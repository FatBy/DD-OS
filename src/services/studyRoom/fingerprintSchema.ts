/**
 * fingerprintSchema — 风格指纹的 Schema 与 3 形态解析/渲染共享模块
 *
 * 为什么独立成文件:
 *   DistillDialog (LLM 解析 + Preview 渲染) / FingerprintPanel (详情展开) / prompts.ts
 *   (AI 写作时注入) 三处都要用同一套 "维度 → 中文标签" + "3 形态 → 渲染/解析" 规则.
 *   放在这里集中维护, 避免各处自行拼装造成漂移.
 *
 * 3 形态约定 (与 types.ts 的 EnumPairField / EnumField / AppealBalanceField 对齐):
 *   - 描述型: string
 *   - 枚举型 (EnumPairField): { primary, secondary?, description }
 *   - 枚举型 (EnumField):     { type, description }
 *   - 配比型 (AppealBalanceField): { logos, pathos, ethos, description }
 */

import {
  ARGUMENT_PATTERNS,
  EVIDENCE_PREFERENCES,
  COUNTER_ARG_HANDLINGS,
  ARGUMENT_DEPTHS,
  CREDIBILITY_PERSONAS,
  CERTAINTY_LEVELS,
  EMOTIONAL_TEMPERATURES,
  READER_DISTANCES,
  HOOK_PATTERNS,
  PACING_PATTERNS,
  CLOSING_PATTERNS,
  type WriterFingerprintProfile,
  type EnumField,
  type EnumPairField,
  type AppealBalanceField,
  type ArgumentPatternType,
  type EvidencePreferenceType,
  type CounterArgHandlingType,
  type ArgumentDepthType,
  type CredibilityPersonaType,
  type CertaintyLevelType,
  type EmotionalTemperatureType,
  type ReaderDistanceType,
  type HookPatternType,
  type PacingPatternType,
  type ClosingPatternType,
} from '@/types'

// ============================================================
// 枚举值 → 中文标签
// ============================================================

export const ARGUMENT_PATTERN_LABELS: Record<ArgumentPatternType, string> = {
  deductive: '演绎',
  inductive: '归纳',
  analogical: '类比',
  counterfactual: '反证',
  abductive: '溯因',
  authority: '权威援引',
}

export const EVIDENCE_PREFERENCE_LABELS: Record<EvidencePreferenceType, string> = {
  data: '数据',
  case: '案例',
  classic: '经典',
  personal: '个人经验',
  thoughtExperiment: '思想实验',
  commonSense: '常识',
}

export const COUNTER_ARG_HANDLING_LABELS: Record<CounterArgHandlingType, string> = {
  preemptive: '预判反驳',
  ignore: '全程忽视',
  acknowledge: '承认但不展开',
  confront: '正面硬刚',
}

export const ARGUMENT_DEPTH_LABELS: Record<ArgumentDepthType, string> = {
  'one-hop': '单跳',
  'two-hop': '两跳',
  'multi-hop': '多跳',
}

export const CREDIBILITY_PERSONA_LABELS: Record<CredibilityPersonaType, string> = {
  expert: '专家',
  oldFriend: '老友',
  witness: '见证人',
  observer: '旁观者',
  prophet: '先知',
}

export const CERTAINTY_LEVEL_LABELS: Record<CertaintyLevelType, string> = {
  assertive: '断言',
  confident: '自信',
  balanced: '平衡',
  cautious: '审慎',
  tentative: '试探',
}

export const EMOTIONAL_TEMPERATURE_LABELS: Record<EmotionalTemperatureType, string> = {
  cool: '冷静',
  angry: '愤怒',
  warm: '温和',
  playful: '戏谑',
  sardonic: '讽刺',
  reverent: '庄重',
}

export const READER_DISTANCE_LABELS: Record<ReaderDistanceType, string> = {
  lecturer: '训话',
  peer: '同辈',
  friend: '朋友',
  stranger: '陌生人',
  confessor: '倾诉',
}

export const HOOK_PATTERN_LABELS: Record<HookPatternType, string> = {
  scene: '场景',
  question: '提问',
  counterintuitive: '反常识',
  quotation: '引用',
  data: '数据',
  personal: '自述',
  direct: '直入',
}

