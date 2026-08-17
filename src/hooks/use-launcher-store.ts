import { useCallback, useEffect, useState } from 'react'
import { useLauncherApi } from '../api/client'
import { DSH_REPOSITORY, EMPTY_DSH_INSTALLATION, EMPTY_RUNTIME_STATE, MAX_LOG_LINES } from '../constants'
import { errorText } from '../lib/format'
import { reorderProfilePlugins } from '../lib/profile-order'
import type {
  ApplicationInstallResult,
  AppSettings,
  CredentialStatus,
  DshInstallationStatus,
  DshUpdateStatus,
  GitHubAuthStatus,
  InstallProgress,
  InstalledSkill,
  InstalledApplicationAddon,
  ManagedPlugin,
  PackStatus,
  PluginTrialResult,
  ProfileState,
  RepositoryInstallResult,
  RuntimeOutput,
  RuntimeState,
  SkillInstallResult,
} from '../types'
import { BUSY, useAsyncAction } from './use-async-action'
import { useToast } from './use-toast'

/**
 * 启动器的领域状态与全部写操作。
 * 界面导航、对话框开关等纯展示状态不在这里 —— 那些由 App 自己持有。
 */

/** toggleRuntime 的结果，调用方据此决定是否切换到日志视图。 */
export type RuntimeToggleResult = 'installed' | 'started' | 'stopped' | 'failed'

export function pluginTrialStateKey(profileName: string, packageName: string): string {
  return `${profileName}:${packageName}`
}

