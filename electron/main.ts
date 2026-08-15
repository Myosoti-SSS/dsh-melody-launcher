import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AppSettings,
  DiscoveryResult,
  InstallProgress,
  PluginInstallRequest,
  PluginInstallTarget,
  RepositoryAnalysis,
  RepositoryInstallResult,
  RepositoryResult,
  RuntimeOutput,
  RuntimeState,
  SkillDiscoveryResult,
  SkillInstallRequest,
  SkillInstallResult,
  SkillRepositoryAnalysis,
  SkillRepositoryResult,
  WindowMode,
} from '../src/types'
import {
  isSafePackageName,
  isSafeProfileName,
  isSafeRepositoryName,
  pathExists,
  readProfile,
  reorderPlugins,
  togglePlugin,
} from './profile'
import {
  clearDeepSeekApiKey,
  getDeepSeekCredentialStatus,
  setDeepSeekApiKey,
} from './credentials'
import { spawnCommand, withExecutableDirectoryOnPath } from './process'
import { approveBuildKeys, ignoredBuildKeys } from './plugin-install'
import { analyzeRepository } from './plugin-catalog'
import { analyzeSkillRepository } from './skill-catalog'
import { readInstalledSkills as readLocalSkills } from './skill-format'
import { installSkillFromRepository } from './skill-install'
import { prepareSubdirectoryPlugin } from './plugin-source'
import {
  readPluginReceipts,
  recordPluginInstall,
  removePluginReceipt,
} from './plugin-receipts'
import {
  findInstalledDsh,
  getManagedDshStatus,
  installWaitingMessage,
  isDshRepository,
  managedDshExecutable,
  packageManagerProgress,
} from './dsh-install'
import {
  ensureNodeRuntime,
  ensurePnpmRuntime,
  findSystemNodeRuntime,
  requiresNodeRuntime,
  resolveNodeExecutable,
  type NodeRuntime,
  type NodeRuntimeProgress,
} from './node-runtime'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let runtimeProcess: ChildProcessWithoutNullStreams | null = null
let runtimeStartedAt: string | null = null
let runtimeUrl: string | null = null
let settingsCache: AppSettings | null = null
let quitAfterRuntimeStops = false
let activeInstallation: InstallProgress | null = null
const repositoryAnalysisCache = new Map<string, { expiresAt: number; analysis: RepositoryAnalysis }>()
const skillAnalysisCache = new Map<string, { expiresAt: number; analysis: SkillRepositoryAnalysis }>()

const WINDOW_MODES: Record<WindowMode, { width: number; height: number; minWidth: number; minHeight: number }> = {
  launcher: { width: 900, height: 560, minWidth: 760, minHeight: 480 },
  manager: { width: 1380, height: 860, minWidth: 1024, minHeight: 680 },
}

function defaultManagedDshRoot(): string {
  return path.join(app.getPath('userData'), 'dsh-runtime')
}

function managedNodeRoot(): string {
  return path.join(app.getPath('userData'), 'node-runtime')
}

function managedPnpmRoot(): string {
  return path.join(app.getPath('userData'), 'pnpm-runtime')
}

function pluginSourceRoot(): string {
  return path.join(app.getPath('userData'), 'plugin-sources')
}

function pluginReceiptsPath(): string {
  return path.join(app.getPath('userData'), 'plugin-installs.json')
}

function skillSourceRoot(): string {
  return path.join(app.getPath('userData'), 'skill-sources')
}

async function analyzePluginRepository(fullName: string, defaultBranch: string): Promise<RepositoryAnalysis> {
  const settings = await getSettings()
  const cacheKey = `${fullName.toLowerCase()}#${defaultBranch}#${settings.profileName}`
  const cached = repositoryAnalysisCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.analysis
  const analysis = await analyzeRepository(fullName, defaultBranch, settings.profileName)
  repositoryAnalysisCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, analysis })
  return analysis
}

async function analyzeSkillCatalogRepository(fullName: string, defaultBranch: string): Promise<SkillRepositoryAnalysis> {
  const cacheKey = `${fullName.toLowerCase()}#${defaultBranch}`
  const cached = skillAnalysisCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.analysis
  const analysis = await analyzeSkillRepository(fullName, defaultBranch)
  skillAnalysisCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, analysis })
  return analysis
}

function setWindowMode(mode: WindowMode): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const size = WINDOW_MODES[mode]
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  mainWindow.setMinimumSize(size.minWidth, size.minHeight)
  mainWindow.setSize(size.width, size.height, true)
  mainWindow.center()
}

function withNodeOnPath(runtime: NodeRuntime, environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return withExecutableDirectoryOnPath(runtime.node, environment)
}

