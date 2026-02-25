/**
 * DD-OS Native Local AI Engine
 * 
 * 独立运行的本地 AI 引擎，包含：
 * - ReAct 循环执行器
 * - 任务规划器 (Planner)
 * - 工具调用能力
 * - 本地记忆持久化
 */

import { chat, streamChat, isLLMConfigured, embed, cosineSimilarity, convertToolInfoToFunctions } from './llmService'
import type { SimpleChatMessage, LLMStreamResult } from './llmService'
import type { ExecutionStatus, OpenClawSkill, MemoryEntry, ToolInfo, ExecTrace, ExecTraceToolCall, ApprovalRequest, ExecutionStep, NexusEntity, SubTask, TaskPlan, SubTaskStatus, TaskItem } from '@/types'
import { parseSoulMd, type ParsedSoul } from '@/utils/soulParser'
import { skillStatsService } from './skillStatsService'
import { immuneService } from './capsuleService'
import { evomapService } from './evomapService'

// ============================================
// 类型定义
// ============================================

interface ToolCall {
  name: string
  args: Record<string, unknown>
}

interface ToolResult {
  tool: string
  status: 'success' | 'error'
  result: string
  timestamp?: string
}

interface PlanStep {
  id: number
  description: string
  tool?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: string
}

interface AgentMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ============================================
// Nexus 性能统计类型
// ============================================

interface ToolUsageStat {
  calls: number
  errors: number
}

interface NexusStats {
  nexusId: string
  totalTasks: number
  successCount: number
  failureCount: number
  toolUsage: Record<string, ToolUsageStat>
  totalTurns: number        // 用于计算平均值
  totalDuration: number     // 用于计算平均值 (ms)
  topErrors: string[]       // 最近的错误模式（去重，最多5条）
  lastUpdated: number
}

type NexusStatsMap = Record<string, NexusStats>

// ============================================
// 自适应规则引擎类型
// ============================================

type RuleType =
  | 'TOOL_ERROR_RATE'
  | 'SUCCESS_RATE_DECLINE'
  | 'EFFICIENCY_DEGRADATION'
  | 'TOOL_SELECTION_HINT'
  | 'TASK_DECOMPOSITION'
  | 'ERROR_PATTERN_MEMORY'

interface NexusRule {
  id: string
  nexusId: string
  type: RuleType
  active: boolean
  injectedPrompt: string
  createdAt: number
  expiresAt: number
  cooldownUntil: number
  metadata: {
    toolName?: string
    triggerValue: number
    threshold: number
    samples: number
  }
}

interface NexusRulesStorage {
  version: string
  rules: Record<string, NexusRule[]>
  lastUpdated: number
}

const RULE_PRIORITY: Record<RuleType, number> = {
  'ERROR_PATTERN_MEMORY': 10,
  'SUCCESS_RATE_DECLINE': 9,
  'TOOL_ERROR_RATE': 8,
  'TASK_DECOMPOSITION': 7,
  'EFFICIENCY_DEGRADATION': 6,
  'TOOL_SELECTION_HINT': 5,
}

const RULE_LABELS: Record<RuleType, string> = {
  'TOOL_ERROR_RATE': '工具错误率预警',
  'SUCCESS_RATE_DECLINE': '成功率下降警报',
  'EFFICIENCY_DEGRADATION': '效率退化警告',
  'TOOL_SELECTION_HINT': '工具选择优化',
  'TASK_DECOMPOSITION': '任务分解建议',
  'ERROR_PATTERN_MEMORY': '错误模式记忆',
}

const RULE_CONFIG = {
  MIN_TASKS: 5,
  MAX_ACTIVE_RULES: 3,
  COOLDOWN_MS: 24 * 60 * 60 * 1000,  // 24 hours
  EXPIRY_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
}

/**
 * 任务完成度验证结果
 * 用于判断任务是否真正完成，而不仅仅是执行了工具
 */
interface TaskCompletionResult {
  /** 任务是否完成 */
  completed: boolean
  /** 完成度百分比 (0-100) */
  completionRate: number
  /** 用户看到的摘要 */
  summary: string
  /** 已完成的步骤 */
  completedSteps: string[]
  /** 未完成的步骤 */
  pendingSteps: string[]
  /** 失败原因 (如果有) */
  failureReason?: string
  /** 建议的下一步操作 */
  nextSteps?: string[]
}

interface StoreActions {
  setConnectionStatus: (status: string) => void
  setConnectionError: (error: string | null) => void
  setAgentStatus: (status: string) => void
  setCurrentTask: (id: string | null, description: string | null) => void
  addToast: (toast: { type: string; title: string; message?: string }) => void
  addSession: (session: any) => void
  updateSession: (key: string, updates: any) => void
  updateExecutionStatus: (id: string, updates: Partial<ExecutionStatus>) => void
  addLog: (log: any) => void
  addRunEvent: (event: any) => void
  // Native 模式需要的 loading 状态控制
  setSessionsLoading: (loading: boolean) => void
  setChannelsLoading: (loading: boolean) => void
  setDevicesLoading: (loading: boolean) => void
  // 数据注入 (Soul/Skills/Memories)
  setSoulFromParsed: (parsed: ParsedSoul, agentIdentity: any) => void
  setOpenClawSkills: (skills: OpenClawSkill[]) => void
  setMemories: (memories: MemoryEntry[]) => void
  // Native 模式: 实时执行任务管理
  addActiveExecution: (task: any) => void
  updateActiveExecution: (id: string, updates: any) => void
  removeActiveExecution: (id: string) => void
  // P3: 危险操作审批
  requestApproval: (req: Omit<ApprovalRequest, 'id' | 'timestamp'>) => Promise<boolean>
  // P4: Nexus 数据注入
  setNexusesFromServer: (nexuses: Array<Partial<NexusEntity> & { id: string }>) => void
  activeNexusId?: string | null
  setActiveNexus?: (id: string | null) => void
  updateNexusXP?: (id: string, xp: number) => void
}

// ============================================
// 配置
// ============================================

// 检测运行环境
const isDevMode = import.meta.env?.DEV ?? false
const isTauriMode = typeof window !== 'undefined' && '__TAURI__' in window

const CONFIG = {
  // 开发模式使用 localhost:3001，生产模式使用相对路径（Python 托管）
  LOCAL_SERVER_URL: isDevMode ? 'http://localhost:3001' : (isTauriMode ? 'http://127.0.0.1:3001' : ''),
  MAX_REACT_TURNS: 100,    // 重型任务：实际上不限制
  DEFAULT_TURNS: 30,       // 普通任务：30轮
  SIMPLE_TURNS: 5,         // 简单任务：5轮
  MAX_PLAN_STEPS: 12,
  TOOL_TIMEOUT: 60000,
  // 任务升级机制配置
  ESCALATION: {
    ENABLED: true,                    // 是否启用升级机制
    EXTRA_TURNS: 20,                  // 每次升级增加的轮次
    MAX_ESCALATIONS: 3,               // 最大升级次数
    MIN_COMPLETION_FOR_SKIP: 80,      // 完成度达到此值则不升级
  },
  // Reflexion 机制配置
  CRITIC_TOOLS: ['writeFile', 'runCmd', 'appendFile'], // 修改类工具需要 Critic 验证
  HIGH_RISK_TOOLS: ['runCmd'], // 高风险工具需要执行前检查
  // P3: 危险命令模式 (触发用户审批)
  DANGER_PATTERNS: [
    { pattern: 'rm -rf', level: 'critical' as const, reason: '递归强制删除' },
    { pattern: 'del /f', level: 'critical' as const, reason: '强制删除文件' },
    { pattern: 'format', level: 'critical' as const, reason: '格式化磁盘' },
    { pattern: 'mkfs', level: 'critical' as const, reason: '创建文件系统' },
    { pattern: 'dd if=/dev', level: 'critical' as const, reason: '低级磁盘写入' },
    { pattern: 'shutdown', level: 'high' as const, reason: '关机操作' },
    { pattern: 'reboot', level: 'high' as const, reason: '重启操作' },
    { pattern: 'reg delete', level: 'high' as const, reason: '删除注册表' },
    { pattern: 'taskkill /f', level: 'high' as const, reason: '强制终止进程' },
    { pattern: 'net stop', level: 'high' as const, reason: '停止系统服务' },
    { pattern: 'chmod 777', level: 'high' as const, reason: '开放所有权限' },
  ],
}

// ============================================
// JIT 上下文注入配置
// ============================================

/**
 * 技能关键词映射表 (P1: 动态填充，不再硬编码)
 * 启动时从 /skills 返回的 manifest.keywords 自动构建
 * 保留少量默认映射作为 fallback
 */
const DEFAULT_SKILL_TRIGGERS: Record<string, { keywords: string[]; path: string }> = {
  'web-search': {
    keywords: ['搜索', '查找', '查询', '查一下', '帮我找', 'search', 'find', 'look up'],
    path: 'skills/web-search/SKILL.md',
  },
  'weather': {
    keywords: ['天气', '气温', '下雨', '晴天', 'weather', 'temperature'],
    path: 'skills/weather/SKILL.md',
  },
  'file-ops': {
    keywords: ['文件', '读取', '写入', '保存', '创建', '删除', 'file', 'read', 'write', 'save'],
    path: 'skills/file-operations/SKILL.md',
  },
  'code': {
    keywords: ['代码', '编程', '运行', '执行', '脚本', 'code', 'run', 'execute', 'script'],
    path: 'skills/code-runner/SKILL.md',
  },
  'dd-os-data': {
    keywords: ['状态', 'soul', '技能列表', '记忆', 'status', 'skills', 'memory'],
    path: 'skills/dd-os-data/SKILL.md',
  },
  'skill-generator': {
    keywords: ['创建技能', '新技能', '生成技能', '添加技能', '技能生成', 
               'create skill', 'new skill', 'generate skill', 'add skill', '自定义技能'],
    path: 'skills/skill-generator/SKILL.md',
  },
  'skill-scout': {
    keywords: ['发现技能', '推荐技能', '安装技能', '加载技能', '下载技能', '热门技能', 
               '技能市场', '技能商店', '升级能力', '技能发现', 'install skill', 'discover skill',
               'recommend skill', 'skill store', 'skill market', 'OpenClaw', '社区技能'],
    path: 'skills/skill-scout/SKILL.md',
  },
}

// ============================================
// 系统提示词模板
// ============================================

const SYSTEM_PROMPT_TEMPLATE = `你是 DD-OS，一个运行在用户本地电脑上的 AI 操作系统。

## 响应策略（重要！）

### 直接回答（不调用工具）
- 简单问答、解释概念、闲聊
- 确认类：好的、明白、谢谢
- 建议类：推荐、比较、选择

### 调用工具
- 获取实时信息（天气、搜索）
- 操作文件（读写、查看目录）
- 执行命令（运行程序）

## 可用工具
{available_tools}

### 记忆管理
- saveMemory: 保存重要信息到长期记忆
- searchMemory: 检索历史记忆

## 意图理解
**常见映射**:
- "有哪些技能/SKILL" → listDir 查看 skills/ 目录
- "搜索 X" → 本地用 readFile/listDir，网络用 webSearch

**禁止**:
- 不要把 SKILL、Agent、DD-OS 当命令执行
- runCmd 只用于真正的 Shell 命令

## 输出格式
当需要使用工具时：
\`\`\`json
{
  "thought": "分析用户需求...",
  "tool": "工具名",
  "args": {"参数名": "参数值"}
}
\`\`\`

当不需要工具时：直接输出纯文本。

## 规则
1. 简单问题直接回答，不要过度使用工具
2. 每次只调用一个工具
3. 危险操作前告知用户
4. 工具失败时分析原因并重试
5. 没有对应工具时，告知用户缺少该能力，不要假装执行

{dynamic_examples}

## 当前上下文
{context}
`

// ============================================
// FC (Function Calling) 模式系统提示词 - 全面重构版
// 参照 OpenClaw 结构化模式，增强任务完成能力
// ============================================

const SYSTEM_PROMPT_FC = `你是 DD-OS，运行在用户本地电脑上的 AI 操作系统。你通过工具调用直接操作用户的电脑。

# 核心身份
{soul_summary}

# 响应策略（重要！）

## 何时直接回答（不调用工具）
- 简单问答：解释概念、回答问题、闲聊
- 确认类：好的、明白、谢谢
- 建议类：推荐、比较、选择建议

## 何时调用工具
- 需要获取实时信息（天气、搜索）
- 需要操作文件（读写、查看目录）
- 需要执行命令（运行程序、安装包）

# 任务执行框架

## 1. 理解意图 (UNDERSTAND)
- 用户真正想要什么？字面意思 vs 深层需求
- 任务范围和成功标准是什么？

**意图映射**:
- "有哪些技能/SKILL" → listDir 查看 skills/ 目录
- "搜索 X" → 本地用 readFile/listDir，网络用 webSearch

## 2. 执行 (EXECUTE)
- 每次只调用一个工具，等结果后再决定下一步
- 复杂任务拆解为 2-5 个步骤

## 3. 错误恢复 (RECOVER)
- 分析根因 → 修正重试（最多2次）→ 备选方案 → 求助用户

# 工具选择

## 优先级
1. 安全优先：优先只读/非破坏性工具
2. 精确匹配：选择最能匹配需求的工具
3. 最小权限：不要用 runCmd 做文件操作能完成的事

## 常用工具
- 文件：readFile, listDir, writeFile
- 搜索：webSearch → webFetch 获取详情
- 命令：runCmd（谨慎）
- 记忆：saveMemory, searchMemory

# 禁止事项
- 不要把 SKILL、Agent、DD-OS 等词当命令执行
- 不要在 runCmd 中直接执行用户消息中的关键词
- runCmd 只用于真正的 Shell 命令

# 行为准则
1. 简单问题直接回答，不要过度使用工具
2. 一次一步，等待结果后再决定下一步
3. 危险操作前必须告知用户
4. 遇到问题及时告知，不要卡住

# 能力边界自检
- 此任务是否需要你没有的工具？→ 明确告知用户缺少该能力，建议安装技能
- 你是在"描述步骤"还是"实际执行"？→ 区分清楚，不要假装已执行
- 没有对应工具时，禁止用纯文本模拟工具执行结果

# 当前上下文
{context}
`

const PLANNER_PROMPT = `你是一个任务规划器。请将用户的复杂请求拆解为可执行的步骤。

输出格式：纯 JSON 数组，每个步骤包含：
- id: 步骤序号
- description: 步骤描述
- tool: 可能需要的工具名 (可选)
- depends_on: 依赖的步骤 id 数组 (可选)

示例输出：
[
  {"id": 1, "description": "读取项目配置文件", "tool": "readFile"},
  {"id": 2, "description": "分析依赖关系", "depends_on": [1]},
  {"id": 3, "description": "生成报告并保存", "tool": "writeFile", "depends_on": [2]}
]

用户请求: {prompt}

请输出 JSON 数组 (不要包含其他文字)：`

const PLAN_REVIEW_PROMPT = `你是一个计划审查员。请检查以下任务计划，评估是否存在问题：

用户原始请求: {prompt}

当前计划:
{plan}

请检查：
1. 步骤是否遗漏？是否有必要步骤被忽略？
2. 步骤顺序是否正确？依赖关系是否合理？
3. 是否有可以合并或省略的冗余步骤？
4. 每个步骤使用的工具是否正确？

如果计划没有问题，原样输出 JSON 数组。
如果有改进，输出优化后的 JSON 数组。
只输出 JSON 数组，不要包含其他文字。`

/**
 * 任务完成度验证提示词
 * 用于评估任务执行是否真正满足用户意图
 */
const TASK_COMPLETION_PROMPT = `你是任务完成度评估器。请分析以下任务执行情况，判断用户的原始意图是否被满足。

**用户原始请求:**
{user_prompt}

**执行记录:**
{execution_log}

**工具调用统计:**
- 总调用次数: {tool_count}
- 成功次数: {success_count}
- 失败次数: {fail_count}
{nexus_metrics_section}
请严格按照以下标准评估：

**意图完成判断规则:**
1. "搜索/查找 X" → 成功标准: 找到并展示了相关信息
2. "安装/加载/下载技能" → 成功标准: 技能文件已保存到 skills/ 目录并验证存在
3. "创建/编写文件" → 成功标准: 文件已创建并内容正确
4. "执行命令" → 成功标准: 命令执行成功且返回预期结果
5. "分析/解释 X" → 成功标准: 给出了有意义的分析结论

**输出格式 (仅输出 JSON):**
{
  "completed": true/false,
  "completionRate": 0-100,
  "summary": "一句话描述完成情况",
  "completedSteps": ["已完成的步骤1", "已完成的步骤2"],
  "pendingSteps": ["未完成的步骤1"],
  "failureReason": "如果未完成，说明原因",
  "nextSteps": ["建议的下一步操作"],
  "metricsStatus": ["metric1: true/false", "metric2: true/false"]
}

重要: 仅输出 JSON，不要包含任何其他文字。`

// ============================================
// Quest 风格任务规划提示词
// ============================================

/**
 * Quest 风格任务分解器提示词
 * 将复杂任务分解为有依赖关系的子任务 DAG
 */
const QUEST_PLANNER_PROMPT = `你是 Quest 任务规划器。请将用户的复杂请求拆解为有依赖关系的子任务。

## 规则
1. 子任务数量：3-10 个（根据任务复杂度调整）
2. 每个子任务应该是原子性的（单一工具调用或简单推理）
3. 用 dependsOn 标记依赖关系：
   - 空数组 [] = 无依赖，可与其他无依赖任务并行执行
   - ["t1"] = 依赖 t1 完成后才能执行
   - ["t1", "t2"] = 需要 t1 和 t2 都完成后才能执行
4. 高风险操作必须标记 approvalRequired: true，包括：
   - 写文件、删除文件
   - 发送消息、邮件
   - API 调用、付费操作
   - 系统命令执行

## 可用工具参考
- webSearch: 网络搜索
- webFetch: 获取网页内容
- readFile: 读取文件
- writeFile: 写入文件（需确认）
- listDir: 列出目录
- runCmd: 执行命令（需确认）
- saveMemory: 保存记忆
- searchMemory: 搜索记忆

## 输出格式（纯 JSON）
{
  "title": "任务标题（简洁描述）",
  "subTasks": [
    {
      "id": "t1",
      "description": "搜索相关资料",
      "toolHint": "webSearch",
      "dependsOn": [],
      "approvalRequired": false
    },
    {
      "id": "t2",
      "description": "分析搜索结果",
      "dependsOn": ["t1"],
      "approvalRequired": false
    },
    {
      "id": "t3",
      "description": "生成报告并保存",
      "toolHint": "writeFile",
      "dependsOn": ["t2"],
      "approvalRequired": true,
      "approvalReason": "将创建新文件"
    }
  ]
}

## 用户请求
{prompt}

## Nexus 上下文（如有）
{nexus_context}

请输出 JSON（不要包含其他文字）：`

// ============================================
// LocalClawService 主类
// ============================================

// ============================================
// P4: 技能嵌入索引
// ============================================

interface SkillVectorEntry {
  skillName: string
  skillPath: string
  description: string
  keywords: string[]
  vector: number[]
}

/**
 * 技能嵌入索引 - 支持语义检索
 * 在启动时为所有技能生成向量，查询时进行语义相似度匹配
 */
class SkillEmbeddingIndex {
  private index: Map<string, SkillVectorEntry> = new Map()
  private indexBuilt = false
  private buildingPromise: Promise<void> | null = null

  /**
   * 构建技能索引 (异步，仅执行一次)
   */
  async buildIndex(skills: OpenClawSkill[]): Promise<void> {
    if (this.buildingPromise) {
      return this.buildingPromise
    }

    if (this.indexBuilt && this.index.size > 0) {
      return
    }

    this.buildingPromise = this._doBuildIndex(skills)
    await this.buildingPromise
    this.buildingPromise = null
  }

  private async _doBuildIndex(skills: OpenClawSkill[]): Promise<void> {
    // 尝试从缓存加载
    const cached = this.loadFromCache()
    const skillChecksum = this.computeChecksum(skills)

    if (cached && cached.checksum === skillChecksum) {
      this.index = new Map(Object.entries(cached.entries))
      this.indexBuilt = true
      console.log(`[SkillIndex] Loaded ${this.index.size} skill vectors from cache`)
      return
    }

    // 重新构建索引
    console.log(`[SkillIndex] Building embedding index for ${skills.length} skills...`)
    const startTime = Date.now()

    for (const skill of skills) {
      const skillPath = `skills/${skill.name}/SKILL.md`
      // 构建嵌入文本：描述 + 关键词
      const text = [
        skill.description || skill.name,
        ...(skill.keywords || []),
      ].join(' ')

      const vector = await embed(text)

      if (vector.length > 0) {
        this.index.set(skill.name, {
          skillName: skill.name,
          skillPath,
          description: skill.description || '',
          keywords: skill.keywords || [],
          vector,
        })
      }
    }

    this.indexBuilt = true
    console.log(`[SkillIndex] Built index with ${this.index.size} vectors in ${Date.now() - startTime}ms`)

    // 缓存到 localStorage
    this.saveToCache(skillChecksum)
  }

