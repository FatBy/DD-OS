/**
 * OpenClaw 数据 → UI 概念映射层
 * 
 * 将 OpenClaw 的真实数据结构映射为游戏化的 UI 概念:
 * - Sessions → Tasks (任务看板)
 * - Channels → Skills (技能树)
 * - Session History → Memories (记忆宫殿)
 * - Health/Presence/Agent → Soul (灵魂塔)
 */

import type { 
  Session, Channel, ChannelType, Device, HealthSnapshot, AgentIdentity,
  TaskItem, SkillNode, MemoryEntry, SoulDimension, SoulConfig
} from '@/types'

// ============================================
// Sessions → Tasks 映射
// ============================================

/**
 * 将 Session 映射为 TaskItem
 * - 最近活跃的会话 = 执行中的任务
 * - 有未读消息的会话 = 待处理任务
 * - 旧会话 = 已完成任务
 */
export function sessionToTask(session: Session): TaskItem {
  const now = Date.now()
  const age = now - session.updatedAt
  const isRecent = age < 3600000 // 1小时内
  const isActive = age < 300000 // 5分钟内
  
  // 根据活跃度决定状态
  let status: TaskItem['status'] = 'done'
  if (isActive) {
    status = 'executing'
  } else if (isRecent) {
    status = 'pending'
  }
  
  // 根据消息数量决定优先级
  let priority: TaskItem['priority'] = 'low'
  if (session.messageCount && session.messageCount > 20) {
    priority = 'high'
  } else if (session.messageCount && session.messageCount > 5) {
    priority = 'medium'
  }
  
  // 生成描述
  const description = session.lastMessage?.content || '暂无消息'
  
  return {
    id: session.key,
    title: session.label || extractSessionTitle(session.key),
    description: description.slice(0, 100) + (description.length > 100 ? '...' : ''),
    status,
    priority,
    timestamp: new Date(session.updatedAt).toISOString(),
    sessionKey: session.key,
    messageCount: session.messageCount,
  }
}

function extractSessionTitle(key: string): string {
  // 从 session key 提取可读标题
  // 格式: agent::<mainKey>::dm:<peerId> 或 agent::<channel>::group:<groupId>
  const parts = key.split('::')
  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1]
    if (lastPart.startsWith('dm:')) {
      return `对话: ${lastPart.slice(3).slice(0, 12)}`
    }
    if (lastPart.startsWith('group:')) {
      return `群组: ${lastPart.slice(6).slice(0, 12)}`
    }
    if (lastPart.startsWith('channel:')) {
      return `频道: ${lastPart.slice(8).slice(0, 12)}`
    }
  }
  return key.slice(0, 20)
}

export function sessionsToTasks(sessions: Session[]): TaskItem[] {
  return sessions.map(sessionToTask).sort((a, b) => {
    // 按状态排序: executing > pending > done
    const statusOrder = { executing: 0, pending: 1, done: 2 }
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status]
    }
    // 同状态按时间倒序
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })
}

// ============================================
// Channels → Skills 映射
// ============================================

// 频道在技能树中的位置配置
const channelSkillConfig: Record<ChannelType, { x: number; y: number; deps: string[] }> = {
  webchat: { x: 250, y: 80, deps: [] },
  telegram: { x: 150, y: 180, deps: ['webchat'] },
  whatsapp: { x: 350, y: 180, deps: ['webchat'] },
  discord: { x: 100, y: 300, deps: ['telegram'] },
  slack: { x: 250, y: 300, deps: ['telegram', 'whatsapp'] },
  signal: { x: 400, y: 300, deps: ['whatsapp'] },
  matrix: { x: 50, y: 420, deps: ['discord'] },
  irc: { x: 180, y: 420, deps: ['discord', 'slack'] },
  teams: { x: 320, y: 420, deps: ['slack'] },
  feishu: { x: 450, y: 420, deps: ['signal'] },
  line: { x: 120, y: 520, deps: ['matrix', 'irc'] },
  nostr: { x: 380, y: 520, deps: ['teams', 'feishu'] },
}

const channelLabels: Record<ChannelType, string> = {
  webchat: 'WebChat',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  discord: 'Discord',
  slack: 'Slack',
  signal: 'Signal',
  matrix: 'Matrix',
  irc: 'IRC',
  teams: 'Teams',
  feishu: '飞书',
  line: 'LINE',
  nostr: 'Nostr',
}

/**
 * 将 Channel 映射为 SkillNode
 * - 已连接的频道 = 已解锁的技能
 * - 连接的账户数 = 技能等级
 */
export function channelToSkill(channel: Channel): SkillNode {
  const config = channelSkillConfig[channel.id] || { x: 250, y: 300, deps: [] }
  const connectedAccounts = channel.accounts.filter(a => a.connected).length
  
  return {
    id: channel.id,
    name: channelLabels[channel.id] || channel.label || channel.id,
    x: config.x,
    y: config.y,
    level: Math.min(connectedAccounts * 20 + (channel.enabled ? 20 : 0), 100),
    unlocked: channel.enabled && connectedAccounts > 0,
    dependencies: config.deps,
    channelId: channel.id,
    connected: connectedAccounts > 0,
    accountCount: channel.accounts.length,
  }
}

