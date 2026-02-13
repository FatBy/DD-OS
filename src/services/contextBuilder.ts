/**
 * 上下文构建器
 * 根据当前页面类型构建 LLM 的 system prompt 和数据上下文
 */

import type { ChatMessage, ViewType, TaskItem, SkillNode, MemoryEntry, SoulTruth, SoulBoundary } from '@/types'

// ============================================
// 系统 Prompt
// ============================================

const SYSTEM_PROMPTS: Record<string, string> = {
  task: `你是 DD-OS 任务管理助手。你的职责是帮助用户分析任务状态、建议优先级、识别瓶颈。
回答要简洁精炼，使用中文。如果用户请求执行任务，可以通过 /run 指令来执行。`,

  skill: `你是 DD-OS 技能分析助手。你的职责是帮助用户了解当前已安装的技能、分析技能覆盖度、推荐可能需要的新技能。
回答要简洁精炼，使用中文。`,

  memory: `你是 DD-OS 记忆管理助手。你的职责是帮助用户总结和分析记忆数据、发现记忆间的关联、提取关键洞察。
回答要简洁精炼，使用中文。`,

  soul: `你是 DD-OS 灵魂分析助手。你的职责是帮助用户理解 Agent 的个性配置、分析核心特质和边界规则、建议优化方向。
回答要简洁精炼，使用中文。`,

  default: `你是 DD-OS 智能助手，帮助用户管理和分析 OpenClaw AI Agent 的各项数据。
回答要简洁精炼，使用中文。`,
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
  
  const messages: ChatMessage[] = [
    {
      id: 'sys',
      role: 'system',
      content: `${systemPrompt}\n\n当前数据:\n${context}`,
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
