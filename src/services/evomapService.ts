/**
 * EvoMap GEP-A2A 协议客户端
 * 
 * 连接到 EvoMap 协作进化市场
 * - 注册节点 (hello)
 * - 获取已验证资产 (fetch)
 * - 发布解决方案 (publish)
 * - 任务系统 (claim/complete)
 * 
 * @see https://evomap.ai/wiki
 */

import type {
  GepA2AEnvelope,
  EvoMapHelloPayload,
  EvoMapHelloResponse,
  EvoMapFetchPayload,
  EvoMapPublishPayload,
  EvoMapPublishResponse,
  EvoMapAsset,
  EvoMapCapsule,
  EvoMapTask,
  EvoMapNodeState,
} from '@/types'

// ============================================
// 配置
// ============================================

const HUB_URL = 'https://evomap.ai'
const PROTOCOL_VERSION = '1.0.0'
const STORAGE_KEY = 'ddos-evomap-state'

// ============================================
// 工具函数
// ============================================

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
}

function generateMessageId(): string {
  return `msg_${Date.now()}_${randomHex(4)}`
}

function generateNodeId(): string {
  return `node_${randomHex(8)}`
}

// ============================================
// EvoMap 服务类
// ============================================

class EvoMapService {
  private state: EvoMapNodeState | null = null
  private cachedAssets: EvoMapAsset[] = []
  private cachedTasks: EvoMapTask[] = []

  constructor() {
    this.loadState()
  }

  // ============================================
  // 状态管理
  // ============================================

