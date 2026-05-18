你已有的关键基础设施（writingService.ts）：

runIntake (L215, 本地推断)
runTelescope (L296, 并行采集)
draftAgenda (L331, 已经内置了 Self-Critique 循环：critiqueAgenda / reviseAgenda，最多 2 轮)
composeDraft (L600, 分节写作)
runFullWriting (L1413, 当前主管线，v3 已砍掉 Agenda Self-Critique 改成 one-pass)
runConversationalEdit (L1754)
classifyWriterIntent / runWriterChat (L2092/L2215)
decideLengthReview (L1221, 写完后的长度审查)
关键发现：你的代码注释已经说明了取舍：v3 版本为了速度砍掉了 Agenda Self-Critique，走 one-pass。所以我下面的方案不是"加一个循环"，而是把被砍掉的批判层以更重、更专门的形式加回来，但只在用户触发"打磨模式"时跑，不拖累日常 one-pass 流程。

下面按你要的三件事给交付。

🔧 一、架构图（精确版）
PlainText
┌──────────────────────────────────────────────────────────────────────────┐
│                     用户在自习室发一条消息                                 │
│                                                                          │
│  ┌─────────────────┐  classifyWriterIntent(已存在)                        │
│  │ intentDispatcher│ ───────► write / edit / discuss / deliberate(新)    │
│  └────────┬────────┘                                                     │
│           ▼                                                              │
│     ╔══════════════════════════════════════════════════════════════╗    │
│     ║  DELIBERATE 模式 (新增, 显式触发, 不自动跑)                    ║    │
│     ║                                                                ║    │
│     ║   input: { draft, userBrief, styleFingerprint, priorReport? } ║    │
│     ╚══════════════════════════════════════════════════════════════╝    │
│           │                                                              │
│           ▼                                                              │
│  ┌────────────────────────────────────────────┐                          │
│  │ Phase 1 · runDiagnosis  (LLM×2, 非阻塞用户) │                          │
│  │   ├─ 1a: 自由思考 [自由Prompt]              │   输出: 思考草稿(text)   │
│  │   └─ 1b: 结构化固化 [Structured Output]     │   输出: DiagnosisReport │
│  │                                            │   存储: ↓                │
│  └────────────────────────────────────────────┘                          │
│           │                     持久化 → memory/exec_traces/             │
│           │                              deliberation/{sessionId}/       │
│           │                              diagnosis-{ts}.json             │
│           ▼                                                              │
│  ┌────────────────────────────────────────────┐                          │
│  │ Phase 2 · runRedTeam     (LLM×3 并行)       │                          │
│  │   ├─ Persona A: 领域专家                    │                          │
│  │   ├─ Persona B: 敌意质疑者                  │  三份自由攻击 → 汇总     │
│  │   └─ Persona C: 目标听众                    │  输出: RedTeamReport    │
│  │   最后 1 次: 去重+排序 [Structured Output]  │                          │
│  │                                            │   存储: ↓                │
│  └────────────────────────────────────────────┘                          │
│           │                     持久化 → redteam-{ts}.json               │
│           ▼                                                              │
│  ┌────────────────────────────────────────────┐                          │
│  │ Phase 3 · proposeInsightCandidates          │                          │
│  │   (LLM×1, 输出 2-3 个候选洞察)               │                          │
│  │                                            │                          │
│  │   ★ 修正点1: 不阻塞等用户, 而是主动给候选   │                          │
│  │   输出: InsightCandidate[]                  │                          │
│  └────────────────────────────────────────────┘                          │
│           │                                                              │
│           ▼  ──────► UI 展示给用户, 用户勾选 0~N 个 + 可自由补充         │
│           │          (这一步是人机交互, 不是 LLM 调用)                   │
│           ▼                                                              │
│  ┌────────────────────────────────────────────┐                          │
│  │ Phase 4 · decideRewriteStrategy  (LLM×1)    │                          │
│  │   输入: diagnosis + redteam + 用户选中洞察  │                          │
│  │   判断: 核心论点是否变化?                   │                          │
│  │   输出: { mode: 'incremental'|'rebuild',    │                          │
│  │           rationale, thesisDelta }          │                          │
│  │   ★ 修正点2: 换底座 vs 增量的触发规则       │                          │
│  └────────────────────────────────────────────┘                          │
│           │                                                              │
│           ├── mode=incremental ──► 走现有 runConversationalEdit          │
│           │                        (在原稿上精准修改, 保留语感)           │
│           │                                                              │
│           └── mode=rebuild      ──► Phase 5                              │
│                                                                          │
│  ┌────────────────────────────────────────────┐                          │
│  │ Phase 5 · runRebuild (流式)                 │                          │
│  │   输入: 新 thesis + 新 logic_chain(来自诊断)│                          │
│  │         + RedTeam 已识别漏洞清单(作为约束)  │                          │
│  │         + 文风指纹 + 用户选中洞察           │                          │
│  │   复用: buildOnePassWritingPrompt 管道      │                          │
│  │   但替换: 系统约束注入 DeliberationContext   │                          │
│  │   输出: 新 draft (流式)                     │                          │
│  └────────────────────────────────────────────┘                          │
│           │                                                              │
│           ▼                                                              │
│  ┌────────────────────────────────────────────┐                          │
│  │ 持久化汇总 → deliberation-{ts}.json         │                          │
│  │   { diagnosis, redteam, insights,           │                          │
│  │     strategy, newDraftId }                  │                          │
│  │                                            │                          │
│  │   ★ 修正点3: 下次进入同 session, 预加载     │                          │
│  │     最新 DeliberationRecord 给 Phase 1      │                          │
│  │     作为 priorReport (增量诊断)             │                          │
│  └────────────────────────────────────────────┘                          │
└──────────────────────────────────────────────────────────────────────────┘
每阶段 LLM 调用一览（硬数字）
阶段	调用次数	Prompt 模式	输出模式	可并行
Phase 1 诊断	2（自由 + 固化）	Free-form → Structured	JSON	❌ 串行
Phase 2 红队	3 并行 + 1 汇总	Free-form × 3 → Structured	JSON	✅ 前 3 个并行
Phase 3 洞察候选	1	Constrained	Structured JSON	—
Phase 4 策略决策	1	Constrained	小 JSON	—
Phase 5 重写	1（流式）	Free-form	Markdown 流	—
总计	8 次 LLM 调用（中间有 3 个并行，实际 wall-clock ≈ 6 次的时间）			
对比你现在的 runFullWriting：one-pass 是 1~2 次调用。所以这条新管线成本 ≈ 4-5 倍，这也是它必须是显式触发而不是默认跑的原因。

