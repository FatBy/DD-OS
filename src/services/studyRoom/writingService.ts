/**
 * Writing Service — 自习室核心编排 v2
 *
 * v2 核心变更: 对话驱动的流式写作
 * - runIntake      — 意图入舱 (本地推断, 无 LLM)
 * - runTelescope   — 多路并行采集
 * - draftAgenda    — 议程生成 (LLM, 内部思维链)
 * - runFullWriting — P2→P3→全文流式一气呵成 (v2 核心)
 * - runConversationalEdit — 对话式修改 (v2)
 * - composeDraft   — 段级草起 (legacy, 保留兼容)
 */

import type {
  WritingBrief, EvidenceItem, AgendaDoc, AgendaSection,
  GenreHint, LengthHint, ToneHint, SkillRef,
  WriterChatMessage, MemorySnippet, EditSummary,
  WriterMessageIntent, SuggestedEdit, ProfileSuggestion,
} from '@/types'
import { streamChat, getLLMConfig, chatBackground } from '@/services/llmService'
import type { SimpleChatMessage, LLMStreamResult } from '@/services/llmService'
import { studyAbortManager } from './abortManager'
import { WritingError, withRetry } from './errors'
import {
  WRITING_CONDUCTOR_PROMPT,
  WRITING_CHAT_SYSTEM_PROMPT,
  buildAgendaPrompt,
  buildComposePrompt,
  buildConversationalEditPrompt,
  buildLengthReviewPrompt,
  buildAgendaCritiquePrompt,
  buildAgendaRevisePrompt,
  EDIT_SUMMARY_DELIMITER,
  WRITER_INTENT_CLASSIFY_PROMPT,
  buildWriterIntentClassifyPrompt,
  WRITER_DISCUSS_SYSTEM_PROMPT,
  buildWriterDiscussPrompt,
  SUGGESTED_EDIT_DELIMITER,
  type SectionLengthMeasure,
  // v3: One-Pass Writing
  ONE_PASS_WRITING_SYSTEM_PROMPT,
  buildOnePassWritingPrompt,
  OUTLINE_TAG_OPEN,
  OUTLINE_TAG_CLOSE,
  formatFingerprintV2,
  resolveFingerprintForBrief,
} from './prompts'
import { matchSkills } from './skillMatcher'
import { lensLibrary } from './lenses/library'
import { lensSkills } from './lenses/skills'
import { recallMemory } from './memoryService'
import { recordArticleCompletion } from './writerProfile'
import { pipelineTracer } from './pipelineTracer'
import {
  STUDY_ROOM_TOOLS,
  executeStudyTool,
  buildToolGuidelines,
  type ToolCallRequest,
  type ToolCallResult,
} from './toolCaller'

// ============================================
// Token Tracker — 自习室 LLM 调用的 token 消耗统计
// ============================================

/**
 * 自习室 Token 追踪器.
 *
 * 每次 runFullWriting / runConversationalEdit 入口调用 start(), 出口调用 finishAndPrint().
 * 内部对每次 streamChat 调用按 stage 归类累加, 结束时打印汇总表.
 * 完全无侵入: streamChat 本体不改动, 只在上层包装.
 */
class StudyTokenTracker {
  private sessionId: string | null = null
  private rootLabel = ''
  private startTime = 0
  private records: Array<{
    stage: string
    prompt: number
    completion: number
    total: number
    ts: number
  }> = []

  start(sessionId: string, rootLabel: string) {
    this.sessionId = sessionId
    this.rootLabel = rootLabel
    this.startTime = Date.now()
    this.records = []
    console.info(
      `%c[StudyRoom Token] ⏵ ${rootLabel} 开始`,
      'color:#0891b2;font-weight:bold',
      { sessionId },
    )
  }

  /** 登记一次 LLM 调用的 usage. 允许 usage 为空 (某些 LLM 不回 usage). */
  record(stage: string, usage: { prompt_tokens?: number; completion_tokens?: number } | undefined) {
    if (!this.sessionId) return  // 未 start, 忽略
    const prompt = usage?.prompt_tokens || 0
    const completion = usage?.completion_tokens || 0
    const total = prompt + completion
    this.records.push({
      stage, prompt, completion, total, ts: Date.now(),
    })
    console.debug(
      `[StudyRoom Token] · ${stage}: prompt=${prompt}, completion=${completion}, total=${total}`,
    )
  }

  /** 汇总并打印. 默认按 stage 聚合, 同时给出调用次数和占比. */
  finishAndPrint() {
    if (!this.sessionId) return
    const elapsedMs = Date.now() - this.startTime
    const byStage = new Map<string, { prompt: number; completion: number; total: number; count: number }>()
    let totalPrompt = 0
    let totalCompletion = 0

    for (const r of this.records) {
      const cur = byStage.get(r.stage) || { prompt: 0, completion: 0, total: 0, count: 0 }
      cur.prompt += r.prompt
      cur.completion += r.completion
      cur.total += r.total
      cur.count += 1
      byStage.set(r.stage, cur)
      totalPrompt += r.prompt
      totalCompletion += r.completion
    }
    const grandTotal = totalPrompt + totalCompletion

    // 按 total 降序排
    const rows = Array.from(byStage.entries())
      .map(([stage, v]) => ({
        stage,
        calls: v.count,
        prompt: v.prompt,
        completion: v.completion,
        total: v.total,
        pct: grandTotal > 0 ? `${((v.total / grandTotal) * 100).toFixed(1)}%` : '0%',
      }))
      .sort((a, b) => b.total - a.total)

    console.info(
      `%c[StudyRoom Token] ⏹ ${this.rootLabel} 结束 · 耗时 ${(elapsedMs / 1000).toFixed(1)}s · 总 tokens ${grandTotal} (prompt ${totalPrompt} / completion ${totalCompletion})`,
      'color:#0891b2;font-weight:bold',
    )
    if (rows.length > 0 && typeof console.table === 'function') {
      console.table(rows)
    } else {
      rows.forEach((r) => console.info(`  ${r.stage}: ${r.total} tokens (${r.calls} 次, ${r.pct})`))
    }

    this.sessionId = null
    this.records = []
  }
}

const tokenTracker = new StudyTokenTracker()

/**
 * 对 streamChat 的轻量包装: 调用后自动把 usage 累加到 tokenTracker.
 * 签名与 streamChat 一致, 仅多一个 stage 参数, 放在最前方.
 */
async function trackedStream(
  stage: string,
  messages: SimpleChatMessage[],
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
  config?: Parameters<typeof streamChat>[3],
  tools?: Parameters<typeof streamChat>[4],
  onReasoningChunk?: (chunk: string) => void,
): Promise<LLMStreamResult> {
  const result = await streamChat(messages, onChunk, signal, config, tools, onReasoningChunk)
  tokenTracker.record(stage, result.usage)
  return result
}

// ============================================
// P1: Intake (本地推断, <50ms)
// ============================================

const GENRE_RULES: Array<[RegExp, GenreHint]> = [
  [/报告|分析|汇报|研究|调研/, 'report'],
  [/文章|散文|随笔|杂文/, 'essay'],
  [/信|邮件|致|回复/, 'letter'],
  [/备忘|纪要|通知|公文|公告/, 'memo'],
  [/教程|指南|手册|入门/, 'tutorial'],
  [/小说|故事|剧本/, 'novel'],
]

/**
 * 长度的"用户显式指定"识别.
 *
 * 与之前不同: 这里不再用正则给 length 贴标签,
 * 而是判断用户是否"明确表达了对篇幅的要求".
 * 只有命中时才设 lengthExplicit=true, 走硬约束分支.
 * 否则 length 仅作为兜底 'medium', 由 LLM 在 Agenda 阶段自主谋篇.
 */
const LENGTH_EXPLICIT_RULES: Array<[RegExp, LengthHint]> = [
  // 明确字数: 300/500/800/1000/1500/2000/3000/5000/万字
  [/(\d{3,5})\s*(字|words?)/i, 'medium'], // 字数会被单独提取到 constraints, 档位默认 medium
  [/万字|万余字/, 'xlong'],
  [/长文|长篇|详尽|全面展开/, 'long'],
  [/简短|简要|几句话|一小段|短评|精炼/, 'short'],
]

const TONE_RULES: Array<[RegExp, ToneHint]> = [
  [/正式|严谨|官方/, 'formal'],
  [/分析|数据|量化/, 'analytical'],
  [/叙事|讲述|故事/, 'narrative'],
  [/批评|质疑|反思/, 'critical'],
  [/温暖|亲切|温情/, 'warm'],
  [/技术|专业|学术/, 'technical'],
]

export function runIntake(
  intent: string,
  options?: {
    skills?: Array<{ name: string; description?: string; keywords?: string[]; whenToUse?: string; tags?: string[]; enabled?: boolean; toolType?: string; category?: string; instructions?: string }>
    pinnedEntityIds?: string[]
    dunId?: string | null
    userPickedSkills?: SkillRef[]
  },
): WritingBrief {
  // 推断 genre
  let genre: GenreHint = 'custom'
  for (const [re, g] of GENRE_RULES) {
    if (re.test(intent)) { genre = g; break }
  }

  // 推断 length: 仅当用户显式指定时才采纳, 否则兜底 medium 但标记非显式
  let length: LengthHint = 'medium'
  let lengthExplicit = false
  const explicitConstraints: string[] = []
  for (const [re, l] of LENGTH_EXPLICIT_RULES) {
    const m = intent.match(re)
    if (m) {
      length = l
      lengthExplicit = true
      // 若是具体字数, 把原话作为硬约束保留给 LLM
      if (/\d/.test(m[0])) {
        explicitConstraints.push(`用户指定篇幅: ${m[0]}`)
      }
      break
    }
  }

  // 推断 tone
  const tone: ToneHint[] = []
  for (const [re, t] of TONE_RULES) {
    if (re.test(intent)) tone.push(t)
  }
  if (tone.length === 0) tone.push('formal')

  // 匹配 skills
  const autoSkills: SkillRef[] = (options?.skills ? matchSkills(intent, options.skills) : [])
    .slice(0, 3)
    .map((s) => ({ name: s.name, source: 'auto' as const, priority: 'secondary' as const }))

  // 合并用户选择的 skills
  const allSkills: SkillRef[] = [...(options?.userPickedSkills || []), ...autoSkills]
  // 去重
  const seen = new Set<string>()
  const deduped = allSkills.filter((s) => {
    if (seen.has(s.name)) return false
    seen.add(s.name)
    return true
  })

  // 第一个 user/mention skill 升级为 primary
  if (deduped.length > 0 && !deduped.some((s) => s.priority === 'primary')) {
    deduped[0].priority = 'primary'
  }

  return {
    id: `brief-${Date.now().toString(36)}`,
    intent,
    genre,
    length,
    lengthExplicit,
    tone,
    audience: '通用读者',
    constraints: explicitConstraints,
    skills: deduped,
    pinnedEntityIds: options?.pinnedEntityIds || [],
    // runIntake 内部 dunId 允许 null, 但 WritingBrief.dunId 只接受 string | undefined;
    // 这里把 null 归一化为 undefined, 避免 "未选 Dun" 的空值污染下游契约.
    dunId: options?.dunId ?? undefined,
    createdAt: Date.now(),
  }
}

