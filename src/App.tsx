import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleStop,
  Clock3,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Folder,
  Github,
  GripVertical,
  KeyRound,
  Layers3,
  LoaderCircle,
  PackageCheck,
  Play,
  RefreshCw,
  ScanSearch,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { demoApi } from './demo-api'
import packageMetadata from '../package.json'
import type {
  AppSettings,
  CredentialStatus,
  DshInstallationStatus,
  InstallProgress,
  InstalledSkill,
  LauncherApi,
  ManagedPlugin,
  PluginInstallTarget,
  ProfileState,
  RepositoryAnalysis,
  RepositoryResult,
  RepositoryInstallResult,
  RuntimeOutput,
  RuntimeState,
  SkillInstallTarget,
  SkillRepositoryAnalysis,
  SkillRepositoryResult,
  ViewName,
} from './types'

const api: LauncherApi = window.launcher ?? demoApi

const EMPTY_RUNTIME: RuntimeState = { running: false, pid: null, startedAt: null, url: null }
const EMPTY_DSH_INSTALLATION: DshInstallationStatus = { installed: false, version: null, executable: null, source: null }
const DSH_REPOSITORY = 'deepseek-ai/deepseek-harness'
const CATALOG_PAGE_SIZE = 30
const GITHUB_SEARCH_RESULT_LIMIT = 1000

