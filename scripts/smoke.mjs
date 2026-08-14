import { spawn } from 'child_process'
import electronPath from 'electron'

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    SMOKE: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  },
})

child.on('exit', (code) => process.exit(code ?? 0))
