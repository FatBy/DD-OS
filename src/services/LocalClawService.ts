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
import type { ExecutionStatus, OpenClawSkill, MemoryEntry, ToolInfo, ExecTrace, ExecTraceToolCall, ApprovalRequest, ExecutionStep } from '@/types'
import { parseSoulMd, type ParsedSoul } from '@/utils/soulParser'

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
}

// ============================================
// 配置
// ============================================

const CONFIG = {
  LOCAL_SERVER_URL: 'http://localhost:3001',
  MAX_REACT_TURNS: 25,
  MAX_PLAN_STEPS: 12,
  TOOL_TIMEOUT: 60000,
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
}

// ============================================
// 系统提示词模板
// ============================================

const SYSTEM_PROMPT_TEMPLATE = `你是 DD-OS，一个运行在用户本地电脑上的 AI 操作系统。

## 核心能力
你可以通过工具直接操作用户的电脑和获取信息：

{available_tools}

### 记忆管理 (显式调用)
- saveMemory: 保存重要信息到长期记忆 (参数: key, content, type)
- searchMemory: 检索历史记忆 (参数: query)

## 意图理解 (最重要!)
在选择工具之前，你必须先理解用户的真实意图。以下是常见意图的正确映射：

**关于 DD-OS 系统自身的查询：**
- "有哪些技能/SKILL" → 用 listDir 查看 skills/ 目录，而不是执行 SKILL 命令
- "安装/下载技能" → 用 webSearch 搜索在线技能资源，然后通过 git clone 或下载安装
- "查看工具列表" → 直接列出你已知的可用工具，不需要调用工具
- "系统状态" → 用 listDir 查看相关目录结构

**关于信息检索：**
- "搜索/检索/查找 X" → 根据目标选择：本地文件用 readFile/listDir，网络信息用 webSearch
- "有没有新的 X" → 如果是在线资源用 webSearch，如果是本地文件用 listDir

**关于文件操作：**
- 明确提到文件路径或文件名 → 使用 readFile/writeFile
- 需要执行代码或命令 → 使用 runCmd

**绝对禁止：**
- 不要把用户提到的专有名词（如 SKILL、Agent、DD-OS）当成系统命令去执行
- 不要在 runCmd 中直接执行用户消息中的关键词
- runCmd 只用于执行真正的 Shell 命令（如 git, npm, python, dir, ls 等）

## 记忆管理策略
你拥有长期记忆能力，应主动管理：

**何时保存记忆** (调用 saveMemory):
- 用户表达偏好："我喜欢..."、"以后都..."、"记住..."
- 发现有效的解决方案或最佳实践
- 从错误中学到的教训
- 用户的重要信息（位置、习惯、项目配置等）

**何时检索记忆** (调用 searchMemory):
- 遇到似曾相识的任务
- 用户提到"之前"、"上次"、"还记得..."
- 需要用户偏好或历史信息
- 执行复杂任务前，检索相关经验

## 输出格式
你必须严格按照以下 JSON 格式输出。每次回复只能包含一个 JSON 代码块或纯文本。

当需要使用工具时：
\`\`\`json
{
  "thought": "分析用户需求，思考当前需要做什么，检查缺少什么信息...",
  "tool": "工具名",
  "args": {"参数名": "参数值"}
}
\`\`\`

当不需要工具、直接回复用户时：
直接输出纯文本即可，不要包含 JSON 代码块。

## 重要规则
1. **先理解意图再行动**：thought 中必须写出你对用户真实意图的分析，不能为空
2. **语义优先于字面**：用户说"SKILL"是指技能/插件概念，不是命令；说"Agent"是指智能体，不是程序名
3. 用户询问天气时，直接使用 weather 工具
4. 用户需要搜索信息时，使用 webSearch 工具
5. 如果需要多个步骤，一步一步执行，每次只调用一个工具
6. 执行危险操作前先在 thought 中评估风险
7. 保持响应简洁明了
8. 如果工具执行失败，在 thought 中分析原因并尝试其他方法
9. **主动记忆**: 发现用户偏好或有价值的信息时，主动调用 saveMemory 保存

{dynamic_examples}

## 当前上下文
{context}
`

// ============================================
// FC (Function Calling) 模式系统提示词 - 精简版
// ============================================