// ============================================
// P2: Telescope (并行采集)
// ============================================

export async function runTelescope(
  brief: WritingBrief,
  storeSkills: Array<{ name: string; description?: string; keywords?: string[]; whenToUse?: string; tags?: string[]; enabled?: boolean; toolType?: string; category?: string; instructions?: string }>,
  signal?: AbortSignal,
): Promise<EvidenceItem[]> {
  const tasks = [
    lensLibrary(brief.intent, 20, brief.dunId),
    Promise.resolve(
      lensSkills(
        brief.intent,
        storeSkills,
        brief.skills.map((s) => s.name),
      ),
    ),
  ]

  const settled = await Promise.allSettled(tasks)

  const allItems: EvidenceItem[] = []
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      allItems.push(...result.value)
    }
  }

  // 检查 signal (allSettled 完成后可能已被取消)
  if (signal?.aborted) return allItems

  return allItems
}

// ============================================
// P3: Agenda (LLM 生成)
// ============================================

export async function draftAgenda(
  brief: WritingBrief,
  pool: EvidenceItem[],
  sessionId: string,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void,
): Promise<AgendaDoc> {
  // 初版 agenda 生成
  const firstDraftPrompt = buildAgendaPrompt(brief, pool)
  const firstDraftMessages = [
    { role: 'system' as const, content: WRITING_CONDUCTOR_PROMPT },
    { role: 'user' as const, content: firstDraftPrompt },
  ]

  const parse = async (): Promise<AgendaDoc> => {
    let fullText = ''
    await trackedStream(
      'agenda.draft',
      firstDraftMessages,
      (chunk) => { fullText += chunk },
      signal,
    )

    // 清理 markdown 代码块包裹
    let cleaned = fullText.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    }

    const raw = JSON.parse(cleaned)
    return normalizeAgenda(raw, brief.id)
  }

  try {
    let agenda = await withRetry(parse, {
      maxRetries: 1,
      onRetry: () => { /* 重试一次 */ },
    })

    // --- 提纲自我批判循环 (Self-Refine): 最多 AGENDA_CRITIQUE_ROUNDS 轮 ---
    for (let round = 0; round < REFINEMENT_CONFIG.AGENDA_CRITIQUE_ROUNDS; round++) {
      if (signal?.aborted) break

      onProgress?.(`复核提纲 (第 ${round + 1}/${REFINEMENT_CONFIG.AGENDA_CRITIQUE_ROUNDS} 轮)...`)

      const critique = await critiqueAgenda(
        brief, agenda, round, REFINEMENT_CONFIG.AGENDA_CRITIQUE_ROUNDS, signal,
      )

      if (!critique || critique.pass) {
        if (critique && round > 0) {
          console.debug('[StudyRoom] Agenda self-critique converged after', round + 1, 'round(s)')
        }
        break
      }

      if (!critique.suggestion || !critique.issues || critique.issues.length === 0) {
        // LLM 说不通过但没给建议/问题, 视为可接受
        break
      }

      onProgress?.(`根据批判意见修订提纲...`)
      const revised = await reviseAgenda(
        brief, agenda, critique.issues, critique.suggestion, signal,
      )
      if (!revised) break

      // agenda.revision 是可选字段 (旧存档里可能为空), 兜底为 0 再自增
      agenda = { ...revised, revision: (agenda.revision ?? 0) + 1 }
    }

    return agenda
  } catch (err) {
    // 降级: 单节占位议程
    // 注意: 这是最后的兜底, targetLength 仅用于"有个数字避免空指针",
    // 真正的篇幅判断由后续 length review 阶段基于实际成稿字数做决定.
    if (signal?.aborted) {
      throw new WritingError({
        code: 'user_aborted', stage: 'agenda', sessionId,
      })
    }
    console.warn('[StudyRoom] Agenda parse failed, degrading to placeholder:', err)
    const placeholderLength = brief.lengthExplicit
      ? estimateLengthFromConstraints(brief) || 800
      : 800
    return {
      briefId: brief.id,
      title: brief.intent.slice(0, 50),
      sections: [{
        id: `sec-${Date.now().toString(36)}`,
        order: 1,
        heading: brief.intent.slice(0, 30),
        intent: brief.intent,
        targetLength: placeholderLength,
        evidencePocket: [],
        skillHints: [],
        status: 'planned',
        revision: 1,
      }],
      lengthRationale: '(Agenda 解析失败, 使用单节占位; 篇幅将在成稿后由 length review 阶段复核)',
      revision: 1,
    }
  }
}

/**
 * 从 brief.constraints 中提取用户显式指定的字数 (如 "800 字", "1500 words").
 * 仅在 lengthExplicit=true 时调用, 未命中返回 null.
 */
function estimateLengthFromConstraints(brief: WritingBrief): number | null {
  for (const c of brief.constraints) {
    const m = c.match(/(\d{3,5})\s*(字|words?)/i)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n >= 100 && n <= 50000) return n
    }
  }
  return null
}

function normalizeAgenda(raw: Record<string, unknown>, briefId: string): AgendaDoc {
  const rawSections = raw.sections as Array<Record<string, unknown>> | undefined
  if (!rawSections || rawSections.length === 0) {
    // 没有 sections 属于严重格式错误, 抛错让 withRetry 重试
    throw new Error('Agenda JSON missing "sections" array')
  }

  const sections = rawSections.map((sec, idx): AgendaSection => {
    const targetLength = typeof sec.targetLength === 'number' && sec.targetLength > 0
      ? Math.round(sec.targetLength)
      : null
    if (targetLength === null) {
      // 不再静默兜底 500, 抛错进 withRetry
      throw new Error(
        `Agenda section[${idx}] "${sec.heading || '(untitled)'}" missing or invalid targetLength`,
      )
    }
    return {
      id: `sec-${Date.now().toString(36)}-${idx}`,
      order: (sec.order as number) || idx + 1,
      heading: (sec.heading as string) || `第 ${idx + 1} 节`,
      intent: (sec.intent as string) || '',
      targetLength,
      evidencePocket: (sec.evidencePocket as string[]) || [],
      skillHints: (sec.skillHints as string[]) || [],
      status: 'planned',
      revision: 1,
    }
  })

  return {
    briefId,
    title: (raw.title as string) || '',
    subtitle: raw.subtitle as string | undefined,
    sections,
    openingStance: raw.openingStance as string | undefined,
    closingCall: raw.closingCall as string | undefined,
    lengthRationale: typeof raw.lengthRationale === 'string' ? raw.lengthRationale : undefined,
    revision: 1,
  }
}

// ============================================
// Agenda Self-Critique (模块私有)
// ============================================

interface AgendaCritiqueResult {
  pass: boolean
  issues?: string[]
  suggestion?: string
}

/**
 * 对当前 agenda 做一次自我批判, 返回结构化判断.
 * LLM / 网络 / 解析失败 → 返回 null, 上层视为 pass.
 */
async function critiqueAgenda(
  brief: WritingBrief,
  agenda: AgendaDoc,
  roundIndex: number,
  maxRounds: number,
  signal?: AbortSignal,
): Promise<AgendaCritiqueResult | null> {
  const userPrompt = buildAgendaCritiquePrompt(brief, agenda, roundIndex, maxRounds)
  const messages: SimpleChatMessage[] = [
    { role: 'system', content: WRITING_CONDUCTOR_PROMPT },
    { role: 'user', content: userPrompt },
  ]

  let fullText = ''
  try {
    await trackedStream('agenda.critique', messages, (chunk) => { fullText += chunk }, signal)
  } catch (err) {
    if (signal?.aborted) throw err
    console.warn('[StudyRoom] Agenda critique LLM call failed:', err)
    return null
  }

  let cleaned = fullText.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  }

  try {
    const raw = JSON.parse(cleaned) as Record<string, unknown>
    return {
      pass: raw.pass === true,
      issues: Array.isArray(raw.issues) ? (raw.issues as unknown[]).filter((x): x is string => typeof x === 'string') : undefined,
      suggestion: typeof raw.suggestion === 'string' ? raw.suggestion : undefined,
    }
  } catch (err) {
    console.warn('[StudyRoom] Agenda critique JSON parse failed:', err, 'raw:', cleaned.slice(0, 200))
    return null
  }
}

/**
 * 根据批判意见修订 agenda. 输出结构与首次 agenda 相同, 仍走 normalizeAgenda.
 * 失败 → 返回 null, 上层保留原版.
 */
async function reviseAgenda(
  brief: WritingBrief,
  previousAgenda: AgendaDoc,
  issues: string[],
  suggestion: string,
  signal?: AbortSignal,
): Promise<AgendaDoc | null> {
  const userPrompt = buildAgendaRevisePrompt(brief, previousAgenda, issues, suggestion)
  const messages: SimpleChatMessage[] = [
    { role: 'system', content: WRITING_CONDUCTOR_PROMPT },
    { role: 'user', content: userPrompt },
  ]

  let fullText = ''
  try {
    await trackedStream('agenda.revise', messages, (chunk) => { fullText += chunk }, signal)
  } catch (err) {
    if (signal?.aborted) throw err
    console.warn('[StudyRoom] Agenda revise LLM call failed:', err)
    return null
  }

  let cleaned = fullText.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  }

  try {
    const raw = JSON.parse(cleaned) as Record<string, unknown>
    // briefId 在 AgendaDoc 上是可选字段 (旧存档可能为空), 但 normalizeAgenda 要求必填.
    // revise 场景下 previousAgenda 必然已关联过 brief, 空兜底只是为了绕过类型声明.
    return normalizeAgenda(raw, previousAgenda.briefId ?? '')
  } catch (err) {
    console.warn('[StudyRoom] Agenda revise JSON parse failed:', err, 'raw:', cleaned.slice(0, 200))
    return null
  }
}

// ============================================
// Reader Modeling 已下线 (v3.1)
// ============================================
// 原因: 正向读者画像的 averseTo 字段会对 LLM 产生负向引导, 和文风指纹方向相反.
// 两股力同时拉会把文字挤向平庸的"平均值", 所以砍掉让指纹独占风向盘.
// 同时省掉一次 LLM 调用 (~2-3s 首字延迟).

// ============================================
// P4: Compose (段级流式)
// ============================================

