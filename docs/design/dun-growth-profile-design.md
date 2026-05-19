# Dun 能力摘要与成长档案设计说明

本文档整理当前 Dun 相关代码的能力边界，并给出「能力摘要」与「成长档案」的设计方案。

核心目标不是给 Dun 加一层装饰性的等级展示，而是让用户能回答三个问题：

1. 这个 Dun 现在被委托了什么？
2. 它靠什么能力栈干活？
3. 它为什么值得信任，并且如何变得更强？

## 第一性原理

Dun 要干活、干好活，需要形成一条完整链路：

```text
目标 -> 工作栈 -> 执行 -> 证据 -> 反馈 -> 能力 -> 成长 -> 契约更新 / 展示变化
```

对应到产品信息架构：

```text
当前目标
模型 / skills / SOP
执行状态
产出与记录
能力摘要
成长档案
```

这 6 项适合作为右侧 Dun 小窗的主信息架构，但它们本身还不够支撑完整成长系统。底层还需要 episode、obligation validation、用户反馈、SOP patch、代表作/教训本等证据层数据。

## 当前代码满足情况

| 模块 | 当前满足度 | 现状判断 |
| --- | --- | --- |
| 当前目标 | 半满足 | 有 `TaskItem`、`TaskPlan`、`SopEpisode.goal`，但 `SopEpisode` 还没有贯穿事前 / 事中 / 事后成为权威目标对象。当前 UI 通过 `taskPlan.dunId` 查 active task，这条链路不够稳定。 |
| 模型 / skills / SOP | 基本满足 | 已有 `llmBinding`、`boundSkillIds`、`sopContent`、`objective`、`metrics`、`strategy`、`obligations`。这是目前最扎实的一块。 |
| 执行状态 | 半满足 | 已有 `activeExecutions`、`executingDunId`、`lastExecutionResult`、execution steps，但没有以 `SopEpisode` 为权威源派生的统一 `DunExecutionState`。 |
| 产出与记录 | 半满足 | 有 experience、artifact、episode、exec trace，但数据分散；validator 结果尚未真正沉淀到持久化 episode。 |
| 能力摘要 | 弱满足 | 有 `DunScoring`、tool dimensions、recent runs、tier、achievement，但它们展示的是分数和工具表现，不是「擅长什么 / 什么可放心委托 / 什么需要复核」。 |
| 成长档案 | 不满足 | 有成长阶段、SOP rewrite、SOP fitness、patch/shadow 类型，但没有 `GrowthProfile`、成长叙事、代表作、教训本、信任边界。 |

## 现有代码资产

### Dun 基础实体

位置：`src/types.ts`

`DunEntity` 已经包含：

- `llmBinding`
- `boundSkillIds`
- `sopContent`
- `objective`
- `metrics`
- `strategy`
- `sopRewriteInfo`
- `sopEvolutionData`
- `scoring`
- `visualDNA`

这些字段足以支撑「工作栈」和部分「身份头」。

### Per-Dun 模型绑定

相关位置：

- `src/types.ts`
- `src/store/slices/worldSlice.ts`
- `src/services/runConfigResolver.ts`
- `server/handlers/duns.py`

当前已经支持：

- 每个 Dun 独立保存 `llmBinding`
- `runConfigResolver` 优先读取 Dun 自己的模型绑定
- 后端将 `llm_binding` 存在 `DUN.md` frontmatter
- UI 中可配置 provider、model、temperature

结论：模型配置能力基本满足，只是当前 UI 里位置偏深，应该前置到右侧小窗的工作栈区域。

### Skills 与 SOP

相关位置：

- `DUN.md` frontmatter 的 `skill_dependencies`
- `DunEntity.boundSkillIds`
- `dunManager.buildContext`
- `DunDetailPanel`

当前已经支持：

- 每个 Dun 有独立 skill 依赖
- UI 可绑定 / 安装 / 展示 skills
- SOP 每次 Dun 执行都会注入上下文
- `objective`、`metrics`、`strategy`、`obligations` 已经成为执行契约的一部分

结论：skills + SOP 也基本满足。需要改的是信息架构，不是底层能力。

### 执行记录与证据

相关位置：

- `src/types.ts`
- `src/services/episodeRecorder.ts`
- `src/services/evidenceValidator.ts`
- `src/services/postExecutionConsolidator.ts`
- `src/services/sopPatchGenerator.ts`
- `src/services/dunScoringService.ts`

当前已有：

- `SopEpisode`
- `SopValidatorOutput`
- `SopObligationCheck`
- `SopPatch`
- `SopShadow`
- `DunScoring`
- `RecentRunEntry`
- `ToolDimensionScore`

但存在几个断点：

- `recordEpisode` 写入的 episode 没有 validation。
- `recordEpisode` 写入的 `modelId` 仍是 `unknown`。
- `userSignal` 类型存在，但没有形成完整反馈闭环。
- `validateEpisode` 在 consolidator 内部运行后主要用于 patch 生成，没有作为 episode 证据长期沉淀。
- ability summary 目前只能从 score/tool dimensions 粗略推断，无法从 obligation 维度生成可信能力声明。

