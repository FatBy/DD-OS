/**
 * Base Sequence Governor — 碱基序列自适应闭环调节器 (v2)
 *
 * 三层架构，全部纯代码，不依赖任何 LLM：
 *
 * Layer 1 (在线规则引擎):
 *   在 ReAct 循环每轮结束时评估 baseSequenceEntries，
 *   触发时返回 prompt 注入文本，引导 LLM 调整策略。
 *   v2: 7 条规则 + 8 维特征 + 干预模式库查询
 *
 * Layer 2 (统计累加器):
 *   每次 ExecTrace 保存后，按特征分桶累加 (成功次数, 总次数)，
 *   同时记录干预事件，为 Layer 3 提供 A/B 对比数据。
 *
 * Layer 3 (阈值自适应):
 *   每 N 条 trace 触发一次，用卡方检验对比干预组 vs 未干预组，
 *   仅在统计显著时调整阈值，否则保持现状（安全阀）。
 *   v2: 反事实预测辅助决策
 *
 * 类比：空调恒温器 — 传感器(碱基分类器) + 规则(if/else) + 执行器(prompt注入)
 */

import type { BaseType } from '@/utils/baseClassifier'
import type { DiscoveredRule } from './ruleTypes'
import { extractFeaturesV2, matchCondition, interpolateTemplate } from './featureRegistry'

// ============================================
// 类型定义
// ============================================

const RUNTIME_DISCOVERED_LIFECYCLES = new Set<DiscoveredRule['lifecycle']>(['observing', 'validated'])

function getRuntimePrompt(rule: DiscoveredRule): string | null {
  const prompt = rule.distillation?.agentPrompt?.trim()
  return prompt || null
}

function isRuntimeDiscoveredRule(rule: DiscoveredRule): boolean {
  return RUNTIME_DISCOVERED_LIFECYCLES.has(rule.lifecycle) && getRuntimePrompt(rule) !== null
}

/** 碱基序列条目（与 types.ts 中 BaseSequenceEntry 兼容的最小子集） */
interface BaseEntry {
  base: BaseType
  order: number
}

/** Layer 1 规则评估结果 */
export interface GovernorSignal {
  /** 是否触发了任何规则 */
  triggered: boolean
  /** 注入到 LLM 上下文的提示文本（空字符串 = 无干预） */
  promptInjection: string
  /** 触发的规则名称列表（用于 trace 记录） */
  triggeredRules: string[]
  /** 当前预估成功率（基于分桶查表，0-1，-1 表示数据不足） */
  estimatedSuccessRate: number
  /** 触发时的特征快照（供 InterventionRecord 使用） */
  _features: FeatureSnapshot
  /** V5: 建议的最优方向（用于响应追踪） */
  suggestedDirection?: string
}

/** 干预事件记录（嵌入 ExecTrace，供 Layer 2/3 使用） */
export interface InterventionRecord {
  /** 触发的规则名称 */
  rule: string
  /** 触发时的碱基步数 */
  stepIndex: number
  /** 触发时的特征快照 */
  features: FeatureSnapshot
  /** 反事实预测：触发时从分桶查表的"如果不干预"预估成功率 */
  counterfactualSuccessRate: number
  /** V5: 注入后模型实际走的下一步碱基 */
  nextBaseAfterInjection?: string
  /** V5: 建议的最优方向 */
  suggestedDirection?: string
}

/** 特征快照（8 维，O(n) 可计算） */
export interface FeatureSnapshot {
  // 原有 4 维
  consecutiveX: number
  stepCount: number
  xRatioLast5: number
  switchRate: number
  // v2 新增 4 维（基于 v2 数据分析发现）
  /** 后半段是否出现 P（后段 P → 77% vs 前段 100%） */
  pInLateHalf: boolean
  /** 最近 P 后是否接 V（P→V → 96.9% vs P→E → 80.8%） */
  lastPFollowedByV: boolean
  /** 最长连续 E run（>=3 → ~100%） */
  maxERunLength: number
  /** X/(X+E) 比值（<0.5 → 97%） */
  xeRatio: number
}

/** 分桶统计条目 */
interface BucketStats {
  successCount: number
  totalCount: number
}

/** 规则阈值配置（可被 Layer 3 动态调整） */
interface RuleThresholds {
  /** 连续 X 刹车阈值（默认 12） */
  consecutiveXBrake: number
  /** 序列长度熔断阈值（默认 12） */
  stepLengthFuse: number
  /** 切换频率警告阈值（默认 0.8，数据显示 >0.8 才真正危险 SR=47%） */
  switchRateWarning: number
  /** Layer 3 自适应触发间隔（每 N 条 trace） */
  adaptationInterval: number
  // v2 新增规则阈值
  /** 多样性崩溃检测窗口大小（默认 5） */
  diversityCollapseWindow: number
  /** 后期规划警告的位置比例阈值（默认 0.5） */
  latePlanningRatio: number
  /** 验证缺失检测的步数阈值（已废弃，保留兼容） */
  missingVerificationSteps: number
  /** 探索过度的 X/(X+E) 阈值（默认 0.7） */
  exploreDominanceRatio: number
  /** 探索过度的最小步数（默认 6） */
  exploreDominanceMinSteps: number
  // v5 新增（数据驱动校准）
  /** P-X-P 循环检测的最小步数（默认 5） */
  planCycleMinSteps: number
  /** 多样性崩溃位置门控（默认 0.6，只在序列 60% 之后触发） */
  diversityCollapsePositionGate: number
  /** 全局干预冷却步数（默认 3，同 trace 内两次干预至少间隔 N 步） */
  globalCooldownSteps: number
}

/** 干预模式库条目 */
interface PatternEntry {
  bucketKey: string
  sequenceSnapshot: string
  rule: string
  success: boolean
  recoveryPath?: string
}

/** 转移统计条目 */
interface TransitionStats {
  successCount: number
  totalCount: number
}

/** 信息响应追踪 */
interface InjectionResponseStats {
  /** 建议后模型响应的次数（下一步走了建议方向） */
  respondedCount: number
  /** 建议后模型未响应的次数 */
  ignoredCount: number
  /** 响应后成功的次数 */
  respondedSuccessCount: number
  /** 未响应后成功的次数 */
  ignoredSuccessCount: number
}

/** 持久化的统计数据 */
export interface GovernorStats {
  /** 版本号（用于数据迁移） */
  version: number
  /** 分桶统计表：key = bucketKey, value = {successCount, totalCount} */
  buckets: Record<string, BucketStats>
  /** 干预效果统计：key = ruleName, value = {intervened: BucketStats, control: BucketStats} */
  interventionEffects: Record<string, { intervened: BucketStats; control: BucketStats }>
  /** 当前阈值 */
  thresholds: RuleThresholds
  /** 总 trace 计数（用于触发 Layer 3） */
  totalTraceCount: number
  /** 上次自适应时的 trace 计数 */
  lastAdaptationCount: number
  /** v2: 干预模式库（上限 200 条，FIFO 淘汰） */
  patternLibrary?: PatternEntry[]
  /** v2: 反事实预测累加（key = ruleName） */
  counterfactualAccumulator?: Record<string, { sumPredicted: number; sumActual: number; count: number }>
  /** V5: 转移成功率统计 key = "X->E", value = {successCount, totalCount} */
  transitionStats?: Record<string, TransitionStats>
  /** V5: 信息注入响应追踪 key = ruleName */
  injectionResponseStats?: Record<string, InjectionResponseStats>
  /** V5: 上次规则发现触发时的 trace 计数 */
  lastDiscoveryCount?: number
}

// ============================================
// 常量
// ============================================

const DEFAULT_THRESHOLDS: RuleThresholds = {
  consecutiveXBrake: 12,         // 数据: X-run 7+ SR=88.3%，连续X不是主要问题，保持高阈值作为安全阀
  stepLengthFuse: 12,
  switchRateWarning: 0.8,        // V5: 0.6→0.8，数据: rate<0.3=94%, 0.3-0.7=81%, >0.8=47%
  adaptationInterval: 50,
  diversityCollapseWindow: 5,
  latePlanningRatio: 0.5,
  missingVerificationSteps: 6,   // V5: 3→6，实质上禁用旧逻辑（由 plan_cycle 替代）
  exploreDominanceRatio: 0.7,    // V5: 0.55→0.7，数据显示 xeRatio 对 SR 区分力仅 1.4pp
  exploreDominanceMinSteps: 8,   // V5: 6→8，避免短序列误触发
  // v5 新增
  planCycleMinSteps: 5,
  diversityCollapsePositionGate: 0.6,
  globalCooldownSteps: 3,
}

