/**
 * 上下文构建器
 * 根据当前页面类型构建 LLM 的 system prompt 和数据上下文
 */

import type { ChatMessage, ViewType, TaskItem, SkillNode, MemoryEntry, SoulTruth, SoulBoundary, ExecutionCommand } from '@/types'

// ============================================
// 系统 Prompt
// ============================================

const OPENCLAW_CAPABILITY = `

你可以通过 DD-OS 直接控制 OpenClaw AI Agent 执行任务。当用户请求你执行某项操作时（如发消息、执行命令、自动化任务等），在你的回复末尾包含以下特殊标记：
\`\`\`execute
{"action":"sendTask","prompt":"要发送给 Agent 的具体指令"}
\`\`\`
只在需要执行操作时才添加此标记，纯分析或回答问题时不需要。`

const SYSTEM_PROMPTS: Record<string, string> = {
  task: `你是 DD-OS 任务管理助手。你的职责是帮助用户分析任务状态、建议优先级、识别瓶颈。
回答要简洁精炼，使用中文。` + OPENCLAW_CAPABILITY,

  skill: `你是 DD-OS 技能分析助手。你的职责是帮助用户了解当前已安装的技能、分析技能覆盖度、推荐可能需要的新技能。
回答要简洁精炼，使用中文。` + OPENCLAW_CAPABILITY,

  memory: `你是 DD-OS 记忆管理助手。你的职责是帮助用户总结和分析记忆数据、发现记忆间的关联、提取关键洞察。
回答要简洁精炼，使用中文。` + OPENCLAW_CAPABILITY,

  soul: `你是 DD-OS 灵魂分析助手。你的职责是帮助用户理解 Agent 的个性配置、分析核心特质和边界规则、建议优化方向。
回答要简洁精炼，使用中文。` + OPENCLAW_CAPABILITY,

  default: `你是 DD-OS 智能助手，帮助用户管理和分析 OpenClaw AI Agent 的各项数据。
回答要简洁精炼，使用中文。` + OPENCLAW_CAPABILITY,
}

// ============================================
// 摘要 Prompt
// ============================================

const SUMMARY_PROMPTS: Record<string, string> = {
  task: '请用一句话概括当前任务状况，并给出最重要的行动建议（30字以内）。',
  skill: '请用一句话概括当前技能配置情况，并指出最需要补充的能力（30字以内）。',
  memory: '请用一句话总结最近的记忆要点和发现的模式（30字以内）。',
  soul: '请用一句话评价当前 Agent 的个性配置特点（30字以内）。',
}

// ============================================
// 数据上下文构建
// ============================================

interface StoreData {
  tasks?: TaskItem[]
  skills?: SkillNode[]
  memories?: MemoryEntry[]
  soulCoreTruths?: SoulTruth[]
  soulBoundaries?: SoulBoundary[]
  soulVibeStatement?: string
  soulRawContent?: string
  connectionStatus?: string
}

function buildTaskContext(tasks: TaskItem[]): string {
  const pending = tasks.filter(t => t.status === 'pending')
  const executing = tasks.filter(t => t.status === 'executing')
  const done = tasks.filter(t => t.status === 'done')
  
  let ctx = `当前任务概况: 共 ${tasks.length} 个任务\n`
  ctx += `- 待处理: ${pending.length} 个\n`
  ctx += `- 执行中: ${executing.length} 个\n`
  ctx += `- 已完成: ${done.length} 个\n\n`
  
  if (executing.length > 0) {
    ctx += '执行中的任务:\n'
    executing.slice(0, 5).forEach(t => {
      ctx += `  - ${t.title} (优先级: ${t.priority})\n`
    })
  }
  
  if (pending.length > 0) {
    ctx += '\n待处理的任务:\n'
    pending.slice(0, 10).forEach(t => {
      ctx += `  - ${t.title} (优先级: ${t.priority})\n`
    })
  }
  
  return ctx
}

function buildSkillContext(skills: SkillNode[]): string {
  const active = skills.filter(s => s.unlocked)
  const categories = [...new Set(skills.map(s => s.category).filter(Boolean))]
  
  let ctx = `当前技能概况: 共 ${skills.length} 个技能, ${active.length} 个已激活\n`
  ctx += `分类: ${categories.join(', ') || '未分类'}\n\n`
  ctx += '技能列表:\n'
  skills.slice(0, 20).forEach(s => {
    ctx += `  - ${s.name} (${s.category || '未知'}) ${s.unlocked ? '[激活]' : '[未激活]'}\n`
  })
  
  return ctx
}

