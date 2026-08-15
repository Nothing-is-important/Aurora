import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowUp,
  BookMarked,
  Brain,
  Check,
  ChevronDown,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  Layers,
  Lightbulb,
  Loader2,
  Paperclip,
  Pencil,
  RefreshCw,
  Sparkles,
  Square,
  Wrench,
  X,
} from 'lucide-react'
import type { ChatController, ChatMessage } from '../lib/chat'
import type { PickedFile } from '../lib/ipc'
import { estimateCost, formatCost, pricingFor } from '../lib/pricing'
import type { ModelPricing } from '../lib/pricing'
import { BUILTIN_TEMPLATES, loadCustomTemplates } from '../lib/templates'
import type { PromptTemplate } from '../lib/templates'
import { Markdown } from './Markdown'

const SUGGESTIONS = [
  { icon: Code2, text: '帮我写一个 Python 脚本' },
  { icon: Lightbulb, text: '解释一个复杂概念' },
  { icon: FileText, text: '总结一段长文本' },
  { icon: Sparkles, text: '头脑风暴新点子' },
]

/** 粗略 token 估算（中文约 1.5 字/token，英文约 4 字符/token，取 0.6 系数折中） */
function estimateTokens(messages: ChatMessage[]): number {
  const chars = messages.reduce(
    (s, m) => s + m.content.length + m.reasoning.length,
    0,
  )
  return Math.round(chars * 0.6)
}

/** 各模型上下文窗口（token） */
function contextWindow(modelName: string | undefined): number {
  if (!modelName) return 64000
  if (modelName.includes('reasoner')) return 64000
  if (modelName.includes('deepseek-chat')) return 64000
  return 128000
}

function Cursor() {
  return (
    <span className="streaming-cursor ml-0.5 inline-block h-[1.05em] w-[7px] translate-y-[0.15em] rounded-[2px] bg-apple-blue" />
  )
}