/** 卡方检验临界值 (df=1, α=0.05) */
const CHI_SQUARE_CRITICAL_005 = 3.841

/** 最小样本量：低于此值不做自适应调整 */
const MIN_SAMPLE_FOR_ADAPTATION = 20

/** 模式库最大容量 */
const MAX_PATTERN_LIBRARY_SIZE = 200

/** 位置折扣衰减因子 */
const GAMMA = 0.9

const STATS_VERSION = 2

/** 全部 7 条规则名称（v5: missing_verification → plan_cycle_detection） */
const ALL_RULE_NAMES = [
  'consecutive_x_brake',
  'step_length_fuse',
  'switch_rate_warning',
  'diversity_collapse',
  'late_planning_warning',
  'plan_cycle_detection',
  'explore_dominance',
]

// ============================================
// Layer 1: 在线规则引擎
// ============================================

/**
 * 从碱基序列中提取 8 维特征向量。
 * 所有计算均为 O(n)，n = 序列长度（通常 <25）。
 */
export function extractFeatures(entries: BaseEntry[]): FeatureSnapshot {
  if (entries.length === 0) {
    return {
      consecutiveX: 0, stepCount: 0, xRatioLast5: 0, switchRate: 0,
      pInLateHalf: false, lastPFollowedByV: false, maxERunLength: 0, xeRatio: 0,
    }
  }

  // 1. 连续 X 计数（从末尾往前数）
  let consecutiveX = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].base === 'X') consecutiveX++
    else break
  }

  // 2. 总步数
  const stepCount = entries.length

  // 3. 最近 5 步中 X 的占比
  const last5 = entries.slice(-5)
  const xCountLast5 = last5.filter(e => e.base === 'X').length
  const xRatioLast5 = last5.length > 0 ? xCountLast5 / last5.length : 0

  // 4. 切换频率（相邻碱基不同的次数 / 总步数）
  let switchCount = 0
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].base !== entries[i - 1].base) switchCount++
  }
  const switchRate = entries.length > 1 ? switchCount / (entries.length - 1) : 0

  // --- v2 新增 4 维 ---

  // 5. 后半段是否出现 P
  const halfIndex = Math.floor(entries.length / 2)
  let pInLateHalf = false
  for (let i = halfIndex; i < entries.length; i++) {
    if (entries[i].base === 'P') { pInLateHalf = true; break }
  }

  // 6. 最近 P 后是否接 V（P→V 黄金路径检测）
  let lastPFollowedByV = false
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].base === 'P') {
      lastPFollowedByV = i + 1 < entries.length && entries[i + 1].base === 'V'
      break
    }
  }

  // 7. 最长连续 E 游程
  let maxERunLength = 0
  let currentERun = 0
  for (const entry of entries) {
    if (entry.base === 'E') {
      currentERun++
      if (currentERun > maxERunLength) maxERunLength = currentERun
    } else {
      currentERun = 0
    }
  }

  // 8. X/(X+E) 比值
  let xCount = 0
  let eCount = 0
  for (const entry of entries) {
    if (entry.base === 'X') xCount++
    else if (entry.base === 'E') eCount++
  }
  const xeRatio = (xCount + eCount) > 0 ? xCount / (xCount + eCount) : 0

  return {
    consecutiveX, stepCount, xRatioLast5, switchRate,
    pInLateHalf, lastPFollowedByV, maxERunLength, xeRatio,
  }
}

/**
 * 静态转移概率表（初始值，基于 907 traces 统计）。
 * 当动态数据不足时 fallback 使用。
 */
const FALLBACK_TRANSITION_SR: Record<string, Record<string, number>> = {
  X: { X: 0.836, E: 0.842, P: 0.691, V: 0.800 },
  E: { E: 0.842, X: 0.821, P: 0.613, V: 0.941 },
  P: { E: 0.725, X: 0.707, P: 0.714, V: 0.706 },
  V: { E: 0.750, X: 0.768, P: 0.637, V: 1.000 },
}

/**
 * 从动态 transitionStats 计算转移 SR，不足时 fallback 到静态表。
 */
function getTransitionSR(transitionStats?: Record<string, { successCount: number; totalCount: number }>): Record<string, Record<string, number>> {
  if (!transitionStats) return FALLBACK_TRANSITION_SR

  const result: Record<string, Record<string, number>> = {}
  for (const base of ['X', 'E', 'P', 'V']) {
    result[base] = {}
    for (const next of ['X', 'E', 'P', 'V']) {
      const key = `${base}->${next}`
      const stat = transitionStats[key]
      if (stat && stat.totalCount >= 5) {
        result[base][next] = stat.successCount / stat.totalCount
      } else {
        result[base][next] = FALLBACK_TRANSITION_SR[base]?.[next] ?? 0.8
      }
    }
  }
  return result
}

function formatTransitionHint(lastBase: string, transitionStats?: Record<string, { successCount: number; totalCount: number }>): string {
  const sr = getTransitionSR(transitionStats)[lastBase]
  if (!sr) return ''
  const sorted = Object.entries(sr).sort((a, b) => b[1] - a[1])
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]
  return `从当前状态，历史最优下一步: ${best[0]}(SR=${(best[1]*100).toFixed(0)}%)，最差: ${worst[0]}(SR=${(worst[1]*100).toFixed(0)}%)`
}

/**
 * 获取当前状态的建议最优方向（用于响应追踪）。
 */
function getSuggestedDirection(lastBase: string, transitionStats?: Record<string, { successCount: number; totalCount: number }>): string {
  const sr = getTransitionSR(transitionStats)[lastBase]
  if (!sr) return 'E'
  const sorted = Object.entries(sr).sort((a, b) => b[1] - a[1])
  return sorted[0][0]
}

/**
 * Layer 1: 评估当前碱基序列，返回干预信号。
 *
 * V5 范式: 信息顾问模式 — 提供量化观测和路径对比，不发出行为命令。
 * 纯代码 if/else，0ms 延迟，不调用任何模型。
 */
