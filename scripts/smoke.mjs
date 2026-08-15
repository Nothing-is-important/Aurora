import { spawn, execSync } from 'child_process'
import electronPath from 'electron'

// 清理残留 Aurora 实例（避免共享 userData 导致冒烟环境脏乱）
if (process.platform === 'win32') {
  try {
    execSync('taskkill /F /IM Aurora.exe /T', { stdio: 'ignore' })
  } catch {
    /* 无残留则忽略 */
  }
  await new Promise((r) => setTimeout(r, 800))
}

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    SMOKE: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  },
})

child.on('exit', (code) => process.exit(code ?? 0))
