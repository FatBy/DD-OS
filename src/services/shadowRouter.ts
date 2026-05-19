/**
 * Shadow Router — SOP Shadow A/B 路由（Pool 并发版）
 *
 * 职责：
 * - 管理 ShadowSOP Pool（最多 3 个并行 active shadow）
 * - 按加权概率路由到 shadow 版本
 * - 14 天退化策略 + 50% 样本延期策略
 * - 锚点严格校验：anchor 找不到时拒绝创建
 * - 向后兼容旧 active.json 单对象格式
 *
 * IO 通过后端 HTTP API (duncrew-server.py) 的 readFile/writeFile 工具完成。
 */

import { getServerUrl } from '@/utils/env'
import type { SopPatch, SopShadowStatus } from '@/types'

// ============================================
// Constants
// ============================================

/** Shadow 流量比例 (0-1)，默认 10% */
const SHADOW_TRAFFIC_SHARE = 0.1

/** Shadow 最大存活天数，超过后自动归档 */
const SHADOW_MAX_AGE_DAYS = 14

/** Pool 最大并发 active shadow 数 */
const SHADOW_MAX_ACTIVE = 3

/** 最少样本数（用于统计判断） */
const MIN_SAMPLE_EPISODES = 20

/** 延期天数（当样本达到 50% 时允许延期一次） */
const EXTENSION_DAYS = 7

// ============================================
// Types
// ============================================

interface ShadowPoolEntry {
  shadowId: string
  patchId: string
  createdAt: number
  status: SopShadowStatus
  trafficShare: number
  expiresAt: number
  extendedOnce?: boolean
  episodeCount?: number
}

interface ShadowPool {
  shadows: ShadowPoolEntry[]
  maxActive: number
  waitQueue: string[]
}

/** applyPatchToSop 结果类型 */
type PatchApplyResult =
  | { success: true; result: string }
  | { success: false; error: 'invalid_anchor'; anchor: string }

/** 旧版 active.json 单对象格式（用于迁移） */
interface LegacyActiveShadowManifest {
  shadowId: string
  baseSopId: string
  baseVersion: string
  createdAt: string
  status: SopShadowStatus
  appliedPatches: string[]
  routing: {
    sliceFilter?: string[]
    trafficShare: number
    minEpisodesBeforeDecision: number
    maxAgeDays: number
  }
}

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

// ============================================
// Path & Pool Helpers
// ============================================

function shadowBasePath(dunId: string): string {
  return `duns/${dunId}/sop_shadows`
}

function poolFilePath(dunId: string): string {
  return `${shadowBasePath(dunId)}/active_pool.json`
}

function legacyActivePath(dunId: string): string {
  return `${shadowBasePath(dunId)}/active.json`
}

function createEmptyPool(): ShadowPool {
  return { shadows: [], maxActive: SHADOW_MAX_ACTIVE, waitQueue: [] }
}

/**
 * 从旧版 active.json 迁移为 pool 格式
 */
function migrateLegacyToPool(legacy: LegacyActiveShadowManifest): ShadowPool {
  const createdAtMs = new Date(legacy.createdAt).getTime()
  const entry: ShadowPoolEntry = {
    shadowId: legacy.shadowId,
    patchId: legacy.appliedPatches[0] || 'unknown',
    createdAt: createdAtMs,
    status: legacy.status,
    trafficShare: legacy.routing.trafficShare ?? SHADOW_TRAFFIC_SHARE,
    expiresAt: createdAtMs + SHADOW_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
    extendedOnce: false,
  }
  return {
    shadows: [entry],
    maxActive: SHADOW_MAX_ACTIVE,
    waitQueue: [],
  }
}

/**
 * 读取 Shadow Pool（自动迁移旧格式）
 */
