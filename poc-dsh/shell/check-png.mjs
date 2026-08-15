// 一次性脚本：校验 PoC 截图内容（尺寸 + 采样像素 + 判定是否为 DSH Web 深色界面）
import { nativeImage } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const file = join(fileURLToPath(new URL('.', import.meta.url)), 'poc-screenshot.png')
const bytes = statSync(file).size
const img = nativeImage.createFromPath(file)
const { width, height } = img.getSize()
const buf = img.toBitmap()

const sample = (x, y) => {
  const i = (y * width + x) * 4
  return [buf[i + 2], buf[i + 1], buf[i]] // R,G,B
}

// 采样网格 + 统计亮度分布（深色界面应有大量暗像素、少量亮文字像素）
let dark = 0
let light = 0
let total = 0
const grid = []
for (let y = 0; y < height; y += 24) {
  for (let x = 0; x < width; x += 24) {
    const [r, g, b] = sample(x, y)
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    total++
    if (lum < 60) dark++
    else if (lum > 160) light++
    if (grid.length < 12) grid.push(`${x},${y}=rgb(${r},${g},${b})`)
  }
}
console.log(JSON.stringify({
  file,
  bytes,
  width,
  height,
  darkPct: +(dark / total).toFixed(3),
  lightPct: +(light / total).toFixed(3),
  corner: sample(0, 0),
  samples: grid,
}, null, 2))
process.exit(0)
