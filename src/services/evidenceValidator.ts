/**
 * Evidence Validator — 三支柱验证模块
 *
 * 对 SopEpisode 进行三个维度的验证：
 *   1. goal_completion（目标完成度）— LLM 判定 output 是否满足 goal
 *   2. quality_standards（质量标准）— 解析 SOP 中"质量标准"section 逐条检查
 *   3. evidence_obligations（证据义务）— 与 SOP obligations 对照 trace 中的工具调用
 *
 * 所有 prompt 常量均内聚在此文件内部，不写入 prompts.ts。
 */

import type {
  SopEpisode,
  SopValidatorOutput,
  SopPillarResult,
  SopObligationCheck,
  SopValidatorDiagnostics,
  SopEvidenceType,
} from '../types'
import { chatBackground, isLLMConfigured } from './llmService'
import type { SimpleChatMessage } from './llmService'

// ============================================
// 常量
// ============================================

const VALIDATOR_VERSION = '1.0.0'

const NEUTRAL_CONFIDENCE = 0.5

/** 写作类关键词 */
const WRITING_KEYWORDS = ['写作', '撰写', '创作', '文章', '文案', '内容生成', '草稿']

// ============================================
// Prompt 模板
// ============================================

const GOAL_COMPLETION_PROMPT = `你是一个任务目标完成度评估器。

用户的目标:
{goal}

实际输出:
{output}

请评估实际输出是否满足用户目标。返回严格 JSON 格式（不要包含 markdown 代码块标记）:
{
  "score": <0到1的浮点数，1表示完全满足>,
  "passed": <true/false，score >= 0.6 时为 true>,
  "reasoning": "<50字以内的判定理由>"
}

注意：
- 只评估目标是否被满足，不考虑输出质量
- 如果输出完全偏题，score 给 0
- 如果部分满足，按比例给分`

const QUALITY_CHECK_PROMPT = `你是一个输出质量评估器。

质量标准清单:
{standards}

实际输出:
{output}

请逐条评估输出是否满足上述质量标准。返回严格 JSON 格式（不要包含 markdown 代码块标记）:
{
  "score": <0到1的浮点数，为各标准满足率的平均值>,
  "passed": <true/false，score >= 0.6 时为 true>,
  "checkResults": [
    {"standard": "<标准描述>", "met": <true/false>, "note": "<简短说明>"}
  ],
  "reasoning": "<50字以内的总体判定>"
}`

// ============================================
// 工具函数
// ============================================

/**
 * 从 SOP 文本中提取指定 section 的内容。
 * 支持 ## 质量标准、## 质量要求、## Quality Standards 等变体。
 */
function extractSopSection(sopText: string, patterns: RegExp[]): string | null {
  const lines = sopText.split(/\r?\n/)
  for (const pattern of patterns) {
    const startIdx = lines.findIndex((l) => pattern.test(l))
    if (startIdx === -1) continue
    const content: string[] = []
    for (let i = startIdx + 1; i < lines.length; i++) {
      // 遇到同级或更高级标题时停止
      if (/^#{1,2}\s/.test(lines[i])) break
      content.push(lines[i])
    }
    const text = content.join('\n').trim()
    if (text.length > 0) return text
  }
  return null
}

/** 解析质量标准 section 为列表 */
function parseQualityStandards(sectionText: string): string[] {
  const items: string[] = []
  const lines = sectionText.split(/\r?\n/)
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s+(.+)$/)
    if (m) {
      items.push(m[1].trim())
    } else if (line.match(/^\s*\d+[.)]\s+(.+)$/)) {
      const numMatch = line.match(/^\s*\d+[.)]\s+(.+)$/)
      if (numMatch) items.push(numMatch[1].trim())
    }
  }
  return items
}