function formatStars(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 1 : 1)}k`
  return String(value)
}

function formatDate(value: string): string {
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diff / 60000))
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value))
}

function CatalogPagination({ page, total, loading, disabled, onPageChange }: {
  page: number
  total: number
  loading: boolean
  disabled: boolean
  onPageChange: (page: number) => void
}) {
  const accessibleTotal = Math.min(total, GITHUB_SEARCH_RESULT_LIMIT)
  const pageCount = Math.max(1, Math.ceil(accessibleTotal / CATALOG_PAGE_SIZE))
  const rangeStart = accessibleTotal === 0 ? 0 : (page - 1) * CATALOG_PAGE_SIZE + 1
  const rangeEnd = Math.min(page * CATALOG_PAGE_SIZE, accessibleTotal)
  const controlsDisabled = loading || disabled

  return (
    <div className="catalog-pagination" role="navigation" aria-label="仓库分页">
      <p>
        当前显示 {rangeStart}-{rangeEnd}，可浏览 {accessibleTotal.toLocaleString('zh-CN')} 个仓库
        {total > GITHUB_SEARCH_RESULT_LIMIT && <>；GitHub 搜索最多开放前 {GITHUB_SEARCH_RESULT_LIMIT.toLocaleString('zh-CN')} 个</>}
      </p>
      <div className="catalog-page-controls">
        <button type="button" disabled={controlsDisabled || page <= 1} onClick={() => onPageChange(page - 1)} aria-label="上一页" title="上一页"><ChevronLeft size={17} /></button>
        <span aria-live="polite">第 {page} / {pageCount} 页</span>
        <button type="button" disabled={controlsDisabled || page >= pageCount} onClick={() => onPageChange(page + 1)} aria-label="下一页" title="下一页"><ChevronRight size={17} /></button>
      </div>
    </div>
  )
}

function pluginInitial(plugin: ManagedPlugin): string {
  return plugin.displayName.trim().slice(0, 2).toUpperCase()
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface ToastState {
  kind: 'success' | 'error'
  message: string
}

interface BatchScanState {
  phase: 'running' | 'complete' | 'partial'
  total: number
  completed: number
  available: number
  failed: number
}

export default function App() {
  const [surface, setSurface] = useState<'launcher' | 'manager'>('launcher')
  const [view, setView] = useState<ViewName>('plugins')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [profile, setProfile] = useState<ProfileState | null>(null)
  const [runtime, setRuntime] = useState<RuntimeState>(EMPTY_RUNTIME)
  const [dshInstallation, setDshInstallation] = useState<DshInstallationStatus>(EMPTY_DSH_INSTALLATION)
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus>({ configured: false })
  const [logs, setLogs] = useState<RuntimeOutput[]>([])
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [credentialOpen, setCredentialOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [confirmingRemoval, setConfirmingRemoval] = useState<ManagedPlugin | null>(null)
  const [repositoryAnalyses, setRepositoryAnalyses] = useState<Record<string, RepositoryAnalysis>>({})
  const [skillRepositoryAnalyses, setSkillRepositoryAnalyses] = useState<Record<string, SkillRepositoryAnalysis>>({})

  const showToast = useCallback((next: ToastState) => {
    setToast(next)
    window.setTimeout(() => setToast(current => current === next ? null : current), 4200)
  }, [])

  const refreshProfile = useCallback(async () => {
    try {
      const next = await api.readProfile()
      setProfile(next)
      setSelectedPlugin(current => current && next.plugins.some(plugin => plugin.packageName === current)
        ? current
        : next.plugins[0]?.packageName ?? null)
    } catch (error) {
      showToast({ kind: 'error', message: errorText(error) })
    }
  }, [showToast])

  useEffect(() => {
    void Promise.all([api.getSettings(), api.readProfile(), api.getRuntimeState(), api.getDeepSeekCredentialStatus(), api.detectDshInstallation()])
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
    const unsubscribeOutput = api.onRuntimeOutput(output => setLogs(current => [...current.slice(-499), output]))
    const unsubscribeState = api.onRuntimeState(setRuntime)
    const unsubscribeInstallProgress = api.onInstallProgress(setInstallProgress)
    return () => {
      unsubscribeOutput()
      unsubscribeState()
      unsubscribeInstallProgress()
    }
  }, [showToast])

  const selected = profile?.plugins.find(plugin => plugin.packageName === selectedPlugin) ?? null

  const showManager = () => {
    setSurface('manager')
    void api.setWindowMode('manager').catch(error => showToast({ kind: 'error', message: errorText(error) }))
  }

  const showLauncher = () => {
    setSurface('launcher')
    void api.setWindowMode('launcher').catch(error => showToast({ kind: 'error', message: errorText(error) }))
  }

  const toggleRuntime = async () => {
    const needsInstallation = !runtime.running && !dshInstallation.installed
    setBusy(needsInstallation ? 'dsh-install' : 'runtime')
    try {
      if (needsInstallation) {
        setInstallProgress({ repository: DSH_REPOSITORY, kind: 'dsh', phase: 'preparing', percent: 0, message: '正在准备本地 DSH' })
        const result = await api.installPlugin(DSH_REPOSITORY)
        setSettings(result.settings)
        setProfile(result.profile)
        setDshInstallation(result.dshInstallation)
        setSelectedPlugin(result.profile.plugins[0]?.packageName ?? null)
        showToast({ kind: 'success', message: `本地 DSH ${result.dshInstallation.version ?? ''} 已安装，可以启动。` })
        return
      }
      const next = runtime.running ? await api.stopRuntime() : await api.startRuntime()
      setRuntime(next)
      if (!runtime.running) setView('runtime')
    } catch (error) {
      showToast({ kind: 'error', message: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  const saveSettings = async (next: AppSettings) => {
    setBusy('settings')
    try {
      const saved = await api.saveSettings(next)
      setSettings(saved)
      setDshInstallation(await api.detectDshInstallation())
      setCredentialStatus(await api.getDeepSeekCredentialStatus())
      setSettingsOpen(false)
      await refreshProfile()
      showToast({ kind: 'success', message: '设置已保存。' })
    } catch (error) {
      showToast({ kind: 'error', message: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  const saveApiKey = async (apiKey: string) => {
    setBusy('credential')
    try {
      setCredentialStatus(await api.setDeepSeekApiKey(apiKey))
      setCredentialOpen(false)
      showToast({ kind: 'success', message: 'DeepSeek API Key 已保存，DSH 可立即使用。' })
    } catch (error) {
      showToast({ kind: 'error', message: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  const clearApiKey = async () => {
    setBusy('credential')
    try {
      setCredentialStatus(await api.clearDeepSeekApiKey())
      setCredentialOpen(false)
      showToast({ kind: 'success', message: 'DeepSeek API Key 已清除。' })
    } catch (error) {
      showToast({ kind: 'error', message: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  const togglePlugin = async (plugin: ManagedPlugin, enabled: boolean) => {
    setBusy(plugin.packageName)
    try {
      const next = await api.togglePlugin(plugin.packageName, enabled)
      setProfile(next)
      showToast({ kind: 'success', message: enabled ? '插件将在下次启动时加载。' : '插件已停用，但仍保留在本机。' })
    } catch (error) {
      showToast({ kind: 'error', message: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  const reorder = async (packageNames: string[]) => {
    if (!profile) return
    const previous = profile
    const orderMap = new Map(packageNames.map((name, index) => [name, index + 1]))
    setProfile({
      ...profile,
      activeBundles: packageNames,
      plugins: [...profile.plugins].sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
        return (orderMap.get(a.packageName) ?? 999) - (orderMap.get(b.packageName) ?? 999)
      }).map(plugin => ({ ...plugin, order: orderMap.get(plugin.packageName) ?? null })),
    })
    setBusy('reorder')
    try {
      setProfile(await api.reorderPlugins(packageNames))
    } catch (error) {
      setProfile(previous)
      showToast({ kind: 'error', message: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  const uninstall = async () => {
    const plugin = confirmingRemoval
    if (!plugin) return
    setConfirmingRemoval(null)
    setBusy(plugin.packageName)
    try {
      const next = await api.uninstallPlugin(plugin.packageName)
      setProfile(next)
      setSelectedPlugin(next.plugins[0]?.packageName ?? null)
      showToast({ kind: 'success', message: `${plugin.displayName} 已卸载。` })
    } catch (error) {
      showToast({ kind: 'error', message: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  if (loading || !settings || !profile) {
    return (
      <div className="app-loading">
        <div className="brand-mark"><Layers3 size={22} /></div>
        <LoaderCircle className="spin" size={22} />
        <span>正在读取 DSH 配置</span>
      </div>
    )
  }

  return (
    <>
      {surface === 'launcher' ? (
        <LauncherHome
          settings={settings}
          profile={profile}
          runtime={runtime}
          dshInstallation={dshInstallation}
          installProgress={installProgress?.repository === DSH_REPOSITORY ? installProgress : null}
          busy={busy === 'runtime' || busy === 'dsh-install'}
          installingDsh={busy === 'dsh-install'}
          onCredential={() => setCredentialOpen(true)}
          onManage={showManager}
          onToggleRuntime={toggleRuntime}
          onOpenHarness={() => runtime.url && void api.openExternal(runtime.url)}
          onClose={() => void api.closeWindow()}
        />
      ) : (
        <div className="app-shell">
          <AppHeader
            runtime={runtime}
            busy={busy === 'runtime' || busy === 'dsh-install'}
            dshInstalled={dshInstallation.installed}
            installingDsh={busy === 'dsh-install'}
            profileName={settings.profileName}
            credentialStatus={credentialStatus}
            onBack={showLauncher}
            onCredential={() => setCredentialOpen(true)}
            onSettings={() => setSettingsOpen(true)}
            onToggleRuntime={toggleRuntime}
            onClose={() => void api.closeWindow()}
          />
          <div className="app-body">
            <SideNavigation
              view={view}
              profile={profile}
              runtime={runtime}
              profileName={settings.profileName}
              onChange={setView}
            />
            <main className="workspace">
              {view === 'plugins' && (
                <PluginsView
                  profile={profile}
                  selected={selected}
                  busy={busy}
                  onSelect={plugin => setSelectedPlugin(plugin.packageName)}
                  onToggle={togglePlugin}
                  onReorder={reorder}
                  onRefresh={refreshProfile}
                  onBrowse={() => setView('discover')}
                  onOpenPath={path => void api.openPath(path)}
                  onOpenRepository={url => void api.openExternal(url)}
                  onUninstall={setConfirmingRemoval}
                />
              )}
              {view === 'discover' && (
                <DiscoverView
                  profile={profile}
                  analyses={repositoryAnalyses}
                  onAnalysis={(repository, analysis) => {
                    setRepositoryAnalyses(current => ({ ...current, [repository]: analysis }))
                  }}
                  onInstalled={result => {
                    setProfile(result.profile)
                    setSettings(result.settings)
                    setDshInstallation(result.dshInstallation)
                    showToast({
                      kind: 'success',
                      message: result.kind === 'dsh'
                        ? `本地 DSH ${result.dshInstallation.version ?? ''} 已安装。`
                        : `${result.packageName ?? '插件'} 已安装到 ${result.installedProfileName ?? settings.profileName} Profile。`,
                    })
                  }}
                  onError={message => showToast({ kind: 'error', message })}
                  onOpenRepository={url => void api.openExternal(url)}
                />
              )}
              {view === 'skills' && (
                <SkillHubView
                  analyses={skillRepositoryAnalyses}
                  onAnalysis={(repository, analysis) => {
                    setSkillRepositoryAnalyses(current => ({ ...current, [repository]: analysis }))
                  }}
                  onInstalled={skill => showToast({ kind: 'success', message: `${skill.name} 已安装到本地 Skill 目录。` })}
                  onError={message => showToast({ kind: 'error', message })}
                  onOpenRepository={url => void api.openExternal(url)}
                />
              )}
              {view === 'runtime' && (
                <RuntimeView
                  runtime={runtime}
                  settings={settings}
                  logs={logs}
                  busy={busy === 'runtime' || busy === 'dsh-install'}
                  onToggleRuntime={toggleRuntime}
                  onOpenHarness={() => runtime.url && void api.openExternal(runtime.url)}
                  onClearLogs={() => setLogs([])}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              )}
            </main>
          </div>
        </div>
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          busy={busy === 'settings'}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
        />
      )}
      {credentialOpen && (
        <CredentialDialog
          status={credentialStatus}
          busy={busy === 'credential'}
          onClose={() => setCredentialOpen(false)}
          onSave={saveApiKey}
          onClear={clearApiKey}
        />
      )}
      {confirmingRemoval && (
        <ConfirmDialog
          plugin={confirmingRemoval}
          onCancel={() => setConfirmingRemoval(null)}
          onConfirm={uninstall}
        />
      )}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </>
  )
}

function LauncherHome({ settings, profile, runtime, dshInstallation, installProgress, busy, installingDsh, onCredential, onManage, onToggleRuntime, onOpenHarness, onClose }: {
  settings: AppSettings
  profile: ProfileState
  runtime: RuntimeState
  dshInstallation: DshInstallationStatus
  installProgress: InstallProgress | null
  busy: boolean
  installingDsh: boolean
  onCredential: () => void
  onManage: () => void
  onToggleRuntime: () => void
  onOpenHarness: () => void
  onClose: () => void
}) {
  const needsInstallation = !dshInstallation.installed
  const runtimeLabel = busy
    ? installingDsh ? '正在安装' : runtime.running ? '正在停止' : '正在启动'
    : runtime.running ? runtime.url ? '已就绪' : '正在启动'
      : needsInstallation ? '尚未安装' : '等待启动'

  return (
    <div className="launcher-home">
      <div className="launcher-drag-region" aria-hidden="true" />
      <button className="launcher-window-close" type="button" title="关闭" aria-label="关闭" onClick={onClose}>
        <X size={18} />
      </button>

      <main className="launcher-stage">
        <div className="launcher-title-block">
          <span className="launcher-kicker">LOCAL AI WORKSPACE</span>
          <h1>DeepSeek Harness</h1>
          <p>{needsInstallation ? '首次部署准备' : `本地 DSH ${dshInstallation.version ?? ''}`} · {profile.activeBundles.length} 个加载层</p>
        </div>

        <div className="launcher-controls">
          <div className="launcher-runtime-state">
            <span className={`launcher-state-dot ${runtime.running ? 'running' : ''}`} />
            <div><small>运行状态</small><strong>{runtimeLabel}</strong></div>
            <span>{runtime.running && runtime.pid ? `PID ${runtime.pid}` : settings.profileName}</span>
          </div>

          <div className="launcher-action-grid">
            <button
              type="button"
              className={`launcher-start-button ${runtime.running ? 'stop' : ''}`}
              onClick={onToggleRuntime}
              disabled={busy}
            >
              {busy ? <LoaderCircle className="spin" size={24} /> : runtime.running ? <CircleStop size={24} /> : needsInstallation ? <Download size={24} /> : <Play size={25} fill="currentColor" />}
              <span>
                <small>{installingDsh ? installProgress?.message ?? '正在准备本地 DSH' : runtime.running ? '结束本地服务' : needsInstallation ? '首次使用需要完成本地部署' : '启动本地工作台'}</small>
                <strong>{runtime.running ? '停止 DSH' : installingDsh ? installProgress?.indeterminate ? '安装进行中' : `安装 DSH ${installProgress?.percent ?? 0}%` : needsInstallation ? '下载安装 DSH' : '启动 DSH'}</strong>
              </span>
            </button>
            <button type="button" className="launcher-utility-button" onClick={onManage} disabled={busy}><Settings size={17} /><span>管理</span></button>
            <button type="button" className="launcher-utility-button" onClick={onCredential} disabled={busy}><KeyRound size={17} /><span>API Key</span></button>
          </div>

          <div className="launcher-profile-row">
            <span>启动配置</span>
            <label className="launcher-profile-select">
              <Box size={15} />
              <select aria-label="启动配置" value={settings.profileName} onChange={() => undefined}>
                <option value={settings.profileName}>{settings.profileName}</option>
              </select>
            </label>
            {runtime.url ? (
              <button type="button" className="launcher-open-button" onClick={onOpenHarness}>打开 Harness<ExternalLink size={13} /></button>
            ) : (
              <span className="launcher-runtime-source">{needsInstallation ? '等待部署' : dshInstallation.source === 'system' ? '系统安装' : '启动器安装'}</span>
            )}
          </div>
        </div>
      </main>

      <footer className="launcher-footer">
        <span>DSH Launcher {packageMetadata.version}</span>
        <span>{profile.initialized ? `${profile.plugins.length} 个插件` : 'Profile 等待初始化'}</span>
      </footer>
    </div>
  )
}

function AppHeader({ runtime, busy, dshInstalled, installingDsh, profileName, credentialStatus, onBack, onCredential, onSettings, onToggleRuntime, onClose }: {
  runtime: RuntimeState
  busy: boolean
  dshInstalled: boolean
  installingDsh: boolean
  profileName: string
  credentialStatus: CredentialStatus
  onBack: () => void
  onCredential: () => void
  onSettings: () => void
  onToggleRuntime: () => void
  onClose: () => void
}) {
  return (
    <header className="app-header">
      <div className="brand-block">
        <button className="icon-button manager-back" type="button" title="返回启动页" aria-label="返回启动页" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div className="brand-mark"><Layers3 size={21} strokeWidth={2.2} /></div>
        <div>
          <div className="brand-name">DSH Launcher</div>
          <div className="brand-subtitle">DeepSeek Harness 管理器</div>
        </div>
      </div>
      <div className="header-context">
        <span className="context-label">配置</span>
        <strong>{profileName}</strong>
        <ChevronRight size={14} />
        <span className={`status-dot ${runtime.running ? 'running' : ''}`} />
        <span>{runtime.running ? `运行中 · PID ${runtime.pid}` : dshInstalled ? '尚未启动' : '尚未安装'}</span>
      </div>
      <div className="header-actions">
        <button
          className={`credential-button ${credentialStatus.configured ? 'configured' : ''}`}
          type="button"
          title="配置 DeepSeek API Key"
          onClick={onCredential}
        >
          <KeyRound size={17} />
          <span>DeepSeek Key</span>
          <span className="credential-state">{credentialStatus.configured ? '已配置' : '未配置'}</span>
        </button>
        <button className="icon-button" type="button" title="启动器设置" aria-label="启动器设置" onClick={onSettings}>
          <Settings size={19} />
        </button>
        <button className={`primary-command ${runtime.running ? 'stop' : ''}`} type="button" onClick={onToggleRuntime} disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={18} /> : runtime.running ? <CircleStop size={18} /> : dshInstalled ? <Play size={18} fill="currentColor" /> : <Download size={18} />}
          <span>{runtime.running ? '停止 DSH' : installingDsh ? '安装中' : dshInstalled ? '启动 DSH' : '安装 DSH'}</span>
        </button>
        <button className="manager-window-close" type="button" title="关闭" aria-label="关闭" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
    </header>
  )
}

function SideNavigation({ view, profile, runtime, profileName, onChange }: {
  view: ViewName
  profile: ProfileState
  runtime: RuntimeState
  profileName: string
  onChange: (view: ViewName) => void
}) {
  const entries: Array<{ id: ViewName; label: string; icon: typeof Box; count?: number }> = [
    { id: 'plugins', label: '插件顺序', icon: Layers3, count: profile.plugins.length },
    { id: 'discover', label: '发现插件', icon: Sparkles },
    { id: 'skills', label: 'Skill Hub', icon: BookOpenCheck },
    { id: 'runtime', label: '运行与日志', icon: SquareTerminal },
  ]
  return (
    <aside className="side-navigation">
      <nav aria-label="主导航">
        {entries.map(entry => {
          const Icon = entry.icon
          return (
            <button
              key={entry.id}
              type="button"
              className={view === entry.id ? 'active' : ''}
              aria-label={entry.label}
              title={entry.label}
              onClick={() => onChange(entry.id)}
            >
              <Icon size={18} />
              <span>{entry.label}</span>
              {entry.count !== undefined && <span className="nav-count">{entry.count}</span>}
            </button>
          )
        })}
      </nav>
      <div className="profile-summary">
        <div className="profile-icon"><Box size={17} /></div>
        <div className="profile-copy">
          <strong>{profileName}</strong>
          <span>{profile.initialized ? `${profile.activeBundles.length} 层已激活` : '等待初始化'}</span>
        </div>
        <span className={`mini-status ${runtime.running ? 'running' : ''}`} title={runtime.running ? 'DSH 正在运行' : 'DSH 未运行'} />
      </div>
    </aside>
  )
}

function PluginsView({ profile, selected, busy, onSelect, onToggle, onReorder, onRefresh, onBrowse, onOpenPath, onOpenRepository, onUninstall }: {
  profile: ProfileState
  selected: ManagedPlugin | null
  busy: string | null
  onSelect: (plugin: ManagedPlugin) => void
  onToggle: (plugin: ManagedPlugin, enabled: boolean) => void
  onReorder: (names: string[]) => void
  onRefresh: () => void
  onBrowse: () => void
  onOpenPath: (path: string) => void
  onOpenRepository: (url: string) => void
  onUninstall: (plugin: ManagedPlugin) => void
}) {
  const [filter, setFilter] = useState('')
  const [dragged, setDragged] = useState<string | null>(null)
  const active = profile.plugins.filter(plugin => plugin.enabled)
  const inactive = profile.plugins.filter(plugin => !plugin.enabled)
  const visible = (plugin: ManagedPlugin) => !filter || `${plugin.displayName} ${plugin.packageName}`.toLowerCase().includes(filter.toLowerCase())

  const move = (packageName: string, direction: -1 | 1) => {
    const names = active.map(plugin => plugin.packageName)
    const index = names.indexOf(packageName)
    const target = index + direction
    if (index < 0 || target < 0 || target >= names.length) return
    ;[names[index], names[target]] = [names[target], names[index]]
    onReorder(names)
  }

  const dropAt = (targetName: string) => {
    if (!dragged || dragged === targetName) return setDragged(null)
    const names = active.map(plugin => plugin.packageName)
    const from = names.indexOf(dragged)
    const to = names.indexOf(targetName)
    if (from < 0 || to < 0) return setDragged(null)
    names.splice(to, 0, names.splice(from, 1)[0])
    setDragged(null)
    onReorder(names)
  }

  return (
    <div className="page plugins-page">
      <PageHeading
        eyebrow="WEB PROFILE"
        title="插件加载顺序"
        description="上方先加载，下方可覆盖前序配置。停用插件不会从本机删除。"
        actions={(
          <>
            <button className="secondary-button" type="button" onClick={onRefresh}><RefreshCw size={17} />刷新</button>
            <button className="secondary-button accent" type="button" onClick={onBrowse}><Download size={17} />获取插件</button>
          </>
        )}
      />

      <div className="stats-strip" aria-label="配置概况">
        <div><strong>{profile.activeBundles.length}</strong><span>已激活</span></div>
        <div><strong>{profile.disabledCount}</strong><span>已停用</span></div>
        <div><strong>{profile.dependencyCount}</strong><span>第三方依赖</span></div>
        <button type="button" onClick={() => onOpenPath(profile.profileDir)} title="在资源管理器中打开配置目录">
          <Folder size={16} /><span className="path-clip">{profile.profileDir}</span><ExternalLink size={14} />
        </button>
      </div>

      {!profile.initialized ? (
        <EmptyProfile onBrowse={onBrowse} />
      ) : (
        <div className="plugin-layout">
          <section className="plugin-list-panel" aria-label="插件列表">
            <div className="list-toolbar">
              <label className="search-field compact">
                <Search size={16} />
                <input value={filter} onChange={event => setFilter(event.target.value)} placeholder="筛选已安装插件" />
                {filter && <button type="button" onClick={() => setFilter('')} aria-label="清除筛选"><X size={15} /></button>}
              </label>
              <span>{active.length} 个加载层</span>
            </div>
            <div className="column-headings" aria-hidden="true">
              <span>优先级</span><span>插件</span><span>版本</span><span>状态</span><span />
            </div>
            <div className="plugin-rows">
              {active.filter(visible).map((plugin, index) => (
                <PluginRow
                  key={plugin.packageName}
                  plugin={plugin}
                  selected={selected?.packageName === plugin.packageName}
                  busy={busy === plugin.packageName}
                  dragging={dragged === plugin.packageName}
                  canMoveUp={index > 0}
                  canMoveDown={index < active.length - 1}
                  onSelect={() => onSelect(plugin)}
                  onToggle={enabled => onToggle(plugin, enabled)}
                  onMove={moveDirection => move(plugin.packageName, moveDirection)}
                  onDragStart={() => setDragged(plugin.packageName)}
                  onDrop={() => dropAt(plugin.packageName)}
                />
              ))}
              {inactive.length > 0 && <div className="disabled-divider"><span>已停用</span><i /></div>}
              {inactive.filter(visible).map(plugin => (
                <PluginRow
                  key={plugin.packageName}
                  plugin={plugin}
                  selected={selected?.packageName === plugin.packageName}
                  busy={busy === plugin.packageName}
                  dragging={false}
                  canMoveUp={false}
                  canMoveDown={false}
                  onSelect={() => onSelect(plugin)}
                  onToggle={enabled => onToggle(plugin, enabled)}
                  onMove={() => undefined}
                  onDragStart={() => undefined}
                  onDrop={() => undefined}
                />
              ))}
            </div>
          </section>
          <PluginDetails
            plugin={selected}
            onOpenRepository={onOpenRepository}
            onUninstall={onUninstall}
          />
        </div>
      )}
    </div>
  )
}

function PluginRow({ plugin, selected, busy, dragging, canMoveUp, canMoveDown, onSelect, onToggle, onMove, onDragStart, onDrop }: {
  plugin: ManagedPlugin
  selected: boolean
  busy: boolean
  dragging: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onSelect: () => void
  onToggle: (enabled: boolean) => void
  onMove: (direction: -1 | 1) => void
  onDragStart: () => void
  onDrop: () => void
}) {
  return (
    <div
      className={`plugin-row ${selected ? 'selected' : ''} ${plugin.enabled ? '' : 'disabled'} ${dragging ? 'dragging' : ''}`}
      draggable={plugin.enabled}
      onDragStart={event => {
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); onDrop() }}
      onClick={onSelect}
    >
      <div className="priority-cell">
        {plugin.enabled ? <><GripVertical size={15} /><strong>{String(plugin.order).padStart(2, '0')}</strong></> : <span>—</span>}
      </div>
      <div className="plugin-identity">
        <div className={`plugin-glyph glyph-${plugin.packageName.length % 4}`}>{pluginInitial(plugin)}</div>
        <div><strong>{plugin.displayName}</strong><span>{plugin.packageName}</span></div>
      </div>
      <span className="plugin-version">{plugin.version}</span>
      <div className="state-cell">
        {!plugin.compatible && <span className="compatibility-warning" title="未检测到 dsh.bundle 声明"><CircleAlert size={16} /></span>}
        <label className={`switch ${plugin.locked ? 'locked' : ''}`} title={plugin.locked ? '核心组合层始终启用' : plugin.enabled ? '停用插件' : '启用插件'} onClick={event => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={plugin.enabled}
            disabled={plugin.locked || busy || !plugin.compatible}
            onChange={event => onToggle(event.target.checked)}
            aria-label={`${plugin.enabled ? '停用' : '启用'} ${plugin.displayName}`}
          />
          <span>{busy && <LoaderCircle className="spin" size={11} />}</span>
        </label>
      </div>
      <div className="row-actions" onClick={event => event.stopPropagation()}>
        <button type="button" disabled={!canMoveUp} onClick={() => onMove(-1)} title="向上移动" aria-label={`向上移动 ${plugin.displayName}`}><ArrowUp size={15} /></button>
        <button type="button" disabled={!canMoveDown} onClick={() => onMove(1)} title="向下移动" aria-label={`向下移动 ${plugin.displayName}`}><ArrowDown size={15} /></button>
      </div>
    </div>
  )
}

function PluginDetails({ plugin, onOpenRepository, onUninstall }: {
  plugin: ManagedPlugin | null
  onOpenRepository: (url: string) => void
  onUninstall: (plugin: ManagedPlugin) => void
}) {
  if (!plugin) return <aside className="plugin-details empty">选择一个插件查看详情</aside>
  return (
    <aside className="plugin-details">
      <div className="detail-topline">
        <div className={`plugin-glyph large glyph-${plugin.packageName.length % 4}`}>{pluginInitial(plugin)}</div>
        <div className={`detail-state ${plugin.enabled ? 'active' : ''}`}><span />{plugin.enabled ? '已激活' : '已停用'}</div>
      </div>
      <h2>{plugin.displayName}</h2>
      <p className="package-name">{plugin.packageName}</p>
      <p className="plugin-description">{plugin.description}</p>
      <dl>
        <div><dt>加载优先级</dt><dd>{plugin.order ? `#${String(plugin.order).padStart(2, '0')}` : '不加载'}</dd></div>
        <div><dt>版本</dt><dd>{plugin.version}</dd></div>
        <div><dt>来源</dt><dd>{plugin.builtin ? 'DSH 内置' : 'Profile 依赖'}</dd></div>
        <div><dt>兼容性</dt><dd className={plugin.compatible ? 'good' : 'warning'}>{plugin.compatible ? 'Bundle 已识别' : '未检测到 Bundle'}</dd></div>
      </dl>
      <div className="detail-note">
        <SlidersHorizontal size={16} />
        <p>{plugin.enabled ? '本层会按当前优先级参与下一次 DSH 启动。' : '插件文件仍保留在本机，可随时重新启用。'}</p>
      </div>
      <div className="detail-actions">
        {plugin.repository && <button type="button" className="secondary-button full" onClick={() => onOpenRepository(plugin.repository!)}><Github size={16} />查看仓库<ExternalLink size={14} /></button>}
        {!plugin.builtin && <button type="button" className="danger-button full" onClick={() => onUninstall(plugin)}><Trash2 size={16} />从此配置卸载</button>}
      </div>
    </aside>
  )
}

