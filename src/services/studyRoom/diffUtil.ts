/**
 * diffUtil — 轻量级行级 diff 工具 (用于版本历史对比)
 *
 * 选型说明: 没有引入第三方 diff 库 (如 diff-match-patch / jsdiff), 原因:
 *   1. 依赖体积考虑 — Markdown 段落级 diff 用 LCS 算法足够, 不需要字符级精度
 *   2. 自习室文章通常 < 5000 字, LCS O(n*m) 完全可接受
 *   3. 展示层是"摘要 + 可展开 diff", 对 diff 精度的容忍度较高
 *
 * 算法: 经典 Longest Common Subsequence (LCS), 输出 unified diff 块.
 */

export type DiffOp = 'equal' | 'add' | 'remove'

export interface DiffLine {
  op: DiffOp
  text: string
  /** 左侧 (旧版) 行号, op === 'add' 时为 null */
  oldLineNo: number | null
  /** 右侧 (新版) 行号, op === 'remove' 时为 null */
  newLineNo: number | null
}

/**
 * 连续的变更块 — 用于折叠展示 (只保留变更附近 context, 大块未变更区域折叠).
 */
export interface DiffHunk {
  lines: DiffLine[]
  /** 本 hunk 的新增行数 */
  addCount: number
  /** 本 hunk 的删除行数 */
  removeCount: number
}

export interface DiffStats {
  addedLines: number
  removedLines: number
  /** 纯文本字数变化 (去空白) */
  wordCountDelta: number
}

export interface DiffResult {
  hunks: DiffHunk[]
  stats: DiffStats
  /** 是否完全相同 (没有任何变更) */
  identical: boolean
}

/** 按换行切分, 保留空行以忠实反映段落间距 */
function splitLines(text: string): string[] {
  if (!text) return []
  // 统一换行符
  return text.replace(/\r\n/g, '\n').split('\n')
}

function countWords(text: string): number {
  return text.replace(/\s/g, '').length
}

/**
 * LCS 动态规划 — 返回 DP 表 (只填长度, 不存回溯路径, 回溯时重算).
 *
 * 性能保护: 当 a.length * b.length > MAX_DP_CELLS 时 (约 400w 格, 即 2000x2000 行),
 * 直接降级为"全替换"的 diff, 避免前端卡死.
 */
const MAX_DP_CELLS = 4_000_000

function computeLcsTable(a: string[], b: string[]): number[][] | null {
  const m = a.length
  const n = b.length
  if (m * n > MAX_DP_CELLS) return null

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  return dp
}

/** 回溯 DP 表生成 DiffLine 序列 (按原文顺序) */
function backtrack(a: string[], b: string[], dp: number[][]): DiffLine[] {
  const lines: DiffLine[] = []
  let i = a.length
  let j = b.length
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lines.push({ op: 'equal', text: a[i - 1], oldLineNo: i, newLineNo: j })
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      lines.push({ op: 'remove', text: a[i - 1], oldLineNo: i, newLineNo: null })
      i--
    } else {
      lines.push({ op: 'add', text: b[j - 1], oldLineNo: null, newLineNo: j })
      j--
    }
  }
  while (i > 0) {
    lines.push({ op: 'remove', text: a[i - 1], oldLineNo: i, newLineNo: null })
    i--
  }
  while (j > 0) {
    lines.push({ op: 'add', text: b[j - 1], oldLineNo: null, newLineNo: j })
    j--
  }
  return lines.reverse()
}

/** 降级方案: 整块替换 */
function fallbackFullReplace(a: string[], b: string[]): DiffLine[] {
  const lines: DiffLine[] = []
  a.forEach((text, idx) => {
    lines.push({ op: 'remove', text, oldLineNo: idx + 1, newLineNo: null })
  })
  b.forEach((text, idx) => {
    lines.push({ op: 'add', text, oldLineNo: null, newLineNo: idx + 1 })
  })
  return lines
}

/**
 * 把线性的 DiffLine 序列切分为 hunks:
 * - 连续的 equal 段落 >= CONTEXT_LINES * 2 + 1 时, 中间会被折叠
 * - 每个 hunk 保留前后各 CONTEXT_LINES 行上下文
 */
const CONTEXT_LINES = 2

function buildHunks(lines: DiffLine[]): DiffHunk[] {
  if (lines.length === 0) return []

  // 找出所有变更行的索引
  const changeIndices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].op !== 'equal') changeIndices.push(i)
  }
  if (changeIndices.length === 0) return []

  // 合并相邻的变更索引 (中间隔 <= 2*CONTEXT_LINES 行 equal 时合并为一个 hunk)
  const ranges: Array<{ start: number; end: number }> = []
  let curStart = Math.max(0, changeIndices[0] - CONTEXT_LINES)
  let curEnd = Math.min(lines.length - 1, changeIndices[0] + CONTEXT_LINES)

  for (let k = 1; k < changeIndices.length; k++) {
    const idx = changeIndices[k]
    if (idx - CONTEXT_LINES <= curEnd + 1) {
      curEnd = Math.min(lines.length - 1, idx + CONTEXT_LINES)
    } else {
      ranges.push({ start: curStart, end: curEnd })
      curStart = Math.max(0, idx - CONTEXT_LINES)
      curEnd = Math.min(lines.length - 1, idx + CONTEXT_LINES)
    }
  }
  ranges.push({ start: curStart, end: curEnd })

  return ranges.map((r) => {
    const hunkLines = lines.slice(r.start, r.end + 1)
    let addCount = 0
    let removeCount = 0
    for (const l of hunkLines) {
      if (l.op === 'add') addCount++
      else if (l.op === 'remove') removeCount++
    }
    return { lines: hunkLines, addCount, removeCount }
  })
}

/**
 * 对两个文本做行级 diff.
 *
 * @param oldText 旧版本文本
 * @param newText 新版本文本
 * @returns DiffResult: 包含 hunks (按变更分块, 已折叠未变更区域) 与统计信息
 */
export function diffText(oldText: string, newText: string): DiffResult {
  const a = splitLines(oldText)
  const b = splitLines(newText)

  const dp = computeLcsTable(a, b)
  const lines = dp ? backtrack(a, b, dp) : fallbackFullReplace(a, b)

  let addedLines = 0
  let removedLines = 0
  for (const l of lines) {
    if (l.op === 'add') addedLines++
    else if (l.op === 'remove') removedLines++
  }

  const hunks = buildHunks(lines)
  const identical = addedLines === 0 && removedLines === 0

  return {
    hunks,
    stats: {
      addedLines,
      removedLines,
      wordCountDelta: countWords(newText) - countWords(oldText),
    },
    identical,
  }
}

/**
 * 生成一句话变更概述 (用于下拉菜单列表项的 subtitle).
 * 如: "+120 字 / -38 字"  或  "无变化"
 */
export function summarizeDiffStats(stats: DiffStats): string {
  if (stats.addedLines === 0 && stats.removedLines === 0) return '无变化'
  const parts: string[] = []
  const { wordCountDelta } = stats
  if (wordCountDelta > 0) parts.push(`+${wordCountDelta} 字`)
  else if (wordCountDelta < 0) parts.push(`${wordCountDelta} 字`)
  if (stats.addedLines > 0) parts.push(`+${stats.addedLines} 行`)
  if (stats.removedLines > 0) parts.push(`-${stats.removedLines} 行`)
  return parts.join(' · ')
}
