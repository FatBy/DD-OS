/**
 * deliberationService — 深度打磨管线核心编排.
 *
 * 5 Phase 管线:
 *   Phase 1: runDiagnosis      — 自由思考 + 结构化固化 (2 次 LLM)
 *   Phase 2: runRedTeam        — 3 persona 并行攻击 + 1 汇总 (4 次 LLM, 3 并行)
 *   Phase 3: proposeInsights   — 生成候选洞察 (1 次 LLM)
 *   Phase 4: decideStrategy    — 增量 vs 换底座 (1 次 LLM, 轻量)
 *   Phase 5: runRebuild        — 流式重写 (1 次 LLM, 流式)
 *
 * 2 个编排器:
 *   runDeliberationUntilUserChoice — 串起 Phase 1→2→3, 暂停等用户
 *   runDeliberationAfterUserChoice — 串起 Phase 4→5
 *
 * 设计决策:
 *   - MVP 不做文件持久化, 数据挂在 Zustand session 内存态
 *   - Phase 5 直接用 streamChat, 不走 runFullWriting (避免重跑 telescope)
 *   - 诊断分两步: 自由思考 → 结构化固化 (避免 JSON 约束压缩推理深度)
 */

import type {
  WritingBrief,
  DiagnosisReport,
  RedTeamReport,
  InsightProposal, InsightCandidate,
  RewriteStrategy,
  WriterFingerprint,
} from '@/types'
import { streamChat, chatBackground } from '@/services/llmService'
import type { SimpleChatMessage } from '@/services/llmService'
import { WritingError } from './errors'
import {
  DIAGNOSIS_FREE_THINKING_SYSTEM,
  DIAGNOSIS_STRUCTURED_PROMPT,
  buildDiagnosisFreeThinkingPrompt,
  buildRedTeamPersonaSystem,
  buildRedTeamUserPrompt,
  buildRedTeamConvergePrompt,
  INSIGHT_CANDIDATES_SYSTEM,
  buildInsightCandidatesPrompt,
  REWRITE_STRATEGY_SYSTEM,
  buildRewriteStrategyPrompt,
  buildRebuildSystemPrompt,
} from './deliberationPrompts'
import {
  formatFingerprintV2,
  resolveFingerprintForBrief,
} from './prompts'

// ============================================
// 配置
// ============================================

export const DELIBERATION_CONFIG = {
  DIAGNOSIS_FREE_THINKING_MAX_TOKENS: 2000,
  DIAGNOSIS_STRUCTURED_MAX_TOKENS: 1500,
  REDTEAM_PER_PERSONA_MAX_TOKENS: 1200,
  REDTEAM_CONVERGE_MAX_TOKENS: 800,
  INSIGHT_CANDIDATES_COUNT: 3,
} as const

// ============================================
// 辅助: 从 LLM 输出中提取 JSON
// ============================================

function extractJson(raw: string): string {
  // 去掉 ```json ... ``` 围栏
  let cleaned = raw.trim()
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/m)
  if (fenceMatch) cleaned = fenceMatch[1].trim()

  // 抓取第一个 { 到最后一个 }
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first >= 0 && last > first) return cleaned.slice(first, last + 1)
  return cleaned
}

function parseJsonSafe<T>(raw: string, label: string): T {
  const jsonStr = extractJson(raw)
  try {
    return JSON.parse(jsonStr) as T
  } catch (err) {
    console.warn(`[Deliberation] ${label} JSON parse failed:`, err, 'raw:', jsonStr.slice(0, 300))
    throw new Error(`${label}: LLM 输出的 JSON 无法解析`)
  }
}

// ============================================
// Phase 1: 诊断
// ============================================

/**
 * Phase 1: 诊断。内部跑 2 次 LLM (自由思考 + 结构化固化).
 */
