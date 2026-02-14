/**
 * DD-OS 本地服务通信模块
 * 通过 HTTP API 与 ddos-local-server.py 通信
 * 用于执行任务（绕过 WebSocket chat 层，直接调用 claw CLI）
 *
 * 远程访问策略：
 * - 本地开发时直连 http://localhost:3001
 * - 远程访问时通过 Vite 代理 /local-api → localhost:3001
 *   这样浏览器只需连接 Vite dev server 端口，无需额外开放 3001 端口
 *
 * 输出流式策略：
 * - 使用 offset 参数增量读取日志
 * - 每次只获取新产生的内容，避免全量传输
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
}

export interface IncrementalTaskResponse {
  taskId: string
  status: 'running' | 'done' | 'error'
  content: string      // 增量内容 (仅 offset 之后的部分)
  offset: number       // 新的游标位置
  hasMore: boolean     // 是否还有更多内容
  fileSize: number     // 当前日志文件总大小
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
   * 查询任务状态 (支持增量读取)
   * GET /task/status/<taskId>?offset=N
   */
  async getTaskStatus(taskId: string, offset = 0): Promise<IncrementalTaskResponse> {
    const response = await fetch(`${this.baseUrl}/task/status/${taskId}?offset=${offset}`, {
      method: 'GET',
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  }

  /**
   * 轮询任务状态直到完成 (增量模式)
   * @param taskId 任务 ID
   * @param onUpdate 增量更新回调
   * @param intervalMs 轮询间隔 (默认 1500ms)
   * @param maxAttempts 最大尝试次数 (默认 200 次 = 5 分钟)
   */
  async pollTaskStatus(
    taskId: string,
    onUpdate: (response: IncrementalTaskResponse) => void,
    intervalMs = 1500,
    maxAttempts = 200
  ): Promise<IncrementalTaskResponse> {
    let attempts = 0
    let currentOffset = 0

    while (attempts < maxAttempts) {
      try {
        const response = await this.getTaskStatus(taskId, currentOffset)
        
        // 更新游标
        currentOffset = response.offset
        
        // 有新内容或状态变化时回调
        if (response.content || response.status !== 'running') {
          onUpdate(response)
        }

        // 完成条件: 状态已结束 且 没有更多内容
        if ((response.status === 'done' || response.status === 'error') && !response.hasMore) {
          return response
        }
        
        // 还有未读内容时立即继续读取，不等待
        if (response.hasMore) {
          continue
        }
      } catch (error) {
        console.error('[LocalServer] Poll error:', error)
        // 继续重试
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs))
      attempts++
    }

    // 超时
    const timeoutResult: IncrementalTaskResponse = {
      taskId,
      status: 'error',
      content: `\n\n[轮询超时 (${maxAttempts * intervalMs / 1000}s)]`,
      offset: currentOffset,
      hasMore: false,
      fileSize: 0,
    }
    onUpdate(timeoutResult)
    return timeoutResult
  }
}

// 导出单例
export const localServerService = new LocalServerService()
