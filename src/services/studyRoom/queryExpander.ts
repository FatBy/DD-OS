/**
 * Query Expander — 把用户长句拆成多路检索 query
 *
 * 背景：
 * - 后端 /api/wiki/search 支持向量优先 + LIKE 降级
 * - 但对长句查询向量召回噪声大、LIKE 几乎必然 0 命中
 * - 拆词多路查询能同时利用向量的语义能力和 LIKE 的精确匹配能力
 */

/** 常见中文停用词 + 写作任务中的动词噪声 */
const STOPWORDS = new Set([
  // 虚词
  '的', '了', '是', '在', '和', '与', '或', '也', '都', '就',
  '而', '及', '对', '把', '让', '使', '从', '到', '向', '给',
  '着', '过', '吧', '吗', '呢', '啊', '哦', '哈', '呀',
  // 代词
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '这', '那',
  '这个', '那个', '这些', '那些', '什么', '怎么', '怎样',
  // 高频动词（写作任务噪声）
  '写', '写一篇', '写一个', '写个', '写点', '做', '做一个', '做个',
  '帮', '帮我', '帮忙', '请', '麻烦', '需要', '希望', '想要', '想',
  '来', '去', '要', '能', '可以', '会', '应该', '必须', '得',
  '关于', '有关', '针对', '基于', '根据', '按照', '通过', '使用',
  // 文体噪声词
  '详细', '简单', '完整', '全面', '系统', '深入', '浅显',
  '一篇', '一个', '一些', '一点', '一下',
])

/** 写作任务常见的文体词——这些往往不是检索意图 */
const GENRE_WORDS = new Set([
  '分析', '报告', '论文', '文章', '综述', '总结', '摘要',
  '评论', '点评', '笔记', '心得', '感想', '介绍',
  '说明', '概述', '讲解', '教程', '指南', '手册',
  '故事', '小说', '散文', '诗歌', '剧本',
])

/**
 * 从用户意图中抽取用于检索的关键短语
 *
 * 策略：
 * 1. 按标点/空格切分
 * 2. 每个片段过滤掉非中英文/数字的字符
 * 3. 保留长度 2-8 的片段，过滤停用词和文体词
 * 4. 对长片段（>4字）做简单的左右滑窗拆分，补充更短的检索单元
 */
export function extractQueryTerms(intent: string, maxTerms = 5): string[] {
  if (!intent || !intent.trim()) return []

  const rawSegments = intent.split(/[,，。.;；:：!！?？\s\n\t()（）【】\[\]{}"'`]+/)

  const candidates = new Set<string>()

  for (const raw of rawSegments) {
    const clean = raw.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
    if (!clean) continue

    // 长度 2-8 的片段整体保留（如果不是停用词）
    if (clean.length >= 2 && clean.length <= 8) {
      if (!STOPWORDS.has(clean) && !GENRE_WORDS.has(clean)) {
        candidates.add(clean)
      }
    }

    // 对长片段做滑窗（3-gram）补充精准检索单元
    if (clean.length > 5) {
      for (let i = 0; i <= clean.length - 3; i++) {
        const gram = clean.slice(i, i + 3)
        if (!STOPWORDS.has(gram) && !GENRE_WORDS.has(gram)) {
          candidates.add(gram)
        }
      }
    }
  }

  // 按长度降序（长词更精确）
  return Array.from(candidates)
    .sort((a, b) => b.length - a.length)
    .slice(0, maxTerms)
}

/**
 * 构建多路查询列表
 * - 第一路：原句（保留完整语义，交给向量引擎）
 * - 后续路：抽取的关键短语（每路都会走向量或 LIKE）
 */
export function buildMultiRouteQueries(intent: string, maxTerms = 5): string[] {
  const trimmed = intent.trim()
  if (!trimmed) return []

  const terms = extractQueryTerms(trimmed, maxTerms)

  // 原句 + 关键短语（去重）
  const all = [trimmed, ...terms]
  const seen = new Set<string>()
  const unique: string[] = []
  for (const q of all) {
    const key = q.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(q)
    }
  }
  return unique
}