function EmptyProfile({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><PackageCheck size={28} /></div>
      <h2>Web 配置尚未初始化</h2>
      <p>首次启动 DSH 或安装插件时，官方 CLI 会创建 profile。启动器随后会在这里显示真实的组合层。</p>
      <button type="button" className="primary-command" onClick={onBrowse}><Sparkles size={17} />浏览插件</button>
    </div>
  )
}

function DiscoverView({ profile, analyses, onAnalysis, onInstalled, onError, onOpenRepository }: {
  profile: ProfileState
  analyses: Record<string, RepositoryAnalysis>
  onAnalysis: (repository: string, analysis: RepositoryAnalysis) => void
  onInstalled: (result: RepositoryInstallResult) => void
  onError: (message: string) => void
  onOpenRepository: (url: string) => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'stars' | 'updated'>('stars')
  const [repositories, setRepositories] = useState<RepositoryResult[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [batchScan, setBatchScan] = useState<BatchScanState | null>(null)
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)
  const [dshInstallation, setDshInstallation] = useState<DshInstallationStatus>({ installed: false, version: null, executable: null, source: null })
  const [installedRepositories, setInstalledRepositories] = useState<Set<string>>(new Set())
  const [targetDialog, setTargetDialog] = useState<{ repo: RepositoryResult; analysis: RepositoryAnalysis } | null>(null)
  const batchRunRef = useRef(0)

  const search = useCallback(async (searchQuery = query, searchSort = sort, searchPage = page) => {
    batchRunRef.current += 1
    setBatchScan(null)
    setTargetDialog(null)
    setLoading(true)
    try {
      const result = await api.discoverPlugins(searchQuery, searchSort, searchPage)
      setRepositories(result.repositories)
      setTotal(result.totalCount)
      setPage(searchPage)
      setDshInstallation(result.dshInstallation)
      setInstalledRepositories(new Set(result.installedRepositories.map(name => name.toLowerCase())))
    } catch (error) {
      onError(errorText(error))
    } finally {
      setLoading(false)
    }
  }, [onError, page, query, sort])

  useEffect(() => { void search('', 'stars', 1) }, [])
  useEffect(() => api.onInstallProgress(setInstallProgress), [])
  useEffect(() => () => { batchRunRef.current += 1 }, [])

  const installedRepos = useMemo(() => {
    const result = new Set(installedRepositories)
    for (const plugin of profile.plugins) {
      if (plugin.repositoryFullName) result.add(plugin.repositoryFullName.toLowerCase())
    }
    return result
  }, [installedRepositories, profile.plugins])

  const pluginRepositories = useMemo(
    () => repositories.filter(repository => repository.kind === 'plugin'),
    [repositories],
  )
  const batchRunning = batchScan?.phase === 'running'

  const changePage = (nextPage: number) => {
    void search(query, sort, nextPage)
  }

  const inspect = async (repo: RepositoryResult) => {
    setChecking(repo.fullName)
    try {
      const analysis = await api.analyzePlugin(repo.fullName, repo.defaultBranch)
      onAnalysis(repo.fullName, analysis)
      if (analysis.installability === 'choice') setTargetDialog({ repo, analysis })
    } catch (error) {
      onError(errorText(error))
    } finally {
      setChecking(null)
    }
  }

  const inspectAll = async () => {
    if (pluginRepositories.length === 0 || batchRunning) return

    const runId = batchRunRef.current + 1
    batchRunRef.current = runId
    const total = pluginRepositories.length
    let completed = 0
    let available = 0
    let failed = 0
    let consecutiveFailures = 0
    let stopped = false
    setTargetDialog(null)
    setBatchScan({ phase: 'running', total, completed, available, failed })

    for (const repo of pluginRepositories) {
      if (batchRunRef.current !== runId) return
      setChecking(repo.fullName)
      try {
        const analysis = await api.analyzePlugin(repo.fullName, repo.defaultBranch)
        if (batchRunRef.current !== runId) return
        onAnalysis(repo.fullName, analysis)
        if (analysis.installability === 'ready' || analysis.installability === 'choice') available += 1
        consecutiveFailures = 0
      } catch (error) {
        if (batchRunRef.current !== runId) return
        failed += 1
        consecutiveFailures += 1
        const message = errorText(error)
        stopped = /403|rate.?limit|请求额度|请求频率/i.test(message) || consecutiveFailures >= 3
      }

      completed += 1
      setBatchScan({ phase: 'running', total, completed, available, failed })
      if (stopped) break
    }

    setChecking(null)
    setBatchScan({
      phase: stopped || completed < total ? 'partial' : 'complete',
      total,
      completed,
      available,
      failed,
    })
  }

  const install = async (repo: RepositoryResult, target?: PluginInstallTarget) => {
    setInstalling(repo.fullName)
    setTargetDialog(null)
    setInstallProgress({ repository: repo.fullName, kind: repo.kind, phase: 'preparing', percent: 0, message: repo.kind === 'dsh' ? '正在准备本地 DSH' : '正在检查插件组件' })
    try {
      const result = await api.installPlugin(repo.kind === 'dsh'
        ? repo.fullName
        : {
            repository: repo.fullName,
            defaultBranch: repo.defaultBranch,
            targetId: target?.id ?? '',
          })
      setDshInstallation(result.dshInstallation)
      setInstalledRepositories(current => new Set(current).add(repo.fullName.toLowerCase()))
      onInstalled(result)
    } catch (error) {
      onError(errorText(error))
    } finally {
      setInstalling(null)
    }
  }

  return (
    <div className="page discover-page">
      <PageHeading eyebrow="GITHUB CATALOG" title="发现 DSH 插件" description={`从 GitHub dsh-plugin 主题中浏览 ${total ? total.toLocaleString('zh-CN') : ''} 个公开仓库。安装前请检查仓库说明与来源。`} />
      <div className="discovery-controls">
        <form className="search-field large" onSubmit={event => { event.preventDefault(); void search(query, sort, 1) }}>
          <Search size={18} />
          <input value={query} disabled={batchRunning} onChange={event => setQuery(event.target.value)} placeholder="搜索名称、作者或说明" aria-label="搜索插件" />
          {query && <button type="button" disabled={batchRunning} onClick={() => { setQuery(''); void search('', sort, 1) }} aria-label="清除搜索"><X size={16} /></button>}
          <button type="submit" className="search-submit" disabled={batchRunning}>搜索</button>
        </form>
        <div className="discovery-actions">
          <div className="segmented-control" aria-label="插件排序方式">
            <button type="button" disabled={batchRunning} className={sort === 'stars' ? 'active' : ''} onClick={() => { setSort('stars'); void search(query, 'stars', 1) }}><Star size={15} />热门</button>
            <button type="button" disabled={batchRunning} className={sort === 'updated' ? 'active' : ''} onClick={() => { setSort('updated'); void search(query, 'updated', 1) }}><Clock3 size={15} />最近更新</button>
          </div>
          <button
            type="button"
            className="secondary-button catalog-scan-button"
            disabled={loading || batchRunning || checking !== null || installing !== null || pluginRepositories.length === 0}
            onClick={() => void inspectAll()}
            title="检测当前页中的全部第三方插件候选"
          >
            {batchRunning ? <LoaderCircle className="spin" size={15} /> : <ScanSearch size={15} />}
            {batchRunning ? `检测 ${batchScan.completed}/${batchScan.total}` : batchScan ? '再次检测当前页' : '检测当前页'}
          </button>
        </div>
      </div>

      {batchScan && (
        <div className={`batch-scan-status ${batchScan.phase}`} role="status" aria-live="polite">
          {batchRunning ? <LoaderCircle className="spin" size={15} /> : batchScan.phase === 'complete' ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <span>
            {batchRunning
              ? `正在检测当前页插件候选：${batchScan.completed}/${batchScan.total}`
              : batchScan.phase === 'complete'
                ? `检测完成：${batchScan.total} 个候选中有 ${batchScan.available} 个包含可安装组件${batchScan.failed ? `，${batchScan.failed} 个检测失败` : ''}`
                : `检测已暂停：完成 ${batchScan.completed}/${batchScan.total}，发现 ${batchScan.available} 个可安装组件，${batchScan.failed} 个请求失败`}
          </span>
          <div className="batch-scan-track" aria-hidden="true"><i style={{ width: `${Math.round(batchScan.completed / batchScan.total * 100)}%` }} /></div>
        </div>
      )}

      <div className="catalog-note"><CircleAlert size={16} /><span>GitHub 主题表示仓库自我声明为 DSH 插件；官方 <code>deepseek-ai/deepseek-harness</code> 会作为 DSH 本体安装到启动器的本地运行目录。</span></div>
      <CatalogPagination page={page} total={total} loading={loading} disabled={batchRunning || checking !== null || installing !== null} onPageChange={changePage} />
      <section className="repository-list" aria-busy={loading}>
        <div className="repository-headings" aria-hidden="true"><span>仓库</span><span>语言</span><span>活跃度</span><span /></div>
        {loading ? (
          <div className="list-loading"><LoaderCircle className="spin" size={21} />正在读取 GitHub 目录</div>
        ) : repositories.length === 0 ? (
          <div className="list-loading"><Search size={21} />没有找到匹配的仓库</div>
        ) : repositories.map(repo => {
          const installed = repo.kind === 'dsh' ? dshInstallation.installed : installedRepos.has(repo.fullName.toLowerCase())
          const analysis = analyses[repo.fullName]
          const progress = installing === repo.fullName && installProgress?.repository === repo.fullName ? installProgress : null
          const indeterminate = progress?.indeterminate === true && progress.phase !== 'error'
          const isChecking = checking === repo.fullName
          const target = analysis?.targets.length === 1 ? analysis.targets[0] : undefined
          const actionLabel = repo.kind === 'dsh'
            ? installed ? '更新 DSH' : '安装 DSH'
            : !analysis
              ? installed ? '检测更新' : '检测'
              : analysis.installability === 'choice'
                ? '选择组件'
                : analysis.installability === 'ready'
                  ? installed ? '更新' : '安装'
                  : analysis.installability === 'dynamic'
                    ? '动态插件'
                    : analysis.installability === 'application'
                      ? '非插件'
                      : '不可安装'
          const actionDisabled = installing !== null
            || checking !== null
            || Boolean(analysis && !['ready', 'choice'].includes(analysis.installability))
          const runAction = () => {
            if (repo.kind === 'dsh') return void install(repo)
            if (!analysis) return void inspect(repo)
            if (analysis.installability === 'choice') return setTargetDialog({ repo, analysis })
            if (target) void install(repo, target)
          }
          return (
            <article className={`repository-row ${repo.kind === 'dsh' ? 'dsh-core-row' : ''}`} key={repo.id}>
              <div className="repo-main">
                <div className={`repo-icon ${repo.kind === 'dsh' ? 'dsh-core-icon' : ''}`}>{repo.kind === 'dsh' ? <Layers3 size={18} /> : <Github size={18} />}</div>
                <div>
                  <div className="repo-title-line">
                    <button type="button" className="repo-title" onClick={() => onOpenRepository(repo.url)}><span>{repo.owner}/</span><strong>{repo.name}</strong><ExternalLink size={13} /></button>
                    {repo.kind === 'dsh' && <span className="dsh-core-badge">DSH 本体</span>}
                    {analysis && <span className={`repository-analysis-badge ${analysis.installability}`}>{analysis.installability === 'ready' ? 'Bundle' : analysis.installability === 'choice' ? `${analysis.targets.length} 个组件` : analysis.installability === 'dynamic' ? '动态' : analysis.installability === 'application' ? '应用' : '无效'}</span>}
                  </div>
                  <p>{repo.description}</p>
                  {analysis && <div className={`repository-analysis-note ${analysis.installability}`}>
                    {analysis.summary}
                    {target && <span>{target.source === 'npm' ? 'npm' : target.source === 'github' ? 'GitHub' : `子目录 ${target.subdirectory}`} · {target.profileName} Profile{target.requiresBuild ? ' · 需要构建' : ''}</span>}
                  </div>}
                  <div className="topic-list">{repo.topics.slice(0, 3).map(topic => <span key={topic}>{topic}</span>)}</div>
                </div>
              </div>
              <div className="language-cell"><i className={`language-dot lang-${(repo.language ?? 'other').toLowerCase()}`} />{repo.language ?? '其他'}</div>
              <div className="activity-cell"><span><Star size={15} fill="currentColor" />{formatStars(repo.stars)}</span><small>更新于 {formatDate(repo.updatedAt)}</small></div>
              <div className="install-cell">
                {progress ? (
                  <div className={`install-progress ${progress.phase === 'error' ? 'error' : ''} ${indeterminate ? 'indeterminate' : ''}`}>
                    <div><LoaderCircle className="spin" size={14} /><span>{progress.message}</span><strong>{indeterminate ? '进行中' : `${progress.percent}%`}</strong></div>
                    <div
                      className="progress-track"
                      role="progressbar"
                      aria-label={progress.message}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={indeterminate ? undefined : progress.percent}
                      aria-valuetext={indeterminate ? '正在进行' : undefined}
                    ><span style={indeterminate ? undefined : { width: `${progress.percent}%` }} /></div>
                  </div>
                ) : installed ? (
                  <div className="installed-actions">
                    <span className="installed-label"><Check size={16} />{repo.kind === 'dsh' ? `${dshInstallation.source === 'system' ? '系统 DSH' : '本地 DSH'} ${dshInstallation.version ?? ''}` : '已下载'}</span>
                    <button type="button" className="install-button update-button" disabled={actionDisabled} onClick={runAction} title={`检查并更新 ${repo.name}`}>
                      {isChecking ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{actionLabel}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="install-button" disabled={actionDisabled} onClick={runAction}>
                    {isChecking || installing === repo.fullName ? <LoaderCircle className="spin" size={16} /> : analysis?.installability === 'application' ? <Box size={16} /> : analysis && !['ready', 'choice'].includes(analysis.installability) ? <CircleAlert size={16} /> : <Download size={16} />}
                    {isChecking ? '检测中' : actionLabel}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </section>
      {targetDialog && (
        <PluginTargetDialog
          repo={targetDialog.repo}
          analysis={targetDialog.analysis}
          busy={installing !== null}
          onClose={() => setTargetDialog(null)}
          onInstall={target => void install(targetDialog.repo, target)}
        />
      )}
    </div>
  )
}

function SkillHubView({ analyses, onAnalysis, onInstalled, onError, onOpenRepository }: {
  analyses: Record<string, SkillRepositoryAnalysis>
  onAnalysis: (repository: string, analysis: SkillRepositoryAnalysis) => void
  onInstalled: (skill: InstalledSkill) => void
  onError: (message: string) => void
  onOpenRepository: (url: string) => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'stars' | 'updated'>('stars')
  const [repositories, setRepositories] = useState<SkillRepositoryResult[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([])
  const [targetDialog, setTargetDialog] = useState<{ repo: SkillRepositoryResult; analysis: SkillRepositoryAnalysis } | null>(null)
  const [batchScan, setBatchScan] = useState<BatchScanState | null>(null)
  const batchRunRef = useRef(0)

  const search = useCallback(async (searchQuery = query, searchSort = sort, searchPage = page) => {
    batchRunRef.current += 1
    setBatchScan(null)
    setTargetDialog(null)
    setLoading(true)
    try {
      const result = await api.discoverSkills(searchQuery, searchSort, searchPage)
      setRepositories(result.repositories)
      setTotal(result.totalCount)
      setPage(searchPage)
      setInstalledSkills(result.installedSkills)
    } catch (error) {
      onError(errorText(error))
    } finally {
      setLoading(false)
    }
  }, [onError, page, query, sort])

  useEffect(() => { void search('', 'stars', 1) }, [])
  useEffect(() => {
    const unsubscribe = api.onInstallProgress(progress => {
      if (progress.kind === 'skill') setInstallProgress(progress)
    })
    return unsubscribe
  }, [])
  useEffect(() => () => { batchRunRef.current += 1 }, [])

  const installedNames = useMemo(() => new Set(installedSkills.map(skill => skill.name)), [installedSkills])
  const batchRunning = batchScan?.phase === 'running'

  const changePage = (nextPage: number) => {
    void search(query, sort, nextPage)
  }

  const inspect = async (repo: SkillRepositoryResult) => {
    setChecking(repo.fullName)
    try {
      const analysis = await api.analyzeSkill(repo.fullName, repo.defaultBranch)
      onAnalysis(repo.fullName, analysis)
      if (analysis.installability === 'choice') setTargetDialog({ repo, analysis })
    } catch (error) {
      onError(errorText(error))
    } finally {
      setChecking(null)
    }
  }

  const install = async (repo: SkillRepositoryResult, target: SkillInstallTarget) => {
    setInstalling(repo.fullName)
    setTargetDialog(null)
    setInstallProgress({ repository: repo.fullName, kind: 'skill', phase: 'preparing', percent: 0, message: '正在准备本地 Skill 目录' })
    try {
      const result = await api.installSkill({ repository: repo.fullName, defaultBranch: repo.defaultBranch, targetId: target.id })
      setInstalledSkills(result.installedSkills)
      onInstalled(result.installedSkill)
    } catch (error) {
      onError(errorText(error))
    } finally {
      setInstalling(null)
    }
  }

  const inspectAll = async () => {
    if (repositories.length === 0 || batchRunning) return
    const runId = batchRunRef.current + 1
    batchRunRef.current = runId
    const totalCandidates = repositories.length
    let completed = 0
    let available = 0
    let failed = 0
    let consecutiveFailures = 0
    let stopped = false
    setTargetDialog(null)
    setBatchScan({ phase: 'running', total: totalCandidates, completed, available, failed })

    for (const repo of repositories) {
      if (batchRunRef.current !== runId) return
      setChecking(repo.fullName)
      try {
        const analysis = await api.analyzeSkill(repo.fullName, repo.defaultBranch)
        if (batchRunRef.current !== runId) return
        onAnalysis(repo.fullName, analysis)
        if (analysis.installability !== 'invalid') available += 1
        consecutiveFailures = 0
      } catch (error) {
        if (batchRunRef.current !== runId) return
        failed += 1
        consecutiveFailures += 1
        const message = errorText(error)
        stopped = /403|rate.?limit|请求额度|请求频率/i.test(message) || consecutiveFailures >= 3
      }
      completed += 1
      setBatchScan({ phase: 'running', total: totalCandidates, completed, available, failed })
      if (stopped) break
    }

    setChecking(null)
    setBatchScan({
      phase: stopped || completed < totalCandidates ? 'partial' : 'complete',
      total: totalCandidates,
      completed,
      available,
      failed,
    })
  }

  return (
    <div className="page discover-page skill-hub-page">
      <PageHeading eyebrow="SKILL HUB" title="发现 DSH Skills" description={`从 GitHub dsh-skill 主题中浏览 ${total ? total.toLocaleString('zh-CN') : ''} 个公开仓库。只有通过 DSH 格式检查的内容才能安装。`} />
      <div className="discovery-controls">
        <form className="search-field large" onSubmit={event => { event.preventDefault(); void search(query, sort, 1) }}>
          <Search size={18} />
          <input value={query} disabled={batchRunning} onChange={event => setQuery(event.target.value)} placeholder="搜索名称、作者或说明" aria-label="搜索 Skills" />
          {query && <button type="button" disabled={batchRunning} onClick={() => { setQuery(''); void search('', sort, 1) }} aria-label="清除搜索"><X size={16} /></button>}
          <button type="submit" className="search-submit" disabled={batchRunning}>搜索</button>
        </form>
        <div className="discovery-actions">
          <div className="segmented-control" aria-label="Skill 排序方式">
            <button type="button" disabled={batchRunning} className={sort === 'stars' ? 'active' : ''} onClick={() => { setSort('stars'); void search(query, 'stars', 1) }}><Star size={15} />热门</button>
            <button type="button" disabled={batchRunning} className={sort === 'updated' ? 'active' : ''} onClick={() => { setSort('updated'); void search(query, 'updated', 1) }}><Clock3 size={15} />最近更新</button>
          </div>
          <button type="button" className="secondary-button catalog-scan-button" disabled={loading || batchRunning || checking !== null || installing !== null || repositories.length === 0} onClick={() => void inspectAll()} title="检测当前页中的全部 Skill 候选">
            {batchRunning ? <LoaderCircle className="spin" size={15} /> : <ScanSearch size={15} />}
            {batchRunning ? `检测 ${batchScan.completed}/${batchScan.total}` : batchScan ? '再次检测当前页' : '检测当前页'}
          </button>
        </div>
      </div>

      {batchScan && (
        <div className={`batch-scan-status ${batchScan.phase}`} role="status" aria-live="polite">
          {batchRunning ? <LoaderCircle className="spin" size={15} /> : batchScan.phase === 'complete' ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <span>{batchRunning
            ? `正在检测当前页 Skill 候选：${batchScan.completed}/${batchScan.total}`
            : batchScan.phase === 'complete'
              ? `检测完成：${batchScan.total} 个候选中有 ${batchScan.available} 个包含有效 Skill${batchScan.failed ? `，${batchScan.failed} 个检测失败` : ''}`
              : `检测已暂停：完成 ${batchScan.completed}/${batchScan.total}，发现 ${batchScan.available} 个有效 Skill 仓库，${batchScan.failed} 个请求失败`}</span>
          <div className="batch-scan-track" aria-hidden="true"><i style={{ width: `${Math.round(batchScan.completed / batchScan.total * 100)}%` }} /></div>
        </div>
      )}

      <div className="catalog-note skill-hub-note"><BookOpenCheck size={16} /><span>检测会核对 <code>SKILL.md</code> 或单文件 Markdown 的 YAML frontmatter：必须包含 kebab-case 的 <code>name</code> 与 <code>description</code>。通过后安装到 <code>DSH_HOME/skills</code>。</span></div>
      <CatalogPagination page={page} total={total} loading={loading} disabled={batchRunning || checking !== null || installing !== null} onPageChange={changePage} />
      <section className="repository-list" aria-busy={loading}>
        <div className="repository-headings" aria-hidden="true"><span>仓库</span><span>语言</span><span>活跃度</span><span /></div>
        {loading ? (
          <div className="list-loading"><LoaderCircle className="spin" size={21} />正在读取 GitHub Skill 目录</div>
        ) : repositories.length === 0 ? (
          <div className="list-loading"><Search size={21} />没有找到匹配的仓库</div>
        ) : repositories.map(repo => {
          const analysis = analyses[repo.fullName]
          const target = analysis?.targets.length === 1 ? analysis.targets[0] : undefined
          const installedTargetCount = analysis?.targets.filter(item => installedNames.has(item.name)).length ?? 0
          const installed = installedTargetCount > 0
          const progress = installing === repo.fullName && installProgress?.repository === repo.fullName ? installProgress : null
          const indeterminate = progress?.indeterminate === true && progress.phase !== 'error'
          const isChecking = checking === repo.fullName
          const actionLabel = !analysis
            ? '检测'
            : analysis.installability === 'choice'
              ? '选择 Skill'
              : analysis.installability === 'ready'
                ? installed ? '更新' : '安装'
                : '非 Skill'
          const actionDisabled = installing !== null || checking !== null || Boolean(analysis && analysis.installability === 'invalid')
          const runAction = () => {
            if (!analysis) return void inspect(repo)
            if (analysis.installability === 'choice') return setTargetDialog({ repo, analysis })
            if (target) void install(repo, target)
          }
          return (
            <article className="repository-row skill-row" key={repo.id}>
              <div className="repo-main">
                <div className="repo-icon skill-icon"><BookOpenCheck size={18} /></div>
                <div>
                  <div className="repo-title-line">
                    <button type="button" className="repo-title" onClick={() => onOpenRepository(repo.url)}><span>{repo.owner}/</span><strong>{repo.name}</strong><ExternalLink size={13} /></button>
                    {analysis && <span className={`repository-analysis-badge ${analysis.installability}`}>{analysis.installability === 'ready' ? 'Skill' : analysis.installability === 'choice' ? `${analysis.targets.length} Skills` : '非 Skill'}</span>}
                  </div>
                  <p>{repo.description}</p>
                  {analysis && <div className={`repository-analysis-note ${analysis.installability}`}>
                    {analysis.summary}
                    {target && <span>{target.format === 'bundle' ? '目录 Skill' : '单文件 Skill'} · {target.name}{target.modelInvocable ? '' : ' · 不对模型开放'}</span>}
                  </div>}
                  <div className="topic-list">{repo.topics.slice(0, 3).map(topic => <span key={topic}>{topic}</span>)}</div>
                </div>
              </div>
              <div className="language-cell"><i className={`language-dot lang-${(repo.language ?? 'other').toLowerCase()}`} />{repo.language ?? '其他'}</div>
              <div className="activity-cell"><span><Star size={15} fill="currentColor" />{formatStars(repo.stars)}</span><small>更新于 {formatDate(repo.updatedAt)}</small></div>
              <div className="install-cell">
                {progress ? (
                  <div className={`install-progress ${progress.phase === 'error' ? 'error' : ''} ${indeterminate ? 'indeterminate' : ''}`}>
                    <div><LoaderCircle className="spin" size={14} /><span>{progress.message}</span><strong>{indeterminate ? '进行中' : `${progress.percent}%`}</strong></div>
                    <div className="progress-track" role="progressbar" aria-label={progress.message} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : progress.percent} aria-valuetext={indeterminate ? '正在进行' : undefined}><span style={indeterminate ? undefined : { width: `${progress.percent}%` }} /></div>
                  </div>
                ) : installed ? (
                  <div className="installed-actions">
                    <span className="installed-label"><Check size={16} />{analysis && analysis.targets.length > 1 ? `已安装 ${installedTargetCount}/${analysis.targets.length}` : '已安装'}</span>
                    <button type="button" className="install-button update-button" disabled={actionDisabled} onClick={runAction} title={`更新 ${target?.name ?? repo.name}`}><RefreshCw size={15} />更新</button>
                  </div>
                ) : (
                  <button type="button" className="install-button" disabled={actionDisabled} onClick={runAction}>
                    {isChecking || installing === repo.fullName ? <LoaderCircle className="spin" size={16} /> : analysis?.installability === 'invalid' ? <CircleAlert size={16} /> : <Download size={16} />}
                    {isChecking ? '检测中' : actionLabel}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </section>
      {targetDialog && (
        <SkillTargetDialog
          repo={targetDialog.repo}
          analysis={targetDialog.analysis}
          installedNames={installedNames}
          busy={installing !== null}
          onClose={() => setTargetDialog(null)}
          onInstall={target => void install(targetDialog.repo, target)}
        />
      )}
    </div>
  )
}

function SkillTargetDialog({ repo, analysis, installedNames, busy, onClose, onInstall }: {
  repo: SkillRepositoryResult
  analysis: SkillRepositoryAnalysis
  installedNames: Set<string>
  busy: boolean
  onClose: () => void
  onInstall: (target: SkillInstallTarget) => void
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !busy) onClose() }}>
      <section className="modal plugin-target-dialog skill-target-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-target-title">
        <header>
          <div><BookOpenCheck size={18} /><h2 id="skill-target-title">选择要安装的 Skill</h2></div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭"><X size={17} /></button>
        </header>
        <div className="modal-content">
          <p className="target-dialog-summary">{repo.fullName} 包含多个通过 DSH 格式检查的 Skills。安装会覆盖同名本地 Skill。</p>
          <div className="plugin-target-list">
            {analysis.targets.map(target => (
              <div className="plugin-target-row" key={target.id}>
                <div className="plugin-target-icon"><BookOpenCheck size={17} /></div>
                <div className="plugin-target-copy">
                  <strong>{target.name}</strong>
                  <span>{target.description}</span>
                  <small>{target.format === 'bundle' ? '目录 Skill' : '单文件 Skill'} · {target.sourcePath}{target.modelInvocable ? '' : ' · 不对模型开放'}</small>
                </div>
                <button type="button" className="install-button" disabled={busy} onClick={() => onInstall(target)}>{installedNames.has(target.name) ? <RefreshCw size={15} /> : <Download size={15} />}{installedNames.has(target.name) ? '更新' : '安装'}</button>
              </div>
            ))}
          </div>
        </div>
        <footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button></footer>
      </section>
    </div>
  )
}

function PluginTargetDialog({ repo, analysis, busy, onClose, onInstall }: {
  repo: RepositoryResult
  analysis: RepositoryAnalysis
  busy: boolean
  onClose: () => void
  onInstall: (target: PluginInstallTarget) => void
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !busy) onClose() }}>
      <section className="modal plugin-target-dialog" role="dialog" aria-modal="true" aria-labelledby="plugin-target-title">
        <header>
          <div><PackageCheck size={18} /><h2 id="plugin-target-title">选择插件组件</h2></div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭"><X size={17} /></button>
        </header>
        <div className="modal-content">
          <p className="target-dialog-summary">{repo.fullName} 包含多个可安装组件。每个组件会安装到它适用的 Profile。</p>
          <div className="plugin-target-list">
            {analysis.targets.map(target => (
              <div className="plugin-target-row" key={target.id}>
                <div className="plugin-target-icon">{target.platform === 'terminal' ? <SquareTerminal size={17} /> : <Box size={17} />}</div>
                <div className="plugin-target-copy">
                  <strong>{target.packageName}</strong>
                  <span>{target.source === 'npm' ? `npm ${target.version ?? ''}` : target.source === 'github' ? 'GitHub 仓库根目录' : `仓库子目录：${target.subdirectory}`}</span>
                  <small>{target.profileName} Profile{target.nodeRange ? ` · Node ${target.nodeRange}` : ''}{target.requiresBuild ? ` · 构建脚本：${target.buildScripts.join(', ')}` : ''}</small>
                </div>
                <button type="button" className="install-button" disabled={busy} onClick={() => onInstall(target)}><Download size={15} />安装</button>
              </div>
            ))}
          </div>
        </div>
        <footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button></footer>
      </section>
    </div>
  )
}

function RuntimeView({ runtime, settings, logs, busy, onToggleRuntime, onOpenHarness, onClearLogs, onOpenSettings }: {
  runtime: RuntimeState
  settings: AppSettings
  logs: RuntimeOutput[]
  busy: boolean
  onToggleRuntime: () => void
  onOpenHarness: () => void
  onClearLogs: () => void
  onOpenSettings: () => void
}) {
  const logEnd = useRef<HTMLDivElement>(null)
  useEffect(() => {
    logEnd.current?.scrollIntoView?.({ block: 'nearest' })
  }, [logs])
  return (
    <div className="page runtime-page">
      <PageHeading
        eyebrow="LOCAL RUNTIME"
        title="运行 DeepSeek Harness"
        description="从当前工作目录启动 Web 界面，并在这里查看进程状态与实时输出。"
        actions={<button type="button" className="secondary-button" onClick={onOpenSettings}><Settings size={16} />启动设置</button>}
      />
      <section className={`runtime-band ${runtime.running ? 'running' : ''}`}>
        <div className="runtime-status-icon">{runtime.running ? <CircleCheck size={25} /> : <CircleStop size={25} />}</div>
        <div className="runtime-copy"><span>{runtime.running ? 'DSH 正在运行' : 'DSH 当前已停止'}</span><strong>{runtime.running ? runtime.url ?? '正在等待 Web 地址…' : '准备从本地启动'}</strong></div>
        <div className="runtime-metadata"><span>配置 <strong>{settings.profileName}</strong></span><span>{runtime.pid ? `PID ${runtime.pid}` : '无活动进程'}</span></div>
        {runtime.url && <button type="button" className="secondary-button" onClick={onOpenHarness}>打开工作台<ExternalLink size={15} /></button>}
        <button type="button" className={`primary-command ${runtime.running ? 'stop' : ''}`} onClick={onToggleRuntime} disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={17} /> : runtime.running ? <CircleStop size={17} /> : <Play size={17} fill="currentColor" />}
          {runtime.running ? '停止' : '启动'}
        </button>
      </section>

      <div className="launch-facts">
        <div><span>启动命令</span><code>{settings.launchExecutable} {settings.launchArgs.join(' ')}</code></div>
        <div><span>工作目录</span><code>{settings.workspace}</code></div>
        <div><span>DSH_HOME</span><code>{settings.dshHome}</code></div>
      </div>

      <section className="log-panel">
        <header><div><SquareTerminal size={17} /><strong>运行日志</strong><span>{logs.length} 条</span></div><button type="button" onClick={onClearLogs} disabled={logs.length === 0}>清空</button></header>
        <div className="log-output" role="log" aria-live="polite">
          {logs.length === 0 ? (
            <div className="log-empty"><SquareTerminal size={22} /><span>启动 DSH 后，输出会显示在这里。</span></div>
          ) : logs.map((log, index) => (
            <div className={`log-line ${log.level}`} key={`${log.timestamp}-${index}`}>
              <time>{new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</time>
              <span className="log-channel">{log.channel === 'plugin' ? 'PLUGIN' : 'DSH'}</span>
              <pre>{log.text}</pre>
            </div>
          ))}
          <div ref={logEnd} />
        </div>
      </section>
    </div>
  )
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

function CredentialDialog({ status, busy, onClose, onSave, onClear }: {
  status: CredentialStatus
  busy: boolean
  onClose: () => void
  onSave: (apiKey: string) => void
  onClear: () => void
}) {
  const [apiKey, setApiKey] = useState('')
  const [visible, setVisible] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !busy) onClose() }}>
      <form
        className="modal credential-dialog"
        aria-modal="true"
        aria-labelledby="credential-title"
        role="dialog"
        onSubmit={event => {
          event.preventDefault()
          if (apiKey.trim() && !busy) onSave(apiKey)
        }}
      >
        <header>
          <div><KeyRound size={19} /><h2 id="credential-title">配置 DeepSeek API Key</h2></div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭 Key 配置"><X size={18} /></button>
        </header>
        <div className="modal-content">
          <div className={`credential-summary ${status.configured ? 'configured' : ''}`}>
            {status.configured ? <CircleCheck size={19} /> : <CircleAlert size={19} />}
            <div>
              <strong>{status.configured ? 'DeepSeek Key 已配置' : '尚未配置 DeepSeek Key'}</strong>
              <span>{status.configured ? '输入新 Key 可直接替换现有值。' : '保存后即可在 DeepSeek Harness 中调用模型。'}</span>
            </div>
          </div>
          <label className="credential-field">
            <span>API Key</span>
            <div className="secret-input">
              <input
                autoFocus
                autoComplete="off"
                type={visible ? 'text' : 'password'}
                value={apiKey}
                placeholder={status.configured ? '输入新的 Key 以替换' : '输入 DeepSeek API Key'}
                spellCheck={false}
                onChange={event => setApiKey(event.target.value)}
              />
              <button
                type="button"
                title={visible ? '隐藏 Key' : '显示 Key'}
                aria-label={visible ? '隐藏 Key' : '显示 Key'}
                onClick={() => setVisible(current => !current)}
              >
                {visible ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          <p className="credential-privacy">Key 仅写入当前 DSH_HOME 的本机凭据文件。启动器不会回显、记录或上传它。</p>
        </div>
        <footer>
          {status.configured && (
            <button
              type="button"
              className="danger-button clear-key"
              disabled={busy}
              onClick={() => confirmingClear ? onClear() : setConfirmingClear(true)}
            >
              <Trash2 size={16} />{confirmingClear ? '再次点击确认清除' : '清除 Key'}
            </button>
          )}
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" className="primary-command" disabled={busy || !apiKey.trim()}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
            {status.configured ? '替换 Key' : '保存 Key'}
          </button>
        </footer>
      </form>
    </div>
  )
}

function SettingsDialog({ settings, busy, onClose, onSave }: {
  settings: AppSettings
  busy: boolean
  onClose: () => void
  onSave: (settings: AppSettings) => void
}) {
  const [draft, setDraft] = useState(settings)
  const [argsText, setArgsText] = useState(settings.launchArgs.join(' '))
  const chooseDirectory = async (kind: 'dshInstallPath' | 'dshHome' | 'workspace') => {
    const chosen = await api.chooseDirectory(kind)
    if (chosen) setDraft(current => ({ ...current, [kind]: chosen }))
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose() }}>
      <section className="modal settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header><div><Settings size={19} /><h2 id="settings-title">启动器设置</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭设置"><X size={18} /></button></header>
        <div className="modal-content">
          <div className="form-section"><h3>DSH 配置</h3><p>本体目录存放 DSH 程序与依赖；DSH_HOME 存放 Profile、配置、插件和 Skills。</p></div>
          <label className="form-field"><span>本体安装目录</span><div className="path-input"><input value={draft.dshInstallPath} onChange={event => setDraft({ ...draft, dshInstallPath: event.target.value })} /><button type="button" onClick={() => void chooseDirectory('dshInstallPath')} title="选择 DSH 本体安装目录"><Folder size={17} /></button></div></label>
          <label className="form-field"><span>DSH_HOME</span><div className="path-input"><input value={draft.dshHome} onChange={event => setDraft({ ...draft, dshHome: event.target.value })} /><button type="button" onClick={() => void chooseDirectory('dshHome')} title="选择 DSH_HOME"><Folder size={17} /></button></div></label>
          <label className="form-field"><span>Profile 名称</span><input value={draft.profileName} onChange={event => setDraft({ ...draft, profileName: event.target.value })} /></label>
          <div className="form-section divided"><h3>启动命令</h3><p>默认使用官方 npm 包启动 Web 工作台。</p></div>
          <label className="form-field"><span>可执行文件</span><input value={draft.launchExecutable} onChange={event => setDraft({ ...draft, launchExecutable: event.target.value })} /></label>
          <label className="form-field"><span>参数</span><input value={argsText} onChange={event => setArgsText(event.target.value)} /></label>
          <label className="form-field"><span>工作目录</span><div className="path-input"><input value={draft.workspace} onChange={event => setDraft({ ...draft, workspace: event.target.value })} /><button type="button" onClick={() => void chooseDirectory('workspace')} title="选择工作目录"><Folder size={17} /></button></div></label>
          <label className="check-field"><input type="checkbox" checked={draft.openAfterLaunch} onChange={event => setDraft({ ...draft, openAfterLaunch: event.target.checked })} /><span><strong>启动后打开 Harness</strong><small>识别到本地 Web 地址时，在默认浏览器中打开。</small></span></label>
        </div>
        <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="button" className="primary-command" disabled={busy} onClick={() => onSave({ ...draft, launchArgs: argsText.trim().split(/\s+/).filter(Boolean) })}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}保存设置</button></footer>
      </section>
    </div>
  )
}

function ConfirmDialog({ plugin, onCancel, onConfirm }: { plugin: ManagedPlugin; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-icon"><Trash2 size={22} /></div>
        <h2 id="confirm-title">卸载 {plugin.displayName}？</h2>
        <p>这会让官方 DSH CLI 从 <strong>web</strong> profile 中移除此依赖。仓库与其他 profile 不受影响。</p>
        <footer><button type="button" className="secondary-button" onClick={onCancel}>取消</button><button type="button" className="danger-button" onClick={onConfirm}><Trash2 size={16} />确认卸载</button></footer>
      </section>
    </div>
  )
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  return (
    <div className={`toast ${toast.kind}`} role="status">
      {toast.kind === 'success' ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="关闭提示"><X size={15} /></button>
    </div>
  )
}