## 关键缺口

### 1. 缺显式的 Dun 当前目标

现在目标主要存在于：

- 用户消息
- `TaskItem.description`
- `TaskPlan.userPrompt`
- `SopEpisode.goal`

但它没有成为 Dun 的一等状态。

建议不要单独新增一套与 episode 分裂的 `activeGoal`，而是把 `SopEpisode` 升级为事前、事中、事后贯穿的目标执行对象：

```ts
type DunEpisode = {
  id: string;
  dunId: string;
  goal: EpisodeGoal;
  stackSnapshot: EpisodeStackSnapshot;
  status: EpisodeStatus;
  workbenchState?: unknown;
  artifacts: string[];
  trace: SopTraceEvent[];
  validation?: SopValidatorOutput;
  userSignal?: SopUserSignal;
  growthEffects?: EpisodeGrowthEffects;
};
```

其中 `stackSnapshot` 是关键字段。它记录「这次 episode 当时到底靠什么配置跑的」，用于能力追溯、模型切换后的置信度衰减、SOP patch 归因和 debug。

```ts
type EpisodeStackSnapshot = {
  llmBinding?: DunLLMBinding;
  resolvedModel: {
    providerId?: string;
    providerLabel?: string;
    modelId: string;
    source: 'dun-binding' | 'global-channel' | 'global-chat' | 'fallback';
    temperature?: number;
    contextWindow?: number;
    supportsTools?: boolean;
  };

  boundSkillIds: string[];
  availableTools: string[];
  unavailableSkillIds?: string[];

  sop: {
    sopId: string;
    sopVersion?: string;
    sopHash?: string;
    isShadow: boolean;
    shadowId?: string;
    injectedAnchors?: string[];
    injectionTruncated?: boolean;
  };

  knowledge?: {
    entityCount?: number;
    memoryCount?: number;
    injectedEntityTitles?: string[];
  };
};
```

注意：`llmBinding` 是用户配置层，`resolvedModel` 是实际执行层。能力归因应该使用 `resolvedModel`，因为 Dun 可能没有独立绑定而是走全局 fallback。

`stackSnapshot` 的时机也要固定：

```text
MVP：episode 创建时生成 stackSnapshot，episode 运行中禁止修改模型 / skills / SOP。

如果用户在执行中尝试修改工作栈：
- UI 提示「当前 Dun 正在执行，修改将在本次任务结束后生效」
- 本次 episode 继续使用创建时快照
- 修改写入 DunEntity，但不影响 running episode
```

后续如果必须支持执行中变更，不能覆盖 `stackSnapshot`，而要追加事件：

```ts
type EpisodeStackChangeEvent = {
  at: string;
  kind: 'model_changed' | 'skills_changed' | 'sop_changed';
  previous: Partial<EpisodeStackSnapshot>;
  next: Partial<EpisodeStackSnapshot>;
  reason: string;
};
```

但这会显著增加能力归因复杂度，MVP 不建议做。

### 2. 缺能力摘要对象

当前 `DunScoring` 能说明：

- 跑了多少次
- 成功率多少
- 哪些工具调用表现好
- 最近 run 怎么样

但它不能直接说明：

- 这个 Dun 最擅长什么业务能力
- 哪类任务可以放心委托
- 哪类任务需要用户复核
- 最近是在变稳还是变差

需要一个派生对象：

```ts
type DunAbilitySummary = {
  overallStatus: 'new' | 'learning' | 'stable' | 'strong' | 'risky';

  strongest: CapabilityClaim[];
  learning: CapabilityClaim[];

  trustAdvice: {
    safeToDelegate: TrustAdviceItem[];
    needsReview: TrustAdviceItem[];
  };

  recentTrend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
};

type EvidenceLevel = 'inferred' | 'validated' | 'statistical';

type CapabilityClaim = {
  id: string;
  label: string;
  evidenceLevel: EvidenceLevel;
  confidence: number;
  evidenceCount: number;
  passRate: number;
  wilsonLowerBound?: number;
  sourceObligations: string[];
  sourceMetrics: string[];
  lastEvidenceAt: string;
  sliceBreakdown: SliceCapability[];
  narrative: string;
};

type SliceCapability = {
  slice: string;
  evidenceCount: number;
  passRate: number;
  avgValidatorConfidence: number;
  wilsonLowerBound: number;
  recentTrend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
  weakObligationIds: string[];
  lastEvidenceAt: string;
};

type TrustAdviceItem = {
  taskType: string;
  slice?: string;
  trustLevel: 'safe' | 'assist' | 'needs_review' | 'not_ready';
  reason: string;
  sourceCapabilityIds: string[];
  evidenceLevel: EvidenceLevel;
};
```

能力摘要不是手填字段，而是从以下证据派生：