  /**
   * 语义搜索：返回 top-K 相似技能
   */
  async search(query: string, topK = 3): Promise<string[]> {
    if (!this.indexBuilt || this.index.size === 0) {
      return []
    }

    const queryVector = await embed(query)
    if (queryVector.length === 0) {
      return [] // embedding 失败，fallback 到关键词匹配
    }

    // 计算相似度并排序
    const scored: { path: string; score: number }[] = []

    for (const entry of this.index.values()) {
      const score = cosineSimilarity(queryVector, entry.vector)
      if (score > 0.3) { // 相似度阈值
        scored.push({ path: entry.skillPath, score })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    const results = scored.slice(0, topK).map(s => s.path)

    if (results.length > 0) {
      console.log(`[SkillIndex] Semantic match: ${results.join(', ')}`)
    }

    return results
  }

  private computeChecksum(skills: OpenClawSkill[]): string {
    const data = skills.map(s => `${s.name}:${s.description}:${(s.keywords || []).join(',')}`).join('|')
    // 简单的哈希
    let hash = 0
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return `v1-${hash.toString(36)}`
  }

  private loadFromCache(): { checksum: string; entries: Record<string, SkillVectorEntry> } | null {
    try {
      const cached = localStorage.getItem('ddos_skill_vectors')
      if (cached) {
        return JSON.parse(cached)
      }
    } catch (e) {
      console.warn('[SkillIndex] Failed to load cache:', e)
    }
    return null
  }

  private saveToCache(checksum: string): void {
    try {
      const entries: Record<string, SkillVectorEntry> = {}
      for (const [key, value] of this.index.entries()) {
        entries[key] = value
      }
      localStorage.setItem('ddos_skill_vectors', JSON.stringify({ checksum, entries }))
    } catch (e) {
      console.warn('[SkillIndex] Failed to save cache:', e)
    }
  }

  /** 检查索引是否就绪 */
  isReady(): boolean {
    return this.indexBuilt && this.index.size > 0
  }
}

class LocalClawService {
  private storeActions: StoreActions | null = null
  private serverUrl = CONFIG.LOCAL_SERVER_URL
  private soulContent: string = ''

  // P0: 动态工具列表 (从 /tools 端点获取)
  private availableTools: ToolInfo[] = []

  // P1: 动态技能触发器 (从 /skills manifest.keywords 构建)
  private skillTriggers: Record<string, { keywords: string[]; path: string }> = { ...DEFAULT_SKILL_TRIGGERS }

  // P4: 技能嵌入索引 (语义检索)
  private skillEmbeddingIndex = new SkillEmbeddingIndex()

  // 追踪执行过程中创建的文件 (用于在聊天中显示文件卡片)
  private _lastCreatedFiles: { filePath: string; fileName: string; message: string; fileSize?: number }[] = []
  get lastCreatedFiles() { return this._lastCreatedFiles }

  // JIT 缓存 - 避免重复读取
  private contextCache: Map<string, { content: string; timestamp: number }> = new Map()
  private readonly CACHE_TTL = 60000 // 1分钟缓存有效期

  // P5: 指代消解 - 跟踪最近操作的实体 (用于解决 "这个"、"那个" 等代词)
  private recentEntities: {
    files: string[]        // 最近操作的文件路径
    commands: string[]     // 最近执行的命令
    queries: string[]      // 最近的搜索查询
    lastToolName: string | null  // 最后调用的工具名
    timestamp: number      // 最后更新时间
  } = {
    files: [],
    commands: [],
    queries: [],
    lastToolName: null,
    timestamp: 0,
  }

  // 能力缺失记忆：记录因缺少工具导致的失败
  private capabilityGapHistory: Array<{ label: string; task: string; timestamp: number }> = []

  /**
   * 检测工具错误是否属于能力缺失，并记录到记忆
   */
  private detectAndRecordCapabilityGap(toolName: string, errorMsg: string, taskHint: string): void {
    // 能力缺失特征词
    const gapPatterns = [
      /unknown tool/i, /tool not found/i, /不支持/,
      /no such tool/i, /未找到工具/, /not available/i,
      /没有.*能力/, /无法.*执行/, /unsupported/i,
    ]
    const isGap = gapPatterns.some(p => p.test(errorMsg))
    if (!isGap) return

    const entry = {
      label: toolName,
      task: taskHint.slice(0, 80),
      timestamp: Date.now(),
    }

    // 去重：同一工具 24 小时内只记一次
    const exists = this.capabilityGapHistory.some(
      g => g.label === toolName && Date.now() - g.timestamp < 86400000
    )
    if (exists) return

    this.capabilityGapHistory.push(entry)

    // 持久化到记忆文件
    const logLine = `[${new Date().toISOString().split('T')[0]}] 缺失能力: ${toolName} | 场景: ${entry.task}\n`
    this.executeTool({
      name: 'appendFile',
      args: { path: 'memory/capability_gaps.md', content: logLine },
    }).catch(() => {})

    console.log(`[LocalClaw] Capability gap detected: ${toolName}`)
  }

  /**
   * 启动时加载历史能力缺失记忆
   */
  private async loadCapabilityGapHistory(): Promise<void> {
    try {
      const result = await this.executeTool({
        name: 'readFile',
        args: { path: 'memory/capability_gaps.md' },
      })
      if (result.status === 'success' && result.result) {
        const lines = result.result.split('\n').filter((l: string) => l.includes('缺失能力:'))
        this.capabilityGapHistory = lines.slice(-10).map((line: string) => {
          const labelMatch = line.match(/缺失能力:\s*(\S+)/)
          const taskMatch = line.match(/场景:\s*(.+)$/)
          return {
            label: labelMatch?.[1] || 'unknown',
            task: taskMatch?.[1] || '',
            timestamp: Date.now(),
          }
        })
      }
    } catch {
      // 文件不存在，忽略
    }
  }

  // ============================================
  // 📊 Nexus 性能统计系统
  // ============================================

  /** 内存中的统计缓存 */
  private nexusStatsCache: NexusStatsMap = {}

  /**
   * 启动时加载已有的统计数据
   */
  private async loadNexusStats(): Promise<void> {
    try {
      const result = await this.executeTool({
        name: 'readFile',
        args: { path: 'memory/nexus_stats.json' },
      })
      if (result.status === 'success' && result.result) {
        this.nexusStatsCache = JSON.parse(result.result)
        console.log(`[LocalClaw] Loaded nexus stats for ${Object.keys(this.nexusStatsCache).length} nexuses`)
      }
    } catch {
      // 文件不存在，从空开始
    }
  }

  /**
   * 持久化统计数据到文件
   */
  private async saveNexusStats(): Promise<void> {
    try {
      await this.executeTool({
        name: 'writeFile',
        args: {
          path: 'memory/nexus_stats.json',
          content: JSON.stringify(this.nexusStatsCache, null, 2),
        },
      })
    } catch (err) {
      console.warn('[LocalClaw] Failed to save nexus stats:', err)
    }
  }

  /**
   * 任务完成后记录统计数据
   * 从 ExecTrace 中提取关键指标，累加到对应 Nexus 的统计中
   */
  recordNexusPerformance(trace: ExecTrace): void {
    const nexusId = trace.activeNexusId || '_global'

    // 获取或初始化
    if (!this.nexusStatsCache[nexusId]) {
      this.nexusStatsCache[nexusId] = {
        nexusId,
        totalTasks: 0,
        successCount: 0,
        failureCount: 0,
        toolUsage: {},
        totalTurns: 0,
        totalDuration: 0,
        topErrors: [],
        lastUpdated: Date.now(),
      }
    }

    const stats = this.nexusStatsCache[nexusId]
    stats.totalTasks++
    stats.totalTurns += trace.turnCount || 0
    stats.totalDuration += trace.duration || 0
    stats.lastUpdated = Date.now()

    if (trace.success) {
      stats.successCount++
    } else {
      stats.failureCount++
    }

    // 统计每个工具的调用和错误
    for (const tool of trace.tools) {
      if (!stats.toolUsage[tool.name]) {
        stats.toolUsage[tool.name] = { calls: 0, errors: 0 }
      }
      stats.toolUsage[tool.name].calls++
      if (tool.status === 'error') {
        stats.toolUsage[tool.name].errors++

        // 记录错误模式（去重，保留最近5条）
        const errSnippet = (tool.result || '').slice(0, 60)
        if (errSnippet && !stats.topErrors.includes(errSnippet)) {
          stats.topErrors.push(errSnippet)
          if (stats.topErrors.length > 5) stats.topErrors.shift()
        }
      }
    }

    // 异步持久化（不阻塞）
    this.saveNexusStats().catch(() => {})

    // 🤖 触发规则引擎评估
    this.evaluateAndActivateRules(nexusId)
  }

  /**
   * 生成 Nexus 性能洞察文本
   * 纯代码逻辑，不调用 LLM，直接从统计数据计算
   */
  buildNexusInsight(nexusId?: string | null): string {
    const id = nexusId || '_global'
    const stats = this.nexusStatsCache[id]
    if (!stats || stats.totalTasks < 2) return ''  // 数据不足，不注入

    const successRate = Math.round((stats.successCount / stats.totalTasks) * 100)
    const avgTurns = Math.round(stats.totalTurns / stats.totalTasks)
    const avgDuration = Math.round(stats.totalDuration / stats.totalTasks / 1000)  // 秒

    const lines: string[] = [`## 📊 历史表现 (${stats.totalTasks}次任务)`]

    // 成功率
    if (successRate >= 80) {
      lines.push(`成功率: ${successRate}% — 表现稳定`)
    } else if (successRate >= 50) {
      lines.push(`成功率: ${successRate}% — 有改进空间，注意失败模式`)
    } else {
      lines.push(`成功率: ${successRate}% — 失败率偏高，执行前仔细规划`)
    }

    // 效率
    lines.push(`平均轮次: ${avgTurns} | 平均耗时: ${avgDuration}s`)

    // 最常用工具 Top 3
    const sortedTools = Object.entries(stats.toolUsage)
      .sort((a, b) => b[1].calls - a[1].calls)
      .slice(0, 3)
    if (sortedTools.length > 0) {
      const toolHints = sortedTools.map(([name, u]) => {
        const errRate = u.calls > 0 ? Math.round((u.errors / u.calls) * 100) : 0
        return errRate > 30
          ? `${name}(${u.calls}次, ⚠️错误率${errRate}%)`
          : `${name}(${u.calls}次)`
      })
      lines.push(`常用工具: ${toolHints.join(', ')}`)
    }

    // 高错误率工具预警
    const riskyTools = Object.entries(stats.toolUsage)
      .filter(([, u]) => u.calls >= 3 && (u.errors / u.calls) > 0.4)
      .map(([name]) => name)
    if (riskyTools.length > 0) {
      lines.push(`⚠️ 高风险工具: ${riskyTools.join(', ')} — 使用前确认参数正确`)
    }

    // 策略建议
    if (successRate < 60 && avgTurns > 15) {
      lines.push(`建议: 失败率高且轮次多，优先拆分为更小的子任务`)
    } else if (avgTurns > 20) {
      lines.push(`建议: 平均轮次偏高，考虑更精确的工具选择`)
    }

    return lines.join('\n') + '\n'
  }

  // ============================================
  // 🤖 自适应规则引擎
  // ============================================

  private nexusRulesCache: NexusRulesStorage = { version: '1.0', rules: {}, lastUpdated: 0 }

  private async loadNexusRules(): Promise<void> {
    try {
      const result = await this.executeTool({
        name: 'readFile',
        args: { path: 'memory/nexus_rules.json' },
      })
      if (result.status === 'success' && result.result) {
        this.nexusRulesCache = JSON.parse(result.result)
        // 启动时清理过期规则
        const now = Date.now()
        for (const nexusId of Object.keys(this.nexusRulesCache.rules)) {
          this.nexusRulesCache.rules[nexusId] = this.nexusRulesCache.rules[nexusId]
            .filter(r => r.expiresAt > now)
        }
        console.log(`[RuleEngine] Loaded rules for ${Object.keys(this.nexusRulesCache.rules).length} nexuses`)
      }
    } catch {
      // 文件不存在，从空开始
    }
  }

  private async saveNexusRules(): Promise<void> {
    this.nexusRulesCache.lastUpdated = Date.now()
    try {
      await this.executeTool({
        name: 'writeFile',
        args: {
          path: 'memory/nexus_rules.json',
          content: JSON.stringify(this.nexusRulesCache, null, 2),
        },
      })
    } catch (err) {
      console.warn('[RuleEngine] Failed to save rules:', err)
    }
  }

  /**
   * 获取 Nexus 的活跃规则（已过期的自动过滤）
   */
  getActiveRulesForNexus(nexusId: string | null): NexusRule[] {
    if (!nexusId) return []
    const rules = this.nexusRulesCache.rules[nexusId] || []
    const now = Date.now()
    return rules.filter(r => r.active && r.expiresAt > now)
  }

  /**
   * 核心：评估统计数据，激活/创建规则
   * 在 recordNexusPerformance 之后调用，纯 if/else 逻辑
   */
  private evaluateAndActivateRules(nexusId: string): void {
    const stats = this.nexusStatsCache[nexusId]
    if (!stats || stats.totalTasks < RULE_CONFIG.MIN_TASKS) return

    const existing = this.nexusRulesCache.rules[nexusId] || []
    const now = Date.now()

    // 清理过期规则
    this.nexusRulesCache.rules[nexusId] = existing.filter(r => r.expiresAt > now)
    const activeCount = this.getActiveRulesForNexus(nexusId).length

    const candidates: NexusRule[] = []

    // --- 规则 1: 工具错误率预警 ---
    for (const [toolName, usage] of Object.entries(stats.toolUsage)) {
      if (usage.calls >= 5) {
        const errorRate = Math.round((usage.errors / usage.calls) * 100)
        if (errorRate > 40 && !this.hasActiveRule(nexusId, 'TOOL_ERROR_RATE', toolName)) {
          candidates.push(this.createRule(nexusId, 'TOOL_ERROR_RATE',
            `工具 ${toolName} 历史错误率 ${errorRate}%。调用前务必验证参数格式和路径，如有疑问先用 readFile 确认。`,
            { toolName, triggerValue: errorRate, threshold: 40, samples: usage.calls }
          ))
        }
      }
    }

    // --- 规则 2: 成功率下降 ---
    if (stats.totalTasks >= 10) {
      const successRate = Math.round((stats.successCount / stats.totalTasks) * 100)
      if (successRate < 50 && !this.hasActiveRule(nexusId, 'SUCCESS_RATE_DECLINE')) {
        candidates.push(this.createRule(nexusId, 'SUCCESS_RATE_DECLINE',
          `当前成功率 ${successRate}%，低于健康水平。执行前制定详细计划，拆分为 3-5 个子步骤，每步验证后再继续。`,
          { triggerValue: successRate, threshold: 50, samples: stats.totalTasks }
        ))
      }
    }

    // --- 规则 3: 效率退化 ---
    const avgTurns = Math.round(stats.totalTurns / stats.totalTasks)
    if (avgTurns > 20 && !this.hasActiveRule(nexusId, 'EFFICIENCY_DEGRADATION')) {
      candidates.push(this.createRule(nexusId, 'EFFICIENCY_DEGRADATION',
        `平均执行轮次 ${avgTurns}，效率偏低。优先使用直接相关的工具，避免试错式调用，参考历史成功案例的工具序列。`,
        { triggerValue: avgTurns, threshold: 20, samples: stats.totalTasks }
      ))
    }

    // --- 规则 4: 正向工具推荐 ---
    for (const [toolName, usage] of Object.entries(stats.toolUsage)) {
      if (usage.calls >= 5) {
        const successRate = Math.round(((usage.calls - usage.errors) / usage.calls) * 100)
        if (successRate > 80 && !this.hasActiveRule(nexusId, 'TOOL_SELECTION_HINT', toolName)) {
          candidates.push(this.createRule(nexusId, 'TOOL_SELECTION_HINT',
            `工具 ${toolName} 历史表现优秀（成功率 ${successRate}%），遇到相关任务时优先考虑。`,
            { toolName, triggerValue: successRate, threshold: 80, samples: usage.calls }
          ))
        }
      }
    }

    // --- 规则 5: 任务分解 ---
    if (stats.failureCount >= 5) {
      const failRate = Math.round((stats.failureCount / stats.totalTasks) * 100)
      if (failRate > 60 && avgTurns > 15 && !this.hasActiveRule(nexusId, 'TASK_DECOMPOSITION')) {
        candidates.push(this.createRule(nexusId, 'TASK_DECOMPOSITION',
          `复杂任务失败率 ${failRate}%。接到任务时先输出 3-5 步执行计划，每步完成后检查结果再继续。`,
          { triggerValue: failRate, threshold: 60, samples: stats.totalTasks }
        ))
      }
    }

    // --- 规则 6: 错误模式记忆 ---
    const errorCounts = new Map<string, number>()
    for (const err of stats.topErrors) {
      const key = err.slice(0, 40)
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1)
    }
    for (const [pattern, count] of errorCounts) {
      if (count >= 3 && !this.hasActiveRule(nexusId, 'ERROR_PATTERN_MEMORY', pattern)) {
        candidates.push(this.createRule(nexusId, 'ERROR_PATTERN_MEMORY',
          `历史错误模式: "${pattern}"（出现${count}次）。遇到类似错误时停止重试，寻求用户确认或换用备选方案。`,
          { toolName: pattern, triggerValue: count, threshold: 3, samples: stats.totalTasks }
        ))
      }
    }

    // 按优先级排序，取可激活的
    const sorted = candidates
      .filter(r => !this.isInCooldown(nexusId, r.type, r.metadata.toolName))
      .sort((a, b) => RULE_PRIORITY[b.type] - RULE_PRIORITY[a.type])

    const maxNew = Math.max(0, RULE_CONFIG.MAX_ACTIVE_RULES - activeCount)
    const toActivate = sorted.slice(0, maxNew)

    if (toActivate.length === 0) return

    // 激活规则
    if (!this.nexusRulesCache.rules[nexusId]) {
      this.nexusRulesCache.rules[nexusId] = []
    }

    for (const rule of toActivate) {
      this.nexusRulesCache.rules[nexusId].push(rule)
      console.log(`[RuleEngine] Activated: ${RULE_LABELS[rule.type]} for ${nexusId}`)

      // Toast 通知
      this.storeActions?.addToast({
        type: 'info',
        title: `规则引擎: ${RULE_LABELS[rule.type]}`,
        message: rule.injectedPrompt.slice(0, 80),
      })
    }

    // 异步保存
    this.saveNexusRules().catch(() => {})
  }

  private createRule(
    nexusId: string,
    type: RuleType,
    prompt: string,
    metadata: NexusRule['metadata']
  ): NexusRule {
    const now = Date.now()
    return {
      id: `rule-${now}-${Math.random().toString(36).slice(2, 6)}`,
      nexusId,
      type,
      active: true,
      injectedPrompt: prompt,
      createdAt: now,
      expiresAt: now + RULE_CONFIG.EXPIRY_MS,
      cooldownUntil: now + RULE_CONFIG.COOLDOWN_MS,
      metadata,
    }
  }

  private hasActiveRule(nexusId: string, type: RuleType, toolName?: string): boolean {
    const rules = this.getActiveRulesForNexus(nexusId)
    return rules.some(r =>
      r.type === type && (!toolName || r.metadata.toolName === toolName)
    )
  }

  private isInCooldown(nexusId: string, type: RuleType, toolName?: string): boolean {
    const all = this.nexusRulesCache.rules[nexusId] || []
    const now = Date.now()
    return all.some(r =>
      r.type === type &&
      (!toolName || r.metadata.toolName === toolName) &&
      r.cooldownUntil > now
    )
  }

  /**
   * 注入 Store Actions
   */
  injectStore(actions: StoreActions) {
    this.storeActions = actions
  }

  /**
   * 任务复杂度分类 - 判断是否需要走 Quest 流程
   * 参考 Qoder 的分类逻辑：
   * - 简单任务：问答、解释、确认、闲聊 → 直接 LLM 响应
   * - 复杂任务：需要工具执行、多步骤操作 → Quest ReAct 循环
   */
  classifyTaskComplexity(prompt: string): 'simple' | 'complex' {
    const lowerPrompt = prompt.toLowerCase()
    
    // 简单任务关键词（问答/解释/确认类）
    const simplePatterns = [
      /^(你好|hi|hello|hey|嗨)/,
      /^(谢谢|感谢|thanks|thank you)/,
      /^(好的|ok|okay|明白|了解|知道了)/,
      /(是什么|什么是|解释一下|介绍一下|告诉我|请问)/,
      /(为什么|怎么理解|如何理解|什么意思)/,
      /(有哪些|有什么|列举|举例)/,
      /(区别|区别是|不同|差异)/,
      /(建议|推荐|怎么选|选哪个)/,
      /(总结|概括|归纳|回顾)/,
      /^(继续|接着|然后呢)/,
    ]
    
    // 复杂任务关键词（需要工具执行类）
    const complexPatterns = [
      /(创建|新建|生成|写入|保存|输出到)/,
      /(修改|编辑|更新|改|替换|重命名)/,
      /(删除|移除|清空|清理)/,
      /(搜索|查找|查询|检索|grep|find)/,
      /(运行|执行|启动|停止|重启|npm|python|node)/,
      /(安装|卸载|install|uninstall)/,
      /(读取|打开|查看|cat|读|看看)/,
      /(分析|调试|debug|排查|检查)/,
      /(部署|发布|提交|commit|push|pull)/,
      /(下载|上传|fetch|curl)/,
      /(文件|目录|文件夹|folder|directory)/,
      /(代码|函数|类|组件|模块|接口)/,
      /(帮我|请帮|麻烦|能不能|可以.*吗)/,  // 请求执行类
    ]
    
    // 检查是否匹配简单任务模式
    const isSimple = simplePatterns.some(pattern => pattern.test(lowerPrompt))
    
    // 检查是否匹配复杂任务模式
    const isComplex = complexPatterns.some(pattern => pattern.test(lowerPrompt))
    
    // 如果同时匹配，优先复杂（因为可能是"帮我解释一下这个文件"这种）
    if (isComplex) return 'complex'
    if (isSimple) return 'simple'
    
    // 默认：短消息视为简单，长消息视为复杂
    return prompt.length < 30 ? 'simple' : 'complex'
  }

  /**
   * 简单对话 - 直接 LLM 流式响应，不走 Quest 流程
   */
  async sendSimpleChat(
    prompt: string,
    nexusId?: string,
    onStream?: (chunk: string) => void
  ): Promise<string> {
    if (!isLLMConfigured()) {
      throw new Error('LLM 未配置')
    }

    // 构建包含 Nexus 设定的系统提示词
    let systemPrompt = '你是一个友好、专业的 AI 助手。请简洁、直接地回答用户问题。'

    if (nexusId) {
      try {
        // 从 store 获取 Nexus 实体
        const { useStore } = await import('@/store')
        const state = useStore.getState() as any
        const nexus = state.nexuses?.get?.(nexusId)

        if (nexus) {
          const identity = nexus.label || nexus.id
          const description = nexus.flavorText || nexus.sopContent?.split('\n')[0] || ''
          const sop = nexus.sopContent || ''

          systemPrompt = `你是 "${identity}"，DD-OS 中的一个专业 Agent。
${description ? `角色描述: ${description}` : ''}
${sop ? `\n行为准则:\n${sop.slice(0, 800)}` : ''}

请以该角色身份简洁、直接地回答用户问题。保持角色一致性。`
        }
      } catch {
        // store 访问失败，使用默认提示词
      }
    }

    const messages: SimpleChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ]

    let fullResponse = ''
    
    try {
      await streamChat(
        messages,
        (chunk) => {
          fullResponse += chunk
          onStream?.(chunk)
        }
      )
      return fullResponse
    } catch (error: any) {
      throw new Error(`对话失败: ${error.message}`)
    }
  }

