// 探针：定位 DSH 客户端注入拖动区(-webkit-app-region)的机制
// 用法：electron probe-drag.mjs [url]（默认 http://127.0.0.1:3080/）
import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const url = process.argv[process.argv.length - 1].startsWith('http')
  ? process.argv[process.argv.length - 1]
  : 'http://127.0.0.1:3080/'

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  await win.loadURL(url)
  await new Promise((r) => setTimeout(r, 9000))
  const info = await win.webContents.executeJavaScript(`(async () => {
    const out = {}
    out.ua = navigator.userAgent
    out.hasProcess = typeof window.process !== 'undefined'
    // 找出所有设置了 app-region 的样式规则及其来源
    const hits = []
    for (const sheet of document.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue }
      for (const rule of rules) {
        if (rule.cssText && rule.cssText.includes('app-region')) {
          hits.push((sheet.href || 'inline') + ' :: ' + rule.cssText.slice(0, 160))
        }
      }
    }
    out.rules = hits.slice(0, 10)
    // 采样若干元素的 app-region 计算值
    const samples = []
    document.querySelectorAll('*').forEach((el) => {
      const r = getComputedStyle(el).webkitAppRegion
      if (r && r !== 'no-drag' && samples.length < 8) {
        samples.push(el.tagName + '.' + String(el.className).slice(0, 24) + '=' + r)
      }
    })
    out.samples = samples
    out.hasAppRegionOnBody = getComputedStyle(document.body).webkitAppRegion
    return out
  })()`)
  console.log(JSON.stringify(info, null, 2))
  app.exit(0)
})
