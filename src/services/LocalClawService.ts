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
- weather: 查询天气 (参数: location 或 city)
- webSearch: 网页搜索 (参数: query 或 q)

## 工具调用格式
当你需要使用工具时，使用以下 XML 格式：
<tool name="工具名">
<arg name="参数名">参数值</arg>
</tool>

## 示例

查询天气：
<tool name="weather">
<arg name="location">惠州</arg>
</tool>

网页搜索：
<tool name="webSearch">
<arg name="query">今天新闻</arg>
</tool>

读取文件：
<tool name="readFile">
<arg name="path">SOUL.md</arg>
</tool>

写入文件：
<tool name="writeFile">
<arg name="path">notes/todo.md</arg>
<arg name="content"># 待办事项\n- 任务1\n- 任务2</arg>
</tool>

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
      this.storeActions?.addToast({
        type: 'success',
        title: 'DD-OS Native 已就绪',
        message: `v${data.version} | ${data.skillCount} skills`,
      })

      // 加载 SOUL
      await this.loadSoul()

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

    const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace(
      '{context}',
      this.soulContent || '无额外上下文'
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

  private parseToolCall(text: string): ToolCall | null {
    const toolMatch = text.match(/<tool\s+name="(\w+)">([\s\S]*?)<\/tool>/)
    if (!toolMatch) return null

    const toolName = toolMatch[1]
    const argsContent = toolMatch[2]
    const args: Record<string, unknown> = {}

    const argMatches = argsContent.matchAll(/<arg\s+name="(\w+)">([\s\S]*?)<\/arg>/g)
    for (const match of argMatches) {
      args[match[1]] = match[2].trim()
    }

    return { name: toolName, args }
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
  // 📚 记忆管理
  // ============================================

  async saveMemory(key: string, content: string): Promise<void> {
    await this.executeTool({
      name: 'writeFile',
      args: {
        path: `memory/${key}.md`,
        content: `# ${key}\n\n${content}\n\n---\nUpdated: ${new Date().toISOString()}`,
      },
    })
  }

  async loadMemory(key: string): Promise<string | null> {
    const result = await this.executeTool({
      name: 'readFile',
      args: { path: `memory/${key}.md` },
    })

    if (result.status === 'success') {
      return result.result
    }
    return null
  }

  async appendToLog(sessionId: string, content: string): Promise<void> {
    await this.executeTool({
      name: 'appendFile',
      args: {
        path: `logs/${sessionId}.log`,
        content: `[${new Date().toISOString()}] ${content}\n`,
      },
    })
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
