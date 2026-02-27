/**
 * EvoMap GEP-A2A Protocol Client
 * 
 * 连接 EvoMap 协作进化市场
 * 协议版本: GEP-A2A v1.0.0
 * Hub URL: https://evomap.ai
 * 
 * 参考文档: https://evomap.ai/skill.md
 */

// ============================================
// 类型定义
// ============================================

export interface GEPEnvelope {
  protocol: 'gep-a2a'
  protocol_version: '1.0.0'
  message_type: string
  message_id: string
  sender_id: string
  timestamp: string
  payload: Record<string, unknown>
}

export interface HelloResponse {
  status: 'acknowledged'
  your_node_id: string
  hub_node_id: string
  claim_code: string
  claim_url: string
  credit_balance: number
  survival_status: 'alive' | 'dormant' | 'dead'
  referral_code: string
  heartbeat_interval_ms: number
  heartbeat_endpoint: string
  recommended_tasks?: BountyTask[]
  starter_gene_pack?: Asset[]
  network_manifest: {
    skill_url: string
    hub_url: string
    protocol_version: string
    total_agents?: number
    active_agents?: number
    total_assets?: number
  }
}

export interface HeartbeatResponse {
  status: 'ok' | 'error'
  credit_balance?: number
  survival_status?: 'alive' | 'dormant' | 'dead'
}

export interface Asset {
  asset_id: string
  asset_type: 'Gene' | 'Capsule' | 'EvolutionEvent'
  summary: string
  confidence: number
  signals_match?: string[]
  blast_radius?: { files: number; lines: number }
  content?: string
  created_at?: string
  author_node_id?: string
  gdi_score?: number
  chain_id?: string
}

export interface FetchResponse {
  assets: Asset[]
  tasks?: BountyTask[]
  total_count: number
  has_more: boolean
  network_manifest?: HelloResponse['network_manifest']
}

export interface PublishResponse {
  status: 'accepted' | 'rejected'
  asset_ids: string[]
  errors?: string[]
  credits_earned?: number
}

export interface BountyTask {
  task_id: string
  title: string
  description?: string
  body?: string
  bounty: number
  deadline?: string
  required_reputation?: number
  status: 'open' | 'claimed' | 'completed' | 'expired'
  tags?: string[]
}

export interface TaskClaimResponse {
  status: 'claimed' | 'error'
  task_id: string
  deadline?: string
  message?: string
}

export interface TaskCompleteResponse {
  status: 'completed' | 'rejected'
  credits_earned?: number
  reputation_change?: number
  message?: string
}

export interface NodeInfo {
  node_id: string
  reputation: number
  credit_balance: number
  survival_status: 'alive' | 'dormant' | 'dead'
  total_assets: number
  promoted_count: number
  rejected_count: number
  revoked_count: number
  referral_count?: number
}

export interface DirectoryEntry {
  node_id: string
  reputation: number
  credit_balance: number
  survival_status: string
  capabilities: string[]
  referral_count?: number
}

export interface EvoMapState {
  connected: boolean
  nodeId: string | null
  claimCode: string | null
  claimUrl: string | null
  credits: number
  reputation: number
  survivalStatus: 'alive' | 'dormant' | 'dead' | null
  pendingTasks: number
  lastHeartbeat: number | null
  starterGenePack: Asset[]
  error: string | null
}

// ============================================
// 常量
// ============================================

const PROTOCOL = 'gep-a2a'
const PROTOCOL_VERSION = '1.0.0'
const DEFAULT_HEARTBEAT_INTERVAL = 15 * 60 * 1000 // 15 分钟

/** 获取代理 URL（通过本地后端转发，解决 CORS 问题） */
function getProxyUrl(path: string): string {
  const serverUrl = localStorage.getItem('ddos_server_url') || 'http://localhost:3001'
  // /a2a/hello -> /api/evomap/a2a/hello
  return `${serverUrl}/api/evomap${path}`
}

// localStorage keys
const STORAGE_KEYS = {
  NODE_ID: 'evomap_node_id',
  CLAIM_CODE: 'evomap_claim_code',
  CREDITS: 'evomap_credits',
  REPUTATION: 'evomap_reputation',
  AUTO_CONNECT: 'evomap_auto_connect',
}

// ============================================
// 工具函数
// ============================================

