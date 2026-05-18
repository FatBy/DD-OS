/**
 * 自习室写作提示词模板
 * 设计文档: docs/design/study-room-design.md §3.7, §7.4, §7.5, §8.6
 */

import type {
  WritingBrief, EvidenceItem, AgendaDoc, AgendaSection, SkillRef,
  WriterChatMessage, MemorySnippet,
  WriterFingerprint,
  WriterFingerprintProfile,
  FingerprintBehaviorRule,
} from '@/types'
import { getStyleContext, type WriterStyleContext } from './writerProfile'
import { getFingerprintSync, getActiveFingerprintSync } from './styleFingerprint'
import {
  PROFILE_FIELD_SPECS_BY_LAYER,
  renderProfileFieldValue,
} from './fingerprintSchema'

// ============================================
// System Prompts
// ============================================

export const WRITING_CONDUCTOR_PROMPT = `# WRITING_CONDUCTOR_PROMPT v1.0

你是 DunCrew 自习室的写作指挥者。你不是聊天机器人, 也不是通用 Agent。你的职责是根据
"写作契约 + 证据池 + 议程"的组合, 精准产出高质量的长文档段落。

## 你理解的写作契约 (WritingBrief)

- intent: 用户原话, 不要偏离
- genre: 体裁 (report / essay / letter / memo / tutorial / novel / custom)
- length: 长度档位, 决定节奏密度
- tone: 语气列表, 多个标签取交集
- audience: 受众画像, 决定用词层级
- constraints: 硬约束, 违反即算失败
- skills: 用户加载的 Skills, 每个 skill 的 instructions 是你必须遵循的文体说明书

## 你理解的证据池 (EvidencePool)

证据来自多个镜头:
- L (Library): 知识库实体和断言, 最权威, 引用优先
- S (Skills): 写作技能文档片段, 是约束不是素材, 禁止直接引用

每条证据有唯一 id (形如 L12 / S3), 你在正文中用 [^Lxx] 语法标注引用。

## 你理解的议程 (AgendaDoc)

议程是契约。你被分配了一节 (section), 你只写这一节, 不要擅自写其他节。
你收到邻接段的摘要用于保持连贯, 但不允许修改邻接段, 也不允许把邻接段的内容复制到本节。

## 输出规范 (严格)

### 当你被要求生成议程时
返回 JSON 对象, 严格符合以下 schema:
\`\`\`json
{
  "title": "string",
  "subtitle": "string?",
  "openingStance": "string (全文立意, 一句话)",
  "closingCall": "string (全文收束, 一句话)",
  "sections": [
    {
      "order": 1,
      "heading": "string",
      "intent": "string (本节要解决的问题)",
      "targetLength": 500,
      "evidencePocket": ["L12", "S3"],
      "skillHints": ["skill-name-1"]
    }
  ]
}
\`\`\`

### 当你被要求草起本节时
返回纯 Markdown 正文, 不加外层围栏, 不加标题 (标题由议程提供), 直接写段落。
引用用 [^Lxx] 格式内嵌, 不要在文末列参考文献 (系统自动生成)。

## 质量规则 (CRITICAL)

1. 不要幻觉数字: 数字必须有 evidencePocket 出处, 否则用模糊表达
2. 不要跨段引用: 只引用分配给本节的 evidencePocket 条目
3. Skills 是约束不是素材: 遵循 instructions 但禁止搬运到正文
4. 保持体裁纯度: report 客观陈述, essay 允许观点, letter 允许第二人称
5. 字数契约: targetLength ±10% 以内合格
6. 邻接连贯: 开头不重复前段, 结尾不剧透后段

## 你不做的事

- 不调用工具, 不访问文件系统
- 不问澄清问题
- 不输出元评论 ("以下是我的草稿" 之类)
- 不添加水印、签名、日期等模板化内容`


export const INTENT_DISPATCHER_PROMPT = `# INTENT_DISPATCHER_PROMPT v1.0

你是 DunCrew 自习室的指令分派器。你的唯一职责是把用户的自然语言指令分类为结构化 WriterIntent, 绝不写文档正文, 绝不做创作。

## 输出规范

返回 JSON 对象:
\`\`\`json
{
  "intent": {
    "kind": "rewrite_section",
    "sectionId": "sec-02",
    "instruction": "加入 GDP 数据并扩展到 600 字"
  },
  "scopeDescription": "§2 现象",
  "plannedActions": ["补采证据", "重写 §2"],
  "confidence": 0.88
}
\`\`\`

## 支持的 Intent kind

- draft_section: 草起某段 (需要 sectionId)
- rewrite_section: 改写某段 (需要 sectionId + instruction)
- revise_agenda: 修改议程 (需要 instruction)
- supplement_evidence: 补充证据 (需要 query)
- export_document: 导出全文
- focus_section: 聚焦某段 (需要 sectionId)
- ask_question: 提问 (需要 question)
- skill_mention: 添加技能 (需要 skillName)
- skill_remove: 移除技能 (需要 skillName)
- unknown: 无法识别

## 分派规则

1. 优先匹配精确动词: "改写/重写" → rewrite_section; "写/草起" → draft_section
2. 指代消解: 用 UI 焦点 + 最近 Intent 消解 "这段/那节"
3. 作用域最小化: 能落到单段就不扩到全局
4. 问答 vs 改动: "这段为什么" → ask_question, 不触发改动
5. 置信度: 指代不明确时 confidence < 0.6

## 你不做的事

- 不写段落正文
- 不判断指令好坏, 只分类
- 不补全用户没说的参数

只输出 JSON。`


// ============================================
// User Prompt Builders
// ============================================

function formatBriefContext(brief: WritingBrief): string {
  const skillNames = brief.skills.map((s: SkillRef) => `${s.name}(${s.priority})`).join(', ')
  return [
    `## 写作契约`,
    `- 意图: ${brief.intent}`,
    `- 体裁: ${brief.genre}`,
    `- 篇幅: ${brief.length}`,
    `- 语气: ${brief.tone.join(', ')}`,
    `- 受众: ${brief.audience}`,
    brief.constraints.length > 0 ? `- 约束: ${brief.constraints.join('; ')}` : '',
    skillNames ? `- Skills: ${skillNames}` : '',
  ].filter(Boolean).join('\n')
}

function formatEvidencePool(pool: EvidenceItem[]): string {
  if (pool.length === 0) return '## 证据池\n(空)'
  const lines = pool.map((e, i) => `- [${e.lens}${i + 1}] ${e.title}: ${e.snippet.slice(0, 200)}`)
  return `## 证据池 (${pool.length} 条)\n${lines.join('\n')}`
}

/**
 * 格式化最近若干轮对话历史 (给对话式修改用)
 * 只保留 user 和 assistant 消息, 跳过 thinking 和 streaming 中的消息
 */
export function formatChatHistory(
  messages: WriterChatMessage[],
  maxTurns = 6,
  maxCharsPerMsg = 300,
): string {
  if (!messages || messages.length === 0) return ''
  const filtered = messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && !m.streaming && m.content,
  )
  const recent = filtered.slice(-maxTurns * 2) // 每轮 2 条
  if (recent.length === 0) return ''

  const lines = recent.map((m) => {
    const role = m.role === 'user' ? '用户' : '你'
    const summary = m.editSummary
      ? `(已修改: ${m.editSummary.summary})`
      : m.content.slice(0, maxCharsPerMsg)
    return `- **${role}**: ${summary}`
  })

  return `## 最近对话 (最新 ${recent.length} 条, 用于理解当前修改意图在对话流中的位置)\n${lines.join('\n')}`
}

/** 格式化长期记忆片段 */
export function formatMemorySnippetsForPrompt(snippets: MemorySnippet[] | undefined): string {
  if (!snippets || snippets.length === 0) return ''
  const lines = snippets.slice(0, 8).map(
    (s) => `- [${s.source}] ${s.content.slice(0, 180)}`,
  )
  return `## 背景记忆 (参考用, 不要强行引用)\n${lines.join('\n')}`
}

/**
 * 格式化自习室写作风格档案 (独立于 DunCrew 全局记忆).
 *
 * 包含用户长期积累的风格偏好 (preferences) + 明确的避免清单 (avoidPatterns),
 * 注入写作 prompt 时分两种优先级:
 *
 * - **无指纹 (hasFingerprint=false)**: 档案是主要风格来源, preferences 和 avoidPatterns
 *   都是硬约束, 标题用"累积偏好, 必须遵守".
 *
 * - **有指纹 (hasFingerprint=true)**: 指纹才是主风格模板, 档案降级为软参考:
 *   - preferences (历史偏好) 降级为"软参考", 与指纹冲突时让位
 *   - avoidPatterns (用户反感的表达) **仍是硬红线** — 用户明确反感的东西永远不该写
 *   这样避免档案里的陈旧偏好 (比如用户以前爱用某种句式, 后来换指纹了) 把指纹味道盖掉.
 */
export function formatWriterStyleContext(
  ctx: WriterStyleContext,
  options?: { hasFingerprint?: boolean },
): string {
  const hasPrefs = ctx.preferences.length > 0
  const hasAvoid = ctx.avoidPatterns.length > 0
  if (!hasPrefs && !hasAvoid) return ''

  const hasFingerprint = options?.hasFingerprint === true

  const title = hasFingerprint
    ? '## 用户写作风格档案 (软参考, 与文风指纹冲突时让位于指纹)'
    : '## 用户写作风格档案 (累积偏好, 必须遵守)'
  const lines: string[] = [title]

  if (hasPrefs) {
    // 有指纹时, 在偏好列表前加一句提醒, 防止 LLM 还是把它当硬约束
    if (hasFingerprint) {
      lines.push('> 以下偏好是**历史累积**, 可能未必贴合当前指纹. 若与指纹风格画像矛盾, 请优先指纹.')
    }
    // 按类别分组展示, 让 LLM 更容易吸收
    const byCategory = new Map<string, string[]>()
    for (const p of ctx.preferences) {
      const tag = categoryLabel(p.category)
      if (!byCategory.has(tag)) byCategory.set(tag, [])
      const weight = p.confidence >= 0.7 ? '★' : p.confidence >= 0.5 ? '·' : ' '
      byCategory.get(tag)!.push(`${weight} ${p.content}`)
    }
    for (const [cat, items] of byCategory) {
      lines.push(`### ${cat}`)
      for (const it of items) lines.push(`- ${it}`)
    }
  }

  if (hasAvoid) {
    // 避免清单即使在有指纹时也保留硬红线地位: 用户明确反感的东西永远不该写
    const avoidTitle = hasFingerprint
      ? '### 明确避免 (硬红线, 无论是否有指纹都必须遵守)'
      : '### 明确避免 (用户反感的表达)'
    lines.push(avoidTitle)
    for (const a of ctx.avoidPatterns) lines.push(`- ${a}`)
  }

  lines.push('(★=强偏好, ·=中偏好; 无标记为待观察)')
  return lines.join('\n')
}

