import { AppWindow, ChevronRight, CircleStop, Download, Folder, GitFork, KeyRound, Layers3, LoaderCircle, Package, Play, X } from 'lucide-react'
import type { CredentialStatus, GitHubAuthStatus, InstalledApplicationAddon, LauncherUpdateStatus, PackStatus, RuntimeState } from '../types'

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
  showPackSwitcher: boolean
  packs: PackStatus[]
  activePackId: string | null | undefined
  packSwitcherDisabled: boolean
  profileActiveCount: number
  profileDisabledCount: number
  installedSkillCount: number
  profileDirectory: string
  onCredential: () => void
  onGitHubAccount: () => void
  onToggleRuntime: () => void
  onUpdate: () => void
  onPackChange: (packId: string) => void
  onOpenProfileDirectory: () => void
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
  showPackSwitcher,
  packs,
  activePackId,
  packSwitcherDisabled,
  profileActiveCount,
  profileDisabledCount,
  installedSkillCount,
  profileDirectory,
  onCredential,
  onGitHubAccount,
  onToggleRuntime,
  onUpdate,
  onPackChange,
  onOpenProfileDirectory,
  onClose,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="brand-block">
        {githubAuthStatus.authenticated && githubAuthStatus.avatarUrl
          ? <img className="brand-avatar" src={githubAuthStatus.avatarUrl} alt="" />
          : <div className="brand-mark"><Layers3 size={21} strokeWidth={2.2} /></div>}
        <div>
          <div className="brand-name">DSH Launcher</div>
          <div className="brand-subtitle">DeepSeek Harness 管理器</div>
        </div>
      </div>
      <div className="header-center">
        {showPackSwitcher ? (
          <div className="header-management-context">
            <label className="header-pack-switcher">
              <Package size={16} />
              <span>整合包</span>
              <select
                aria-label="切换整合包"
                value={activePackId ?? ''}
                disabled={packSwitcherDisabled}
                onChange={event => onPackChange(event.target.value)}
              >
                <option value="">默认配置</option>
                {packs.map(pack => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
              </select>
            </label>
            <div className="header-management-stats" aria-label="配置概况">
              <span><strong>{profileActiveCount}</strong> 激活</span>
              <span><strong>{profileDisabledCount}</strong> 停用</span>
              <span><strong>{installedSkillCount}</strong> Skill</span>
              <button type="button" onClick={onOpenProfileDirectory} title={profileDirectory} aria-label="打开配置目录"><Folder size={15} /></button>
            </div>
            <div className="header-runtime-status" title={runtime.running ? `${runtime.applicationAddonName ?? 'DSH'} 运行中 · PID ${runtime.pid}` : activeRuntimeReplacement ? `${activeRuntimeReplacement.name} 等待启动` : dshInstalled ? 'DSH 尚未启动' : 'DSH 尚未安装'}>
              <span className={`status-dot ${runtime.running ? 'running' : ''}`} />
              <span>{runtime.running ? '运行中' : activeRuntimeReplacement ? '等待启动' : dshInstalled ? '未启动' : '未安装'}</span>
            </div>
          </div>
        ) : (
          <div className="header-context">
            <span className="context-label">配置</span>
            <strong>{profileName}</strong>
            <ChevronRight size={14} />
            <span className={`status-dot ${runtime.running ? 'running' : ''}`} />
            <span>{runtime.running ? `${runtime.applicationAddonName ?? 'DSH'} 运行中 · PID ${runtime.pid}` : activeRuntimeReplacement ? `${activeRuntimeReplacement.name} 等待启动` : dshInstalled ? '尚未启动' : '尚未安装'}</span>
          </div>
        )}
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
