/**
 * MBTI 灵魂形象分析器
 * 规则打分(默认) + LLM 覆盖(可选)
 */
import type { MBTIType, MBTIResult, SoulTruth, SoulBoundary } from '@/types'
import { isLLMConfigured, chat } from './llmService'

// ── 16 种 MBTI 完整映射表 ──────────────────────────

interface MBTIProfile {
  type: MBTIType
  animal: string
  animalZh: string
  group: string
  trait: string
}

const MBTI_PROFILES: Record<MBTIType, MBTIProfile> = {
  intj: { type: 'intj', animal: 'octopus', animalZh: '章鱼', group: '分析家', trait: '高智商独行侠，善于幕后策划' },
  intp: { type: 'intp', animal: 'cat', animalZh: '猫', group: '分析家', trait: '好奇独立，沉浸自己的世界' },
  entj: { type: 'entj', animal: 'lion', animalZh: '狮子', group: '分析家', trait: '天生领导者，果断且有魄力' },
  entp: { type: 'entp', animal: 'fox', animalZh: '狐狸', group: '分析家', trait: '机灵狡黠，喜欢挑战传统' },
  infj: { type: 'infj', animal: 'wolf', animalZh: '狼', group: '外交官', trait: '深沉稀有，直觉力极强' },
  infp: { type: 'infp', animal: 'rabbit', animalZh: '兔子', group: '外交官', trait: '敏感温柔，追求内在和谐' },
  enfj: { type: 'enfj', animal: 'dolphin', animalZh: '海豚', group: '外交官', trait: '热情利他，群体灵魂人物' },
  enfp: { type: 'enfp', animal: 'otter', animalZh: '水獭', group: '外交官', trait: '充满活力，给人带来快乐' },
  istj: { type: 'istj', animal: 'beaver', animalZh: '海狸', group: '守护者', trait: '勤奋务实，严格遵守规则' },
  isfj: { type: 'isfj', animal: 'elephant', animalZh: '大象', group: '守护者', trait: '忠诚可靠，默默守护' },
  estj: { type: 'estj', animal: 'bee', animalZh: '蜜蜂', group: '守护者', trait: '讲究纪律，高效组织执行' },
  esfj: { type: 'esfj', animal: 'penguin', animalZh: '企鹅', group: '守护者', trait: '热衷照顾他人，重视和谐' },
  istp: { type: 'istp', animal: 'falcon', animalZh: '隼', group: '探险家', trait: '冷静观察，行动迅猛' },
  isfp: { type: 'isfp', animal: 'deer', animalZh: '梅花鹿', group: '探险家', trait: '艺术感强，向往自由' },
  estp: { type: 'estp', animal: 'cheetah', animalZh: '猎豹', group: '探险家', trait: '追求速度激情，极具爆发力' },
  esfp: { type: 'esfp', animal: 'peacock', animalZh: '孔雀', group: '探险家', trait: '天生表演家，喜欢成为焦点' },
}

// ── 四轴关键词权重 ─────────────────────────────────

type AxisKeywords = { positive: string[]; negative: string[] }

/** E(+) vs I(-) */
const EI_KEYWORDS: AxisKeywords = {
  positive: ['social', 'team', 'collaborate', 'outgoing', 'communicate', 'engage', 'interact', 'lead', 'guide',
    '社交', '团队', '协作', '外向', '沟通', '引导', '互动', '带领', '热情', '主动'],
  negative: ['independent', 'focus', 'introspect', 'deep', 'quiet', 'solitary', 'internal', 'reflect', 'private',
    '独立', '专注', '内省', '深度', '安静', '内在', '反思', '沉思', '独行'],
}

/** S(+) vs N(-) */
const SN_KEYWORDS: AxisKeywords = {
  positive: ['practical', 'detail', 'concrete', 'reliable', 'step-by-step', 'systematic', 'precise', 'fact', 'real',
    '实际', '细节', '具体', '可靠', '步骤', '系统', '精确', '事实', '务实'],
  negative: ['creative', 'vision', 'innovative', 'abstract', 'imagine', 'possibility', 'intuition', 'big-picture',
    '创造', '愿景', '创新', '抽象', '想象', '可能性', '直觉', '全局', '灵感'],
}

/** T(+) vs F(-) */
const TF_KEYWORDS: AxisKeywords = {
  positive: ['logic', 'analyze', 'efficient', 'objective', 'rational', 'optimize', 'strategy', 'accuracy', 'data',
    '逻辑', '分析', '效率', '客观', '理性', '优化', '策略', '准确', '数据'],
  negative: ['empathy', 'caring', 'harmony', 'value', 'gentle', 'warm', 'compassion', 'emotional', 'feeling',
    '共情', '关怀', '和谐', '温暖', '温柔', '情感', '体贴', '感受', '人文'],
}

/** J(+) vs P(-) */
const JP_KEYWORDS: AxisKeywords = {
  positive: ['plan', 'structure', 'organize', 'decisive', 'discipline', 'schedule', 'systematic', 'order', 'rule',
    '计划', '结构', '组织', '果断', '纪律', '安排', '有序', '规则', '规范'],
  negative: ['flexible', 'adapt', 'spontaneous', 'explore', 'open', 'curious', 'experiment', 'improvise',
    '灵活', '适应', '即兴', '探索', '开放', '好奇', '实验', '随机应变'],
}

// ── 规则引擎 ───────────────────────────────────────

function scoreAxis(corpus: string, keywords: AxisKeywords): number {
  let score = 0
  for (const kw of keywords.positive) {
    if (corpus.includes(kw)) score += 1
  }
  for (const kw of keywords.negative) {
    if (corpus.includes(kw)) score -= 1
  }
  return score
}

