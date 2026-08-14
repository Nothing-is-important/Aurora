import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MessageSquare,
  Monitor,
  Plus,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react'
import type { ConversationRow, ModelConfig } from '../lib/ipc'

export type PaletteItem =
  | { kind: 'action'; id: string; label: string; hint?: string }
  | { kind: 'model'; id: string; label: string; sub: string }
  | { kind: 'conv'; id: string; label: string; sub: string }

interface CommandPaletteProps {
  open: boolean
  conversations: ConversationRow[]
  models: ModelConfig[]
  modelId: string
  onClose: () => void
  onNewChat: () => void
  onOpenSettings: () => void
  onCycleTheme: () => void
  onSelectConversation: (id: string) => void
  onSelectModel: (id: string) => void
}

const ACTIONS: PaletteItem[] = [
  { kind: 'action', id: 'new', label: '新对话', hint: 'Ctrl N' },
  { kind: 'action', id: 'settings', label: '打开设置', hint: 'Ctrl ,' },
  { kind: 'action', id: 'theme', label: '切换主题', hint: '' },
]

export default function CommandPalette({
  open,
  conversations,
  models,
  modelId,
  onClose,
  onNewChat,
  onOpenSettings,
  onCycleTheme,
  onSelectConversation,
  onSelectModel,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase()
    const convItems: PaletteItem[] = conversations
      .filter((c) => !q || c.title.toLowerCase().includes(q))
      .slice(0, 8)
      .map((c) => ({ kind: 'conv' as const, id: c.id, label: c.title, sub: '会话' }))
    const modelItems: PaletteItem[] = q
      ? models
          .filter((m) => m.name.toLowerCase().includes(q))
          .map((m) => ({
            kind: 'model' as const,
            id: m.id,
            label: `切换到 ${m.name}`,
            sub: m.id === modelId ? '当前' : m.modelId,
          }))
      : models.map((m) => ({
          kind: 'model' as const,
          id: m.id,
          label: `切换到 ${m.name}`,
          sub: m.id === modelId ? '当前' : m.modelId,
        }))
    const actions: PaletteItem[] = q
      ? ACTIONS.filter((a) => a.label.toLowerCase().includes(q))
      : ACTIONS
    return [...actions, ...modelItems, ...convItems]
  }, [query, conversations, models, modelId])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => {
    setSel(0)
  }, [query])

  // Esc 全局兜底：焦点在面板外时也能关闭
  useEffect(() => {
    if (!open) return
    const onWinKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onWinKey)
    return () => window.removeEventListener('keydown', onWinKey)
  }, [open, onClose])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-palette-item][data-sel="true"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel, items])

  if (!open) return null

  const execute = (item: PaletteItem): void => {
    if (item.kind === 'action') {
      if (item.id === 'new') onNewChat()
      else if (item.id === 'settings') onOpenSettings()
      else onCycleTheme()
    } else if (item.kind === 'model') {
      onSelectModel(item.id)
    } else {
      onSelectConversation(item.id)
    }
    onClose()
  }

  const onKey = (e: React.KeyboardEvent): void => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[sel]
      if (item) execute(item)
    }
  }

  const iconFor = (item: PaletteItem): React.ReactNode => {
    if (item.kind === 'action') {
      if (item.id === 'new') return <Plus size={14} strokeWidth={2.2} />
      if (item.id === 'settings') return <Settings size={14} strokeWidth={2.2} />
      return <Monitor size={14} strokeWidth={2.2} />
    }
    if (item.kind === 'model') return <Sparkles size={14} strokeWidth={2.2} />
    return <MessageSquare size={14} strokeWidth={2.2} />
  }

  return (
    <div
      data-command-palette
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/20 pt-[18vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="glass-strong animate-scaleIn w-[560px] overflow-hidden rounded-2xl shadow-glass"
        onKeyDown={onKey}
      >
        <div className="flex items-center gap-2.5 border-b border-black/[0.06] px-4 py-3.5 dark:border-white/[0.08]">
          <Search
            size={16}
            strokeWidth={2.2}
            className="shrink-0 text-black/35 dark:text-white/40"
          />
          <input
            ref={inputRef}
            data-palette-input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话、模型或执行操作…"
            className="flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
          />
          <kbd className="rounded-md border border-black/[0.12] px-1.5 py-0.5 text-[10px] font-medium text-black/40 dark:border-white/[0.15] dark:text-white/40">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[340px] overflow-y-auto py-1.5">
          {items.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-black/40 dark:text-white/40">
              没有匹配的结果
            </p>
          ) : (
            items.map((item, i) => (
              <button
                key={`${item.kind}-${item.id}`}
                data-palette-item
                data-sel={i === sel ? 'true' : 'false'}
                onMouseEnter={() => setSel(i)}
                onClick={() => execute(item)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === sel
                    ? 'bg-apple-blue/10 dark:bg-apple-blue/20'
                    : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    i === sel
                      ? 'bg-apple-blue text-white'
                      : 'bg-black/[0.05] text-black/50 dark:bg-white/[0.08] dark:text-white/55'
                  }`}
                >
                  {iconFor(item)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-black/80 dark:text-white/85">
                    {item.label}
                  </span>
                  {item.sub && (
                    <span className="block truncate text-[11px] text-black/35 dark:text-white/35">
                      {item.sub}
                    </span>
                  )}
                </span>
                {item.kind === 'action' && item.hint && (
                  <span className="shrink-0 text-[11px] text-black/30 dark:text-white/30">
                    {item.hint}
                  </span>
                )}
                {item.kind === 'conv' && (
                  <span className="shrink-0 text-[11px] text-black/30 dark:text-white/30">
                    ↵
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-black/[0.06] px-4 py-2 text-[10.5px] text-black/35 dark:border-white/[0.08] dark:text-white/35">
          <span>↑↓ 导航</span>
          <span>↵ 执行</span>
          <span>esc 关闭</span>
          <span className="ml-auto">Aurora 命令面板</span>
        </div>
      </div>
    </div>
  )
}