export function evaluateSequence(
  entries: BaseEntry[],
  thresholds: RuleThresholds = DEFAULT_THRESHOLDS,
  disabledRules?: Set<string>,
  transitionStats?: Record<string, { successCount: number; totalCount: number }>,
): GovernorSignal {
  const features = extractFeatures(entries)
  const triggeredRules: string[] = []
  const injections: string[] = []

  // 规则 1: 连续探索安全阀
  if (!disabledRules?.has('consecutive_x_brake')
    && features.consecutiveX >= thresholds.consecutiveXBrake) {
    triggeredRules.push('consecutive_x_brake')
    injections.push(
      `[状态观测] 已连续 ${features.consecutiveX} 步探索(X)。` +
      `${formatTransitionHint('X', transitionStats)}。` +
      `历史数据: 连续探索后转入执行(E)的成功率为 84%。`
    )
  }

  // 规则 2: 序列长度安全阀
  if (!disabledRules?.has('step_length_fuse')
    && features.stepCount >= thresholds.stepLengthFuse) {
    triggeredRules.push('step_length_fuse')
    injections.push(
      `[状态观测] 当前已执行 ${features.stepCount} 步。` +
      `历史数据: 序列长度 ≥12 步时成功率 79%（基线 82%），≥21 步时降至 74.5%。`
    )
  }

  // 规则 3: 极端切换警告
  // 仅在切换率 >0.8 时触发（数据: >0.8 的 SR=47%，属于真正危险区）
  if (!disabledRules?.has('switch_rate_warning')
    && features.stepCount >= 6 && features.switchRate > thresholds.switchRateWarning) {
    triggeredRules.push('switch_rate_warning')
    injections.push(
      `[状态观测] 当前切换率 ${(features.switchRate * 100).toFixed(0)}%（每步都在换方向）。` +
      `历史数据: 切换率 >80% 时成功率仅 47%（基线 82%），切换率 <30% 时成功率 94%。` +
      `连续 2-3 步同方向推进的历史表现显著优于频繁切换。`
    )
  }

  // --- v5 信息顾问规则 ---

  // 规则 4: 单一模式（仅后段，排除连续 E）
  if (!disabledRules?.has('diversity_collapse')
    && features.stepCount >= thresholds.diversityCollapseWindow * 2) {
    const positionRatio = features.stepCount / Math.max(thresholds.stepLengthFuse, features.stepCount)
    if (positionRatio >= thresholds.diversityCollapsePositionGate) {
      const window = entries.slice(-thresholds.diversityCollapseWindow)
      const uniqueBases = new Set(window.map(e => e.base))
      if (uniqueBases.size === 1 && window[0].base !== 'E') {
        triggeredRules.push('diversity_collapse')
        const dominantBase = window[0].base
        injections.push(
          `[状态观测] 最近 ${thresholds.diversityCollapseWindow} 步全是 ${dominantBase}。` +
          `${formatTransitionHint(dominantBase, transitionStats)}。`
        )
      }
    }
  }

  // 规则 5: 后期规划信号
  // 数据: p_late SR=59.4%, no_p_late SR=97.6%，gap=38pp
  if (!disabledRules?.has('late_planning_warning')
    && features.stepCount > thresholds.stepLengthFuse * thresholds.latePlanningRatio
    && entries.length > 0 && entries[entries.length - 1].base === 'P') {
    triggeredRules.push('late_planning_warning')
    injections.push(
      `[状态观测] 第 ${features.stepCount} 步仍在规划(P)。` +
      `历史数据: 后半段出现 P 的成功率 59%，不出现 P 的成功率 98%。` +
      `从 P 出发: →E(SR=72%), →X(SR=71%), →V(SR=71%)。P→E 是当前最优路径。`
    )
  }

  // 规则 6: 规划循环检测
  // 数据: P-X-P cycle SR=51.4%, P≥3 SR=54.9%
  if (!disabledRules?.has('plan_cycle_detection')
    && features.stepCount >= thresholds.planCycleMinSteps) {
    const bases = entries.map(e => e.base)
    let pxpCount = 0
    for (let i = 0; i < bases.length - 2; i++) {
      if (bases[i] === 'P' && bases[i + 2] === 'P') pxpCount++
    }
    const pCount = bases.filter(b => b === 'P').length
    if (pxpCount >= 1 || pCount >= 3) {
      triggeredRules.push('plan_cycle_detection')
      injections.push(
        `[状态观测] 检测到规划循环（P 出现 ${pCount} 次，P-?-P 循环 ${pxpCount} 次）。` +
        `历史数据: P-X-P 循环的成功率 51%，P≥3 次的成功率 55%。` +
        `无 P 的任务成功率 98%。当前最优路径: 立即执行(E)，SR=84%。`
      )
    }
  }

  // 规则 7: 探索比例信号
  if (!disabledRules?.has('explore_dominance')
    && features.stepCount >= thresholds.exploreDominanceMinSteps
    && features.xeRatio > thresholds.exploreDominanceRatio) {
    triggeredRules.push('explore_dominance')
    injections.push(
      `[状态观测] 探索占比 X/(X+E) = ${(features.xeRatio * 100).toFixed(0)}%，执行步骤较少。` +
      `历史数据: X→E 转移的成功率 84%，X→X 为 84%（持平），X→P 为 69%（低）。` +
      `将已探索的信息转化为执行动作，历史表现优于继续探索或重新规划。`
    )
  }

  const promptInjection = injections.length > 0
    ? injections.join('\n')
    : ''

  return {
    triggered: triggeredRules.length > 0,
    promptInjection,
    triggeredRules,
    estimatedSuccessRate: -1,
    _features: features,
  }
}

/**
 * 通用求值器：基于 JSON 规则（DiscoveredRule[]）评估碱基序列。
 *
 * 替代硬编码 evaluateSequence，规则来自 Python 发现管线或手动迁移。
 * 冲突解决：仅注入 |effectSizePP| 最大的一条规则。
 */
export function evaluateWithRules(
  entries: BaseEntry[],
  rules: DiscoveredRule[],
): GovernorSignal {
  const features = extractFeaturesV2(entries)
  const triggeredRules: string[] = []
  const injections: string[] = []

  // V9: 仅 observing / validated 且已蒸馏出 agentPrompt 的规则参与运行时干预。
  // candidate/distilled 只在 UI 展示，不影响 Agent。
  const activeRules = rules.filter(isRuntimeDiscoveredRule)

  // 收集所有命中的规则
  const hits: Array<{ rule: DiscoveredRule }> = []
  for (const rule of activeRules) {
    if (matchCondition(features, rule.condition)) {
      hits.push({ rule })
    }
  }

  // 冲突解决：仅注入最强的一条（max |effectSizePP|）
  if (hits.length > 0) {
    hits.sort((a, b) => Math.abs(b.rule.stats.effectSizePP) - Math.abs(a.rule.stats.effectSizePP))
    const strongest = hits[0]
    triggeredRules.push(strongest.rule.id)
    const template = getRuntimePrompt(strongest.rule)
    if (template) {
      const prefix = strongest.rule.lifecycle === 'observing' ? '[实验观察] ' : ''
      injections.push(prefix + interpolateTemplate(template, features))
    }
  }

  // 将 V2 特征映射回旧版 FeatureSnapshot（兼容 InterventionRecord）
  const legacyFeatures: FeatureSnapshot = {
    consecutiveX: (features.consecutiveXTail as number) || 0,
    stepCount: (features.stepCount as number) || 0,
    xRatioLast5: (features.xRatioLast5 as number) || 0,
    switchRate: (features.switchRate as number) || 0,
    pInLateHalf: !!features.pInLateHalf,
    lastPFollowedByV: !!features.lastPFollowedByV,
    maxERunLength: (features.maxERunLength as number) || 0,
    xeRatio: (features.xeRatio as number) || 0,
  }

  return {
    triggered: triggeredRules.length > 0,
    promptInjection: injections.join('\n'),
    triggeredRules,
    estimatedSuccessRate: -1,
    _features: legacyFeatures,
  }
}

// ============================================
// Layer 2: 统计累加器
// ============================================

/**
 * 将特征快照映射到分桶 key。
 * 桶的粒度故意设计得较粗，避免稀疏问题。
 * 维持 4D 分桶（72 桶）不变 — 新增 4 维仅用于规则触发。
 */
function toBucketKey(features: FeatureSnapshot): string {
  const cxBucket = Math.min(features.consecutiveX, 3)
  const stepBucket = features.stepCount <= 4 ? 'S' : features.stepCount <= 11 ? 'M' : 'L'
  const xrBucket = features.xRatioLast5 < 0.4 ? 'lo' : features.xRatioLast5 <= 0.8 ? 'mi' : 'hi'
  const srBucket = features.switchRate <= 0.6 ? 'L' : 'H'

  return `${cxBucket}_${stepBucket}_${xrBucket}_${srBucket}`
}

/**
 * 创建空的统计数据。
 */
export function createEmptyStats(): GovernorStats {
  return {
    version: STATS_VERSION,
    buckets: {},
    interventionEffects: {},
    thresholds: { ...DEFAULT_THRESHOLDS },
    totalTraceCount: 0,
    lastAdaptationCount: 0,
    patternLibrary: [],
    counterfactualAccumulator: {},
  }
}

/**
 * Layer 2: 从一条完成的 trace 中更新统计数据。
 *
 * @param stats 当前统计数据（会被原地修改）
 * @param baseSequence 碱基序列字符串（如 "X-E-E-V-X"）
 * @param success 任务是否成功
 * @param interventions 本次执行中触发的干预记录
 * @returns 是否应触发 Layer 3 自适应
 */