/** 生成随机 hex 字符串 */
function randomHex(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** 生成消息 ID */
function generateMessageId(): string {
  return `msg_${Date.now()}_${randomHex(4)}`
}

/** 获取或生成节点 ID */
function getOrCreateNodeId(): string {
  let nodeId = localStorage.getItem(STORAGE_KEYS.NODE_ID)
  if (!nodeId) {
    nodeId = `node_${randomHex(8)}`
    localStorage.setItem(STORAGE_KEYS.NODE_ID, nodeId)
  }
  return nodeId
}

/** 计算 SHA256 哈希 */
async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder()
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(data))
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** 规范化 JSON（用于 asset_id 计算）- 按 key 排序 */
function canonicalJson(obj: Record<string, unknown>): string {
  const sortKeys = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(sortKeys)
    if (o && typeof o === 'object') {
      return Object.keys(o as Record<string, unknown>).sort().reduce((acc, key) => {
        acc[key] = sortKeys((o as Record<string, unknown>)[key])
        return acc
      }, {} as Record<string, unknown>)
    }
    return o
  }
  return JSON.stringify(sortKeys(obj))
}

/** 计算 asset_id (sha256:xxx 格式) */
async function computeAssetId(asset: Omit<Asset, 'asset_id'>): Promise<string> {
  const json = canonicalJson(asset as Record<string, unknown>)
  const hash = await sha256(json)
  return `sha256:${hash}`
}

/** 构建 GEP-A2A 协议信封 */
function buildEnvelope(messageType: string, payload: Record<string, unknown>): GEPEnvelope {
  return {
    protocol: PROTOCOL,
    protocol_version: PROTOCOL_VERSION,
    message_type: messageType,
    message_id: generateMessageId(),
    sender_id: getOrCreateNodeId(),
    timestamp: new Date().toISOString(),
    payload,
  }
}

// ============================================
// EvoMap Service 类
// ============================================

class EvoMapService {
  private state: EvoMapState = {
    connected: false,
    nodeId: null,
    claimCode: null,
    claimUrl: null,
    credits: 0,
    reputation: 0,
    survivalStatus: null,
    pendingTasks: 0,
    lastHeartbeat: null,
    starterGenePack: [],
    error: null,
  }

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL
  private listeners: Set<(state: EvoMapState) => void> = new Set()

  constructor() {
    // 从 localStorage 恢复状态
    this.state.nodeId = localStorage.getItem(STORAGE_KEYS.NODE_ID)
    this.state.claimCode = localStorage.getItem(STORAGE_KEYS.CLAIM_CODE)
    this.state.credits = parseInt(localStorage.getItem(STORAGE_KEYS.CREDITS) || '0', 10)
    this.state.reputation = parseInt(localStorage.getItem(STORAGE_KEYS.REPUTATION) || '0', 10)

    // 自动重连：如果之前已连接过，延迟自动 hello
    if (localStorage.getItem(STORAGE_KEYS.AUTO_CONNECT) === 'true' && this.state.nodeId) {
      setTimeout(() => {
        console.log('[EvoMap] Auto-connecting...')
        this.hello().catch(err => {
          console.warn('[EvoMap] Auto-connect failed:', err)
        })
      }, 2000) // 延迟 2 秒等后端就绪
    }
  }

  /** 获取当前状态 */
  getState(): EvoMapState {
    return { ...this.state }
  }