function categoryLabel(cat: string): string {
  switch (cat) {
    case 'style': return '语言风格'
    case 'structure': return '结构偏好'
    case 'vocabulary': return '词汇倾向'
    case 'citation': return '引用方式'
    case 'topic': return '话题倾向'
    default: return '其他'
  }
}

/**
 * 格式化风格指纹 (Writer Fingerprint) 为 prompt 注入段落
 * 指纹是用户主动应用到 session 的"文风模板", 优先级最高, 作为硬约束
 *
 * 注入策略:
 * - Layer 2 (自然语言画像) 全量注入: 最关键, LLM 直接照着写
 * - Layer 1 (结构化指标) 简要注入: 作为量化参考 (avgSentenceLen 等)
 * - Layer 3 (范文样本) 最多 2 段注入: 让 LLM 看到实际范本
 */
export function formatFingerprint(fp: WriterFingerprint | null | undefined): string {
  if (!fp) return ''

  const lines: string[] = [
    `## 文风指纹: ${fp.name} (强制应用, 优先级最高)`,
  ]
  if (fp.description) {
    lines.push(`> ${fp.description}`)
  }

  // ---- Layer 2: 自然语言画像 (核心, 22 维度分 6 层注入) ----
  //
  // 3 形态统一由 renderProfileFieldValue 渲染成 "标签 — 描述" / "X% Y% Z% — 描述" 形式,
  // LLM 写作时可直接参考. 向后兼容: 旧指纹的 opening / closing (纯字符串) 在宏观结构层降级展示.
  const profile = fp.profile || {}
  const layerSections: string[] = []
  for (const group of PROFILE_FIELD_SPECS_BY_LAYER) {
    const groupLines: string[] = []
    // 宏观结构层前置旧版 opening (如果没有 hookPattern)
    if (group.layer === 'macro' && !profile.hookPattern && profile.opening && profile.opening.trim()) {
      groupLines.push(`- **开篇风格 (旧版)**: ${profile.opening.trim()}`)
    }
    for (const spec of group.fields) {
      const rendered = renderProfileFieldValue(spec, profile[spec.key])
      if (!rendered) continue
      groupLines.push(`- **${spec.label}**: ${rendered}`)
    }
    // 宏观结构层后置旧版 closing (如果没有 closingPattern)
    if (group.layer === 'macro' && !profile.closingPattern && profile.closing && profile.closing.trim()) {
      groupLines.push(`- **收束风格 (旧版)**: ${profile.closing.trim()}`)
    }
    if (groupLines.length > 0) {
      layerSections.push(`#### ${group.label}\n${groupLines.join('\n')}`)
    }
  }
  if (layerSections.length > 0) {
    lines.push('### 风格画像 (Layer 2)')
    lines.push(layerSections.join('\n\n'))
  }

  // ---- Layer 1: 结构化指标 (量化锚点, 挑信息量最大的注入) ----
  const m = fp.metrics || {}
  const metricTips: string[] = []
  if (m.avgSentenceLen !== undefined) {
    metricTips.push(`平均句长 ${m.avgSentenceLen.toFixed(1)} 字`)
  }
  if (m.avgParagraphLen !== undefined) {
    metricTips.push(`平均段长 ${m.avgParagraphLen.toFixed(0)} 字`)
  }
  if (m.shortSentenceRate !== undefined && m.longSentenceRate !== undefined) {
    const shortPct = Math.round(m.shortSentenceRate * 100)
    const longPct = Math.round(m.longSentenceRate * 100)
    metricTips.push(`短句占 ${shortPct}%, 长句占 ${longPct}%`)
  }
  if (m.formalityScore !== undefined) {
    const tone = m.formalityScore > 0.3 ? '书面语' : m.formalityScore < -0.3 ? '口语' : '中性'
    metricTips.push(`偏${tone} (书面度 ${m.formalityScore.toFixed(2)})`)
  }
  // 扩展指标: 选几个对 LLM 写作有直接指导意义的
  if (m.conjunctionDensity !== undefined) {
    metricTips.push(`关联词密度 ${m.conjunctionDensity.toFixed(1)}/千字 (越高越爱用然而/因此等过渡词)`)
  }
  if (m.modalDensity !== undefined) {
    metricTips.push(`模态词密度 ${m.modalDensity.toFixed(1)}/千字 (越高越爱用必然/或许等确定性标记)`)
  }
  if (m.rhetoricalQuestionRate !== undefined && m.rhetoricalQuestionRate > 0.1) {
    metricTips.push(`问句中反问占 ${Math.round(m.rhetoricalQuestionRate * 100)}%`)
  }
  if (m.addressYou !== undefined || m.addressYouFormal !== undefined || m.addressWe !== undefined) {
    const parts: string[] = []
    if (m.addressYou !== undefined && m.addressYou > 0.3) parts.push(`"你" ${m.addressYou.toFixed(1)}/千字`)
    if (m.addressYouFormal !== undefined && m.addressYouFormal > 0.3) parts.push(`"您" ${m.addressYouFormal.toFixed(1)}/千字`)
    if (m.addressWe !== undefined && m.addressWe > 0.3) parts.push(`"我们" ${m.addressWe.toFixed(1)}/千字`)
    if (parts.length > 0) metricTips.push(`读者称呼: ${parts.join(' / ')}`)
  }
  if (metricTips.length > 0) {
    lines.push('### 量化指标 (Layer 1, 参考锚点, 不必精确匹配)')
    lines.push(metricTips.map((t) => `- ${t}`).join('\n'))
  }

  // ---- Layer 3: 范文样本 (最多 2 段, 避免 prompt 过长) ----
  if (fp.samples && fp.samples.length > 0) {
    lines.push('### 范文样本 (Layer 3, 照着这种风格写)')
    fp.samples.slice(0, 2).forEach((s, i) => {
      const snippet = s.text.length > 400 ? s.text.slice(0, 400) + '⋯' : s.text
      lines.push(`**样本 ${i + 1}**${s.source ? ` (来自《${s.source}》)` : ''}:`)
      lines.push(`> ${snippet.replace(/\n/g, '\n> ')}`)
    })
  }

  lines.push([
    '---',
    '**重要: 必须严格按照上述文风指纹写作.**',
    '**优先级: 文风指纹 > 用户写作风格档案 > 通用风格建议.**',
    '若下方"用户写作风格档案"里的 preferences 与本指纹冲突, 以指纹为准;',
    '但档案中的"明确避免"清单仍是硬红线, 必须同时遵守.',
  ].join('\n'))
  return lines.join('\n')
}

/**
 * 根据 brief 解析要应用的指纹:
 * - brief.fingerprintId 显式指定 -> 用指定的
 * - 否则不注入 (不自动使用 "active" 指纹, 避免全局副作用污染单个 session)
 *
 * 设计权衡: 之前讨论时考虑过"active"全局激活模式, 但容易造成"用户以为 session 没指纹
 * 结果其实默默应用了", 所以改为每个 session 显式指定.
 */
export function resolveFingerprintForBrief(brief: WritingBrief): WriterFingerprint | null {
  if (brief.fingerprintId) {
    return getFingerprintSync(brief.fingerprintId)
  }
  return null
}

/** 导出给测试/UI 预览用: 直接读当前激活指纹 (如果有) */
export function resolveActiveFingerprint(): WriterFingerprint | null {
  return getActiveFingerprintSync()
}


/**
 * P3: 议程生成 user prompt
 *
 * 核心理念: 篇幅服从内容, 不由档位决定.
 * - 若 brief.lengthExplicit=true (用户显式指定字数): 在 lengthRationale 中说明"我如何把用户要求的 X 字分配到各节"
 * - 若 brief.lengthExplicit=false: 完全由 LLM 根据题目内在复杂度决定节数和每节字数, 在 lengthRationale 中说明"为什么这个题目适合写这么长"
 */
export function buildAgendaPrompt(brief: WritingBrief, pool: EvidenceItem[]): string {
  const briefCtx = formatBriefContext(brief)
  const evidenceCtx = formatEvidencePool(pool)
  // 指纹注入 (如果 session 应用了): 提纲阶段就要定下"是谁在写",
  // 否则后续 compose 再注入已经晚了——结构和角度已被"通用作者"定死.
  const fingerprintCtx = formatFingerprint(resolveFingerprintForBrief(brief))

  const pinnedIds = brief.pinnedEntityIds || []
  const pinnedNote = pinnedIds.length > 0
    ? `\n## 钉住的实体\n${pinnedIds.join(', ')}\n`
    : ''

  const lengthGuide = brief.lengthExplicit
    ? [
      `## 篇幅要求 (用户硬性指定)`,
      `用户在意图或约束中明确指定了篇幅, 你必须严格遵守.`,
      `你的任务是: 把用户要求的总字数合理分配到各节, 并在 lengthRationale 中说明分配理由.`,
      `禁止自作主张改变总字数.`,
    ].join('\n')
    : [
      `## 篇幅决策 (由你谋篇)`,
      `用户没有明确指定字数. 你需要根据题目的内在复杂度, 自主决定:`,
      `- 写几节最合适 (不是越多越好, 也不是越少越深)`,
      `- 每节大约多少字 (要有自己的节奏判断, 不要落入"每节 500 字"的惯性)`,
      `- 全文大约多少字`,
      `在 lengthRationale 中用一句话说清楚"为什么这个题目适合写这么长、这样分节".`,
      `原则: 短题目别硬撑; 复杂题目别草草; 篇幅是题目的自然结果, 不是任务指标.`,
    ].join('\n')

  const parts = [
    briefCtx,
    fingerprintCtx,
    evidenceCtx,
    pinnedNote.trim(),
    lengthGuide,
    `## 任务`,
    [
      `请根据以上写作契约和证据池, 生成写作议程 (AgendaDoc JSON)。要求:`,
      `1. 根据题目和篇幅要求, 自主决定 sections 数量 (参考范围: 2-10 节)`,
      `2. 每节给出 targetLength (数字), 并确保总和与你的谋篇判断一致`,
      `3. **必须**产出 lengthRationale 字段 (字符串), 说明篇幅决策的理由`,
      `4. 将证据合理分配到各节的 evidencePocket`,
      `5. 如果有 skills, 在相关节标注 skillHints`,
      `6. 生成全文立意 openingStance 和收束 closingCall`,
      `7. 若上方提供了"文风指纹", 提纲的 openingStance / closingCall / 分节切角都应**贴着作者的习惯**来想 (而不是按通用模板谋篇)`,
    ].join('\n'),
    `JSON schema 示例:`,
    [
      '```',
      `{`,
      `  "title": "...",`,
      `  "lengthRationale": "这个题目涉及 3 个维度, 每个维度需要约 400 字展开, 加上起承收束, 全文约 1500 字较合适.",`,
      `  "openingStance": "...",`,
      `  "closingCall": "...",`,
      `  "sections": [`,
      `    { "order": 1, "heading": "...", "intent": "...", "targetLength": 400, "evidencePocket": ["L1"], "skillHints": [] }`,
      `  ]`,
      `}`,
      '```',
    ].join('\n'),
    `只返回 JSON, 不要包裹 markdown 代码块。`,
  ].filter((s) => s && s.length > 0)

  return parts.join('\n\n')
}


