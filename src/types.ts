import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'

// ============================================
// UI 配置类型
// ============================================

export type ViewType = 'world' | 'task' | 'skill' | 'memory' | 'soul' | 'settings' | 'link-station' | 'library'

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
  | 'error'        // 执行出错
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
  dunId?: string                              // 关联的 Dun ID
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
  dunId?: string                // 关联的 Dun ID（如果通过 Dun 执行）
  createdAt: number
  startedAt?: number
  completedAt?: number
  progress: number              // 0-100 完成百分比
  // 执行配置
  maxParallel?: number          // 最大并行度（默认 3）
  autoApprove?: boolean         // 自动批准低风险操作
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
// Soul Evolution (双轨制灵魂演化)
// ============================================

/** 用户偏好修正案 (Layer 2 灵魂) */
export interface SoulAmendment {
  id: string                          // amend-{timestamp}-{random}
  content: string                     // 自然语言偏好 (如 "偏好简洁回答")
  source: {
    dunIds: string[]                  // 观测到此行为的 Dun
    evidence: string[]                // trace 摘要片段 (<=3条, 每条<=100字)
    detectedAt: number
    signalLabel?: string              // 触发信号的标签 (用于去重, 如 "heavy_runCmd_usage")
  }
  status: 'draft' | 'approved' | 'rejected' | 'archived'
  weight: number                      // 0~1, 时间衰减
  hitCount: number                    // 被注入上下文次数
  createdAt: number
  confirmedAt?: number                // 用户批准时间
  lastHitAt?: number                  // 最后注入时间
}

/** MBTI 四轴原始分数 (-1~+1) */
export interface MBTIAxisScores {
  ei: number    // -1=I极端, +1=E极端
  sn: number    // -1=N极端, +1=S极端
  tf: number    // -1=F极端, +1=T极端
  jp: number    // -1=P极端, +1=J极端
}

/** Soul Evolution 配置常量 */
export const SOUL_EVOLUTION_CONFIG = {
  DECAY_HALF_LIFE_DAYS: 30,
  MIN_WEIGHT_THRESHOLD: 0.1,
  INJECTION_MIN_WEIGHT: 0.3,
  MAX_INJECTION_CHARS: 500,
  CHECK_INTERVAL_TASKS: 3,
  MIN_DUN_COUNT: 1,
  INITIAL_DRAFT_WEIGHT: 0.6,
  MBTI_MAX_MODIFIER: 0.4,
  DECAY_INTERVAL_MS: 6 * 60 * 60 * 1000,
  /** 工具偏好信号：最少总调用数 */
  TOOL_PREF_MIN_TOTAL_CALLS: 5,
  /** 工具偏好信号：最少跨 Dun 数 */
  TOOL_PREF_MIN_DUN_SPREAD: 1,
  /** 成功模式信号：最少 Dun 数 */
  SUCCESS_PATTERN_MIN_SCORINGS: 1,
  /** 风格偏移信号：最少历史总调用数 */
  STYLE_SHIFT_MIN_TOTAL_CALLS: 12,
} as const

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

// 技能来源
export type SkillSource = 'builtin' | 'community' | 'user'

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
  inputs?: Record<string, unknown> // 输入参数 schema
  dangerLevel?: string         // safe | high | critical
  keywords?: string[]          // 语义触发关键词
  whenToUse?: string           // 何时使用提示（供 LLM 判断是否调用）
  /** 自由分类标签 (用户/社区自定义, 与 tags 不同) */
  category?: string
  /** 从 SKILL.md 正文抽取的 Instructions 段落, 给 LLM 做 whenToUse 判定 */
  instructions?: string
  // OpenClaw 生态字段
  emoji?: string
  author?: string
  primaryEnv?: 'shell' | 'node' | 'python' | 'go' | 'rust' | 'browser'
  requires?: {
    bins?: string[]
    env?: string[]
    config?: string[]
    anyBins?: string[]
  }
  install?: OpenClawInstallSpec[]
  tags?: string[]
  source?: SkillSource           // 技能来源: builtin(系统内置) | community(社区下载) | user(用户自建)
  clawHub?: {
    slug?: string
    version?: string
    publishedAt?: string
    source?: 'local' | 'clawhub'
  }
}

// OpenClaw 安装规格 (brew/apt/node/go/uv/download)
export interface OpenClawInstallSpec {
  id: string
  kind: 'brew' | 'apt' | 'node' | 'go' | 'uv' | 'download'
  formula?: string        // brew
  package?: string        // apt
  module?: string         // node/go/uv
  url?: string            // download
  bins?: string[]
  label?: string
}

// ============================================
// ClawHub 市场类型
// ============================================

export interface ClawHubSearchResult {
  skills: ClawHubSkillSummary[]
  total: number
  page: number
  pageSize: number
}

export interface ClawHubSkillSummary {
  slug: string
  name: string
  description: string
  emoji?: string
  author: string
  version: string
  tags: string[]
  downloads: number
  updatedAt: string
}

export interface ClawHubSkillDetail extends ClawHubSkillSummary {
  readme: string
  requires?: { bins?: string[]; env?: string[]; anyBins?: string[] }
  install?: OpenClawInstallSpec[]
  fileList: string[]
}

export interface SkillPublishPayload {
  name: string
  slug: string
  description: string
  version: string
  skillArchive: Blob
  tags?: string[]
}

export interface ClawHubPublishResult {
  success: boolean
  slug: string
  version: string
  url: string
}

export interface ClawHubUser {
  username: string
  email: string
  avatar?: string
}

export interface ClawHubSuggestion {
  id: string
  type: 'skill-discovery'
  query: string
  matches: ClawHubSkillSummary[]
  triggerTool: string
  triggerTask: string
  dismissed?: boolean
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

/** 通知中心历史记录 */
export interface NotificationRecord {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  timestamp: number
  read: boolean
}

// ============================================
// LLM / AI 类型
// ============================================

/**
 * 图片生成 API 契约 — Provider 声明自己的 API 差异，generateImage 据此适配
 *
 * 不设置（undefined）= 全部走 OpenAI 默认值，零配置。
 */
export interface ImageGenProfile {
  /** 端点路径 (如 'v1/image_generation')，默认 'v1/images/generations' */
  endpoint?: string
  /** 尺寸参数模式: 'pixel' → size="1024x1024", 'ratio' → aspect_ratio="1:1"。默认 'pixel' */
  sizeMode?: 'pixel' | 'ratio'
  /** 发给 API 的 response_format 值 (如 'url', 'b64_json')，不设则不发送此字段 */
  responseFormat?: string
  /** 响应数据结构: 'openai' = data:[{url, b64_json}], 'wrapped' = data:{image_urls:[], image_base64:[]}。默认 'openai' */
  responseLayout?: 'openai' | 'wrapped'
}

export interface LLMConfig {
  apiKey: string
  baseUrl: string
  model: string
  // API 协议格式: 'auto' 自动检测 | 'openai' OpenAI 兼容 | 'anthropic' Anthropic 原生 | 'claude-code' 本地 Claude Code
  apiFormat?: ApiProtocol
  // 独立的 Embedding API 配置（可选）
  embedApiKey?: string
  embedBaseUrl?: string
  embedModel?: string
  /** 图片生成 API 契约（由 Provider 预设声明，generateImage 据此适配） */
  imageGenProfile?: ImageGenProfile
  /** 采样温度 (skillProductionService 等场景里按调用方需要覆盖) */
  temperature?: number
}

// ============================================
// 联络站类型 (Link Station)
// ============================================

/** 模型通道类型 */
export type ModelChannelType = 'chat' | 'chatSecondary' | 'embed' | 'imageGen' | 'videoGen' | 'search'

/** API 协议 */
export type ApiProtocol = 'openai' | 'anthropic' | 'claude-code' | 'auto'

/** Provider 来源 */
export type ProviderSource = 'manual' | 'env-scan' | 'plugin'

/** Provider 区域 */
export type ProviderRegion = 'domestic' | 'overseas' | 'local' | 'any'

/** 模型兼容性标志 */
export interface ModelCompatFlags {
  supportsTools: boolean
  thinkingContentField?: string
}

/** 模型条目 */
export interface ModelEntry {
  id: string
  name: string
  compatFlags?: ModelCompatFlags
}

/** 模型 Provider */
export interface ModelProvider {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  apiProtocol: ApiProtocol
  source: ProviderSource
  models: ModelEntry[]
  createdAt: number
  updatedAt: number
  /** 图片生成 API 契约（如 MiniMax 与 OpenAI 的端点、参数、响应格式不同） */
  imageGenProfile?: ImageGenProfile
}

/** 模型绑定（通道 → Provider + Model） */
export interface ModelBinding {
  providerId: string
  modelId: string
}

/** 通道绑定配置 */
export interface ChannelBindings {
  chat: ModelBinding | null
  chatSecondary: ModelBinding | null
  embed: ModelBinding | null
  imageGen: ModelBinding | null
  videoGen: ModelBinding | null
  search: ModelBinding | null
}

// ===== Dun Per-Run LLM 配置 =====

// Dun 的 LLM 绑定（存储层，不含密钥）
export interface DunLLMBinding {
  providerId: string       // 引用 LinkStation 中的 Provider
  modelId: string          // 该 Provider 下的具体模型
  temperature?: number     // 可选温度覆盖
}

// LLM 调用目的（预留细粒度扩展）
export type LLMPurpose = 'chat' | 'critic' | 'search' | 'vision' | 'childAgent' | 'background'

// 解析后的完整运行配置（不可变快照）
export interface EffectiveRunConfig {
  apiKey: string
  baseUrl: string
  model: string
  apiFormat: ApiProtocol
  temperature?: number     // undefined = 不传，保持 Provider 默认
  contextWindow: number    // 模型上下文窗口（token）
  supportsTools: boolean   // 是否支持 function calling
  providerLabel: string    // 用于 trace/日志标记
  purpose: LLMPurpose      // 记录本配置的解析目的
  source: 'dun-binding' | 'global-channel' | 'global-chat' | 'fallback'
  providerId?: string      // 方便 trace/debug 追踪
  channel?: string         // 对应 LinkStation channel（如 chat/search/embed）
}

// Run 级执行上下文（避免散传参数）
export interface RunExecutionContext {
  runDunId: string | undefined   // 本次 run 锁定的 finalDunId（自动匹配后的）
  chatConfig: EffectiveRunConfig // 主推理 + critic
  resolveUtility: (purpose: LLMPurpose) => EffectiveRunConfig // 按真实 purpose 解析
}

/** 联络站 Sheet 标签 */
export type LinkStationSheet = 'model-channel' | 'mcp-service'

/** MCP 服务器状态 */
export type MCPServerStatus = 'connected' | 'disconnected' | 'connecting' | 'error'

/** MCP 传输类型 */
export type MCPTransportType = 'stdio' | 'sse'

/** MCP 服务器条目 */
export interface MCPServerEntry {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled: boolean
  /** 传输类型: stdio (默认) 或 sse */
  transportType?: MCPTransportType
  /** SSE 模式下的服务器 URL */
  url?: string
  /** 超时时间（秒），默认 60 */
  timeout?: number
}

/** MCP 工具条目 */
export interface MCPToolEntry {
  serverName: string
  name: string
  description: string
  inputSchema?: Record<string, unknown>
}

/** 联络站完整状态 */
export interface LinkStationState {
  activeSheet: LinkStationSheet
  providers: ModelProvider[]
  channelBindings: ChannelBindings
  mcpServers: MCPServerEntry[]
  mcpStatus: Record<string, MCPServerStatus>
  mcpTools: MCPToolEntry[]
}

/** Provider 注册引导配置 */
export interface ProviderGuide {
  label: string
  tagline: string
  icon: string
  region: ProviderRegion
  signupUrl: string
  apiKeyPageUrl: string
  baseUrl: string
  apiProtocol: ApiProtocol
  steps: string[]
  tip: string
  recommendedModel: string
  /** 图片生成 API 契约 */
  imageGenProfile?: ImageGenProfile
}

/** Fallback 触发条件配置 */
export const FALLBACK_CONFIG = {
  TRIGGER_STATUS_CODES: [429, 500, 502, 503] as const,
  TRIGGER_ERROR_TYPES: ['TIMEOUT', 'NETWORK_ERROR', 'ECONNREFUSED'] as const,
  NO_FALLBACK_STATUS_CODES: [400, 401, 403] as const,
  MAX_FALLBACK_RETRIES: 1,
} as const

export interface ChatMessage {
  id: string
  /**
   * 消息角色。`'thinking'` 是自习室扩展出来的专用角色, 用于在对话流里展示 Dun 的思考过程气泡;
   * 通用聊天流程不应该产生 'thinking' 消息, 只在自习室 ReAct 循环里出现。
   */
  role: 'system' | 'user' | 'assistant' | 'thinking'
  content: string
  timestamp: number
  error?: boolean
  execution?: ExecutionStatus
  /** 执行过程中创建的文件列表，用于在聊天中显示可点击的文件卡片 */
  createdFiles?: { filePath: string; fileName: string; message: string; fileSize?: number }[]
  /** 关联的执行追踪 ID，用于点赞等反馈关联 */
  traceId?: string
  /** 用户是否点赞该消息 */
  liked?: boolean
  // ============================================
  // 自习室 (StudyRoom) 扩展字段 (仅在 WriterChatPanel / studyReActLoop 使用)
  // ============================================
  /** 消息是否正在流式追加中 (流式输出未完成) */
  streaming?: boolean
  /** thinking 气泡顶部的阶段标签, 如 "采集证据"、"撰写中" */
  thinkingLabel?: string
  /** 用户附加的技能引用 (@skill-name) */
  attachments?: WriterChatAttachment[]
  /** 本条消息携带的意图澄清卡片 (role === 'assistant' && intent === 'unclear' 时有) */
  intentClarification?: IntentClarification
  /** 本条消息分类器给出的意图 (如果跑了 classifyWriterIntent) */
  intent?: WriterMessageIntent
  /** 讨论模式末尾附带的"应用此建议"卡片 */
  suggestedEdit?: SuggestedEdit
  /** 全文改写 / 段改模式末尾附带的变更摘要卡片 */
  editSummary?: EditSummary
  /** Tool Loop 里 LLM 想写入风格档案的候选建议, 用户确认后才落库 */
  profileSuggestions?: ProfileSuggestion[]
}

// ============================================
// 会话管理类型
// ============================================

export type ConversationType = 'general' | 'dun'

export interface Conversation {
  id: string
  type: ConversationType
  title: string
  dunId?: string            // 仅 'dun' 类型使用
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  pinned?: boolean
  autoTitled?: boolean      // 标记是否已自动生成标题
  messagesLoaded?: boolean  // 标记消息是否已从后端懒加载
}

export interface ConversationMeta {
  id: string
  type: ConversationType
  title: string
  dunId?: string
  messageCount: number
  createdAt: number
  updatedAt: number
  pinned?: boolean
  autoTitled?: boolean
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
  /** V3: 循环终止路径 — 区分 LLM 自然完成、用户中止、超时等 */
  completionPath?: 'natural' | 'aborted' | 'truncation_fail' | 'unrecoverable_error' | 'max_turns' | 'escalation' | 'agent_abort'
  failureReason?: string
  duration: number
  timestamp: number
  tags: string[]
  // Observer 元数据 (用于模式分析)
  turnCount?: number           // ReAct 循环轮次
  errorCount?: number          // 失败的工具调用次数
  retryCount?: number          // 重试次数
  skillIds?: string[]          // 触发的技能 ID
  activeDunId?: string         // 执行时的活跃 Dun
  /** V2: 碱基序列字符串，如 "X-P-E-V-E" */
  baseSequence?: string
  /** V2: 碱基分布统计 */
  baseDistribution?: { E: number; P: number; V: number; X: number }
  /** V2: 每轮 ReAct 循环的元数据 */
  turnMetas?: ReActTurnMeta[]
  /** V3: Governor 干预记录（用于 Layer 2/3 A/B 对比） */
  governorInterventions?: Array<{
    rule: string
    stepIndex: number
    features: {
      consecutiveX: number; stepCount: number; xRatioLast5: number; switchRate: number
      pInLateHalf?: boolean; lastPFollowedByV?: boolean
      maxERunLength?: number; xeRatio?: number
    }
    counterfactualSuccessRate?: number
  }>
  /** V4: 上下文注入元数据（用于记忆/技能注入质量分析） */
  contextInjectionMeta?: ContextInjectionMeta
  /** V5: LLM 执行环境（用于按模型/Provider 对比分析） */
  llmModel?: string
  llmProvider?: string
  /** V6: 多维结果信号（供 Governor 数据驱动学习，不硬编码权重） */
  outcomeSignals?: OutcomeSignals
  /** V7: Context Refresh 事件记录（每次 escalation 的上下文重建） */
  contextRefreshEvents?: ContextRefreshEvent[]
  /** V8: Ledger 里程碑事件（关键节点记录） */
  ledgerMilestones?: LedgerMilestone[]
  /** V8: Ledger 累积事实（任务结束时的 facts 快照） */
  ledgerFacts?: LedgerFacts
  /** V9: Transcriptase spawn 决策记录（供 TranscriptaseGovernor 回溯分析） */
  transcriptaseDecisions?: Array<{
    action: string
    patternId: string
    confidence: number
    childTask?: string
    baseIndex: number
  }>