async function prepareNodeRuntime(channel: RuntimeOutput['channel'], repository?: string): Promise<NodeRuntime> {
  let lastLogBucket = -1
  return ensureNodeRuntime(managedNodeRoot(), (progress: NodeRuntimeProgress) => {
    const bucket = Math.floor(progress.percent / 10)
    if (bucket !== lastLogBucket || progress.percent === 100) {
      lastLogBucket = bucket
      emitOutput(channel, 'info', `${progress.message}（${progress.percent}%）`)
    }
    if (repository && activeInstallation) {
      emitInstallProgress({
        repository,
        kind: activeInstallation.kind,
        phase: 'preparing',
        percent: Math.min(17, 5 + Math.round(progress.percent * 0.12)),
        message: progress.message,
      })
    }
  })
}

function defaultSettings(): AppSettings {
  return {
    dshInstallPath: defaultManagedDshRoot(),
    dshHome: process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
    profileName: 'web',
    workspace: app.getPath('documents'),
    launchExecutable: findSystemNodeRuntime()?.npx ?? (process.platform === 'win32' ? 'npx.cmd' : 'npx'),
    launchArgs: ['--yes', '@deepseek-ai/dsh', 'web'],
    openAfterLaunch: true,
  }
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function usesOnDemandDsh(settings: AppSettings): boolean {
  const executable = path.basename(settings.launchExecutable).toLowerCase()
  return (executable === 'npx' || executable === 'npx.cmd') && settings.launchArgs.includes('@deepseek-ai/dsh')
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left)
  const resolvedRight = path.resolve(right)
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight
}

async function getSettings(): Promise<AppSettings> {
  if (settingsCache) return settingsCache
  const defaults = defaultSettings()
  try {
    const stored = JSON.parse(await readFile(settingsPath(), 'utf8')) as Partial<AppSettings>
    settingsCache = {
      ...defaults,
      ...stored,
      dshInstallPath: typeof stored.dshInstallPath === 'string' && path.isAbsolute(stored.dshInstallPath)
        ? stored.dshInstallPath
        : defaults.dshInstallPath,
      launchArgs: Array.isArray(stored.launchArgs) ? stored.launchArgs.filter(value => typeof value === 'string') : defaults.launchArgs,
    }
  } catch {
    settingsCache = defaults
  }
  if (usesOnDemandDsh(settingsCache)) {
    const detected = await findInstalledDsh({
      managedRoot: settingsCache.dshInstallPath,
      configuredExecutable: settingsCache.launchExecutable,
    })
    if (detected.installed && detected.executable) {
      settingsCache = { ...settingsCache, launchExecutable: detected.executable, launchArgs: ['web'] }
    }
  }
  return settingsCache
}

function validateSettings(input: AppSettings): AppSettings {
  if (!input || typeof input !== 'object') throw new Error('设置格式无效。')
  if (!isSafeProfileName(input.profileName)) throw new Error('配置名称只能包含字母、数字、点、横线或下划线。')
  if (!path.isAbsolute(input.dshInstallPath) || !path.isAbsolute(input.dshHome) || !path.isAbsolute(input.workspace)) throw new Error('目录必须使用完整路径。')
  const resolvedInstallPath = path.resolve(input.dshInstallPath)
  if (resolvedInstallPath === path.parse(resolvedInstallPath).root) throw new Error('DSH 本体不能直接安装到磁盘根目录。')
  if (samePath(input.dshInstallPath, input.dshHome)) throw new Error('DSH 本体安装目录不能与 DSH_HOME 相同。')
  if (!input.launchExecutable.trim()) throw new Error('启动命令不能为空。')
  if (!Array.isArray(input.launchArgs) || input.launchArgs.some(value => typeof value !== 'string')) throw new Error('启动参数格式无效。')
  return {
    dshInstallPath: input.dshInstallPath,
    dshHome: input.dshHome,
    profileName: input.profileName,
    workspace: input.workspace,
    launchExecutable: input.launchExecutable.trim(),
    launchArgs: input.launchArgs,
    openAfterLaunch: Boolean(input.openAfterLaunch),
  }
}

