/**
 * 安装服务 - 从 Registry 安装 SKILL 和 MCP 服务器
 * 
 * 特点：
 * - 一键安装，无需手动配置
 * - 安装后自动热重载
 * - 支持环境变量配置（MCP）
 */

import type { RegistrySkillResult, RegistryMCPResult } from './onlineSearchService'

// 安装结果类型
export interface InstallResult {
  success: boolean
  message: string
  path?: string
}

// 获取服务器 URL
function getServerUrl(): string {
  return localStorage.getItem('ddos_server_url') || 'http://localhost:3001'
}

/**
 * 安装 SKILL
 * @param skill 要安装的 SKILL 信息
 */
export async function installSkill(skill: RegistrySkillResult): Promise<InstallResult> {
  const serverUrl = getServerUrl()
  const url = `${serverUrl}/skills/install`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        id: skill.id,
        name: skill.name,
        downloadUrl: skill.downloadUrl,
      }),
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        message: errorData.error || `安装失败: HTTP ${response.status}`,
      }
    }
    
    const data = await response.json()
    return {
      success: true,
      message: data.message || '安装成功',
      path: data.path,
    }
  } catch (error) {
    console.error('[InstallService] Error installing skill:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : '网络错误',
    }
  }
}

/**
 * 安装 MCP 服务器
 * @param mcp 要安装的 MCP 信息
 * @param envValues 环境变量值（如 GITHUB_TOKEN）
 */
export async function installMCP(
  mcp: RegistryMCPResult,
  envValues?: Record<string, string>
): Promise<InstallResult> {
  const serverUrl = getServerUrl()
  const url = `${serverUrl}/mcp/install`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        id: mcp.id,
        name: mcp.name,
        command: mcp.command,
        args: mcp.args,
        env: envValues || {},
      }),
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        message: errorData.error || `安装失败: HTTP ${response.status}`,
      }
    }
    
    const data = await response.json()
    return {
      success: true,
      message: data.message || '安装成功',
      path: data.configPath,
    }
  } catch (error) {
    console.error('[InstallService] Error installing MCP:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : '网络错误',
    }
  }
}

/**
 * 触发热重载（重新扫描已安装的 SKILL 和 MCP）
 */
export async function triggerHotReload(): Promise<InstallResult> {
  const serverUrl = getServerUrl()
  const url = `${serverUrl}/reload`
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
    })
    
    if (!response.ok) {
      return {
        success: false,
        message: `热重载失败: HTTP ${response.status}`,
      }
    }
    
    const data = await response.json()
    return {
      success: true,
      message: data.message || '热重载成功',
    }
  } catch (error) {
    console.error('[InstallService] Error triggering hot reload:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : '网络错误',
    }
  }
}
