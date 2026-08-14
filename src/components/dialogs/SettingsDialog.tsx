import { Check, Folder, LoaderCircle, Settings, X } from 'lucide-react'
import { useState } from 'react'
import { useLauncherApi } from '../../api/client'
import type { AppSettings } from '../../types'

/** 启动器设置：DSH_HOME、Profile、启动命令与工作目录。 */

interface SettingsDialogProps {
  settings: AppSettings
  busy: boolean
  onClose: () => void
  onSave: (settings: AppSettings) => void
}

export function SettingsDialog({ settings, busy, onClose, onSave }: SettingsDialogProps) {
  const api = useLauncherApi()
  const [draft, setDraft] = useState(settings)
  // 参数在界面上是一整行文本，保存时才切成数组。
  const [argsText, setArgsText] = useState(settings.launchArgs.join(' '))

  const chooseDirectory = async (kind: 'dshHome' | 'workspace') => {
    const chosen = await api.chooseDirectory(kind)
    if (chosen) setDraft(current => ({ ...current, [kind]: chosen }))
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose() }}>
      <section className="modal settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header><div><Settings size={19} /><h2 id="settings-title">启动器设置</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭设置"><X size={18} /></button></header>
        <div className="modal-content">
          <div className="form-section"><h3>DSH 配置</h3><p>启动器直接读取官方 profile，修改后请刷新插件列表。</p></div>
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