export async function composeDraft(
  section: AgendaSection,
  pool: EvidenceItem[],
  agenda: AgendaDoc,
  brief: WritingBrief,
  sessionId: string,
  onDelta: (partial: string) => void,
  signal?: AbortSignal,
): Promise<{ body: string; wordCount: number }> {
  const abortKey = `${sessionId}:compose:${section.id}`
  const ctrl = studyAbortManager.acquire(abortKey)
  const combinedSignal = signal || ctrl.signal

  // 邻接段上下文
  const idx = agenda.sections.findIndex((s) => s.id === section.id)
  const prevSection = idx > 0 ? agenda.sections[idx - 1] : undefined
  const nextSection = idx < agenda.sections.length - 1 ? agenda.sections[idx + 1] : undefined

  const neighbors = {
    prev: prevSection?.draft
      ? prevSection.draft.split(/[。！？\n]/).filter(Boolean).slice(-3).join('。')
      : undefined,
    next: nextSection?.intent,
  }

  const userPrompt = buildComposePrompt(section, pool, agenda, brief, neighbors)
  const messages = [
    { role: 'system' as const, content: WRITING_CONDUCTOR_PROMPT },
    { role: 'user' as const, content: userPrompt },
  ]

  let fullText = ''
  try {
    await trackedStream(
      'compose.legacy',
      messages,
      (chunk) => {
        fullText += chunk
        onDelta(fullText)
      },
      combinedSignal,
    )
  } catch (err) {
    if (combinedSignal?.aborted) {
      throw new WritingError({
        code: 'user_aborted', stage: 'compose', sessionId, sectionId: section.id,
      })
    }
    throw new WritingError({
      code: 'llm_unavailable', stage: 'compose', sessionId, sectionId: section.id,
      details: err,
    })
  } finally {
    studyAbortManager.release(abortKey)
  }

  const wordCount = fullText.replace(/\s/g, '').length
  return { body: fullText, wordCount }
}

// ============================================
// v2: 全文一气呵成 (P2→P3→全文流式)
// ============================================

export interface WritingProgress {
  stage: 'telescope' | 'agenda' | 'writing' | 'done' | 'error' | 'memory' | 'tool'
  label: string
  detail?: string
}

// ============================================
// P2: Tool Loop — 自习室工具调用
// ============================================

/** Tool Loop 配置 */
const TOOL_LOOP_CONFIG = {
  MAX_ROUNDS: 3, // 最多 3 轮工具调用, 避免死循环
  TEMPERATURE: 0.2, // 工具决策低温度, 避免乱调
} as const

/**
 * Length Review 配置.
 * 篇幅复核的阈值和熔断参数. 用户无感, 只在后台运行.
 */
const LENGTH_REVIEW_CONFIG = {
  /** 单节字数偏差阈值: 超过即进入复核决策 */
  SECTION_DEVIATION: 0.30,
  /** 全文字数偏差阈值: 超过即进入复核决策 */
  TOTAL_DEVIATION: 0.25,
  /** 最多复核轮次 (含首次写作, 即最多"写一版 + 复核 2 版" = 3 版成稿) */
  MAX_ROUNDS: 3,
  /** 复核决策的 LLM 温度 */
  TEMPERATURE: 0.1,
} as const

/**
 * Refinement 配置 — "交稿前 LLM 折磨自己"的各环节熔断参数.
 */
const REFINEMENT_CONFIG = {
  /** Agenda 自我批判最多几轮 (critique → revise 为一轮) */
  AGENDA_CRITIQUE_ROUNDS: 2,
} as const

// ============================================
// Inline Tool Loop — 流式写作中自带工具调用 (方案一)
// ============================================

/** Inline Tool 配置 */
const INLINE_TOOL_CONFIG = {
  /** 最多工具循环轮次 (不含首轮纯写作) */
  MAX_TOOL_ROUNDS: 3,
} as const

/**
 * 流式写作回调 — 在 runStreamWithTools 内部被调用.
 * 调用方接收和普通 streamChat 一样的 chunk 回调, 同时可选接收工具进度.
 */
export interface StreamWithToolsCallbacks {
  onChunk: (chunk: string) => void
  onReasoningChunk?: (chunk: string) => void
  /** 工具执行进度 (给前端展示思考链) */
  onToolProgress?: (msg: string) => void
  /** 工具产出的新证据 */
  onEvidenceDelta?: (items: EvidenceItem[]) => void
  /** 工具产出的新记忆 */
  onMemoryDelta?: (items: MemorySnippet[]) => void
  /** 风格档案待确认建议 */
  onProfileSuggestions?: (items: ProfileSuggestion[]) => void
  /**
   * 工具轮完成后、下一轮流式开始前被调用.
   * 调用方应在此回调中重置自己的流式累积状态 (rawStream / bodyText / 解析状态机等),
   * 避免工具轮的"思考文字"污染最终正文.
   */
  onContentReset?: () => void
}

/**
 * runStreamWithTools — "流式 → 工具 → 流式" 循环.
 *
 * 机制:
 *   1. 调用 streamChat(messages, onChunk, signal, config, tools)
 *   2. 如果 LLM 返回 toolCalls (finishReason='tool_calls'):
 *      - 执行工具, 追加 assistant + tool 消息
 *      - 循环调用 streamChat (新轮的 chunk 追加到同一回调)
 *   3. 如果 LLM 不返回 toolCalls: 写作完成, 返回最终 LLMStreamResult
 *   4. 最多 INLINE_TOOL_CONFIG.MAX_TOOL_ROUNDS 轮工具调用
 *
 * 相比 runToolLoop 的优势:
 *   - 不调工具场景: 零额外延迟 (不再有独立的"要不要调工具"判断调用)
 *   - 调工具场景: 用户在第一秒就能看到 reasoning 流, 而不是干等
 *   - LLM 在完整上下文中判断"是否需要补采", 比精简版 Tool Loop 更准
 *
 * @param stage  tokenTracker 记账标签
 * @param messages  初始 messages (system + user, 会被就地 mutate)
 * @param tools  工具定义 (传 null/空数组 = 不启用工具)
 * @param callbacks  流式和工具回调
 * @param ctx  工具执行上下文 (dunId, signal)
 * @returns  最终的 LLMStreamResult (content 是最后一轮非工具调用的输出)
 */
async function runStreamWithTools(
  stage: string,
  messages: SimpleChatMessage[],
  tools: Parameters<typeof streamChat>[4] | null,
  callbacks: StreamWithToolsCallbacks,
  ctx: { dunId?: string | null; signal?: AbortSignal },
): Promise<LLMStreamResult> {
  const effectiveTools: Parameters<typeof streamChat>[4] =
    tools && tools.length > 0 ? tools : undefined

  for (let round = 0; round <= INLINE_TOOL_CONFIG.MAX_TOOL_ROUNDS; round++) {
    if (ctx.signal?.aborted) {
      throw new WritingError({ code: 'user_aborted', stage: 'compose', sessionId: '' })
    }

    // 流式调用: 如果是工具轮后的续写, chunk 追加到同一回调 (对调用方透明)
    const result = await trackedStream(
      round === 0 ? stage : `${stage}.tool_round_${round}`,
      messages,
      callbacks.onChunk,
      ctx.signal,
      undefined,
      effectiveTools,
      callbacks.onReasoningChunk,
    )

    // 没有工具调用 → 写作/回答完成
    if (!result.toolCalls || result.toolCalls.length === 0) {
      return result
    }

    // 有工具调用 → 执行工具, 续写
    callbacks.onToolProgress?.(`第 ${round + 1} 轮: 调用 ${result.toolCalls.length} 个工具`)

    // 追加 assistant 消息 (含 tool_calls)
    messages.push({
      role: 'assistant',
      content: result.content || '',
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    })

    // 执行每个工具
    for (const tc of result.toolCalls) {
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
      } catch { parsedArgs = {} }

      const toolReq: ToolCallRequest = {
        id: tc.id,
        name: tc.function.name,
        arguments: parsedArgs,
      }

      callbacks.onToolProgress?.(`调用 ${toolReq.name}(${JSON.stringify(parsedArgs).slice(0, 80)})`)

      const toolResult = await executeStudyTool(toolReq, { dunId: ctx.dunId, signal: ctx.signal })

      // 回吐工具产出
      if (toolResult.evidenceDelta && toolResult.evidenceDelta.length > 0) {
        callbacks.onEvidenceDelta?.(toolResult.evidenceDelta)
      }
      if (toolResult.memoryDelta && toolResult.memoryDelta.length > 0) {
        callbacks.onMemoryDelta?.(toolResult.memoryDelta)
      }
      if (toolResult.profileSuggestions && toolResult.profileSuggestions.length > 0) {
        callbacks.onProfileSuggestions?.(toolResult.profileSuggestions)
      }

      // 追加 tool 结果消息
      messages.push({
        role: 'tool',
        tool_call_id: toolResult.toolCallId,
        name: toolResult.name,
        content: toolResult.content,
      })
    }

    // 工具轮完成 → 让调用方重置流式状态, 避免工具轮思考文字污染正文
    callbacks.onContentReset?.()
  }

  // 超过最大工具轮次, 做最后一次无工具调用的流式 (让 LLM 收尾)
  callbacks.onContentReset?.()
  callbacks.onToolProgress?.('工具轮次已满, 开始最终输出...')
  return trackedStream(
    `${stage}.final`,
    messages,
    callbacks.onChunk,
    ctx.signal,
    undefined,
    undefined, // 不传 tools, 强制 LLM 直接输出
    callbacks.onReasoningChunk,
  )
}

export interface ToolLoopContext {
  dunId?: string | null
  signal?: AbortSignal
  /** 工具执行进度回调 (给前端 thinking 气泡用) */
  onToolProgress?: (msg: string) => void
  /** 新增证据合并回调 (每次工具产出后立即合并到 session.evidencePool) */
  onEvidenceDelta?: (items: EvidenceItem[]) => void
  /** 新增记忆合并回调 */
  onMemoryDelta?: (items: MemorySnippet[]) => void
  /**
   * 风格档案"待确认建议"回调 (Phase 5).
   * LLM 通过 append_to_memory 想写 writerProfile 时不再直接落库,
   * 而是以 ProfileSuggestion 形式回吐 — UI 渲染确认卡片, 用户点接受才入库.
   */
  onProfileSuggestions?: (items: ProfileSuggestion[]) => void
}

/**
 * 在写作前跑一个 Tool Loop, 让 LLM 决定是否需要补充资料
 *
 * 机制: OpenAI Function Calling, 非流式
 * 1. 发送 system + user prompt + tools 到 LLM
 * 2. 如果 LLM 返回 tool_calls, 执行工具并把结果塞回 messages
 * 3. 循环直到 LLM 不再请求工具, 或达到 MAX_ROUNDS
 *
 * 返回: 累积的所有工具调用记录 (用于展示 + 上下文增强)
 */