  // V10: 实验元数据（Task 0.0 最小日志补丁）
  policyVersion?: string                    // Governor 策略版本，如 'governor_v2.1'
  promptVersion?: string                    // system prompt 版本，如 'fc_v3.2'
  toolSetHash?: string                      // 工具列表的 murmurhash
  softBehaviorEnabled?: boolean             // Soft Behavior 是否启用
  outcomeLabelSource?: 'auto' | 'human' | 'user_confirmed'  // repair 标签来源
  experimentPhase?: 'baseline' | 'experiment' | 'post_experiment'  // 实验阶段

  // V10 Task 1: 扩展字段
  /** 是否为 control 组（Task 3 动态判定：按 taskContent hash 固定 20% 分组） */
  controlTrack?: boolean
  /** 数据来源标记 */
  dataOrigin?: 'real_trace' | 'human_corrected' | 'augmented'

  // V10 Task 3: Control Track Shadow 记录
  /** Control 组 shadow 运行 Soft 规则的记录（仅 controlTrack=true 时填充） */
  controlTrackShadow?: ControlTrackShadow
}

/** V10 Task 3: Control Track Shadow 记录——Control 组 shadow 运行 Soft 规则的结果 */
export interface ControlTrackShadow {
  /** Soft 规则是否会触发干预 */
  wouldHaveSoftIntervened: boolean
  /** 会触发的 Soft 规则名称 */
  wouldHaveInterventionType?: string
  /** 会触发干预的步骤索引 */
  wouldHaveInterventionStep?: number
}

/** V6: 多维结果信号 — 保留原始信号，不压缩为单一置信度 */
export interface OutcomeSignals {
  /** 循环终止路径 */
  completionPath: string
  /** 工具错误率 (errorCount / toolCount, 无工具时为 -1) */
  errorRatio: number
  /** 是否存在 V 碱基（Agent 做了验证） */
  hasVerificationBase: boolean
  /** 是否有 Critic 工具调用成功（writeFile/runCmd 等修改类工具成功执行） */
  hasCriticToolSuccess: boolean
  /** 最后一个工具调用是否成功 */
  lastToolSucceeded: boolean
  /** 工具调用总数 */
  toolCount: number
  /** 是否触发过 Reflexion */
  hadReflexion: boolean
  /** 是否有 Dun 验收标准 */
  dunHasMetrics: boolean
  /** success 判定的具体原因（human-readable，用于调试和分析） */
  successReason: string

  // V10 新增: repair 标签体系（tri-state，区分 proxy 信号和真值）
  /** 结果综合判定 */
  outcome?: 'success' | 'partial' | 'failure' | 'uncertain'
  /** 自动检测：完成后 N 分钟内有编辑（proxy，必录） */
  manualEditAfterCompletion?: boolean
  /** 训练目标：null = 未确认 */
  requiredManualRepair?: boolean | null
  /** repair 标签来源 */
  repairLabelSource?: 'auto' | 'human' | 'user_confirmed'
  /** 检测窗口（默认 30 分钟） */
  repairWindowMinutes?: number
  /** repair 检测时间戳 */
  repairDetectedAt?: number
  /** V10: 细粒度信号 */
  signals?: {
    toolSuccess?: boolean
    userAccepted?: boolean | null
    testsPassed?: boolean | null
    llmJudgeScore?: number | null
    humanScore?: number | null
  }
}

/** V4: 上下文注入元数据 — 记录每次 buildDynamicContext 的注入质量指标 */
export interface ContextInjectionMeta {
  memory: {
    l0Count: number               // L0 检索返回条数
    l0Chars: number               // L0 注入总字符数
    l0AvgScore: number            // L0 平均 similarity score
    l0AvgConfidence: number       // L0 平均 confidence
    l0ScoreRange: [number, number]  // [最低, 最高] score
    categoryCounts: Record<string, number>  // 各 category 注入条数
    budgetUsed: number            // memory 分区已用字符数
    budgetCap: number             // memory 分区上限
  }
  skills: {
    availableCount: number        // 全量候选技能数
    injectedCount: number         // 实际注入的技能数（经排序过滤后）
    injectedChars: number         // 技能清单注入字符数
    avgSemanticScore: number      // 注入 skills 的平均语义分
    avgTotalScore: number         // 注入 skills 的平均总分
    minTotalScore: number         // 注入 skills 的最低总分（边界质量）
    injectedSkills: Array<{       // 每个注入 skill 的明细
      name: string
      totalScore: number
      semanticScore: number
    }>
  }
  traces: {
    execTraceCount: number        // exec_trace 检索条数
    successCaseCount: number      // 历史成功案例条数
    budgetUsed: number            // traces 分区已用字符数
  }
  totalChars: number              // 总注入字符数
  totalBudget: number             // 总预算上限
}

// ============================================
// V2: 碱基序列演进类型
// ============================================

/** V10: 碱基步骤意图来源 */
export type IntentSource =
  | 'agent_autonomous'
  | 'governor_prompted'
  | 'user_directed'
  | 'system_required'
  | 'child_inherited'

/** 碱基序列独立条目（P 碱基 + 工具碱基统一记录） */
export interface BaseSequenceEntry {
  /** 碱基类型 */
  base: 'E' | 'P' | 'V' | 'X'
  /** 全局序号（跨轮次递增） */
  order: number
  /** P 碱基的推理摘要（截断至 200 字符） */
  reasoningSummary?: string
  /** 对应 traceTools 中的 order（仅工具碱基有值） */
  toolOrder?: number
  /** 是否来自 Reflexion 轮次 */
  isReflexion?: boolean
  /** V8: 来自子 Agent 的碱基标记 */
  childRunId?: string
  /** V8: 在 Ledger 中的全局位置（跨 Agent 统一编号） */
  ledgerIndex?: number
  /** Phase 3: P 碱基的检测来源（非 P 碱基无此字段） */
  pDetectionSource?: PBaseDetectionSource

  // V10 新增: 元数据维度（Week 1 先只用 referencesArtifact）
  /** 分类置信度 0-1 */
  confidence?: number
  /** 碱基分类来源 */
  source?: 'rule' | 'tool' | 'meta' | 'human' | 'model'
  /** 意图来源 */
  intentSource?: IntentSource
  /** 风险等级 */
  risk?: 'low' | 'medium' | 'high'
  /** 作用域 */
  scope?: 'local' | 'global' | 'child-agent'
  /** 人工校正标签 */
  humanLabel?: 'E' | 'P' | 'V' | 'X'
  /** 模型预测标签 */
  modelLabel?: 'E' | 'P' | 'V' | 'X'

