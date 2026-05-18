/**
 * Library Lens — 图书馆镜头
 *
 * 调用后端 /api/wiki/search（向量优先 + LIKE 降级），转为 EvidenceItem[]
 *
 * v2 改造（2026-04）：多路召回
 * - 后端支持向量/LIKE，但对长句命中率差
 * - 前端拆词成多个 query，并发召回后合并去重
 * - 同一实体被多个 query 命中则 hitCount 累加，用于排序加权
 */

import type { EvidenceItem } from '@/types'
import { buildMultiRouteQueries } from '../queryExpander'

const API_BASE = 'http://localhost:3001'

interface WikiEntityHit {
  id?: string
  entityId?: string
  title: string
  tldr?: string
  dun_id?: string
  dunId?: string
  type?: string
  score?: number
  claims?: Array<{ content: string }>
}

interface ScoredEntity {
  entity: WikiEntityHit
  entityId: string
  hitCount: number // 被多少路 query 命中
  maxScore: number // 最高相似度（向量）
  firstHitRank: number // 首次命中时的排名（越小越好）
}

async function fetchOneRoute(query: string, limit: number): Promise<WikiEntityHit[]> {
  try {
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    const res = await fetch(`${API_BASE}/api/wiki/search?${params}`)
    if (!res.ok) return []
    const data = await res.json()
    const hits: WikiEntityHit[] = data.results || data.entities || data || []
    return Array.isArray(hits) ? hits : []
  } catch {
    return []
  }
}

/**
 * 从图书馆搜索实体，转为证据项
 * @param intent 用户原始意图（会被自动拆词成多路 query）
 * @param limit 最大返回数（默认 20）
 * @param dunId 可选，Dun ID 加权
 */
export async function lensLibrary(
  intent: string,
  limit = 20,
  dunId?: string | null,
): Promise<EvidenceItem[]> {
  const t0 = performance.now()
  const queries = buildMultiRouteQueries(intent, 5)
  if (queries.length === 0) {
    console.debug('[lensLibrary] skipped: empty intent')
    return []
  }

  // 每路 query 的召回量稍微收紧（避免总量爆炸），最终再 top-K
  const perRouteLimit = Math.max(5, Math.ceil(limit * 0.8))

  const allRoutes = await Promise.all(
    queries.map((q) => fetchOneRoute(q, perRouteLimit)),
  )

  // 合并去重
  const merged = new Map<string, ScoredEntity>()
  for (const route of allRoutes) {
    route.forEach((entity, rank) => {
      const eid = entity.entityId || entity.id
      if (!eid) return

      const existing = merged.get(eid)
      if (existing) {
        existing.hitCount += 1
        existing.maxScore = Math.max(existing.maxScore, entity.score ?? 0)
        existing.firstHitRank = Math.min(existing.firstHitRank, rank)
      } else {
        merged.set(eid, {
          entity,
          entityId: eid,
          hitCount: 1,
          maxScore: entity.score ?? 0,
          firstHitRank: rank,
        })
      }
    })
  }

  // ─── Debug 日志: 每路召回情况 + 合并统计 ───
  const elapsed = Math.round(performance.now() - t0)
  const perRouteSummary = queries.map((q, i) => ({
    query: q,
    hits: allRoutes[i]?.length ?? 0,
    topTitles: (allRoutes[i] || []).slice(0, 3).map((e) => e.title).join(' / ') || '(none)',
  }))

  console.groupCollapsed(
    `%c[lensLibrary]%c ${queries.length} routes → ${merged.size} unique entities (${elapsed}ms)`,
    'color:#a16207;font-weight:bold',
    'color:inherit',
  )
  console.log('🔍 intent:', intent)
  console.table(perRouteSummary)
  if (merged.size > 0) {
    const multiHit = Array.from(merged.values()).filter((s) => s.hitCount >= 2)
    if (multiHit.length > 0) {
      console.log(
        `⭐ 多路命中 (${multiHit.length}):`,
        multiHit
          .sort((a, b) => b.hitCount - a.hitCount)
          .slice(0, 5)
          .map((s) => `${s.entity.title}×${s.hitCount}`)
          .join(', '),
      )
    }
  } else {
    console.warn('⚠️ 所有路均未召回任何实体，LLM 将缺少证据支持')
  }
  console.groupEnd()

  if (merged.size === 0) return []

  // 排序：多路命中 > 向量分数 > 首次命中排名
  const ranked = Array.from(merged.values()).sort((a, b) => {
    if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount
    if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore
    return a.firstHitRank - b.firstHitRank
  })

  return ranked.slice(0, limit).map((scored): EvidenceItem => {
    const { entity, entityId, hitCount } = scored

    // snippet: tldr 优先，否则取前几条 claims
    let snippet = entity.tldr || ''
    if (!snippet && entity.claims && entity.claims.length > 0) {
      snippet = entity.claims.slice(0, 3).map((c) => c.content).join('; ')
    }
    snippet = snippet.slice(0, 400)

    // Dun 加权标记
    const entityDunId = entity.dun_id || entity.dunId
    const isDunMatch = dunId && entityDunId === dunId

    // 多路命中打星（视觉提示更强相关）
    const multiHitTag = hitCount >= 2 ? `◉×${hitCount} ` : ''

    return {
      id: `evidence-L-${entityId}`,
      lens: 'L',
      title: `${isDunMatch ? '★ ' : ''}${multiHitTag}${entity.title}`,
      snippet,
      ref: {
        kind: 'entity',
        entityId,
        snapshotTldr: snippet.slice(0, 200),
      },
    }
  })
}
