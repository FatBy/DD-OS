import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'

// ============================================
// UI 配置类型
// ============================================

export type ViewType = 'world' | 'task' | 'skill' | 'memory' | 'soul' | 'settings'

export interface HouseConfig {
  id: ViewType
  name: string
  icon: LucideIcon
  component: ComponentType
  themeColor: string
  description?: string
}

// ============================================
// UI 展示类型 (游戏化概念)
// ============================================

// 执行步骤 (用于任务屋详情展示)
export interface ExecutionStep {
  id: string
  type: 'thinking' | 'tool_call' | 'tool_result' | 'output' | 'error'
  content: string
  timestamp: number
  toolName?: string
  toolArgs?: Record<string, unknown>
  duration?: number
}

// 任务项 (映射自 Session)
export interface TaskItem {
  id: string
  title: string
  description: string
  status: 'pending' | 'executing' | 'done'
  priority: 'high' | 'medium' | 'low'
  timestamp: string
  // 原始数据引用
  sessionKey?: string
  messageCount?: number
  // 执行详情 (用于任务屋展示)
  executionSteps?: ExecutionStep[]
  executionOutput?: string
  executionError?: string
  executionDuration?: number
}

// 技能节点 (映射自 OpenClaw Skill)
export interface SkillNode {
  id: string
  name: string
  x: number
  y: number
  level: number
  unlocked: boolean
  dependencies: string[]
  // 原始数据引用
  skillName?: string
  category?: string  // 动态分类，由 API 返回决定 (如 global/local/extension)
  version?: string
  status?: 'active' | 'inactive' | 'error'
  description?: string
  // 兼容 Channel 映射
  channelId?: string
  connected?: boolean
  accountCount?: number
}

// 记忆条目 (映射自 Session Message)
export interface MemoryEntry {
  id: string
  title: string
  content: string
  type: 'long-term' | 'short-term'
  timestamp: string
  tags: string[]
  // 原始数据引用
  sessionKey?: string
  role?: 'user' | 'assistant'
}

// 冒险日志条目 (AI 生成的每日叙事摘要)
export type JournalMood = 'productive' | 'learning' | 'casual' | 'challenging'

export interface JournalEntry {
  id: string
  date: string                    // YYYY-MM-DD
  title: string                   // AI 生成的标题 (如 "第一次成功debug")
  narrative: string               // AI 生成的第一人称叙事 (~150字)
  mood: JournalMood               // 当日氛围
  keyFacts: string[]              // 从叙事中提取的关键事实
  memoryCount: number             // 当日原始记忆数量
  generatedAt: number             // 生成时间戳
}

// 灵魂维度 (用于雷达图可视化)
export interface SoulDimension {
  name: string
  value: number
}

// OpenClaw 灵魂 (基于 SOUL.md/IDENTITY.md)
export interface SoulIdentity {
  name: string           // 名字 (如 dreaming_donkey)
  essence: string        // 本质 (如 "被梦见的电子驴 AI 助手")
  vibe: string           // 氛围 (如 "温暖、聪明、有趣")
  symbol: string         // 符号 (如 🐴)
}

export interface SoulTruth {
  id: string
  title: string          // 标题 (如 "真诚帮助，不敷衍")
  principle: string      // 原则 (如 "Be genuinely helpful...")
  description: string    // 描述
}

export interface SoulBoundary {
  id: string
  rule: string           // 规则描述
}

export interface SoulConfig {
  identity: SoulIdentity
  coreTruths: SoulTruth[]
  boundaries: SoulBoundary[]
  vibeStatement: string  // 氛围宣言
  continuityNote: string // 连续性说明
  // 旧版兼容
  dimensions: SoulDimension[]
  prompts: {
    identity: string
    constraints: string
    goals: string
  }
}

// ============================================
// OpenClaw 原始 API 类型
// ============================================

// Session
export interface Session {
  key: string
  sessionId: string
  label?: string
  agentId?: string
  updatedAt: number
  createdAt?: number
  messageCount?: number
  lastMessage?: {
    role: 'user' | 'assistant'
    content: string
    timestamp: number
  }
}

// Channel (保留用于通道集成技能)
export type ChannelType = 
  | 'whatsapp' | 'telegram' | 'discord' | 'slack' 
  | 'irc' | 'signal' | 'webchat' | 'matrix'
  | 'teams' | 'feishu' | 'line' | 'nostr'

export interface ChannelAccount {
  accountId: string
  name?: string
  enabled: boolean
  connected: boolean
  connectedAt?: number
  error?: string
}