async function saveSettings(input: AppSettings): Promise<AppSettings> {
  const current = await getSettings()
  let next = validateSettings(input)
  const installPathChanged = !samePath(current.dshInstallPath, next.dshInstallPath)
  const usedPreviousManagedExecutable = samePath(next.launchExecutable, managedDshExecutable(current.dshInstallPath))
  if (installPathChanged && usedPreviousManagedExecutable) {
    next = { ...next, launchExecutable: managedDshExecutable(next.dshInstallPath), launchArgs: ['web'] }
  }
  await mkdir(path.dirname(settingsPath()), { recursive: true })
  await writeFile(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  settingsCache = next
  return next
}

async function detectDshInstallation() {
  const settings = await getSettings()
  return findInstalledDsh({ managedRoot: settings.dshInstallPath, configuredExecutable: settings.launchExecutable })
}

function runtimeState(): RuntimeState {
  return {
    running: runtimeProcess !== null,
    pid: runtimeProcess?.pid ?? null,
    startedAt: runtimeStartedAt,
    url: runtimeUrl,
  }
}

function emitState(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send('runtime:state-changed', runtimeState())
}

function emitOutput(channel: RuntimeOutput['channel'], level: RuntimeOutput['level'], text: string): void {
  const normalized = text.replace(/\r\n/g, '\n').trimEnd()
  if (!normalized) return
  const output: RuntimeOutput = { channel, level, text: normalized, timestamp: new Date().toISOString() }
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send('runtime:output', output)
}

function emitInstallProgress(progress: InstallProgress): void {
  activeInstallation = progress
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send('plugins:install-progress', progress)
}

function currentInstallPercent(fallback: number): number {
  return activeInstallation?.percent ?? fallback
}

function beginPackageInstallProgress(
  repository: string,
  kind: InstallProgress['kind'],
  message: string,
): { handleOutput: (text: string) => void; stop: () => void } {
  const startedAt = Date.now()
  let hasMeasuredProgress = false

  const emitWaiting = () => {
    if (hasMeasuredProgress) return
    emitInstallProgress({
      repository,
      kind,
      phase: 'downloading',
      percent: Math.max(28, currentInstallPercent(28)),
      message: installWaitingMessage(message, Date.now() - startedAt),
      indeterminate: true,
    })
  }

  emitWaiting()
  const heartbeat = setInterval(emitWaiting, 5_000)
  heartbeat.unref()

  return {
    handleOutput: text => {
      const parsed = packageManagerProgress(text, currentInstallPercent(28))
      if (!parsed || (parsed.indeterminate && hasMeasuredProgress)) return
      if (!parsed.indeterminate) hasMeasuredProgress = true
      emitInstallProgress({ repository, kind, phase: 'downloading', ...parsed })
    },
    stop: () => clearInterval(heartbeat),
  }
}

function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/[^\s]*)?/i)
  return match?.[0] ?? null
}

async function startRuntime(): Promise<RuntimeState> {
  if (runtimeProcess) return runtimeState()
  const settings = await getSettings()
  const cwd = (await pathExists(settings.workspace)) ? settings.workspace : app.getPath('documents')
  let executable = settings.launchExecutable
  let environment: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: settings.dshHome, FORCE_COLOR: '0' }
  if (requiresNodeRuntime(executable, settings.launchArgs)) {
    const nodeRuntime = await prepareNodeRuntime('runtime')
    executable = resolveNodeExecutable(executable, nodeRuntime)
    environment = withNodeOnPath(nodeRuntime, environment)
  }
  emitOutput('runtime', 'info', `启动：${executable} ${settings.launchArgs.join(' ')}`)
  emitOutput('runtime', 'info', `工作目录：${cwd}`)
  const child = spawnCommand(executable, settings.launchArgs, {
    cwd,
    env: environment,
  })
  runtimeProcess = child
  runtimeStartedAt = new Date().toISOString()
  runtimeUrl = null
  emitState()
  let stderrOutput = ''

  const handleData = (level: RuntimeOutput['level']) => (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    if (level === 'error') stderrOutput = `${stderrOutput}${text}`.slice(-24_000)
    emitOutput('runtime', level, text)
    const foundUrl = extractUrl(text)
    if (foundUrl && foundUrl !== runtimeUrl) {
      runtimeUrl = foundUrl
      emitState()
      if (settings.openAfterLaunch) void shell.openExternal(foundUrl)
    }
  }
  child.stdout.on('data', handleData('info'))
  child.stderr.on('data', handleData('error'))
  child.once('error', error => {
    emitOutput('runtime', 'error', `启动失败：${error.message}`)
  })
  child.once('exit', code => {
    const expected = runtimeProcess === null
    runtimeProcess = null
    if (!expected && code !== 0 && stderrOutput.includes('EADDRINUSE')) {
      emitOutput('runtime', 'error', '本地端口已被其他进程占用。请关闭旧的 DSH 服务，或在启动参数中指定其他端口。')
    }
    emitOutput('runtime', code === 0 || expected ? 'success' : 'error', `DSH 已退出（代码 ${code ?? '未知'}）`)
    emitState()
  })
  return runtimeState()
}

async function stopRuntime(): Promise<RuntimeState> {
  const child = runtimeProcess
  if (!child) return runtimeState()
  runtimeProcess = null
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
    await new Promise<void>(resolve => {
      killer.once('error', () => resolve())
      killer.once('exit', () => resolve())
    })
  } else {
    child.kill('SIGTERM')
  }
  emitOutput('runtime', 'info', '已发送停止请求。')
  emitState()
  return runtimeState()
}

