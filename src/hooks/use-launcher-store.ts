import { useCallback, useEffect, useState } from 'react'
import { useLauncherApi } from '../api/client'
import { DSH_REPOSITORY, EMPTY_DSH_INSTALLATION, EMPTY_RUNTIME_STATE, MAX_LOG_LINES } from '../constants'
import { errorText } from '../lib/format'
import { reorderProfilePlugins } from '../lib/profile-order'
import type {
  AppSettings,
  CredentialStatus,
  DshInstallationStatus,
  InstallProgress,
  InstalledSkill,
  ManagedPlugin,
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

export function useLauncherStore() {
  const api = useLauncherApi()
  const { toast, showToast, dismissToast } = useToast()
  const { busy, run } = useAsyncAction(showToast)

  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [profile, setProfile] = useState<ProfileState | null>(null)
  const [runtime, setRuntime] = useState<RuntimeState>(EMPTY_RUNTIME_STATE)
  const [dshInstallation, setDshInstallation] = useState<DshInstallationStatus>(EMPTY_DSH_INSTALLATION)
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)
  const [installedRepositories, setInstalledRepositories] = useState<Set<string>>(new Set())
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([])
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus>({ configured: false })
  const [logs, setLogs] = useState<RuntimeOutput[]>([])
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  /** 保留原选中项；它已不存在时退回列表首项。 */
  const adoptProfile = useCallback((next: ProfileState) => {
    setProfile(next)
    setSelectedPlugin(current => current && next.plugins.some(plugin => plugin.packageName === current)
      ? current
      : next.plugins[0]?.packageName ?? null)
  }, [])

  useEffect(() => {
    void Promise.all([
      api.getSettings(),
      api.readProfile(),
      api.getRuntimeState(),
      api.getDeepSeekCredentialStatus(),
      api.detectDshInstallation(),
    ])
      .then(([nextSettings, nextProfile, nextRuntime, nextCredentialStatus, nextDshInstallation]) => {
        setSettings(nextSettings)
        setProfile(nextProfile)
        setRuntime(nextRuntime)
        setCredentialStatus(nextCredentialStatus)
        setDshInstallation(nextDshInstallation)
        setSelectedPlugin(nextProfile.plugins[0]?.packageName ?? null)
      })
      .catch(error => showToast({ kind: 'error', message: errorText(error) }))
      .finally(() => setLoading(false))

    const unsubscribers = [
      api.onRuntimeOutput(output => setLogs(current => [...current.slice(-(MAX_LOG_LINES - 1)), output])),
      api.onRuntimeState(setRuntime),
      api.onInstallProgress(setInstallProgress),
    ]
    return () => unsubscribers.forEach(unsubscribe => unsubscribe())
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

  const adoptCatalogInstallationState = useCallback((repositories: string[], skills: InstalledSkill[]) => {
    setInstalledRepositories(new Set(repositories.map(repository => repository.toLowerCase())))
    setInstalledSkills(skills)
  }, [])

  const applyCatalogPluginInstall = useCallback((repository: string, result: RepositoryInstallResult) => {
    applyInstallResult(result)
    setInstalledRepositories(current => new Set(current).add(repository.toLowerCase()))
  }, [applyInstallResult])

  const applyCatalogSkillInstall = useCallback((result: SkillInstallResult) => {
    setInstalledSkills(result.installedSkills)
  }, [])

  const beginInstall = useCallback((progress: InstallProgress) => {
    setInstallProgress(progress)
  }, [])

  const finishInstall = useCallback((repository: string) => {
    setInstallProgress(current => current?.repository === repository ? null : current)
  }, [])

  /**
   * 首页主按钮。尚未安装 DSH 时先完成部署，之后才是启动/停止。
   */
  const toggleRuntime = useCallback(async (): Promise<RuntimeToggleResult> => {
    const needsInstallation = !runtime.running && !dshInstallation.installed
    if (needsInstallation) {
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
      if (!result) return 'failed'
      applyInstallResult(result)
      return 'installed'
    }

    const wasRunning = runtime.running
    const next = await run(BUSY.runtime, () => wasRunning ? api.stopRuntime() : api.startRuntime())
    if (!next) return 'failed'
    setRuntime(next)
    return wasRunning ? 'stopped' : 'started'
  }, [api, applyInstallResult, dshInstallation.installed, run, runtime.running])

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
  }, [api, run])

  return {
    // 状态
    loading,
    settings,
    profile,
    runtime,
    dshInstallation,
    installProgress,
    installedRepositories,
    installedSkills,
    credentialStatus,
    logs,
    selectedPlugin,
    selected: profile?.plugins.find(plugin => plugin.packageName === selectedPlugin) ?? null,
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
    beginInstall,
    finishInstall,
    toggleRuntime,
    saveSettings,
    saveApiKey,
    clearApiKey,
    togglePlugin,
    reorderPlugins,
    uninstallPlugin,
  }
}

export type LauncherStore = ReturnType<typeof useLauncherStore>