  /**
   * P5: 更新最近操作的实体 (用于指代消解)
   * 从工具调用中提取关键实体，供后续代词解析使用
   */
  private updateRecentEntities(toolName: string, args: Record<string, unknown>, result: string) {
    const now = Date.now()
    
    // 提取文件路径
    const path = args.path as string | undefined
    const file = args.file as string | undefined
    const filePath = path || file
    if (filePath) {
      this.recentEntities.files = [filePath, ...this.recentEntities.files.slice(0, 4)]
    }
    
    // 提取命令
    const command = args.command as string | undefined
    const cmd = args.cmd as string | undefined
    const cmdStr = command || cmd
    if (cmdStr) {
      this.recentEntities.commands = [cmdStr, ...this.recentEntities.commands.slice(0, 4)]
    }
    
    // 提取搜索查询
    const query = args.query as string | undefined
    const search = args.search as string | undefined
    const queryStr = query || search
    if (queryStr) {
      this.recentEntities.queries = [queryStr, ...this.recentEntities.queries.slice(0, 4)]
    }
    
    // 从结果中提取文件路径 (如 writeFile 返回的路径)
    const pathMatch = result.match(/(?:Written to|Created|Saved|写入|创建|保存).*?([\/\\][\w\-\.\/\\]+\.\w+)/i)
    if (pathMatch) {
      this.recentEntities.files = [pathMatch[1], ...this.recentEntities.files.slice(0, 4)]
    }
    
    this.recentEntities.lastToolName = toolName
    this.recentEntities.timestamp = now
  }

  /**
   * P5: 构建指代消解提示
   * 检测用户输入中的代词，并从最近实体中生成上下文提示
   */
  private buildAnaphoraHint(userQuery: string): string {
    // 常见代词模式
    const pronounPatterns = [
      /这个|这|这里|这边|这些/,
      /那个|那|那里|那边|那些/,
      /它|它们|他|她|他们|她们/,
      /上面|上述|前面|刚才|之前/,
      /this|that|it|them|these|those/i,
    ]
    
    const hasPronouns = pronounPatterns.some(p => p.test(userQuery))
    
    // 如果没有代词或最近实体太旧 (超过5分钟)，不需要提示
    if (!hasPronouns) return ''
    if (Date.now() - this.recentEntities.timestamp > 5 * 60 * 1000) return ''
    
    const hints: string[] = []
    
    // 根据最近操作类型生成提示
    if (this.recentEntities.files.length > 0) {
      const recentFile = this.recentEntities.files[0]
      hints.push(`最近操作的文件: "${recentFile}"`)
    }
    
    if (this.recentEntities.commands.length > 0) {
      const recentCmd = this.recentEntities.commands[0]
      hints.push(`最近执行的命令: "${recentCmd.slice(0, 50)}${recentCmd.length > 50 ? '...' : ''}"`)
    }
    
    if (this.recentEntities.queries.length > 0) {
      const recentQuery = this.recentEntities.queries[0]
      hints.push(`最近的搜索: "${recentQuery}"`)
    }
    
    if (this.recentEntities.lastToolName) {
      hints.push(`最后使用的工具: ${this.recentEntities.lastToolName}`)
    }
    
    if (hints.length === 0) return ''
    
    return `\n[指代消解提示] 用户输入中可能包含代词。上下文参考:\n${hints.join('\n')}\n`
  }

  /**
   * 设置服务器地址
   */
  setServerUrl(url: string) {
    this.serverUrl = url || CONFIG.LOCAL_SERVER_URL
  }