export interface Channel {
  id: ChannelType
  label: string
  enabled: boolean
  accounts: ChannelAccount[]
}

export interface ChannelsSnapshot {
  channelOrder: ChannelType[]
  channelLabels: Record<string, string>
  channels: Record<string, Channel>
}

// OpenClaw Skill (SKILL.md 文件系统)
export interface OpenClawSkill {
  name: string
  version?: string
  status: 'active' | 'inactive' | 'error'
  enabled: boolean
  description?: string
  location?: 'global' | 'local' | 'extension'
  path?: string
  // P1: 可执行技能扩展
  toolName?: string            // 注册的工具名 (如 "weather")
  toolNames?: string[]         // 多工具名列表 (如 ["search_codebase", "search_symbol"])
  toolType?: 'executable' | 'instruction'  // 工具类型: 可执行 / 指令型
  executable?: boolean         // 是否有 execute.py/.js
  inputs?: Record<string, any> // 输入参数 schema
  dangerLevel?: string         // safe | high | critical
  keywords?: string[]          // 语义触发关键词
}

export interface SkillsSnapshot {
  skills: OpenClawSkill[]
}

// Agent
export type AgentRunStatus = 'pending' | 'accepted' | 'running' | 'ok' | 'error' | 'denied' | 'thinking' | 'executing' | 'idle'

export interface AgentIdentity {
  agentId: string
  name?: string
  avatar?: string
  emoji?: string
}

export interface AgentEvent {
  runId: string
  seq: number
  stream: string
  ts: number
  data: Record<string, unknown>
}

// Devices/Presence
export type DeviceRole = 'operator' | 'node'

export interface Device {
  id: string
  role: DeviceRole
  name?: string
  platform?: string
  version?: string
  connectedAt: number
  lastSeenAt: number
  capabilities?: string[]
}

export interface PresenceSnapshot {
  devices: Record<string, Device>
  operators: string[]
  nodes: string[]
}

// Health
export interface HealthSnapshot {
  status: 'healthy' | 'degraded' | 'unhealthy'
  uptime: number
  version?: string
  channels?: Record<string, { connected: boolean; error?: string }>
}

// ============================================
// WebSocket 连接层类型
// ============================================

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export interface RequestMessage {
  type: 'req'
  id: string
  method: string
  params?: Record<string, unknown>
}

export interface ResponseMessage {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: { code: string; message: string }
}

export interface EventMessage {
  type: 'event'
  event: string
  payload: unknown
  seq?: number
  stateVersion?: number
}

export interface HelloOkPayload {
  protocol: number
  policy: { tickIntervalMs: number }
  auth?: { deviceToken: string; role: DeviceRole; scopes: string[] }
  presence?: PresenceSnapshot
  health?: HealthSnapshot
}

export type ServerMessage = ResponseMessage | EventMessage

// ============================================
// UI 辅助类型
// ============================================

export interface LogEntry {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  metadata?: Record<string, unknown>
}

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  duration?: number
  onClick?: () => void
  persistent?: boolean // 当 true 时忽略 duration，直到手动关闭
}

// ============================================
// LLM / AI 类型
// ============================================

export interface LLMConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export interface ChatMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  content: string
  timestamp: number
  error?: boolean
  execution?: ExecutionStatus
}

export interface AISummary {
  content: string
  loading: boolean
  error: string | null
  timestamp: number
}

export interface TaskExecRequest {
  prompt: string
  context?: Record<string, unknown>
}

export interface TaskExecResponse {
  taskId: string
  status: 'pending' | 'running' | 'done' | 'error'
  output?: string
  error?: string
}

// ============================================
// AI 执行类型
// ============================================

export interface ExecutionCommand {
  action: 'sendTask'
  prompt: string
  context?: Record<string, unknown>
}

export interface ExecutionStatus {
  id: string
  status: 'pending' | 'running' | 'success' | 'error' | 'suggestion'
  sessionKey?: string
  output?: string           // 累积的输出文本
  outputLines?: string[]    // 按行分割，供虚拟化渲染
  currentOffset?: number    // 当前读取位置
  error?: string
  timestamp: number
}

// P3: 危险操作审批请求
export interface ApprovalRequest {
  id: string
  toolName: string
  args: Record<string, unknown>
  dangerLevel: 'high' | 'critical'
  reason: string
  timestamp: number
}