/**
 * P4: 段级草起 user prompt
 */
export function buildComposePrompt(
  section: AgendaSection,
  pool: EvidenceItem[],
  agenda: AgendaDoc,
  brief: WritingBrief,
  neighbors: { prev?: string; next?: string },
): string {
  const briefCtx = formatBriefContext(brief)
  // 指纹注入: 段级草起必须知道"谁在写"才能保持口吻一致.
  const fingerprintCtx = formatFingerprint(resolveFingerprintForBrief(brief))

  // 段级证据: 只提供分配给本段的
  // 修复: evidencePocket 存的是 "L1"/"S3" 格式,
  // 但 pool[i].id 是 "evidence-L-xxx" 格式. 需要双向匹配:
  // 1. 用 pool 索引生成的 label (如 "L1") 匹配 pocketIds
  // 2. 用 pool[i].id 直接匹配 pocketIds
  // 3. 用 pool[i].id 提取的简短格式匹配 pocketIds
  const pocketIds = new Set(section.evidencePocket)
  const sectionEvidence = pool.filter((item, i) => {
    const indexLabel = `${item.lens}${i + 1}`
    if (pocketIds.has(indexLabel)) return true
    if (pocketIds.has(item.id)) return true
    // "evidence-L-xxx" → 尝试用 "L{index}" 匹配
    const shortId = `${item.lens}${i + 1}`
    return pocketIds.has(shortId)
  })
  const evidenceCtx = sectionEvidence.length > 0
    ? sectionEvidence.map((e, i) => `- [${e.lens}${i + 1}] ${e.title}: ${e.snippet}`).join('\n')
    : '(本节无分配证据)'

  const adjacency = [
    neighbors.prev ? `前一段末尾: "${neighbors.prev}"` : '(本节是第一段)',
    neighbors.next ? `后一段意图: "${neighbors.next}"` : '(本节是最后一段)',
  ].join('\n')

  const parts = [
    briefCtx,
    fingerprintCtx,
    `## 全文立意\n${agenda.openingStance || '(未设定)'}`,
    [
      `## 本节议程`,
      `- 标题: ${section.heading}`,
      `- 意图: ${section.intent}`,
      `- 目标字数: ${section.targetLength}`,
    ].join('\n'),
    `## 邻接上下文\n${adjacency}`,
    `## 本节证据池\n${evidenceCtx}`,
    `## 适用 Skills\n${section.skillHints.length > 0 ? section.skillHints.join(', ') : '(无)'}`,
    [
      `## 任务`,
      ``,
      `请草起本节正文, 要求:`,
      `1. 字数约 ${section.targetLength} 字 (±10%)`,
      `2. 用 [^Lxx] / [^Sxx] 格式标注引用`,
      `3. 不写标题 (标题由系统渲染)`,
      `4. 开头不重复前段, 结尾不剧透后段`,
      `5. 直接输出纯 Markdown 正文`,
      `6. 若上方提供了"文风指纹", **严格模仿**作者的句式 / 词汇 / 节奏 / 论证方式, 不要切换成通用写作腔`,
    ].join('\n'),
  ].filter((s) => s && s.length > 0)

  return parts.join('\n\n')
}


/**
 * Intent Dispatcher user prompt
 */
export function buildDispatcherPrompt(
  userMessage: string,
  context: {
    agenda?: AgendaDoc | null
    brief?: WritingBrief
    recentIntents?: Array<{ kind: string; sectionId?: string }>
    focusedSectionId?: string | null
    attachments?: Array<{ type: string; name: string }>
  },
): string {
  const parts: string[] = []

  if (context.brief) {
    parts.push(`## Brief 摘要`)
    parts.push(`体裁: ${context.brief.genre}, 语气: ${context.brief.tone.join('/')}, 篇幅: ${context.brief.length}`)
    const skills = context.brief.skills.map((s: SkillRef) => s.name).join(', ')
    if (skills) parts.push(`Skills: ${skills}`)
  }

  if (context.agenda) {
    parts.push(`\n## 当前议程`)
    for (const sec of context.agenda.sections) {
      parts.push(`- ${sec.id} (order ${sec.order}): "${sec.heading}" [${sec.status}]`)
    }
  }

  if (context.recentIntents && context.recentIntents.length > 0) {
    parts.push(`\n## 最近 3 条 Intent`)
    for (const ri of context.recentIntents.slice(-3)) {
      parts.push(`- ${ri.kind}${ri.sectionId ? ` → ${ri.sectionId}` : ''}`)
    }
  }

  if (context.focusedSectionId) {
    parts.push(`\n## UI 焦点: ${context.focusedSectionId}`)
  }

  if (context.attachments && context.attachments.length > 0) {
    parts.push(`\n## @mention 附件`)
    for (const att of context.attachments) {
      parts.push(`- ${att.type}: ${att.name}`)
    }
  }

  parts.push(`\n## 用户指令\n${userMessage}`)
  parts.push(`\n请分类为 WriterIntent JSON。`)

  return parts.join('\n')
}

// ============================================
// v2: 全文写作 + 对话式修改 Prompt
// ============================================

/** v2 全文写作 system prompt (对话驱动, 一气呵成) */
export const WRITING_CHAT_SYSTEM_PROMPT = `# DunCrew 写作助手 v2

你是 DunCrew 自习室的写作助手。用户会通过对话驱动写作, 你需要:

1. 当用户要求写文章时, 直接输出完整的 Markdown 格式文章
2. 当用户要求修改时, 输出修改后的完整文章
3. 在写作过程中引用证据时使用 [^Lxx] 格式标注

## 输出规范

- 直接输出 Markdown 正文, 不加围栏, 不加元评论
- 文章应结构完整: 有标题、有章节、有结论
- 引用证据用 [^Lxx] 格式内嵌
- 保持体裁纯度和语气一致性
- 不输出 "以下是我的文章" 之类的前缀, 直接开写

## 你不做的事

- 不问澄清问题 (除非信息严重不足)
- 不输出元评论或水印
- 不拒绝合理的写作请求`

/**
 * v2: 全文写作 user prompt (带议程作为内部思维链)
 */
export function buildFullWritingPrompt(
  brief: WritingBrief,
  pool: EvidenceItem[],
  agenda: AgendaDoc,
  memorySnippets?: MemorySnippet[],
): string {
  const briefCtx = formatBriefContext(brief)
  const evidenceCtx = formatEvidencePool(pool)
  const memoryCtx = formatMemorySnippetsForPrompt(memorySnippets)
  // 注入风格指纹 (如果 session 应用了); 指纹优先级最高, 风格档案需要据此降级
  const appliedFingerprint = resolveFingerprintForBrief(brief)
  const fingerprintCtx = formatFingerprint(appliedFingerprint)
  // 注入自习室风格档案 (独立于全局 L0/L1 记忆); 有指纹时 preferences 降级为软参考, avoidPatterns 保留硬红线
  const styleCtx = formatWriterStyleContext(
    getStyleContext(brief.genre),
    { hasFingerprint: !!appliedFingerprint },
  )

  const agendaCtx = agenda.sections.map((sec, i) =>
    `${i + 1}. ${sec.heading} (约${sec.targetLength}字) — ${sec.intent}`,
  ).join('\n')

  const parts = [
    briefCtx,
    fingerprintCtx,  // 指纹优先级最高, 放在档案前面
    styleCtx,
    evidenceCtx,
    memoryCtx,
    `## 写作结构 (内部参考, 不要在文章中暴露)`,
    agenda.openingStance ? `立意: ${agenda.openingStance}` : '',
    agendaCtx,
    agenda.closingCall ? `收束: ${agenda.closingCall}` : '',
    `## 任务`,
    `请根据以上写作契约、风格档案、证据池和结构参考, 撰写完整文章。要求:`,
    `1. 直接输出完整 Markdown 文章 (含标题)`,
    `2. 用 [^Lxx] 格式标注引用`,
    `3. 总字数约 ${agenda.sections.reduce((sum, s) => sum + s.targetLength, 0)} 字`,
    `4. 一气呵成, 结构完整, 逻辑流畅`,
    `5. 如果有"文风指纹", **必须**严格模仿其风格 (优先级最高)`,
    `6. 如果有"用户写作风格档案", 必须遵守其偏好和避免清单`,
  ].filter(Boolean)

  return parts.join('\n\n')
}

/** 固定的变更摘要分隔符 — 前端依赖这个字符串切分文章和 JSON */
export const EDIT_SUMMARY_DELIMITER = '===EDIT_SUMMARY==='

/**
 * v2: 对话式修改 user prompt (带当前全文 + 用户指令 + 对话历史 + 议程 + 长期记忆)
 *
 * 产出格式 (两段, 用固定分隔符分开):
 *   <修改后的完整 Markdown 文章>
 *   ===EDIT_SUMMARY===
 *   {"summary":"...", "changes":[{"where":"...","what":"...","why":"..."}]}
 */
