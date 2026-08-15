export interface PromptTemplate {
  id: string
  name: string
  desc: string
  kind: 'system' | 'chat'
  prompt: string
  /** 适用模式 id 列表：未定义 = 所有模式可见；定义后仅这些模式显示 */
  modes?: string[]
}

/**
 * 模板矩阵：按 DSH 四模式的工作场景针对性设计
 * - 标准模式：通用办公与效率（写作/会议/数据/规划）
 * - PTC 模式：工程编排（测试/重构/文档/部署）
 * - 极简模式：运维脚本（Shell/日志/批量操作）
 * - 创造模式：元创作（设计模式/插件/优化提示词）
 */
export const BUILTIN_TEMPLATES: PromptTemplate[] = [
  // ============ 标准模式：通用办公与效率 ============
  {
    id: 'translate',
    name: '翻译助手',
    desc: '翻译成中文，保持语气',
    kind: 'chat',
    prompt: '请将以下内容翻译成中文，保持原意与语气：\n\n',
    modes: ['standard'],
  },
  {
    id: 'polish',
    name: '写作润色',
    desc: '让文字更流畅专业',
    kind: 'chat',
    prompt: '请润色以下文字，使其更流畅、专业，并简要说明主要修改：\n\n',
    modes: ['standard'],
  },
  {
    id: 'meeting-minutes',
    name: '会议纪要整理',
    desc: '速记 → 结构化纪要 + 待办',
    kind: 'chat',
    prompt:
      '请把下面的会议速记整理成结构化纪要：\n\n【结论】3 条以内核心决策\n【讨论要点】按主题归纳，保留关键数字与分歧\n【待办事项】表格：事项 | 负责人 | 截止时间（未提及的标注"待定"）\n\n速记内容：\n\n',
    modes: ['standard'],
  },
  {
    id: 'data-report',
    name: '数据分析报告',
    desc: '数据 → 洞察 + 图表建议',
    kind: 'chat',
    prompt:
      '请分析以下数据，输出：\n1. 关键发现（3-5 条，标注数据依据）\n2. 异常点与可能原因\n3. 建议的图表类型与维度\n4. 一句话行动建议\n\n数据：\n\n',
    modes: ['standard'],
  },
  {
    id: 'weekly-report',
    name: '周报生成',
    desc: '要点生成结构化周报',
    kind: 'chat',
    prompt:
      '请根据以下工作要点生成一份结构化周报，包含：本周完成、数据亮点、问题与风险、下周计划：\n\n',
    modes: ['standard'],
  },
  {
    id: 'require-breakdown',
    name: '需求拆解',
    desc: '模糊需求 → 可执行任务清单',
    kind: 'chat',
    prompt:
      '请把下面的模糊需求拆解为可执行任务：\n1. 澄清问题清单（先问我缺失的关键信息）\n2. 任务分解（编号 + 验收标准）\n3. 依赖关系与建议顺序\n4. 风险点与里程碑建议\n\n需求：\n\n',
    modes: ['standard'],
  },
  {
    id: 'competitor-analysis',
    name: '竞品分析框架',
    desc: '产品 → 维度化对比与机会',
    kind: 'chat',
    prompt:
      '请按以下框架分析该产品/项目：\n- 目标用户与核心痛点\n- 功能对比表（与主流竞品，缺失项标注）\n- 差异化优势与可复制点\n- 三个可切入的机会点（按性价比排序）\n\n产品信息：\n\n',
    modes: ['standard'],
  },
  {
    id: 'learning-path',
    name: '学习路径规划',
    desc: '目标 → 分阶段路径',
    kind: 'chat',
    prompt:
      '请为以下学习目标制定路径：\n1. 阶段划分（入门/进阶/实战，每阶段给时长建议）\n2. 每阶段：核心知识点 + 推荐资源类型 + 一个验收练习\n3. 常见坑与避坑建议\n\n学习目标与现有基础：\n\n',
    modes: ['standard'],
  },
  {
    id: 'okr-draft',
    name: 'OKR 制定',
    desc: '目标 → 可度量的 OKR',
    kind: 'chat',
    prompt:
      '请基于以下目标起草 OKR：\n- 1 个 Objective（有感染力的一句话）\n- 3 个 Key Results（每个可量化、有时间点）\n- 每项 KR 的衡量口径说明\n- 可能阻碍达成的主要风险\n\n目标背景：\n\n',
    modes: ['standard'],
  },
  {
    id: 'brainstorm',
    name: '头脑风暴顾问',
    desc: '多角度拓展创意思路',
    kind: 'system',
    prompt:
      '你是一位富有创造力的头脑风暴顾问。面对用户的每个想法，先给出 3 个不同角度的拓展思路，再指出最大风险与反直觉的替代方案，最后用一句话总结最值得尝试的方向。保持热情但克制，避免空话。',
    modes: ['standard'],
  },

  // ============ PTC 模式：工程编排 ============
  {
    id: 'code-review',
    name: '代码审查',
    desc: '找出 bug 与改进点',
    kind: 'chat',
    prompt:
      '请审查以下代码，按严重程度分级输出：\n- 🔴 严重：bug / 安全隐患\n- 🟡 建议：性能 / 可维护性\n- 🟢 可选：风格 / 命名\n每项给出位置、原因与修改建议：\n\n',
    modes: ['standard', 'ptc'],
  },
  {
    id: 'python-expert',
    name: 'Python 专家',
    desc: '可运行示例优先，标注兼容性',
    kind: 'system',
    prompt:
      '你是一位资深 Python 工程师。回答代码问题时优先给出可直接运行的完整示例，标注 Python 版本兼容性，指出性能与类型安全注意事项。回答简洁，代码优先。',
    modes: ['standard', 'ptc'],
  },
  {
    id: 'unit-test',
    name: '单元测试生成',
    desc: '函数 → 边界齐全的测试',
    kind: 'chat',
    prompt:
      '请为以下代码编写单元测试：\n1. 覆盖正常路径 + 边界 + 异常输入\n2. 标注每个用例验证的点\n3. 使用该语言的主流测试框架\n\n代码：\n\n',
    modes: ['ptc'],
  },
  {
    id: 'refactor',
    name: '重构建议',
    desc: '坏味道 → 分步重构方案',
    kind: 'chat',
    prompt:
      '请分析以下代码的重构机会：\n1. 坏味道清单（命名/重复/过长函数/耦合等）\n2. 分步重构方案（每步可独立提交、行为不变）\n3. 重构前后的关键代码对比\n\n代码：\n\n',
    modes: ['ptc'],
  },
  {
    id: 'api-docs',
    name: 'API 文档生成',
    desc: '接口代码 → 规范化文档',
    kind: 'chat',
    prompt:
      '请为以下接口/代码生成 API 文档：\n- 接口说明（路径、方法、用途）\n- 参数表（名称/类型/必填/说明）\n- 请求与响应示例\n- 错误码说明\n\n代码：\n\n',
    modes: ['ptc'],
  },
  {
    id: 'sql-optimize',
    name: 'SQL 优化',
    desc: '慢查询 → 优化方案',
    kind: 'chat',
    prompt:
      '请分析以下 SQL：\n1. 性能瓶颈（索引/全表扫描/子查询等）\n2. 优化后的 SQL（保持语义等价）\n3. 建议的索引设计\n4. 验证优化效果的方法\n\nSQL 与表结构：\n\n',
    modes: ['ptc'],
  },
  {
    id: 'deploy-checklist',
    name: '部署清单生成',
    desc: '项目 → 上线检查清单',
    kind: 'chat',
    prompt:
      '请为该服务/项目生成上线部署清单：\n- 环境准备（依赖/配置/密钥）\n- 部署步骤（可执行的命令）\n- 健康检查与验证项\n- 回滚预案\n\n项目信息：\n\n',
    modes: ['ptc'],
  },
  {
    id: 'bug-report',
    name: 'Bug 复现报告',
    desc: '现象 → 结构化排查报告',
    kind: 'chat',
    prompt:
      '请根据以下现象输出 Bug 排查报告：\n- 现象复述与影响范围\n- 可能原因列表（按概率排序）\n- 每项原因的验证方法\n- 建议的临时规避与根治方案\n\n现象与日志：\n\n',
    modes: ['ptc'],
  },

  // ============ 极简模式：运维与脚本 ============
  {
    id: 'shell-script',
    name: 'Shell 脚本生成',
    desc: '任务 → 带注释的脚本',
    kind: 'chat',
    prompt:
      '请生成一个完成以下任务的 Shell 脚本：\n- 兼容性说明（bash/sh）\n- 关键步骤注释\n- 错误处理（set -e 与退出码）\n- 使用说明\n\n任务：\n\n',
    modes: ['minimal'],
  },
  {
    id: 'log-analysis',
    name: '日志分析',
    desc: '日志 → 异常定位',
    kind: 'chat',
    prompt:
      '请分析以下日志：\n1. 异常/错误摘要（按类型聚合计数）\n2. 根因分析（按时间线）\n3. 需要重点关注的 3 个位置\n4. 建议的排查命令\n\n日志内容：\n\n',
    modes: ['minimal'],
  },
  {
    id: 'batch-rename',
    name: '批量重命名',
    desc: '规则 → 安全的重命名命令',
    kind: 'chat',
    prompt:
      '请为以下批量重命名需求生成命令：\n- 先 dry-run（仅打印将执行的改名）\n- 正式执行命令\n- 冲突与覆盖处理说明\n- 回滚方法\n\n文件规则：\n\n',
    modes: ['minimal'],
  },
  {
    id: 'env-check',
    name: '环境检查脚本',
    desc: '环境 → 一键体检脚本',
    kind: 'chat',
    prompt:
      '请生成环境检查脚本，检查：\n- 所需命令是否存在与版本\n- 端口占用\n- 磁盘/内存余量\n- 关键服务连通性\n输出彩色 ✓/✗ 结果汇总。目标环境：\n\n',
    modes: ['minimal'],
  },

  // ============ 创造模式：元创作 ============
  {
    id: 'mode-design',
    name: 'Agent 模式设计',
    desc: '场景 → 模式配置建议',
    kind: 'chat',
    prompt:
      '请为以下使用场景设计一个 Agent 模式配置：\n- 模式名称与一句话定位\n- 系统提示词（完整可粘贴）\n- 需要的工具组合与理由\n- 推荐模型与参数建议\n- 该模式的典型对话示例\n\n场景描述：\n\n',
    modes: ['creator'],
  },
  {
    id: 'plugin-idea',
    name: '插件创意设计',
    desc: '需求 → 插件工具定义与骨架',
    kind: 'chat',
    prompt:
      '请为以下需求设计一个 Aurora 插件：\n- 插件名称/版本/描述\n- 工具清单：名称、参数 schema、返回格式\n- 每个工具的核心逻辑伪代码\n- registerTool 的 JavaScript 代码骨架\n\n需求：\n\n',
    modes: ['creator'],
  },
  {
    id: 'prompt-optimizer',
    name: '提示词优化器',
    desc: '现有提示词 → 优化版',
    kind: 'chat',
    prompt:
      '请优化以下提示词：\n1. 诊断：指出现有问题（模糊/缺约束/易误解）\n2. 优化版：结构清晰、包含角色/任务/约束/输出格式\n3. 说明每处改动的原因\n\n原提示词：\n\n',
    modes: ['creator'],
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
