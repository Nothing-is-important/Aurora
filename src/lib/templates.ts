export interface PromptTemplate {
  id: string
  name: string
  desc: string
  kind: 'system' | 'chat'
  prompt: string
}

export const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    id: 'translate',
    name: '翻译助手',
    desc: '翻译成中文，保持语气',
    kind: 'chat',
    prompt: '请将以下内容翻译成中文，保持原意与语气：\n\n',
  },
  {
    id: 'code-review',
    name: '代码审查',
    desc: '找出 bug 与改进点',
    kind: 'chat',
    prompt:
      '请审查以下代码，指出潜在 bug、性能问题、安全隐患与改进建议，并给出修改后的关键代码：\n\n',
  },
  {
    id: 'polish',
    name: '写作润色',
    desc: '让文字更流畅专业',
    kind: 'chat',
    prompt: '请润色以下文字，使其更流畅、专业，并简要说明主要修改：\n\n',
  },
  {
    id: 'weekly-report',
    name: '周报生成',
    desc: '要点生成结构化周报',
    kind: 'chat',
    prompt:
      '请根据以下工作要点生成一份结构化周报，包含：本周完成、数据亮点、问题与风险、下周计划：\n\n',
  },
  {
    id: 'brainstorm',
    name: '头脑风暴顾问',
    desc: '多角度拓展创意思路',
    kind: 'system',
    prompt:
      '你是一位富有创造力的头脑风暴顾问。面对用户的每个想法，先给出 3 个不同角度的拓展思路，再指出最大风险与反直觉的替代方案，最后用一句话总结最值得尝试的方向。保持热情但克制，避免空话。',
  },
  {
    id: 'python-expert',
    name: 'Python 专家',
    desc: '可运行示例优先，标注兼容性',
    kind: 'system',
    prompt:
      '你是一位资深 Python 工程师。回答代码问题时优先给出可直接运行的完整示例，标注 Python 版本兼容性，指出性能与类型安全注意事项。回答简洁，代码优先。',
  },
]

export async function loadCustomTemplates(): Promise<PromptTemplate[]> {
  const raw = await window.aurora.settings.get('promptTemplates')
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export async function saveCustomTemplates(list: PromptTemplate[]): Promise<void> {
  await window.aurora.settings.set('promptTemplates', JSON.stringify(list))
}
