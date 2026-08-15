// 打包内置 dsh 运行时：staging(node.exe + node_modules) → 单个 dsh-runtime.zip
// 安装包只携带这一个 zip（安装秒级完成）；首启解压到 userData/runtime。
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, copyFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const shellDir = join(__dirname, '..')
const staging = join(shellDir, '.runtime-staging')
const outZip = join(shellDir, 'assets', 'dsh-runtime.zip')
const nodeZip = join(shellDir, '.node-portable.zip')

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: true })
  if (r.status !== 0) {
    console.error(`FAILED: ${cmd} ${args.join(' ')}`)
    process.exit(1)
  }
}

// 1. 准备 staging：node.exe + node_modules
rmSync(staging, { recursive: true, force: true })
mkdirSync(join(staging, 'node_modules'), { recursive: true })
if (existsSync(nodeZip)) {
  const tmp = join(shellDir, '.node-extract')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  run('tar', ['-x', '-f', nodeZip, '-C', tmp])
  const nodeExe = join(tmp, 'node-v24.14.0-win-x64', 'node.exe')
  if (!existsSync(nodeExe)) {
    console.error('node.exe not found in portable zip')
    process.exit(1)
  }
  copyFileSync(nodeExe, join(staging, 'node.exe'))
  rmSync(tmp, { recursive: true, force: true })
} else {
  console.error('portable node zip missing, run the download step first')
  process.exit(1)
}

// 2. node_modules 拷贝进 staging（保持路径结构）
run('cmd', ['/d', '/s', '/c', 'xcopy', '/E', '/I', '/Q',
  join(shellDir, '.dsh-runtime', 'node_modules'),
  join(staging, 'node_modules')])

// 3. 打成 zip（Windows 自带 tar.exe = libarchive，支持 -a 生成 zip）
mkdirSync(join(shellDir, 'assets'), { recursive: true })
rmSync(outZip, { force: true })
run('tar', ['-a', '-c', '-f', outZip, '-C', staging, '.'])

rmSync(staging, { recursive: true, force: true })
console.log('runtime zip written:', outZip, (statSync(outZip).size / 1024 / 1024).toFixed(1), 'MB')
