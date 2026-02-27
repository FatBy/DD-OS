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

// 任务状态类型
export type TaskStatus = 
  | 'pending'      // 等待执行
  | 'queued'       // 已入队列
  | 'executing'    // 执行中
  | 'done'         // 完成
  | 'terminated'   // 用户终止
  | 'interrupted'  // 系统中断
  | 'retrying'     // 重试中
  | 'paused'       // 用户暂停

// 任务检查点 (断点续作支持)
export interface TaskCheckpoint {
  stepIndex: number                           // 当前步骤索引 (traceTools.length)
  subTaskId?: string                          // 当前子任务 ID (Quest 模式)
  savedAt: number                             // 保存时间
  // 恢复执行所需的完整上下文
  userPrompt: string                          // 原始用户输入
  nexusId?: string                            // 关联的 Nexus ID
  turnCount: number                           // 当前执行轮次
  messages: Array<{                           // LLM 对话历史 (精简版)
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string | null
    tool_call_id?: string
    tool_calls?: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }>
  }>
  traceTools: Array<{                         // 已执行的工具追踪
    name: string
    args: Record<string, unknown>
    status: 'success' | 'error'
    result: string
    latency: number
    order: number
  }>
}

// 任务项 (映射自 Session)
export interface TaskItem {
  id: string
  title: string
  description: string
  status: TaskStatus
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
  // Quest 风格复杂任务支持
  taskPlan?: TaskPlan           // 复杂任务的执行计划
  executionMode?: 'simple' | 'complex' | 'quest'
  // 任务监管字段
  retryCount?: number           // 已重试次数
  maxRetries?: number           // 最大重试次数 (默认 2)
  pausedAt?: number             // 暂停时间戳
  checkpoint?: TaskCheckpoint   // 断点信息
  startedAt?: number            // 开始执行时间
  completedAt?: number          // 完成时间
}

// ============================================
// Quest 风格任务执行系统
// ============================================

// 子任务状态
export type SubTaskStatus = 
  | 'pending'           // 等待执行
  | 'ready'             // 依赖已满足，可执行
  | 'executing'         // 执行中
  | 'done'              // 完成
  | 'failed'            // 失败
  | 'blocked'           // 被依赖阻塞
  | 'skipped'           // 用户跳过
  | 'paused_for_approval' // 等待用户确认

// 子任务定义（原子级任务单元）
export interface SubTask {
  id: string
  description: string           // 任务描述
  toolHint?: string             // 建议的工具名
  status: SubTaskStatus
  dependsOn: string[]           // 依赖的子任务 ID 列表（空 = 无依赖，可并行）
  result?: string               // 执行结果
  error?: string                // 错误信息
  startTime?: number
  endTime?: number
  retryCount?: number           // 已重试次数
  maxRetries?: number           // 最大重试次数（默认 2）
  approvalRequired?: boolean    // 需要用户确认
  approvalReason?: string       // 确认原因
  blockReason?: string          // 阻塞原因（依赖失败详情）
  // 执行追踪
  executionSteps?: ExecutionStep[]
}

// 任务计划状态
export type TaskPlanStatus = 'planning' | 'executing' | 'paused' | 'done' | 'failed' | 'cancelled'

// 任务计划（DAG 结构）
export interface TaskPlan {
  id: string
  title: string                 // AI 生成的任务标题
  userPrompt: string            // 用户原始需求
  subTasks: SubTask[]           // 子任务列表（构成 DAG）
  status: TaskPlanStatus
  nexusId?: string              // 关联的 Nexus ID（如果通过 Nexus 执行）
  createdAt: number
  startedAt?: number
  completedAt?: number
  progress: number              // 0-100 完成百分比
  // 执行配置
  maxParallel?: number          // 最大并行度（默认 3）
  autoApprove?: boolean         // 自动批准低风险操作
}

// ============================================
// 交互式 Quest 系统 (Qoder 风格)
// ============================================

// Quest 阶段状态机
export type QuestPhase = 
  | 'idle'           // 空闲
  | 'exploring'      // 探索阶段（并行子代理搜索代码）
  | 'planning'       // 规划阶段（生成任务计划）
  | 'confirming'     // 确认阶段（用户审查计划）
  | 'executing'      // 执行阶段
  | 'completed'      // 完成

