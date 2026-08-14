import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatUsage, ModelConfig } from './ipc'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning: string
  status: 'streaming' | 'done' | 'error'
  error?: string
  usage?: ChatUsage
}

let smokeAutoStarted = false
let smokeNotified = false

export interface ChatController {
  messages: ChatMessage[]
  models: ModelConfig[]
  modelId: string
  setModelId: (id: string) => void
  streamingId: string | null
  send: (text: string) => void
  stop: () => void
  clear: () => void
}

export function useChat(): ChatController {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [models, setModels] = useState<ModelConfig[]>([])
  const [modelId, setModelIdState] = useState('')
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const streamingRef = useRef<string | null>(null)

  // 订阅聊天事件
  useEffect(() => {
    const offs = [
      window.aurora.chat.onDelta(({ requestId, content, reasoning }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === requestId
              ? {
                  ...m,
                  content: m.content + (content ?? ''),
                  reasoning: m.reasoning + (reasoning ?? ''),
                }
              : m,
          ),
        )
      }),
      window.aurora.chat.onDone(({ requestId }) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === requestId ? { ...m, status: 'done' } : m)),
        )
        if (streamingRef.current === requestId) {
          streamingRef.current = null
          setStreamingId(null)
          if (window.aurora.smoke && !smokeNotified) {
            smokeNotified = true
            window.aurora.smokeNotifyChatDone()
          }
        }
      }),
      window.aurora.chat.onError(({ requestId, message, aborted }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === requestId
              ? {
                  ...m,
                  status: aborted ? 'done' : 'error',
                  error: aborted ? undefined : message,
                }
              : m,
          ),
        )
        if (streamingRef.current === requestId) {
          streamingRef.current = null
          setStreamingId(null)
        }
      }),
      window.aurora.chat.onUsage(({ requestId, usage }) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === requestId ? { ...m, usage } : m)),
        )
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // 加载模型列表
  useEffect(() => {
    void window.aurora.models.list().then((list) => {
      setModels(list)
      setModelIdState((prev) => prev || list.find((m) => m.enabled)?.id || '')
    })
  }, [])

  const send = useCallback(
    (text: string, forceModelId?: string) => {
      if (streamingRef.current) return
      const mid = forceModelId ?? modelId
      const trimmed = text.trim()
      if (!trimmed || !mid) return
      const requestId = crypto.randomUUID()
      const apiMessages = messages
        .filter((m) => m.status !== 'error' && m.content !== '')
        .map((m) => ({ role: m.role, content: m.content }))
      apiMessages.push({ role: 'user', content: trimmed })

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: trimmed,
        reasoning: '',
        status: 'done',
      }
      const asstMsg: ChatMessage = {
        id: requestId,
        role: 'assistant',
        content: '',
        reasoning: '',
        status: 'streaming',
      }
      setMessages((prev) => [...prev, userMsg, asstMsg])
      streamingRef.current = requestId
      setStreamingId(requestId)
      window.aurora.chat.start({
        requestId,
        modelId: mid,
        messages: apiMessages,
      })
    },
    [messages, modelId],
  )

  // 冒烟模式：模型加载后自动发起 Mock 对话
  useEffect(() => {
    if (!window.aurora.smoke || smokeAutoStarted || models.length === 0) return
    smokeAutoStarted = true
    const mock = models.find((m) => m.provider === 'mock')
    if (mock) {
      const t = setTimeout(() => {
        send('冒烟测试：请演示一个包含代码、公式和列表的综合示例', mock.id)
      }, 250)
      return () => clearTimeout(t)
    }
  }, [models, send])

  const stop = useCallback(() => {
    const id = streamingRef.current
    if (id) window.aurora.chat.stop(id)
  }, [])

  const clear = useCallback(() => {
    setMessages([])
  }, [])

  const setModelId = useCallback((id: string) => setModelIdState(id), [])

  return { messages, models, modelId, setModelId, streamingId, send, stop, clear }
}
