/**
 * writerProfile — 自习室专用的"写作风格档案"
 *
 * 设计要点:
 * - 与 DunCrew 全局 L0/L1 记忆系统**独立存储**, 避免事实类记忆污染风格判断
 * - 存储在 localStorage['studyRoom:writerProfile'], 前端即写即读, 秒级可用
 * - 不进 /api/memory/* 端点, 所以不会被 ReAct 召回到
 * - 读取时向写作 prompt 注入"风格偏好"段落 + "避免清单", 作为硬约束
 * - 写入触发点:
 *     1. Tool Loop 里的 append_to_memory 被判定为风格类时 (由 toolCaller 分流)
 *     2. 文章完成时自动统计 genreHistogram
 *     3. (未来) 离线提炼脚本产出的推断性偏好
 *
 * 为什么不复用 L0/L1:
 * - L0/L1 的衰减半衰期 30 天适合任务执行, 不适合写作偏好 (应 180 天起)
 * - L0/L1 schema 带 toolName/resultPreview 等, 对风格偏好是噪声
 * - L0/L1 被 ReAct 召回, 会让写作偏好混入上下文造成污染
 *
 * 但**复用以下设计思路** (非代码复用):
 * - 置信度 [0, 1] + 多信号累积
 * - "明确反馈 > 推断" 的优先级
 */

import type { GenreHint } from '@/types'

const STORAGE_KEY = 'studyRoom:writerProfile'
const SCHEMA_VERSION = 1

// ============================================
// Schema
// ============================================

export type PreferenceCategory =
  | 'style'       // 语言风格 (正式度、人称、口吻)
  | 'structure'   // 结构偏好 (开头/结尾/段落节奏)
  | 'vocabulary'  // 词汇倾向 (喜欢/讨厌某类词)
  | 'citation'    // 引用方式
  | 'topic'       // 话题倾向

export interface WriterPreference {
  id: string
  content: string                  // 人类可读的偏好描述, 如 "喜欢用数据支撑观点"
  category: PreferenceCategory
  confidence: number               // [0, 1], 初始 0.35, 每次正反馈 +0.15, 负反馈 -0.2
  signalCount: number              // 累积信号次数, 用于置信度加权
  genre?: GenreHint                // 如果偏好只在某种体裁下成立
  createdAt: number
  updatedAt: number
}

export interface WriterProfile {
  version: number
  /** 明确偏好清单 (由 append_to_memory 分流写入, 或离线提炼) */
  preferences: WriterPreference[]
  /** 用户明确说过"别这样"的黑名单 (1-2 句话) */
  avoidPatterns: string[]
  /** 各体裁出现次数, 用于判断用户写作领域分布 */
  genreHistogram: Partial<Record<GenreHint, number>>
  /** 最近一次更新时间 */
  updatedAt: number
}

// ============================================
// 常量
// ============================================

const DEFAULTS = {
  INITIAL_CONFIDENCE: 0.35,
  POSITIVE_BOOST: 0.15,
  NEGATIVE_PENALTY: 0.2,
  MAX_PREFERENCES: 40,
  MAX_AVOID_PATTERNS: 20,
  /** Prompt 注入时, 只取 confidence >= 此阈值的偏好 */
  INJECTION_CONFIDENCE_THRESHOLD: 0.4,
} as const

function createEmpty(): WriterProfile {
  return {
    version: SCHEMA_VERSION,
    preferences: [],
    avoidPatterns: [],
    genreHistogram: {},
    updatedAt: Date.now(),
  }
}

// ============================================
// 存储读写
// ============================================

export function loadWriterProfile(): WriterProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createEmpty()
    const parsed = JSON.parse(raw) as WriterProfile
    // 简单 schema 校验
    if (!parsed || typeof parsed !== 'object' || parsed.version !== SCHEMA_VERSION) {
      return createEmpty()
    }
    return {
      version: SCHEMA_VERSION,
      preferences: Array.isArray(parsed.preferences) ? parsed.preferences : [],
      avoidPatterns: Array.isArray(parsed.avoidPatterns) ? parsed.avoidPatterns : [],
      genreHistogram: parsed.genreHistogram || {},
      updatedAt: parsed.updatedAt || Date.now(),
    }
  } catch (err) {
    console.warn('[writerProfile] load failed, using empty:', err)
    return createEmpty()
  }
}

function saveWriterProfile(profile: WriterProfile): void {
  try {
    profile.updatedAt = Date.now()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  } catch (err) {
    console.warn('[writerProfile] save failed:', err)
  }
}

