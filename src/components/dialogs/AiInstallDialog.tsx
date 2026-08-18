import {
  Bot,
  CircleAlert,
  CircleCheck,
  History,
  LoaderCircle,
  OctagonX,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AiInstallLogEntry } from '../../hooks/use-ai-install'
import type { AiApprovalRequest, AiInstallStatus } from '../../types'

/** AI 尝试安装的实时对话框：日志滚动、审批卡片、快照还原。 */

interface AiInstallDialogProps {
  status: AiInstallStatus
  logs: AiInstallLogEntry[]
  pendingApproval: AiApprovalRequest | null
  hasSnapshot: boolean
  busy: boolean
  cancelling: boolean
  onApprove: (requestId: string, allow: boolean) => void
  onCancel: () => void
  onRollback: () => void
  onClose: () => void
}

const PHASE_LABEL: Record<AiInstallStatus['phase'], string> = {
  idle: '空闲',
  preparing: '准备中',
  running: '运行中',
  done: '已完成',
  cancelled: '已取消',
  error: '出错',
}

function MarkdownLog({ text }: { text: string }) {
  return <div className="ai-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>
}

export function AiInstallDialog({ status, logs, pendingApproval, hasSnapshot, busy, cancelling, onApprove, onCancel, onRollback, onClose }: AiInstallDialogProps) {
  const active = status.phase === 'preparing' || status.phase === 'running'
  const settled = status.phase === 'done' || status.phase === 'cancelled' || status.phase === 'error'
  const logEndRef = useRef<HTMLDivElement>(null)
  const title = status.taskKind === 'plugin-adaptation'
    ? 'DSH 安装适配'
    : status.taskKind === 'runtime-repair'
      ? 'DSH 启动修复'
      : 'AI 尝试安装'
  const activeDescription = status.taskKind === 'plugin-adaptation'
    ? 'Flash 模型会分析隔离试运行日志并尝试做最小适配；只读操作自动放行，有副作用的动作会请求你批准。'
    : status.taskKind === 'runtime-repair'
      ? 'Flash 模型会分析最近一次启动日志并尝试修复当前 Profile；只读操作自动放行，有副作用的动作会请求你批准。'
      : '让 DSH 的 AI 研究仓库并尝试安装：只读操作自动放行，有副作用的动作会请求你批准。'

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [logs])

  const closeOnBackdrop = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target && !active && !busy) onClose()
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={closeOnBackdrop}>
      <section className="modal ai-install-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-install-title">
        <header>
          <div><Bot size={19} /><h2 id="ai-install-title">{title}</h2></div>
          <div className="ai-header-actions">
            <span className={`ai-phase-badge ${status.phase}`}>{PHASE_LABEL[status.phase]}</span>
            <button type="button" className="icon-button" onClick={onClose} disabled={active || busy} aria-label="关闭 AI 安装">
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="modal-content ai-install-content">
          <p className="ai-install-subject">
            {status.subject ?? status.repository ?? '—'}
            {active && <small>{activeDescription}</small>}
          </p>
          <div className="ai-install-logs" role="log" aria-live="polite">
            {logs.length === 0 ? (
              <div className="ai-log-empty"><LoaderCircle className="spin" size={17} /><MarkdownLog text={status.message || '等待任务开始…'} /></div>
            ) : (
              logs.map(entry => (
                <div key={entry.id} className={`ai-log-entry ${entry.kind}`}>
                  {entry.kind === 'auto-approved' && <ShieldCheck size={13} />}
                  {entry.kind === 'error' && <CircleAlert size={13} />}
                  {entry.kind === 'log' || entry.kind === 'error'
                    ? <MarkdownLog text={entry.text} />
                    : <span>{entry.text}</span>}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>

          {pendingApproval && (
            <div className="ai-approval-card" role="alertdialog" aria-label="审批请求">
              <div className="ai-approval-head">
                <span>需要批准</span>
                <code>{pendingApproval.toolName}</code>
              </div>
              <pre className="ai-approval-args">{pendingApproval.args}</pre>
              <p>{pendingApproval.reason}</p>
              <div className="ai-approval-actions">
                <button type="button" className="danger-button" onClick={() => onApprove(pendingApproval.id, false)}>拒绝</button>
                <button type="button" className="primary-command" onClick={() => onApprove(pendingApproval.id, true)}>允许</button>
              </div>
            </div>
          )}
        </div>
        <footer>
          {active && (
            <button type="button" className="primary-command stop" onClick={onCancel} disabled={cancelling}>
              {cancelling ? <LoaderCircle className="spin" size={16} /> : <OctagonX size={16} />}
              {cancelling ? '正在停止' : '停止'}
            </button>
          )}
          {settled && (
            <>
              <button type="button" className="danger-button" disabled={!hasSnapshot || busy} onClick={onRollback}>
                {busy ? <LoaderCircle className="spin" size={16} /> : <History size={16} />}还原快照
              </button>
              <button type="button" className="primary-command" onClick={onClose}><CircleCheck size={16} />关闭</button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}
