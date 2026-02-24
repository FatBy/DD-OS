/**
 * 智能匹配服务 - 用 LLM 语义理解 + 关键词降级，将用户自然语言描述匹配到 SKILL/MCP
 */

import { chat, isLLMConfigured } from './llmService'

// ============================================
// 类型定义
// ============================================

export interface MatchResult {
  name: string
  description: string
  matchReason: string
  score: number            // 0-100
  matchType: 'llm' | 'keyword'
  extras?: string[]        // MCP: 匹配的工具名; SKILL: 关键词
}

export interface SkillCandidate {
  name: string
  description?: string
  keywords?: string[]
}

export interface MCPServerCandidate {
  name: string
  tools: Array<{ name: string; description?: string }>
}

// ============================================
// 缓存
// ============================================

const cache = new Map<string, { results: MatchResult[]; ts: number }>()
const CACHE_SIZE = 10
const CACHE_TTL = 5 * 60 * 1000 // 5min

function getCached(key: string): MatchResult[] | null {
  const entry = cache.get(key)
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.results
  if (entry) cache.delete(key)
  return null
}

function setCache(key: string, results: MatchResult[]) {
  if (cache.size >= CACHE_SIZE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { results, ts: Date.now() })
}

// ============================================
// SKILL 搜索
// ============================================

export async function searchSkills(
  query: string,
  skills: SkillCandidate[],
): Promise<MatchResult[]> {
  const q = query.trim()
  if (!q) return []

  const cacheKey = `skill:${q}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const candidates = skills.slice(0, 30)

  // 尝试 LLM 匹配
  if (isLLMConfigured()) {
    try {
      const results = await matchSkillsWithLLM(q, candidates)
      if (results.length > 0) {
        setCache(cacheKey, results)
        return results
      }
    } catch {
      // 静默降级
    }
  }

  // 降级关键词匹配
  const results = fallbackSkillMatch(q, candidates)
  if (results.length > 0) setCache(cacheKey, results)
  return results
}

// ============================================
// MCP 搜索
// ============================================

export async function searchMCPServers(
  query: string,
  servers: MCPServerCandidate[],
): Promise<MatchResult[]> {
  const q = query.trim()
  if (!q) return []

  const cacheKey = `mcp:${q}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const candidates = servers.slice(0, 30)

  if (isLLMConfigured()) {
    try {
      const results = await matchMCPWithLLM(q, candidates)
      if (results.length > 0) {
        setCache(cacheKey, results)
        return results
      }
    } catch {
      // 静默降级
    }
  }

  const results = fallbackMCPMatch(q, candidates)
  if (results.length > 0) setCache(cacheKey, results)
  return results
}

// ============================================
// LLM 匹配
// ============================================

async function matchSkillsWithLLM(
  query: string,
  candidates: SkillCandidate[],
): Promise<MatchResult[]> {
  const list = candidates
    .map((s, i) => `${i + 1}. ${s.name} - ${s.description || '无描述'}`)
    .join('\n')

  const prompt = `用户想找一个技能来完成: "${query}"

可选技能:
${list}

返回最相关的前3个(JSON格式，不要输出其他内容):
{"matches":[{"name":"技能名","reason":"推荐原因(15字内)","score":0到100的数字}]}
如果没有相关技能返回 {"matches":[]}`

  const raw = await chatWithTimeout(prompt)
  return parseLLMResponse(raw, candidates, 'skill')
}

async function matchMCPWithLLM(
  query: string,
  candidates: MCPServerCandidate[],
): Promise<MatchResult[]> {
  const list = candidates
    .map((s, i) => {
      const toolNames = s.tools.map(t => t.name).join(', ')
      return `${i + 1}. ${s.name} - 工具: ${toolNames || '无'}`
    })
    .join('\n')

  const prompt = `用户想找一个MCP服务来完成: "${query}"

可选服务:
${list}

返回最相关的前3个(JSON格式，不要输出其他内容):
{"matches":[{"name":"服务名","reason":"推荐原因(15字内)","score":0到100的数字,"tools":["匹配的工具名"]}]}
如果没有相关服务返回 {"matches":[]}`

  const raw = await chatWithTimeout(prompt)
  return parseLLMResponse(raw, candidates, 'mcp')
}

