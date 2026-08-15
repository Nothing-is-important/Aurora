// 直接读 ICO 文件验证（不经 getFileIcon）
import { app, nativeImage } from 'electron'

const file = process.argv[process.argv.length - 1]
app.whenReady().then(async () => {
  const img = nativeImage.createFromPath(file)
  if (img.isEmpty()) {
    console.log(JSON.stringify({ file, error: 'empty' }))
    app.exit(1)
    return
  }
  const sizes = img.getSize()
  const buf = img.toBitmap()
  const { width } = img.getSize()
  const sample = (x, y) => {
    const i = (y * width + x) * 4
    return [buf[i + 2], buf[i + 1], buf[i], buf[i + 3]]
  }
  console.log(
    JSON.stringify({
      file,
      sizes,
      cornerTL: sample(1, 1),
      edgeTop: sample(Math.floor(width / 2), 0),
      center: sample(Math.floor(width / 2), Math.floor(width / 2)),
    }),
  )
  app.exit(0)
})
