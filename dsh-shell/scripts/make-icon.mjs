// 生成应用图标：SVG → 离屏渲染 → 多尺寸 PNG → 自打包 ICO（PNG-in-ICO，Win10+）
// 不依赖 electron-builder 的 png→ico 转换（其转换会把全幅图标做成透明角）。
import { app, BrowserWindow, nativeImage } from 'electron'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const SIZES = [16, 24, 32, 48, 64, 128, 256]

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a84ff"/>
      <stop offset="1" stop-color="#5e5ce6"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" fill="url(#g)"/>
  <text x="128" y="165" font-family="Segoe UI, Arial, sans-serif" font-size="95" font-weight="700"
        fill="#ffffff" text-anchor="middle">DSH</text>
</svg>`

const html = `<!doctype html><html><body style="margin:0;background:#0a84ff">
<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="256" height="256" style="display:block">
</body></html>`

/** 把多张 PNG 打包成 ICO（每帧一个 PNG，Vista+ 支持） */
function packIco(frames) {
  const count = frames.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  let offset = 6 + count * 16
  const parts = [header]
  for (const { size, data } of frames) {
    const dir = Buffer.alloc(16)
    dir.writeUInt8(size >= 256 ? 0 : size, 0)
    dir.writeUInt8(size >= 256 ? 0 : size, 1)
    dir.writeUInt8(0, 2)
    dir.writeUInt8(0, 3)
    dir.writeUInt16LE(1, 4)
    dir.writeUInt16LE(32, 6)
    dir.writeUInt32LE(data.length, 8)
    dir.writeUInt32LE(offset, 12)
    offset += data.length
    parts.push(dir)
  }
  for (const { data } of frames) parts.push(data)
  return Buffer.concat(parts)
}

app.whenReady().then(async () => {
  // 优先复用现有 icon.png（Aurora 官方图标）；否则离屏渲染 SVG 生成
  const existingPng = join(__dirname, '..', 'assets', 'icon.png')
  let master = null
  if (existsSync(existingPng)) {
    master = nativeImage.createFromPath(existingPng)
  }
  if (!master || master.isEmpty()) {
    const win = new BrowserWindow({
      width: 256,
      height: 256,
      show: false,
      frame: false,
      useContentSize: true,
      webPreferences: { offscreen: true },
    })
    await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
    await new Promise((r) => setTimeout(r, 500))
    master = await win.webContents.capturePage()
    win.destroy()
  }
  if (master.isEmpty()) {
    console.error('icon render failed: empty image')
    app.exit(1)
    return
  }

  const outDir = join(__dirname, '..', 'assets')
  mkdirSync(outDir, { recursive: true })

  // 各尺寸 PNG + 打包 ICO
  const frames = []
  for (const size of SIZES) {
    const png = master.resize({ width: size, height: size }).toPNG()
    frames.push({ size, data: png })
  }
  writeFileSync(join(outDir, 'icon.png'), frames.find((f) => f.size === 256).data)
  writeFileSync(join(outDir, 'icon.ico'), packIco(frames))
  console.log('icons written: assets/icon.png + assets/icon.ico (16-256)')
  app.exit(0)
})