async function runPluginCommand(
  args: string[],
  installingRepository?: string,
  profileName?: string,
  allowBuildRetry = true,
): Promise<void> {
  const settings = await getSettings()
  const nodeRuntime = await prepareNodeRuntime('plugin', installingRepository)
  const pnpmRuntime = await ensurePnpmRuntime(managedPnpmRoot(), nodeRuntime, progress => {
    emitOutput('plugin', 'info', progress.message)
    if (installingRepository) {
      emitInstallProgress({
        repository: installingRepository,
        kind: 'plugin',
        phase: 'resolving',
        percent: 10 + Math.round(progress.percent * 0.12),
        message: progress.message,
      })
    }
  })
  const executable = resolveNodeExecutable(settings.launchExecutable, nodeRuntime)
  const packageIndex = settings.launchArgs.indexOf('@deepseek-ai/dsh')
  const prefix = packageIndex >= 0
    ? settings.launchArgs.slice(0, packageIndex + 1)
    : path.basename(executable).toLowerCase().startsWith('dsh')
      ? []
      : ['--yes', '@deepseek-ai/dsh']
  const targetProfile = profileName ?? settings.profileName
  const commandArgs = [...prefix, 'plugin', '--profile', targetProfile, ...args]
  emitOutput('plugin', 'info', `插件操作：${args.join(' ')}`)
  if (installingRepository) {
    emitInstallProgress({ repository: installingRepository, kind: 'plugin', phase: 'resolving', percent: 18, message: '正在解析插件仓库' })
  }
  const child = spawnCommand(executable, commandArgs, {
    cwd: settings.workspace,
    env: withExecutableDirectoryOnPath(pnpmRuntime.executable, withNodeOnPath(nodeRuntime, {
      ...process.env,
      DSH_HOME: settings.dshHome,
      FORCE_COLOR: '0',
    })),
  })
  const progressReporter = installingRepository
    ? beginPackageInstallProgress(installingRepository, 'plugin', '正在下载并安装插件')
    : null
  let commandOutput = ''
  const handleOutput = (level: RuntimeOutput['level']) => (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    commandOutput = `${commandOutput}${text}`.slice(-48_000)
    emitOutput('plugin', level, text)
    progressReporter?.handleOutput(text)
  }
  child.stdout.on('data', handleOutput('info'))
  child.stderr.on('data', handleOutput('error'))
  let exitCode: number
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => resolve(code ?? 1))
    })
  } finally {
    progressReporter?.stop()
  }
  if (exitCode !== 0 && installingRepository && allowBuildRetry && commandOutput.includes('ERR_PNPM_IGNORED_BUILDS')) {
    const buildKeys = ignoredBuildKeys(commandOutput)
    const workspacePath = path.join(settings.dshHome, 'profiles', targetProfile, 'pnpm-workspace.yaml')
    const decision = buildKeys.length > 0 && mainWindow
      ? await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: '插件需要运行构建脚本',
          message: '是否允许这些包在安装期间运行构建脚本？',
          detail: `${buildKeys.join('\n')}\n\n构建脚本会在本机执行代码。请只允许你信任的插件和依赖。`,
          buttons: ['取消安装', '允许并重试'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
      : null
    if (decision?.response === 1) {
      const approved = await approveBuildKeys(workspacePath, buildKeys)
      emitOutput('plugin', 'info', `已允许 ${approved.length} 个明确列出的构建脚本，正在重试。`)
      emitInstallProgress({
        repository: installingRepository,
        kind: 'plugin',
        phase: 'building',
        percent: Math.max(82, currentInstallPercent(82)),
        message: '已确认构建权限，正在重新安装',
      })
      return runPluginCommand(args, installingRepository, targetProfile, false)
    }
  }
  if (exitCode !== 0) throw new Error(`插件操作失败（代码 ${exitCode}），请查看运行日志。`)
  emitOutput('plugin', 'success', '插件操作完成。')
}

async function verifyProfileComposition(profileName: string, repository: string): Promise<void> {
  const settings = await getSettings()
  const nodeRuntime = await prepareNodeRuntime('plugin', repository)
  const executable = resolveNodeExecutable(settings.launchExecutable, nodeRuntime)
  const packageIndex = settings.launchArgs.indexOf('@deepseek-ai/dsh')
  const prefix = packageIndex >= 0
    ? settings.launchArgs.slice(0, packageIndex + 1)
    : path.basename(executable).toLowerCase().startsWith('dsh')
      ? []
      : ['--yes', '@deepseek-ai/dsh']
  const child = spawnCommand(executable, [...prefix, '--profile', profileName, '--dump-config'], {
    cwd: settings.workspace,
    env: withNodeOnPath(nodeRuntime, { ...process.env, DSH_HOME: settings.dshHome, FORCE_COLOR: '0' }),
  })
  let diagnostics = ''
  child.stderr.on('data', (chunk: Buffer) => { diagnostics = `${diagnostics}${chunk.toString('utf8')}`.slice(-8_000) })
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolve(code ?? 1))
  })
  if (exitCode !== 0) {
    throw new Error(`插件已安装，但组合验证失败。${diagnostics ? `\n${diagnostics.trim()}` : ''}`)
  }
}