async function readPool(dunId: string): Promise<ShadowPool | null> {
  // 优先读 active_pool.json
  const poolRaw = await readFileFromDisk(poolFilePath(dunId))
  if (poolRaw) {
    try {
      return JSON.parse(poolRaw) as ShadowPool
    } catch {
      return null
    }
  }

  // 尝试读旧版 active.json 并迁移
  const legacyRaw = await readFileFromDisk(legacyActivePath(dunId))
  if (legacyRaw) {
    try {
      const legacy = JSON.parse(legacyRaw) as LegacyActiveShadowManifest
      // 确认是旧格式（有 shadowId 字段而非 shadows 数组）
      if (legacy.shadowId && !('shadows' in legacy)) {
        const pool = migrateLegacyToPool(legacy)
        // 写回新格式
        await writeFileToDisk(poolFilePath(dunId), JSON.stringify(pool, null, 2))
        console.log(`[ShadowRouter] Migrated legacy active.json → active_pool.json for dun=${dunId}`)
        return pool
      }
    } catch {
      return null
    }
  }

  return null
}

/**
 * 写入 Shadow Pool
 */
async function writePool(dunId: string, pool: ShadowPool): Promise<boolean> {
  return await writeFileToDisk(poolFilePath(dunId), JSON.stringify(pool, null, 2))
}

/**
 * 读取 main SOP 内容
 */
async function readMainSop(dunId: string): Promise<string | null> {
  return await readFileFromDisk(`duns/${dunId}/DUN.md`)
}

/**
 * 读取 shadow SOP 内容
 */
async function readShadowSop(dunId: string, shadowId: string): Promise<string | null> {
  const path = `${shadowBasePath(dunId)}/${shadowId}/sop.md`
  return await readFileFromDisk(path)
}

/**
 * 判断 shadow 是否已过期
 */
function isShadowExpired(entry: ShadowPoolEntry): boolean {
  return Date.now() > entry.expiresAt
}

/**
 * D3 - 50% 延期策略
 * 到期时检查样本量：>= 50% MIN_SAMPLE 且未延期过 → 延期 7 天
 */
function tryExtendShadow(entry: ShadowPoolEntry): boolean {
  if (entry.extendedOnce) return false
  const episodeCount = entry.episodeCount ?? 0
  const threshold = Math.floor(MIN_SAMPLE_EPISODES * 0.5) // 10
  if (episodeCount >= threshold) {
    entry.expiresAt += EXTENSION_DAYS * 24 * 60 * 60 * 1000
    entry.extendedOnce = true
    console.log(`[ShadowRouter] Shadow ${entry.shadowId} extended by ${EXTENSION_DAYS} days (episodes=${episodeCount})`)
    return true
  }
  return false
}

/**
 * 处理 pool 中过期 shadow 的归档与延期
 * 返回是否有变更需要写回
 */
function processExpirations(pool: ShadowPool): boolean {
  let changed = false
  for (const entry of pool.shadows) {
    if (entry.status !== 'active') continue
    if (!isShadowExpired(entry)) continue

    // 尝试延期
    if (tryExtendShadow(entry)) {
      changed = true
      continue
    }

    // 无法延期，标为 expired
    entry.status = 'expired'
    changed = true
    console.log(`[ShadowRouter] Shadow ${entry.shadowId} expired (episodes=${entry.episodeCount ?? 0})`)
  }

  // 如果有 active 位置空出，从 waitQueue 提升
  if (changed) {
    promoteFromWaitQueue(pool)
  }
  return changed
}

/**
 * 从 waitQueue 中提升 shadow 进入 active
 */
function promoteFromWaitQueue(pool: ShadowPool): void {
  const activeCount = pool.shadows.filter(s => s.status === 'active').length
  while (activeCount < pool.maxActive && pool.waitQueue.length > 0) {
    const nextPatchId = pool.waitQueue.shift()!
    // waitQueue 中的条目需要外部再调用 createShadowSop
    // 这里仅记录日志，实际创建由上游触发
    console.log(`[ShadowRouter] PatchId ${nextPatchId} promoted from waitQueue (implementation pending)`)
    break // 避免无限循环，因为 activeCount 不会在本次循环内更新
  }
}

/**
 * 加权随机选择一个 active shadow
 */
function weightedSelectShadow(activeShadows: ShadowPoolEntry[]): ShadowPoolEntry | null {
  if (activeShadows.length === 0) return null

  const totalWeight = activeShadows.reduce((sum, s) => sum + s.trafficShare, 0)
  if (totalWeight <= 0) return null

  const roll = Math.random() * totalWeight
  let cumulative = 0
  for (const shadow of activeShadows) {
    cumulative += shadow.trafficShare
    if (roll < cumulative) return shadow
  }
  return activeShadows[activeShadows.length - 1]
}

