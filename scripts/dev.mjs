import { createServer } from 'vite'
import { spawn } from 'child_process'
import electronPath from 'electron'

const server = await createServer({ configFile: 'vite.config.mjs' })
await server.listen()
const url = server.resolvedUrls?.local?.[0]
if (!url) throw new Error('Vite dev server failed to start')

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: url,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  },
})

child.on('exit', async (code) => {
  await server.close()
  process.exit(code ?? 0)
})
