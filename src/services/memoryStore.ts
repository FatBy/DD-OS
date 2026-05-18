/**
 * MemoryStore - 统一记忆存储服务
 *
 * 前端 API 客户端，对接后端 SQLite + FTS5 + BGE 向量存储。
 * 提供：
 * - 搜索（信任后端混合排序 + 时间衰减 + MMR 去冗余）
 * - 记忆写入（exec_trace, gene, dun_xp, session, memory）
 * - 批量导入/导出
 *
 * 后端实现在 duncrew-server.py，前端仅做 API 调用和结果后处理。
 */

import type { MemorySearchResult, MemorySearchPurpose, MemorySupersedeParams } from '@/types'
import { SEARCH_CONFIG } from '@/types'
import { getServerUrl } from '@/utils/env'
import { PROMOTION_PROMPT, parsePromotionResult } from '@/utils/memoryPromotion'
import { chatBackground, isLLMConfigured } from './llmService'

// ============================================
// 类型定义
// ============================================

export type MemorySource = 'memory' | 'exec_trace' | 'gene' | 'dun_xp' | 'session' | 'l1_memory' | 'diary'

export interface MemoryWriteParams {
  source: MemorySource
  content: string
  dunId?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface MemorySearchParams {
  query: string
  sources?: MemorySource[]
  dunId?: string
  maxResults?: number
  minScore?: number
  /** 是否启用 MMR 去冗余 */
  useMmr?: boolean
  /** 时间范围（仅返回该时间戳之后的结果） */
  since?: number
  /**
   * V10: 搜索调用目的
   * - context_injection: 由 buildDynamicContext 注入上下文时的搜索（会触发命中计数 → 被动晋升）
   * - user_query:        用户在 UI 中主动查询（不计命中，避免 UI 刷屏刷分）
   * - dedup_check:       postExecutionConsolidator 的查重检索（不计命中）
   * - internal:          其他内部调用（默认）
   */
  purpose?: MemorySearchPurpose
}

export interface MemoryStats {
  totalEntries: number
  bySource: Record<MemorySource, number>
  oldestEntry?: number
  newestEntry?: number
}

// ============================================
// 时间衰减计算
// ============================================

/** 计算时间衰减因子 (半衰期指数衰减，preference/discovery 使用更长半衰期) */
function temporalDecay(entryTimestamp: number, category?: string): number {
  // preference/discovery 记忆衰减更慢 (90天)，其余用默认 (30天)
  const halfLifeDays = (category === 'preference' || category === 'discovery')
    ? 90
    : SEARCH_CONFIG.TEMPORAL_DECAY_HALF_LIFE_DAYS
  const ageMs = Date.now() - entryTimestamp
  const ageDays = ageMs / (24 * 60 * 60 * 1000)
  return Math.pow(0.5, ageDays / halfLifeDays)
}

// ============================================
// MMR (Maximal Marginal Relevance) 去冗余
// ============================================

/**
 * MMR 重排序：基于 Jaccard 文本相似度的去冗余
 *
 * 后端不返回 embedding 向量，使用 snippet 文本重叠度作为多样性指标。
 * score_mmr = lambda * relevance - (1 - lambda) * max_text_similarity_to_selected
 */
function mmrRerank(
  results: MemorySearchResult[],
  lambda: number = SEARCH_CONFIG.MMR_LAMBDA,
  maxResults: number = SEARCH_CONFIG.DEFAULT_MAX_RESULTS,
): MemorySearchResult[] {
  if (results.length <= 1) return results

  const selected: MemorySearchResult[] = []
  const remaining = [...results]

  // 使用字符 bigram 分词，解决中文无空格导致 Jaccard 失效的问题
  const tokenize = (text: string): Set<string> => {
    const bigrams = new Set<string>()
    const t = text.toLowerCase().slice(0, 300)
    for (let i = 0; i < t.length - 1; i++) bigrams.add(t.slice(i, i + 2))
    return bigrams
  }

  const jaccardSim = (a: Set<string>, b: Set<string>): number => {
    let intersection = 0
    for (const w of a) { if (b.has(w)) intersection++ }
    const union = a.size + b.size - intersection
    return union === 0 ? 0 : intersection / union
  }

  const snippetTokens = new Map<string, Set<string>>()
  for (const r of results) {
    snippetTokens.set(r.id, tokenize(r.snippet.slice(0, 300)))
  }

  while (selected.length < maxResults && remaining.length > 0) {
    let bestIdx = 0
    let bestScore = -Infinity

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      const relevance = candidate.score

      let maxSim = 0
      if (selected.length > 0) {
        const candTokens = snippetTokens.get(candidate.id)
        if (candTokens) {
          for (const sel of selected) {
            const selTokens = snippetTokens.get(sel.id)
            if (selTokens) {
              maxSim = Math.max(maxSim, jaccardSim(candTokens, selTokens))
            }
          }
        }
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim
      if (mmrScore > bestScore) {
        bestScore = mmrScore
        bestIdx = i
      }
    }

    selected.push(remaining[bestIdx])
    remaining.splice(bestIdx, 1)
  }

  return selected
}

// ============================================
// MemoryStore 服务
// ============================================

class MemoryStoreService {
  private serverUrl: string = getServerUrl()
  private writeCallbacks: Array<(entries: MemorySearchResult[]) => void> = []

