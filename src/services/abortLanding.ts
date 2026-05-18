/**
 * AbortLanding — Transcriptase abort 触发时的"软着陆"模块
 *
 * 背景：当 Transcriptase 熔断规则（如探索死循环、反复规划）触发 abort 时，
 * 绝不能让用户"戛然而止只看到一行报错 + 烧了的 token"，必须保证他们
 * 一定能拿到一份有价值的 Markdown 答案 / 进展报告 / 下一步建议。
 *
 * 设计：三层降级，每一层都比前一层更轻量、更不易失败。
 *   L1 完整收尾 — 裁剪 messages + 无 tools + 30s 超时，让 LLM 基于全量上下文收尾
 *   L2 最小重试 — 只给 system + 用户原 query + 本地拼的进展摘要，再调一次 LLM
 *   L3 纯本地兜底 — 从 traceTools / ledger.facts 本地拼 Markdown，永不失败
 *
 * 任何一层成功都直接返回，失败再降级到下一层。
 */

import type { BaseLedger, ExecTraceToolCall } from '@/types'
import { chat, type SimpleChatMessage } from './llmService'

// ============================================
// 配置
// ============================================

const CONFIG = {
  /** L1 完整收尾时保留最近多少条 messages（system + 尾部若干轮） */
  L1_KEEP_TAIL: 12,
  /** L1 LLM 调用超时 (ms) */
  L1_TIMEOUT_MS: 30_000,
  /** L2 最小重试超时 (ms) */
  L2_TIMEOUT_MS: 20_000,
  /** 进展摘要里每类 facts 最多列几条 */
  DIGEST_MAX_ITEMS_PER_GROUP: 8,
  /** 工具结果预览最大字符数 */
  TOOL_RESULT_PREVIEW: 160,
} as const

/** 对用户友好的中止标题（替代"碱基序列控制终止"这种内部黑话） */
export const ABORT_TITLE = '⚠️ 任务已自动中止（反复探索未收敛）'

// ============================================
// 类型
// ============================================

export interface ProgressDigest {
  /** 用户原始问题（已截断） */
  userQuery: string
  /** Agent 已完成的动作摘要 */
  completedActions: string[]
  /** Agent 发现但未整合的资源 */
  discoveredResources: string[]
  /** 已经尝试但失败的路径 */
  failedApproaches: string[]
  /** 最近的工具调用（成功 + 失败） */
  recentTools: Array<{ name: string; status: 'success' | 'error'; preview: string }>
  /** 中止原因（Transcriptase 决策 reasoning） */
  abortReason: string
  /** 触发的熔断规则 id（便于用户排查） */
  triggeredPatternId?: string
  /** 已执行的轮次数 */
  turnCount: number
}

export interface AbortLandingInput {
  /** 主循环的完整 messages（会被复制，不改原数组） */
  messages: SimpleChatMessage[]
  /** 用户原始 prompt */
  userPrompt: string
  /** 主循环收集的工具调用记录 */
  traceTools: ExecTraceToolCall[]
  /** 当前 BaseLedger 快照，可选（取不到时走降级） */
  ledger: BaseLedger | null
  /** Transcriptase 决策理由 */
  abortReason: string
  /** Transcriptase 触发的规则 id */
  triggeredPatternId?: string
  /** 主循环当前轮次 */
  turnCount: number
  /** 用户主动中止的 signal（如果已 aborted 就跳过 LLM 调用直接走 L3） */
  signal?: AbortSignal
}

export interface AbortLandingResult {
  /** 最终面向用户的 Markdown 回复 */
  finalResponse: string
  /** 走到了第几层（1/2/3） */
  landingLevel: 1 | 2 | 3
  /** L1/L2 失败时的错误说明（仅 debug 用，不会拼进 finalResponse） */
  debugErrors: string[]
}

// ============================================
// 公开 API
// ============================================

/**
 * 从当前运行状态构建一份"进展摘要"。
 * 纯本地拼装，不依赖 LLM，不会失败。
 */