  private loadState(): void {
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      if (data) {
        this.state = JSON.parse(data)
        console.log(`[EvoMap] Loaded node: ${this.state?.sender_id}`)
      }
    } catch (e) {
      console.warn('[EvoMap] Failed to load state:', e)
    }
  }

  private saveState(): void {
    if (!this.state) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch (e) {
      console.warn('[EvoMap] Failed to save state:', e)
    }
  }

  /**
   * 获取或生成 sender_id
   */
  private getSenderId(): string {
    if (this.state?.sender_id) {
      return this.state.sender_id
    }
    const newId = generateNodeId()
    this.state = {
      sender_id: newId,
      reputation: 0,
      credits: 0,
      registered_at: new Date().toISOString(),
      last_sync_at: new Date().toISOString(),
    }
    this.saveState()
    return newId
  }

  /**
   * 构建协议信封
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildEnvelope(
    messageType: GepA2AEnvelope['message_type'],
    payload: any
  ): GepA2AEnvelope {
    return {
      protocol: 'gep-a2a',
      protocol_version: PROTOCOL_VERSION,
      message_type: messageType,
      message_id: generateMessageId(),
      sender_id: this.getSenderId(),
      timestamp: new Date().toISOString(),
      payload,
    }
  }

  /**
   * 发送 A2A 请求
   */
  private async sendRequest<T>(
    endpoint: string,
    envelope: GepA2AEnvelope
  ): Promise<T> {
    const response = await fetch(`${HUB_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(envelope),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`EvoMap API error (${response.status}): ${errorText}`)
    }

    return response.json()
  }

  // ============================================
  // API: Hello (注册节点)
  // ============================================

  /**
   * 注册节点到 EvoMap 网络
   */
  async hello(): Promise<EvoMapHelloResponse> {
    const payload: EvoMapHelloPayload = {
      capabilities: {
        dd_os: true,
        react_loop: true,
        mcp_client: true,
      },
      gene_count: 0,
      capsule_count: 0,
      env_fingerprint: {
        platform: this.detectPlatform(),
        arch: this.detectArch(),
      },
    }

    const envelope = this.buildEnvelope('hello', payload)
    
    try {
      const response = await this.sendRequest<EvoMapHelloResponse>('/a2a/hello', envelope)
      
      // 更新状态
      if (this.state) {
        this.state.claim_code = response.claim_code
        this.state.claim_url = response.claim_url
        this.state.last_sync_at = new Date().toISOString()
        this.saveState()
      }

      console.log(`[EvoMap] Registered! Claim URL: ${response.claim_url}`)
      return response
    } catch (error) {
      console.error('[EvoMap] Hello failed:', error)
      throw error
    }
  }

  private detectPlatform(): string {
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent.toLowerCase()
      if (ua.includes('win')) return 'windows'
      if (ua.includes('mac')) return 'darwin'
      if (ua.includes('linux')) return 'linux'
    }
    return 'unknown'
  }

  private detectArch(): string {
    return 'x64'  // 简化处理
  }

  // ============================================
  // API: Fetch (获取资产)
  // ============================================

  /**
   * 获取已验证的 Capsule 资产
   */
  async fetchCapsules(limit: number = 20): Promise<EvoMapCapsule[]> {
    const payload: EvoMapFetchPayload = {
      asset_type: 'Capsule',
      limit,
    }

    const envelope = this.buildEnvelope('fetch', payload)
    
    try {
      const response = await this.sendRequest<{ assets: EvoMapCapsule[] }>('/a2a/fetch', envelope)
      this.cachedAssets = response.assets || []
      
      if (this.state) {
        this.state.last_sync_at = new Date().toISOString()
        this.saveState()
      }

      console.log(`[EvoMap] Fetched ${this.cachedAssets.length} capsules`)
      return this.cachedAssets as EvoMapCapsule[]
    } catch (error) {
      console.error('[EvoMap] Fetch failed:', error)
      throw error
    }
  }

  /**
   * 获取可用任务 (赏金)
   */
  async fetchTasks(): Promise<EvoMapTask[]> {
    const payload: EvoMapFetchPayload = {
      include_tasks: true,
    }

    const envelope = this.buildEnvelope('fetch', payload)
    
    try {
      const response = await this.sendRequest<{ tasks: EvoMapTask[] }>('/a2a/fetch', envelope)
      this.cachedTasks = response.tasks || []
      console.log(`[EvoMap] Fetched ${this.cachedTasks.length} tasks`)
      return this.cachedTasks
    } catch (error) {
      console.error('[EvoMap] Fetch tasks failed:', error)
      throw error
    }
  }

  // ============================================
  // API: Publish (发布资产)
  // ============================================

  /**
   * 计算资产 ID (SHA256)
   */
  private async computeAssetId(asset: Omit<EvoMapAsset, 'asset_id'>): Promise<string> {
    const canonical = JSON.stringify(asset, Object.keys(asset).sort())
    const encoder = new TextEncoder()
    const data = encoder.encode(canonical)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * 发布解决方案到 EvoMap
   */
  async publish(
    summary: string,
    implementation: string,
    toolsUsed: string[],
    confidence: number = 0.8
  ): Promise<EvoMapPublishResponse> {
    // 构建 Capsule 资产
    const capsuleBase = {
      asset_type: 'Capsule' as const,
      summary,
      confidence,
      blast_radius: { files: 1, lines: 10 },
      implementation,
      tool_chain: toolsUsed,
      created_at: new Date().toISOString(),
      status: 'candidate' as const,
    }

    const capsuleId = await this.computeAssetId(capsuleBase)
    const capsule: EvoMapCapsule = {
      ...capsuleBase,
      asset_id: capsuleId,
    }

    const payload: EvoMapPublishPayload = {
      assets: [capsule],
    }

    const envelope = this.buildEnvelope('publish', payload)
    
    try {
      const response = await this.sendRequest<EvoMapPublishResponse>('/a2a/publish', envelope)
      console.log(`[EvoMap] Published: ${response.status}`)
      return response
    } catch (error) {
      console.error('[EvoMap] Publish failed:', error)
      throw error
    }
  }

  // ============================================
  // API: Task (任务系统)
  // ============================================

  /**
   * 认领任务
   */
  async claimTask(taskId: string): Promise<{ status: string }> {
    const envelope = this.buildEnvelope('decision', {
      action: 'claim',
      task_id: taskId,
    })

    try {
      const response = await this.sendRequest<{ status: string }>('/task/claim', envelope)
      console.log(`[EvoMap] Claimed task: ${taskId}`)
      return response
    } catch (error) {
      console.error('[EvoMap] Claim task failed:', error)
      throw error
    }
  }

  /**
   * 完成任务
   */
  async completeTask(taskId: string, assetId: string): Promise<{ status: string; credits?: number }> {
    const envelope = this.buildEnvelope('decision', {
      action: 'complete',
      task_id: taskId,
      asset_id: assetId,
    })

    try {
      const response = await this.sendRequest<{ status: string; credits?: number }>('/task/complete', envelope)
      
      // 更新积分
      if (response.credits && this.state) {
        this.state.credits += response.credits
        this.saveState()
      }

      console.log(`[EvoMap] Completed task: ${taskId}, earned: ${response.credits || 0} credits`)
      return response
    } catch (error) {
      console.error('[EvoMap] Complete task failed:', error)
      throw error
    }
  }

  // ============================================
  // 状态查询
  // ============================================

  /**
   * 是否已注册
   */
  isRegistered(): boolean {
    return !!this.state?.sender_id
  }

  /**
   * 获取节点状态
   */
  getNodeState(): EvoMapNodeState | null {
    return this.state
  }

  /**
   * 获取缓存的资产
   */
  getCachedAssets(): EvoMapAsset[] {
    return this.cachedAssets
  }

  /**
   * 获取缓存的任务
   */
  getCachedTasks(): EvoMapTask[] {
    return this.cachedTasks
  }

  /**
   * 搜索本地缓存的 Capsule
   */
  searchCapsules(query: string): EvoMapCapsule[] {
    const lowerQuery = query.toLowerCase()
    return (this.cachedAssets as EvoMapCapsule[]).filter(asset => 
      asset.asset_type === 'Capsule' &&
      (asset.summary.toLowerCase().includes(lowerQuery) ||
       asset.implementation?.toLowerCase().includes(lowerQuery) ||
       asset.signals_match?.some(s => s.toLowerCase().includes(lowerQuery)))
    )
  }
}

// 单例导出
export const evomapService = new EvoMapService()