async function installManagedDsh(repository: string): Promise<RepositoryInstallResult> {
  if (runtimeProcess) throw new Error('请先停止 DSH，再安装或更新本地 DSH。')
  const currentSettings = await getSettings()
  const runtimeRoot = currentSettings.dshInstallPath
  await mkdir(runtimeRoot, { recursive: true })
  const manifestPath = path.join(runtimeRoot, 'package.json')
  if (existsSync(manifestPath)) {
    let manifest: { name?: unknown; dependencies?: Record<string, unknown> }
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof manifest
    } catch {
      throw new Error('所选 DSH 安装目录包含无法读取的 package.json，请选择空目录或已有的启动器安装目录。')
    }
    if (manifest.name !== 'dsh-launcher-runtime' && !Object.hasOwn(manifest.dependencies ?? {}, '@deepseek-ai/dsh')) {
      throw new Error('所选 DSH 安装目录已被其他 Node.js 项目使用，请选择空目录。')
    }
  } else {
    await writeFile(manifestPath, `${JSON.stringify({ name: 'dsh-launcher-runtime', private: true }, null, 2)}\n`, 'utf8')
  }

  const nodeRuntime = await prepareNodeRuntime('plugin', repository)
  emitInstallProgress({ repository, kind: 'dsh', phase: 'resolving', percent: 18, message: '正在解析 DSH 安装包' })
  const child = spawnCommand(nodeRuntime.npm, [
    'install',
    '--prefix', runtimeRoot,
    '--save-exact',
    '--no-audit',
    '--no-fund',
    '--progress=true',
    '@deepseek-ai/dsh@latest',
  ], {
    cwd: runtimeRoot,
    env: withNodeOnPath(nodeRuntime, { ...process.env, FORCE_COLOR: '0', NPM_CONFIG_UPDATE_NOTIFIER: 'false' }),
  })
  const progressReporter = beginPackageInstallProgress(repository, 'dsh', '正在下载并安装 DSH')

  const handleOutput = (level: RuntimeOutput['level']) => (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    emitOutput('plugin', level, text)
    progressReporter.handleOutput(text)
  }
  child.stdout.on('data', handleOutput('info'))
  child.stderr.on('data', handleOutput('error'))
  let exitCode: number
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => resolve(code ?? 1))
    })
  } finally {
    progressReporter.stop()
  }
  if (exitCode !== 0) throw new Error(`本地 DSH 安装失败（代码 ${exitCode}），请查看运行日志。`)

  emitInstallProgress({ repository, kind: 'dsh', phase: 'configuring', percent: 90, message: '正在切换本地启动命令' })
  const dshInstallation = await getManagedDshStatus(runtimeRoot)
  if (!dshInstallation.installed || !dshInstallation.executable) {
    throw new Error('安装完成，但没有找到本地 DSH 可执行文件。')
  }
  const settings = await saveSettings({
    ...currentSettings,
    launchExecutable: dshInstallation.executable,
    launchArgs: ['web'],
  })
  const profile = await readProfile(settings.dshHome, settings.profileName)
  emitInstallProgress({
    repository,
    kind: 'dsh',
    phase: 'complete',
    percent: 100,
    message: `DSH ${dshInstallation.version ?? ''} 已安装`,
  })
  return { kind: 'dsh', profile, settings, dshInstallation }
}