```text
DunScoring
+ SopEpisode.validation.obligationChecks
+ experience index
+ artifacts
+ user feedback
= DunAbilitySummary
```

`trustAdvice` 不应人工手写，而应由 `sliceBreakdown` 自动派生。例如「短合同」切片稳定，但「跨境合同」切片样本不足时，能力摘要可以同时给出：

```text
safeToDelegate: 普通短合同初审
needsReview: 跨境合同 / 高金额合同
```

这样「擅长合同审查」不会把所有合同类型混成一个过度自信的结论。

### 3. 缺能力推导阈值与统计显著性

能力声明必须有定量门槛，否则容易变成营销话术。这里不能只用 `passRate >= 80%` 这类拍脑袋阈值，因为小样本会让 Dun 过早显得可靠。

建议把能力声明分成三层：

```text
inferred:
- 只来自 DunScoring / recentRuns / legacy experience
- UI 只能说「倾向」「初步观察」
- 永远不能进入 safeToDelegate

validated:
- 来自 SopEpisode.validation.obligationChecks
- 有明确 obligation / metric 来源
- UI 可以说「在这些证据上表现稳定」

statistical:
- 样本数达到统计门槛
- 单 slice 用 Wilson score lower bound
- 跨 slice / 前后对比复用 fitnessEvaluator 的 Welch's t-test / SliceComparison
- 只有这一层才允许生成强信任建议
```

配置建议：

```ts
type AbilityDerivationConfig = {
  minEvidenceForDisplay: number;
  minEvidenceForValidated: number;
  minEvidenceForStatistical: number;
  wilsonConfidenceZ: number;
  minWilsonLowerBoundForStrongest: number;
  minWilsonLowerBoundForSafeDelegate: number;
  minAvgConfidenceForValidated: number;
  maxPValueForComparativeClaim: number;
  minSliceEpisodesForComparison: number;

  maxEvidenceForLearning: number;
  maxWilsonLowerBoundForLearning: number;

  recentWindowSize: number;
  recentDecayHalfLifeDays: number;
  decliningFailureRateThreshold: number;
};

const DEFAULT_ABILITY_DERIVATION_CONFIG: AbilityDerivationConfig = {
  minEvidenceForDisplay: 3,
  minEvidenceForValidated: 5,
  minEvidenceForStatistical: 20,
  wilsonConfidenceZ: 1.96,
  minWilsonLowerBoundForStrongest: 0.75,
  minWilsonLowerBoundForSafeDelegate: 0.8,
  minAvgConfidenceForValidated: 0.72,
  maxPValueForComparativeClaim: 0.05,
  minSliceEpisodesForComparison: 20,

  maxEvidenceForLearning: 3,
  maxWilsonLowerBoundForLearning: 0.6,

  recentWindowSize: 7,
  recentDecayHalfLifeDays: 14,
  decliningFailureRateThreshold: 0.35,
};
```

派生规则：

```text
strongest:
- 同一 capability/slice 证据数 >= 20
- Wilson lower bound >= 0.75
- avgValidatorConfidence >= 0.72
- 最近 7 次没有 critical failure
- evidenceLevel = statistical

validated:
- 同一 capability/slice 证据数 >= 5
- avgValidatorConfidence >= 0.72
- 有 obligationChecks / metrics 映射
- evidenceLevel = validated
- 不自动进入 safeToDelegate

inferred:
- 只来自 DunScoring / recentRuns / legacy experience
- 只能展示为「基于执行统计推断」
- evidenceLevel = inferred
- 不进入 safeToDelegate

stable:
- validated 或 statistical 声明
- 近期趋势不是 declining

learning:
- 证据数 <= 3
- 或 Wilson lower bound < 0.6
- 或 avgValidatorConfidence 偏低

needsReview:
- obligation 连续 2 次缺失
- 或用户显式 thumbs_down
- 或 critical / high-risk 场景缺少对应 evidence
- 或该 slice 样本数 < 20，但用户要把它当成高信任任务委托
```

Wilson 下界用于单一 slice 的通过率声明：

```text
phat = passCount / n
z = 1.96
lower =
  (phat + z*z/(2*n) - z*sqrt((phat*(1-phat)+z*z/(4*n))/n))
  / (1 + z*z/n)
```

复用 v2 统计基础：

```text
单 slice 是否稳定:
- 使用 Wilson score lower bound

跨 slice 声明，例如「短合同显著强于跨境合同」:
- 复用 fitnessEvaluator 的 SliceComparison
- pValue < 0.05 才能说「显著更强」

before / after 声明，例如「这次 SOP patch 后更稳定」:
- 复用 fitnessEvaluator 的 Welch's t-test
- 未达显著性时只能写「正在验证这个调整」，不能写「我学会了」
```

`recentTrend` 建议按滑窗计算：