  /**
   * 连接到本地服务器
   */
  async connect(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/status`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`)
      }

      const data = await response.json()
      console.log('[LocalClaw] Connected to Native Server:', data)

      this.storeActions?.setConnectionStatus('connected')
      this.storeActions?.setConnectionError(null)
      
      // Native 模式下，设置所有 loading 状态为 false
      this.storeActions?.setSessionsLoading(false)
      this.storeActions?.setChannelsLoading(false)
      this.storeActions?.setDevicesLoading(false)
      
      this.storeActions?.addToast({
        type: 'success',
        title: 'DD-OS Native 已就绪',
        message: `v${data.version} | ${data.skillCount} skills`,
      })

      // 加载 SOUL
      await this.loadSoul()

      // 加载所有数据到 store (Soul/Skills/Memories)
      await this.loadAllDataToStore()

      // P0: 加载动态工具列表
      await this.loadTools()

      // 加载能力缺失记忆
      await this.loadCapabilityGapHistory()

      // 加载 Nexus 性能统计
      await this.loadNexusStats()

      // 加载自适应规则
      await this.loadNexusRules()

      // 初始化今日日志
      await this.initDailyLog()

      return true
    } catch (error: any) {
      console.error('[LocalClaw] Connection failed:', error)
      this.storeActions?.setConnectionStatus('error')
      this.storeActions?.setConnectionError(
        '无法连接本地服务器。请确保 ddos-local-server.py 正在运行。'
      )
      return false
    }
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.storeActions?.setConnectionStatus('disconnected')
  }

  /**
   * 检查连接状态
   */
  async checkStatus(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/status`, {
        signal: AbortSignal.timeout(3000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * 加载 SOUL.md
   */
  private async loadSoul(): Promise<void> {
    try {
      const response = await fetch(`${this.serverUrl}/file/SOUL.md`)
      if (response.ok) {
        this.soulContent = await response.text()
      }
    } catch (error) {
      console.warn('[LocalClaw] Failed to load SOUL.md:', error)
    }
  }

  /**
   * P0: 加载动态工具列表
   */
  private async loadTools(): Promise<void> {
    try {
      const response = await fetch(`${this.serverUrl}/tools`)
      if (response.ok) {
        this.availableTools = await response.json()
        const plugins = this.availableTools.filter(t => t.type === 'plugin').length
        const instructions = this.availableTools.filter(t => t.type === 'instruction').length
        const mcpTools = this.availableTools.filter(t => t.type === 'mcp').length
        console.log(`[LocalClaw] ${this.availableTools.length} tools loaded (${plugins} plugins, ${instructions} instruction skills, ${mcpTools} mcp)`)
      }
    } catch (error) {
      console.warn('[LocalClaw] Failed to load tools, using defaults:', error)
    }
  }

  /**
   * P0: 生成动态工具文档 (注入到系统提示词)
   */
  private buildToolsDocumentation(toolList?: ToolInfo[]): string {
    const toolSource = toolList || this.availableTools
    if (toolSource.length === 0) {
      // fallback: 硬编码工具列表
      return `### 文件操作
- readFile: 读取文件内容
- writeFile: 写入文件
- appendFile: 追加内容到文件
- listDir: 列出目录

### 系统操作
- runCmd: 执行 Shell 命令

### 网络能力
- weather: 查询天气 (参数: location)
- webSearch: 网页搜索 (参数: query)
- webFetch: 获取网页内容 (参数: url)`
    }

    const builtins = toolSource.filter(t => t.type === 'builtin')
    const plugins = toolSource.filter(t => t.type === 'plugin')
    const instructions = toolSource.filter(t => t.type === 'instruction')

    let doc = '### 内置工具\n'
    for (const tool of builtins) {
      doc += `- ${tool.name}`
      if (tool.description) doc += `: ${tool.description}`
      doc += '\n'
    }

    if (plugins.length > 0) {
      doc += '\n### 插件工具\n'
      for (const tool of plugins) {
        doc += `- ${tool.name}`
        if (tool.description) doc += `: ${tool.description}`
        if (tool.inputs && Object.keys(tool.inputs).length > 0) {
          const params = Object.entries(tool.inputs)
            .map(([k, v]: [string, any]) => `${k}${v?.required ? '(必填)' : ''}`)
            .join(', ')
          doc += ` (参数: ${params})`
        }
        doc += '\n'
      }
    }

    if (instructions.length > 0) {
      doc += '\n### 指令型技能 (Agent Skills)\n'
      for (const tool of instructions) {
        doc += `- ${tool.name}`
        if (tool.description) doc += `: ${tool.description}`
        if (tool.inputs && Object.keys(tool.inputs).length > 0) {
          const params = Object.entries(tool.inputs)
            .map(([k, v]: [string, any]) => `${k}${v?.required ? '(必填)' : ''}`)
            .join(', ')
          doc += ` (参数: ${params})`
        }
        doc += '\n'
      }
    }

    const mcpTools = toolSource.filter(t => t.type === 'mcp')
    if (mcpTools.length > 0) {
      doc += '\n### MCP 工具\n'
      for (const tool of mcpTools) {
        doc += `- ${tool.name}`
        if (tool.description) doc += `: ${tool.description}`
        if (tool.inputs && Object.keys(tool.inputs).length > 0) {
          const params = Object.entries(tool.inputs)
            .map(([k, v]: [string, any]) => `${k}${v?.required ? '(必填)' : ''}`)
            .join(', ')
          doc += ` (参数: ${params})`
        }
        doc += '\n'
      }
    }

    // 📛 物理边界：负面能力声明
    doc += this.buildNegativeCapabilities()

    return doc
  }

  /**
   * 生成负面能力声明：明确告知 Agent 哪些能力不可用
   * 通过对比已加载工具与常见能力类别，生成 "你没有的能力" 列表
   */
  private buildNegativeCapabilities(): string {
    const toolNames = new Set(this.availableTools.map(t => t.name.toLowerCase()))

    // 常见能力类别 → 对应的工具名模式
    const capabilityMap: Array<{ label: string; patterns: string[] }> = [
      { label: '网络搜索', patterns: ['websearch', 'web_search', 'search'] },
      { label: '网页抓取', patterns: ['webfetch', 'web_fetch', 'fetch', 'scrape'] },
      { label: '数据库操作', patterns: ['sql', 'database', 'db', 'query'] },
      { label: 'GUI 控制', patterns: ['gui', 'screenshot', 'click', 'mouse'] },
      { label: '邮件发送', patterns: ['email', 'mail', 'sendmail', 'smtp'] },
      { label: '图片/视频处理', patterns: ['image', 'video', 'ffmpeg', 'resize', 'convert'] },
      { label: '代码编译执行', patterns: ['compile', 'interpret', 'eval', 'sandbox'] },
    ]

    const missing: string[] = []
    for (const cap of capabilityMap) {
      const hasCapability = cap.patterns.some(p =>
        [...toolNames].some(name => name.includes(p))
      )
      if (!hasCapability) {
        missing.push(cap.label)
      }
    }

    if (missing.length === 0) return ''

    // 读取历史能力缺失记忆
    const gapHistory = this.capabilityGapHistory.slice(-3)
    const gapHint = gapHistory.length > 0
      ? `\n历史教训: ${gapHistory.map(g => g.label).join(', ')} 曾导致任务失败`
      : ''

    return `\n### ⚠️ 能力边界\n以下能力当前不可用: ${missing.join('、')}${gapHint}\n遇到相关需求时，请明确告知用户当前缺少该能力，建议安装对应技能。不要假装能执行。\n`
  }

  /**
   * 连接成功后，自动加载所有数据到 UI Store
   * Soul → 解析并注入 store (驱动 SoulHouse)
   * Skills → 注入 store (驱动 SkillTree + SoulOrb 粒子)
   * Memories → 注入 store (驱动 MemoryHouse)
   */
  private async loadAllDataToStore(): Promise<void> {
    // 1. Soul: 解析已加载的 SOUL.md 并更新 store
    if (this.soulContent) {
      try {
        const parsed = parseSoulMd(this.soulContent)
        this.storeActions?.setSoulFromParsed(parsed, null)
        // 缓存到 localStorage
        localStorage.setItem('ddos_soul_md', this.soulContent)
        console.log('[LocalClaw] Soul loaded to store')
      } catch (e) {
        console.warn('[LocalClaw] Failed to parse SOUL.md:', e)
      }

      // 尝试加载 IDENTITY.md
      try {
        const identityRes = await fetch(`${this.serverUrl}/file/IDENTITY.md`)
        if (identityRes.ok) {
          const identityContent = await identityRes.text()
          localStorage.setItem('ddos_identity_md', identityContent)
        }
      } catch { /* optional file */ }
    }

    // 2. Skills: 从服务器获取技能列表
    try {
      const skillsRes = await fetch(`${this.serverUrl}/skills`)
      if (skillsRes.ok) {
        const skills: OpenClawSkill[] = await skillsRes.json()
        // 始终调用 setOpenClawSkills (即使空数组)，确保 channelsLoading 变为 false
        this.storeActions?.setOpenClawSkills(skills)
        if (skills.length > 0) {
          localStorage.setItem('ddos_skills_json', JSON.stringify(skills))
          console.log(`[LocalClaw] ${skills.length} skills loaded to store`)

          // P1: 从 manifest.keywords 动态构建技能触发器
          this.buildSkillTriggersFromManifest(skills)
          
          // P6: 尝试连接 EvoMap 网络 (后台，不阻塞)
          this.initEvoMap().catch(e => console.warn('[LocalClaw] EvoMap init failed:', e))
        } else {
          console.log('[LocalClaw] No skills found (empty array)')
        }
      } else {
        // API 失败也要设置空数组，解除 loading 状态
        this.storeActions?.setOpenClawSkills([])
        console.warn('[LocalClaw] Skills API returned non-OK status')
      }
    } catch (e) {
      // 失败也要设置空数组，解除 loading 状态
      this.storeActions?.setOpenClawSkills([])
      console.warn('[LocalClaw] Failed to load skills:', e)
    }

    // 3. Memories: 从服务器获取记忆
    try {
      const memoriesRes = await fetch(`${this.serverUrl}/memories`)
      if (memoriesRes.ok) {
        const memories: MemoryEntry[] = await memoriesRes.json()
        if (memories.length > 0) {
          this.storeActions?.setMemories(memories)
          localStorage.setItem('ddos_memories_json', JSON.stringify(memories))
          console.log(`[LocalClaw] ${memories.length} memories loaded to store`)
        }
      }
    } catch (e) {
      console.warn('[LocalClaw] Failed to load memories:', e)
    }

    // 4. Nexuses: 从服务器获取 Nexus 列表 (Phase 4)
    try {
      const nexusesRes = await fetch(`${this.serverUrl}/nexuses`)
      if (nexusesRes.ok) {
        const nexuses = await nexusesRes.json()
        if (nexuses.length > 0) {
          this.storeActions?.setNexusesFromServer(nexuses)
          localStorage.setItem('ddos_nexuses_json', JSON.stringify(nexuses))
          console.log(`[LocalClaw] ${nexuses.length} nexuses loaded to store`)
        }
      }
    } catch (e) {
      console.warn('[LocalClaw] Failed to load nexuses:', e)
    }
  }

  /**
   * P1: 从 /skills 返回的 manifest.keywords 动态构建触发器
   * P4: 同时构建语义嵌入索引
   * 有 keywords 的技能会覆盖 DEFAULT_SKILL_TRIGGERS 中的同名条目
   * P5: 支持多工具技能 (toolNames 数组)
   */
  private buildSkillTriggersFromManifest(skills: OpenClawSkill[]): void {
    // 从 DEFAULT_SKILL_TRIGGERS 开始
    this.skillTriggers = { ...DEFAULT_SKILL_TRIGGERS }

    for (const skill of skills) {
      if (skill.keywords && skill.keywords.length > 0) {
        const skillMdPath = `skills/${skill.name}/SKILL.md`

        // 为每个 toolName 创建触发器映射
        const names = skill.toolNames
          || (skill.toolName ? [skill.toolName] : [skill.name])
        
        for (const name of names) {
          this.skillTriggers[name] = {
            keywords: skill.keywords,
            path: skillMdPath,
          }
        }

        // 也保留 skill.name 作为触发器 (向后兼容)
        if (!this.skillTriggers[skill.name]) {
          this.skillTriggers[skill.name] = {
            keywords: skill.keywords,
            path: skillMdPath,
          }
        }
      }
    }

    const dynamicCount = skills.filter(s => s.keywords && s.keywords.length > 0).length
    if (dynamicCount > 0) {
      console.log(`[LocalClaw] Skill triggers: ${Object.keys(this.skillTriggers).length} total (${dynamicCount} from manifests)`)
    }

    // P4: 异步构建语义嵌入索引 (不阻塞主流程)
    this.skillEmbeddingIndex.buildIndex(skills).catch(err => {
      console.warn('[LocalClaw] Failed to build skill embedding index:', err)
    })
  }

  // ============================================
  // 🎯 JIT 动态上下文构建
  // ============================================

  /**
   * 构建动态上下文 (Just-In-Time Loading)
   * 根据用户查询动态注入相关上下文，避免上下文窗口膨胀
   * 返回 { context, dynamicExamples } 分别注入模板的两个占位符
   */
  private async buildDynamicContext(userQuery: string): Promise<{ context: string; dynamicExamples: string }> {
    const contextParts: string[] = []
    const exampleParts: string[] = []
    const queryLower = userQuery.toLowerCase()

    // 0. P5: 指代消解提示 (优先注入，让模型理解代词指向)
    const anaphoraHint = this.buildAnaphoraHint(userQuery)
    if (anaphoraHint) {
      contextParts.push(anaphoraHint)
    }

    // 1. 核心人格 (SOUL.md) - 始终加载但精简
    if (this.soulContent) {
      const soulSummary = this.extractSoulSummary(this.soulContent)
      if (soulSummary) {
        contextParts.push(`## 核心人格\n${soulSummary}`)
      }
    }

    // 1.5 激活的 Nexus SOP 注入 (Phase 4)
    const activeNexusId = this.getActiveNexusId()
    if (activeNexusId) {
      const nexusCtx = await this.buildNexusContext(activeNexusId, queryLower)
      if (nexusCtx) {
        contextParts.push(nexusCtx)
      }
    }

    // 1.6 📊 Nexus 性能洞察注入
    const performanceInsight = this.buildNexusInsight(activeNexusId)
    if (performanceInsight) {
      contextParts.push(performanceInsight)
    }

    // 1.7 🤖 自适应规则引擎注入
    const activeRules = this.getActiveRulesForNexus(activeNexusId)
    if (activeRules.length > 0) {
      const ruleTexts = activeRules.map(r => `- ${r.injectedPrompt}`).join('\n')
      contextParts.push(`## 🤖 自适应约束\n${ruleTexts}`)
    }

    // 2. 今日记忆 - 仅当可能相关时加载
    const today = new Date().toISOString().split('T')[0]
    const dailyLog = await this.readFileWithCache(`memory/${today}.md`)
    if (dailyLog) {
      const recentLogs = this.extractRecentLogs(dailyLog, 10)
      if (recentLogs) {
        contextParts.push(`## 今日活动\n${recentLogs}`)
      }
    }

    // 3. SOP 记忆检索 - 查找相关的成功任务模式
    const sopMemory = await this.searchSOPMemory(queryLower)
    if (sopMemory) {
      contextParts.push(`## 相关经验\n${sopMemory}`)
    }

    // 3.5 P2: 执行追踪检索 - 查找相似任务的成功工具序列
    const relatedTraces = await this.searchExecTraces(queryLower, 3)
    const successfulTraces = relatedTraces.filter(t => t.success)
    if (successfulTraces.length > 0) {
      const traceHints = successfulTraces.map(t => {
        const toolSeq = t.tools.map(tool => `${tool.name}()`).join(' → ')
        return `- 任务: "${t.task.slice(0, 50)}..." → ${toolSeq}`
      }).join('\n')
      contextParts.push(`## 历史成功案例\n${traceHints}`)
    }

    // 4. 动态技能注入 - 优先语义检索，fallback 关键词匹配
    const matchedSkills = await this.matchSkillsAsync(queryLower)
    for (const skillPath of matchedSkills) {
      const skillContent = await this.readFileWithCache(skillPath)
      if (skillContent) {
        const skillUsage = this.extractSkillUsage(skillContent)
        if (skillUsage) {
          exampleParts.push(skillUsage)
        }
      }
    }

    // 5. 用户偏好 (如果存在)
    if (queryLower.includes('偏好') || queryLower.includes('设置') || queryLower.includes('preference')) {
      const userPrefs = await this.readFileWithCache('USER.md')
      if (userPrefs) {
        contextParts.push(`## 用户偏好\n${userPrefs}`)
      }
    }

    // 组合上下文
    const timestamp = new Date().toLocaleString('zh-CN')
    const header = `当前时间: ${timestamp}\n用户意图: ${userQuery.slice(0, 100)}${userQuery.length > 100 ? '...' : ''}`
    
    const context = contextParts.length > 0 
      ? `${header}\n\n${contextParts.join('\n\n')}`
      : header

    const dynamicExamples = exampleParts.length > 0
      ? `## 相关技能参考\n以下是与当前任务相关的工具用法和思维示例：\n\n${exampleParts.join('\n\n---\n\n')}`
      : `## 基础示例\n查询天气：\n\`\`\`json\n{"thought": "用户想查天气，使用 weather 工具", "tool": "weather", "args": {"location": "惠州"}}\n\`\`\`\n\n网页搜索：\n\`\`\`json\n{"thought": "用户需要搜索信息", "tool": "webSearch", "args": {"query": "关键词"}}\n\`\`\``

    return { context, dynamicExamples }
  }

  // ============================================
  // 🌌 Nexus 上下文 & 经验系统 (Phase 4)
  // ============================================

  /**
   * 获取当前激活的 Nexus ID
   */
  private getActiveNexusId(): string | null {
    // 从 storeActions 中读取 (Zustand 状态)
    return (this.storeActions as any)?.activeNexusId ?? null
  }

  /**
   * 构建 Nexus 专用上下文 (Mission + SOP + 相关经验)
   */
  private async buildNexusContext(nexusId: string, userQuery: string): Promise<string | null> {
    // 先尝试从 store 中获取 SOP
    const nexuses: Map<string, NexusEntity> | undefined = (this.storeActions as any)?.nexuses
    const nexus = nexuses?.get(nexusId)
    
    let sopContent = nexus?.sopContent
    
    // 如果 store 中没有 SOP，从后端加载
    if (!sopContent) {
      try {
        const res = await fetch(`${this.serverUrl}/nexuses/${nexusId}`)
        if (res.ok) {
          const detail = await res.json()
          sopContent = detail.sopContent
        }
      } catch {
        // 静默失败
      }
    }
    
    if (!sopContent) return null

    // 截断 SOP 到 ~2000 token 预算 (约 8000 字符)
    const maxChars = 8000
    const trimmedSOP = sopContent.length > maxChars 
      ? sopContent.slice(0, maxChars) + '\n... [truncated]'
      : sopContent

    let ctx = `## 🌌 Active Nexus: ${nexus?.label || nexusId}\n\n`
    
    // 🎯 目标函数驱动上下文 (Objective-Driven Execution)
    const objective = nexus?.objective
    const metrics = nexus?.metrics
    const strategy = nexus?.strategy
    
    if (objective) {
      ctx += `### 🎯 核心目标 (Objective)\n${objective}\n\n`
      
      if (metrics && metrics.length > 0) {
        ctx += `### ✓ 验收标准 (Metrics)\n`
        ctx += `执行过程中，请自我检查是否满足以下条件：\n`
        metrics.forEach((m, i) => {
          ctx += `${i + 1}. ${m}\n`
        })
        ctx += `\n`
      }
      
      if (strategy) {
        ctx += `### 🔄 动态调整策略\n${strategy}\n\n`
      }
      
      ctx += `---\n\n`
    }
    
    ctx += trimmedSOP

    // 加载相关经验 (简单关键词匹配)
    const experiences = await this.searchNexusExperiences(nexusId, userQuery)
    if (experiences.length > 0) {
      ctx += `\n\n### 相关历史经验\n${experiences.join('\n---\n')}`
    }

    return ctx
  }

  /**
   * 搜索 Nexus 相关经验条目 (关键词匹配)
   */
  private async searchNexusExperiences(nexusId: string, query: string): Promise<string[]> {
    const results: string[] = []
    
    for (const fileName of ['successes.md', 'failures.md']) {
      const content = await this.readFileWithCache(`nexuses/${nexusId}/experience/${fileName}`)
      if (!content) continue

      const entries = content.split('\n### ').filter(e => e.trim())
      const queryWords = query.split(/\s+/).filter(w => w.length > 2)
      
      for (const entry of entries) {
        const entryLower = entry.toLowerCase()
        const matchCount = queryWords.filter(w => entryLower.includes(w.toLowerCase())).length
        if (matchCount > 0) {
          const prefix = fileName.includes('success') ? '[SUCCESS]' : '[FAILURE]'
          results.push(`${prefix} ### ${entry.slice(0, 500)}`)
        }
      }
    }

    return results.slice(0, 5) // 最多返回 5 条
  }

  // ============================================================
  // 🎯 Nexus 驱动的上下文装配系统 (三层匹配)
  // ============================================================

  /**
   * Layer 1: Nexus 路由匹配
   * 四个优先级: P0 显式激活 → P1 触发词命中 → P2 关键词评分 → P3 经验匹配
   * 返回匹配到的 NexusEntity 或 null（降级到全量工具）
   */
  private matchNexusForTask(userInput: string): NexusEntity | null {
    const nexuses: Map<string, NexusEntity> | undefined = (this.storeActions as any)?.nexuses
    if (!nexuses || nexuses.size === 0) return null

    const inputLower = userInput.toLowerCase()

    // P0: 显式激活（用户已选中 Nexus）
    const activeNexusId = this.getActiveNexusId()
    if (activeNexusId) {
      const active = nexuses.get(activeNexusId)
      if (active) return active
    }

    const nexusList = Array.from(nexuses.values()).filter(n => n.constructionProgress >= 1)

    // P1: 触发词命中（精确匹配，命中即返回）
    for (const nexus of nexusList) {
      const triggers = nexus.triggers || []
      if (triggers.length > 0 && triggers.some(t => inputLower.includes(t.toLowerCase()))) {
        console.log(`[NexusRouter] P1 trigger match: "${nexus.label}" via triggers`)
        return nexus
      }
    }

    // P2: 关键词综合评分
    let bestMatch: NexusEntity | null = null
    let bestScore = 0

    for (const nexus of nexusList) {
      let score = 0

      // 标签命中（权重 3）
      const triggers = nexus.triggers || []
      score += triggers.filter(t => inputLower.includes(t.toLowerCase())).length * 3

      // 技能名命中（权重 2）—— "web-search" 拆分为 ["web", "search"]
      const skills = [...(nexus.boundSkillIds || []), ...(nexus.skillDependencies || [])]
      score += skills.filter(s => {
        const parts = s.toLowerCase().split('-')
        return parts.some(p => p.length > 2 && inputLower.includes(p))
      }).length * 2

      // SOP/描述关键词命中（权重 1）
      const desc = `${nexus.flavorText || ''} ${nexus.label || ''}`
      const descWords = desc.toLowerCase().split(/\s+/).filter(w => w.length > 2)
      score += descWords.filter(w => inputLower.includes(w)).length

      if (score > bestScore) {
        bestScore = score
        bestMatch = nexus
      }
    }

    if (bestScore >= 3 && bestMatch) {
      console.log(`[NexusRouter] P2 keyword match: "${bestMatch.label}" (score: ${bestScore})`)
      return bestMatch
    }

    // P3: 经验匹配（查看历史成功追踪中关联的 Nexus）
    // 暂时通过现有 exec_traces 实现，后续可增强
    // 当前阶段跳过，降级到全量工具

    console.log('[NexusRouter] No Nexus matched, using full toolset')
    return null
  }

  /**
   * Layer 2: 工具过滤
   * 根据匹配到的 Nexus，组装精准工具集
   * 公式: 基础工具 ∪ 绑定工具 ∪ 经验工具
   */
  private assembleToolsForNexus(nexus: NexusEntity): ToolInfo[] {
    const result: ToolInfo[] = []
    const included = new Set<string>()

    // 1. 基础工具（builtin 类型永远包含）
    for (const tool of this.availableTools) {
      if (tool.type === 'builtin') {
        result.push(tool)
        included.add(tool.name)
      }
    }

    // 2. 绑定工具（boundSkillIds + skillDependencies）
    const boundIds = new Set<string>([
      ...(nexus.boundSkillIds || []),
      ...(nexus.skillDependencies || []),
    ])
    for (const tool of this.availableTools) {
      if (!included.has(tool.name) && boundIds.has(tool.name)) {
        result.push(tool)
        included.add(tool.name)
      }
    }

    // 3. MCP 工具：如果绑定的技能名与 MCP server 名有交集，包含该 MCP 的所有工具
    for (const tool of this.availableTools) {
      if (tool.type === 'mcp' && !included.has(tool.name)) {
        // MCP 工具名通常是 server__toolName 格式
        const mcpServer = tool.name.split('__')[0] || ''
        if (boundIds.has(mcpServer) || Array.from(boundIds).some(bid => tool.name.includes(bid))) {
          result.push(tool)
          included.add(tool.name)
        }
      }
    }

    // 4. 如果绑定工具太少（<3 个非 builtin），可能是新 Nexus，补充相关技能
    const nonBuiltinCount = result.filter(t => t.type !== 'builtin').length
    if (nonBuiltinCount < 3) {
      // 通过技能名模糊匹配补充
      const nexusKeywords = [
        ...(nexus.triggers || []),
        ...(nexus.label ? nexus.label.toLowerCase().split(/\s+/) : []),
      ].map(k => k.toLowerCase()).filter(k => k.length > 2)

      for (const tool of this.availableTools) {
        if (included.has(tool.name)) continue
        if (result.length >= 15) break // 上限 15 个工具

        const toolLower = tool.name.toLowerCase()
        const descLower = (tool.description || '').toLowerCase()
        if (nexusKeywords.some(k => toolLower.includes(k) || descLower.includes(k))) {
          result.push(tool)
          included.add(tool.name)
        }
      }
    }

    console.log(`[NexusRouter] Assembled ${result.length} tools for "${nexus.label}" (${result.filter(t => t.type !== 'builtin').map(t => t.name).join(', ')})`)
    return result
  }

  /**
   * Layer 3: 运行时动态扩展
   * 当 Reflexion 检测到工具不足时，扩展可用工具集
   * 返回扩展后的工具列表，或 null 表示不需要扩展
   */
  private expandToolsForReflexion(
    currentTools: ToolInfo[],
    failedToolName: string,
    errorMsg: string,
  ): ToolInfo[] | null {
    // 检测是否是"工具未找到"类型的错误
    const isToolMissing = /unknown tool|tool not found|不支持|no such tool|未找到工具|not available/i.test(errorMsg)
    if (!isToolMissing) return null

    // 在全量工具中查找请求的工具
    const currentNames = new Set(currentTools.map(t => t.name))
    const missingTool = this.availableTools.find(t => t.name === failedToolName && !currentNames.has(t.name))

    if (missingTool) {
      console.log(`[NexusRouter] Runtime expansion: adding "${failedToolName}" to toolset`)
      return [...currentTools, missingTool]
    }

    // 工具完全不存在，返回 null
    return null
  }

  /**
   * 核心入口：为当前任务准备工具集
   * 返回 { tools, matchedNexus, isFiltered }
   */
  private prepareToolsForTask(userInput: string): {
    tools: ToolInfo[]
    matchedNexus: NexusEntity | null
    isFiltered: boolean
  } {
    const matchedNexus = this.matchNexusForTask(userInput)

    if (matchedNexus) {
      const filteredTools = this.assembleToolsForNexus(matchedNexus)
      // 安全阀：如果过滤后工具太少（仅有 builtin），降级到全量
      const nonBuiltin = filteredTools.filter(t => t.type !== 'builtin').length
      if (nonBuiltin === 0) {
        console.log('[NexusRouter] Safety fallback: no non-builtin tools after filtering, using full toolset')
        return { tools: this.availableTools, matchedNexus, isFiltered: false }
      }
      return { tools: filteredTools, matchedNexus, isFiltered: true }
    }

    return { tools: this.availableTools, matchedNexus: null, isFiltered: false }
  }

  /**
   * 构建 Nexus 技能上下文 (用于 Reflexion/Critic 提示词增强)
   * 返回当前 Nexus 的已绑定技能和可用技能库信息
   */
  private buildNexusSkillContext(): string {
    const activeNexusId = this.getActiveNexusId()
    if (!activeNexusId) return ''

    const nexuses: Map<string, NexusEntity> | undefined = (this.storeActions as any)?.nexuses
    const nexus = nexuses?.get(activeNexusId)
    if (!nexus) return ''

    const boundSkills = nexus.boundSkillIds || nexus.skillDependencies || []

    // 从 availableTools 中提取可用技能名 (instruction + plugin 类型)
    const availableSkillNames = this.availableTools
      .filter((t: ToolInfo) => t.type === 'instruction' || t.type === 'plugin')
      .map((t: ToolInfo) => t.name)

    return `\n当前 Nexus: ${nexus.label || activeNexusId}
已绑定技能: ${boundSkills.join(', ') || '无'}
可用技能库: ${availableSkillNames.slice(0, 15).join(', ')}${availableSkillNames.length > 15 ? '...' : ''}`
  }

  /**
   * 记录 Nexus 经验 (在 ReAct 循环完成后调用)
   */
  private async recordNexusExperience(
    nexusId: string,
    task: string,
    toolsUsed: string[],
    success: boolean,
    finalResponse: string
  ): Promise<void> {
    try {
      const insight = this.extractKeyInsight(toolsUsed, finalResponse)
      await fetch(`${this.serverUrl}/nexuses/${nexusId}/experience`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: task.slice(0, 200),
          tools_used: toolsUsed,
          outcome: success ? 'success' : 'failure',
          key_insight: insight,
        }),
      })
      console.log(`[LocalClaw] Recorded ${success ? 'success' : 'failure'} experience for Nexus: ${nexusId}`)
    } catch (e) {
      console.warn('[LocalClaw] Failed to record Nexus experience:', e)
    }
  }

  /**
   * 从工具列表和最终回复中提取关键洞察
   */
  private extractKeyInsight(toolsUsed: string[], finalResponse: string): string {
    if (toolsUsed.length === 0) return 'Direct response without tool usage'
    const toolSeq = toolsUsed.join(' → ')
    const summary = finalResponse.slice(0, 100).replace(/\n/g, ' ')
    return `Tool sequence: ${toolSeq}. Result: ${summary}...`
  }

  /**
   * 从用户查询匹配 Nexus 触发器
   */
  matchNexusByTriggers(userQuery: string): string | null {
    const query = userQuery.toLowerCase()
    const nexuses: Map<string, NexusEntity> | undefined = (this.storeActions as any)?.nexuses
    if (!nexuses) return null

    for (const [, nexus] of nexuses) {
      if (nexus.triggers && nexus.triggers.length > 0) {
        for (const trigger of nexus.triggers) {
          if (query.includes(trigger.toLowerCase())) {
            return nexus.id
          }
        }
      }
    }
    return null
  }

  /**
   * 带缓存的文件读取
   */
  private async readFileWithCache(path: string): Promise<string | null> {
    const cached = this.contextCache.get(path)
    const now = Date.now()

    if (cached && (now - cached.timestamp) < this.CACHE_TTL) {
      return cached.content
    }

    const content = await this.readFile(path)
    if (content) {
      this.contextCache.set(path, { content, timestamp: now })
    }
    return content
  }

  /**
   * 匹配用户查询与技能 (P1: 使用动态 skillTriggers, P4: 优先语义检索)
   */
  private async matchSkillsAsync(queryLower: string): Promise<string[]> {
    // P4: 优先使用语义检索
    if (this.skillEmbeddingIndex.isReady()) {
      const semanticMatches = await this.skillEmbeddingIndex.search(queryLower, 3)
      if (semanticMatches.length > 0) {
        return semanticMatches
      }
    }

    // Fallback: 关键词匹配
    return this.matchSkillsByKeyword(queryLower)
  }

  /**
   * 关键词匹配 (fallback 方法)
   */
  private matchSkillsByKeyword(queryLower: string): string[] {
    const matched: string[] = []
    
    for (const [skillName, config] of Object.entries(this.skillTriggers)) {
      const hasMatch = config.keywords.some(keyword => 
        queryLower.includes(keyword.toLowerCase())
      )
      if (hasMatch) {
        matched.push(config.path)
        console.log(`[LocalClaw] JIT: 关键词匹配技能 ${skillName}`)
      }
    }
    
    return matched
  }

  /**
   * 提取 SOUL.md 摘要 (精简版)
   */
  private extractSoulSummary(soulContent: string): string {
    const lines = soulContent.split('\n')
    const summaryLines: string[] = []
    let inCoreSection = false
    let lineCount = 0
    const maxLines = 15 // 最多15行

    for (const line of lines) {
      if (lineCount >= maxLines) break
      
      // 提取标题和核心原则
      if (line.startsWith('# ') || line.startsWith('## Core') || line.startsWith('## 核心')) {
        inCoreSection = true
        summaryLines.push(line)
        lineCount++
      } else if (inCoreSection && line.trim()) {
        if (line.startsWith('## ')) {
          inCoreSection = false
        } else {
          summaryLines.push(line)
          lineCount++
        }
      }
    }

    return summaryLines.join('\n').trim()
  }

  /**
   * 提取最近的日志条目
   */
  private extractRecentLogs(logContent: string, count: number): string {
    const entries = logContent.split(/\n(?=\[|\d{2}:)/).filter(e => e.trim())
    return entries.slice(-count).join('\n')
  }

  /**
   * 提取技能的核心用法和示例部分
   */
  private extractSkillUsage(skillContent: string): string {
    const lines = skillContent.split('\n')
    const resultLines: string[] = []
    let inRelevantSection = false
    let lineCount = 0
    const maxLines = 40 // 增大以容纳思维链示例

    for (const line of lines) {
      if (lineCount >= maxLines) break

      // 捕获 Usage 和 Examples 两个关键部分
      if (line.includes('## Usage') || line.includes('## 用法') || 
          line.includes('## Examples') || line.includes('## 示例')) {
        inRelevantSection = true
        resultLines.push(line)
        lineCount++
        continue
      }
      
      if (inRelevantSection) {
        // 遇到 Notes/Safety/其他无关节时停止
        if (line.startsWith('## ') && 
            !line.includes('Usage') && !line.includes('Examples') && 
            !line.includes('用法') && !line.includes('示例')) {
          inRelevantSection = false
          continue
        }
        resultLines.push(line)
        lineCount++
      }
    }

    // 如果没找到相关部分，取前30行
    if (resultLines.length === 0) {
      return lines.slice(0, 30).join('\n')
    }

    return resultLines.join('\n').trim()
  }

  // ============================================
  // 📦 远程技能安装
  // ============================================

  /**
   * 从 Git URL 安装新技能
   * @param source Git URL (https://... 或 git@...)
   * @param name 可选，指定安装目录名
   * @returns 安装的技能名称
   */
  async installSkill(source: string, name?: string): Promise<string> {
    const res = await fetch(`${this.serverUrl}/skills/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, name }),
    })

    const result = await res.json()

    if (!res.ok) {
      throw new Error(result.error || `Install failed: ${res.status}`)
    }

    // 重新加载工具和技能列表
    await this.loadTools()
    await this.loadAllDataToStore()

    return result.name
  }

  /**
   * 卸载技能
   * @param skillName 技能名称
   */
  async uninstallSkill(skillName: string): Promise<void> {
    const res = await fetch(`${this.serverUrl}/skills/uninstall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: skillName }),
    })

    const result = await res.json()

    if (!res.ok) {
      throw new Error(result.error || `Uninstall failed: ${res.status}`)
    }

    // 重新加载工具和技能列表
    await this.loadTools()
    await this.loadAllDataToStore()
  }

  // ============================================
  // 🌟 入口方法
  // ============================================

  /**
   * 发送简单消息 (ReAct 模式)
   */
  async sendMessage(
    prompt: string,
    onUpdate?: (content: string) => void,
    onStep?: (step: ExecutionStep) => void
  ): Promise<string> {
    if (!isLLMConfigured()) {
      throw new Error('LLM 未配置。请在设置中配置 API Key。')
    }

    // 清空上次执行的文件创建记录
    this._lastCreatedFiles = []

    // P4: Nexus 触发器匹配 - 自动激活匹配的 Nexus
    const matchedNexus = this.matchNexusByTriggers(prompt)
    if (matchedNexus && !this.getActiveNexusId()) {
      this.storeActions?.setActiveNexus?.(matchedNexus)
      console.log(`[LocalClaw] Auto-activated Nexus by trigger: ${matchedNexus}`)
    }

    const execId = `native-${Date.now()}`
    
    this.storeActions?.updateExecutionStatus(execId, {
      id: execId,
      status: 'running',
      timestamp: Date.now(),
    })

    // 设置当前任务上下文 (驱动 UI 全局状态指示)
    this.storeActions?.setCurrentTask(execId, prompt.slice(0, 80))

    // 📝 记录用户输入到短暂层
    this.logToEphemeral(`用户: ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`, 'action').catch(() => {})

    try {
      const result = await this.runReActLoop(prompt, onUpdate, onStep)
      
      this.storeActions?.updateExecutionStatus(execId, {
        status: 'success',
        output: result,
      })

      return result
    } catch (error: any) {
      this.storeActions?.updateExecutionStatus(execId, {
        status: 'error',
        error: error.message,
      })
      throw error
    } finally {
      // 清除当前任务上下文
      this.storeActions?.setCurrentTask(null, null)
    }
  }

  /**
   * Quest 模式：发送消息并生成分步骤任务计划
   * 会自动将任务添加到 TaskHouse 并显示子任务进度
   */
  async sendMessageWithQuestPlan(
    prompt: string,
    nexusId?: string,
    onStep?: (step: ExecutionStep) => void
  ): Promise<string> {
    if (!isLLMConfigured()) {
      throw new Error('LLM 未配置。请在设置中配置 API Key。')
    }

    // 清空上次执行的文件创建记录
    this._lastCreatedFiles = []

    const taskId = `quest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    
    // 1. 设置执行状态
    this.storeActions?.setAgentStatus('planning')
    this.storeActions?.setCurrentTask(taskId, `规划任务: ${prompt.slice(0, 50)}...`)

    try {
      // 2. 生成 Quest 任务计划
      console.log('[LocalClaw/Quest] Generating task plan...')
      const taskPlan = await this.generateQuestPlan(prompt, nexusId)
      console.log('[LocalClaw/Quest] Task plan generated:', taskPlan.subTasks.length, 'subtasks')

      // 3. 创建 TaskItem 并添加到 activeExecutions
      const taskItem: TaskItem = {
        id: taskId,
        title: taskPlan.title || prompt.slice(0, 50),
        description: prompt,
        status: 'executing',
        priority: 'high',
        timestamp: new Date().toISOString(),
        taskPlan,
        executionMode: 'quest',
        executionSteps: [],
      }
      this.storeActions?.addActiveExecution(taskItem)

      // 4. 更新状态为执行中
      this.storeActions?.setAgentStatus('executing')
      this.storeActions?.setCurrentTask(taskId, taskPlan.title || prompt.slice(0, 50))

      // 5. 执行任务计划，通过回调更新进度
      const result = await this.executeQuestPlan(
        taskPlan,
        // onProgress 回调：更新子任务状态
        (updatedPlan) => {
          this.storeActions?.updateActiveExecution(taskId, {
            taskPlan: updatedPlan,
          })
          
          // 同时触发 onStep 回调（如果提供）
          const executingTask = updatedPlan.subTasks.find(t => t.status === 'executing')
          if (executingTask && onStep) {
            onStep({
              id: `step-${executingTask.id}`,
              type: 'tool_call',
              content: `执行子任务: ${executingTask.description}`,
              timestamp: Date.now(),
            })
          }
        },
        // onApprovalRequired 回调：处理需要确认的操作
        async (task: SubTask) => {
          const approved = await this.storeActions?.requestApproval({
            toolName: 'quest_subtask',
            args: { taskId: task.id, description: task.description },
            dangerLevel: 'high',
            reason: task.approvalReason || `子任务 "${task.description}" 需要确认`,
          })
          return approved ? 'approve' : 'skip'
        }
      )

      // 6. 更新任务状态为完成
      this.storeActions?.updateActiveExecution(taskId, {
        status: 'done',
        executionOutput: result,
        executionDuration: Date.now() - new Date(taskItem.timestamp).getTime(),
      })

      return result

    } catch (error: any) {
      console.error('[LocalClaw/Quest] Execution failed:', error)
      
      // 更新任务状态为失败
      this.storeActions?.updateActiveExecution(taskId, {
        status: 'done', // 即使失败也标记为完成，避免一直显示执行中
        executionError: error.message,
      })

      throw error
    } finally {
      this.storeActions?.setAgentStatus('idle')
      this.storeActions?.setCurrentTask(null, null)
    }
  }

  /**
   * 发送复杂任务 (带规划)
   */
  async sendComplexTask(
    prompt: string,
    onProgress?: (step: PlanStep, total: number) => void
  ): Promise<string> {
    if (!isLLMConfigured()) {
      throw new Error('LLM 未配置')
    }

    const execId = `plan-${Date.now()}`
    
    this.storeActions?.setAgentStatus('planning')
    this.storeActions?.updateExecutionStatus(execId, {
      id: execId,
      status: 'running',
      timestamp: Date.now(),
    })

    try {
      // 1. 生成计划
      const plan = await this.generatePlan(prompt)
      console.log('[LocalClaw] Generated plan:', plan)

      // 2. 执行每个步骤 (支持失败重新规划)
      let failCount = 0
      let replanCount = 0
      const MAX_REPLAN = 1  // 最多重新规划1次

      for (let i = 0; i < plan.length; i++) {
        const step = plan[i]
        step.status = 'running'
        onProgress?.(step, plan.length)

        try {
          const stepResult = await this.executeStep(step, plan)
          step.status = 'completed'
          step.result = stepResult
          failCount = 0  // 成功时重置连续失败计数
        } catch (error: any) {
          step.status = 'failed'
          step.result = error.message
          failCount++

          // 连续失败 2 次 → 触发重新规划剩余步骤
          if (failCount >= 2 && replanCount < MAX_REPLAN) {
            replanCount++
            const remainingSteps = plan.slice(i + 1)
            if (remainingSteps.length > 0) {
              console.log(`[LocalClaw] Re-planning after ${failCount} consecutive failures...`)
              const completedContext = plan
                .filter(s => s.status === 'completed')
                .map(s => `[completed] ${s.description}: ${s.result?.slice(0, 100)}`)
                .join('\n')
              const failedContext = plan
                .filter(s => s.status === 'failed')
                .map(s => `[failed] ${s.description}: ${s.result?.slice(0, 100)}`)
                .join('\n')

              const replanPrompt = `原始任务: ${prompt}\n\n已完成:\n${completedContext}\n\n失败:\n${failedContext}\n\n请根据已有进展和失败原因，重新规划剩余步骤。`
              try {
                const newPlan = await this.generatePlan(replanPrompt)
                plan.splice(i + 1, plan.length - i - 1, ...newPlan)
                console.log(`[LocalClaw] Re-planned: ${newPlan.length} new steps`)
              } catch {
                console.warn('[LocalClaw] Re-planning failed, continuing with original plan')
              }
            }
          }
        }

        onProgress?.(step, plan.length)
      }

      // 3. 生成总结报告
      const report = await this.synthesizeReport(prompt, plan)

      // 4. 📝 SOP 存储: 成功的复杂任务自动记录执行模式
      const successSteps = plan.filter(s => s.status === 'completed')
      if (successSteps.length >= 2) {
        this.recordSOP(prompt, plan).catch(() => {})
      }

      this.storeActions?.updateExecutionStatus(execId, {
        status: 'success',
        output: report,
      })

      return report
    } catch (error: any) {
      this.storeActions?.updateExecutionStatus(execId, {
        status: 'error',
        error: error.message,
      })
      throw error
    } finally {
      this.storeActions?.setAgentStatus('idle')
    }
  }

  // ============================================
  // 🧠 ReAct 循环
  // ============================================

  /**
   * ReAct 循环 - 路由器
   * 检测 FC 支持并自动选择合适的执行模式
   */
  private async runReActLoop(
    userPrompt: string,
    onUpdate?: (content: string) => void,
    onStep?: (step: ExecutionStep) => void
  ): Promise<string> {
    // 检测是否应该使用 FC 模式
    // 条件: 有可用工具 && 模型支持 FC (暂时通过配置/特性检测)
    const useFunctionCalling = this.shouldUseFunctionCalling()
    
    if (useFunctionCalling && this.availableTools.length > 0) {
      console.log('[LocalClaw] Using Function Calling mode')
      return this.runReActLoopFC(userPrompt, onUpdate, onStep)
    } else {
      console.log('[LocalClaw] Using Legacy text-based mode')
      return this.runReActLoopLegacy(userPrompt, onUpdate, onStep)
    }
  }

  /**
   * 检测是否应该使用 Function Calling 模式
   * 目前通过 localStorage 配置项控制，便于 A/B 测试和回退
   */
  private shouldUseFunctionCalling(): boolean {
    // 可通过 localStorage 设置 'ddos_use_fc' = 'true' / 'false' 控制
    const fcSetting = localStorage.getItem('ddos_use_fc')
    if (fcSetting === 'false') return false
    if (fcSetting === 'true') return true
    // 默认启用 FC 模式
    return true
  }

  /**
   * ReAct 循环 - Legacy 文本模式 (原实现)
   * 保留用于不支持 FC 的模型或回退场景
   */
  private async runReActLoopLegacy(
    userPrompt: string,
    onUpdate?: (content: string) => void,
    onStep?: (step: ExecutionStep) => void
  ): Promise<string> {
    this.storeActions?.setAgentStatus('thinking')

    // 🎯 复杂度感知：三级轮次分配
    const isSimpleTask = userPrompt.length < 20 && 
      !userPrompt.match(/代码|编写|创建|修复|分析|部署|配置|脚本|搜索|安装|下载|code|create|fix|analyze|search|install/)
    const isHeavyTask = userPrompt.length > 80 ||
      !!userPrompt.match(/并且|然后|之后|同时|自动|批量|全部|and then|also|batch/)
    const maxTurns = isSimpleTask ? CONFIG.SIMPLE_TURNS : isHeavyTask ? CONFIG.MAX_REACT_TURNS : CONFIG.DEFAULT_TURNS
    console.log(`[LocalClaw] Task complexity: ${isSimpleTask ? 'simple' : isHeavyTask ? 'heavy' : 'normal'}, maxTurns: ${maxTurns}`)

    // 🎯 Nexus 驱动：为当前任务准备精准工具集
    const { tools: legacyTaskTools, matchedNexus: legacyMatchedNexus, isFiltered: legacyIsFiltered } = this.prepareToolsForTask(userPrompt)

    // 🎯 JIT: 动态构建上下文
    const { context: dynamicContext, dynamicExamples } = await this.buildDynamicContext(userPrompt)
    console.log('[LocalClaw] JIT Context built:', dynamicContext.slice(0, 200) + '...')

    const systemPrompt = SYSTEM_PROMPT_TEMPLATE
      .replace('{available_tools}', this.buildToolsDocumentation(legacyIsFiltered ? legacyTaskTools : undefined))
      .replace('{context}', dynamicContext)
      .replace('{dynamic_examples}', dynamicExamples)
    
    if (legacyIsFiltered) {
      console.log(`[LocalClaw] Tool documentation filtered for Nexus: ${legacyMatchedNexus?.label} (${legacyTaskTools.length} tools)`)
    }

    const messages: AgentMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    let turnCount = 0
    let finalResponse = ''
    let lastToolResult = ''  // 保存最后一次工具结果，防止循环耗尽时返回空
    const legacyErrorSignatureHistory: string[] = []  // 错误签名追踪 (防 Reflexion 死循环)
    
    // 🔄 升级机制状态
    let currentMaxTurns = maxTurns
    let escalationCount = 0
    let needEscalation = false

    // P2: 执行追踪收集
    const traceTools: ExecTraceToolCall[] = []
    const traceStartTime = Date.now()

    // 外层升级循环
    do {
      needEscalation = false
      
      // 主循环
      while (turnCount < currentMaxTurns) {
        turnCount++
        console.log(`[LocalClaw] ReAct turn ${turnCount}`)

        try {
          // 调用 LLM
        let response = ''
        
        await streamChat(
          messages.map((m) => ({ role: m.role as any, content: m.content })),
          (chunk) => {
            response += chunk
            onUpdate?.(response)
          }
        )

        // 检查是否有工具调用
        const toolCall = this.parseToolCall(response)

        // 提取 thought (如果模型输出了)
        if (toolCall) {
          const thoughtMatch = response.match(/"thought"\s*:\s*"([^"]*)"/)
          if (thoughtMatch) {
            console.log(`[LocalClaw] Thought: ${thoughtMatch[1].slice(0, 100)}`)
            // 发送思考步骤
            onStep?.({
              id: `think-${Date.now()}`,
              type: 'thinking',
              content: thoughtMatch[1],
              timestamp: Date.now(),
            })
          }
        }

        if (toolCall) {
          // 🛡️ P3: 危险操作检测 + 用户审批
          if (CONFIG.HIGH_RISK_TOOLS.includes(toolCall.name)) {
            const argsStr = JSON.stringify(toolCall.args)
            const argsLower = argsStr.toLowerCase()

            // 匹配危险模式
            const matchedDanger = CONFIG.DANGER_PATTERNS.find(p =>
              argsLower.includes(p.pattern.toLowerCase())
            )

            if (matchedDanger) {
              this.storeActions?.addLog({
                id: `precheck-${Date.now()}`,
                timestamp: Date.now(),
                level: 'warn',
                message: `[PreCheck] 检测到危险操作 (${matchedDanger.reason}): ${argsStr.slice(0, 100)}`,
              })

              // 请求用户审批 (如果 store 支持)
              let approved = false
              if (this.storeActions?.requestApproval) {
                try {
                  approved = await this.storeActions.requestApproval({
                    toolName: toolCall.name,
                    args: toolCall.args,
                    dangerLevel: matchedDanger.level,
                    reason: matchedDanger.reason,
                  })
                } catch {
                  approved = false
                }
              }

              if (!approved) {
                // 用户拒绝或无审批UI：阻止执行，让 Agent 重新思考
                messages.push({ role: 'assistant', content: response })
                messages.push({
                  role: 'user',
                  content: `[用户审批] 操作已被用户拒绝。
工具: ${toolCall.name}
命令: ${argsStr}
原因: ${matchedDanger.reason} (风险等级: ${matchedDanger.level})

请使用更安全的替代方案，或向用户解释为什么需要此操作。`,
                })

                this.storeActions?.setAgentStatus('thinking')
                continue // 跳过执行，让 Agent 重新思考
              }
              // approved = true: 继续执行
              this.storeActions?.addLog({
                id: `approved-${Date.now()}`,
                timestamp: Date.now(),
                level: 'info',
                message: `[Approval] 用户已批准危险操作: ${toolCall.name}`,
              })
            }
          }
          
          // 执行工具
          this.storeActions?.setAgentStatus('executing')
          this.storeActions?.addLog({
            id: `tool-${Date.now()}`,
            timestamp: Date.now(),
            level: 'info',
            message: `调用工具: ${toolCall.name}`,
          })

          // 发送工具调用步骤
          onStep?.({
            id: `call-${Date.now()}`,
            type: 'tool_call',
            content: JSON.stringify(toolCall.args, null, 2),
            toolName: toolCall.name,
            toolArgs: toolCall.args,
            timestamp: Date.now(),
          })

          const toolStartTime = Date.now()
          const toolResult = await this.executeTool(toolCall)
          const toolLatency = Date.now() - toolStartTime

          // 发送工具结果步骤
          onStep?.({
            id: `result-${Date.now()}`,
            type: toolResult.status === 'error' ? 'error' : 'tool_result',
            content: toolResult.result.slice(0, 2000),
            toolName: toolCall.name,
            duration: toolLatency,
            timestamp: Date.now(),
          })

          // P2: 记录到执行追踪
          traceTools.push({
            name: toolCall.name,
            args: toolCall.args,
            status: toolResult.status === 'error' ? 'error' : 'success',
            latency: toolLatency,
            order: traceTools.length + 1,
          })

          // 📝 记录工具调用到短暂层
          this.logToEphemeral(
            `${toolCall.name}(${JSON.stringify(toolCall.args).slice(0, 80)}) -> ${toolResult.status}`,
            'action'
          ).catch(() => {}) // 静默失败

          // 添加到消息历史
          messages.push({ role: 'assistant', content: response })
          
          // 🔧 Reflexion 机制：错误时生成结构化反思
          if (toolResult.status === 'error') {
            lastToolResult = toolResult.result
            
            // 📝 记录失败教训到记忆（Reflexion: Verbal Reinforcement）
            const failureLesson = `工具 ${toolCall.name} 执行失败: ${toolResult.result.slice(0, 200)}`
            this.logToEphemeral(failureLesson, 'thought').catch(() => {})

            // 🧬 能力缺失检测
            this.detectAndRecordCapabilityGap(toolCall.name, toolResult.result, userPrompt)
            
            // 🛡️ 错误签名追踪: 检测重复错误防止死循环
            const legacyErrorSig = `${toolCall.name}:${toolResult.result.slice(0, 100)}`
            legacyErrorSignatureHistory.push(legacyErrorSig)
            const legacyRepeatCount = legacyErrorSignatureHistory.filter(e => e === legacyErrorSig).length
            
            if (legacyRepeatCount >= 2) {
              // 🚨 危机干预: 相同错误已出现2+次, 强制策略变更
              messages.push({
                role: 'user',
                content: `[CRITICAL - 重复错误检测] ${toolCall.name} 已连续 ${legacyRepeatCount} 次产生相同错误。
错误信息: ${toolResult.result}

禁止再次使用相同参数调用此工具。你必须选择以下策略之一:
1. 使用完全不同的工具或方法达成目标
2. 彻底修改参数后重试（不能与之前相同）
3. 跳过此步骤，继续执行后续任务
不要重复之前的失败操作。`,
              })
              
              this.storeActions?.addLog({
                id: `reflexion-crisis-${Date.now()}`,
                timestamp: Date.now(),
                level: 'error',
                message: `[Reflexion] 检测到重复错误(${legacyRepeatCount}次)，强制策略变更: ${toolCall.name}`,
              })
            } else {
              messages.push({
                role: 'user',
                content: `[Reflexion 反思] ${toolCall.name} 执行失败。
错误信息: ${toolResult.result}

请进行结构化反思:
1. **根本原因**: 是路径错误？参数类型错误？权限问题？工具不支持？
2. **修正方案**: 如何调整参数或换用其他方法？
3. **预防措施**: 下次如何避免此类错误？${(() => { const ctx = this.buildNexusSkillContext(); return ctx ? `
4. **技能充足性**: 当前 Nexus 的技能是否足以完成任务？如果缺少必要技能，可使用 nexusBindSkill 添加；如果某技能不适用，可使用 nexusUnbindSkill 移除。${ctx}` : '' })()}

请在 thought 中完成反思，然后执行修正后的操作。`,
              })
            
              this.storeActions?.addLog({
                id: `reflexion-${Date.now()}`,
                timestamp: Date.now(),
                level: 'warn',
                message: `[Reflexion] 分析 ${toolCall.name} 失败原因`,
              })
            }
          } else {
            lastToolResult = toolResult.result
            
            // P5: 更新最近操作的实体 (用于指代消解)
            this.updateRecentEntities(toolCall.name, toolCall.args as Record<string, unknown>, toolResult.result)
            
            // 追踪文件创建事件
            if (toolCall.name === 'writeFile' && toolResult.status === 'success') {
              try {
                const parsed = JSON.parse(toolResult.result)
                if (parsed.action === 'file_created' && parsed.filePath) {
                  this._lastCreatedFiles.push({
                    filePath: parsed.filePath,
                    fileName: parsed.fileName || '',
                    message: parsed.message || '',
                    fileSize: parsed.fileSize,
                  })
                }
              } catch { /* 非 JSON 结果，忽略 */ }
            }

            // 🔄 技能变更检测：安装/卸载技能后刷新工具列表
            const isSkillChange = 
              (toolCall.name === 'runCmd' && (
                toolResult.result.includes('Skill installed') ||
                toolResult.result.includes('tools registered') ||
                toolResult.result.includes('git clone')
              )) ||
              // writeFile 写入 skills/ 目录也触发刷新
              (toolCall.name === 'writeFile' && toolResult.status === 'success' && 
                String(toolCall.args.path || '').replace(/\\/g, '/').includes('skills/'))
            
            if (isSkillChange) {
              try {
                await this.loadTools()
                await this.loadAllDataToStore()  // 刷新技能树 UI
                const updatedToolsDoc = this.buildToolsDocumentation()
                // 更新 system prompt 中的工具文档
                if (messages[0]?.role === 'system') {
                  messages[0].content = messages[0].content.replace(
                    /### 内置工具[\s\S]*$/,
                    updatedToolsDoc
                  )
                }
                console.log('[LocalClaw] Tools & skills refreshed mid-loop after skill change')
              } catch {
                console.warn('[LocalClaw] Failed to refresh tools mid-loop')
              }
            }

            // 🌌 Nexus 技能绑定变更检测：自适应后刷新前端状态
            const isNexusSkillChange = 
              (toolCall.name === 'nexusBindSkill' || toolCall.name === 'nexusUnbindSkill') &&
              toolResult.status === 'success'

            if (isNexusSkillChange) {
              try {
                await this.loadAllDataToStore()  // 重新加载 Nexus 数据到前端
                console.log('[LocalClaw] Nexus skills refreshed after self-adaptation')
              } catch {
                console.warn('[LocalClaw] Failed to refresh nexuses after skill adaptation')
              }
            }
            
            // 🔍 Critic 自检：修改类工具成功后触发验证
            const needsCritic = CONFIG.CRITIC_TOOLS.includes(toolCall.name)
            
            if (needsCritic) {
              const nexusSkillCtxCritic = this.buildNexusSkillContext()
              const recentToolNames = traceTools.slice(-5).map(t => t.name).join(', ')

              messages.push({
                role: 'user',
                content: `[Critic 自检] ${toolCall.name} 执行成功。
结果: ${toolResult.result.slice(0, 500)}

请验证:
1. 结果是否完全满足用户的原始需求？
2. 是否有潜在问题需要修正？
3. 是否需要额外操作来完善？${nexusSkillCtxCritic ? `
4. **技能优化**: 本次使用了 [${recentToolNames}]。当前 Nexus 是否有未使用的冗余技能？是否需要新技能？${nexusSkillCtxCritic}` : ''}

如果满足需求，请给出最终回复。如果发现问题，请自行修正。`,
              })
              
              this.storeActions?.addLog({
                id: `critic-${Date.now()}`,
                timestamp: Date.now(),
                level: 'info',
                message: `[Critic] 验证 ${toolCall.name} 执行结果`,
              })
            } else {
              // 查询类工具直接返回结果
              messages.push({
                role: 'user',
                content: `[工具执行结果] ${toolCall.name}:\n${toolResult.result}`,
              })
            }
          }

          this.storeActions?.setAgentStatus('thinking')
        } else {
          // 无工具调用，返回最终响应
          finalResponse = response
          
          // 发送最终输出步骤
          onStep?.({
            id: `output-${Date.now()}`,
            type: 'output',
            content: response.slice(0, 2000),
            timestamp: Date.now(),
          })
          
          // 📝 记录响应摘要到短暂层
          const summary = response.slice(0, 100).replace(/\n/g, ' ')
          this.logToEphemeral(`回复: ${summary}...`, 'result').catch(() => {})
          
          break
        }
      } catch (error: any) {
        console.error('[LocalClaw] ReAct error:', error)
        finalResponse = `执行出错: ${error.message}`
        break
      }
    }

    this.storeActions?.setAgentStatus('idle')

    // P2: 保存执行追踪 (含 Observer 元数据)
    if (traceTools.length > 0) {
      const errorCount = traceTools.filter(t => t.status === 'error').length
      const activeNexusId = this.getActiveNexusId()
      
      const trace: ExecTrace = {
        id: `trace-${traceStartTime}`,
        task: userPrompt.slice(0, 200),
        tools: traceTools,
        success: traceTools.every(t => t.status === 'success'),
        duration: Date.now() - traceStartTime,
        timestamp: traceStartTime,
        tags: userPrompt.split(/\s+/).filter(w => w.length > 2 && w.length < 15).slice(0, 5),
        // Observer 元数据
        turnCount,
        errorCount,
        skillIds: [], // 由上下文构建时填充
        activeNexusId: activeNexusId || undefined,
      }
      this.saveExecTrace(trace).catch(err => {
        console.warn('[LocalClaw] Failed to save exec trace:', err)
      })

      // 📊 记录 Nexus 性能统计
      this.recordNexusPerformance(trace)
    }

    // 🔍 任务完成度验证 - 当没有最终响应或达到最大轮次时触发 (Legacy 模式)
    if (!finalResponse && traceTools.length > 0) {
      console.log('[LocalClaw/Legacy] No final response, validating task completion...')
      
      try {
        const validation = await this.validateTaskCompletion(userPrompt, traceTools, lastToolResult)
        
        // 🔄 升级机制：任务未完成且未达升级上限时，继续执行
        if (CONFIG.ESCALATION.ENABLED && 
            !validation.completed && 
            validation.completionRate < CONFIG.ESCALATION.MIN_COMPLETION_FOR_SKIP &&
            escalationCount < CONFIG.ESCALATION.MAX_ESCALATIONS) {
          
          escalationCount++
          currentMaxTurns += CONFIG.ESCALATION.EXTRA_TURNS
          
          console.log(`[LocalClaw/Legacy] 🔄 Task escalation #${escalationCount}: extending to ${currentMaxTurns} turns`)
          
          // 添加升级提示到消息历史
          messages.push({
            role: 'user',
            content: `[系统提示] 任务尚未完成 (完成度: ${Math.round(validation.completionRate)}%)。
待完成: ${validation.pendingSteps.join(', ') || '继续执行'}
原因: ${validation.failureReason || '未能达成目标'}

请继续执行任务，确保完成用户的原始请求。`,
          })
          
          this.storeActions?.addLog({
            id: `escalation-${Date.now()}`,
            timestamp: Date.now(),
            level: 'warn',
            message: `[升级] 任务未完成，扩展轮次 (+${CONFIG.ESCALATION.EXTRA_TURNS})，当前 ${escalationCount}/${CONFIG.ESCALATION.MAX_ESCALATIONS}`,
          })
          
          // 标记需要升级继续执行
          needEscalation = true
        }
        
        if (!needEscalation) {
          return this.formatTaskResult(validation, userPrompt, turnCount, currentMaxTurns)
        }
      } catch (validationError) {
        console.warn('[LocalClaw/Legacy] Task validation failed, using fallback:', validationError)
        
        // 降级：简单的工具调用总结
        const toolNames = traceTools.map(t => t.name).join('、')
        const successCount = traceTools.filter(t => t.status === 'success').length
        const failCount = traceTools.filter(t => t.status === 'error').length
        
        if (failCount > 0 || /Exit Code: (?!0)\d+/.test(lastToolResult)) {
          return `❌ **任务未能成功完成**\n\n**执行概要:**\n- 调用工具: ${toolNames}\n- 成功: ${successCount} / 失败: ${failCount}\n- 执行轮次: ${turnCount}/${currentMaxTurns}\n\n**说明:** 部分操作失败。请检查错误信息并重试，或提供更具体的指令。`
        }
        
        return `⚠️ **任务执行中断**\n\n**执行概要:**\n- 调用工具: ${toolNames}\n- 执行轮次: ${turnCount}/${currentMaxTurns}\n\n**说明:** AI 在工具调用后未能继续完成任务。请尝试更具体地描述你想要完成的目标。`
      }
    }
    } while (needEscalation)
    
    return finalResponse || '任务执行完成，但未生成总结。'
  }

  // ============================================
  // 🚀 ReAct 循环 - Function Calling 模式
  // ============================================

  /**
   * ReAct 循环 - 原生 Function Calling 模式
   * 使用 OpenAI-compatible tools API 实现工具调用
   */
  private async runReActLoopFC(
    userPrompt: string,
    onUpdate?: (content: string) => void,
    onStep?: (step: ExecutionStep) => void
  ): Promise<string> {
    this.storeActions?.setAgentStatus('thinking')

    // 复杂度感知轮次分配 (与 Legacy 保持一致)
    const isSimpleTask = userPrompt.length < 20 && 
      !userPrompt.match(/代码|编写|创建|修复|分析|部署|配置|脚本|搜索|安装|下载|code|create|fix|analyze|search|install/)
    const isHeavyTask = userPrompt.length > 80 ||
      !!userPrompt.match(/并且|然后|之后|同时|自动|批量|全部|and then|also|batch/)
    const maxTurns = isSimpleTask ? CONFIG.SIMPLE_TURNS : isHeavyTask ? CONFIG.MAX_REACT_TURNS : CONFIG.DEFAULT_TURNS
    console.log(`[LocalClaw/FC] Task complexity: ${isSimpleTask ? 'simple' : isHeavyTask ? 'heavy' : 'normal'}, maxTurns: ${maxTurns}`)

    // 🎯 Nexus 驱动：为当前任务准备精准工具集
    const { tools: taskTools, matchedNexus, isFiltered } = this.prepareToolsForTask(userPrompt)
    let currentTaskTools = taskTools

    // JIT: 动态构建上下文
    const { context: dynamicContext } = await this.buildDynamicContext(userPrompt)

    // 构建精简系统提示词 (FC 模式无需工具文档)
    const soulSummary = this.soulContent ? this.extractSoulSummary(this.soulContent) : ''
    const systemPrompt = SYSTEM_PROMPT_FC
      .replace('{soul_summary}', soulSummary || '一个友好、专业的 AI 助手')
      .replace('{context}', dynamicContext)

    // 转换工具为 OpenAI Function Calling 格式
    let tools = convertToolInfoToFunctions(currentTaskTools)
    console.log(`[LocalClaw/FC] Registered ${tools.length} functions${isFiltered ? ` (filtered for Nexus: ${matchedNexus?.label})` : ''}`)

    // 消息历史 (使用标准 OpenAI 格式)
    const messages: SimpleChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    let turnCount = 0
    let finalResponse = ''
    let lastToolResult = ''
    let consecutiveFailures = 0  // 连续失败计数 (用于触发重规划)
    const MAX_CONSECUTIVE_FAILURES = 2  // 连续失败阈值
    const errorSignatureHistory: string[] = []  // 错误签名追踪 (防 Reflexion 死循环)
    
    // 🔄 升级机制状态
    let currentMaxTurns = maxTurns
    let escalationCount = 0
    let needEscalation = false

    // P2: 执行追踪收集
    const traceTools: ExecTraceToolCall[] = []
    const traceStartTime = Date.now()

    // 外层升级循环
    do {
      needEscalation = false
      
      // 主循环
      while (turnCount < currentMaxTurns) {
        turnCount++
        console.log(`[LocalClaw/FC] Turn ${turnCount}`)

        try {
          // 调用 LLM (带 tools 参数)
          let streamedContent = ''
        const result: LLMStreamResult = await streamChat(
          messages,
          (chunk) => {
            streamedContent += chunk
            onUpdate?.(streamedContent)
          },
          undefined, // signal
          undefined, // config
          tools
        )

        const { content, toolCalls, finishReason, reasoningContent } = result
        console.log(`[LocalClaw/FC] finish_reason: ${finishReason}, toolCalls: ${toolCalls.length}`)

        // 判断是否有工具调用
        if (toolCalls.length > 0) {
          // 构建 assistant 消息 (包含 tool_calls)
          // DeepSeek 思维模式: 必须传递 reasoning_content
          const assistantMsg: SimpleChatMessage = {
            role: 'assistant',
            content: content || null,
            tool_calls: toolCalls.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: tc.function,
            })),
            ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
          }
          messages.push(assistantMsg)

          // 逐个执行工具并收集结果
          for (const tc of toolCalls) {
            const toolName = tc.function.name
            let toolArgs: Record<string, unknown> = {}
            
            try {
              toolArgs = JSON.parse(tc.function.arguments || '{}')
            } catch {
              console.warn(`[LocalClaw/FC] Failed to parse args for ${toolName}:`, tc.function.arguments)
            }

            // 发送思考步骤 (如果有 content)
            if (content) {
              onStep?.({
                id: `think-${Date.now()}`,
                type: 'thinking',
                content: content.slice(0, 500),
                timestamp: Date.now(),
              })
            }

            // 🛡️ P3: 危险操作检测 + 用户审批 (与 Legacy 保持一致)
            if (CONFIG.HIGH_RISK_TOOLS.includes(toolName)) {
              const argsStr = JSON.stringify(toolArgs)
              const argsLower = argsStr.toLowerCase()
              const matchedDanger = CONFIG.DANGER_PATTERNS.find(p =>
                argsLower.includes(p.pattern.toLowerCase())
              )

              if (matchedDanger) {
                this.storeActions?.addLog({
                  id: `precheck-${Date.now()}`,
                  timestamp: Date.now(),
                  level: 'warn',
                  message: `[PreCheck] 检测到危险操作 (${matchedDanger.reason}): ${argsStr.slice(0, 100)}`,
                })

                let approved = false
                if (this.storeActions?.requestApproval) {
                  try {
                    approved = await this.storeActions.requestApproval({
                      toolName,
                      args: toolArgs,
                      dangerLevel: matchedDanger.level,
                      reason: matchedDanger.reason,
                    })
                  } catch {
                    approved = false
                  }
                }

                if (!approved) {
                  // 用户拒绝：返回错误消息让 LLM 重新思考
                  messages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: `操作被用户拒绝。原因: ${matchedDanger.reason} (风险等级: ${matchedDanger.level})。请使用更安全的替代方案。`,
                  })
                  continue
                }
              }
            }

            // 执行工具
            this.storeActions?.setAgentStatus('executing')
            this.storeActions?.addLog({
              id: `tool-${Date.now()}`,
              timestamp: Date.now(),
              level: 'info',
              message: `调用工具: ${toolName}`,
            })

            onStep?.({
              id: `call-${Date.now()}`,
              type: 'tool_call',
              content: JSON.stringify(toolArgs, null, 2),
              toolName,
              toolArgs,
              timestamp: Date.now(),
            })

            const toolStartTime = Date.now()
            const toolResult = await this.executeTool({ name: toolName, args: toolArgs })
            const toolLatency = Date.now() - toolStartTime

            onStep?.({
              id: `result-${Date.now()}`,
              type: toolResult.status === 'error' ? 'error' : 'tool_result',
              content: toolResult.result.slice(0, 2000),
              toolName,
              duration: toolLatency,
              timestamp: Date.now(),
            })

            // P2: 记录到执行追踪
            traceTools.push({
              name: toolName,
              args: toolArgs,
              status: toolResult.status === 'error' ? 'error' : 'success',
              latency: toolLatency,
              order: traceTools.length + 1,
            })

            lastToolResult = toolResult.result

            // 🧠 FC 模式增强: Reflexion + Critic 机制
            if (toolResult.status === 'error') {
              consecutiveFailures++
              
              // 📝 记录失败教训到短暂层
              const failureLesson = `工具 ${toolName} 执行失败: ${toolResult.result.slice(0, 200)}`
              this.logToEphemeral(failureLesson, 'thought').catch(() => {})

              // 🧬 能力缺失检测
              this.detectAndRecordCapabilityGap(toolName, toolResult.result, userPrompt)

              // 🎯 Layer 3: 运行时动态扩展 - 工具不足时自动补充
              if (isFiltered) {
                const expanded = this.expandToolsForReflexion(currentTaskTools, toolName, toolResult.result)
                if (expanded) {
                  currentTaskTools = expanded
                  tools = convertToolInfoToFunctions(currentTaskTools)
                  console.log(`[NexusRouter/FC] Expanded toolset to ${tools.length} after "${toolName}" missing`)
                }
                // 连续失败 2+ 次且仍在过滤模式 → 解锁全量工具
                if (consecutiveFailures >= 2 && currentTaskTools.length < this.availableTools.length) {
                  currentTaskTools = this.availableTools
                  tools = convertToolInfoToFunctions(currentTaskTools)
                  console.log(`[NexusRouter/FC] Safety unlock: full toolset (${tools.length}) after ${consecutiveFailures} failures`)
                }
              }
              
              // 🛡️ 错误签名追踪: 检测重复错误防止死循环
              const errorSig = `${toolName}:${toolResult.result.slice(0, 100)}`
              errorSignatureHistory.push(errorSig)
              const repeatCount = errorSignatureHistory.filter(e => e === errorSig).length
              
              if (repeatCount >= 2) {
                // 🚨 危机干预: 相同错误已出现2+次, 强制策略变更
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: toolResult.result + `

[CRITICAL - 重复错误检测]
工具 ${toolName} 已连续 ${repeatCount} 次产生相同错误。禁止再次使用相同参数调用此工具。
你必须选择以下策略之一:
1. 使用完全不同的工具或方法达成目标
2. 彻底修改参数后重试（不能与之前相同）
3. 跳过此步骤，继续执行后续任务
不要重复之前的失败操作。`,
                  name: toolName,
                })
                
                this.storeActions?.addLog({
                  id: `reflexion-crisis-${Date.now()}`,
                  timestamp: Date.now(),
                  level: 'error',
                  message: `[Reflexion] 检测到重复错误(${repeatCount}次)，强制策略变更: ${toolName}`,
                })
              } else {
                // 🔄 Reflexion: 结构化反思提示 - 让 LLM 分析失败原因
                const nexusSkillCtxFC = this.buildNexusSkillContext()
                const reflexionHint = `

[系统提示 - Reflexion 反思机制]
工具执行失败。在下一步操作前，请先进行结构化反思：
1. **根本原因**: 是路径错误？参数错误？权限问题？工具不支持？
2. **修正方案**: 如何调整参数或换用其他工具/方法？
3. **预防措施**: 如何避免再次出错？${nexusSkillCtxFC ? `
4. **技能充足性**: 当前 Nexus 的技能是否足以完成任务？如果缺少必要技能，可使用 nexusBindSkill 添加；如果某技能不适用，可使用 nexusUnbindSkill 移除。${nexusSkillCtxFC}` : ''}

请根据反思结果调整你的下一步操作。`
              
                // 将反思提示追加到工具结果中
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: toolResult.result + reflexionHint,
                  name: toolName,
                })
                
                this.storeActions?.addLog({
                  id: `reflexion-${Date.now()}`,
                  timestamp: Date.now(),
                  level: 'warn',
                  message: `[Reflexion] 触发反思机制，分析 ${toolName} 失败原因`,
                })
              }
              
              // 🔄 连续失败过多 → 提示重新规划
              if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                const replanHint = `
[系统提示 - 连续失败警告]
已连续失败 ${consecutiveFailures} 次。建议：
- 重新评估任务可行性
- 考虑完全不同的实现方案
- 如果无法解决，向用户说明困难并请求指导`
                
                messages.push({
                  role: 'user',
                  content: replanHint,
                })
                
                this.storeActions?.addLog({
                  id: `replan-hint-${Date.now()}`,
                  timestamp: Date.now(),
                  level: 'warn',
                  message: `[ReAct] 连续失败 ${consecutiveFailures} 次，提示重新规划`,
                })
              }
            } else {
              // 成功时重置连续失败计数
              consecutiveFailures = 0
              
              // 🔍 Critic 自检: 修改类工具成功后触发验证
              const needsCritic = CONFIG.CRITIC_TOOLS.includes(toolName)
              
              if (needsCritic) {
                const nexusSkillCtxFCCritic = this.buildNexusSkillContext()
                const recentToolNamesFC = traceTools.slice(-5).map(t => t.name).join(', ')
                const criticHint = `

[系统提示 - Critic 自检机制]
${toolName} 执行成功。请验证：
1. 结果是否完全满足用户的原始需求？
2. 是否有潜在问题需要修正？
3. 是否需要额外操作来完善？${nexusSkillCtxFCCritic ? `
4. **技能优化**: 本次使用了 [${recentToolNamesFC}]。当前 Nexus 是否有未使用的冗余技能？是否需要新技能？${nexusSkillCtxFCCritic}` : ''}

如果满足需求，给出最终回复。如果发现问题，自行修正。`
                
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: toolResult.result + criticHint,
                  name: toolName,
                })
                
                this.storeActions?.addLog({
                  id: `critic-${Date.now()}`,
                  timestamp: Date.now(),
                  level: 'info',
                  message: `[Critic] 验证 ${toolName} 执行结果`,
                })
              } else {
                // 非修改类工具：直接添加结果
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: toolResult.result,
                  name: toolName,
                })
              }
            }

            // P5: 更新最近操作的实体 (用于指代消解) - FC 模式
            if (toolResult.status === 'success') {
              this.updateRecentEntities(toolName, toolArgs, toolResult.result)

              // 追踪文件创建事件 - FC 模式
              if (toolName === 'writeFile') {
                try {
                  const parsed = JSON.parse(toolResult.result)
                  if (parsed.action === 'file_created' && parsed.filePath) {
                    this._lastCreatedFiles.push({
                      filePath: parsed.filePath,
                      fileName: parsed.fileName || '',
                      message: parsed.message || '',
                      fileSize: parsed.fileSize,
                    })
                  }
                } catch { /* 非 JSON 结果，忽略 */ }
              }
            }

            // 🔄 技能变更检测 (与 Legacy 保持一致)
            if ((toolName === 'runCmd' && (
              toolResult.result.includes('Skill installed') ||
              toolResult.result.includes('tools registered') ||
              toolResult.result.includes('git clone')
            )) ||
            // writeFile 写入 skills/ 目录也触发刷新
            (toolName === 'writeFile' && toolResult.status !== 'error' && 
              String(toolArgs.path || '').replace(/\\/g, '/').includes('skills/'))) {
              try {
                await this.loadTools()
                await this.loadAllDataToStore()
                console.log('[LocalClaw/FC] Tools & skills refreshed mid-loop')
              } catch {
                console.warn('[LocalClaw/FC] Failed to refresh tools mid-loop')
              }
            }

            // 🌌 Nexus 技能绑定变更检测 (FC 模式)
            if ((toolName === 'nexusBindSkill' || toolName === 'nexusUnbindSkill') &&
                toolResult.status === 'success') {
              try {
                await this.loadAllDataToStore()
                console.log('[LocalClaw/FC] Nexus skills refreshed after self-adaptation')
              } catch {
                console.warn('[LocalClaw/FC] Failed to refresh nexuses after skill adaptation')
              }
            }
          }

          this.storeActions?.setAgentStatus('thinking')
        } else {
          // 无工具调用 - LLM 直接回复用户
          finalResponse = content || ''
          
          onStep?.({
            id: `output-${Date.now()}`,
            type: 'output',
            content: finalResponse.slice(0, 2000),
            timestamp: Date.now(),
          })

          // 记录响应摘要
          const summary = finalResponse.slice(0, 100).replace(/\n/g, ' ')
          this.logToEphemeral(`回复: ${summary}...`, 'result').catch(() => {})

          break
        }
      } catch (error: any) {
        console.error('[LocalClaw/FC] ReAct error:', error)
        finalResponse = `执行出错: ${error.message}`
        break
      }
    }

    this.storeActions?.setAgentStatus('idle')

    // P2: 保存执行追踪 (含 Observer 元数据)
    const activeNexusId = this.getActiveNexusId()
    if (traceTools.length > 0) {
      const errorCount = traceTools.filter(t => t.status === 'error').length
      
      const trace: ExecTrace = {
        id: `trace-${traceStartTime}`,
        task: userPrompt.slice(0, 200),
        tools: traceTools,
        success: traceTools.every(t => t.status === 'success'),
        duration: Date.now() - traceStartTime,
        timestamp: traceStartTime,
        tags: userPrompt.split(/\s+/).filter(w => w.length > 2 && w.length < 15).slice(0, 5),
        // Observer 元数据
        turnCount,
        errorCount,
        skillIds: [],
        activeNexusId: activeNexusId || undefined,
      }
      this.saveExecTrace(trace).catch(err => {
        console.warn('[LocalClaw/FC] Failed to save exec trace:', err)
      })

      // 📊 记录 Nexus 性能统计
      this.recordNexusPerformance(trace)

      // P4: Nexus 经验记录
      if (activeNexusId) {
        const success = traceTools.every(t => t.status === 'success')
        this.recordNexusExperience(
          activeNexusId,
          userPrompt,
          traceTools.map(t => t.name),
          success,
          finalResponse || ''
        ).catch(err => {
          console.warn('[LocalClaw/FC] Failed to record Nexus experience:', err)
        })
      }
    }

    // 🔍 任务完成度验证 - 当没有最终响应或达到最大轮次时触发
    if (!finalResponse && traceTools.length > 0) {
      console.log('[LocalClaw/FC] No final response, validating task completion...')
      
      try {
        const validation = await this.validateTaskCompletion(userPrompt, traceTools, lastToolResult)
        
        // 🔄 升级机制：任务未完成且未达升级上限时，继续执行
        if (CONFIG.ESCALATION.ENABLED && 
            !validation.completed && 
            validation.completionRate < CONFIG.ESCALATION.MIN_COMPLETION_FOR_SKIP &&
            escalationCount < CONFIG.ESCALATION.MAX_ESCALATIONS) {
          
          escalationCount++
          currentMaxTurns += CONFIG.ESCALATION.EXTRA_TURNS
          
          console.log(`[LocalClaw/FC] 🔄 Task escalation #${escalationCount}: extending to ${currentMaxTurns} turns`)
          
          // 添加升级提示到消息历史
          messages.push({
            role: 'user',
            content: `[系统提示] 任务尚未完成 (完成度: ${Math.round(validation.completionRate)}%)。
待完成: ${validation.pendingSteps.join(', ') || '继续执行'}
原因: ${validation.failureReason || '未能达成目标'}

请继续执行任务，确保完成用户的原始请求。`,
          })
          
          this.storeActions?.addLog({
            id: `escalation-${Date.now()}`,
            timestamp: Date.now(),
            level: 'warn',
            message: `[升级] 任务未完成，扩展轮次 (+${CONFIG.ESCALATION.EXTRA_TURNS})，当前 ${escalationCount}/${CONFIG.ESCALATION.MAX_ESCALATIONS}`,
          })
          
          // 标记需要升级继续执行
          needEscalation = true
        }
        
        if (!needEscalation) {
          // 返回验证结果
          return this.formatTaskResult(validation, userPrompt, turnCount, currentMaxTurns)
        }
      } catch (validationError) {
        console.warn('[LocalClaw/FC] Task validation failed, using fallback:', validationError)
        
        // 降级：简单的工具调用总结
        const toolNames = traceTools.map(t => t.name).join('、')
        const successCount = traceTools.filter(t => t.status === 'success').length
        const failCount = traceTools.filter(t => t.status === 'error').length
        
        if (failCount > 0 || /Exit Code: (?!0)\d+/.test(lastToolResult)) {
          return `❌ **任务未能成功完成**\n\n**执行概要:**\n- 调用工具: ${toolNames}\n- 成功: ${successCount} / 失败: ${failCount}\n- 执行轮次: ${turnCount}/${currentMaxTurns}\n\n**说明:** 部分操作失败。请检查错误信息并重试，或提供更具体的指令。`
        }
        
        return `⚠️ **任务执行中断**\n\n**执行概要:**\n- 调用工具: ${toolNames}\n- 执行轮次: ${turnCount}/${currentMaxTurns}\n\n**说明:** AI 在工具调用后未能继续完成任务。请尝试更具体地描述你想要完成的目标。`
      }
    }
    } while (needEscalation)
    
    return finalResponse || '任务执行完成，但未生成总结。'
  }

  // ============================================
  // 📋 任务规划器
  // ============================================

  private async generatePlan(prompt: string): Promise<PlanStep[]> {
    const plannerPrompt = PLANNER_PROMPT.replace('{prompt}', prompt)

    try {
      const response = await chat([{ role: 'user', content: plannerPrompt }])

      // 提取 JSON
      const jsonMatch = response.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        let plan = JSON.parse(jsonMatch[0]) as PlanStep[]
        plan = plan.slice(0, CONFIG.MAX_PLAN_STEPS).map((step, i) => ({
          ...step,
          id: i + 1,
          status: 'pending' as const,
        }))

        // 🔍 Plan Review: 批评者机制
        console.log('[LocalClaw] Initial plan generated, running review...')
        const reviewedPlan = await this.reviewPlan(prompt, plan)
        return reviewedPlan
      }
    } catch (error) {
      console.error('[LocalClaw] Plan generation failed:', error)
    }

    // 降级：单步计划
    return [{ id: 1, description: prompt, status: 'pending' }]
  }

  /**
   * 计划审查 (Critic/Refine)
   * 通过 LLM 二次检查计划的完整性和逻辑性
   */
  private async reviewPlan(prompt: string, plan: PlanStep[]): Promise<PlanStep[]> {
    try {
      const planJson = JSON.stringify(plan.map(s => ({
        id: s.id,
        description: s.description,
        tool: s.tool,
      })), null, 2)

      const reviewPrompt = PLAN_REVIEW_PROMPT
        .replace('{prompt}', prompt)
        .replace('{plan}', planJson)

      const response = await chat([{ role: 'user', content: reviewPrompt }])

      const jsonMatch = response.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const reviewed = JSON.parse(jsonMatch[0]) as PlanStep[]
        const refinedPlan = reviewed.slice(0, CONFIG.MAX_PLAN_STEPS).map((step, i) => ({
          ...step,
          id: i + 1,
          status: 'pending' as const,
        }))

        console.log(`[LocalClaw] Plan reviewed: ${plan.length} -> ${refinedPlan.length} steps`)
        return refinedPlan
      }
    } catch (error) {
      console.warn('[LocalClaw] Plan review failed, using original:', error)
    }

    // Review 失败则使用原计划
    return plan
  }

  private async executeStep(step: PlanStep, fullPlan: PlanStep[]): Promise<string> {
    // 构建上下文
    const completedSteps = fullPlan
      .filter((s) => s.status === 'completed')
      .map((s) => `步骤 ${s.id}: ${s.description}\n结果: ${s.result}`)
      .join('\n\n')

    const context = completedSteps
      ? `已完成的步骤:\n${completedSteps}\n\n当前任务: ${step.description}`
      : `当前任务: ${step.description}`

    return await this.runReActLoop(context)
  }

  private async synthesizeReport(originalPrompt: string, plan: PlanStep[]): Promise<string> {
    const stepsReport = plan
      .map((s) => `${s.id}. ${s.description}\n   状态: ${s.status}\n   结果: ${s.result || '无'}`)
      .join('\n\n')

    const summaryPrompt = `请根据以下执行结果，为用户总结任务完成情况。

原始请求: ${originalPrompt}

执行步骤:
${stepsReport}

请用简洁的语言总结：`

    try {
      return await chat([{ role: 'user', content: summaryPrompt }])
    } catch {
      return `任务执行完成。\n\n${stepsReport}`
    }
  }

  // ============================================
  // 🎯 Quest 风格任务规划系统
  // ============================================

  /**
   * 生成 Quest 风格的任务计划（DAG 结构）
   * 将复杂任务分解为有依赖关系的子任务
   */
  async generateQuestPlan(userPrompt: string, nexusId?: string): Promise<TaskPlan> {
    console.log('[LocalClaw] Generating Quest plan for:', userPrompt.slice(0, 50))

    // 构建 Nexus 上下文（如果有）
    let nexusContext = '无'
    if (nexusId) {
      const nexusCtx = await this.buildNexusContext(nexusId, userPrompt)
      if (nexusCtx) {
        nexusContext = nexusCtx
      }
    }

    const plannerPrompt = QUEST_PLANNER_PROMPT
      .replace('{prompt}', userPrompt)
      .replace('{nexus_context}', nexusContext)

    try {
      const response = await chat([{ role: 'user', content: plannerPrompt }])

      // 提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { title: string; subTasks: SubTask[] }
        
        // 验证和规范化子任务
        const subTasks: SubTask[] = parsed.subTasks.slice(0, CONFIG.MAX_PLAN_STEPS).map((task, i) => ({
          id: task.id || `t${i + 1}`,
          description: task.description,
          toolHint: task.toolHint,
          status: 'pending' as SubTaskStatus,
          dependsOn: task.dependsOn || [],
          approvalRequired: task.approvalRequired || false,
          approvalReason: task.approvalReason,
          retryCount: 0,
          maxRetries: 2,
        }))

        // 验证依赖关系（检测循环依赖）
        if (!this.validateTaskDependencies(subTasks)) {
          console.warn('[LocalClaw] Invalid dependencies detected, fixing...')
          // 简单修复：移除无效依赖
          subTasks.forEach(task => {
            task.dependsOn = task.dependsOn.filter(dep => 
              subTasks.some(t => t.id === dep)
            )
          })
        }

        const plan: TaskPlan = {
          id: `plan-${Date.now()}`,
          title: parsed.title || userPrompt.slice(0, 50),
          userPrompt,
          subTasks,
          status: 'planning',
          nexusId,
          createdAt: Date.now(),
          progress: 0,
          maxParallel: 3,
        }

        console.log(`[LocalClaw] Quest plan generated: ${subTasks.length} sub-tasks`)
        return plan
      }
    } catch (error) {
      console.error('[LocalClaw] Quest plan generation failed:', error)
    }

    // 降级：单任务计划
    return {
      id: `plan-${Date.now()}`,
      title: userPrompt.slice(0, 50),
      userPrompt,
      subTasks: [{
        id: 't1',
        description: userPrompt,
        status: 'pending',
        dependsOn: [],
        retryCount: 0,
        maxRetries: 2,
      }],
      status: 'planning',
      nexusId,
      createdAt: Date.now(),
      progress: 0,
      maxParallel: 1,
    }
  }

  /**
   * 验证任务依赖关系（检测循环依赖）
   */
  private validateTaskDependencies(subTasks: SubTask[]): boolean {
    const taskIds = new Set(subTasks.map(t => t.id))
    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    const hasCycle = (taskId: string): boolean => {
      if (recursionStack.has(taskId)) return true
      if (visited.has(taskId)) return false

      visited.add(taskId)
      recursionStack.add(taskId)

      const task = subTasks.find(t => t.id === taskId)
      if (task) {
        for (const dep of task.dependsOn) {
          if (!taskIds.has(dep)) continue // 忽略无效依赖
          if (hasCycle(dep)) return true
        }
      }

      recursionStack.delete(taskId)
      return false
    }

    for (const task of subTasks) {
      if (hasCycle(task.id)) {
        console.error('[LocalClaw] Circular dependency detected involving:', task.id)
        return false
      }
    }

    return true
  }

  /**
   * 获取就绪的子任务（依赖已满足）
   */
  private getReadySubTasks(plan: TaskPlan): SubTask[] {
    return plan.subTasks.filter(task => {
      if (task.status !== 'pending') return false
      
      // 检查所有依赖是否已完成
      return task.dependsOn.every(depId => {
        const depTask = plan.subTasks.find(t => t.id === depId)
        return depTask && (depTask.status === 'done' || depTask.status === 'skipped')
      })
    })
  }

  /**
   * 计算任务计划进度（0-100）
   */
  private calculatePlanProgress(plan: TaskPlan): number {
    const total = plan.subTasks.length
    if (total === 0) return 100
    
    const completed = plan.subTasks.filter(
      t => t.status === 'done' || t.status === 'skipped'
    ).length
    
    return Math.round((completed / total) * 100)
  }

  /**
   * 执行 Quest 风格的任务计划
   * 支持依赖管理和并行执行
   */
  async executeQuestPlan(
    plan: TaskPlan,
    onProgress?: (plan: TaskPlan, currentTask?: SubTask) => void,
    onApprovalRequired?: (task: SubTask) => Promise<'approve' | 'skip' | 'cancel'>
  ): Promise<string> {
    console.log('[LocalClaw] Executing Quest plan:', plan.title)
    
    plan.status = 'executing'
    plan.startedAt = Date.now()
    onProgress?.(plan)

    const maxParallel = plan.maxParallel || 3

    while (true) {
      // 获取就绪任务
      const readyTasks = this.getReadySubTasks(plan)
      
      // 检查是否完成
      if (readyTasks.length === 0) {
        const pendingTasks = plan.subTasks.filter(t => t.status === 'pending')
        const blockedTasks = plan.subTasks.filter(t => t.status === 'blocked')
        
        if (pendingTasks.length === 0 && blockedTasks.length === 0) {
          // 全部完成
          break
        }
        
        // 有阻塞的任务（可能是依赖失败）
        if (pendingTasks.length > 0) {
          // 标记被阻塞的任务
          pendingTasks.forEach(task => {
            const hasFailedDep = task.dependsOn.some(depId => {
              const dep = plan.subTasks.find(t => t.id === depId)
              return dep && dep.status === 'failed'
            })
            if (hasFailedDep) {
              task.status = 'blocked'
              const failedDepNames = task.dependsOn
                .map(depId => plan.subTasks.find(t => t.id === depId))
                .filter(dep => dep && dep.status === 'failed')
                .map(dep => `[${dep!.id}] ${dep!.description}`)
              task.blockReason = `依赖的任务失败: ${failedDepNames.join(', ')}`
            }
          })
          
          // 重新检查
          const stillReady = this.getReadySubTasks(plan)
          if (stillReady.length === 0) {
            console.warn('[LocalClaw] All remaining tasks are blocked')
            break
          }
        } else {
          break
        }
        
        continue
      }

      // 检查是否有需要审批的任务
      const needsApproval = readyTasks.find(t => t.approvalRequired && t.status === 'pending')
      if (needsApproval && onApprovalRequired) {
        needsApproval.status = 'paused_for_approval'
        onProgress?.(plan, needsApproval)
        
        const decision = await onApprovalRequired(needsApproval)
        
        if (decision === 'cancel') {
          plan.status = 'cancelled'
          onProgress?.(plan)
          return '任务已取消'
        } else if (decision === 'skip') {
          needsApproval.status = 'skipped'
          plan.progress = this.calculatePlanProgress(plan)
          onProgress?.(plan)
          continue
        } else {
          needsApproval.status = 'pending'
          needsApproval.approvalRequired = false // 已批准，不再需要
        }
      }

      // 选择要执行的任务（最多 maxParallel 个）
      const tasksToExecute = readyTasks
        .filter(t => t.status === 'pending')
        .slice(0, maxParallel)

      if (tasksToExecute.length === 0) continue

      // 并行执行
      const execPromises = tasksToExecute.map(async (task) => {
        task.status = 'executing'
        task.startTime = Date.now()
        onProgress?.(plan, task)

        try {
          // 构建子任务上下文
          const completedContext = plan.subTasks
            .filter(t => t.status === 'done')
            .map(t => `[${t.id}] ${t.description}: ${t.result?.slice(0, 200) || '完成'}`)
            .join('\n')

          const taskPrompt = completedContext
            ? `基于已完成的步骤:\n${completedContext}\n\n当前任务: ${task.description}`
            : task.description

          // 执行 ReAct 循环
          const result = await this.runReActLoop(taskPrompt)
          
          task.status = 'done'
          task.result = result
          task.endTime = Date.now()
          
        } catch (error) {
          task.retryCount = (task.retryCount || 0) + 1
          
          if (task.retryCount < (task.maxRetries || 2)) {
            // 重试
            task.status = 'pending'
            task.error = `重试 ${task.retryCount}/${task.maxRetries}: ${error}`
          } else {
            // 最终失败
            task.status = 'failed'
            task.error = String(error)
            task.endTime = Date.now()
          }
        }
      })

      await Promise.allSettled(execPromises)
      
      // 更新进度
      plan.progress = this.calculatePlanProgress(plan)
      onProgress?.(plan)
    }

    // 确定最终状态
    const failedTasks = plan.subTasks.filter(t => t.status === 'failed')
    const blockedTasks = plan.subTasks.filter(t => t.status === 'blocked')
    
    if (failedTasks.length > 0 || blockedTasks.length > 0) {
      plan.status = 'failed'
    } else {
      plan.status = 'done'
    }
    
    plan.completedAt = Date.now()
    plan.progress = this.calculatePlanProgress(plan)
    onProgress?.(plan)

    // 生成总结
    return this.synthesizeQuestReport(plan)
  }

  /**
   * 生成 Quest 任务执行报告
   */
  private async synthesizeQuestReport(plan: TaskPlan): Promise<string> {
    const tasksSummary = plan.subTasks.map(t => {
      const statusEmoji = {
        done: '✅',
        failed: '❌',
        skipped: '⏭️',
        blocked: '🚫',
        pending: '⏳',
        executing: '🔄',
        ready: '🟢',
        paused_for_approval: '⏸️',
      }[t.status] || '❓'
      
      return `${statusEmoji} [${t.id}] ${t.description}${t.result ? `\n   结果: ${t.result.slice(0, 100)}` : ''}${t.error ? `\n   错误: ${t.error}` : ''}`
    }).join('\n\n')

    const summaryPrompt = `请根据以下 Quest 任务执行结果，为用户生成简洁的总结报告。

原始请求: ${plan.userPrompt}

执行进度: ${plan.progress}%

子任务执行情况:
${tasksSummary}

请用简洁的语言总结任务完成情况，突出关键结果：`

    try {
      return await chat([{ role: 'user', content: summaryPrompt }])
    } catch {
      return `任务执行完成 (${plan.progress}%)\n\n${tasksSummary}`
    }
  }

  // ============================================
  // 🔍 任务完成度验证 (Task Completion Validation)
  // ============================================

  /**
   * 验证任务是否真正完成
   * 在 ReAct 循环结束后调用，评估是否满足用户意图
   */
  private async validateTaskCompletion(
    userPrompt: string,
    traceTools: ExecTraceToolCall[],
    lastToolResult: string
  ): Promise<TaskCompletionResult> {
    // 构建执行日志
    const executionLog = traceTools.map((t, i) => {
      const statusEmoji = t.status === 'success' ? '✓' : '✗'
      const argsStr = JSON.stringify(t.args).slice(0, 100)
      return `${i + 1}. [${statusEmoji}] ${t.name}(${argsStr})`
    }).join('\n')

    const successCount = traceTools.filter(t => t.status === 'success').length
    const failCount = traceTools.filter(t => t.status === 'error').length

    // 包含最后的工具结果以便更准确判断
    const lastResultSummary = lastToolResult 
      ? `\n\n**最后工具返回 (摘要):**\n${lastToolResult.slice(0, 500)}`
      : ''

    // 🎯 获取 Nexus 目标函数验收标准 (如果有)
    let nexusMetricsSection = ''
    const activeNexusId = this.getActiveNexusId()
    if (activeNexusId) {
      const nexuses: Map<string, NexusEntity> | undefined = (this.storeActions as any)?.nexuses
      const nexus = nexuses?.get(activeNexusId)
      if (nexus?.objective && nexus.metrics && nexus.metrics.length > 0) {
        nexusMetricsSection = `
**🎯 Nexus 目标函数验收标准:**
目标: ${nexus.objective}
验收检查点:
${nexus.metrics.map((m, i) => `${i + 1}. ${m}`).join('\n')}

请逐一评估每个检查点是否满足，并在输出的 metricsStatus 字段中说明。
`
      }
    }

    const prompt = TASK_COMPLETION_PROMPT
      .replace('{user_prompt}', userPrompt)
      .replace('{execution_log}', (executionLog || '无工具调用') + lastResultSummary)
      .replace('{tool_count}', String(traceTools.length))
      .replace('{success_count}', String(successCount))
      .replace('{fail_count}', String(failCount))
      .replace('{nexus_metrics_section}', nexusMetricsSection)

    try {
      const response = await chat([{ role: 'user', content: prompt }])
      
      // 提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]) as TaskCompletionResult
        console.log(`[LocalClaw] Task completion validated: ${result.completed} (${result.completionRate}%)`)
        return result
      }
    } catch (error) {
      console.warn('[LocalClaw] Task completion validation failed:', error)
    }

    // 降级：基于工具调用结果判断
    const allSuccess = traceTools.length > 0 && traceTools.every(t => t.status === 'success')
    return {
      completed: allSuccess,
      completionRate: allSuccess ? 100 : (successCount / Math.max(traceTools.length, 1)) * 100,
      summary: allSuccess ? '工具调用成功完成' : '部分操作未能成功',
      completedSteps: traceTools.filter(t => t.status === 'success').map(t => t.name),
      pendingSteps: [],
      failureReason: allSuccess ? undefined : '存在失败的工具调用',
      nextSteps: allSuccess ? undefined : ['请检查错误信息并重试'],
    }
  }

  /**
   * 生成结构化的任务结果反馈
   * 当任务未完成或达到最大轮次时，提供有意义的反馈
   */
  private formatTaskResult(
    validation: TaskCompletionResult,
    userPrompt: string,
    turnCount: number,
    maxTurns: number
  ): string {
    if (validation.completed && validation.completionRate >= 80) {
      // 任务完成
      return `✅ **任务完成**\n\n${validation.summary}\n\n**执行步骤:**\n${validation.completedSteps.map(s => `- ${s}`).join('\n')}`
    }

    // 任务未完成
    const sections: string[] = []

    sections.push(`⚠️ **任务未能完全完成** (完成度: ${Math.round(validation.completionRate)}%)`)
    sections.push(`\n**原始请求:** ${userPrompt.slice(0, 100)}${userPrompt.length > 100 ? '...' : ''}`)
    sections.push(`\n**执行概要:** ${validation.summary}`)

    if (validation.completedSteps.length > 0) {
      sections.push(`\n**已完成:**\n${validation.completedSteps.map(s => `✓ ${s}`).join('\n')}`)
    }

    if (validation.pendingSteps.length > 0) {
      sections.push(`\n**待完成:**\n${validation.pendingSteps.map(s => `○ ${s}`).join('\n')}`)
    }

    if (validation.failureReason) {
      sections.push(`\n**未完成原因:** ${validation.failureReason}`)
    }

    if (turnCount >= maxTurns) {
      sections.push(`\n**注意:** 已达到最大执行轮次 (${maxTurns})，任务被中断。`)
    }

    if (validation.nextSteps && validation.nextSteps.length > 0) {
      sections.push(`\n**建议下一步:**\n${validation.nextSteps.map(s => `→ ${s}`).join('\n')}`)
    }

    return sections.join('\n')
  }

  // ============================================
  // 📊 P2: 执行追踪管理
  // ============================================

  /**
   * 保存执行追踪到后端
   */
  private async saveExecTrace(trace: ExecTrace): Promise<void> {
    try {
      const res = await fetch(`${this.serverUrl}/api/traces/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trace),
      })
      if (res.ok) {
        console.log(`[LocalClaw] Exec trace saved: ${trace.id} (${trace.tools.length} tools)`)
      }
    } catch (err) {
      console.warn('[LocalClaw] Failed to save exec trace:', err)
    }
  }

  /**
   * 搜索相关执行追踪 (用于上下文注入)
   */
  private async searchExecTraces(query: string, limit = 3): Promise<ExecTrace[]> {
    try {
      const url = `${this.serverUrl}/api/traces/search?query=${encodeURIComponent(query)}&limit=${limit}`
      const res = await fetch(url)
      if (res.ok) {
        return await res.json()
      }
    } catch (err) {
      console.warn('[LocalClaw] Failed to search traces:', err)
    }
    return []
  }

  // ============================================
  // 🛠️ 工具执行
  // ============================================

  /**
   * 解析工具调用 (JSON 格式)
   * 支持错误自修正：尝试多种格式解析
   */
  private parseToolCall(text: string): ToolCall | null {
    // 方法1: 标准 JSON 代码块
    const jsonBlockMatch = text.match(/```json\s*\n?([\s\S]*?)\n?```/)
    if (jsonBlockMatch) {
      const parsed = this.tryParseToolJson(jsonBlockMatch[1])
      if (parsed) return parsed
    }

    // 方法2: 无标记的 JSON 代码块
    const plainBlockMatch = text.match(/```\s*\n?(\{[\s\S]*?\})\n?```/)
    if (plainBlockMatch) {
      const parsed = this.tryParseToolJson(plainBlockMatch[1])
      if (parsed) return parsed
    }

    // 方法3: 行内 JSON (无代码块) - tool 是第一个 key
    const inlineMatch = text.match(/\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[^}]*\}\s*\}/)
    if (inlineMatch) {
      const parsed = this.tryParseToolJson(inlineMatch[0])
      if (parsed) return parsed
    }

    // 方法3b: 通用 JSON 提取 - tool 不是第一个 key (如 {"thought": "...", "tool": "...", "args": {...}})
    if (text.includes('"tool"') && text.includes('"args"')) {
      const firstBrace = text.indexOf('{')
      const lastBrace = text.lastIndexOf('}')
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const candidate = text.slice(firstBrace, lastBrace + 1)
        const parsed = this.tryParseToolJson(candidate)
        if (parsed) return parsed
      }
    }

    // 方法4: 兼容旧版 XML 格式 (向后兼容)
    const xmlMatch = text.match(/<tool\s+name="(\w+)">([\s\S]*?)<\/tool>/)
    if (xmlMatch) {
      console.log('[LocalClaw] 检测到旧版 XML 格式，自动转换')
      const toolName = xmlMatch[1]
      const argsContent = xmlMatch[2]
      const args: Record<string, unknown> = {}
      
      const argMatches = argsContent.matchAll(/<arg\s+name="(\w+)">([\s\S]*?)<\/arg>/g)
      for (const match of argMatches) {
        args[match[1]] = match[2].trim()
      }
      
      return { name: toolName, args }
    }

    return null
  }

  /**
   * 尝试解析 JSON 工具调用
   * 带错误修正能力
   */
  private tryParseToolJson(jsonStr: string): ToolCall | null {
    try {
      // 清理常见的格式问题
      let cleaned = jsonStr.trim()
      
      // 修正1: 移除尾部逗号
      cleaned = cleaned.replace(/,\s*}/g, '}')
      cleaned = cleaned.replace(/,\s*]/g, ']')
      
      // 先尝试直接解析（多行 JSON 本身就合法）
      let parsed: any
      try {
        parsed = JSON.parse(cleaned)
      } catch {
        // 修正2: 单引号转双引号 (仅在 key 处，不动 value)
        let attempt2 = cleaned.replace(/(\w)'/g, '$1"').replace(/'(\w)/g, '"$1')
        // 修正3: 处理字符串值中的未转义换行
        attempt2 = attempt2.replace(/\n/g, '\\n')
        parsed = JSON.parse(attempt2)
      }
      
      // 验证结构
      if (parsed.tool && typeof parsed.tool === 'string') {
        return {
          name: parsed.tool,
          args: parsed.args || {},
        }
      }
      
      // 兼容 name 字段
      if (parsed.name && typeof parsed.name === 'string') {
        return {
          name: parsed.name,
          args: parsed.args || {},
        }
      }
      
    } catch (error) {
      console.warn('[LocalClaw] JSON 解析失败，尝试修正:', error)
      
      // 最后尝试: 正则提取关键字段
      const toolMatch = jsonStr.match(/"tool"\s*:\s*"([^"]+)"/)
      const nameMatch = jsonStr.match(/"name"\s*:\s*"([^"]+)"/)
      const toolName = toolMatch?.[1] || nameMatch?.[1]
      
      if (toolName) {
        // 尝试提取 args
        const argsMatch = jsonStr.match(/"args"\s*:\s*(\{[^}]*\})/)
        let args: Record<string, unknown> = {}
        
        if (argsMatch) {
          try {
            args = JSON.parse(argsMatch[1].replace(/'/g, '"'))
          } catch {
            // 手动提取常见参数
            const pathMatch = jsonStr.match(/"path"\s*:\s*"([^"]+)"/)
            const queryMatch = jsonStr.match(/"query"\s*:\s*"([^"]+)"/)
            const locationMatch = jsonStr.match(/"location"\s*:\s*"([^"]+)"/)
            const contentMatch = jsonStr.match(/"content"\s*:\s*"([^"]*)"/)
            
            if (pathMatch) args.path = pathMatch[1]
            if (queryMatch) args.query = queryMatch[1]
            if (locationMatch) args.location = locationMatch[1]
            if (contentMatch) args.content = contentMatch[1]
          }
        }
        
        console.log('[LocalClaw] 通过正则修正成功:', toolName)
        return { name: toolName, args }
      }
    }
    
    return null
  }

  async executeTool(tool: ToolCall, _retryCount = 0): Promise<ToolResult> {
    // 旁路统计：记录调用
    skillStatsService.recordCall(tool.name)
    
    // 可重试的网络错误模式
    const RETRYABLE_PATTERNS = ['timeout', 'ECONNREFUSED', 'fetch failed', 'ECONNRESET', 'aborted']
    const MAX_TOOL_RETRIES = 2
    
    // 数字免疫系统自愈上下文
    const executeWithHealing = async (): Promise<ToolResult> => {
      try {
        const response = await fetch(`${this.serverUrl}/api/tools/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: tool.name, args: tool.args }),
          signal: AbortSignal.timeout(CONFIG.TOOL_TIMEOUT),
        })

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`)
        }

        const result: ToolResult = await response.json()
        
        // 旁路统计：记录结果
        skillStatsService.recordResult(tool.name, result.status === 'success')
        
        // 成功时重置免疫状态
        if (result.status === 'success') {
          immuneService.resetState(tool.name)
        }
        
        return result
      } catch (error: any) {
        const errorMessage = error.message || String(error)
        
        // 数字免疫系统：匹配失败签名
        const matchResult = immuneService.matchFailure(errorMessage)
        
        if (matchResult && matchResult.healingScript) {
          const healingResult = immuneService.executeHealing(
            tool.name,
            matchResult.signature,
            matchResult.healingScript
          )
          
          console.log(`[LocalClaw] Immune healing: ${healingResult.message}`)
          
          if (healingResult.shouldRetry) {
            // 根据自愈参数调整等待时间
            const backoffMs = (healingResult.params?.backoffMultiplier as number || 1) * 1000
            await new Promise(resolve => setTimeout(resolve, backoffMs))
            
            return executeWithHealing()
          }
          
          return {
            tool: tool.name,
            status: 'error',
            result: `${healingResult.message}\n原始错误: ${errorMessage}`,
          }
        }
        
        // 旁路统计：记录失败
        skillStatsService.recordResult(tool.name, false)
        
        // 🔄 网络错误自动重试（指数退避）
        if (_retryCount < MAX_TOOL_RETRIES && RETRYABLE_PATTERNS.some(p => errorMessage.toLowerCase().includes(p))) {
          const backoffMs = 1000 * Math.pow(2, _retryCount)
          console.log(`[LocalClaw] Tool ${tool.name} failed with retryable error, retry ${_retryCount + 1}/${MAX_TOOL_RETRIES} after ${backoffMs}ms`)
          await new Promise(resolve => setTimeout(resolve, backoffMs))
          return this.executeTool(tool, _retryCount + 1)
        }
        
        return {
          tool: tool.name,
          status: 'error',
          result: `工具执行失败: ${errorMessage}`,
        }
      }
    }
    
    return executeWithHealing()
  }

  // ============================================
  // 📚 双层记忆系统 (Dual-Layer Memory)
  // ============================================

  // 消息计数器 - 用于触发记忆整合
  private messageCount = 0
  private readonly CONSOLIDATION_THRESHOLD = 20

  /**
   * 记录到短暂层 (Ephemeral Layer)
   * 每日日志，会话结束后可丢弃
   */
  async logToEphemeral(entry: string, category: 'action' | 'thought' | 'result' = 'action'): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const prefix = category === 'action' ? '[ACT]' : category === 'thought' ? '[THK]' : '[RES]'
    
    const logEntry = `${time} ${prefix} ${entry}\n`
    
    await this.executeTool({
      name: 'appendFile',
      args: {
        path: `memory/${today}.md`,
        content: logEntry,
      },
    })

    // 增加消息计数
    this.messageCount++
    
    // 检查是否需要触发整合
    if (this.messageCount >= this.CONSOLIDATION_THRESHOLD) {
      this.triggerConsolidation().catch(err => 
        console.warn('[LocalClaw] Background consolidation failed:', err)
      )
      this.messageCount = 0
    }
  }

  /**
   * 保存到持久层 (Durable Layer)
   * 关键事实，长期保留
   */
  async saveToDurable(fact: string, tags: string[] = []): Promise<void> {
    const timestamp = new Date().toISOString()
    const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : ''
    const entry = `- ${fact}${tagStr} (${timestamp})\n`
    
    // 追加到 MEMORY.md
    await this.executeTool({
      name: 'appendFile',
      args: {
        path: 'MEMORY.md',
        content: entry,
      },
    })
    
    console.log('[LocalClaw] Saved to durable memory:', fact.slice(0, 50))
  }

  /**
   * 从持久层读取记忆
   */
  async loadDurableMemory(): Promise<string | null> {
    return await this.readFile('MEMORY.md')
  }

  /**
   * 读取今日短暂记忆
   */
  async loadTodayEphemeral(): Promise<string | null> {
    const today = new Date().toISOString().split('T')[0]
    return await this.readFile(`memory/${today}.md`)
  }

  /**
   * 静默记忆整合 (Background Consolidation)
   * 将短暂记忆中的重要信息提取到持久层
   */
  private async triggerConsolidation(): Promise<void> {
    console.log('[LocalClaw] Starting memory consolidation...')
    
    const today = new Date().toISOString().split('T')[0]
    const ephemeralContent = await this.readFile(`memory/${today}.md`)
    
    if (!ephemeralContent || ephemeralContent.length < 100) {
      return // 内容太少，跳过整合
    }

    // 使用 LLM 提取关键信息
    const consolidationPrompt = `请从以下今日操作日志中提取1-3条最重要的事实或发现。