  // V10 新增: 因果链
  /** 操作的文件/资源路径 */
  referencesArtifact?: string
  /** 直接触发源事件 ID（最近 10 步窗口内） */
  causedBy?: string[]
  /** 因果来源标记 */
  causalSource?: 'explicit' | 'inferred' | 'heuristic'
}

// ============================================
// V7: Context Refresh 事件
// ============================================

/** V7: Context Refresh 事件 — 记录每次升级时的上下文重建 */
export interface ContextRefreshEvent {
  /** 第几次升级（从 1 开始） */
  escalationIndex: number
  /** 触发时间戳 */
  timestamp: number
  /** 触发时的 ReAct 轮次 */
  turnCountAtRefresh: number
  /** 重建前的消息数 */
  messageCountBefore: number
  /** 重建后的消息数（通常为 4） */
  messageCountAfter: number
  /** 重建前的 token 估算（字符数 / 4） */
  tokensBefore: number
  /** 重建后的 token 估算 */
  tokensAfter: number
  /** 触发时的任务完成率 */
  completionRate: number
  /** 携带的工作摘要长度 */
  carryOverSummaryLength: number
  /** 重建前的碱基序列快照 */
  preRefreshBaseSequence: string
  /** 碱基序列当前长度 */
  baseSequenceIndex: number
}

// ============================================
// V8: 碱基 Ledger 数据结构
// ============================================

/** V8: Ledger 里程碑事件类型 */
export type LedgerMilestoneType =
  | 'reflexion'
  | 'escalation'
  | 'context_refresh'
  | 'governor_intervention'
  | 'child_spawn'
  | 'child_complete'
  | 'transcriptase_adaptation'

/** V8: Ledger 里程碑事件 */
export interface LedgerMilestone {
  /** 里程碑类型 */
  type: LedgerMilestoneType
  /** 在碱基序列中的位置 */
  baseIndex: number
  /** 触发时间戳 */
  timestamp: number
  /** 附加元数据 */
  metadata: Record<string, unknown>
}

/** V8: Ledger 累积事实 — 纯规则从工具结果中提取 */
export interface LedgerFacts {
  /** 已完成操作摘要（最多 20 条，滚动窗口） */
  completedActions: string[]
  /** 发现的资源路径 */
  discoveredResources: string[]
  /** 失败的尝试（Reflexion 产生） */
  failedApproaches: string[]
  /** 当前目标（初始 = 用户 prompt） */
  currentObjective: string
  /** 分解出的子目标 */
  subObjectives: string[]
}

/** V8: 碱基 Ledger — 碱基序列 + 里程碑 + 累积事实 */
export interface BaseLedger {
  /** 运行 ID */
  runId: string
  /** 父运行 ID（子 Agent 时存在） */
  parentRunId?: string
  /** 关联的 Dun ID */
  dunId: string
  /** 碱基序列条目 */
  entries: BaseSequenceEntry[]
  /** 15 维特征快照（实时更新） */
  features: Record<string, number | boolean>
  /** 里程碑事件 */
  milestones: LedgerMilestone[]
  /** 累积事实 */
  facts: LedgerFacts
  /** 创建时间 */
  createdAt: number
  /** 最后更新时间 */
  updatedAt: number
}

/** 单轮 ReAct 循环的元数据 */
export interface ReActTurnMeta {
  /** 轮次索引（从 0 开始） */
  turnIndex: number
  /** 本轮是否包含计划/策略转变 */
  hasPlan: boolean
  /** 本轮 LLM 返回的计划步骤数 */
  planLength: number
  /** 本轮是否为 Reflexion 触发 */
  isReflexion: boolean
  /** 本轮是否已发射 P 碱基 */
  emittedPlanBase: boolean
  /** 本轮工具调用数量 */
  toolCount: number
  /** 本轮工具碱基类型列表 */
  toolBases: Array<'E' | 'V' | 'X'>
}

export interface ExecTraceToolCall {
  name: string
  args: Record<string, unknown>
  status: 'success' | 'error'
  result?: string
  latency: number
  order: number
  /** V2: 碱基类型标注 — E(Execute)/P(Plan)/V(Verify)/X(Explore) */
  baseType?: 'E' | 'P' | 'V' | 'X'
  /** V2: P 碱基的推理文本摘要（仅 baseType='P' 时有值） */
  reasoningSummary?: string
  /** V2: Layer 1 Token 消耗（本轮 LLM 调用的 usage） */
  tokenCost?: { prompt: number; completion: number }
  /** V2: 思维链文本摘要（DeepSeek reasoning_content 截断） */
  thinkingTextSummary?: string
  /** V2: 本轮上下文消息数 */
  contextMessageCount?: number
  /** V2: 本轮所有工具调用名称列表 */
  turnToolCalls?: string[]
  /** V2: 是否为 Reflexion 轮次 */
  isReflexionTurn?: boolean
  /** V2: LLM 本轮调用的响应耗时 (ms)，反映 Agent 的思考负担 */
  llmResponseTime?: number
}

// P0: 动态工具信息
export interface ToolInfo {
  name: string
  type: 'builtin' | 'plugin' | 'instruction' | 'mcp'
  description?: string
  inputs?: Record<string, unknown>
  dangerLevel?: string
  version?: string
  server?: string  // MCP 服务器名称
}

// ============================================
// World Genesis 类型
// ============================================

// [已废弃] 固定类型限制已移除，改为基于 ID 动态生成视觉样式

export interface VisualDNA {
  primaryHue: number        // 0-360
  primarySaturation: number // 40-100
  primaryLightness: number  // 30-70
  accentHue: number         // 0-360
  textureMode: 'solid' | 'wireframe' | 'gradient'
  glowIntensity: number     // 0-1
  geometryVariant: number   // 0-3 (sub-variant within archetype)
  // AI 生图：自定义图片 URL (高级用户)
  customImageUrl?: string
}

export interface GridPosition {
  gridX: number
  gridY: number
}

export interface DunEntity {
  id: string
  position: GridPosition
  // V2: 评分系统 (替代旧 xp/level)
  scoring: DunScoring
  visualDNA: VisualDNA
  species?: string            // 动物种族 (AnimalSpecies), 持久化后避免重复
  label?: string            // LLM-generated name
  constructionProgress: number // 0-1 (1 = fully built)
  createdAt: number
  // Phase 2: 涌现式 Dun
  boundSkillIds?: string[]  // 绑定的 Skill ID 列表
  flavorText?: string       // LLM 生成的描述
  lastUsedAt?: number       // 最后使用时间（用于 XP 计算）
  // Phase 3: 模型绑定
  customModel?: {           // 自定义模型 (null = 使用全局配置)
    baseUrl: string
    model: string
    apiKey?: string         // 空则用全局 key
  }
  llmBinding?: DunLLMBinding  // Per-Dun LLM 绑定（引用 LinkStation Provider）
  // Phase 4: File-based Dun (DUN.md)
  sopContent?: string             // DUN.md Markdown 正文 (Mission + SOP)
  triggers?: string[]             // 自动激活关键词
  version?: string                // Dun 版本
  location?: 'local' | 'bundled'  // 来源
  path?: string                   // 本地路径
  projectPath?: string            // 关联的项目根目录 (绝对路径)
  skillsConfirmed?: boolean       // 技能配置是否已经过用户确认
  // Phase 5: 目标函数驱动 (Objective-Driven Execution)
  objective?: string              // 核心目标函数 (任务终点定义)
  metrics?: string[]              // 验收标准 (布尔型检查点)
  strategy?: string               // 动态调整策略 (失败时的重试方案)
  // 元数据
  updatedAt?: number              // 最后更新时间
  source?: string                 // 来源标识 (e.g., 'openclaw:agent-id')
  agentIdentity?: {               // OpenClaw Agent identity
    name?: string
    emoji?: string
  }
  // Phase 6: SOP 自进化
  sopRewriteInfo?: {              // SOP 最近一次自动改写信息
    rewrittenAt: number           // 改写时间戳
    previousVersion?: string      // 改写前版本号
    triggerLevel?: string         // 触发级别 (EMERGENCY/STANDARD/GRADUAL)
    basedOnExecutions?: number    // 基于多少次执行数据
    historyVersion?: string       // 旧版本在 sop-history 中的版本号，供恢复用
  }
  sopEvolutionData?: {            // SOP 进化运行时数据
    isGolden: boolean             // 是否达到 Golden 状态
    ema: number                   // EMA fitness (0-1)
    totalExecutions: number       // 总执行次数
    goldenPathSummary?: {         // LLM 蒸馏的 Golden Path 总结
      taskCategories: Array<{
        name: string
        typicalToolChain: string[]
        estimatedDurationMs: number
        tips: string
      }>
      phaseInsights: Array<{
        phaseName: string
        status: 'golden' | 'stable' | 'bottleneck'
        insight: string
      }>
      commonPitfalls: string[]
      lastSummarizedAt: number
      basedOnExecutions: number
    }
  }
}

// Dun 经验记录
export interface DunExperience {
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
// Observer / 涌现式 Dun 类型
// ============================================

export type TriggerType = 'frequency' | 'complexity' | 'dependency' | 'periodic' | 'cross-skill' | 'intent-cluster'

export interface TriggerPattern {
  type: TriggerType
  confidence: number           // 0-1 置信度
  evidence: string[]           // 证据摘要（相关消息片段）
  detectedAt: number
  // 技能和SOP推荐
  suggestedSkills?: string[]   // 建议绑定的工具/技能名列表
  suggestedSOP?: string        // 建议的系统提示词/作业程序
  // ── 以下为 intent-cluster 类型使用的可选字段 [Q1] ──
  /** 发现的用户目的（从意图簇提炼） */
  discoveredObjective?: string
  /** 建议的 Dun 名称 */
  suggestedName?: string
  /** 建议的 triggers（从簇的核心关键词生成） */
  suggestedTriggers?: string[]
  /** 建议的 metrics（从成功/失败率推断） */
  suggestedMetrics?: string[]
  /** 原始意图簇（完整保留，不做有损转换）[Q1] */
  intentCluster?: IntentCluster
}

/** 意图簇：从 ExecTrace.task/tags 聚类得到 */
export interface IntentCluster {
  /** 簇的核心关键词 */
  coreKeywords: string[]
  /** 簇内的 trace ID 列表 */
  traceIds: string[]
  /** 簇内的原始 task 描述 */
  taskDescriptions: string[]
  /** 从簇内 traces 反查的工具链 */
  toolChains: string[][]
  /** 聚合的 tags */
  aggregatedTags: string[]
  /** 簇的大小（trace 数量） */
  size: number
  /** 簇的时间跨度（天） */
  timeSpanDays: number
  /** 簇内 traces 的平均轮次 [Q2] */
  avgTurnCount: number
  /** 簇内 traces 的成功率 [Q4] */
  successRate: number
}

/** Observer 洞察：从行为模式检测中产出，供 UI 展示和用户行动 */
export interface ObserverInsight {
  id: string
  /** 原始意图簇数据 */
  cluster: IntentCluster
  /** 检测置信度 */
  confidence: number
  /** 建议绑定的工具/技能 */
  suggestedSkills: string[]
  /** 核心关键词 */
  coreKeywords: string[]
  /** 代表性任务描述 */
  representativeTask: string
  /** 匹配到的已有 Dun ID（如果有） */
  relatedDunId?: string
  /** 匹配到的 Dun 名称 */
  relatedDunLabel?: string
  /** 是否已写入记忆系统 */
  memoryWritten: boolean
  /** 创建时间 */
  createdAt: number
}

/** Skill 提案（与 BuildProposal 平行） */
export interface SkillProposal {
  id: string
  /** 发现类型 */
  discoveryType: 'tool_frequency' | 'tool_chain' | 'cross_tool'
  /** 建议的 Skill 名称 */
  suggestedName: string
  /** 建议的 Skill 描述 */
  description: string
  /** 涉及的工具列表 */
  tools: string[]
  /** 工具链模式（如 "searchFiles→readFile→writeFile"） */
  toolChainPattern?: string
  /** 置信度 */
  confidence: number
  /** 检测证据 */
  evidence: string[]
  /** 状态 */
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: number
}

export interface BuildProposal {
  id: string
  triggerPattern: TriggerPattern
  suggestedName: string        // 建议的 Dun 名称
  previewVisualDNA: VisualDNA
  boundSkillIds?: string[]     // 多技能绑定列表
  sopContent?: string          // 系统提示词/SOP
  purposeSummary: string       // 一句话概括此 Dun 的功能目标
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: number
  // 意图维度的 Dun 元数据
  suggestedObjective?: string
  suggestedTriggers?: string[]
  suggestedMetrics?: string[]
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
// MBTI 灵魂形象类型
// ============================================

export type MBTIType = 'intj' | 'intp' | 'entj' | 'entp'
  | 'infj' | 'infp' | 'enfj' | 'enfp'
  | 'istj' | 'isfj' | 'estj' | 'esfj'
  | 'istp' | 'isfp' | 'estp' | 'esfp'

export interface MBTIResult {
  type: MBTIType
  animal: string       // "octopus", "cat", etc.
  animalZh: string     // "章鱼", "猫", etc.
  group: string        // "分析家", "外交官", etc.
  trait: string        // 一句话特质描述
  confidence: number   // 0-1
  source: 'rule' | 'llm'
}

// ============================================
// Gene Pool 自愈基因库类型
// ============================================

// 基因类别
export type GeneCategory = 
  | 'repair'      // 修复基因 (error→success 模式)
  | 'optimize'    // 优化基因
  | 'pattern'     // 通用模式

// Dun 能力信息
export interface DunCapabilityInfo {
  dunId: string             // dun 唯一标识
  dunName: string           // 显示名称
  description: string       // 能力描述
  capabilities: string[]    // 能力标签 ['漫画', '剧情', '角色设计']
  dirPath: string           // duns/xxx/
}

// Dun 产出物信息
export interface DunArtifactInfo {
  dunId: string             // 产出此文件的 Dun
  path: string              // 文件路径
  name: string              // 文件名/产出物名称
  type: string              // 类型 (story-outline, character-design, ppt, code...)
  size: number              // 文件大小
  description?: string      // 产出物描述
  linkedArtifacts?: string[] // 关联的其他产出物 ID
}

// 基因: 一条可复用的修复/优化模式
export interface Gene {
  id: string                      // gene-{timestamp} 或 seed-{name}
  category: GeneCategory
  signals_match: string[]         // 触发信号 (支持 /regex/flags 和子串匹配)
  strategy: string[]              // 修复策略步骤 (自然语言，V2: 抽象模式而非具体参数值)
  preconditions?: string[]        // V2: 前置条件 — 什么情况下该激活此基因
  antiPatterns?: string[]         // V2: 反模式 — 什么情况下不该使用此基因
  source: {
    traceId?: string              // 来源 trace ID
    dunId?: string                // 产生此基因的 Dun
    createdAt: number
    isSeed?: boolean              // V2: 是否为内置种子基因
  }
  metadata: {
    confidence: number            // 0-1 置信度
    useCount: number              // 被使用次数
    successCount: number          // 使用后成功次数
    lastUsedAt?: number
  }
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
  dunId?: string
  timestamp: number
}

// ============================================
// V2: Agent 事件状态机
// ============================================

// Agent 执行阶段
export type AgentPhase =
  | 'idle'               // 空闲
  | 'planning'           // 任务规划
  | 'executing'          // 工具执行中
  | 'reflecting'         // Reflexion 反思中
  | 'compacting'         // 上下文压缩中
  | 'waiting_approval'   // 等待用户审批
  | 'recovering'         // 错误恢复中（模型切换/重试）
  | 'done'               // 正常完成
  | 'error'              // 异常终止
  | 'aborted'            // 用户终止

// 工具调用摘要 (已完成的工具执行记录)
export interface ToolCallSummary {
  callId: string
  toolName: string
  args: Record<string, unknown>
  status: 'success' | 'error'
  result?: string                   // 成功时的结果（截断）
  error?: string                    // 失败时的错误信息
  durationMs: number
  isMutating: boolean               // 是否修改类操作
  timestamp: number
}

// 工具执行结果 (按 callId 索引)
export interface ToolResult {
  callId: string
  toolName: string
  success: boolean
  output: string
  durationMs: number
  timestamp: number
}

// 故障原因分类
export type FailoverReason =
  | 'auth'               // API Key 无效或过期
  | 'rate_limit'         // 速率限制
  | 'context_overflow'   // 上下文超出模型窗口
  | 'timeout'            // 请求超时
  | 'model_error'        // 模型返回错误
  | 'network'            // 网络连接失败
  | 'billing'            // 账户余额不足

// Agent 运行状态 (有状态事件转换器核心)
export interface AgentRunState {
  // ── 生命周期 ──
  runId: string
  seq: number                       // 单调递增事件序号
  phase: AgentPhase
  aborted: boolean
  timedOut: boolean

