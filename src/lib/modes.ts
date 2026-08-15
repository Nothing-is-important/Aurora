export interface ChatMode {
  id: string
  name: string
  desc: string
  systemPrompt: string
  toolsEnabled: boolean
  recommendModelId?: string
  builtin?: boolean
}

export const BUILTIN_MODES: ChatMode[] = [
  {
    id: 'chat',
    name: '普通对话',
    desc: '快速问答，不调用工具',
    systemPrompt: '',
    toolsEnabled: false,
    builtin: true,
  },
  {
    id: 'coder',
    name: '编程助手',
    desc: '写代码、审查、解释，可用文件与代码执行',
    systemPrompt:
      '你是一位资深软件工程师。回答代码问题时优先给出可直接运行的完整示例，标注版本兼容性，指出性能与安全注意事项。涉及文件操作时使用提供的工具，回答简洁、代码优先。',
    toolsEnabled: true,
    recommendModelId: 'deepseek-chat',
    builtin: true,
  },
  {
    id: 'writer',
    name: '写作助手',
    desc: '润色、翻译、公文与文案',
    systemPrompt:
      '你是一位专业的中文写作顾问。润色文字时保持原意与语气，让表达更流畅、专业；翻译时兼顾信达雅；撰写文案时结构清晰、重点突出。修改后简要说明关键改动。',
    toolsEnabled: false,
    recommendModelId: 'deepseek-chat',
    builtin: true,
  },
  {
    id: 'agent',
    name: 'Agent 完整模式',
    desc: '全部工具：文件/代码/命令/搜索/知识库/MCP',
    systemPrompt: '',
    toolsEnabled: true,
    recommendModelId: 'deepseek-chat',
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
  return (await window.aurora.settings.get('activeModeId')) ?? 'chat'
}

export async function saveActiveModeId(id: string): Promise<void> {
  await window.aurora.settings.set('activeModeId', id)
}