export async function runDiagnosis(
  draft: string,
  brief: WritingBrief,
  sessionId: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
  priorReport?: DiagnosisReport,
): Promise<DiagnosisReport> {
  if (signal?.aborted) {
    throw new WritingError({ code: 'user_aborted', stage: 'compose', sessionId })
  }

  // Phase 1a: 自由思考
  onProgress?.('诊断中: 自由审查...')

  const freeMessages: SimpleChatMessage[] = [
    { role: 'system', content: DIAGNOSIS_FREE_THINKING_SYSTEM },
    {
      role: 'user',
      content: buildDiagnosisFreeThinkingPrompt(
        draft,
        brief.intent,
        priorReport ? `论点: ${priorReport.thesis}\n置信度: ${priorReport.confidence}` : undefined,
      ),
    },
  ]

  const rawThinking = await chatBackground(freeMessages, { signal })
  if (!rawThinking) {
    throw new Error('诊断 Phase 1a: LLM 返回空结果')
  }

  if (signal?.aborted) {
    throw new WritingError({ code: 'user_aborted', stage: 'compose', sessionId })
  }

  // Phase 1b: 结构化固化
  onProgress?.('诊断中: 整理结论...')

  const structMessages: SimpleChatMessage[] = [
    { role: 'system', content: DIAGNOSIS_FREE_THINKING_SYSTEM },
    { role: 'user', content: freeMessages[1].content! },
    { role: 'assistant', content: rawThinking },
    { role: 'user', content: DIAGNOSIS_STRUCTURED_PROMPT },
  ]

  const structRaw = await chatBackground(structMessages, { signal })
  if (!structRaw) {
    throw new Error('诊断 Phase 1b: LLM 返回空结果')
  }

  const parsed = parseJsonSafe<Omit<DiagnosisReport, 'rawThinking' | 'timestamp'>>(
    structRaw, 'DiagnosisReport',
  )

  return {
    ...parsed,
    rawThinking,
    timestamp: Date.now(),
  }
}

// ============================================
// Phase 2: 红队
// ============================================

/**
 * Phase 2: 红队. 3 个 persona 并行攻击 + 1 次汇总.
 */