  // ── 消息流 ──
  assistantTexts: string[]
  deltaBuffer: string
  blockState: {
    thinking: boolean
    codeBlock: boolean
  }
  assistantMessageIndex: number
  lastStreamedText: string | undefined
  suppressLateChunks: boolean

  // ── 推理流 ──
  reasoningMode: 'off' | 'on' | 'stream'
  reasoningBuffer: string
  reasoningStreamOpen: boolean

  // ── 工具执行 ──
  currentTool: {
    name: string
    callId: string
    startTime: number
    args: Record<string, unknown>
  } | null
  toolHistory: ToolCallSummary[]
  toolResultById: Map<string, ToolResult>
  lastToolError: {
    toolName: string
    error: string
    isMutating: boolean
  } | undefined

  // ── 上下文压缩 ──
  compactionInFlight: boolean
  compactionCount: number
  tokensBefore: number
  tokensAfter: number

  // ── 错误恢复 ──
  failoverReason: FailoverReason | null
  attemptIndex: number
  modelChain: string[]
  currentModel: string

  // ── Dun 上下文 ──
  activeDunId: string | null
  dunSopInjected: boolean
  dunScore: number
  planProgress: {
    total: number
    completed: number
    currentStep: string
  } | null

  // ── Critic/Reflexion ──
  reflexionCount: number
  criticPending: boolean
  approvalPending: boolean
  approvalRequest: ApprovalRequest | null

  // ── 子智能体追踪 ──
  activeChildren: string[]
  childrenCompleted: number
  childrenFailed: number

  // ── Token 预算 ──
  tokenBudget: number
  tokenUsed: number
  tokenPercentage: number
}

// AgentRunState 工厂函数参数
export function createInitialRunState(runId: string, model: string, dunId?: string): AgentRunState {
  return {
    runId,
    seq: 0,
    phase: 'idle',
    aborted: false,
    timedOut: false,
    assistantTexts: [],
    deltaBuffer: '',
    blockState: { thinking: false, codeBlock: false },
    assistantMessageIndex: 0,
    lastStreamedText: undefined,
    suppressLateChunks: false,
    reasoningMode: 'off',
    reasoningBuffer: '',
    reasoningStreamOpen: false,
    currentTool: null,
    toolHistory: [],
    toolResultById: new Map(),
    lastToolError: undefined,
    compactionInFlight: false,
    compactionCount: 0,
    tokensBefore: 0,
    tokensAfter: 0,
    failoverReason: null,
    attemptIndex: 0,
    modelChain: [model],
    currentModel: model,
    activeDunId: dunId ?? null,
    dunSopInjected: false,
    dunScore: 50,
    planProgress: null,
    reflexionCount: 0,
    criticPending: false,
    approvalPending: false,
    approvalRequest: null,
    activeChildren: [],
    childrenCompleted: 0,
    childrenFailed: 0,
    tokenBudget: 0,
    tokenUsed: 0,
    tokenPercentage: 0,
  }
}

// ============================================
// V2: Agent 事件系统
// ============================================

// 事件流分类
export type AgentEventStream =
  | 'lifecycle'     // 生命周期
  | 'assistant'     // 助手消息流
  | 'tool'          // 工具执行
  | 'context'       // 上下文管理
  | 'recovery'      // 错误恢复
  | 'reflexion'     // 反思/Critic
  | 'approval'      // 审批
  | 'plan'          // 计划追踪
  | 'child'         // 子智能体
  | 'transcriptase' // V8: 碱基编排决策

// 事件信封 (所有事件的通用包装)
export interface AgentEventEnvelope {
  runId: string
  seq: number
  ts: number
  stream: AgentEventStream
  type: string
  data: Record<string, unknown>
  sessionId?: string
  dunId?: string
}

// ── lifecycle 事件 payload ──
export interface RunStartData {
  runId: string
  dunId: string | null
  model: string
  dunScore: number
  tokenBudget: number
}

export interface PhaseChangeData {
  from: AgentPhase
  to: AgentPhase
  reason?: string
}

export interface RunEndData {
  success: boolean
  turns: number
  tokensUsed: number
  toolsCalled: number
  reflexionCount: number
  compactionCount: number
  durationMs: number
  scoreChange: number
  childrenSpawned: number
  childrenCompleted: number
}

// ── tool 事件 payload ──
export interface ToolStartData {
  toolName: string
  callId: string
  args: Record<string, unknown>
  isMutating: boolean
}

export interface ToolEndData {
  callId: string
  toolName: string
  success: boolean
  result: string
  durationMs: number
  dimensionScoreChange?: number
}

export interface ToolErrorData {
  callId: string
  toolName: string
  error: string
  isMutating: boolean
}

// ── context 事件 payload ──
export interface CompactionStartData {
  tokensBefore: number
  trigger: 'overflow' | 'budget' | 'proactive'
}

export interface CompactionEndData {
  tokensAfter: number
  tokensBefore: number
  success: boolean
  summary?: string
}

export interface TokenWarningData {
  used: number
  budget: number
  percentage: number
}

// ── recovery 事件 payload ──
export interface FailoverStartData {
  reason: FailoverReason
  fromModel: string
  toModel: string
  attemptIndex: number
}

export interface RetryData {
  attemptIndex: number
  backoffMs: number
  reason: FailoverReason
}

// ── reflexion 事件 payload ──
export interface ReflexionStartData {
  failedTool: string
  error: string
  reflexionIndex: number
  dunScore: number
}

export interface ReflexionEndData {
  insight: string
  strategy: string
  reflexionIndex: number
}

// ── approval 事件 payload ──
export interface ApprovalRequiredData {
  requestId: string
  command: string
  toolName: string
  risk: 'high' | 'critical'
  reason: string
}

export interface ApprovalResolvedData {
  requestId: string
  approved: boolean
  resolvedBy: 'user' | 'auto'
}

// ── plan 事件 payload ──
export interface StepStartData {
  stepIndex: number
  totalSteps: number
  description: string
  dependsOn: string[]
}

export interface StepCompleteData {
  stepIndex: number
  success: boolean
  result?: string
  error?: string
  durationMs: number
}

// ── child 事件 payload ──
export interface ChildSpawnedData {
  childRunId: string
  childSessionId: string
  dunId: string
  task: string
  depth: number
  model: string
}

export interface ChildProgressData {
  childRunId: string
  phase: AgentPhase
  turns: number
  currentTool?: string
}

export interface ChildCompletedData {
  childRunId: string
  dunId: string
  success: boolean
  result?: string
  error?: string
  durationMs: number
  scoreChange: number
  genesHarvested: number
}

// ============================================
// V2: Dun 评分系统 (替代 XP/Level)
// ============================================

// 分数等级
export type ScoreTier = 'Expert' | 'Capable' | 'Learning' | 'Weak'

// 工具维度分数
export interface ToolDimensionScore {
  toolName: string
  score: number                     // 0-100
  calls: number
  successes: number
  failures: number
  avgDurationMs: number
  lastUsedAt: number
}

// 最近执行记录
export interface RecentRunEntry {
  runId: string
  task: string                      // 截断 80 字
  success: boolean
  scoreChange: number               // +5, -8 等
  turns: number
  toolsCalled: string[]
  durationMs: number
  timestamp: number
  genesHarvested?: number
}

// Dun 评分
export interface DunScoring {
  score: number                     // 0-100, 初始 50
  streak: number                    // 正=连胜, 负=连败
  totalRuns: number
  successCount: number
  failureCount: number
  successRate: number               // 0-1
  dimensions: Record<string, ToolDimensionScore>
  recentRuns: RecentRunEntry[]      // 最多 20 条
  lastUpdated: number
}

// 计分规则常量
export const SCORING_RULES = {
  SUCCESS_BASE: 5,
  SUCCESS_STREAK_BONUS: 1,
  SUCCESS_STREAK_MAX_BONUS: 5,
  SUCCESS_COMPLEXITY_BONUS: 3,
  SCORE_MAX: 100,
  FAILURE_BASE: -8,
  FAILURE_STREAK_PENALTY: -2,
  FAILURE_STREAK_MAX_PENALTY: -10,
  SCORE_MIN: 0,
  TOOL_SUCCESS_DELTA: 2,
  TOOL_FAILURE_DELTA: -3,
  EXPERT_THRESHOLD: 80,
  CAPABLE_THRESHOLD: 60,
  LEARNING_THRESHOLD: 40,
  INITIAL_SCORE: 0,
  MAX_RECENT_RUNS: 20,
} as const

// 分数等级计算
export function getScoreTier(score: number): ScoreTier {
  if (score >= SCORING_RULES.EXPERT_THRESHOLD) return 'Expert'
  if (score >= SCORING_RULES.CAPABLE_THRESHOLD) return 'Capable'
  if (score >= SCORING_RULES.LEARNING_THRESHOLD) return 'Learning'
  return 'Weak'
}

// 分数等级颜色
export const SCORE_TIER_COLORS: Record<ScoreTier, string> = {
  Expert:   '#22c55e',
  Capable:  '#3b82f6',
  Learning: '#f59e0b',
  Weak:     '#ef4444',
}

// 分数驱动行为配置
export interface ScoreDrivenBehavior {
  criticFrequency: 'all_mutating' | 'standard' | 'reduced'
  reflexionDepth: 'deep' | 'standard' | 'shallow'
  sopBudgetRatio: number
  memoryBudgetRatio: number
  geneInjection: boolean
  fewShotInjection: boolean
  autoApproveThreshold: 'high' | 'critical' | 'none'
}

export const SCORE_BEHAVIORS: Record<ScoreTier, ScoreDrivenBehavior> = {
  Expert: {
    criticFrequency: 'reduced',
    reflexionDepth: 'shallow',
    sopBudgetRatio: 0.08,
    memoryBudgetRatio: 0.10,
    geneInjection: false,
    fewShotInjection: false,
    autoApproveThreshold: 'high',
  },
  Capable: {
    criticFrequency: 'standard',
    reflexionDepth: 'standard',
    sopBudgetRatio: 0.15,
    memoryBudgetRatio: 0.20,
    geneInjection: true,
    fewShotInjection: false,
    autoApproveThreshold: 'none',
  },
  Learning: {
    criticFrequency: 'standard',
    reflexionDepth: 'deep',
    sopBudgetRatio: 0.15,
    memoryBudgetRatio: 0.25,
    geneInjection: true,
    fewShotInjection: false,
    autoApproveThreshold: 'none',
  },
  Weak: {
    criticFrequency: 'all_mutating',
    reflexionDepth: 'deep',
    sopBudgetRatio: 0.20,
    memoryBudgetRatio: 0.25,
    geneInjection: true,
    fewShotInjection: true,
    autoApproveThreshold: 'none',
  },
}

// 创建初始评分
export function createInitialScoring(): DunScoring {
  return {
    score: SCORING_RULES.INITIAL_SCORE,
    streak: 0,
    totalRuns: 0,
    successCount: 0,
    failureCount: 0,
    successRate: 0,
    dimensions: {},
    recentRuns: [],
    lastUpdated: Date.now(),
  }
}

/** 从 DunScoring 映射到视觉等级 (1-5)，供渲染器使用 */
export function scoringToVisualLevel(scoring?: DunScoring): number {
  const score = scoring?.score ?? 0
  if (score >= 80) return 5   // Expert
  if (score >= 60) return 4   // Capable
  if (score >= 40) return 3   // Learning
  if (score >= 20) return 2   // Weak
  return 1                    // New
}

// ============================================
// V2: DunContextEngine 接口
// ============================================

// assemble 参数和结果
export interface AssembleParams {
  sessionId: string
  messages: ChatMessage[]
  tokenBudget: number
  taskDescription?: string
}

export interface AssembleResult {
  messages: ChatMessage[]
  estimatedTokens: number
  systemPromptAddition?: string
  budgetBreakdown: {
    system: number
    sop: number
    memory: number
    genes: number
    skills: number
    history: number
  }
}

// compact 参数和结果
export interface CompactParams {
  sessionId: string
  tokenBudget: number
  trigger: 'overflow' | 'budget' | 'proactive'
  currentTokenCount: number
  /** 需要压缩的消息历史（compact 必须看到实际内容才能生成有效摘要） */
  messages?: Array<{ role: string; content: string }>
}

export interface CompactResult {
  ok: boolean
  compacted: boolean
  tokensBefore: number
  tokensAfter?: number
  summary?: string
  reason?: string
}

// ingest 参数和结果
export interface IngestParams {
  sessionId: string
  message: ChatMessage
}

export interface IngestResult {
  ingested: boolean
}

// afterTurn 参数
export interface AfterTurnParams {
  sessionId: string
  messages: ChatMessage[]
  prePromptMessageCount: number
  tokenBudget: number
  toolResults: ToolCallSummary[]
  runState: AgentRunState
}

// bootstrap 参数和结果
export interface BootstrapParams {
  sessionId: string
}

export interface BootstrapResult {
  bootstrapped: boolean
  importedMessages?: number
  memoriesLoaded?: number
  reason?: string
}

// prepareChildSpawn 参数和结果
export interface PrepareChildSpawnParams {
  parentSessionId: string
  childSessionId: string
  childDunId: string
  inheritContext: boolean
}

export interface ChildSpawnPreparation {
  contextSummary?: string
  sharedGenes?: Gene[]
  rollback: () => Promise<void>
}

// onChildEnded 参数
export interface OnChildEndedParams {
  childSessionId: string
  childDunId: string
  reason: 'completed' | 'error' | 'timeout' | 'killed'
  outcome?: {
    success: boolean
    result?: string
    error?: string
    tokensUsed?: number
    toolsCalled?: string[]
    scoreChange?: number
    genesHarvested?: Gene[]
  }
}

// DunContextEngine 接口
export interface DunContextEngine {
  readonly info: {
    id: string
    dunId: string
    name: string
  }

