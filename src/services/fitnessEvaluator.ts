/**
 * Fitness Evaluator — SOP Shadow 适应度评估
 *
 * 职责：
 * - 读取最近 N 条 episodes，按 isShadow 分组
 * - 按 slice (taskSlice / userQuery 前 20 字符 / goalSlice) 拆分独立比较
 * - Welch's t-test + 临界值查表 (df=5,10,15,20,30,40,60,120,Inf 对应 p=0.05) 做显著性判定
 * - 全局决策：无任何 slice base_wins 且 >=1 个 slice shadow_wins → promote
 * - Promote 安全机制：版本备份 + PatchEvaluationResult 回填 + Auto-rollback
 *
 * IO 通过后端 HTTP API (duncrew-server.py) 完成。
 */

import { getServerUrl } from '@/utils/env'
import type { SopEpisode, SopPatchEvaluationResult } from '@/types'

// ============================================
// Constants
// ============================================

/** 评估时拉取的最大 episode 数量 */
const MAX_EPISODES_TO_EVALUATE = 60

/** 每组最少样本数（shadow / main 各自） */
const MIN_SAMPLE_SIZE_PER_GROUP = 20

/** Promote 后检测 rollback 的窗口大小 */
const ROLLBACK_WINDOW_SIZE = 3

/** Rollback 阈值：confidence 连续下降超过此值 */
const ROLLBACK_DECLINE_THRESHOLD = 0.2

/** 显著性水平 */
const SIGNIFICANCE_LEVEL = 0.05

// ============================================
// IO Helpers
// ============================================

function getServerUrlCached(): string {
  return localStorage.getItem('duncrew_server_url') || getServerUrl()
}

async function readFileFromDisk(path: string): Promise<string | null> {
  try {
    const serverUrl = getServerUrlCached()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(`${serverUrl}/api/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'readFile', args: { path } }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json()
    return data.status === 'error' ? null : (data.result ?? null)
  } catch {
    return null
  }
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

async function listDirectory(path: string): Promise<string[]> {
  try {
    const serverUrl = getServerUrlCached()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(`${serverUrl}/api/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'listDir', args: { path } }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return []
    const data = await res.json()
    if (data.status === 'error') return []
    if (typeof data.result === 'string') {
      try {
        return JSON.parse(data.result)
      } catch {
        return data.result.split('\n').filter((l: string) => l.trim())
      }
    }
    return Array.isArray(data.result) ? data.result : []
  } catch {
    return []
  }
}

// ============================================
// Types
// ============================================

export type SliceVerdict = 'shadow_wins' | 'base_wins' | 'no_signal' | 'inconclusive'

export interface SliceComparison {
  slice: string
  shadowScores: number[]
  mainScores: number[]
  verdict: SliceVerdict
  pValue?: number
}

export interface EvaluationMetrics {
  shadowScore: number
  mainScore: number
  sampleSize: number
  significant: boolean
  sliceComparisons: SliceComparison[]
}

export interface EvaluationResult {
  winner: 'shadow' | 'main' | 'inconclusive'
  metrics: EvaluationMetrics
}

interface ActiveShadowManifest {
  shadowId: string
  baseSopId: string
  baseVersion: string
  createdAt: string
  status: string
  appliedPatches: string[]
  routing: {
    sliceFilter?: string[]
    trafficShare: number
    minEpisodesBeforeDecision: number
    maxAgeDays: number
  }
}

// ============================================
// Welch's t-test (pure TS, critical-value lookup)
// ============================================

/** 双侧 p=0.05 对应的 t 临界值表 (df → tCrit) */
const T_CRITICAL_TABLE_P05: Array<{ df: number; tCrit: number }> = [
  { df: 5, tCrit: 2.571 },
  { df: 10, tCrit: 2.228 },
  { df: 15, tCrit: 2.131 },
  { df: 20, tCrit: 2.086 },
  { df: 30, tCrit: 2.042 },
  { df: 40, tCrit: 2.021 },
  { df: 60, tCrit: 2.000 },
  { df: 120, tCrit: 1.980 },
  { df: Infinity, tCrit: 1.960 },
]