export function updateStats(
  stats: GovernorStats,
  baseSequence: string,
  success: boolean,
  interventions: InterventionRecord[],
  /** 动态规则名列表（为空时 fallback 到硬编码 ALL_RULE_NAMES） */
  dynamicRuleNames?: string[],
): boolean {
  if (!baseSequence) return false

  const bases = baseSequence.split('-').filter(b => 'EPVX'.includes(b)) as BaseType[]
  if (bases.length === 0) return false

  const entries: BaseEntry[] = bases.map((base, index) => ({ base, order: index }))
  const features = extractFeatures(entries)
  const bucketKey = toBucketKey(features)

  // 更新分桶统计
  if (!stats.buckets[bucketKey]) {
    stats.buckets[bucketKey] = { successCount: 0, totalCount: 0 }
  }
  stats.buckets[bucketKey].totalCount++
  if (success) stats.buckets[bucketKey].successCount++

  // 更新干预效果统计（动态规则名列表）
  const triggeredRuleNames = new Set(interventions.map(i => i.rule))
  const ruleNames = dynamicRuleNames && dynamicRuleNames.length > 0 ? dynamicRuleNames : ALL_RULE_NAMES

  for (const ruleName of ruleNames) {
    if (!stats.interventionEffects[ruleName]) {
      stats.interventionEffects[ruleName] = {
        intervened: { successCount: 0, totalCount: 0 },
        control: { successCount: 0, totalCount: 0 },
      }
    }
    const effect = stats.interventionEffects[ruleName]
    if (triggeredRuleNames.has(ruleName)) {
      effect.intervened.totalCount++
      if (success) effect.intervened.successCount++
    } else {
      effect.control.totalCount++
      if (success) effect.control.successCount++
    }
  }

  // v2: 反事实预测累加
  if (!stats.counterfactualAccumulator) stats.counterfactualAccumulator = {}
  for (const intervention of interventions) {
    const acc = stats.counterfactualAccumulator[intervention.rule]
      || { sumPredicted: 0, sumActual: 0, count: 0 }
    if (intervention.counterfactualSuccessRate >= 0) {
      acc.sumPredicted += intervention.counterfactualSuccessRate
      acc.sumActual += success ? 1 : 0
      acc.count++
    }
    stats.counterfactualAccumulator[intervention.rule] = acc
  }

  // v2: 更新干预模式库
  if (!stats.patternLibrary) stats.patternLibrary = []
  for (const intervention of interventions) {
    const seqSnapshot = bases.slice(
      Math.max(0, intervention.stepIndex - 5),
      intervention.stepIndex,
    ).join('-')
    // 干预后的恢复路径（干预点之后的碱基）
    const recoveryBases = bases.slice(intervention.stepIndex)
    const recoveryPath = recoveryBases.length > 0 ? recoveryBases.join('-') : undefined

    stats.patternLibrary.push({
      bucketKey,
      sequenceSnapshot: seqSnapshot,
      rule: intervention.rule,
      success,
      recoveryPath,
    })
  }
  // FIFO 淘汰
  if (stats.patternLibrary.length > MAX_PATTERN_LIBRARY_SIZE) {
    stats.patternLibrary = stats.patternLibrary.slice(-MAX_PATTERN_LIBRARY_SIZE)
  }

  // V5: 更新转移统计（每对相邻碱基的成功率）
  if (!stats.transitionStats) stats.transitionStats = {}
  for (let i = 0; i < bases.length - 1; i++) {
    const key = `${bases[i]}->${bases[i + 1]}`
    if (!stats.transitionStats[key]) {
      stats.transitionStats[key] = { successCount: 0, totalCount: 0 }
    }
    stats.transitionStats[key].totalCount++
    if (success) stats.transitionStats[key].successCount++
  }

  // V5: 更新信息注入响应追踪
  if (!stats.injectionResponseStats) stats.injectionResponseStats = {}
  for (const intervention of interventions) {
    const rule = intervention.rule
    if (!stats.injectionResponseStats[rule]) {
      stats.injectionResponseStats[rule] = {
        respondedCount: 0, ignoredCount: 0,
        respondedSuccessCount: 0, ignoredSuccessCount: 0,
      }
    }
    const irs = stats.injectionResponseStats[rule]
    // 判断模型是否响应了建议方向
    if (intervention.suggestedDirection && intervention.nextBaseAfterInjection) {
      if (intervention.nextBaseAfterInjection === intervention.suggestedDirection) {
        irs.respondedCount++
        if (success) irs.respondedSuccessCount++
      } else {
        irs.ignoredCount++
        if (success) irs.ignoredSuccessCount++
      }
    }
  }

  stats.totalTraceCount++

  const shouldAdapt = (stats.totalTraceCount - stats.lastAdaptationCount) >= stats.thresholds.adaptationInterval
  return shouldAdapt
}

/**
 * 从统计数据中查询预估成功率。
 * v2: 位置折扣权重 — fallback 查询时按桶接近度加权。
 */
export function lookupSuccessRate(stats: GovernorStats, entries: BaseEntry[]): number {
  const features = extractFeatures(entries)
  const bucketKey = toBucketKey(features)
  const bucket = stats.buckets[bucketKey]

  if (bucket && bucket.totalCount >= 3) {
    return bucket.successCount / bucket.totalCount
  }

  // Fallback: 位置折扣加权 — 按 consecutiveX 和 stepBucket 的接近度加权
  const cxBucket = Math.min(features.consecutiveX, 3)
  const stepBucket = features.stepCount <= 4 ? 'S' : features.stepCount <= 11 ? 'M' : 'L'

  let weightedSuccess = 0
  let weightedTotal = 0
  for (const [key, value] of Object.entries(stats.buckets)) {
    const parts = key.split('_')
    if (parts.length < 2) continue
    const keyCx = parseInt(parts[0])
    const keyStep = parts[1]

    // 计算接近度权重：consecutiveX 差距越小权重越高
    const cxDist = Math.abs(keyCx - cxBucket)
    const stepMatch = keyStep === stepBucket ? 1.0 : 0.5
    const weight = Math.pow(GAMMA, cxDist) * stepMatch

    weightedSuccess += value.successCount * weight
    weightedTotal += value.totalCount * weight
  }

  if (weightedTotal >= 3) {
    return weightedSuccess / weightedTotal
  }

  return -1 // 数据不足
}

/**
 * 从模式库查询历史经验。
 * 返回匹配的成功恢复路径（最多 1 条）。
 */
function queryPatternLibrary(
  patternLibrary: PatternEntry[] | undefined,
  rule: string,
  bucketKey: string,
): string | undefined {
  if (!patternLibrary || patternLibrary.length === 0) return undefined

  // 查询相同规则 + 优先匹配相同 bucketKey 的成功案例
  const candidates = patternLibrary.filter(
    p => p.rule === rule && p.success && p.recoveryPath
  )
  if (candidates.length === 0) return undefined

  // 优先精确匹配
  const exactMatch = candidates.find(p => p.bucketKey === bucketKey)
  if (exactMatch) return exactMatch.recoveryPath

  // 退而求其次：取最近一条
  return candidates[candidates.length - 1].recoveryPath
}

// ============================================
// Layer 3: 阈值自适应
// ============================================

/**
 * 卡方检验（2x2 列联表）。
 * 返回卡方统计量。
 */
function chiSquare(
  interventionSuccess: number,
  interventionFail: number,
  controlSuccess: number,
  controlFail: number,
): number {
  const a = interventionSuccess
  const b = interventionFail
  const c = controlSuccess
  const d = controlFail
  const n = a + b + c + d

  if (n === 0) return 0

  // Yates 校正的卡方检验
  const numerator = n * Math.pow(Math.abs(a * d - b * c) - n / 2, 2)
  const denominator = (a + b) * (c + d) * (a + c) * (b + d)

  if (denominator === 0) return 0
  return numerator / denominator
}

/**
 * 单条规则的自适应调整逻辑。
 * 返回调整说明（null = 无调整）。
 */
