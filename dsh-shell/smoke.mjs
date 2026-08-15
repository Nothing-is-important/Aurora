// Aurora DSH 壳客户端冒烟审计驱动
// 场景 A：完整链路（设置/托盘/快捷键/远程加载/窗口状态/崩溃自动重启/截图/清理）
// 场景 B：dsh 缺失引导页（no-dsh 视图 + 重新检测按钮）
// 两个场景都通过才退出 0。
import { spawn, execSync } from 'child_process'
import { fileURLToPath } from 'url'
import electronPath from 'electron'

const APP_DIR = fileURLToPath(new URL('.', import.meta.url))

function cleanupResidual() {
  if (process.platform !== 'win32') return
  try {
    // 杀残留：本应用的打包版实例（占快捷键/端口）+ 命令行含 dsh-shell 的
    // 开发态 Electron。都是自己的应用，测试前清理安全。
    execSync('taskkill /F /IM "Aurora DSH.exe" /T', { stdio: 'ignore' })
  } catch {
    /* 无残留则忽略 */
  }
  try {
    execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \'electron.exe\' -and $_.CommandLine -like \'*dsh-shell*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"',
      { stdio: 'ignore' },
    )
  } catch {
    /* 无残留则忽略 */
  }
}

function runScenario(name, extraEnv, timeoutMs) {
  return new Promise((resolve) => {
    cleanupResidual()
    console.log(`\n===== ${name} =====`)
    const child = spawn(electronPath, ['.'], {
      cwd: APP_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SMOKE: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
        ...extraEnv,
      },
    })
    let out = ''
    const onData = (c) => {
      out += c.toString()
      process.stdout.write(c)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    const watchdog = setTimeout(() => {
      console.error(`[smoke] ${name} watchdog timeout`)
      try {
        child.kill()
      } catch {
        /* 已退出 */
      }
      resolve({ ok: false, out })
    }, timeoutMs)
    child.on('exit', (code) => {
      clearTimeout(watchdog)
      const ok = code === 0 && out.includes('[SMOKE] OK')
      console.log(`[smoke] ${name} exit=${code} ${ok ? 'PASS' : 'FAIL'}`)
      resolve({ ok, out })
    })
  })
}

const results = []
results.push(await runScenario('A 完整链路（dsh web 包裹 + 崩溃重启）', {}, 240000))
results.push(await runScenario('B dsh 缺失引导页', { SMOKE_MISSING: '1' }, 120000))

const failed = results.filter((r) => !r.ok)
if (failed.length > 0) {
  console.error(`\n[smoke] ${failed.length} 个场景失败`)
  process.exit(1)
}
console.log('\n[smoke] ALL PASS')
process.exit(0)