export const PACING_PATTERN_LABELS: Record<PacingPatternType, string> = {
  linear: '平铺直叙',
  spiral: '螺旋深挖',
  dualTrack: '对比双线',
  peelingLayers: '逐层剥笋',
  scatteredConverge: '散点归宗',
}

export const CLOSING_PATTERN_LABELS: Record<ClosingPatternType, string> = {
  aphorism: '金句',
  echo: '回环',
  question: '反问',
  callToAction: '号召',
  openEnding: '留白',
  selfDeprecation: '自嘲',
}

// ============================================================
// 维度字段 → 中文标签 + 所属层 + 形态
// ============================================================

export type ProfileFormShape = 'string' | 'enumPair' | 'enum' | 'appeal'

export interface ProfileFieldSpec {
  key: keyof WriterFingerprintProfile
  label: string
  /** 所属 6 大分层 */
  layer: 'micro' | 'discourse' | 'persuasion' | 'stance' | 'semantics' | 'macro'
  /** 形态 */
  shape: ProfileFormShape
  /** 枚举字段的可选值 (枚举型必填) */
  enumValues?: readonly string[]
  /** 枚举值 → 中文 (枚举型必填) */
  enumLabels?: Record<string, string>
  /** 是否属于意象/主题层 (样本 < 3 时跳过) */
  requiresMultiSample?: boolean
}

export const LAYER_LABELS: Record<ProfileFieldSpec['layer'], string> = {
  micro: '微观语言层',
  discourse: '话语/论证层',
  persuasion: '说服力层',
  stance: '态度层',
  semantics: '意象/主题层',
  macro: '宏观结构层',
}

export const PROFILE_FIELD_SPECS: ProfileFieldSpec[] = [
  // 微观语言层 (描述型)
  { key: 'sentenceStyle',    label: '句式特点', layer: 'micro', shape: 'string' },
  { key: 'rhetoric',         label: '修辞偏好', layer: 'micro', shape: 'string' },
  { key: 'vocabulary',       label: '词汇倾向', layer: 'micro', shape: 'string' },
  { key: 'paragraphing',     label: '段落组织', layer: 'micro', shape: 'string' },
  { key: 'citation',         label: '引用方式', layer: 'micro', shape: 'string' },
  { key: 'avoid',            label: '明确避免', layer: 'micro', shape: 'string' },

  // 话语/论证层
  { key: 'argumentPattern',  label: '论证模式', layer: 'discourse', shape: 'enumPair',
    enumValues: ARGUMENT_PATTERNS, enumLabels: ARGUMENT_PATTERN_LABELS },
  { key: 'evidencePreference', label: '证据偏好', layer: 'discourse', shape: 'enumPair',
    enumValues: EVIDENCE_PREFERENCES, enumLabels: EVIDENCE_PREFERENCE_LABELS },
  { key: 'counterArgHandling', label: '反方处理', layer: 'discourse', shape: 'enum',
    enumValues: COUNTER_ARG_HANDLINGS, enumLabels: COUNTER_ARG_HANDLING_LABELS },
  { key: 'argumentDepth',    label: '论证深度', layer: 'discourse', shape: 'enum',
    enumValues: ARGUMENT_DEPTHS, enumLabels: ARGUMENT_DEPTH_LABELS },
  { key: 'transitionStyle',  label: '过渡方式', layer: 'discourse', shape: 'string' },
  { key: 'informationDensity', label: '信息密度', layer: 'discourse', shape: 'string' },

  // 说服力层
  { key: 'appealBalance',    label: 'Logos/Pathos/Ethos', layer: 'persuasion', shape: 'appeal' },
  { key: 'emotionalTriggers', label: '情绪调动手法', layer: 'persuasion', shape: 'string' },
  { key: 'credibilityBuilding', label: '可信度建立', layer: 'persuasion', shape: 'enum',
    enumValues: CREDIBILITY_PERSONAS, enumLabels: CREDIBILITY_PERSONA_LABELS },

  // 态度层
  { key: 'certaintyLevel',   label: '确定性程度', layer: 'stance', shape: 'enum',
    enumValues: CERTAINTY_LEVELS, enumLabels: CERTAINTY_LEVEL_LABELS },
  { key: 'emotionalTemperature', label: '情感温度', layer: 'stance', shape: 'enum',
    enumValues: EMOTIONAL_TEMPERATURES, enumLabels: EMOTIONAL_TEMPERATURE_LABELS },
  { key: 'readerDistance',   label: '读者距离', layer: 'stance', shape: 'enum',
    enumValues: READER_DISTANCES, enumLabels: READER_DISTANCE_LABELS },

  // 意象/主题层 (样本 < 3 跳过)
  { key: 'frequentImagery',  label: '高频意象', layer: 'semantics', shape: 'string', requiresMultiSample: true },
  { key: 'metaphorDomain',   label: '隐喻来源', layer: 'semantics', shape: 'string', requiresMultiSample: true },
  { key: 'referencePreference', label: '引用偏好', layer: 'semantics', shape: 'string', requiresMultiSample: true },

  // 宏观结构层
  { key: 'hookPattern',      label: '开篇策略', layer: 'macro', shape: 'enum',
    enumValues: HOOK_PATTERNS, enumLabels: HOOK_PATTERN_LABELS },
  { key: 'pacingPattern',    label: '推进节奏', layer: 'macro', shape: 'enum',
    enumValues: PACING_PATTERNS, enumLabels: PACING_PATTERN_LABELS },
  { key: 'turnPoints',       label: '转折设置', layer: 'macro', shape: 'string' },
  { key: 'closingPattern',   label: '收尾策略', layer: 'macro', shape: 'enum',
    enumValues: CLOSING_PATTERNS, enumLabels: CLOSING_PATTERN_LABELS },
]