// ============================================
// 内容分类器: 判断一条 append_to_memory 应该进哪里
// ============================================

/** 明确的"避免"信号 */
const AVOID_PATTERNS = /不喜欢|别用|不要用|避免|讨厌|受不了|过敏|反感/

/** 风格偏好信号 (分类时用) */
const CATEGORY_RULES: Array<[RegExp, PreferenceCategory]> = [
  [/(语气|口吻|人称|正式|严谨|活泼|幽默|口语|书面|腔调|文风)/, 'style'],
  [/(结构|开头|结尾|段落|节奏|骨架|分节|小标题|提纲)/, 'structure'],
  [/(词|成语|术语|口头禅|用语|措辞|表述)/, 'vocabulary'],
  [/(引用|参考文献|出处|来源|[^\s]注脚|脚注)/, 'citation'],
  [/(话题|题材|主题|选题|领域|方向)/, 'topic'],
]

/** 判断内容是否属于"风格偏好类"记忆 (而非事实类) */
export function classifyMemoryContent(content: string): {
  kind: 'profile' | 'global'
  category?: PreferenceCategory
  isAvoid: boolean
} {
  const text = content.trim()
  if (!text) return { kind: 'global', isAvoid: false }

  // 明确的偏好词
  const hasPreferenceWord = /偏好|习惯|喜欢|擅长|倾向|常用|一般都|总是|从不|默认/.test(text)
  const isAvoid = AVOID_PATTERNS.test(text)

  // 命中类别规则
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(text)) {
      return { kind: 'profile', category: cat, isAvoid }
    }
  }

  // 虽没命中类别但有明确偏好/避免词, 也归风格档案
  if (hasPreferenceWord || isAvoid) {
    return { kind: 'profile', category: 'style', isAvoid }
  }

  // 否则默认进全局记忆 (事实类)
  return { kind: 'global', isAvoid: false }
}

// ============================================
// 写入 API
// ============================================

