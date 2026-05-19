/**
 * SOP Patch Generator — 基于 episode 与 validator 输出生成 section-anchored 的 SopPatch
 *
 * 由 postExecutionConsolidator 在 Phase 3 异步调用，独立 LLM 调用产出结构化 patch。
 * 失败时返回 null 而不是抛错，全程 try/catch 包裹。
 *
 * Prompt 常量内聚在本文件，不写入 prompts.ts。
 *
 * == 累积策略 ==
 * signalAccumulator 按 sopId+section+direction 累积 episode 信号：
 *   - 同一 section 同方向信号 >= 3 条时才真正触发 LLM 生成 patch
 *   - 生成后清空该 key 的累积，防止重复
 *   - 未达阈值时返回 null（但信号已记录）
 *
 * == Quarantine ==
 * LLM 返回后如果 schema 校验失败，写入 quarantine/{patchId}.json 留存。
 */

import type {
  SopEpisode,
  SopValidatorOutput,
  SopPatch,
  SopPatchOperation,
} from '../types'
import { chatBackground, isLLMConfigured } from './llmService'
import type { SimpleChatMessage } from './llmService'
import { getServerUrl } from '@/utils/env'

// ============================================
// 常量
// ============================================

const GENERATOR_VERSION = '2.0.0'
const GENERATOR_MODEL = 'chatBackground'

/** 同方向信号累积阈值 */
const ACCUMULATION_THRESHOLD = 3

/** delete 操作最低 confidence 阈值 */
const DELETE_CONFIDENCE_THRESHOLD = 0.85

/** 合法 sectionAnchor 白名单 */
const VALID_SECTION_ANCHORS = [
  '目标',
  '输入要求',
  '执行流程',
  '质量标准',
  'obligations',
  '风险处理',
  '输出格式',
] as const

const VALID_OPERATIONS: SopPatchOperation[] = ['replace', 'insert_after', 'delete']

/** 输入截断 */
const MAX_SOP_CHARS = 4000
const MAX_OUTPUT_CHARS = 1500
const MAX_REASONING_CHARS = 1200

// ============================================
// Signal Accumulator (B10)
// ============================================

interface AccumulatedSignal {
  section: string
  direction: 'improve' | 'remove'
  episodes: string[]
}

/**
 * 模块级信号累积器（内存中）。
 * Key 格式: `{sopId}::{section}::{direction}`
 * 应用重启后重置是可接受的。
 */
const signalAccumulator: Map<string, AccumulatedSignal> = new Map()

function buildAccumulatorKey(sopId: string, section: string, direction: 'improve' | 'remove'): string {
  return `${sopId}::${section}::${direction}`
}

/**
 * 从 validatorOutput 推断需要改进的 section 和方向。
 * 返回 null 表示无明确信号。
 *
 * 注：此处不依赖 episode 字段做信号推断，全部基于 validator 诊断结构。
 * episode 维度信息（episodeId、sopId）由调用方在累积阶段传入。
 */
function inferSignal(
  validatorOutput: SopValidatorOutput,
): { section: string; direction: 'improve' | 'remove' } | null {
  // 按失败 pillar 推断受影响 section
  if (!validatorOutput.pillars.goal.passed) {
    return { section: '目标', direction: 'improve' }
  }
  if (!validatorOutput.pillars.quality.passed) {
    return { section: '质量标准', direction: 'improve' }
  }
  if (!validatorOutput.pillars.evidence.passed) {
    return { section: '执行流程', direction: 'improve' }
  }
  // 缺失 obligation
  const missingObligations = validatorOutput.obligationChecks.filter(c => !c.found)
  if (missingObligations.length > 0) {
    return { section: 'obligations', direction: 'improve' }
  }
  // 低置信度 → 执行流程需改进
  if (validatorOutput.confidence < 0.6) {
    return { section: '执行流程', direction: 'improve' }
  }
  return null
}

/**
 * 累积信号并判断是否达到阈值。
 * 返回达到阈值的 episode IDs 数组，或 null（未达标）。
 */
