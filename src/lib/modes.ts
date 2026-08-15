export interface ChatMode {
  id: string
  name: string
  desc: string
  systemPrompt: string
  toolsEnabled: boolean
  /** 工具白名单：未定义 = 全部工具；定义后仅允许列出的工具 */
  allowedTools?: string[]
  recommendModelId?: string
  builtin?: boolean
}

/** 与 DeepSeek Harness（DSH）四个 Agent 预设对齐 */
export const BUILTIN_MODES: ChatMode[] = [
  {
    id: 'standard',
    name: '标准模式',
    desc: '全功能 Agent：文件编辑、Shell、文件与网页检索、知识库、MCP 与工作流。',
    systemPrompt: '',
    toolsEnabled: true,
    builtin: true,
  },
  {
    id: 'ptc',
    name: 'PTC 模式',
    desc: '标准模式全部能力 + 程序化多步操作（对应 DSH 的 Code Mode SDK）。',
    systemPrompt:
      '你是一位精通程序化任务编排的工程师。面对多步操作时，优先将步骤组合为清晰、可复用、可校验的程序化方案，善用文件与代码执行工具，输出结构严谨、可直接运行的结果。',
    toolsEnabled: true,
    recommendModelId: 'deepseek-chat',
    builtin: true,
  },
  {
    id: 'minimal',
    name: '极简模式',
    desc: '仅 Shell 与文件编辑的双工具编码 Agent。',
    systemPrompt:
      '你是一个极简编码 Agent，只使用 Shell 与文件编辑工具完成任务。回答直接、克制、不展开无关内容。',
    toolsEnabled: true,
    allowedTools: ['run_shell', 'read_file', 'write_file', 'list_dir'],
    recommendModelId: 'deepseek-chat',
    builtin: true,
  },
  {
    id: 'creator',
    name: '创造模式',
    desc: '创建自定义模式：标准模式全部能力 + 模式创作指导。',
    systemPrompt:
      '你是一位 Agent 预设创作顾问。帮助用户设计自定义模式：明确模式的目标场景、系统提示词、需要的工具组合与推荐模型，并给出可直接使用的配置建议。',
    toolsEnabled: true,
    builtin: true,
  },
]

export async function loadCustomModes(): Promise<ChatMode[]> {
  const raw = await window.aurora.settings.get('customModes')
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr)
      ? arr.map((m) => ({ ...m, builtin: false }))
      : []
  } catch {
    return []
  }
}

export async function saveCustomModes(list: ChatMode[]): Promise<void> {
  await window.aurora.settings.set('customModes', JSON.stringify(list))
}

export async function loadActiveModeId(): Promise<string> {
  return (await window.aurora.settings.get('activeModeId')) ?? 'standard'
}

export async function saveActiveModeId(id: string): Promise<void> {
  await window.aurora.settings.set('activeModeId', id)
}
