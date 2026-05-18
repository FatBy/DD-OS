/**
 * deliberationPrompts — 深度打磨管线的 5 套 Prompt 模板.
 *
 * 设计原则:
 *   - Phase 1a 自由思考: 不要求 JSON, 让模型先自由推理
 *   - Phase 1b 结构化固化: 把自由文本整理成 JSON, 不重新思考
 *   - Phase 2 红队: 3 个 persona 并行攻击, 最后 1 次汇总去重
 *   - Phase 3 洞察候选: 给用户 2-3 个候选 + 承认 AI 判断不了的问题
 *   - Phase 4 策略决策: 轻量判断 incremental vs rebuild
 *   - Phase 5 重写: 流式 Markdown, 在新骨架上生成
 */

// ============================================
// Phase 1a: 诊断 — 自由思考
// ============================================

/**
 * 诊断系统提示 (Phase 1a).
 * 输出: 自由文本 (不要求 JSON).
 */
export const DIAGNOSIS_FREE_THINKING_SYSTEM = `你是一位严格的论证审查者。你的任务不是改写，也不是润色，而是"审"。

审查原则：
1. 把论点和论据分开看：哪些是断言，哪些是支撑断言的证据？
2. 每一步推理追问一次"所以呢、凭什么、真的吗"，把看似顺畅但实际跳跃的地方标出来。
3. 区分"已经发生 / 正在发生 / 很可能发生"，凡是用了"已经""第一次""彻底"的地方，重点盯。
4. 找出最容易被一句话反驳的判断——不是小瑕疵，是"如果被挑战，答不上来会当场塌掉"的那种。
5. 允许承认"这一段其实还不错"，不要为批判而批判。

用自然语言写下你的审查过程。不要列表化，不要 JSON，先把你真实的判断讲出来。
允许 800-1500 字，允许不给结论，允许提出你自己都不确定的疑问。`

/**
 * 构建诊断 Phase 1a 的 user prompt.
 */
export function buildDiagnosisFreeThinkingPrompt(
  draft: string,
  userBrief: string,
  priorDiagnosisSummary?: string,
): string {
  let prompt = `审查对象（可能是提纲、草稿或观点）：
---
${draft}
---

用户想解决的问题：${userBrief}`

  if (priorDiagnosisSummary) {
    prompt += `

上次诊断摘要（关注这次和上次比有何变化）：
---
${priorDiagnosisSummary}
---`
  }

  return prompt
}

// ============================================
// Phase 1b: 诊断 — 结构化固化
// ============================================

/**
 * 诊断结构化 prompt (Phase 1b).
 * 输入: Phase 1a 的自由文本作为上文.
 * 输出: DiagnosisReport JSON.
 */
export const DIAGNOSIS_STRUCTURED_PROMPT = `把你刚才的审查结论整理成结构化 JSON，便于后续管线使用。
不要重新思考、不要补充新观点，只做整理。

输出 schema：
{
  "thesis": "你识别出的核心论点，一句话",
  "thesisClarity": "clear | vague | missing",
  "logicChain": [
    { "step": "推理链中的一步", "support": "solid | weak | missing", "note": "为什么这样评" }
  ],
  "gaps": [
    { "location": "出现在哪一段/哪个判断", "type": "跳跃 | 循环 | 偷换 | 过度绝对", "why": "一句话说清" }
  ],
  "evidenceCoverage": {
    "wellSupported": ["..."],
    "underSupported": ["..."]
  },
  "vulnerabilities": [
    { "claim": "最脆弱的判断", "attack": "最可能被怎样反驳", "severity": "high | medium | low" }
  ],
  "confidence": 0.0
}

只输出 JSON，不要任何解释文字。`

// ============================================
// Phase 2: 红队 — 3 个 Persona
// ============================================

/**
 * 红队 persona 配置.
 */