/** 按 layer 分组的规格 (渲染时保持顺序稳定) */
export const PROFILE_FIELD_SPECS_BY_LAYER: Array<{
  layer: ProfileFieldSpec['layer']
  label: string
  fields: ProfileFieldSpec[]
}> = (['micro', 'discourse', 'persuasion', 'stance', 'semantics', 'macro'] as const).map((layer) => ({
  layer,
  label: LAYER_LABELS[layer],
  fields: PROFILE_FIELD_SPECS.filter((s) => s.layer === layer),
}))

/** 通过 key 快速查规格 */
const SPEC_BY_KEY = new Map(PROFILE_FIELD_SPECS.map((s) => [s.key, s] as const))
export function getProfileFieldSpec(key: keyof WriterFingerprintProfile): ProfileFieldSpec | undefined {
  return SPEC_BY_KEY.get(key)
}

// ============================================================
// 解析器 (LLM 返回的 JSON → 受类型约束的 Profile)
// ============================================================

function nonEmptyString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed ? trimmed : null
}

export function parseStringField(raw: unknown): string | undefined {
  const s = nonEmptyString(raw)
  return s ?? undefined
}

export function parseEnumField<T extends string>(
  raw: unknown,
  allowed: readonly T[],
): EnumField<T> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const type = typeof obj.type === 'string' ? obj.type : null
  const desc = nonEmptyString(obj.description)
  if (!type || !desc) return undefined
  if (!allowed.includes(type as T)) return undefined
  return { type: type as T, description: desc }
}

export function parseEnumPairField<T extends string>(
  raw: unknown,
  allowed: readonly T[],
): EnumPairField<T> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const primary = typeof obj.primary === 'string' ? obj.primary : null
  const desc = nonEmptyString(obj.description)
  if (!primary || !desc) return undefined
  if (!allowed.includes(primary as T)) return undefined
  const result: EnumPairField<T> = { primary: primary as T, description: desc }
  if (typeof obj.secondary === 'string' && allowed.includes(obj.secondary as T) && obj.secondary !== primary) {
    result.secondary = obj.secondary as T
  }
  return result
}

/**
 * 归一化 Logos/Pathos/Ethos:
 *   - 任一维度不是 [0,1] 的有限数 → 尝试救回 (截断或替换为 0)
 *   - 总和偏离 1 超过 0.05 → 整体归一化到 1
 *   - 全 0 (LLM 没理解) → 返回 undefined
 */