async function installRepository(request: string | PluginInstallRequest): Promise<RepositoryInstallResult> {
  const fullName = typeof request === 'string' ? request : request.repository
  if (activeInstallation) throw new Error(`正在安装 ${activeInstallation.repository}，请等待当前任务完成。`)
  const kind = isDshRepository(fullName) ? 'dsh' : 'plugin'
  emitInstallProgress({ repository: fullName, kind, phase: 'preparing', percent: 5, message: kind === 'dsh' ? '正在准备本地 DSH' : '正在检查插件结构' })
  try {
    if (kind === 'dsh') return await installManagedDsh(fullName)
    if (typeof request === 'string') throw new Error('请先检测仓库并选择可安装的插件组件。')
    const analysis = await analyzePluginRepository(fullName, request.defaultBranch)
    const target = analysis.targets.find(item => item.id === request.targetId)
    if (!target) throw new Error(analysis.summary || '所选插件组件已经失效，请重新检测仓库。')

    let specifier: string
    if (target.source === 'npm') {
      specifier = target.version ? `${target.packageName}@${target.version}` : target.packageName
    } else if (target.source === 'github') {
      specifier = `github:${fullName}#${target.commit}`
    } else {
      const packageDirectory = await prepareSubdirectoryPlugin(
        pluginSourceRoot(),
        fullName,
        target,
        (percent, message) => emitInstallProgress({ repository: fullName, kind: 'plugin', phase: 'downloading', percent, message }),
      )
      specifier = `file:${packageDirectory}`
    }

    await runPluginCommand(['add', specifier], fullName, target.profileName)
    emitInstallProgress({ repository: fullName, kind, phase: 'configuring', percent: 88, message: '正在核对插件加载顺序' })
    const settings = await getSettings()
    const installedProfile = await readProfile(settings.dshHome, target.profileName)
    const installedPlugin = installedProfile.plugins.find(plugin => plugin.packageName === target.packageName)
    if (!installedPlugin?.enabled || !installedPlugin.compatible) {
      throw new Error('包已下载，但 DSH 没有把它识别为有效 Bundle。请检查插件清单和补丁文件。')
    }
    emitInstallProgress({ repository: fullName, kind, phase: 'verifying', percent: 94, message: '正在验证插件组合配置' })
    await verifyProfileComposition(target.profileName, fullName)
    await recordPluginInstall(pluginReceiptsPath(), {
      repository: fullName,
      packageName: target.packageName,
      profileName: target.profileName,
      source: target.source,
      subdirectory: target.subdirectory,
      version: target.version,
      commit: target.commit,
      installedAt: new Date().toISOString(),
    })
    const profile = target.profileName === settings.profileName
      ? installedProfile
      : await readProfile(settings.dshHome, settings.profileName)
    const dshInstallation = await detectDshInstallation()
    emitInstallProgress({ repository: fullName, kind, phase: 'complete', percent: 100, message: `插件已安装到 ${target.profileName} Profile` })
    return {
      kind,
      profile,
      settings,
      dshInstallation,
      installedProfileName: target.profileName,
      packageName: target.packageName,
    }
  } catch (error) {
    emitInstallProgress({
      repository: fullName,
      kind,
      phase: 'error',
      percent: currentInstallPercent(0),
      message: error instanceof Error ? error.message : '安装失败',
    })
    throw error
  } finally {
    activeInstallation = null
  }
}

async function discoverPlugins(query: string, sort: 'stars' | 'updated'): Promise<DiscoveryResult> {
  const normalizedQuery = query.trim().replace(/[^\p{L}\p{N}._ -]/gu, ' ').slice(0, 80)
  const searchQuery = `topic:dsh-plugin${normalizedQuery ? ` ${normalizedQuery} in:name,description` : ''}`
  const url = new URL('https://api.github.com/search/repositories')
  url.searchParams.set('q', searchQuery)
  url.searchParams.set('sort', sort)
  url.searchParams.set('order', 'desc')
  url.searchParams.set('per_page', '30')
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DSH-Launcher',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) {
    if (response.status === 403) throw new Error('GitHub 请求额度暂时用尽，请稍后重试。')
    throw new Error(`GitHub 返回 ${response.status}，暂时无法获取插件。`)
  }
  const data = await response.json() as {
    total_count: number
    items: Array<{
      id: number
      full_name: string
      name: string
      owner: { login: string }
      description: string | null
      html_url: string
      stargazers_count: number
      language: string | null
      updated_at: string
      topics?: string[]
      default_branch: string
    }>
  }
  const repositories: RepositoryResult[] = data.items.map(item => ({
    id: item.id,
    fullName: item.full_name,
    name: item.name,
    owner: item.owner.login,
    description: item.description ?? '此仓库没有提供说明。',
    url: item.html_url,
    stars: item.stargazers_count,
    language: item.language,
    updatedAt: item.updated_at,
    topics: item.topics ?? [],
    defaultBranch: item.default_branch,
    kind: isDshRepository(item.full_name) ? 'dsh' : 'plugin',
  }))
  const remaining = Number(response.headers.get('x-ratelimit-remaining'))
  const settings = await getSettings()
  const profile = await readProfile(settings.dshHome, settings.profileName)
  const receipts = await readPluginReceipts(pluginReceiptsPath())
  const installedRepositories = new Set<string>()
  for (const plugin of profile.plugins) {
    if (plugin.repositoryFullName) installedRepositories.add(plugin.repositoryFullName)
  }
  for (const receipt of receipts) installedRepositories.add(receipt.repository)
  return {
    repositories,
    totalCount: data.total_count,
    rateRemaining: Number.isFinite(remaining) ? remaining : undefined,
    dshInstallation: await detectDshInstallation(),
    installedRepositories: [...installedRepositories],
  }
}