export async function runToolLoop(
  systemPrompt: string,
  userPrompt: string,
  ctx: ToolLoopContext,
): Promise<{
  toolResults: ToolCallResult[]
  accumulatedEvidence: EvidenceItem[]
  accumulatedMemory: MemorySnippet[]
  accumulatedProfileSuggestions: ProfileSuggestion[]
}> {
  const cfg = getLLMConfig()
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
    console.debug('[toolLoop] LLM config missing, skip tool loop')
    return {
      toolResults: [],
      accumulatedEvidence: [],
      accumulatedMemory: [],
      accumulatedProfileSuggestions: [],
    }
  }

  const messages: SimpleChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  const toolResults: ToolCallResult[] = []
  const accumulatedEvidence: EvidenceItem[] = []
  const accumulatedMemory: MemorySnippet[] = []
  const accumulatedProfileSuggestions: ProfileSuggestion[] = []

  // 使用 local server proxy (和 streamChat 保持一致)
  const localServer = (typeof window !== 'undefined')
    ? (window as unknown as { __DUNCREW_SERVER_URL__?: string }).__DUNCREW_SERVER_URL__ || 'http://localhost:3001'
    : 'http://localhost:3001'
  const proxyUrl = `${localServer}/api/llm/proxy`

  // 清理 baseUrl 结尾
  const cleanBase = cfg.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
  const targetUrl = cleanBase.endsWith('/v1')
    ? `${cleanBase}/chat/completions`
    : `${cleanBase}/v1/chat/completions`

  for (let round = 0; round < TOOL_LOOP_CONFIG.MAX_ROUNDS; round++) {
    if (ctx.signal?.aborted) break

    ctx.onToolProgress?.(`第 ${round + 1} 轮: 思考是否需要工具...`)

    const requestBody = {
      model: cfg.model,
      messages,
      tools: STUDY_ROOM_TOOLS,
      tool_choice: 'auto' as const,
      temperature: TOOL_LOOP_CONFIG.TEMPERATURE,
      stream: false,
    }

    let data: {
      choices?: Array<{
        message?: {
          role: string
          content: string | null
          /** 部分模型 (DeepSeek-R1 / Qwen-Thinking 等) 会把思维链放在独立字段 */
          reasoning_content?: string | null
          tool_calls?: Array<{
            id: string
            function: { name: string; arguments: string }
          }>
        }
        finish_reason?: string
      }>
    }

    try {
      const res = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          headers: { Authorization: `Bearer ${cfg.apiKey}` },
          apiKey: cfg.apiKey,
          body: requestBody,
          stream: false,
        }),
        signal: ctx.signal,
      })
      if (!res.ok) {
        console.warn(`[toolLoop] proxy returned ${res.status}, abort tool loop`)
        break
      }
      data = await res.json()
    } catch (err) {
      if ((err as Error).name === 'AbortError') break
      console.warn('[toolLoop] request failed, skip tool loop:', err)
      break
    }

    const choice = data.choices?.[0]
    const assistantMsg = choice?.message
    if (!assistantMsg) break

    const toolCalls = assistantMsg.tool_calls || []

    // 把模型的"真实思考内容"上报给 UI (覆盖掉"第 N 轮: 思考是否需要工具..."占位文案).
    // 两类来源:
    //   1. reasoning_content — DeepSeek-R1 / Qwen-Thinking 等把思维链放在独立字段
    //   2. content — 普通模型的自然语言思考 (通常在有 tool_calls 时是思考, 没 tool_calls 时是最终答复)
    const reasoningText = (assistantMsg.reasoning_content || '').trim()
    const contentText = (assistantMsg.content || '').trim()
    const thoughtText = reasoningText || contentText

    if (thoughtText) {
      // 控制长度, 避免一次性把几千字塞进气泡
      const preview = thoughtText.length > 400
        ? `${thoughtText.slice(0, 400)}…`
        : thoughtText
      ctx.onToolProgress?.(`第 ${round + 1} 轮思考:\n${preview}`)
    }

    // 记录 assistant 消息 (即使没工具调用也要, 便于下一轮接续)
    messages.push({
      role: 'assistant',
      content: assistantMsg.content || '',
      tool_calls: toolCalls.length > 0
        ? toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }))
        : undefined,
    })

    if (toolCalls.length === 0) {
      // LLM 不再请求工具, 退出. 若前面已经上报过思考内容, 这里只补一句结论标签即可.
      ctx.onToolProgress?.(
        thoughtText ? '思考完成, 无需调工具, 直接开始写作' : '无需工具, 直接开始写作',
      )
      break
    }

    // 执行所有工具调用
    for (const tc of toolCalls) {
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
      } catch {
        parsedArgs = {}
      }

      const toolReq: ToolCallRequest = {
        id: tc.id,
        name: tc.function.name,
        arguments: parsedArgs,
      }

      ctx.onToolProgress?.(`调用工具 ${toolReq.name}(${JSON.stringify(parsedArgs).slice(0, 80)})`)

      const result = await executeStudyTool(toolReq, { dunId: ctx.dunId, signal: ctx.signal })
      toolResults.push(result)

      // 合并工具产出到 session
      if (result.evidenceDelta && result.evidenceDelta.length > 0) {
        accumulatedEvidence.push(...result.evidenceDelta)
        ctx.onEvidenceDelta?.(result.evidenceDelta)
      }
      if (result.memoryDelta && result.memoryDelta.length > 0) {
        accumulatedMemory.push(...result.memoryDelta)
        ctx.onMemoryDelta?.(result.memoryDelta)
      }
      // 风格档案待确认建议 (Phase 5): 不落库, 仅累计并立即回吐给 UI
      if (result.profileSuggestions && result.profileSuggestions.length > 0) {
        accumulatedProfileSuggestions.push(...result.profileSuggestions)
        ctx.onProfileSuggestions?.(result.profileSuggestions)
      }

      // 把工具结果塞回 messages, 供下一轮 LLM 参考
      messages.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        name: result.name,
        content: result.content,
      })
    }
  }

  return { toolResults, accumulatedEvidence, accumulatedMemory, accumulatedProfileSuggestions }
}

// ============================================
// Length Review 辅助 (模块私有)
// ============================================

/** Length review 的 LLM 决策输出 */
interface LengthReviewDecision {
  overallAssessment?: string
  action: 'accept' | 'rewrite_section' | 'update_agenda'
  sectionId?: string
  reason?: string
  rewriteHint?: string
  newTargetLength?: number
}

/**
 * 按 agenda.sections 顺序和 heading 文本, 启发式地把成稿全文切分到各节,
 * 统计每节实际字数 (中文按字符计, 去空白).
 *
 * 策略:
 *   1. 先按 markdown 标题行 (^#{1,6}\s+) 把全文切成 "标题块"
 *   2. 按 heading 文本模糊匹配 (去空白后 startsWith / includes) 把标题块分配给对应的 section
 *   3. 未匹配到标题的正文归入"上一节"; 始终没匹配到任何 heading 时, 按 section 数量均分全文字数
 */
export function measureSectionLengths(document: string, agenda: AgendaDoc): SectionLengthMeasure[] {
  const sections = agenda.sections
  if (sections.length === 0) return []

  const countChars = (s: string) => s.replace(/\s/g, '').length
  const normalizeHeading = (s: string) => s.replace(/\s+/g, '').toLowerCase()

  // 按标题行切块; 保留每块的标题文本和正文文本
  interface HeadingBlock {
    heading: string  // 标题文本 (不含 # 前缀)
    body: string     // 该标题下的正文 (不含标题行本身)
  }

  const lines = document.split('\n')
  const blocks: HeadingBlock[] = []
  let preface = ''  // 首个标题前的文本 (通常是文档主标题前的引言或主标题本身被跳过的场景)
  let currentBlock: HeadingBlock | null = null

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (headingMatch) {
      if (currentBlock) blocks.push(currentBlock)
      currentBlock = { heading: headingMatch[1].trim(), body: '' }
    } else if (currentBlock) {
      currentBlock.body += line + '\n'
    } else {
      preface += line + '\n'
    }
  }
  if (currentBlock) blocks.push(currentBlock)

  // 启发式匹配: 每个 section 取 agenda 顺序第一个"尚未被占用"且 heading 相似的块
  const usedBlockIdx = new Set<number>()
  const sectionToBlocks = new Map<string, number[]>()

  for (const sec of sections) {
    const target = normalizeHeading(sec.heading)
    if (!target) continue
    for (let i = 0; i < blocks.length; i++) {
      if (usedBlockIdx.has(i)) continue
      const blockH = normalizeHeading(blocks[i].heading)
      if (blockH.includes(target) || target.includes(blockH)) {
        sectionToBlocks.set(sec.id, [i])
        usedBlockIdx.add(i)
        break
      }
    }
  }

  // 未被任何 section 匹配的标题块, 按顺序就近合并到"上一个已匹配的 section"
  const matchedCount = sectionToBlocks.size
  if (matchedCount === 0) {
    // 完全没匹配到 → 按 targetLength 比例均分总字数
    const totalBodyChars = countChars(document)
    const totalTarget = sections.reduce((s, x) => s + x.targetLength, 0) || 1
    return sections.map((sec) => ({
      sectionId: sec.id,
      heading: sec.heading,
      targetLength: sec.targetLength,
      actualLength: Math.round((sec.targetLength / totalTarget) * totalBodyChars),
      deviation: 0, // 无法判断, 视为不偏
    }))
  }

  // 有部分匹配: 把未匹配的标题块挂到"顺序上前一个已匹配 section"
  let lastMatchedSectionId: string | null = null
  for (let i = 0; i < blocks.length; i++) {
    if (usedBlockIdx.has(i)) {
      // 找到属于它的 section
      for (const [secId, idxs] of sectionToBlocks) {
        if (idxs.includes(i)) {
          lastMatchedSectionId = secId
          break
        }
      }
    } else if (lastMatchedSectionId) {
      const arr = sectionToBlocks.get(lastMatchedSectionId)
      if (arr) arr.push(i)
    }
  }

  return sections.map((sec) => {
    const blockIdxs = sectionToBlocks.get(sec.id) || []
    const actualLength = blockIdxs.reduce(
      (sum, idx) => sum + countChars(blocks[idx].heading) + countChars(blocks[idx].body),
      0,
    )
    const deviation = sec.targetLength > 0
      ? (actualLength - sec.targetLength) / sec.targetLength
      : 0
    return {
      sectionId: sec.id,
      heading: sec.heading,
      targetLength: sec.targetLength,
      actualLength,
      deviation,
    }
  })
  // preface 在当前策略下被忽略 (通常是文档主标题或前言, 不计入任何 section);
  // 这对篇幅复核足够准确, 无需额外处理.
}

/**
 * 判断是否需要触发一轮 length review.
 * 任一节偏差超 SECTION_DEVIATION, 或全文总偏差超 TOTAL_DEVIATION, 即触发.
 */
export function shouldTriggerLengthReview(measures: SectionLengthMeasure[]): boolean {
  if (measures.length === 0) return false

  const hasBigSectionDev = measures.some(
    (m) => Math.abs(m.deviation) > LENGTH_REVIEW_CONFIG.SECTION_DEVIATION,
  )
  if (hasBigSectionDev) return true

  const totalTarget = measures.reduce((s, m) => s + m.targetLength, 0)
  const totalActual = measures.reduce((s, m) => s + m.actualLength, 0)
  const totalDev = totalTarget > 0 ? (totalActual - totalTarget) / totalTarget : 0
  return Math.abs(totalDev) > LENGTH_REVIEW_CONFIG.TOTAL_DEVIATION
}

/**
 * 调用 LLM 做一次 length review 决策.
 * 失败 / 解析失败 / 被中断 时返回 null, 上层应视为 accept.
 */
