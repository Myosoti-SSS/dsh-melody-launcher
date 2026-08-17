import { app, BrowserWindow, net, safeStorage, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppSettings, RuntimeOutput, WindowMode } from '../src/types'
import { ACP_RUNTIME_DIRNAME, CREDENTIALS_LOCK_DIRNAME, createAiInstaller, healCredentialsLock, type AiInstaller } from './ai-install'
import { createApplicationAddonManager, type ApplicationAddonManager } from './application-addons'
import { applyWindowMode, createMainWindow, createRendererChannel } from './app-window'
import { runCommand } from './command'
import { readDeepSeekApiKey } from './credentials'
import { findInstalledDsh } from './dsh-install'
import { buildPluginCommandArgs, createInstaller, validateLocalPluginDirectory, type Installer } from './installer'
import { registerIpcHandlers } from './ipc'
import { createLauncherUpdater, type LauncherUpdater } from './launcher-update'
import { createGitHubAuthService, type GitHubAuthService } from './github-auth'
import {
  ensureNodeRuntime,
  ensurePnpmRuntime,
  findSystemNodeRuntime,
  resolveNodeExecutable,
  type NodeRuntime,
  type NodeRuntimeProgress,
  type PnpmRuntime,
} from './node-runtime'
import { createProxyAwareFetch } from './network'
import { createPackManager, type InstallInstaller, type PackInstallTarget, type PackManager } from './pack'
import { createPluginTrialManager, type PluginTrialManager } from './plugin-trial'
import { recordPluginInstall } from './plugin-receipts'
import { configureProcessTracker, withExecutableDirectoryOnPath } from './process'
import { createProcessSupervisor, type ProcessSupervisor } from './process-supervisor'
import { readProfile, togglePlugin } from './profile'
import { installPresetFromDirectory } from './preset-install'
import { installSkillFromDirectory } from './skill-install'
import { createRendererEvents } from './renderer-events'
import { createRuntimeController, type RuntimeController } from './runtime'
import { createSettingsStore, defaultSettings, type SettingsStore } from './settings'

/**
 * 应用入口与装配根。
 * 这里只负责「谁依赖谁」，具体行为都在各自的模块里。
 */

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let processSupervisor: ProcessSupervisor | null = null
let quitCleanupStarted = false
let allowFinalQuit = false

const getWindow = (): BrowserWindow | null => mainWindow
const events = createRendererEvents(createRendererChannel(getWindow))

interface Services {
  settings: SettingsStore
  runtime: RuntimeController
  installer: Installer
  pluginTrial: PluginTrialManager
  aiInstaller: AiInstaller
  packManager: PackManager
  launcherUpdater: LauncherUpdater
  githubAuth: GitHubAuthService
  applicationAddons: ApplicationAddonManager
}

// app.getPath 依赖 app 就绪，因此服务在 whenReady 之后才装配。
let services: Services | null = null