// ============================================
// Public API
// ============================================

/**
 * 路由 SOP：决定当前执行使用 main 还是 shadow 版本
 *
 * 策略：
 * 1. 读取 active_pool.json（兼容旧 active.json 自动迁移）
 * 2. 处理过期 shadow（含 50% 延期策略）
 * 3. 从 active pool 中加权随机选一个 shadow
 * 4. 按 trafficShare 概率决定是否路由到 shadow
 * 5. 任何失败 fallback 到 main（不抛错）
 *
 * @returns isShadow + shadowId 信号供调用方传递给 episodeRecorder
 */
export async function routeSop(
  dunId: string,
  taskSlice: string,
): Promise<{ sopText: string; isShadow: boolean; shadowId?: string }> {
  // taskSlice 预留给未来 sliceFilter（按任务切片限定 shadow 命中范围）
  void taskSlice
  try {
    // 1. 读取 pool
    const pool = await readPool(dunId)

    if (!pool || pool.shadows.length === 0) {
      const mainSop = await readMainSop(dunId)
      return { sopText: mainSop || '', isShadow: false }
    }

    // 2. 处理过期
    const changed = processExpirations(pool)
    if (changed) {
      await writePool(dunId, pool)
    }

    // 3. 筛选 active shadows
    const activeShadows = pool.shadows.filter(s => s.status === 'active')
    if (activeShadows.length === 0) {
      const mainSop = await readMainSop(dunId)
      return { sopText: mainSop || '', isShadow: false }
    }

    // 4. 加权选择一个 shadow
    const selected = weightedSelectShadow(activeShadows)
    if (!selected) {
      const mainSop = await readMainSop(dunId)
      return { sopText: mainSop || '', isShadow: false }
    }

    // 5. 按该 shadow 的 trafficShare 概率决定是否路由
    const roll = Math.random()
    if (roll < selected.trafficShare) {
      const shadowSop = await readShadowSop(dunId, selected.shadowId)
      if (shadowSop) {
        console.log(
          `[ShadowRouter] Routing to shadow=${selected.shadowId} for dun=${dunId} ` +
          `(roll=${roll.toFixed(3)} < share=${selected.trafficShare})`
        )
        return { sopText: shadowSop, isShadow: true, shadowId: selected.shadowId }
      }
      console.warn(`[ShadowRouter] Shadow SOP file missing for ${selected.shadowId}, falling back to main`)
    }

    // Fallback main
    const mainSop = await readMainSop(dunId)
    return { sopText: mainSop || '', isShadow: false }
  } catch (err) {
    console.warn('[ShadowRouter] routeSop error, falling back to main:', err)
    const mainSop = await readMainSop(dunId)
    return { sopText: mainSop || '', isShadow: false }
  }
}

/**
 * 创建 Shadow SOP
 *
 * 1. 将 patch 应用到 mainSopText（严格锚点校验）
 * 2. 持久化到 {dataDir}/duns/{dunId}/sop_shadows/{shadowId}/sop.md
 * 3. 写入 active_pool.json（如果 active 已满则进入 waitQueue）
 *
 * @returns shadowId
 * @throws 当 anchor 校验失败时抛出包含 invalid_anchor 信息的错误
 */