/**
 * 给定 df，查表得到 p=0.05 双侧临界值。表内不存在的 df 用线性插值。
 * df < 5 时按 5 处理；df >= 120 时向 1.960 (Inf) 渐近。
 */
function getCriticalT(df: number): number {
  if (!isFinite(df) || df <= 0) return T_CRITICAL_TABLE_P05[T_CRITICAL_TABLE_P05.length - 1].tCrit
  if (df <= T_CRITICAL_TABLE_P05[0].df) return T_CRITICAL_TABLE_P05[0].tCrit

  for (let i = 0; i < T_CRITICAL_TABLE_P05.length - 1; i++) {
    const cur = T_CRITICAL_TABLE_P05[i]
    const next = T_CRITICAL_TABLE_P05[i + 1]
    if (df >= cur.df && df <= next.df) {
      if (!isFinite(next.df)) {
        // df 落在 [120, Inf)：用衰减比例，超过 1000 直接取渐近值
        if (df >= 1000) return next.tCrit
        const ratio = (df - cur.df) / (1000 - cur.df)
        return cur.tCrit + Math.min(1, ratio) * (next.tCrit - cur.tCrit)
      }
      const ratio = (df - cur.df) / (next.df - cur.df)
      return cur.tCrit + ratio * (next.tCrit - cur.tCrit)
    }
  }
  return 1.96
}

/**
 * 仅用 p=0.05 临界值估计 p-value：
 * - |t| >= tCrit → 返回 < 0.05 的近似值（按 |t|/tCrit 比值给出 0.04 / 0.01 / 0.001 三档）
 * - 否则 → 返回 [0.05, 0.5] 之间的近似值，便于上层观察
 *
 * 该函数的目标是“是否显著”决策，p-value 仅作可读性记录。
 */
function estimatePValue(tStat: number, df: number): number {
  const absT = Math.abs(tStat)
  if (!isFinite(absT)) return 0
  const tCrit = getCriticalT(df)
  if (tCrit <= 0) return 1
  if (absT >= tCrit) {
    const ratio = absT / tCrit
    if (ratio >= 2.0) return 0.001
    if (ratio >= 1.5) return 0.01
    return 0.04
  }
  return Math.min(0.5, 0.05 + (1 - absT / tCrit) * 0.45)
}

/** Welch's t-test: 检验两组独立样本均值是否存在显著差异 */
export function welchTTest(
  g1: number[],
  g2: number[],
): { tStat: number; pValue: number; df: number } {
  const n1 = g1.length
  const n2 = g2.length
  if (n1 < 2 || n2 < 2) return { tStat: 0, pValue: 1, df: 0 }

  const mean1 = g1.reduce((a, b) => a + b, 0) / n1
  const mean2 = g2.reduce((a, b) => a + b, 0) / n2

  const var1 = g1.reduce((acc, v) => acc + (v - mean1) ** 2, 0) / (n1 - 1)
  const var2 = g2.reduce((acc, v) => acc + (v - mean2) ** 2, 0) / (n2 - 1)

  if (var1 === 0 && var2 === 0) {
    if (mean1 === mean2) return { tStat: 0, pValue: 1, df: n1 + n2 - 2 }
    return { tStat: mean1 > mean2 ? 1e9 : -1e9, pValue: 0, df: n1 + n2 - 2 }
  }

  const se1 = var1 / n1
  const se2 = var2 / n2
  const seDiff = Math.sqrt(se1 + se2)
  const tStat = (mean1 - mean2) / seDiff
  const df = (se1 + se2) ** 2 / (se1 ** 2 / (n1 - 1) + se2 ** 2 / (n2 - 1))
  const pValue = estimatePValue(tStat, df)
  return { tStat, pValue, df }
}

// ============================================
// Episode helpers
// ============================================