const SYSTEM_PROMPT_FC = `你是 DD-OS，一个运行在用户本地电脑上的 AI 操作系统。

## 核心身份
{soul_summary}

## 工作模式
- 你可以通过调用工具直接操作用户的电脑
- 工具会以 function calling 的形式自动注册，无需记忆工具文档
- 直接调用合适的工具来完成任务，无需输出 JSON

## 行为准则
1. **先思考再行动**: 如果不确定用户意图，先询问澄清
2. **语义理解**: 用户说"技能/SKILL"是指插件概念，不是命令；"Agent"是指智能体
3. **简洁高效**: 每次调用一个工具，逐步完成任务
4. **风险评估**: 执行危险操作（如删除、修改系统文件）前先告知用户

## 记忆提示
- saveMemory: 用户表达偏好或重要信息时主动保存
- searchMemory: 遇到"之前/上次/记得"等词时检索历史

## 当前上下文
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

  // JIT 缓存 - 避免重复读取
  private contextCache: Map<string, { content: string; timestamp: number }> = new Map()
  private readonly CACHE_TTL = 60000 // 1分钟缓存有效期

  /**
   * 注入 Store Actions
   */
  injectStore(actions: StoreActions) {
    this.storeActions = actions
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
  private buildToolsDocumentation(): string {
    if (this.availableTools.length === 0) {
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

    const builtins = this.availableTools.filter(t => t.type === 'builtin')
    const plugins = this.availableTools.filter(t => t.type === 'plugin')
    const instructions = this.availableTools.filter(t => t.type === 'instruction')

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

    const mcpTools = this.availableTools.filter(t => t.type === 'mcp')
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

    return doc
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
        if (skills.length > 0) {
          this.storeActions?.setOpenClawSkills(skills)
          localStorage.setItem('ddos_skills_json', JSON.stringify(skills))
          console.log(`[LocalClaw] ${skills.length} skills loaded to store`)

          // P1: 从 manifest.keywords 动态构建技能触发器
          this.buildSkillTriggersFromManifest(skills)
        }
      }
    } catch (e) {
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

    // 1. 核心人格 (SOUL.md) - 始终加载但精简
    if (this.soulContent) {
      const soulSummary = this.extractSoulSummary(this.soulContent)
      if (soulSummary) {
        contextParts.push(`## 核心人格\n${soulSummary}`)
      }
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
    const maxTurns = isSimpleTask ? 3 : isHeavyTask ? CONFIG.MAX_REACT_TURNS : 15
    console.log(`[LocalClaw] Task complexity: ${isSimpleTask ? 'simple' : isHeavyTask ? 'heavy' : 'normal'}, maxTurns: ${maxTurns}`)

    // 🎯 JIT: 动态构建上下文
    const { context: dynamicContext, dynamicExamples } = await this.buildDynamicContext(userPrompt)
    console.log('[LocalClaw] JIT Context built:', dynamicContext.slice(0, 200) + '...')

    const systemPrompt = SYSTEM_PROMPT_TEMPLATE
      .replace('{available_tools}', this.buildToolsDocumentation())
      .replace('{context}', dynamicContext)
      .replace('{dynamic_examples}', dynamicExamples)

    const messages: AgentMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    let turnCount = 0
    let finalResponse = ''
    let lastToolResult = ''  // 保存最后一次工具结果，防止循环耗尽时返回空

    // P2: 执行追踪收集
    const traceTools: ExecTraceToolCall[] = []
    const traceStartTime = Date.now()

    while (turnCount < maxTurns) {
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
            
            messages.push({
              role: 'user',
              content: `[Reflexion 反思] ${toolCall.name} 执行失败。
错误信息: ${toolResult.result}

请进行结构化反思:
1. **根本原因**: 是路径错误？参数类型错误？权限问题？工具不支持？
2. **修正方案**: 如何调整参数或换用其他方法？
3. **预防措施**: 下次如何避免此类错误？

请在 thought 中完成反思，然后执行修正后的操作。`,
            })
            
            this.storeActions?.addLog({
              id: `reflexion-${Date.now()}`,
              timestamp: Date.now(),
              level: 'warn',
              message: `[Reflexion] 分析 ${toolCall.name} 失败原因`,
            })
          } else {
            lastToolResult = toolResult.result
            
            // 🔄 技能变更检测：安装/卸载技能后刷新工具列表
            const isSkillChange = 
              (toolCall.name === 'runCmd' && (
                toolResult.result.includes('Skill installed') ||
                toolResult.result.includes('tools registered') ||
                toolResult.result.includes('git clone')
              ))
            
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
            
            // 🔍 Critic 自检：修改类工具成功后触发验证
            const needsCritic = CONFIG.CRITIC_TOOLS.includes(toolCall.name)
            
            if (needsCritic) {
              messages.push({
                role: 'user',
                content: `[Critic 自检] ${toolCall.name} 执行成功。
结果: ${toolResult.result.slice(0, 500)}

请验证:
1. 结果是否完全满足用户的原始需求？
2. 是否有潜在问题需要修正？
3. 是否需要额外操作来完善？

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

    // P2: 保存执行追踪
    if (traceTools.length > 0) {
      const trace: ExecTrace = {
        id: `trace-${traceStartTime}`,
        task: userPrompt.slice(0, 200),
        tools: traceTools,
        success: traceTools.every(t => t.status === 'success'),
        duration: Date.now() - traceStartTime,
        timestamp: traceStartTime,
        tags: userPrompt.split(/\s+/).filter(w => w.length > 2 && w.length < 15).slice(0, 5),
      }
      this.saveExecTrace(trace).catch(err => {
        console.warn('[LocalClaw] Failed to save exec trace:', err)
      })
    }

    // 如果循环耗尽但有工具结果，将最后的工具结果作为回复
    if (!finalResponse && lastToolResult) {
      // 如果结果只是 Exit Code 错误，给出更友好的提示
      if (/^Exit Code: \d+/.test(lastToolResult.trim()) || /Exit Code: (?!0)\d+/.test(lastToolResult)) {
        return `执行完成，但工具调用未成功。返回信息:\n${lastToolResult}\n\n可能原因: 网络连接问题或命令不可用。你可以尝试换一种方式描述需求。`
      }
      return `执行完成。工具返回结果:\n${lastToolResult}`
    }
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
    const maxTurns = isSimpleTask ? 3 : isHeavyTask ? CONFIG.MAX_REACT_TURNS : 15
    console.log(`[LocalClaw/FC] Task complexity: ${isSimpleTask ? 'simple' : isHeavyTask ? 'heavy' : 'normal'}, maxTurns: ${maxTurns}`)

    // JIT: 动态构建上下文
    const { context: dynamicContext } = await this.buildDynamicContext(userPrompt)

    // 构建精简系统提示词 (FC 模式无需工具文档)
    const soulSummary = this.soulContent ? this.extractSoulSummary(this.soulContent) : ''
    const systemPrompt = SYSTEM_PROMPT_FC
      .replace('{soul_summary}', soulSummary || '一个友好、专业的 AI 助手')
      .replace('{context}', dynamicContext)

    // 转换工具为 OpenAI Function Calling 格式
    const tools = convertToolInfoToFunctions(this.availableTools)
    console.log(`[LocalClaw/FC] Registered ${tools.length} functions`)

    // 消息历史 (使用标准 OpenAI 格式)
    const messages: SimpleChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    let turnCount = 0
    let finalResponse = ''
    let lastToolResult = ''

    // P2: 执行追踪收集
    const traceTools: ExecTraceToolCall[] = []
    const traceStartTime = Date.now()

    while (turnCount < maxTurns) {
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

        const { content, toolCalls, finishReason } = result
        console.log(`[LocalClaw/FC] finish_reason: ${finishReason}, toolCalls: ${toolCalls.length}`)

        // 判断是否有工具调用
        if (toolCalls.length > 0) {
          // 构建 assistant 消息 (包含 tool_calls)
          const assistantMsg: SimpleChatMessage = {
            role: 'assistant',
            content: content || null,
            tool_calls: toolCalls.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: tc.function,
            })),
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

            // 添加 tool 消息 (标准 OpenAI 格式)
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: toolResult.result,
              name: toolName,
            })

            // 🔄 技能变更检测 (与 Legacy 保持一致)
            if (toolName === 'runCmd' && (
              toolResult.result.includes('Skill installed') ||
              toolResult.result.includes('tools registered') ||
              toolResult.result.includes('git clone')
            )) {
              try {
                await this.loadTools()
                await this.loadAllDataToStore()
                console.log('[LocalClaw/FC] Tools & skills refreshed mid-loop')
              } catch {
                console.warn('[LocalClaw/FC] Failed to refresh tools mid-loop')
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

    // P2: 保存执行追踪
    if (traceTools.length > 0) {
      const trace: ExecTrace = {
        id: `trace-${traceStartTime}`,
        task: userPrompt.slice(0, 200),
        tools: traceTools,
        success: traceTools.every(t => t.status === 'success'),
        duration: Date.now() - traceStartTime,
        timestamp: traceStartTime,
        tags: userPrompt.split(/\s+/).filter(w => w.length > 2 && w.length < 15).slice(0, 5),
      }
      this.saveExecTrace(trace).catch(err => {
        console.warn('[LocalClaw/FC] Failed to save exec trace:', err)
      })
    }

    if (!finalResponse && lastToolResult) {
      if (/^Exit Code: \d+/.test(lastToolResult.trim()) || /Exit Code: (?!0)\d+/.test(lastToolResult)) {
        return `执行完成，但工具调用未成功。返回信息:\n${lastToolResult}\n\n可能原因: 网络连接问题或命令不可用。`
      }
      return `执行完成。工具返回结果:\n${lastToolResult}`
    }
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

  async executeTool(tool: ToolCall): Promise<ToolResult> {
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

      return await response.json()
    } catch (error: any) {
      return {
        tool: tool.name,
        status: 'error',
        result: `工具执行失败: ${error.message}`,
      }
    }
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
}

// 导出单例
export const localClawService = new LocalClawService()
