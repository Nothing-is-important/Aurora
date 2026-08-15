import { MessageSquare, Plus } from 'lucide-react'
import type { SessionMeta } from '../types'

interface Props {
  sessions: SessionMeta[]
  activeId: string | null
  onOpen: (id: string) => void
  onNew: () => void
}

export default function Sidebar({ sessions, activeId, onOpen, onNew }: Props) {
  return (
    <aside className="flex w-[236px] shrink-0 flex-col border-r border-black/[0.06] dark:border-white/[0.07]">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-black/35 dark:text-white/35">
          会话
        </span>
        <button
          aria-label="新对话"
          title="新对话"
          onClick={onNew}
          className="flex h-6 w-6 items-center justify-center rounded-md text-black/45 transition-colors hover:bg-black/[0.06] hover:text-apple-blue dark:text-white/45 dark:hover:bg-white/[0.08]"
        >
          <Plus size={14} strokeWidth={2.4} />
        </button>
      </div>
      <div data-session-list className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-3">
        {sessions.length === 0 && (
          <p className="px-2 py-4 text-center text-[11.5px] leading-relaxed text-black/35 dark:text-white/35">
            暂无会话。点右上角 + 开始与 DeepSeek Harness 对话。
          </p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onOpen(s.id)}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors ${
              s.id === activeId
                ? 'bg-apple-blue/12 font-medium text-apple-blue dark:bg-apple-blue/20 dark:text-apple-blue'
                : 'text-black/70 hover:bg-black/[0.05] dark:text-white/70 dark:hover:bg-white/[0.06]'
            }`}
          >
            <MessageSquare size={13} strokeWidth={2} className="shrink-0 opacity-60" />
            <span className="min-w-0 flex-1 truncate">{s.title}</span>
            {!s.live && (
              <span className="shrink-0 rounded bg-black/[0.05] px-1 py-px text-[9px] text-black/40 dark:bg-white/[0.08] dark:text-white/40">
                历史
              </span>
            )}
          </button>
        ))}
      </div>
    </aside>
  )
}