function buildMemoryContext(memories: MemoryEntry[]): string {
  const shortTerm = memories.filter(m => m.type === 'short-term')
  const longTerm = memories.filter(m => m.type === 'long-term')
  
  let ctx = `当前记忆: 共 ${memories.length} 条 (短期 ${shortTerm.length}, 长期 ${longTerm.length})\n\n`
  ctx += '最近记忆:\n'
  memories.slice(0, 10).forEach(m => {
    ctx += `  - [${m.type}] ${m.title}: ${m.content.slice(0, 80)}...\n`
  })
  
  return ctx
}

function buildSoulContext(data: StoreData): string {
  let ctx = ''
  
  if (data.soulCoreTruths && data.soulCoreTruths.length > 0) {
    ctx += '核心特质:\n'
    data.soulCoreTruths.forEach(t => {
      ctx += `  - ${t.title}: ${t.principle}\n`
    })
  }
  
  if (data.soulBoundaries && data.soulBoundaries.length > 0) {
    ctx += '\n边界规则:\n'
    data.soulBoundaries.forEach(b => {
      ctx += `  - ${b.rule}\n`
    })
  }
  
  if (data.soulVibeStatement) {
    ctx += `\n氛围: ${data.soulVibeStatement}\n`
  }
  
  return ctx || 'SOUL.md 未配置'
}

function getContextForView(view: ViewType, data: StoreData): string {
  switch (view) {
    case 'task':
      return buildTaskContext(data.tasks || [])
    case 'skill':
      return buildSkillContext(data.skills || [])
    case 'memory':
      return buildMemoryContext(data.memories || [])
    case 'soul':
      return buildSoulContext(data)
    default:
      return ''
  }
}

// ============================================
// 公开 API
// ============================================

/**
 * 构建摘要请求的消息
 */
export function buildSummaryMessages(view: ViewType, data: StoreData): ChatMessage[] {
  const systemPrompt = SYSTEM_PROMPTS[view] || SYSTEM_PROMPTS.default
  const context = getContextForView(view, data)
  const summaryPrompt = SUMMARY_PROMPTS[view] || '请总结当前数据的要点（30字以内）。'
  
  return [
    {
      id: 'sys',
      role: 'system',
      content: `${systemPrompt}\n\n当前数据:\n${context}`,
      timestamp: Date.now(),
    },
    {
      id: 'user',
      role: 'user',
      content: summaryPrompt,
      timestamp: Date.now(),
    },
  ]
}

/**
 * 构建对话请求的消息
 */
export function buildChatMessages(
  view: ViewType,
  data: StoreData,
  history: ChatMessage[],
  userMessage: string,
): ChatMessage[] {
  const systemPrompt = SYSTEM_PROMPTS[view] || SYSTEM_PROMPTS.default
  const context = getContextForView(view, data)
  const connStatus = data.connectionStatus === 'connected' ? 'OpenClaw 已连接，可执行任务' : 'OpenClaw 未连接，无法执行任务'
  
  const messages: ChatMessage[] = [
    {
      id: 'sys',
      role: 'system',
      content: `${systemPrompt}\n\n系统状态: ${connStatus}\n\n当前数据:\n${context}`,
      timestamp: Date.now(),
    },
  ]
  
  // 添加历史消息 (最多保留最近 20 条)
  const recentHistory = history.filter(m => m.role !== 'system').slice(-20)
  messages.push(...recentHistory)
  
  // 添加用户新消息
  messages.push({
    id: `user-${Date.now()}`,
    role: 'user',
    content: userMessage,
    timestamp: Date.now(),
  })
  
  return messages
}

/**
 * 获取当前页面的快捷指令
 */
export function getQuickCommands(view: ViewType): Array<{ label: string; prompt: string }> {
  switch (view) {
    case 'task':
      return [
        { label: '分析进度', prompt: '分析当前所有任务的执行进度，指出需要关注的问题' },
        { label: '优化优先级', prompt: '根据当前任务情况，建议如何调整任务优先级' },
      ]
    case 'skill':
      return [
        { label: '推荐技能', prompt: '分析当前技能配置，推荐应该添加的新技能' },
        { label: '分析缺口', prompt: '分析当前技能覆盖的不足之处' },
      ]
    case 'memory':
      return [
        { label: '总结记忆', prompt: '总结最近的记忆要点，提取关键信息' },
        { label: '发现关联', prompt: '分析记忆之间的关联和模式' },
      ]
    case 'soul':
      return [
        { label: '个性分析', prompt: '分析当前 Agent 的个性特征和行为倾向' },
        { label: '优化建议', prompt: '建议如何优化 SOUL.md 配置来提升 Agent 表现' },
      ]
    default:
      return []
  }
}