  // 必需方法
  assemble(params: AssembleParams): AssembleResult
  compact(params: CompactParams): Promise<CompactResult>
  ingest(params: IngestParams): IngestResult

  // 可选方法
  afterTurn?(params: AfterTurnParams): Promise<void>
  bootstrap?(params: BootstrapParams): Promise<BootstrapResult>
  prepareChildSpawn?(params: PrepareChildSpawnParams): Promise<ChildSpawnPreparation>
  onChildEnded?(params: OnChildEndedParams): Promise<void>
  dispose?(): Promise<void>

  /** Memory Flush: ReAct 循环结束后提炼本轮认知（可选，由 LocalClawService 调用） */
  flushMemory?(toolHistory: ToolCallSummary[], signal?: AbortSignal): Promise<void>

  /** Response Knowledge Flush: 从 AI 分析性响应中提取领域知识（可选） */
  flushResponseKnowledge?(userPrompt: string, response: string, signal?: AbortSignal): Promise<void>
}

// ============================================
// V2: 子智能体系统
// ============================================

// 子智能体生成参数
export interface SpawnChildParams {
  task: string
  dunId?: string
  model?: string
  mode: 'run' | 'session'
  cleanup: 'delete' | 'keep'
  timeout?: number
  inheritContext?: boolean
  shareGenes?: boolean
  priority?: 'high' | 'normal' | 'background'
  /** V8: 碱基 Ledger 上下文信封（由 Transcriptase 构建） */
  contextEnvelope?: ChildContextEnvelope
}

// 子智能体运行记录
export interface ChildRunRecord {
  runId: string
  childSessionId: string
  parentSessionId: string
  dunId: string
  dunLabel: string
  task: string
  status: 'pending' | 'running' | 'completed' | 'error' | 'timeout' | 'killed'
  outcome?: ChildOutcome
  depth: number
  model: string
  createdAt: number
  startedAt?: number
  endedAt?: number
  turns: number
  toolsCalled: string[]
  currentPhase: AgentPhase
}

// 子智能体执行结果
export interface ChildOutcome {
  success: boolean
  result?: string
  error?: string
  tokensUsed: number
  durationMs: number
  scoreChange: number
  genesHarvested: number
  /** V8: 子 Agent 的碱基序列（用于合并到父 Ledger） */
  childBaseSequence?: string
  /** V8: 子 Agent 发现的新 facts */
  childFacts?: Partial<LedgerFacts>
  /** v5: 终止原因，保留 killed/timeout 语义不被 markCompleted 覆盖 */
  terminationReason?: 'completed' | 'error' | 'killed' | 'timeout'
}

// 子智能体生成结果
export interface SpawnChildResult {
  status: 'accepted' | 'forbidden' | 'error'
  childSessionId?: string
  runId?: string
  error?: string
  dunId?: string
}

// 子智能体限制常量
export const CHILD_LIMITS = {
  maxSpawnDepth: 2,
  maxChildrenPerSession: 5,
  defaultTimeoutSeconds: 300,
} as const

// ============================================
// V8: Transcriptase 编排器类型
// ============================================

/** Transcriptase 编排决策类型 */
export type TranscriptaseDecisionType = 'continue' | 'spawn_child' | 'handoff' | 'abort' | 'escalate'

/** Transcriptase 编排决策 */
export interface TranscriptaseDecision {
  /** 决策类型 */
  type: TranscriptaseDecisionType
  /** 决策置信度 (0-1) */
  confidence: number
  /** 决策理由（人类可读，用于 trace） */
  reasoning: string
  /** 触发的规则 ID */
  triggeredPatternId?: string
  /** spawn_child 时: 子任务描述 */
  childTask?: string
  /** spawn_child 时: 目标 Dun ID */
  childDunId?: string
  /** spawn_child 时: 子任务优先级 */
  childPriority?: 'high' | 'normal' | 'background'
  /** handoff 时: 目标 Dun ID */
  handoffTarget?: string
  /** handoff 时: 交接上下文摘要 */
  handoffContext?: string
}

/** 子 Agent 上下文信封 (mRNA — 从父 Ledger 构建) */
export interface ChildContextEnvelope {
  /** 父 Ledger 快照 */
  parentLedgerSnapshot: BaseLedger
  /** 分配的子任务 */
  assignedTask: string
  /** 从父 Ledger 精选的共享事实 */
  sharedFacts: LedgerFacts
  /** 父碱基序列字符串（供子 Agent Governor 参考） */
  parentBaseSequence: string
  /** 返回契约 */
  returnContract: {
    /** 期望的输出类型 */
    expectedOutputType: 'text' | 'file' | 'data'
    /** 最大执行时间 (ms) */
    maxDurationMs: number
    /** 回报目标（父 runId） */
    reportBackTo: string
  }
}

/** Transcriptase 模式匹配规则 */
export interface TranscriptasePattern {
  /** 规则 ID */
  id: string
  /** 规则名称（人类可读） */
  name: string
  /** 碱基序列特征条件（复用 RuleCondition 格式） */
  featureCondition: {
    operator: 'AND' | 'OR'
    clauses: Array<{ feature: string; op: '>' | '<' | '>=' | '<='; value: number }>
  }
  /** Ledger facts 条件（可选） */
  factsCondition?: {
    minSubObjectives?: number
    minDiscoveredResources?: number
    hasFailedApproaches?: boolean
    minCompletedActions?: number
  }
  /** 满足条件时的决策类型 */
  decision: TranscriptaseDecisionType
  /** 决策置信度 */
  confidence: number
  /** 是否启用 */
  enabled: boolean
}

/** Transcriptase 配置 */
export interface TranscriptaseConfig {
  /** 是否启用 Transcriptase 编排 */
  enabled: boolean
  /** 最少执行 N 步后才考虑 spawn（防止过早分裂） */
  minStepsBeforeSpawn: number
  /** 最大活跃子 Agent 数 */
  maxActiveChildren: number
  /** 至少发现 N 个 facts 后才考虑 spawn */
  minFactsForSpawn: number
  /** 两次 spawn 决策之间的最小间隔步数 */
  minStepsBetweenSpawns: number
  /** 模式匹配规则 */
  patterns: TranscriptasePattern[]
}

// ============================================
// V8 Phase 3: Transcriptase 自适应 + P 碱基激活
// ============================================

/** Phase 3: Transcriptase spawn 决策记录（用于 A/B 对比） */
export interface TranscriptaseSpawnRecord {
  /** spawn 时的碱基步数 */
  stepCount: number
  /** spawn 时 Ledger facts 子目标数 */
  subObjectiveCount: number
  /** spawn 时 xeRatio */
  xeRatio: number
  /** spawn 时已有子 Agent 数 */
  childrenSpawned: number
  /** 触发的规则 ID */
  patternId: string
  /** 决策置信度 */
  confidence: number
  /** 最终任务是否成功 */
  success: boolean
  /** 子 Agent 是否完成并回传了 facts */
  childCompleted: boolean
  /** v5: follow-up run 的 runId，用于跨 run 关联 */
  followUpRunId?: string
  /** v5: 原始 run 的 runId，follow-up run 用此字段回溯 spawn 记录 */
  originalRunId?: string
}

/** Phase 3: Transcriptase Governor 分桶统计 */
export interface TranscriptaseGovBucketStats {
  spawnSuccessCount: number
  spawnTotalCount: number
  noSpawnSuccessCount: number
  noSpawnTotalCount: number
}

/** Phase 3: Transcriptase Governor 持久化统计数据 */
export interface TranscriptaseGovernorStats {
  version: number
  /** 分桶统计表: key = bucketKey */
  buckets: Record<string, TranscriptaseGovBucketStats>
  /** 每规则 spawn 效果统计 */
  patternEffects: Record<string, {
    spawnSuccess: number; spawnTotal: number
    noSpawnSuccess: number; noSpawnTotal: number
  }>
  /** 总 trace 计数 */
  totalTraceCount: number
  /** 上次自适应时的 trace 计数 */
  lastAdaptationCount: number
  /** 自适应历史记录（最近 20 条） */
  adaptationLog: Array<{
    timestamp: number
    adjustments: string[]
    traceCount: number
  }>
}

/** Phase 3: Transcriptase Governor 配置 */
export interface TranscriptaseGovernorConfig {
  /** 是否启用（默认 false，休眠态） */
  enabled: boolean
  /** 最小 trace 数量，低于此值不做自适应（默认 50） */
  minTracesForAdaptation: number
  /** 自适应触发间隔（每 N 条 trace） */
  adaptationInterval: number
  /** 卡方检验显著性水平 (默认 0.05) */
  significanceLevel: number
  /** 最小样本量（分桶内需达到此量才做调整） */
  minSamplePerBucket: number
}

/** Phase 3: P 碱基检测来源（标记 P 碱基是如何被识别的） */
export type PBaseDetectionSource =
  | 'llm_meta'           // LLM Function Calling _meta.planStep
  | 'reasoning_content'  // DeepSeek 等模型的 reasoning_content
  | 'reflexion'          // Reflexion 结构化反思（已有）
  | 'manual'             // 手动标注

// V10: 记忆状态三态（对应 server/db.py memory.status 字段）
// - active: 当前有效
// - superseded: 被新条目取代（保留做审计追溯）
// - conflicted: 与另一条目冲突，待解决
export type MemoryStatus = 'active' | 'superseded' | 'conflicted'

export interface MemorySearchResult {
  id: string
  score: number                     // 0-1
  snippet: string
  content?: string                  // 完整内容 (后端返回)
  source: string                    // 'memory' | 'exec_trace' | 'gene' | 'dun_xp' | 'session' | 'l1_memory'
  dunId?: string
  createdAt?: number                // Unix 毫秒时间戳
  confidence?: number               // 后端返回的置信度 (0-1)
  tags?: string[]
  metadata?: Record<string, unknown>
  category?: string                 // preference | project | discovery | uncategorized
  // ---- V10: Supersede 血统字段（后端可选返回）----
  status?: MemoryStatus             // 默认 active
  supersededBy?: string             // 指向新条目的 id
  supersedeReason?: string          // 取代原因
  supersedeAt?: number              // 取代时间（ms）
}

// V10: Supersede API 请求参数
export interface MemorySupersedeParams {
  targetId: string                  // 被取代的记忆 id
  newContent?: string               // 若提供则同步写入新记忆
  newTags?: string[]
  newCategory?: string
  newConfidence?: number
  source?: string                   // 新记忆 source，默认 'memory'
  dunId?: string
  reason: string                    // 取代原因（必填）
  mode?: 'supersede' | 'conflict'   // 默认 supersede
  metadata?: Record<string, unknown>
}

// V10: 写入闭环四态 action（postExecutionConsolidator LLM 输出）
export type MemoryWriteAction = 'NEW' | 'SUPERSEDE' | 'CONFLICT' | 'SKIP'

// 搜索算法配置
export const SEARCH_CONFIG = {
  FTS_WEIGHT: 0.3,
  VECTOR_WEIGHT: 0.7,
  TEMPORAL_DECAY_HALF_LIFE_DAYS: 30,
  MMR_LAMBDA: 0.7,
  SNIPPET_MAX_CHARS: 700,
  DEFAULT_MAX_RESULTS: 10,
  DEFAULT_MIN_SCORE: 0.3,
  DEDUP_SIMILARITY_THRESHOLD: 0.85,
} as const

// ============================================
// V2: 会话持久化
// ============================================

export interface SessionMeta {
  id: string
  title: string
  type: 'general' | 'dun'
  dunId?: string
  messageCount: number
  createdAt: number
  updatedAt: number
  lastMessagePreview?: string
  hasCheckpoint: boolean
}

// ============================================
// V2: 错误恢复配置
// ============================================

export const FAILOVER_STRATEGIES: Record<FailoverReason, string[]> = {
  auth:              ['rotate_api_key', 'prompt_user'],
  rate_limit:        ['exponential_backoff', 'switch_model'],
  context_overflow:  ['compact_context', 'truncate_tool_results'],
  timeout:           ['retry_with_backoff', 'switch_model'],
  model_error:       ['switch_model', 'simplify_prompt'],
  network:           ['retry_with_backoff', 'prompt_user'],
  billing:           ['switch_model', 'prompt_user'],
}

export const BACKOFF_CONFIG = {
  initialMs: 250,
  maxMs: 1500,
  factor: 2,
  maxAttempts: 3,
} as const

// ============================================
// V2: AgentEventBus 接口
// ============================================

export interface AgentEventBus {
  emit(event: Omit<AgentEventEnvelope, 'seq' | 'ts'>): void
  subscribe(listener: (event: AgentEventEnvelope) => void): () => void
  subscribeStream(stream: AgentEventStream, listener: (event: AgentEventEnvelope) => void): () => void
  getState(): AgentRunState
  getEvents(runId: string): AgentEventEnvelope[]
  reset(): void
}

// 终止操作粒度
export type AbortTarget =
  | { level: 'run' }
  | { level: 'tool'; callId: string }
  | { level: 'child'; childRunId: string }
  | { level: 'step'; stepIndex: number }
  | { level: 'compact' }

// ============================================
// V3: File Registry + L1 Memory
// ============================================

// 文件注册表条目
export interface FileRegistryEntry {
  path: string              // 归一化路径 (/ 分隔)
  mtime: number             // 最后修改时间戳(ms), 写操作更新
  lastAccessed: number      // 最后访问时间戳
  accessCount: number       // 累计访问次数
  dunId: string | null      // 首次访问时关联的 Dun ID
  registeredAt: number      // 首次注册时间
}

// L1 热记忆快照 (只存元数据，不存原始工具输出)
export interface L1ActionSnapshot {
  turn: number              // ReAct 循环轮次
  action: string            // 工具名 (toolName)
  target: string            // 操作目标 (路径或参数摘要, max 100 字符)
  status: 'success' | 'error'
  resultSize: number        // 原始结果字节数
  resultPreview: string     // 结果前 200 字符
  dunId: string             // 所属 Dun
  timestamp: number
}

// File Registry 配置
export const FILE_REGISTRY_CONFIG = {
  MAX_ENTRIES: 500,
  STALE_THRESHOLD_MS: 7 * 24 * 60 * 60 * 1000, // 7 天未访问视为过期
  PERSIST_DEBOUNCE_MS: 5000,
  LOCALSTORAGE_KEY: 'duncrew_file_registry',
  FILE_OPS: ['readFile', 'writeFile', 'appendFile', 'listDir'] as const,
} as const

// L1 Memory 配置
export const L1_MEMORY_CONFIG = {
  HOT_MAX_SNAPSHOTS: 5,          // L1-Hot 保留最近 5 轮
  SNAPSHOT_PREVIEW_CHARS: 200,   // resultPreview 截取长度
  SNAPSHOT_TARGET_CHARS: 100,    // target 截取长度
} as const

// ============================================
// V3: Confidence Scoring + L1→L0 Promotion
// ============================================

// 置信度信号
// V10: 新增 'passive_hit' 类型，用于被动晋升（搜索命中累计）
export interface ConfidenceSignal {
  type: 'environment' | 'human_feedback' | 'system_failure' | 'decay' | 'passive_hit'
  delta: number             // 分值变化量 (归一化到 0-1 范围)
  source: string            // 来源描述
  timestamp: number
}

// L1 记忆条目 (带置信度追踪)
// V10: 加入 hitCount / lastHitAt 支持被动晋升通道
export interface L1MemoryEntry {
  id: string
  dunId: string
  content: string
  confidence: number        // 0.0 ~ 1.0
  signals: ConfidenceSignal[]
  promotedToL0: boolean
  createdAt: number
  updatedAt: number
  lastDecayAt?: number      // 上次衰减时间戳（用于增量衰减计算）
  hitCount?: number         // V10: 搜索命中次数（被动晋升依据）
  lastHitAt?: number        // V10: 最近一次命中时间（ms）
}

// 置信度信号分值
export const CONFIDENCE_SIGNALS = {
  ENVIRONMENT_ASSERTION: 0.15,   // Critic 验证通过
  HUMAN_POSITIVE: 0.10,          // 用户正面隐式反馈 (降权，避免过度敏感)
  HUMAN_NEGATIVE: -0.20,         // 用户负面反馈
  SYSTEM_FAILURE: -0.15,         // 系统/工具执行失败 (降低惩罚)
  GENE_MATCH: 0.05,              // 与高置信基因匹配
  REPEATED_SUCCESS: 0.10,        // 同类工具重复成功 (新增)
} as const

// L0 晋升配置
export const L0_PROMOTION_CONFIG = {
  PROMOTION_THRESHOLD: 0.50,     // 置信度 >= 0.50 (从 0.65 降低，实际路径: 0.35+0.15+0.10=0.60>0.50)
  MIN_SIGNALS_FOR_PROMOTION: 2,  // 至少 2 个信号
  DECAY_HALF_LIFE_DAYS: 30,      // L0 记忆半衰期
  INITIAL_CONFIDENCE: 0.35,      // 新条目初始置信度
} as const

// V10: L1 被动晋升配置 — 针对长期有用但无主动信号的 L1 条目
// 触发条件：存活 >= MIN_AGE_DAYS 且搜索命中 >= MIN_HIT_COUNT 且近 NO_NEGATIVE_WINDOW_DAYS 天无负面信号
export const PASSIVE_PROMOTION_CONFIG = {
  MIN_AGE_DAYS: 7,                    // 条目存活至少 7 天
  MIN_HIT_COUNT: 3,                   // 被搜索命中至少 3 次
  HIT_SIGNAL_DELTA: 0.10,             // 每次命中贡献的信号 delta（累加到 confidence）
  NO_NEGATIVE_WINDOW_DAYS: 30,        // 近 30 天无负面信号
  HIT_DEBOUNCE_MS: 5 * 60 * 1000,     // 5 分钟内同一 memoryId 的多次命中算一次（避免刷分）
} as const

// V10: 记忆搜索调用目的（purpose）
// - context_injection: 由 buildDynamicContext 注入上下文时的搜索（会触发命中计数）
// - user_query:        用户在 Memory House 或 UI 中主动查询（不计命中，避免 UI 刷屏刷分）
// - dedup_check:       postExecutionConsolidator 的查重检索（不计命中）
// - internal:          其他内部调用
export type MemorySearchPurpose =
  | 'context_injection'
  | 'user_query'
  | 'dedup_check'
  | 'internal'

// ============================================================================
// StudyRoom (自习室) — 写作契约 / 证据 / 议程 / 会话运行时
// ----------------------------------------------------------------------------
// 这一整段类型是 `src/services/studyRoom/*`, `src/components/houses/studyRoom/*`
// 和 `src/store/slices/studyRoomSlice.ts` 共享的核心数据结构. 之前它们分散在
// 各个使用点内部或丢失, 统一收拢到这里维护.
// ============================================================================

// ---- 体裁 / 篇幅 / 语气枚举 (来自写作契约 brief) --------------------------

export type GenreHint =
  | 'report'      // 报告 / 分析
  | 'essay'       // 随笔 / 议论
  | 'letter'      // 书信
  | 'memo'        // 备忘
  | 'tutorial'    // 教程
  | 'novel'       // 虚构
  | 'custom'      // 自定义

export type LengthHint = 'short' | 'medium' | 'long' | 'xlong' | 'auto'

/** 语气标签是开放集合 — brief.tone 用户可自由输入, 这里只给出常见预设 */
export type ToneHint = string

// ---- 技能引用 -----------------------------------------------------------

/** SkillRef — 写作契约里引用的技能元信息, 注入 prompt 时展示名称 + 优先级 */
export interface SkillRef {
  // 技能名 (和 skills 目录下每个子目录的 SKILL.md 的 name 对齐, 避免 JSDoc 含 `*` 误闭合)
  name: string
  /** 来源: 内置 / 用户自定义 / openclaw 市场 */
  source: 'builtin' | 'user' | 'openclaw' | string
  /** 优先级: 多技能冲突时数值大者优先. 用户手动 @ 的 = high, 自动推荐 = normal */
  priority: 'high' | 'normal' | 'low' | string
}

// ---- 写作契约 (WritingBrief) ---------------------------------------------

/**
 * 写作契约 — 一次自习室会话的"写作需求"描述.
 * 由 intake 阶段从用户原话 + LLM 分类器解析出, 后续所有 prompt 注入都以它为中心.
 */
export interface WritingBrief {
  id: string
  /** 用户原话, 不做改写 */
  intent: string
  /** 体裁 */
  genre: GenreHint
  /** 长度档位 */
  length: LengthHint
  /** 用户是否显式指定了长度 (true = 用户说过"写长一点"; false = 由 LLM 推断) */
  lengthExplicit?: boolean
  /** 语气标签, 多个标签取交集 */
  tone: ToneHint[]
  /** 受众画像 (自由文本) */
  audience: string
  /** 硬约束列表, 违反即失败 */
  constraints: string[]
  /** 用户 @ 或自动推荐的技能列表 */
  skills: SkillRef[]
  /** 用户在 TelescopePanel 钉住的实体 ID (Library 实体, 写作时必须引用) */
  pinnedEntityIds?: string[]
  /** 创建时间 */
  createdAt: number
  /** 指定的写作 Dun (如果用户挑了 Dun 来写) */
  dunId?: string
  /** 指定的文风指纹 id (session 级, 不跨 session) */
  fingerprintId?: string | null
}

// ---- 证据 / 记忆片段 ------------------------------------------------------

/**
 * EvidenceItem — 证据池里的一条素材.
 * 来自 3 个镜头: L (Library 权威知识) / W (WebSearch 网络) / S (Skills 文档) / M (Memory 记忆).
 */
export interface EvidenceItem {
  id: string
  /** 镜头来源. 决定 prompt 里的引用标记前缀 (如 [^L12]) */
  lens: 'L' | 'W' | 'S' | 'M' | string
  /** 证据标题 */
  title: string
  /** 证据摘要 (给 LLM 注入 prompt 用, 通常 200 字内) */
  snippet: string
  /** 原始 URL (W 镜头) / 文件路径 (S 镜头) / 实体 id (L 镜头) */
  source?: string
  /**
   * 可选的引用元数据. 两种形态:
   * - string: 简单的引用链接 (旧用法)
   * - 对象: 指向具体 L/S/M/E 记录的结构化引用 (lensLibrary / lensSkills 填的形态)
   */
  ref?: string | {
    kind: 'entity' | 'skill' | 'memory' | 'web' | string
    entityId?: string
    skillName?: string
    memoryId?: string
    url?: string
    snapshotTldr?: string
  }
  /** 发布时间 / 创建时间, 用于可信度排序 */
  publishedAt?: number
  /** 自由标签, 辅助筛选 */
  tags?: string[]
}

/** MemorySnippet — 从全局记忆召回的长期知识片段, 区别于证据池里的 M 镜头 */
export interface MemorySnippet {
  id: string
  /** 来源描述, 如 "l0_memory" / "exec_trace" / "nexus_xp" */
  source: string
  /** 记忆内容 */
  content: string
  /** 相关性分数 (0-1), 用于排序 */
  score?: number
  /** 时间戳 */
  createdAt?: number
}

// ---- 议程 (AgendaDoc) -----------------------------------------------------

/**
 * AgendaSection — 议程里的一节.
 * 每一节由一次写作调用负责产出, 其他节不会被改动.
 */
export interface AgendaSection {
  /** 节 id, 形如 "sec-01" (所有生成路径都会填, 一律视为必填) */
  id: string
  /** 节次序, 从 1 开始 */
  order: number
  /** 标题 */
  heading: string
  /** 本节要解决的问题 (写作 prompt 注入用) */
  intent: string
  /** 目标字数 (±10% 内算合格) */
  targetLength: number
  /** 本节允许引用的证据 id 列表 (EvidenceItem.id) */
  evidencePocket: string[]
  /** 本节建议适用的技能名 */
  skillHints: string[]
  /** 已生成的内容 (可选, draft 阶段后填) */
  content?: string
  /** 本节生成状态 (planned = 骨架规划好还没动笔) */
  status?: 'planned' | 'pending' | 'drafting' | 'done' | 'failed'
  /** 节内部版本号, 每次重写段落递增 */
  revision?: number
  /** 本节已完整产出的草稿 (draft 阶段的终态) */
  draft?: string
  /** 本节正在流式生成中的半成品 (composeDraft/rewriteSection 的增量累积) */
  draftPartial?: string
  /** 本节正文里解析出的脚注 (footnote) 列表 */
  footnotes?: Footnote[]
}

/** 议程文档 — 整篇文章的骨架, 由 Conductor 一次性产出 */
export interface AgendaDoc {
  /** 关联的 brief id (一个 brief 对应一个 agenda) */
  briefId?: string
  title: string
  subtitle?: string
  /** 全文立意 (一句话) */
  openingStance?: string
  /** 全文收束 (一句话) */
  closingCall?: string
  /** 各节定义 */
  sections: AgendaSection[]
  /** 篇幅决策的自然语言解释 (v3 一次性写作模式下用) */
  lengthRationale?: string
  /** 创建时间 */
  createdAt?: number
  /** 议程版本号, 每次用户修改议程递增 */
  revision?: number
}

// ---- 对话消息扩展 --------------------------------------------------------

/** 自习室对话消息附件 */
export interface WriterChatAttachment {
  type: 'skill' | 'file'
  name: string
  mimeType?: string
  size?: number
  content?: string
  error?: string
}

/**
 * WriterMessageIntent — 用户消息被分类器分成的四类意图.
 * - discuss: 只想讨论, 不动文章
 * - edit:    想改已有文章
 * - write:   想从头写一篇 (当前文章空)
 * - unclear: 分类器置信度不足, 需要用户二次澄清
 */
export type WriterMessageIntent = 'discuss' | 'edit' | 'write' | 'unclear' | 'deliberate'

/** 意图澄清卡片 — unclear 意图下 AI 回弹给用户的卡片数据 */
export interface IntentClarification {
  /** 用户的原始消息 (用户点按钮后需要重放这条消息) */
  originalMessage: string
  /** 分类器给出的理由 (可选展示给用户看) */
  reason?: string
  /** 分类器给出的置信度 (0-1) */
  confidence?: number
  /** 用户是否已经处理过这张澄清卡 (点了某个按钮后置 true, 避免重复渲染) */
  resolved?: boolean
}

/**
 * SuggestedEdit — 讨论模式结尾 AI 附带的"应用此建议"卡片.
 * 用户点"应用"后, 前端会把 instruction 作为下一轮 edit 请求的输入.
 */
export interface SuggestedEdit {
  /** 一句话总结这次建议 (UI 顶部显示) */
  summary: string
  /** 具体指令, 会被填回 composer 作为 edit intent */
  instruction: string
  /** 用户是否已经点了"应用" (避免重复应用) */
  applied?: boolean
}

/**
 * EditSummary — 改写 / 整篇重写结束时 AI 给出的变更摘要.
 * 用于在对话流里显示"我做了哪些修改", 避免用户盯着 diff 猜.
 */
export interface EditSummary {
  /** 一句话总结这次编辑 */
  summary: string
  /** 具体变更列表 */
  changes: Array<{
    /** 改在哪 (段落描述或 section id) */
    where: string
    /** 改了什么 */
    what: string
    /** 为什么改 (可选, 非核心) */
    why?: string
  }>
  /** AI 选择不改的地方 (可选, 展示"我考虑过但没动"的透明度) */
  skipped?: string[]
  /** 字数变化 [修改前, 修改后], 由上层根据实际文本计算填入 */
  wordCountDelta?: [number, number]
}

/**
 * ProfileSuggestion — LLM 在 Tool Loop 里想写入"风格档案"的候选建议.
 * 不再让 LLM 直接写档案, 而是产出这个对象, 用户点"接受"后才真正落库.
 */
export interface ProfileSuggestion {
  id: string
  /** 偏好 vs 避免 */
  kind: 'preference' | 'avoid'
  /** 内容 (人类可读的一句话) */
  content: string
  /** 风格类别 (可选, 由分类器给) — 与 writerProfile.PreferenceCategory 对齐 */
  category?: 'style' | 'structure' | 'vocabulary' | 'citation' | 'topic'
  /** UI 状态: pending 待处理 / accepted 已接受入档 / dismissed 用户忽略 */
  status?: 'pending' | 'accepted' | 'dismissed'
  /** LLM 给出的"建议这条入档的理由" (UI 二次确认时展示) */
  reason?: string
  /** 创建时间 */
  createdAt?: number
}

/**
 * WriterChatMessage — 自习室对话流里的消息.
 * 结构上就是扩展了自习室字段的 ChatMessage, ChatMessage 的自习室扩展字段
 * 已经在上面的 ChatMessage 里 opt-in, 这里只是起一个"强类型提示"作用.
 */
export type WriterChatMessage = ChatMessage

// ---- 旧版 ChatTurn (兼容字段) -------------------------------------------

/**
 * ChatTurn — v1 时期的对话轮记录 (user+assistant 配对).
 * v2 已经改用 WriterChatMessage 扁平数组, ChatTurn 仅 studyRoomSlice.addChatTurn
 * 还保留作为兼容入口, 新代码不应该使用.
 */
export interface ChatTurn {
  id: string
  userMessage: string
  assistantMessage: string
  timestamp: number
  /** 可选附件 (技能引用等) */
  attachments?: WriterChatAttachment[]
}

// ---- 文档版本 (DocumentVersion) -----------------------------------------

/** 版本触发来源: 用户手动保存 / Dun 写作完成 / 段改 / 整改 / 提炼后回写 */
export type DocumentVersionTrigger =
  | 'manual'
  | 'dun_write'
  | 'section_edit'
  | 'full_rewrite'
  | 'restore'
  | 'distill'
  | string

/** 版本轻量元信息 — 用于版本列表渲染, 不带 document 正文 */
export interface DocumentVersionMeta {
  id: string
  wordCount: number
  createdAt: number
  trigger: DocumentVersionTrigger
  /**
   * 变更摘要. 允许三种形态:
   * - string: 一句话说明 (手动保存 / 自动触发时)
   * - EditSummary: 结构化变更摘要 (改写 / 整改时)
   * - null: 无摘要
   */
  summary: string | EditSummary | null
  parentVersionId: string | null
}

/** 版本完整记录 — 含正文. 恢复 / diff 时才拉取 */
export interface DocumentVersion extends DocumentVersionMeta {
  document: string
}

// ---- 自习室会话运行时 (StudySessionRuntime) -----------------------------

/**
 * StudySessionRuntime — 单个自习室会话在内存里的完整运行时状态.
 * 后端持久化的是它的一个 sanitized 子集.
 */
export interface StudySessionRuntime {
  id: string
  /** 写作契约 */
  brief: WritingBrief
  /** 当前正文 (最新版) */
  document: string
  /** 扁平对话流 (v2, 新代码用这个) */
  chatMessages: WriterChatMessage[]
  /** 证据池 (L/W/S/M 4 镜头累积) */
  evidencePool: EvidenceItem[]
  /** 议程 */
  agenda: AgendaDoc | null
  /** 旧版 ChatTurn 列表 (v1 兼容) */
  chatHistory: ChatTurn[]
  /** 会话状态 */
  status: 'idle' | 'intake' | 'researching' | 'drafting' | 'revising' | 'done' | 'error' | string
  /** 后端 revision 号 (乐观锁) */
  revision: number
  createdAt: number
  updatedAt: number
  /** 信任模式 — 开启后跳过 unclear 澄清, 直接按 LLM 置信度较低也继续 */
  trustMode?: boolean
  /** 版本历史 (轻量元信息, 正文按需拉) */
  versions?: DocumentVersionMeta[]
  /** 已加载的写作 Dun (不落后端, 只在内存 + localStorage) */
  loadedDun?: import('./services/studyRoom/writingDun').LoadedDun | null
  /** 长期记忆片段 (召回缓存) */
  memorySnippets?: MemorySnippet[]
  /** 当前聚焦的 section id (UI 状态) */
  focusedSectionId?: string | null
  /** 深度打磨管线状态 (MVP: 纯内存态, 刷新即丢) */
  deliberation?: DeliberationState | null
}

// ============================================================================
// StudyRoom — 文风指纹 (WriterFingerprint)
// ----------------------------------------------------------------------------
// 指纹采用 3 层结构: L0 行为规则 / L1 量化指标 + 画像 / L3 范文样本.
// 存储: localStorage + 后端 /api/study/fingerprints/*.
// ============================================================================

// ---- 11 个枚举常量数组 + 对应的类型别名 --------------------------------

export const ARGUMENT_PATTERNS = [
  'deductive', 'inductive', 'analogical', 'counterfactual', 'abductive', 'authority',
] as const
export type ArgumentPatternType = typeof ARGUMENT_PATTERNS[number]

export const EVIDENCE_PREFERENCES = [
  'data', 'case', 'classic', 'personal', 'thoughtExperiment', 'commonSense',
] as const
export type EvidencePreferenceType = typeof EVIDENCE_PREFERENCES[number]

export const COUNTER_ARG_HANDLINGS = [
  'preemptive', 'ignore', 'acknowledge', 'confront',
] as const
export type CounterArgHandlingType = typeof COUNTER_ARG_HANDLINGS[number]

export const ARGUMENT_DEPTHS = ['one-hop', 'two-hop', 'multi-hop'] as const
export type ArgumentDepthType = typeof ARGUMENT_DEPTHS[number]

export const CREDIBILITY_PERSONAS = [
  'expert', 'oldFriend', 'witness', 'observer', 'prophet',
] as const
export type CredibilityPersonaType = typeof CREDIBILITY_PERSONAS[number]

export const CERTAINTY_LEVELS = [
  'assertive', 'confident', 'balanced', 'cautious', 'tentative',
] as const
export type CertaintyLevelType = typeof CERTAINTY_LEVELS[number]

export const EMOTIONAL_TEMPERATURES = [
  'cool', 'angry', 'warm', 'playful', 'sardonic', 'reverent',
] as const
export type EmotionalTemperatureType = typeof EMOTIONAL_TEMPERATURES[number]

export const READER_DISTANCES = [
  'lecturer', 'peer', 'friend', 'stranger', 'confessor',
] as const
export type ReaderDistanceType = typeof READER_DISTANCES[number]

export const HOOK_PATTERNS = [
  'scene', 'question', 'counterintuitive', 'quotation', 'data', 'personal', 'direct',
] as const
export type HookPatternType = typeof HOOK_PATTERNS[number]

export const PACING_PATTERNS = [
  'linear', 'spiral', 'dualTrack', 'peelingLayers', 'scatteredConverge',
] as const
export type PacingPatternType = typeof PACING_PATTERNS[number]

export const CLOSING_PATTERNS = [
  'aphorism', 'echo', 'question', 'callToAction', 'openEnding', 'selfDeprecation',
] as const
export type ClosingPatternType = typeof CLOSING_PATTERNS[number]

// ---- 3 个字段形态 (对应 fingerprintSchema.ProfileFormShape) -------------

/** 枚举单值字段, 如 "反方处理 = confront" */
export interface EnumField<T extends string = string> {
  /** 枚举值 */
  type: T
  /** 自由文本描述 (LLM 在 type 之外补充的语境说明) */
  description: string
}

/** 枚举主+次字段, 如 "论证模式 = 主 deductive, 次 analogical" */
export interface EnumPairField<T extends string = string> {
  /** 主倾向 */
  primary: T
  /** 次倾向 (可能空) */
  secondary?: T
  /** 自由文本描述 */
  description: string
}

/** Logos / Pathos / Ethos 三诉求配比 (百分比, 三者之和应接近 100) */
export interface AppealBalanceField {
  /** 逻辑 (事实/论证) */
  logos: number
  /** 情感 (动之以情) */
  pathos: number
  /** 人格 (诉诸可信度) */
  ethos: number
  /** 自由文本描述 */
  description: string
}

// ---- WriterFingerprint 画像 (L2, 22 维) ---------------------------------

/**
 * 风格画像 22 个可选字段. 具体字段 key / 标签 / 所属层 / 形态
 * 权威定义在 `src/services/studyRoom/fingerprintSchema.ts` 的 `PROFILE_FIELD_SPECS`.
 * 单样本时 (sourceCount < 3) 意象/主题层字段会被跳过 (留空).
 */
export interface WriterFingerprintProfile {
  // --- 旧字段 (向后兼容, 早期版本存档里可能还有) ---
  /** 旧版"开篇风格"字段, 新版已并入 hookPattern */
  opening?: string
  /** 旧版"收束风格"字段, 新版已并入 closingPattern */
  closing?: string
  // --- 微观语言层 (string 描述型) ---
  sentenceStyle?: string
  rhetoric?: string
  vocabulary?: string
  paragraphing?: string
  citation?: string
  avoid?: string
  // --- 话语 / 论证层 ---
  argumentPattern?: EnumPairField<ArgumentPatternType>
  evidencePreference?: EnumPairField<EvidencePreferenceType>
  counterArgHandling?: EnumField<CounterArgHandlingType>
  argumentDepth?: EnumField<ArgumentDepthType>
  transitionStyle?: string
  informationDensity?: string
  // --- 说服力层 ---
  appealBalance?: AppealBalanceField
  emotionalTriggers?: string
  credibilityBuilding?: EnumField<CredibilityPersonaType>
  // --- 态度层 ---
  certaintyLevel?: EnumField<CertaintyLevelType>
  emotionalTemperature?: EnumField<EmotionalTemperatureType>
  readerDistance?: EnumField<ReaderDistanceType>
  // --- 意象 / 主题层 (多样本才能有) ---
  frequentImagery?: string
  metaphorDomain?: string
  referencePreference?: string
  // --- 宏观结构层 ---
  hookPattern?: EnumField<HookPatternType>
  pacingPattern?: EnumField<PacingPatternType>
  turnPoints?: string
  closingPattern?: EnumField<ClosingPatternType>
}

// ---- WriterFingerprint 量化指标 (L1) ------------------------------------

/**
 * L1 量化指标 — 由后端 `/distill-prepare` 从原文算出, 给 LLM 画像做锚.
 * 全部字段都是可选的, 因为不同的源文档可能算不出某些指标.
 */
export interface WriterFingerprintMetrics {
  /** 平均句长 (字) */
  avgSentenceLen?: number
  /** 平均段长 (字) */
  avgParagraphLen?: number
  /** 短句 (<15 字) 占比, 0-1 */
  shortSentenceRate?: number
  /** 长句 (>40 字) 占比, 0-1 */
  longSentenceRate?: number
  /** 书面 / 口语倾向, -1 (口语) ~ +1 (书面) */
  formalityScore?: number
  /** 成语密度, 个/千字 */
  idiomDensity?: number
  /** 设问 / 反问率, 个/千字 */
  rhetoricRate?: number
  /** 允许后端未来加字段, 不强制破坏客户端 */
  [extra: string]: number | undefined
}

// ---- WriterFingerprint 范文样本 (L3) -------------------------------------

/** 范文样本 — 从原文里抽出的代表性段落, 写作时可作为 few-shot 参考 */
export interface WriterFingerprintSample {
  /** 样本正文 */
  text: string
  /** 来源标题 (如 "《散步》") */
  source?: string
  /** 入选理由 (如 "最能体现画面感") */
  reason?: string
}

// ---- WriterFingerprint 行为规则 (L0) -------------------------------------

/**
 * FingerprintBehaviorRule — L0 行为规则.
 * 以 L1 画像 + 指标为锚点, 从原文提取出的"可执行"规则, 写作时作为硬约束注入.
 *
 * 【阶段 1 认知论升级: 维特根斯坦"共识是涌现的"】
 * 一条规则的意义 = 它在不同使用场景下的交集.
 * examples 字段从"旧版兼容字段"升格为"多源印证的主字段":
 *   - 每条规则应挂 2-3 条来自原文不同位置的印证片段
 *   - 只有多源印证才能证明这是"可复现的风格", 不是单次偶然
 * example (单数) 保留作为向后兼容字段, 旧指纹数据仍可读.
 *
 * 【阶段 2 认知论升级: 维特根斯坦"语言游戏的语境分层"】
 * when 字段的语境可以横跨三个层级, 都共用这一个容器, 无需新类型:
 *   - 微观 (句子/段内): "当需要自嘲时" / "当引用反常识数据时"
 *   - 中观 (段落/论证): "当面对可能抵触的读者时" / "当铺陈核心论题时"
 *   - 宏观 (篇章/骨架): "当组织一整篇文章时" / "当决定开篇切入角度时"
 */
export interface FingerprintBehaviorRule {
  /** 规则 id (可选, L0 提取器可能不给 id, 以 when+do 指纹去重) */
  id?: string
  /**
   * 内部判断式触发条件 (而非外部位置).
   * 好: "当读者可能抵触这个观点时" / "当想给一个论断减轻权威感时".
   * 差: "开头第一段" / "段落过渡处" — 这是排版习惯, 不是风格.
   */
  when?: string
  /** 作者具体怎么做 (在这个字段里请用引号标出标志性词汇或句式). */
  do?: string
  /** 作者明确不做什么 (与 do 形成辨识度对照). */
  not?: string
  /**
   * 【阶段 1 主字段】多源印证 (≥ 2 条, 来自原文不同位置).
   * 体现维特根斯坦"共识涌现"原则: 同一模式在多个使用场景下出现, 才算真规则.
   * 若 LLM 只能找到 1 条印证, 该规则应被判定为"未被证明", 予以删除.
   */
  examples?: string[]
  /**
   * @deprecated 阶段 1 起请用 examples (复数). 单数字段保留用于向后兼容旧指纹数据.
   * 渲染时: 优先 examples, 回退到 example.
   */
  example?: string
  // ---- 以下为旧版兼容字段, 新路径不再写入 ----
  /** 旧版"规则一句话描述" (等价于新 do) */
  rule?: string
  /** 分类: 句式 / 修辞 / 用词 / 结构 / 其他 */
  category?: 'sentence' | 'rhetoric' | 'vocabulary' | 'structure' | 'other' | string
  /** 旧版触发条件 (等价于新 when) */
  trigger?: string
  /** 旧版反例列表 */
  antiExamples?: string[]
  /** 优先级, 数值越大越硬 */
  priority?: number
}

// ---- WriterFingerprint 提炼日志 ----------------------------------------

/** 提炼过程的时间线日志条目 (用于 DistillDialog 展示) */
export interface WriterFingerprintDistillLog {
  /** 时间戳 (ms) */
  time: number
  /** 级别: info 常规 / success 里程碑 / warn 警告 / error 错误 / data 数据展示 */
  level: 'info' | 'success' | 'warn' | 'error' | 'data'
  /** 一句话标签 */
  label: string
  /** 详情 (可多行) */
  detail?: string
}

// ---- WriterFingerprint 元信息 + 完整对象 -------------------------------

/** 列表页只读元信息, 不带 profile/samples/metrics */
export interface WriterFingerprintMeta {
  id: string
  /** 显示名 */
  name: string
  /** 用户描述 */
  description?: string
  /** 源文档数量 */
  sourceCount?: number
  /** 源文档总字数 */
  sourceWordCount?: number
  createdAt: number
  updatedAt: number
}

/** 完整的文风指纹 — 含画像 / 指标 / 范文 / 行为规则 */
export interface WriterFingerprint extends WriterFingerprintMeta {
  /** L2 画像 */
  profile: WriterFingerprintProfile
  /** L1 量化指标 */
  metrics: WriterFingerprintMetrics
  /** L3 范文样本 */
  samples: WriterFingerprintSample[]
  /** L0 行为规则 (可选, 没配 L0 提取器时为 undefined) */
  behaviorRules?: FingerprintBehaviorRule[]
  /** 源文件路径 (如果是从文件提炼的) */
  sourcePaths?: string[]
  /** 提炼时的执行日志 (便于用户回溯) */
  distillLogs?: WriterFingerprintDistillLog[]
  /** 旧版单数字段名 (向后兼容, 等价于 distillLogs) */
  distillLog?: WriterFingerprintDistillLog[]
}

// ============================================================================
// StudyRoom — 意图 / 引用 / 镜头 / 篇幅复核 等补充类型
// ----------------------------------------------------------------------------
// 这些是被 intentDispatcher / citationParser / writingService 引用的结构,
// 单独列在文件末尾是因为它们跨多个子模块, 放在各自定义处会引起循环依赖.
// ============================================================================

// ---- 证据镜头 (LensKind) -------------------------------------------------

/**
 * 证据池的镜头分类.
 * - L: Library (本地权威知识库)
 * - W: WebSearch (联网检索)
 * - S: Skills (技能文档)
 * - M: Memory (长期记忆)
 * - E: Entity (实体, 历史版本兼容)
 */
export type LensKind = 'L' | 'W' | 'S' | 'M' | 'E'

// ---- 引用 / 脚注 (InlineCitation / Footnote) ------------------------------

/** 正文里出现的引用标记 (未解析前) */
export interface InlineCitation {
  /** 原始标记, 如 "[^L12]" */
  marker: string
  /** 对应的证据 id (可能是临时 label, 也可能是已解析的 EvidenceItem.id) */
  evidenceId: string
}

/** 正文脚注 (引用标记已映射到具体证据) */
export interface Footnote {
  /** 原始标记, 如 "[^L12]" */
  marker: string
  /** 对应的 EvidenceItem.id */
  evidenceId: string
  /** 展示用的 label, 如 "L12" */
  label: string
}

// ---- 篇幅复核度量 (SectionLengthMeasure) ---------------------------------

/** 一节的篇幅实测 vs. 目标对比, 由 writingService.measureSectionLengths 产出 */
export interface SectionLengthMeasure {
  sectionId: string
  heading: string
  targetLength: number
  actualLength: number
  /** 偏差 = (actual - target) / target, 正数为超, 负数为欠 */
  deviation: number
}

// ---- 意图 (WriterIntent / IntentCard) -------------------------------------

/**
 * WriterIntent — 用户消息在 intentDispatcher 里被解析出的结构化意图.
 * 是 11 种 kind 的判别联合 (discriminated union).
 */
export type WriterIntent =
  | { kind: 'draft_section'; sectionId: string; hint?: string }
  | { kind: 'rewrite_section'; sectionId: string; instruction: string }
  | { kind: 'revise_agenda'; instruction: string }
  | { kind: 'supplement_evidence'; query: string; lenses?: LensKind[] }
  | { kind: 'export_document' }
  | { kind: 'focus_section'; sectionId: string }
  | { kind: 'ask_question'; question: string }
  | { kind: 'skill_mention'; skillName: string; priority?: 'primary' | 'secondary' }
  | { kind: 'skill_remove'; skillName: string }
  | { kind: 'unknown'; raw?: string }

/**
 * IntentCard — dispatchIntent 的返回值, 是给 UI 二次确认 / 自动执行判定用的包装.
 */
export interface IntentCard {
  intent: WriterIntent
  /** 一句话描述本次操作范围 (UI 顶部展示) */
  scopeDescription: string
  /** 计划步骤列表 (用户可预览) */
  plannedActions: string[]
  /** 分类器置信度 (0-1), >= 0.85 可走信任模式自动执行 */
  confidence: number
}

// ============================================================================
// StudyRoom — Deliberation Pipeline (深度打磨管线)
// ----------------------------------------------------------------------------
// 显式触发的 "诊断 → 红队 → 洞察 → 策略 → 重写" 管线.
// 不自动跑, 用户点"深度打磨"时触发.
// MVP 阶段数据挂在 Zustand session 内存态, 不做文件持久化.
// ============================================================================

// ---- Phase 1: 诊断报告 ---------------------------------------------------

export interface DiagnosisLogicStep {
  step: string
  support: 'solid' | 'weak' | 'missing'
  note: string
}

export interface DiagnosisGap {
  location: string
  type: '跳跃' | '循环' | '偷换' | '过度绝对'
  why: string
}

export interface DiagnosisVulnerability {
  claim: string
  attack: string
  severity: 'high' | 'medium' | 'low'
}

export interface DiagnosisReport {
  thesis: string
  thesisClarity: 'clear' | 'vague' | 'missing'
  logicChain: DiagnosisLogicStep[]
  gaps: DiagnosisGap[]
  evidenceCoverage: { wellSupported: string[]; underSupported: string[] }
  vulnerabilities: DiagnosisVulnerability[]
  confidence: number
  /** Phase 1a 的自由文本, 用于追溯和 debug */
  rawThinking: string
  timestamp: number
}

// ---- Phase 2: 红队报告 ---------------------------------------------------

export type RedTeamPersona = 'expert' | 'adversary' | 'audience'

export interface RedTeamChallenge {
  id: string
  question: string
  whyLethal: string
  fromPersonas: RedTeamPersona[]
  severity: 'high' | 'medium' | 'low'
}

export interface RedTeamReport {
  challenges: RedTeamChallenge[]
  convergentPoints: string[]
  /** 三份 persona 原文 (追溯 + debug) */
  rawFeedback: { expert: string; adversary: string; audience: string }
  timestamp: number
}

// ---- Phase 3: 洞察候选 ---------------------------------------------------

export interface InsightCandidate {
  id: string
  insight: string
  whyItMatters: string
  whatChanges: { keep: string[]; rewrite: string[]; drop: string[] }
  risk: string
}

export interface InsightProposal {
  candidates: InsightCandidate[]
  /** AI 承认自己判断不了、必须由用户回答的问题 */
  alsoWorthAskingUser: string
}

// ---- Phase 4: 重写策略 ---------------------------------------------------

export interface RewriteStrategy {
  mode: 'incremental' | 'rebuild'
  rationale: string
  newThesis?: string
  preservedChunks: string[]
}

// ---- Deliberation 运行时状态 (挂在 session 内存态) -------------------------

export type DeliberationPhase =
  | 'idle'
  | 'diagnosing'
  | 'redteaming'
  | 'proposing_insights'
  | 'waiting_user'
  | 'deciding_strategy'
  | 'rebuilding'
  | 'done'

export interface DeliberationUserChoice {
  selectedIds: string[]
  customNote: string
}

export interface DeliberationState {
  phase: DeliberationPhase
  diagnosis?: DiagnosisReport
  redTeam?: RedTeamReport
  proposal?: InsightProposal
  userChoice?: DeliberationUserChoice
  strategy?: RewriteStrategy
  startedAt: number
  /** 如果管线出错, 记录错误信息 */
  error?: string
}
