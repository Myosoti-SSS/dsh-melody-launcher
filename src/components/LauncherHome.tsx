import { Box, CircleStop, Download, ExternalLink, KeyRound, LoaderCircle, Play, RefreshCw, Settings, X } from 'lucide-react'
import packageMetadata from '../../package.json'
import type { AppSettings, DshInstallationStatus, DshUpdateStatus, InstallProgress, ProfileState, RuntimeState } from '../types'

/** 启动页：无边框小窗口，只暴露最少的几个动作。 */

interface LauncherHomeProps {
  settings: AppSettings
  profile: ProfileState
  runtime: RuntimeState
  dshInstallation: DshInstallationStatus
  dshUpdate: DshUpdateStatus | null
  installProgress: InstallProgress | null
  busy: boolean
  installingDsh: boolean
  onCredential: () => void
  onManage: () => void
  onToggleRuntime: () => void
  onUpdateDsh: () => void
  onOpenHarness: () => void
  onClose: () => void
}

export function LauncherHome({
  settings,
  profile,
  runtime,
  dshInstallation,
  dshUpdate,
  installProgress,
  busy,
  installingDsh,
  onCredential,
  onManage,
  onToggleRuntime,
  onUpdateDsh,
  onOpenHarness,
  onClose,
}: LauncherHomeProps) {
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
          {dshUpdate?.state === 'update-available' && (
            <div className="launcher-update-notice" role="status">
              <RefreshCw size={14} />
              <span><strong>发现新版本 {dshUpdate.remoteVersion}</strong><small>本地 {dshUpdate.localVersion}，可以更新</small></span>
              <button type="button" onClick={onUpdateDsh} disabled={busy} title="更新 DSH">更新</button>
            </div>
          )}
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