function createServices(): Services {
  const userData = app.getPath('userData')
  const managedDshRoot = path.join(userData, 'dsh-runtime')
  const managedNodeRoot = path.join(userData, 'node-runtime')
  const managedPnpmRoot = path.join(userData, 'pnpm-runtime')
  const pluginSourceRoot = path.join(userData, 'plugin-sources')
  const pluginReceiptsPath = path.join(userData, 'plugin-installs.json')
  const presetReceiptsPath = path.join(userData, 'preset-installs.json')
  const skillSourceRoot = path.join(userData, 'skill-sources')
  const applicationRoot = path.join(userData, 'application-addons')
  const proxyAwareFetch = createProxyAwareFetch((input, init) => net.fetch(input, init))
  const githubAuth = createGitHubAuthService({
    filePath: path.join(userData, 'github-auth.bin'),
    clientId: process.env.DSH_LAUNCHER_GITHUB_CLIENT_ID,
    fetchImpl: proxyAwareFetch,
    cipher: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: value => safeStorage.encryptString(value),
      decrypt: value => safeStorage.decryptString(value),
    },
  })

  /**
   * 准备 Node.js 运行环境，并把下载进度写进日志。
   * 进度每跨越 10% 记一条，避免刷屏。
   */
  const prepareNodeRuntime = (
    source: RuntimeOutput['channel'],
    onProgress?: (progress: NodeRuntimeProgress) => void,
  ): Promise<NodeRuntime> => {
    let lastBucket = -1
    return ensureNodeRuntime(managedNodeRoot, progress => {
      const bucket = Math.floor(progress.percent / 10)
      if (bucket !== lastBucket || progress.percent === 100) {
        lastBucket = bucket
        events.output(source, 'info', `${progress.message}（${progress.percent}%）`)
      }
      onProgress?.(progress)
    })
  }

  const preparePnpmRuntime = (
    source: RuntimeOutput['channel'],
    nodeRuntime: NodeRuntime,
    onProgress?: (progress: NodeRuntimeProgress) => void,
  ): Promise<PnpmRuntime> => {
    let lastBucket = -1
    return ensurePnpmRuntime(managedPnpmRoot, nodeRuntime, progress => {
      const bucket = Math.floor(progress.percent / 10)
      if (bucket !== lastBucket || progress.percent === 100) {
        lastBucket = bucket
        events.output(source, 'info', `${progress.message}（${progress.percent}%）`)
      }
      onProgress?.(progress)
    })
  }

  const settings = createSettingsStore({
    filePath: path.join(userData, 'settings.json'),
    createDefaults: () => defaultSettings({
      dshHomeFromEnvironment: process.env.DSH_HOME,
      homeDirectory: os.homedir(),
      documentsDirectory: app.getPath('documents'),
      systemNpx: findSystemNodeRuntime()?.npx,
      dshInstallPath: managedDshRoot,
    }),
    detectInstalledDsh: (settings: AppSettings) => findInstalledDsh({
      managedRoot: settings.dshInstallPath,
      configuredExecutable: settings.launchExecutable,
    }),
  })

  let applicationAddons: ApplicationAddonManager
  const runtime = createRuntimeController({
    readSettings: () => settings.read(),
    prepareNodeRuntime: () => prepareNodeRuntime('runtime'),
    fallbackWorkspace: () => app.getPath('documents'),
    emitOutput: (level, text) => events.output('runtime', level, text),
    emitState: state => events.runtimeState(state),
    openExternal: url => void shell.openExternal(url),
    resolveApplicationLaunchPlan: () => applicationAddons.launchPlan(),
  })

  applicationAddons = createApplicationAddonManager({
    registryPath: path.join(userData, 'application-addons.json'),
    installRoot: applicationRoot,
    readSettings: () => settings.read(),
    prepareNodeRuntime: onProgress => prepareNodeRuntime('plugin', onProgress),
    preparePnpmRuntime: (nodeRuntime, onProgress) => preparePnpmRuntime('plugin', nodeRuntime, onProgress),
    emitOutput: (level, text) => events.output('plugin', level, text),
    emitProgress: progress => events.installProgress(progress),
    isRuntimeRunning: () => runtime.isRunning(),
    githubFetch: githubAuth.fetch,
  })

  const installer = createInstaller({
    readSettings: () => settings.read(),
    saveSettings: next => settings.save(next),
    prepareNodeRuntime: onProgress => prepareNodeRuntime('plugin', onProgress),
    preparePnpmRuntime: (nodeRuntime, onProgress) => preparePnpmRuntime('plugin', nodeRuntime, onProgress),
    pluginSourceRoot,
    pluginReceiptsPath,
    presetReceiptsPath,
    skillSourceRoot,
    emitOutput: (level, text) => events.output('plugin', level, text),
    emitProgress: progress => events.installProgress(progress),
    isRuntimeRunning: () => runtime.isRunning(),
    githubFetch: githubAuth.fetch,
  })

  const pluginTrial = createPluginTrialManager({
    readSettings: () => settings.read(),
    prepareNodeRuntime: () => prepareNodeRuntime('plugin'),
    preparePnpmRuntime: nodeRuntime => preparePnpmRuntime('plugin', nodeRuntime),
    trialRoot: path.join(userData, 'plugin-trials'),
    resultsPath: path.join(userData, 'plugin-trial-results.json'),
    emitOutput: (level, text) => events.output('plugin', level, text),
    emitResult: result => events.pluginTrial(result),
    isRuntimeRunning: () => runtime.isRunning(),
    isInstallerBusy: () => installer.isBusy(),
  })

  const aiInstaller = createAiInstaller({
    readSettings: () => settings.read(),
    prepareNodeRuntime: () => prepareNodeRuntime('ai'),
    preparePnpmRuntime: nodeRuntime => preparePnpmRuntime('ai', nodeRuntime),
    acpRuntimeRoot: path.join(userData, ACP_RUNTIME_DIRNAME),
    snapshotRoot: path.join(userData, 'ai-snapshots'),
    emitOutput: (level, text) => events.output('ai', level, text),
    emitEvent: event => events.aiInstallEvent(event),
    isRuntimeRunning: () => runtime.isRunning(),
    isInstallerBusy: () => installer.isBusy(),
    analyzePlugin: (repository, defaultBranch) => installer.analyzePlugin(repository, defaultBranch),
    readApiKey: dshHome => readDeepSeekApiKey(dshHome),
    githubFetch: githubAuth.fetch,
  })

  /**
   * 整合包离线导入（zip 内的 plugin-bodies）用 `file:` specifier 安装。
   * 真实 installer 的 installPluginTarget 只接受 GitHub 仓库分析，无法直接
   * 安装本地目录，因此这里在组装层用 DSH CLI 插件命令补上最小通路。
   */
  async function installPackLocalDirectory(target: PackInstallTarget): Promise<void> {
    const localDirectory = validateLocalPluginDirectory(target.localDirectory)
    const current = await settings.read()
    const nodeRuntime = await prepareNodeRuntime('plugin')
    const pnpmRuntime = await preparePnpmRuntime('plugin', nodeRuntime)
    const executable = resolveNodeExecutable(current.launchExecutable, nodeRuntime)
    const commandArgs = buildPluginCommandArgs(current, executable, ['add', `file:${localDirectory}`], target.profileName)
    const result = await runCommand(executable, commandArgs, {
      cwd: current.workspace,
      env: withExecutableDirectoryOnPath(
        pnpmRuntime.executable,
        withExecutableDirectoryOnPath(nodeRuntime.node, {
          ...process.env,
          DSH_HOME: current.dshHome,
          FORCE_COLOR: '0',
        }),
      ),
    })
    if (result.exitCode !== 0) throw new Error(`插件安装失败（代码 ${result.exitCode}），请查看运行日志。`)
    let version: string | null = null
    try {
      const packageManifest = JSON.parse(await readFile(path.join(localDirectory, 'package.json'), 'utf8')) as { version?: unknown }
      version = typeof packageManifest.version === 'string' ? packageManifest.version : null
    } catch {
      // 版本读取失败可忽略，receipt 的 version 允许为 null。
    }
    await recordPluginInstall(pluginReceiptsPath, {
      repository: `file:${localDirectory}`,
      packageName: target.packageName,
      profileName: target.profileName,
      source: 'local-directory',
      subdirectory: null,
      version,
      commit: '',
      installedAt: new Date().toISOString(),
    })
  }

  const packInstaller: InstallInstaller = {
    async installPluginTarget(target) {
      if (target.source === 'local-directory') {
        await installPackLocalDirectory(target)
        return
      }
      if (!target.repository) throw new Error('缺少来源仓库，无法安装。')
      // 真实 installer 按 analysis.targets 的 id 定位，id 形如 `<packageName>:<subdir|.>`。
      const targetId = target.subdirectory ? `${target.packageName}:${target.subdirectory}` : `${target.packageName}:.`
      const request: {
        repository: string
        defaultBranch: string
        targetId: string
        commit?: string
        version?: string
      } = { repository: target.repository, defaultBranch: 'main', targetId }
      // 转发整合包声明的 pin：github 用固定 commit，npm 用固定 version（0.0.0 是占位符，不转发）。
      if (target.source === 'github' && target.commit) request.commit = target.commit
      if (target.source === 'npm' && target.version && target.version !== '0.0.0') request.version = target.version
      await installer.installPluginTarget(request, target.profileName)
    },
    remove: (packageName, profileName) => installer.remove(packageName, profileName),
    readProfile: (dshHome, profileName) => readProfile(dshHome, profileName),
    togglePlugin: (dshHome, profileName, packageName, enabled) => togglePlugin(dshHome, profileName, packageName, enabled),
    // raw 整合包导入的技能：从本地 staging 目录全局安装（bundle 目录或 flat 单文件）。
    installSkillLocal: (dshHome, skill) => installSkillFromDirectory(dshHome, skill.name, skill.format, skill.sourceDir),
    installPreset: request => installer.installPreset(request),
    installPresetLocal: (dshHome, preset) => installPresetFromDirectory(dshHome, preset.name, preset.sourceDir),
    togglePreset: (name, enabled) => installer.togglePreset(name, enabled),
  }

  const packManager = createPackManager({
    readSettings: () => settings.read(),
    saveSettings: next => settings.save(next),
    registryPath: path.join(userData, 'packs.json'),
    snapshotRoot: path.join(userData, 'pack-snapshots'),
    pluginReceiptsPath,
    presetReceiptsPath,
    installer: packInstaller,
    emitOutput: (level, text) => events.output('plugin', level, text),
    emitEvent: event => events.packProgress(event),
    isRuntimeRunning: () => runtime.isRunning(),
    isInstallerBusy: () => installer.isBusy(),
  })

  const launcherUpdater = createLauncherUpdater({
    getVersion: () => app.getVersion(),
    userDataPath: userData,
    githubFetch: githubAuth.fetch,
    emitProgress: progress => events.launcherUpdateProgress(progress),
  })

  // 启动自愈：上次 AI 会话若在凭据锁期间崩溃（进程被杀、finally 未跑），
  // .credentials.yaml 会滞留在锁目录，这里把它还原回 dshHome。
  void settings
    .read()
    .then(current => healCredentialsLock(current.dshHome, path.join(userData, CREDENTIALS_LOCK_DIRNAME)))
    .catch(() => { /* 设置未就绪可忽略，锁会在下次 AI 会话前置处理 */ })

  return { settings, runtime, installer, launcherUpdater, pluginTrial, aiInstaller, packManager, githubAuth, applicationAddons }
}

