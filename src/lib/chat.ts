import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatUsage, ModelConfig, PickedFile, ToolStep } from './ipc'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning: string
  status: 'streaming' | 'done' | 'error'
  error?: string
  usage?: ChatUsage
  durationMs?: number
  firstTokenMs?: number
  toolSteps?: ToolStep[]
}

let smokeAutoStarted = false
let smokeNotified = false

export interface ChatController {
  messages: ChatMessage[]
  models: ModelConfig[]
  modelId: string
  setModelId: (id: string) => void
  reloadModels: () => Promise<void>
  streamingId: string | null
  send: (text: string, forceModelId?: string, attachments?: PickedFile[]) => void
  stop: () => void
  loadConversation: (conversationId: string) => Promise<void>
  clear: () => void
  editMessage: (messageId: string, newText: string) => void
  regenerate: (assistantId: string) => void
}

export interface UseChatOptions {
  /** 当前会话 id；为空表示"新对话"（首条消息时创建） */
  conversationId: string | null
  /** 首条消息前确保会话存在，返回会话 id */
  onEnsureConversation: (title: string) => Promise<string>
  /** 会话活动（发送/完成）时通知上层刷新列表 */
  onActivity: () => void
}

export function truncateTitle(text: string, max = 24): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) : t
}

function smokeLog(op: string, extra?: unknown): void {
  if (!window.aurora.smoke) return
  const w = window as unknown as { __smokeMsgOps?: unknown[] }
  w.__smokeMsgOps = [...(w.__smokeMsgOps ?? []), { t: Date.now(), op, ...(extra as object) }]
}