function adaptSingleRule(
  stats: GovernorStats,
  ruleName: string,
  adjustFn: (direction: 'tighten' | 'loosen') => string | null,
): string | null {
  const effect = stats.interventionEffects[ruleName]
  if (!effect) return null

  const { intervened, control } = effect
  if (intervened.totalCount < MIN_SAMPLE_FOR_ADAPTATION
    || control.totalCount < MIN_SAMPLE_FOR_ADAPTATION) {
    return null
  }

  const interventionRate = intervened.successCount / intervened.totalCount
  const controlRate = control.successCount / control.totalCount

  const chi2 = chiSquare(
    intervened.successCount,
    intervened.totalCount - intervened.successCount,
    control.successCount,
    control.totalCount - control.successCount,
  )

  if (chi2 < CHI_SQUARE_CRITICAL_005) return null

  // v2: 反事实辅助决策 — 如果反事实预测数据充足，参考预测与实际的差值
  const cfAcc = stats.counterfactualAccumulator?.[ruleName]
  let cfHint = ''
  if (cfAcc && cfAcc.count >= 10) {
    const avgPredicted = cfAcc.sumPredicted / cfAcc.count
    const avgActual = cfAcc.sumActual / cfAcc.count
    const delta = avgActual - avgPredicted
    cfHint = `, cf_delta=${delta.toFixed(2)}`
  }

  if (interventionRate > controlRate) {
    const result = adjustFn('tighten')
    return result ? `${result} (干预有效, χ²=${chi2.toFixed(1)}${cfHint})` : null
  } else if (interventionRate < controlRate) {
    const result = adjustFn('loosen')
    return result ? `${result} (干预无效, χ²=${chi2.toFixed(1)}${cfHint})` : null
  }
  return null
}

/**
 * Layer 3: 自适应调整阈值。
 * v2: 覆盖全部 7 条规则 + 反事实预测辅助。
 *
 * @returns 调整说明（空数组 = 无调整）
 */
export function adaptThresholds(stats: GovernorStats): string[] {
  const adjustments: string[] = []
  const t = stats.thresholds

  // 规则 1: consecutive_x_brake
  const adj1 = adaptSingleRule(stats, 'consecutive_x_brake', (dir) => {
    if (dir === 'tighten' && t.consecutiveXBrake > 1) {
      t.consecutiveXBrake = Math.max(1, t.consecutiveXBrake - 1)
      return `consecutive_x_brake: 收紧到 ${t.consecutiveXBrake}`
    } else if (dir === 'loosen' && t.consecutiveXBrake < 12) {
      t.consecutiveXBrake = Math.min(12, t.consecutiveXBrake + 1)
      return `consecutive_x_brake: 放宽到 ${t.consecutiveXBrake}`
    }
    return null
  })
  if (adj1) adjustments.push(adj1)

  // 规则 2: step_length_fuse
  const adj2 = adaptSingleRule(stats, 'step_length_fuse', (dir) => {
    if (dir === 'tighten' && t.stepLengthFuse > 8) {
      t.stepLengthFuse = Math.max(8, t.stepLengthFuse - 2)
      return `step_length_fuse: 收紧到 ${t.stepLengthFuse}`
    } else if (dir === 'loosen' && t.stepLengthFuse < 20) {
      t.stepLengthFuse = Math.min(20, t.stepLengthFuse + 2)
      return `step_length_fuse: 放宽到 ${t.stepLengthFuse}`
    }
    return null
  })
  if (adj2) adjustments.push(adj2)

  // 规则 3: switch_rate_warning
  const adj3 = adaptSingleRule(stats, 'switch_rate_warning', (dir) => {
    if (dir === 'tighten' && t.switchRateWarning > 0.4) {
      t.switchRateWarning = Math.max(0.4, t.switchRateWarning - 0.1)
      return `switch_rate_warning: 收紧到 ${t.switchRateWarning.toFixed(1)}`
    } else if (dir === 'loosen' && t.switchRateWarning < 0.8) {
      t.switchRateWarning = Math.min(0.8, t.switchRateWarning + 0.1)
      return `switch_rate_warning: 放宽到 ${t.switchRateWarning.toFixed(1)}`
    }
    return null
  })
  if (adj3) adjustments.push(adj3)

  // 规则 4: diversity_collapse
  const adj4 = adaptSingleRule(stats, 'diversity_collapse', (dir) => {
    if (dir === 'tighten' && t.diversityCollapseWindow > 3) {
      t.diversityCollapseWindow = Math.max(3, t.diversityCollapseWindow - 1)
      return `diversity_collapse: 收紧窗口到 ${t.diversityCollapseWindow}`
    } else if (dir === 'loosen' && t.diversityCollapseWindow < 8) {
      t.diversityCollapseWindow = Math.min(8, t.diversityCollapseWindow + 1)
      return `diversity_collapse: 放宽窗口到 ${t.diversityCollapseWindow}`
    }
    return null
  })
  if (adj4) adjustments.push(adj4)

  // 规则 5: late_planning_warning
  const adj5 = adaptSingleRule(stats, 'late_planning_warning', (dir) => {
    if (dir === 'tighten' && t.latePlanningRatio > 0.3) {
      t.latePlanningRatio = Math.max(0.3, t.latePlanningRatio - 0.1)
      return `late_planning_warning: 收紧比例到 ${t.latePlanningRatio.toFixed(1)}`
    } else if (dir === 'loosen' && t.latePlanningRatio < 0.8) {
      t.latePlanningRatio = Math.min(0.8, t.latePlanningRatio + 0.1)
      return `late_planning_warning: 放宽比例到 ${t.latePlanningRatio.toFixed(1)}`
    }
    return null
  })
  if (adj5) adjustments.push(adj5)

  // 规则 6: plan_cycle_detection
  const adj6 = adaptSingleRule(stats, 'plan_cycle_detection', (dir) => {
    if (dir === 'tighten' && t.planCycleMinSteps > 3) {
      t.planCycleMinSteps = Math.max(3, t.planCycleMinSteps - 1)
      return `plan_cycle_detection: 收紧到 ${t.planCycleMinSteps} 步`
    } else if (dir === 'loosen' && t.planCycleMinSteps < 8) {
      t.planCycleMinSteps = Math.min(8, t.planCycleMinSteps + 1)
      return `plan_cycle_detection: 放宽到 ${t.planCycleMinSteps} 步`
    }
    return null
  })
  if (adj6) adjustments.push(adj6)

  // 规则 7: explore_dominance
  const adj7 = adaptSingleRule(stats, 'explore_dominance', (dir) => {
    if (dir === 'tighten' && t.exploreDominanceRatio > 0.5) {
      t.exploreDominanceRatio = Math.max(0.5, t.exploreDominanceRatio - 0.1)
      return `explore_dominance: 收紧比例到 ${t.exploreDominanceRatio.toFixed(1)}`
    } else if (dir === 'loosen' && t.exploreDominanceRatio < 0.9) {
      t.exploreDominanceRatio = Math.min(0.9, t.exploreDominanceRatio + 0.1)
      return `explore_dominance: 放宽比例到 ${t.exploreDominanceRatio.toFixed(1)}`
    }
    return null
  })
  if (adj7) adjustments.push(adj7)

  stats.lastAdaptationCount = stats.totalTraceCount
  return adjustments
}

/**
 * 通用自适应：基于 A/B 统计对 DiscoveredRule 的阈值进行调整。
 * 仅当规则有 adaptationBounds 且 A/B 数据充足时才调整。
 *
 * @returns 被修改的规则列表（空 = 无调整）
 */
export function adaptDiscoveredRules(
  stats: GovernorStats,
  rules: DiscoveredRule[],
): DiscoveredRule[] {
  const modified: DiscoveredRule[] = []

  for (const rule of rules) {
    if (rule.lifecycle === 'retired') continue
    if (!rule.adaptationBounds) continue

    const effect = stats.interventionEffects[rule.id]
    if (!effect) continue

    const { intervened, control } = effect
    if (intervened.totalCount < MIN_SAMPLE_FOR_ADAPTATION
      || control.totalCount < MIN_SAMPLE_FOR_ADAPTATION) continue

    const interventionRate = intervened.successCount / intervened.totalCount
    const controlRate = control.successCount / control.totalCount

    const chi2 = chiSquare(
      intervened.successCount,
      intervened.totalCount - intervened.successCount,
      control.successCount,
      control.totalCount - control.successCount,
    )

    if (chi2 < CHI_SQUARE_CRITICAL_005) continue

    // 找到对应 adaptationBounds.feature 的条件子句
    const bounds = rule.adaptationBounds
    const clause = rule.condition.clauses.find(c => c.feature === bounds.feature)
    if (!clause) continue

    if (interventionRate > controlRate) {
      // 干预有效 → 收紧阈值（让更多 trace 命中）
      const newVal = clause.op.includes('>') 
        ? Math.max(bounds.min, clause.value - bounds.step)
        : Math.min(bounds.max, clause.value + bounds.step)
      if (newVal !== clause.value) {
        clause.value = Math.round(newVal * 10000) / 10000
        modified.push(rule)
      }
    } else {
      // 干预无效 → 放宽阈值（让更少 trace 命中）
      const newVal = clause.op.includes('>')
        ? Math.min(bounds.max, clause.value + bounds.step)
        : Math.max(bounds.min, clause.value - bounds.step)
      if (newVal !== clause.value) {
        clause.value = Math.round(newVal * 10000) / 10000
        modified.push(rule)
      }
    }
  }

  return modified
}