function makeId(): string {
  return `wp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 追加一条偏好到档案
 * 如果内容与已有偏好高度相似, 做合并 (提升 confidence 而非新增)
 */
export function appendPreference(
  content: string,
  opts?: { category?: PreferenceCategory; genre?: GenreHint; confidence?: number },
): { profile: WriterProfile; action: 'added' | 'reinforced'; pref: WriterPreference } {
  const profile = loadWriterProfile()
  const clean = content.trim()
  if (!clean) {
    const fallback: WriterPreference = {
      id: makeId(),
      content: clean,
      category: opts?.category || 'style',
      confidence: 0,
      signalCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return { profile, action: 'added', pref: fallback }
  }

  // 相似度: 简单子串/Jaccard 近似, 足够 MVP 用
  const similar = profile.preferences.find((p) => isSimilar(p.content, clean))

  if (similar) {
    similar.confidence = Math.min(1, similar.confidence + DEFAULTS.POSITIVE_BOOST)
    similar.signalCount += 1
    similar.updatedAt = Date.now()
    // 内容若更详细则更新为新的
    if (clean.length > similar.content.length + 20) {
      similar.content = clean
    }
    saveWriterProfile(profile)
    return { profile, action: 'reinforced', pref: similar }
  }

  const pref: WriterPreference = {
    id: makeId(),
    content: clean,
    category: opts?.category || 'style',
    confidence: opts?.confidence ?? DEFAULTS.INITIAL_CONFIDENCE,
    signalCount: 1,
    genre: opts?.genre,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  profile.preferences.push(pref)

  // 超过上限时淘汰: 按 confidence * recency 打分, 保留最高的 MAX_PREFERENCES 条
  if (profile.preferences.length > DEFAULTS.MAX_PREFERENCES) {
    profile.preferences.sort((a, b) => scorePreference(b) - scorePreference(a))
    profile.preferences = profile.preferences.slice(0, DEFAULTS.MAX_PREFERENCES)
  }

  saveWriterProfile(profile)
  return { profile, action: 'added', pref }
}

/**
 * 应用一条"待确认的档案建议" (由 UI 层接受按钮触发).
 *
 * 设计: toolCaller 现在不再让 LLM 直接写档案, 而是把要写的内容产出成
 * ProfileSuggestion 回传给 UI; 只有用户点"接受"按钮时才调用这个函数真正入库.
 * 这样避免了"LLM 默默改风格档案, 用户无感知"的老问题.
 *
 * 返回 writerProfile + action 语义 (与直写 appendPreference / appendAvoidPattern 保持一致).
 */
export function applyProfileSuggestion(suggestion: {
  kind: 'preference' | 'avoid'
  content: string
  category?: PreferenceCategory
}): { profile: WriterProfile; action: 'added' | 'reinforced' | 'skipped' } {
  const clean = suggestion.content.trim()
  if (!clean) {
    return { profile: loadWriterProfile(), action: 'skipped' }
  }
  if (suggestion.kind === 'avoid') {
    const before = loadWriterProfile()
    const beforeCount = before.avoidPatterns.length
    const profile = appendAvoidPattern(clean)
    // appendAvoidPattern 对已存在的相似项会跳过 (不新增), 这种情况下长度不变
    const action: 'added' | 'skipped' = profile.avoidPatterns.length > beforeCount ? 'added' : 'skipped'
    return { profile, action }
  }
  const result = appendPreference(clean, { category: suggestion.category })
  return { profile: result.profile, action: result.action }
}

/**
 * 追加一条"避免清单"
 */
export function appendAvoidPattern(content: string): WriterProfile {
  const profile = loadWriterProfile()
  const clean = content.trim()
  if (!clean) return profile

  // 已有高度相似的就跳过
  const exists = profile.avoidPatterns.some((p) => isSimilar(p, clean))
  if (exists) return profile

  profile.avoidPatterns.unshift(clean)
  if (profile.avoidPatterns.length > DEFAULTS.MAX_AVOID_PATTERNS) {
    profile.avoidPatterns = profile.avoidPatterns.slice(0, DEFAULTS.MAX_AVOID_PATTERNS)
  }
  saveWriterProfile(profile)
  return profile
}

/**
 * 文章完成时调用: 记录体裁出现次数
 */
export function recordArticleCompletion(genre: GenreHint): void {
  const profile = loadWriterProfile()
  profile.genreHistogram[genre] = (profile.genreHistogram[genre] || 0) + 1
  saveWriterProfile(profile)
}

// ============================================
// 读取 API (给 prompt 构造用)
// ============================================

export interface WriterStyleContext {
  preferences: WriterPreference[]
  avoidPatterns: string[]
  dominantGenre?: GenreHint
}

/**
 * 获取用于注入 prompt 的风格上下文
 * - 过滤 confidence 过低的偏好
 * - 若指定 genre, 优先返回该 genre 下的偏好 + 通用偏好
 */
export function getStyleContext(genre?: GenreHint): WriterStyleContext {
  const profile = loadWriterProfile()

  const filtered = profile.preferences
    .filter((p) => p.confidence >= DEFAULTS.INJECTION_CONFIDENCE_THRESHOLD)
    .filter((p) => !p.genre || p.genre === genre)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10) // 最多塞 10 条进 prompt

  // 判断主导体裁
  let dominantGenre: GenreHint | undefined
  let maxCount = 0
  for (const [g, c] of Object.entries(profile.genreHistogram)) {
    if (c && c > maxCount) {
      maxCount = c
      dominantGenre = g as GenreHint
    }
  }

  return {
    preferences: filtered,
    avoidPatterns: profile.avoidPatterns.slice(0, 8),
    dominantGenre,
  }
}

// ============================================
// 内部工具
// ============================================

function isSimilar(a: string, b: string): boolean {
  if (!a || !b) return false
  const sa = a.replace(/\s+/g, '')
  const sb = b.replace(/\s+/g, '')
  if (sa === sb) return true
  // 短串子串判定
  if (sa.length < 40 && (sb.includes(sa) || sa.includes(sb))) return true
  // Jaccard on 2-gram
  const ga = nGrams(sa, 2)
  const gb = nGrams(sb, 2)
  if (ga.size === 0 || gb.size === 0) return false
  let inter = 0
  for (const x of ga) if (gb.has(x)) inter++
  const jaccard = inter / (ga.size + gb.size - inter)
  return jaccard >= 0.6
}

function nGrams(s: string, n: number): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i <= s.length - n; i++) out.add(s.slice(i, i + n))
  return out
}

function scorePreference(p: WriterPreference): number {
  const ageDays = (Date.now() - p.updatedAt) / (24 * 3600 * 1000)
  // 写作偏好半衰期按 180 天 (远比 L0/L1 的 30 天长)
  const recency = Math.exp(-ageDays / 180)
  return p.confidence * 0.7 + recency * 0.3
}