📋 二、五个 Prompt 模板原文
说明：我给的是中文原文，直接贴进 prompts.ts 就能跑。变量用 {{xxx}} 占位，你按你现有的 buildXxxPrompt 风格替换就行。每段 prompt 前都标注了放在 system 还是 user、期望输出格式。

Prompt 1 — 诊断（Phase 1a 自由思考）
位置: system。输出: 自由文本（不要求 JSON）。

PlainText
你是一位严格的论证审查者。你的任务不是改写，也不是润色，而是"审"。

审查原则：
1. 把论点和论据分开看：哪些是断言，哪些是支撑断言的证据？
2. 每一步推理追问一次"所以呢、凭什么、真的吗"，把看似顺畅但实际跳跃的地方标出来。
3. 区分"已经发生 / 正在发生 / 很可能发生"，凡是用了"已经""第一次""彻底"的地方，重点盯。
4. 找出最容易被一句话反驳的判断——不是小瑕疵，是"如果被挑战，答不上来会当场塌掉"的那种。
5. 允许承认"这一段其实还不错"，不要为批判而批判。

审查对象（可能是提纲、草稿或观点）：
---
{{draft}}
---

用户想解决的问题：{{user_brief}}

用自然语言写下你的审查过程。不要列表化，不要 JSON，先把你真实的判断讲出来。
允许 800-1500 字，允许不给结论，允许提出你自己都不确定的疑问。
关键设计：