async function discoverSkills(query: string, sort: 'stars' | 'updated'): Promise<SkillDiscoveryResult> {
  const normalizedQuery = query.trim().replace(/[^\p{L}\p{N}._ -]/gu, ' ').slice(0, 80)
  const searchQuery = `topic:dsh-skill${normalizedQuery ? ` ${normalizedQuery} in:name,description` : ''}`
  const url = new URL('https://api.github.com/search/repositories')
  url.searchParams.set('q', searchQuery)
  url.searchParams.set('sort', sort)
  url.searchParams.set('order', 'desc')
  url.searchParams.set('per_page', '30')
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DSH-Launcher',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) {
    if (response.status === 403) throw new Error('GitHub 请求额度暂时用尽，请稍后重试。')
    throw new Error(`GitHub 返回 ${response.status}，暂时无法获取 Skills。`)
  }
  const data = await response.json() as {
    total_count: number
    items: Array<{
      id: number
      full_name: string
      name: string
      owner: { login: string }
      description: string | null
      html_url: string
      stargazers_count: number
      language: string | null
      updated_at: string
      topics?: string[]
      default_branch: string
    }>
  }
  const repositories: SkillRepositoryResult[] = data.items.map(item => ({
    id: item.id,
    fullName: item.full_name,
    name: item.name,
    owner: item.owner.login,
    description: item.description ?? '此仓库没有提供说明。',
    url: item.html_url,
    stars: item.stargazers_count,
    language: item.language,
    updatedAt: item.updated_at,
    topics: item.topics ?? [],
    defaultBranch: item.default_branch,
  }))
  const remaining = Number(response.headers.get('x-ratelimit-remaining'))
  const settings = await getSettings()
  return {
    repositories,
    totalCount: data.total_count,
    rateRemaining: Number.isFinite(remaining) ? remaining : undefined,
    installedSkills: await readLocalSkills(settings.dshHome),
  }
}

async function installSkillRepository(request: SkillInstallRequest): Promise<SkillInstallResult> {
  if (activeInstallation) throw new Error(`正在安装 ${activeInstallation.repository}，请等待当前任务完成。`)
  emitInstallProgress({ repository: request.repository, kind: 'skill', phase: 'preparing', percent: 5, message: '正在确认 Skill 格式' })
  try {
    const analysis = await analyzeSkillCatalogRepository(request.repository, request.defaultBranch)
    const target = analysis.targets.find(item => item.id === request.targetId)
    if (!target) throw new Error(analysis.summary || '所选 Skill 已失效，请重新检测仓库。')
    const settings = await getSettings()
    const installedSkill = await installSkillFromRepository(
      skillSourceRoot(),
      settings.dshHome,
      request.repository,
      target,
      (percent, message) => emitInstallProgress({ repository: request.repository, kind: 'skill', phase: 'downloading', percent, message }),
    )
    const installedSkills = await readLocalSkills(settings.dshHome)
    const verified = installedSkills.find(skill => skill.name === target.name)
    if (!verified) throw new Error('文件已写入，但 DSH 没有把它识别为有效 Skill。')
    emitInstallProgress({ repository: request.repository, kind: 'skill', phase: 'complete', percent: 100, message: `${target.name} 已安装` })
    return { installedSkill, installedSkills }
  } catch (error) {
    emitInstallProgress({
      repository: request.repository,
      kind: 'skill',
      phase: 'error',
      percent: currentInstallPercent(0),
      message: error instanceof Error ? error.message : 'Skill 安装失败',
    })
    throw error
  } finally {
    activeInstallation = null
  }
}

