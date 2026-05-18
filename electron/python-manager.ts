import { app } from 'electron'
import { spawn, execSync, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as http from 'http'

const SERVER_PORT = 3001
const SERVER_HOST = '127.0.0.1'
const HEALTH_CHECK_URL = `http://${SERVER_HOST}:${SERVER_PORT}/status`
const MAX_WAIT_MS = 60000
const POLL_INTERVAL_MS = 500
const MAX_RESTART_ATTEMPTS = 3

export class PythonManager {
  private process: ChildProcess | null = null
  private restartCount = 0
  private intentionalStop = false
  private isExternalProcess = false

  /**
   * 启动 Python 后端
   * 如果端口已被占用且服务正常响应且数据目录匹配，复用已有进程
   * 否则杀掉旧进程并启动新进程
   */
  async start(): Promise<void> {
    const isDev = !app.isPackaged
    const expectedDataPath = path.resolve(this.resolveDataPath(isDev))

    // 先检测是否已有服务在运行
    const alreadyRunning = await this.checkHealth()
    if (alreadyRunning) {
      // 验证已有进程的数据目录是否与期望一致
      const serverDataPath = await this.getServerDataPath()
      if (serverDataPath && path.resolve(serverDataPath) === expectedDataPath) {
        console.log(`[PythonManager] Port 3001 already has a running server with matching data path, reusing it`)
        this.isExternalProcess = true
        return
      }
      // 数据目录不匹配，杀掉旧进程
      console.warn(
        `[PythonManager] Port 3001 occupied by server with DIFFERENT data path!\n` +
        `  Running:  ${serverDataPath}\n` +
        `  Expected: ${expectedDataPath}\n` +
        `  Killing stale process and starting fresh...`
      )
      await this.killProcessOnPort(SERVER_PORT)
      // 等待端口释放
      await this.sleep(1000)
    }

    this.intentionalStop = false
    this.spawnProcess()
  }

  private spawnProcess(): void {
    const isDev = !app.isPackaged

    let cmd: string
    let args: string[]
    let cwd: string

    // 数据目录解析（优先级从高到低）：
    // 1. 环境变量 DUNCREW_DATA_PATH
    // 2. duncrew-server.py 中的默认路径 D:\编程\DunCrew-Data（开发模式）
    // 3. 用户主目录 ~/DunCrew-Data（生产模式兜底）
    const dataPath = this.resolveDataPath(isDev)
    // 确保数据目录存在
    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true })
    }

    if (isDev) {
      // 开发模式：直接运行 python
      cmd = 'python'
      args = ['duncrew-server.py', '--port', String(SERVER_PORT), '--host', SERVER_HOST, '--path', dataPath]
      cwd = path.join(__dirname, '..')
    } else {
      // 生产模式：运行 PyInstaller onedir 产物
      const exeName = process.platform === 'win32' ? 'duncrew-server.exe' : 'duncrew-server'
      const exePath = path.join(process.resourcesPath, 'duncrew-server', exeName)
      cmd = exePath
      args = ['--port', String(SERVER_PORT), '--host', SERVER_HOST, '--path', dataPath]
      cwd = path.join(process.resourcesPath, 'duncrew-server')
    }

    console.log(`[PythonManager] Starting: ${cmd} ${args.join(' ')}`)
    console.log(`[PythonManager] CWD: ${cwd}`)

    this.process = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      console.log(`[Python] ${data.toString().trim()}`)
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error(`[Python:err] ${data.toString().trim()}`)
    })

    this.process.on('close', (code: number | null) => {
      console.log(`[PythonManager] Process exited with code ${code}`)
      this.process = null

      // 非预期退出且未达到重启上限，自动重启
      if (!this.intentionalStop && this.restartCount < MAX_RESTART_ATTEMPTS) {
        this.restartCount++
        console.log(`[PythonManager] Restarting (attempt ${this.restartCount}/${MAX_RESTART_ATTEMPTS})...`)
        setTimeout(() => this.spawnProcess(), 1000)
      }
    })

    this.process.on('error', (err: Error) => {
      console.error(`[PythonManager] Spawn error:`, err.message)
    })
  }

  /**
   * 等待后端就绪（轮询 /status 端点）
   */
  async waitForReady(): Promise<void> {
    const startTime = Date.now()

    while (Date.now() - startTime < MAX_WAIT_MS) {
      const ok = await this.checkHealth()
      if (ok) return
      await this.sleep(POLL_INTERVAL_MS)
    }

    throw new Error(`Python backend did not start within ${MAX_WAIT_MS / 1000}s`)
  }

  /**
   * 停止 Python 后端
   */
  stop(): void {
    this.intentionalStop = true

    // 如果是外部进程，不要杀它
    if (this.isExternalProcess) {
      console.log('[PythonManager] External process, not killing')
      return
    }

    if (!this.process || !this.process.pid) {
      return
    }

    const pid = this.process.pid
    console.log(`[PythonManager] Stopping process tree (PID: ${pid})`)

    try {
      // Windows: 用 taskkill 杀整个进程树
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
      } else {
        this.process.kill('SIGTERM')
        // 超时强杀
        setTimeout(() => {
          if (this.process) {
            this.process.kill('SIGKILL')
          }
        }, 3000)
      }
    } catch (err) {
      // 进程可能已经退出
      console.log('[PythonManager] Process already exited')
    }

    this.process = null
  }

  /**
   * 健康检查：GET /status
   */
  private checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(HEALTH_CHECK_URL, { timeout: 2000 }, (res) => {
        resolve(res.statusCode === 200)
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
    })
  }

  /**
   * 从已运行的后端 /status 获取 clawdPath，用于验证数据目录是否匹配
   */
  private getServerDataPath(): Promise<string | null> {
    return new Promise((resolve) => {
      const req = http.get(HEALTH_CHECK_URL, { timeout: 3000 }, (res) => {
        let body = ''
        res.on('data', (chunk: Buffer) => { body += chunk.toString() })
        res.on('end', () => {
          try {
            const data = JSON.parse(body)
            resolve(data.clawdPath || null)
          } catch {
            resolve(null)
          }
        })
      })
      req.on('error', () => resolve(null))
      req.on('timeout', () => {
        req.destroy()
        resolve(null)
      })
    })
  }

  /**
   * 杀掉占用指定端口的进程
   */
  private async killProcessOnPort(port: number): Promise<void> {
    try {
      if (process.platform === 'win32') {
        const output = execSync(
          `netstat -ano | findstr :${port} | findstr LISTENING`,
          { encoding: 'utf-8', timeout: 5000 }
        ).trim()
        const pids = new Set<string>()
        for (const line of output.split('\n')) {
          const parts = line.trim().split(/\s+/)
          const pid = parts[parts.length - 1]
          if (pid && pid !== '0') pids.add(pid)
        }
        for (const pid of pids) {
          console.log(`[PythonManager] Killing stale process PID ${pid} on port ${port}`)
          try {
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', timeout: 5000 })
          } catch {
            // 进程可能已经退出
          }
        }
      } else {
        try {
          const output = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', timeout: 5000 }).trim()
          for (const pid of output.split('\n').filter(Boolean)) {
            console.log(`[PythonManager] Killing stale process PID ${pid} on port ${port}`)
            try {
              execSync(`kill -9 ${pid}`, { stdio: 'ignore', timeout: 5000 })
            } catch {
              // ignore
            }
          }
        } catch {
          // lsof 可能找不到进程
        }
      }
    } catch (err) {
      console.warn(`[PythonManager] Failed to kill process on port ${port}:`, err)
    }
  }

  /**
   * 解析数据目录路径
   * 优先级：环境变量 > 开发硬编码路径 > 用户主目录
   */
  private resolveDataPath(isDev: boolean): string {
    // 1. 环境变量最高优先
    const envPath = process.env.DUNCREW_DATA_PATH || process.env.DDOS_DATA_PATH
    if (envPath && fs.existsSync(envPath)) {
      console.log(`[PythonManager] Using env data path: ${envPath}`)
      return envPath
    }

    // 2. 开发模式：检查已知的开发数据目录
    if (isDev) {
      const devCandidates = [
        path.join(path.dirname(__dirname), '..', 'DunCrew-Data'),  // 项目同级目录
        'D:\\编程\\DunCrew-Data',                                    // 开发环境固定路径
      ]
      for (const candidate of devCandidates) {
        const resolved = path.resolve(candidate)
        if (fs.existsSync(resolved)) {
          console.log(`[PythonManager] Using dev data path: ${resolved}`)
          return resolved
        }
      }
    }

    // 3. 兜底：用户主目录
    const homePath = path.join(app.getPath('home'), 'DunCrew-Data')
    console.log(`[PythonManager] Using home directory path: ${homePath}`)
    return homePath
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
