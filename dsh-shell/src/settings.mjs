// 轻量 JSON 设置 + 窗口状态持久化（userData/settings.json）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const DEFAULTS = {
  /** 空 = 使用默认 <userData>/dsh-home（隔离部署） */
  dshHome: '',
  /** 开机自启 */
  autostart: false,
  /** 启动时最小化到托盘 */
  startHidden: false,
  /** 关闭窗口 = 隐藏到托盘（否则直接退出） */
  closeToTray: true,
  windowState: null,
}

export function loadSettings(userDataDir) {
  const file = join(userDataDir, 'settings.json')
  let data = {}
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    /* 首次运行或损坏：用默认值 */
  }
  const merged = { ...DEFAULTS, ...data }
  return {
    data: merged,
    file,
    get(key) {
      return merged[key]
    },
    set(key, value) {
      merged[key] = value
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(merged, null, 2), 'utf8')
    },
    patch(obj) {
      Object.assign(merged, obj)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(merged, null, 2), 'utf8')
    },
  }
}