export async function runRedTeam(
  draft: string,
  _diagnosis: DiagnosisReport,
  sessionId: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<RedTeamReport> {
  if (signal?.aborted) {
    throw new WritingError({ code: 'user_aborted', stage: 'compose', sessionId })
  }

  onProgress?.('红队测试: 3 个 persona 并行攻击...')

  const userPrompt = buildRedTeamUserPrompt(draft)
  const personaKeys: Array<'expert' | 'adversary' | 'audience'> = ['expert', 'adversary', 'audience']

  // 并行跑 3 个 persona
  const feedbackPromises = personaKeys.map((key) => {
    const messages: SimpleChatMessage[] = [
      { role: 'system', content: buildRedTeamPersonaSystem(key) },
      { role: 'user', content: userPrompt },
    ]
    return chatBackground(messages, { signal })
  })

  const feedbacks = await Promise.all(feedbackPromises)
  const [expertFeedback, adversaryFeedback, audienceFeedback] = feedbacks.map(
    (f) => f || '(该 persona 未返回反馈)',
  )

  if (signal?.aborted) {
    throw new WritingError({ code: 'user_aborted', stage: 'compose', sessionId })
  }

  // 汇总去重
  onProgress?.('红队测试: 汇总质疑...')

  const convergeMessages: SimpleChatMessage[] = [
    { role: 'system', content: '你是一个结构化信息整理器。把多源反馈去重、排序、标注来源。' },
    {
      role: 'user',
      content: buildRedTeamConvergePrompt(expertFeedback, adversaryFeedback, audienceFeedback),
    },
  ]

  const convergeRaw = await chatBackground(convergeMessages, { signal })
  if (!convergeRaw) {
    throw new Error('红队 Phase 2 汇总: LLM 返回空结果')
  }

  const parsed = parseJsonSafe<Pick<RedTeamReport, 'challenges' | 'convergentPoints'>>(
    convergeRaw, 'RedTeamReport',
  )

  return {
    ...parsed,
    rawFeedback: {
      expert: expertFeedback,
      adversary: adversaryFeedback,
      audience: audienceFeedback,
    },
    timestamp: Date.now(),
  }
}

// ============================================
// Phase 3: 洞察候选
// ============================================

/**
 * Phase 3: 基于诊断 + 红队, 生成 2-3 个候选洞察给用户选.
 */
export async function proposeInsightCandidates(
  draft: string,
  diagnosis: DiagnosisReport,
  redTeam: RedTeamReport,
  sessionId: string,
  signal?: AbortSignal,
): Promise<InsightProposal> {
  if (signal?.aborted) {
    throw new WritingError({ code: 'user_aborted', stage: 'compose', sessionId })
  }

  // 压缩 draft 为摘要 (取前 500 字 + 核心论点)
  const draftSummary = `核心论点: ${diagnosis.thesis}\n原稿前 500 字: ${draft.slice(0, 500)}...`

  const messages: SimpleChatMessage[] = [
    { role: 'system', content: INSIGHT_CANDIDATES_SYSTEM },
    {
      role: 'user',
      content: buildInsightCandidatesPrompt(
        draftSummary,
        JSON.stringify({
          thesis: diagnosis.thesis,
          thesisClarity: diagnosis.thesisClarity,
          gaps: diagnosis.gaps,
          vulnerabilities: diagnosis.vulnerabilities,
        }),
        JSON.stringify({
          challenges: redTeam.challenges,
          convergentPoints: redTeam.convergentPoints,
        }),
      ),
    },
  ]

  const raw = await chatBackground(messages, { signal })
  if (!raw) {
    throw new Error('洞察候选 Phase 3: LLM 返回空结果')
  }

  return parseJsonSafe<InsightProposal>(raw, 'InsightProposal')
}

// ============================================
// Phase 4: 重写策略决策
// ============================================

/**
 * Phase 4: 判断增量修改还是换底座重写.
 */
export async function decideRewriteStrategy(
  originalThesis: string,
  selectedInsights: InsightCandidate[],
  skippedInsights: InsightCandidate[],
  userCustomNote: string | undefined,
  signal?: AbortSignal,
): Promise<RewriteStrategy> {
  const messages: SimpleChatMessage[] = [
    { role: 'system', content: REWRITE_STRATEGY_SYSTEM },
    {
      role: 'user',
      content: buildRewriteStrategyPrompt(
        originalThesis,
        selectedInsights.map((i) => i.insight).join('\n'),
        skippedInsights.map((i) => i.insight).join('\n'),
        userCustomNote || '',
      ),
    },
  ]

  const raw = await chatBackground(messages, { signal })
  if (!raw) {
    throw new Error('策略决策 Phase 4: LLM 返回空结果')
  }

  return parseJsonSafe<RewriteStrategy>(raw, 'RewriteStrategy')
}

// ============================================
// Phase 5: 重写 (流式)
// ============================================

/**
 * Phase 5: 重写 (流式).
 *
 * 关键设计: 直接用 streamChat, 不走 runFullWriting.
 * 因为 rebuild 场景下证据已经在 Phase 1-3 消费过, 不需要重跑 telescope.
 */
export async function runRebuild(
  ctx: {
    brief: WritingBrief
    newThesis: string
    newLogicChain: DiagnosisReport['logicChain']
    mustAddressChallenges: RedTeamReport['challenges']
    preservedChunks: string[]
    styleFingerprint: WriterFingerprint | null
  },
  callbacks: {
    onChunk: (text: string) => void
    onProgress: (msg: string) => void
    onReasoningChunk?: (chunk: string) => void
  },
  signal?: AbortSignal,
): Promise<{ draft: string }> {
  callbacks.onProgress('重写中: 在新骨架上生成全文...')

  const fingerprintStr = ctx.styleFingerprint
    ? formatFingerprintV2(ctx.styleFingerprint)
    : ''

  const systemPrompt = buildRebuildSystemPrompt(
    ctx.newThesis,
    ctx.newLogicChain,
    ctx.mustAddressChallenges,
    ctx.preservedChunks,
    fingerprintStr,
  )

  const messages: SimpleChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `请基于上述骨架重写这篇文章。核心论点: ${ctx.newThesis}` },
  ]

  let fullText = ''

  await streamChat(
    messages,
    (chunk) => {
      fullText += chunk
      callbacks.onChunk(fullText)
    },
    signal,
    undefined,
    undefined,
    callbacks.onReasoningChunk,
  )

  return { draft: fullText.trim() }
}

// ============================================
// 编排器 1: Phase 1→2→3, 暂停等用户
// ============================================

/**
 * 串起 Phase 1→2→3. 暂停在用户选择点.
 * 返回后 UI 展示 InsightProposal 让用户勾选/补充.
 */