// ============================================
// Governor 单例服务
// ============================================

// V10: 规则层级分类
// Safety: 阻止不可逆损害的规则
const SAFETY_RULES = new Set(['consecutive_x_brake', 'step_length_fuse'])
// Hard Behavior: 关键行为约束规则
const HARD_BEHAVIOR_RULES = new Set(['diversity_collapse', 'plan_cycle_detection'])
// 其余规则默认为 Soft Behavior: switch_rate_warning, late_planning_warning, explore_dominance

class BaseSequenceGovernor {
  private stats: GovernorStats = createEmptyStats()
  private serverUrl = ''
  private loaded = false
  /** 用户禁用的 legacy 规则名集合（从后端 /api/governor/rule-prefs 加载） */
  private disabledLegacyRules: Set<string> = new Set()
  /** 数据发现的规则（从后端 /api/discovered-rules 加载） */
  private discoveredRules: DiscoveredRule[] = []
  /** V10: Soft Behavior 开关（Control Track 关闭此开关仅保留 Safety + Hard） */
  private softBehaviorEnabled: boolean = true
  /** V10 Task 3: Shadow 记录——当 Soft Behavior 关闭时，记录 Soft 规则的虚拟触发结果 */
  private _shadowRecord: import('@/types').ControlTrackShadow | null = null
  /** V5: 全局冷却——同 trace 内上次干预的步数 */
  private lastInterventionStep: number = -999
  /** V5: plan_cycle 每 trace 只触发一次 */
  private planCycleFiredThisTrace: boolean = false

  /** V10: 获取 Soft Behavior 开关状态 */
  public isSoftBehaviorEnabled(): boolean {
    return this.softBehaviorEnabled
  }

  /** V10: 设置 Soft Behavior 开关状态 */
  public setSoftBehaviorEnabled(enabled: boolean): void {
    this.softBehaviorEnabled = enabled
    // 开启时清空 shadow 记录
    if (enabled) this._shadowRecord = null
    console.log(`[Governor] Soft Behavior ${enabled ? 'enabled' : 'disabled'}`)
  }

  /** V10 Task 3: 获取 Shadow 记录（Control 组 shadow 运行 Soft 规则的结果） */
  public getShadowRecord(): import('@/types').ControlTrackShadow | null {
    return this._shadowRecord
  }

  /**
   * 初始化：设置后端 URL，加载统计数据 + 规则配置。
   */
  async initialize(serverUrl: string): Promise<void> {
    this.serverUrl = serverUrl
    await this.loadStats()
    await this.loadRuleConfig()
  }

  /**
   * 加载用户规则偏好 + 数据发现规则。
   * 初始化时调用一次，UI 切换规则后可通过 reload() 重新加载。
   */
  private async loadRuleConfig(): Promise<void> {
    if (!this.serverUrl) return

    // 1. 加载 legacy 规则偏好
    try {
      const res = await fetch(`${this.serverUrl}/api/governor/rule-prefs`)
      if (res.ok) {
        const prefs = await res.json() as Record<string, boolean>
        this.disabledLegacyRules = new Set(
          Object.entries(prefs).filter(([, enabled]) => !enabled).map(([name]) => name)
        )
      }
    } catch {
      // 首次运行或后端未就绪，使用空集（全部启用 fallback）
    }

    // 2. 加载 discovered rules
    try {
      const res = await fetch(`${this.serverUrl}/api/discovered-rules`)
      if (res.ok) {
        const data = await res.json() as { rules: DiscoveredRule[] }
        this.discoveredRules = data.rules || []
      }
    } catch {
      // 容错
    }

    const legacyActive = 7 - this.disabledLegacyRules.size
    const discoveredActive = this.discoveredRules.filter(isRuntimeDiscoveredRule).length
    console.log(`[Governor] Rules loaded: ${legacyActive} legacy active, ${discoveredActive} discovered runtime-active`)
  }

  /**
   * UI 切换规则后调用，重新从后端加载规则配置。
   */
  async reload(): Promise<void> {
    await this.loadRuleConfig()
  }

  /**
   * Layer 1: 评估当前碱基序列，返回干预信号。
   * 在 ReAct 循环每轮工具执行完成后调用。
   *
   * 双路径合并：
   * - 路径 1: Legacy 硬编码规则（受用户偏好 disabledLegacyRules 控制）
   * - 路径 2: 数据发现规则（受 lifecycle 字段控制）
   *
   * V8: 可选接受 BaseLedger，利用 LedgerFacts 避免重复干预
   */
  evaluate(entries: BaseEntry[], ledger?: { facts?: { failedApproaches?: string[] } }, recoveryHint?: { isAdaptive: boolean }): GovernorSignal {
    // V5: 新 trace 开始时重置 per-trace 状态
    if (entries.length <= 1) {
      this.lastInterventionStep = -999
      this.planCycleFiredThisTrace = false
    }

    // V10: 当 Soft Behavior 关闭时，将 Soft 规则加入禁用集合（仅保留 Safety + Hard）
    let effectiveDisabledRules = this.disabledLegacyRules
    const ALL_LEGACY_RULES = ['consecutive_x_brake', 'step_length_fuse', 'switch_rate_warning', 'diversity_collapse', 'late_planning_warning', 'plan_cycle_detection', 'explore_dominance']
    if (!this.softBehaviorEnabled) {
      effectiveDisabledRules = new Set(this.disabledLegacyRules)
      // 过滤掉所有非 Safety/Hard 的规则
      for (const rule of ALL_LEGACY_RULES) {
        if (!SAFETY_RULES.has(rule) && !HARD_BEHAVIOR_RULES.has(rule)) {
          effectiveDisabledRules.add(rule)
        }
      }

      // V10 Task 3: Shadow 评估 — 用完整规则集评估一次，记录 Soft 规则是否会触发
      const shadowSignal = evaluateSequence(entries, this.stats.thresholds, this.disabledLegacyRules, this.stats.transitionStats)
      // 找出 shadow 中触发了但 effective 中被过滤掉的 Soft 规则
      const softOnlyRules = shadowSignal.triggeredRules.filter(
        r => !SAFETY_RULES.has(r) && !HARD_BEHAVIOR_RULES.has(r)
      )
      if (softOnlyRules.length > 0) {
        this._shadowRecord = {
          wouldHaveSoftIntervened: true,
          wouldHaveInterventionType: softOnlyRules[0],
          wouldHaveInterventionStep: entries.length,
        }
      }
    }

    // 路径 1: Legacy 规则（受用户 UI 开关控制 + V10 Soft Behavior 开关）
    const legacySignal = evaluateSequence(entries, this.stats.thresholds, effectiveDisabledRules, this.stats.transitionStats)

    // 路径 2: 数据发现规则（受 lifecycle 控制，evaluateWithRules 内部过滤 retired）
    let discoveredSignal: GovernorSignal | null = null
    if (this.discoveredRules.length > 0) {
      discoveredSignal = evaluateWithRules(entries, this.discoveredRules)
    }

    // 合并信号
    const signal: GovernorSignal = {
      triggered: legacySignal.triggered || (discoveredSignal?.triggered ?? false),
      promptInjection: [
        legacySignal.promptInjection,
        discoveredSignal?.promptInjection || '',
      ].filter(Boolean).join('\n'),
      triggeredRules: [
        ...legacySignal.triggeredRules,
        ...(discoveredSignal?.triggeredRules || []),
      ],
      estimatedSuccessRate: -1,
      _features: legacySignal._features,
    }

    // V5: 全局冷却 — 同 trace 内两次干预至少间隔 N 步（Safety 规则豁免）
    if (signal.triggered) {
      const cooldown = this.stats.thresholds.globalCooldownSteps
      const stepsSinceLast = entries.length - this.lastInterventionStep
      const onlySafetyTriggered = signal.triggeredRules.every(r => SAFETY_RULES.has(r))
      if (stepsSinceLast < cooldown && !onlySafetyTriggered) {
        signal.triggered = false
        signal.promptInjection = ''
        signal.triggeredRules = []
      }
    }

    // V5/C: Recovery signal 抑制 — 模型正在自修复时不打断
    if (signal.triggered && recoveryHint?.isAdaptive) {
      const onlySafetyTriggered = signal.triggeredRules.every(r => SAFETY_RULES.has(r))
      if (!onlySafetyTriggered) {
        signal.triggered = false
        signal.promptInjection = ''
        signal.triggeredRules = []
      }
    }

    // V5: plan_cycle_detection 每 trace 只触发一次
    if (signal.triggered && signal.triggeredRules.includes('plan_cycle_detection')) {
      if (this.planCycleFiredThisTrace) {
        signal.triggeredRules = signal.triggeredRules.filter(r => r !== 'plan_cycle_detection')
        if (signal.triggeredRules.length === 0) {
          signal.triggered = false
          signal.promptInjection = ''
        }
      } else {
        this.planCycleFiredThisTrace = true
      }
    }

    // V5: 更新冷却计时 + 附加建议方向
    if (signal.triggered) {
      this.lastInterventionStep = entries.length
      const lastBase = entries.length > 0 ? entries[entries.length - 1].base : 'X'
      signal.suggestedDirection = getSuggestedDirection(lastBase, this.stats.transitionStats)
    }

    // V5: 附加量化状态摘要（信息顾问核心——即使没触发规则也计算 SR）
    if (this.loaded && this.stats.totalTraceCount >= 10) {
      signal.estimatedSuccessRate = lookupSuccessRate(this.stats, entries)
    }

    // V5: 当触发干预时，附加当前预估成功率作为顶部元信息
    if (signal.triggered && signal.estimatedSuccessRate >= 0) {
      const srPct = (signal.estimatedSuccessRate * 100).toFixed(0)
      signal.promptInjection = `[当前预估成功率: ${srPct}%]\n` + signal.promptInjection
    }

    // 模式库查询 — 提供历史成功恢复路径作为参考信息
    if (signal.triggered && this.stats.patternLibrary && this.stats.patternLibrary.length > 0) {
      const bucketKey = toBucketKey(signal._features)
      const patternHints: string[] = []

      for (const rule of signal.triggeredRules) {
        const recoveryPath = queryPatternLibrary(this.stats.patternLibrary, rule, bucketKey)
        if (recoveryPath) {
          patternHints.push(
            `[历史参考] 相似状态下的成功路径: ${recoveryPath}`
          )
        }
      }

      if (patternHints.length > 0) {
        signal.promptInjection = signal.promptInjection + '\n' + patternHints.join('\n')
      }
    }

    // Ledger 增强 — 提供已知失败路径作为决策信息
    if (signal.triggered && ledger?.facts?.failedApproaches && ledger.facts.failedApproaches.length > 0) {
      const failedSummary = ledger.facts.failedApproaches.slice(-3).join('; ')
      signal.promptInjection = signal.promptInjection + `\n[已知无效路径] ${failedSummary}`
    }

    return signal
  }