export function buildConversationalEditPrompt(
  currentDocument: string,
  userInstruction: string,
  brief: WritingBrief,
  pool: EvidenceItem[],
  options?: {
    chatHistory?: WriterChatMessage[]
    agenda?: AgendaDoc | null
    memorySnippets?: MemorySnippet[]
    freshEvidence?: EvidenceItem[] // 本轮新召回的证据 (高亮给 LLM 看)
  },
): string {
  const briefCtx = formatBriefContext(brief)

  // 普通证据池 + 本轮新增证据 (如果有)
  const freshIds = new Set((options?.freshEvidence || []).map((e) => e.id))
  const oldPool = pool.filter((e) => !freshIds.has(e.id))
  const freshPool = options?.freshEvidence || []

  const evidenceSections: string[] = []
  if (oldPool.length > 0) {
    evidenceSections.push(
      `## 历史证据池 (${oldPool.length} 条, 首次写作已使用)\n` +
      oldPool.slice(0, 10).map((e) => `- [${e.id}] ${e.title}: ${e.snippet.slice(0, 150)}`).join('\n'),
    )
  }
  if (freshPool.length > 0) {
    evidenceSections.push(
      `## 本轮新召回证据 (${freshPool.length} 条, 专门为当前修改指令搜索, 优先参考)\n` +
      freshPool.slice(0, 10).map((e) => `- [${e.id}] ${e.title}: ${e.snippet.slice(0, 150)}`).join('\n'),
    )
  }
  if (evidenceSections.length === 0) {
    evidenceSections.push('## 证据池\n(本轮没有可用证据, 请基于现有文章和你的常识修改)')
  }

  const chatCtx = options?.chatHistory ? formatChatHistory(options.chatHistory, 6) : ''
  const memoryCtx = formatMemorySnippetsForPrompt(options?.memorySnippets)
  // 注入风格指纹 (如果 session 应用了); 指纹优先级最高, 风格档案需要据此降级
  const appliedFingerprint = resolveFingerprintForBrief(brief)
  const fingerprintCtx = formatFingerprint(appliedFingerprint)
  // 注入自习室风格档案 (独立于全局 L0/L1 记忆); 有指纹时 preferences 降级为软参考, avoidPatterns 保留硬红线
  const styleCtx = formatWriterStyleContext(
    getStyleContext(brief.genre),
    { hasFingerprint: !!appliedFingerprint },
  )

  let agendaCtx = ''
  if (options?.agenda && options.agenda.sections.length > 0) {
    const lines = options.agenda.sections.map(
      (s, i) => `${i + 1}. ${s.heading} — ${s.intent}`,
    ).join('\n')
    agendaCtx = [
      `## 原始写作骨架 (首次写作时的结构规划, 修改时尽量保持大结构)`,
      options.agenda.openingStance ? `立意: ${options.agenda.openingStance}` : '',
      lines,
      options.agenda.closingCall ? `收束: ${options.agenda.closingCall}` : '',
    ].filter(Boolean).join('\n')
  }

  const parts = [
    briefCtx,
    fingerprintCtx,  // 指纹优先级最高
    styleCtx,
    agendaCtx,
    chatCtx,
    memoryCtx,
    evidenceSections.join('\n\n'),
    `## 当前文章全文\n\n${currentDocument}`,
    `## 用户本轮修改指令\n\n${userInstruction}`,
  ].filter(Boolean)

  return parts.join('\n\n') + `

## 任务

请根据用户的修改指令, 输出修改后的完整文章, **并在结尾附上变更摘要**。

### 输出格式 (严格遵守)

分为两部分, 用固定分隔符 \`${EDIT_SUMMARY_DELIMITER}\` 隔开:

**第一部分: 修改后的完整 Markdown 文章**
- 保持未修改部分原文不变
- 按用户指令修改相关段落
- 保持引用格式 [^Lxx] 一致
- 不加解释、不加代码围栏

**第二部分: 变更摘要 JSON**
- 在文章末尾换行后输出分隔符 \`${EDIT_SUMMARY_DELIMITER}\`
- 分隔符之后输出单个 JSON 对象, 不包裹在代码块中
- Schema:
\`\`\`json
{
  "summary": "一句话总结这次改了什么 (中文, 不超过 40 字)",
  "changes": [
    {
      "where": "改动位置 (如 '§2 现象' / '开头段' / '结论' / '全文')",
      "what": "改了什么 (具体到: 替换/新增/删除/重组 了什么)",
      "why": "为什么这么改 (对用户指令的理解 + 你的策略)"
    }
  ],
  "skipped": ["若用户指令里有你无法执行或刻意跳过的部分, 列出并说明原因; 没有则省略此字段"]
}
\`\`\`

### 示例输出

\`\`\`
# 智能体经济发展研究

## 一、引言
...<修改后的正文>...

## 二、现象
...<修改后的正文>...

${EDIT_SUMMARY_DELIMITER}
{"summary":"精简第二段至 400 字并补充 GDP 数据","changes":[{"where":"§2 现象","what":"删除冗余的背景介绍(约 200 字), 并引入 [^L3] 的 GDP 数据","why":"用户要求'更短更聚焦', 同时补数据增强说服力"}]}
\`\`\`

### 重要

- **必须**在文章末尾输出分隔符和 JSON, 否则前端无法展示变更反馈
- \`changes\` 数组至少 1 项, 最多 5 项, 聚焦真正的改动, 不要列琐碎的措辞替换
- JSON 必须是合法的单行或多行 JSON (不要带尾逗号)`
}

// ============================================
// Length Review (内部复核, 用户无感)
// ============================================

/** Length review 的章节字数实测数据 */
export interface SectionLengthMeasure {
  sectionId: string
  heading: string
  targetLength: number
  actualLength: number
  /** 偏差比例, (actual - target) / target, 正值表示超长, 负值表示不足 */
  deviation: number
}

/**
 * 构造 length review 的 user prompt.
 *
 * 目的: 写完全文后, 让 LLM 回看"实际字数分布 vs 目标字数", 自主判断:
 *   - accept: 实际篇幅就是该题目应有的样子, agenda 当初的目标值略偏无妨
 *   - rewrite_section: 某节实际字数严重偏离, 是"没写到位 / 啰嗦", 应该重写该节
 *   - update_agenda: agenda 当初的 targetLength 判断失误, 实际成稿是合理的, 应该更新目标值
 *
 * 硬约束:
 *   - 当 brief.lengthExplicit === true (用户明确指定了字数), 禁止 update_agenda,
 *     因为那相当于擅自改变用户的硬性要求, 只能 rewrite_section 或 accept.
 *   - 输出必须是严格 JSON, 不要解释.
 */
export function buildLengthReviewPrompt(
  brief: WritingBrief,
  agenda: AgendaDoc,
  measures: SectionLengthMeasure[],
  roundIndex: number,
  maxRounds: number,
  fullText?: string,
): string {
  const totalTarget = agenda.sections.reduce((s, x) => s + x.targetLength, 0)
  const totalActual = measures.reduce((s, m) => s + m.actualLength, 0)
  const totalDev = totalTarget > 0 ? (totalActual - totalTarget) / totalTarget : 0

  const measureLines = measures.map((m, i) => {
    const sign = m.deviation >= 0 ? '+' : ''
    return `${i + 1}. [${m.sectionId}] "${m.heading}": 目标 ${m.targetLength} 字, 实际 ${m.actualLength} 字 (${sign}${Math.round(m.deviation * 100)}%)`
  }).join('\n')

  const fingerprintCtx = formatFingerprint(resolveFingerprintForBrief(brief))

  // 全文可选注入: 终审需要通读说服力, 但过长时截断为首尾拼接以控成本
  const MAX_FULLTEXT_CHARS = 6000
  const fullTextCtx = (() => {
    if (!fullText || fullText.trim().length === 0) return ''
    const trimmed = fullText.trim()
    if (trimmed.length <= MAX_FULLTEXT_CHARS) {
      return `## 全文成稿\n\n${trimmed}`
    }
    const headLen = Math.floor(MAX_FULLTEXT_CHARS * 0.6)
    const tailLen = MAX_FULLTEXT_CHARS - headLen
    return [
      `## 全文成稿 (过长, 已截取首尾)`,
      ``,
      trimmed.slice(0, headLen),
      ``,
      `...(中间省略 ${trimmed.length - MAX_FULLTEXT_CHARS} 字)...`,
      ``,
      trimmed.slice(-tailLen),
    ].join('\n')
  })()

  const lockPolicy = brief.lengthExplicit
    ? [
      `## 重要约束 (用户已显式指定篇幅)`,
      `用户在原始意图中明确要求了总字数 (见"写作契约"的 constraints).`,
      `**禁止**使用 action="update_agenda" — 你无权擅自修改用户的硬性要求.`,
      `只能在 action="rewrite_section" 和 action="accept" 之间选择.`,
      `若实际总字数严重偏离用户要求, 必须 rewrite_section 向目标靠拢.`,
    ].join('\n')
    : [
      `## 决策自由度 (用户未指定篇幅)`,
      `用户没有明确指定字数, agenda 的 targetLength 是你上一轮的自主判断.`,
      `现在可以反思: 当初的判断对吗? 还是实际成稿才是这个题目的自然篇幅?`,
      `三种选项都合法, 按"实际成稿质量"判断, 不要机械追求偏差归零.`,
    ].join('\n')

  return [
    `## 写作契约 (节选)`,
    `- 意图: ${brief.intent}`,
    brief.constraints.length > 0 ? `- 约束: ${brief.constraints.join('; ')}` : '',
    ``,
    fingerprintCtx,
    ``,
    `## 原始篇幅决策理由 (你上一轮自己写的)`,
    agenda.lengthRationale || '(当初未提供 lengthRationale)',
    ``,
    `## 实测字数分布 (第 ${roundIndex + 1} / ${maxRounds} 轮终审)`,
    `全文目标: ${totalTarget} 字, 实际: ${totalActual} 字 (${totalDev >= 0 ? '+' : ''}${Math.round(totalDev * 100)}%)`,
    ``,
    measureLines,
    ``,
    fullTextCtx,
    ``,
    lockPolicy,
    ``,
    `## 任务 (终审)`,
    `这是交稿前的最后一关. 请同时戴上两副眼镜通读全文, 综合判断是否需要最后一次修订:`,
    ``,
    `### 眼镜 1: 作者风格忠诚度 (最重要)`,
    `对照上方"文风指纹 / 作者档案". 全文是否保持了作者的口吻? 有没有哪一节读起来"不像这位作者"`,
    `(比如突然变得很干瘪, 或者被某种陈词滥调污染)?`,
    `这是终审的第一优先级——**风格失真即使字数完全达标也要重写**.`,
    ``,
    `### 眼镜 2: 篇幅合理性`,
    `再看字数分布. 某节的偏差是内容问题 (啰嗦 / 没写够) 还是这个题目的自然形状?`,
    ``,
    `## 决策原则`,
    `- **只挑最严重的一个问题处理**: 即使同时有多个问题, 一次只动一处 (或直接 accept)`,
    `- **风格 > 字数**: 两者冲突时优先保风格`,
    `- **不要为了改而改**: 默认倾向 accept, 只有"真的影响成稿质量"的问题才重写`,
    `- 单节字数偏差 < 30% 且全文偏差 < 25% → accept`,
    `- 已经是最后一轮 (${roundIndex + 1} === ${maxRounds}): 强烈倾向 accept, 避免无限重写`,
    ``,
    `输出 JSON 决策. Schema:`,
    '```json',
    `{`,
    `  "overallAssessment": "一句话: 全文整体如何? 两副眼镜各自看到了什么?",`,
    `  "primaryConcern": "length" | "style" | "none",`,
    `  "action": "accept" | "rewrite_section" | "update_agenda",`,
    `  "sectionId": "仅 action=rewrite_section 或 update_agenda 时必填",`,
    `  "reason": "做此决定的理由 (不超过 100 字, 说清楚是哪副眼镜看到了问题)",`,
    `  "rewriteHint": "仅 rewrite_section 时填: 给写作阶段的具体提示, 明确说明是改风格/字数中的哪一项, 以及具体怎么改",`,
    `  "newTargetLength": "仅 update_agenda 时填: 更新后的 targetLength 数字"`,
    `}`,
    '```',
    ``,
    `只输出 JSON, 不要包裹 markdown 代码块, 不要解释.`,
  ].filter((s) => s !== '').join('\n')
}

// ============================================
// Reader Modeling 已下线 (v3.1)
// ============================================
// 原因: 正向读者画像的 averseTo 字段会对 LLM 产生负向引导, 和文风指纹的方向相反,
// 两股力同时拉会把文字挤向平庸的"平均值". 砍掉让指纹独占风向盘.

// ============================================
// Agenda Self-Critique (Stage 2 Phase 2: 提纲自批)
// ============================================

