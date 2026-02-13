import type { 
  RequestMessage, ResponseMessage, EventMessage, ServerMessage,
  Session, ChannelsSnapshot, AgentEvent, Device, HealthSnapshot, HelloOkPayload, LogEntry,
  OpenClawSkill
} from '@/types'
import { parseSoulMd, type ParsedSoul } from '@/utils/soulParser'

// ============================================
// 配置常量
// ============================================
const CONFIG = {
  HEARTBEAT_INTERVAL: 15000,     // 心跳间隔 15 秒 (OpenClaw 规范)
  HEARTBEAT_TIMEOUT: 30000,      // 心跳超时 30 秒
  RECONNECT_BASE_DELAY: 1000,    // 重连基础延迟 1 秒
  RECONNECT_MAX_DELAY: 30000,    // 重连最大延迟 30 秒
  RECONNECT_MAX_ATTEMPTS: 10,    // 最大重连次数
  REQUEST_TIMEOUT: 30000,        // 请求超时 30 秒
  PROTOCOL_VERSION: 3,           // 协议版本
}

// ============================================
// 类型定义
// ============================================
interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timeout: number
}

type StoreActions = {
  // Connection
  setConnectionStatus: (status: string) => void
  setConnectionError: (error: string | null) => void
  setReconnectAttempt: (attempt: number) => void
  setReconnectCountdown: (countdown: number | null) => void
  addToast: (toast: { type: string; title: string; message?: string }) => void
  
  // Sessions → Tasks
  setSessions: (sessions: Session[]) => void
  addSession: (session: Session) => void
  updateSession: (key: string, updates: Partial<Session>) => void
  removeSession: (key: string) => void
  setSessionsLoading: (loading: boolean) => void
  
  // Channels → Skills (兼容旧 API)
  setChannelsSnapshot: (snapshot: ChannelsSnapshot) => void
  setChannelConnected: (id: string, accountId: string, connected: boolean) => void
  setChannelsLoading: (loading: boolean) => void
  
  // OpenClaw Skills → Skills (新 API)
  setOpenClawSkills: (skills: OpenClawSkill[]) => void
  
  // Agent → Memories
  setAgentIdentity: (identity: { agentId: string; name?: string; emoji?: string } | null) => void
  setAgentStatus: (status: string) => void
  addRunEvent: (event: AgentEvent) => void
  addLog: (log: LogEntry) => void
  setAgentLoading: (loading: boolean) => void
  setMemoriesFromSessions: (sessions: Session[]) => void
  
  // Devices → Soul
  setPresenceSnapshot: (snapshot: { devices: Record<string, Device>; operators: string[]; nodes: string[] }) => void
  updateDevice: (id: string, updates: Partial<Device>) => void
  removeDevice: (id: string) => void
  setHealth: (health: HealthSnapshot | null) => void
  setDevicesLoading: (loading: boolean) => void
  updateSoulFromState: (identity: { agentId: string; name?: string; emoji?: string } | null) => void
  
  // Soul from SOUL.md
  setSoulFromParsed: (parsed: ParsedSoul, agentIdentity: { agentId: string; name?: string; emoji?: string } | null) => void
}

// ============================================
// WebSocket 服务类
// ============================================
class OpenClawService {
  private ws: WebSocket | null = null
  private pendingRequests: Map<string, PendingRequest> = new Map()
  private reconnectAttempt = 0
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null
  private heartbeatTimeoutTimer: number | null = null
  private countdownTimer: number | null = null
  private isManualDisconnect = false
  private storeActions: StoreActions | null = null
  private authToken: string = ''
  private gatewayUrl: string = ''  // 自定义 Gateway 地址
  private tickInterval: number = CONFIG.HEARTBEAT_INTERVAL

  // 注入 Store actions (避免循环依赖)
  injectStore(actions: StoreActions) {
    this.storeActions = actions
  }

  // 设置认证 Token
  setAuthToken(token: string) {
    this.authToken = token
  }

