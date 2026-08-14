import { useRef, useState } from 'react'
import {
  ArrowUp,
  ChevronDown,
  Code2,
  FileText,
  Lightbulb,
  Paperclip,
  Sparkles,
} from 'lucide-react'

interface DemoMessage {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  { icon: Code2, text: '帮我写一个 Python 脚本' },
  { icon: Lightbulb, text: '解释一个复杂概念' },
  { icon: FileText, text: '总结一段长文本' },
  { icon: Sparkles, text: '头脑风暴新点子' },
]

const DEMO: DemoMessage[] = [
  { role: 'user', content: '用一句话介绍你自己' },
  {
    role: 'assistant',
    content:
      '我是 Aurora，一个 Apple 风格的 DeepSeek 桌面工作台。\n\n我可以帮你：\n• 编写和解释代码\n• 分析本地文件与数据\n• 联网搜索实时信息\n• 构建你的本地知识库\n\n所有数据都保存在你的电脑上。',
  },
]

export default function ChatArea({ smoke }: { smoke: boolean }) {
  const [input, setInput] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  const autoGrow = (): void => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }

  const canSend = input.trim().length > 0
  const messages = smoke ? DEMO : []

  return (
    <main className="relative z-10 flex min-w-0 flex-1 flex-col">
      {/* 顶部模型选择 */}
      <div className="flex justify-center pt-2.5">
        <button className="glass-strong flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium text-black/70 shadow-soft transition-transform duration-200 ease-spring hover:scale-[1.03] active:scale-[0.97] dark:text-white/75">
          <span className="h-1.5 w-1.5 rounded-full bg-apple-green" />
          deepseek-chat
          <ChevronDown size={13} strokeWidth={2.2} className="text-black/40 dark:text-white/40" />
        </button>
      </div>

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto">
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
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} data-role="user" className="animate-slideUp flex justify-end">
                  <div className="max-w-[78%] rounded-[22px] rounded-br-md bg-gradient-to-br from-[#0A84FF] to-[#3D9BFF] px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-soft">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} data-role="assistant" className="animate-slideUp flex justify-start">
                  <div className="glass-strong max-w-[86%] rounded-[22px] rounded-bl-md px-4 py-3 text-[14px] leading-relaxed text-black/80 shadow-soft dark:text-white/85">
                    {m.content.split('\n').map((line, j) => (
                      <p key={j} className={line.startsWith('•') ? 'pl-1' : j > 0 ? 'mt-2' : ''}>
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="px-4 pb-4">
        <div className="mx-auto w-full max-w-[780px]">
          <div className="glass-strong flex items-end gap-1 rounded-[26px] p-2 shadow-glass transition-shadow focus-within:ring-1 focus-within:ring-apple-blue/40">
            <button className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/[0.05] hover:text-black/70 dark:text-white/40 dark:hover:bg-white/[0.08] dark:hover:text-white/75">
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
                  if (canSend) {
                    setInput('')
                    if (taRef.current) taRef.current.style.height = 'auto'
                  }
                }
              }}
              placeholder="给 Aurora 发送消息…"
              className="max-h-[160px] flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-relaxed outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
            />
            <button
              aria-label="发送"
              disabled={!canSend}
              className={`mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200 ease-spring ${
                canSend
                  ? 'bg-apple-blue text-white shadow-soft hover:brightness-110 active:scale-90'
                  : 'bg-black/[0.06] text-black/25 dark:bg-white/[0.08] dark:text-white/25'
              }`}
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-black/30 dark:text-white/30">
            Aurora 可能会犯错，请核查重要信息
          </p>
        </div>
      </div>
    </main>
  )
}
