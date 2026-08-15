import { useEffect, useState } from 'react'
import { X, KeyRound, Check, Loader2, FolderOpen, Cpu, Gauge } from 'lucide-react'
import type { LlmState, LlmProviderInfo } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onEngineRestarted: () => void
}

export default function SettingsModal({ open, onClose, onEngineRestarted }: Props) {
  const [llm, setLlm] = useState<LlmState | null>(null)
  const [dshHome, setDshHome] = useState('')
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({})
  const [keyBusy, setKeyBusy] = useState<string | null>(null)
  const [modelBusy, setModelBusy] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState<string | null>(null)
  const [discoverMsg, setDiscoverMsg] = useState<Record<string, string>>({})
  const [homeBusy, setHomeBusy] = useState(false)
  const [homeMsg, setHomeMsg] = useState('')

  const refresh = async () => {
    try {
      setLlm(await window.aurora.llm.state())
    } catch (err) {
      console.error('llm:state failed', err)
    }
  }

  useEffect(() => {
    if (!open) return
    void refresh()
    void window.aurora.appSettings.get().then((s) => setDshHome(s.dshHome ?? ''))
  }, [open])

  if (!open) return null

  const saveKey = async (p: LlmProviderInfo) => {
    const ref = p.apiKeyEnv
    if (!ref) return
    const value = (keyDraft[ref] ?? '').trim()
    if (!value) return
    setKeyBusy(ref)
    try {
      await window.aurora.credentials.set(ref, value)
      setKeyDraft((d) => ({ ...d, [ref]: '' }))
      await refresh()
    } finally {
      setKeyBusy(null)
    }
  }

  const clearKey = async (p: LlmProviderInfo) => {
    const ref = p.apiKeyEnv
    if (!ref) return
    setKeyBusy(ref)
    try {
      await window.aurora.credentials.unset(ref)
      await refresh()
    } finally {
      setKeyBusy(null)
    }
  }

  const selectModel = async (provider: string, model: string) => {
    setModelBusy(`${provider}::${model}`)
    try {
      setLlm(await window.aurora.llm.select(provider, model))
    } finally {
      setModelBusy(null)
    }
  }

  const discover = async (p: LlmProviderInfo) => {
    setDiscovering(p.id)
    setDiscoverMsg((m) => ({ ...m, [p.id]: '' }))
    try {
      const r = await window.aurora.llm.discover(p.id)
      if (r.ok) {
        setLlm((prev) =>
          prev
            ? {
                ...prev,
                providers: prev.providers.map((x) =>
                  x.id === p.id ? { ...x, models: r.models } : x,
                ),
              }
            : prev,
        )
        setDiscoverMsg((m) => ({
          ...m,
          [p.id]:
            r.models.length > 0
              ? `已获取 ${r.models.length} 个模型（${r.elapsedMs}ms，来源：${r.source === 'endpoint' ? '端点' : '内置目录'}）`
              : `未发现模型（${r.elapsedMs}ms）`,
        }))
      } else {
        setDiscoverMsg((m) => ({ ...m, [p.id]: `获取失败：${r.error}` }))
      }
    } finally {
      setDiscovering(null)
    }
  }

  const applyHome = async () => {
    setHomeBusy(true)
    setHomeMsg('')
    try {
      const r = await window.aurora.appSettings.set({ dshHome: dshHome.trim() })
      if (r.restarted) {
        setHomeMsg('已切换数据目录，引擎已重启')
        onEngineRestarted()
      } else if (r.error) {
        setHomeMsg(`失败：${r.error}`)
      } else {
        setHomeMsg('已保存')
      }
    } finally {
      setHomeBusy(false)
    }
  }

  const field =
    'w-full rounded-lg bg-black/[0.045] px-3 py-2 text-[13px] outline-none ring-1 ring-transparent transition-shadow focus:ring-apple-blue/50 dark:bg-white/[0.07]'
  const label = 'mb-1 block text-[11.5px] font-medium text-black/45 dark:text-white/45'

  return (
    <div
      data-settings
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/25 backdrop-blur-[3px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="glass-strong flex h-[540px] w-[700px] flex-col overflow-hidden rounded-3xl shadow-glass">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3.5 dark:border-white/[0.08]">
          <h2 className="text-[15px] font-semibold text-black/85 dark:text-white/90">设置</h2>
          <button
            title="关闭"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-black/45 hover:bg-black/[0.06] dark:text-white/45 dark:hover:bg-white/[0.08]"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {/* 模型供应商 */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-black/70 dark:text-white/70">
              <Cpu size={13} strokeWidth={2.2} /> 模型供应商
            </h3>
            {!llm ? (
              <p className="text-[12px] text-black/40 dark:text-white/40">正在读取引擎模型目录…</p>
            ) : (
              <div className="space-y-3">
                {llm.providers.map((p) => {
                  const ref = p.apiKeyEnv
                  const keyValue = keyDraft[ref ?? ''] ?? ''
                  const busy = keyBusy === ref
                  return (
                    <div
                      key={p.id}
                      data-provider-card
                      className="rounded-xl border border-black/[0.06] p-3 dark:border-white/[0.08]"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-black/80 dark:text-white/85">
                            {p.name}
                          </span>
                          <span
                            className={`rounded px-1.5 py-px text-[9.5px] ${
                              p.hasKey
                                ? 'bg-apple-green/15 text-apple-green'
                                : 'bg-apple-orange/15 text-apple-orange'
                            }`}
                          >
                            {p.hasKey ? '密钥已配置' : '未配置密钥'}
                          </span>
                        </div>
                      </div>

                      {ref ? (
                        <div className="mt-2.5 flex items-center gap-2">
                          <div className="relative flex-1">
                            <KeyRound
                              size={12}
                              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/30"
                            />
                            <input
                              data-api-key
                              type="password"
                              className={`${field} pl-7`}
                              placeholder={
                                p.hasKey ? '已保存（输入新值可覆盖）' : 'API Key，如 sk-…'
                              }
                              value={keyValue}
                              onChange={(e) =>
                                setKeyDraft((d) => ({ ...d, [ref]: e.target.value }))
                              }
                            />
                          </div>
                          <button
                            data-key-save
                            disabled={busy || !keyValue.trim()}
                            onClick={() => void saveKey(p)}
                            className="h-8 shrink-0 rounded-lg bg-apple-blue px-3 text-[12px] font-medium text-white transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
                          >
                            保存
                          </button>
                          {p.hasKey && (
                            <button
                              data-key-clear
                              disabled={busy}
                              onClick={() => void clearKey(p)}
                              className="h-8 shrink-0 rounded-lg bg-black/[0.05] px-3 text-[12px] font-medium text-black/60 transition-colors hover:bg-apple-red/10 hover:text-apple-red dark:bg-white/[0.07] dark:text-white/60"
                            >
                              清除
                            </button>
                          )}
                          <button
                            data-discover
                            disabled={discovering === p.id}
                            onClick={() => void discover(p)}
                            className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-black/[0.05] px-3 text-[12px] font-medium text-black/60 transition-colors hover:bg-black/[0.09] dark:bg-white/[0.07] dark:text-white/60 dark:hover:bg-white/[0.12]"
                          >
                            {discovering === p.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Gauge size={12} />
                            )}
                            测速并获取模型
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 text-[11px] text-black/35 dark:text-white/35">
                          该提供商通过环境变量注入密钥（{p.id}）。
                        </p>
                      )}

                      {discoverMsg[p.id] && (
                        <p className="mt-1.5 text-[11px] text-black/50 dark:text-white/50">
                          {discoverMsg[p.id]}
                        </p>
                      )}

                      {p.models.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {p.models.map((m) => {
                            const active =
                              llm.current.provider === p.id && llm.current.model === m.id
                            const busySel = modelBusy === `${p.id}::${m.id}`
                            return (
                              <button
                                key={m.id}
                                data-model-option
                                title={m.description ?? m.id}
                                onClick={() => void selectModel(p.id, m.id)}
                                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] transition-all ${
                                  active
                                    ? 'bg-apple-blue font-medium text-white'
                                    : 'bg-black/[0.05] text-black/60 hover:bg-black/[0.09] dark:bg-white/[0.07] dark:text-white/60 dark:hover:bg-white/[0.12]'
                                }`}
                              >
                                {busySel && <Loader2 size={11} className="animate-spin" />}
                                {m.name}
                                {m.contextWindow
                                  ? ` · ${Math.round(m.contextWindow / 1024)}K 上下文`
                                  : ''}
                                {m.maxTokens ? ` · 上限 ${m.maxTokens}` : ''}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 数据目录 */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-black/70 dark:text-white/70">
              <FolderOpen size={13} strokeWidth={2.2} /> DSH 数据目录
            </h3>
            <p className="mb-2 text-[11.5px] leading-relaxed text-black/40 dark:text-white/40">
              会话、凭据与配置存于此目录。可指向已有部署（如 F:\.dsh）直接复用其 API Key
              与会话；留空则使用应用自带目录。
            </p>
            <div className="flex items-center gap-2">
              <input
                data-dsh-home
                className={field}
                placeholder="留空 = 应用自带目录"
                value={dshHome}
                onChange={(e) => setDshHome(e.target.value)}
              />
              <button
                data-home-apply
                disabled={homeBusy}
                onClick={() => void applyHome()}
                className="h-9 shrink-0 rounded-lg bg-apple-blue px-4 text-[12.5px] font-medium text-white transition-all hover:brightness-110 active:scale-95 disabled:opacity-60"
              >
                {homeBusy ? <Loader2 size={13} className="animate-spin" /> : '应用'}
              </button>
            </div>
            {homeMsg && <p className="mt-1.5 text-[11px] text-apple-green">{homeMsg}</p>}
          </section>
        </div>
      </div>
    </div>
  )
}