function AssistantBubble({
  m,
  pricing,
  onRetry,
}: {
  m: ChatMessage
  pricing: ModelPricing
  onRetry?: (id: string) => void
}) {
  const reasoningActive = m.status === 'streaming' && m.content === ''
  const cost = estimateCost(m.usage, pricing)
  return (
    <div className="glass-strong w-full rounded-[22px] rounded-bl-md px-4 py-3 text-[14px] leading-relaxed text-black/80 shadow-soft dark:text-white/85">
      {m.toolSteps && m.toolSteps.length > 0 && (
        <div className="mb-2.5 space-y-1.5">
          {m.toolSteps.map((s) => (
            <div
              key={s.id}
              data-tool-step
              className={`rounded-xl border px-3 py-2 text-[12px] ${
                s.status === 'error'
                  ? 'border-apple-red/25 bg-apple-red/[0.07]'
                  : 'border-black/[0.07] bg-black/[0.035] dark:border-white/[0.09] dark:bg-white/[0.05]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Wrench
                  size={13}
                  strokeWidth={2}
                  className={`shrink-0 ${
                    s.status === 'error'
                      ? 'text-apple-red'
                      : s.status === 'done'
                        ? 'text-apple-green'
                        : 'text-apple-blue'
                  }`}
                />
                <span className="shrink-0 font-mono text-[11.5px] font-semibold text-black/70 dark:text-white/75">
                  {s.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-black/45 dark:text-white/45">
                  {s.resultSummary || JSON.stringify(s.args).slice(0, 80)}
                </span>
                <span className="shrink-0">
                  {s.status === 'running' ? (
                    <Loader2 size={13} className="animate-spin text-apple-blue" />
                  ) : s.status === 'done' ? (
                    <Check size={13} strokeWidth={2.6} className="text-apple-green" />
                  ) : (
                    <X size={13} strokeWidth={2.6} className="text-apple-red" />
                  )}
                </span>
              </div>
              {s.refs && s.refs.length > 0 && (
                <div className="mt-1.5 space-y-0.5 border-t border-black/[0.05] pt-1.5 dark:border-white/[0.07]">
                  {s.refs.map((r, i) => (
                    <button
                      key={i}
                      data-ref
                      onClick={() => void window.aurora.openExternal(r.url)}
                      className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    >
                      <ExternalLink
                        size={11}
                        strokeWidth={2.2}
                        className="shrink-0 text-apple-blue"
                      />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-apple-blue/90">
                        {r.title}
                      </span>
                      <span className="shrink-0 text-[10px] text-black/30 dark:text-white/30">
                        {r.snippet ? r.snippet.slice(0, 30) + '…' : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
          <span className="select-text min-w-0 flex-1 break-all">{m.error}</span>
          {onRetry && (
            <button
              data-error-retry
              onClick={() => onRetry(m.id)}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-apple-red/15 px-2 py-1 text-[11.5px] font-medium transition-colors hover:bg-apple-red/25"
            >
              <RefreshCw size={11} strokeWidth={2.4} />
              重试
            </button>
          )}
        </div>
      )}
      {m.usage && m.status === 'done' && (
        <div
          data-usage
          className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border-t border-black/[0.05] pt-2 text-[10.5px] tabular-nums text-black/35 dark:border-white/[0.06] dark:text-white/35"
        >
          <span>{m.usage.total_tokens ?? 0} tokens</span>
          {m.firstTokenMs != null && (
            <span>首字 {m.firstTokenMs}ms</span>
          )}
          {m.durationMs != null && (
            <span>耗时 {(m.durationMs / 1000).toFixed(1)}s</span>
          )}
          {cost > 0 && <span>{formatCost(cost)}</span>}
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

function MsgToolbar({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="no-scrollbar pointer-events-none absolute -bottom-3 right-0 z-10 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
      {children}
    </div>
  )
}

function ToolbarBtn({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="pointer-events-auto flex h-6 items-center gap-1 rounded-full bg-white/90 px-2 text-[10.5px] font-medium text-black/55 shadow-soft backdrop-blur transition-colors hover:bg-white hover:text-black/80 dark:bg-[#2a2a33]/90 dark:text-white/60 dark:hover:bg-[#33333d] dark:hover:text-white/90"
    >
      {children}
    </button>
  )
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
    modes,
    modeId,
    setMode,
    streamingId,
    send,
    stop,
    editMessage,
    regenerate,
  } = chat
  const [input, setInput] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [attachments, setAttachments] = useState<PickedFile[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [promptMenuOpen, setPromptMenuOpen] = useState(false)
  const [customTemplates, setCustomTemplates] = useState<PromptTemplate[]>([])
  const [promptToast, setPromptToast] = useState<string | null>(null)
  const promptMenuRef = useRef<HTMLDivElement>(null)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const activeModel = models.find((m) => m.id === modelId)
  const activeMode = modes.find((m) => m.id === modeId)
  const isStreaming = streamingId !== null
  const pricing = pricingFor(activeModel)
  const ctxTokens = estimateTokens(messages)
  const ctxWindow = contextWindow(activeModel?.modelId)
  const ctxRatio = ctxWindow > 0 ? ctxTokens / ctxWindow : 0

  useEffect(() => {
    const sc = scrollRef.current
    if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!menuOpen && !modeMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !(modeMenuRef.current && modeMenuRef.current.contains(e.target as Node))
      ) {
        setMenuOpen(false)
        setModeMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen, modeMenuOpen])

  useEffect(() => {
    void loadCustomTemplates().then(setCustomTemplates)
  }, [])

  useEffect(() => {
    if (!promptMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (
        promptMenuRef.current &&
        !promptMenuRef.current.contains(e.target as Node)
      ) {
        setPromptMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [promptMenuOpen])

  const applyTemplate = (t: PromptTemplate): void => {
    setPromptMenuOpen(false)
    if (t.kind === 'chat') {
      setInput((prev) => (prev.trim() ? prev + '\n\n' : '') + t.prompt)
      taRef.current?.focus()
    } else {
      void window.aurora.settings.set('systemPrompt', t.prompt).then(() => {
        setPromptToast(`已设为系统提示词：${t.name}`)
        setTimeout(() => setPromptToast(null), 2500)
      })
    }
  }

  // ---- 冒烟第二阶段：中途停止验证 ----
  const phase2 = useRef(false)
  const phase2StopClicked = useRef(false)
  const phase2Verified = useRef(false)

  useEffect(() => {
    if (!window.aurora.smoke || phase2.current) return
    const allDone = messages.length >= 2 && messages.every((m) => m.status !== 'streaming')
    if (!allDone) return
    phase2.current = true
    // 延迟 4s 启动：为主进程留出展示截图窗口（截图在第一轮对话完成后立即执行）
    setTimeout(() => {
      send('第二次冒烟：测试停止生成功能')
      // 停止计时器相对 send 触发，避免负载抖动下打在空流上
      setTimeout(() => {
        phase2StopClicked.current = true
        stop()
      }, 400)
    }, 4000)
  }, [messages, send, stop])

  useEffect(() => {
    if (!window.aurora.smoke || !phase2.current || !phase2StopClicked.current) return
    if (phase2Verified.current) return
    if (streamingId !== null) return
    phase2Verified.current = true
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

  const copyMessage = async (text: string, id: string): Promise<void> => {
    await window.aurora.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500)
  }

  const commitEdit = (id: string): void => {
    editMessage(id, editDraft)
    setEditingId(null)
    setEditDraft('')
  }

  return (
    <main className="relative z-10 flex min-w-0 flex-1 flex-col">
      {/* 顶部模式与模型选择 */}
      <div className="relative flex items-center justify-center gap-2 pt-2.5" ref={menuRef}>
        <button
          data-mode-pill
          onClick={() => setModeMenuOpen((v) => !v)}
          className="glass-strong flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium text-black/70 shadow-soft transition-transform duration-200 ease-spring hover:scale-[1.03] active:scale-[0.97] dark:text-white/75"
        >
          <Layers size={13} strokeWidth={2.2} className="text-apple-purple" />
          {activeMode?.name ?? '普通对话'}
          <ChevronDown
            size={13}
            strokeWidth={2.2}
            className="text-black/40 dark:text-white/40"
          />
        </button>

        {modeMenuOpen && (
          <div
            ref={modeMenuRef}
            data-mode-menu
            className="glass-strong animate-scaleIn absolute top-11 z-30 w-72 origin-top rounded-2xl p-1.5 shadow-glass"
          >
            {modes.map((m) => (
              <button
                key={m.id}
                data-mode-item
                onClick={() => {
                  setMode(m.id)
                  setModeMenuOpen(false)
                  if (m.recommendModelId) {
                    const rec = models.find(
                      (x) => x.modelId === m.recommendModelId,
                    )
                    if (rec) setModelId(rec.id)
                  }
                }}
                className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${
                  m.id === modeId
                    ? 'bg-apple-purple/10 dark:bg-apple-purple/20'
                    : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                }`}
              >
                <Layers
                  size={14}
                  strokeWidth={2}
                  className={`mt-0.5 shrink-0 ${
                    m.id === modeId
                      ? 'text-apple-purple'
                      : 'text-black/40 dark:text-white/40'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-black/80 dark:text-white/85">
                    {m.name}
                  </span>
                  <span className="block text-[11px] leading-snug text-black/40 dark:text-white/40">
                    {m.desc}
                    {m.toolsEnabled ? ' · 可用工具' : ''}
                  </span>
                </span>
                {m.id === modeId && (
                  <Check
                    size={13}
                    strokeWidth={2.6}
                    className="mt-0.5 shrink-0 text-apple-purple"
                  />
                )}
              </button>
            ))}
          </div>
        )}

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
                data-model-item
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
                  className="group relative animate-slideUp flex justify-end"
                >
                  {editingId === m.id ? (
                    <div className="w-full max-w-[78%]">
                      <textarea
                        data-msg-edit-input
                        autoFocus
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            commitEdit(m.id)
                          }
                          if (e.key === 'Escape') {
                            setEditingId(null)
                            setEditDraft('')
                          }
                        }}
                        rows={Math.min(8, Math.max(2, editDraft.split('\n').length))}
                        className="w-full resize-none select-text rounded-[22px] rounded-br-md bg-gradient-to-br from-[#0A84FF] to-[#3D9BFF] px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-soft outline-none ring-2 ring-white/60"
                      />
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <button
                          data-msg-edit-save
                          onClick={() => commitEdit(m.id)}
                          className="flex h-6 items-center gap-1 rounded-full bg-apple-blue px-2.5 text-[11px] font-medium text-white shadow-soft transition-transform active:scale-95"
                        >
                          <Check size={12} strokeWidth={2.6} /> 保存并重新发送
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(null)
                            setEditDraft('')
                          }}
                          className="flex h-6 items-center gap-1 rounded-full bg-black/[0.06] px-2.5 text-[11px] font-medium text-black/55 transition-colors hover:bg-black/[0.1] dark:bg-white/[0.09] dark:text-white/60"
                        >
                          <X size={12} strokeWidth={2.6} /> 取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="relative max-w-[78%]">
                      <div className="select-text whitespace-pre-wrap break-words rounded-[22px] rounded-br-md bg-gradient-to-br from-[#0A84FF] to-[#3D9BFF] px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-soft">
                        {m.content}
                      </div>
                      {m.status !== 'streaming' && (
                        <MsgToolbar>
                          <ToolbarBtn
                            label="编辑消息"
                            onClick={() => {
                              setEditingId(m.id)
                              setEditDraft(m.content.replace(/\n\n📎.*$/s, ''))
                            }}
                          >
                            <Pencil size={11} strokeWidth={2.4} />
                            编辑
                          </ToolbarBtn>
                          <ToolbarBtn
                            label="复制消息"
                            onClick={() => void copyMessage(m.content, m.id)}
                          >
                            {copiedId === m.id ? (
                              <Check size={11} strokeWidth={2.6} />
                            ) : (
                              <Copy size={11} strokeWidth={2.4} />
                            )}
                            {copiedId === m.id ? '已复制' : '复制'}
                          </ToolbarBtn>
                        </MsgToolbar>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  key={m.id}
                  data-role="assistant"
                  className="group relative animate-slideUp flex justify-start"
                >
                  <AssistantBubble m={m} pricing={pricing} onRetry={regenerate} />
                  {m.status !== 'streaming' && (
                    <MsgToolbar>
                      <ToolbarBtn
                        label="重新生成"
                        onClick={() => regenerate(m.id)}
                      >
                        <RefreshCw size={11} strokeWidth={2.4} />
                        重新生成
                      </ToolbarBtn>
                      <ToolbarBtn
                        label="复制回复"
                        onClick={() => void copyMessage(m.content, m.id)}
                      >
                        {copiedId === m.id ? (
                          <Check size={11} strokeWidth={2.6} />
                        ) : (
                          <Copy size={11} strokeWidth={2.4} />
                        )}
                        {copiedId === m.id ? '已复制' : '复制'}
                      </ToolbarBtn>
                    </MsgToolbar>
                  )}
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="px-4 pb-4">
        <div className="relative mx-auto w-full max-w-[780px]">
          {promptToast && (
            <div
              data-prompt-toast
              className="animate-slideUp absolute -top-10 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-black/75 px-3.5 py-1.5 text-[12px] text-white shadow-glass backdrop-blur dark:bg-white/20"
            >
              <Check size={12} strokeWidth={2.6} className="text-apple-green" />
              {promptToast}
            </div>
          )}

          {/* 模板菜单 */}
          {promptMenuOpen && (
            <div
              ref={promptMenuRef}
              data-prompt-menu
              className="glass-strong animate-scaleIn absolute bottom-[calc(100%+10px)] left-0 z-30 max-h-[320px] w-[340px] origin-bottom overflow-y-auto rounded-2xl p-1.5 shadow-glass"
            >
              <p className="px-3 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-black/35 dark:text-white/30">
                提示词模板 · {activeMode?.name ?? '标准模式'}
              </p>
              {[...BUILTIN_TEMPLATES, ...customTemplates]
                .filter((t) => !t.modes || t.modes.includes(modeId))
                .map((t) => (
                <button
                  key={t.id}
                  data-template-item
                  onClick={() => applyTemplate(t)}
                  className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                >
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      t.kind === 'system' ? 'bg-apple-purple' : 'bg-apple-blue'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-black/80 dark:text-white/85">
                      {t.name}
                    </span>
                    <span className="block truncate text-[11px] text-black/40 dark:text-white/40">
                      {t.desc} · {t.kind === 'system' ? '设为系统提示词' : '填入输入框'}
                    </span>
                  </span>
                </button>
              ))}
              {[...BUILTIN_TEMPLATES, ...customTemplates].filter(
                (t) => !t.modes || t.modes.includes(modeId),
              ).length === 0 && (
                <p className="px-3 py-5 text-center text-[12px] text-black/40 dark:text-white/40">
                  当前模式没有可用模板
                </p>
              )}
            </div>
          )}

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
                data-prompt-btn
                onClick={() => setPromptMenuOpen((v) => !v)}
                title="提示词模板"
                className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/[0.05] hover:text-black/70 dark:text-white/40 dark:hover:bg-white/[0.08] dark:hover:text-white/75"
              >
                <BookMarked size={16} strokeWidth={2} />
              </button>
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
          <p className="mt-2 flex items-center justify-center gap-2 text-center text-[11px] text-black/30 dark:text-white/30">
            <span>Aurora 可能会犯错，请核查重要信息</span>
            {messages.length > 0 && (
              <span
                data-ctx-indicator
                className={`tabular-nums ${
                  ctxRatio > 0.9
                    ? 'text-apple-red'
                    : ctxRatio > 0.7
                      ? 'text-apple-orange'
                      : ''
                }`}
              >
                上下文 ≈{ctxTokens.toLocaleString()} / {ctxWindow.toLocaleString()} tokens
                {ctxRatio > 0.7 && `（${Math.round(ctxRatio * 100)}%）`}
              </span>
            )}
          </p>
        </div>
      </div>
    </main>
  )
}
