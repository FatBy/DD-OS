/**
 * Skill 匹配算法: 轻量关键词包含 + 加权求和
 * 设计文档: docs/design/study-room-design.md §3.2.1
 */

export interface ScoredSkill {
  name: string
  description: string
  score: number
  keywords: string[]
  instructions: string
}

export interface SkillLike {
  name: string
  description?: string
  keywords?: string[]
  whenToUse?: string
  tags?: string[]
  enabled?: boolean
  toolType?: string
  category?: string
  instructions?: string
}

/**
 * 自习室里"可用"的 skill 类型:
 * 只有这些 toolType/category 的 skill 在纯 prompt 驱动的写作场景里有意义
 * (它们作为写作风格/文体约束注入 system prompt)
 */
const WRITING_STYLE_TYPES = new Set([
  'writing', 'content', 'style', 'prompt', 'template', 'persona',
])

/**
 * 判断一个 skill 是否是"风格型"(能在自习室纯 prompt 模式下生效)
 * 还是"工具型"(需要后端执行引擎, 自习室里无法真正跑)
 */
export function isStyleSkill(skill: SkillLike): boolean {
  if (WRITING_STYLE_TYPES.has((skill.toolType || '').toLowerCase())) return true
  if (WRITING_STYLE_TYPES.has((skill.category || '').toLowerCase())) return true
  // 没有 toolType/category 的 skill, 默认当风格型处理 (大部分 SKILL.md 就是文体说明书)
  if (!skill.toolType && !skill.category) return true
  return false
}

/**
 * 将 skills 分流为两组: 风格型(参与 prompt) 和 工具型(自习室暂不执行, 需坦诚告知用户)
 */
export function splitSkillsByUsability<T extends SkillLike>(skills: T[]): {
  styleSkills: T[]
  toolSkills: T[]
} {
  const styleSkills: T[] = []
  const toolSkills: T[] = []
  for (const s of skills) {
    if (s.enabled === false) continue
    if (isStyleSkill(s)) styleSkills.push(s)
    else toolSkills.push(s)
  }
  return { styleSkills, toolSkills }
}

/**
 * 从 whenToUse 字段抽取前 N 个 2-5 字关键短语
 */
function extractKeyPhrases(text: string, maxPhrases: number): string[] {
  const STOPWORDS = new Set(['的', '了', '是', '在', '和', '与', '或', '应', '可', '用', '当', '要', '能'])
  return text
    .split(/[,，。.;；:：\s]+/)
    .flatMap((seg) => {
      const clean = seg.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
      if (clean.length >= 2 && clean.length <= 5 && !STOPWORDS.has(clean)) return [clean]
      return []
    })
    .slice(0, maxPhrases)
}

/**
 * 字符 n-gram (仅用于 description 模糊命中)
 */
function tokenizeByChar(s: string, n: number): string[] {
  const out: string[] = []
  const clean = s.replace(/\s+/g, '')
  for (let i = 0; i <= clean.length - n; i++) out.push(clean.slice(i, i + n))
  return out
}

/**
 * 匹配 skills, 返回按得分降序排列的结果
 */
export function matchSkills(intent: string, skills: SkillLike[]): ScoredSkill[] {
  const normalized = intent.toLowerCase()

  return skills
    .filter((s) => s.enabled !== false)
    .map((skill) => {
      let score = 0

      // 规则 A: keywords 命中 +3
      for (const kw of skill.keywords || []) {
        if (normalized.includes(kw.toLowerCase())) score += 3
      }

      // 规则 B: whenToUse 关键短语 +2
      const hints = extractKeyPhrases(skill.whenToUse || '', 5)
      for (const hint of hints) {
        if (normalized.includes(hint)) score += 2
      }

      // 规则 C: description 3-gram +1
      if (skill.description) {
        const grams = tokenizeByChar(skill.description, 3)
        for (const g of grams) {
          if (normalized.includes(g)) {
            score += 1
            break
          }
        }
      }

      // 规则 D: tags +1.5
      for (const tag of skill.tags || []) {
        if (normalized.includes(tag.toLowerCase())) score += 1.5
      }

      // 规则 E: 写作类 skill 加权
      if (skill.toolType === 'writing' || skill.category === 'writing') {
        score *= 1.3
      }

      return {
        name: skill.name,
        description: skill.description || '',
        score,
        keywords: skill.keywords || [],
        instructions: (skill.instructions || '').slice(0, 800),
      }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
}
