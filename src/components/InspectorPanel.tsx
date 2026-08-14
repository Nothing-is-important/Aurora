import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ExternalLink,
  FileJson,
  FileText,
  Gauge,
  Info,
  Link2,
  Loader2,
  PanelRightClose,
  Wrench,
  X,
} from 'lucide-react'
import type { ConversationRow, ModelConfig, SearchRef } from '../lib/ipc'
import type { ChatMessage } from '../lib/chat'
import { estimateCost, formatCost, pricingFor } from '../lib/pricing'

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
  messages: ChatMessage[]
  activeModel: ModelConfig | undefined
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function InspectorPanel({
  conversation,
  messageCount,
  messages,
  activeModel,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<Tab>('tools')
  const [open, setOpen] = useState(true)
  const [exported, setExported] = useState<string | null>(null)
  const [convSys, setConvSys] = useState('')
  const [convSysSaved, setConvSysSaved] = useState(false)

  useEffect(() => {
    if (!conversation) return
    setConvSysSaved(false)
    void window.aurora.conversations
      .getSystemPrompt(conversation.id)
      .then((v) => setConvSys(v ?? ''))
  }, [conversation?.id])

  const saveConvSys = async (): Promise<void> => {
    if (!conversation) return
    await window.aurora.conversations.setSystemPrompt(conversation.id, convSys)
    setConvSysSaved(true)
    setTimeout(() => setConvSysSaved(false), 2000)
  }

  // ⚠️ 所有 hooks 必须在 early return 之前：折叠切换改变 hooks 顺序会导致 React 崩溃（黑屏）
  const allRefs = useMemo<SearchRef[]>(() => {
    const map = new Map<string, SearchRef>()
    for (const m of messages) {
      for (const s of m.toolSteps ?? []) {
        for (const r of s.refs ?? []) {
          if (!map.has(r.url)) map.set(r.url, r)
        }
      }
    }
    return [...map.values()]
  }, [messages])

  const doExport = async (format: 'md' | 'json'): Promise<void> => {
    if (!conversation) return
    try {
      const r = await window.aurora.conversations.export(
        conversation.id,
        format,
      )
      if (r.path) {
        setExported(r.path)
        setTimeout(() => setExported(null), 4000)
      }
    } catch (err) {
      setExported(`导出失败：${String(err)}`)
      setTimeout(() => setExported(null), 4000)
    }
  }

  if (!open) {
    return (
      <aside className="glass relative z-10 flex w-10 shrink-0 flex-col items-center border-l border-black/[0.06] pt-2 dark:border-white/[0.08]">
        <button
          aria-label="展开面板"
          onClick={() => setOpen(true)}
          title="展开面板"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-black/45 hover:bg-black/[0.05] dark:text-white/50 dark:hover:bg-white/[0.08]"
        >
          <PanelRightClose size={15} strokeWidth={2} className="rotate-180" />
        </button>
      </aside>
    )
  }

  const empty = EMPTY[tab]

  return (
    <aside
      data-inspector-open
      className="glass relative z-10 flex w-[300px] shrink-0 flex-col border-l border-black/[0.06] dark:border-white/[0.08]"
    >
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
          data-export-md
          title="导出 Markdown"
          disabled={!conversation}
          onClick={() => void doExport('md')}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-black/45 transition-colors hover:bg-black/[0.05] disabled:opacity-30 dark:text-white/50 dark:hover:bg-white/[0.08]"
        >
          <FileText size={14} strokeWidth={2} />
        </button>
        <button
          data-export-json
          title="导出 JSON"
          disabled={!conversation}
          onClick={() => void doExport('json')}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-black/45 transition-colors hover:bg-black/[0.05] disabled:opacity-30 dark:text-white/50 dark:hover:bg-white/[0.08]"
        >
          <FileJson size={14} strokeWidth={2} />
        </button>
        <button
          onClick={() => setOpen(false)}
          title="收起面板"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-black/45 transition-colors hover:bg-black/[0.05] dark:text-white/50 dark:hover:bg-white/[0.08]"
        >
          <PanelRightClose size={15} strokeWidth={2} />
        </button>
      </div>

      {tab === 'info' && conversation ? (
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* 用量总览 */}
          <div data-usage-summary className="rounded-2xl bg-black/[0.04] p-3.5 dark:bg-white/[0.06]">
            <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-black/35 dark:text-white/30">
              <Gauge size={12} strokeWidth={2.2} />
              用量总览
            </p>
            {(() => {
              const totalPrompt = messages.reduce(
                (s, m) => s + (m.usage?.prompt_tokens ?? 0),
                0,
              )
              const totalCompletion = messages.reduce(
                (s, m) => s + (m.usage?.completion_tokens ?? 0),
                0,
              )
              const total = totalPrompt + totalCompletion
              const cost = estimateCost(
                {
                  prompt_tokens: totalPrompt,
                  completion_tokens: totalCompletion,
                  total_tokens: total,
                },
                pricingFor(activeModel),
              )
              return (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Tokens', `${total}`],
                    ['输入 / 输出', `${totalPrompt} / ${totalCompletion}`],
                    ['消息数', `${messageCount}`],
                    ['费用', formatCost(cost)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-white/60 px-2.5 py-2 dark:bg-white/[0.05]">
                      <p className="text-[10px] text-black/35 dark:text-white/35">{k}</p>
                      <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-black/75 dark:text-white/80">
                        {v}
                      </p>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

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
              ['模型', activeModel?.name ?? '—'],
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
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-black/35 dark:text-white/30">
              会话级系统提示词（覆盖全局）
            </p>
            <textarea
              data-conv-sysprompt
              rows={3}
              value={convSys}
              onChange={(e) => setConvSys(e.target.value)}
              placeholder="留空则使用全局提示词"
              className="w-full resize-y rounded-lg bg-black/[0.045] px-3 py-2 font-mono text-[11.5px] leading-relaxed outline-none ring-1 ring-transparent transition-shadow focus:ring-apple-blue/50 dark:bg-white/[0.07]"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                data-conv-sysprompt-save
                onClick={() => void saveConvSys()}
                className="h-7 rounded-lg bg-apple-blue px-3.5 text-[12px] font-medium text-white transition-all duration-200 ease-spring hover:brightness-110 active:scale-[0.96]"
              >
                保存
              </button>
              {convSysSaved && (
                <span className="flex items-center gap-1 text-[11.5px] text-apple-green">
                  <Check size={12} strokeWidth={2.6} /> 已保存
                </span>
              )}
            </div>
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
      ) : tab === 'tools' ? (
        messages.some((m) => m.toolSteps && m.toolSteps.length > 0) ? (
          <div className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
            {messages
              .flatMap((m) => m.toolSteps ?? [])
              .map((s) => (
                <div
                  key={s.id}
                  data-inspector-toolstep
                  className="rounded-xl bg-black/[0.035] px-3 py-2.5 dark:bg-white/[0.05]"
                >
                  <div className="flex items-center gap-2">
                    <Wrench size={12} strokeWidth={2} className="shrink-0 text-apple-blue" />
                    <span className="font-mono text-[11.5px] font-semibold text-black/70 dark:text-white/75">
                      {s.name}
                    </span>
                    <span
                      className={`ml-auto flex items-center gap-1 text-[10.5px] ${
                        s.status === 'done'
                          ? 'text-apple-green'
                          : s.status === 'error'
                            ? 'text-apple-red'
                            : 'text-apple-blue'
                      }`}
                    >
                      {s.status === 'done' ? (
                        <Check size={11} strokeWidth={2.6} />
                      ) : s.status === 'error' ? (
                        <X size={11} strokeWidth={2.6} />
                      ) : (
                        <Loader2 size={11} className="animate-spin" />
                      )}
                      {s.status === 'done' ? '完成' : s.status === 'error' ? '失败' : '执行中'}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-[10.5px] text-black/40 dark:text-white/40">
                    {JSON.stringify(s.args).slice(0, 100)}
                  </p>
                  {s.resultSummary && (
                    <p className="mt-1 line-clamp-3 select-text whitespace-pre-wrap break-all text-[11px] leading-relaxed text-black/55 dark:text-white/55">
                      {s.resultSummary}
                    </p>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-8 pb-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/[0.04] text-black/25 dark:bg-white/[0.07] dark:text-white/30">
              <Wrench size={19} strokeWidth={1.8} />
            </div>
            <p className="text-[13px] font-medium text-black/60 dark:text-white/60">
              暂无工具调用
            </p>
            <p className="text-[12px] leading-relaxed text-black/35 dark:text-white/35">
              对话中 Agent 执行的文件、代码、搜索等步骤会显示在这里
            </p>
          </div>
        )
      ) : tab === 'refs' ? (
        allRefs.length > 0 ? (
          <div className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
            {allRefs.map((r) => (
              <button
                key={r.url}
                data-inspector-ref
                onClick={() => void window.aurora.openExternal(r.url)}
                className="block w-full rounded-xl bg-black/[0.035] px-3 py-2.5 text-left transition-colors hover:bg-black/[0.06] dark:bg-white/[0.05] dark:hover:bg-white/[0.09]"
              >
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-apple-blue">
                  <ExternalLink size={11} strokeWidth={2.2} className="shrink-0" />
                  <span className="truncate">{r.title}</span>
                </span>
                <span className="mt-0.5 block truncate text-[10.5px] text-black/35 dark:text-white/35">
                  {r.url}
                </span>
                {r.snippet && (
                  <span className="mt-1 line-clamp-2 block text-[11px] leading-relaxed text-black/55 dark:text-white/55">
                    {r.snippet}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-8 pb-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/[0.04] text-black/25 dark:bg-white/[0.07] dark:text-white/30">
              <Link2 size={19} strokeWidth={1.8} />
            </div>
            <p className="text-[13px] font-medium text-black/60 dark:text-white/60">
              暂无引用
            </p>
            <p className="text-[12px] leading-relaxed text-black/35 dark:text-white/35">
              联网搜索与网页抓取得到的来源会显示在这里
            </p>
          </div>
        )
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-8 pb-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/[0.04] text-black/25 dark:bg-white/[0.07] dark:text-white/30">
            <Info size={19} strokeWidth={1.8} />
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
