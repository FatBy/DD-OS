/**
 * Episode Recorder — 记录每次任务执行的 SopEpisode
 *
 * 持久化路径: {dataDir}/episodes/{yyyymm}/{episodeId}.json (顶层月度分片)
 * IO 通过后端 HTTP API (duncrew-server.py) 的 writeFile 工具完成。
 * 失败时 silent fail，不向上抛错。
 *
 * Task #12 改造要点：
 *  - directiveMode 强制 'strict'
 *  - sopId 由 DUN.md 路径 hash 前 12 位生成（非 dunId）
 *  - sopVersion 由 SOP 内容 hash 前 8 位生成
 *  - traceStats.reasoningMarkerCount / artifactCount 从 toolCalls 中检索
 *  - 顶层月度分片路径 episodes/{yyyymm}/{episodeId}.json
 */

import { getServerUrl } from '@/utils/env'
import type {
  SopEpisode,
  SopTraceEvent,
  SopTokenUsage,
  SopTraceStats,
  SopOutputFingerprint,
  SopPromptSnapshot,
} from '@/types'

// ============================================
// Types
// ============================================

export interface RecordEpisodeToolCall {
  name: string
  args: Record<string, unknown>
  result: string
  success: boolean
  /** 可选：标识工具调用的语义类型，例如 'reasoning_marker' / 'artifact' */
  kind?: string
}

export interface RecordEpisodeInput {
  // ---- 基础上下文 ----
  dunId: string
  taskId: string
  userQuery: string
  sopAnchorsHit: string[]
  toolCalls: RecordEpisodeToolCall[]
  outcome: string
  evidenceRefs: string[]
  timestamp: number

  // ---- C9 SOP 注入信号 ----
  sopInjectionTruncated: boolean

  // ---- C3 Shadow 路由信号 ----
  isShadow: boolean
  shadowId?: string

  // ---- C1 / C2 SOP 标识 ----
  sopId: string
  sopVersion: string

  // ---- C4 模型与上下文规模 ----
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number }
  modelId: string
  contextSizeChars: number

  // ---- 可选：注入到 LLM 的完整 prompt 文本，用于 fullPromptHash 计算 ----
  injectedPromptText?: string
}

// ============================================
// Hash & ID helpers
// ============================================

/**
 * djb2 风格简单字符串 hash。返回 hex 字符串（无符号 32-bit）。
 */
export function simpleHash(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i)
    hash = hash & hash // force 32-bit
  }
  // 拼接二次扰动，避免短串碰撞过多 / 长度不足
  let h2 = 0
  for (let i = input.length - 1; i >= 0; i--) {
    h2 = ((h2 << 3) - h2) + input.charCodeAt(i)
    h2 = h2 & h2
  }
  const hex1 = (hash >>> 0).toString(16).padStart(8, '0')
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0')
  return hex1 + hex2
}

/**
 * C1: 用 DUN.md 文件路径 hash 前 12 位作为 sopId
 */
export function computeSopId(dunId: string): string {
  const path = `duns/${dunId}/DUN.md`
  return simpleHash(path).slice(0, 12)
}

/**
 * C2: 用 SOP 内容 hash 前 8 位作为 sopVersion
 */
export function computeSopVersion(sopContent: string): string {
  return simpleHash(sopContent).slice(0, 8)
}

/**
 * 生成 4 位 hex 随机串
 */
function rand4Hex(): string {
  return Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0')
}

/**
 * 生成 yyyymm 月份字符串
 */
function formatYyyymm(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  return `${y}${m}`
}

// ============================================
// IO
// ============================================

function getServerUrlCached(): string {
  return localStorage.getItem('duncrew_server_url') || getServerUrl()
}