export async function decideLengthReview(
  brief: WritingBrief,
  agenda: AgendaDoc,
  measures: SectionLengthMeasure[],
  roundIndex: number,
  fullText: string,
  signal?: AbortSignal,
): Promise<LengthReviewDecision | null> {
  const userPrompt = buildLengthReviewPrompt(
    brief,
    agenda,
    measures,
    roundIndex,
    LENGTH_REVIEW_CONFIG.MAX_ROUNDS,
    fullText,
  )
  const messages: SimpleChatMessage[] = [
    { role: 'system', content: WRITING_CONDUCTOR_PROMPT },
    { role: 'user', content: userPrompt },
  ]

  let responseText = ''
  try {
    await trackedStream(
      'finalReview',
      messages,
      (chunk) => { responseText += chunk },
      signal,
    )
  } catch (err) {
    if (signal?.aborted) throw err
    console.warn('[StudyRoom] Length review LLM call failed:', err)
    return null
  }

  let cleaned = responseText.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  }

  try {
    const raw = JSON.parse(cleaned) as Record<string, unknown>
    const action = raw.action as LengthReviewDecision['action']
    if (action !== 'accept' && action !== 'rewrite_section' && action !== 'update_agenda') {
      return null
    }
    return {
      overallAssessment: typeof raw.overallAssessment === 'string' ? raw.overallAssessment : undefined,
      action,
      sectionId: typeof raw.sectionId === 'string' ? raw.sectionId : undefined,
      reason: typeof raw.reason === 'string' ? raw.reason : undefined,
      rewriteHint: typeof raw.rewriteHint === 'string' ? raw.rewriteHint : undefined,
      newTargetLength: typeof raw.newTargetLength === 'number' ? raw.newTargetLength : undefined,
    }
  } catch (err) {
    console.warn('[StudyRoom] Length review JSON parse failed:', err, 'raw:', cleaned.slice(0, 200))
    return null
  }
}

// ============================================
// v3: Outline Parsing Helpers
// ============================================

/**
 * 从 <outline> 块文本解析轻量 AgendaDoc.
 *
 * 期望 LLM 输出格式:
 *   ## 标题 — 一句话意图
 *   ## 标题 — 一句话意图
 *
 * 也兼容: "1. 标题 — 意图" / "- 标题: 意图" 等变体.
 */