// Quest 会话（完整的交互式任务流程）
export interface QuestSession {
  id: string
  phase: QuestPhase
  userGoal: string                         // 用户原始目标
  explorationResults: ExplorationResult[]  // 探索阶段收集的结果
  proposedPlan: TaskPlan | null            // 生成的任务计划
  accumulatedContext: ContextEntry[]       // 累积的上下文
  subagents: Subagent[]                    // 活跃的子代理
  createdAt: number
  completedAt?: number
  finalResult?: string                     // 最终执行结果
}

// 探索结果
export interface ExplorationResult {
  source: 'codebase' | 'symbol' | 'file' | 'grep'
  query: string
  summary: string
  details: ExplorationDetail[]
  timestamp: number
}

export interface ExplorationDetail {
  filePath?: string
  lineNumber?: number
  content?: string
  symbolName?: string
  symbolType?: string
  relation?: string
}

// 子代理
export interface Subagent {
  id: string
  type: 'explore' | 'plan' | 'execute'
  task: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress?: number                       // 0-100
  result?: string
  error?: string
  startedAt?: number
  completedAt?: number
  tools: string[]                         // 可用工具列表
}

// 子代理任务定义
export interface SubagentTask {
  type: 'explore' | 'plan' | 'execute'
  task: string
  tools: string[]
  context?: string                        // 上下文信息
}

// 上下文条目（用于跨步骤累积）
export interface ContextEntry {
  type: 'exploration' | 'execution' | 'clarification' | 'user_feedback'
  content: string
  timestamp: number
  source?: string                         // 来源（子代理ID、工具名等）
}

// 符号查询结果
export interface SymbolResult {
  symbol: string
  relation: 'calls' | 'called_by' | 'references' | 'referenced_by' | 'extends' | 'implements'
  filePath: string
  lineNumber: number
  codeSnippet: string
  symbolType: string
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
  // 独立的 Embedding API 配置（可选）
  embedApiKey?: string
  embedBaseUrl?: string
  embedModel?: string
}

export interface ChatMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  content: string
  timestamp: number
  error?: boolean
  execution?: ExecutionStatus
  /** 执行过程中创建的文件列表，用于在聊天中显示可点击的文件卡片 */
  createdFiles?: { filePath: string; fileName: string; message: string; fileSize?: number }[]
}

// ============================================
// 会话管理类型
// ============================================

export type ConversationType = 'general' | 'nexus'