  /**
   * Layer 2 + 3: 在 trace 保存后调用，更新统计并可能触发自适应。
   */
  async recordTrace(
    baseSequence: string,
    success: boolean,
    interventions: InterventionRecord[],
  ): Promise<void> {
    const shouldAdapt = updateStats(
      this.stats, baseSequence, success, interventions,
      // 将 discovered rules 的活跃 ID 传入，确保 A/B 统计覆盖动态规则
      this.discoveredRules.filter(isRuntimeDiscoveredRule).map(r => r.id),
    )

    if (shouldAdapt) {
      const adjustments = adaptThresholds(this.stats)
      if (adjustments.length > 0) {
        console.log('[Governor/L3] 阈值自适应调整:', adjustments.join('; '))
      } else {
        console.log('[Governor/L3] 自适应检查完成，无需调整')
      }
    }

    // V5: 自动触发规则发现（每 50 条新 trace）
    const discoveryInterval = 50
    const lastDiscovery = this.stats.lastDiscoveryCount || 0
    if (this.stats.totalTraceCount - lastDiscovery >= discoveryInterval) {
      this.stats.lastDiscoveryCount = this.stats.totalTraceCount
      this.triggerRuleDiscovery()
    }

    // 异步持久化（不阻塞主流程）
    this.saveStats().catch(err => {
      console.warn('[Governor] Failed to persist stats:', err)
    })
  }

  /**
   * 获取当前阈值（供外部读取）。
   */
  getThresholds(): Readonly<RuleThresholds> {
    return this.stats.thresholds
  }

  /**
   * 获取统计摘要（供 UI 展示）。
   */
  getStatsSummary(): {
    totalTraces: number
    bucketCount: number
    thresholds: RuleThresholds
    interventionSummary: Record<string, { interventionRate: string; controlRate: string; sampleSize: number }>
  } {
    const interventionSummary: Record<string, { interventionRate: string; controlRate: string; sampleSize: number }> = {}

    for (const [rule, effect] of Object.entries(this.stats.interventionEffects)) {
      const iRate = effect.intervened.totalCount > 0
        ? (effect.intervened.successCount / effect.intervened.totalCount * 100).toFixed(1) + '%'
        : 'N/A'
      const cRate = effect.control.totalCount > 0
        ? (effect.control.successCount / effect.control.totalCount * 100).toFixed(1) + '%'
        : 'N/A'
      interventionSummary[rule] = {
        interventionRate: iRate,
        controlRate: cRate,
        sampleSize: effect.intervened.totalCount + effect.control.totalCount,
      }
    }

    return {
      totalTraces: this.stats.totalTraceCount,
      bucketCount: Object.keys(this.stats.buckets).length,
      thresholds: { ...this.stats.thresholds },
      interventionSummary,
    }
  }

  /**
   * 获取完整统计数据（供 deriveStrategies 使用）。
   * 返回浅层只读引用——调用方不应修改返回值。
   */
  getFullStats(): Readonly<GovernorStats> {
    return this.stats
  }

  // ---- V5: 自动规则发现 ----

  private triggerRuleDiscovery(): void {
    if (!this.serverUrl) return
    fetch(`${this.serverUrl}/api/rule-discovery/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(res => {
        if (res.ok) {
          console.log('[Governor/V5] Rule discovery triggered successfully')
          this.reloadDiscoveredRules()
        } else {
          console.warn(`[Governor/V5] Rule discovery returned ${res.status}`)
        }
      })
      .catch(() => {
        // 静默失败 — Python 服务可能暂时不可用
      })
  }

  private reloadDiscoveredRules(): void {
    if (!this.serverUrl) return
    fetch(`${this.serverUrl}/api/discovered-rules`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.rules) {
          this.discoveredRules = data.rules
          const active = this.discoveredRules.filter(isRuntimeDiscoveredRule).length
          console.log(`[Governor/V5] Discovered rules reloaded: ${active} active`)
        }
      })
      .catch(() => {})
  }

  // ---- 持久化 ----

  private async loadStats(): Promise<void> {
    if (!this.serverUrl) return
    try {
      const response = await fetch(`${this.serverUrl}/api/governor/stats`)
      if (response.ok) {
        const data = await response.json() as GovernorStats
        if (data && data.version) {
          // v2 兼容：旧版 stats 缺少新字段时补齐
          if (!data.patternLibrary) data.patternLibrary = []
          if (!data.counterfactualAccumulator) data.counterfactualAccumulator = {}
          // 补齐新阈值字段（从旧版本升级时）
          data.thresholds = { ...DEFAULT_THRESHOLDS, ...data.thresholds }
          this.stats = data
          this.stats.version = STATS_VERSION
          this.loaded = true
          console.log(`[Governor] Loaded stats: ${data.totalTraceCount} traces, ${Object.keys(data.buckets).length} buckets`)
          return
        }
      }
    } catch {
      // 首次运行或后端未就绪，使用默认值
    }
    this.stats = createEmptyStats()
    this.loaded = true
    console.log('[Governor] Initialized with empty stats (first run or backend unavailable)')
  }

  private async saveStats(): Promise<void> {
    if (!this.serverUrl) return
    try {
      await fetch(`${this.serverUrl}/api/governor/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.stats),
      })
    } catch {
      // 静默失败，下次重试
    }
  }
}