export function buildProgressDigest(input: Omit<AbortLandingInput, 'messages' | 'signal'>): ProgressDigest {
  const { userPrompt, traceTools, ledger, abortReason, triggeredPatternId, turnCount } = input

  const facts = ledger?.facts
  const max = CONFIG.DIGEST_MAX_ITEMS_PER_GROUP

  // 优先使用 ledger.facts（规则提取的结构化数据），降级为从 traceTools 拼
  const completedActions = facts?.completedActions?.slice(-max) ?? []
  const discoveredResources = facts?.discoveredResources?.slice(-max) ?? []
  const failedApproaches = facts?.failedApproaches?.slice(-max) ?? []

  // 最近的工具调用（取尾部 8 条）
  const recentTools = traceTools.slice(-8).map(t => ({
    name: t.name,
    status: t.status,
    preview: truncate(t.result ?? '', CONFIG.TOOL_RESULT_PREVIEW),
  }))

  return {
    userQuery: truncate(userPrompt, 300),
    completedActions,
    discoveredResources,
    failedApproaches,
    recentTools,
    abortReason: truncate(abortReason, 400),
    triggeredPatternId,
    turnCount,
  }
}

/**
 * 三层降级着陆，一定会返回一段用户可读的 Markdown。
 */
export async function gracefulAbortLanding(input: AbortLandingInput): Promise<AbortLandingResult> {
  const digest = buildProgressDigest(input)
  const debugErrors: string[] = []

  // 用户已主动中止 —— 跳过 LLM，直接 L3
  if (input.signal?.aborted) {
    return {
      finalResponse: buildLocalFallbackMarkdown(digest),
      landingLevel: 3,
      debugErrors: ['aborted_by_user_before_landing'],
    }
  }

  // ─── L1: 完整收尾 ───
  try {
    const trimmed = trimMessagesForLanding(input.messages, CONFIG.L1_KEEP_TAIL)
    trimmed.push({
      role: 'system',
      content: buildL1SystemInstruction(digest),
    })
    const llmText = await chatWithTimeout(trimmed, CONFIG.L1_TIMEOUT_MS)
    if (llmText && llmText.trim().length > 0) {
      return {
        finalResponse: composeFinalResponse(digest, llmText, 1),
        landingLevel: 1,
        debugErrors,
      }
    }
    debugErrors.push('L1_empty_response')
  } catch (err) {
    debugErrors.push(`L1_failed: ${errMsg(err)}`)
    console.warn('[AbortLanding] L1 failed, falling back to L2:', err)
  }

  if (input.signal?.aborted) {
    return {
      finalResponse: buildLocalFallbackMarkdown(digest),
      landingLevel: 3,
      debugErrors: [...debugErrors, 'aborted_between_L1_L2'],
    }
  }

  // ─── L2: 最小上下文重试 ───
  try {
    const minimalMessages: SimpleChatMessage[] = [
      { role: 'system', content: buildL2SystemInstruction() },
      { role: 'user', content: buildL2UserPrompt(digest) },
    ]
    const llmText = await chatWithTimeout(minimalMessages, CONFIG.L2_TIMEOUT_MS)
    if (llmText && llmText.trim().length > 0) {
      return {
        finalResponse: composeFinalResponse(digest, llmText, 2),
        landingLevel: 2,
        debugErrors,
      }
    }
    debugErrors.push('L2_empty_response')
  } catch (err) {
    debugErrors.push(`L2_failed: ${errMsg(err)}`)
    console.warn('[AbortLanding] L2 failed, falling back to L3:', err)
  }

  // ─── L3: 纯本地兜底 ───
  return {
    finalResponse: buildLocalFallbackMarkdown(digest),
    landingLevel: 3,
    debugErrors,
  }
}

// ============================================
// 内部实现：messages 裁剪 & 提示词构造
// ============================================

/**
 * 裁剪 messages 用于 L1 完整收尾：
 * - 保留第一条 system（含系统提示）
 * - 保留最近 keepTail 条
 * - 清除所有 tool_calls / tool role（避免 LLM 把脏上下文当成还没结束的工具调用继续发指令）
 * - 保证裁剪后首条非 system 是 user 角色（兼容 Anthropic 格式对首条必须是 user 的硬性要求）
 * - 保证除 system 外至少有一条消息，避免 LLM API 拒收空对话
 */