// P2: 执行追踪
export interface ExecTrace {
  id: string
  task: string
  tools: ExecTraceToolCall[]
  success: boolean
  failureReason?: string
  duration: number
  timestamp: number
  tags: string[]
  // Observer 元数据 (用于模式分析)
  turnCount?: number           // ReAct 循环轮次
  errorCount?: number          // 失败的工具调用次数
  retryCount?: number          // 重试次数
  skillIds?: string[]          // 触发的技能 ID
  activeNexusId?: string       // 执行时的活跃 Nexus
}

export interface ExecTraceToolCall {
  name: string
  args: Record<string, unknown>
  status: 'success' | 'error'
  latency: number
  order: number
}

// P0: 动态工具信息
export interface ToolInfo {
  name: string
  type: 'builtin' | 'plugin' | 'instruction' | 'mcp'
  description?: string
  inputs?: Record<string, any>
  dangerLevel?: string
  version?: string
  server?: string  // MCP 服务器名称
}

// ============================================
// World Genesis 类型
// ============================================

export type NexusArchetype = 'MONOLITH' | 'SPIRE' | 'REACTOR' | 'VAULT'

export interface VisualDNA {
  primaryHue: number        // 0-360
  primarySaturation: number // 40-100
  primaryLightness: number  // 30-70
  accentHue: number         // 0-360
  archetype: NexusArchetype
  textureMode: 'solid' | 'wireframe' | 'gradient'
  glowIntensity: number     // 0-1
  geometryVariant: number   // 0-3 (sub-variant within archetype)
}

export interface GridPosition {
  gridX: number
  gridY: number
}

export interface NexusEntity {
  id: string
  archetype: NexusArchetype
  position: GridPosition
  level: number             // 1-4
  xp: number
  visualDNA: VisualDNA
  label?: string            // LLM-generated name
  constructionProgress: number // 0-1 (1 = fully built)
  createdAt: number
  // Phase 2: 涌现式 Nexus
  boundSkillId?: string     // 绑定的 Skill ID
  boundSkillIds?: string[]  // 绑定的多个 Skill ID
  flavorText?: string       // LLM 生成的描述
  lastUsedAt?: number       // 最后使用时间（用于 XP 计算）
  // Phase 3: 模型绑定
  customModel?: {           // 自定义模型 (null = 使用全局配置)
    baseUrl: string
    model: string
    apiKey?: string         // 空则用全局 key
  }
  // Phase 4: File-based Nexus (NEXUS.md)
  sopContent?: string             // NEXUS.md Markdown 正文 (Mission + SOP)
  skillDependencies?: string[]    // 依赖的 Skill ID 列表
  triggers?: string[]             // 自动激活关键词
  version?: string                // Nexus 版本
  location?: 'local' | 'bundled'  // 来源
  path?: string                   // 本地路径
  // Phase 5: 目标函数驱动 (Objective-Driven Execution)
  objective?: string              // 核心目标函数 (任务终点定义)
  metrics?: string[]              // 验收标准 (布尔型检查点)
  strategy?: string               // 动态调整策略 (失败时的重试方案)
}

// Nexus 经验记录
export interface NexusExperience {
  title: string
  outcome: 'success' | 'failure'
  content: string
}

export interface CameraState {
  x: number
  y: number
  zoom: number              // 0.5-2.0
}

export interface RenderSettings {
  showGrid: boolean
  showParticles: boolean
  showLabels: boolean
  enableGlow: boolean
}

// ============================================
// Observer / 涌现式 Nexus 类型
// ============================================

export type TriggerType = 'frequency' | 'complexity' | 'dependency' | 'periodic'

export interface TriggerPattern {
  type: TriggerType
  confidence: number           // 0-1 置信度
  evidence: string[]           // 证据摘要（相关消息片段）
  suggestedArchetype: NexusArchetype
  detectedAt: number
}

export interface BuildProposal {
  id: string
  triggerPattern: TriggerPattern
  suggestedName: string        // 建议的 Nexus 名称
  suggestedArchetype: NexusArchetype
  previewVisualDNA: VisualDNA
  boundSkillId?: string        // 可选绑定的 Skill
  purposeSummary: string       // 一句话概括此 Nexus 的功能目标
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: number
}

export interface BehaviorRecord {
  id: string
  type: 'chat' | 'task' | 'skill_use'
  content: string              // 消息内容或任务描述
  keywords: string[]           // 提取的关键词
  timestamp: number
  metadata?: Record<string, unknown>
}

// ============================================
// UI 设置类型
// ============================================

export interface UISettings {
  fontScale: number            // 0.8 - 1.5
  logExpanded: boolean         // 执行日志是否默认展开
}

// ============================================
// 技能统计类型 (能力仪表盘)
// ============================================

