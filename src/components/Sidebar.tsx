import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  FolderOpen,
  Info,
  LogOut,
  Monitor,
  Moon,
  Pin,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
} from 'lucide-react'
import { useTheme } from '../lib/theme'
import type { ConversationRow } from '../lib/ipc'

export function formatTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function ThemeIcon() {
  const { source } = useTheme()
  if (source === 'light') return <Sun size={15} strokeWidth={2} />
  if (source === 'dark') return <Moon size={15} strokeWidth={2} />
  return <Monitor size={15} strokeWidth={2} />
}

export interface SidebarProps {
  conversations: ConversationRow[]
  activeId: string | null
  onNewChat: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onOpenSettings: () => void
}

export default function Sidebar({
  conversations,
  activeId,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
  onTogglePin,
  onOpenSettings,
}: SidebarProps) {
  const { cycle, source } = useTheme()
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.aurora.app.getVersion().then(setAppVersion)
  }, [])

  useEffect(() => {
    if (!userMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [userMenuOpen])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => c.title.toLowerCase().includes(q))
  }, [conversations, query])

  const startEdit = (c: ConversationRow): void => {
    setEditingId(c.id)
    setDraft(c.title)
  }

  const commitEdit = (): void => {
    if (editingId) {
      const t = draft.trim()
      if (t) onRename(editingId, t)
    }
    setEditingId(null)
  }

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
            data-conv-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话"
            className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-black/35 dark:placeholder:text-white/35"
          />
        </div>
      </div>

      <div className="mt-3 flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-black/35 dark:text-white/30">
          最近对话
        </p>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/[0.04] text-black/30 dark:bg-white/[0.06] dark:text-white/30">
              <Search size={16} />
            </div>
            <p className="text-[12px] text-black/40 dark:text-white/35">
              {conversations.length === 0 ? '还没有会话，点击上方按钮开始' : '没有匹配的会话'}
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  data-conv-item
                  data-active={c.id === activeId ? 'true' : 'false'}
                  onClick={() => onSelect(c.id)}
                  onDoubleClick={() => startEdit(c)}
                  className={`group relative flex w-full items-center gap-1.5 rounded-xl px-2 py-2 text-left transition-colors duration-150 ${
                    c.id === activeId
                      ? 'bg-black/[0.05] dark:bg-white/[0.09]'
                      : 'hover:bg-black/[0.035] dark:hover:bg-white/[0.05]'
                  }`}
                >
                  {editingId === c.id ? (
                    <span
                      className="flex min-w-0 flex-1 items-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit()
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        onBlur={commitEdit}
                        className="w-full rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[13px] outline-none ring-1 ring-apple-blue/50 dark:bg-white/[0.1]"
                      />
                      <Check size={12} className="ml-1 shrink-0 text-apple-blue" />
                    </span>
                  ) : (
                    <>
                      <span
                        className={`min-w-0 flex-1 truncate text-[13px] ${
                          c.id === activeId
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
                      <span className="shrink-0 text-[11px] tabular-nums text-black/30 transition-opacity group-hover:opacity-0 dark:text-white/30">
                        {formatTime(c.updatedAt)}
                      </span>
                      <span
                        className="absolute right-1.5 hidden shrink-0 items-center gap-0.5 group-hover:flex"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span
                          data-conv-pin
                          title={c.pinned ? '取消置顶' : '置顶'}
                          onClick={() => onTogglePin(c.id, !c.pinned)}
                          className={`flex h-[22px] w-[22px] items-center justify-center rounded-md transition-colors hover:bg-black/[0.07] dark:hover:bg-white/[0.1] ${
                            c.pinned ? 'text-apple-blue' : 'text-black/35 dark:text-white/35'
                          }`}
                        >
                          <Pin size={12} strokeWidth={2.2} />
                        </span>
                        <span
                          data-conv-delete
                          title="删除"
                          onClick={() => onDelete(c.id)}
                          className="flex h-[22px] w-[22px] items-center justify-center rounded-md text-black/35 transition-colors hover:bg-apple-red/10 hover:text-apple-red dark:text-white/35"
                        >
                          <Trash2 size={12} strokeWidth={2.2} />
                        </span>
                      </span>
                    </>
                  )}
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
          onClick={onOpenSettings}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-black/50 transition-colors hover:bg-black/[0.05] hover:text-black/80 dark:text-white/55 dark:hover:bg-white/[0.08] dark:hover:text-white/90"
        >
          <Settings size={15} strokeWidth={2} />
        </button>
        <div className="relative ml-auto" ref={userMenuRef}>
          <button
            data-user-chip
            onClick={() => setUserMenuOpen((v) => !v)}
            title="用户菜单"
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-apple-blue to-apple-purple text-[11px] font-semibold text-white">
              A
            </div>
            <span className="text-[12.5px] font-medium text-black/70 dark:text-white/75">
              本地用户
            </span>
          </button>

          {userMenuOpen && (
            <div
              data-user-menu
              className="glass-strong animate-scaleIn absolute bottom-11 right-0 z-40 w-52 origin-bottom rounded-2xl p-1.5 shadow-glass"
            >
              <div className="px-3 pb-1.5 pt-1.5">
                <p className="text-[12px] font-medium text-black/75 dark:text-white/80">
                  本地用户
                </p>
                <p
                  data-user-menu-version
                  className="text-[10.5px] text-black/35 dark:text-white/35"
                >
                  Aurora v{appVersion || '0.1.0'}
                </p>
              </div>
              <button
                onClick={() => {
                  setUserMenuOpen(false)
                  void window.aurora.app.openDataDir()
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12.5px] text-black/70 transition-colors hover:bg-black/[0.04] dark:text-white/75 dark:hover:bg-white/[0.06]"
              >
                <FolderOpen size={13} strokeWidth={2} className="shrink-0 text-black/40 dark:text-white/40" />
                打开数据目录
              </button>
              <button
                onClick={() => {
                  setUserMenuOpen(false)
                  window.aurora.app.quit()
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12.5px] text-apple-red/85 transition-colors hover:bg-apple-red/10"
              >
                <LogOut size={13} strokeWidth={2} className="shrink-0" />
                退出 Aurora
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