```text
recentTrend = 最近 7 个 episode 的加权表现

improving:
- 最近窗口 passRate 比上一窗口高 >= 15%
- 且 failureRate 没有上升

stable:
- 最近窗口 passRate 波动 < 15%
- 且没有连续失败

declining:
- 最近窗口 failureRate >= 35%
- 或连续 2 次 validator failed

insufficient_data:
- episode 数 < 3
```

时间衰减：

```text
weight = 0.5 ^ (ageDays / recentDecayHalfLifeDays)
```

这样旧能力不会永久有效，模型、SOP、skills 变化后的表现会逐渐覆盖旧表现。

### 4. 缺能力摘要更新策略

建议不要每次渲染 UI 时现场全量算。能力摘要应该是一个可缓存的派生视图。

```ts
type DunProfileCacheMeta = {
  dunId: string;
  computedAt: number;
  sourceEpisodeIds: string[];
  sourceScoringUpdatedAt?: number;
  sourceSopVersion?: string;
  sourceModelId?: string;
  sourceSkillHash?: string;
};
```

触发时机：

```text
episode completed -> 异步增量更新 ability summary
episode validation completed -> 更新 obligation 相关 capability
user feedback received -> 立即更新 trustAdvice / learning
SOP patch promoted -> 标记 profile stale，后台重算
model binding changed -> 标记相关 capability confidence 衰减
skills changed -> 标记 stack-dependent capability stale
```

更新策略：

```text
默认：增量更新
- 新 episode 只更新涉及的 obligations / metrics / tools / artifacts / slices
- 相关 slice 的 Wilson lower bound 每次 episode 完成后重算
- recentTrend 每次 episode 完成后重算最近窗口
- 只有涉及跨 slice / before-after 的声明才触发 fitnessEvaluator 显著性计算

需要全量重算：
- SOP version 变化
- obligation schema 变化
- model provider/model 变化
- skill set 变化超过 30%
- 用户手动请求重新评估
```

缓存策略：

```text
cache key:
- dunId
- scoring.lastUpdated
- latestEpisodeId
- sopVersion/sopHash
- modelId
- skillHash

失效条件:
- 新 episode 写入
- scoring 更新
- feedback 写入
- SOP patch promoted/rejected
- llmBinding changed
- boundSkillIds changed

TTL:
- UI 读取缓存可接受 5 分钟
- episode 完成后应 fire-and-forget 刷新
```

建议新增：

```text
src/services/dunProfileService.ts
```

职责：

```ts
buildAbilitySummary(dunId: string): Promise<DunAbilitySummary>;
buildGrowthProfile(dunId: string): Promise<DunGrowthProfile>;
invalidateDunProfile(dunId: string, reason: ProfileInvalidationReason): void;
```

### 5. 缺成长档案对象

成长档案要回答的是「它为什么变成现在这样」。

当前代码有：

- `getGrowthStage`
- `sopRewriteInfo`
- `sopEvolutionData`
- `SopPatch`
- `SopShadow`
- achievements

但这些还不是一个面向用户的职业履历。

需要新增：

```ts
type DunGrowthProfile = {
  stage: GrowthStage;
  title: string;
  selfIntro: string;

  strengths: CapabilityClaim[];
  learningEdges: CapabilityClaim[];
  trustBoundaries: TrustBoundary[];

  highlights: CareerItem[];
  lessons: CareerItem[];
  timeline: GrowthEvent[];
};

type TrustBoundary = {
  taskType: string;
  trustLevel: 'safe' | 'assist' | 'needs_review' | 'not_ready';
  reason: string;
  escalationRule?: string;
};

type CareerItem = {
  id: string;
  kind: 'highlight' | 'lesson';
  title: string;
  summary: string;
  sourceEpisodeId: string;
  sourceArtifactIds?: string[];
  learnedChange?: string;
};

type GrowthEvent = {
  id: string;
  date: string;
  kind: 'success_pattern' | 'failure_lesson' | 'sop_patch' | 'stage_upgrade';
  title: string;
  firstPersonSummary: string;
  sourceEpisodeIds: string[];
};
```

### 6. 缺成长叙事生成与质量门禁

`GrowthEvent.firstPersonSummary` 可以由 LLM 生成，但必须基于结构化证据，不能让模型自由发挥。

推荐策略：

```text
规则模板优先，LLM 润色可选。
```

生成输入必须包含：

- source episode id
- validation result
- failed/passed obligations
- patch id 或 rewriteInfo
- before/after SOP contract change 或 presentation change
- artifact id
- user feedback

生成格式：

```ts
type GrowthNarrativeInput = {
  dunId: string;
  trigger: 'sop_patch' | 'success_pattern' | 'failure_lesson' | 'stage_upgrade';
  sourceEpisodeIds: string[];
  obligationIds: string[];
  evidenceSummary: string;
  contractChange?: string;
  presentationChange?: string;
  userFeedbackSummary?: string;
};
```

质量门禁：