明确说"不要 JSON"——让模型先自由推理（避开 "Let Me Speak Freely" 那个坑）
明确说"允许不给结论"——避免模型为了凑齐字段瞎编
给的是"审查原则"不是"输出 schema"——引导思考，不约束表达
Prompt 2 — 诊断（Phase 1b 结构化固化）
位置: user（system 沿用上一步）。输入: Phase 1a 的自由文本。输出: JSON（建议用 OpenAI Structured Outputs 或 JSON mode）。

PlainText
把你刚才的审查结论整理成结构化 JSON，便于后续管线使用。
不要重新思考、不要补充新观点，只做整理。

输出 schema：
{
  "thesis": "你识别出的核心论点，一句话",
  "thesis_clarity": "clear | vague | missing",
  "logic_chain": [
    { "step": "推理链中的一步", "support": "solid | weak | missing", "note": "为什么这样评" }
  ],
  "gaps": [
    { "location": "出现在哪一段/哪个判断", "type": "跳跃 | 循环 | 偷换 | 过度绝对", "why": "一句话说清" }
  ],
  "evidence_coverage": {
    "well_supported": ["..."],
    "under_supported": ["..."]
  },
  "vulnerabilities": [
    { "claim": "最脆弱的判断", "attack": "最可能被怎样反驳", "severity": "high | medium | low" }
  ],
  "confidence": "你对以上判断本身的把握 0.0-1.0"
}

只输出 JSON，不要任何解释文字。
Prompt 3 — 红队（Phase 2，3 个并行 persona，仅给出 Persona B 作为示例；A/C 结构同构）
位置: system。输出: 自由文本。并行跑 3 次，persona 不同。

PlainText
你现在扮演一个角色：{{persona_name}}
背景：{{persona_background}}
动机：你不是来配合的。你看到这篇文章 / 这份提纲时，你的第一反应是"哪里不对、哪里不严、哪里是在偷懒"。
但你也不是杠精——你只攻击那些如果不被回应、会真的让这篇东西失败的点。

三个 persona 的具体设定：
─ Persona A（领域专家）: 你熟悉这个话题的文献和历史，你知道哪些是陈词滥调、哪些是真正的新判断。
  最敏感的问题：论点是不是在重复已经被讨论烂了的东西？是不是回避了这个领域最棘手的争论？
─ Persona B（敌意质疑者）: 你不认同作者的立场，你预设作者"又在包装企业利益 / 自我感动 / 贩卖焦虑"。
  最敏感的问题：作者是不是在用漂亮话绕过真正的冲突？哪里的"我们"在掩盖"谁"？
─ Persona C（目标听众）: 你是这篇内容真正要说服的人。你忙、你怀疑、你没耐心。
  最敏感的问题：这和我有什么关系？凭什么我要相信？讲到一半我会在哪里走神？

审查对象：
---
{{draft}}
---

用你这个 persona 的口吻，提 3-5 个最致命的问题。每个问题包含：
1. 问题本身（一句话，尖锐）
2. 你为什么觉得这个问题致命（2-3 句）
3. 作者有没有可能已经暗含回答了这个问题？如果有，为什么还不够？

不要礼貌。不要用"这篇文章整体不错，但是..."这种开场。直接开打。
Persona B 独立实例，汇总时再统一去重（第 4 次调用，结构化输出）：

PlainText
下面是 3 位不同 persona 对同一份内容的质疑。请做三件事：
1. 去重：语义相同的质疑合并，保留最尖锐的那版表述
2. 排序：按"如果不回应会否让论点崩塌"排序，最致命的在前
3. 标注：每个质疑来自哪些 persona（可能多个）

