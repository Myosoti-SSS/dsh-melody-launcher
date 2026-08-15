import { Check, CircleAlert, CircleCheck, Eye, EyeOff, KeyRound, LoaderCircle, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { CredentialStatus } from '../../types'

/** DeepSeek API Key 的配置与清除。Key 只向下写入，不回显。 */

interface CredentialDialogProps {
  status: CredentialStatus
  busy: boolean
  onClose: () => void
  onSave: (apiKey: string) => void
  onClear: () => void
}

export function CredentialDialog({ status, busy, onClose, onSave, onClear }: CredentialDialogProps) {
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
