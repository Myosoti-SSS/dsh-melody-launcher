import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DSH_PACKAGE_NAME } from '../src/constants'
import type {
  AppSettings,
  DshInstallationStatus,
  InstallProgress,
  ProfileState,
  RepositoryInstallResult,
  RuntimeOutput,
} from '../src/types'
import { runCommand, type OutputLevel } from './command'
import {
  findInstalledDsh,
  getManagedDshStatus,
  installWaitingMessage,
  isDshRepository,
  packageManagerProgress,
} from './dsh-install'
import { resolveNodeExecutable, type NodeRuntime, type NodeRuntimeProgress } from './node-runtime'
import { approveIgnoredGitHubBuilds } from './plugin-install'
import { readProfile } from './profile'
import { withExecutableDirectoryOnPath } from './process'

/**
 * 安装编排：插件与 DSH 本体的安装、卸载，以及安装进度的推送。
 * 同一时刻只允许一个安装任务。
 */

/**
 * 拼出调用官方 DSH CLI 的完整参数。
 * 启动配置可能是 `npx --yes @deepseek-ai/dsh web`，也可能已经绑定到本地 dsh 可执行文件，
 * 两种情况下 `plugin` 子命令的前缀不同。
 */
export function buildPluginCommandArgs(
  settings: AppSettings,
  executable: string,
  args: string[],
): string[] {
  const packageIndex = settings.launchArgs.indexOf(DSH_PACKAGE_NAME)
  const prefix = packageIndex >= 0
    ? settings.launchArgs.slice(0, packageIndex + 1)
    : path.basename(executable).toLowerCase().startsWith('dsh')
      ? []
      : ['--yes', DSH_PACKAGE_NAME]
  return [...prefix, 'plugin', '--profile', settings.profileName, ...args]
}

export interface InstallerOptions {
  readSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<AppSettings>
  /** 确保 Node.js 可用；onProgress 用于把下载进度并入安装进度。 */
  prepareNodeRuntime: (onProgress?: (progress: NodeRuntimeProgress) => void) => Promise<NodeRuntime>
  /** 启动器自己管理的 DSH 安装目录。 */
  managedDshRoot: string
  emitOutput: (level: RuntimeOutput['level'], text: string) => void
  emitProgress: (progress: InstallProgress) => void
  isRuntimeRunning: () => boolean
}

export interface Installer {
  /** 安装一个 GitHub 仓库；识别为 DSH 本体时走本体安装流程。 */
  install(fullName: string): Promise<RepositoryInstallResult>
  /** 从当前 Profile 中卸载一个插件。 */
  remove(packageName: string): Promise<ProfileState>
  detectDsh(): Promise<DshInstallationStatus>
  isBusy(): boolean
}

/** Node.js 下载进度映射到安装进度的 5% ~ 17% 区间。 */
const NODE_RUNTIME_PROGRESS_FLOOR = 5
const NODE_RUNTIME_PROGRESS_CEILING = 17
const DOWNLOAD_PROGRESS_FLOOR = 28