export async function createShadowSop(
  dunId: string,
  patch: SopPatch,
  mainSopText: string,
): Promise<string> {
  const shadowId = `shadow-${patch.patchId}-${Date.now().toString(36)}`

  // 1. 应用 patch（严格锚点校验）
  const patchResult = applyPatchToSop(mainSopText, patch)

  if (!patchResult.success) {
    // B9: anchor 找不到时返回失败，让上游将 patch 写入 quarantine
    throw new Error(
      `[ShadowRouter] Invalid anchor: "${patchResult.anchor}" not found in SOP. ` +
      `Patch ${patch.patchId} rejected (invalid_anchor).`
    )
  }

  const shadowContent = patchResult.result

  // 2. 持久化 shadow SOP 文件
  const sopPath = `${shadowBasePath(dunId)}/${shadowId}/sop.md`
  const written = await writeFileToDisk(sopPath, shadowContent)
  if (!written) {
    throw new Error(`[ShadowRouter] Failed to write shadow SOP to ${sopPath}`)
  }

  // 3. 更新 pool
  const pool = (await readPool(dunId)) || createEmptyPool()

  const newEntry: ShadowPoolEntry = {
    shadowId,
    patchId: patch.patchId,
    createdAt: Date.now(),
    status: 'active',
    trafficShare: SHADOW_TRAFFIC_SHARE,
    expiresAt: Date.now() + SHADOW_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
    extendedOnce: false,
    episodeCount: 0,
  }

  const activeCount = pool.shadows.filter(s => s.status === 'active').length
  if (activeCount >= pool.maxActive) {
    // Pool 已满，进入 waitQueue
    pool.waitQueue.push(patch.patchId)
    newEntry.status = 'waiting_for_signal'
    console.log(`[ShadowRouter] Pool full (${activeCount}/${pool.maxActive}), patch ${patch.patchId} queued`)
  }

  pool.shadows.push(newEntry)
  await writePool(dunId, pool)

  console.log(`[ShadowRouter] Created shadow SOP: id=${shadowId}, dunId=${dunId}, patch=${patch.patchId}, status=${newEntry.status}`)
  return shadowId
}

// ============================================
// Patch Application (B9 - Strict Anchor Validation)
// ============================================

/**
 * 将 SopPatch 应用到 SOP 文本，生成 shadow 版本
 *
 * 锚点严格校验：anchor 找不到时返回 { success: false } 而非追加末尾
 *
 * 策略：
 * - replace: 找到 sectionAnchor 对应的 section，替换内容
 * - insert_after: 在 sectionAnchor 之后插入新内容
 * - delete: 删除 sectionAnchor 对应的 section
 */
function applyPatchToSop(sopText: string, patch: SopPatch): PatchApplyResult {
  const { sectionAnchor, operation, newContent } = patch

  // 找到 section anchor（按 markdown heading 匹配）
  // 支持模糊匹配：anchor 可以是 heading 的子串
  const lines = sopText.split('\n')
  let anchorLineIdx = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.match(/^#{1,6}\s/) && line.toLowerCase().includes(sectionAnchor.toLowerCase())) {
      anchorLineIdx = i
      break
    }
  }

  // B9: anchor 找不到时返回失败信号
  if (anchorLineIdx === -1) {
    return { success: false, error: 'invalid_anchor', anchor: sectionAnchor }
  }

  // 找到 section 结束位置（下一个同级或更高级 heading）
  const anchorLevel = (lines[anchorLineIdx].match(/^(#{1,6})\s/) || ['', '#'])[1].length
  let sectionEndIdx = lines.length

  for (let i = anchorLineIdx + 1; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s/)
    if (match && match[1].length <= anchorLevel) {
      sectionEndIdx = i
      break
    }
  }

  switch (operation) {
    case 'replace': {
      const before = lines.slice(0, anchorLineIdx)
      const after = lines.slice(sectionEndIdx)
      return { success: true, result: [...before, lines[anchorLineIdx], newContent || '', ...after].join('\n') }
    }
    case 'insert_after': {
      const before = lines.slice(0, sectionEndIdx)
      const after = lines.slice(sectionEndIdx)
      return { success: true, result: [...before, '', newContent || '', ...after].join('\n') }
    }
    case 'delete': {
      const before = lines.slice(0, anchorLineIdx)
      const after = lines.slice(sectionEndIdx)
      return { success: true, result: [...before, ...after].join('\n') }
    }
    default:
      return { success: true, result: sopText }
  }
}

// ============================================
// Pool Management Utilities (exported for testing)
// ============================================

/**
 * 更新 shadow 的 episodeCount（供 episodeRecorder 调用）
 */
export async function incrementShadowEpisodeCount(
  dunId: string,
  shadowId: string,
): Promise<void> {
  const pool = await readPool(dunId)
  if (!pool) return

  const entry = pool.shadows.find(s => s.shadowId === shadowId)
  if (!entry) return

  entry.episodeCount = (entry.episodeCount ?? 0) + 1
  await writePool(dunId, pool)
}

/**
 * 获取 pool 状态（供调试/UI 使用）
 */
export async function getShadowPoolStatus(dunId: string): Promise<ShadowPool | null> {
  return await readPool(dunId)
}