/**
 * Agenda 自我批判 prompt.
 *
 * 让 LLM 以"刚写完提纲的作者 + 挑剔读者"的双重身份回看自己的提纲,
 * 判断这个提纲能否撑得起一篇有说服力的文章.
 */
export function buildAgendaCritiquePrompt(
  brief: WritingBrief,
  agenda: AgendaDoc,
  roundIndex: number,
  maxRounds: number,
): string {
  const briefCtx = formatBriefContext(brief)
  const agendaCtx = agenda.sections.map((s, i) =>
    `${i + 1}. ${s.heading} (${s.targetLength} 字) — ${s.intent}`,
  ).join('\n')

  return [
    briefCtx,
    ``,
    `## 你刚写好的提纲 (第 ${roundIndex + 1}/${maxRounds} 稿)`,
    agenda.openingStance ? `立意: ${agenda.openingStance}` : '',
    agendaCtx,
    agenda.closingCall ? `收束: ${agenda.closingCall}` : '',
    agenda.lengthRationale ? `篇幅理由: ${agenda.lengthRationale}` : '',
    ``,
    `## 任务`,
    `放下笔. 假装这不是你写的提纲, 而是别人发给你审阅的. 你是一位经验丰富、读稿无数的编辑.`,
    ``,
    `请冷静地问自己几个问题:`,
    `- 按这个提纲写出来, 读者能"**迅速形成共识**"吗? 还是会在中途觉得你在绕圈子?`,
    `- 每一节都在**推进论证**吗? 有没有哪一节其实是"凑数"或"自说自话"?`,
    `- 相邻两节之间的**衔接**成立吗? 还是有断裂、重复、跳跃?`,
    `- 立意 (openingStance) 和收束 (closingCall) 之间真的形成了**完整的说服链**吗?`,
    `- 有没有哪个关键环节被漏掉了, 导致读者到某一节会问"所以呢?"?`,
    ``,
    `这是第 ${roundIndex + 1} 轮批判 (共 ${maxRounds} 轮). 如果你觉得这稿真的够了, 就让它过.`,
    `不要为了批判而批判——好的提纲应该放行, 不完美但够用也应该放行. 只有存在**影响说服力**的实质问题才拦下.`,
    ``,
    `输出 JSON, schema:`,
    '```json',
    `{`,
    `  "pass": true | false,`,
    `  "issues": ["具体问题 1", "具体问题 2"],`,
    `  "suggestion": "若 pass=false, 给出修订方向 (一段话, 不超过 150 字); pass=true 时省略"`,
    `}`,
    '```',
    ``,
    `只返回 JSON, 不要包裹 markdown 代码块.`,
  ].filter((s) => s !== '').join('\n')
}

/**
 * Agenda 修订 prompt.
 * 基于上一版 agenda + critique 意见, 产出新一版 agenda JSON (同首次 agenda 的 schema).
 */
export function buildAgendaRevisePrompt(
  brief: WritingBrief,
  previousAgenda: AgendaDoc,
  issues: string[],
  suggestion: string,
): string {
  const briefCtx = formatBriefContext(brief)
  const prevCtx = JSON.stringify({
    title: previousAgenda.title,
    subtitle: previousAgenda.subtitle,
    openingStance: previousAgenda.openingStance,
    closingCall: previousAgenda.closingCall,
    lengthRationale: previousAgenda.lengthRationale,
    sections: previousAgenda.sections.map((s) => ({
      order: s.order,
      heading: s.heading,
      intent: s.intent,
      targetLength: s.targetLength,
      evidencePocket: s.evidencePocket,
      skillHints: s.skillHints,
    })),
  }, null, 2)

  return [
    briefCtx,
    ``,
    `## 上一版提纲`,
    '```json',
    prevCtx,
    '```',
    ``,
    `## 你自己刚才提出的批判意见`,
    issues.map((i) => `- ${i}`).join('\n'),
    ``,
    `## 修订方向`,
    suggestion,
    ``,
    `## 任务`,
    `基于上述批判, 重新输出一版提纲 JSON. 格式与首次提纲完全一致 (含 title, openingStance, closingCall, lengthRationale, sections).`,
    `注意:`,
    `- 不要因为要"改"就把不该动的也动了. 只修订批判意见涉及的部分.`,
    `- 保留原本合理的节数、字数分配、证据分配.`,
    `- 修订的目标是**更有说服力**, 不是"换个说法".`,
    ``,
    `只返回 JSON, 不要包裹 markdown 代码块.`,
  ].join('\n')
}

// ============================================
// Paragraph Sequential Writing (Stage 3: 逐段生成)
// ============================================

/**
 * 段落生成 prompt (用于逐段流式写作).
 *
 * 与 buildFullWritingPrompt 的差异:
 *   - buildFullWritingPrompt: 一次写整篇, LLM 自由切分段落
 *   - buildParagraphComposePrompt: 一次只写一节, 已完成部分作为上文
 */
export function buildParagraphComposePrompt(
  brief: WritingBrief,
  agenda: AgendaDoc,
  currentSection: AgendaSection,
  pool: EvidenceItem[],
  previousText: string,
  memorySnippets?: MemorySnippet[],
): string {
  const briefCtx = formatBriefContext(brief)
  const evidenceCtx = formatEvidencePool(pool)
  const memoryCtx = formatMemorySnippetsForPrompt(memorySnippets)
  // 指纹优先级最高, 风格档案需要据此降级
  const appliedFingerprint = resolveFingerprintForBrief(brief)
  const fingerprintCtx = formatFingerprint(appliedFingerprint)
  const styleCtx = formatWriterStyleContext(
    getStyleContext(brief.genre),
    { hasFingerprint: !!appliedFingerprint },
  )

  const sectionIdx = agenda.sections.findIndex((s) => s.id === currentSection.id)
  const isFirst = sectionIdx === 0
  const isLast = sectionIdx === agenda.sections.length - 1

  const fullOutline = agenda.sections.map((s, i) => {
    const marker = s.id === currentSection.id ? '→ ' : '  '
    return `${marker}${i + 1}. ${s.heading} (${s.targetLength} 字)`
  }).join('\n')

  const parts = [
    briefCtx,
    fingerprintCtx,
    styleCtx,
    evidenceCtx,
    memoryCtx,
    `## 全文结构 (内部参考, 不要暴露)`,
    agenda.openingStance ? `立意: ${agenda.openingStance}` : '',
    fullOutline,
    agenda.closingCall ? `收束: ${agenda.closingCall}` : '',
    ``,
    previousText
      ? `## 已完成的上文 (不要复制, 不要总结, 你要续写下去)\n\n${previousText}`
      : `## 已完成的上文\n\n(本节是第一节, 上文为空. 你要开篇.)`,
    ``,
    `## 当前要写的这一节`,
    `- 标题: ${currentSection.heading}`,
    `- 意图: ${currentSection.intent}`,
    `- 目标字数: ${currentSection.targetLength} 字 (±15%)`,
    currentSection.skillHints.length > 0 ? `- 适用技能: ${currentSection.skillHints.join(', ')}` : '',
    ``,
    `## 任务`,
    `只写这一节. 要求:`,
    `1. **从 Markdown 标题行开始** (如 "## ${currentSection.heading}"), 包含本节标题 + 本节正文`,
    isFirst
      ? `2. 这是全文开头——第一句话就要让人**愿意读下去**; 如果用户在 brief 里指定了文章总标题, 请先输出 "# <总标题>" 再输出本节 "## " 标题`
      : `2. 开头自然衔接上文 (不要用"接下来"/"首先"这种套话)`,
    isLast
      ? `3. 这是全文收束——要呼应立意, 给一个"合上文章还想回味"的结尾`
      : `3. 结尾为下一节"${agenda.sections[sectionIdx + 1]?.heading || ''}"留出自然的承接, 但**不要剧透**下一节内容`,
    `4. 按作者自己的笔触写, 该展开的展开, 该略过的略过`,
    `5. 引用证据用 [^Lxx] 格式内嵌`,
    `6. 直接输出 Markdown 正文, 不加代码围栏, 不加元评论`,
  ].filter(Boolean)

  return parts.join('\n\n')
}

// ============================================
// 意图分类 (Writer Intent Classify) — 讨论 vs 改文 vs 首次写作
// ============================================

/**
 * 意图分类系统提示词.
 *
 * 输入: 用户最新一条消息 + (可选)当前文章快照 + (可选)最近对话摘要
 * 输出: 严格 JSON { intent, confidence, reason }
 *
 * 设计原则:
 *   - 尽量轻量 (≤ 200 tokens 输出), 不写任何正文
 *   - 文章空态下: 用户发消息 → 大概率是 write, 但也可能是 discuss (比如先聊想法)
 *   - 文章非空态下: 默认优先 discuss (让用户先问, 不要冒然改文) —— 除非用户明确要求修改
 *   - 置信度 < 0.7 时返回 unclear, 前端会反问
 */
export const WRITER_INTENT_CLASSIFY_PROMPT = `# WRITER_INTENT_CLASSIFY_PROMPT v1.0

你是 DunCrew 自习室的意图分类器。用户正在和 AI 协作写一篇文章, 右侧是对话框, 左侧是文章全文 (可能为空).
你的**唯一**职责是: 把用户最新一条消息分类为以下四类之一, 输出严格 JSON. 不要做任何其他事.

## 四种意图

- **discuss**: 用户想就文章内容 / 写作思路 / 相关话题和你讨论, 不需要你修改文章.
  典型: "这段为什么这么写?" / "你觉得立意怎么样?" / "帮我分析这个论点的漏洞" / "再给我讲讲那个数据背景".
- **edit**: 用户想让你**直接修改**当前已有的文章 (文章非空).
  典型: "把第二段再短一点" / "开头改得更有冲击力" / "补一段关于 X 的内容" / "全文换成更正式的语气".
- **write**: 用户想让你**从零开始写**一篇新文章 (通常文章为空).
  典型: "写一篇关于 AI 教育的分析报告" / "帮我起草一封致供应商的感谢信".
- **unclear**: 上述三者都不明显, 或同时像两种 (例如既像讨论又像改文). 此时必须返回 unclear, 前端会反问用户.

## 分类判据

### 硬规则 (先套这些, 命中就定)
1. 如果"当前文章"为空字符串或只有空白: edit 不成立, 在 discuss / write / unclear 里选.
2. 如果用户消息包含"改/删/加/写/润色/扩/缩/换/调整"等明确编辑动词 + 指向文章内容: edit.
3. 如果用户消息包含"写一篇/起草/帮我写/来一份"等从零创作动词: write.
4. 如果用户消息是疑问句 (以"为什么/怎么/能否/是不是/对吗/你觉得"等开头或结尾是"?"/"吗"): 优先 discuss.
5. 如果用户消息只是表达想法、感受、评价, 没有祈使动词: discuss.

### 软规则 (硬规则都不命中时)
- 有当前文章 + 指令含糊 (如"再优化下") → 倾向 edit, 但置信度压到 0.6-0.75.
- 无当前文章 + 消息很短 → 倾向 write.
- 同时像 discuss 和 edit (如"这段写得好吗? 顺便改下") → unclear.

## 置信度

- confidence ∈ [0, 1]
- ≥ 0.85 : 明确
- 0.7-0.85 : 比较明确, 直接走
- < 0.7 : **必须**返回 intent="unclear" (置信度字段仍如实填)

## 输出格式 (严格)

只输出单个 JSON 对象, 不要任何解释, 不要代码围栏, 不要前后空行:

\`\`\`
{"intent":"discuss|edit|write|unclear","confidence":0.0-1.0,"reason":"用 ≤ 30 字说明分类理由"}
\`\`\`

## 你绝对不做的事

- 不写文章正文
- 不改文章
- 不回答用户的问题本身
- 不输出除 JSON 以外的任何字符`