export function channelsToSkills(channels: Record<string, Channel>, order: ChannelType[]): SkillNode[] {
  // 如果 order 为空，从 channels 的 keys 中提取
  if (!order || order.length === 0) {
    order = Object.keys(channels || {}) as ChannelType[]
  }
  
  // 如果 channels 也为空，返回空数组
  if (!channels || Object.keys(channels).length === 0) {
    return []
  }
  
  return order
    .map(id => channels[id])
    .filter(Boolean)
    .map(channelToSkill)
}

// ============================================
// Session Messages → Memories 映射
// ============================================

/**
 * 将会话消息映射为记忆条目
 * - 最近的消息 = 短期记忆
 * - 旧的消息 = 长期记忆
 */
export function sessionToMemories(session: Session): MemoryEntry[] {
  const memories: MemoryEntry[] = []
  const now = Date.now()
  
  // 如果有最后消息，创建记忆条目
  if (session.lastMessage) {
    const age = now - session.lastMessage.timestamp
    const isRecent = age < 86400000 // 24小时内
    
    memories.push({
      id: `${session.key}-last`,
      title: session.label || extractSessionTitle(session.key),
      content: session.lastMessage.content,
      type: isRecent ? 'short-term' : 'long-term',
      timestamp: new Date(session.lastMessage.timestamp).toISOString(),
      tags: extractTags(session),
      sessionKey: session.key,
      role: session.lastMessage.role,
    })
  }
  
  return memories
}

function extractTags(session: Session): string[] {
  const tags: string[] = []
  const key = session.key
  
  if (key.includes('::dm:')) tags.push('私聊')
  if (key.includes('::group:')) tags.push('群组')
  if (key.includes('::channel:')) tags.push('频道')
  if (key.includes('telegram')) tags.push('Telegram')
  if (key.includes('whatsapp')) tags.push('WhatsApp')
  if (key.includes('discord')) tags.push('Discord')
  if (key.includes('webchat')) tags.push('WebChat')
  
  return tags
}

export function sessionsToMemories(sessions: Session[]): MemoryEntry[] {
  return sessions
    .flatMap(sessionToMemories)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

// ============================================
// Health/Presence/Agent → Soul 映射
// ============================================

/**
 * 将系统状态映射为灵魂维度
 * 始终返回 6 个维度，使用默认值填充缺失数据
 */
export function healthToSoulDimensions(
  health: HealthSnapshot | null,
  presence: { operators: string[]; nodes: string[] } | null,
  identity: AgentIdentity | null
): SoulDimension[] {
  const dimensions: SoulDimension[] = []
  
  // 生命力: 基于 health.status，默认 50
  const healthValue = health 
    ? (health.status === 'healthy' ? 90 : health.status === 'degraded' ? 60 : 30)
    : 50
  dimensions.push({ name: '生命力', value: healthValue })
  
  // 经验: 基于 uptime，默认 0
  const expValue = health ? Math.min(Math.floor(health.uptime / 3600000), 100) : 0
  dimensions.push({ name: '经验', value: expValue })
  
  // 感知: 基于 operators 数量，默认 25
  const perceptionValue = presence 
    ? Math.min(presence.operators.length * 25 + 25, 100)
    : 25
  dimensions.push({ name: '感知', value: perceptionValue })
  
  // 力量: 基于 nodes 数量，默认 20
  const powerValue = presence
    ? Math.min(presence.nodes.length * 20 + 20, 100)
    : 20
  dimensions.push({ name: '力量', value: powerValue })
  
  // 智慧: 基于 identity 存在，默认 0
  const wisdomValue = identity ? 85 : 0
  dimensions.push({ name: '智慧', value: wisdomValue })
  
  // 连接: 基于 health.status，默认 50
  const connectionValue = health?.status === 'healthy' ? 95 : 50
  dimensions.push({ name: '连接', value: connectionValue })
  
  return dimensions
}

/**
 * 生成灵魂配置
 * 确保 prompts 始终有值，即使数据源为空
 */
export function generateSoulConfig(
  health: HealthSnapshot | null,
  presence: { operators: string[]; nodes: string[]; devices: Record<string, Device> } | null,
  identity: AgentIdentity | null
): SoulConfig {
  const dimensions = healthToSoulDimensions(health, presence, identity)
  
  // 根据系统状态生成 prompts，提供友好的默认文案
  const prompts = {
    identity: identity 
      ? `我是 ${identity.name || 'OpenClaw Agent'}，ID: ${identity.agentId}。${identity.emoji || '🤖'}`
      : '已连接，等待获取 Agent 身份...',
    constraints: health
      ? `系统状态: ${health.status}\n运行时间: ${Math.floor(health.uptime / 3600000)}小时\n版本: ${health.version || '未知'}`
      : '系统状态获取中...',
    goals: presence
      ? `当前连接:\n- 操作者: ${presence.operators.length} 个\n- 节点: ${presence.nodes.length} 个`
      : '设备连接状态获取中...',
  }
  
  return { dimensions, prompts }
}