export function analyzeByRules(
  coreTruths: SoulTruth[],
  boundaries: SoulBoundary[],
  vibeStatement: string,
): MBTIResult {
  const parts = [
    ...coreTruths.map(t => `${t.title} ${t.principle} ${t.description}`),
    ...boundaries.map(b => b.rule),
    vibeStatement,
  ]
  const corpus = parts.join(' ').toLowerCase()

  const ei = scoreAxis(corpus, EI_KEYWORDS)
  const sn = scoreAxis(corpus, SN_KEYWORDS)
  const tf = scoreAxis(corpus, TF_KEYWORDS)
  const jp = scoreAxis(corpus, JP_KEYWORDS)

  const letter1 = ei >= 0 ? 'e' : 'i'
  const letter2 = sn >= 0 ? 's' : 'n'
  const letter3 = tf >= 0 ? 't' : 'f'
  const letter4 = jp >= 0 ? 'j' : 'p'

  const type = `${letter1}${letter2}${letter3}${letter4}` as MBTIType
  const profile = MBTI_PROFILES[type]

  // confidence: 各轴分差越大越确信
  const maxPossible = 10
  const avgDiff = (Math.abs(ei) + Math.abs(sn) + Math.abs(tf) + Math.abs(jp)) / 4
  const confidence = Math.min(avgDiff / maxPossible, 1)

  return { ...profile, confidence, source: 'rule' }
}

// ── 缓存层 ─────────────────────────────────────────

const CACHE_KEY_LLM = 'ddos_soul_mbti'
const CACHE_KEY_RESULT = 'ddos_soul_mbti_result'

function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return hash
}

interface CachedMBTI {
  type: MBTIType
  contentHash: number
}

function getCachedLLMResult(contentHash: number): MBTIType | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_LLM)
    if (!raw) return null
    const cached: CachedMBTI = JSON.parse(raw)
    if (cached.contentHash !== contentHash) return null
    return cached.type
  } catch {
    return null
  }
}

function setCachedLLMResult(type: MBTIType, contentHash: number) {
  localStorage.setItem(CACHE_KEY_LLM, JSON.stringify({ type, contentHash }))
}

/** 持久化完整 MBTIResult，避免刷新后 avatar 重新 loading */
export function getCachedMBTIResult(): MBTIResult | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_RESULT)
    if (!raw) return null
    return JSON.parse(raw) as MBTIResult
  } catch {
    return null
  }
}

function setCachedMBTIResult(result: MBTIResult) {
  localStorage.setItem(CACHE_KEY_RESULT, JSON.stringify(result))
}

const ALL_MBTI_TYPES: MBTIType[] = [
  'intj', 'intp', 'entj', 'entp', 'infj', 'infp', 'enfj', 'enfp',
  'istj', 'isfj', 'estj', 'esfj', 'istp', 'isfp', 'estp', 'esfp',
]

export async function analyzeByLLM(soulContent: string): Promise<MBTIType | null> {
  if (!isLLMConfigured()) return null
  try {
    const result = await chat([
      {
        role: 'system',
        content: 'You are a personality analyst. Analyze the given AI agent soul definition and determine its MBTI type. Return ONLY a JSON object: {"type":"xxxx"} where xxxx is a lowercase 4-letter MBTI code.',
      },
      {
        role: 'user',
        content: `Analyze the MBTI personality type of this AI agent based on its soul definition:\n\n${soulContent.slice(0, 2000)}`,
      },
    ])
    const match = result.match(/"type"\s*:\s*"([a-z]{4})"/i)
    if (match) {
      const type = match[1].toLowerCase() as MBTIType
      if (ALL_MBTI_TYPES.includes(type)) return type
    }
    return null
  } catch {
    return null
  }
}

// ── 主入口 ─────────────────────────────────────────

export async function detectMBTI(
  coreTruths: SoulTruth[],
  boundaries: SoulBoundary[],
  vibeStatement: string,
  soulRawContent: string,
  onLLMComplete?: (result: MBTIResult) => void,
): Promise<MBTIResult> {
  // 1. 规则引擎 (即时)
  const ruleResult = analyzeByRules(coreTruths, boundaries, vibeStatement)

  // 2. 检查 LLM 缓存
  const contentHash = simpleHash(soulRawContent)
  const cachedType = getCachedLLMResult(contentHash)
  if (cachedType) {
    const profile = MBTI_PROFILES[cachedType]
    const llmResult: MBTIResult = { ...profile, confidence: 0.85, source: 'llm' }
    setCachedMBTIResult(llmResult)
    return llmResult
  }

  // 3. 持久化规则引擎结果
  setCachedMBTIResult(ruleResult)

  // 4. 异步 LLM 分析 (不阻塞，后台完成后回调更新 store)
  if (isLLMConfigured() && soulRawContent.length > 20) {
    analyzeByLLM(soulRawContent).then(llmType => {
      if (llmType) {
        setCachedLLMResult(llmType, contentHash)
        const profile = MBTI_PROFILES[llmType]
        const llmResult: MBTIResult = { ...profile, confidence: 0.85, source: 'llm' }
        setCachedMBTIResult(llmResult)
        onLLMComplete?.(llmResult)
      }
    }).catch(() => {})
  }

  return ruleResult
}

// ── 工具函数 ──────────────────────────────────────

export function getAvatarPath(result: MBTIResult): string {
  return `/assets/soul/${result.type}-${result.animal}.png`
}

export function getMBTIProfile(type: MBTIType): MBTIProfile {
  return MBTI_PROFILES[type]
}