export function normalizeAppealBalance(raw: unknown): AppealBalanceField | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const desc = nonEmptyString(obj.description)
  if (!desc) return undefined

  const clamp01 = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) return 0
    if (n < 0) return 0
    if (n > 1) return 1
    return n
  }
  let logos = clamp01(obj.logos)
  let pathos = clamp01(obj.pathos)
  let ethos = clamp01(obj.ethos)
  const sum = logos + pathos + ethos
  if (sum <= 0) return undefined
  if (Math.abs(sum - 1) > 0.05) {
    logos = logos / sum
    pathos = pathos / sum
    ethos = ethos / sum
  }
  return {
    logos: Math.round(logos * 1000) / 1000,
    pathos: Math.round(pathos * 1000) / 1000,
    ethos: Math.round(ethos * 1000) / 1000,
    description: desc,
  }
}

/**
 * LLM 返回的 JSON → 严格校验过的 WriterFingerprintProfile
 *
 * 行为:
 *   - 按 PROFILE_FIELD_SPECS 遍历, 每个字段按 shape 走对应解析器
 *   - 字段类型不对 / 枚举值非法 / 描述为空 → 丢弃该字段 (不抛错)
 *   - 同时返回 warnings 供日志展示 "哪些字段被丢弃了"
 */
export function parseProfileFromLlm(raw: unknown): {
  profile: WriterFingerprintProfile
  warnings: string[]
} {
  const profile: WriterFingerprintProfile = {}
  const warnings: string[] = []
  if (!raw || typeof raw !== 'object') {
    return { profile, warnings: ['LLM 返回不是对象'] }
  }
  const obj = raw as Record<string, unknown>

  for (const spec of PROFILE_FIELD_SPECS) {
    const key = spec.key
    const value = obj[key]
    if (value === undefined || value === null) continue  // 未返回该字段是合法的

    if (spec.shape === 'string') {
      const parsed = parseStringField(value)
      if (parsed !== undefined) {
        ;(profile as Record<string, unknown>)[key] = parsed
      } else if (value !== '') {
        warnings.push(`字段 "${spec.label}" (${key}) 非字符串或为空, 已丢弃`)
      }
    } else if (spec.shape === 'enum') {
      const parsed = parseEnumField(value, spec.enumValues!)
      if (parsed) {
        ;(profile as Record<string, unknown>)[key] = parsed
      } else {
        warnings.push(`字段 "${spec.label}" (${key}) 枚举/描述不合法, 已丢弃`)
      }
    } else if (spec.shape === 'enumPair') {
      const parsed = parseEnumPairField(value, spec.enumValues!)
      if (parsed) {
        ;(profile as Record<string, unknown>)[key] = parsed
      } else {
        warnings.push(`字段 "${spec.label}" (${key}) 枚举/描述不合法, 已丢弃`)
      }
    } else if (spec.shape === 'appeal') {
      const parsed = normalizeAppealBalance(value)
      if (parsed) {
        profile.appealBalance = parsed
      } else {
        warnings.push(`字段 "${spec.label}" (${key}) 配比无效 (非 [0,1] 或和为 0), 已丢弃`)
      }
    }
  }

  // 向后兼容: 旧指纹返回的 opening / closing 字段也接进来 (纯字符串)
  const oldOpening = parseStringField(obj.opening)
  if (oldOpening) profile.opening = oldOpening
  const oldClosing = parseStringField(obj.closing)
  if (oldClosing) profile.closing = oldClosing

  return { profile, warnings }
}

// ============================================================
// 渲染辅助 (string 化 profile 字段, formatFingerprint / 日志 / Preview 共用)
// ============================================================

export interface ProfileFieldRenderOptions {
  /** 枚举字段是否转中文 (true) 还是用英文代号 (false) */
  labelInChinese?: boolean
}

