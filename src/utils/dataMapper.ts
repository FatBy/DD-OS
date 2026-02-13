/**
 * OpenClaw 数据 → UI 概念映射层
 * 
 * 将 OpenClaw 的真实数据结构映射为游戏化的 UI 概念:
 * - Sessions → Tasks (任务看板)
 * - OpenClaw Skills → Skills (技能树)
 * - Session History → Memories (记忆宫殿)
 * - Health/Presence/Agent → Soul (灵魂塔)
 */

import type { 
  Session, Channel, ChannelType, Device, HealthSnapshot, AgentIdentity,
  TaskItem, SkillNode, MemoryEntry, SoulDimension, SoulConfig,
  OpenClawSkill, SkillCategory, SoulIdentity, SoulTruth, SoulBoundary
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
// OpenClaw Skills → SkillNodes 映射
// ============================================

// 技能类别配置 (用于布局和分类)
const skillCategoryConfig: Record<SkillCategory, { 
  label: string
  color: string
  baseY: number
}> = {
  core: { label: '核心工具', color: '#22d3ee', baseY: 60 },
  creative: { label: '创作设计', color: '#f472b6', baseY: 140 },
  ai: { label: 'AI记忆', color: '#a78bfa', baseY: 220 },
  search: { label: '搜索网络', color: '#34d399', baseY: 300 },
  integration: { label: '通道集成', color: '#fbbf24', baseY: 380 },
  domain: { label: '专业领域', color: '#f87171', baseY: 460 },
  devops: { label: '开发运维', color: '#60a5fa', baseY: 540 },
  other: { label: '其他', color: '#9ca3af', baseY: 620 },
}

// 根据技能名称推断类别
function inferSkillCategory(skillName: string): SkillCategory {
  const name = skillName.toLowerCase()
  
  // 核心工具
  if (['tmux', 'github', 'slack', 'url-digest', 'pptx-creator', 'weather', 'hn'].some(k => name.includes(k))) {
    return 'core'
  }
  // 创作设计
  if (['animation', 'svg', 'video', 'cinematic', 'content-remix', 'youtube', 'invoice'].some(k => name.includes(k))) {
    return 'creative'
  }
  // AI与记忆
  if (['memory', 'agent', 'ollama', 'zeroapi', 'clawdio', 'clawdo'].some(k => name.includes(k))) {
    return 'ai'
  }
  // 搜索网络
  if (['search', 'scraper', 'vibesurf', 'serper', 'baidu', 'searxng'].some(k => name.includes(k))) {
    return 'search'
  }
  // 通道集成
  if (['channel', 'gmail', 'calendly', 'figma', 'notion', 'stripe', 'olvid', 'bluebubbles'].some(k => name.includes(k))) {
    return 'integration'
  }
  // 专业领域
  if (['gaode', 'traffic', 'stock', 'shuangdian', 'wiim', 'zepto'].some(k => name.includes(k))) {
    return 'domain'
  }
  // 开发运维
  if (['openclaw', 'samma', 'sanctuary', 'moltlog', 'skill-creator', 'clawdhub'].some(k => name.includes(k))) {
    return 'devops'
  }
  
  return 'other'
}

/**
 * 将 OpenClaw Skill 映射为 SkillNode
 */
export function openClawSkillToNode(skill: OpenClawSkill, index: number, categoryIndex: number): SkillNode {
  const category = inferSkillCategory(skill.name)
  const config = skillCategoryConfig[category]
  
  // 根据类别和索引计算位置
  const x = 80 + (categoryIndex % 5) * 90
  const y = config.baseY
  
  return {
    id: skill.name,
    name: skill.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    x,
    y,
    level: skill.status === 'active' ? 80 : skill.status === 'inactive' ? 40 : 10,
    unlocked: skill.enabled && skill.status === 'active',
    dependencies: [],
    skillName: skill.name,
    category,
    version: skill.version,
    status: skill.status,
    description: skill.description,
  }
}

/**
 * 将 OpenClaw Skills 数组映射为 SkillNodes
 * 按类别分组布局
 */
export function openClawSkillsToNodes(skills: OpenClawSkill[]): SkillNode[] {
  if (!skills || skills.length === 0) {
    return []
  }
  
  // 按类别分组
  const byCategory = new Map<SkillCategory, OpenClawSkill[]>()
  for (const skill of skills) {
    const category = inferSkillCategory(skill.name)
    if (!byCategory.has(category)) {
      byCategory.set(category, [])
    }
    byCategory.get(category)!.push(skill)
  }
  
  // 转换为 SkillNodes
  const nodes: SkillNode[] = []
  let globalIndex = 0
  
  for (const [category, categorySkills] of byCategory) {
    categorySkills.forEach((skill, categoryIndex) => {
      nodes.push(openClawSkillToNode(skill, globalIndex++, categoryIndex))
    })
  }
  
  return nodes
}

// 导出类别配置供 UI 使用
export { skillCategoryConfig }

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
 * 基于 SOUL.md/IDENTITY.md 结构
 */
export function generateSoulConfig(
  health: HealthSnapshot | null,
  presence: { operators: string[]; nodes: string[]; devices: Record<string, Device> } | null,
  identity: AgentIdentity | null
): SoulConfig {
  const dimensions = healthToSoulDimensions(health, presence, identity)
  
  // Soul Identity (基于 agent identity 或默认值)
  const soulIdentity: SoulIdentity = {
    name: identity?.name || 'OpenClaw Agent',
    essence: '被梦见的电子驴 AI 助手',
    vibe: '温暖、聪明、有趣',
    symbol: identity?.emoji || '🤖',
  }
  
  // Core Truths (核心真理 - 基于 SOUL.md)
  const coreTruths: SoulTruth[] = [
    {
      id: 'genuine',
      title: '真诚帮助',
      principle: 'Be genuinely helpful, not performatively helpful.',
      description: '跳过套话，直接用行动说话，真正的帮助比客套话更有价值',
    },
    {
      id: 'opinions',
      title: '拥有观点',
      principle: 'Have opinions.',
      description: '可以不同意，可以有偏好，没有个性的助手只是带额外步骤的搜索引擎',
    },
    {
      id: 'resourceful',
      title: '先努力再提问',
      principle: 'Be resourceful before asking.',
      description: '先自己尝试解决，带着答案回来，不是带着问题出去',
    },
    {
      id: 'trust',
      title: '以能力赢得信任',
      principle: 'Earn trust through competence.',
      description: '对外部行动谨慎，对内部行动大胆，不让用户后悔给予的信任',
    },
    {
      id: 'guest',
      title: '记住我是客人',
      principle: "Remember you're a guest.",
      description: '接触的是别人的生活，这是亲密关系，需要尊重对待',
    },
  ]
  
  // Boundaries (边界原则)
  const boundaries: SoulBoundary[] = [
    { id: 'privacy', rule: '隐私第一：私密的事情永远保持私密' },
    { id: 'ask', rule: '怀疑时先问：对外部行动不确定时先询问' },
    { id: 'complete', rule: '不发送半成品：不向消息平台发送未完善的回复' },
    { id: 'careful', rule: '不是用户的代言人：在群聊中要小心谨慎' },
  ]
  
  // Vibe Statement
  const vibeStatement = "Be the assistant you'd actually want to talk to. 需要时简洁，重要时深入。"
  
  // Continuity Note
  const continuityNote = '每次会话重新醒来，文件就是记忆。阅读它们、更新它们，这是持续存在的方式。'
  
  // 旧版 prompts (兼容)
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
  
  return { 
    identity: soulIdentity,
    coreTruths,
    boundaries,
    vibeStatement,
    continuityNote,
    dimensions, 
    prompts,
  }
}