async function loadRecentEpisodes(dunId: string, maxCount: number): Promise<SopEpisode[]> {
  const episodesDir = `duns/${dunId}/episodes`
  const files = await listDirectory(episodesDir)

  const episodeFiles = files
    .filter(f => f.endsWith('.json') && !f.endsWith('.meta.json'))
    .sort()
    .slice(-maxCount)

  const episodes: SopEpisode[] = []
  for (const file of episodeFiles) {
    const filePath = file.startsWith('duns/') ? file : `${episodesDir}/${file}`
    const raw = await readFileFromDisk(filePath)
    if (raw) {
      try {
        episodes.push(JSON.parse(raw) as SopEpisode)
      } catch {
        // skip malformed
      }
    }
  }
  return episodes
}

function getConfidence(ep: SopEpisode): number | null {
  return ep.validation?.confidence ?? null
}

/**
 * Slice key 获取顺序：taskSlice → userQuery 前 20 字符 → goalSlice → 'default'
 * （taskSlice / userQuery 不在 SopEpisode 类型上，但实际存档中可能存在，故用宽松取值）
 */
function getSlice(ep: SopEpisode): string {
  const anyEp = ep as unknown as { taskSlice?: string; userQuery?: string }
  if (anyEp.taskSlice && typeof anyEp.taskSlice === 'string') return anyEp.taskSlice
  if (anyEp.userQuery && typeof anyEp.userQuery === 'string') {
    return anyEp.userQuery.slice(0, 20) || 'default'
  }
  if (ep.goalSlice) return ep.goalSlice
  return 'default'
}

function groupBySlice(episodes: SopEpisode[]): Record<string, SopEpisode[]> {
  const groups: Record<string, SopEpisode[]> = {}
  for (const ep of episodes) {
    const slice = getSlice(ep)
    if (!groups[slice]) groups[slice] = []
    groups[slice].push(ep)
  }
  return groups
}

/** 单 slice 上执行 Welch's t-test 并产出 verdict */
function evaluateSlice(slice: string, shadowEps: SopEpisode[], mainEps: SopEpisode[]): SliceComparison {
  const shadowScores = shadowEps.map(getConfidence).filter((v): v is number => v !== null)
  const mainScores = mainEps.map(getConfidence).filter((v): v is number => v !== null)

  // 每组 < 20 → no_signal
  if (
    shadowScores.length < MIN_SAMPLE_SIZE_PER_GROUP ||
    mainScores.length < MIN_SAMPLE_SIZE_PER_GROUP
  ) {
    return { slice, shadowScores, mainScores, verdict: 'no_signal' }
  }

  const { pValue } = welchTTest(shadowScores, mainScores)
  const shadowMean = shadowScores.reduce((a, b) => a + b, 0) / shadowScores.length
  const mainMean = mainScores.reduce((a, b) => a + b, 0) / mainScores.length

  let verdict: SliceVerdict
  if (pValue < SIGNIFICANCE_LEVEL) {
    verdict = shadowMean > mainMean ? 'shadow_wins' : 'base_wins'
  } else {
    verdict = 'inconclusive'
  }

  return { slice, shadowScores, mainScores, verdict, pValue }
}

// ============================================
// Public API
// ============================================

/**
 * 评估指定 shadow 的适应度
 *
 * 流程：
 * 1. 读取最近 N 条 episodes，按 isShadow 分组
 * 2. 按 slice 拆分，每个 slice 独立 Welch's t-test
 * 3. 全局决策：无任何 slice base_wins 且 >=1 个 slice shadow_wins → promote
 * 4. shadow 胜出 → 备份旧版 + 写回 + PatchEvaluationResult
 */