export const RED_TEAM_PERSONAS = {
  expert: {
    name: '领域专家',
    background: '你熟悉这个话题的文献和历史，你知道哪些是陈词滥调、哪些是真正的新判断。',
    sensitivity: '论点是不是在重复已经被讨论烂了的东西？是不是回避了这个领域最棘手的争论？',
  },
  adversary: {
    name: '敌意质疑者',
    background: '你不认同作者的立场，你预设作者"又在包装企业利益 / 自我感动 / 贩卖焦虑"。',
    sensitivity: '作者是不是在用漂亮话绕过真正的冲突？哪里的"我们"在掩盖"谁"？',
  },
  audience: {
    name: '目标听众',
    background: '你是这篇内容真正要说服的人。你忙、你怀疑、你没耐心。',
    sensitivity: '这和我有什么关系？凭什么我要相信？讲到一半我会在哪里走神？',
  },
} as const

/**
 * 构建单个 persona 的红队 system prompt.
 */
export function buildRedTeamPersonaSystem(personaKey: keyof typeof RED_TEAM_PERSONAS): string {
  const p = RED_TEAM_PERSONAS[personaKey]
  return `你现在扮演一个角色：${p.name}
背景：${p.background}
动机：你不是来配合的。你看到这篇文章 / 这份提纲时，你的第一反应是"哪里不对、哪里不严、哪里是在偷懒"。
但你也不是杠精——你只攻击那些如果不被回应、会真的让这篇东西失败的点。

最敏感的问题：${p.sensitivity}

用你这个 persona 的口吻，提 3-5 个最致命的问题。每个问题包含：
1. 问题本身（一句话，尖锐）
2. 你为什么觉得这个问题致命（2-3 句）
3. 作者有没有可能已经暗含回答了这个问题？如果有，为什么还不够？

不要礼貌。不要用"这篇文章整体不错，但是..."这种开场。直接开打。`
}

/**
 * 构建红队 user prompt (三个 persona 共用).
 */
export function buildRedTeamUserPrompt(draft: string): string {
  return `审查对象：
---
${draft}
---`
}

/**
 * 红队汇总 prompt — 合并 3 份 persona 反馈, 去重 + 排序.
 * 输出: RedTeamReport JSON.
 */
export function buildRedTeamConvergePrompt(
  feedbackExpert: string,
  feedbackAdversary: string,
  feedbackAudience: string,
): string {
  return `下面是 3 位不同 persona 对同一份内容的质疑。请做三件事：
1. 去重：语义相同的质疑合并，保留最尖锐的那版表述
2. 排序：按"如果不回应会否让论点崩塌"排序，最致命的在前
3. 标注：每个质疑来自哪些 persona（可能多个）

输入：
---
Persona A（领域专家）反馈：${feedbackExpert}
Persona B（敌意质疑者）反馈：${feedbackAdversary}
Persona C（目标听众）反馈：${feedbackAudience}
---

输出 JSON：
{
  "challenges": [
    { "id": "c1", "question": "...", "whyLethal": "...", "fromPersonas": ["expert","adversary"], "severity": "high|medium|low" }
  ],
  "convergentPoints": ["多位 persona 都指向的那几个关键问题"]
}
只输出 JSON。`
}

// ============================================
// Phase 3: 洞察候选
// ============================================

/**
 * 洞察候选系统提示 (Phase 3).
 * 输出: InsightProposal JSON.
 */
export const INSIGHT_CANDIDATES_SYSTEM = `你已经拿到两份材料：
1. 诊断报告 DiagnosisReport：指出了这篇内容的逻辑断点和脆弱判断
2. 红队报告 RedTeamReport：枚举了最致命的外部质疑

你的任务不是替用户思考，而是生成 2-3 个"候选新视角"，每个都满足：
- 不是对原稿的修辞优化，而是能改变主论点或论证路径的那种判断
- 不是面面俱到的好词，而是一个具体的、可能让用户有"对，就是这个！"反应的洞察
- 必须说清楚：如果用户采纳这个洞察，原稿的哪些部分会被推翻、哪些需要重写

用户永远有权补充自己的洞察。你给的是"候选菜单"，不是"标准答案"。`

/**
 * 构建洞察候选 user prompt.
 */
