import { Bot, Check, CircleCheck, CornerDownLeft, History, LoaderCircle, MessageSquarePlus, OctagonX, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AiApprovalRequest, AiSession, AiSessionPhase } from '../types'
import type { CopilotSessionState } from '../hooks/use-copilot-sessions'
import type { AiInstallState } from '../hooks/use-ai-install'

const PHASE_LABEL: Record<AiSessionPhase, string> = {
  idle: '空闲', queued: '排队中', preparing: '准备中', running: '运行中', done: '已完成', cancelled: '已取消', error: '出错', interrupted: '已中断',
}

function kindLabel(session: AiSession): string {
  if (session.kind === 'repository-install') return 'AI 尝试安装'
  if (session.kind === 'plugin-adaptation') return '插件安装适配'
  if (session.kind === 'runtime-repair') return 'DSH 启动修复'
  return 'Copilot 对话'
}

function Message({ role, text }: { role: string; text: string }) {
  return <div className={`copilot-message ${role}`}><span className="copilot-message-role">{role === 'user' ? '你' : role === 'tool' ? '系统' : 'DSH Copilot'}</span><div className="ai-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div></div>
}

interface DSHCopilotPanelProps {
  state: CopilotSessionState
  legacyAi: AiInstallState
  onLegacyApprove: (requestId: string, allow: boolean) => void
  onLegacyCancel: () => void
  onLegacyRollback: () => void
  open: boolean
  width: number
  onWidthChange: (width: number) => void
  onResizeStateChange?: (resizing: boolean) => void
}

