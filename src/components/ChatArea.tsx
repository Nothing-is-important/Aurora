import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowUp,
  Brain,
  ChevronDown,
  Code2,
  FileText,
  Lightbulb,
  Paperclip,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import type { ChatController, ChatMessage } from '../lib/chat'
import type { PickedFile } from '../lib/ipc'
import { Markdown } from './Markdown'

const SUGGESTIONS = [
  { icon: Code2, text: '帮我写一个 Python 脚本' },
  { icon: Lightbulb, text: '解释一个复杂概念' },
  { icon: FileText, text: '总结一段长文本' },
  { icon: Sparkles, text: '头脑风暴新点子' },
]

function Cursor() {
  return (
    <span className="streaming-cursor ml-0.5 inline-block h-[1.05em] w-[7px] translate-y-[0.15em] rounded-[2px] bg-apple-blue" />
  )
}

function AssistantBubble({ m }: { m: ChatMessage }) {
  const reasoningActive = m.status === 'streaming' && m.content === ''
  return (
    <div className="glass-strong max-w-[86%] rounded-[22px] rounded-bl-md px-4 py-3 text-[14px] leading-relaxed text-black/80 shadow-soft dark:text-white/85">
      {m.reasoning !== '' && (
        <details
          data-reasoning
          open={reasoningActive}
          className="group/reasoning border-b border-black/[0.06] pb-2.5 dark:border-white/[0.08]"
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12px] font-medium text-black/50 outline-none [&::-webkit-details-marker]:hidden dark:text-white/50">
            <Brain size={13} strokeWidth={2} className="text-apple-purple" />
            思考过程
            {reasoningActive && (
              <span className="thinking-dots ml-1.5 flex items-center gap-0.5">
                <i />
                <i />
                <i />
              </span>
            )}
            <ChevronDown
              size={13}
              strokeWidth={2}
              className="ml-auto transition-transform duration-200 group-open/reasoning:rotate-180"
            />
          </summary>
          <div className="reasoning-body mt-2 select-text whitespace-pre-wrap text-[12.5px] leading-relaxed text-black/45 dark:text-white/45">
            {m.reasoning}
            {m.status === 'streaming' && m.content === '' && <Cursor />}
          </div>
        </details>
      )}
      {m.content !== '' && (
        <div className={m.reasoning !== '' ? 'mt-2.5' : ''}>
          <Markdown text={m.content} />
        </div>
      )}
      {m.status === 'streaming' && m.content !== '' && <Cursor />}
      {m.status === 'error' && (
        <div
          data-error
          className="mt-2 flex items-start gap-2 rounded-xl bg-apple-red/10 px-3 py-2 text-[12.5px] text-apple-red"
        >
          <AlertCircle size={14} strokeWidth={2.2} className="mt-0.5 shrink-0" />
          <span className="select-text break-all">{m.error}</span>
        </div>
      )}
    </div>
  )
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

interface ChatAreaProps {
  chat: ChatController
  settingsOpen: boolean
  onSmokePhase2Done: () => void
}