function accumulateAndCheck(
  sopId: string,
  episodeId: string,
  section: string,
  direction: 'improve' | 'remove',
): string[] | null {
  const key = buildAccumulatorKey(sopId, section, direction)
  const existing = signalAccumulator.get(key)

  if (existing) {
    // 防止同一 episode 重复累积
    if (!existing.episodes.includes(episodeId)) {
      existing.episodes.push(episodeId)
    }
  } else {
    signalAccumulator.set(key, { section, direction, episodes: [episodeId] })
  }

  const current = signalAccumulator.get(key)!
  if (current.episodes.length >= ACCUMULATION_THRESHOLD) {
    // 达到阈值，取出并清空
    const episodes = [...current.episodes]
    signalAccumulator.delete(key)
    return episodes
  }
  return null
}

// ============================================
// Quarantine (B12)
// ============================================

function getServerUrlCached(): string {
  return localStorage.getItem('duncrew_server_url') || getServerUrl()
}

async function writeQuarantineFile(patchId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const serverUrl = getServerUrlCached()
    const path = `quarantine/${patchId}.json`
    const content = JSON.stringify(payload, null, 2)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    await fetch(`${serverUrl}/api/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'writeFile', args: { path, content } }),
      signal: controller.signal,
    })
    clearTimeout(timer)
  } catch (err) {
    console.warn('[SopPatchGen] quarantine write failed:', err)
  }
}

// ============================================
// Schema Validation (B12)
// ============================================

interface SchemaValidationResult {
  valid: boolean
  reason?: string
}

function validatePatchSchema(parsed: RawPatchProposal): SchemaValidationResult {
  // sectionAnchor 必须在白名单
  if (!isValidSectionAnchor(parsed.sectionAnchor)) {
    return { valid: false, reason: `invalid sectionAnchor: "${parsed.sectionAnchor}", must be one of ${VALID_SECTION_ANCHORS.join('|')}` }
  }
  // operation 必须是合法值
  if (!isValidOperation(parsed.operation)) {
    return { valid: false, reason: `invalid operation: "${parsed.operation}", must be replace|insert_after|delete` }
  }
  // confidence 必须是 0-1 之间的数字
  if (typeof parsed.confidence !== 'number' || isNaN(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 1) {
    return { valid: false, reason: `invalid confidence: ${parsed.confidence}, must be number in [0, 1]` }
  }
  // newContent 对 replace/insert_after 操作必须非空
  const newContent = (parsed.newContent || '').trim()
  if (parsed.operation !== 'delete' && newContent.length === 0) {
    return { valid: false, reason: `missing newContent for non-delete operation "${parsed.operation}"` }
  }
  // delete 操作额外阈值 (B11)
  if (parsed.operation === 'delete' && parsed.confidence < DELETE_CONFIDENCE_THRESHOLD) {
    return { valid: false, reason: `delete operation requires confidence >= ${DELETE_CONFIDENCE_THRESHOLD}, got ${parsed.confidence}` }
  }
  return { valid: true }
}

// ============================================
// Prompt
// ============================================

const PATCH_GENERATOR_SYSTEM_PROMPT = `你是 SOP 演化分析器。基于一次任务执行的 validator 诊断结果，对当前 SOP 提出一条精确的、可定位的修改建议（patch）。

要求：
1. 修改必须落在以下 section 之一（sectionAnchor 字段必须取下列字面值之一）:
   "目标" | "输入要求" | "执行流程" | "质量标准" | "obligations" | "风险处理" | "输出格式"
2. operation 字段必须取: "replace" | "insert_after" | "delete"
3. 若没有有价值的修改建议，返回 {"skip": true}
4. 修改必须直接对应 validator 反馈中的失败原因（如缺失证据、低质量、目标偏离等）

返回严格 JSON，不要 markdown 代码块：
{
  "skip": false,
  "sectionAnchor": "<上述七选一>",
  "operation": "replace | insert_after | delete",
  "newContent": "<新内容；delete 操作可省略或空字符串>",
  "problemPattern": "<一句话描述本次执行暴露的问题模式（≤80字）>",
  "rationale": "<为何这样改，结合 validator 信号（≤120字）>",
  "expectedImprovement": ["<期望指标 1>", "<期望指标 2>"],
  "confidence": <0.0-1.0>
}

或拒绝输出：
{"skip": true, "reason": "<简短理由>"}`

// ============================================
// 工具函数
// ============================================

function safeParseJson<T>(text: string): T | null {
  try {
    let cleaned = text.trim()
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
    // 去除 <think> 块
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    // 取第一个 { ... } 块
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) cleaned = m[0]
    return JSON.parse(cleaned) as T
  } catch {
    return null
  }
}

function generatePatchId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `patch-${ts}-${rand}`
}

interface RawPatchProposal {
  skip?: boolean
  reason?: string
  sectionAnchor?: string
  operation?: string
  newContent?: string
  problemPattern?: string
  rationale?: string
  expectedImprovement?: string[]
  confidence?: number
}

function isValidSectionAnchor(s: unknown): s is typeof VALID_SECTION_ANCHORS[number] {
  return typeof s === 'string' && (VALID_SECTION_ANCHORS as readonly string[]).includes(s)
}

function isValidOperation(s: unknown): s is SopPatchOperation {
  return typeof s === 'string' && VALID_OPERATIONS.includes(s as SopPatchOperation)
}

/** 构建 validator 失败摘要供 LLM 参考 */
function summarizeValidator(v: SopValidatorOutput): string {
  const parts: string[] = []
  parts.push(`overall: passed=${v.passed} confidence=${v.confidence.toFixed(2)}`)
  parts.push(`goal: passed=${v.pillars.goal.passed} (${v.pillars.goal.notes || ''})`)
  parts.push(`quality: passed=${v.pillars.quality.passed} (${v.pillars.quality.notes || ''})`)
  parts.push(`evidence: passed=${v.pillars.evidence.passed} (${v.pillars.evidence.notes || ''})`)
  if (v.obligationChecks.length > 0) {
    const missing = v.obligationChecks.filter(c => !c.found).map(c => c.obligationId)
    if (missing.length > 0) parts.push(`missing_obligations: ${missing.join(', ')}`)
  }
  if (v.reasoning) {
    parts.push(`reasoning: ${v.reasoning.slice(0, MAX_REASONING_CHARS)}`)
  }
  return parts.join('\n')
}

function buildUserPrompt(
  episode: SopEpisode,
  validatorOutput: SopValidatorOutput,
  currentSop: string,
): string {
  const sopSlice = currentSop.slice(0, MAX_SOP_CHARS)
  const outputSlice = (episode.output || '').slice(0, MAX_OUTPUT_CHARS)
  const validatorSummary = summarizeValidator(validatorOutput)
  const toolsUsed = episode.traceStats?.distinctTools?.join(', ') || '无'

  return [
    '## 任务目标',
    episode.goal.slice(0, 500),
    '',
    '## 当前 SOP（节选）',
    sopSlice,
    '',
    '## 实际输出（节选）',
    outputSlice,
    '',
    '## 工具使用',
    toolsUsed,
    '',
    '## Validator 诊断',
    validatorSummary,
    '',
    '请基于以上信息，对 SOP 提出一条精准的修改建议（或 skip）。',
  ].join('\n')
}

// ============================================
// 公开 API
// ============================================

export interface GeneratePatchInput {
  episode: SopEpisode
  validatorOutput: SopValidatorOutput
  currentSop: string
}

/**
 * 生成 SopPatch：基于 episode + validator 信号，调用独立 LLM 产出 section-anchored patch。
 *
 * == 累积策略 ==
 * 每次调用先累积信号（section + direction），只有同一 section 同方向
 * 累积 >= 3 条 episode 信号时才真正触发 LLM 生成。
 * 未达阈值时返回 null，但信号已内部记录。
 *
 * == Schema 校验 ==
 * LLM 返回后做严格 JSON schema 校验，校验失败写入 quarantine 文件并返回 null。
 */
export async function generatePatch(input: GeneratePatchInput): Promise<SopPatch | null> {
  try {
    const { episode, validatorOutput, currentSop } = input

    if (!episode || !validatorOutput || !currentSop) return null
    if (!isLLMConfigured()) {
      console.warn('[SopPatchGen] LLM not configured, skip patch generation')
      return null
    }

    // 仅当存在 validator 失败信号或低置信度时才考虑生成 patch
    const hasFailure =
      !validatorOutput.passed ||
      validatorOutput.confidence < 0.6 ||
      validatorOutput.obligationChecks.some(c => !c.found)
    if (!hasFailure) {
      return null
    }

    // --- B10: 信号累积 ---
    const signal = inferSignal(validatorOutput)
    if (!signal) return null

    const accumulatedEpisodes = accumulateAndCheck(
      episode.sopId,
      episode.episodeId,
      signal.section,
      signal.direction,
    )

    // 未达阈值，返回 null（信号已累积）
    if (!accumulatedEpisodes) {
      console.log(
        `[SopPatchGen] Signal accumulated for ${episode.sopId}::${signal.section}::${signal.direction}, ` +
        `waiting for threshold (${ACCUMULATION_THRESHOLD})`,
      )
      return null
    }

    // --- 达到阈值，触发 LLM 生成 ---
    const messages: SimpleChatMessage[] = [
      { role: 'system', content: PATCH_GENERATOR_SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(episode, validatorOutput, currentSop) },
    ]

    const response = await chatBackground(messages, { priority: 5 })
    if (!response) return null

    const parsed = safeParseJson<RawPatchProposal>(response)
    if (!parsed) {
      const patchId = generatePatchId()
      await writeQuarantineFile(patchId, {
        rawLlmOutput: response,
        failureReason: 'JSON parse failed',
        timestamp: new Date().toISOString(),
        sourceEpisodes: accumulatedEpisodes,
      })
      console.warn('[SopPatchGen] failed to parse LLM response, quarantined as', patchId)
      return null
    }

    if (parsed.skip === true) return null

    // --- B12: 严格 JSON schema 校验 ---
    const schemaResult = validatePatchSchema(parsed)
    if (!schemaResult.valid) {
      const patchId = generatePatchId()
      await writeQuarantineFile(patchId, {
        rawLlmOutput: response,
        parsedProposal: parsed,
        failureReason: schemaResult.reason,
        timestamp: new Date().toISOString(),
        sourceEpisodes: accumulatedEpisodes,
      })
      console.warn(`[SopPatchGen] schema validation failed: ${schemaResult.reason}, quarantined as ${patchId}`)
      return null
    }

    // --- 构建 SopPatch ---
    const problemPattern = (parsed.problemPattern || '').trim()
    const rationale = (parsed.rationale || '').trim()
    if (!problemPattern || !rationale) {
      const patchId = generatePatchId()
      await writeQuarantineFile(patchId, {
        rawLlmOutput: response,
        parsedProposal: parsed,
        failureReason: 'missing problemPattern or rationale',
        timestamp: new Date().toISOString(),
        sourceEpisodes: accumulatedEpisodes,
      })
      console.warn('[SopPatchGen] missing problemPattern or rationale, quarantined as', patchId)
      return null
    }

    const newContent = (parsed.newContent || '').trim()
    const confidence = parsed.confidence as number
    const expectedImprovement = Array.isArray(parsed.expectedImprovement)
      ? parsed.expectedImprovement.filter(s => typeof s === 'string' && s.trim().length > 0).slice(0, 5)
      : []

    const proposedAt = new Date().toISOString()
    const firstEpisodeTs = accumulatedEpisodes.length > 0 ? episode.timestamp : proposedAt

    const patch: SopPatch = {
      patchId: generatePatchId(),
      proposedAt,

      sourceEpisodes: accumulatedEpisodes,
      sourceWindow: { from: firstEpisodeTs, to: proposedAt },

      targetSopId: episode.sopId,
      targetBaseVersion: episode.sopVersion || 'current',

      sectionAnchor: parsed.sectionAnchor as typeof VALID_SECTION_ANCHORS[number],
      operation: parsed.operation as SopPatchOperation,
      newContent: parsed.operation === 'delete' && newContent.length === 0 ? undefined : newContent,

      problemPattern,
      rationale,
      expectedImprovement,

      confidence,
      generatorModel: GENERATOR_MODEL,
      generatorVersion: GENERATOR_VERSION,

      status: 'proposed',
      statusHistory: [
        {
          status: 'proposed',
          at: proposedAt,
          reason: `auto-generated after ${accumulatedEpisodes.length} supporting episodes`,
          by: 'auto',
        },
      ],
    }

    return patch
  } catch (err) {
    console.warn('[SopPatchGen] generatePatch failed:', err)
    return null
  }
}

/** 暴露 signalAccumulator 状态（调试 / 测试用） */
export function getAccumulatorSnapshot(): Map<string, AccumulatedSignal> {
  return new Map(signalAccumulator)
}

/** 清空 signalAccumulator（测试用） */
export function resetAccumulator(): void {
  signalAccumulator.clear()
}