function parseOutlineToAgenda(outlineText: string, briefId: string): AgendaDoc {
  const lines = outlineText.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const sections: AgendaSection[] = []

  for (const line of lines) {
    // 匹配: "## 标题 — 意图" / "## 标题 - 意图" / "1. 标题 — 意图" / "- 标题: 意图"
    const cleaned = line
      .replace(/^#+\s*/, '')           // 去掉 ## 前缀
      .replace(/^\d+\.\s*/, '')        // 去掉 "1. " 前缀
      .replace(/^[-*]\s*/, '')         // 去掉 "- " 前缀
      .trim()

    if (!cleaned) continue

    // 尝试用 " — " / " - " / ": " 分割标题和意图
    let heading = cleaned
    let intent = ''
    const separators = [' — ', ' — ', ' - ', ': ', '：']
    for (const sep of separators) {
      const idx = cleaned.indexOf(sep)
      if (idx > 0) {
        heading = cleaned.slice(0, idx).trim()
        intent = cleaned.slice(idx + sep.length).trim()
        break
      }
    }

    sections.push({
      id: `sec-${Date.now().toString(36)}-${sections.length}`,
      order: sections.length + 1,
      heading,
      intent,
      targetLength: 0,  // v3: 不预设字数, 由内容决定
      evidencePocket: [],
      skillHints: [],
      status: 'planned',
      revision: 1,
    })
  }

  // 兜底: 如果解析不出任何 section, 放一个占位
  if (sections.length === 0) {
    sections.push({
      id: `sec-${Date.now().toString(36)}-0`,
      order: 1,
      heading: '(全文)',
      intent: '一次性写作, 无结构分段',
      targetLength: 0,
      evidencePocket: [],
      skillHints: [],
      status: 'planned',
      revision: 1,
    })
  }

  return {
    briefId,
    title: '',
    sections,
    lengthRationale: '(v3 一次性写作模式, 结构由模型自行规划)',
    revision: 1,
  }
}

/**
 * Fallback: 从已生成的 Markdown 正文推断轻量 agenda.
 * 当 LLM 没有输出 <outline> 标签时使用.
 * 简单匹配 ## 标题行.
 */
function inferAgendaFromMarkdown(markdown: string, briefId: string): AgendaDoc {
  const lines = markdown.split('\n')
  const sections: AgendaSection[] = []

  for (const line of lines) {
    // 匹配 ## 标题 (不匹配 # 一级标题, 那是文章总标题)
    const m = line.match(/^##\s+(.+)/)
    if (m) {
      sections.push({
        id: `sec-${Date.now().toString(36)}-${sections.length}`,
        order: sections.length + 1,
        heading: m[1].trim(),
        intent: '',
        targetLength: 0,
        evidencePocket: [],
        skillHints: [],
        status: 'planned',
        revision: 1,
      })
    }
  }

  if (sections.length === 0) {
    sections.push({
      id: `sec-${Date.now().toString(36)}-0`,
      order: 1,
      heading: '(全文)',
      intent: '',
      targetLength: 0,
      evidencePocket: [],
      skillHints: [],
      status: 'planned',
      revision: 1,
    })
  }

  return {
    briefId,
    title: '',
    sections,
    lengthRationale: '(从正文标题推断)',
    revision: 1,
  }
}

/**
 * runFullWriting — 对话驱动的一气呵成写作 (v3: 支持 memory + 可选 tool loop)
 *
 * 流程: Memory 召回 → P2 Telescope → (可选) Tool Loop → P3 Agenda → 全文流式输出 → Length Review 循环
 */
export async function runFullWriting(
  brief: WritingBrief,
  storeSkills: Array<{ name: string; description?: string; keywords?: string[]; whenToUse?: string; tags?: string[]; enabled?: boolean; toolType?: string; category?: string; instructions?: string }>,
  sessionId: string,
  callbacks: {
    onProgress: (progress: WritingProgress) => void
    onDocumentDelta: (fullText: string) => void
    onEvidencePool: (pool: EvidenceItem[]) => void
    onAgenda: (agenda: AgendaDoc) => void
    /** 推理过程流式输出 (reasoning_content, 如 DeepSeek-Reasoner) */
    onReasoningDelta?: (fullReasoning: string) => void
    /** 工具调用进度 */
    onToolProgress?: (msg: string) => void
    /** 工具产出的新增证据 (已合并到 session) */
    onEvidenceDelta?: (items: EvidenceItem[]) => void
    /** 工具产出的新增记忆 */
    onMemoryDelta?: (items: MemorySnippet[]) => void
    /** 长期记忆召回完成 */
    onMemoryRecalled?: (snippets: MemorySnippet[]) => void
    /** 风格档案"待确认建议"回调 (Phase 5: 不直接落库, 由 UI 渲染确认卡片) */
    onProfileSuggestions?: (items: ProfileSuggestion[]) => void
  },
  options?: {
    /** 是否启用 Tool Loop (默认 true, 但仅在 LLM 配好 function calling 时生效) */
    enableToolLoop?: boolean
  },
  signal?: AbortSignal,
): Promise<{ document: string; wordCount: number }> {
  const abortKey = `${sessionId}:fullWriting`
  const ctrl = studyAbortManager.acquire(abortKey)
  const effectiveSignal = signal || ctrl.signal
  const enableToolLoop = options?.enableToolLoop !== false

  tokenTracker.start(sessionId, 'runFullWriting')
  pipelineTracer.start(sessionId, 'runFullWriting')

  try {
    // --- Stage 0 + 1: 长期记忆召回 与 Telescope 证据采集 并行 ---
    // 两者输入都只是 brief.intent, 无依赖, 可完全并行. recallMemory 失败不影响 telescope.
    callbacks.onProgress({
      stage: 'memory',
      label: '正在并行检索长期记忆与证据...',
      detail: '记忆召回与知识库/技能库搜索同时进行',
    })

    const [memoryResult, telescopeResult] = await pipelineTracer.span(
      'memory+telescope.parallel',
      () => Promise.all([
        recallMemory(brief.intent, 8, effectiveSignal).catch((err) => {
          console.warn('[StudyRoom] recallMemory failed, degrade to empty:', err)
          return [] as MemorySnippet[]
        }),
        runTelescope(brief, storeSkills, effectiveSignal),
      ]),
    )

    const memorySnippets = memoryResult
    let pool = telescopeResult
    pipelineTracer.annotate('memory+telescope.parallel', {
      memoryCount: memorySnippets.length,
      evidenceCount: pool.length,
    })

    callbacks.onMemoryRecalled?.(memorySnippets)
    if (memorySnippets.length > 0) {
      callbacks.onProgress({
        stage: 'memory',
        label: `找到 ${memorySnippets.length} 条相关记忆`,
        detail: memorySnippets.slice(0, 2).map((s) => s.content.slice(0, 40)).join(' / '),
      })
    }

    callbacks.onEvidencePool(pool)
    callbacks.onProgress({
      stage: 'telescope',
      label: `已采集 ${pool.length} 条证据`,
      detail: pool.slice(0, 3).map((e) => e.title).join(', '),
    })

    if (effectiveSignal?.aborted) {
      throw new WritingError({ code: 'user_aborted', stage: 'telescope', sessionId })
    }

    // --- Stage 2: One-Pass Writing (v3: 单次全文流式写作, 方案一: 工具内联) ---
    //
    // v3 核心变更: 砍掉 Agenda Draft / Self-Critique / 奇偶波次 / Length Review 四大环节,
    // 合并为单次 LLM 调用. LLM 在流开头输出 <outline> 块 (前端拆出来喂给侧栏),
    // 然后直接写全文. 注意力预算从"遵循规则"反转为"消化素材+吸收风格".
    //
    // 方案一优化: Tool Loop 不再独立调用, 工具定义直接传入 streamChat.
    // LLM 如果需要补采资料会在流中返回 tool_calls, 执行后续写;
    // 不需要工具时零额外延迟.

    callbacks.onProgress({
      stage: 'writing',
      label: '正在撰写全文...',
      detail: enableToolLoop ? '单次全文流式写作 (工具内联)' : '单次全文流式写作',
    })

    // 构建指纹注入块 (v3: 使用 formatFingerprintV2, 行为规则+范文 few-shot, 三级降级)
    const appliedFingerprint = resolveFingerprintForBrief(brief)
    const fingerprintBlock = formatFingerprintV2(appliedFingerprint)

    const userPrompt = buildOnePassWritingPrompt(
      brief, pool, memorySnippets, fingerprintBlock,
    )

    // 系统提示: 启用工具时追加工具使用指南
    const writeSystemPrompt = enableToolLoop
      ? `${ONE_PASS_WRITING_SYSTEM_PROMPT}\n\n${buildToolGuidelines()}`
      : ONE_PASS_WRITING_SYSTEM_PROMPT

    const writeMessages: SimpleChatMessage[] = [
      { role: 'system', content: writeSystemPrompt },
      { role: 'user', content: userPrompt },
    ]

    // --- 流式状态机: 拆分 <outline> 块和正文 ---
    let rawStream = ''         // LLM 完整输出 (含 outline 标签)
    let outlineText = ''       // <outline> 内容
    let bodyText = ''          // 正文 (去掉 outline 后)
    let outlineParsed = false  // outline 是否已完整提取
    let inOutline = false      // 当前是否在 outline 标签内
    let outlineEmitted = false // 是否已向侧栏推送过 agenda

    const parseStreamChunk = () => {
      // 检测 <outline> 开始
      if (!inOutline && !outlineParsed) {
        const openIdx = rawStream.indexOf(OUTLINE_TAG_OPEN)
        if (openIdx !== -1) {
          inOutline = true
          // openIdx 之前的内容直接进正文 (LLM 可能在 outline 前输出空行)
          const before = rawStream.slice(0, openIdx).trim()
          if (before) bodyText = before
        }
      }

      // 检测 </outline> 结束
      if (inOutline && !outlineParsed) {
        const closeIdx = rawStream.indexOf(OUTLINE_TAG_CLOSE)
        if (closeIdx !== -1) {
          const openIdx = rawStream.indexOf(OUTLINE_TAG_OPEN)
          outlineText = rawStream.slice(
            openIdx + OUTLINE_TAG_OPEN.length,
            closeIdx,
          ).trim()
          inOutline = false
          outlineParsed = true

          // outline 之后的内容是正文
          const afterOutline = rawStream.slice(closeIdx + OUTLINE_TAG_CLOSE.length)
          bodyText = afterOutline.trimStart()

          // 解析 outline → 轻量 AgendaDoc 并推送给侧栏
          if (!outlineEmitted) {
            const lightAgenda = parseOutlineToAgenda(outlineText, brief.id)
            callbacks.onAgenda(lightAgenda)
            outlineEmitted = true

            const sectionSummary = lightAgenda.sections
              .map((s, i) => `${i + 1}. ${s.heading}`)
              .join(' → ')
            callbacks.onProgress({
              stage: 'writing',
              label: `结构规划完成 (${lightAgenda.sections.length} 节)`,
              detail: sectionSummary,
            })
          }
        }
      }

      // outline 已解析完毕 — 后续所有输出都是正文
      if (outlineParsed) {
        const openIdx = rawStream.indexOf(OUTLINE_TAG_OPEN)
        const closeIdx = rawStream.indexOf(OUTLINE_TAG_CLOSE)
        if (openIdx !== -1 && closeIdx !== -1) {
          // 完整重算正文: 去掉整个 outline 块
          const beforeOutline = rawStream.slice(0, openIdx).trim()
          const afterOutline = rawStream.slice(closeIdx + OUTLINE_TAG_CLOSE.length)
          bodyText = (beforeOutline ? beforeOutline + '\n\n' : '') + afterOutline.trimStart()
        }
      }

      // 尚未发现 outline 标签 — 所有内容暂时都算正文
      if (!inOutline && !outlineParsed) {
        bodyText = rawStream
      }
    }

    // 内联工具产出追踪 (写完后合并到 pool)
    const inlineToolEvidence: EvidenceItem[] = []

    await pipelineTracer.span(
      'onepass.write',
      async () => {
        await runStreamWithTools(
          'onepass.write',
          writeMessages,
          enableToolLoop ? STUDY_ROOM_TOOLS : null,
          {
            onChunk: (chunk) => {
              rawStream += chunk
              parseStreamChunk()
              // 只向 UI 推送正文部分
              if (!inOutline) {
                callbacks.onDocumentDelta(bodyText)
              }
            },
            onReasoningChunk: (reasoningChunk) => {
              callbacks.onReasoningDelta?.(reasoningChunk)
            },
            onToolProgress: (msg) => {
              callbacks.onProgress({ stage: 'tool', label: msg })
              callbacks.onToolProgress?.(msg)
            },
            onEvidenceDelta: (items) => {
              inlineToolEvidence.push(...items)
              callbacks.onEvidenceDelta?.(items)
            },
            onMemoryDelta: (items) => callbacks.onMemoryDelta?.(items),
            onProfileSuggestions: (items) => callbacks.onProfileSuggestions?.(items),
            onContentReset: () => {
              // 工具轮的"思考文字"不应混入正文 — 重置流式状态机
              rawStream = ''
              outlineText = ''
              bodyText = ''
              outlineParsed = false
              inOutline = false
              // outlineEmitted 不重置: 若工具轮中偶然解析出 outline 则保留
            },
          },
          { dunId: brief.dunId, signal: effectiveSignal },
        )
      },
    )

    // 合并内联工具产出的新证据到 pool
    if (inlineToolEvidence.length > 0) {
      const existingIds = new Set(pool.map((e) => e.id))
      const fresh = inlineToolEvidence.filter((e) => !existingIds.has(e.id))
      if (fresh.length > 0) {
        pool = [...pool, ...fresh]
        callbacks.onEvidencePool(pool)
      }
    }

    // --- 最终处理 ---
    // 确保 outline 已提取 (即使 LLM 没输出 outline 标签, 也要有 fallback)
    if (!outlineEmitted) {
      // LLM 没输出 outline — 从正文 Markdown 标题推断轻量 agenda
      const fallbackAgenda = inferAgendaFromMarkdown(bodyText, brief.id)
      callbacks.onAgenda(fallbackAgenda)
    }

    const fullText = bodyText.trim()
    callbacks.onDocumentDelta(fullText)

    const wordCount = fullText.replace(/\s/g, '').length
    callbacks.onProgress({
      stage: 'done',
      label: `初稿完成 (约 ${wordCount} 字)`,
      detail: '你可以在左栏编辑文章, 或在对话中说"第二段太短了"来修改',
    })

    // 记录本次完成的体裁, 用于写作档案的 genreHistogram (不阻塞主流程)
    try {
      recordArticleCompletion(brief.genre)
    } catch (e) {
      console.warn('[writingService] recordArticleCompletion failed:', e)
    }

    return { document: fullText, wordCount }
  } catch (err) {
    if (effectiveSignal?.aborted || (err instanceof WritingError && err.code === 'user_aborted')) {
      throw err
    }
    callbacks.onProgress({
      stage: 'error',
      label: '写作过程出错',
      detail: err instanceof Error ? err.message : String(err),
    })
    throw new WritingError({
      code: 'llm_unavailable',
      stage: 'compose',
      sessionId,
      details: err,
    })
  } finally {
    tokenTracker.finishAndPrint()
    studyAbortManager.release(abortKey)
  }
}

// ============================================
// v2: 对话式修改 (带当前全文上下文)
// ============================================

export interface ConversationalEditContext {
  /** 当前文章全文 */
  currentDocument: string
  /** 用户本轮指令 */
  userInstruction: string
  /** 当前 brief (可能已被动态 @ 的 skill 合并过) */
  brief: WritingBrief
  /** 现有证据池 (首次写作积累的) */
  existingPool: EvidenceItem[]
  /** 原始议程 (首次写作的结构规划) */
  agenda?: AgendaDoc | null
  /** 对话历史 (给 LLM 看连续上下文) */
  chatHistory?: WriterChatMessage[]
  /** 已有的长期记忆快照 */
  existingMemory?: MemorySnippet[]
  /** 本次用户新 @ 的 skills (已合并到 brief 的情况可不传) */
  newSkills?: SkillRef[]
  /** 本地 storeSkills, 用于重新匹配 lensSkills */
  storeSkills?: Array<{ name: string; description?: string; keywords?: string[]; whenToUse?: string; tags?: string[]; enabled?: boolean; toolType?: string; category?: string; instructions?: string }>
}

export interface ConversationalEditCallbacks {
  onDocumentDelta: (fullText: string) => void
  onReasoningDelta?: (fullReasoning: string) => void
  /** 轻量进度 (补采/工具/修改中) */
  onProgress?: (msg: string) => void
  /** 本轮新召回的证据, 前端应合并到 session */
  onEvidenceDelta?: (items: EvidenceItem[]) => void
  /** 本轮工具产出的记忆 */
  onMemoryDelta?: (items: MemorySnippet[]) => void
  /** 风格档案"待确认建议"回调 (Phase 5: 不直接落库, 由 UI 渲染确认卡片) */
  onProfileSuggestions?: (items: ProfileSuggestion[]) => void
}

/**
 * runConversationalEdit — 用户通过对话修改文章 (v3)
 *
 * 新流程 (解决"一份素材用到死"的问题):
 *   1. 基于新指令重新召回 lensLibrary + lensSkills, 与旧 pool 合并去重
 *   2. 重新召回 memory (按新指令的语境)
 *   3. (可选) Tool Loop: 让 LLM 决定是否需要调工具补资料
 *   4. 构造带 chat 历史 + agenda + 新增证据 diff 的 prompt
 *   5. 流式输出修改后全文 + 变更摘要 JSON
 */
export async function runConversationalEdit(
  ctx: ConversationalEditContext,
  sessionId: string,
  callbacks: ConversationalEditCallbacks,
  options?: {
    enableToolLoop?: boolean
    /** 是否每轮重新召回 (默认 true) */
    refreshRecall?: boolean
  },
  signal?: AbortSignal,
): Promise<{
  document: string
  wordCount: number
  editSummary: EditSummary | null
  freshEvidence: EvidenceItem[]
  freshMemory: MemorySnippet[]
}> {
  const abortKey = `${sessionId}:conversationalEdit`
  const ctrl = studyAbortManager.acquire(abortKey)
  const effectiveSignal = signal || ctrl.signal
  const enableToolLoop = options?.enableToolLoop !== false
  const refreshRecall = options?.refreshRecall !== false

  const originalWordCount = ctx.currentDocument.replace(/\s/g, '').length

  // 本轮新增的证据和记忆
  const freshEvidence: EvidenceItem[] = []
  const freshMemory: MemorySnippet[] = []

  tokenTracker.start(sessionId, 'runConversationalEdit')
  pipelineTracer.start(sessionId, 'runConversationalEdit')

  try {
    // --- Stage 1: 增量召回 (按新指令重新搜 wiki + skills + memory) ---
    if (refreshRecall) {
      callbacks.onProgress?.('按新指令重新检索资料...')
      const existingIds = new Set(ctx.existingPool.map((e) => e.id))

      // 并行: wiki + skills + memory
      const [wikiFresh, skillsFresh, memFresh] = await pipelineTracer.span(
        'edit.refreshRecall',
        () => Promise.all([
          lensLibrary(ctx.userInstruction, 12, ctx.brief.dunId).catch(() => []),
          Promise.resolve(
            ctx.storeSkills
              ? lensSkills(
                ctx.userInstruction,
                ctx.storeSkills,
                ctx.brief.skills.map((s) => s.name),
              )
              : [],
          ),
          recallMemory(ctx.userInstruction, 6, effectiveSignal).catch(() => []),
        ]),
      )

      // 过滤掉已有的 evidence
      for (const e of [...wikiFresh, ...skillsFresh]) {
        if (!existingIds.has(e.id)) {
          freshEvidence.push(e)
          existingIds.add(e.id)
        }
      }

      // memory 去重 (按 id)
      const existingMemIds = new Set((ctx.existingMemory || []).map((m) => m.id))
      for (const m of memFresh) {
        if (!existingMemIds.has(m.id)) {
          freshMemory.push(m)
          existingMemIds.add(m.id)
        }
      }

      if (freshEvidence.length > 0) {
        callbacks.onEvidenceDelta?.(freshEvidence)
        callbacks.onProgress?.(`新召回 ${freshEvidence.length} 条证据`)
      }
      if (freshMemory.length > 0) {
        callbacks.onMemoryDelta?.(freshMemory)
      }
    }

    if (effectiveSignal?.aborted) {
      throw new WritingError({ code: 'user_aborted', stage: 'compose', sessionId })
    }

    // --- Stage 2: 构造 prompt + 流式修改 (方案一: 工具内联) ---
    callbacks.onProgress?.('开始修改文章...')
    const combinedPool = [...ctx.existingPool, ...freshEvidence]
    const combinedMemory = [...(ctx.existingMemory || []), ...freshMemory]

    const userPrompt = buildConversationalEditPrompt(
      ctx.currentDocument,
      ctx.userInstruction,
      ctx.brief,
      combinedPool,
      {
        chatHistory: ctx.chatHistory,
        agenda: ctx.agenda,
        memorySnippets: combinedMemory,
        freshEvidence,
      },
    )

    // 系统提示: 启用工具时追加工具使用指南
    const editSystemPrompt = enableToolLoop
      ? `${WRITING_CHAT_SYSTEM_PROMPT}\n\n${buildToolGuidelines()}`
      : WRITING_CHAT_SYSTEM_PROMPT

    const messages: SimpleChatMessage[] = [
      { role: 'system', content: editSystemPrompt },
      { role: 'user', content: userPrompt },
    ]

    let rawBuffer = '' // 完整原始流 (文章 + 分隔符 + JSON)
    let articleText = '' // 已确认属于文章的部分
    let delimiterSeen = false
    let fullReasoning = ''

    await pipelineTracer.span(
      'stream.main',
      async () => {
        await runStreamWithTools(
          'conversationalEdit',
          messages,
          enableToolLoop ? STUDY_ROOM_TOOLS : null,
          {
            onChunk: (chunk) => {
              rawBuffer += chunk

              if (!delimiterSeen) {
                const idx = rawBuffer.indexOf(EDIT_SUMMARY_DELIMITER)
                if (idx >= 0) {
                  delimiterSeen = true
                  articleText = rawBuffer.slice(0, idx).replace(/\s+$/, '')
                  callbacks.onDocumentDelta(articleText)
                } else {
                  const safeLen = Math.max(0, rawBuffer.length - EDIT_SUMMARY_DELIMITER.length)
                  if (safeLen > articleText.length) {
                    articleText = rawBuffer.slice(0, safeLen)
                    callbacks.onDocumentDelta(articleText)
                  }
                }
              }
            },
            onReasoningChunk: (reasoningChunk) => {
              fullReasoning += reasoningChunk
              callbacks.onReasoningDelta?.(fullReasoning)
            },
            onToolProgress: (msg) => callbacks.onProgress?.(msg),
            onEvidenceDelta: (items) => {
              for (const e of items) {
                if (!freshEvidence.some((x) => x.id === e.id)) freshEvidence.push(e)
              }
              callbacks.onEvidenceDelta?.(items)
            },
            onMemoryDelta: (items) => {
              for (const m of items) {
                if (!freshMemory.some((x) => x.id === m.id)) freshMemory.push(m)
              }
              callbacks.onMemoryDelta?.(items)
            },
            onProfileSuggestions: (items) => callbacks.onProfileSuggestions?.(items),
            onContentReset: () => {
              rawBuffer = ''
              articleText = ''
              delimiterSeen = false
              fullReasoning = ''
            },
          },
          { dunId: ctx.brief.dunId, signal: effectiveSignal },
        )
      },
    )

    // 流式结束后, 做最终切分 (兜底: 分隔符可能是最后才完整出现的)
    let editSummary: EditSummary | null = null
    const finalDelimiterIdx = rawBuffer.indexOf(EDIT_SUMMARY_DELIMITER)

    if (finalDelimiterIdx >= 0) {
      articleText = rawBuffer.slice(0, finalDelimiterIdx).replace(/\s+$/, '')
      callbacks.onDocumentDelta(articleText)

      const jsonPart = rawBuffer.slice(finalDelimiterIdx + EDIT_SUMMARY_DELIMITER.length).trim()
      editSummary = parseEditSummaryJson(jsonPart)

      if (editSummary && !editSummary.wordCountDelta) {
        const newWordCount = articleText.replace(/\s/g, '').length
        editSummary.wordCountDelta = [originalWordCount, newWordCount]
      }
    } else {
      articleText = rawBuffer
      callbacks.onDocumentDelta(articleText)
      console.warn('[StudyRoom] LLM did not output EDIT_SUMMARY delimiter, skipping summary')
    }

    const wordCount = articleText.replace(/\s/g, '').length
    return { document: articleText, wordCount, editSummary, freshEvidence, freshMemory }
  } catch (err) {
    if (effectiveSignal?.aborted) {
      throw new WritingError({ code: 'user_aborted', stage: 'compose', sessionId })
    }
    throw new WritingError({
      code: 'llm_unavailable',
      stage: 'compose',
      sessionId,
      details: err,
    })
  } finally {
    tokenTracker.finishAndPrint()
    studyAbortManager.release(abortKey)
  }
}

/**
 * 健壮地解析 LLM 输出的变更摘要 JSON
 * LLM 经常带 markdown 代码围栏或多余的解释文字, 尽量提取第一个合法 JSON 对象
 */
function parseEditSummaryJson(raw: string): EditSummary | null {
  if (!raw) return null

  // 去掉可能的 ```json ... ``` 围栏
  let cleaned = raw.trim()
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/)
  if (fenceMatch) cleaned = fenceMatch[1].trim()

  // 抓取第一个 { 到最后一个 } 之间的内容
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace <= firstBrace) return null

  const jsonStr = cleaned.slice(firstBrace, lastBrace + 1)

  try {
    const parsed = JSON.parse(jsonStr) as Partial<EditSummary>
    if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.changes)) return null

    return {
      summary: parsed.summary,
      changes: parsed.changes
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
          where: typeof c.where === 'string' ? c.where : '未知',
          what: typeof c.what === 'string' ? c.what : '',
          why: typeof c.why === 'string' ? c.why : undefined,
        }))
        .filter((c) => c.what.length > 0),
      skipped: Array.isArray(parsed.skipped)
        ? parsed.skipped.filter((s): s is string => typeof s === 'string')
        : undefined,
    }
  } catch (e) {
    console.warn('[StudyRoom] parseEditSummaryJson failed:', e, 'raw:', jsonStr.slice(0, 200))
    return null
  }
}