export default function ChatArea({ chat, settingsOpen, onSmokePhase2Done }: ChatAreaProps) {
  const {
    messages,
    models,
    modelId,
    setModelId,
    streamingId,
    send,
    stop,
  } = chat
  const [input, setInput] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [attachments, setAttachments] = useState<PickedFile[]>([])
  const taRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const activeModel = models.find((m) => m.id === modelId)
  const isStreaming = streamingId !== null

  useEffect(() => {
    const sc = scrollRef.current
    if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  // ---- 冒烟第二阶段：中途停止验证 ----
  const phase2 = useRef(false)
  const phase2StopClicked = useRef(false)

  useEffect(() => {
    if (!window.aurora.smoke || phase2.current) return
    const allDone = messages.length >= 2 && messages.every((m) => m.status !== 'streaming')
    if (!allDone) return
    phase2.current = true
    setTimeout(() => send('第二次冒烟：测试停止生成功能'), 500)
    setTimeout(() => {
      phase2StopClicked.current = true
      stop()
    }, 1300)
  }, [messages, send, stop])

  useEffect(() => {
    if (!window.aurora.smoke || !phase2.current || !phase2StopClicked.current) return
    if (streamingId !== null) return
    const lastAsst = [...messages].reverse().find((m) => m.role === 'assistant')
    const stoppedEarly = !!lastAsst && lastAsst.content.length < 400
    const errored = lastAsst?.status === 'error'
    window.aurora.smokeNotifyStopVerified({ stoppedEarly, errored })
    onSmokePhase2Done()
  }, [streamingId, messages, onSmokePhase2Done])

  const autoGrow = (): void => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }

  const canSend = input.trim().length > 0 && !isStreaming

  const pickFiles = async (): Promise<void> => {
    const files = await window.aurora.dialog.pickFiles()
    if (files.length === 0) return
    setAttachments((prev) => {
      const seen = new Set(prev.map((f) => f.path))
      return [...prev, ...files.filter((f) => !seen.has(f.path))]
    })
  }

  const doSend = (): void => {
    if (!canSend) return
    send(input, undefined, attachments)
    setInput('')
    setAttachments([])
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  return (
    <main className="relative z-10 flex min-w-0 flex-1 flex-col">
      {/* 顶部模型选择 */}
      <div className="relative flex justify-center pt-2.5" ref={menuRef}>
        <button
          data-model-pill
          onClick={() => setMenuOpen((v) => !v)}
          className="glass-strong flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium text-black/70 shadow-soft transition-transform duration-200 ease-spring hover:scale-[1.03] active:scale-[0.97] dark:text-white/75"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              activeModel && (activeModel.provider === 'mock' || activeModel.apiKey)
                ? 'bg-apple-green'
                : 'bg-black/25 dark:bg-white/30'
            }`}
          />
          {activeModel?.name ?? '选择模型'}
          <ChevronDown
            size={13}
            strokeWidth={2.2}
            className="text-black/40 dark:text-white/40"
          />
        </button>

        {menuOpen && (
          <div className="glass-strong animate-scaleIn absolute top-11 z-30 w-64 origin-top rounded-2xl p-1.5 shadow-glass">
            {models.length === 0 && (
              <p className="px-3 py-4 text-center text-[12px] text-black/40 dark:text-white/40">
                暂无可用模型
              </p>
            )}
            {models.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setModelId(m.id)
                  setMenuOpen(false)
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${
                  m.id === modelId
                    ? 'bg-black/[0.05] dark:bg-white/[0.09]'
                    : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    m.provider === 'mock' || m.apiKey
                      ? 'bg-apple-green'
                      : 'bg-black/25 dark:bg-white/30'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-black/80 dark:text-white/85">
                    {m.name}
                  </span>
                  <span className="block text-[10.5px] text-black/35 dark:text-white/35">
                    {m.provider === 'mock'
                      ? '本地演示'
                      : m.provider === 'deepseek'
                        ? '官方 API'
                        : '兼容端点'}
                    {m.provider !== 'mock' && !m.apiKey && ' · 未配置 Key'}
                  </span>
                </span>
                {m.id === modelId && (
                  <Sparkles size={13} className="shrink-0 text-apple-blue" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 pb-10">
            <div className="animate-scaleIn flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-apple-blue via-apple-purple to-apple-orange shadow-glow">
                <Sparkles size={28} className="text-white" strokeWidth={2} />
              </div>
              <h1 className="mt-5 text-[26px] font-semibold tracking-tight text-black/85 dark:text-white/90">
                你好，我是 Aurora
              </h1>
              <p className="mt-1.5 text-[13.5px] text-black/45 dark:text-white/45">
                Apple 风格的 DeepSeek 桌面工作台
              </p>
            </div>
            <div className="mt-8 grid w-full max-w-[560px] grid-cols-2 gap-2.5">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s.text}
                  data-suggestion
                  onClick={() => setInput(s.text)}
                  className="glass animate-slideUp flex items-center gap-2.5 rounded-2xl px-4 py-3 text-left text-[13px] text-black/70 shadow-soft transition-all duration-200 ease-spring hover:scale-[1.02] hover:bg-white/80 active:scale-[0.98] dark:text-white/75 dark:hover:bg-[#22222a]/80"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <s.icon size={16} strokeWidth={2} className="shrink-0 text-apple-blue" />
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-6 py-6">
            {messages.map((m) =>
              m.role === 'user' ? (
                <div
                  key={m.id}
                  data-role="user"
                  className="animate-slideUp flex justify-end"
                >
                  <div className="max-w-[78%] select-text whitespace-pre-wrap break-words rounded-[22px] rounded-br-md bg-gradient-to-br from-[#0A84FF] to-[#3D9BFF] px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-soft">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div
                  key={m.id}
                  data-role="assistant"
                  className="animate-slideUp flex justify-start"
                >
                  <AssistantBubble m={m} />
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="px-4 pb-4">
        <div className="mx-auto w-full max-w-[780px]">
          <div className="glass-strong rounded-[26px] p-2 shadow-glass transition-shadow focus-within:ring-1 focus-within:ring-apple-blue/40">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-1.5 pb-2 pt-1">
                {attachments.map((a) => (
                  <div
                    key={a.path}
                    data-attachment
                    className="group/att relative flex items-center gap-2 rounded-xl bg-black/[0.04] py-1 pl-1 pr-2 dark:bg-white/[0.07]"
                  >
                    {a.isImage && a.dataUrl ? (
                      <img
                        src={a.dataUrl}
                        alt={a.name}
                        className="h-9 w-9 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-apple-blue/10 text-apple-blue">
                        <FileText size={15} strokeWidth={2} />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block max-w-[180px] truncate text-[12px] font-medium text-black/75 dark:text-white/80">
                        {a.name}
                      </span>
                      <span className="block text-[10.5px] text-black/35 dark:text-white/35">
                        {formatSize(a.size)}
                      </span>
                    </span>
                    <button
                      onClick={() =>
                        setAttachments((prev) => prev.filter((f) => f.path !== a.path))
                      }
                      className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full text-black/35 transition-colors hover:bg-black/[0.08] hover:text-black/70 dark:text-white/35 dark:hover:bg-white/[0.12] dark:hover:text-white/75"
                    >
                      <X size={11} strokeWidth={2.6} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-1">
              <button
                data-attach
                onClick={() => void pickFiles()}
                title="添加附件"
                className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/[0.05] hover:text-black/70 dark:text-white/40 dark:hover:bg-white/[0.08] dark:hover:text-white/75"
              >
                <Paperclip size={17} strokeWidth={2} />
              </button>
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                autoGrow()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  doSend()
                }
              }}
              placeholder="给 Aurora 发送消息…"
              className="max-h-[160px] flex-1 resize-none select-text bg-transparent py-1.5 text-[14px] leading-relaxed outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
            {isStreaming ? (
              <button
                aria-label="停止"
                onClick={stop}
                className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-apple-red/90 text-white shadow-soft transition-all duration-200 ease-spring hover:brightness-110 active:scale-90"
              >
                <Square size={12} strokeWidth={2.5} fill="currentColor" />
              </button>
            ) : (
              <button
                aria-label="发送"
                disabled={!canSend}
                onClick={doSend}
                className={`mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200 ease-spring ${
                  canSend
                    ? 'bg-apple-blue text-white shadow-soft hover:brightness-110 active:scale-90'
                    : 'bg-black/[0.06] text-black/25 dark:bg-white/[0.08] dark:text-white/25'
                }`}
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-black/30 dark:text-white/30">
            Aurora 可能会犯错，请核查重要信息
          </p>
        </div>
      </div>
    </main>
  )
}
