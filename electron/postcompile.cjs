// Ensure dist-electron is treated as CommonJS
// (needed because root package.json has "type": "module")
const fs = require('fs')
const path = require('path')

const target = path.join(__dirname, '..', 'dist-electron', 'package.json')
fs.writeFileSync(target, JSON.stringify({ type: 'commonjs' }, null, 2))
console.log('[postcompile] Created dist-electron/package.json with type:commonjs')

// 复制内置插件到 dist-electron/plugins/
const srcPlugins = path.join(__dirname, 'plugins')
const destPlugins = path.join(__dirname, '..', 'dist-electron', 'plugins')

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

if (fs.existsSync(srcPlugins)) {
  copyDirSync(srcPlugins, destPlugins)
  console.log('[postcompile] Copied built-in plugins to dist-electron/plugins/')
}
