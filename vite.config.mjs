import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    // 单 bundle：manualChunks 会破坏 highlight.js 内部模块初始化顺序
    // （循环引用 TDZ），本地桌面应用无网络加载瓶颈，可靠性优先。
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
