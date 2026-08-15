import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, SessionEventPayload, SessionMeta, ToolStepInfo } from './types'

function messageKey(turn: number, step: number, role: string) {
  return `${role}-${turn}-${step}`
}

/** 把会话事件流折叠成 Aurora 消息模型（user/assistant + 工具步骤） */
export function foldEvents(events: SessionEventPayload[]): ChatMessage[] {
  const msgs: ChatMessage[] = []
  const index = new Map<string, number>()
  let current: ChatMessage | null = null

  const ensureAssistant = (turn: number, step: number): ChatMessage => {
    const key = messageKey(turn, step, 'assistant')
    let idx = index.get(key)
    if (idx === undefined) {
      const m: ChatMessage = {
        id: key,
        role: 'assistant',
        content: '',
        reasoning: '',
        status: 'streaming',
        toolSteps: [],
        turn,
        step,
      }
      msgs.push(m)
      idx = msgs.length - 1
      index.set(key, idx)
      current = m
    } else {
      current = msgs[idx]
    }
    return current
  }

  for (const ev of events) {
    switch (ev.type) {
      case 'user/message': {
        msgs.push({
          id: `user-${ev.seq}`,
          role: 'user',
          content: String(ev.data.content ?? ''),
          reasoning: '',
          status: 'done',
          toolSteps: [],
          turn: (ev.data.turn as number) ?? 0,
          step: 0,
        })
        break
      }
      case 'assistant/chunk': {
        const m = ensureAssistant(ev.data.turn as number, ev.data.step as number)
        const chunk = ev.data.chunk as { content?: string; reasoning?: string } | undefined
        m.content += chunk?.content ?? ''
        m.reasoning += chunk?.reasoning ?? ''
        break
      }
      case 'assistant/message': {
        const m = ensureAssistant(ev.data.turn as number, ev.data.step as number)
        m.status = 'done'
        const usage = ev.data.usage as { inputTokens?: number; outputTokens?: number } | undefined
        if (usage) m.usage = usage
        break
      }
      case 'tool/call': {
        const m = ensureAssistant(ev.data.turn as number, ev.data.step as number)
        const step: ToolStepInfo = {
          id: String(ev.data.callId ?? `${ev.seq}`),
          name: String(ev.data.name ?? 'tool'),
          status: 'running',
          args: ev.data.arguments,
        }
        m.toolSteps = [...m.toolSteps, step]
        break
      }
      case 'tool/result': {
        const m = ensureAssistant(ev.data.turn as number, ev.data.step as number)
        const resultMsg = ev.data.message as { callId?: string; content?: unknown } | undefined
        const callId = String(resultMsg?.callId ?? '')
        m.toolSteps = m.toolSteps.map((s) =>
          s.id === callId
            ? {
                ...s,
                status: ev.data.error ? 'error' : 'done',
                result:
                  typeof resultMsg?.content === 'string'
                    ? (resultMsg.content as string)
                    : JSON.stringify(resultMsg?.content),
                error: ev.data.error ? `${ev.data.error.name}: ${ev.data.error.code}` : undefined,
              }
            : s,
        )
        break
      }
      case 'turn/end': {
        const reason = ev.data.reason as { kind?: string; error?: { message?: string } } | undefined
        if (current && current.status === 'streaming') {
          if (reason?.kind === 'error') {
            current.status = 'error'
            current.error = reason.error?.message ?? 'unknown error'
          } else {
            current.status = 'done'
          }
        }
        break
      }
      default:
        break
    }
  }
  return msgs
}

export interface UseChatResult {
  sessions: SessionMeta[]
  sessionId: string | null
  messages: ChatMessage[]
  streaming: boolean
  ready: boolean
  refreshSessions: () => Promise<void>
  openSession: (id: string) => Promise<void>
  newChat: () => void
  send: (text: string) => Promise<void>
  stop: () => void
}

export function useChat(): UseChatResult {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [rawEvents, setRawEvents] = useState<SessionEventPayload[]>([])
  const [streaming, setStreaming] = useState(false)
  const [ready, setReady] = useState(false)
  const sessionRef = useRef<string | null>(null)
  sessionRef.current = sessionId

  const messages = useMemo(() => foldEvents(rawEvents), [rawEvents])

  const refreshSessions = useCallback(async () => {
    try {
      const list = await window.aurora.sessions.list()
      setSessions(list)
    } catch (err) {
      console.error('sessions:list failed', err)
    }
  }, [])

  // 事件流订阅（全局，按会话过滤）
  useEffect(() => {
    const off = window.aurora.chat.onEvent(({ sessionId: sid, event }) => {
      if (sessionRef.current !== sid) return
      setRawEvents((prev) => [...prev, event])
      if (event.type === 'turn/end') setStreaming(false)
    })
    void refreshSessions().then(() => setReady(true))
    return off
  }, [refreshSessions])

  const openSession = useCallback(async (id: string) => {
    setSessionId(id)
    setRawEvents([])
    setStreaming(false)
    try {
      const { events } = await window.aurora.sessions.open(id)
      setRawEvents(events)
    } catch (err) {
      console.error('sessions:open failed', err)
    }
  }, [])

  const newChat = useCallback(() => {
    setSessionId(null)
    setRawEvents([])
    setStreaming(false)
  }, [])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      let sid = sessionRef.current
      if (!sid) {
        sid = `aurora-${crypto.randomUUID()}`
        setSessionId(sid)
        sessionRef.current = sid
      }
      setStreaming(true)
      try {
        await window.aurora.chat.send(sid, trimmed)
      } catch (err) {
        console.error('chat:send failed', err)
        setStreaming(false)
      }
      void refreshSessions()
    },
    [refreshSessions],
  )

  const stop = useCallback(() => {
    if (sessionRef.current) window.aurora.chat.stop(sessionRef.current)
    setStreaming(false)
  }, [])

  return { sessions, sessionId, messages, streaming, ready, refreshSessions, openSession, newChat, send, stop }
}
