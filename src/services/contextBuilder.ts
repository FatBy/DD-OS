/**
 * 上下文构建器
 * 根据当前页面类型构建 LLM 的 system prompt 和数据上下文
 */

import type { ChatMessage, ViewType, TaskItem, SkillNode, MemoryEntry, SoulTruth, SoulBoundary, ExecutionCommand, JournalMood } from '@/types'

// ============================================
// 系统 Prompt
// ============================================

const OPENCLAW_CAPABILITY = `

你可以通过 DD-OS 直接控制 AI Agent 执行任务。当用户请求你执行某项操作时（如发消息、执行命令、自动化任务等），在你的回复末尾包含以下特殊标记：
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

  default: `你是 DD-OS 智能助手，帮助用户管理和分析 AI Agent 的各项数据。
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
  const connStatus = data.connectionStatus === 'connected' ? 'DD-OS 已连接，可执行任务' : 'DD-OS 未连接，无法执行任务'
  
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

// ============================================
// 冒险日志生成 Prompt
// ============================================

/**
 * 构建每日冒险日志生成 Prompt
 * 将某一天的原始记忆转化为叙事故事
 */
export function buildJournalPrompt(
  date: string,
  memories: MemoryEntry[]
): ChatMessage[] {
  const memoriesSummary = memories.map(m => {
    const roleTag = m.role === 'user' ? '用户' : 'AI'
    return `[${roleTag}] ${m.title}: ${m.content.slice(0, 200)}`
  }).join('\n')

  return [
    {
      id: 'sys',
      role: 'system',
      content: `你是一个 AI 冒险日志撰写者。你的任务是将一天的对话记录转化为一篇简短、有趣、第一人称的冒险日志。

写作要求：
- 使用第一人称（"我"），以 AI 助手的视角书写
- 像写冒险日记一样，把对话经历变成有趣的小故事
- 控制在 100-200 字以内
- 语气要活泼自然，可以加入一些小幽默
- 不要太正式，就像朋友之间分享今天发生的事
- 使用中文

你必须返回 JSON 格式，不要包含其他文字：
{
  "title": "简短有趣的标题（5-10字）",
  "narrative": "第一人称叙事故事",
  "mood": "productive|learning|casual|challenging 选一个",
  "keyFacts": ["关键事实1", "关键事实2", "关键事实3"]
}

mood 选择标准：
- productive: 完成了很多实际工作，如编程、修复bug、部署
- learning: 探索新知识，学习新概念，研究问题
- casual: 轻松聊天，日常对话，闲聊
- challenging: 遇到困难、调试棘手问题、解决复杂任务`,
      timestamp: Date.now(),
    },
    {
      id: 'user',
      role: 'user',
      content: `日期：${date}\n对话记录共 ${memories.length} 条：\n${memoriesSummary}\n\n请将以上内容转化为冒险日志 JSON。`,
      timestamp: Date.now(),
    },
  ]
}

/**
 * 解析日志生成结果
 */
export function parseJournalResult(response: string): {
  title: string
  narrative: string
  mood: JournalMood
  keyFacts: string[]
} {
  const parsed = parseJSONFromLLM<{
    title?: string
    narrative?: string
    mood?: string
    keyFacts?: string[]
  }>(response)

  const validMoods: JournalMood[] = ['productive', 'learning', 'casual', 'challenging']
  const mood = validMoods.includes(parsed.mood as JournalMood) 
    ? (parsed.mood as JournalMood) 
    : 'casual'

  return {
    title: parsed.title || '未命名日志',
    narrative: parsed.narrative || '今天发生了一些事情...',
    mood,
    keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts.slice(0, 5) : [],
  }
}

// ============================================
// Quest 上下文构建 (交互式规划支持)
// ============================================

import type { QuestSession, ExplorationResult, ContextEntry } from '@/types'

/**
 * 构建 Quest 会话的上下文字符串
 * 用于传递给 LLM 进行规划和执行
 */