export function useLauncherStore() {
  const api = useLauncherApi()
  const { toast, showToast, dismissToast } = useToast()
  const { busy, run } = useAsyncAction(showToast)

  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [profile, setProfile] = useState<ProfileState | null>(null)
  const [runtime, setRuntime] = useState<RuntimeState>(EMPTY_RUNTIME_STATE)
  const [dshInstallation, setDshInstallation] = useState<DshInstallationStatus>(EMPTY_DSH_INSTALLATION)
  const [dshUpdate, setDshUpdate] = useState<DshUpdateStatus | null>(null)
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)
  const [pluginTrials, setPluginTrials] = useState<Record<string, PluginTrialResult>>({})
  const [installedRepositories, setInstalledRepositories] = useState<Set<string>>(new Set())
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([])
  const [installedApplications, setInstalledApplications] = useState<InstalledApplicationAddon[]>([])
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus>({ configured: false })
  const [githubAuthStatus, setGitHubAuthStatus] = useState<GitHubAuthStatus>({
    authenticated: false,
    login: null,
    name: null,
    avatarUrl: null,
    scopes: [],
    method: null,
    oauthAvailable: false,
    rateLimit: null,
  })
  const [logs, setLogs] = useState<RuntimeOutput[]>([])
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null)
  const [packs, setPacks] = useState<PackStatus[]>([])
  const [packSnapshotsAvailable, setPackSnapshotsAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const activeRuntimeReplacement = installedApplications.find(
    application => application.enabled && application.launchMode === 'runtime-replacement',
  ) ?? null

  /** 保留原选中项；它已不存在时退回列表首项。 */
  const adoptProfile = useCallback((next: ProfileState) => {
    setProfile(next)
    setSelectedPlugin(current => current && next.plugins.some(plugin => plugin.packageName === current)
      ? current
      : next.plugins[0]?.packageName ?? null)
  }, [])

  useEffect(() => {
    let disposed = false
    void Promise.all([
      api.getSettings(),
      api.readProfile(),
      api.getRuntimeState(),
      api.getDeepSeekCredentialStatus(),
      api.getGitHubAuthStatus(),
      api.detectDshInstallation(),
      api.readInstalledSkills(),
      api.readInstalledApplications(),
      api.listPacks(),
      api.packHasSnapshot(),
      api.readPluginTrials(),
    ])
      .then(([nextSettings, nextProfile, nextRuntime, nextCredentialStatus, nextGitHubAuthStatus, nextDshInstallation, nextInstalledSkills, nextInstalledApplications, nextPacks, nextPackSnapshot, nextPluginTrials]) => {
        setSettings(nextSettings)
        setProfile(nextProfile)
        setRuntime(nextRuntime)
        setCredentialStatus(nextCredentialStatus)
        setGitHubAuthStatus(nextGitHubAuthStatus)
        setDshInstallation(nextDshInstallation)
        setInstalledSkills(nextInstalledSkills)
        setInstalledApplications(nextInstalledApplications)
        setSelectedPlugin(nextProfile.plugins[0]?.packageName ?? null)
        setPacks(nextPacks)
        setPackSnapshotsAvailable(nextPackSnapshot)
        setPluginTrials(Object.fromEntries(nextPluginTrials.map(result => [pluginTrialStateKey(result.profileName, result.packageName), result])))
      })
      .catch(error => showToast({ kind: 'error', message: errorText(error) }))
      .finally(() => setLoading(false))

    // 更新检查必须在后台进行，网络不可用时不能阻塞启动页。
    void api.checkDshUpdate()
      .then(next => { if (!disposed) setDshUpdate(next) })
      .catch(() => { /* 主进程已把网络失败转换为状态；演示 API 也不应阻塞启动 */ })

    const unsubscribers = [
      api.onRuntimeOutput(output => setLogs(current => [...current.slice(-(MAX_LOG_LINES - 1)), output])),
      api.onRuntimeState(setRuntime),
      api.onInstallProgress(setInstallProgress),
      api.onPluginTrialEvent(result => {
        setPluginTrials(current => ({ ...current, [pluginTrialStateKey(result.profileName, result.packageName)]: result }))
      }),
    ]
    return () => {
      disposed = true
      unsubscribers.forEach(unsubscribe => unsubscribe())
    }
  }, [api, showToast])

  const refreshProfile = useCallback(async () => {
    try {
      adoptProfile(await api.readProfile())
    } catch (error) {
      showToast({ kind: 'error', message: errorText(error) })
    }
  }, [adoptProfile, api, showToast])

  /** 安装完成后一次性同步受影响的几处状态。 */
  const applyInstallResult = useCallback((result: RepositoryInstallResult) => {
    setSettings(result.settings)
    adoptProfile(result.profile)
    setDshInstallation(result.dshInstallation)
  }, [adoptProfile])

  const adoptCatalogInstallationState = useCallback((
    repositories: string[],
    skills: InstalledSkill[],
    applications: InstalledApplicationAddon[],
  ) => {
    setInstalledRepositories(new Set(repositories.map(repository => repository.toLowerCase())))
    setInstalledSkills(skills)
    setInstalledApplications(applications)
  }, [])

  const applyCatalogPluginInstall = useCallback((repository: string, result: RepositoryInstallResult) => {
    applyInstallResult(result)
    setInstalledRepositories(current => new Set(current).add(repository.toLowerCase()))
    if (result.packageName && result.installedProfileName) {
      const key = pluginTrialStateKey(result.installedProfileName, result.packageName)
      setPluginTrials(current => {
        const next = { ...current }
        delete next[key]
        return next
      })
    }
  }, [applyInstallResult])

  const applyCatalogSkillInstall = useCallback((result: SkillInstallResult) => {
    setInstalledSkills(result.installedSkills)
  }, [])

  const applyCatalogApplicationInstall = useCallback((result: ApplicationInstallResult) => {
    setInstalledApplications(result.installedAddons)
    adoptProfile(result.profile)
    if (result.migrationWarning) showToast({ kind: 'error', message: result.migrationWarning })
  }, [adoptProfile, showToast])

  const beginInstall = useCallback((progress: InstallProgress) => {
    setInstallProgress(progress)
  }, [])

  const finishInstall = useCallback((repository: string) => {
    setInstallProgress(current => current?.repository === repository ? null : current)
  }, [])

  const installDsh = useCallback(async (): Promise<RepositoryInstallResult | undefined> => {
    setInstallProgress({
      repository: DSH_REPOSITORY,
      kind: 'dsh',
      phase: 'preparing',
      percent: 0,
      message: '正在准备本地 DSH',
    })
    const result = await run(BUSY.dshInstall, () => api.installPlugin(DSH_REPOSITORY), {
      success: installed => `本地 DSH ${installed.dshInstallation.version ?? ''} 已安装，可以启动。`,
    })
    if (!result) return undefined
    applyInstallResult(result)
    void api.checkDshUpdate().then(setDshUpdate).catch(() => undefined)
    return result
  }, [api, applyInstallResult, run])

  /**
   * 首页主按钮。尚未安装 DSH 时先完成部署，之后才是启动/停止。
   */
  const toggleRuntime = useCallback(async (): Promise<RuntimeToggleResult> => {
    const needsInstallation = !runtime.running && !dshInstallation.installed && !activeRuntimeReplacement
    if (needsInstallation) {
      const result = await installDsh()
      if (!result) return 'failed'
      return 'installed'
    }

    const wasRunning = runtime.running
    const next = await run(BUSY.runtime, () => wasRunning ? api.stopRuntime() : api.startRuntime())
    if (!next) return 'failed'
    setRuntime(next)
    return wasRunning ? 'stopped' : 'started'
  }, [activeRuntimeReplacement, dshInstallation.installed, installDsh, run, runtime.running])

  const updateDsh = useCallback(async (): Promise<boolean> => {
    const result = await installDsh()
    return result !== undefined
  }, [installDsh])

  const saveSettings = useCallback(async (next: AppSettings): Promise<boolean> => {
    const saved = await run(BUSY.settings, async () => {
      const stored = await api.saveSettings(next)
      setSettings(stored)
      setDshInstallation(await api.detectDshInstallation())
      setCredentialStatus(await api.getDeepSeekCredentialStatus())
      await refreshProfile()
      return stored
    }, { success: '设置已保存。' })
    return saved !== undefined
  }, [api, refreshProfile, run])

  const saveApiKey = useCallback(async (apiKey: string): Promise<boolean> => {
    const status = await run(BUSY.credential, () => api.setDeepSeekApiKey(apiKey), {
      success: 'DeepSeek API Key 已保存，DSH 可立即使用。',
    })
    if (!status) return false
    setCredentialStatus(status)
    return true
  }, [api, run])

  const clearApiKey = useCallback(async (): Promise<boolean> => {
    const status = await run(BUSY.credential, () => api.clearDeepSeekApiKey(), {
      success: 'DeepSeek API Key 已清除。',
    })
    if (!status) return false
    setCredentialStatus(status)
    return true
  }, [api, run])

  const togglePlugin = useCallback(async (plugin: ManagedPlugin, enabled: boolean) => {
    const next = await run(plugin.packageName, () => api.togglePlugin(plugin.packageName, enabled), {
      success: enabled ? '插件将在下次启动时加载。' : '插件已停用，但仍保留在本机。',
    })
    if (next) setProfile(next)
  }, [api, run])

  const toggleSkill = useCallback(async (skill: InstalledSkill, enabled: boolean) => {
    const next = await run(`skill:${skill.name}`, () => api.toggleSkill(skill.name, enabled), {
      success: enabled ? `Skill「${skill.name}」已启用。` : `Skill「${skill.name}」已停用。`,
    })
    if (next) setInstalledSkills(next)
  }, [api, run])

  const toggleApplication = useCallback(async (application: InstalledApplicationAddon, enabled: boolean) => {
    const next = await run(`application:${application.id}`, () => api.toggleApplication(application.id, enabled), {
      success: enabled
        ? `${application.name} 已激活，将按“${application.launchMode}”模式参与下次启动。`
        : `${application.name} 已停用。`,
    })
    if (next) setInstalledApplications(next)
  }, [api, run])

  const uninstallApplication = useCallback(async (application: InstalledApplicationAddon) => {
    const next = await run(`application-remove:${application.id}`, () => api.uninstallApplication(application.id), {
      success: `${application.name} 已卸载。`,
    })
    if (next) setInstalledApplications(next)
  }, [api, run])

  /** 先本地重排让拖拽有即时反馈，主进程写盘失败再回滚。 */
  const reorderPlugins = useCallback(async (packageNames: string[]) => {
    if (!profile) return
    const previous = profile
    setProfile(reorderProfilePlugins(profile, packageNames))
    const next = await run(BUSY.reorder, () => api.reorderPlugins(packageNames), {
      onError: error => {
        setProfile(previous)
        showToast({ kind: 'error', message: errorText(error) })
      },
    })
    if (next) setProfile(next)
  }, [api, profile, run, showToast])

  const uninstallPlugin = useCallback(async (plugin: ManagedPlugin) => {
    const next = await run(plugin.packageName, () => api.uninstallPlugin(plugin.packageName), {
      success: `${plugin.displayName} 已卸载。`,
    })
    if (!next) return
    setProfile(next)
    setSelectedPlugin(next.plugins[0]?.packageName ?? null)
    if (settings) {
      const key = pluginTrialStateKey(settings.profileName, plugin.packageName)
      setPluginTrials(current => {
        const updated = { ...current }
        delete updated[key]
        return updated
      })
    }
  }, [api, run, settings])

  const trialPlugin = useCallback(async (packageName: string, profileName?: string): Promise<PluginTrialResult | undefined> => {
    const result = await run(`plugin-trial:${packageName}`, () => api.trialPlugin(packageName, profileName))
    if (result) {
      showToast({
        kind: result.phase === 'passed' ? 'success' : 'error',
        message: result.message,
      })
    }
    return result
  }, [api, run, showToast])

  // ===================== 整合包（Pack）管理 =====================

  const refreshPacks = useCallback(async () => {
    const next = await run('pack-refresh', () => api.listPacks(), {
      onError: error => showToast({ kind: 'error', message: errorText(error) }),
    })
    if (next) setPacks(next)
  }, [api, run, showToast])

  const refreshPackSnapshots = useCallback(async () => {
    try {
      setPackSnapshotsAvailable(await api.packHasSnapshot())
    } catch {
      setPackSnapshotsAvailable(false)
    }
  }, [api])

  /** 包级写操作返回单个 PackStatus，原地替换列表项，避免整表刷新闪烁。 */
  const applyPackUpdate = useCallback((next: PackStatus) => {
    setPacks(current => current.map(pack => pack.id === next.id ? next : pack))
  }, [])

  const activatePack = useCallback(async (packId: string): Promise<boolean> => {
    const next = await run(`pack-activate:${packId}`, async () => {
      const settings = await api.activatePack(packId)
      setSettings(settings)
      await refreshProfile()
      await refreshPacks()
      return settings
    }, { success: '整合包已启用，当前 Profile 已切换。' })
    return next !== undefined
  }, [api, refreshPacks, refreshProfile, run])

  const deactivatePack = useCallback(async (): Promise<boolean> => {
    const next = await run('pack-deactivate', async () => {
      const settings = await api.deactivatePack()
      setSettings(settings)
      await refreshProfile()
      await refreshPacks()
      return settings
    }, { success: '已停用整合包，恢复默认 Profile。' })
    return next !== undefined
  }, [api, refreshPacks, refreshProfile, run])

  const removePack = useCallback(async (packId: string): Promise<boolean> => {
    const next = await run(`pack-remove:${packId}`, async () => {
      const result = await api.removePack(packId)
      await refreshPacks()
      return result
    }, { success: result => `已删除 ${result.removed} 个整合包。` })
    return next !== undefined
  }, [api, refreshPacks, run])

  const exportPack = useCallback(async (packId: string): Promise<string | null> => {
    const path = await run(`pack-export:${packId}`, () => api.exportPack(packId))
    if (path) showToast({ kind: 'success', message: `整合包已导出到 ${path}` })
    return path ?? null
  }, [api, run, showToast])

  const addPackPlugin = useCallback(async (packId: string, packageName: string): Promise<boolean> => {
    const next = await run(`pack-add:${packId}:${packageName}`, async () => {
      const updated = await api.addPackPlugin(packId, packageName)
      applyPackUpdate(updated)
      return updated
    }, { success: `${packageName} 已加入整合包。` })
    return next !== undefined
  }, [api, applyPackUpdate, run])

  const togglePackItem = useCallback(async (packId: string, packageName: string, enabled: boolean): Promise<boolean> => {
    const next = await run(`pack-toggle:${packId}:${packageName}`, async () => {
      const updated = await api.togglePackItem(packId, packageName, enabled)
      applyPackUpdate(updated)
      return updated
    }, { success: enabled ? '插件已启用。' : '插件已停用。' })
    return next !== undefined
  }, [api, applyPackUpdate, run])

  const removePackItem = useCallback(async (packId: string, packageName: string): Promise<boolean> => {
    const next = await run(`pack-remove-item:${packId}:${packageName}`, async () => {
      const updated = await api.removePackItem(packId, packageName)
      applyPackUpdate(updated)
      return updated
    }, { success: `${packageName} 已从整合包移除。` })
    return next !== undefined
  }, [api, applyPackUpdate, run])

  return {
    // 状态
    loading,
    settings,
    profile,
    runtime,
    dshInstallation,
    dshUpdate,
    installProgress,
    pluginTrials,
    installedRepositories,
    installedSkills,
    installedApplications,
    activeRuntimeReplacement,
    credentialStatus,
    githubAuthStatus,
    logs,
    selectedPlugin,
    selected: profile?.plugins.find(plugin => plugin.packageName === selectedPlugin) ?? null,
    packs,
    packSnapshotsAvailable,
    busy,
    toast,

    // 动作
    selectPlugin: setSelectedPlugin,
    clearLogs: () => setLogs([]),
    dismissToast,
    showToast,
    refreshProfile,
    applyInstallResult,
    adoptCatalogInstallationState,
    applyCatalogPluginInstall,
    applyCatalogSkillInstall,
    applyCatalogApplicationInstall,
    beginInstall,
    finishInstall,
    toggleRuntime,
    updateDsh,
    saveSettings,
    saveApiKey,
    clearApiKey,
    setGitHubAuthStatus,
    togglePlugin,
    toggleSkill,
    toggleApplication,
    uninstallApplication,
    reorderPlugins,
    uninstallPlugin,
    trialPlugin,
    refreshPacks,
    refreshPackSnapshots,
    activatePack,
    deactivatePack,
    removePack,
    exportPack,
    addPackPlugin,
    togglePackItem,
    removePackItem,
  }
}

export type LauncherStore = ReturnType<typeof useLauncherStore>