// ============================================
// Phase 0: 策略自动提炼（纯统计，零 LLM）
// ============================================

/** 分桶 key 解析结果（对应 toBucketKey 的 4 维输出） */
interface ParsedBucketKey {
  /** 末尾连续 X 数 (0-3, 其中 3 表示 ≥3) */
  consecutiveX: number
  /** 序列长度分桶 */
  stepBucket: 'S' | 'M' | 'L'
  /** 最近5步探索比例 */
  exploreRatio: 'lo' | 'mi' | 'hi'
  /** 切换频率 */
  switchRate: 'L' | 'H'
}

/** 解析 toBucketKey 产出的 "2_M_mi_L" 格式 */
function parseBucketKey(key: string): ParsedBucketKey | null {
  const parts = key.split('_')
  if (parts.length !== 4) return null

  const consecutiveX = parseInt(parts[0])
  if (isNaN(consecutiveX) || consecutiveX < 0 || consecutiveX > 3) return null

  const stepBucket = parts[1]
  if (stepBucket !== 'S' && stepBucket !== 'M' && stepBucket !== 'L') return null

  const exploreRatio = parts[2]
  if (exploreRatio !== 'lo' && exploreRatio !== 'mi' && exploreRatio !== 'hi') return null

  const switchRateBucket = parts[3]
  if (switchRateBucket !== 'L' && switchRateBucket !== 'H') return null

  return { consecutiveX, stepBucket, exploreRatio, switchRate: switchRateBucket }
}

/** 步长分桶的人类可读描述 */
const STEP_BUCKET_LABELS: Record<string, string> = {
  S: '短任务(≤4步)',
  M: '中等任务(5-11步)',
  L: '长任务(≥12步)',
}

/** 探索比例分桶的人类可读描述 */
const EXPLORE_RATIO_LABELS: Record<string, string> = {
  lo: '低探索(<40%)',
  mi: '中等探索(40-80%)',
  hi: '高探索(>80%)',
}

/** 将高成功率分桶特征转化为正面策略文本 */
function describeBucketAsStrategy(parsed: ParsedBucketKey): string {
  const parts: string[] = []

  if (parsed.consecutiveX === 0) {
    parts.push('避免末尾连续探索')
  }

  parts.push(STEP_BUCKET_LABELS[parsed.stepBucket] || parsed.stepBucket)

  if (parsed.exploreRatio === 'lo') {
    parts.push('保持低探索比例')
  } else if (parsed.exploreRatio === 'mi') {
    parts.push('适度探索')
  }

  if (parsed.switchRate === 'L') {
    parts.push('策略切换频率低（专注推进）')
  }

  return parts.join('，')
}

/** 将低成功率分桶特征转化为警告文本 */
function describeBucketAsWarning(parsed: ParsedBucketKey): string {
  const parts: string[] = []

  if (parsed.consecutiveX >= 2) {
    const prefix = parsed.consecutiveX === 3 ? '≥' : ''
    parts.push(`末尾连续探索 ${prefix}${parsed.consecutiveX} 次`)
  }

  if (parsed.exploreRatio === 'hi') {
    parts.push(EXPLORE_RATIO_LABELS.hi)
  }

  if (parsed.switchRate === 'H') {
    parts.push('策略切换过于频繁')
  }

  parts.push(STEP_BUCKET_LABELS[parsed.stepBucket] || parsed.stepBucket)

  return parts.join('，')
}

/** 规则显示名称映射 */
const RULE_STRATEGY_LABELS: Record<string, string> = {
  consecutive_x_brake: '连续探索刹车',
  step_length_fuse: '序列长度熔断',
  switch_rate_warning: '极端切换警告',
  diversity_collapse: '多样性崩溃检测',
  late_planning_warning: '后期规划警告',
  plan_cycle_detection: '规划循环检测',
  missing_verification: '验证缺失检测',
  explore_dominance: '探索过度检测',
}

/**
 * 从 Governor 统计数据中提炼出人类可读的策略规则。
 * 纯代码统计，零 LLM 开销。
 *
 * 数据来源：
 * 1. interventionEffects（干预 A/B 对比）→ 有效/无效规则（因果性，优先级高）
 * 2. buckets（分桶成功率）→ 高/低成功率模式（相关性，作为补充）
 *
 * 注意：v2 特征（pInLateHalf、lastPFollowedByV 等）不在 bucket key 中，
 * 通过 interventionEffects 的 missing_verification 规则间接获取验证策略价值。
 */
export function deriveStrategies(stats: GovernorStats): string[] {
  if (stats.totalTraceCount < 10) return []

  // 干预效果优先（因果性 > 相关性）
  const interventionStrategies: string[] = []
  const bucketStrategies: string[] = []

  // --- 1. 从干预效果统计中提取有效/无效规则 ---
  for (const [ruleName, effect] of Object.entries(stats.interventionEffects)) {
    const { intervened, control } = effect

    if (intervened.totalCount < 3 || control.totalCount < 3) continue

    const intervenedRate = intervened.successCount / intervened.totalCount
    const controlRate = control.successCount / control.totalCount
    const deltaPercentagePoints = Math.round((intervenedRate - controlRate) * 100)

    if (Math.abs(deltaPercentagePoints) < 10) continue

    const ruleLabel = RULE_STRATEGY_LABELS[ruleName] || ruleName

    if (deltaPercentagePoints > 0) {
      interventionStrategies.push(
        `${ruleLabel} 有效 (+${deltaPercentagePoints}pp): ` +
        `干预后 ${Math.round(intervenedRate * 100)}% vs 未干预 ${Math.round(controlRate * 100)}%`
      )
    } else {
      interventionStrategies.push(
        `${ruleLabel} 可能过度 (${deltaPercentagePoints}pp): 考虑放宽阈值`
      )
    }
  }

  // --- 2. 从分桶统计中提取高/低成功率模式 ---
  const significantBuckets = Object.entries(stats.buckets)
    .filter(([, bucket]) => bucket.totalCount >= 5)
    .map(([key, bucket]) => ({
      key,
      parsed: parseBucketKey(key),
      successRate: bucket.successCount / bucket.totalCount,
      sampleSize: bucket.totalCount,
    }))
    .filter((b): b is typeof b & { parsed: ParsedBucketKey } => b.parsed !== null)
    .sort((a, b) => b.successRate - a.successRate)

  // 最高成功率模式（≥90%）
  const bestPattern = significantBuckets.find(b => b.successRate >= 0.9)
  if (bestPattern) {
    bucketStrategies.push(
      `高成功率模式 (${Math.round(bestPattern.successRate * 100)}%, n=${bestPattern.sampleSize}): ` +
      describeBucketAsStrategy(bestPattern.parsed)
    )
  }

  // 最低成功率模式（≤50%）— ES2020 兼容写法
  let worstPattern: typeof significantBuckets[number] | undefined
  for (let i = significantBuckets.length - 1; i >= 0; i--) {
    if (significantBuckets[i].successRate <= 0.5) {
      worstPattern = significantBuckets[i]
      break
    }
  }
  if (worstPattern) {
    bucketStrategies.push(
      `⚠ 风险模式 (${Math.round(worstPattern.successRate * 100)}%, n=${worstPattern.sampleSize}): ` +
      describeBucketAsWarning(worstPattern.parsed)
    )
  }

  // 干预效果优先，分桶模式补充
  return [...interventionStrategies, ...bucketStrategies].slice(0, 5)
}

// ============================================
// V10 Task 3: Control Track 分组函数
// ============================================

/** 简单确定性哈希（同一 taskContent 永远分到同一组） */
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash)
}

/**
 * 判断任务是否属于 Control Track（20% 固定分组）。
 * 基于 task 内容的确定性哈希，不使用随机数。
 */
export function isControlTrack(taskContent: string): boolean {
  return simpleHash(taskContent) % 5 === 0
}

/** 全局单例 */
export const baseSequenceGovernor = new BaseSequenceGovernor()