export function buildQuestContext(session: QuestSession): string {
  const parts: string[] = []
  
  // 用户目标
  parts.push(`## 任务目标\n${session.userGoal}`)
  
  // 探索结果摘要
  if (session.explorationResults.length > 0) {
    parts.push(`\n## 探索发现 (${session.explorationResults.length} 项)`)
    session.explorationResults.forEach((r, i) => {
      parts.push(`${i + 1}. [${r.source}] ${r.query}`)
      parts.push(`   ${r.summary.slice(0, 200)}`)
    })
  }
  
  // 累积上下文（最近 15 条）
  const recentContext = session.accumulatedContext.slice(-15)
  if (recentContext.length > 0) {
    parts.push(`\n## 执行历史 (${recentContext.length} 条)`)
    recentContext.forEach(c => {
      const prefix = c.type === 'exploration' ? '🔍' : c.type === 'execution' ? '⚡' : '💬'
      parts.push(`${prefix} ${c.content.slice(0, 150)}`)
    })
  }
  
  // 当前计划状态
  if (session.proposedPlan) {
    const plan = session.proposedPlan
    const completed = plan.subTasks.filter(t => t.status === 'done').length
    const total = plan.subTasks.length
    parts.push(`\n## 计划进度: ${completed}/${total}`)
    
    // 显示当前执行的任务
    const executing = plan.subTasks.find(t => t.status === 'executing')
    if (executing) {
      parts.push(`当前: ${executing.description}`)
    }
  }
  
  return parts.join('\n')
}

/**
 * 估算文本的 token 数量（简单实现）
 */
export function estimateTokens(text: string): number {
  // 粗略估算：中文约 1.5 token/字，英文约 0.25 token/word
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length
  const others = text.length - chineseChars - englishWords
  
  return Math.ceil(chineseChars * 1.5 + englishWords * 0.25 + others * 0.5)
}

/**
 * 压缩 Quest 上下文（超过阈值时调用 LLM 摘要）
 * 返回压缩后的上下文条目数组
 */
export async function compressQuestContext(
  context: ContextEntry[],
  maxTokens: number = 3000,
  summarizer?: (text: string) => Promise<string>
): Promise<ContextEntry[]> {
  const fullText = context.map(c => c.content).join('\n')
  const currentTokens = estimateTokens(fullText)
  
  if (currentTokens <= maxTokens) {
    return context
  }
  
  // 如果没有摘要函数，简单截断
  if (!summarizer) {
    // 保留最近的条目，直到 token 数量低于阈值
    const result: ContextEntry[] = []
    let totalTokens = 0
    
    for (let i = context.length - 1; i >= 0 && totalTokens < maxTokens; i--) {
      const entry = context[i]
      const entryTokens = estimateTokens(entry.content)
      if (totalTokens + entryTokens <= maxTokens) {
        result.unshift(entry)
        totalTokens += entryTokens
      }
    }
    
    return result
  }
  
  // 使用 LLM 摘要压缩
  try {
    const summary = await summarizer(fullText)
    return [{
      type: 'execution',
      content: `[历史摘要] ${summary}`,
      timestamp: Date.now(),
    }]
  } catch (error) {
    console.warn('[contextBuilder] Failed to summarize context:', error)
    // 降级：简单截断
    return context.slice(-5)
  }
}

/**
 * 合并探索结果为简洁摘要
 */
export function summarizeExplorationResults(results: ExplorationResult[]): string {
  if (results.length === 0) return '无探索结果'
  
  const bySource: Record<string, string[]> = {}
  
  for (const r of results) {
    if (!bySource[r.source]) {
      bySource[r.source] = []
    }
    bySource[r.source].push(r.summary.slice(0, 100))
  }
  
  const parts: string[] = []
  for (const [source, summaries] of Object.entries(bySource)) {
    parts.push(`[${source}] ${summaries.join('; ')}`)
  }
  
  return parts.join('\n')
}