// ============================================
// 导出归档
// ============================================

export async function exportSession(sessionId: string): Promise<{ success: boolean; archivePath?: string }> {
  try {
    // 127.0.0.1 而非 localhost，避免被系统代理(Clash/V2rayN 等)劫持导致 ERR_EMPTY_RESPONSE
    const res = await fetch(`http://127.0.0.1:3001/api/study/sessions/${sessionId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!res.ok) {
      return { success: false }
    }
    const data = await res.json()
    return { success: true, archivePath: data.archivePath }
  } catch {
    return { success: false }
  }
}

// ============================================
// v3: 意图分类 (discuss / edit / write / unclear)
// ============================================

/** 分类器输出 */
export interface WriterIntentResult {
  intent: WriterMessageIntent
  confidence: number
  reason: string
}

/** 置信度阈值: 低于该值强制返回 'unclear' */
const INTENT_UNCLEAR_THRESHOLD = 0.7

/**
 * 从 LLM 原始输出中抽取第一个合法 JSON 对象.
 * 容忍常见污染: 代码围栏、前后解释文字.
 */
function extractFirstJsonObject(raw: string): string | null {
  if (!raw) return null
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  return text.slice(first, last + 1)
}

/**
 * 把"最近对话"压成一段摘要, 给意图分类器看指代用. 只取最新 4 条 user/assistant.
 */
function digestRecentChat(messages: WriterChatMessage[] | undefined): string {
  if (!messages || messages.length === 0) return ''
  const filtered = messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && !m.streaming && m.content,
  )
  const recent = filtered.slice(-4)
  if (recent.length === 0) return ''
  return recent
    .map((m) => {
      const role = m.role === 'user' ? '用户' : 'AI'
      return `- ${role}: ${m.content.slice(0, 120).replace(/\s+/g, ' ')}`
    })
    .join('\n')
}

/**
 * classifyWriterIntent — 轻量意图分类 (一次短 LLM 调用).
 *
 * 用途: 在用户提交消息后、真正路由到 runFullWriting / runConversationalEdit / runWriterChat 之前,
 * 用一次 ~200 tokens 的 LLM 调用把用户意图分为 discuss / edit / write / unclear.
 *
 * 失败策略:
 *   - LLM 未配置 / 网络错误 / JSON 解析失败 → 不阻断用户, 返回一个"保底意图":
 *     - 文章非空 → 'edit' (保留现有行为)
 *     - 文章为空 → 'write' (保留现有行为)
 *     confidence 标记为 0, reason 标记 fallback 原因. 前端可选择忽略或照走.
 */
export async function classifyWriterIntent(
  userMessage: string,
  options: {
    currentDocument: string
    chatHistory?: WriterChatMessage[]
    signal?: AbortSignal,
  },
): Promise<WriterIntentResult> {
  const docEmpty = !options.currentDocument || options.currentDocument.trim().length === 0
  const fallback: WriterIntentResult = {
    intent: docEmpty ? 'write' : 'edit',
    confidence: 0,
    reason: 'fallback: classifier unavailable',
  }

  const cfg = getLLMConfig()
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
    return fallback
  }

  const userPrompt = buildWriterIntentClassifyPrompt(userMessage, {
    currentDocument: options.currentDocument,
    recentChatDigest: digestRecentChat(options.chatHistory),
  })

  const messages: SimpleChatMessage[] = [
    { role: 'system', content: WRITER_INTENT_CLASSIFY_PROMPT },
    { role: 'user', content: userPrompt },
  ]

  let rawOutput: string
  try {
    const result = await chatBackground(messages, { signal: options.signal })
    if (!result) {
      console.warn('[StudyRoom] classifyWriterIntent returned null, fallback')
      return fallback
    }
    rawOutput = result
  } catch (err) {
    console.warn('[StudyRoom] classifyWriterIntent LLM failed, fallback:', err)
    return fallback
  }

  const jsonStr = extractFirstJsonObject(rawOutput)
  if (!jsonStr) {
    console.warn('[StudyRoom] classifyWriterIntent no JSON found, raw:', rawOutput.slice(0, 200))
    return fallback
  }

  try {
    const parsed = JSON.parse(jsonStr) as Partial<WriterIntentResult>
    const rawIntent = typeof parsed.intent === 'string' ? parsed.intent : ''
    const rawConf = typeof parsed.confidence === 'number' ? parsed.confidence : 0
    const reason = typeof parsed.reason === 'string' ? parsed.reason : ''

    // 合法值收敛
    const validIntents: WriterMessageIntent[] = ['discuss', 'edit', 'write', 'unclear']
    let intent: WriterMessageIntent = validIntents.includes(rawIntent as WriterMessageIntent)
      ? (rawIntent as WriterMessageIntent)
      : 'unclear'
    const confidence = Math.max(0, Math.min(1, rawConf))

    // 硬规则覆盖: 文章为空时禁止 edit (语义上不成立)
    if (docEmpty && intent === 'edit') {
      intent = 'unclear'
    }

    // 置信度兜底
    if (intent !== 'unclear' && confidence < INTENT_UNCLEAR_THRESHOLD) {
      intent = 'unclear'
    }

    return { intent, confidence, reason }
  } catch (err) {
    console.warn('[StudyRoom] classifyWriterIntent parse failed:', err, 'raw:', jsonStr.slice(0, 200))
    return fallback
  }
}

// ============================================
// v3: 讨论模式 (runWriterChat) — 聊文章但不改文章
// ============================================

export interface WriterChatContext {
  /** 当前文章全文 */
  currentDocument: string
  /** 用户本轮消息 */
  userMessage: string
  /** 当前 brief */
  brief: WritingBrief
  /** 现有证据池 (不重新召回, 省钱) */
  existingPool: EvidenceItem[]
  /** 对话历史 */
  chatHistory?: WriterChatMessage[]
  /** 已有的长期记忆快照 */
  existingMemory?: MemorySnippet[]
  /** 本地 storeSkills, 用于 tool loop 重新匹配 lensSkills */
  storeSkills?: Array<{ name: string; description?: string; keywords?: string[]; whenToUse?: string; tags?: string[]; enabled?: boolean; toolType?: string; category?: string; instructions?: string }>
}

export interface WriterChatCallbacks {
  /** 流式回复文本 (分隔符前的部分) */
  onAnswerDelta: (fullAnswer: string) => void
  onReasoningDelta?: (fullReasoning: string) => void
  /** 轻量进度 (工具/召回) */
  onProgress?: (msg: string) => void
  /** 本轮新召回的证据, 前端应合并到 session */
  onEvidenceDelta?: (items: EvidenceItem[]) => void
  /** 本轮工具产出的记忆 */
  onMemoryDelta?: (items: MemorySnippet[]) => void
  /** LLM 在 tool loop 中想写入风格档案时产出的待确认建议 (Phase 5: 不直接落库) */
  onProfileSuggestions?: (items: ProfileSuggestion[]) => void
}

/**
 * runWriterChat — 讨论模式 (v3).
 *
 * 与 runConversationalEdit 的关键区别:
 *   - **不改文章**: 不回写 document, 只产出一条 assistant 消息
 *   - **不重新召回**: 默认复用 existingPool + existingMemory (refreshRecall=false 为默认)
 *   - **可选 tool loop**: 如果用户问的是新事实/数据, 允许调 search_wiki / search_memory 补资料
 *   - **可选 suggestedEdit**: LLM 可在回答末尾附一个"应用此建议"块 (见 SUGGESTED_EDIT_DELIMITER)
 */
export async function runWriterChat(
  ctx: WriterChatContext,
  sessionId: string,
  callbacks: WriterChatCallbacks,
  options?: {
    /** 是否启用 tool loop 允许补采资料 (默认 true — 但只有 LLM 判断"需要"才会真调) */
    enableToolLoop?: boolean
    /** 是否每轮重新召回 wiki+memory (默认 false — 讨论模式默认复用旧资料) */
    refreshRecall?: boolean
  },
  signal?: AbortSignal,
): Promise<{
  answer: string
  suggestedEdit: SuggestedEdit | null
  freshEvidence: EvidenceItem[]
  freshMemory: MemorySnippet[]
}> {
  const abortKey = `${sessionId}:writerChat`
  const ctrl = studyAbortManager.acquire(abortKey)
  const effectiveSignal = signal || ctrl.signal
  const enableToolLoop = options?.enableToolLoop !== false
  const refreshRecall = options?.refreshRecall === true

  const freshEvidence: EvidenceItem[] = []
  const freshMemory: MemorySnippet[] = []

  tokenTracker.start(sessionId, 'runWriterChat')
  pipelineTracer.start(sessionId, 'runWriterChat')

  try {
    // --- Stage 1: 可选的增量召回 (默认关) ---
    if (refreshRecall) {
      callbacks.onProgress?.('按讨论话题检索资料...')
      const existingIds = new Set(ctx.existingPool.map((e) => e.id))
      const [wikiFresh, skillsFresh, memFresh] = await pipelineTracer.span(
        'discuss.refreshRecall',
        () => Promise.all([
          lensLibrary(ctx.userMessage, 8, ctx.brief.dunId).catch(() => []),
          Promise.resolve(
            ctx.storeSkills
              ? lensSkills(
                ctx.userMessage,
                ctx.storeSkills,
                ctx.brief.skills.map((s) => s.name),
              )
              : [],
          ),
          recallMemory(ctx.userMessage, 4, effectiveSignal).catch(() => []),
        ]),
      )
      for (const e of [...wikiFresh, ...skillsFresh]) {
        if (!existingIds.has(e.id)) {
          freshEvidence.push(e)
          existingIds.add(e.id)
        }
      }
      const existingMemIds = new Set((ctx.existingMemory || []).map((m) => m.id))
      for (const m of memFresh) {
        if (!existingMemIds.has(m.id)) {
          freshMemory.push(m)
          existingMemIds.add(m.id)
        }
      }
      if (freshEvidence.length > 0) callbacks.onEvidenceDelta?.(freshEvidence)
      if (freshMemory.length > 0) callbacks.onMemoryDelta?.(freshMemory)
    }

    if (effectiveSignal?.aborted) {
      throw new WritingError({ code: 'user_aborted', stage: 'compose', sessionId })
    }

    // --- Stage 2: 流式讨论 (方案一: 工具内联) ---
    callbacks.onProgress?.('思考中...')
    const combinedPool = [...ctx.existingPool, ...freshEvidence]
    const combinedMemory = [...(ctx.existingMemory || []), ...freshMemory]

    const userPrompt = buildWriterDiscussPrompt(
      ctx.currentDocument,
      ctx.userMessage,
      ctx.brief,
      combinedPool,
      {
        chatHistory: ctx.chatHistory,
        memorySnippets: combinedMemory,
        freshEvidence,
      },
    )

    // 系统提示: 启用工具时追加工具使用指南
    const discussSystemPrompt = enableToolLoop
      ? `${WRITER_DISCUSS_SYSTEM_PROMPT}\n\n${buildToolGuidelines()}`
      : WRITER_DISCUSS_SYSTEM_PROMPT

    const messages: SimpleChatMessage[] = [
      { role: 'system', content: discussSystemPrompt },
      { role: 'user', content: userPrompt },
    ]

    let rawBuffer = ''
    let answerText = ''
    let delimiterSeen = false
    let fullReasoning = ''

    await pipelineTracer.span(
      'stream.main',
      async () => {
        await runStreamWithTools(
          'writerChat',
          messages,
          enableToolLoop ? STUDY_ROOM_TOOLS : null,
          {
            onChunk: (chunk) => {
              rawBuffer += chunk
              if (!delimiterSeen) {
                const idx = rawBuffer.indexOf(SUGGESTED_EDIT_DELIMITER)
                if (idx >= 0) {
                  delimiterSeen = true
                  answerText = rawBuffer.slice(0, idx).replace(/\s+$/, '')
                  callbacks.onAnswerDelta(answerText)
                } else {
                  const safeLen = Math.max(0, rawBuffer.length - SUGGESTED_EDIT_DELIMITER.length)
                  if (safeLen > answerText.length) {
                    answerText = rawBuffer.slice(0, safeLen)
                    callbacks.onAnswerDelta(answerText)
                  }
                }
              }
            },
            onReasoningChunk: (reasoningChunk) => {
              fullReasoning += reasoningChunk
              callbacks.onReasoningDelta?.(fullReasoning)
            },
            onToolProgress: (msg) => callbacks.onProgress?.(msg),
            onEvidenceDelta: (items) => {
              for (const e of items) {
                if (!freshEvidence.some((x) => x.id === e.id)) freshEvidence.push(e)
              }
              callbacks.onEvidenceDelta?.(items)
            },
            onMemoryDelta: (items) => {
              for (const m of items) {
                if (!freshMemory.some((x) => x.id === m.id)) freshMemory.push(m)
              }
              callbacks.onMemoryDelta?.(items)
            },
            onProfileSuggestions: (items) => callbacks.onProfileSuggestions?.(items),
            onContentReset: () => {
              rawBuffer = ''
              answerText = ''
              delimiterSeen = false
              fullReasoning = ''
            },
          },
          { dunId: ctx.brief.dunId, signal: effectiveSignal },
        )
      },
    )

    // --- Stage 3: 收尾 — 解析 suggestedEdit ---
    let suggestedEdit: SuggestedEdit | null = null
    const finalIdx = rawBuffer.indexOf(SUGGESTED_EDIT_DELIMITER)
    if (finalIdx >= 0) {
      answerText = rawBuffer.slice(0, finalIdx).replace(/\s+$/, '')
      callbacks.onAnswerDelta(answerText)
      const jsonPart = rawBuffer.slice(finalIdx + SUGGESTED_EDIT_DELIMITER.length).trim()
      suggestedEdit = parseSuggestedEditJson(jsonPart)
    } else {
      answerText = rawBuffer
      callbacks.onAnswerDelta(answerText)
    }

    return { answer: answerText, suggestedEdit, freshEvidence, freshMemory }
  } catch (err) {
    if (effectiveSignal?.aborted) {
      throw new WritingError({ code: 'user_aborted', stage: 'compose', sessionId })
    }
    throw new WritingError({
      code: 'llm_unavailable',
      stage: 'compose',
      sessionId,
      details: err,
    })
  } finally {
    tokenTracker.finishAndPrint()
    studyAbortManager.release(abortKey)
  }
}

/** 解析讨论模式的 suggestedEdit JSON (容忍围栏、前后杂文本) */
function parseSuggestedEditJson(raw: string): SuggestedEdit | null {
  const jsonStr = extractFirstJsonObject(raw)
  if (!jsonStr) return null
  try {
    const parsed = JSON.parse(jsonStr) as Partial<SuggestedEdit>
    if (typeof parsed.summary !== 'string' || typeof parsed.instruction !== 'string') return null
    const summary = parsed.summary.trim()
    const instruction = parsed.instruction.trim()
    if (!summary || !instruction) return null
    return { summary, instruction }
  } catch (err) {
    console.warn('[StudyRoom] parseSuggestedEditJson failed:', err, 'raw:', jsonStr.slice(0, 200))
    return null
  }
}
