/** 模型默认参数预设：按模型 ID 自动匹配，添加/切换模型时套用（用户可随时手动修改） */
export interface DefaultParams {
  temperature: number
  maxTokens: number
  topP: number
}

export const GENERIC_DEFAULTS: DefaultParams = {
  temperature: 1,
  maxTokens: 4096,
  topP: 1,
}

/** 已知模型的推荐默认值 */
const PRESETS: { match: RegExp; params: DefaultParams }[] = [
  // DeepSeek Reasoner：最大 64K，默认 32K；temperature 固定 1
  {
    match: /reasoner/i,
    params: { temperature: 1, maxTokens: 32768, topP: 1 },
  },
  // DeepSeek Chat：官方默认 4K，推荐温度 1.3
  {
    match: /deepseek-chat/i,
    params: { temperature: 1.3, maxTokens: 4096, topP: 1 },
  },
  // 常见 32K 上下文模型族
  {
    match: /qwen|glm|llama3|mixtral|command-r/i,
    params: { temperature: 1, maxTokens: 8192, topP: 1 },
  },
]

export function defaultParamsFor(modelId: string): DefaultParams {
  const id = modelId.trim()
  if (!id) return { ...GENERIC_DEFAULTS }
  const hit = PRESETS.find((p) => p.match.test(id))
  return hit ? { ...hit.params } : { ...GENERIC_DEFAULTS }
}

/**
 * 计算 Max Tokens（输出上限）：
 * 端点返回的上下文长度（contextLength，如 LM Studio 的 max_context_length）
 * 优先参与计算——取预设值与「min(8192, contextLength)」的较大者，
 * 保证未知模型也能从端点数据获得合理默认；端点无数据时用预设兜底。
 */
export function maxTokensFor(modelId: string, contextLength?: number): number {
  const preset = defaultParamsFor(modelId).maxTokens
  if (contextLength && contextLength > 0) {
    const fromContext = Math.min(8192, Math.floor(contextLength))
    return Math.max(preset, fromContext)
  }
  return preset
}