export function DSHCopilotPanel({ state, legacyAi, onLegacyApprove, onLegacyCancel, onLegacyRollback, open, width, onWidthChange, onResizeStateChange }: DSHCopilotPanelProps) {
  const { sessions, selected, selectedId, setSelectedId, loading, create, send, cancel, approve, rollback, remove } = state
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingSubmission, setPendingSubmission] = useState<{ sessionId: string; text: string } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = width
    onResizeStateChange?.(true)
    const move = (moveEvent: PointerEvent) => onWidthChange(startWidth + startX - moveEvent.clientX)
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      onResizeStateChange?.(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }

  useEffect(() => {
    if (!loading && sessions.length === 0) void create()
  }, [create, loading, sessions.length])

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [selected?.messages.length, selected?.messages.at(-1)?.text])

  const legacyActive = legacyAi.active || legacyAi.settled
  const pending = selected?.pendingApproval ?? null
  const legacyPending = legacyActive && legacyAi.pendingApproval && (!selected || selected.kind !== 'chat') ? legacyAi.pendingApproval : null
  const activePending = pending ?? legacyPending
  const legacySession = Boolean(selected && selected.kind !== 'chat')
  const legacyTaskActive = legacySession && legacyAi.active
  const processing = selected ? ['queued', 'preparing', 'running'].includes(selected.phase) : false
  const pendingForSelected = pendingSubmission?.sessionId === selected?.id ? pendingSubmission : null
  const showResultFooter = selected ? ['done', 'error', 'cancelled'].includes(selected.phase) : false

  // 回答结束后自动提交用户在生成期间准备好的下一条消息。
  useEffect(() => {
    if (!pendingForSelected || !selected) return
    if (processing) return
    if (selected.phase !== 'done') {
      setPendingSubmission(null)
      return
    }
    const text = pendingForSelected.text
    setPendingSubmission(null)
    setDraft('')
    setBusy(true)
    void send(text).catch(() => {
      setDraft(current => current || text)
    }).finally(() => setBusy(false))
  }, [pendingForSelected, processing, selected, send])

  const submit = async (text = draft.trim()) => {
    if (!text || busy || !selected || processing || pendingForSelected) return
    setDraft('')
    setBusy(true)
    try { await send(text) } catch { setDraft(current => current || text) } finally { setBusy(false) }
  }

  const handleComposerAction = () => {
    if (!selected || pendingForSelected) return
    const text = draft.trim()
    if (!text) {
      if (processing || legacyTaskActive) handleCancel()
      return
    }
    if (legacySession) return
    if (processing) {
      setPendingSubmission({ sessionId: selected.id, text })
      return
    }
    void submit(text)
  }

  const handleApproval = (request: AiApprovalRequest, allow: boolean) => {
    if (legacyAi.pendingApproval?.id === request.id) onLegacyApprove(request.id, allow)
    else void approve(request.id, allow)
  }

  const handleCancel = () => {
    setPendingSubmission(null)
    if (legacyTaskActive) onLegacyCancel()
    else void cancel()
  }

  const handleRollback = () => {
    void rollback().catch(() => { if (legacySession) onLegacyRollback() })
  }

  const hasDraft = draft.trim().length > 0
  const canStop = processing || legacyTaskActive
  const composerButtonTitle = pendingForSelected
    ? '等待当前回答完成后提交'
    : hasDraft
      ? processing ? '当前回答完成后提交' : '提交'
      : canStop ? '停止当前回答' : '输入消息后提交'

  return (
    <aside className={`copilot-panel ${open ? 'open' : 'closed'}`} aria-label="DSH Copilot" aria-hidden={!open}>
      <div className="copilot-resize-handle" role="separator" aria-orientation="vertical" aria-label="调整 DSH Copilot 宽度" onPointerDown={beginResize} />
      <header className="copilot-header">
        <div className="copilot-header-brand"><Bot size={18} /><div><strong>DSH Copilot</strong></div></div>
        <div className="copilot-session-picker">
          <select aria-label="切换 Copilot 会话" value={selectedId ?? ''} onChange={event => setSelectedId(event.target.value)}>
            {sessions.length === 0 && <option value="">新对话</option>}
            {sessions.map(session => <option key={session.id} value={session.id}>{session.title} · {PHASE_LABEL[session.phase]}</option>)}
          </select>
          <button type="button" className="icon-button" title="新建会话" aria-label="新建会话" onClick={() => void create()}><MessageSquarePlus size={15} /></button>
          {selected && <button type="button" className="icon-button" title="清除会话" aria-label="清除会话" disabled={['queued', 'preparing', 'running'].includes(selected.phase)} onClick={() => void remove(selected.id)}><Trash2 size={14} /></button>}
        </div>
      </header>
      <div className="copilot-body">
        <section className="copilot-workspace">
          {selected ? (
            <>
              <div className="copilot-task-head">
                <div><strong>{selected.title}</strong><small>{selected.subject ?? kindLabel(selected)}</small></div>
                <div className="copilot-task-actions"><span className={`ai-phase-badge ${selected.phase}`}>{PHASE_LABEL[selected.phase]}</span><button type="button" className="icon-button" title="清除会话" aria-label="清除会话" disabled={['queued', 'preparing', 'running'].includes(selected.phase)} onClick={() => void remove(selected.id)}><Trash2 size={15} /></button></div>
              </div>
              {selected.queue.position !== null && <div className="copilot-queue-note">修改队列第 {selected.queue.position} 项，共 {selected.queue.total} 项{selected.queue.reason ? ` · ${selected.queue.reason}` : ''}</div>}
              <div className="copilot-messages" role="log" aria-live="polite">
                {selected.messages.length === 0 && <div className="copilot-empty"><Bot size={24} /><span>输入问题，让 DSH Copilot 分析当前 DSH 环境。</span></div>}
                {selected.messages.map(message => <Message key={message.id} role={message.role} text={message.text} />)}
                <div ref={endRef} />
              </div>
              {activePending && (
                <div className="ai-approval-card copilot-approval" role="alertdialog" aria-label="审批请求">
                  <div className="ai-approval-head"><span>需要批准</span><code>{activePending.toolName}</code></div>
                  <pre className="ai-approval-args">{activePending.args}</pre>
                  <p>{activePending.reason}</p>
                  <div className="ai-approval-actions"><button type="button" className="danger-button" onClick={() => handleApproval(activePending, false)}>拒绝</button><button type="button" className="primary-command" onClick={() => handleApproval(activePending, true)}><Check size={15} />允许</button></div>
                </div>
              )}
              <div className="copilot-composer"><div className="copilot-input-wrap"><textarea value={draft} placeholder={legacySession ? '该任务由原页面启动，完成后可新建对话。' : pendingForSelected ? '已准备提交，等待当前回答完成…' : processing ? '继续输入，提交将在当前回答完成后发送…' : '向 DSH Copilot 输入问题…'} disabled={legacySession || Boolean(pendingForSelected)} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); handleComposerAction() } }} /><button type="button" className={`copilot-send-button ${!hasDraft && canStop ? 'stop' : ''} ${pendingForSelected ? 'pending' : ''}`} title={composerButtonTitle} aria-label={composerButtonTitle} disabled={(legacySession && !legacyTaskActive) || pendingForSelected !== null || busy || (!hasDraft && !canStop)} onClick={handleComposerAction}>{pendingForSelected || busy ? <LoaderCircle size={15} className="spin" /> : !hasDraft && canStop ? <OctagonX size={15} /> : <CornerDownLeft size={15} />}</button></div></div>
              {showResultFooter && <footer className="copilot-footer">
                  <button type="button" className="danger-button" disabled={!selected.hasSnapshot} onClick={handleRollback}><History size={15} />还原快照</button><span className="copilot-footer-spacer" /><span className="copilot-complete"><CircleCheck size={14} />结果已保留</span>
                </footer>}
            </>
          ) : <div className="copilot-empty"><Bot size={24} /><span>正在准备 DSH Copilot…</span></div>}
        </section>
      </div>
    </aside>
  )
}