function createWindow(): void {
  const initialSize = WINDOW_MODES.launcher
  mainWindow = new BrowserWindow({
    width: initialSize.width,
    height: initialSize.height,
    minWidth: initialSize.minWidth,
    minHeight: initialSize.minHeight,
    backgroundColor: '#151914',
    frame: false,
    hasShadow: true,
    icon: path.join(__dirname, app.isPackaged ? '../dist/launcher-icon.png' : '../public/launcher-icon.png'),
    title: 'DSH Launcher',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.once('closed', () => { mainWindow = null })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function registerHandlers(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_event, settings: AppSettings) => saveSettings(settings))
  ipcMain.handle('dsh:detect-installation', () => detectDshInstallation())
  ipcMain.handle('credentials:deepseek-status', async () => {
    const settings = await getSettings()
    return getDeepSeekCredentialStatus(settings.dshHome)
  })
  ipcMain.handle('credentials:deepseek-set', async (_event, apiKey: string) => {
    if (typeof apiKey !== 'string') throw new Error('API Key 格式无效。')
    const settings = await getSettings()
    return setDeepSeekApiKey(settings.dshHome, apiKey)
  })
  ipcMain.handle('credentials:deepseek-clear', async () => {
    const settings = await getSettings()
    return clearDeepSeekApiKey(settings.dshHome)
  })
  ipcMain.handle('dialog:directory', async (_event, kind: 'dshInstallPath' | 'dshHome' | 'workspace') => {
    if (!['dshInstallPath', 'dshHome', 'workspace'].includes(kind)) throw new Error('目录类型无效。')
    const settings = await getSettings()
    const result = await dialog.showOpenDialog(mainWindow!, {
      defaultPath: settings[kind],
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('profile:read', async () => {
    const settings = await getSettings()
    return readProfile(settings.dshHome, settings.profileName)
  })
  ipcMain.handle('profile:toggle', async (_event, payload: { packageName: string; enabled: boolean }) => {
    if (!isSafePackageName(payload.packageName)) throw new Error('插件名称无效。')
    const settings = await getSettings()
    return togglePlugin(settings.dshHome, settings.profileName, payload.packageName, Boolean(payload.enabled))
  })
  ipcMain.handle('profile:reorder', async (_event, packageNames: string[]) => {
    if (!Array.isArray(packageNames) || packageNames.some(name => !isSafePackageName(name))) throw new Error('插件顺序无效。')
    const settings = await getSettings()
    return reorderPlugins(settings.dshHome, settings.profileName, packageNames)
  })
  ipcMain.handle('plugins:discover', (_event, payload: { query: string; sort: 'stars' | 'updated' }) => {
    return discoverPlugins(payload.query ?? '', payload.sort === 'updated' ? 'updated' : 'stars')
  })
  ipcMain.handle('plugins:analyze', async (_event, payload: { fullName: string; defaultBranch: string }) => {
    if (!isSafeRepositoryName(payload.fullName)) throw new Error('GitHub 仓库名称无效。')
    return analyzePluginRepository(payload.fullName, payload.defaultBranch)
  })
  ipcMain.handle('plugins:install', async (_event, request: string | PluginInstallRequest) => {
    const fullName = typeof request === 'string' ? request : request.repository
    if (!isSafeRepositoryName(fullName)) throw new Error('GitHub 仓库名称无效。')
    if (typeof request !== 'string' && (!request.targetId || !request.defaultBranch)) throw new Error('插件安装目标无效。')
    return installRepository(request)
  })
  ipcMain.handle('plugins:uninstall', async (_event, packageName: string) => {
    if (!isSafePackageName(packageName)) throw new Error('插件名称无效。')
    const settings = await getSettings()
    await runPluginCommand(['remove', packageName])
    await removePluginReceipt(pluginReceiptsPath(), settings.profileName, packageName)
    return readProfile(settings.dshHome, settings.profileName)
  })
  ipcMain.handle('skills:discover', (_event, payload: { query: string; sort: 'stars' | 'updated' }) => {
    return discoverSkills(payload.query ?? '', payload.sort === 'updated' ? 'updated' : 'stars')
  })
  ipcMain.handle('skills:analyze', async (_event, payload: { fullName: string; defaultBranch: string }) => {
    if (!isSafeRepositoryName(payload.fullName)) throw new Error('GitHub 仓库名称无效。')
    return analyzeSkillCatalogRepository(payload.fullName, payload.defaultBranch)
  })
  ipcMain.handle('skills:install', async (_event, request: SkillInstallRequest) => {
    if (!request || !isSafeRepositoryName(request.repository) || !request.defaultBranch || !request.targetId) {
      throw new Error('Skill 安装目标无效。')
    }
    return installSkillRepository(request)
  })
  ipcMain.handle('skills:read-installed', async () => {
    const settings = await getSettings()
    return readLocalSkills(settings.dshHome)
  })
  ipcMain.handle('runtime:state', () => runtimeState())
  ipcMain.handle('runtime:start', () => startRuntime())
  ipcMain.handle('runtime:stop', () => stopRuntime())
  ipcMain.handle('window:set-mode', (_event, mode: WindowMode) => {
    if (mode !== 'launcher' && mode !== 'manager') throw new Error('窗口模式无效。')
    setWindowMode(mode)
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('shell:open-external', (_event, url: string) => {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只允许打开网页链接。')
    return shell.openExternal(parsed.toString())
  })
  ipcMain.handle('shell:open-path', async (_event, target: string) => {
    if (!path.isAbsolute(target)) throw new Error('路径无效。')
    await shell.openPath(target)
  })
}

app.whenReady().then(() => {
  registerHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', event => {
  if (quitAfterRuntimeStops || !runtimeProcess) return
  event.preventDefault()
  void stopRuntime().finally(() => {
    quitAfterRuntimeStops = true
    app.quit()
  })
})
