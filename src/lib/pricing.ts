import type { ChatUsage, ModelConfig } from './ipc'

/** 模型定价（人民币 / 百万 tokens，DeepSeek 官方价目） */
export interface ModelPricing {
  inputPerM: number
  outputPerM: number
}

const DEEPSEEK_PRICE: Record<string, ModelPricing> = {
  'deepseek-chat': { inputPerM: 2, outputPerM: 8 },
  'deepseek-reasoner': { inputPerM: 4, outputPerM: 16 },
}

export function pricingFor(model: ModelConfig | undefined): ModelPricing {
  if (!model) return { inputPerM: 0, outputPerM: 0 }
  if (model.providerKind === 'mock') return { inputPerM: 1, outputPerM: 2 }
  if (model.providerKind === 'deepseek') {
    return DEEPSEEK_PRICE[model.modelId] ?? { inputPerM: 0, outputPerM: 0 }
  }
  // 兼容端点价格未知
  return { inputPerM: 0, outputPerM: 0 }
}

export function estimateCost(
  usage: ChatUsage | undefined,
  pricing: ModelPricing,
): number {
  if (!usage) return 0
  const p = (usage.prompt_tokens ?? 0) / 1_000_000
  const c = (usage.completion_tokens ?? 0) / 1_000_000
  return p * pricing.inputPerM + c * pricing.outputPerM
}

export function formatCost(cost: number): string {
  if (cost <= 0) return '¥0'
  if (cost < 0.01) return `≈¥${cost.toFixed(4)}`
  if (cost < 1) return `≈¥${cost.toFixed(3)}`
  return `≈¥${cost.toFixed(2)}`
}