  // 设置 Gateway 地址 (支持远程直连，不走代理)
  setGatewayUrl(url: string) {
    if (!url) {
      this.gatewayUrl = ''
      return
    }
    // 自动补全协议
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = `ws://${url}`
    }
    // 移除尾部斜杠
    this.gatewayUrl = url.replace(/\/+$/, '')
  }

  // 获取 WebSocket URL
  private getWsUrl(): string {
    // 1. 如果指定了自定义 Gateway 地址，直连（用于远程调试）
    if (this.gatewayUrl) {
      return this.gatewayUrl
    }
    // 2. 默认使用相对路径 /ws，通过代理转发
    //    - 开发环境: Vite 代理 (vite.config.ts 配置 target)
    //    - 生产环境: nginx/Caddy 代理
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws`
  }

  // 生成唯一 ID
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  }

  // ============================================
  // 公开方法
  // ============================================

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    this.isManualDisconnect = false
    this.storeActions?.setConnectionStatus('connecting')
    this.storeActions?.setConnectionError(null)

    return new Promise((resolve, reject) => {
      try {
        // 构建带 token 的 URL (浏览器 WebSocket 不支持自定义 headers)
        let url = this.getWsUrl()
        if (this.authToken) {
          url += `?token=${encodeURIComponent(this.authToken)}`
        }
        
        console.log('[OpenClawService] Connecting to:', url.replace(/token=.*/, 'token=***'))
        this.ws = new WebSocket(url)

        const timeout = window.setTimeout(() => {
          if (this.ws?.readyState !== WebSocket.OPEN) {
            this.ws?.close()
            reject(new Error('Connection timeout'))
          }
        }, CONFIG.REQUEST_TIMEOUT)

        this.ws.onopen = () => {
          clearTimeout(timeout)
          this.handleOpen()
          resolve()
        }

        this.ws.onclose = (event) => {
          clearTimeout(timeout)
          this.handleClose(event)
        }

        this.ws.onerror = (error) => {
          clearTimeout(timeout)
          this.handleError(error)
          reject(error)
        }

        this.ws.onmessage = (event) => {
          this.handleMessage(event)
        }
      } catch (error) {
        this.storeActions?.setConnectionStatus('error')
        this.storeActions?.setConnectionError(String(error))
        reject(error)
      }
    })
  }

  disconnect(): void {
    this.isManualDisconnect = true
    this.cleanup()
    
    if (this.ws) {
      this.ws.close(1000, 'Manual disconnect')
      this.ws = null
    }

    this.storeActions?.setConnectionStatus('disconnected')
    this.storeActions?.setConnectionError(null)
    this.storeActions?.setReconnectAttempt(0)
    this.storeActions?.setReconnectCountdown(null)
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected')
    }

    const id = this.generateId()
    const message: RequestMessage = {
      type: 'req',
      id,
      method,
      params,
    }

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout: ${method}`))
      }, CONFIG.REQUEST_TIMEOUT)

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      })

      this.ws!.send(JSON.stringify(message))
    })
  }

  retry(): void {
    this.reconnectAttempt = 0
    this.connect().catch(console.error)
  }

  // 加载初始数据
  async loadInitialData(): Promise<void> {
    try {
      // 并行请求初始数据 (包括新的 skills.list 和 files.read API)
      const [sessionsResult, skillsResult, channelsResult, agentResult, soulResult] = await Promise.allSettled([
        this.send<{ sessions: Session[] }>('sessions.list', { limit: 50, includeLastMessage: true }),
        this.send<{ skills: OpenClawSkill[] }>('skills.list', {}),
        this.send<ChannelsSnapshot>('channels.status', {}),
        this.send<{ agentId: string; name?: string; emoji?: string }>('agent.identity', {}),
        // 尝试读取 SOUL.md 文件
        this.send<{ content: string } | string>('files.read', { path: 'SOUL.md' }),
      ])

      let sessions: Session[] = []
      let agentIdentity: { agentId: string; name?: string; emoji?: string } | null = null

      // 处理 Sessions → Tasks + Memories
      if (sessionsResult.status === 'fulfilled' && sessionsResult.value) {
        console.log('[OpenClawService] sessions.list raw response:', sessionsResult.value)
        sessions = (sessionsResult.value as { sessions?: Session[] }).sessions || []
        this.storeActions?.setSessions(sessions)
        this.storeActions?.setMemoriesFromSessions(sessions)
      }
      this.storeActions?.setSessionsLoading(false)

      // 处理 Skills (优先使用 skills.list API)
      let skillsLoaded = false
      if (skillsResult.status === 'fulfilled' && skillsResult.value) {
        const skillsResponse = skillsResult.value as { skills?: OpenClawSkill[] }
        console.log('[OpenClawService] skills.list raw response:', skillsResponse)
        if (skillsResponse.skills && Array.isArray(skillsResponse.skills) && skillsResponse.skills.length > 0) {
          this.storeActions?.setOpenClawSkills(skillsResponse.skills)
          skillsLoaded = true
        }
      } else if (skillsResult.status === 'rejected') {
        console.log('[OpenClawService] skills.list API not available:', skillsResult.reason)
      }
      
      // 如果 skills.list 没有返回数据，回退到 channels.status
      if (!skillsLoaded && channelsResult.status === 'fulfilled' && channelsResult.value) {
        console.log('[OpenClawService] channels.status raw response (fallback):', channelsResult.value)
        this.storeActions?.setChannelsSnapshot(channelsResult.value as ChannelsSnapshot)
      }
      
      // 确保 channelsLoading 变为 false（无论 API 是否成功）
      this.storeActions?.setChannelsLoading(false)

      // 处理 Agent Identity
      if (agentResult.status === 'fulfilled' && agentResult.value) {
        agentIdentity = agentResult.value as { agentId: string; name?: string; emoji?: string }
        this.storeActions?.setAgentIdentity(agentIdentity)
      }
      this.storeActions?.setAgentLoading(false)

      // 处理 SOUL.md 文件内容
      if (soulResult.status === 'fulfilled' && soulResult.value) {
        console.log('[OpenClawService] files.read SOUL.md raw response:', soulResult.value)
        // 响应可能是 { content: string } 或直接是 string
        const soulContent = typeof soulResult.value === 'string' 
          ? soulResult.value 
          : (soulResult.value as { content?: string }).content || ''
        
        if (soulContent) {
          const parsedSoul = parseSoulMd(soulContent)
          console.log('[OpenClawService] Parsed SOUL.md:', parsedSoul)
          this.storeActions?.setSoulFromParsed(parsedSoul, agentIdentity)
        }
      } else if (soulResult.status === 'rejected') {
        console.log('[OpenClawService] files.read SOUL.md not available:', soulResult.reason)
        // 如果无法读取 SOUL.md，使用 agent identity 更新基本信息
        this.storeActions?.updateSoulFromState(agentIdentity)
      }

      // 确保 devicesLoading 最终为 false（兜底逻辑）
      this.storeActions?.setDevicesLoading(false)

    } catch (error) {
      console.error('[OpenClawService] Failed to load initial data:', error)
      // 即使出错也要确保 loading 状态结束
      this.storeActions?.setSessionsLoading(false)
      this.storeActions?.setChannelsLoading(false)
      this.storeActions?.setAgentLoading(false)
      this.storeActions?.setDevicesLoading(false)
    }
  }

  // ============================================
  // 私有方法 - 事件处理
  // ============================================

  private handleOpen(): void {
    console.log('[OpenClawService] WebSocket connected, waiting for challenge...')
    this.reconnectAttempt = 0
    this.storeActions?.setReconnectAttempt(0)
    this.storeActions?.setReconnectCountdown(null)
  }

  private async handleChallenge(_payload: { nonce: string; ts: number }): Promise<void> {
    console.log('[OpenClawService] Received challenge, sending connect request...')
    
    const instanceId = this.getDeviceId()

    try {
      // webclaw 风格: 不发送 device，只用 token/password 认证
      const response = await this.send('connect', {
        minProtocol: CONFIG.PROTOCOL_VERSION,
        maxProtocol: CONFIG.PROTOCOL_VERSION,
        client: {
          id: 'gateway-client',
          displayName: 'DD-OS',
          version: '1.0.0',
          platform: 'browser',
          mode: 'ui',
          instanceId,
        },
        auth: {
          token: this.authToken || undefined,
        },
        role: 'operator',
        scopes: ['operator.admin'],
      })

      console.log('[OpenClawService] Connect response:', response)
      this.handleHelloResponse(response as HelloOkPayload)
    } catch (error) {
      console.error('[OpenClawService] Connect failed:', error)
      this.storeActions?.setConnectionStatus('error')
      this.storeActions?.setConnectionError('认证失败: ' + String(error))
    }
  }

  private handleHelloResponse(response: HelloOkPayload): void {
    // 更新心跳间隔
    if (response?.policy?.tickIntervalMs) {
      this.tickInterval = response.policy.tickIntervalMs
      console.log('[OpenClawService] Using server tick interval:', this.tickInterval)
    }
    
    // 处理初始 presence 数据
    if (response?.presence) {
      this.storeActions?.setPresenceSnapshot(response.presence)
    } else {
      // 如果握手响应不包含 presence，也要确保 loading 结束
      this.storeActions?.setDevicesLoading(false)
    }
    
    // 处理初始 health 数据
    if (response?.health) {
      this.storeActions?.setHealth(response.health)
    }
    
    // 握手完成
    this.storeActions?.setConnectionStatus('connected')
    this.storeActions?.addToast({
      type: 'success',
      title: '已连接',
      message: '已连接到 OpenClaw Gateway',
    })
    
    // 启动心跳
    this.startHeartbeat()
    
    // 加载初始数据
    this.loadInitialData()
  }

  private getDeviceId(): string {
    const key = 'openclaw_device_id'
    let deviceId = localStorage.getItem(key)
    if (!deviceId) {
      deviceId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
      localStorage.setItem(key, deviceId)
    }
    return deviceId
  }

  // ============================================
  // 设备密钥对管理 (Web Crypto API)
  // ============================================

  private async getOrCreateDeviceKeys(): Promise<{ publicKey: string; privateKey: CryptoKey }> {
    const storedPub = localStorage.getItem('openclaw_device_pubkey')
    const storedPriv = localStorage.getItem('openclaw_device_privkey')

    if (storedPub && storedPriv) {
      try {
        const privKeyData = Uint8Array.from(atob(storedPriv), c => c.charCodeAt(0))
        const privateKey = await crypto.subtle.importKey(
          'pkcs8', privKeyData,
          { name: 'ECDSA', namedCurve: 'P-256' },
          false, ['sign']
        )
        return { publicKey: storedPub, privateKey }
      } catch {
        // 密钥损坏，重新生成
        this.resetDeviceIdentity()
      }
    }

    // 生成新密钥对
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true, ['sign', 'verify']
    )

    // 导出公钥 (Base64)
    const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
    const publicKey = btoa(String.fromCharCode(...new Uint8Array(pubRaw)))

    // 导出私钥 (Base64) 用于持久化
    const privRaw = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
    const privBase64 = btoa(String.fromCharCode(...new Uint8Array(privRaw)))

    localStorage.setItem('openclaw_device_pubkey', publicKey)
    localStorage.setItem('openclaw_device_privkey', privBase64)

    return { publicKey, privateKey: keyPair.privateKey }
  }

  // 重置设备身份（清除旧密钥和设备 ID）
  resetDeviceIdentity(): void {
    localStorage.removeItem('openclaw_device_id')
    localStorage.removeItem('openclaw_device_pubkey')
    localStorage.removeItem('openclaw_device_privkey')
  }

  private async signNonce(privateKey: CryptoKey, nonce: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(nonce)
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey, data
    )
    return btoa(String.fromCharCode(...new Uint8Array(signature)))
  }

  private handleClose(event: CloseEvent): void {
    console.log('[OpenClawService] Connection closed:', event.code, event.reason)
    this.cleanup()

    if (!this.isManualDisconnect) {
      this.storeActions?.addToast({
        type: 'warning',
        title: '连接断开',
        message: '正在尝试重新连接...',
      })
      this.scheduleReconnect()
    }
  }

  private handleError(error: Event): void {
    console.error('[OpenClawService] WebSocket error:', error)
    this.storeActions?.setConnectionError('WebSocket connection error')
  }

  private handleMessage(event: MessageEvent): void {
    this.resetHeartbeatTimeout()

    try {
      const message: ServerMessage = JSON.parse(event.data)

      if (message.type === 'res') {
        this.handleResponse(message)
      } else if (message.type === 'event') {
        this.dispatchEvent(message)
      }
    } catch (error) {
      console.error('[OpenClawService] Failed to parse message:', error)
    }
  }

  private handleResponse(response: ResponseMessage): void {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) {
      console.warn('[OpenClawService] No pending request for id:', response.id)
      return
    }

    clearTimeout(pending.timeout)
    this.pendingRequests.delete(response.id)

    if (response.ok) {
      pending.resolve(response.payload)
    } else {
      pending.reject(new Error(response.error?.message || 'Request failed'))
    }
  }

  // ============================================
  // 私有方法 - 事件分发 (OpenClaw 真实事件)
  // ============================================

  private dispatchEvent(event: EventMessage): void {
    console.log('[OpenClawService] Event received:', event.event, event.payload)

    switch (event.event) {
      // 握手事件
      case 'connect.challenge': {
        const challengePayload = event.payload as { nonce: string; ts: number }
        this.handleChallenge(challengePayload)
        break
      }

      // 心跳响应
      case 'tick':
      case 'pong':
        break

      // 健康状态更新
      case 'health': {
        const healthPayload = event.payload as HealthSnapshot
        this.storeActions?.setHealth(healthPayload)
        break
      }

      // 设备在线状态
      case 'presence': {
        const presencePayload = event.payload as { devices: Record<string, Device>; operators: string[]; nodes: string[] }
        this.storeActions?.setPresenceSnapshot(presencePayload)
        break
      }

      // Agent 执行事件
      case 'agent': {
        const agentPayload = event.payload as AgentEvent
        this.storeActions?.addRunEvent(agentPayload)
        // 添加日志
        this.storeActions?.addLog({
          id: `${agentPayload.runId}-${agentPayload.seq}`,
          timestamp: agentPayload.ts,
          level: 'info',
          message: `[${agentPayload.stream}] ${JSON.stringify(agentPayload.data).slice(0, 100)}`,
        })
        break
      }

      // 聊天消息事件
      case 'chat': {
        const chatPayload = event.payload as { sessionKey: string; message: unknown }
        // 更新会话的最后消息
        if (chatPayload.sessionKey) {
          this.storeActions?.updateSession(chatPayload.sessionKey, {
            updatedAt: Date.now(),
            lastMessage: chatPayload.message as Session['lastMessage'],
          })
        }
        break
      }

      // 执行审批请求
      case 'exec.approval.requested': {
        this.storeActions?.addToast({
          type: 'warning',
          title: '执行审批',
          message: '有操作需要您的批准',
        })
        this.storeActions?.setAgentStatus('pending')
        break
      }

      // 系统关闭通知
      case 'shutdown': {
        this.storeActions?.addToast({
          type: 'warning',
          title: '系统关闭',
          message: 'Gateway 正在关闭...',
        })
        break
      }

      default:
        console.log('[OpenClawService] Unhandled event:', event.event)
    }
  }

  // ============================================
  // 私有方法 - 心跳机制
  // ============================================

  private startHeartbeat(): void {
    this.stopHeartbeat()

    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'req', id: this.generateId(), method: 'ping' }))

        this.heartbeatTimeoutTimer = window.setTimeout(() => {
          console.warn('[OpenClawService] Heartbeat timeout, closing connection')
          this.ws?.close(4000, 'Heartbeat timeout')
        }, CONFIG.HEARTBEAT_TIMEOUT)
      }
    }, this.tickInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this.resetHeartbeatTimeout()
  }

  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer)
      this.heartbeatTimeoutTimer = null
    }
  }

  // ============================================
  // 私有方法 - 重连机制
  // ============================================

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= CONFIG.RECONNECT_MAX_ATTEMPTS) {
      console.error('[OpenClawService] Max reconnect attempts reached')
      this.storeActions?.setConnectionStatus('error')
      this.storeActions?.setConnectionError('无法连接到服务器，已达到最大重试次数')
      this.storeActions?.addToast({
        type: 'error',
        title: '连接失败',
        message: '无法连接到服务器，请检查网络后手动重试',
      })
      return
    }

    const delay = Math.min(
      CONFIG.RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempt),
      CONFIG.RECONNECT_MAX_DELAY
    )

    console.log(`[OpenClawService] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempt + 1}/${CONFIG.RECONNECT_MAX_ATTEMPTS})`)

    this.storeActions?.setConnectionStatus('reconnecting')
    this.storeActions?.setReconnectAttempt(this.reconnectAttempt + 1)

    let countdown = Math.ceil(delay / 1000)
    this.storeActions?.setReconnectCountdown(countdown)

    this.countdownTimer = window.setInterval(() => {
      countdown--
      if (countdown > 0) {
        this.storeActions?.setReconnectCountdown(countdown)
      } else {
        if (this.countdownTimer) {
          clearInterval(this.countdownTimer)
          this.countdownTimer = null
        }
        this.storeActions?.setReconnectCountdown(null)
      }
    }, 1000)

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectAttempt++
      this.connect().catch(console.error)
    }, delay)
  }

  // ============================================
  // 私有方法 - 清理
  // ============================================

  private cleanup(): void {
    this.stopHeartbeat()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }

    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Connection closed'))
    })
    this.pendingRequests.clear()
  }
}

// 导出单例
export const openClawService = new OpenClawService()