```text
必须满足：
- 叙事中的能力声明能映射到 source obligation / metric
- 不允许出现没有 sourceEpisodeIds 的成长事件
- 不允许使用"已经掌握"、"精通"等强断言，除非 strongest 阈值已满足
- failure_lesson 必须包含 learnedChange
- sop_patch 事件必须引用 patchId 或 sopRewriteInfo
- stage_upgrade 只能改变履历展示和身份文案，不能声明新的执行能力
```

可用模板：

```text
success_pattern:
我在最近 {evidenceCount} 次「{capability}」任务中稳定满足了 {obligationIds}，之后我会继续优先保持这个检查顺序。

failure_lesson:
我在「{episodeTitle}」中漏掉了 {missingObligation}，之后我把它加入了默认检查清单：{learnedChange}。

sop_patch:
我根据 {sourceEpisodeCount} 次执行信号调整了 SOP 的「{sectionAnchor}」部分，变化是：{contractChange}。
```

LLM 可以做的事情：

- 把模板改写得更自然
- 压缩到 1-2 句
- 使用第一人称

LLM 不可以做的事情：

- 新增能力结论
- 新增不存在的 episode / artifact
- 把低置信 evidence 写成高置信结论

用户机制：

- MVP 阶段允许用户隐藏某条成长事件。
- 后续允许用户编辑 `firstPersonSummary`，但保留原始 generated summary 和 source ids。

## 字段映射方案

### 当前目标

来源：

- `TaskItem`
- `TaskPlan`
- `SopEpisode.goal`
- 当前 Dun 会话消息

建议补齐：

```ts
type EpisodeGoal = {
  title: string;
  userIntent: string;
  deliverables: string[];
  successCriteria: string[];
};
```

右侧小窗显示：

```text
当前目标：审查这份合同
产物：风险清单 + 修改建议
状态：执行中，第 2/5 步
```

### 模型 / Skills / SOP

来源：

- `DunEntity.llmBinding`
- `DunEntity.boundSkillIds`
- `DunEntity.sopContent`
- `DunEntity.objective`
- `DunEntity.metrics`
- `DunEntity.strategy`
- `DUN.md` frontmatter

建议抽象：

```ts
type DunWorkStack = {
  model: {
    providerId?: string;
    modelId?: string;
    temperature?: number;
    source: 'dun-binding' | 'global';
  };

  skills: {
    bound: string[];
    active: string[];
    unavailable: string[];
  };

  sop: {
    version?: string;
    objective?: string;
    metricCount: number;
    obligationCount: number;
    patchCount: number;
    lastPatchedAt?: string;
  };
};
```

右侧小窗显示成紧凑 chip：

```text
Model: GPT-5.4 · temp 0.7
Skills: 4 active / 1 unavailable
SOP: v1.3 · 4 obligations · 2 patches
```

### 执行状态

来源：

- `DunEpisode` / `SopEpisode`
- `DunEpisode.status`
- `DunEpisode.goal`
- `DunEpisode.trace`
- `DunEpisode.validation`
- 兼容层的 `activeExecutions` / `executingDunId`

原则：`DunEpisode` 应该是 per-Dun execution state 的权威源，`activeExecutions` 只作为旧 UI 的派生视图或兼容层存在，避免「episode 一套状态、activeExecutions 一套状态」的双轨。

建议抽象：

```ts
type DunExecutionState = {
  state: 'idle' | 'running' | 'paused' | 'waiting_user' | 'reviewing' | 'error';
  activeEpisodeId?: string;
  activeTool?: string;
  progressLabel?: string;
  currentStep?: string;
  nextAction?: string;
  startedAt?: number;
  lastActivityAt?: number;
};
```

状态转移建议：

```text
idle
  -> running          用户提交任务 / episode 创建

running
  -> waiting_user     触发 approval / 需要用户补材料
  -> reviewing        主执行完成，进入 critic / validator / consolidator
  -> error            执行异常且不可恢复

waiting_user
  -> running          用户批准 / 补充材料
  -> paused           用户暂停
  -> error            超时或用户拒绝导致任务失败

reviewing
  -> idle             episode 完成，后处理结束
  -> error            后处理失败但主任务失败

paused
  -> running          用户恢复
  -> idle             用户终止

error
  -> idle             用户确认 / 失败记录完成
```

并发策略：

```text
MVP：一个 Dun 同时只允许一个 running episode。
```

原因：

- 右侧小窗需要有明确的「当前目标」。
- SOP evolution 和 ability summary 都依赖清晰 episode 边界。
- 多任务并发会导致同一个 Dun 的 working memory、skills、SOP patch 归因混乱。

后续如果支持并发，建议：

```ts
type DunExecutionState = {
  state: 'idle' | 'running' | 'paused' | 'waiting_user' | 'reviewing' | 'error';
  activeEpisodeIds: string[];
  primaryEpisodeId?: string;
  concurrencyLimit: number;
};
```

与现有 `activeExecutions` 的关系：

