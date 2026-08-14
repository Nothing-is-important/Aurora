import { useState } from 'react'
import { Info, Link2, PanelRightClose, Wrench } from 'lucide-react'

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

export default function InspectorPanel() {
  const [tab, setTab] = useState<Tab>('tools')
  const [open, setOpen] = useState(true)

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
    </aside>
  )
}
