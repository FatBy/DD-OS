/**
 * memoryService — 自习室长期记忆读取
 *
 * 设计目的:
 * - 自习室不只是"根据当前 intent 召回知识库"
 * - 还要让 LLM 能看到用户最近的经验、笔记、偏好 (长期记忆)
 * - 避免每次修改都像初次见面的"金鱼脑"
 *
 * 数据源 (按优先级):
 * 1. 后端 /api/memory/search — 向量召回最相关的记忆
 * 2. 失败时静默降级为空数组, 不阻塞写作流程
 */

import type { MemorySnippet } from '@/types'

const API_BASE = 'http://localhost:3001'

interface RawMemoryHit {
  id?: string
  content?: string
  snippet?: string
  score?: number
  source?: string
  created_at?: number
  createdAt?: number
  metadata?: Record<string, unknown>
}

/**
 * 根据意图召回长期记忆
 * @param query 检索意图 (用户原话即可)
 * @param limit 最多返回条数
 * @param signal abort signal
 */
export async function recallMemory(
  query: string,
  limit = 8,
  signal?: AbortSignal,
): Promise<MemorySnippet[]> {
  if (!query || !query.trim()) return []

  const t0 = performance.now()
  try {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
    })
    const res = await fetch(`${API_BASE}/api/memory/search?${params}`, { signal })
    if (!res.ok) {
      console.debug(`[memoryService] /api/memory/search returned ${res.status}, skip`)
      return []
    }
    const data = await res.json()
    const rawHits: RawMemoryHit[] = data.results || data.items || data.memories || data || []
    if (!Array.isArray(rawHits)) return []

    // 用 Set 跟踪已出现的 id, 保证 key 唯一 (后端可能返回重复 hit.id, 或 fallback 随机 id 撞车)
    const seenIds = new Set<string>()
    const snippets = rawHits
      .map((hit, index): MemorySnippet | null => {
        const content = (hit.content || hit.snippet || '').toString()
        if (!content.trim()) return null
        // 生成唯一 id: 优先用后端 id, 重复时追加索引后缀; 无 id 时用 index + 时间戳兜底
        let id = hit.id
          ? String(hit.id)
          : `mem-${Date.now().toString(36)}-${index}`
        if (seenIds.has(id)) {
          id = `${id}__${index}`
        }
        seenIds.add(id)
        return {
          id,
          content: content.slice(0, 500),
          source: hit.source || 'memory',
          score: hit.score,
          createdAt: hit.created_at || hit.createdAt,
        }
      })
      .filter((x): x is MemorySnippet => x !== null)
      .slice(0, limit)

    const elapsed = Math.round(performance.now() - t0)
    console.debug(
      `[memoryService] recalled ${snippets.length} memory snippets for "${query.slice(0, 40)}..." (${elapsed}ms)`,
    )
    return snippets
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return []
    console.warn('[memoryService] recall failed:', err)
    return []
  }
}

/**
 * 将记忆片段格式化为 prompt 片段 (markdown 列表)
 */
export function formatMemoryContext(snippets: MemorySnippet[], maxChars = 1200): string {
  if (!snippets || snippets.length === 0) return ''
  const lines: string[] = []
  let total = 0
  for (const s of snippets) {
    const line = `- [${s.source}] ${s.content.slice(0, 180)}`
    if (total + line.length > maxChars) break
    lines.push(line)
    total += line.length
  }
  if (lines.length === 0) return ''
  return `## 背景记忆 (来自你与用户以前的交互, 仅供参考, 不要强行引用)\n${lines.join('\n')}`
}
