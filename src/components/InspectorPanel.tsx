import { useState } from 'react'
import {
  Check,
  FileJson,
  FileText,
  Info,
  Link2,
  PanelRightClose,
  Wrench,
} from 'lucide-react'
import type { ConversationRow } from '../lib/ipc'

type Tab = 'tools' | 'refs' | 'info'

const TABS: { id: Tab; label: string; icon: typeof Wrench }[] = [
  { id: 'tools', label: '工具调用', icon: Wrench },
  { id: 'refs', label: '引用', icon: Link2 },
  { id: 'info', label: '信息', icon: Info },
]

const EMPTY: Record<Tab, { title: string; desc: string }> = {
  tools: {
    title: '暂无工具调用',
    desc: '对话中 Agent 执行的文件、代码、搜索等步骤会显示在这里',
  },
  refs: {
    title: '暂无引用',
    desc: '知识库检索到的文档片段会显示在这里',
  },
  info: {
    title: '会话信息',
    desc: '模型、Token 用量与统计信息会显示在这里',
  },
}

interface InspectorPanelProps {
  conversation: ConversationRow | null
  messageCount: number
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function InspectorPanel({
  conversation,
  messageCount,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<Tab>('tools')
  const [open, setOpen] = useState(true)
  const [exported, setExported] = useState<string | null>(null)

  if (!open) {
    return (
      <aside className="glass relative z-10 flex w-[300px] shrink-0 flex-col items-center border-l border-black/[0.06] pt-3 dark:border-white/[0.08]">
        <button
          onClick={() => setOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-black/45 hover:bg-black/[0.05] dark:text-white/50 dark:hover:bg-white/[0.08]"
        >
          <PanelRightClose size={15} strokeWidth={2} className="rotate-180" />
        </button>
      </aside>
    )
  }

  const empty = EMPTY[tab]

  const doExport = async (format: 'md' | 'json'): Promise<void> => {
    if (!conversation) return
    const r = await window.aurora.conversations.export(conversation.id, format)
    if (r.path) {
      setExported(r.path)
      setTimeout(() => setExported(null), 4000)
    }
  }

  return (
    <aside className="glass relative z-10 flex w-[300px] shrink-0 flex-col border-l border-black/[0.06] dark:border-white/[0.08]">
      <div className="flex items-center gap-1 border-b border-black/[0.05] px-3 pt-3 pb-1.5 dark:border-white/[0.07]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors ${
              tab === t.id
                ? 'bg-black/[0.06] text-black/85 dark:bg-white/[0.1] dark:text-white/90'
                : 'text-black/45 hover:bg-black/[0.04] dark:text-white/45 dark:hover:bg-white/[0.06]'
            }`}
          >
            <t.icon size={14} strokeWidth={2.1} />
            {t.label}
          </button>
        ))}
        <button
          onClick={() => setOpen(false)}
          title="收起面板"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-black/45 transition-colors hover:bg-black/[0.05] dark:text-white/50 dark:hover:bg-white/[0.08]"
        >
          <PanelRightClose size={15} strokeWidth={2} />
        </button>
      </div>

      {tab === 'info' && conversation ? (
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-black/35 dark:text-white/30">
              会话
            </p>
            <p className="text-[13.5px] font-medium leading-snug text-black/80 dark:text-white/85">
              {conversation.title}
            </p>
          </div>
          <div className="space-y-2">
            {[
              ['消息数', `${messageCount} 条`],
              ['创建时间', formatDate(conversation.createdAt)],
              ['最近活动', formatDate(conversation.updatedAt)],
              ['置顶', conversation.pinned ? '是' : '否'],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between text-[12.5px]"
              >
                <span className="text-black/40 dark:text-white/40">{k}</span>
                <span className="text-black/70 dark:text-white/75">{v}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-black/35 dark:text-white/30">
              导出
            </p>
            <div className="space-y-1.5">
              <button
                data-export-md
                onClick={() => void doExport('md')}
                className="flex w-full items-center gap-2.5 rounded-xl bg-black/[0.04] px-3 py-2.5 text-left transition-colors hover:bg-black/[0.07] dark:bg-white/[0.07] dark:hover:bg-white/[0.1]"
              >
                <FileText size={15} strokeWidth={2} className="shrink-0 text-apple-blue" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-black/75 dark:text-white/80">
                    导出 Markdown
                  </span>
                  <span className="block text-[10.5px] text-black/35 dark:text-white/35">
                    含思考过程，适合分享
                  </span>
                </span>
              </button>
              <button
                data-export-json
                onClick={() => void doExport('json')}
                className="flex w-full items-center gap-2.5 rounded-xl bg-black/[0.04] px-3 py-2.5 text-left transition-colors hover:bg-black/[0.07] dark:bg-white/[0.07] dark:hover:bg-white/[0.1]"
              >
                <FileJson size={15} strokeWidth={2} className="shrink-0 text-apple-green" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-black/75 dark:text-white/80">
                    导出 JSON
                  </span>
                  <span className="block text-[10.5px] text-black/35 dark:text-white/35">
                    完整结构化数据
                  </span>
                </span>
              </button>
            </div>
          </div>
          {exported && (
            <div
              data-export-done
              className="flex items-start gap-2 rounded-xl bg-apple-green/10 px-3 py-2 text-[11.5px] text-apple-green"
            >
              <Check size={13} strokeWidth={2.4} className="mt-0.5 shrink-0" />
              <span className="select-text break-all">已导出：{exported}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-8 pb-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/[0.04] text-black/25 dark:bg-white/[0.07] dark:text-white/30">
            {tab === 'tools' ? (
              <Wrench size={19} strokeWidth={1.8} />
            ) : tab === 'refs' ? (
              <Link2 size={19} strokeWidth={1.8} />
            ) : (
              <Info size={19} strokeWidth={1.8} />
            )}
          </div>
          <p className="text-[13px] font-medium text-black/60 dark:text-white/60">
            {empty.title}
          </p>
          <p className="text-[12px] leading-relaxed text-black/35 dark:text-white/35">
            {empty.desc}
          </p>
        </div>
      )}
    </aside>
  )
}