function trimMessagesForLanding(
  messages: SimpleChatMessage[],
  keepTail: number,
): SimpleChatMessage[] {
  const result: SimpleChatMessage[] = []

  // 保留首条 system
  if (messages.length > 0 && messages[0].role === 'system') {
    result.push({
      role: 'system',
      content: safeContent(messages[0].content),
    })
  }

  const tail = messages.slice(Math.max(1, messages.length - keepTail))

  for (const m of tail) {
    // 跳过 tool 角色消息（收尾阶段不需要工具响应上下文）
    if (m.role === 'tool') continue

    if (m.role === 'assistant') {
      const content = safeContent(m.content)
      // 纯 tool_calls 的空文本 assistant 消息丢弃（禁用 tools 后它没有配对 tool 响应，会让 Anthropic 报错）
      if (!content && m.tool_calls && m.tool_calls.length > 0) continue
      result.push({ role: 'assistant', content })
      continue
    }

    if (m.role === 'user') {
      result.push({ role: 'user', content: safeContent(m.content) })
      continue
    }

    // 其它未知 role（含 system 非首条）统一降级为 user，避免后端报错
    result.push({ role: 'user', content: safeContent(m.content) })
  }

  // 统计 system 之外的消息
  const nonSystemStart = result[0]?.role === 'system' ? 1 : 0
  const nonSystemPart = result.slice(nonSystemStart)

  // 兼容 Anthropic：首条非 system 必须是 user
  if (nonSystemPart.length === 0) {
    result.push({
      role: 'user',
      content: '请基于前面的系统提示和已知上下文，给我一份收尾答复。',
    })
  } else if (nonSystemPart[0].role !== 'user') {
    // 首条是 assistant —— 塞一条引导性 user 消息在它前面
    result.splice(nonSystemStart, 0, {
      role: 'user',
      content: '[上下文续接] 基于前面的执行进展，请直接收尾回答我的原始问题。',
    })
  }

  return result
}

/** SimpleChatMessage.content 是 string | null，这里统一归一为 string */
function safeContent(content: string | null | undefined): string {
  return typeof content === 'string' ? content : ''
}

function buildL1SystemInstruction(digest: ProgressDigest): string {
  return [
    '任务因反复探索未收敛已被系统自动中止。',
    '现在请**不要再调用任何工具**，直接用中文 Markdown 回复用户，包含以下内容：',
    '',
    '1. **已经做了什么** — 对前面 ' + digest.turnCount + ' 轮执行做一个精炼的回顾（不要流水账，提炼关键进展）',
    '2. **初步结论 / 已掌握的信息** — 基于已有工具结果，哪怕只是部分答案也要给出（这是最重要的，用户的 token 不能白烧）',
    '3. **卡在哪** — 解释为什么没能完全完成',
    '4. **建议的下一步** — 给用户 2-3 条具体的、可执行的建议',
    '',
    '中止原因：' + digest.abortReason,
    digest.triggeredPatternId ? '触发规则：' + digest.triggeredPatternId : '',
    '',
    '回复格式要求：',
    '- 使用清晰的 Markdown 标题层级',
    '- **一定要尝试给出初步答案**，哪怕标注"基于不完整信息"也比空白强',
    '- 不要提及"碱基"、"Transcriptase"、"熔断"等内部术语，用"探索未收敛"、"重复尝试"这类自然表达',
  ].filter(Boolean).join('\n')
}

function buildL2SystemInstruction(): string {
  return [
    '你是一个严谨的助手。用户的任务已因反复探索被系统中止，',
    '现在请**仅基于下面提供的【进展摘要】**，用中文 Markdown 给用户一份：',
    '1. 基于已知信息的初步回答',
    '2. 尚未解答的部分',
    '3. 2-3 条可执行的后续建议',
    '',
    '绝对不要虚构你没看到的信息。不要使用"碱基"、"熔断"等内部术语。',
  ].join('\n')
}

function buildL2UserPrompt(digest: ProgressDigest): string {
  const lines: string[] = []
  lines.push('## 我的原始问题')
  lines.push(digest.userQuery)
  lines.push('')
  lines.push(`## 执行进展摘要（已跑 ${digest.turnCount} 轮）`)

  if (digest.completedActions.length > 0) {
    lines.push('### 已完成的动作')
    digest.completedActions.forEach(a => lines.push(`- ${truncate(a, 200)}`))
  }
  if (digest.discoveredResources.length > 0) {
    lines.push('### 已发现的资源')
    digest.discoveredResources.forEach(r => lines.push(`- ${truncate(r, 200)}`))
  }
  if (digest.failedApproaches.length > 0) {
    lines.push('### 失败的尝试')
    digest.failedApproaches.forEach(f => lines.push(`- ${truncate(f, 200)}`))
  }
  if (digest.recentTools.length > 0) {
    lines.push('### 最近的工具调用')
    digest.recentTools.forEach(t => {
      const icon = t.status === 'success' ? '✅' : '❌'
      lines.push(`- ${icon} \`${t.name}\` — ${t.preview || '(无输出)'}`)
    })
  }

  lines.push('')
  lines.push('请基于以上信息给我一份初步答复 + 后续建议。')
  return lines.join('\n')
}