export async function evaluateShadow(
  shadowId: string,
  dunId: string,
): Promise<EvaluationResult> {
  const episodes = await loadRecentEpisodes(dunId, MAX_EPISODES_TO_EVALUATE)

  const shadowEpisodes = episodes.filter(ep => ep.isShadow && ep.shadowId === shadowId)
  const mainEpisodes = episodes.filter(ep => !ep.isShadow)

  const shadowBySlice = groupBySlice(shadowEpisodes)
  const mainBySlice = groupBySlice(mainEpisodes)

  const sliceSet: Record<string, true> = {}
  for (const k of Object.keys(shadowBySlice)) sliceSet[k] = true
  for (const k of Object.keys(mainBySlice)) sliceSet[k] = true
  const allSlices = Object.keys(sliceSet)

  const sliceComparisons: SliceComparison[] = []
  for (const slice of allSlices) {
    sliceComparisons.push(
      evaluateSlice(slice, shadowBySlice[slice] || [], mainBySlice[slice] || []),
    )
  }

  const hasBaseWins = sliceComparisons.some(c => c.verdict === 'base_wins')
  const hasShadowWins = sliceComparisons.some(c => c.verdict === 'shadow_wins')
  const allNoSignal = sliceComparisons.length === 0 || sliceComparisons.every(c => c.verdict === 'no_signal')

  let winner: 'shadow' | 'main' | 'inconclusive'
  if (allNoSignal) {
    winner = 'inconclusive'
  } else if (!hasBaseWins && hasShadowWins) {
    winner = 'shadow'
  } else if (hasBaseWins && !hasShadowWins) {
    winner = 'main'
  } else {
    winner = 'inconclusive'
  }

  // 汇总分数
  const allShadowScores = shadowEpisodes.map(getConfidence).filter((v): v is number => v !== null)
  const allMainScores = mainEpisodes.map(getConfidence).filter((v): v is number => v !== null)
  const shadowScore = allShadowScores.length > 0
    ? allShadowScores.reduce((a, b) => a + b, 0) / allShadowScores.length
    : 0
  const mainScore = allMainScores.length > 0
    ? allMainScores.reduce((a, b) => a + b, 0) / allMainScores.length
    : 0

  const metrics: EvaluationMetrics = {
    shadowScore,
    mainScore,
    sampleSize: shadowEpisodes.length + mainEpisodes.length,
    significant: winner === 'shadow' || winner === 'main',
    sliceComparisons,
  }

  if (winner === 'shadow') {
    await promoteShadow(dunId, shadowId, shadowScore, mainScore, sliceComparisons)
  } else if (winner === 'main') {
    await archiveShadowById(dunId, shadowId)
  }

  console.log(
    `[FitnessEvaluator] Shadow ${shadowId} evaluation: winner=${winner}, ` +
    `shadowScore=${shadowScore.toFixed(3)}, mainScore=${mainScore.toFixed(3)}, ` +
    `samples=${shadowEpisodes.length}/${mainEpisodes.length}, slices=${sliceComparisons.length}`,
  )

  return { winner, metrics }
}

/** 扫描 active shadow 并触发评估 */
export async function evaluatePendingShadows(dunId: string): Promise<void> {
  const activePath = `duns/${dunId}/sop_shadows/active.json`
  const raw = await readFileFromDisk(activePath)
  if (!raw) return

  let manifest: ActiveShadowManifest
  try {
    manifest = JSON.parse(raw)
  } catch {
    return
  }

  if (manifest.status !== 'active') return
  await evaluateShadow(manifest.shadowId, dunId)
}

// ============================================
// Promotion / Archive / Rollback
// ============================================

/**
 * 将 shadow SOP 升正：
 * 1. 备份旧 DUN.md → versions/{sopVersion}.md
 * 2. shadow 内容写回 DUN.md
 * 3. active.json status = 'promoted'
 * 4. 回填 PatchEvaluationResult 到 patches/{patchId}.json
 */
