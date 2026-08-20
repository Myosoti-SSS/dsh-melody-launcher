import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLauncherApi } from '../api/client'
import type { AiSession, AiSessionCreateInput, AiSessionEvent } from '../types'

function replaceSession(current: AiSession[], next: AiSession): AiSession[] {
  const index = current.findIndex(item => item.id === next.id)
  if (index < 0) return [next, ...current]
  return current.map(item => item.id === next.id ? next : item)
}

export function useCopilotSessions() {
  const api = useLauncherApi()
  const [sessions, setSessions] = useState<AiSession[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    void api.listAiSessions().then(items => {
      if (!mounted) return
      setSessions(items)
      setSelectedId(current => current ?? items[0]?.id ?? null)
    }).finally(() => { if (mounted) setLoading(false) })
    const unsubscribe = api.onAiSessionEvent((event: AiSessionEvent) => {
      if (event.kind === 'session-created') {
        setSessions(current => replaceSession(current, event.session))
        setSelectedId(event.session.id)
      } else if (event.kind === 'session-updated') {
        setSessions(current => replaceSession(current, event.session))
      } else if (event.kind === 'message') {
        setSessions(current => current.map(session => {
          if (session.id !== event.sessionId) return session
          const index = session.messages.findIndex(message => message.id === event.message.id)
          const messages = index < 0
            ? [...session.messages, event.message]
            : session.messages.map(message => message.id === event.message.id ? event.message : message)
          return { ...session, messages, messageCount: messages.length, updatedAt: event.message.createdAt }
        }))
      } else if (event.kind === 'approval') {
        setSessions(current => current.map(session => session.id === event.sessionId ? { ...session, pendingApproval: event.request } : session))
      } else if (event.kind === 'snapshot') {
        setSessions(current => current.map(session => session.id === event.sessionId ? { ...session, hasSnapshot: true } : session))
      } else if (event.kind === 'deleted') {
        setSessions(current => current.filter(session => session.id !== event.sessionId))
        setSelectedId(current => current === event.sessionId ? null : current)
      }
    })
    return () => { mounted = false; unsubscribe() }
  }, [api])

  const selected = useMemo(() => sessions.find(session => session.id === selectedId) ?? sessions[0] ?? null, [sessions, selectedId])

  const create = useCallback(async (input?: AiSessionCreateInput) => {
    const session = await api.createAiSession(input)
    setSelectedId(session.id)
    return session
  }, [api])

  const send = useCallback(async (text: string) => {
    if (!selected) return null
    return api.sendAiSessionMessage(selected.id, text)
  }, [api, selected])

  const cancel = useCallback(() => selected ? api.cancelAiSession(selected.id) : Promise.resolve(), [api, selected])
  const approve = useCallback((requestId: string, allow: boolean) => selected ? api.approveAiSession(selected.id, requestId, allow) : Promise.resolve(false), [api, selected])
  const rollback = useCallback(() => selected ? api.rollbackAiSession(selected.id) : Promise.reject(new Error('没有选中的会话。')), [api, selected])
  const remove = useCallback(async (sessionId: string) => {
    await api.deleteAiSession(sessionId)
    setSelectedId(current => current === sessionId ? null : current)
  }, [api])

  return { sessions, selected, selectedId, setSelectedId, loading, create, send, cancel, approve, rollback, remove }
}

export type CopilotSessionState = ReturnType<typeof useCopilotSessions>