/**
 * 拼接最终面向用户的 Markdown：
 * 顶部统一展示友好的中止横幅 + 执行概况 + LLM 生成的正文
 */
function composeFinalResponse(digest: ProgressDigest, llmBody: string, level: 1 | 2): string {
  const lines: string[] = []
  lines.push(`### ${ABORT_TITLE}`)
  lines.push('')
  lines.push('> 系统检测到任务在反复探索中难以收敛，已主动中止以避免继续消耗 token。')
  lines.push(`> 已执行 **${digest.turnCount}** 轮，触发：${digest.abortReason}`)
  lines.push(`> 已为你整理一份**初步答复与建议**（降级层级 L${level}）：`)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push(llmBody.trim())
  return lines.join('\n')
}

/**
 * L3 纯本地兜底 Markdown —— 永不失败。
 * 没有 LLM 生成答案，但至少保证结构化地展示"已经做了什么 / 卡在哪 / 建议"。
 */
function buildLocalFallbackMarkdown(digest: ProgressDigest): string {
  const lines: string[] = []
  lines.push(`### ${ABORT_TITLE}`)
  lines.push('')
  lines.push('> 系统检测到任务在反复探索中难以收敛，已主动中止。')
  lines.push('> 由于收尾阶段生成答复也未成功，以下是**本地整理的执行纪要**，供你参考（降级层级 L3）：')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('#### 你的原始问题')
  lines.push(digest.userQuery || '(未捕获)')
  lines.push('')
  lines.push(`#### 执行概览`)
  lines.push(`- 已执行轮次：${digest.turnCount}`)
  lines.push(`- 中止原因：${digest.abortReason || '(未提供)'}`)
  if (digest.triggeredPatternId) {
    lines.push(`- 触发规则：\`${digest.triggeredPatternId}\``)
  }
  lines.push('')

  if (digest.completedActions.length > 0) {
    lines.push('#### ✅ 已完成的动作')
    digest.completedActions.forEach(a => lines.push(`- ${truncate(a, 240)}`))
    lines.push('')
  }
  if (digest.discoveredResources.length > 0) {
    lines.push('#### 📁 已发现的资源')
    digest.discoveredResources.forEach(r => lines.push(`- ${truncate(r, 240)}`))
    lines.push('')
  }
  if (digest.failedApproaches.length > 0) {
    lines.push('#### ❌ 失败的尝试')
    digest.failedApproaches.forEach(f => lines.push(`- ${truncate(f, 240)}`))
    lines.push('')
  }
  if (digest.recentTools.length > 0) {
    lines.push('#### 🔧 最近的工具调用')
    digest.recentTools.forEach(t => {
      const icon = t.status === 'success' ? '✅' : '❌'
      lines.push(`- ${icon} \`${t.name}\` — ${t.preview || '(无输出)'}`)
    })
    lines.push('')
  }

  lines.push('#### 💡 建议的下一步')
  const suggestions = buildGenericSuggestions(digest)
  suggestions.forEach(s => lines.push(`- ${s}`))

  return lines.join('\n')
}

function buildGenericSuggestions(digest: ProgressDigest): string[] {
  const out: string[] = []

  if (digest.failedApproaches.length > 0) {
    out.push('换一种问法或提供更具体的约束（比如指定文件路径、输出格式、关键假设），避免 Agent 在同一条路径上反复尝试。')
  }
  if (digest.discoveredResources.length > 0) {
    out.push('已有一些相关资源被发现，你可以基于这些线索手动补一个更聚焦的子问题，让 Agent 直接从这里切入。')
  }
  if (digest.recentTools.some(t => t.status === 'error')) {
    out.push('最近有工具调用失败，建议先排查工具本身或参数，再继续让 Agent 执行。')
  }
  if (out.length === 0) {
    out.push('换一种问法并提供更具体的上下文（目标、约束、已知条件），可显著提升一次性通过率。')
    out.push('如果问题本身开放性较强，建议拆成更小的子问题分别提问。')
  }
  out.push('你也可以直接告诉我"基于当前进展继续"，我会在已有上下文上再推一把。')
  return out
}

// ============================================
// 工具函数
// ============================================

/** 给 chat() 加一个 Promise.race 超时保护（chat 本身不支持 signal / timeout） */
async function chatWithTimeout(messages: SimpleChatMessage[], timeoutMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<string>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`abort landing LLM call timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
  })
  try {
    // 不传第三个 tools 参数 → 纯文本输出，绝不会再触发 tool_calls
    const result = await Promise.race([chat(messages), timeoutPromise])
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function truncate(s: string, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
