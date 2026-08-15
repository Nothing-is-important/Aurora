import { useEffect, useState } from 'react'
import {
  X,
  KeyRound,
  Check,
  Loader2,
  FolderOpen,
  Cpu,
  Gauge,
  Boxes,
  Play,
  Square,
  Trash2,
  PlugZap,
} from 'lucide-react'
import type { LlmState, LlmProviderInfo, PluginRow } from '../types'

const PLUGIN_TEMPLATE = `// Aurora 动态插件：返回 { meta, apply }
const meta = {
  name: '我的插件',
  version: '1.0.0',
  description: '插件功能简介',
}
function apply(ctx) {
  const tool = harness.defineTool({
    name: 'my_tool',
    description: '工具功能说明（模型会据此决定何时调用）',
    parameters: {
      type: 'object',
      properties: { input: { type: 'string', description: '输入参数' } },
      required: ['input'],
    },
    output: { schema: { type: 'string' }, render: (args, value) => value },
    execute: async (args) => \`处理结果：\${args.input}\`,
  })
  harness.registerTool(ctx, tool)
}
return { meta, apply }
`

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
  const [mcpYaml, setMcpYaml] = useState('')
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpMsg, setMcpMsg] = useState('')
  const [pluginList, setPluginList] = useState<PluginRow[]>([])
  const [pluginCode, setPluginCode] = useState('')
  const [pluginMsg, setPluginMsg] = useState('')
  const [pluginDefineBusy, setPluginDefineBusy] = useState(false)
  const [pluginActionBusy, setPluginActionBusy] = useState<string | null>(null)

  const refreshPlugins = async () => {
    try {
      const r = await window.aurora.plugins.list()
      setPluginList(Array.isArray(r) ? r : [])
    } catch (err) {
      console.error('plugins:list failed', err)
    }
  }

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
    void window.aurora.mcp.get().then(setMcpYaml)
    void refreshPlugins()
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

  const applyMcp = async () => {
    setMcpBusy(true)
    setMcpMsg('')
    try {
      const r = await window.aurora.mcp.set(mcpYaml)
      if (r.restarted) {
        setMcpMsg('已保存并重启引擎')
        onEngineRestarted()
      } else if (r.error) {
        setMcpMsg(`失败：${r.error}`)
      } else {
        setMcpMsg('已保存')
      }
    } finally {
      setMcpBusy(false)
    }
  }

  const definePlugin = async () => {
    if (!pluginCode.trim()) return
    setPluginDefineBusy(true)
    setPluginMsg('')
    try {
      const r = await window.aurora.plugins.define({
        plugin: { kind: 'new', idPrefix: 'auplg' },
        name: 'Aurora 插件',
        purpose: 'Aurora 面板定义的动态插件',
        code: { host: pluginCode },
      })
      setPluginMsg(`已定义：${r.pluginId} / ${r.packageId}（在列表中点击运行）`)
      setPluginCode('')
      await refreshPlugins()
    } catch (err) {
      setPluginMsg(`定义失败：${String(err)}`)
    } finally {
      setPluginDefineBusy(false)
    }
  }

  const pluginAction = async (fn: () => Promise<unknown>) => {
    setPluginMsg('')
    try {
      await fn()
    } catch (err) {
      setPluginMsg(`失败：${String(err)}`)
    }
    await refreshPlugins()
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

          {/* MCP 服务器（组合级配置：cordis.patch.yml） */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-black/70 dark:text-white/70">
              <PlugZap size={13} strokeWidth={2.2} /> MCP 服务器
            </h3>
            <p className="mb-2 text-[11.5px] leading-relaxed text-black/40 dark:text-white/40">
              按 DSH 组合配置编写 `cordis.patch.yml`（每个 MCP 服务器一行插件条目，如
              `@deepseek-ai/dsh-mcp-client`）。保存后引擎自动重启生效。
            </p>
            <textarea
              data-mcp-yaml
              rows={5}
              spellCheck={false}
              value={mcpYaml}
              onChange={(e) => setMcpYaml(e.target.value)}
              placeholder={'# 例：\n# - id: mcp-servers\n#   name: @deepseek-ai/dsh-mcp-client\n#   config:\n#     command: npx\n#     args: ["-y", "@modelcontextprotocol/server-filesystem", "."]'}
              className={`${field} resize-y font-mono text-[11.5px] leading-relaxed`}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                data-mcp-apply
                disabled={mcpBusy}
                onClick={() => void applyMcp()}
                className="h-8 rounded-lg bg-apple-blue px-4 text-[12px] font-medium text-white transition-all hover:brightness-110 active:scale-95 disabled:opacity-60"
              >
                {mcpBusy ? <Loader2 size={12} className="animate-spin" /> : '保存并重启引擎'}
              </button>
              {mcpMsg && <span className="text-[11px] text-black/50 dark:text-white/50">{mcpMsg}</span>}
            </div>
          </section>

          {/* 动态插件（引擎 dynamicCordisRunner） */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-black/70 dark:text-white/70">
              <Boxes size={13} strokeWidth={2.2} /> 动态插件
            </h3>
            <p className="mb-2 text-[11.5px] leading-relaxed text-black/40 dark:text-white/40">
              代码热定义 → 运行 → 停止，插件注册的工具并入 Agent 循环（引擎官方
              dynamicCordisRunner；本地桌面环境审批自动通过）。
            </p>
            <div className="space-y-1.5">
              {pluginList.map((p) => (
                <div
                  key={p.pluginId}
                  data-plugin-row
                  className="flex items-center gap-2 rounded-xl bg-black/[0.035] px-3 py-2 dark:bg-white/[0.05]"
                >
                  <Boxes size={12} strokeWidth={2} className="shrink-0 text-apple-blue" />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-black/75 dark:text-white/80">
                    {p.name}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-px text-[9.5px] ${
                      p.status === 'running'
                        ? 'bg-apple-green/15 text-apple-green'
                        : 'bg-black/[0.05] text-black/40 dark:bg-white/[0.08] dark:text-white/40'
                    }`}
                  >
                    {p.status ?? 'defined'}
                  </span>
                  <button
                    data-plugin-run
                    title="运行"
                    disabled={pluginActionBusy === p.pluginId}
                    onClick={() =>
                      void pluginAction(() =>
                        window.aurora.plugins.run(p.pluginId, p.currentPackageId ?? ''),
                      )
                    }
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-apple-green transition-colors hover:bg-apple-green/10"
                  >
                    <Play size={11} strokeWidth={2.4} />
                  </button>
                  <button
                    data-plugin-stop
                    title="停止"
                    onClick={() =>
                      void pluginAction(() => window.aurora.plugins.stop(p.pluginId))
                    }
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-apple-orange transition-colors hover:bg-apple-orange/10"
                  >
                    <Square size={10} strokeWidth={2.4} />
                  </button>
                  <button
                    data-plugin-remove
                    title="删除"
                    onClick={() =>
                      void pluginAction(() => window.aurora.plugins.undefine(p.pluginId))
                    }
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-black/35 transition-colors hover:bg-apple-red/10 hover:text-apple-red dark:text-white/35"
                  >
                    <Trash2 size={11} strokeWidth={2.2} />
                  </button>
                </div>
              ))}
            </div>
            <textarea
              data-plugin-code
              rows={8}
              spellCheck={false}
              value={pluginCode}
              onChange={(e) => setPluginCode(e.target.value)}
              placeholder={PLUGIN_TEMPLATE}
              className={`${field} mt-2 resize-y font-mono text-[11.5px] leading-relaxed`}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                data-plugin-define
                disabled={pluginDefineBusy || !pluginCode.trim()}
                onClick={() => void definePlugin()}
                className="h-8 rounded-lg bg-apple-blue px-4 text-[12px] font-medium text-white transition-all hover:brightness-110 active:scale-95 disabled:opacity-60"
              >
                {pluginDefineBusy ? <Loader2 size={12} className="animate-spin" /> : '定义插件'}
              </button>
              {pluginMsg && <span className="text-[11px] text-black/50 dark:text-white/50">{pluginMsg}</span>}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
