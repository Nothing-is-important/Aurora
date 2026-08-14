import { useEffect, useState } from 'react'
import {
  Check,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  PlugZap,
  Trash2,
  X,
} from 'lucide-react'
import type { ModelConfig } from '../lib/ipc'

interface SettingsModalProps {
  open: boolean
  models: ModelConfig[]
  onClose: () => void
  onChanged: () => void
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
}: SettingsModalProps) {
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState<ModelConfig>(emptyModel())
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    message?: string
    models?: number | null
  } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && models.length > 0 && !models.find((m) => m.id === selectedId)) {
      const first = models.find((m) => m.provider !== 'mock') ?? models[0]
      selectModel(first)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, models])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [open])

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
    onChanged()
  }

  const addNew = (): void => {
    const m = emptyModel()
    setSelectedId(m.id)
    setForm(m)
    setTestResult(null)
  }

  const remove = async (): Promise<void> => {
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
            </div>
          </div>

          {/* 编辑表单 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-3.5">
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

              <div className="grid grid-cols-3 gap-3">
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
