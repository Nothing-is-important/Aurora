import { useEffect, useState } from 'react'
import {
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FolderPlus,
  Loader2,
  Play,
  Plus,
  PlugZap,
  RefreshCw,
  Server,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import type { ModelConfig, McpServerConfig, KbRow, PluginRow } from '../lib/ipc'
import { loadCustomModes, saveCustomModes } from '../lib/modes'
import type { ChatMode } from '../lib/modes'

interface SettingsModalProps {
  open: boolean
  models: ModelConfig[]
  onClose: () => void
  onChanged: () => void
  onModesChanged?: () => void
}

const PROVIDERS: { id: ModelConfig['provider']; label: string }[] = [
  { id: 'deepseek', label: 'DeepSeek 官方' },
  { id: 'openai', label: 'OpenAI 兼容' },
  { id: 'mock', label: '本地 Mock' },
]

function emptyModel(): ModelConfig {
  return {
    id: `custom-${Date.now().toString(36)}`,
    name: '新模型',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    modelId: '',
    temperature: 1,
    maxTokens: 4096,
    topP: 1,
    enabled: true,
  }
}

export default function SettingsModal({
  open,
  models,
  onClose,
  onChanged,
  onModesChanged,
}: SettingsModalProps) {
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState<ModelConfig>(emptyModel())
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    message?: string
    models?: number | null
    modelIds?: string[]
  } | null>(null)
  const [saving, setSaving] = useState(false)
  /** 未保存的新模型草稿（点击 + 后立即出现在左侧列表，带「未保存」徽标） */
  const [draftModel, setDraftModel] = useState<ModelConfig | null>(null)
  const [sysPrompt, setSysPrompt] = useState('')
  const [sysSaved, setSysSaved] = useState(false)
  const [whitelistText, setWhitelistText] = useState('')
  const [wlSaved, setWlSaved] = useState(false)
  const [proxyUrl, setProxyUrl] = useState('')
  const [proxySaved, setProxySaved] = useState(false)
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([])
  const [mcpMsg, setMcpMsg] = useState<string | null>(null)
  const [mcpName, setMcpName] = useState('')
  const [mcpCmd, setMcpCmd] = useState('')
  const [mcpArgs, setMcpArgs] = useState('')
  const [kbList, setKbList] = useState<KbRow[]>([])
  const [appVersion, setAppVersion] = useState('')
  const [customModes, setCustomModes] = useState<ChatMode[]>([])
  const [pluginList, setPluginList] = useState<PluginRow[]>([])
  const [pluginCode, setPluginCode] = useState('')
  const [pluginMsg, setPluginMsg] = useState<string | null>(null)

  const loadPlugins = async (): Promise<void> => {
    setPluginList(await window.aurora.plugins.list())
  }

  const createAndRunPlugin = async (): Promise<void> => {
    const code = pluginCode.trim()
    if (!code) return
    const id = `plugin-${Date.now().toString(36)}`
    await window.aurora.plugins.define(id, code)
    const r = await window.aurora.plugins.run(id)
    setPluginCode('')
    setPluginMsg(r.ok ? '插件已保存并运行' : `运行失败：${r.error ?? '未知错误'}`)
    setTimeout(() => setPluginMsg(null), 4000)
    void loadPlugins()
  }

  const pluginAction = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
    } catch (err) {
      setPluginMsg(`失败：${String(err)}`)
      setTimeout(() => setPluginMsg(null), 3000)
    }
    void loadPlugins()
  }

  const reloadCustomModes = async (): Promise<void> => {
    setCustomModes(await loadCustomModes())
    onModesChanged?.()
  }

  const updateModes = async (next: ChatMode[]): Promise<void> => {
    await saveCustomModes(next)
    setCustomModes(next)
    onModesChanged?.()
  }

  const addMode = (): void => {
    const m: ChatMode = {
      id: `mode-${Date.now().toString(36)}`,
      name: '新模式',
      desc: '',
      systemPrompt: '',
      toolsEnabled: false,
    }
    void updateModes([...customModes, m])
  }

  const patchMode = (id: string, patch: Partial<ChatMode>): void => {
    void updateModes(customModes.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  useEffect(() => {
    void window.aurora.app.getVersion().then(setAppVersion)
  }, [])

  const loadKb = (): void => {
    void window.aurora.kb.list().then(setKbList)
  }

  const loadMcp = (): void => {
    void window.aurora.settings.get('mcpServers').then((v) => {
      try {
        const arr = v ? JSON.parse(v) : []
        setMcpServers(Array.isArray(arr) ? arr : [])
      } catch {
        setMcpServers([])
      }
    })
  }

  useEffect(() => {
    if (open) {
      void window.aurora.settings.get('systemPrompt').then((v) => {
        setSysPrompt(v ?? '')
        setSysSaved(false)
      })
      void window.aurora.settings.get('shellWhitelist').then((v) => {
        try {
          const arr = v ? JSON.parse(v) : []
          setWhitelistText(Array.isArray(arr) ? arr.join('\n') : '')
        } catch {
          setWhitelistText('')
        }
        setWlSaved(false)
      })
      void window.aurora.settings.get('proxyUrl').then((v) => {
        setProxyUrl(v ?? '')
        setProxySaved(false)
      })
      loadMcp()
      loadKb()
      void reloadCustomModes()
      void loadPlugins()
    }
  }, [open])

  const addKb = async (): Promise<void> => {
    const row = await window.aurora.kb.addFolder()
    if (row) loadKb()
  }

  const applyMcp = async (list: McpServerConfig[]): Promise<void> => {
    setMcpServers(list)
    const r = await window.aurora.mcp.configure(list)
    setMcpMsg(
      r.errors.length
        ? `失败：${r.errors.join('；')}`
        : `已连接 ${r.connected.length} 个 MCP 服务器`,
    )
    setTimeout(() => setMcpMsg(null), 3000)
  }

  const addMcp = (): void => {
    const name = mcpName.trim()
    const cmd = mcpCmd.trim()
    if (!name || !cmd) return
    const next = [
      ...mcpServers,
      {
        id: `mcp-${Date.now().toString(36)}`,
        name,
        command: cmd,
        args: mcpArgs.trim() ? mcpArgs.trim().split(/\s+/) : [],
        enabled: true,
      },
    ]
    setMcpName('')
    setMcpCmd('')
    setMcpArgs('')
    void applyMcp(next)
  }

  const saveSysPrompt = async (): Promise<void> => {
    await window.aurora.settings.set('systemPrompt', sysPrompt)
    setSysSaved(true)
    setTimeout(() => setSysSaved(false), 2000)
  }

  const saveWhitelist = async (): Promise<void> => {
    const list = whitelistText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    await window.aurora.settings.set('shellWhitelist', JSON.stringify(list))
    setWlSaved(true)
    setTimeout(() => setWlSaved(false), 2000)
  }

  const saveProxy = async (): Promise<void> => {
    await window.aurora.settings.set('proxyUrl', proxyUrl.trim())
    setProxySaved(true)
    setTimeout(() => setProxySaved(false), 2000)
  }

  useEffect(() => {
    if (!open) {
      // 关闭弹窗时丢弃未保存草稿
      setDraftModel(null)
      return
    }
    if (
      models.length > 0 &&
      !models.find((m) => m.id === selectedId) &&
      selectedId !== draftModel?.id
    ) {
      const first = models.find((m) => m.provider !== 'mock') ?? models[0]
      selectModel(first)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, models, draftModel?.id])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const selectModel = (m: ModelConfig): void => {
    setSelectedId(m.id)
    setForm({ ...m })
    setTestResult(null)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    await window.aurora.models.save(form)
    setSaving(false)
    if (draftModel && draftModel.id === selectedId) {
      // 草稿转正：清除临时条目，列表刷新后自动选中正式条目
      setDraftModel(null)
      setSelectedId(form.id)
    }
    onChanged()
  }

  const addNew = (): void => {
    const m = emptyModel()
    setDraftModel(m)
    setSelectedId(m.id)
    setForm(m)
    setTestResult(null)
  }

  const remove = async (): Promise<void> => {
    if (draftModel && draftModel.id === selectedId) {
      // 删除未保存草稿：直接丢弃，回到已保存列表第一项
      setDraftModel(null)
      setForm(models[0] ?? emptyModel())
      setSelectedId(models[0]?.id ?? '')
      setTestResult(null)
      return
    }
    if (form.provider === 'mock') return
    await window.aurora.models.remove(form.id)
    setSelectedId('')
    onChanged()
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    const r = await window.aurora.models.test(form)
    setTestResult(r)
    setTesting(false)
  }

  /** 一键添加端点返回的模型（ccswitch 式自动获取） */
  const addFetchedModel = async (modelId: string): Promise<void> => {
    await window.aurora.models.save({
      ...form,
      id: modelId,
      name: modelId,
      enabled: true,
    })
    onChanged()
    setTestResult((prev) =>
      prev
        ? { ...prev, modelIds: (prev.modelIds ?? []).filter((x) => x !== modelId) }
        : prev,
    )
  }

  const addAllFetched = async (): Promise<void> => {
    const ids = testResult?.modelIds ?? []
    for (const id of ids) {
      await window.aurora.models.save({
        ...form,
        id,
        name: id,
        enabled: true,
      })
    }
    onChanged()
    setTestResult((prev) => (prev ? { ...prev, modelIds: [] } : prev))
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
      <div className="glass-strong animate-scaleIn flex h-[540px] w-[760px] flex-col overflow-hidden rounded-3xl shadow-glass">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3.5 dark:border-white/[0.08]">
          <h2 className="text-[15px] font-semibold text-black/85 dark:text-white/90">
            设置
          </h2>
          <button
            aria-label="关闭设置"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.05] text-black/55 transition-colors hover:bg-black/[0.09] dark:bg-white/[0.08] dark:text-white/60 dark:hover:bg-white/[0.12]"
          >
            <X size={14} strokeWidth={2.4} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 模型列表 */}
          <div className="flex w-60 shrink-0 flex-col border-r border-black/[0.06] p-2.5 dark:border-white/[0.08]">
            <div className="flex items-center justify-between px-2 pb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-black/35 dark:text-white/30">
                模型
              </span>
              <button
                onClick={addNew}
                data-settings-add
                title="添加模型"
                className="flex h-6 w-6 items-center justify-center rounded-md text-black/45 transition-colors hover:bg-black/[0.06] hover:text-apple-blue dark:text-white/45 dark:hover:bg-white/[0.08]"
              >
                <Plus size={13} strokeWidth={2.4} />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {models.map((m) => (
                <button
                  key={m.id}
                  data-settings-model
                  onClick={() => selectModel(m)}
                  className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    m.id === selectedId
                      ? 'bg-apple-blue/10 dark:bg-apple-blue/20'
                      : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      m.enabled
                        ? m.provider === 'mock' || m.apiKey
                          ? 'bg-apple-green'
                          : 'bg-apple-orange'
                        : 'bg-black/25 dark:bg-white/30'
                    }`}
                    title={m.enabled ? '已启用' : '已停用'}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[12.5px] font-medium ${
                        m.id === selectedId
                          ? 'text-apple-blue dark:text-[#7ab8ff]'
                          : 'text-black/75 dark:text-white/75'
                      }`}
                    >
                      {m.name}
                    </span>
                    <span className="block truncate text-[10.5px] text-black/35 dark:text-white/35">
                      {m.modelId || '未设置模型 ID'}
                    </span>
                  </span>
                  {m.id === selectedId && (
                    <Check size={12} strokeWidth={2.6} className="shrink-0 text-apple-blue" />
                  )}
                </button>
              ))}
              {/* 未保存的新模型草稿：加号后立即出现，带醒目徽标 */}
              {draftModel && (
                <button
                  key={draftModel.id}
                  data-settings-model
                  onClick={() => selectModel(draftModel)}
                  className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    draftModel.id === selectedId
                      ? 'bg-apple-blue/10 dark:bg-apple-blue/20'
                      : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-apple-orange" />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[12.5px] font-medium ${
                        draftModel.id === selectedId
                          ? 'text-apple-blue dark:text-[#7ab8ff]'
                          : 'text-black/75 dark:text-white/75'
                      }`}
                    >
                      {form.name.trim() || '新模型'}
                    </span>
                    <span className="flex items-center gap-1 text-[10.5px] text-apple-orange">
                      <span
                        data-unsaved-badge
                        className="rounded bg-apple-orange/15 px-1 py-px font-medium"
                      >
                        未保存
                      </span>
                      <span className="truncate text-black/35 dark:text-white/35">
                        {form.provider === 'mock' ? '本地 Mock' : form.modelId || '待配置'}
                      </span>
                    </span>
                  </span>
                  {draftModel.id === selectedId && (
                    <Check size={12} strokeWidth={2.6} className="shrink-0 text-apple-blue" />
                  )}
                </button>
              )}
            </div>
          </div>

          {/* 编辑表单 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-3.5">
              <div>
                <label className={label}>
                  系统提示词（全局默认，会话级覆盖优先）
                </label>
                <textarea
                  data-sysprompt-input
                  rows={3}
                  value={sysPrompt}
                  onChange={(e) => setSysPrompt(e.target.value)}
                  placeholder="为空则不注入系统提示词；可从输入区模板菜单快速套用"
                  className={`${field} resize-y font-mono text-[12px] leading-relaxed`}
                />
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    data-sysprompt-save
                    onClick={() => void saveSysPrompt()}
                    className="h-7 rounded-lg bg-apple-blue px-3.5 text-[12px] font-medium text-white transition-all duration-200 ease-spring hover:brightness-110 active:scale-[0.96]"
                  >
                    保存
                  </button>
                  {sysSaved && (
                    <span className="flex items-center gap-1 text-[11.5px] text-apple-green">
                      <Check size={12} strokeWidth={2.6} /> 已保存
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-3 text-[11px] text-black/35 dark:text-white/35">
                    <button
                      data-open-datadir
                      onClick={() => void window.aurora.app.openDataDir()}
                      className="transition-colors hover:text-apple-blue"
                    >
                      打开数据目录
                    </button>
                    <span data-app-version>v{appVersion || '0.1.0'}</span>
                  </div>
                </div>
              </div>

              <div>
                <label className={label}>
                  系统命令白名单（每行一条，前缀匹配；以 * 结尾表示前缀通配）
                </label>
                <textarea
                  data-shell-whitelist
                  rows={4}
                  value={whitelistText}
                  onChange={(e) => setWhitelistText(e.target.value)}
                  placeholder={'git \nnpm \necho'}
                  className={`${field} resize-y font-mono text-[12px] leading-relaxed`}
                />
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    onClick={() => void saveWhitelist()}
                    className="h-7 rounded-lg bg-apple-blue px-3.5 text-[12px] font-medium text-white transition-all duration-200 ease-spring hover:brightness-110 active:scale-[0.96]"
                  >
                    保存
                  </button>
                  {wlSaved && (
                    <span className="flex items-center gap-1 text-[11.5px] text-apple-green">
                      <Check size={12} strokeWidth={2.6} /> 已保存
                    </span>
                  )}
                  <span className="text-[11px] text-black/35 dark:text-white/35">
                    白名单内的命令执行时不再弹窗确认
                  </span>
                </div>
              </div>

              <div>
                <label className={label}>
                  网络代理（HTTP 代理，如 http://127.0.0.1:7890；留空直连）
                </label>
                <div className="flex items-center gap-2">
                  <input
                    data-proxy-input
                    className={`${field} flex-1`}
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    placeholder="http://127.0.0.1:7890"
                  />
                  <button
                    onClick={() => void saveProxy()}
                    className="h-8 rounded-lg bg-apple-blue px-3.5 text-[12px] font-medium text-white transition-all duration-200 ease-spring hover:brightness-110 active:scale-[0.96]"
                  >
                    保存
                  </button>
                  {proxySaved && (
                    <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-apple-green">
                      <Check size={12} strokeWidth={2.6} /> 已保存
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-black/35 dark:text-white/35">
                  应用于模型请求、联网搜索与网页抓取
                </p>
              </div>

              <div>
                <label className={label}>MCP 服务器（stdio 启动）</label>
                <div className="space-y-1.5">
                  {mcpServers.length === 0 && (
                    <p className="rounded-lg bg-black/[0.03] px-3 py-2.5 text-[11.5px] text-black/40 dark:bg-white/[0.05] dark:text-white/40">
                      暂无 MCP 服务器。示例：npx -y @modelcontextprotocol/server-filesystem C:\path
                    </p>
                  )}
                  {mcpServers.map((s) => (
                    <div
                      key={s.id}
                      data-mcp-row
                      className="flex items-center gap-2 rounded-xl bg-black/[0.035] px-3 py-2 dark:bg-white/[0.05]"
                    >
                      <Server size={13} strokeWidth={2} className="shrink-0 text-apple-blue" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium text-black/75 dark:text-white/80">
                          {s.name}
                        </span>
                        <span className="block truncate font-mono text-[10.5px] text-black/35 dark:text-white/35">
                          {s.command} {s.args.join(' ')}
                        </span>
                      </span>
                      <span
                        onClick={() =>
                          void applyMcp(
                            mcpServers.map((x) =>
                              x.id === s.id ? { ...x, enabled: !x.enabled } : x,
                            ),
                          )
                        }
                        className={`relative h-4.5 w-8 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
                          s.enabled ? 'bg-apple-green' : 'bg-black/20 dark:bg-white/20'
                        }`}
                        style={{ height: 18, width: 32 }}
                      >
                        <span
                          className="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-soft transition-all duration-200"
                          style={{
                            left: s.enabled ? 15 : 2,
                            height: 14,
                            width: 14,
                          }}
                        />
                      </span>
                      <button
                        onClick={() => void applyMcp(mcpServers.filter((x) => x.id !== s.id))}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-black/35 transition-colors hover:bg-apple-red/10 hover:text-apple-red dark:text-white/35"
                      >
                        <Trash2 size={12} strokeWidth={2.2} />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <input
                      data-mcp-name
                      className={`${field} !w-24`}
                      value={mcpName}
                      onChange={(e) => setMcpName(e.target.value)}
                      placeholder="名称"
                    />
                    <input
                      data-mcp-cmd
                      className={`${field} flex-1`}
                      value={mcpCmd}
                      onChange={(e) => setMcpCmd(e.target.value)}
                      placeholder="npx / node / uvx"
                    />
                    <input
                      className={`${field} flex-1`}
                      value={mcpArgs}
                      onChange={(e) => setMcpArgs(e.target.value)}
                      placeholder="参数（空格分隔）"
                    />
                    <button
                      onClick={addMcp}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-apple-blue/10 text-apple-blue transition-colors hover:bg-apple-blue/20"
                    >
                      <Plus size={14} strokeWidth={2.6} />
                    </button>
                  </div>
                  {mcpMsg && (
                    <p
                      data-mcp-msg
                      className="text-[11.5px] text-black/45 dark:text-white/45"
                    >
                      {mcpMsg}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className={label}>知识库（本地索引，文档不出本机）</label>
                <div className="space-y-1.5">
                  {kbList.length === 0 && (
                    <p className="rounded-lg bg-black/[0.03] px-3 py-2.5 text-[11.5px] text-black/40 dark:bg-white/[0.05] dark:text-white/40">
                      暂无知识库。添加文件夹后，对话中可用「检索知识库」能力引用其中的文档。
                    </p>
                  )}
                  {kbList.map((k) => (
                    <div
                      key={k.id}
                      data-kb-row
                      className="flex items-center gap-2 rounded-xl bg-black/[0.035] px-3 py-2 dark:bg-white/[0.05]"
                    >
                      <BookOpen size={13} strokeWidth={2} className="shrink-0 text-apple-purple" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium text-black/75 dark:text-white/80">
                          {k.name}
                        </span>
                        <span className="block truncate text-[10.5px] text-black/35 dark:text-white/35">
                          {k.fileCount} 个文件 · {k.path}
                        </span>
                      </span>
                      <button
                        title="重建索引"
                        onClick={() =>
                          void window.aurora.kb.rebuild(k.id).then(() => loadKb())
                        }
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-black/35 transition-colors hover:bg-black/[0.06] hover:text-black/70 dark:text-white/35 dark:hover:bg-white/[0.1]"
                      >
                        <RefreshCw size={12} strokeWidth={2.2} />
                      </button>
                      <button
                        title="移除知识库"
                        onClick={() =>
                          void window.aurora.kb.remove(k.id).then(() => loadKb())
                        }
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-black/35 transition-colors hover:bg-apple-red/10 hover:text-apple-red dark:text-white/35"
                      >
                        <Trash2 size={12} strokeWidth={2.2} />
                      </button>
                    </div>
                  ))}
                  <button
                    data-kb-add
                    onClick={() => void addKb()}
                    className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-black/[0.04] text-[12px] font-medium text-black/60 transition-colors hover:bg-black/[0.07] dark:bg-white/[0.07] dark:text-white/65 dark:hover:bg-white/[0.11]"
                  >
                    <FolderPlus size={13} strokeWidth={2.2} />
                    添加文件夹…
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className={label}>自定义模式（对话区顶部切换）</label>
                  <button
                    data-mode-add
                    onClick={addMode}
                    title="添加模式"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-black/45 transition-colors hover:bg-black/[0.06] hover:text-apple-blue dark:text-white/45 dark:hover:bg-white/[0.08]"
                  >
                    <Plus size={13} strokeWidth={2.4} />
                  </button>
                </div>
                <div className="space-y-1.5">
                  {customModes.length === 0 && (
                    <p className="rounded-lg bg-black/[0.03] px-3 py-2.5 text-[11.5px] text-black/40 dark:bg-white/[0.05] dark:text-white/40">
                      暂无自定义模式。内置模式（普通对话/编程助手/写作助手/Agent 完整模式）已可用；点右上角 + 创建自己的模式。
                    </p>
                  )}
                  {customModes.map((m) => (
                    <div
                      key={m.id}
                      data-custom-mode
                      className="rounded-xl bg-black/[0.035] px-3 py-2 dark:bg-white/[0.05]"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          className="min-w-0 flex-1 rounded-md bg-transparent text-[12.5px] font-medium text-black/75 outline-none dark:text-white/80"
                          value={m.name}
                          onChange={(e) => patchMode(m.id, { name: e.target.value })}
                        />
                        <span
                          onClick={() =>
                            patchMode(m.id, { toolsEnabled: !m.toolsEnabled })
                          }
                          title="是否启用工具"
                          className={`shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
                            m.toolsEnabled ? 'bg-apple-green' : 'bg-black/20 dark:bg-white/20'
                          }`}
                          style={{ height: 18, width: 32 }}
                        >
                          <span
                            className="block rounded-full bg-white shadow-soft transition-all duration-200"
                            style={{
                              height: 14,
                              width: 14,
                              marginTop: 2,
                              marginLeft: m.toolsEnabled ? 15 : 2,
                            }}
                          />
                        </span>
                        <span className="shrink-0 text-[10.5px] text-black/35 dark:text-white/35">
                          {m.toolsEnabled ? '工具开' : '工具关'}
                        </span>
                        <button
                          onClick={() =>
                            void updateModes(customModes.filter((x) => x.id !== m.id))
                          }
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-black/35 transition-colors hover:bg-apple-red/10 hover:text-apple-red dark:text-white/35"
                        >
                          <Trash2 size={12} strokeWidth={2.2} />
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        className="mt-1.5 w-full resize-y rounded-lg bg-black/[0.04] px-2 py-1.5 font-mono text-[11.5px] leading-relaxed text-black/65 outline-none dark:bg-white/[0.06] dark:text-white/70"
                        placeholder="该模式的系统提示词（留空则不注入）"
                        value={m.systemPrompt}
                        onChange={(e) =>
                          patchMode(m.id, { systemPrompt: e.target.value })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className={label}>
                  动态插件（DPS · 代码热定义 / 运行 / 停止）
                </label>
                <div className="space-y-1.5">
                  {pluginList.length === 0 && (
                    <p className="rounded-lg bg-black/[0.03] px-3 py-2.5 text-[11.5px] text-black/40 dark:bg-white/[0.05] dark:text-white/40">
                      暂无插件。在下方粘贴插件代码并「保存并运行」，插件注册的工具会并入 Agent 循环。
                    </p>
                  )}
                  {pluginList.map((p) => (
                    <div
                      key={p.id}
                      data-plugin-row
                      className="rounded-xl bg-black/[0.035] px-3 py-2 dark:bg-white/[0.05]"
                    >
                      <div className="flex items-center gap-2">
                        <Boxes size={13} strokeWidth={2} className="shrink-0 text-apple-blue" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium text-black/75 dark:text-white/80">
                            {p.name}
                            <span className="ml-1.5 font-mono text-[10px] text-black/35 dark:text-white/35">
                              v{p.version}
                            </span>
                          </span>
                          <span className="block truncate text-[10.5px] text-black/35 dark:text-white/35">
                            {p.description || '无描述'}
                          </span>
                        </span>
                        <span
                          data-plugin-status
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            p.status === 'running'
                              ? 'bg-apple-green'
                              : p.status === 'error'
                                ? 'bg-apple-red'
                                : p.status === 'defined'
                                  ? 'bg-apple-blue'
                                  : 'bg-black/25 dark:bg-white/30'
                          }`}
                          title={p.status}
                        />
                        {p.status !== 'running' ? (
                          <button
                            data-plugin-run
                            title="运行"
                            onClick={() =>
                              void pluginAction(() => window.aurora.plugins.run(p.id))
                            }
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-black/40 transition-colors hover:bg-apple-green/10 hover:text-apple-green dark:text-white/40"
                          >
                            <Play size={12} strokeWidth={2.4} />
                          </button>
                        ) : (
                          <button
                            title="停止"
                            onClick={() =>
                              void pluginAction(() => window.aurora.plugins.stop(p.id))
                            }
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-black/40 transition-colors hover:bg-apple-orange/10 hover:text-apple-orange dark:text-white/40"
                          >
                            <Square size={11} strokeWidth={2.4} />
                          </button>
                        )}
                        <button
                          title="删除"
                          onClick={() =>
                            void pluginAction(() => window.aurora.plugins.remove(p.id))
                          }
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-black/35 transition-colors hover:bg-apple-red/10 hover:text-apple-red dark:text-white/35"
                        >
                          <Trash2 size={12} strokeWidth={2.2} />
                        </button>
                      </div>
                      {p.status === 'error' && p.error && (
                        <p className="mt-1 select-text break-all font-mono text-[10.5px] leading-relaxed text-apple-red/80">
                          {p.error}
                        </p>
                      )}
                    </div>
                  ))}
                  <textarea
                    data-plugin-code
                    rows={6}
                    value={pluginCode}
                    onChange={(e) => setPluginCode(e.target.value)}
                    placeholder={`// 插件代码：返回 { meta, setup(api) }，setup 中用 api.registerTool 注册工具\nconst meta = { name: '我的插件', version: '1.0.0', description: '…' }\nfunction setup(api) {\n  api.registerTool({\n    name: 'my_tool',\n    description: '…',\n    handler: (args) => '结果',\n  })\n}\nreturn { meta, setup }`}
                    className="w-full resize-y rounded-lg bg-black/[0.04] px-3 py-2 font-mono text-[11px] leading-relaxed text-black/70 outline-none ring-1 ring-transparent transition-shadow focus:ring-apple-blue/50 dark:bg-white/[0.07] dark:text-white/75"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      data-plugin-create
                      onClick={() => void createAndRunPlugin()}
                      className="h-8 rounded-lg bg-apple-blue px-4 text-[12px] font-medium text-white transition-all duration-200 ease-spring hover:brightness-110 active:scale-[0.96]"
                    >
                      保存并运行
                    </button>
                    {pluginMsg && (
                      <span className="text-[11.5px] text-black/45 dark:text-white/45">
                        {pluginMsg}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>显示名称</label>
                  <input
                    data-settings-name
                    className={field}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className={label}>提供方</label>
                  <select
                    className={field}
                    value={form.provider}
                    disabled={form.provider === 'mock'}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        provider: e.target.value as ModelConfig['provider'],
                      })
                    }
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {form.provider !== 'mock' && (
                <>
                  <div>
                    <label className={label}>Base URL</label>
                    <input
                      data-settings-baseurl
                      className={field}
                      value={form.baseUrl}
                      onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                      placeholder="https://api.deepseek.com/v1"
                    />
                  </div>
                  <div>
                    <label className={label}>API Key（本地 DPAPI 加密存储）</label>
                    <div className="relative">
                      <input
                        data-settings-apikey
                        className={`${field} pr-9`}
                        type={showKey ? 'text' : 'password'}
                        value={form.apiKey}
                        onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                        placeholder="sk-..."
                      />
                      <button
                        onClick={() => setShowKey((v) => !v)}
                        className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-black/40 hover:bg-black/[0.05] dark:text-white/40 dark:hover:bg-white/[0.08]"
                      >
                        {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className={label}>模型 ID</label>
                    <input
                      data-settings-modelid
                      className={field}
                      value={form.modelId}
                      onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                      placeholder="deepseek-chat"
                    />
                  </div>
                </>
              )}

              <details className="group/adv rounded-xl bg-black/[0.03] px-3 py-2 dark:bg-white/[0.04]">
                <summary className="flex cursor-pointer list-none items-center text-[12px] font-medium text-black/50 outline-none [&::-webkit-details-marker]:hidden dark:text-white/50">
                  <ChevronDown
                    size={13}
                    strokeWidth={2.2}
                    className="mr-1 transition-transform duration-200 group-open/adv:rotate-180"
                  />
                  高级设置
                  <span className="ml-2 text-[10.5px] font-normal text-black/30 dark:text-white/30">
                    Temperature · Max Tokens · Top P（默认即可，一般无需修改）
                  </span>
                </summary>
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <div>
                    <label className={label}>Temperature</label>
                    <input
                      className={field}
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={form.temperature}
                      onChange={(e) =>
                        setForm({ ...form, temperature: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <label className={label}>Max Tokens</label>
                    <input
                      className={field}
                      type="number"
                      min={1}
                      step={256}
                      value={form.maxTokens}
                      onChange={(e) =>
                        setForm({ ...form, maxTokens: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <label className={label}>Top P</label>
                    <input
                      className={field}
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={form.topP}
                      onChange={(e) => setForm({ ...form, topP: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </details>

              <label className="flex cursor-pointer items-center gap-2.5">
                <span
                  onClick={() => setForm({ ...form, enabled: !form.enabled })}
                  className={`relative h-5 w-9 rounded-full transition-colors duration-200 ${
                    form.enabled ? 'bg-apple-green' : 'bg-black/20 dark:bg-white/20'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-soft transition-all duration-200 ${
                      form.enabled ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </span>
                <span className="text-[12.5px] text-black/60 dark:text-white/60">
                  启用该模型
                </span>
              </label>

              {testResult && (
                <div
                  data-settings-testresult
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] ${
                    testResult.ok
                      ? 'bg-apple-green/10 text-apple-green'
                      : 'bg-apple-red/10 text-apple-red'
                  }`}
                >
                  {testResult.ok
                    ? `连接成功${testResult.models != null ? `，端点提供 ${testResult.models} 个模型` : ''}`
                    : `连接失败：${testResult.message ?? '未知错误'}`}
                </div>
              )}

              {/* 自动获取的模型列表（ccswitch 式一键添加） */}
              {testResult?.ok && (testResult.modelIds?.length ?? 0) > 0 && (
                <div
                  data-fetched-models
                  className="rounded-xl border border-black/[0.07] p-2.5 dark:border-white/[0.09]"
                >
                  <div className="flex items-center justify-between px-1 pb-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-black/35 dark:text-white/30">
                      可用模型（点击添加）
                    </span>
                    <button
                      onClick={() => void addAllFetched()}
                      className="rounded-md bg-apple-blue/10 px-2 py-0.5 text-[11px] font-medium text-apple-blue transition-colors hover:bg-apple-blue/20"
                    >
                      全部添加
                    </button>
                  </div>
                  <div className="max-h-36 space-y-0.5 overflow-y-auto">
                    {(testResult.modelIds ?? []).map((id) => (
                      <button
                        key={id}
                        data-fetched-model
                        onClick={() => void addFetchedModel(id)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                      >
                        <Plus size={11} strokeWidth={2.4} className="shrink-0 text-apple-blue" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-black/70 dark:text-white/75">
                          {id}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={save}
                  disabled={saving}
                  className="h-9 rounded-xl bg-apple-blue px-5 text-[13px] font-medium text-white shadow-soft transition-all duration-200 ease-spring hover:brightness-110 active:scale-[0.97] disabled:opacity-60"
                >
                  保存
                </button>
                {form.provider !== 'mock' && (
                  <>
                    <button
                      onClick={test}
                      disabled={testing}
                      className="flex h-9 items-center gap-1.5 rounded-xl bg-black/[0.05] px-4 text-[13px] font-medium text-black/65 transition-colors hover:bg-black/[0.09] dark:bg-white/[0.08] dark:text-white/70 dark:hover:bg-white/[0.13]"
                    >
                      {testing ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <PlugZap size={13} />
                      )}
                      测试连接
                    </button>
                    <button
                      onClick={remove}
                      data-model-remove
                      className="ml-auto flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[13px] font-medium text-apple-red/80 transition-colors hover:bg-apple-red/10"
                    >
                      <Trash2 size={13} />
                      删除
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