async function chatWithTimeout(prompt: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    const result = await chat(
      [{ role: 'user', content: prompt }],
    )
    return result
  } finally {
    clearTimeout(timer)
  }
}

function parseLLMResponse(
  raw: string,
  candidates: Array<SkillCandidate | MCPServerCandidate>,
  type: 'skill' | 'mcp',
): MatchResult[] {
  // 从返回中提取 JSON
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return []

  let parsed: { matches: Array<{ name: string; reason: string; score: number; tools?: string[] }> }
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return []
  }

  if (!Array.isArray(parsed.matches)) return []

  return parsed.matches
    .filter(m => m.name && typeof m.score === 'number')
    .slice(0, 3)
    .map(m => {
      const candidate = candidates.find(c => c.name === m.name)
      const desc = type === 'skill'
        ? (candidate as SkillCandidate)?.description || ''
        : `提供 ${(candidate as MCPServerCandidate)?.tools?.length || 0} 个工具`

      return {
        name: m.name,
        description: desc,
        matchReason: m.reason || '语义匹配',
        score: Math.min(100, Math.max(0, m.score)),
        matchType: 'llm' as const,
        extras: m.tools,
      }
    })
}

// ============================================
// 降级关键词匹配
// ============================================

function tokenize(query: string): string[] {
  // 按空格/标点拆分，同时保留连续英文/数字作为单独 token
  return query
    .toLowerCase()
    .split(/[\s,，.。!！?？、;；:：\-—]+/)
    .filter(t => t.length >= 1)
}

function fallbackSkillMatch(
  query: string,
  candidates: SkillCandidate[],
): MatchResult[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []

  const scored = candidates.map(c => {
    let score = 0
    const nameLower = c.name.toLowerCase()
    const descLower = (c.description || '').toLowerCase()
    const matchedFields: string[] = []

    for (const token of tokens) {
      if (nameLower === token) {
        score += 50
        matchedFields.push(`名称完全匹配: ${token}`)
      } else if (nameLower.includes(token)) {
        score += 30
        matchedFields.push(`名称包含: ${token}`)
      }
      if (descLower.includes(token)) {
        score += 20
        matchedFields.push(`描述匹配: ${token}`)
      }
      if (c.keywords?.some(k => k.toLowerCase().includes(token))) {
        score += 15
        matchedFields.push(`关键词匹配: ${token}`)
      }
    }

    return {
      candidate: c,
      score: Math.min(score, 100),
      matchedFields,
    }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => ({
      name: s.candidate.name,
      description: s.candidate.description || '',
      matchReason: s.matchedFields[0] || '关键词匹配',
      score: s.score,
      matchType: 'keyword' as const,
      extras: s.candidate.keywords?.slice(0, 3),
    }))
}

function fallbackMCPMatch(
  query: string,
  candidates: MCPServerCandidate[],
): MatchResult[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []

  const scored = candidates.map(c => {
    let score = 0
    const nameLower = c.name.toLowerCase()
    const matchedTools: string[] = []
    const matchedFields: string[] = []

    for (const token of tokens) {
      if (nameLower.includes(token)) {
        score += 30
        matchedFields.push(`名称匹配: ${token}`)
      }
      for (const tool of c.tools) {
        const toolNameLower = tool.name.toLowerCase()
        const toolDescLower = (tool.description || '').toLowerCase()
        if (toolNameLower.includes(token) || toolDescLower.includes(token)) {
          score += 10
          if (!matchedTools.includes(tool.name)) matchedTools.push(tool.name)
        }
      }
    }

    return {
      candidate: c,
      score: Math.min(score, 100),
      matchedFields,
      matchedTools,
    }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => ({
      name: s.candidate.name,
      description: `提供 ${s.candidate.tools.length} 个工具`,
      matchReason: s.matchedFields[0] || '工具匹配',
      score: s.score,
      matchType: 'keyword' as const,
      extras: s.matchedTools.slice(0, 5),
    }))
}