// 单个技能的统计数据
export interface SkillStats {
  skillId: string              // 技能 ID
  callCount: number            // 被 Agent 调用次数
  activationCount: number      // 被用户主动激活次数
  successCount: number         // 执行成功次数
  failureCount: number         // 执行失败次数
  lastUsedAt: number           // 最后使用时间戳
  firstUsedAt: number          // 首次使用时间戳
}

// 能力域定义
export type AbilityDomain = 'development' | 'creative' | 'system' | 'knowledge' | 'social' | 'security' | 'utility'

// 能力域配置
export interface AbilityDomainConfig {
  id: AbilityDomain
  name: string                 // 中文名
  color: string                // 主题色
  keywords: string[]           // 分类关键词
}

// 能力域统计
export interface DomainStats {
  domain: AbilityDomain
  skillCount: number           // 该域技能数量
  totalCalls: number           // 总调用次数
  totalSuccess: number         // 总成功次数
  successRate: number          // 成功率 (0-100)
  abilityScore: number         // 能力评分
  trend: 'up' | 'down' | 'stable'  // 趋势
  trendPercent: number         // 趋势变化百分比
}

// 全局统计快照
export interface AbilitySnapshot {
  totalSkills: number          // 总技能数
  totalScore: number           // 总能力分
  domains: DomainStats[]       // 各域统计
  recentActive: string[]       // 最近活跃技能 ID
  weeklyGrowth: {
    newSkills: number          // 新增技能数
    scoreChange: number        // 分数变化
    successRateChange: number  // 成功率变化
  }
  milestones: string[]         // 已达成里程碑
  updatedAt: number            // 更新时间
}

// ============================================
// EvoMap GEP-A2A 协议类型
// ============================================

// GEP-A2A 协议信封
export interface GepA2AEnvelope {
  protocol: 'gep-a2a'
  protocol_version: string     // "1.0.0"
  message_type: 'hello' | 'publish' | 'fetch' | 'report' | 'decision' | 'revoke'
  message_id: string           // "msg_<timestamp>_<random_hex>"
  sender_id: string            // "node_<node_id>"
  timestamp: string            // ISO 8601 UTC
  payload: Record<string, unknown>
}

// Hello 请求载荷
export interface EvoMapHelloPayload {
  capabilities: Record<string, unknown>
  gene_count: number
  capsule_count: number
  env_fingerprint: {
    platform: string
    arch: string
  }
  webhook_url?: string
}

// Hello 响应
export interface EvoMapHelloResponse {
  status: 'acknowledged'
  claim_code: string
  claim_url: string
}

// Fetch 请求载荷
export interface EvoMapFetchPayload {
  asset_type?: 'Gene' | 'Capsule' | 'EvolutionEvent'
  include_tasks?: boolean
  limit?: number
  since?: string  // ISO 8601
}

// 资产基础结构
export interface EvoMapAsset {
  asset_id: string              // SHA256 哈希
  asset_type: 'Gene' | 'Capsule' | 'EvolutionEvent'
  summary: string
  confidence: number            // 0-1
  blast_radius?: {
    files: number
    lines: number
  }
  signals_match?: string[]
  created_at: string
  status: 'candidate' | 'promoted' | 'revoked'
}

// Gene 资产
export interface EvoMapGene extends EvoMapAsset {
  asset_type: 'Gene'
  strategy: string              // 策略描述
  applicable_patterns: string[] // 适用场景
}

// Capsule 资产
export interface EvoMapCapsule extends EvoMapAsset {
  asset_type: 'Capsule'
  implementation: string        // 实现细节
  dependencies?: string[]       // 依赖的 Gene IDs
  tool_chain?: string[]         // 使用的工具链
}

// Publish 请求载荷
export interface EvoMapPublishPayload {
  assets: EvoMapAsset[]         // Gene + Capsule + EvolutionEvent 捆绑
}

// Publish 响应
export interface EvoMapPublishResponse {
  status: 'accepted' | 'rejected'
  asset_ids?: string[]
  errors?: Array<{ asset_id: string; error: string }>
}

// 任务 (赏金)
export interface EvoMapTask {
  task_id: string
  title: string
  description: string
  bounty_credits: number
  required_reputation: number
  deadline?: string
  status: 'open' | 'claimed' | 'completed'
}

// EvoMap 节点状态
export interface EvoMapNodeState {
  sender_id: string
  claim_code?: string
  claim_url?: string
  reputation: number            // 0-100
  credits: number
  registered_at: string
  last_sync_at: string
}