/** 构造意图分类的 user prompt (轻量: 只带必要上下文) */
export function buildWriterIntentClassifyPrompt(
  userMessage: string,
  options?: {
    /** 当前文章全文, 用于判断 edit 是否成立; 过长会被截断 */
    currentDocument?: string
    /** 最近对话摘要, 帮助判断"这段/刚才那个"等指代 */
    recentChatDigest?: string
  },
): string {
  const doc = (options?.currentDocument || '').trim()
  const docLen = doc.replace(/\s/g, '').length

  // 文章过长时截首尾, 控 token
  const MAX_DOC_CHARS = 1200
  let docCtx: string
  if (docLen === 0) {
    docCtx = '## 当前文章\n(空 — 用户还未开始写作)'
  } else if (doc.length <= MAX_DOC_CHARS) {
    docCtx = `## 当前文章 (${docLen} 字)\n\n${doc}`
  } else {
    const head = doc.slice(0, 600)
    const tail = doc.slice(-400)
    docCtx = `## 当前文章 (${docLen} 字, 已截取首尾)\n\n${head}\n\n...(中间省略)...\n\n${tail}`
  }

  const chatCtx = options?.recentChatDigest
    ? `## 最近对话 (参考指代)\n${options.recentChatDigest}`
    : ''

  return [
    docCtx,
    chatCtx,
    `## 用户最新一条消息`,
    userMessage,
    `## 任务`,
    `按系统提示的规则分类, 输出 JSON. 不要做任何其他事.`,
  ].filter(Boolean).join('\n\n')
}

// ============================================
// 讨论模式 (Writer Discuss) — 聊文章但不改文章
// ============================================

/**
 * 讨论模式系统提示词.
 *
 * 关键约束:
 *   - **绝不**修改文章 / 输出完整文章
 *   - 可以引用文章原文片段 (用 > 引用块) 以回答问题
 *   - 末尾**可选**给出一个"建议修改" JSON 块 (让用户一键转去改文), 但必须放在分隔符后
 */
export const WRITER_DISCUSS_SYSTEM_PROMPT = `# WRITER_DISCUSS_SYSTEM_PROMPT v1.0

你是 DunCrew 自习室的"写作讨论伙伴". 用户正在和你一起写一篇文章, 他现在想就**内容本身**和你聊聊,
**不是**让你动手改文章. 你的职责是: 基于当前文章 + 证据池 + 背景记忆, 和用户平等地讨论, 给出有见地的回答.

## 你可以做的

- 回答用户关于文章内容、立意、论据、结构、风格的问题
- 引用文章原文片段来支撑你的观点 (用 Markdown > 引用块)
- 解释某段话背后的写作逻辑 / 证据选择 / 语气决策
- 给出你的观察、建议、不同角度的看法
- 如果对话中你发现某个具体的"可以改一改"的点, 可以在回答末尾附上一个**建议修改**块 (见下方)

## 你绝对不做的事

- **不输出完整或大段改写后的文章**. 你不是执行者, 是讨论伙伴.
- 不默认写新段落. 哪怕用户说"顺便写一下", 也应先确认"你是想让我改文章, 还是先聊聊?"
- 不输出元评论 ("作为一个 AI 助手..." 这类)
- 不空泛地夸奖或敷衍 ("写得很好!" 这种), 要给具体的、基于文本的回答

## 引用文章原文

当你要谈论文章某一段时, 用 Markdown 引用块摘一两句关键原文, 再展开讨论:

> 示例:
> > "智能体经济正在重塑生产关系..."
>
> 这一句开篇立意很强, 但"重塑生产关系"本身是个大概念, 后文需要一个具体的抓手来承接, 否则读者容易悬空.

## 回答长度

- 简短 (≤ 200 字): 如果是简单问答
- 中等 (200-500 字): 如果涉及分析、解释
- 长 (500+ 字): 只在用户明确要求深入分析时
- 不要为了显得认真就拉长, **信息密度 > 篇幅**

## 可选: 建议修改 (分隔符后输出)

如果你在回答中自然地发现"这里确实可以改一下", 可以在正文结束后换行输出分隔符, 然后输出一个 JSON:

\`\`\`
===SUGGESTED_EDIT===
{"summary":"一句话描述建议改什么 (≤ 30 字)", "instruction":"具体改法指令 (给改文系统用, ≤ 100 字)"}
\`\`\`

**重要**:
- 分隔符前是正常的讨论回答 (Markdown 文本)
- 分隔符后**只能**是一个 JSON, 不要代码围栏, 不要解释
- 如果不需要建议修改 (纯聊天 / 用户没问改的事), **不要**输出分隔符, 也不要输出 JSON
- 最多一个 suggested edit, 不要列清单
- instruction 要具体可执行, 像给同事下一道指令, 不要模糊`

/** 讨论模式 user prompt 的建议修改分隔符 — 前端依赖此常量切分 */
export const SUGGESTED_EDIT_DELIMITER = '===SUGGESTED_EDIT==='

/**
 * 讨论模式 user prompt 构造器.
 *
 * 注意: 不强制带议程 — 讨论模式优先"能回答问题"而非"保持写作计划".
 */
export function buildWriterDiscussPrompt(
  currentDocument: string,
  userMessage: string,
  brief: WritingBrief,
  pool: EvidenceItem[],
  options?: {
    chatHistory?: WriterChatMessage[]
    memorySnippets?: MemorySnippet[]
    freshEvidence?: EvidenceItem[]
  },
): string {
  const briefCtx = formatBriefContext(brief)
  // 指纹注入: 讨论模式虽不改文, 但给的建议要贴合作者口吻,
  // 避免"让张三按李四的路子改"的违和感.
  const fingerprintCtx = formatFingerprint(resolveFingerprintForBrief(brief))

  const freshIds = new Set((options?.freshEvidence || []).map((e) => e.id))
  const oldPool = pool.filter((e) => !freshIds.has(e.id))
  const freshPool = options?.freshEvidence || []

  const evidenceSections: string[] = []
  if (oldPool.length > 0) {
    evidenceSections.push(
      `## 证据池 (${oldPool.length} 条, 可引用也可不用)\n` +
      oldPool.slice(0, 10).map((e) => `- [${e.id}] ${e.title}: ${e.snippet.slice(0, 150)}`).join('\n'),
    )
  }
  if (freshPool.length > 0) {
    evidenceSections.push(
      `## 本轮新召回证据 (${freshPool.length} 条, 专门为这次讨论搜索)\n` +
      freshPool.slice(0, 10).map((e) => `- [${e.id}] ${e.title}: ${e.snippet.slice(0, 150)}`).join('\n'),
    )
  }

  const chatCtx = options?.chatHistory ? formatChatHistory(options.chatHistory, 6) : ''
  const memoryCtx = formatMemorySnippetsForPrompt(options?.memorySnippets)

  const doc = (currentDocument || '').trim()
  const docCtx = doc.length > 0
    ? `## 当前文章全文 (你可以引用原文片段, 但不要改它)\n\n${doc}`
    : `## 当前文章\n(空 — 用户还没开始写. 讨论时可以帮他理清思路, 但不要擅自写出完整文章)`

  const parts = [
    briefCtx,
    fingerprintCtx,
    chatCtx,
    memoryCtx,
    evidenceSections.join('\n\n'),
    docCtx,
    `## 用户本轮消息 (讨论, 不是改文指令)`,
    userMessage,
    `## 任务`,
    [
      `按系统提示的讨论伙伴身份回答. 要点:`,
      `1. **不要**输出完整或大段改写后的文章`,
      `2. 引用文章原文用 Markdown > 引用块, 引用证据用 [^Lxx]`,
      `3. 信息密度 > 篇幅, 不要为了显得认真就拉长`,
      `4. 若上方提供了"文风指纹", 给的任何改进建议都要能接在该作者的口吻上 (否则相当于让他变成另一个人)`,
      `5. 如果发现一个具体的可以改一改的点, 回答末尾可换行输出 \`${SUGGESTED_EDIT_DELIMITER}\` + JSON, 否则不要输出分隔符`,
    ].join('\n'),
  ].filter(Boolean)

  return parts.join('\n\n')
}

/**
 * 构造 length review 后的局部重写 prompt (用于 rewrite_section 决策).
 * 与 buildComposePrompt 不同: 这里是基于已成稿的整体上下文, 针对特定章节做重写.
 */
export function buildSectionRewritePrompt(
  brief: WritingBrief,
  agenda: AgendaDoc,
  targetSection: AgendaSection,
  currentDocument: string,
  rewriteHint: string,
): string {
  // agenda 目前未进 prompt (重写指令已包含所有信息), 保留签名以便后续注入 "在 agenda 里的位置/相邻章节标题" 的上下文
  void agenda
  const briefCtx = formatBriefContext(brief)
  // 指纹注入: 终审重写最容易"改着改着把作者口吻改没了",
  // 这里必须把指纹再次提醒一遍, 锁住风格.
  const fingerprintCtx = formatFingerprint(resolveFingerprintForBrief(brief))

  return [
    briefCtx,
    fingerprintCtx,
    ``,
    `## 当前全文 (需要在此基础上仅改写指定章节)`,
    ``,
    currentDocument,
    ``,
    `## 需要改写的章节`,
    `- 标题: ${targetSection.heading}`,
    `- 意图: ${targetSection.intent}`,
    `- 目标字数: ${targetSection.targetLength} 字 (±15%)`,
    ``,
    `## 改写指示 (来自 length review)`,
    rewriteHint,
    ``,
    `## 任务`,
    `请输出**完整的修改后全文** (Markdown), 保持其他章节原文不变, 仅按指示改写指定章节.`,
    `- 不要输出分隔符或 JSON 摘要 (这是内部复核, 不是对话式修改)`,
    `- 不要加代码围栏, 不要加元评论`,
    `- 保留原文的引用标注 [^Lxx]`,
    `- 若上方提供了"文风指纹", 重写部分必须与原文其他章节的口吻**无缝衔接**, 不得切换成通用写作腔`,
  ].filter((s) => s !== '' || s === '').join('\n')
}

// ============================================
// v3: One-Pass Writing (单次全文流式写作)
// ============================================