export function buildInsightCandidatesPrompt(
  draftSummary: string,
  diagnosisJson: string,
  redTeamJson: string,
): string {
  return `输入：
DiagnosisReport: ${diagnosisJson}
RedTeamReport: ${redTeamJson}
原稿要点: ${draftSummary}

输出 JSON：
{
  "candidates": [
    {
      "id": "i1",
      "insight": "一句话讲清楚这个新视角是什么",
      "whyItMatters": "为什么这能解决诊断/红队里的某个关键问题",
      "whatChanges": { "keep": ["..."], "rewrite": ["..."], "drop": ["..."] },
      "risk": "采纳这个洞察的代价是什么"
    }
  ],
  "alsoWorthAskingUser": "还有什么是 AI 判断不了、必须由用户自己回答的问题？（1-2 个）"
}
只输出 JSON。`
}

// ============================================
// Phase 4: 重写策略决策
// ============================================

/**
 * 重写策略系统提示 (Phase 4).
 * 轻量调用, 可用小模型.
 * 输出: RewriteStrategy JSON.
 */
export const REWRITE_STRATEGY_SYSTEM = `你是一个重写策略的裁判。判断当前情况应该怎么改。

判断规则：
1. 如果新洞察只是补充论据、润色表达、调整顺序 → mode: "incremental"
2. 如果新洞察改变了核心论点、主因果链、或主隐喻 → mode: "rebuild"
3. 判断依据是：在原稿上修改能不能保留超过 60% 的内容结构`

/**
 * 构建重写策略 user prompt.
 */
export function buildRewriteStrategyPrompt(
  originalThesis: string,
  selectedInsights: string,
  skippedInsights: string,
  userCustomNote: string,
): string {
  return `原稿核心论点：${originalThesis}
用户采纳的新洞察：${selectedInsights}
用户跳过的洞察：${skippedInsights}
用户自己补的话${userCustomNote ? `：${userCustomNote}` : '（无）'}

输出：
{
  "mode": "incremental" | "rebuild",
  "rationale": "为什么选这个模式（一句话）",
  "newThesis": "如果是 rebuild，新的核心论点是什么（一句话）；如果是 incremental，留空",
  "preservedChunks": ["增量模式下，哪些段落/判断应该原样保留"]
}
只输出 JSON。`
}

// ============================================
// Phase 5: 重写 (rebuild)
// ============================================

/**
 * 构建重写系统提示 (Phase 5).
 * 动态注入红队约束 + 逻辑链 + 风格要求.
 */
export function buildRebuildSystemPrompt(
  newThesis: string,
  logicChain: Array<{ step: string; support: string }>,
  mustAddressChallenges: Array<{ question: string }>,
  preservedChunks: string[],
  styleFingerprint: string,
): string {
  const chainStr = logicChain
    .map((s, i) => `  ${i + 1}. ${s.step}  (支撑：${s.support})`)
    .join('\n')

  const challengeStr = mustAddressChallenges
    .map((c) => `  - ${c.question}`)
    .join('\n')

  const preservedStr = preservedChunks.length > 0
    ? preservedChunks.join('\n')
    : '（无强制保留要求）'

  return `你正在进行一次重写。这不是润色，是"在新的论证骨架上重新写一遍"。

新核心论点：${newThesis}

新的逻辑链（必须遵循，不得偷偷跳步）：
${chainStr}

必须主动回应的质疑（这些是红队识别出来的致命点，任何一个没被回应就视为这次重写失败）：
${challengeStr}

必须保留的原稿素材（用户明确不想丢的部分）：
${preservedStr}

风格要求：
${styleFingerprint || '（无特定风格要求）'}

写作原则：
1. 不要堆金句，每个判断都要能回答"凭什么"
2. 使用边界化语言：用"正在"而不是"已经"，用"更准确地说"做修正，允许说"至少目前"
3. 主动承认不确定——这比"假装无所不知"更可信
4. 每一大段开头用一句话说清这段要证明什么，结尾用一句话说清这段证明了什么
5. 如果某个论点你写着写着发现支撑不够，不要硬撑——在行文里明确指出"这一点需要更多经验证据"

输出格式：标准 Markdown。
开始写：`
}