```text
DunEpisode / SopEpisode 是权威源。
activeExecutions 是现有全局任务列表，MVP 只保留为兼容视图。

selectDunExecutionState(dunId):
- 调用 selectActiveEpisodeForDun(dunId)
- 从 episode.status / trace / validation 推导 running/reviewing/waiting/error
- 若未来允许多个 running episode，取 primaryEpisodeId 作为右侧小窗主显示
- 将状态归一化为 DunExecutionState

deriveActiveExecutions():
- 从 running / waiting_user / reviewing episodes 生成旧组件需要的 activeExecutions 形状
- 不反向写 episode 状态，避免双向同步
```

### 产出与记录

来源：

- `DunExperience`
- `DunArtifactInfo`
- `SopEpisode`
- `ExecTrace`
- conversation history

建议抽象：

```ts
type DunEvidenceIndex = {
  episodes: EpisodeBrief[];
  artifacts: ArtifactBrief[];
  experiences: ExperienceBrief[];
  feedback: FeedbackSignal[];
};
```

当前代码已经能做「产出数 / 最近产出 / 最近执行」摘要，但还不能稳定做代表作和教训本。

### 现有 DunExperience 到 CareerItem 的迁移

现有 `DunExperience` 只有：

```ts
type DunExperience = {
  title: string;
  outcome: 'success' | 'failure';
  content: string;
};
```

它不能直接满足 `CareerItem`，因为缺：

- sourceEpisodeId
- sourceArtifactIds
- learnedChange
- self_summary
- highlight / lesson 标注

迁移策略：

```text
历史数据不强行 backfill 为强证据。
```

建议分三层处理：

```text
legacy_experience:
- 从 successes.md / failures.md 读取
- 只展示在历史记录或成长时间线的"旧经验"区域
- 不参与 strongest 能力声明

derived_candidate:
- 从旧 experience 中粗略提取代表作/教训候选
- UI 标记为"待确认"
- 用户确认后转为 CareerItem

new_career_item:
- 只从新 episode + validation + artifact + feedback 生成
- 可参与成长档案和能力声明
```

兼容字段：

```ts
type CareerItem = {
  id: string;
  kind: 'highlight' | 'lesson';
  title: string;
  summary: string;
  sourceEpisodeId?: string;
  sourceArtifactIds?: string[];
  learnedChange?: string;
  legacyExperienceRef?: {
    file: 'successes.md' | 'failures.md';
    title: string;
  };
  confirmationStatus: 'auto' | 'user_confirmed' | 'legacy_unverified';
};
```

这样可以保留历史资产，但不会把弱历史记录包装成强成长证据。

### 能力摘要

能力摘要放在右侧小窗，目标是帮助用户快速判断「这活能不能交」。

显示建议：

```text
能力摘要

最擅长
合同付款 / 违约风险识别
17 次证据 · 稳定

正在学习
跨境管辖条款判断
样本不足，需复核

委托建议
普通合同初审可放心
高金额合同需确认
```

派生规则建议：

```text
obligation pass rate 高 + evidenceCount 足够 -> strongest
obligation 缺失 / validator confidence 低 -> learning
critical failure 或用户否定 -> needsReview
recentRuns 连续成功且 validation 稳定 -> trend stable/improving
```

### 成长档案

成长档案放在左侧大窗，目标是让用户理解「它为什么值得信任，以及它怎么变强」。

显示建议：

```text
成长档案

身份
资深合同风险顾问
我现在更擅长先定位关键风险，再给出谈判建议。

能力画像
- 我擅长：付款、违约、交付风险识别
- 我在学习：跨境合同判断
- 我会提醒你复核：高金额赔偿、诉讼策略

代表作
- XX 合同审查报告
  我认为这次做得好，因为我提前发现了隐藏排他条款。

教训本
- 曾漏掉排他条款
  后来我把排他条款加入默认检查清单。

成长时间线
- 2026-04-12：我开始默认检查付款和违约条款。
- 2026-04-19：我学会先按风险等级排序，而不是逐条解释。
```

## UI 改造方案

### 右侧小窗：Dun 仪表盘

右侧小窗不再承载全部详情，而是展示 Dun 的当前状态和关键入口。

建议结构：

```text
身份头
- 头像 / 名称 / stage / 一句话自述

当前目标
- 目标标题 / 当前步骤 / 状态

工作栈
- 模型
- Skills
- SOP

执行状态
- idle / running / waiting_user / error
- Execute / Pause

产出与记录
- 产出数
- 最近产出
- 近 7 次成功失败

能力摘要
- 最擅长
- 正在学习
- 委托建议

成长档案入口
- 点击身份头或成长卡打开左侧大窗
```

### 左侧大窗：深度展开区

左侧大窗用于承载详细内容，避免把所有内容挤在右侧小窗。

建议入口：

```text
Career Profile
SOP
Skills
Ability Evidence
Records
Artifacts
Knowledge
```

各入口职责：

