import { ProxyAgent } from 'undici'
import { getSetting } from './db'

let cachedUrl: string | null = null
let cachedAgent: ProxyAgent | null = null

/** 返回当前代理配置的 dispatcher（无配置返回 undefined 走直连） */
export function getDispatcher(): ProxyAgent | undefined {
  const url = (getSetting('proxyUrl') ?? '').trim()
  if (!url) {
    cachedAgent = null
    cachedUrl = null
    return undefined
  }
  if (url !== cachedUrl) {
    try {
      cachedAgent = new ProxyAgent(url)
      cachedUrl = url
    } catch {
      cachedAgent = null
      cachedUrl = null
      return undefined
    }
  }
  return cachedAgent ?? undefined
}
