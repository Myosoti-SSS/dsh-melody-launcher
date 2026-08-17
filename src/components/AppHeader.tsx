import { AppWindow, ArrowLeft, ChevronRight, CircleStop, Download, GitFork, KeyRound, Layers3, LoaderCircle, Play, Settings, X } from 'lucide-react'
import type { CredentialStatus, GitHubAuthStatus, InstalledApplicationAddon, RuntimeState } from '../types'

/** 管理界面顶栏：品牌、当前配置与运行状态、全局动作。 */

interface AppHeaderProps {
  runtime: RuntimeState
  busy: boolean
  dshInstalled: boolean
  installingDsh: boolean
  profileName: string
  credentialStatus: CredentialStatus
  githubAuthStatus: GitHubAuthStatus
  activeRuntimeReplacement: InstalledApplicationAddon | null
  onBack: () => void
  onCredential: () => void
  onGitHubAccount: () => void
  onSettings: () => void
  onToggleRuntime: () => void
  onClose: () => void
}

export function AppHeader({
  runtime,
  busy,
  dshInstalled,
  installingDsh,
  profileName,
  credentialStatus,
  githubAuthStatus,
  activeRuntimeReplacement,
  onBack,
  onCredential,
  onGitHubAccount,
  onSettings,
  onToggleRuntime,
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
          {busy ? <LoaderCircle className="spin" size={18} /> : runtime.running ? <CircleStop size={18} /> : activeRuntimeReplacement ? <AppWindow size={18} /> : dshInstalled ? <Play size={18} fill="currentColor" /> : <Download size={18} />}
          <span>{runtime.running ? `停止 ${runtime.applicationAddonName ?? 'DSH'}` : installingDsh ? '安装中' : activeRuntimeReplacement ? `启动 ${activeRuntimeReplacement.name}` : dshInstalled ? '启动 DSH' : '安装 DSH'}</span>
        </button>
        <button className="manager-window-close" type="button" title="关闭" aria-label="关闭" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
    </header>
  )
}
