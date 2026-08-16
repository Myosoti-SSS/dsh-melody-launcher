import { useCallback, useEffect, useRef, useState } from 'react'
import { useLauncherApi } from '../api/client'
import type { AiApprovalRequest, AiInstallStatus } from '../types'
import { useAsyncAction } from './use-async-action'
import type { ToastState } from './use-toast'

/** AI 尝试安装对话框里的一条日志。 */
export interface AiInstallLogEntry {
  id: number
  kind: 'log' | 'auto-approved' | 'error'
  text: string
  stream?: boolean
}

/** 对话框关闭后的初始状态。 */
const IDLE_STATUS: AiInstallStatus = {
  phase: 'idle',
  repository: null,
  startedAt: null,
  sessionId: null,
  message: '',
}

/**
 * AI 尝试安装的渲染层状态机。
 *
 * 任务事件是流式的（log / snapshot / approval / done…），单 Promise 的 useAsyncAction
 * 装不下；这里自己订阅 onAiInstallEvent，只有 rollback 这种一次性动作走 useAsyncAction。
 *
 * 主进程侧 ai.install 一直运行到任务彻底结束才 resolve，因此对话框的打开由
 * 乐观置为 preparing 触发，随后的阶段全靠事件驱动。
 */
export function useAiInstall(onSettled: () => void, showToast: (toast: ToastState) => void) {
  const api = useLauncherApi()
  const { busy, run } = useAsyncAction(showToast)

  const [status, setStatus] = useState<AiInstallStatus>(IDLE_STATUS)
  const [logs, setLogs] = useState<AiInstallLogEntry[]>([])
  const [pendingApproval, setPendingApproval] = useState<AiApprovalRequest | null>(null)
  const [hasSnapshot, setHasSnapshot] = useState(false)
  const [snapshotId, setSnapshotId] = useState<string | null>(null)

  /** 最新 phase，供 start 的收尾判断避开闭包里的过期值。 */
  const statusRef = useRef(status)
  statusRef.current = status
  const settledRef = useRef(onSettled)
  settledRef.current = onSettled
  const nextLogId = useRef(0)

  const appendLog = useCallback((kind: AiInstallLogEntry['kind'], text: string, stream = false) => {
    nextLogId.current += 1
    setLogs(current => {
      const previous = current.at(-1)
      if (kind === 'log' && previous?.kind === 'log') {
        const separator = stream && previous.stream ? '' : '\n\n'
        return [
          ...current.slice(0, -1),
          { ...previous, text: `${previous.text}${separator}${text}`, stream },
        ]
      }
      return [...current, { id: nextLogId.current, kind, text, stream }]
    })
  }, [])

  /** 渲染层刷新后主进程可能仍在跑任务，进入时同步一次状态。 */
  useEffect(() => {
    void Promise.all([api.aiStatus(), api.aiHasSnapshot()])
      .then(([nextStatus, nextHasSnapshot]) => {
        setStatus(nextStatus)
        setHasSnapshot(nextHasSnapshot)
      })
      .catch(() => { /* 状态未就绪可忽略 */ })
  }, [api])

  useEffect(() => {
    const unsubscribe = api.onAiInstallEvent(event => {
      switch (event.kind) {
        case 'status':
          setStatus(event.status)
          break
        case 'log':
          appendLog('log', event.text, event.stream)
          break
        case 'auto-approved':
          appendLog('auto-approved', `${event.toolName}：${event.reason}`)
          break
        case 'approval':
          setPendingApproval(event.request)
          break
        case 'snapshot':
          setSnapshotId(event.snapshotId)
          setHasSnapshot(true)
          appendLog('log', '已生成配置快照，改动可一键还原。')
          break
        case 'done':
        case 'cancelled':
        case 'error':
          setPendingApproval(null)
          setStatus(current => ({ ...current, phase: event.kind, message: event.message }))
          appendLog(event.kind === 'error' ? 'error' : 'log', event.message)
          settledRef.current()
          break
      }
    })
    return unsubscribe
  }, [api, appendLog])

  const start = useCallback(async (repository: string, defaultBranch: string): Promise<boolean> => {
    setLogs([])
    setPendingApproval(null)
    setSnapshotId(null)
    setHasSnapshot(false)
    // 乐观打开对话框；真正的阶段变化由事件驱动。
    setStatus({ phase: 'preparing', repository, startedAt: new Date().toISOString(), sessionId: null, message: '准备中…' })
    const result = await api.aiInstall({ repository, defaultBranch })
    if (!result.ok && statusRef.current.phase === 'preparing') {
      // 前置失败（互斥 / 缺 Key / 未安装 DSH 等）：主进程只返回结果不推事件，这里补上展示。
      setStatus(current => ({ ...current, phase: 'error', message: result.message }))
      appendLog('error', result.message)
    }
    return result.ok
  }, [api, appendLog])

  const approve = useCallback((requestId: string, allow: boolean) => {
    setPendingApproval(null)
    void api.aiApprove(requestId, allow)
  }, [api])

  const cancel = useCallback(() => {
    void api.aiCancel()
  }, [api])

  const rollback = useCallback(async () => {
    const result = await run('ai-rollback', () => api.aiRollback())
    if (result) appendLog('log', `已还原 profile「${result.profileName}」（${result.restored} 个文件）。`)
    return result
  }, [api, appendLog, run])

  const reset = useCallback(() => {
    setLogs([])
    setPendingApproval(null)
    setSnapshotId(null)
    setHasSnapshot(false)
    setStatus(IDLE_STATUS)
  }, [])

  const active = status.phase === 'preparing' || status.phase === 'running'
  const settled = status.phase === 'done' || status.phase === 'cancelled' || status.phase === 'error'

  return {
    status,
    logs,
    pendingApproval,
    hasSnapshot,
    snapshotId,
    busy,
    active,
    settled,
    start,
    approve,
    cancel,
    rollback,
    reset,
  }
}

export type AiInstallState = ReturnType<typeof useAiInstall>