async function promoteShadow(
  dunId: string,
  shadowId: string,
  shadowAvg: number,
  mainAvg: number,
  sliceComparisons: SliceComparison[],
): Promise<void> {
  const dunMdPath = `duns/${dunId}/DUN.md`
  const activePath = `duns/${dunId}/sop_shadows/active.json`

  // Step 1: 读取 active manifest 取 baseVersion
  const manifestRaw = await readFileFromDisk(activePath)
  let manifest: ActiveShadowManifest | null = null
  let sopVersion = 'unknown'
  if (manifestRaw) {
    try {
      manifest = JSON.parse(manifestRaw) as ActiveShadowManifest
      sopVersion = manifest.baseVersion || 'unknown'
    } catch {
      // ignore
    }
  }

  // Step 2: 备份旧 DUN.md
  const oldContent = await readFileFromDisk(dunMdPath)
  if (oldContent) {
    const backupPath = `duns/${dunId}/versions/${sopVersion}.md`
    await writeFileToDisk(backupPath, oldContent)
    console.log(`[FitnessEvaluator] Backed up DUN.md to ${backupPath}`)
  }

  // Step 3: 把 shadow SOP 写回 DUN.md
  const shadowSopPath = `duns/${dunId}/sop_shadows/${shadowId}/sop.md`
  const shadowContent = await readFileFromDisk(shadowSopPath)
  if (shadowContent) {
    await writeFileToDisk(dunMdPath, shadowContent)
    console.log(`[FitnessEvaluator] Shadow ${shadowId} promoted: content merged to DUN.md`)
  }

  // Step 4: 更新 active.json status
  if (manifest) {
    manifest.status = 'promoted'
    await writeFileToDisk(activePath, JSON.stringify(manifest, null, 2))
  }

  // Step 5: 回填 PatchEvaluationResult
  await writePatchEvaluationResult(dunId, manifest, shadowAvg, mainAvg, sliceComparisons)
}

/** 写入 PatchEvaluationResult 到 patches/{patchId}.json (C7) */
async function writePatchEvaluationResult(
  dunId: string,
  manifest: ActiveShadowManifest | null,
  shadowAvg: number,
  mainAvg: number,
  sliceComparisons: SliceComparison[],
): Promise<void> {
  if (!manifest || !manifest.appliedPatches?.length) return

  const now = new Date().toISOString()
  const delta = shadowAvg - mainAvg
  const significantSlices = sliceComparisons.filter(s => s.verdict === 'shadow_wins').length
  const verdict: SopPatchEvaluationResult['verdict'] =
    delta >= 0.1 ? 'exceeded' : delta > 0 ? 'as_expected' : 'underperformed'

  for (const patchId of manifest.appliedPatches) {
    const patchPath = `duns/${dunId}/patches/${patchId}.json`
    const patchRaw = await readFileFromDisk(patchPath)
    if (!patchRaw) continue

    try {
      const patch = JSON.parse(patchRaw)
      const evaluationResult: SopPatchEvaluationResult = {
        promotedAt: now,
        postPromotionWindow: { from: now, to: '' },
        expectedImprovement: Array.isArray(patch.expectedImprovement) ? patch.expectedImprovement : [],
        actualImprovement: {
          obligationFulfillmentDelta: delta,
          validatorPassRateDelta: delta,
          userPositiveRateDelta: 0,
          unexpectedRegressions: [],
        },
        verdict,
        shouldRollback: false,
        reviewNote: `auto-promoted by fitnessEvaluator; significantSlices=${significantSlices}/${sliceComparisons.length}`,
      }

      patch.evaluationResult = evaluationResult
      patch.status = 'promoted'
      await writeFileToDisk(patchPath, JSON.stringify(patch, null, 2))
      console.log(`[FitnessEvaluator] Wrote evaluationResult to patch ${patchId}`)
    } catch {
      // skip malformed patch
    }
  }
}

/** 归档 shadow（main 胜出/无定论） */
async function archiveShadowById(dunId: string, shadowId: string): Promise<void> {
  const activePath = `duns/${dunId}/sop_shadows/active.json`
  const raw = await readFileFromDisk(activePath)
  if (!raw) return

  try {
    const manifest = JSON.parse(raw) as ActiveShadowManifest
    if (manifest.shadowId === shadowId) {
      manifest.status = 'expired'
      await writeFileToDisk(activePath, JSON.stringify(manifest, null, 2))
      console.log(`[FitnessEvaluator] Shadow ${shadowId} archived`)
    }
  } catch {
    // silent
  }
}