输入：
---
Persona A 反馈：{{feedback_a}}
Persona B 反馈：{{feedback_b}}
Persona C 反馈：{{feedback_c}}
---

输出 JSON：
{
  "challenges": [
    { "id": "c1", "question": "...", "why_lethal": "...", "from_personas": ["A","B"], "severity": "high|medium|low" }
  ],
  "convergent_points": ["多位 persona 都指向的那几个关键问题"]
}
只输出 JSON。
Prompt 4 — 用户洞察分拣（Phase 3）
位置: system。输出: Structured。

PlainText
你已经拿到两份材料：
1. 诊断报告 DiagnosisReport：指出了这篇内容的逻辑断点和脆弱判断
2. 红队报告 RedTeamReport：枚举了最致命的外部质疑

你的任务不是替用户思考，而是生成 2-3 个"候选新视角"，每个都满足：
- 不是对原稿的修辞优化，而是能改变主论点或论证路径的那种判断
- 不是面面俱到的好词，而是一个具体的、可能让用户有"对，就是这个！"反应的洞察
- 必须说清楚：如果用户采纳这个洞察，原稿的哪些部分会被推翻、哪些需要重写

用户永远有权补充自己的洞察。你给的是"候选菜单"，不是"标准答案"。

输入：
DiagnosisReport: {{diagnosis_json}}
RedTeamReport: {{redteam_json}}
原稿要点: {{draft_summary}}

输出 JSON：
{
  "candidates": [
    {
      "id": "i1",
      "insight": "一句话讲清楚这个新视角是什么",
      "why_it_matters": "为什么这能解决诊断/红队里的某个关键问题（引用 gap_id 或 challenge_id）",
      "what_changes": { "keep": ["..."], "rewrite": ["..."], "drop": ["..."] },
      "risk": "采纳这个洞察的代价是什么（比如会偏离原意、会损失某个群体的共鸣）"
    }
  ],
  "also_worth_asking_user": "还有什么是 AI 判断不了、必须由用户自己回答的问题？（1-2 个）"
}
只输出 JSON。
关键设计（对应我上轮修正点 1）：最后的 also_worth_asking_user 把"意图锚定"显式化——AI 承认自己不能替用户回答的问题。

Prompt 5a — 重写策略决策（Phase 4）
位置: system。输出: 小 JSON。轻量调用，可以用较小模型。

PlainText
你是一个重写策略的裁判。判断下面这种情况应该怎么改：

原稿核心论点：{{original_thesis}}
用户采纳的新洞察：{{selected_insights}}
用户跳过的洞察：{{skipped_insights}}
用户自己补的话（可能为空）：{{user_custom_note}}

判断规则：
1. 如果新洞察只是补充论据、润色表达、调整顺序 → mode: "incremental"
2. 如果新洞察改变了核心论点、主因果链、或主隐喻 → mode: "rebuild"
3. 判断依据是：在原稿上修改能不能保留超过 60% 的内容结构

输出：
{
  "mode": "incremental" | "rebuild",
  "rationale": "为什么选这个模式（一句话）",
  "new_thesis": "如果是 rebuild，新的核心论点是什么（一句话）；如果是 incremental，留空",
  "preserved_chunks": ["增量模式下，哪些段落/判断应该原样保留（按 heading 或 id）"]
}
Prompt 5b — 重写（Phase 5）
位置: system。输出: 流式 Markdown。

PlainText
你正在进行一次重写。这不是润色，是"在新的论证骨架上重新写一遍"。