  // ═══ 写入失败队列 ═══
  // 后端不可用时暂存待写入记忆，恢复连接后通过 writeBatch 补写
  private static readonly PENDING_WRITES_KEY = 'duncrew_pending_writes'
  private static readonly MAX_PENDING = 50
  private pendingWrites: MemoryWriteParams[] = []
  private _flushing = false

  constructor() {
    this.restorePendingWrites()
  }

  private restorePendingWrites(): void {
    try {
      const raw = localStorage.getItem(MemoryStoreService.PENDING_WRITES_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this.pendingWrites = parsed.slice(-MemoryStoreService.MAX_PENDING)
        }
      }
    } catch { /* 静默 */ }
  }

  private savePendingWrites(): void {
    try {
      if (this.pendingWrites.length === 0) {
        localStorage.removeItem(MemoryStoreService.PENDING_WRITES_KEY)
      } else {
        const toSave = this.pendingWrites.slice(-MemoryStoreService.MAX_PENDING)
        localStorage.setItem(MemoryStoreService.PENDING_WRITES_KEY, JSON.stringify(toSave))
      }
    } catch { /* quota exceeded */ }
  }

  /** 入队待写入，基于 bigramJaccard 去重避免重复积累 */
  private addToPendingWrites(params: MemoryWriteParams): void {
    const isDuplicate = this.pendingWrites.some(
      pending => this.bigramJaccardSimilarity(pending.content, params.content) > 0.7
    )
    if (!isDuplicate) {
      this.pendingWrites.push(params)
      if (this.pendingWrites.length > MemoryStoreService.MAX_PENDING) {
        this.pendingWrites = this.pendingWrites.slice(-MemoryStoreService.MAX_PENDING)
      }
      this.savePendingWrites()
    }
  }

  /** 后端恢复后批量补写队列中的记忆 */
  async flushPendingWrites(): Promise<void> {
    if (this._flushing || this.pendingWrites.length === 0) return
    this._flushing = true

    const toFlush = [...this.pendingWrites]
    this.pendingWrites = []

    try {
      const written = await this.writeBatch(toFlush)
      if (written === 0) {
        // 全部失败，放回队列
        this.pendingWrites = toFlush
      }
      // 部分成功：writeBatch 不告知哪条失败，保守认为全部成功
    } catch {
      // 网络错误，全部放回
      this.pendingWrites = toFlush
    } finally {
      this.savePendingWrites()
      this._flushing = false
    }
  }

  /** 获取队列中待补写条目数量 */
  get pendingWriteCount(): number {
    return this.pendingWrites.length
  }

  /** 更新后端地址 */
  setServerUrl(url: string): void {
    this.serverUrl = url
  }

  /** 注册写入回调（用于通知 store 更新缓存） */
  onWrite(callback: (entries: MemorySearchResult[]) => void): void {
    this.writeCallbacks.push(callback)
  }

  /** 从 MemoryWriteParams 构造合成的 MemorySearchResult */
  private synthesizeResult(params: MemoryWriteParams): MemorySearchResult {
    const now = Date.now()
    return {
      id: `mem-${crypto.randomUUID()}`,
      source: params.source,
      content: params.content,
      snippet: params.content.slice(0, 200),
      dunId: params.dunId || '',
      tags: params.tags || [],
      score: 1.0,
      createdAt: now,
      confidence: 0.5,
      metadata: params.metadata || {},
    }
  }

  /** 通知所有注册的回调 */
  private notifyWrite(entries: MemorySearchResult[]): void {
    for (const cb of this.writeCallbacks) {
      try { cb(entries) } catch { /* 回调失败不影响主流程 */ }
    }
  }