async function writeFileToDisk(path: string, content: string): Promise<boolean> {
  try {
    const serverUrl = getServerUrlCached()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(`${serverUrl}/api/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'writeFile', args: { path, content } }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return false
    const data = await res.json()
    return data.status !== 'error'
  } catch {
    return false
  }
}

// ============================================
// Builders
// ============================================

function buildTraceEvents(toolCalls: RecordEpisodeToolCall[]): SopTraceEvent[] {
  const events: SopTraceEvent[] = []
  for (const tc of toolCalls) {
    events.push({
      ts: new Date().toISOString(),
      kind: 'tool_call',
      payload: { name: tc.name, args: tc.args, kind: tc.kind },
    })
    events.push({
      ts: new Date().toISOString(),
      kind: 'tool_result',
      payload: {
        name: tc.name,
        success: tc.success,
        resultPreview: (tc.result || '').slice(0, 200),
      },
    })
  }
  return events
}

/**
 * C5: reasoningMarkerCount / artifactCount 从 toolCalls 中识别
 *  - 优先匹配 tc.kind === 'reasoning_marker' / 'artifact'
 *  - 兼容匹配 tc.name 包含 'reasoning_marker' / 'artifact'
 */
function buildTraceStats(toolCalls: RecordEpisodeToolCall[]): SopTraceStats {
  const distinctTools = [...new Set(toolCalls.map((tc) => tc.name))]
  let reasoningMarkerCount = 0
  let artifactCount = 0
  for (const tc of toolCalls) {
    const kind = (tc.kind || '').toLowerCase()
    const name = (tc.name || '').toLowerCase()
    if (kind === 'reasoning_marker' || name.includes('reasoning_marker')) {
      reasoningMarkerCount++
    }
    if (kind === 'artifact' || name === 'artifact' || name.endsWith('_artifact')) {
      artifactCount++
    }
  }
  return {
    toolCallCount: toolCalls.length,
    distinctTools,
    toolFailures: toolCalls.filter((tc) => !tc.success).length,
    artifactCount,
    reasoningMarkerCount,
  }
}

function buildOutputFingerprint(outcome: string): SopOutputFingerprint {
  return {
    contentHash: `djb2-${simpleHash(outcome).slice(0, 12)}`,
    hallucinationFlags: [],
    structuralSignature: outcome.length > 500 ? 'long_form' : 'short_form',
  }
}

function buildPromptSnapshot(input: RecordEpisodeInput): SopPromptSnapshot {
  // C4: fullPromptHash —— 优先使用 injectedPromptText；
  // 缺失时退化为 sopAnchorsHit 拼接（仍是非空 hash）
  const promptText =
    input.injectedPromptText && input.injectedPromptText.length > 0
      ? input.injectedPromptText
      : input.sopAnchorsHit.join('\n')
  const fullPromptHash = `djb2-${simpleHash(promptText)}`

  return {
    fullPromptHash,
    sopSectionInjected: input.sopAnchorsHit.join(', '),
    sopInjectionTruncated: input.sopInjectionTruncated,
    truncationLayer: input.sopInjectionTruncated ? 'localclaw_partition' : null,
    contextSizeChars: input.contextSizeChars,
    // A1: 强制 strict
    directiveMode: 'strict',
  }
}

// ============================================
// Public API
// ============================================

/**
 * 记录一次执行 episode 并持久化到磁盘
 * 失败时 silent fail (console.warn)，不向上抛错
 */
export async function recordEpisode(input: RecordEpisodeInput): Promise<SopEpisode | null> {
  try {
    const {
      dunId,
      taskId,
      userQuery,
      toolCalls,
      outcome,
      evidenceRefs,
      timestamp,
      isShadow,
      shadowId,
      sopId,
      sopVersion,
      tokenUsage,
      modelId,
    } = input

    // episodeId 格式: ep-{dunId}-{timestamp}-{random4hex}
    const episodeId = `ep-${dunId}-${timestamp}-${rand4Hex()}`
    const yyyymm = formatYyyymm(timestamp)
    const durationMs = Math.max(0, Date.now() - timestamp)

    const tokenUsageNormalized: SopTokenUsage = {
      promptTokens: tokenUsage.promptTokens,
      completionTokens: tokenUsage.completionTokens,
      totalTokens: tokenUsage.totalTokens,
    }

    const episode: SopEpisode = {
      episodeId,
      timestamp: new Date(timestamp).toISOString(),
      sessionId: taskId,

      goal: userQuery,
      goalSlice: userQuery.slice(0, 200),

      // C1 / C2 / C3
      sopId,
      sopVersion,
      isShadow,
      ...(shadowId ? { shadowId } : {}),

      promptSnapshot: buildPromptSnapshot(input),

      trace: buildTraceEvents(toolCalls),
      output: outcome,
      durationMs,

      // C4
      modelId,
      tokenUsage: tokenUsageNormalized,

      // C5
      traceStats: buildTraceStats(toolCalls),
      outputFingerprint: buildOutputFingerprint(outcome),
    }

    // A10: 顶层月度分片路径 episodes/{yyyymm}/{episodeId}.json
    // 后端 writeFile 自动创建父目录
    const filePath = `episodes/${yyyymm}/${episodeId}.json`
    const written = await writeFileToDisk(filePath, JSON.stringify(episode, null, 2))

    if (!written) {
      console.warn(`[EpisodeRecorder] Failed to write episode to ${filePath}`)
    }

    // 额外写入 evidenceRefs（沿用同一目录，便于聚合）
    if (evidenceRefs.length > 0) {
      const metaPath = `episodes/${yyyymm}/${episodeId}.meta.json`
      await writeFileToDisk(metaPath, JSON.stringify({ evidenceRefs }, null, 2))
    }

    return episode
  } catch (err) {
    console.warn('[EpisodeRecorder] recordEpisode failed silently:', err)
    return null
  }
}