新核心论点：{{new_thesis}}
新的逻辑链（必须遵循，不得偷偷跳步）：
{{#each new_logic_chain}}
  {{@index+1}}. {{this.step}}  (支撑：{{this.support}})
{{/each}}

必须主动回应的质疑（这些是红队识别出来的致命点，任何一个没被回应就视为这次重写失败）：
{{#each must_address_challenges}}
  - {{this.question}}
{{/each}}

必须保留的原稿素材（用户明确不想丢的部分）：
{{preserved_chunks}}

风格要求：
{{style_fingerprint}}

写作原则：
1. 不要堆金句，每个判断都要能回答"凭什么"
2. 使用边界化语言：用"正在"而不是"已经"，用"更准确地说"做修正，允许说"至少目前"
3. 主动承认不确定——这比"假装无所不知"更可信
4. 每一大段开头用一句话说清这段要证明什么，结尾用一句话说清这段证明了什么
5. 如果某个论点你写着写着发现支撑不够，不要硬撑——在行文里明确指出"这一点需要更多经验证据"

输出格式：标准 Markdown，带 outline 块（用于侧栏结构导航）。
开始写：
🧠 三、writingService.ts 新增函数签名（不写实现）
放在你现有的 writingService.ts 里；如果最终超过 700 行建议（你现在已经 86KB 了），可以拆出一个 deliberationService.ts 专门放这套。

TypeScript
// ============================================================
//  Deliberation Pipeline (新增)
//  显式触发的"诊断 → 红队 → 洞察 → 策略 → 重写"管线
//  设计原则：
//    - 不自动跑，用户在 UI 点"深度打磨"时触发
//    - 每阶段结果独立持久化到 memory/exec_traces/deliberation/
//    - 可中断 (abortManager) ，可续跑 (读 priorReport)
// ============================================================

// ---------- 类型定义（建议挂在 src/types.ts 或 fingerprintSchema.ts 旁边）----------

export interface DiagnosisReport {
  thesis: string
  thesisClarity: 'clear' | 'vague' | 'missing'
  logicChain: Array<{ step: string; support: 'solid' | 'weak' | 'missing'; note: string }>
  gaps: Array<{ location: string; type: '跳跃' | '循环' | '偷换' | '过度绝对'; why: string }>
  evidenceCoverage: { wellSupported: string[]; underSupported: string[] }
  vulnerabilities: Array<{ claim: string; attack: string; severity: 'high' | 'medium' | 'low' }>
  confidence: number
  rawThinking: string   // Phase 1a 的自由文本, 用于追溯和 debug
  timestamp: number
}

export interface RedTeamReport {
  challenges: Array<{
    id: string
    question: string
    whyLethal: string
    fromPersonas: Array<'expert' | 'adversary' | 'audience'>
    severity: 'high' | 'medium' | 'low'
  }>
  convergentPoints: string[]
  rawFeedback: { expert: string; adversary: string; audience: string }  // 三份 persona 原文
  timestamp: number
}

export interface InsightCandidate {
  id: string
  insight: string
  whyItMatters: string
  whatChanges: { keep: string[]; rewrite: string[]; drop: string[] }
  risk: string
}

export interface InsightProposal {
  candidates: InsightCandidate[]
  alsoWorthAskingUser: string  // 明确承认 AI 判断不了的问题
}

export interface RewriteStrategy {
  mode: 'incremental' | 'rebuild'
  rationale: string
  newThesis?: string
  preservedChunks: string[]
}

export interface DeliberationRecord {
  sessionId: string
  diagnosisPath: string     // 持久化文件相对路径
  redTeamPath: string
  insightsPath: string
  strategyPath: string
  selectedInsightIds: string[]
  userCustomNote?: string
  newDraftId?: string       // rebuild 模式下产出的新稿 id
  createdAt: number
}

// ---------- 核心函数签名 ----------

/**
 * Phase 1: 诊断。内部跑 2 次 LLM (自由思考 + 结构化固化).
 * 非阻塞, 结果持久化到 deliberation/{sessionId}/diagnosis-{ts}.json.
 *
 * @param priorReport 上次诊断报告; 存在时作为增量参考, 让模型关注"这次和上次比有何变化"
 */
export async function runDiagnosis(
  draft: string,
  brief: WritingBrief,
  sessionId: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
  priorReport?: DiagnosisReport,
): Promise<DiagnosisReport>

/**
 * Phase 2: 红队. 3 个 persona 并行攻击 + 1 次汇总.
 * wall-clock 大约 = 1.2 × 单次 LLM 时间 (因为并行).
 */
export async function runRedTeam(
  draft: string,
  diagnosis: DiagnosisReport,
  sessionId: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<RedTeamReport>

/**
 * Phase 3: 基于诊断 + 红队, 生成 2-3 个候选洞察给用户选.
 * 注意: 这个函数返回后, 应由 UI 展示候选让用户勾选, 而不是管线内部自动推进.
 */
export async function proposeInsightCandidates(
  draft: string,
  diagnosis: DiagnosisReport,
  redTeam: RedTeamReport,
  sessionId: string,
  signal?: AbortSignal,
): Promise<InsightProposal>

/**
 * Phase 4: 决策: 增量修改还是换底座重写.
 * 轻量调用 (可用较小模型), 关键是给下游一个明确的路由.
 */
export async function decideRewriteStrategy(
  originalThesis: string,
  selectedInsights: InsightCandidate[],
  skippedInsights: InsightCandidate[],
  userCustomNote: string | undefined,
  signal?: AbortSignal,
): Promise<RewriteStrategy>

/**
 * Phase 5: 重写 (流式).
 * - mode='incremental' 时, 调用方应转向现有 runConversationalEdit 而不是这个函数
 * - mode='rebuild' 时, 本函数负责在新骨架上生成全文
 *
 * 复用 buildOnePassWritingPrompt 的流式基础设施, 但替换 system 约束为 DeliberationContext.
 */
export async function runRebuild(
  ctx: {
    brief: WritingBrief
    newThesis: string
    newLogicChain: DiagnosisReport['logicChain']
    mustAddressChallenges: RedTeamReport['challenges']
    preservedChunks: string[]
    styleFingerprint: WriterFingerprint | null
  },
  callbacks: {
    onChunk: (text: string) => void
    onAgenda: (agenda: AgendaDoc) => void
    onProgress: (stage: string, msg: string) => void
  },
  signal?: AbortSignal,
): Promise<{ draft: string; agenda: AgendaDoc }>

/**
 * 编排器: 串起 Phase 1→2→3. 暂停在用户选择点.
 * 返回到 UI 一个 "pending user decision" 的状态, UI 拿着 InsightProposal 展示候选.
 */
export async function runDeliberationUntilUserChoice(
  draft: string,
  brief: WritingBrief,
  sessionId: string,
  callbacks: {
    onDiagnosisReady: (d: DiagnosisReport) => void
    onRedTeamReady: (r: RedTeamReport) => void
    onInsightsReady: (p: InsightProposal) => void
    onProgress: (stage: 'diagnosis' | 'redteam' | 'insights', msg: string) => void
  },
  signal?: AbortSignal,
): Promise<{
  diagnosis: DiagnosisReport
  redTeam: RedTeamReport
  proposal: InsightProposal
}>

/**
 * 编排器: 拿到用户选择后, 串起 Phase 4→5.
 * 按 strategy.mode 分叉到 incrementalEdit 或 rebuild.
 */
export async function runDeliberationAfterUserChoice(
  params: {
    brief: WritingBrief
    originalDraft: string
    diagnosis: DiagnosisReport
    redTeam: RedTeamReport
    proposal: InsightProposal
    selectedInsightIds: string[]
    userCustomNote?: string
    styleFingerprint: WriterFingerprint | null
    sessionId: string
  },
  callbacks: {
    onStrategy: (s: RewriteStrategy) => void
    onChunk: (text: string) => void
    onAgenda: (agenda: AgendaDoc) => void
    onProgress: (stage: string, msg: string) => void
  },
  signal?: AbortSignal,
): Promise<{ strategy: RewriteStrategy; newDraft: string; record: DeliberationRecord }>

// ---------- 辅助函数 (建议独立文件 deliberationStorage.ts) ----------

/** 写入诊断/红队/洞察/策略 JSON 到 memory/exec_traces/deliberation/{sessionId}/ */
export async function persistDeliberationArtifact<T>(
  sessionId: string,
  kind: 'diagnosis' | 'redteam' | 'insights' | 'strategy',
  payload: T,
): Promise<string>  // 返回持久化路径

/** 读取该 session 最近一次的诊断报告, 用于 priorReport 增量. */
export async function loadLatestDiagnosis(
  sessionId: string,
): Promise<DiagnosisReport | null>

/** 汇总一次完整 deliberation 到单个 Record, 写入 duncrew.db (用于后续检索/复盘). */
export async function commitDeliberationRecord(
  record: DeliberationRecord,
): Promise<void>
intentDispatcher.ts 需要的改动
TypeScript
// 意图类型扩展
// 现有: 'write' | 'edit' | 'discuss' | ...
// 新增:
type WriterIntent = /* 原有类型 */ | 'deliberate'

// classifyWriterIntent 里增加触发词识别:
//   "深度打磨" "帮我抠一下逻辑" "压力测试" "挑战一下这篇"
//   "这篇经得起问吗" "找找漏洞" ... → 'deliberate'
// 或者更稳: UI 上加一个"深度打磨"按钮, 按钮直接 dispatch intent='deliberate', 不走意图分类
配置扩展（writingService.ts 里的 REFINEMENT_CONFIG）
TypeScript
export const DELIBERATION_CONFIG = {
  // Phase 1
  DIAGNOSIS_FREE_THINKING_MAX_TOKENS: 2000,   // 自由思考给足 token
  DIAGNOSIS_STRUCTURED_MAX_TOKENS: 1500,
  
  // Phase 2
  REDTEAM_PERSONAS: ['expert', 'adversary', 'audience'] as const,
  REDTEAM_PER_PERSONA_MAX_TOKENS: 1200,
  REDTEAM_CONVERGE_MAX_TOKENS: 800,
  
  // Phase 3
  INSIGHT_CANDIDATES_COUNT: 3,  // 给用户 2-3 个候选, 不超过 3 避免选择疲劳
  
  // Phase 4
  STRATEGY_MODEL: 'smaller' as 'smaller' | 'default',  // 策略决策可用小模型省钱
  
  // Phase 5 (rebuild) 复用 one-pass 的配置, 不重复定义
  
  // 持久化
  MAX_DELIBERATION_HISTORY_PER_SESSION: 10,  // 每个 session 最多保留 10 次历史
}
四、最后一个关键提醒
你现有代码里有一个必须处理的冲突点：

draftAgenda (L331) 已经内置了 critiqueAgenda / reviseAgenda 的 Self-Critique 循环，而你 runFullWriting v3 (L1413-L1498) 已经砍掉了它改走 one-pass。

我的建议：

保持 one-pass 为默认（速度优先，符合你 v3 的取舍）
新的 Deliberation 管线完全独立，不要把它塞进 runFullWriting 的循环里
入口清晰：普通"写"走 runFullWriting（one-pass）；用户显式点"深度打磨"才走 runDeliberationUntilUserChoice + runDeliberationAfterUserChoice
这样既不拖慢日常流程，又让"思辨浓度"成为一个显式可付费/可消费的高级能力——这点和你 DunCrew 作为"AI 操作系统"的定位也是匹配的：普通能力人人可用，深度能力按需触发。

需要我下一步做哪个：

📐 把 Prompt 1-5 的中文原文进一步细化（比如给完整的 few-shot 示例）
🗂️ 画一张 DeliberationRecord 的 SQLite schema（对应 duncrew.db 里应该怎么存）
🧪 设计一组测试用例：拿你之前那段"AI 教育提纲"对话作为 golden case，验证管线输出是否接近那种思辨浓度