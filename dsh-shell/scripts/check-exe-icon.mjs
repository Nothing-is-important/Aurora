// 探针：读取 exe 内嵌图标，检查四角 alpha 与中心色
// 用法：electron check-exe-icon.mjs <exe路径>
import { app, nativeImage } from 'electron'
import { statSync } from 'node:fs'

const exe = process.argv[process.argv.length - 1].endsWith('.exe')
  ? process.argv[process.argv.length - 1]
  : 'E:\\Project\\Aurora\\release\\dsh-shell\\win-unpacked\\Aurora DSH.exe'

app.whenReady().then(async () => {
  // createFromPath 不支持 exe；用 app.getFileIcon 取系统关联图标
  let img = nativeImage.createFromPath(exe)
  if (img.isEmpty()) {
    img = await app.getFileIcon(exe, { size: 'large' })
  }
  if (img.isEmpty()) {
    console.log(JSON.stringify({ exe, error: 'no icon extracted' }))
    app.exit(1)
    return
  }
  // 取最大尺寸表示
  const sizes = img.getSize()
  const resized = img.resize({ width: 64, height: 64 })
  const buf = resized.toBitmap()
  const { width } = resized.getSize()
  const sample = (x, y) => {
    const i = (y * width + x) * 4
    return [buf[i + 2], buf[i + 1], buf[i], buf[i + 3]]
  }
  console.log(
    JSON.stringify(
      {
        exe,
        sizeBytes: statSync(exe).size,
        iconSize: sizes,
        cornerTL: sample(2, 2),
        cornerTR: sample(61, 2),
        cornerBL: sample(2, 61),
        cornerBR: sample(61, 61),
        edgeTop: sample(32, 1),
        center: sample(32, 32),
      },
      null,
      2,
    ),
  )
  app.exit(0)
})
