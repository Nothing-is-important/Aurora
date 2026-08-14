import {
  Monitor,
  Moon,
  Pin,
  Plus,
  Search,
  Settings,
  Sun,
} from 'lucide-react'
import { useTheme } from '../lib/theme'

export interface ConversationItem {
  id: string
  title: string
  time: string
  pinned?: boolean
  active?: boolean
}

interface SidebarProps {
  conversations: ConversationItem[]
  onNewChat: () => void
}

function ThemeIcon() {
  const { source } = useTheme()
  if (source === 'light') return <Sun size={15} strokeWidth={2} />
  if (source === 'dark') return <Moon size={15} strokeWidth={2} />
  return <Monitor size={15} strokeWidth={2} />
}

export default function Sidebar({
  conversations,
  onNewChat,
}: SidebarProps) {
  const { cycle, source } = useTheme()

  return (
    <aside className="glass relative z-10 flex w-[264px] shrink-0 flex-col border-r border-black/[0.06] dark:border-white/[0.08]">
      <div className="flex flex-col gap-2 px-3 pt-3">
        <button
          onClick={onNewChat}
          aria-label="新对话"
          className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-apple-blue text-[13px] font-medium text-white shadow-soft transition-all duration-200 ease-spring hover:brightness-110 active:scale-[0.97]"
        >
          <Plus size={15} strokeWidth={2.5} />
          新对话
        </button>

        <div className="flex h-8 items-center gap-2 rounded-lg bg-black/[0.04] px-2.5 dark:bg-white/[0.07]">
          <Search
            size={13}
            strokeWidth={2.2}
            className="shrink-0 text-black/35 dark:text-white/40"
          />
          <input
            placeholder="搜索会话"
            className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-black/35 dark:placeholder:text-white/35"
          />
        </div>
      </div>

      <div className="mt-3 flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-black/35 dark:text-white/30">
          最近对话
        </p>
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/[0.04] text-black/30 dark:bg-white/[0.06] dark:text-white/30">
              <Search size={16} />
            </div>
            <p className="text-[12px] text-black/40 dark:text-white/35">
              还没有会话，点击上方按钮开始
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  className={`group flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-150 ${
                    c.active
                      ? 'bg-black/[0.05] dark:bg-white/[0.09]'
                      : 'hover:bg-black/[0.035] dark:hover:bg-white/[0.05]'
                  }`}
                >
                  <span
                    className={`min-w-0 flex-1 truncate text-[13px] ${
                      c.active
                        ? 'font-medium text-black/85 dark:text-white/90'
                        : 'text-black/70 dark:text-white/70'
                    }`}
                  >
                    {c.title}
                  </span>
                  {c.pinned && (
                    <Pin
                      size={12}
                      strokeWidth={2.2}
                      className="shrink-0 text-black/35 dark:text-white/35"
                    />
                  )}
                  <span className="shrink-0 text-[11px] tabular-nums text-black/30 dark:text-white/30">
                    {c.time}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-black/[0.05] px-3 py-2.5 dark:border-white/[0.07]">
        <button
          onClick={cycle}
          title={`主题：${source === 'system' ? '跟随系统' : source === 'dark' ? '深色' : '浅色'}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-black/50 transition-colors hover:bg-black/[0.05] hover:text-black/80 dark:text-white/55 dark:hover:bg-white/[0.08] dark:hover:text-white/90"
        >
          <ThemeIcon />
        </button>
        <button
          title="设置"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-black/50 transition-colors hover:bg-black/[0.05] hover:text-black/80 dark:text-white/55 dark:hover:bg-white/[0.08] dark:hover:text-white/90"
        >
          <Settings size={15} strokeWidth={2} />
        </button>
        <div className="ml-auto flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-apple-blue to-apple-purple text-[11px] font-semibold text-white">
            A
          </div>
          <span className="text-[12.5px] font-medium text-black/70 dark:text-white/75">
            本地用户
          </span>
        </div>
      </div>
    </aside>
  )
}