  /** 订阅状态变化 */
  subscribe(listener: (state: EvoMapState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 通知状态变化 */
  private notify(): void {
    const state = this.getState()
    this.listeners.forEach(l => l(state))
  }

  /** 更新状态 */
  private updateState(partial: Partial<EvoMapState>): void {
    this.state = { ...this.state, ...partial }
    
    // 持久化关键状态
    if (partial.nodeId !== undefined && partial.nodeId) {
      localStorage.setItem(STORAGE_KEYS.NODE_ID, partial.nodeId)
    }
    if (partial.claimCode !== undefined && partial.claimCode) {
      localStorage.setItem(STORAGE_KEYS.CLAIM_CODE, partial.claimCode)
    }
    if (partial.credits !== undefined) {
      localStorage.setItem(STORAGE_KEYS.CREDITS, String(partial.credits))
    }
    if (partial.reputation !== undefined) {
      localStorage.setItem(STORAGE_KEYS.REPUTATION, String(partial.reputation))
    }
    
    this.notify()
  }

  // ============================================
  // 核心 API
  // ============================================

  /**
   * 注册节点 (Hello)
   * 首次连接或重新注册
   */
  async hello(referrer?: string): Promise<HelloResponse> {
    console.log('[EvoMap] Registering node...')
    
    const nodeId = getOrCreateNodeId()
    
    const envelope = buildEnvelope('hello', {
      capabilities: {
        'skill-execution': true,
        'task-completion': true,
        'asset-publishing': true,
      },
      gene_count: 0,
      capsule_count: 0,
      env_fingerprint: {
        platform: navigator.platform,
        arch: navigator.userAgent.includes('x64') ? 'x64' : 'unknown',
        userAgent: navigator.userAgent.slice(0, 50),
      },
      ...(referrer ? { referrer } : {}),
    })

    try {
      // evomap.ai 响应较慢 (30+ 秒)，需要较长超时
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 120_000) // 120s timeout

      const response = await fetch(getProxyUrl('/a2a/hello'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`EvoMap hello failed (${response.status}): ${errorText}`)
      }

      const raw = await response.json()
      console.log('[EvoMap] Hello raw response:', JSON.stringify(raw, null, 2))
      
      // GEP envelope: 实际数据可能在 payload 中
      const data: HelloResponse = raw.payload ? raw.payload : raw
      
      // 使用返回的 your_node_id（但我们已经生成了自己的，应该一致）
      this.updateState({
        connected: true,
        nodeId: data.your_node_id || nodeId,
        claimCode: data.claim_code,
        claimUrl: data.claim_url,
        credits: data.credit_balance ?? raw.credit_balance ?? 0,
        reputation: (data as any).reputation ?? (raw as any).reputation ?? 0,
        survivalStatus: data.survival_status || raw.survival_status,
        starterGenePack: data.starter_gene_pack || [],
        error: null,
      })

      // 标记自动连接
      localStorage.setItem(STORAGE_KEYS.AUTO_CONNECT, 'true')

      // 设置心跳间隔
      this.heartbeatIntervalMs = data.heartbeat_interval_ms || DEFAULT_HEARTBEAT_INTERVAL

      // 启动心跳
      this.startHeartbeat()

      console.log('[EvoMap] Node registered:', data.your_node_id)
      console.log('[EvoMap] Claim URL:', data.claim_url)
      console.log('[EvoMap] Credits:', data.credit_balance)
      console.log('[EvoMap] Survival:', data.survival_status)
      if (data.starter_gene_pack?.length) {
        console.log('[EvoMap] Received starter gene pack:', data.starter_gene_pack.length, 'genes')
      }
      
      return data
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.updateState({ connected: false, error })
      console.error('[EvoMap] Hello failed:', error)
      throw err
    }
  }

  /**
   * 心跳保活（轻量级，不需要完整信封）
   */
  async heartbeat(): Promise<HeartbeatResponse> {
    const nodeId = this.state.nodeId || getOrCreateNodeId()
    
    try {
      const response = await fetch(getProxyUrl('/a2a/heartbeat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId }),
      })

      if (!response.ok) {
        throw new Error(`Heartbeat failed: ${response.status}`)
      }

      const data: HeartbeatResponse = await response.json()
      
      this.updateState({
        connected: true,
        lastHeartbeat: Date.now(),
        ...(data.credit_balance !== undefined ? { credits: data.credit_balance } : {}),
        ...(data.survival_status ? { survivalStatus: data.survival_status } : {}),
        error: null,
      })

      console.log('[EvoMap] Heartbeat OK - Status:', data.status)
      
      return data
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.updateState({ error })
      console.warn('[EvoMap] Heartbeat failed:', error)
      throw err
    }
  }

  /**
   * 启动心跳循环
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
    }
    
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat().catch(() => {
        console.log('[EvoMap] Heartbeat failed, will retry on next interval')
      })
    }, this.heartbeatIntervalMs)
    
    console.log('[EvoMap] Heartbeat started, interval:', this.heartbeatIntervalMs / 1000, 'seconds')
  }

  /**
   * 停止心跳
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
      console.log('[EvoMap] Heartbeat stopped')
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.stopHeartbeat()
    localStorage.removeItem(STORAGE_KEYS.AUTO_CONNECT)
    this.updateState({
      connected: false,
      error: null,
    })
    console.log('[EvoMap] Disconnected')
  }

  /**
   * 获取资产和任务
   */
  async fetch(options: {
    assetType?: 'Gene' | 'Capsule' | 'EvolutionEvent'
    includeTasks?: boolean
    limit?: number
    offset?: number
    tags?: string[]
  } = {}): Promise<FetchResponse> {
    console.log('[EvoMap] Fetching assets...')
    
    const envelope = buildEnvelope('fetch', {
      asset_type: options.assetType || 'Capsule',
      include_tasks: options.includeTasks ?? true,
      limit: options.limit || 20,
      offset: options.offset || 0,
      ...(options.tags?.length ? { tags: options.tags } : {}),
    })

    const response = await fetch(getProxyUrl('/a2a/fetch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    })

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`)
    }

    const data: FetchResponse = await response.json()
    
    console.log('[EvoMap] Fetched', data.assets.length, 'assets,', data.tasks?.length || 0, 'tasks')
    
    return data
  }

  /**
   * 发布资产包 (Gene + Capsule + 可选 EvolutionEvent)
   */
  async publish(bundle: {
    gene: Omit<Asset, 'asset_id' | 'asset_type'>
    capsule: Omit<Asset, 'asset_id' | 'asset_type'>
    evolutionEvent?: Omit<Asset, 'asset_id' | 'asset_type'>
    chainId?: string
  }): Promise<PublishResponse> {
    console.log('[EvoMap] Publishing bundle...')

    // 构建 Gene
    const geneWithType = { ...bundle.gene, asset_type: 'Gene' as const }
    const gene: Asset = {
      ...geneWithType,
      asset_id: await computeAssetId(geneWithType),
    }
    
    // 构建 Capsule
    const capsuleWithType = { ...bundle.capsule, asset_type: 'Capsule' as const }
    const capsule: Asset = {
      ...capsuleWithType,
      asset_id: await computeAssetId(capsuleWithType),
    }

    const assets: Asset[] = [gene, capsule]

    // 可选：EvolutionEvent
    if (bundle.evolutionEvent) {
      const eventWithType = { ...bundle.evolutionEvent, asset_type: 'EvolutionEvent' as const }
      const event: Asset = {
        ...eventWithType,
        asset_id: await computeAssetId(eventWithType),
      }
      assets.push(event)
    }

    const envelope = buildEnvelope('publish', {
      assets,
      ...(bundle.chainId ? { chain_id: bundle.chainId } : {}),
    })

    const response = await fetch(getProxyUrl('/a2a/publish'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Publish failed (${response.status}): ${errorText}`)
    }

    const data: PublishResponse = await response.json()
    
    if (data.status === 'accepted') {
      console.log('[EvoMap] Bundle published, asset IDs:', data.asset_ids)
      if (data.credits_earned) {
        this.updateState({ credits: this.state.credits + data.credits_earned })
        console.log('[EvoMap] Earned', data.credits_earned, 'credits')
      }
    } else {
      console.warn('[EvoMap] Bundle rejected:', data.errors)
    }
    
    return data
  }

  /**
   * 列出可用任务
   */
  async listTasks(options: {
    minBounty?: number
    limit?: number
  } = {}): Promise<BountyTask[]> {
    console.log('[EvoMap] Listing tasks...')
    
    const params = new URLSearchParams()
    if (options.minBounty) params.set('min_bounty', String(options.minBounty))
    if (options.limit) params.set('limit', String(options.limit))
    
    const url = getProxyUrl(`/a2a/task/list${params.toString() ? '?' + params : ''}`)
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`List tasks failed: ${response.status}`)
    }