只输出需要长期记住的关键信息，每条一行，格式：
- [事实内容]

日志内容：
${ephemeralContent.slice(-2000)}

关键事实（如果没有重要信息，输出"无"）：`

    try {
      const response = await chat([{ role: 'user', content: consolidationPrompt }])
      
      // 解析提取的事实
      const lines = response.split('\n').filter(line => line.trim().startsWith('-'))
      
      for (const line of lines) {
        const fact = line.replace(/^-\s*/, '').trim()
        if (fact && fact !== '无' && fact.length > 5) {
          await this.saveToDurable(fact, ['auto-consolidated'])
        }
      }
      
      console.log('[LocalClaw] Consolidation complete, extracted', lines.length, 'facts')
    } catch (error) {
      console.warn('[LocalClaw] Consolidation LLM call failed:', error)
    }
  }

  /**
   * 初始化今日日志文件
   */
  async initDailyLog(): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    const header = `# DD-OS Daily Log - ${today}\n\n`
    
    // 检查文件是否存在
    const existing = await this.readFile(`memory/${today}.md`)
    if (!existing) {
      await this.writeFile(`memory/${today}.md`, header)
    }
  }

  // 兼容旧 API
  async saveMemory(key: string, content: string): Promise<void> {
    await this.saveToDurable(`${key}: ${content}`, [key])
  }

  async loadMemory(key: string): Promise<string | null> {
    const durableContent = await this.loadDurableMemory()
    if (!durableContent) return null
    
    // 搜索包含 key 的条目
    const lines = durableContent.split('\n')
    const matched = lines.filter(line => line.includes(key))
    return matched.length > 0 ? matched.join('\n') : null
  }

  async appendToLog(sessionId: string, content: string): Promise<void> {
    await this.logToEphemeral(`[${sessionId}] ${content}`, 'action')
  }

  // ============================================
  // 🧩 程序化记忆 (Procedural Memory / SOP)
  // ============================================

  /**
   * 记录成功的任务执行模式 (SOP)
   * 当复杂任务成功完成时，自动提取执行模式并存储
   */
  private async recordSOP(taskDescription: string, plan: PlanStep[]): Promise<void> {
    try {
      const steps = plan
        .filter(s => s.status === 'completed')
        .map(s => `${s.id}. ${s.description}${s.tool ? ` [${s.tool}]` : ''}`)
        .join('\n')

      const sopEntry = `\n- #SOP 任务: "${taskDescription.slice(0, 80)}"\n  步骤: ${steps.replace(/\n/g, '\n  ')}\n  记录时间: ${new Date().toISOString()}\n`
      
      await this.executeTool({
        name: 'appendFile',
        args: {
          path: 'MEMORY.md',
          content: sopEntry,
        },
      })

      console.log('[LocalClaw] SOP recorded for task:', taskDescription.slice(0, 50))
    } catch (error) {
      console.warn('[LocalClaw] Failed to record SOP:', error)
    }
  }

  /**
   * 检索相关的 SOP 记忆
   * 根据用户查询在 MEMORY.md 中查找匹配的 #SOP 条目
   */
  private async searchSOPMemory(queryLower: string): Promise<string | null> {
    const memory = await this.readFileWithCache('MEMORY.md')
    if (!memory) return null

    // 提取所有 SOP 条目
    const sopEntries: string[] = []
    const lines = memory.split('\n')
    let currentSOP = ''
    let inSOP = false

    for (const line of lines) {
      if (line.includes('#SOP')) {
        if (currentSOP) sopEntries.push(currentSOP.trim())
        currentSOP = line
        inSOP = true
      } else if (inSOP && line.startsWith('  ')) {
        currentSOP += '\n' + line
      } else if (inSOP && line.trim() === '') {
        // 空行结束 SOP
      } else {
        if (currentSOP) sopEntries.push(currentSOP.trim())
        currentSOP = ''
        inSOP = false
      }
    }
    if (currentSOP) sopEntries.push(currentSOP.trim())

    if (sopEntries.length === 0) return null

    // 简单关键词匹配
    const queryWords = queryLower.split(/[\s,，。？！]+/).filter(w => w.length > 1)
    const matched = sopEntries.filter(entry => {
      const entryLower = entry.toLowerCase()
      return queryWords.some(word => entryLower.includes(word))
    })

    if (matched.length === 0) return null

    // 最多返回2条最相关的
    return matched.slice(0, 2).join('\n\n')
  }

  // ============================================
  // 🔧 辅助方法
  // ============================================

  async listFiles(path = '.'): Promise<any[]> {
    const result = await this.executeTool({
      name: 'listDir',
      args: { path },
    })

    if (result.status === 'success') {
      try {
        return JSON.parse(result.result)
      } catch {
        return []
      }
    }
    return []
  }

  async readFile(path: string): Promise<string | null> {
    const result = await this.executeTool({
      name: 'readFile',
      args: { path },
    })

    return result.status === 'success' ? result.result : null
  }

  async writeFile(path: string, content: string): Promise<boolean> {
    const result = await this.executeTool({
      name: 'writeFile',
      args: { path, content },
    })

    return result.status === 'success'
  }

  async runCommand(command: string): Promise<string> {
    const result = await this.executeTool({
      name: 'runCmd',
      args: { command },
    })

    return result.result
  }

  // ============================================
  // EvoMap 集成 (GEP-A2A 协议)
  // ============================================

  /**
   * 初始化 EvoMap 连接
   * 后台执行，不阻塞主流程
   */
  private async initEvoMap(): Promise<void> {
    try {
      // 如果尚未注册，发送 hello
      if (!evomapService.isRegistered()) {
        const response = await evomapService.hello()
        console.log(`[LocalClaw] EvoMap registered! Claim: ${response.claim_url}`)
        
        // 提示用户
        this.storeActions?.addToast({
          type: 'info',
          title: 'EvoMap 已连接',
          message: `认领链接: ${response.claim_code}`,
        })
      }

      // 尝试获取已验证的 Capsule 资产
      const capsules = await evomapService.fetchCapsules(10)
      if (capsules.length > 0) {
        console.log(`[LocalClaw] Fetched ${capsules.length} EvoMap capsules`)
      }
    } catch (error) {
      // EvoMap 连接失败不影响主流程
      console.warn('[LocalClaw] EvoMap connection failed (non-blocking):', error)
    }
  }

  /**
   * 发布成功经验到 EvoMap
   * 在任务成功完成后调用
   */
  async publishToEvoMap(
    summary: string,
    implementation: string,
    toolsUsed: string[]
  ): Promise<boolean> {
    try {
      const response = await evomapService.publish(summary, implementation, toolsUsed)
      if (response.status === 'accepted') {
        console.log(`[LocalClaw] Published to EvoMap: ${response.asset_ids?.join(', ')}`)
        this.storeActions?.addToast({
          type: 'success',
          title: 'EvoMap 发布成功',
          message: '解决方案已共享到网络',
        })
        return true
      }
      return false
    } catch (error) {
      console.warn('[LocalClaw] EvoMap publish failed:', error)
      return false
    }
  }

  /**
   * 获取 EvoMap 节点状态
   */
  getEvoMapState() {
    return evomapService.getNodeState()
  }
}

// 导出单例
export const localClawService = new LocalClawService()

