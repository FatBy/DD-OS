/**
 * DD-OS Native Local AI Engine
 * 
 * 独立运行的本地 AI 引擎，包含：
 * - ReAct 循环执行器
 * - 任务规划器 (Planner)
 * - 工具调用能力
 * - 本地记忆持久化
 */

import { chat, streamChat, isLLMConfigured } from './llmService'
import type { ChatMessage, ExecutionStatus } from '@/types'

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
}

// ============================================
// 配置
// ============================================

const CONFIG = {
  LOCAL_SERVER_URL: 'http://localhost:3001',
  MAX_REACT_TURNS: 10,
  MAX_PLAN_STEPS: 8,
  TOOL_TIMEOUT: 60000,
}

// ============================================
// JIT 上下文注入配置
// ============================================

/**
 * 技能关键词映射表
 * 当用户输入匹配这些关键词时，自动加载对应的 SKILL.md
 */
const SKILL_TRIGGERS: Record<string, { keywords: string[]; path: string }> = {
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
}

// ============================================
// 系统提示词模板
// ============================================

const SYSTEM_PROMPT_TEMPLATE = `你是 DD-OS，一个运行在用户本地电脑上的 AI 操作系统。

## 核心能力
你可以通过工具直接操作用户的电脑和获取信息：

### 文件操作
- readFile: 读取文件内容
- writeFile: 写入文件
- appendFile: 追加内容到文件
- listDir: 列出目录

### 系统操作
- runCmd: 执行 Shell 命令

### 网络能力
- weather: 查询天气 (参数: location)
- webSearch: 网页搜索 (参数: query)

## 工具调用格式
当你需要使用工具时，输出 JSON 代码块：

\`\`\`json
{"tool": "工具名", "args": {"参数名": "参数值"}}
\`\`\`

## 示例

查询天气：
\`\`\`json
{"tool": "weather", "args": {"location": "惠州"}}
\`\`\`

网页搜索：
\`\`\`json
{"tool": "webSearch", "args": {"query": "今天新闻"}}
\`\`\`

读取文件：
\`\`\`json
{"tool": "readFile", "args": {"path": "SOUL.md"}}
\`\`\`

写入文件：
\`\`\`json
{"tool": "writeFile", "args": {"path": "notes/todo.md", "content": "# 待办事项\\n- 任务1\\n- 任务2"}}
\`\`\`

## 重要规则
1. 用户询问天气时，直接使用 weather 工具
2. 用户需要搜索信息时，使用 webSearch 工具
3. 如果需要多个步骤，一步一步执行
4. 执行危险操作前先确认
5. 保持响应简洁明了
6. 如果工具执行失败，分析原因并尝试其他方法

## 当前上下文
{context}
`

const PLANNER_PROMPT = `你是一个任务规划器。请将用户的复杂请求拆解为可执行的步骤。

输出格式：纯 JSON 数组，每个步骤包含：
- id: 步骤序号
- description: 步骤描述
- tool: 可能需要的工具名 (可选)

示例输出：
[
  {"id": 1, "description": "读取项目配置文件", "tool": "readFile"},
  {"id": 2, "description": "分析依赖关系"},
  {"id": 3, "description": "生成报告并保存", "tool": "writeFile"}
]

用户请求: {prompt}

请输出 JSON 数组 (不要包含其他文字)：`

// ============================================
// LocalClawService 主类
// ============================================

class LocalClawService {
  private storeActions: StoreActions | null = null
  private serverUrl = CONFIG.LOCAL_SERVER_URL
  private soulContent: string = ''
  private isConnected = false

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

      this.isConnected = true
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

      // 初始化今日日志
      await this.initDailyLog()

