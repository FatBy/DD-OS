/**
 * Citation Parser — 引用标记解析
 * 解析 [^Lxx] / [^Sxx] 格式的引用标记
 */

import type { InlineCitation, Footnote, EvidenceItem } from '@/types'

/** 匹配 [^L12], [^S3] 等引用标记 */
const CITATION_REGEX = /\[\^([LMSWE])(\d+)\]/g

/**
 * 从草稿正文中解析所有引用标记
 */
export function parseCitations(draftBody: string): InlineCitation[] {
  const citations: InlineCitation[] = []
  const seen = new Set<string>()

  let match: RegExpExecArray | null
  // 重置 lastIndex
  CITATION_REGEX.lastIndex = 0
  while ((match = CITATION_REGEX.exec(draftBody)) !== null) {
    const marker = match[0]       // [^L12]
    const lens = match[1]         // L
    const num = match[2]          // 12
    const label = `${lens}${num}` // L12

    if (!seen.has(label)) {
      seen.add(label)
      citations.push({
        marker,
        evidenceId: label,  // 临时 ID, resolveFootnotes 会做映射
      })
    }
  }

  return citations
}

/**
 * 将引用标记映射到实际的 EvidenceItem, 生成脚注列表
 */
export function resolveFootnotes(
  citations: InlineCitation[],
  pool: EvidenceItem[],
): Footnote[] {
  // 构建索引: pool 中第 i 个 L 类型的 item 对应 L{i+1}
  const lensCounters: Record<string, number> = {}
  const labelToEvidence = new Map<string, EvidenceItem>()

  for (const item of pool) {
    const lens = item.lens
    lensCounters[lens] = (lensCounters[lens] || 0) + 1
    const label = `${lens}${lensCounters[lens]}`
    labelToEvidence.set(label, item)
  }

  return citations
    .map((c): Footnote | null => {
      const evidence = labelToEvidence.get(c.evidenceId)
      if (!evidence) return null
      return {
        marker: c.marker,
        evidenceId: evidence.id,
        label: c.evidenceId,
      }
    })
    .filter((f): f is Footnote => f !== null)
}

/**
 * 一步到位: 解析 + 映射
 */
export function extractFootnotes(draftBody: string, pool: EvidenceItem[]): Footnote[] {
  const citations = parseCitations(draftBody)
  return resolveFootnotes(citations, pool)
}
