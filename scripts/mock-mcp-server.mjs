// Aurora 内置 Mock MCP 服务器（stdio JSON-RPC，仅用于冒烟与演示）
import readline from 'readline'

const rl = readline.createInterface({ input: process.stdin })

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.method === 'initialize') {
    respond(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'mock-server', version: '1.0.0' },
    })
  } else if (msg.method === 'tools/list') {
    respond(msg.id, {
      tools: [
        {
          name: 'echo',
          description: '回显输入文本（Mock MCP 工具，用于验证 MCP 链路）',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      ],
    })
  } else if (msg.method === 'tools/call') {
    const text = msg.params?.arguments?.text ?? ''
    respond(msg.id, {
      content: [{ type: 'text', text: `echo: ${text}` }],
    })
  } else if (msg.id !== undefined) {
    respond(msg.id, {})
  }
})
