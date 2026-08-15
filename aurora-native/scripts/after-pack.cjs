// electron-builder afterPack 钩子：rcedit 把 exe 图标真正写进去
// （builder 26 在本项目未应用 win.icon 到 exe，仅用于 NSIS；此处兜底）
const { join } = require('path')
const { spawnSync } = require('child_process')

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context
  const exe = join(appOutDir, `${packager.appInfo.productFilename}.exe`)
  const ico = join(packager.projectDir, 'assets', 'icon.ico')
  const rcedit = join(packager.projectDir, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe')
  const r = spawnSync(rcedit, [exe, '--set-icon', ico], { stdio: 'inherit', windowsHide: true })
  if (r.status !== 0) {
    throw new Error(`rcedit set-icon failed: ${r.status}`)
  }
  console.log('  • exe icon applied via rcedit:', ico)
}