/**
 * 新版写作系统提示词 — 极简原则, 把注意力让给素材和风格.
 *
 * 设计理念:
 *   - 旧 WRITING_CONDUCTOR_PROMPT (~1500 token 的规范手册) 让 LLM 进入"合规模式"
 *   - 新 prompt 只给最核心的写作原则, 让 LLM 进入"创作模式"
 *   - token 预算从"指令占 50%"反转为"指令占 10%"
 */
export const ONE_PASS_WRITING_SYSTEM_PROMPT = `你是一位专业写作者。你的职责是根据用户的写作任务、参考素材和文风参考, 写出高质量的完整文章。

核心原则:
- 内容密度优先: 每句话都有信息量, 删掉也会影响理解的才留
- 结构服从内容: 该长就长, 该短就短, 不追求各节字数均匀
- 引用留痕: 使用素材时用 [^Lxx] 格式标注来源
- 风格浸润: 如果提供了"写作习惯"和"风格范文", 请内化这种声音来写, 而不是逐条核对规则`

/**
 * OUTLINE 标签约定: LLM 在正文前输出 <outline>...</outline> 块,
 * 前端从流中拆出来喂给侧栏 AgendaDoc 展示.
 * 正文不包含这个块.
 */
export const OUTLINE_TAG_OPEN = '<outline>'
export const OUTLINE_TAG_CLOSE = '</outline>'

/**
 * v3: 单次全文写作 user prompt.
 *
 * 替代旧管线的: buildAgendaPrompt + buildParagraphComposePrompt + buildFullWritingPrompt
 * 一次 LLM 调用, 先输出轻量 outline 再写全文.
 */
export function buildOnePassWritingPrompt(
  brief: WritingBrief,
  pool: EvidenceItem[],
  memorySnippets?: MemorySnippet[],
  fingerprintBlock?: string,
): string {
  // --- 写作任务 ---
  const taskLines = [
    `## 写作任务`,
    `${brief.intent}`,
    ``,
    `- 体裁: ${brief.genre}`,
    `- 语气: ${brief.tone.join(', ')}`,
    `- 受众: ${brief.audience}`,
  ]
  if (brief.constraints.length > 0) {
    taskLines.push(`- 硬约束: ${brief.constraints.join('; ')}`)
  }
  const skillNames = brief.skills.filter(s => s.priority === 'primary').map(s => s.name)
  if (skillNames.length > 0) {
    taskLines.push(`- 遵循技能: ${skillNames.join(', ')}`)
  }

  // --- 素材 ---
  const materialParts: string[] = []

  // 长期记忆
  if (memorySnippets && memorySnippets.length > 0) {
    const memLines = memorySnippets.slice(0, 8).map(
      (s) => `- [${s.source}] ${s.content.slice(0, 200)}`,
    )
    materialParts.push(`### 背景记忆\n${memLines.join('\n')}`)
  }

  // 证据池
  if (pool.length > 0) {
    const evidenceLines = pool.slice(0, 20).map(
      (e, i) => `- [${e.id || `${e.lens}${i + 1}`}] ${e.title}: ${e.snippet.slice(0, 250)}`,
    )
    materialParts.push(`### 证据池 (${pool.length} 条)\n${evidenceLines.join('\n')}`)
  }

  const materialsBlock = materialParts.length > 0
    ? `## 素材\n\n${materialParts.join('\n\n')}`
    : '## 素材\n(无额外素材, 请基于你的知识写作)'

  // --- 风格 (由调用方传入, 可能是 V2 行为规则或降级版) ---
  const styleBlock = fingerprintBlock || ''

  // --- 长度指引 ---
  const lengthHint = brief.lengthExplicit
    ? `## 长度要求\n用户明确要求约 ${extractLengthFromConstraints(brief) || '适中'} 字, 请尽量贴近。`
    : `## 长度指引\n根据题目复杂度自行判断合适的篇幅, 以内容需要为准, 不必追求特定字数。`

  // --- 输出格式指令 ---
  const formatInstr = [
    `## 输出要求`,
    `1. 先用 ${OUTLINE_TAG_OPEN}...${OUTLINE_TAG_CLOSE} 标签输出你的结构规划 (每节一行: "## 标题 — 一句话意图"), 这不会出现在正文里`,
    `2. 然后直接输出完整的 Markdown 文章 (含 # 标题)`,
    `3. 引用素材时用 [^Lxx] 格式内嵌`,
    `4. 不要输出代码围栏, 不要输出元评论或自我点评`,
  ].join('\n')

  return [
    taskLines.join('\n'),
    materialsBlock,
    styleBlock,
    lengthHint,
    formatInstr,
  ].filter(Boolean).join('\n\n')
}

/** 从 brief.constraints 中提取用户显式字数 (复用逻辑) */
function extractLengthFromConstraints(brief: WritingBrief): string | null {
  for (const c of brief.constraints) {
    const m = c.match(/(\d{3,5})\s*(字|words?)/i)
    if (m) return m[1]
  }
  return null
}

// ============================================
// v3: L0 Behavior Rule Extraction (两步法 Step 2)
// ============================================

/**
 * L0 行为规则提取的系统提示词.
 *
 * 这是两步法的 Step 2:
 *   Step 1: 已有的 L1 提取 (22 维画像 + 量化指标) — 不变
 *   Step 2: 用 L1 + 原文 → 提炼行为规则 — 本函数
 *
 * L1 是 L0 的提取基础: 量化指标和画像作为"锚点",
 * 帮助 LLM 精准捕捉行为模式, 而非飘向泛泛的描述.
 */
export const L0_EXTRACTION_SYSTEM_PROMPT = `你是一位文风分析师。你的任务是从文章样本中提炼出这位作者**最独特的写作行为规则**。

你会收到两类输入:
1. L1 分析层 (量化指标 + 22 维画像) — 这是已经提取好的结构化分析, 作为你的"锚点"
2. 原文样本 — 这是分层采样的文章片段

你的产出是一组 "When / Do / Not" 三元组, 每条描述一个可执行的写作行为模式.

【硬约束 1 · When 必须是内部判断, 不是外部位置】
  差的 when: "开头时" / "论证时" / "段落过渡处" / "引入新论点时"
  好的 when: "当读者可能抵触这个观点时" / "当想给一个论断减轻权威感时" /
            "当一段情感叙述需要被冷静打断时" / "当面对一个人人都认同的共识时"
  when 必须回答"作者在什么情境下会选择这么做", 而不是"文本的哪个位置".
  如果一条规则的 when 只能写成外部位置词, 说明这不是风格, 是排版习惯, 请删掉.

【硬约束 2 · 多源印证原则 (共识涌现)】
  每条规则必须在原文中至少出现 2 次, 且来自不同段落或不同样本.
  在 examples 数组中列出所有印证片段 (2-3 条, 每条 20-50 字).
  如果你只能找到 1 条印证, 说明这不是可复现的模式, 请删除这条规则.
  宁可一条规则都不产出, 也不要放没有多源印证的假规则.

【硬约束 3 · 宁缺毋滥, 按区分度排序】
  一条好规则 = 让另一位 AI 照着就能产生"哦, 这个语气像那个作者"的感觉.
  不要写"善于使用数据""论证严密"这种普适描述 — 人人都能这么做, 不是风格.
  只写这位作者区别于其他作者的独特之处.
  数量不限: 发现 2 条就输出 2 条, 按区分度从高到低排序.
  在 "do" 字段中, 请用引号标出作者的标志性词汇或句式.

【硬约束 4 · 三层语境都可以产出规则, 全放在同一个 rules 数组里】
  规则不只存在于句子层级. 请同时留意作者在以下三个语境层的行为模式,
  它们都放在同一个 rules 数组里, 不做额外分组:

  - 微观语境 (句子 / 段内):
      when 示例: "当需要自嘲时" / "当引用一个反常识数据时"
      回答"句子怎么写"

  - 中观语境 (段落 / 论证):
      when 示例: "当铺陈一个核心论题时" / "当面对可能抵触的读者时"
      回答"作者如何组织一段论证" / "如何让观点有说服力"

  - 宏观语境 (篇章 / 骨架):
      when 示例: "当组织一整篇文章时" / "当决定开篇从哪个角度切入时"
      回答"作者如何搭整篇骨架"

  三个层级不是必须都有. 如果作者在中观或宏观层没有明显独特模式, 不要凑数.
  但如果有, 请务必捕捉 — 这些往往比微观规则更能定义"像不像".

【硬约束 5 · 打磨模式 (可选, 仅当输入里出现"## 已有行为规则"时生效)】
  如果用户提供了"已有行为规则"(来自上一轮打磨的产物), 这些规则是你的**迭代锚点**,
  不是要被推翻的对象. 此时你的任务不是从零重写, 而是:

  - 印证强化: 如果新样本再次呈现了旧规则描述的模式, 保留这条规则,
    并在它的 examples 数组里 **合并进新样本里的新印证片段** (让多源印证更充分).
    共识是涌现的 — 每多一个来源的印证, 这条规则的置信度就更高.

  - 补充新规则: 只有当新样本呈现出旧规则**未覆盖**的独特模式时, 才新增规则.
    不要因为"旧规则表述不够优雅"就另起一条同义规则 (这是重写, 不是打磨).

  - 谨慎删改: 只有当旧规则在新样本中**反复出现反例** (至少 2 条反例, 来自不同段落),
    才能在输出里删掉它. 如果没有反例, 就保留原样.

  核心原则: 打磨 = 雕琢, 不是重塑. 好规则应该在一轮轮打磨中越来越厚实,
  而不是被每轮新样本清零重来.

同时请从文章中选出 2-3 段最能代表此风格的段落 (每段 300-500 字), 作为范文示例.
每段范文需附理由: 它展示了哪些行为规则.`

/**
 * 构建 L0 提取的 user prompt.
 *
 * @param l1Profile - Step 1 产出的 22 维画像 (JSON)
 * @param l1MetricsJson - Step 1 产出的量化指标 (JSON 字符串)
 * @param sampleText - 原文采样文本 (多篇×多段分层采样)
 * @param fingerprintName - 指纹名称
 * @param baseRules - 【打磨模式】上一轮的行为规则, 作为迭代锚点传给 LLM.
 *   传入后 SYSTEM_PROMPT 的"硬约束 5 · 打磨模式"会被激活, LLM 会印证强化旧规则
 *   而不是从零重写.
 */
