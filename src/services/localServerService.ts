/**
 * DD-OS 本地服务通信模块
 * 通过 HTTP API 与 ddos-local-server.py 通信
 * 用于执行任务（绕过 WebSocket chat 层，直接调用 claw CLI）
 *
 * 远程访问策略：
 * - 本地开发时直连 http://localhost:3001
 * - 远程访问时通过 Vite 代理 /local-api → localhost:3001
 *   这样浏览器只需连接 Vite dev server 端口，无需额外开放 3001 端口
 */

// 自动推断本地服务地址
function getDefaultServerUrl(): string {
  const hostname = window.location.hostname
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    // 本地开发：直连 3001 端口
    return 'http://localhost:3001'
  }
  // 远程访问：走 Vite 代理，使用相对路径
  // /local-api/* → 代理到 localhost:3001/*
  return '/local-api'
}

// 默认本地服务地址
const DEFAULT_LOCAL_SERVER = getDefaultServerUrl()

// 配置 key
const STORAGE_KEY = 'ddos_local_server_url'

export interface TaskExecuteResponse {
  taskId: string
  status: 'running' | 'done' | 'error'
  output?: string
  error?: string
}

export interface TaskStatusResponse {
  taskId: string
  status: 'running' | 'done' | 'error'
  output?: string
  error?: string
}

class LocalServerService {
  private baseUrl: string

  constructor() {
    this.baseUrl = localStorage.getItem(STORAGE_KEY) || DEFAULT_LOCAL_SERVER
  }

  /**
   * 设置本地服务地址
   */
  setServerUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '') // 移除尾部斜杠
    localStorage.setItem(STORAGE_KEY, this.baseUrl)
  }

  /**
   * 获取当前服务地址
   */
  getServerUrl(): string {
    return this.baseUrl
  }

  /**
   * 检查本地服务是否可用
   */
  async checkStatus(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/status`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * 执行任务
   * POST /task/execute
   */
  async executeTask(prompt: string): Promise<TaskExecuteResponse> {
    const response = await fetch(`${this.baseUrl}/task/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  }

  /**
   * 查询任务状态
   * GET /task/status/<taskId>
   */
  async getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const response = await fetch(`${this.baseUrl}/task/status/${taskId}`, {
      method: 'GET',
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  }

  /**
   * 轮询任务状态直到完成
   * @param taskId 任务 ID
   * @param onUpdate 状态更新回调
   * @param intervalMs 轮询间隔 (默认 2000ms)
   * @param maxAttempts 最大尝试次数 (默认 60 次 = 2 分钟)
   */
  async pollTaskStatus(
    taskId: string,
    onUpdate: (status: TaskStatusResponse) => void,
    intervalMs = 2000,
    maxAttempts = 60
  ): Promise<TaskStatusResponse> {
    let attempts = 0

    while (attempts < maxAttempts) {
      try {
        const status = await this.getTaskStatus(taskId)
        onUpdate(status)

        if (status.status === 'done' || status.status === 'error') {
          return status
        }
      } catch (error) {
        console.error('[LocalServer] Poll error:', error)
        // 继续重试
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs))
      attempts++
    }

    // 超时
    const timeoutResult: TaskStatusResponse = {
      taskId,
      status: 'error',
      error: `轮询超时 (${maxAttempts * intervalMs / 1000}s)`,
    }
    onUpdate(timeoutResult)
    return timeoutResult
  }
}

// 导出单例
export const localServerService = new LocalServerService()
