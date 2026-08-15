import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DSH_PACKAGE_NAME } from '../src/constants'
import type {
  AppSettings,
  CatalogRepositoryAnalysis,
  DshInstallationStatus,
  InstallProgress,
  InstalledSkill,
  ProfileState,
  RepositoryAnalysis,
  RepositoryInstallResult,
  RuntimeOutput,
  SkillInstallRequest,
  SkillInstallResult,
  SkillRepositoryAnalysis,
} from '../src/types'
import { runCommand, type OutputLevel } from './command'
import { classifyCatalogRepository } from './catalog-analysis'
import {
  findInstalledDsh,
  getManagedDshStatus,
  installWaitingMessage,
  isDshRepository,
  packageManagerProgress,
} from './dsh-install'
import { resolveNodeExecutable, type NodeRuntime, type NodeRuntimeProgress } from './node-runtime'
import { approveIgnoredGitHubBuilds } from './plugin-install'
import { analyzeRepository } from './plugin-catalog'
import { prepareSubdirectoryPlugin } from './plugin-source'
import { readPluginReceipts, recordPluginInstall } from './plugin-receipts'
import { readProfile } from './profile'
import { withExecutableDirectoryOnPath } from './process'
import { analyzeSkillRepository } from './skill-catalog'
import { readInstalledSkills as readLocalSkills } from './skill-format'
import { installSkillFromRepository } from './skill-install'

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
  profileName?: string,
): string[] {
  const packageIndex = settings.launchArgs.indexOf(DSH_PACKAGE_NAME)
  const prefix = packageIndex >= 0
    ? settings.launchArgs.slice(0, packageIndex + 1)
    : path.basename(executable).toLowerCase().startsWith('dsh')
      ? []
      : ['--yes', DSH_PACKAGE_NAME]
  return [...prefix, 'plugin', '--profile', profileName ?? settings.profileName, ...args]
}

export interface InstallerOptions {
  readSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<AppSettings>
  /** 确保 Node.js 可用；onProgress 用于把下载进度并入安装进度。 */
  prepareNodeRuntime: (onProgress?: (progress: NodeRuntimeProgress) => void) => Promise<NodeRuntime>
  /** 插件子目录安装的缓存根目录。 */
  pluginSourceRoot: string
  /** 插件安装凭据文件的路径。 */
  pluginReceiptsPath: string
  /** Skill 仓库缓存根目录。 */
  skillSourceRoot: string
  emitOutput: (level: RuntimeOutput['level'], text: string) => void
  emitProgress: (progress: InstallProgress) => void
  isRuntimeRunning: () => boolean
}

