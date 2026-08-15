// 生成应用图标：512×512 SVG → 离屏 BrowserWindow 渲染 → capturePage → PNG
// （electron-builder 打包时自动把 icon.png 转 .ico）
import { app, BrowserWindow } from 'electron'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a84ff"/>
      <stop offset="1" stop-color="#5e5ce6"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <text x="256" y="330" font-family="Segoe UI, Arial, sans-serif" font-size="190" font-weight="700"
        fill="#ffffff" text-anchor="middle">DSH</text>
</svg>`

const html = `<!doctype html><html><body style="margin:0;background:transparent">
<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="512" height="512" style="display:block">
</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  })
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
  await new Promise((r) => setTimeout(r, 500))
  const img = await win.webContents.capturePage()
  if (img.isEmpty()) {
    console.error('icon render failed: empty image')
    app.exit(1)
    return
  }
  const out = join(__dirname, '..', 'assets', 'icon.png')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, img.resize({ width: 512, height: 512 }).toPNG())
  console.log('icon written:', out, img.getSize())
  app.exit(0)
})
