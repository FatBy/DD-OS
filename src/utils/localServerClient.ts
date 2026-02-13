/**
 * 本地数据服务客户端
 * 连接 ddos-local-server.py 获取 clawd 目录数据
 */

import type { OpenClawSkill, MemoryEntry } from '@/types'

export const LOCAL_SERVER_URL = 'http://localhost:3001'

export interface LocalServerData {
  soul?: {
    content: string
    identity?: string
  }
  skills?: OpenClawSkill[]
  memories?: MemoryEntry[]
  files?: string[]
}

export interface LocalServerStatus {
  connected: boolean
  version?: string
  clawdPath?: string
  error?: string
}

/**
 * 检查本地服务是否在线
 */
export async function checkLocalServer(url: string = LOCAL_SERVER_URL): Promise<LocalServerStatus> {
  try {
    const response = await fetch(`${url}/status`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    })
    
    if (!response.ok) {
      return { connected: false, error: `HTTP ${response.status}` }
    }
    
    const data = await response.json()
    return {
      connected: true,
      version: data.version,
      clawdPath: data.clawdPath,
    }
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }
  }
}

/**
 * 从本地服务获取所有数据
 */
export async function fetchLocalServerData(url: string = LOCAL_SERVER_URL): Promise<LocalServerData> {
  const data: LocalServerData = {}
  
  try {
    // 获取 SOUL.md
    const soulRes = await fetch(`${url}/file/SOUL.md`)
    if (soulRes.ok) {
      const soulContent = await soulRes.text()
      data.soul = { content: soulContent }
      
      // 尝试获取 IDENTITY.md
      const identityRes = await fetch(`${url}/file/IDENTITY.md`)
      if (identityRes.ok) {
        data.soul.identity = await identityRes.text()
      }
    }
    
    // 获取技能列表
    const skillsRes = await fetch(`${url}/skills`)
    if (skillsRes.ok) {
      data.skills = await skillsRes.json()
    }
    
    // 获取记忆
    const memoriesRes = await fetch(`${url}/memories`)
    if (memoriesRes.ok) {
      data.memories = await memoriesRes.json()
    }
    
    // 获取文件列表
    const filesRes = await fetch(`${url}/files`)
    if (filesRes.ok) {
      data.files = await filesRes.json()
    }
  } catch (error) {
    console.error('[LocalServerClient] Failed to fetch data:', error)
  }
  
  return data
}

/**
 * 从本地服务获取单个文件
 */
export async function fetchLocalFile(
  fileName: string, 
  url: string = LOCAL_SERVER_URL
): Promise<string | null> {
  try {
    const response = await fetch(`${url}/file/${encodeURIComponent(fileName)}`)
    if (response.ok) {
      return await response.text()
    }
  } catch (error) {
    console.error(`[LocalServerClient] Failed to fetch ${fileName}:`, error)
  }
  return null
}

// ============================================
// 任务执行 API
// ============================================

export interface TaskExecResult {
  taskId: string
  status: 'pending' | 'running' | 'done' | 'error'
  output?: string
  error?: string
}

/**
 * 通过本地服务执行任务
 */
export async function executeTask(
  prompt: string,
  url: string = LOCAL_SERVER_URL
): Promise<TaskExecResult> {
  const response = await fetch(`${url}/task/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  
  if (!response.ok) {
    throw new Error(`Task execution failed: ${response.status}`)
  }
  
  return await response.json()
}

/**
 * 查询任务执行状态
 */
export async function getTaskStatus(
  taskId: string,
  url: string = LOCAL_SERVER_URL
): Promise<TaskExecResult> {
  const response = await fetch(`${url}/task/status/${taskId}`)
  
  if (!response.ok) {
    throw new Error(`Task status check failed: ${response.status}`)
  }
  
  return await response.json()
}