| 入口 | 内容 |
| --- | --- |
| Career Profile | 身份卡、能力画像、代表作、教训本、成长时间线 |
| SOP | DUN.md 正文、obligations、metrics、patch history |
| Skills | 绑定技能、可用性、安装与解除绑定 |
| Ability Evidence | 能力声明、证据来源、validator / obligation 详情 |
| Records | episodes、trace、experience |
| Artifacts | 作品集、artifact preview |
| Knowledge | Dun knowledge tab |

## 推荐实现顺序

### Phase 1：修通基础状态

目标：让右侧小窗能可靠展示「当前目标 / 工作栈 / 执行状态」。

任务：

1. 用户把任务委托给 Dun 时创建 `DunEpisode` / `SopEpisode`，写入 `dunId`、`goal`、`status: running`、`stackSnapshot`。
2. 新增 `selectActiveEpisodeForDun(dunId)`，以 episode 作为右侧小窗「当前目标 / 执行状态」的权威来源。
3. 将 `activeExecutions` 降级为兼容派生视图，只从 episode 派生，不再反向决定 Dun 状态。
4. 把模型、skills、SOP 从 tab 深处前置为右侧小窗常驻工作栈。

### Phase 2：沉淀 episode 证据

目标：让能力摘要有可信来源。

任务：

1. `recordEpisode` 写入真实 `modelId`。
2. episode 写入 `stackSnapshot`。
3. consolidator 里的 `validatorOutput` 回写到 episode。
4. 接入 `userSignal`，至少先支持 thumbs up / thumbs down。

### Phase 3：新增派生服务

目标：从现有数据生成产品可用对象。

建议新增：

```text
src/services/dunProfileService.ts
```

职责：

```ts
buildAbilitySummary(dunId): Promise<DunAbilitySummary>
buildGrowthProfile(dunId): Promise<DunGrowthProfile>
deriveTrustAdvice(summary: DunAbilitySummary): TrustAdviceItem[]
```

输入：

- `DunEntity`
- `DunScoring`
- recent episodes
- experiences
- artifacts
- SOP evolution data
- user feedback
- `fitnessEvaluator` 的 SliceComparison / Welch's t-test 结果

输出：

- `DunAbilitySummary`
- `DunGrowthProfile`

### Phase 4：UI 落地

目标：右侧小窗仪表盘化，左侧大窗承载详情。

任务：

1. 重构 `DunDetailPanel` 为右侧仪表盘。
2. 新增左侧 `DunDrilldownPanel`。
3. 将现有 6 个 tab 内容迁入左侧大窗。
4. 新增 `CareerProfileView`。
5. 右侧能力摘要读取 `DunAbilitySummary`。

### Phase 5：成长影响展示风格

目标：让进化不只是数字展示，而是影响用户如何理解这个 Dun。

边界：这一阶段不进入 SOP / prompt 注入链，不修改 strict directive，不改变 task execution 的执行契约。Dun 真正的执行契约变化只能来自 promoted SopPatch / SOP 版本变更；stage 只影响 UI 文案密度、身份标签、履历页语气和能力说明方式。

建议新增：

```ts
type DunPresentationProfile = {
  summaryTone: 'humble' | 'balanced' | 'confident';
  explanationDensity: 'detailed' | 'normal' | 'concise';
  uiBadgeStyle: 'learning' | 'stable' | 'senior';
  defaultEvidenceDisclosure: 'expanded' | 'normal' | 'compact';
};
```

映射：

```text
trainee -> 解释更完整，证据默认展开，避免强断言文案
operator -> 显示可委托范围，但保留关键风险提示
specialist -> 能力摘要更聚焦，代表作和证据并列展示
senior -> 先显示信任边界 / 风险边界，再显示成绩
principal -> 展示跨任务模式和长期策略，但仍必须引用证据
```

禁止项：

```text
- 不把 stage 写入 Dun 执行 prompt
- 不让 stage 覆盖 SOP obligation
- 不让 stage 改变 validator / consolidator 的判断标准
- 不因为 stage 高就放宽 evidence 门槛
```

## 最小可行版本

如果要尽快落地，建议 MVP 只做四件事：

1. 右侧小窗展示工作栈：模型 / skills / SOP。
2. 右侧小窗展示能力摘要：最擅长、正在学习、委托建议。
3. 左侧大窗新增 Career Profile 骨架。
4. `dunProfileService` 先用现有 `DunScoring + recentRuns + experiences + artifacts` 生成粗版本。

MVP 阶段可以暂时不等完整 validator 数据闭环，但 UI 文案要明确区分：

- `统计推断`：来自 DunScoring / recentRuns / legacy experience，用灰色或琥珀色前置色块，文案只允许「倾向 / 初步观察」。
- `验证证据`：来自 obligationChecks，用蓝色前置色块，可展示 source obligation / episode。
- `统计显著`：满足 Wilson 下界或 fitnessEvaluator 显著性门槛，用绿色前置色块，才允许进入强委托建议。