      return true
    } catch (error: any) {
      console.error('[LocalClaw] Connection failed:', error)
      this.isConnected = false
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
    this.isConnected = false
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

  // ============================================
  // 🎯 JIT 动态上下文构建
  // ============================================

  /**
   * 构建动态上下文 (Just-In-Time Loading)
   * 根据用户查询动态注入相关上下文，避免上下文窗口膨胀
   */
  private async buildDynamicContext(userQuery: string): Promise<string> {
    const contextParts: string[] = []
    const queryLower = userQuery.toLowerCase()

    // 1. 核心人格 (SOUL.md) - 始终加载但精简
    if (this.soulContent) {
      // 只提取关键部分，避免全量注入
      const soulSummary = this.extractSoulSummary(this.soulContent)
      if (soulSummary) {
        contextParts.push(`## 核心人格\n${soulSummary}`)
      }
    }

    // 2. 今日记忆 - 仅当可能相关时加载
    const today = new Date().toISOString().split('T')[0]
    const dailyLog = await this.readFileWithCache(`memory/${today}.md`)
    if (dailyLog) {
      // 只取最近10条记录
      const recentLogs = this.extractRecentLogs(dailyLog, 10)
      if (recentLogs) {
        contextParts.push(`## 今日活动\n${recentLogs}`)
      }
    }

    // 3. 动态技能注入 - 根据关键词匹配
    const matchedSkills = this.matchSkills(queryLower)
    for (const skillPath of matchedSkills) {
      const skillContent = await this.readFileWithCache(skillPath)
      if (skillContent) {
        // 只提取技能的核心用法部分
        const skillUsage = this.extractSkillUsage(skillContent)
        if (skillUsage) {
          contextParts.push(`## 相关技能\n${skillUsage}`)
        }
      }
    }

    // 4. 用户偏好 (如果存在)
    if (queryLower.includes('偏好') || queryLower.includes('设置') || queryLower.includes('preference')) {
      const userPrefs = await this.readFileWithCache('USER.md')
      if (userPrefs) {
        contextParts.push(`## 用户偏好\n${userPrefs}`)
      }
    }

    // 组合上下文，添加时间戳
    const timestamp = new Date().toLocaleString('zh-CN')
    const header = `当前时间: ${timestamp}\n用户意图: ${userQuery.slice(0, 100)}${userQuery.length > 100 ? '...' : ''}`
    
    return contextParts.length > 0 
      ? `${header}\n\n${contextParts.join('\n\n')}`
      : header
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
   * 匹配用户查询与技能关键词
   */
  private matchSkills(queryLower: string): string[] {
    const matched: string[] = []
    
    for (const [skillName, config] of Object.entries(SKILL_TRIGGERS)) {
      const hasMatch = config.keywords.some(keyword => 
        queryLower.includes(keyword.toLowerCase())
      )
      if (hasMatch) {
        matched.push(config.path)
        console.log(`[LocalClaw] JIT: 匹配技能 ${skillName}`)
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
   * 提取技能的核心用法部分
   */
  private extractSkillUsage(skillContent: string): string {
    const lines = skillContent.split('\n')
    const usageLines: string[] = []
    let inUsageSection = false
    let lineCount = 0
    const maxLines = 20

    for (const line of lines) {
      if (lineCount >= maxLines) break

      if (line.includes('## Usage') || line.includes('## 用法') || line.includes('## What This')) {
        inUsageSection = true
        continue
      }
      
      if (inUsageSection) {
        if (line.startsWith('## ') && !line.includes('Usage')) {
          break
        }
        usageLines.push(line)
        lineCount++
      }
    }

    // 如果没找到 Usage 部分，取前20行
    if (usageLines.length === 0) {
      return lines.slice(0, 20).join('\n')
    }

    return usageLines.join('\n').trim()
  }

  // ============================================
  // 🌟 入口方法
  // ============================================

  /**
   * 发送简单消息 (ReAct 模式)
   */
  async sendMessage(
    prompt: string,
    onUpdate?: (content: string) => void
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

    try {
      const result = await this.runReActLoop(prompt, onUpdate)
      
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

      // 2. 执行每个步骤
      for (const step of plan) {
        step.status = 'running'
        onProgress?.(step, plan.length)

        try {
          const stepResult = await this.executeStep(step, plan)
          step.status = 'completed'
          step.result = stepResult
        } catch (error: any) {
          step.status = 'failed'
          step.result = error.message
        }

        onProgress?.(step, plan.length)
      }

      // 3. 生成总结报告
      const report = await this.synthesizeReport(prompt, plan)

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

  private async runReActLoop(
    userPrompt: string,
    onUpdate?: (content: string) => void
  ): Promise<string> {
    this.storeActions?.setAgentStatus('thinking')

    // 🎯 JIT: 动态构建上下文
    const dynamicContext = await this.buildDynamicContext(userPrompt)
    console.log('[LocalClaw] JIT Context built:', dynamicContext.slice(0, 200) + '...')

    const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace(
      '{context}',
      dynamicContext
    )

    const messages: AgentMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    let turnCount = 0
    let finalResponse = ''

    while (turnCount < CONFIG.MAX_REACT_TURNS) {
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

        if (toolCall) {
          // 执行工具
          this.storeActions?.setAgentStatus('executing')
          this.storeActions?.addLog({
            id: `tool-${Date.now()}`,
            timestamp: Date.now(),
            level: 'info',
            message: `调用工具: ${toolCall.name}`,
          })

          const toolResult = await this.executeTool(toolCall)

          // 📝 记录工具调用到短暂层
          this.logToEphemeral(
            `${toolCall.name}(${JSON.stringify(toolCall.args).slice(0, 80)}) -> ${toolResult.status}`,
            'action'
          ).catch(() => {}) // 静默失败

          // 添加到消息历史
          messages.push({ role: 'assistant', content: response })
          messages.push({
            role: 'user',
            content: `[工具执行结果] ${toolCall.name}:\n${toolResult.result}`,
          })

          this.storeActions?.setAgentStatus('thinking')
        } else {
          // 无工具调用，返回最终响应
          finalResponse = response
          
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
    return finalResponse
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
        const plan = JSON.parse(jsonMatch[0]) as PlanStep[]
        return plan.slice(0, CONFIG.MAX_PLAN_STEPS).map((step, i) => ({
          ...step,
          id: i + 1,
          status: 'pending' as const,
        }))
      }
    } catch (error) {
      console.error('[LocalClaw] Plan generation failed:', error)
    }

    // 降级：单步计划
    return [{ id: 1, description: prompt, status: 'pending' }]
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

    // 方法3: 行内 JSON (无代码块)
    const inlineMatch = text.match(/\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[^}]*\}\s*\}/)
    if (inlineMatch) {
      const parsed = this.tryParseToolJson(inlineMatch[0])
      if (parsed) return parsed
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
      
      // 修正2: 单引号转双引号
      cleaned = cleaned.replace(/'/g, '"')
      
      // 修正3: 处理未转义的换行
      cleaned = cleaned.replace(/\n/g, '\\n')
      
      const parsed = JSON.parse(cleaned)
      
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
