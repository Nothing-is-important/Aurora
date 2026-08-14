import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import type { ModelConfig } from './db'

export interface ApiChatMessage {
  role: string
  content: string
}

export interface ChatStartRequest {
  requestId: string
  modelId: string
  messages: ApiChatMessage[]
}

export interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

const active = new Map<string, AbortController>()

/** 冒烟模式记录最近的请求（用于系统提示词注入断言） */
const smokeRequests: ChatStartRequest[] = []

export function getSmokeChatRequests(): ChatStartRequest[] {
  return smokeRequests
}

export function registerChatIpc(getModels: () => ModelConfig[]): void {
  ipcMain.on('chat:start', (e, req: ChatStartRequest) => {
    if (process.env.SMOKE === '1') smokeRequests.push(req)
    const model = getModels().find((m) => m.id === req.modelId)
    void runChat(e.sender, req, model ?? null)
  })
  ipcMain.on('chat:stop', (_e, requestId: string) => {
    active.get(requestId)?.abort()
  })
}

function emit(wc: WebContents, channel: string, payload: unknown): void {
  if (!wc.isDestroyed()) wc.send(channel, payload)
}

function errMessage(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err)
  return s.slice(0, 500)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t)
          reject(new DOMException('Aborted', 'AbortError'))
        },
        { once: true },
      )
    }
  })
}

async function runChat(
  wc: WebContents,
  req: ChatStartRequest,
  model: ModelConfig | null,
): Promise<void> {
  if (!model) {
    emit(wc, 'chat:error', {
      requestId: req.requestId,
      message: '未找到所选模型',
      aborted: false,
    })
    emit(wc, 'chat:done', {
      requestId: req.requestId,
      aborted: false,
      durationMs: 0,
      firstTokenMs: 0,
    })
    return
  }
  const ac = new AbortController()
  active.set(req.requestId, ac)
  const startAt = Date.now()
  let firstTokenAt = 0
  const onFirstToken = (): void => {
    if (!firstTokenAt) firstTokenAt = Date.now()
  }
  try {
    if (model.provider === 'mock') {
      await mockStream(wc, req, ac.signal, onFirstToken)
    } else if (!model.apiKey) {
      emit(wc, 'chat:error', {
        requestId: req.requestId,
        message: `「${model.name}」尚未配置 API Key，请到设置中填写`,
        aborted: false,
      })
    } else {
      await sseStream(wc, req, model, ac.signal, onFirstToken)
    }
    emit(wc, 'chat:done', {
      requestId: req.requestId,
      aborted: false,
      durationMs: Date.now() - startAt,
      firstTokenMs: firstTokenAt ? firstTokenAt - startAt : 0,
    })
  } catch (err) {
    const aborted = ac.signal.aborted
    emit(wc, 'chat:error', {
      requestId: req.requestId,
      message: aborted ? '已停止生成' : errMessage(err),
      aborted,
    })
    emit(wc, 'chat:done', {
      requestId: req.requestId,
      aborted,
      durationMs: Date.now() - startAt,
      firstTokenMs: firstTokenAt ? firstTokenAt - startAt : 0,
    })
  } finally {
    active.delete(req.requestId)
  }
}

// ---- OpenAI 兼容 SSE 流 ----
async function sseStream(
  wc: WebContents,
  req: ChatStartRequest,
  model: ModelConfig,
  signal: AbortSignal,
  onFirstToken?: () => void,
): Promise<void> {
  const url = `${model.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${model.apiKey}`,
    },
    body: JSON.stringify({
      model: model.modelId,
      messages: req.messages,
      stream: true,
      temperature: model.temperature,
      max_tokens: model.maxTokens,
      top_p: model.topP,
    }),
    signal,
  })
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${detail ? ': ' + detail.slice(0, 300) : ''}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const data = t.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const j = JSON.parse(data)
        const delta = j.choices?.[0]?.delta ?? {}
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          emit(wc, 'chat:delta', {
            requestId: req.requestId,
            reasoning: delta.reasoning_content,
          })
        }
        if (typeof delta.content === 'string' && delta.content) {
          onFirstToken?.()
          emit(wc, 'chat:delta', {
            requestId: req.requestId,
            content: delta.content,
          })
        }
        if (j.usage) {
          emit(wc, 'chat:usage', { requestId: req.requestId, usage: j.usage })
        }
      } catch {
        /* 忽略不完整行 */
      }
    }
  }
}

// ---- Mock 提供方（无需网络/Key，用于演示与测试）----
function chunks(text: string, n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n))
  return out
}

async function mockStream(
  wc: WebContents,
  req: ChatStartRequest,
  signal: AbortSignal,
  onFirstToken?: () => void,
): Promise<void> {
  const reasoning =
    '用户希望看到一个综合示例。我可以准备一段包含二级标题、Python 代码块、LaTeX 公式与列表的 Markdown 回复，用来验证流式渲染、语法高亮、复制按钮与 KaTeX 是否正常工作。'
  for (const ch of chunks(reasoning, 6)) {
    emit(wc, 'chat:delta', { requestId: req.requestId, reasoning: ch })
    await sleep(28, signal)
  }
  await sleep(200, signal)

  const content = [
    '好的，下面是一个综合示例。',
    '',
    '## 快速示例',
    '',
    '先看一个 Python 函数：',
    '',
    '```python',
    'def fib(n):',
    '    """返回前 n 个斐波那契数"""',
    '    a, b = 0, 1',
    '    out = []',
    '    for _ in range(n):',
    '        out.append(a)',
    '        a, b = b, a + b',
    '    return out',
    '',
    'print(fib(10))',
    '```',
    '',
    '再验证一个公式，欧拉恒等式：',
    '',
    '$$',
    'e^{i\\pi} + 1 = 0',
    '$$',
    '',
    '要点：',
    '',
    '- **流式渲染**逐字出现',
    '- 代码块带语法高亮与复制按钮',
    '- 公式由 KaTeX 渲染',
    '',
    '以上全部来自本地 Mock 提供方，无需 API Key。',
  ].join('\n')

  for (const ch of chunks(content, 8)) {
    onFirstToken?.()
    emit(wc, 'chat:delta', { requestId: req.requestId, content: ch })
    await sleep(16, signal)
  }
  emit(wc, 'chat:usage', {
    requestId: req.requestId,
    usage: { prompt_tokens: 24, completion_tokens: 218, total_tokens: 242 },
  })
}