function openMainWindow(): void {
  mainWindow = createMainWindow({
    preloadPath: path.join(moduleDirectory, 'preload.mjs'),
    iconPath: path.join(moduleDirectory, app.isPackaged ? '../dist/launcher-icon.png' : '../public/launcher-icon.png'),
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
    indexPath: path.join(moduleDirectory, '../dist/index.html'),
    onClosed: () => { mainWindow = null },
  })
}

app.whenReady().then(async () => {
  try {
    processSupervisor = await createProcessSupervisor({
      root: path.join(app.getPath('userData'), 'process-supervisor'),
      onError: message => console.error(`[process-supervisor] ${message}`),
    })
    configureProcessTracker(processSupervisor)
  } catch (error) {
    console.error('[process-supervisor] 启动失败，退出时只能执行普通清理。', error)
  }
  services = createServices()
  registerIpcHandlers({
    ...services,
    getWindow,
    setWindowMode: (mode: WindowMode) => applyWindowMode(mainWindow, mode),
  })
  openMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function waitForIdle(check: () => boolean): Promise<void> {
  if (!check()) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setInterval(() => {
      if (!check()) {
        clearInterval(timer)
        resolve()
      }
    }, 100)
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function shutdownLauncherProcesses(): Promise<void> {
  const current = services
  const gracefulTasks: Promise<unknown>[] = []
  if (current?.runtime.isRunning()) gracefulTasks.push(current.runtime.stop())
  if (current?.pluginTrial.isBusy()) gracefulTasks.push(current.pluginTrial.cancel())
  if (current?.aiInstaller.isBusy()) gracefulTasks.push(current.aiInstaller.cancel())
  if (current?.packManager.isBusy()) gracefulTasks.push(waitForIdle(() => current.packManager.isBusy()))
  if (current?.installer.isBusy()) gracefulTasks.push(waitForIdle(() => current.installer.isBusy()))
  if (current?.applicationAddons.isBusy()) gracefulTasks.push(waitForIdle(() => current.applicationAddons.isBusy()))

  const graceful = Promise.allSettled(gracefulTasks)
  await Promise.race([graceful, delay(2_000)])
  await processSupervisor?.shutdown().catch(error => {
    console.error('[process-supervisor] 清理子进程失败。', error)
  })
  configureProcessTracker(null)
  await Promise.race([graceful, delay(800)])

  if (current) {
    try {
      const settings = await current.settings.read()
      await healCredentialsLock(
        settings.dshHome,
        path.join(app.getPath('userData'), CREDENTIALS_LOCK_DIRNAME),
      )
    } catch (error) {
      console.error('[shutdown] AI 凭据文件还原失败。', error)
    }
  }
}

// 无论是正常关闭还是安装过程中退出，所有由启动器登记的进程树都必须一起结束。
app.on('before-quit', event => {
  if (allowFinalQuit) return
  event.preventDefault()
  if (quitCleanupStarted) return
  quitCleanupStarted = true
  void shutdownLauncherProcesses().finally(() => {
    allowFinalQuit = true
    app.quit()
  })
})