export interface Conversation {
  id: string
  type: ConversationType
  title: string
  nexusId?: string          // 仅 'nexus' 类型使用
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  pinned?: boolean
  autoTitled?: boolean      // 标记是否已自动生成标题
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
  result?: string
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

// [已废弃] 固定类型限制已移除，改为基于 ID 动态生成视觉样式

// 建筑配置 (城市主题)
export interface BuildingConfig {
  base: string           // 地基类型 (concrete, steel, glass, stone)
  body: string           // 主体类型 (office, lab, factory, library, tower, warehouse)
  roof: string           // 屋顶类型 (flat, dome, antenna, satellite, chimney, garden)
  props?: string[]       // 装饰物 (signs, lights, wires, plants, machines)
  themeColor?: string    // 主题色 (用于发光效果)
}

export interface VisualDNA {
  primaryHue: number        // 0-360
  primarySaturation: number // 40-100
  primaryLightness: number  // 30-70
  accentHue: number         // 0-360
  textureMode: 'solid' | 'wireframe' | 'gradient'
  // 星球纹理配置 (cosmos 主题)
  planetTexture?: 'bands' | 'storm' | 'core' | 'crystal'
  ringCount?: number            // 1-3
  ringTilts?: number[]          // 环倾角数组
  glowIntensity: number     // 0-1
  geometryVariant: number   // 0-3 (sub-variant within archetype)
  // 城市主题：建筑配置 (用于 cityscape 主题)
  buildingConfig?: BuildingConfig
  // AI 生图：自定义图片 URL (高级用户)
  customImageUrl?: string
}

export interface GridPosition {
  gridX: number
  gridY: number
}

export interface NexusEntity {
  id: string
  position: GridPosition
  level: number             // 1-4
  xp: number
  visualDNA: VisualDNA
  label?: string            // LLM-generated name
  constructionProgress: number // 0-1 (1 = fully built)
  createdAt: number
  // Phase 2: 涌现式 Nexus
  boundSkillIds?: string[]  // 绑定的 Skill ID 列表
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
  triggers?: string[]             // 自动激活关键词
  version?: string                // Nexus 版本
  location?: 'local' | 'bundled'  // 来源
  path?: string                   // 本地路径
  // Phase 5: 目标函数驱动 (Objective-Driven Execution)
  objective?: string              // 核心目标函数 (任务终点定义)
  metrics?: string[]              // 验收标准 (布尔型检查点)
  strategy?: string               // 动态调整策略 (失败时的重试方案)
  // 元数据
  updatedAt?: number              // 最后更新时间
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

export type TriggerType = 'frequency' | 'complexity' | 'dependency' | 'periodic' | 'cross-skill'

export interface TriggerPattern {
  type: TriggerType
  confidence: number           // 0-1 置信度
  evidence: string[]           // 证据摘要（相关消息片段）
  detectedAt: number
  // 新增：技能和SOP推荐
  suggestedSkills?: string[]   // 建议绑定的工具/技能名列表
  suggestedSOP?: string        // 建议的系统提示词/作业程序
}

export interface BuildProposal {
  id: string
  triggerPattern: TriggerPattern
  suggestedName: string        // 建议的 Nexus 名称
  previewVisualDNA: VisualDNA
  boundSkillIds?: string[]     // 多技能绑定列表
  sopContent?: string          // 新增：系统提示词/SOP
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
// Gene Pool 自愈基因库类型
// ============================================

// 基因类别
export type GeneCategory = 
  | 'repair'      // 修复基因 (error→success 模式)
  | 'optimize'    // 优化基因
  | 'pattern'     // 通用模式
  | 'capability'  // Nexus 能力基因 (描述 Nexus 能做什么)
  | 'artifact'    // Nexus 产出物基因 (描述 Nexus 产出了什么)
  | 'activity'    // Nexus 活动基因 (描述 Nexus 做过什么)

// Nexus 能力信息 (capability 基因专用)
export interface NexusCapabilityInfo {
  nexusId: string           // nexus 唯一标识
  nexusName: string         // 显示名称
  description: string       // 能力描述
  capabilities: string[]    // 能力标签 ['漫画', '剧情', '角色设计']
  dirPath: string           // nexuses/xxx/
}

// Nexus 产出物信息 (artifact 基因专用)
export interface NexusArtifactInfo {
  nexusId: string           // 产出此文件的 Nexus
  path: string              // 文件路径
  name: string              // 文件名/产出物名称
  type: string              // 类型 (story-outline, character-design, ppt, code...)
  size: number              // 文件大小
  description?: string      // 产出物描述
  linkedArtifacts?: string[] // 关联的其他产出物 ID
}

// Nexus 活动信息 (activity 基因专用)
export interface NexusActivityInfo {
  nexusId: string           // 执行此活动的 Nexus
  nexusName: string         // Nexus 显示名称
  summary: string           // 活动摘要 "生成了8集科幻动漫剧情大纲"
  toolsUsed: string[]       // 使用的工具
  artifactsCreated: string[] // 创建的产出物 ID
  duration: number          // 耗时 (ms)
  status: 'success' | 'failed'
}

// 基因: 一条可复用的修复/优化模式 或 Nexus 通讯信息
export interface Gene {
  id: string                      // gene-{timestamp}
  category: GeneCategory
  signals_match: string[]         // 触发信号 (支持 /regex/flags 和子串匹配)
  strategy: string[]              // 修复策略步骤 (自然语言)
  source: {
    traceId?: string              // 来源 trace ID
    nexusId?: string              // 产生此基因的 Nexus
    createdAt: number
  }
  metadata: {
    confidence: number            // 0-1 置信度
    useCount: number              // 被使用次数
    successCount: number          // 使用后成功次数
    lastUsedAt?: number
  }
  // Nexus 通讯扩展字段 (根据 category 使用)
  nexusCapability?: NexusCapabilityInfo  // capability 基因
  artifactInfo?: NexusArtifactInfo       // artifact 基因
  activityInfo?: NexusActivityInfo       // activity 基因
}

// 基因匹配结果
export interface GeneMatch {
  gene: Gene
  score: number                   // 匹配分数 (匹配的信号数量)
  matchedSignals: string[]        // 命中的信号列表
}

// 胶囊: 基因被使用一次的完整上下文快照
export interface Capsule {
  id: string
  geneId: string
  trigger: string[]               // 触发时的错误信号
  outcome: 'success' | 'failure'
  nexusId?: string
  timestamp: number
}