这个标识必须是能力卡片的前缀或主色块，不要做成右上角小角标。MVP 最容易犯的错是用粗略统计生成「擅长 X / 可放心委托 Y」这种强语义，所以 `inferred` 能力不允许进入 `safeToDelegate`。

## 最终判断

当前代码已经有 Dun 成长系统的地基：

- per-Dun 模型绑定有了
- skills 有了
- SOP 有了
- objective / metrics / obligations 有了
- scoring 有了
- episode 类型有了
- validator / patch / shadow 类型有了

但还缺三个产品层对象：

```text
DunExecutionState
DunAbilitySummary
DunGrowthProfile
```

也缺一个关键闭环：

```text
episode validation + user feedback -> capability claim -> trust boundary -> growth narrative -> SOP patch / presentation update
```

所以当前不是推倒重来，而是把分散的数据资产整理成面向用户的「委托判断」和「成长履历」。

## 补充设计问题

### SopPatch 到 GrowthEvent

不是所有 patch 都应该出现在成长时间线。

建议记录条件：

```text
生成 GrowthEvent 的 patch:
- status promoted
- 或影响 obligations / output format / risk handling 等用户可感知行为
- 或来自连续 >= 3 次同类 failure_lesson
- 如果声明「变强 / 更稳定」，必须通过 Wilson 下界或 fitnessEvaluator 显著性检查

不记录:
- 文案微调
- 无显著执行契约变化的 patch
- shadow rejected 的 patch，除非它解释了重要失败教训
```

映射：

```ts
SopPatch.status === 'promoted'
  -> GrowthEvent.kind = 'sop_patch'
  -> sourceEpisodeIds = patch.sourceEpisodes
  -> firstPersonSummary = summarizePatchAsGrowthEvent(patch)
```

如果 patch 已 promoted 但还没有统计显著性，只能写成「我开始尝试把 X 加入检查流程」，不能写成「我已经学会 X」。

### 模型升级后的能力置信度衰减

能力声明是「Dun + stack」共同产生的，不应完全脱离模型。

当 `resolvedModel.modelId` 变化时：

```text
同 provider 同系列小版本变化:
- confidence * 0.9
- recentTrend 标记为 needs_revalidation

跨 provider 或大模型家族变化:
- confidence * 0.75
- strongest 降级为 validated，直到新模型下有 >= 5 条验证证据；强委托建议仍需 >= 20 条统计证据

降级到能力明显更弱的模型:
- confidence * 0.6
- trustAdvice 中加入 needsReview
```

当 skills 变化时：

```text
新增 skill:
- 不降低旧能力
- 新 skill 相关能力需要重新积累证据

移除 skill:
- 如果 capability 的 sourceTools 包含该 skill/tool，则 confidence * 0.6
- 且标记 stack_changed
```

### 多 Dun 能力模板

同类 Dun 可以共享 capability 模板，但不能共享能力证据。

```text
可以共享:
- capability label
- obligation -> capability 映射
- trust boundary 初始模板

不能共享:
- evidenceCount
- confidence
- passRate
- highlights
- lessons
```

建议后续加入：

```ts
type CapabilityTemplate = {
  id: string;
  domain: string;
  label: string;
  relatedObligationIds: string[];
  defaultTrustBoundary: string;
};
```

### UI 线框图

右侧小窗：

```text
┌────────────────────────────┐
│ 头像  Dun 名称              │
│ stage · 一句话自述           │
├────────────────────────────┤
│ 当前目标                    │
│ 审查这份合同                 │
│ 执行中 · 第 2/5 步           │
├────────────────────────────┤
│ 工作栈                      │
│ Model  GPT-5.4              │
│ Skills 4 active             │
│ SOP    v1.3 · 4 obligations │
├────────────────────────────┤
│ 执行状态                    │
│ 正在提取合同条款             │
│ [Pause] [Open Workbench]    │
├────────────────────────────┤
│ 能力摘要                    │
│ 擅长：付款/违约风险          │
│ 在学：跨境管辖               │
│ 建议：高金额合同需复核        │
├────────────────────────────┤
│ 产出 23 · 记录 6/7 成功      │
│ [成长档案] [内部结构]         │
└────────────────────────────┘
```

左侧 Career Profile：

```text
┌──────────────────────────────────────────────┐
│ Career Profile                               │
├──────────────────────────────────────────────┤
│ 身份卡                                       │
│ 资深合同风险顾问                              │
│ 我现在更擅长先定位关键风险，再给谈判建议。      │
├──────────────────────────────────────────────┤
│ 能力画像                                     │
│ 强项 / 在学 / 信任边界                         │
├──────────────────────────────────────────────┤
│ 代表作                                       │
│ highlight cards                              │
├──────────────────────────────────────────────┤
│ 教训本                                       │
│ lesson cards                                 │
├──────────────────────────────────────────────┤
│ 成长时间线                                   │
│ success_pattern / failure_lesson / sop_patch │
└──────────────────────────────────────────────┘
```