/**
 * 检查 promote 后是否需要 rollback
 *
 * 逻辑：promote 后最近 ROLLBACK_WINDOW_SIZE 条 main episode confidence 对比
 *      之前的 main baseline，如果连续下降 > ROLLBACK_DECLINE_THRESHOLD 则触发 rollback。
 */
export async function checkRollbackNeeded(dunId: string): Promise<boolean> {
  const activePath = `duns/${dunId}/sop_shadows/active.json`
  const manifestRaw = await readFileFromDisk(activePath)
  if (!manifestRaw) return false

  let manifest: ActiveShadowManifest
  try {
    manifest = JSON.parse(manifestRaw) as ActiveShadowManifest
  } catch {
    return false
  }
  if (manifest.status !== 'promoted') return false

  const sopVersion = manifest.baseVersion || 'unknown'

  const episodes = await loadRecentEpisodes(dunId, MAX_EPISODES_TO_EVALUATE)
  const mainEps = episodes.filter(ep => !ep.isShadow)

  const recentMain = mainEps.slice(-ROLLBACK_WINDOW_SIZE)
  if (recentMain.length < ROLLBACK_WINDOW_SIZE) return false

  const olderMain = mainEps.slice(0, -ROLLBACK_WINDOW_SIZE)
  const olderScores = olderMain.map(getConfidence).filter((v): v is number => v !== null)
  if (olderScores.length === 0) return false
  const baselineAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length

  const recentScores = recentMain.map(getConfidence).filter((v): v is number => v !== null)
  if (recentScores.length < ROLLBACK_WINDOW_SIZE) return false

  // 必须“连续”下降才算
  const monotonicDecline = recentScores.every((v, i, arr) => i === 0 || v <= arr[i - 1])
  const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length
  const decline = baselineAvg - recentAvg

  if (monotonicDecline && decline > ROLLBACK_DECLINE_THRESHOLD) {
    console.log(
      `[FitnessEvaluator] Rollback triggered for ${dunId}: ` +
      `decline=${decline.toFixed(3)} > threshold=${ROLLBACK_DECLINE_THRESHOLD}`,
    )
    await executeRollback(dunId, sopVersion, manifest)
    return true
  }
  return false
}

/** 执行 rollback：versions/{sopVersion}.md 写回 DUN.md，同步 active.json + patch 状态 */
async function executeRollback(
  dunId: string,
  sopVersion: string,
  manifest: ActiveShadowManifest,
): Promise<void> {
  const backupPath = `duns/${dunId}/versions/${sopVersion}.md`
  const backupContent = await readFileFromDisk(backupPath)
  if (backupContent) {
    const dunMdPath = `duns/${dunId}/DUN.md`
    await writeFileToDisk(dunMdPath, backupContent)
    console.log(`[FitnessEvaluator] Rolled back DUN.md from ${backupPath}`)
  }

  const activePath = `duns/${dunId}/sop_shadows/active.json`
  manifest.status = 'rolled_back'
  await writeFileToDisk(activePath, JSON.stringify(manifest, null, 2))

  if (manifest.appliedPatches?.length) {
    for (const patchId of manifest.appliedPatches) {
      const patchPath = `duns/${dunId}/patches/${patchId}.json`
      const patchRaw = await readFileFromDisk(patchPath)
      if (!patchRaw) continue
      try {
        const patch = JSON.parse(patchRaw)
        if (patch.evaluationResult) {
          patch.evaluationResult.shouldRollback = true
          patch.evaluationResult.verdict = 'regressed'
        }
        patch.status = 'rejected'
        await writeFileToDisk(patchPath, JSON.stringify(patch, null, 2))
      } catch {
        // skip
      }
    }
  }
}