export function buildL0ExtractionPrompt(
  l1Profile: WriterFingerprintProfile,
  l1MetricsJson: string,
  sampleText: string,
  fingerprintName: string,
  baseRules?: FingerprintBehaviorRule[],
): string {
  // 将 L1 画像渲染成可读文本 (与 formatFingerprint 类似, 但更简洁)
  const profileLines: string[] = []
  for (const group of PROFILE_FIELD_SPECS_BY_LAYER) {
    const groupLines: string[] = []
    for (const spec of group.fields) {
      const val = l1Profile[spec.key]
      const rendered = renderProfileFieldValue(spec, val)
      if (rendered) groupLines.push(`- ${spec.label}: ${rendered}`)
    }
    if (groupLines.length > 0) {
      profileLines.push(`#### ${group.label}\n${groupLines.join('\n')}`)
    }
  }

  // 【打磨模式】把旧规则渲染进 prompt, 触发 SYSTEM_PROMPT 的硬约束 5
  // 展示时连带展示每条规则已有的 examples, 让 LLM 知道哪些印证片段已经收录过,
  // 避免在新样本里找一模一样的片段重复计数
  let baseRulesSection = ''
  if (baseRules && baseRules.length > 0) {
    const ruleLines: string[] = []
    baseRules.forEach((r, i) => {
      ruleLines.push(`### 旧规则 ${i + 1}`)
      ruleLines.push(`- when: ${r.when || '(缺)'}`)
      ruleLines.push(`- do: ${r.do || '(缺)'}`)
      ruleLines.push(`- not: ${r.not || '(缺)'}`)
      const exs = (r.examples && r.examples.length > 0)
        ? r.examples
        : (r.example ? [r.example] : [])
      if (exs.length > 0) {
        ruleLines.push(`- 已有印证 (${exs.length} 条):`)
        exs.forEach((ex) => ruleLines.push(`  · "${ex}"`))
      }
      ruleLines.push('')
    })
    baseRulesSection = `
## 已有行为规则 (来自上一轮打磨, 作为迭代锚点)

以下规则是你上一轮已经提炼出来的. 本轮是**打磨**, 不是重写.
请按 SYSTEM_PROMPT 的"硬约束 5 · 打磨模式"处理这些规则:
- 新样本印证了旧规则 → 保留该规则, 把新印证片段合并进它的 examples
- 新样本呈现的独特模式旧规则没覆盖到 → 新增规则
- 旧规则在新样本中反复出现反例 → 才可删除 (在新样本里没出现不算反例, 保留即可)

${ruleLines.join('\n')}
`
  }

  return `## 指纹: ${fingerprintName}${baseRulesSection}

## L1 分析层 (已提取的结构化锚点)

### 量化指标
\`\`\`json
${l1MetricsJson}
\`\`\`

### 22 维画像
${profileLines.join('\n\n')}

## 原文样本
${sampleText}

## 输出任务
请输出 JSON, 格式如下:
\`\`\`
{
  "rules": [
    {
      "when": "内部判断式触发条件 (如: 当读者可能抵触这个观点时)",
      "do": "作者具体怎么做 (用引号标出标志性词汇, 如: 先铺设2-3个带百分比的数据点, 然后用\\"由此可见\\"收束)",
      "not": "作者明确不做什么 (如: 不用\\"显而易见\\"这类空洞过渡)",
      "examples": [
        "来自原文的印证片段1 (20-50字, 必须是原文真实片段)",
        "来自原文不同段落或不同样本的印证片段2",
        "可选的第3条印证"
      ]
    }
  ],
  "samples": [
    {
      "text": "300-500 字的范文片段",
      "reason": "展示了哪些行为规则 (含微观/中观/宏观)"
    }
  ]
}
\`\`\`
硬性要求:
1. 只输出 JSON, 不要代码块包裹, 不要前后解释文字
2. 每条 rule 的 examples 数组必须 ≥ 2 条, 且来自原文不同位置 — 这是"共识涌现"原则
   如果你只能找到 1 条印证, 说明这不是可复现的模式, 请删除该 rule
3. when 禁止写外部位置词 (如 "开头""段落过渡"), 必须是作者的内部判断条件
4. rules 数量由文本决定, 宁缺毋滥, 按区分度降序排列
5. rules 可以混合微观/中观/宏观三层语境的触发条件, 都放在同一数组
6. samples 选 2-3 段, 优先选能同时展示多条规则的段落`
}

// ============================================
// v3: formatFingerprintV2 (写作 prompt 注入)
// ============================================

/**
 * v3 指纹注入格式: 行为规则 + 范文 few-shot.
 *
 * 【阶段 0 认知论重构: 维特根斯坦"语言意义在于使用"】
 * 把 L0 行为规则从"外部 checklist"改造成"作者的第二人格独白",
 * 让 LLM 进入 style-absorption 模式而非 compliance-checking 模式.
 *
 * 设计意图 (解释为什么用第二人称叙事而不是规则列表):
 *   旧版 "1. **When**, Do 2. ✗ Not 例: xxx" 的列表结构, 会触发 LLM 的
 *   "逐条核对合规"模式 — 它会把风格当成必须通过的检查项, 而不是要内化的声音.
 *   新版用 "每当X, 你Y. 你不会Z. 你曾经这样写过..." 的独白式表达,
 *   让 LLM 在推理时以"我就是这个人"的视角运作, 风格才会渗透进句子.
 *
 * 三级降级策略:
 *   有 behaviorRules + samples → 人格独白 + 过往作品 + 范文
 *   仅 samples                → 纯 few-shot (作品样本)
 *   仅 22 维 profile         → 挑描述型字段转伪规则 (也改叙事口吻)
 *   什么都没有                → 不注入风格段
 *
 * 架构原则: 解耦"给人看的分析 (UI)" 和 "给模型用的提示 (prompt)".
 * profile/metrics 不再注入写作 prompt, 只保留给 UI 展示.
 */
export function formatFingerprintV2(fp: WriterFingerprint | null | undefined): string {
  if (!fp) return ''

  const hasRules = fp.behaviorRules && fp.behaviorRules.length > 0
  const hasSamples = fp.samples && fp.samples.length > 0
  const hasProfile = fp.profile && Object.keys(fp.profile).length > 0
  if (!hasRules && !hasSamples && !hasProfile) return ''

  const lines: string[] = []

  // --- 开场: 人格召唤, 而非"文风参考"声明 ---
  lines.push(`## 请你成为这位作者: ${fp.name}`)
  if (fp.description) {
    lines.push('')
    lines.push(`> ${fp.description}`)
  }
  lines.push('')
  lines.push(
    '接下来你要写的不是"符合某个风格指南的文章", 而是"这个人会写出的文章". ' +
    '下面描述的是 ta 根深蒂固的写作习惯, 请把它们当作你自己的反射, 不是条款. ' +
    '写的时候不要边写边核对清单, 写完也不要回头逐条检查 — ' +
    '如果这些习惯真的被你内化了, 它们会在句子里自然浮现; ' +
    '如果某一条在这篇里不自然, 说明它不适合这一篇.'
  )

  // --- 策略 1: 有行为规则 → 第二人称独白 ---
  if (hasRules) {
    lines.push('')
    lines.push('### 你的写作习惯')
    lines.push('')
    fp.behaviorRules!.forEach((rule) => {
      // 防御: 任何字段缺失都跳过, 避免输出 "每当undefined" 这种垃圾
      if (!rule.when || !rule.do) return
      const notPart = rule.not ? ` 你不会${rule.not}.` : ''
      lines.push(`- 每当${rule.when}, 你${rule.do}.${notPart}`)

      // 多例渲染: 优先用 examples (阶段 1 主字段), 回退到 example (旧字段兼容)
      const exs = (rule.examples && rule.examples.length > 0)
        ? rule.examples
        : (rule.example ? [rule.example] : [])
      if (exs.length === 1) {
        lines.push(`  （你曾经这样写过: "${exs[0]}"）`)
      } else if (exs.length > 1) {
        lines.push(`  （你曾经在不同地方这样写过:`)
        exs.forEach((ex) => lines.push(`    · "${ex}"`))
        lines.push(`  ）`)
      }
      lines.push('')
    })
  }
  // --- 策略 3: 仅有 22 维 profile → 伪规则 (叙事化口吻) ---
  else if (!hasSamples && hasProfile) {
    const pseudoRules = extractPseudoRulesFromProfile(fp.profile)
    if (pseudoRules.length > 0) {
      lines.push('')
      lines.push('### 你的写作习惯 (从画像推断)')
      lines.push('')
      pseudoRules.forEach((r) => {
        lines.push(`- ${r}`)
      })
    }
  }

  // --- 范文: 从"示例"重定位为"你的过往作品" ---
  if (hasSamples) {
    lines.push('')
    lines.push('### 你过去的一些段落 (这是你的声音, 不是模板)')
    lines.push('')
    lines.push(
      '读完下面的片段, 不要去复制其中的句子或论点 — ' +
      '要捕捉的是语气的温度、节奏的呼吸、转折的方式. 让它们变成你的肌肉记忆.'
    )
    fp.samples.slice(0, 3).forEach((s, i) => {
      const snippet = s.text.length > 500 ? s.text.slice(0, 500) + '⋯' : s.text
      lines.push('')
      lines.push(`**片段 ${i + 1}**${s.source ? ` (出自《${s.source}》)` : ''}:`)
      lines.push(`> ${snippet.replace(/\n/g, '\n> ')}`)
    })
  }

  // --- 反 compliance 收尾 ---
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push(
    '现在, 用这个人的声音去写. 不要在文章里解释你为什么这么写, ' +
    '不要列"我遵循了规则 1/2/3", 不要在结尾自我点评. 直接写.'
  )

  return lines.join('\n')
}

/**
 * 从旧版 22 维 profile 中挑选描述型字段, 转成伪行为规则.
 * 用于三级降级的第三级: 既无 behaviorRules 也无 samples 的旧指纹.
 *
 * 【阶段 0 口吻调整】从第三人称 ("**句式特点**: XX") 改为第二人称叙事
 * ("在句式上, 你 XX"), 与主注入的人格代入保持一致.
 *
 * 只挑 string 类型的描述字段, 跳过枚举型字段 (argumentPattern 等) —
 * 那些对 LLM 太抽象, 不如不注入.
 */
function extractPseudoRulesFromProfile(profile: WriterFingerprintProfile): string[] {
  const rules: string[] = []

  // 每个字段配一个"引导短语", 让描述自然衔接成第二人称叙事
  const descriptiveFields: Array<{ key: keyof WriterFingerprintProfile; lead: string }> = [
    { key: 'sentenceStyle', lead: '在句式上, 你' },
    { key: 'avoid', lead: '你明确避免' },
    { key: 'transitionStyle', lead: '在段落过渡上, 你' },
    { key: 'vocabulary', lead: '在用词上, 你' },
    { key: 'rhetoric', lead: '在修辞上, 你' },
    { key: 'emotionalTriggers', lead: '在情绪调动上, 你' },
    { key: 'informationDensity', lead: '在信息密度上, 你' },
  ]

  for (const { key, lead } of descriptiveFields) {
    const val = profile[key]
    if (typeof val === 'string' && val.trim().length > 5) {
      // 轻量清洗: 原始描述通常是第三人称 (如"作者偏好长句"), 去掉开头的"作者"前缀.
      // 不做更激进的改写以避免语义失真 — LLM 自己能从上下文理解.
      const cleaned = val.trim().replace(/^作者[：:]?\s*/, '').replace(/^ta\s*/i, '')
      rules.push(`${lead}${cleaned}`)
    }
    if (rules.length >= 5) break  // 最多 5 条, 避免 prompt 膨胀
  }

  return rules
}