export interface Installer {
  /** 安装一个 GitHub 仓库；识别为 DSH 本体时走本体安装流程。 */
  install(fullName: string): Promise<RepositoryInstallResult>
  /** 安装一个已选定的插件组件；调用前需先 analyze。 */
  installPluginTarget(request: { repository: string; defaultBranch: string; targetId: string }): Promise<RepositoryInstallResult>
  /** 检测一个插件仓库，返回可安装组件清单（带 5 分钟缓存）。 */
  analyzePlugin(fullName: string, defaultBranch: string): Promise<RepositoryAnalysis>
  /** 检测一个 Skill 仓库，返回可安装组件清单（带 5 分钟缓存）。 */
  analyzeSkill(fullName: string, defaultBranch: string): Promise<SkillRepositoryAnalysis>
  /** 同时检测 Plugin 与 Skill，返回统一资源市场分类。 */
  analyzeCatalogRepository(fullName: string, defaultBranch: string): Promise<CatalogRepositoryAnalysis>
  /** 安装一个 Skill。 */
  installSkill(request: SkillInstallRequest): Promise<SkillInstallResult>
  /** 读取已安装的 Skill 列表。 */
  readInstalledSkills(): Promise<InstalledSkill[]>
  /** 汇总当前 Profile 与安装凭据里已安装的仓库，用于在列表中标记「已安装」。 */
  listInstalledRepositories(): Promise<string[]>
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
      managedRoot: settings.dshInstallPath,
      configuredExecutable: settings.launchExecutable,
    })
  }

  /** 仓库结构检测结果缓存 5 分钟，避免同一仓库反复触发 GitHub 请求。 */
  const repositoryAnalysisCache = new Map<string, { expiresAt: number; analysis: RepositoryAnalysis }>()
  const skillAnalysisCache = new Map<string, { expiresAt: number; analysis: SkillRepositoryAnalysis }>()

  const analyzePlugin = async (fullName: string, defaultBranch: string): Promise<RepositoryAnalysis> => {
    const settings = await options.readSettings()
    const cacheKey = `${fullName.toLowerCase()}#${defaultBranch}#${settings.profileName}`
    const cached = repositoryAnalysisCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.analysis
    const analysis = await analyzeRepository(fullName, defaultBranch, settings.profileName)
    repositoryAnalysisCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, analysis })
    return analysis
  }

  const analyzeSkill = async (fullName: string, defaultBranch: string): Promise<SkillRepositoryAnalysis> => {
    const cacheKey = `${fullName.toLowerCase()}#${defaultBranch}`
    const cached = skillAnalysisCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.analysis
    const analysis = await analyzeSkillRepository(fullName, defaultBranch)
    skillAnalysisCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, analysis })
    return analysis
  }

  const analyzeCatalogRepository = async (
    fullName: string,
    defaultBranch: string,
  ): Promise<CatalogRepositoryAnalysis> => {
    if (isDshRepository(fullName)) return classifyCatalogRepository(
      fullName,
      defaultBranch,
      { status: 'rejected', reason: new Error('skipped') },
      { status: 'rejected', reason: new Error('skipped') },
    )

    const [pluginResult, skillResult] = await Promise.allSettled([
      analyzePlugin(fullName, defaultBranch),
      analyzeSkill(fullName, defaultBranch),
    ])
    return classifyCatalogRepository(fullName, defaultBranch, pluginResult, skillResult)
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

  /** 调用官方 DSH CLI 的 plugin 子命令。profileName 用于把插件装进指定 Profile。 */
  async function runPluginCommand(
    args: string[],
    installingRepository?: string,
    allowBuildRetry = true,
    profileName?: string,
  ): Promise<void> {
    const settings = await options.readSettings()
    const targetProfile = profileName ?? settings.profileName
    const nodeRuntime = await prepareNode(installingRepository)
    const executable = resolveNodeExecutable(settings.launchExecutable, nodeRuntime)
    const commandArgs = buildPluginCommandArgs(settings, executable, args, targetProfile)

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
      const workspacePath = path.join(settings.dshHome, 'profiles', targetProfile, 'pnpm-workspace.yaml')
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

    const settings = await options.readSettings()
    const runtimeRoot = settings.dshInstallPath
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

    const saved = await options.saveSettings({
      ...settings,
      launchExecutable: dshInstallation.executable,
      launchArgs: ['web'],
    })
    const profile = await readProfile(saved.dshHome, saved.profileName)
    emit({
      repository,
      kind: 'dsh',
      phase: 'complete',
      percent: 100,
      message: `DSH ${dshInstallation.version ?? ''} 已安装`,
    })
    return { kind: 'dsh', profile, settings, dshInstallation }
  }

  /** 安装完成后用 --dump-config 验证插件组合可被 DSH 正常解析。 */
  const verifyProfileComposition = async (profileName: string, repository: string): Promise<void> => {
    const settings = await options.readSettings()
    const nodeRuntime = await options.prepareNodeRuntime()
    const executable = resolveNodeExecutable(settings.launchExecutable, nodeRuntime)
    const packageIndex = settings.launchArgs.indexOf(DSH_PACKAGE_NAME)
    const prefix = packageIndex >= 0
      ? settings.launchArgs.slice(0, packageIndex + 1)
      : path.basename(executable).toLowerCase().startsWith('dsh')
        ? []
        : ['--yes', DSH_PACKAGE_NAME]
    const result = await runCommand(executable, [...prefix, '--profile', profileName, '--dump-config'], {
      cwd: settings.workspace,
      env: withExecutableDirectoryOnPath(nodeRuntime.node, {
        ...process.env,
        DSH_HOME: settings.dshHome,
        FORCE_COLOR: '0',
      }),
    })
    if (result.exitCode !== 0) {
      const diagnostics = result.output.slice(-8_000).trim()
      throw new Error(`插件已安装，但组合验证失败。${diagnostics ? `\n${diagnostics}` : ''}`)
    }
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

    analyzePlugin,

    analyzeSkill,

    analyzeCatalogRepository,

    async readInstalledSkills(): Promise<InstalledSkill[]> {
      const settings = await options.readSettings()
      return readLocalSkills(settings.dshHome)
    },

    async listInstalledRepositories(): Promise<string[]> {
      const settings = await options.readSettings()
      const profile = await readProfile(settings.dshHome, settings.profileName)
      const receipts = await readPluginReceipts(options.pluginReceiptsPath)
      const repositories = new Set<string>()
      for (const plugin of profile.plugins) {
        if (plugin.repositoryFullName) repositories.add(plugin.repositoryFullName)
      }
      for (const receipt of receipts) repositories.add(receipt.repository)
      return [...repositories]
    },

    async installPluginTarget(request: { repository: string; defaultBranch: string; targetId: string }): Promise<RepositoryInstallResult> {
      const fullName = request.repository
      if (active) throw new Error(`正在安装 ${active.repository}，请等待当前任务完成。`)
      emit({ repository: fullName, kind: 'plugin', phase: 'preparing', percent: 5, message: '正在检查插件结构' })
      try {
        const analysis = await analyzePlugin(fullName, request.defaultBranch)
        const target = analysis.targets.find(item => item.id === request.targetId)
        if (!target) throw new Error(analysis.summary || '所选插件组件已经失效，请重新检测仓库。')

        let specifier: string
        if (target.source === 'npm') {
          specifier = target.version ? `${target.packageName}@${target.version}` : target.packageName
        } else if (target.source === 'github') {
          specifier = `github:${fullName}#${target.commit}`
        } else {
          const packageDirectory = await prepareSubdirectoryPlugin(
            options.pluginSourceRoot,
            fullName,
            target,
            progress => emit({ repository: fullName, kind: 'plugin', phase: 'downloading', ...progress }),
          )
          specifier = `file:${packageDirectory}`
        }

        await runPluginCommand(['add', specifier], fullName, true, target.profileName)
        emit({ repository: fullName, kind: 'plugin', phase: 'configuring', percent: 88, message: '正在核对插件加载顺序' })
        const settings = await options.readSettings()
        const installedProfile = await readProfile(settings.dshHome, target.profileName)
        const installedPlugin = installedProfile.plugins.find(plugin => plugin.packageName === target.packageName)
        if (!installedPlugin?.enabled || !installedPlugin.compatible) {
          throw new Error('包已下载，但 DSH 没有把它识别为有效 Bundle。请检查插件清单和补丁文件。')
        }
        emit({ repository: fullName, kind: 'plugin', phase: 'verifying', percent: 94, message: '正在验证插件组合配置' })
        await verifyProfileComposition(target.profileName, fullName)
        await recordPluginInstall(options.pluginReceiptsPath, {
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
        const dshInstallation = await detectDsh()
        emit({ repository: fullName, kind: 'plugin', phase: 'complete', percent: 100, message: `插件已安装到 ${target.profileName} Profile` })
        return {
          kind: 'plugin',
          profile,
          settings,
          dshInstallation,
          installedProfileName: target.profileName,
          packageName: target.packageName,
        }
      } catch (error) {
        emit({
          repository: fullName,
          kind: 'plugin',
          phase: 'error',
          percent: currentPercent(0),
          message: error instanceof Error ? error.message : '安装失败',
        })
        throw error
      } finally {
        active = null
      }
    },

    async installSkill(request: SkillInstallRequest): Promise<SkillInstallResult> {
      if (active) throw new Error(`正在安装 ${active.repository}，请等待当前任务完成。`)
      emit({ repository: request.repository, kind: 'skill', phase: 'preparing', percent: 5, message: '正在确认 Skill 格式' })
      try {
        const analysis = await analyzeSkill(request.repository, request.defaultBranch)
        const target = analysis.targets.find(item => item.id === request.targetId)
        if (!target) throw new Error(analysis.summary || '所选 Skill 已失效，请重新检测仓库。')
        const settings = await options.readSettings()
        const installedSkill = await installSkillFromRepository(
          options.skillSourceRoot,
          settings.dshHome,
          request.repository,
          target,
          (percent, message) => emit({ repository: request.repository, kind: 'skill', phase: 'downloading', percent, message }),
        )
        const installedSkills = await readLocalSkills(settings.dshHome)
        const verified = installedSkills.find(skill => skill.name === target.name)
        if (!verified) throw new Error('文件已写入，但 DSH 没有把它识别为有效 Skill。')
        emit({ repository: request.repository, kind: 'skill', phase: 'complete', percent: 100, message: `${target.name} 已安装` })
        return { installedSkill, installedSkills }
      } catch (error) {
        emit({
          repository: request.repository,
          kind: 'skill',
          phase: 'error',
          percent: currentPercent(0),
          message: error instanceof Error ? error.message : 'Skill 安装失败',
        })
        throw error
      } finally {
        active = null
      }
    },
  }
}