// ============================================
// AI 增强 Prompt 构建器
// ============================================

/**
 * 从 LLM 返回文本中提取 JSON
 */
export function parseJSONFromLLM<T = unknown>(response: string): T {
  // 1. 直接解析
  try {
    return JSON.parse(response)
  } catch {}

  // 2. 提取 ```json ... ``` 代码块
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1])
    } catch {}
  }

  // 3. 提取数组 [...]
  const arrayMatch = response.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0])
    } catch {}
  }

  throw new Error('无法解析 LLM 返回的 JSON')
}

/**
 * 构建技能重要度分析 Prompt
 */
export function buildSkillEnhancementPrompt(skills: SkillNode[]): ChatMessage[] {
  const limitedSkills = skills.slice(0, 50)

  const skillsList = limitedSkills.map(s => ({
    id: s.id,
    name: s.name,
    category: s.category || '未分类',
    status: s.status || (s.unlocked ? 'active' : 'inactive'),
    description: s.description || '',
  }))

  return [
    {
      id: 'sys',
      role: 'system',
      content: `你是 DD-OS 技能分析专家。根据技能的名称、分类、状态和描述，完成两个任务：
1. 评估每个技能对 AI Agent 的重要程度（0-100 分）
2. 将技能归类到功能子分类中

评分标准：
- 90-100: 核心必备技能（如记忆管理、任务执行）
- 70-89: 重要辅助技能（如浏览器自动化、代码分析）
- 50-69: 一般技能
- 0-49: 可选/低优先级技能

子分类参考（可自行判断最合适的分类名）：
- 通信: 消息平台、通知、社交相关
- 分析: 数据分析、代码审查、信息提取
- 执行: 自动化操作、文件操作、系统调用
- 存储: 数据库、文件系统、缓存
- 系统: 核心框架、运行时、配置
- 辅助: 工具类、格式化、转换

你必须返回纯 JSON 数组，不要包含任何其他文字。`,
      timestamp: Date.now(),
    },
    {
      id: 'user',
      role: 'user',
      content: `分析以下 ${limitedSkills.length} 个技能，返回 JSON 数组：
${JSON.stringify(skillsList, null, 2)}

返回格式：[{"skillId":"技能id","importanceScore":85,"reasoning":"一句话理由","subCategory":"分类名"}]`,
      timestamp: Date.now(),
    },
  ]
}

/**
 * 构建任务自然语言命名 Prompt
 */
export function buildTaskNamingPrompt(tasks: TaskItem[]): ChatMessage[] {
  const limitedTasks = tasks.slice(0, 50)

  const tasksList = limitedTasks.map(t => ({
    id: t.id,
    originalTitle: t.title,
    description: t.description || '',
    status: t.status,
    priority: t.priority,
  }))

  return [
    {
      id: 'sys',
      role: 'system',
      content: `你是 DD-OS 任务命名专家。根据任务的原始标题和描述，生成简洁易懂的中文任务名称。
要求：
- 每个名称 5-15 个字
- 使用自然语言，让人一眼看懂任务内容
- 如果原始标题已经足够好，可以保留或微调
你必须返回纯 JSON 数组，不要包含任何其他文字。`,
      timestamp: Date.now(),
    },
    {
      id: 'user',
      role: 'user',
      content: `为以下 ${limitedTasks.length} 个任务生成自然语言标题，返回 JSON 数组：
${JSON.stringify(tasksList, null, 2)}

返回格式：[{"taskId":"任务id","naturalTitle":"自然语言标题"}]`,
      timestamp: Date.now(),
    },
  ]
}

// ============================================
// AI 执行命令解析
// ============================================

/**
 * 从 LLM 回复中提取执行命令
 */
export function parseExecutionCommands(content: string): ExecutionCommand[] {
  const commands: ExecutionCommand[] = []
  const regex = /```execute\s*([\s\S]*?)\s*```/g
  let match

  while ((match = regex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      if (parsed.action === 'sendTask' && parsed.prompt) {
        commands.push({
          action: 'sendTask',
          prompt: parsed.prompt,
          context: parsed.context,
        })
      }
    } catch {
      // 解析失败跳过
    }
  }

  return commands
}

/**
 * 从显示内容中移除执行命令块
 */
export function stripExecutionBlocks(content: string): string {
  return content.replace(/```execute\s*[\s\S]*?\s*```/g, '').trim()
}