/** 把任意 profile 字段值渲染成一行人类可读字符串, 不适用返回 null */
export function renderProfileFieldValue(
  spec: ProfileFieldSpec,
  value: WriterFingerprintProfile[keyof WriterFingerprintProfile],
  opts: ProfileFieldRenderOptions = { labelInChinese: true },
): string | null {
  if (value == null) return null
  const cn = opts.labelInChinese !== false

  if (spec.shape === 'string') {
    if (typeof value !== 'string') return null
    return value.trim() || null
  }
  if (spec.shape === 'appeal') {
    const v = value as AppealBalanceField
    if (typeof v !== 'object' || typeof v.logos !== 'number') return null
    const pct = (n: number) => `${Math.round(n * 100)}%`
    return `逻辑 ${pct(v.logos)} / 情感 ${pct(v.pathos)} / 人格 ${pct(v.ethos)} — ${v.description}`
  }
  if (spec.shape === 'enum') {
    const v = value as EnumField<string>
    if (typeof v !== 'object' || typeof v.type !== 'string') return null
    const head = cn ? (spec.enumLabels?.[v.type] ?? v.type) : v.type
    return `${head} — ${v.description}`
  }
  if (spec.shape === 'enumPair') {
    const v = value as EnumPairField<string>
    if (typeof v !== 'object' || typeof v.primary !== 'string') return null
    const labelOf = (t: string) => cn ? (spec.enumLabels?.[t] ?? t) : t
    const head = v.secondary
      ? `${labelOf(v.primary)} + ${labelOf(v.secondary)}`
      : labelOf(v.primary)
    return `${head} — ${v.description}`
  }
  return null
}

// ============================================================
// Prompt 构造 (LLM 提炼时用的 JSON Schema 说明)
// ============================================================

/**
 * 生成给 LLM 的 "请按此 Schema 输出" 说明.
 * 如 isMultiSample=false, 意象/主题层的字段会在 schema 里被标注 "本轮样本不足, 请输出 null 而不是猜测".
 */
export function buildProfileSchemaPrompt(isMultiSample: boolean): string {
  const lines: string[] = []
  lines.push('请输出一份 JSON, 按以下 Schema (每个字段都可省略或置 null):')
  lines.push('')

  for (const group of PROFILE_FIELD_SPECS_BY_LAYER) {
    lines.push(`### ${group.label}`)
    for (const spec of group.fields) {
      const multiSampleNote = spec.requiresMultiSample && !isMultiSample
        ? '  [本轮样本不足 3 篇, 请直接置 null, 不要猜测]'
        : ''
      if (spec.shape === 'string') {
        lines.push(`- \`${spec.key}\` (${spec.label}): string — 一句话描述, 具体可操作${multiSampleNote}`)
      } else if (spec.shape === 'enum') {
        const values = (spec.enumValues || []).map((v) => {
          const cn = spec.enumLabels?.[v]
          return cn ? `"${v}"(${cn})` : `"${v}"`
        }).join(' | ')
        lines.push(`- \`${spec.key}\` (${spec.label}): { type: ${values}, description: string }${multiSampleNote}`)
      } else if (spec.shape === 'enumPair') {
        const values = (spec.enumValues || []).map((v) => {
          const cn = spec.enumLabels?.[v]
          return cn ? `"${v}"(${cn})` : `"${v}"`
        }).join(' | ')
        lines.push(`- \`${spec.key}\` (${spec.label}): { primary: ${values}, secondary?: same enum, description: string }${multiSampleNote}`)
      } else if (spec.shape === 'appeal') {
        lines.push(`- \`${spec.key}\` (${spec.label}): { logos: 0-1, pathos: 0-1, ethos: 0-1 (三者之和 ≈ 1), description: string }`)
      }
    }
    lines.push('')
  }

  lines.push('硬性要求:')
  lines.push('1. 只输出 JSON, 不要代码块包裹, 不要前后解释文字.')
  lines.push('2. 每个 description 字段 1-3 句话, 具体到"作者怎么做", 不要空泛.')
  lines.push('3. 枚举 type/primary 必须是上面列出的英文值之一, 不要自造.')
  lines.push('4. 不确定的字段直接省略或置 null, 不要凭感觉猜.')
  if (!isMultiSample) {
    lines.push('5. 本轮样本不足 3 篇, 意象/主题层 (frequentImagery / metaphorDomain / referencePreference) 必须置 null.')
  }
  return lines.join('\n')
}