export function useChat(opts: UseChatOptions): ChatController {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [models, setModels] = useState<ModelConfig[]>([])
  const [modelId, setModelIdState] = useState('')
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const streamingRef = useRef<string | null>(null)
  const convIdRef = useRef<string | null>(opts.conversationId)
  convIdRef.current = opts.conversationId
  const flushTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const optsRef = useRef(opts)
  optsRef.current = opts
  /** 加载代际：并发/过期 load 结果直接丢弃，避免覆盖 send 刚追加的消息 */
  const loadGenRef = useRef(0)

  const flushMessage = useCallback((m: ChatMessage) => {
    const t = flushTimers.current.get(m.id)
    if (t) clearTimeout(t)
    flushTimers.current.delete(m.id)
    const convId = convIdRef.current
    if (!convId) return
    void window.aurora.conversations.messages.upsert({
      id: m.id,
      conversationId: convId,
      role: m.role,
      content: m.content,
      reasoning: m.reasoning,
      status: m.status,
      error: m.error,
      usage: m.usage,
      durationMs: m.durationMs,
      firstTokenMs: m.firstTokenMs,
      toolSteps: m.toolSteps,
      createdAt: Date.now(),
    })
  }, [])

  const scheduleFlush = useCallback(
    (m: ChatMessage) => {
      const t = flushTimers.current.get(m.id)
      if (t) clearTimeout(t)
      flushTimers.current.set(
        m.id,
        setTimeout(() => {
          flushTimers.current.delete(m.id)
          // 取最新状态再落库
          setMessages((prev) => {
            const cur = prev.find((x) => x.id === m.id)
            if (cur) flushMessage(cur)
            return prev
          })
        }, 300),
      )
    },
    [flushMessage],
  )

  // 订阅聊天事件（全局，不随会话切换卸载）
  useEffect(() => {
    const offs = [
      window.aurora.chat.onDelta(({ requestId, content, reasoning }) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === requestId)
          if (idx < 0) return prev
          const next = [...prev]
          next[idx] = {
            ...next[idx],
            content: next[idx].content + (content ?? ''),
            reasoning: next[idx].reasoning + (reasoning ?? ''),
          }
          scheduleFlush(next[idx])
          return next
        })
      }),
      window.aurora.chat.onDone(({ requestId, durationMs, firstTokenMs }) => {
        smokeLog('evt-done', { id: requestId.slice(0, 6) })
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === requestId)
          if (idx < 0) return prev
          const next = [...prev]
          next[idx] = {
            ...next[idx],
            // 错误场景：error 事件先于 done 到达，保持 error 状态
            status: next[idx].status === 'error' ? 'error' : 'done',
            durationMs,
            firstTokenMs,
          }
          flushMessage(next[idx])
          return next
        })
        if (streamingRef.current === requestId) {
          streamingRef.current = null
          setStreamingId(null)
          optsRef.current.onActivity()
          if (window.aurora.smoke && !smokeNotified) {
            smokeNotified = true
            window.aurora.smokeNotifyChatDone()
          }
        }
      }),
      window.aurora.chat.onError(({ requestId, message, aborted }) => {
        smokeLog('evt-error', {
          id: requestId.slice(0, 6),
          msg: message.slice(0, 24),
          aborted,
        })
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === requestId)
          if (idx < 0) return prev
          const next = [...prev]
          next[idx] = {
            ...next[idx],
            status: aborted ? 'done' : 'error',
            error: aborted ? undefined : message,
          }
          flushMessage(next[idx])
          return next
        })
        if (streamingRef.current === requestId) {
          streamingRef.current = null
          setStreamingId(null)
          optsRef.current.onActivity()
        }
      }),
      window.aurora.chat.onUsage(({ requestId, usage }) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === requestId ? { ...m, usage } : m)),
        )
      }),
      window.aurora.chat.onTool(({ requestId, step }) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === requestId)
          if (idx < 0) return prev
          const next = [...prev]
          const existing = next[idx].toolSteps ?? []
          const si = existing.findIndex((s) => s.id === step.id)
          const steps =
            si >= 0
              ? existing.map((s, i) => (i === si ? step : s))
              : [...existing, step]
          next[idx] = { ...next[idx], toolSteps: steps }
          scheduleFlush(next[idx])
          return next
        })
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [scheduleFlush, flushMessage])

  // 加载模型列表
  useEffect(() => {
    void window.aurora.models.list().then((list) => {
      setModels(list)
      setModelIdState((prev) => prev || list.find((m) => m.enabled)?.id || '')
    })
  }, [])

  const reloadModels = useCallback(async () => {
    const list = await window.aurora.models.list()
    setModels(list)
  }, [])

  const loadConversation = useCallback(
    async (conversationId: string) => {
      const gen = ++loadGenRef.current
      const rows = await window.aurora.conversations.messages.list(conversationId)
      if (gen !== loadGenRef.current) {
        smokeLog('load-discard', { n: rows.length })
        return
      }
      const msgs: ChatMessage[] = rows.map((r) => ({
        id: r.id,
        role: r.role === 'user' ? 'user' : 'assistant',
        content: r.content,
        reasoning: r.reasoning,
        // 重启后残留的 streaming 记录视为 done（无法续流）
        status: (r.status === 'error' ? 'error' : 'done') as ChatMessage['status'],
        error: r.error || undefined,
        usage: r.usageJson ? (JSON.parse(r.usageJson) as ChatUsage) : undefined,
        durationMs: r.durationMs || undefined,
        firstTokenMs: r.firstTokenMs || undefined,
        toolSteps: r.toolStepsJson
          ? (JSON.parse(r.toolStepsJson) as ToolStep[])
          : undefined,
      }))
      smokeLog('load', { n: msgs.length, ids: msgs.map((m) => m.id.slice(0, 6)) })
      setMessages(msgs)
    },
    [],
  )

  const send = useCallback(
    (
      text: string,
      forceModelId?: string,
      attachments?: PickedFile[],
      baseMessages?: ChatMessage[],
      skipUserAppend = false,
    ) => {
      if (streamingRef.current) return
      const mid = forceModelId ?? modelId
      const trimmed = text.trim()
      if (!trimmed || !mid) return
      const files = attachments ?? []
      const model = models.find((m) => m.id === mid)
      if (window.aurora.smoke) {
        const w = window as unknown as { __smokeSends?: string[] }
        w.__smokeSends = [...(w.__smokeSends ?? []), trimmed]
      }
      void (async () => {
        let convId = convIdRef.current
        if (!convId) {
          convId = await optsRef.current.onEnsureConversation(
            truncateTitle(trimmed),
          )
          convIdRef.current = convId
        }
        const requestId = crypto.randomUUID()
        const apiMessages = (baseMessages ?? messages)
          .filter((m) => m.status !== 'error' && m.content !== '')
          .map((m) => ({ role: m.role, content: m.content }))

        // 系统提示词注入：会话级优先，其次全局
        const convSys = convId
          ? ((await window.aurora.conversations.getSystemPrompt(convId)) ?? '')
          : ''
        const sysPrompt =
          convSys.trim() ||
          ((await window.aurora.settings.get('systemPrompt')) ?? '').trim()
        if (sysPrompt) {
          apiMessages.unshift({ role: 'system', content: sysPrompt })
        }

        // 本轮用户消息：文本 + 附件内容（文本内联 / 图片多模态）
        const textFiles = files.filter((f) => f.isText && f.content)
        const imageFiles = files.filter((f) => f.isImage && f.dataUrl)
        let userText = trimmed
        if (textFiles.length > 0) {
          userText +=
            '\n\n--- 附件内容 ---\n' +
            textFiles
              .map((f) => `《${f.name}》:\n${f.content!.slice(0, 50000)}`)
              .join('\n\n')
        }
        const displayText =
          files.length > 0
            ? trimmed + '\n\n' + files.map((f) => `📎 ${f.name}`).join('\n')
            : trimmed

        let userContent: string | unknown[]
        // 图片多模态：仅非 DeepSeek 官方端点（官方暂不支持视觉）
        if (imageFiles.length > 0 && model && model.provider !== 'deepseek') {
          userContent = [
            { type: 'text', text: userText },
            ...imageFiles.map((f) => ({
              type: 'image_url',
              image_url: { url: f.dataUrl },
            })),
          ]
        } else {
          userContent = userText
        }
        if (!skipUserAppend) {
          apiMessages.push({ role: 'user', content: userContent } as never)
        }

        const userMsg: ChatMessage | null = skipUserAppend
          ? null
          : {
              id: crypto.randomUUID(),
              role: 'user',
              content: displayText,
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
        // 先落库再启动流，切换会话也能恢复
        if (userMsg) {
          await window.aurora.conversations.messages.upsert({
            id: userMsg.id,
            conversationId: convId,
            role: 'user',
            content: userMsg.content,
            reasoning: '',
            status: 'done',
            createdAt: Date.now(),
          })
        }
        await window.aurora.conversations.messages.upsert({
          id: asstMsg.id,
          conversationId: convId,
          role: 'assistant',
          content: '',
          reasoning: '',
          status: 'streaming',
          createdAt: Date.now() + 1,
        })
        smokeLog('append', {
          ids: [userMsg?.id.slice(0, 6) ?? 'skip', asstMsg.id.slice(0, 6)],
          convId,
        })
        // 使在途的 load 失效（它们可能读到了不完整的落库状态）
        loadGenRef.current++
        setMessages((prev) =>
          userMsg ? [...prev, userMsg, asstMsg] : [...prev, asstMsg],
        )
        streamingRef.current = requestId
        setStreamingId(requestId)
        optsRef.current.onActivity()
        window.aurora.chat.start({
          requestId,
          modelId: mid,
          messages: apiMessages,
        })
      })()
    },
    [messages, modelId, models],
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

  /** 编辑某条用户消息：截断其后所有消息（分支），用新文本重发 */
  const editMessage = useCallback(
    (messageId: string, newText: string) => {
      if (streamingRef.current) return
      const trimmed = newText.trim()
      if (!trimmed) return
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx < 0) return
      const sliced = messages.slice(0, idx)
      const convId = convIdRef.current
      if (convId) {
        void window.aurora.conversations.messages.deleteFrom(convId, messageId)
      }
      setMessages(sliced)
      send(trimmed, undefined, undefined, sliced)
    },
    [messages, send],
  )

  /** 重新生成助手消息：截断该消息及其后，重发前一条用户消息 */
  const regenerate = useCallback(
    (assistantId: string) => {
      if (streamingRef.current) return
      const idx = messages.findIndex((m) => m.id === assistantId)
      if (idx < 0) return
      const sliced = messages.slice(0, idx)
      const lastUser = [...sliced].reverse().find((m) => m.role === 'user')
      if (!lastUser) return
      const convId = convIdRef.current
      if (convId) {
        void window.aurora.conversations.messages.deleteFrom(convId, assistantId)
      }
      setMessages(sliced)
      send(lastUser.content, undefined, undefined, sliced, true)
    },
    [messages, send],
  )

  const clear = useCallback(() => {
    setMessages([])
  }, [])

  const setModelId = useCallback((id: string) => setModelIdState(id), [])

  return {
    messages,
    models,
    modelId,
    setModelId,
    reloadModels,
    streamingId,
    send,
    stop,
    loadConversation,
    clear,
    editMessage,
    regenerate,
  }
}