export function createInstaller(options: InstallerOptions): Installer {
  let active: InstallProgress | null = null

  const emit = (progress: InstallProgress) => {
    active = progress
    options.emitProgress(progress)
  }

  const currentPercent = (fallback: number) => active?.percent ?? fallback

  const detectDsh = async (): Promise<DshInstallationStatus> => {
    const settings = await options.readSettings()
    return findInstalledDsh({
      managedRoot: options.managedDshRoot,
      configuredExecutable: settings.launchExecutable,
    })
  }

  /** 准备 Node.js，同时把下载进度折算进当前安装任务的进度条。 */
  const prepareNode = (repository?: string) => options.prepareNodeRuntime(progress => {
    if (!repository || !active) return
    emit({
      repository,
      kind: active.kind,
      phase: 'preparing',
      percent: Math.min(
        NODE_RUNTIME_PROGRESS_CEILING,
        NODE_RUNTIME_PROGRESS_FLOOR + Math.round(progress.percent * 0.12),
      ),
      message: progress.message,
    })
  })

  /**
   * 包管理器的输出格式各异，能解析出百分比就用真实进度，
   * 解析不出来就用「已等待 N 秒」的心跳，避免进度条长时间凝固。
   */
  const trackPackageProgress = (repository: string, kind: InstallProgress['kind'], message: string) => {
    const startedAt = Date.now()
    let measured = false

    const emitWaiting = () => {
      if (measured) return
      emit({
        repository,
        kind,
        phase: 'downloading',
        percent: Math.max(DOWNLOAD_PROGRESS_FLOOR, currentPercent(DOWNLOAD_PROGRESS_FLOOR)),
        message: installWaitingMessage(message, Date.now() - startedAt),
        indeterminate: true,
      })
    }

    emitWaiting()
    const heartbeat = setInterval(emitWaiting, 5_000)
    heartbeat.unref()

    return {
      handleOutput: (text: string) => {
        const parsed = packageManagerProgress(text, currentPercent(DOWNLOAD_PROGRESS_FLOOR))
        if (!parsed || (parsed.indeterminate && measured)) return
        if (!parsed.indeterminate) measured = true
        emit({ repository, kind, phase: 'downloading', ...parsed })
      },
      stop: () => clearInterval(heartbeat),
    }
  }

  /** 调用官方 DSH CLI 的 plugin 子命令。 */
  async function runPluginCommand(args: string[], installingRepository?: string, allowBuildRetry = true): Promise<void> {
    const settings = await options.readSettings()
    const nodeRuntime = await prepareNode(installingRepository)
    const executable = resolveNodeExecutable(settings.launchExecutable, nodeRuntime)
    const commandArgs = buildPluginCommandArgs(settings, executable, args)

    options.emitOutput('info', `插件操作：${args.join(' ')}`)
    if (installingRepository) {
      emit({ repository: installingRepository, kind: 'plugin', phase: 'resolving', percent: 18, message: '正在解析插件仓库' })
    }

    const tracker = installingRepository
      ? trackPackageProgress(installingRepository, 'plugin', '正在下载并安装插件')
      : null

    let result
    try {
      result = await runCommand(executable, commandArgs, {
        cwd: settings.workspace,
        env: withExecutableDirectoryOnPath(nodeRuntime.node, {
          ...process.env,
          DSH_HOME: settings.dshHome,
          FORCE_COLOR: '0',
        }),
        onOutput: (text, level: OutputLevel) => {
          options.emitOutput(level, text)
          tracker?.handleOutput(text)
        },
      })
    } finally {
      tracker?.stop()
    }

    // pnpm 默认拒绝执行依赖里的构建脚本。只为当前正在安装的仓库放行，然后重试一次。
    if (result.exitCode !== 0 && installingRepository && allowBuildRetry && result.output.includes('ERR_PNPM_IGNORED_BUILDS')) {
      const workspacePath = path.join(settings.dshHome, 'profiles', settings.profileName, 'pnpm-workspace.yaml')
      const approved = await approveIgnoredGitHubBuilds(workspacePath, result.output, installingRepository)
      if (approved.length > 0) {
        options.emitOutput('info', `已允许当前仓库的 ${approved.length} 个构建脚本，正在自动重试。`)
        emit({
          repository: installingRepository,
          kind: 'plugin',
          phase: 'configuring',
          percent: Math.max(82, currentPercent(82)),
          message: '已确认构建权限，正在重新安装',
        })
        return runPluginCommand(args, installingRepository, false)
      }
    }

    if (result.exitCode !== 0) throw new Error(`插件操作失败（代码 ${result.exitCode}），请查看运行日志。`)
    options.emitOutput('success', '插件操作完成。')
  }

  /** 把 DSH 本体装进启动器自己的运行目录，并把启动命令切过去。 */
  async function installManagedDsh(repository: string): Promise<RepositoryInstallResult> {
    if (options.isRuntimeRunning()) throw new Error('请先停止 DSH，再安装或更新本地 DSH。')

    const runtimeRoot = options.managedDshRoot
    await mkdir(runtimeRoot, { recursive: true })
    const manifestPath = path.join(runtimeRoot, 'package.json')
    if (!existsSync(manifestPath)) {
      await writeFile(manifestPath, `${JSON.stringify({ name: 'dsh-launcher-runtime', private: true }, null, 2)}\n`, 'utf8')
    }

    const nodeRuntime = await prepareNode(repository)
    emit({ repository, kind: 'dsh', phase: 'resolving', percent: 18, message: '正在解析 DSH 安装包' })

    const tracker = trackPackageProgress(repository, 'dsh', '正在下载并安装 DSH')
    let result
    try {
      result = await runCommand(nodeRuntime.npm, [
        'install',
        '--prefix', runtimeRoot,
        '--save-exact',
        '--no-audit',
        '--no-fund',
        '--progress=true',
        `${DSH_PACKAGE_NAME}@latest`,
      ], {
        cwd: runtimeRoot,
        env: withExecutableDirectoryOnPath(nodeRuntime.node, {
          ...process.env,
          FORCE_COLOR: '0',
          NPM_CONFIG_UPDATE_NOTIFIER: 'false',
        }),
        onOutput: (text, level: OutputLevel) => {
          options.emitOutput(level, text)
          tracker.handleOutput(text)
        },
      })
    } finally {
      tracker.stop()
    }
    if (result.exitCode !== 0) throw new Error(`本地 DSH 安装失败（代码 ${result.exitCode}），请查看运行日志。`)

    emit({ repository, kind: 'dsh', phase: 'configuring', percent: 90, message: '正在切换本地启动命令' })
    const dshInstallation = await getManagedDshStatus(runtimeRoot)
    if (!dshInstallation.installed || !dshInstallation.executable) {
      throw new Error('安装完成，但没有找到本地 DSH 可执行文件。')
    }

    const settings = await options.saveSettings({
      ...await options.readSettings(),
      launchExecutable: dshInstallation.executable,
      launchArgs: ['web'],
    })
    const profile = await readProfile(settings.dshHome, settings.profileName)
    emit({
      repository,
      kind: 'dsh',
      phase: 'complete',
      percent: 100,
      message: `DSH ${dshInstallation.version ?? ''} 已安装`,
    })
    return { kind: 'dsh', profile, settings, dshInstallation }
  }

  return {
    isBusy: () => active !== null,

    detectDsh,

    async install(fullName: string): Promise<RepositoryInstallResult> {
      if (active) throw new Error(`正在安装 ${active.repository}，请等待当前任务完成。`)
      const kind = isDshRepository(fullName) ? 'dsh' : 'plugin'
      emit({
        repository: fullName,
        kind,
        phase: 'preparing',
        percent: 5,
        message: kind === 'dsh' ? '正在准备本地 DSH' : '正在准备安装插件',
      })
      try {
        if (kind === 'dsh') return await installManagedDsh(fullName)

        await runPluginCommand(['add', `github:${fullName}`], fullName)
        emit({ repository: fullName, kind, phase: 'configuring', percent: 90, message: '正在更新插件配置' })
        const settings = await options.readSettings()
        const profile = await readProfile(settings.dshHome, settings.profileName)
        const dshInstallation = await detectDsh()
        emit({ repository: fullName, kind, phase: 'complete', percent: 100, message: '插件安装完成' })
        return { kind, profile, settings, dshInstallation }
      } catch (error) {
        emit({
          repository: fullName,
          kind,
          phase: 'error',
          percent: currentPercent(0),
          message: error instanceof Error ? error.message : '安装失败',
        })
        throw error
      } finally {
        active = null
      }
    },

    async remove(packageName: string): Promise<ProfileState> {
      const settings = await options.readSettings()
      await runPluginCommand(['remove', packageName])
      return readProfile(settings.dshHome, settings.profileName)
    },
  }
}
