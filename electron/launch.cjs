/**
 * Electron launcher script with diagnostics
 */
'use strict'

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

// 写入诊断日志到用户目录（不依赖 stdout）
const diagFile = path.join(os.homedir(), 'duncrew-launch-diag.log')
function diag(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { fs.appendFileSync(diagFile, line) } catch {}
  console.log(msg)
}

try { fs.writeFileSync(diagFile, '') } catch {}
diag(`=== DunCrew Launcher Diagnostics ===`)
diag(`cwd: ${process.cwd()}`)
diag(`__dirname: ${__dirname}`)
diag(`node: ${process.version}`)
diag(`platform: ${process.platform}`)

const mainJs = path.join(__dirname, '..', 'dist-electron', 'main.js')
diag(`mainJs: ${mainJs}`)
diag(`mainJs exists: ${fs.existsSync(mainJs)}`)

if (!fs.existsSync(mainJs)) {
  diag(`ERROR: main.js not found!`)
  process.exit(1)
}

// Check dist-electron/package.json
const distPkgJson = path.join(__dirname, '..', 'dist-electron', 'package.json')
diag(`dist-electron/package.json exists: ${fs.existsSync(distPkgJson)}`)
if (fs.existsSync(distPkgJson)) {
  diag(`dist-electron/package.json content: ${fs.readFileSync(distPkgJson, 'utf-8').trim()}`)
}

const electronBin = require('electron')
diag(`electronBin: ${electronBin}`)
diag(`electronBin exists: ${fs.existsSync(electronBin)}`)

diag(`Spawning electron...`)

const child = spawn(electronBin, [mainJs], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  windowsHide: false,
})

let stdout = ''
let stderr = ''

child.stdout.on('data', (data) => {
  const s = data.toString()
  stdout += s
  process.stdout.write(s)
})

child.stderr.on('data', (data) => {
  const s = data.toString()
  stderr += s
  process.stderr.write(s)
})

child.on('error', (err) => {
  diag(`Spawn ERROR: ${err.message}`)
  process.exit(1)
})

child.on('close', (code, signal) => {
  diag(`Electron exited: code=${code} signal=${signal}`)
  diag(`stdout length: ${stdout.length}`)
  diag(`stderr length: ${stderr.length}`)
  if (stderr) {
    diag(`stderr (last 2000 chars): ${stderr.slice(-2000)}`)
  }
  if (stdout) {
    diag(`stdout (last 2000 chars): ${stdout.slice(-2000)}`)
  }
  diag(`=== Diagnostics End ===`)
  process.exit(code || 0)
})
