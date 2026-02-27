/**
 * Signal Matcher — EvoMap 兼容的信号提取与匹配引擎
 * 
 * 纯字符串匹配，无 ML 依赖。支持:
 * - 正则模式: /pattern/flags
 * - 子串匹配: case-insensitive
 */

import type { Gene, GeneMatch } from '@/types'

// 常见错误关键词 (用于信号提取)
const ERROR_KEYWORDS = [
  'error', 'timeout', 'permission', 'denied', 'not found', 'no such file',
  'enoent', 'eperm', 'eacces', 'econnrefused', 'etimedout',
  'syntax error', 'unexpected token', 'cannot find', 'is not defined',
  'failed', 'rejected', 'aborted', 'invalid', 'missing', 'overflow',
  'null', 'undefined', 'nan', 'exception', 'crash', 'fatal',
]

// 错误码正则: ENOENT, EPERM, HTTP_404, ERR_xxx 等
const ERROR_CODE_REGEX = /\b(E[A-Z]{2,}|HTTP_\d{3}|ERR_[A-Z_]+|[A-Z_]{4,}_ERROR)\b/g

/**
 * 从工具名和错误消息中提取信号列表
 */
export function extractSignals(toolName: string, errorMessage: string): string[] {
  const signals: string[] = []
  const lowerError = errorMessage.toLowerCase()

  // 1. 工具名本身就是重要信号
  signals.push(toolName)

  // 2. 提取错误码 (ENOENT, EPERM, etc.)
  const codes = errorMessage.match(ERROR_CODE_REGEX)
  if (codes) {
    for (const code of codes) {
      if (!signals.includes(code.toLowerCase())) {
        signals.push(code.toLowerCase())
      }
    }
  }

  // 3. 匹配预定义关键词
  for (const kw of ERROR_KEYWORDS) {
    if (lowerError.includes(kw) && !signals.includes(kw)) {
      signals.push(kw)
    }
  }

  // 4. 错误消息子串 (截取前 100 字符，用于精确匹配)
  const snippet = errorMessage.slice(0, 100).trim()
  if (snippet && !signals.includes(snippet.toLowerCase())) {
    signals.push(snippet.toLowerCase())
  }

  return signals
}

/**
 * 测试单个模式是否匹配任一信号
 * 支持 EvoMap 风格的 /regex/flags 和普通子串匹配
 */
function matchPattern(pattern: string, signals: string[]): boolean {
  // 正则模式: /pattern/flags
  const regexMatch = pattern.match(/^\/(.+)\/([gimsuy]*)$/)
  if (regexMatch) {
    try {
      const re = new RegExp(regexMatch[1], regexMatch[2])
      return signals.some(s => re.test(s))
    } catch {
      // 无效正则降级为子串匹配
    }
  }

  // 子串匹配 (case-insensitive)
  const lowerPattern = pattern.toLowerCase()
  return signals.some(s => s.includes(lowerPattern) || lowerPattern.includes(s))
}

/**
 * 计算单个基因与信号集的匹配分数
 * 返回匹配的信号数量和命中列表
 */
export function scoreGene(gene: Gene, signals: string[]): { score: number; matchedSignals: string[] } {
  const matchedSignals: string[] = []

  for (const pattern of gene.signals_match) {
    if (matchPattern(pattern, signals)) {
      matchedSignals.push(pattern)
    }
  }

  return { score: matchedSignals.length, matchedSignals }
}

/**
 * 在基因库中查找与当前信号匹配的基因，按分数降序排列
 */
export function rankGenes(signals: string[], genes: Gene[]): GeneMatch[] {
  const matches: GeneMatch[] = []

  for (const gene of genes) {
    // 跳过置信度过低的废弃基因
    if (gene.metadata.confidence < 0.1 && gene.metadata.useCount > 5) {
      continue
    }

    const { score, matchedSignals } = scoreGene(gene, signals)
    if (score > 0) {
      matches.push({ gene, score, matchedSignals })
    }
  }

  // 按分数降序，相同分数按置信度降序
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.gene.metadata.confidence - a.gene.metadata.confidence
  })

  return matches
}

/**
 * 计算两组信号的重叠度 (0-1)
 * 用于防重复基因检测
 */
export function signalOverlap(signalsA: string[], signalsB: string[]): number {
  if (signalsA.length === 0 || signalsB.length === 0) return 0

  const setB = new Set(signalsB.map(s => s.toLowerCase()))
  const overlap = signalsA.filter(s => setB.has(s.toLowerCase())).length
  const maxLen = Math.max(signalsA.length, signalsB.length)

  return overlap / maxLen
}
