import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square, Wrench, ChevronRight, ChevronDown, Settings2, Cpu } from 'lucide-react'
import type { ChatMessage, LlmState } from '../types'
import { Markdown } from './Markdown'

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div data-role={msg.role} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[76%] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed shadow-soft transition-colors ${
          isUser
            ? 'bg-apple-blue text-white'
            : 'bg-white/85 text-black/85 dark:bg-white/[0.08] dark:text-white/85'
        }`}
      >
        {msg.reasoning && (
          <details data-reasoning className="mb-2 rounded-lg bg-black/[0.04] px-3 py-2 text-[12px] text-black/55 dark:bg-white/[0.05] dark:text-white/55">
            <summary className="cursor-pointer select-none font-medium">思考过程</summary>
            <p className="mt-1 whitespace-pre-wrap">{msg.reasoning}</p>
          </details>
        )}
        {msg.toolSteps.length > 0 && (
          <div className="mb-2 space-y-1">
            {msg.toolSteps.map((t) => (
              <div
                key={t.id}
                data-tool-step
                className="rounded-lg bg-black/[0.04] px-2.5 py-1.5 text-[11.5px] text-black/55 dark:bg-white/[0.05] dark:text-white/55"
              >
                <div className="flex items-center gap-1.5">
                  <Wrench size={11} strokeWidth={2.2} className="shrink-0 text-apple-teal" />
                  <span className="font-mono font-medium">{t.name}</span>
                  <span
                    className={`ml-auto shrink-0 rounded px-1 py-px text-[9px] ${
                      t.status === 'running'
                        ? 'bg-apple-blue/15 text-apple-blue'
                        : t.status === 'error'
                          ? 'bg-apple-red/15 text-apple-red'
                          : 'bg-apple-green/15 text-apple-green'
                    }`}
                  >
                    {t.status === 'running' ? '运行中' : t.status === 'error' ? '失败' : '完成'}
                  </span>
                </div>
                {t.result && (
                  <pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10.5px] opacity-75">
                    {t.result.length > 400 ? t.result.slice(0, 400) + '…' : t.result}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
        {msg.status === 'error' ? (
          <p data-error className="text-apple-red">
            {msg.error ?? '出错了'}
          </p>
        ) : (
          <Markdown content={msg.content} />
        )}
        {msg.status === 'streaming' && (
          <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-current align-middle opacity-70" />
        )}
        {msg.usage && (
          <p className="mt-2 text-right text-[10px] text-black/35 dark:text-white/35">
            {msg.usage.inputTokens ?? 0} in · {msg.usage.outputTokens ?? 0} out
          </p>
        )}
      </div>
    </div>
  )
}

interface Props {
  messages: ChatMessage[]
  streaming: boolean
  ready: boolean
  llm: LlmState | null
  onLlmSelect: (provider: string, model: string) => Promise<void>
  onOpenSettings: () => void
  onSend: (text: string) => void
  onStop: () => void
}

export default function ChatArea({
  messages,
  streaming,
  ready,
  llm,
  onLlmSelect,
  onOpenSettings,
  onSend,
  onStop,
}: Props) {
  const [input, setInput] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  const submit = () => {
    const t = input.trim()
    if (!t || streaming) return
    onSend(t)
    setInput('')
  }

  const currentProvider = llm?.providers.find((p) => p.id === llm.current.provider)
  const currentModel = currentProvider?.models.find((m) => m.id === llm.current.model)
  const modelLabel = currentModel?.name ?? llm?.current.model ?? '选择模型'

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {/* 顶部工具行：模型选择 + 设置 */}
      <div className="flex shrink-0 items-center justify-between px-6 pb-1 pt-2">
        <div className="relative" ref={menuRef}>
          <button
            data-model-pill
            title="切换模型"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-full bg-black/[0.05] px-3 py-1.5 text-[12px] font-medium text-black/70 transition-colors hover:bg-black/[0.09] dark:bg-white/[0.07] dark:text-white/70 dark:hover:bg-white/[0.12]"
          >
            <Cpu size={12} strokeWidth={2.2} className="text-apple-blue" />
            {modelLabel}
            <ChevronDown size={12} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>
          {menuOpen && llm && (
            <div className="absolute left-0 top-9 z-30 max-h-72 w-64 overflow-y-auto rounded-xl border border-black/[0.08] bg-white/95 p-1.5 shadow-glass backdrop-blur-2xl dark:border-white/[0.1] dark:bg-[#1c1c23]/95">
              {llm.providers.map((p) => (
                <div key={p.id}>
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-black/35 dark:text-white/35">
                    {p.name}
                  </p>
                  {p.models.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setMenuOpen(false)
                        void onLlmSelect(p.id, m.id)
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${
                        llm.current.provider === p.id && llm.current.model === m.id
                          ? 'bg-apple-blue/12 font-medium text-apple-blue dark:bg-apple-blue/20'
                          : 'text-black/70 hover:bg-black/[0.05] dark:text-white/70 dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      {m.name}
                      {m.contextWindow ? (
                        <span className="text-[9.5px] text-black/35 dark:text-white/35">
                          {Math.round(m.contextWindow / 1024)}K
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          title="设置"
          data-open-settings
          onClick={onOpenSettings}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-black/45 transition-colors hover:bg-black/[0.06] hover:text-apple-blue dark:text-white/45 dark:hover:bg-white/[0.08]"
        >
          <Settings2 size={14} strokeWidth={2.2} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-apple-blue to-apple-purple text-[20px] font-bold text-white shadow-glass">
              A
            </div>
            <h2 className="text-[17px] font-semibold text-black/80 dark:text-white/85">
              探索未至之境
            </h2>
            <p className="max-w-sm text-[12.5px] leading-relaxed text-black/45 dark:text-white/45">
              {ready
                ? '这是 Aurora 原生客户端：界面属于 Aurora，能力来自进程内嵌入的 DeepSeek Harness 引擎。'
                : '正在启动 DeepSeek Harness 引擎…'}
            </p>
          </div>
        )}
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="shrink-0 px-6 pb-5 pt-1">
        <div className="glass-strong mx-auto flex max-w-3xl items-end gap-2 rounded-2xl p-2.5">
          <textarea
            rows={1}
            placeholder="和 DeepSeek Harness 对话…（Enter 发送，Shift+Enter 换行）"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] leading-relaxed text-black/85 outline-none placeholder:text-black/35 dark:text-white/85 dark:placeholder:text-white/35"
          />
          {streaming ? (
            <button
              aria-label="停止"
              title="停止"
              onClick={onStop}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-apple-red/12 text-apple-red transition-all hover:bg-apple-red/20 active:scale-95"
            >
              <Square size={12} strokeWidth={2.6} fill="currentColor" />
            </button>
          ) : (
            <button
              aria-label="发送"
              data-send
              title="发送"
              onClick={submit}
              disabled={!input.trim()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-apple-blue text-white shadow-soft transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
            >
              <ArrowUp size={15} strokeWidth={2.6} />
            </button>
          )}
        </div>
        <p className="mx-auto mt-1.5 flex max-w-3xl items-center gap-1 text-[10px] text-black/30 dark:text-white/30">
          <ChevronRight size={10} />
          DeepSeek Harness 引擎 · 进程内运行 · 全部能力（工具/沙箱/审批/轨迹）由引擎提供
        </p>
      </div>
    </main>
  )
}
