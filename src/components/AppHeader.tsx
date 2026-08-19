import { AppWindow, ArrowLeft, ChevronRight, CircleStop, Download, GitFork, KeyRound, Layers3, LoaderCircle, Maximize2, Minus, Play, Settings, X } from 'lucide-react'
import type { CredentialStatus, GitHubAuthStatus, InstalledApplicationAddon, LauncherUpdateStatus, RuntimeState } from '../types'

/** 管理界面顶栏：品牌、当前配置与运行状态、全局动作。 */

interface AppHeaderProps {
  runtime: RuntimeState
  busy: boolean
  dshInstalled: boolean
  installingDsh: boolean
  profileName: string
  credentialStatus: CredentialStatus
  customApiCount: number
  githubAuthStatus: GitHubAuthStatus
  activeRuntimeReplacement: InstalledApplicationAddon | null
  launcherUpdate: LauncherUpdateStatus | null
  onBack: () => void
  onCredential: () => void
  onGitHubAccount: () => void
  onSettings: () => void
  onToggleRuntime: () => void
  onUpdate: () => void
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

export function AppHeader({
  runtime,
  busy,
  dshInstalled,
  installingDsh,
  profileName,
  credentialStatus,
  customApiCount,
  githubAuthStatus,
  activeRuntimeReplacement,
  launcherUpdate,
  onBack,
  onCredential,
  onGitHubAccount,
  onSettings,
  onToggleRuntime,
  onUpdate,
  onMinimize,
  onToggleMaximize,
  onClose,
}: AppHeaderProps) {
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
        <span>{runtime.running ? `${runtime.applicationAddonName ?? 'DSH'} 运行中 · PID ${runtime.pid}` : activeRuntimeReplacement ? `${activeRuntimeReplacement.name} 等待启动` : dshInstalled ? '尚未启动' : '尚未安装'}</span>
      </div>
      <div className="header-actions">
        <button
          className={`github-account-button ${githubAuthStatus.authenticated ? 'configured' : ''}`}
          type="button"
          title={githubAuthStatus.authenticated ? `GitHub：${githubAuthStatus.login}` : '登录 GitHub'}
          onClick={onGitHubAccount}
        >
          <GitFork size={17} />
          <span>{githubAuthStatus.authenticated ? githubAuthStatus.login : 'GitHub'}</span>
          <span className="credential-state">{githubAuthStatus.authenticated ? '已登录' : '未登录'}</span>
        </button>
        <button
          className={`credential-button ${credentialStatus.configured || customApiCount > 0 ? 'configured' : ''}`}
          type="button"
          title="配置 DeepSeek 与自定义模型 API"
          onClick={onCredential}
        >
          <KeyRound size={17} />
          <span>API 配置</span>
          <span className="credential-state">{customApiCount > 0 ? `${customApiCount} 个自定义` : credentialStatus.configured ? '已配置' : '未配置'}</span>
        </button>
        {launcherUpdate && (launcherUpdate.state === 'update-available' || launcherUpdate.state === 'downloading' || launcherUpdate.state === 'downloaded') && (
          <button
            className={`launcher-update-button ${launcherUpdate.state === 'downloaded' ? 'ready' : ''}`}
            type="button"
            title={`发现新版本 ${launcherUpdate.remoteVersion ?? ''}`}
            onClick={onUpdate}
          >
            {launcherUpdate.state === 'downloading'
              ? <LoaderCircle className="spin" size={17} />
              : <Download size={17} />}
            <span>{launcherUpdate.state === 'downloaded' ? '立即更新' : `更新 v${launcherUpdate.remoteVersion ?? ''}`}</span>
          </button>
        )}
        <button className="icon-button" type="button" title="启动器设置" aria-label="启动器设置" onClick={onSettings}>
          <Settings size={19} />
        </button>
        <button className={`primary-command ${runtime.running ? 'stop' : ''}`} type="button" onClick={onToggleRuntime} disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={18} /> : runtime.running ? <CircleStop size={18} /> : activeRuntimeReplacement ? <AppWindow size={18} /> : dshInstalled ? <Play size={18} fill="currentColor" /> : <Download size={18} />}
          <span>{runtime.running ? `停止 ${runtime.applicationAddonName ?? 'DSH'}` : installingDsh ? '安装中' : activeRuntimeReplacement ? `启动 ${activeRuntimeReplacement.name}` : dshInstalled ? '启动 DSH' : '安装 DSH'}</span>
        </button>
        <button className="manager-window-button" type="button" title="最小化" aria-label="最小化" onClick={onMinimize}>
          <Minus size={17} />
        </button>
        <button className="manager-window-button" type="button" title="最大化或还原" aria-label="最大化或还原" onClick={onToggleMaximize}>
          <Maximize2 size={15} />
        </button>
        <button className="manager-window-close" type="button" title="关闭" aria-label="关闭" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
    </header>
  )
}
