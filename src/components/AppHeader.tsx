import { ArrowLeft, ChevronRight, CircleStop, Download, KeyRound, Layers3, LoaderCircle, Play, Settings, X } from 'lucide-react'
import type { CredentialStatus, RuntimeState } from '../types'

/** 管理界面顶栏：品牌、当前配置与运行状态、全局动作。 */

interface AppHeaderProps {
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
}

export function AppHeader({
  runtime,
  busy,
  dshInstalled,
  installingDsh,
  profileName,
  credentialStatus,
  onBack,
  onCredential,
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