    const tasks: BountyTask[] = await response.json()
    console.log('[EvoMap] Found', tasks.length, 'tasks')
    
    return tasks
  }

  /**
   * 认领任务
   */
  async claimTask(taskId: string): Promise<TaskClaimResponse> {
    console.log('[EvoMap] Claiming task:', taskId)
    
    const nodeId = this.state.nodeId || getOrCreateNodeId()
    
    const response = await fetch(getProxyUrl('/a2a/task/claim'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, node_id: nodeId }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Claim task failed (${response.status}): ${errorText}`)
    }

    const data: TaskClaimResponse = await response.json()
    
    if (data.status === 'claimed') {
      console.log('[EvoMap] Task claimed, deadline:', data.deadline)
    } else {
      console.warn('[EvoMap] Failed to claim task:', data.message)
    }
    
    return data
  }

  /**
   * 完成任务
   */
  async completeTask(taskId: string, assetId: string): Promise<TaskCompleteResponse> {
    console.log('[EvoMap] Completing task:', taskId)
    
    const nodeId = this.state.nodeId || getOrCreateNodeId()
    
    const response = await fetch(getProxyUrl('/a2a/task/complete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, asset_id: assetId, node_id: nodeId }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Complete task failed (${response.status}): ${errorText}`)
    }

    const data: TaskCompleteResponse = await response.json()
    
    if (data.status === 'completed') {
      console.log('[EvoMap] Task completed!')
      if (data.credits_earned) {
        this.updateState({ credits: this.state.credits + data.credits_earned })
        console.log('[EvoMap] Earned', data.credits_earned, 'credits')
      }
      if (data.reputation_change) {
        this.updateState({ reputation: this.state.reputation + data.reputation_change })
        console.log('[EvoMap] Reputation change:', data.reputation_change)
      }
    } else {
      console.warn('[EvoMap] Task completion rejected:', data.message)
    }
    
    return data
  }

  /**
   * 获取我认领的任务
   */
  async getMyTasks(): Promise<BountyTask[]> {
    const nodeId = this.state.nodeId || getOrCreateNodeId()
    
    const response = await fetch(getProxyUrl(`/a2a/task/my?node_id=${nodeId}`))
    
    if (!response.ok) {
      throw new Error(`Get my tasks failed: ${response.status}`)
    }

    return response.json()
  }

  /**
   * 获取节点信息（声誉等）
   */
  async getNodeInfo(nodeId?: string): Promise<NodeInfo> {
    const id = nodeId || this.state.nodeId || getOrCreateNodeId()
    
    const response = await fetch(getProxyUrl(`/a2a/nodes/${id}`))
    
    if (!response.ok) {
      throw new Error(`Get node info failed: ${response.status}`)
    }

    const data: NodeInfo = await response.json()
    
    // 更新本地状态
    if (!nodeId || nodeId === this.state.nodeId) {
      this.updateState({
        reputation: data.reputation,
        credits: data.credit_balance,
        survivalStatus: data.survival_status,
      })
    }
    
    return data
  }

  /**
   * 获取代理目录
   */
  async getDirectory(): Promise<DirectoryEntry[]> {
    console.log('[EvoMap] Fetching directory...')
    
    const response = await fetch(getProxyUrl('/a2a/directory'))
    if (!response.ok) {
      throw new Error(`Failed to fetch directory: ${response.status}`)
    }
    
    return response.json()
  }

  // ============================================
  // 资产转换工具
  // ============================================

  /**
   * 将 DD-OS 技能/经验转换为 EvoMap Capsule 格式
   */
  static skillToCapsule(skill: {
    name: string
    description: string
    content?: string
    successRate?: number
  }): Omit<Asset, 'asset_id' | 'asset_type'> {
    return {
      summary: `[${skill.name}] ${skill.description}`.slice(0, 500),
      confidence: skill.successRate || 0.8,
      signals_match: [skill.name.toLowerCase()],
      blast_radius: { files: 1, lines: 50 },
      content: skill.content,
    }
  }

  /**
   * 将 EvoMap Capsule 转换为 DD-OS 技能格式
   */
  static capsuleToSkill(capsule: Asset): {
    name: string
    description: string
    source: 'evomap'
    evomap_asset_id: string
    gdi_score?: number
  } {
    // 从 summary 提取名称
    const nameMatch = capsule.summary.match(/^\[([^\]]+)\]/)
    const name = nameMatch ? nameMatch[1] : `evomap_${capsule.asset_id.slice(7, 15)}`
    const description = nameMatch 
      ? capsule.summary.replace(/^\[[^\]]+\]\s*/, '')
      : capsule.summary

    return {
      name,
      description,
      source: 'evomap',
      evomap_asset_id: capsule.asset_id,
      gdi_score: capsule.gdi_score,
    }
  }
}

// 单例导出
export const evoMapService = new EvoMapService()

// 便捷函数导出
export const connectToEvoMap = (referrer?: string) => evoMapService.hello(referrer)
export const disconnectFromEvoMap = () => evoMapService.disconnect()
export const fetchEvoMapAssets = (options?: Parameters<typeof evoMapService.fetch>[0]) => evoMapService.fetch(options)
export const publishToEvoMap = (bundle: Parameters<typeof evoMapService.publish>[0]) => evoMapService.publish(bundle)
export const listEvoMapTasks = (options?: Parameters<typeof evoMapService.listTasks>[0]) => evoMapService.listTasks(options)
export const claimEvoMapTask = (taskId: string) => evoMapService.claimTask(taskId)
export const completeEvoMapTask = (taskId: string, assetId: string) => evoMapService.completeTask(taskId, assetId)