export async function runDeliberationUntilUserChoice(
  draft: string,
  brief: WritingBrief,
  sessionId: string,
  callbacks: {
    onDiagnosisReady: (d: DiagnosisReport) => void
    onRedTeamReady: (r: RedTeamReport) => void
    onInsightsReady: (p: InsightProposal) => void
    onProgress: (stage: 'diagnosis' | 'redteam' | 'insights', msg: string) => void
  },
  signal?: AbortSignal,
  priorReport?: DiagnosisReport,
): Promise<{
  diagnosis: DiagnosisReport
  redTeam: RedTeamReport
  proposal: InsightProposal
}> {
  // Phase 1
  callbacks.onProgress('diagnosis', '开始诊断...')
  const diagnosis = await runDiagnosis(
    draft, brief, sessionId,
    (msg) => callbacks.onProgress('diagnosis', msg),
    signal,
    priorReport,
  )
  callbacks.onDiagnosisReady(diagnosis)

  // Phase 2
  callbacks.onProgress('redteam', '开始红队测试...')
  const redTeam = await runRedTeam(
    draft, diagnosis, sessionId,
    (msg) => callbacks.onProgress('redteam', msg),
    signal,
  )
  callbacks.onRedTeamReady(redTeam)

  // Phase 3
  callbacks.onProgress('insights', '生成候选洞察...')
  const proposal = await proposeInsightCandidates(
    draft, diagnosis, redTeam, sessionId, signal,
  )
  callbacks.onInsightsReady(proposal)

  return { diagnosis, redTeam, proposal }
}

// ============================================
// 编排器 2: Phase 4→5, 用户选择后执行
// ============================================

/**
 * 拿到用户选择后, 串起 Phase 4→5.
 * 按 strategy.mode 分叉:
 *   incremental → 返回 strategy, 调用方走现有 runConversationalEdit
 *   rebuild → 在此函数内流式重写
 */
export async function runDeliberationAfterUserChoice(
  params: {
    brief: WritingBrief
    originalDraft: string
    diagnosis: DiagnosisReport
    proposal: InsightProposal
    selectedInsightIds: string[]
    userCustomNote?: string
    sessionId: string
  },
  callbacks: {
    onStrategy: (s: RewriteStrategy) => void
    onChunk: (text: string) => void
    onProgress: (msg: string) => void
    onReasoningChunk?: (chunk: string) => void
  },
  signal?: AbortSignal,
): Promise<{ strategy: RewriteStrategy; newDraft?: string }> {
  const {
    brief, originalDraft: _originalDraft, diagnosis, proposal,
    selectedInsightIds, userCustomNote, sessionId: _sessionId,
  } = params

  const selectedInsights = proposal.candidates.filter(
    (c) => selectedInsightIds.includes(c.id),
  )
  const skippedInsights = proposal.candidates.filter(
    (c) => !selectedInsightIds.includes(c.id),
  )

  // 如果用户只写了自定义笔记, 没选任何候选, 也创建一个虚拟 insight
  if (selectedInsights.length === 0 && userCustomNote) {
    selectedInsights.push({
      id: 'user_custom',
      insight: userCustomNote,
      whyItMatters: '用户自行提供的判断',
      whatChanges: { keep: [], rewrite: [], drop: [] },
      risk: '需要 AI 评估影响范围',
    })
  }

  // Phase 4: 策略决策
  callbacks.onProgress('决策中: 增量修改还是换底座重写...')
  const strategy = await decideRewriteStrategy(
    diagnosis.thesis,
    selectedInsights,
    skippedInsights,
    userCustomNote,
    signal,
  )
  callbacks.onStrategy(strategy)

  // 分叉
  if (strategy.mode === 'incremental') {
    // 增量模式: 返回 strategy, 调用方负责走 runConversationalEdit
    callbacks.onProgress('策略: 增量修改。将基于现有文章精准修改。')
    return { strategy }
  }

  // Rebuild 模式
  callbacks.onProgress('策略: 换底座重写。开始在新骨架上生成...')
  const fingerprint = resolveFingerprintForBrief(brief)

  const { draft } = await runRebuild(
    {
      brief,
      newThesis: strategy.newThesis || diagnosis.thesis,
      newLogicChain: diagnosis.logicChain,
      mustAddressChallenges: [], // Phase 2 的挑战在后续版本中注入
      preservedChunks: strategy.preservedChunks,
      styleFingerprint: fingerprint,
    },
    {
      onChunk: callbacks.onChunk,
      onProgress: callbacks.onProgress,
      onReasoningChunk: callbacks.onReasoningChunk,
    },
    signal,
  )

  return { strategy, newDraft: draft }
}