  // ═══ 搜索 ═══

  /**
   * 搜索：信任后端混合分数 + 时间衰减 + MMR 去冗余
   *
   * 流程：
   * 1. 向后端发送搜索请求（后端已做 FTS5 + BGE 向量混合排序）
   * 2. 信任后端返回的 score，不再前端重新计算
   * 3. 应用时间衰减
   * 4. 可选 MMR 去冗余（基于文本去重）
   */
  async search(params: MemorySearchParams): Promise<MemorySearchResult[]> {
    const {
      query,
      sources,
      dunId,
      maxResults = SEARCH_CONFIG.DEFAULT_MAX_RESULTS,
      minScore = SEARCH_CONFIG.DEFAULT_MIN_SCORE,
      useMmr = true,
      since,
      purpose = 'internal',
    } = params

    try {
      // 通配符 '*' 不是语义搜索，跳过混合引擎，走 SQL 直查
      const effectiveQuery = query === '*' ? '' : query
      const limit = Math.min(maxResults * 3, 500)

      // 1. 向后端发送搜索请求
      const searchParams = new URLSearchParams({
        q: effectiveQuery,
        limit: String(limit),
      })
      if (effectiveQuery === '') searchParams.set('hybrid', '0')
      if (sources?.length) searchParams.set('source', sources[0])
      if (dunId) searchParams.set('dunId', dunId)
      if (since) searchParams.set('since', String(since))

      const res = await fetch(`${this.serverUrl}/api/memory/search?${searchParams}`)
      if (!res.ok) {
        console.warn(`[MemoryStore] Search failed: ${res.status}`)
        return []
      }

      let results: MemorySearchResult[] = await res.json()

      // 2. 信任后端 score，仅应用时间衰减
      if (results.length > 0) {
        for (const r of results) {
          // 使用 createdAt 字段计算时间衰减（后端返回毫秒时间戳）
          if (r.createdAt) {
            r.score *= temporalDecay(r.createdAt, r.metadata?.category as string)
          }
        }

        // 3. 排序
        results.sort((a, b) => b.score - a.score)

        // 4. MMR 去冗余（基于文本相似度）
        if (useMmr && results.length > 1) {
          results = mmrRerank(results, SEARCH_CONFIG.MMR_LAMBDA, maxResults)
        }
      }

      // 过滤低分结果
      results = results.filter(r => r.score >= minScore)

      // 限制返回数量
      const finalResults = results.slice(0, maxResults)

      // V10: 只在 context_injection 场景下记录命中，用于 L1 被动晋升
      if (purpose === 'context_injection' && finalResults.length > 0) {
        this.notifyHits(finalResults)
      }

      return finalResults
    } catch (error: any) {
      console.warn('[MemoryStore] Search error:', error.message)
      return []
    }
  }

  // ═══ 写入 ═══