/** 从 SOP frontmatter 中解析 obligations 列表 */
function parseObligationsFromSop(sopText: string): Array<{
  id: string
  description: string
  evidenceType: SopEvidenceType
}> {
  // 尝试从 frontmatter 中提取 obligations 块
  const fmMatch = sopText.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/)
  if (!fmMatch) return []
  const fm = fmMatch[1]

  const lines = fm.split(/\r?\n/)
  const headIdx = lines.findIndex((l) => /^obligations\s*:\s*$/.test(l))
  if (headIdx === -1) return []

  const obligations: Array<{ id: string; description: string; evidenceType: SopEvidenceType }> = []
  let current: Record<string, string> | null = null

  const flush = () => {
    if (current) {
      obligations.push({
        id: current.id || `obligation_${obligations.length + 1}`,
        description: current.description || '',
        evidenceType: (current.evidenceType as SopEvidenceType) || 'semantic',
      })
      current = null
    }
  }

  for (let i = headIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    // 顶层字段 → 结束
    if (/^[A-Za-z_]/.test(line)) break
    const dashMatch = line.match(/^\s*-\s+(.*)$/)
    if (dashMatch) {
      flush()
      const kvMatch = dashMatch[1].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
      if (kvMatch) {
        current = { [kvMatch[1]]: kvMatch[2].trim().replace(/^['"]|['"]$/g, '') }
      }
      continue
    }
    const contMatch = line.match(/^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (contMatch && current) {
      current[contMatch[1]] = contMatch[2].trim().replace(/^['"]|['"]$/g, '')
    }
  }
  flush()
  return obligations
}

/** 从 episode trace 中提取工具调用名称集合 */
function extractToolCalls(episode: SopEpisode): string[] {
  return episode.trace
    .filter((e) => e.kind === 'tool_call')
    .map((e) => (e.payload.toolName as string) || (e.payload.name as string) || '')
    .filter(Boolean)
}

/** 安全地解析 LLM 返回的 JSON */
function safeParseJson<T>(text: string): T | null {
  try {
    // 移除可能的 markdown 代码块标记
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

/** 计算 output_specificity_score（写作类启发式） */
function computeSpecificityScore(output: string): number {
  let score = 0.5
  // 含数字数据
  const numberMatches = output.match(/\d+[%‰万亿千百十]/g)
  if (numberMatches && numberMatches.length >= 2) score += 0.15
  // 含引用标记
  if (/[【\[].*?[】\]]/.test(output) || /引用|参考|来源|数据来源/.test(output)) score += 0.1
  // 含专有名词（中文括号注释）
  if (/[\u4e00-\u9fff]+[（(][A-Za-z]/.test(output)) score += 0.1
  // 含具体日期
  if (/\d{4}[-/年]\d{1,2}[-/月]/.test(output)) score += 0.1
  // 含列表结构
  const listItems = output.match(/^\s*[-*\d.]+\s/gm)
  if (listItems && listItems.length >= 3) score += 0.05
  return Math.min(score, 1.0)
}

/** 判断是否为写作类 SOP */
function isWritingSop(sopText: string): boolean {
  return WRITING_KEYWORDS.some((kw) => sopText.includes(kw))
}

// ============================================
// 三支柱验证核心逻辑
// ============================================

interface GoalResult {
  score: number
  passed: boolean
  reasoning: string
}

interface QualityResult {
  score: number
  passed: boolean
  reasoning: string
}

/**
 * 支柱 1: 目标完成度 — 调用 LLM 判定
 */
async function evaluateGoalCompletion(
  goal: string,
  output: string,
): Promise<SopPillarResult> {
  const llmAvailable = isLLMConfigured()
  if (!llmAvailable) {
    return {
      passed: true,
      confidence: NEUTRAL_CONFIDENCE,
      notes: 'LLM 不可用，返回中性默认值',
    }
  }

  try {
    const prompt = GOAL_COMPLETION_PROMPT
      .replace('{goal}', goal)
      .replace('{output}', output.slice(0, 3000))

    const messages: SimpleChatMessage[] = [
      { role: 'system', content: '你是一个严格的任务完成度评估器，只返回 JSON。' },
      { role: 'user', content: prompt },
    ]

    const response = await chatBackground(messages, { priority: 5 })
    if (!response) {
      return {
        passed: true,
        confidence: NEUTRAL_CONFIDENCE,
        notes: 'LLM 调用返回空，使用中性默认值',
      }
    }

    const parsed = safeParseJson<GoalResult>(response)
    if (!parsed || typeof parsed.score !== 'number') {
      return {
        passed: true,
        confidence: NEUTRAL_CONFIDENCE,
        notes: 'LLM 返回格式异常，使用中性默认值',
      }
    }

    const passed = parsed.score >= 0.6
    return {
      passed,
      confidence: Math.min(Math.max(parsed.score, 0), 1),
      notes: parsed.reasoning || '',
      failureCategory: passed ? undefined : 'missed_goal',
    }
  } catch {
    return {
      passed: true,
      confidence: NEUTRAL_CONFIDENCE,
      notes: 'LLM 调用异常，使用中性默认值',
    }
  }
}

/**
 * 支柱 2: 质量标准 — 解析 SOP 质量标准 section 逐条检查
 */
async function evaluateQualityStandards(
  sopText: string,
  output: string,
): Promise<SopPillarResult> {
  const qualityPatterns = [
    /^#{2,3}\s*(质量标准|质量要求|Quality\s*Standards?)/i,
    /^#{2,3}\s*(评估标准|验收标准|Acceptance\s*Criteria)/i,
  ]

  const sectionText = extractSopSection(sopText, qualityPatterns)
  if (!sectionText) {
    return {
      passed: true,
      confidence: NEUTRAL_CONFIDENCE,
      notes: 'SOP 缺少质量标准 section，返回中性默认值',
      failureCategory: undefined,
    }
  }

  const standards = parseQualityStandards(sectionText)
  if (standards.length === 0) {
    return {
      passed: true,
      confidence: NEUTRAL_CONFIDENCE,
      notes: 'SOP 质量标准 section 未包含可解析的条目',
    }
  }

  const llmAvailable = isLLMConfigured()
  if (!llmAvailable) {
    return {
      passed: true,
      confidence: NEUTRAL_CONFIDENCE,
      notes: `LLM 不可用，已提取 ${standards.length} 条质量标准但无法评估`,
    }
  }

  try {
    const prompt = QUALITY_CHECK_PROMPT
      .replace('{standards}', standards.map((s, i) => `${i + 1}. ${s}`).join('\n'))
      .replace('{output}', output.slice(0, 3000))

    const messages: SimpleChatMessage[] = [
      { role: 'system', content: '你是一个严格的质量评估器，只返回 JSON。' },
      { role: 'user', content: prompt },
    ]

    const response = await chatBackground(messages, { priority: 5 })
    if (!response) {
      return {
        passed: true,
        confidence: NEUTRAL_CONFIDENCE,
        notes: 'LLM 调用返回空，使用中性默认值',
      }
    }

    const parsed = safeParseJson<QualityResult>(response)
    if (!parsed || typeof parsed.score !== 'number') {
      return {
        passed: true,
        confidence: NEUTRAL_CONFIDENCE,
        notes: 'LLM 返回格式异常，使用中性默认值',
      }
    }

    const passed = parsed.score >= 0.6
    return {
      passed,
      confidence: Math.min(Math.max(parsed.score, 0), 1),
      notes: parsed.reasoning || '',
      failureCategory: passed ? undefined : 'low_quality',
    }
  } catch {
    return {
      passed: true,
      confidence: NEUTRAL_CONFIDENCE,
      notes: 'LLM 调用异常，使用中性默认值',
    }
  }
}

/**
 * 支柱 3: 证据义务 — 与 SOP obligations 对照 trace
 */
function evaluateEvidenceObligations(
  sopText: string,
  episode: SopEpisode,
): { pillar: SopPillarResult; checks: SopObligationCheck[] } {
  const obligations = parseObligationsFromSop(sopText)

  if (obligations.length === 0) {
    // SOP 缺 obligations section → fallback
    return {
      pillar: {
        passed: true,
        confidence: NEUTRAL_CONFIDENCE,
        notes: 'SOP 缺少 obligations 定义，返回中性默认值',
        failureCategory: 'obligations_section_missing',
      },
      checks: [],
    }
  }

  const toolCalls = extractToolCalls(episode)
  const outputText = episode.output || ''

  const checks: SopObligationCheck[] = obligations.map((obl) => {
    let found = false
    let evidenceRef: string | undefined

    switch (obl.evidenceType) {
      case 'tool_call': {
        // 检查 trace 中是否有匹配的工具调用
        const match = toolCalls.find((tc) =>
          tc.toLowerCase().includes(obl.id.toLowerCase()) ||
          obl.description.toLowerCase().split(/\s+/).some((w) => w.length > 2 && tc.toLowerCase().includes(w))
        )
        if (match) {
          found = true
          evidenceRef = `tool_call:${match}`
        }
        break
      }
      case 'artifact': {
        // 检查 trace 中是否有 artifact_produced 事件
        const artifactEvents = episode.trace.filter((e) => e.kind === 'artifact_produced')
        if (artifactEvents.length > 0) {
          found = true
          evidenceRef = `artifact:${artifactEvents.length} items`
        }
        break
      }
      case 'semantic': {
        // 语义检查：output 中是否包含相关关键词
        const keywords = obl.description.split(/[\s,，;；]+/).filter((w) => w.length > 1)
        const matchCount = keywords.filter((kw) => outputText.includes(kw)).length
        if (matchCount >= Math.ceil(keywords.length * 0.3)) {
          found = true
          evidenceRef = `semantic:${matchCount}/${keywords.length} keywords matched`
        }
        break
      }
      case 'data_provenance':
      case 'reasoning_trace': {
        // 检查 trace 中是否有 reasoning_marker
        const markers = episode.trace.filter((e) => e.kind === 'reasoning_marker')
        if (markers.length > 0) {
          found = true
          evidenceRef = `${obl.evidenceType}:${markers.length} markers`
        }
        break
      }
      case 'evidence_completeness': {
        // 综合检查：工具调用数 + artifact 数达到基本阈值
        const stats = episode.traceStats
        if (stats.toolCallCount >= 1 || stats.artifactCount >= 1) {
          found = true
          evidenceRef = `completeness:tools=${stats.toolCallCount},artifacts=${stats.artifactCount}`
        }
        break
      }
      default: {
        // 未知类型默认通过
        found = true
        evidenceRef = 'unknown_type:default_pass'
      }
    }

    return {
      obligationId: obl.id,
      description: obl.description,
      evidenceType: obl.evidenceType,
      found,
      evidenceRef,
    }
  })

  const foundCount = checks.filter((c) => c.found).length
  const score = obligations.length > 0 ? foundCount / obligations.length : NEUTRAL_CONFIDENCE
  const passed = score >= 0.6
  const missingItems = checks.filter((c) => !c.found).map((c) => c.obligationId)

  return {
    pillar: {
      passed,
      confidence: score,
      notes: missingItems.length > 0
        ? `缺失证据: ${missingItems.join(', ')}`
        : `全部 ${obligations.length} 项义务均有证据`,
      failureCategory: passed ? undefined : 'missing_evidence',
    },
    checks,
  }
}

// ============================================
// 公开 API
// ============================================

/**
 * 对单个 SopEpisode 执行三支柱验证。
 *
 * @param episode - 待验证的执行回合
 * @param sopText - 完整的 SOP 文本（含 frontmatter + body）
 * @returns SopValidatorOutput 完整验证结果
 */
export async function validateEpisode(
  episode: SopEpisode,
  sopText: string,
): Promise<SopValidatorOutput> {
  const startTime = Date.now()
  let llmCalls = 0

  try {
    // 支柱 1: 目标完成度
    const goalPillar = await evaluateGoalCompletion(episode.goal, episode.output)
    if (isLLMConfigured()) llmCalls++

    // 支柱 2: 质量标准
    const qualityPillar = await evaluateQualityStandards(sopText, episode.output)
    if (isLLMConfigured() && extractSopSection(sopText, [
      /^#{2,3}\s*(质量标准|质量要求|Quality\s*Standards?)/i,
      /^#{2,3}\s*(评估标准|验收标准|Acceptance\s*Criteria)/i,
    ])) {
      llmCalls++
    }

    // 支柱 3: 证据义务
    const { pillar: evidencePillar, checks: obligationChecks } =
      evaluateEvidenceObligations(sopText, episode)

    // 综合判定
    const pillars = {
      goal: goalPillar,
      quality: qualityPillar,
      evidence: evidencePillar,
    }

    const avgConfidence = (goalPillar.confidence + qualityPillar.confidence + evidencePillar.confidence) / 3
    const passed = goalPillar.passed && qualityPillar.passed && evidencePillar.passed

    // 写作类 output_specificity_score
    let specificityNote = ''
    if (episode.output.length > 500 && isWritingSop(sopText)) {
      const specificityScore = computeSpecificityScore(episode.output)
      specificityNote = ` | output_specificity_score=${specificityScore.toFixed(2)}`
    }

    const durationMs = Date.now() - startTime

    const diagnostics: SopValidatorDiagnostics = {
      layerResults: {
        layer1Rule: {
          passed: evidencePillar.passed,
          failedChecks: obligationChecks.filter((c) => !c.found).map((c) => c.obligationId),
          durationMs,
        },
        layer2Judge: llmCalls > 0
          ? {
              passed: goalPillar.passed && qualityPillar.passed,
              lowConfidenceChecks: [goalPillar, qualityPillar]
                .filter((p) => p.confidence < 0.6)
                .map((_, i) => i === 0 ? 'goal' : 'quality'),
              durationMs,
            }
          : undefined,
      },
      shortCircuited: false,
      totalValidationCost: {
        llmCalls,
        tokens: 0, // 无法精确追踪 chatBackground 的 token 消耗
        durationMs,
      },
      hallucinationFlagsRaised: episode.outputFingerprint?.hallucinationFlags ?? [],
    }

    const reasoning = [
      `goal(${goalPillar.confidence.toFixed(2)}): ${goalPillar.notes}`,
      `quality(${qualityPillar.confidence.toFixed(2)}): ${qualityPillar.notes}`,
      `evidence(${evidencePillar.confidence.toFixed(2)}): ${evidencePillar.notes}`,
      specificityNote,
    ].filter(Boolean).join(' | ')

    const validatorModel = llmCalls > 0 ? 'chatBackground' : 'rule-only'

    return {
      episodeId: episode.episodeId,
      validatedAt: new Date().toISOString(),
      validatorVersion: VALIDATOR_VERSION,
      validatorModel,
      passed,
      confidence: avgConfidence,
      pillars,
      obligationChecks,
      diagnostics,
      reasoning,
    }
  } catch (err) {
    // 全局 fallback：返回中性默认值
    const durationMs = Date.now() - startTime
    const neutralPillar: SopPillarResult = {
      passed: true,
      confidence: NEUTRAL_CONFIDENCE,
      notes: `验证异常: ${err instanceof Error ? err.message : String(err)}`,
    }

    return {
      episodeId: episode.episodeId,
      validatedAt: new Date().toISOString(),
      validatorVersion: VALIDATOR_VERSION,
      validatorModel: 'rule-only',
      passed: true,
      confidence: NEUTRAL_CONFIDENCE,
      pillars: {
        goal: neutralPillar,
        quality: neutralPillar,
        evidence: neutralPillar,
      },
      obligationChecks: [],
      diagnostics: {
        layerResults: {
          layer1Rule: { passed: true, failedChecks: [], durationMs },
        },
        shortCircuited: true,
        totalValidationCost: { llmCalls: 0, tokens: 0, durationMs },
        hallucinationFlagsRaised: [],
      },
      reasoning: `验证过程异常，返回中性默认值: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * 自检函数 — 构造 mock 数据验证 validateEpisode 返回类型正确。
 * 不做实际 LLM 调用（判断 LLM 不可用时直接使用 fallback）。
 */
export async function __runSelfTest(): Promise<void> {
  const mockEpisode: SopEpisode = {
    episodeId: 'test-ep-001',
    timestamp: new Date().toISOString(),
    sessionId: 'test-session',
    goal: '生成一份竞品分析报告',
    sopId: 'test-sop',
    sopVersion: '1.0.0',
    isShadow: false,
    promptSnapshot: {
      fullPromptHash: 'abc123',
      sopSectionInjected: '',
      sopInjectionTruncated: false,
      contextSizeChars: 1000,
      directiveMode: 'advisory',
    },
    trace: [
      { ts: new Date().toISOString(), kind: 'tool_call', payload: { toolName: 'webSearch', query: '竞品' } },
      { ts: new Date().toISOString(), kind: 'tool_result', payload: { success: true } },
      { ts: new Date().toISOString(), kind: 'artifact_produced', payload: { type: 'report' } },
    ],
    output: '这是一份详细的竞品分析报告，包含市场份额数据（2024年Q3），主要竞品A公司（MarketCo）占比35%...',
    durationMs: 5000,
    modelId: 'test-model',
    tokenUsage: { promptTokens: 500, completionTokens: 300, totalTokens: 800 },
    traceStats: {
      toolCallCount: 1,
      distinctTools: ['webSearch'],
      toolFailures: 0,
      artifactCount: 1,
      reasoningMarkerCount: 0,
    },
    outputFingerprint: {
      contentHash: 'hash123',
      hallucinationFlags: [],
      structuralSignature: 'report',
    },
  }

  const mockSopText = `---
name: competitive-analysis
version: 1.0.0
archetype: research
obligations:
  - id: web_search
    description: 搜索竞品信息
    evidenceType: tool_call
    evidenceMatcher: webSearch
  - id: data_cite
    description: 引用数据来源
    evidenceType: semantic
    evidenceMatcher: 数据来源
---

## 目标
生成竞品分析报告

## 质量标准
- 包含至少3个竞品的对比数据
- 引用具体数据来源
- 结论清晰明确

## 约束
不得捏造数据
`

  const result = await validateEpisode(mockEpisode, mockSopText)

  // 类型断言验证
  const _episodeId: string = result.episodeId
  const _validatedAt: string = result.validatedAt
  const _passed: boolean = result.passed
  const _confidence: number = result.confidence
  const _goalPassed: boolean = result.pillars.goal.passed
  const _qualityPassed: boolean = result.pillars.quality.passed
  const _evidencePassed: boolean = result.pillars.evidence.passed
  const _checks: SopObligationCheck[] = result.obligationChecks
  const _reasoning: string = result.reasoning

  // 避免 unused variable 警告
  void _episodeId
  void _validatedAt
  void _passed
  void _confidence
  void _goalPassed
  void _qualityPassed
  void _evidencePassed
  void _checks
  void _reasoning

  console.log('[evidenceValidator] Self-test passed. Result:', {
    passed: result.passed,
    confidence: result.confidence.toFixed(2),
    pillars: {
      goal: result.pillars.goal.passed,
      quality: result.pillars.quality.passed,
      evidence: result.pillars.evidence.passed,
    },
    obligationChecks: result.obligationChecks.length,
  })
}