  /** 写入一条记忆（失败时自动入队，后端恢复后补写） */
  async write(params: MemoryWriteParams): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverUrl}/api/memory/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: params.source,
          content: params.content,
          dunId: params.dunId,
          tags: params.tags,
          metadata: params.metadata,
          timestamp: Date.now(),
        }),
      })
      if (res.ok) {
        this.notifyWrite([this.synthesizeResult(params)])
        // 写入成功，顺带尝试 flush 之前积压的队列
        if (this.pendingWrites.length > 0) {
          void this.flushPendingWrites()
        }
        return true
      }
      this.addToPendingWrites(params)
      return false
    } catch (error: any) {
      console.warn('[MemoryStore] Write error:', error.message)
      this.addToPendingWrites(params)
      return false
    }
  }

  /** 批量写入记忆 */
  async writeBatch(entries: MemoryWriteParams[]): Promise<number> {
    try {
      const res = await fetch(`${this.serverUrl}/api/memory/write-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: entries.map(e => ({
            ...e,
            timestamp: Date.now(),
          })),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const written = data.written || 0
        if (written > 0) {
          this.notifyWrite(entries.map(e => this.synthesizeResult(e)))
        }
        return written
      }
      return 0
    } catch (error: any) {
      console.warn('[MemoryStore] WriteBatch error:', error.message)
      return 0
    }
  }

  // ═══ 管理 ═══

  /** 获取记忆统计 */
  async getStats(): Promise<MemoryStats | null> {
    try {
      const res = await fetch(`${this.serverUrl}/api/memory/stats`)
      if (res.ok) {
        return await res.json()
      }
      return null
    } catch {
      return null
    }
  }

  /** 清理过期记忆 */
  async prune(olderThanDays: number = 90): Promise<number> {
    try {
      const res = await fetch(`${this.serverUrl}/api/memory/prune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThanDays }),
      })
      if (res.ok) {
        const data = await res.json()
        return data.pruned || 0
      }
      return 0
    } catch {
      return 0
    }
  }

  /** 按 Dun ID 获取记忆 */
  async getByDun(dunId: string, limit: number = 20): Promise<MemorySearchResult[]> {
    try {
      const res = await fetch(`${this.serverUrl}/api/memory/dun/${encodeURIComponent(dunId)}?limit=${limit}`)
      if (res.ok) {
        return await res.json()
      }
      return []
    } catch {
      return []
    }
  }

  // ═══ 分组搜索 (Phase 1.1) ═══

  /** 按 source 分别限制数量的分组搜索 */
  async searchGrouped(params: {
    query: string
    sourceLimits: Record<string, number>
    dunId?: string
    minScore?: number
    useMmr?: boolean
  }): Promise<MemorySearchResult[]> {
    const {
      query,
      sourceLimits,
      dunId,
      minScore = SEARCH_CONFIG.DEFAULT_MIN_SCORE,
      useMmr = true,
    } = params

    try {
      const res = await fetch(`${this.serverUrl}/api/memory/search-grouped`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: query,
          sourceLimits,
          dunId,
          minScore,
          useMmr,
        }),
      })

      if (!res.ok) {
        throw new Error(`searchGrouped HTTP ${res.status}`)
      }

      const grouped = await res.json()

      // 后端返回分组对象 { source: MemorySearchResult[] }，展平为数组
      const results: MemorySearchResult[] = Array.isArray(grouped)
        ? grouped
        : Object.values(grouped).flat() as MemorySearchResult[]

      // 应用时间衰减（使用 createdAt 字段）
      for (const result of results) {
        if (result.createdAt) {
          result.score *= temporalDecay(result.createdAt, result.metadata?.category as string)
        }
      }

      // MMR 去冗余
      if (useMmr && results.length > 1) {
        const totalLimit = Object.values(sourceLimits).reduce((sum, limit) => sum + limit, 0)
        return mmrRerank(results, SEARCH_CONFIG.MMR_LAMBDA, totalLimit)
      }

      return results.filter(result => result.score >= minScore)
    } catch (error: any) {
      console.warn('[MemoryStore] searchGrouped error:', error.message)
      // 降级：用原有 search 方法
      return this.search({
        query,
        maxResults: Object.values(sourceLimits).reduce((sum, limit) => sum + limit, 0),
        minScore,
        useMmr,
        dunId,
      })
    }
  }

  // ═══ 去重写入 (Phase 2.0) ═══

  /** 最近写入缓存（5 分钟过期） */
  private recentWrites: Array<{ content: string; timestamp: number }> = []
  private readonly DEDUP_CACHE_TTL = 5 * 60 * 1000

  /**
   * 带去重的记忆写入
   * 仅对 source='memory' 生效，其他 source 直接写入
   */
  async writeWithDedup(params: MemoryWriteParams): Promise<boolean> {
    if (params.source !== 'memory') {
      return this.write(params)
    }

    // 1. 先检查本地缓存（零网络开销）
    const now = Date.now()
    this.recentWrites = this.recentWrites.filter(write => now - write.timestamp < this.DEDUP_CACHE_TTL)

    for (const recent of this.recentWrites) {
      if (this.bigramJaccardSimilarity(params.content, recent.content) > 0.7) {
        console.log(`[MemoryStore] Dedup (cache hit): skipped "${params.content.slice(0, 50)}..."`)
        return false  // 去重命中，实际未写入
      }
    }

    // 2. 缓存未命中，走后端语义搜索
    try {
      const similar = await this.search({
        query: params.content,
        sources: ['memory'],
        maxResults: 3,
        minScore: SEARCH_CONFIG.DEDUP_SIMILARITY_THRESHOLD,
        useMmr: false,
      })
      if (similar.length > 0) {
        console.log(`[MemoryStore] Dedup (backend hit): skipped "${params.content.slice(0, 50)}..."`)
        this.recentWrites.push({ content: params.content, timestamp: now })
        return false  // 去重命中，实际未写入
      }
    } catch {
      // 去重查询失败不阻塞写入
    }

    // 3. 写入并加入缓存
    const writeSuccess = await this.write(params)
    if (writeSuccess) {
      this.recentWrites.push({ content: params.content, timestamp: now })
    }
    return writeSuccess
  }

  /** 基于字符 bigram 的 Jaccard 文本相似度 */
  private bigramJaccardSimilarity(textA: string, textB: string): number {
    const bigramsA = new Set<string>()
    const bigramsB = new Set<string>()
    for (let i = 0; i < textA.length - 1; i++) bigramsA.add(textA.slice(i, i + 2))
    for (let i = 0; i < textB.length - 1; i++) bigramsB.add(textB.slice(i, i + 2))
    let intersection = 0
    for (const bigram of bigramsA) if (bigramsB.has(bigram)) intersection++
    const union = bigramsA.size + bigramsB.size - intersection
    return union === 0 ? 0 : intersection / union
  }

  // ═══ V10: Supersede / Conflict / 命中回调 / Markdown 导出 ═══

  /** 命中回调：search() 在 purpose=context_injection 时调用，用于 L1 被动晋升 */
  private hitCallbacks: Array<(ids: string[]) => void | Promise<void>> = []

  /** 订阅搜索命中事件（confidenceTracker 会订阅此事件推进被动晋升） */
  onSearchHit(callback: (ids: string[]) => void | Promise<void>): () => void {
    this.hitCallbacks.push(callback)
    return () => {
      this.hitCallbacks = this.hitCallbacks.filter(cb => cb !== callback)
    }
  }

  private notifyHits(results: MemorySearchResult[]): void {
    if (this.hitCallbacks.length === 0) return
    // 只对 source='l1_memory' 或 'memory' 的结果记录命中
    const ids = results
      .filter(r => r.source === 'l1_memory' || r.source === 'memory')
      .map(r => r.id)
    if (ids.length === 0) return
    for (const cb of this.hitCallbacks) {
      try {
        const result = cb(ids)
        // BUG-4 fix: 捕获 async 回调的 rejection，防止 unhandled promise rejection
        if (result && typeof (result as any).catch === 'function') {
          ;(result as any).catch((err: any) =>
            console.warn('[MemoryStore] onSearchHit async error:', err?.message),
          )
        }
      } catch (error: any) {
        console.warn('[MemoryStore] onSearchHit callback error:', error.message)
      }
    }
  }

  /**
   * V10: 将旧记忆标记为被取代（supersede），可选同步写入新记忆。
   *
   * 使用场景：postExecutionConsolidator 的 LLM 输出 action=SUPERSEDE 时调用。
   *
   * @returns 若成功，返回新写入的记忆 id（若 params.newContent 为空则返回 null）
   */
  async supersede(params: MemorySupersedeParams): Promise<string | null> {
    try {
      const body = {
        ...params,
        mode: params.mode ?? 'supersede',
      }
      const res = await fetch(`${this.serverUrl}/api/memory/supersede`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        console.warn(`[MemoryStore] supersede failed: ${res.status} ${text}`)
        return null
      }
      const data = await res.json()
      return data.newId ?? null
    } catch (error: any) {
      console.warn('[MemoryStore] supersede error:', error.message)
      return null
    }
  }

  /** V10: 标记两条记忆为冲突（保留双方，等待后续信号解决） */
  async markConflict(params: MemorySupersedeParams): Promise<string | null> {
    return this.supersede({ ...params, mode: 'conflict' })
  }

  /**
   * V10 / P3: 将当前记忆导出为 Markdown（人类可读的镜像视图）。
   *
   * 分组规则：按 category（preference / project / discovery / uncategorized）分章节。
   * 每条记忆输出：
   *   - [YYYY-MM-DD] content
   *   - 可选：tags / confidence / dunId
   *
   * @param options.onlyActive 是否只导出 active 记忆（默认 true）
   * @returns Markdown 字符串
   */
  async exportToMarkdown(options: { onlyActive?: boolean } = {}): Promise<string> {
    const { onlyActive: _onlyActive = true } = options
    try {
      // 拉取全量（走通配符，后端已过滤 deleted_at；status 默认 active）
      const res = await fetch(`${this.serverUrl}/api/memory/search?q=*&limit=500&hybrid=0`)
      if (!res.ok) {
        return `# DunCrew Memory Export\n\n_Export failed: HTTP ${res.status}_\n`
      }
      const rows: MemorySearchResult[] = await res.json()

      // 按 category 分组
      const groups: Record<string, MemorySearchResult[]> = {}
      for (const row of rows) {
        const category = (row.category || 'uncategorized').toString()
        if (!groups[category]) groups[category] = []
        groups[category].push(row)
      }

      const CATEGORY_TITLES: Record<string, string> = {
        preference: '用户偏好 Preferences',
        project: '项目上下文 Project Context',
        project_context: '项目上下文 Project Context',
        discovery: '发现与洞察 Discoveries',
        uncategorized: '未分类 Uncategorized',
      }

      const lines: string[] = []
      lines.push('# DunCrew Memory Export')
      lines.push('')
      lines.push(`_Exported at ${new Date().toISOString()}_  _Total: ${rows.length} entries_`)
      lines.push('')

      const orderedKeys = ['preference', 'project', 'project_context', 'discovery', 'uncategorized']
      for (const key of orderedKeys) {
        const entries = groups[key]
        if (!entries || entries.length === 0) continue
        lines.push(`## ${CATEGORY_TITLES[key] || key} (${entries.length})`)
        lines.push('')
        // 按时间倒序
        entries.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        for (const entry of entries) {
          const date = entry.createdAt
            ? new Date(entry.createdAt).toISOString().slice(0, 10)
            : '----'
          const content = (entry.content ?? entry.snippet ?? '').trim()
          const tags = entry.tags?.length ? ` #${entry.tags.join(' #')}` : ''
          const conf = typeof entry.confidence === 'number' ? ` _(conf: ${entry.confidence.toFixed(2)})_` : ''
          const dun = entry.dunId ? ` _[dun: ${entry.dunId}]_` : ''
          lines.push(`- **[${date}]** ${content}${tags}${conf}${dun}`)
        }
        lines.push('')
      }
      return lines.join('\n')
    } catch (error: any) {
      return `# DunCrew Memory Export\n\n_Export error: ${error.message}_\n`
    }
  }

  // ═══ 软删除 (Phase 3.2) ═══

  /** 软删除一条记忆（设置 deleted_at） */
  async delete(memoryId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverUrl}/api/memory/${encodeURIComponent(memoryId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        console.log(`[MemoryStore] Soft-deleted memory: ${memoryId}`)
        return true
      }
      console.warn(`[MemoryStore] Delete failed: ${res.status}`)
      return false
    } catch (error: any) {
      console.warn('[MemoryStore] Delete error:', error.message)
      return false
    }
  }

  // ═══ 旧数据清理 (F2) ═══

  /**
   * 清理旧低质量 L0 记忆
   * 正则快速过滤工具日志 + LLM 兜底判断
   * 由设置页"整理记忆"按钮触发
   *
   * @param dryRun 为 true 时仅返回待删除列表，不执行实际删除（用于用户确认）
   */
  async cleanupLowQualityMemories(dryRun = false): Promise<{ cleaned: number; candidates: MemorySearchResult[] }> {
    const allL0 = await this.search({
      query: '*',
      sources: ['memory'],
      maxResults: 200,
      minScore: 0,
      useMmr: false,
    })

    let cleaned = 0
    const candidates: MemorySearchResult[] = []

    for (const mem of allL0) {
      const content = mem.content || mem.snippet || ''

      // 快速过滤：纯工具日志特征（不需要 LLM）
      const isToolLog = /^(readFile|writeFile|runCmd|listDir|searchFiles)\s*[:：]/.test(content)
        || /返回\s*\d+\s*字节/.test(content)
        || /操作了\s*.+\.(json|ts|py|md)/.test(content)

      if (isToolLog) {
        candidates.push(mem)
        if (!dryRun) {
          await this.delete(mem.id)
          cleaned++
        }
        continue
      }

      // 对不确定的短内容，用 LLM 判断（复用 PROMOTION_PROMPT）
      if (content.length < 100 && isLLMConfigured()) {
        try {
          const result = await chatBackground([
            { role: 'system', content: PROMOTION_PROMPT },
            { role: 'user', content },
          ], { priority: 9 })
          const parsed = parsePromotionResult(result?.trim() || '')
          if (!parsed) {
            candidates.push(mem)
            if (!dryRun) {
              await this.delete(mem.id)
              cleaned++
            }
          }
        } catch {
          // LLM 调用失败，保守保留
        }
      }
    }

    console.log(`[MemoryStore] Cleanup ${dryRun ? 'dry-run' : 'completed'}: ${dryRun ? candidates.length + ' candidates' : cleaned + ' removed'}`)
    return { cleaned: dryRun ? candidates.length : cleaned, candidates }
  }
}

// 导出单例
export const memoryStore = new MemoryStoreService()
