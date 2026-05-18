# Skills IDE 设计方案

> 技工学院页面重构: 从技能商店到技能生产线
>
> 讨论日期: 2026-04-23
> 最后更新: 2026-04-23 (v3 — 整合 Review 反馈，落地细节补全)
> 状态: 方案定稿，待实现

---

## 1. 背景与问题

### 1.1 当前技工学院的问题

当前技工学院 tab (`SkillsHouseView`) 本质上是一个**技能商店/画廊**:

- `SkillsGridView` — 只读的技能卡片列表，用户无法直接操作技能内容
- `SkillsInspectorPanel` (1035行) — 80% 的代码在渲染分数条和状态指标 (rankScore / healthScore / freshnessScore)，真正的编辑能力只有一个 textarea + LLM 黑箱调用，用户完全看不到 SKILL.md 源码
- 评分、排序对用户来说不是有效的交互界面

### 1.2 核心洞察

**SKILL.md 是 LLM 的程序代码**:
- YAML frontmatter = 配置声明
- Markdown body = 指令逻辑
- scripts/ = 可执行模块
- references/ = 上下文数据

开发技能 = 编程。所以它需要 **IDE**，不是 App Store。

**但 IDE 的价值不在 UI 壳子，而在驱动生产的 LLM 管线。** 只是套一个 IDE 外壳来开发 skills 没有效率。目的是**快速生产高质量的 skills**，这意味着:
- 需要**独立的 system prompt** 来调用 LLM，而不是复用系统的主 Agent 架构
- 需要专门为高质量 skills 生产设计的 LLM 调用环境
- 需要考虑编码格式、大模型产出质量、结构化输出

### 1.3 目标

将技工学院页面改造为 **Skills IDE** — 一个专为高质量 SKILL.md 生产设计的环境:
- **独立 LLM 管线**: 专门的 system prompt + 多阶段生产流水线 + 质量门禁
- **AI 驱动的编辑**: 自然语言描述意图 → 结构化 LLM 生产 → Diff 审核 → 验证保存
- **沙箱测试验证**: 隔离环境执行完整 ReAct 循环，验证技能实际效果
- **版本追踪回退**: 自动快照 + 简化 Git

### 1.4 目标用户画像

Skills IDE 的**主要用户是技能作者/开发者** — 他们理解 SKILL.md 的结构，追求精确控制和高效生产。UI 设计以此为锚点。

| 用户类型 | 特征 | IDE 策略 |
|---------|------|---------|
| **技能开发者** (主要) | 理解 SKILL.md 格式，需要精确控制 diff、直接编辑源码、git 版本管理 | 默认展示 Source tab + Diff 审核，提供快速模式跳过引导 |
| **高级用户** (次要) | 有明确需求但不想学格式细节，能看懂 Diff 但不想手写 | AI Producer 自然语言驱动，Preview tab 为默认视图 |
| **初次用户** (偶尔) | 不了解 SKILL.md，需要引导 | 结构化访谈模式 (引导创建)，但不强制 |

**设计原则**: 面向专家优化，对新手友好但不牺牲效率。快速模式是默认路径，引导模式是可选。

---

## 2. 设计决策

经过多轮讨论，确定以下关键决策:

| 决策点 | 选择 | 理由 |
|--------|------|------|
| **编辑器模式** | Textarea + AI 驱动 | 用自然语言编辑为主，Source 为辅。SKILL.md 本身是给 LLM 看的文档，用 LLM 来写它是自然的 |
| **LLM 配置** | 复用主 LLM + 可覆盖 | 默认使用主 Agent 的 LLM 配置，但允许用户为 IDE 指定不同模型 |
| **测试系统** | 沙箱执行测试 | 在隔离环境中实际调用 LLM，模拟完整 ReAct 循环，观察技能是否被正确触发和执行 |
| **版本管理** | 内置快照 + 简化 Git | 自动快照作为基础，同时提供一键 git commit 的便捷操作 |
| **Tab 关系** | 双模式共存 | 保留当前网格视图作为"浏览模式"，新增 IDE 作为"开发模式"，允许切换 |
| **实现路线** | 分阶段渐进 | Phase 1 先搭骨架和核心编辑，后续迭代加入测试和版本 |
| **创建流程** | AI 导向创建 | 在 IDE 内通过 AI 对话创建:"我要创建一个 PDF 处理技能" -> AI 引导生成 SKILL.md |

---

## 3. 核心: 独立 LLM 生产管线 (Skill Production Pipeline)

> **这是 Skills IDE 的第一等价值**。UI 是管线的展示层，不是核心。

### 3.1 架构概览

Skills IDE 运行一条**独立于主 Agent (LocalClawService) 的 LLM 管线**。它不复用系统的 ReAct 循环，而是有自己的 system prompt、调用参数、输出格式控制和质量门禁。

```
                ┌───────────────────────────────────────┐
                │        Skill Production Pipeline       │
                │  (独立 LLM 通道, 非主 Agent 架构)        │
                │                                       │
用户意图 ──────→│  Phase B: 生产 (Production) [默认入口]  │
                │    ↓ 定界符输出: ===SKILL_START===     │
                │  Phase C: 验证 (Validation) [本地]      │
                │    ↓ DiagnosticResult[]                │
                │  Phase C+: 触发测试 [本地+轻量LLM]      │
                │    ↓ TriggerTestResult                 │
                └──────────────┬────────────────────────┘
                               ↓
                     Diff 审核 → 用户接受/拒绝 → 快照保存
                                    ↓ (如果用户对 Diff 不满意)
                            Phase A: 分析 [按需触发]
                            展示 change_plan → 用户调整方向
```

**关键决策: Phase A 默认跳过。** 大多数情况下用户直接看 Diff (Phase B 输出) 就能判断修改是否正确。Phase A 只在用户需要 "解释修改逻辑" 或 Diff 方向明显偏离时才触发。这遵循 "先看结果，再看理由" 的使用习惯，避免每次操作都要两轮 LLM 调用的延迟。

**与主 Agent 的区别:**

| 维度 | 主 Agent (LocalClawService) | Skill Producer |
|------|---------------------------|----------------|
| 目的 | 通用任务执行 | 专精 SKILL.md 生产 |
| System prompt | SYSTEM_PROMPT_FC (通用) | SKILL_PRODUCER_PROMPT (专用, 带版本号) |
| 调用模式 | ReAct 多轮循环 + 工具调用 | 单次定向调用 + 流式输出 + 结构化定界符 |
| 温度 | 默认 (由模型决定) | 生产模式: 0 / 探索模式: 0.3-0.5 |
| 输出格式 | 自然语言 + function_call | 定界符包裹 (===SKILL_START=== / ===SKILL_END===) |
| 工具访问 | 完整工具注册表 | 无 (纯文本生产) |
| 上下文 | 聊天历史 + 工具结果 | 当前 SKILL.md + 用户指令 + 近期操作上下文 |

### 3.2 SKILL_PRODUCER_PROMPT (生产者系统提示词)

这是整个管线的灵魂。参考 Claude Code 的 `skillify.ts` 和 `skillImprovement.ts`，但针对 DunCrew 的 SKILL.md 格式深度定制。

**Prompt 版本管理**: SKILL_PRODUCER_PROMPT 带版本号 (如 `v1.0`)，每次生产的快照中记录当时使用的 prompt 版本。这样在 prompt 迭代后，仍可追溯某个技能是用哪个版本的 prompt 生产的，回退快照时也能复现生产环境。

```markdown
# SKILL_PRODUCER_PROMPT v1.0

你是 DunCrew Skills IDE 的技能生产引擎。你的唯一任务是生产和优化高质量的 SKILL.md 文件。

## 你理解的 SKILL.md 结构

SKILL.md 是 DunCrew Agent 的程序代码。它由以下部分组成:

### YAML Frontmatter (配置声明)
```yaml
---
name: skill-name              # 必填, kebab-case
description: |                 # 必填, 技能触发的核心机制
  做什么 + 什么时候触发。
  Agent 根据 description 决定是否加载此技能。
version: 1.0.0                # 推荐, semver
tags: [category]              # 推荐, 用于分类和检索
keywords: [word1, word2]      # 用于触发词匹配
toolName: primary-tool        # 如果技能绑定单一工具
toolNames: [tool1, tool2]     # 如果技能使用多个工具
toolType: builtin|mcp|api     # 工具类型
dangerLevel: low|medium|high  # 操作风险级别
requires:
  env: [API_KEY_NAME]         # 需要的环境变量
  bins: [binary-name]         # 需要的可执行文件
  config: [config-key]        # 需要的配置项
emoji: "🔧"                   # 显示用 emoji
author: author-name           # 作者
---
```

### Markdown Body (指令逻辑)
- 第一段落: 高密度能力概述 (1-3句)
- 后续章节: 使用步骤、约束规则、示例、安全规则
- 遵循 Progressive Disclosure: 主体保持精简 (<3000 tokens)
- 大量参考资料拆分到 references/ 目录，用相对路径引用

### 目录结构
```
skill-name/
├── SKILL.md           # 主文件 (必须)
├── scripts/           # 可执行脚本 (可选)
├── references/        # 参考文档 (可选, 用于 Progressive Disclosure)
└── assets/            # 静态资源 (可选)
```

## 你的输出规范

**重要**: 使用定界符而非 XML 标签包裹输出。SKILL.md 内容可能包含 `<` `>` 字符，XML 解析极其脆弱。定界符方案只需字符串 split，几乎不会出错。

### 修改已有技能时
分析用户指令，输出以下结构:

===CHANGE_SUMMARY===
用一句话描述做了什么改动。
===END_CHANGE_SUMMARY===

===SKILL_START===
---
(完整的 YAML frontmatter)
---
(完整的 Markdown body)
===SKILL_END===

### 当用户要求解释修改逻辑时 (Phase A, 按需)
额外输出修改计划:

===CHANGE_PLAN===
- 变更类型: [frontmatter修改 | body修改 | 结构重组 | 新增引用文件]
- 变更范围: [具体哪些字段/章节]
- 变更理由: [为什么这样改]
===END_CHANGE_PLAN===

### 创建新技能时
根据用户描述的需求，通过结构化访谈或快速模式收集信息，然后一次性生成完整 SKILL.md。

## 质量规则 (CRITICAL)

1. **description 是第一优先级**: 它决定 Agent 是否会触发此技能。必须同时包含:
   - 这个技能做什么 (能力)
   - 什么情况下应该使用它 (触发条件)
   不良示例: "处理 PDF 文件" (太模糊)
   优良示例: "将 PDF 文件转换为 Markdown 格式，提取文本、表格和图片。当用户需要阅读、分析或转换 PDF 文档时使用。"

2. **frontmatter 完整性**: 每个字段都要有意义。不确定的字段宁可不填，不要填占位值。

3. **token 预算意识**: Agent 的上下文窗口是有限的。SKILL.md body 应该:
   - 核心指令 < 3000 tokens
   - 冗长的参考资料放到 references/
   - 避免大段重复内容

4. **最小改动原则**: 修改时只改用户要求的部分。不做额外的 "优化"、重新排版、补充注释等无关操作。保持原有的格式风格和结构。

5. **requires 声明精确**: 如果技能使用了外部 API，必须在 requires.env 中声明。如果依赖命令行工具，必须在 requires.bins 中声明。

6. **安全边界**: 高风险操作 (文件删除、系统命令、网络请求) 必须在 body 中声明安全规则，并设置合适的 dangerLevel。

## 你不做的事

- 不执行工具调用，不访问文件系统
- 不生成与 SKILL.md 无关的内容
- 不做超出用户指令范围的改动
- 不输出不完整的 SKILL.md 片段 — 始终返回完整文件
```

### 3.3 多阶段生产流程

#### Phase B: 生产 (Production) — 默认入口

**触发**: 用户在 AI 面板输入修改指令 (默认直接进入，跳过 Phase A)
**输入**: 当前 SKILL.md 全文 + 用户指令 + 近期操作上下文 (最近 3-5 次操作摘要)
**输出**: `===SKILL_START===` 包裹的完整 SKILL.md + `===CHANGE_SUMMARY===`
**关键参数**:
- **生产模式** (默认): temperature: 0 — 确定性输出，减少随机变动
- **探索模式** (用户说"换一种写法试试"): temperature: 0.3-0.5 — 允许多样性
- **流式输出**: streaming 到 Diff 视图，用户看到 SKILL.md 逐行生成，而不是等待黑盒完成

```typescript
async function produceSkill(
  currentSkill: string,
  instruction: string,
  recentOps: OperationContext[],  // 近期 3-5 次操作摘要
  mode: 'production' | 'exploration' = 'production'
) {
  const stream = await callLLMStream({
    systemPrompt: SKILL_PRODUCER_PROMPT,
    messages: [
      ...buildRecentOpsContext(recentOps),  // 注入近期操作上下文
      { role: 'user', content: buildProductionPrompt(currentSkill, instruction) }
    ],
    temperature: mode === 'production' ? 0 : 0.4,
  })

  // 流式输出到 Diff 视图，实时渲染增量内容
  for await (const chunk of stream) {
    yield chunk  // UI 层增量渲染
  }

  const fullResponse = stream.getFullText()
  return {
    updatedSkill: parseDelimited(fullResponse, 'SKILL_START', 'SKILL_END'),
    changeSummary: parseDelimited(fullResponse, 'CHANGE_SUMMARY', 'END_CHANGE_SUMMARY'),
  }
}
```

**近期操作上下文** (解决 "刚才" 引用问题): 不维护完整聊天历史，但保留最近 3-5 次操作的结构化摘要 (指令 + 变更说明)，让 LLM 能理解用户说的 "把刚才的 description 改回去" 指的是什么。

```typescript
interface OperationContext {
  instruction: string     // 用户的修改指令
  changeSummary: string   // AI 的变更说明
  timestamp: number
}
```

**大文件保护**: 如果当前 SKILL.md 估算超过 4000 tokens，Phase B 输出可能被截断。应对策略:
1. Phase C 检测 `===SKILL_END===` 是否存在 — 不存在则判定截断
2. 截断时自动提示用户: "技能文件过大，建议将部分内容拆分到 references/ 目录"
3. 不自动重试 (重试大概率仍然截断)，而是引导用户缩减文件

#### Phase A: 分析 (Analysis) — 按需触发

**触发条件** (非默认路径):
- 用户点击 "解释修改逻辑" 按钮
- 用户对 Phase B 的 Diff 不满意，想了解 AI 的修改思路
- Diff 变更行数超过原文 50%，系统自动建议展示计划

**输入**: 当前 SKILL.md + 用户指令
**输出**: `===CHANGE_PLAN===` 定界符包裹的修改计划

```typescript
async function analyzeChange(currentSkill: string, instruction: string) {
  const response = await callLLM({
    systemPrompt: SKILL_PRODUCER_PROMPT,
    messages: [
      { role: 'user', content: `请只输出修改计划，不要生成SKILL.md。\n\n当前技能:\n${currentSkill}\n\n修改指令: ${instruction}` }
    ],
    temperature: 0,
  })
  return parseDelimited(response, 'CHANGE_PLAN', 'END_CHANGE_PLAN')
}
```

#### Phase C: 验证 (Validation) — 本地 + 轻量触发测试

**触发**: Phase B 完成后自动执行
**输入**: 生成的 SKILL.md 文本

**C1: 本地静态验证** (纯本地，不调 LLM):

| 检查 | 方法 | 严重性 |
|------|------|--------|
| 完整性 | `===SKILL_END===` 定界符存在 | error |
| frontmatter 存在 | 检测 `---` 分隔符 | error |
| YAML 语法 | `yaml.parse()` | error |
| 必填字段 | name, description 存在且非空 | error |
| Token 预算 | body 估算 < 5000 tokens | warning |
| requires 一致性 | env/bins 声明与 body 提及一致 | warning |
| 引用文件存在 | references/ 中引用的文件在磁盘上存在 | warning |
| version 格式 | semver 合规 | info |
| dangerLevel 合理性 | 提及高风险操作时 dangerLevel 不低于 medium | warning |

**C2: 轻量触发测试** (Phase 1 就要有，异步执行不阻塞):

> description 字符数检查太弱 (100 字符的烂 description 也能通过)。真正有意义的验证是: 给定这个 description，什么样的用户请求会触发此技能?

```typescript
async function triggerTest(skillDescription: string, skillKeywords: string[]) {
  // 用小模型/低成本调用，异步执行不阻塞 Diff 展示
  const response = await callLLM({
    systemPrompt: '你是一个技能触发测试器。给定技能的 description 和 keywords，生成 3 个会触发此技能的用户请求，和 2 个不应该触发的请求。',
    messages: [{ role: 'user', content: `description: ${skillDescription}\nkeywords: ${skillKeywords.join(', ')}` }],
    temperature: 0,
    model: 'small-fast',  // 用小模型降低成本
  })
  return parseTriggerTestResult(response)
}
```

展示效果 (Diagnostics Bar 的 "触发测试" 项):
```
✓ 触发测试:
  会触发: "帮我分析这个PR" | "review一下代码改动" | "看看这个PR有什么问题"
  不触发: "今天天气怎么样" | "帮我写个函数"
```

这比字符数检查有意义得多 — 用户能直观看到 Agent 在什么情况下会使用这个技能。

### 3.4 创建流程 (新技能) — 双模式

#### 快速模式 (默认，面向有经验用户)

用户直接描述需求或粘贴模板，一次性生成:

```
用户: "创建一个 github-pr-review 技能，需要 GITHUB_TOKEN，
      分析 PR 的代码改动并生成 review 报告，当用户说
      'review PR' 或 '分析PR' 时触发"
  ↓
Phase B 直接生产 → 展示完整 SKILL.md Diff → [接受] [修改]
```

也支持从模板创建: 选择模板 (空白 / API 集成 / 命令行工具 / 数据处理) → 预填 frontmatter → 用户修改。

#### 引导模式 (可选，面向初次用户)

参考 Claude Code `skillify.ts` 的结构化访谈，4-round 引导:

```
Round 1: 基础确认
  AI: "你想创建什么技能? 描述它的功能和使用场景。"
  → 确认 name + description 初稿

Round 2: 能力边界
  AI: "这个技能需要哪些工具? 有什么外部依赖?"
  → 确定 toolNames, requires, dangerLevel

Round 3: 指令细化
  AI: "描述一下技能执行的具体步骤和成功标准。"
  → 生成 body 步骤结构

Round 4: 触发条件
  AI: "什么情况下 Agent 应该使用这个技能?"
  → 完善 description 触发条件 + keywords
```

**用户可在任何 Round 中断**: 说 "直接生成吧" 跳到最终生产。访谈收集的信息作为 context 传给 Phase B。

### 3.5 自改进机制 (Self-Improvement)

参考 Claude Code `skillImprovement.ts` 的 side-channel 分析模式:

**场景**: 用户在主 Agent 中使用某个技能时，发现技能表现不佳，手动纠正了 Agent 的行为。这些纠正信号应该被捕获并反馈给 Skills IDE。

```
主 Agent 执行技能 → 用户发出纠正指令 → 检测模块捕获
                                            ↓
                                     Side-channel LLM 分析:
                                     "用户的纠正意味着技能应该..."
                                            ↓
                                     生成改进建议 → 推送到 Skills IDE
                                            ↓
                                     用户在 IDE 中审核 → 接受/拒绝
```

**具体触发信号** (不是泛泛的"分析日志"，而是明确的 pattern matching):

| 信号 | 检测方法 | 示例 |
|------|---------|------|
| **步骤纠正** | 用户消息含 "不要...而是..." / "跳过这步" / "先做...再做..." | "不要直接搜索，先分析用户的意图" |
| **输出格式纠正** | 用户消息含 "格式不对" / "用...格式" / "输出应该是..." | "输出用 markdown 表格，不要纯文本列表" |
| **约束补充** | 用户消息含 "记住..." / "以后..." / "每次都要..." | "记住每次搜索结果都要附上来源链接" |
| **触发失败** | 技能应触发但未触发，用户手动指定技能 | 用户说 "用 web-search 帮我搜索" (自动触发失败) |

**不触发的情况** (区分 "技能需要改进" vs "用户需求变化了"):
- 用户的纠正与技能核心功能无关 → 忽略
- SKILL.md 已包含相关规则但 Agent 没遵守 → Agent 问题不是技能问题 → 忽略
- 一次性特殊需求 (不具有重复性) → 忽略

**频率控制**: 同一技能 24h 内最多 3 条建议，队列上限 10 条，超过丢弃最旧的。

**LLM 调用参数**:
- 使用小模型 (或主模型的低成本模式)
- temperature: 0
- 定界符输出: `===IMPROVEMENT===` / `===END_IMPROVEMENT===`

### 3.6 LLM 通道配置

```typescript
interface SkillProducerLLMConfig {
  // 默认继承主 Agent 的 LLM 配置
  inheritFromMain: boolean

  // 覆盖配置 (当 inheritFromMain = false 或用户手动设置)
  model?: string          // e.g. "gpt-4o", "claude-sonnet-4-20250514"
  apiKey?: string
  baseUrl?: string

  // 生产参数
  maxTokens: 8192          // SKILL.md 不应该超过这个长度

  // 温度由调用场景决定，不是固定值
  // - 生产模式 (默认修改): temperature = 0
  // - 探索模式 (用户想要不同写法): temperature = 0.3-0.5
  // - 触发测试/自改进分析: temperature = 0
}
```

**默认行为**: 继承主 Agent 的 model + apiKey + baseUrl。温度根据场景自动选择: 生产模式 temperature=0 保证确定性，探索模式 temperature=0.3-0.5 允许多样性。用户说 "换一种写法试试" 时自动切换到探索模式。

### 3.7 输出质量控制

除了 Phase C 的本地验证，还有以下机制保证 LLM 输出质量:

1. **定界符解析**: 输出必须包含 `===SKILL_START===` 和 `===SKILL_END===`，解析失败则重试 1 次。比 XML 更健壮 — SKILL.md 内容中的 `<>` 字符不会干扰解析
2. **完整性校验**: 解析后的 SKILL.md 必须包含 `---` 分隔的 frontmatter，否则拒绝
3. **Diff 对比**: 自动计算修改前后的 diff，只有当 diff 与用户指令语义相关时才呈现给用户
4. **最小改动检测**: 如果 diff 行数超过原文的 50%，系统自动建议展示 Phase A 修改计划，并警告用户 "AI 做了大量修改，请仔细审核"
5. **格式保持**: system prompt 中强调 "保持原有的格式风格和结构"
6. **流式输出**: Phase B 使用 streaming 输出，用户看到 SKILL.md 逐行生成。Diff 组件需要支持增量渲染 — 这对感知速度影响很大

### 3.8 SKILL_PRODUCER_PROMPT 版本管理

SKILL_PRODUCER_PROMPT 是硬编码在代码中的，但会随系统演进不断迭代。如果 prompt 改了，用旧 prompt 生产的技能质量基线也变了，回退快照时也无法复现当时的生产环境。

**策略**:
- Prompt 带语义版本号: `SKILL_PRODUCER_PROMPT v1.0`
- 每个快照记录生产时使用的 prompt 版本号
- Prompt 历史版本存档在代码中 (或配置文件)，不删除旧版本
- 回退快照时可选择使用原始 prompt 版本重新生产

```typescript
interface SkillSnapshot {
  // ... 其他字段
  producerPromptVersion: string   // 生产时用的 prompt 版本
}
```

---

## 4. UI 层设计

> UI 是生产管线的展示层。它的职责是: 呈现数据、收集输入、展示 Diff、提供操控。

### 4.1 整体布局

```
┌─ SkillIDE ──────────────────────────────────────────────────┐
│ ┌──────────┬──────────────────────────────┬───────────────┐ │
│ │          │  Toolbar: [Preview][Source]   │               │ │
│ │ Explorer │  [Test][Validate] [LLM ▾]    │  AI Producer  │ │
│ │          ├──────────────────────────────┤               │ │
│ │ 📁 skills│                              │ 💬 生产面板    │ │
│ │ ├ 📄 cod │  ┌── 主工作区 ──────────────┐  │               │ │
│ │ ├ 📄 dee │  │                          │  │  [修改指令]   │ │
│ │ ├ 📄 web │  │  Preview / Source /      │  │  AI: <plan>   │ │
│ │ ├ 📄 pro │  │  Test Results            │  │  [确认] [修改] │ │
│ │ └ 📄 ska │  │                          │  │  AI: <diff>   │ │
│ │          │  │                          │  │  [接受] [拒绝] │ │
│ │ ── 状态 ──│  └──────────────────────────┘  │               │ │
│ │ ⚠ 2 待修 │  ┌── Diagnostics Bar ──────┐  │  ─── 版本 ─── │ │
│ │ ✓ 38 正常│  │ ✓ yaml │ ✓ desc │ ⚠ tok │  │  v3 当前 ✓    │ │
│ └──────────┴──┴──────────────────────────┴──┴───────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

右面板不再叫 "AI Copilot" (暗示通用聊天)，而是 **AI Producer** (明确生产定位)。

### 4.2 与现有页面的关系 + 模式切换

```
SkillHouse
├── Tab "神经元"    → SkillTreeView (保留不变)
└── Tab "技工学院"  → SkillsHouseView (改造)
    ├── 浏览模式    → 保留当前 Grid + Sidebar + Inspector
    └── 开发模式    → 新增 SkillIDE (三栏布局)
```

**模式切换的具体交互**:

| 场景 | 操作 | 行为 |
|------|------|------|
| 浏览 → 开发 | 在浏览模式点击技能卡片上的 "编辑" 按钮 | 切换到 IDE，自动加载该技能 |
| 浏览 → 开发 | 点击顶部 "开发模式" 切换按钮 | 进入 IDE，保持上次选中的技能 |
| 开发 → 浏览 | 点击顶部 "浏览模式" 切换按钮 | 如有未保存修改，提示保存 |
| 开发中关闭技能 | 在 Explorer 中取消选中 | 回到 IDE 空状态 (不切换模式) |

**路由**: 两个模式共用同一路由 (不影响 URL)，通过 Zustand state `ideMode` 切换。这是纯前端状态，不需要路由变化。

### 4.3 AI Producer 面板 — 核心交互

这个面板是 LLM 生产管线的人机接口。**默认路径直接出 Diff**:

```
用户输入修改指令
  ↓
Phase B 流式输出: Diff 视图逐行生成
  添加行 (绿色) / 删除行 (红色) / 不变行 (灰色)
  变更说明: "添加了 TAVILY_API_KEY 环境变量依赖声明"
  [接受修改] [拒绝] [再改改] [解释修改逻辑]
  ↓
Phase C 自动执行: 底部 Diagnostics Bar + 触发测试 更新
  接受 → 自动保存 + 创建快照 → 实时更新 Preview
```

**如果用户对 Diff 不满意**: 点击 [解释修改逻辑] → 触发 Phase A → 展示修改计划 → 用户可以调整指令重新生产。

**近期操作上下文** (不是聊天，但有记忆):
- 面板保留最近 3-5 次操作的摘要条 (指令 + 变更说明)
- 用户可以引用 "刚才": "把刚才的 description 改回去"
- LLM 调用时注入这些操作摘要作为上下文
- 操作历史随技能切换而清空 (不跨技能)

### 4.4 错误恢复路径

每个故障场景都需要有完整的用户操作路径:

| 故障 | 用户看到什么 | 用户可以做什么 |
|------|-------------|---------------|
| 定界符解析失败 (Phase B) | "生成格式异常，正在重试..." | 自动重试 1 次。仍失败 → 展示原始 LLM 输出文本 + [手动编辑] 按钮，用户可以从中提取有用内容 |
| 输出截断 (大文件) | "技能文件过大，输出被截断" + 截断位置标记 | [拆分建议] 按钮 → AI 建议哪些内容可以移到 references/。或直接在 Source tab 手动修复 |
| Phase C 报 error | Diagnostics Bar 显示红色错误项 | 用户可以在 Diff 视图中直接修复 (不需要重走 Phase B)，也可以输入新指令让 AI 修复 |
| LLM 调用超时/网络错误 | "LLM 连接失败" | [重试] / [切换模型] / Source tab 手动编辑 |
| 探索模式输出不满意 | 正常 Diff 展示 | [再试一次] (重新生成) / [切回生产模式] (temperature=0) |

### 4.5 其他 UI 模块

**Explorer (左面板)**:
- 技能列表 (按来源分组: 用户 > 内置)
- 搜索框 (fuzzy match)
- 选中后展开文件树 (SKILL.md + scripts/ + references/)
- 底部状态聚合

**主工作区 (中间)**:
- Preview tab: Markdown 渲染预览 (frontmatter 卡片 + body)
- Source tab: Textarea 直接编辑 (带行号)
- Test tab: 沙箱测试结果展示 (Phase 2)

**Diagnostics Bar (底部)**:
- Phase C 静态验证 + 触发测试结果的可视化
- 替代旧的 healthScore/rankScore — 给开发者可操作的诊断信息
- `[✓ yaml] [✓ desc] [⚠ tokens: 3.2k] [✓ requires] [✓ 触发测试]`
- 触发测试项展开后展示: 会触发的 prompt 示例 + 不会触发的 prompt 示例

**版本快照 (右面板下方)**:
- 时间线: v3 当前 / v2 10:32 / v1 09:15
- 点击查看 diff，回退到任意版本
- 每条快照记录: 内容 + prompt 版本号 + 来源 (手动/AI)

### 4.6 沙箱测试 (Phase 2)

分为两层:

**轻量触发测试** (Phase 1 已有，在 Diagnostics Bar 中展示):
- 用小模型验证 description/keywords 的触发能力
- 异步执行，不阻塞主流程

**完整沙箱测试** (Phase 2，独立 Test tab):

```
测试输入: 用户 prompt (模拟真实用户请求)
  ↓
Step 1: 触发匹配 — 验证 description/keywords 能否正确触发此技能
Step 2: 上下文加载 — 验证 SKILL.md body + references 加载正常
Step 3: LLM 规划 — 观察 Agent 如何理解和执行技能指令
Step 4: 工具调用 — dry-run 模式，记录调用但不真正执行
Step 5: 结果评估 — token 消耗、步骤数、是否触发了预期工具
```

---

## 5. 技术实现

### 5.1 核心服务: SkillProductionService

独立于 `LocalClawService` 的 LLM 调用服务:

```typescript
// src/services/SkillProductionService.ts

class SkillProductionService {
  private llmConfig: SkillProducerLLMConfig
  private promptVersion: string = 'v1.0'

  // Phase B: 生产 (默认入口, 支持流式)
  async *produceStream(
    currentSkill: string,
    instruction: string,
    recentOps: OperationContext[],
    mode: 'production' | 'exploration' = 'production'
  ): AsyncGenerator<string, ProductionResult>

  // Phase A: 分析 (按需)
  async analyze(currentSkill: string, instruction: string): Promise<ChangePlan>

  // Phase C: 验证 (纯本地)
  validate(skillContent: string, skillDir?: string): DiagnosticResult[]

  // Phase C+: 轻量触发测试 (异步, 用小模型)
  async triggerTest(description: string, keywords: string[]): Promise<TriggerTestResult>

  // 创建: 快速模式
  async quickCreate(description: string): Promise<ProductionResult>

  // 创建: 引导模式 (4-round)
  async interviewRound(round: number, context: InterviewContext): Promise<InterviewResponse>
  async finalizeCreation(context: InterviewContext): Promise<ProductionResult>

  // 自改进: 分析执行日志
  async analyzeForImprovement(
    skillContent: string,
    executionLog: ExecutionLogEntry[]
  ): Promise<ImprovementSuggestion | null>

  // 内部: LLM 调用 (不走 ReAct 循环, 支持流式和非流式)
  private async callLLM(messages: Message[], temperature: number): Promise<string>
  private async *callLLMStream(messages: Message[], temperature: number): AsyncGenerator<string>
  private parseDelimited(response: string, startTag: string, endTag: string): string
}

interface ProductionResult {
  updatedSkill: string      // 完整 SKILL.md 内容
  changeSummary: string     // 变更说明
  promptVersion: string     // 使用的 prompt 版本号
}

interface TriggerTestResult {
  wouldTrigger: string[]    // 会触发的示例 prompt
  wouldNotTrigger: string[] // 不会触发的示例 prompt
}
```

**关键**: `callLLM()` 直接调用 `llmService.ts` 的底层 API，绕过 `LocalClawService` 的 ReAct 循环。temperature 根据场景传入 (生产=0, 探索=0.4)。

### 5.2 前端组件结构

```
src/components/houses/skillsHouse/
├── SkillsHouseView.tsx          (改造: 增加浏览/开发模式切换)
├── ide/                          (新增)
│   ├── SkillIDE.tsx             (IDE 主容器, 三栏布局)
│   ├── SkillExplorer.tsx        (左面板: 技能列表 + 文件树)
│   ├── SkillWorkspace.tsx       (中间: 多 Tab 工作区)
│   ├── SkillPreviewTab.tsx      (Preview tab)
│   ├── SkillSourceTab.tsx       (Source tab)
│   ├── SkillTestRunner.tsx      (Test tab)
│   ├── SkillProducer.tsx        (右面板: AI 生产面板)
│   ├── SkillDiffView.tsx        (Diff 展示组件)
│   ├── SkillVersionTimeline.tsx (版本快照时间线)
│   ├── SkillDiagnosticsBar.tsx  (底部诊断条 = Phase C 可视化)
│   └── SkillLLMSelector.tsx     (LLM 配置选择器)
├── SkillsSidebar.tsx            (保留, 浏览模式用)
├── SkillsGridView.tsx           (保留, 浏览模式用)
├── SkillGridCard.tsx            (保留, 浏览模式用)
├── SkillsInspectorPanel.tsx     (保留, 浏览模式用)
└── SkillsMindMapView.tsx        (保留, 浏览模式用)
```

### 5.3 状态管理

新增 `src/store/slices/skillIDESlice.ts`:

```typescript
interface SkillIDEState {
  // 模式
  ideMode: 'browse' | 'develop'

  // 当前编辑
  activeSkillName: string | null
  activeTab: 'preview' | 'source' | 'test'
  skillContent: string | null
  skillContentDirty: boolean
  skillFileTree: FileTreeNode[]

  // 生产管线状态
  pipeline: {
    phase: 'idle' | 'producing' | 'analyzing' | 'validating'
    pendingResult: ProductionResult | null  // Phase B 结果, 待用户确认
    changePlan: ChangePlan | null           // Phase A 结果 (按需)
    diagnostics: DiagnosticResult[]         // Phase C 结果
    triggerTest: TriggerTestResult | null   // Phase C+ 触发测试结果
    streamingContent: string | null         // 流式输出的中间内容
  }

  // 近期操作上下文 (不是聊天历史, 而是操作摘要)
  recentOperations: OperationContext[]  // 最多保留 5 条, 切换技能时清空

  // 版本快照
  snapshots: SkillSnapshot[]
  selectedSnapshotId: string | null

  // 测试
  testPrompt: string
  testResult: TestResult | null
  testRunning: boolean

  // LLM 配置
  llmConfig: SkillProducerLLMConfig

  // 自改进建议队列
  improvementSuggestions: ImprovementSuggestion[]
}

interface OperationContext {
  instruction: string     // 用户的修改指令
  changeSummary: string   // AI 的变更说明
  timestamp: number
}

interface SkillSnapshot {
  id: string
  skillName: string
  timestamp: number
  content: string
  label?: string
  source: 'manual' | 'ai'
  producerPromptVersion: string  // 生产时用的 prompt 版本
}
```

### 5.4 快照存储策略

快照如果只存内存，重启就丢了，版本管理的价值大打折扣。

**存储方案**: 本地文件，存放在技能目录下的隐藏文件夹:

```
skills/github-pr-review/
├── SKILL.md
├── .snapshots/              # 快照存储 (gitignore)
│   ├── index.json           # 快照索引 (id, timestamp, label, source, promptVersion)
│   ├── snap_001.md          # 快照内容
│   ├── snap_002.md
│   └── ...
```

**清理策略**:
- 每个技能最多保留 **50 个快照**
- 超过 50 个时，按策略删除: 保留最近 20 个 + 每天保留 1 个最新的 (其余删除)
- 手动标记为 "重要" 的快照永不自动删除
- `.snapshots/` 加入 `.gitignore` (git 管理用正式 commit，不用快照)

**后端实现**: 快照 CRUD 在 `duncrew-server.py` 中实现，前端不直接操作文件系统。

### 5.5 并发访问保护

用户在 IDE 中编辑技能的同时，主 Agent 可能正在读取同一个 SKILL.md。

**保护策略**:
1. **原子写入**: 保存时先写临时文件 (`SKILL.md.tmp`)，写入成功后 rename 覆盖原文件。避免主 Agent 读到半写入状态
2. **编辑锁标记**: IDE 编辑期间在内存中标记该技能为 "editing"。主 Agent 如果需要触发该技能，使用最后一次成功保存的版本 (不是编辑中的草稿)
3. **不做文件锁**: 不阻止主 Agent 读取 SKILL.md，只确保写入是原子的

```python
# duncrew-server.py 中的原子写入
def save_skill_content(skill_name: str, content: str):
    skill_path = os.path.join(SKILLS_DIR, skill_name, 'SKILL.md')
    tmp_path = skill_path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        f.write(content)
    os.replace(tmp_path, skill_path)  # 原子操作
```

### 5.6 后端 API

| Endpoint | Method | 功能 | Phase |
|----------|--------|------|-------|
| `/skills/{name}/content` | GET | 读取 SKILL.md 原文 | 1 |
| `/skills/{name}/content` | POST | 原子保存 SKILL.md | 1 |
| `/skills/{name}/tree` | GET | 获取技能目录文件树 | 1 |
| `/skills/{name}/validate` | POST | 本地验证 (Phase C1) | 1 |
| `/skills/{name}/snapshots` | GET/POST | 快照 CRUD | 1 |
| `/skills/{name}/snapshot/{id}` | GET | 获取特定快照 | 1 |
| `/skills/{name}/test` | POST | 完整沙箱测试 | 2 |
| `/skills/{name}/file` | GET/POST | 子文件读写 | 3 |

注意: Phase A/B 的 LLM 调用由前端 `SkillProductionService` 直接发起 (走 llmService)，不经过后端中转。后端只负责文件 I/O、验证和快照管理。

---

## 6. 分阶段实施

### Phase 1 — 生产管线 + 基础 UI + 轻量验证

**核心目标**: LLM 生产管线跑通，能编辑现有技能，有基本质量保障。

- [ ] `SkillProductionService.ts` — 核心服务 (produce 流式 + validate + triggerTest)
- [ ] `SKILL_PRODUCER_PROMPT v1.0` — 生产者系统提示词 (带版本号)
- [ ] `SkillIDE.tsx` — 三栏布局框架
- [ ] `SkillExplorer.tsx` — 技能列表 + 文件树
- [ ] `SkillPreviewTab.tsx` + `SkillSourceTab.tsx` — 预览和编辑
- [ ] `SkillProducer.tsx` — AI 生产面板 (指令输入 + 流式 Diff + 接受/拒绝 + 近期操作上下文)
- [ ] `SkillDiffView.tsx` — 增量渲染 Diff 可视化
- [ ] `SkillDiagnosticsBar.tsx` — Phase C 静态验证 + 轻量触发测试
- [ ] `skillIDESlice.ts` — 状态管理
- [ ] 后端: content (原子写入) / tree / validate / snapshots API
- [ ] 后端: `.snapshots/` 快照存储 + 清理策略
- [ ] `SkillsHouseView.tsx` — 浏览/开发模式切换 (含切换交互)

### Phase 2 — 创建 + 完整测试

- [ ] 快速创建模式 (一次性描述 → 生成)
- [ ] 引导创建模式 (4-round 访谈，可中断)
- [ ] `SkillTestRunner.tsx` — 完整沙箱测试 (5-step)
- [ ] `SkillVersionTimeline.tsx` — 版本快照时间线 UI
- [ ] 后端: test API

### Phase 3 — 自改进 + 高级功能

- [ ] 自改进检测模块 (4 种触发信号 + 频率控制)
- [ ] `SkillLLMSelector.tsx` — LLM 覆盖配置 + 探索模式切换
- [ ] Phase A 按需分析 (解释修改逻辑)
- [ ] 子文件编辑 (scripts/, references/)
- [ ] 一键 Git commit

---

## 7. 设计参考

### 7.1 Claude Code 技能系统 (D:\编程\src\src)

从 Claude Code 的**技能生产管线** (而非 UI) 中提取了关键模式:

| 源文件 | 提取的模式 | 在 Skills IDE 中的对应 |
|--------|-----------|----------------------|
| `skills/bundled/skillify.ts` | 4-round 结构化访谈, session 上下文注入, 每步成功标准注解 | 3.4 结构化创建流程 |
| `utils/hooks/skillImprovement.ts` | side-channel LLM, temperature:0, 结构化 XML 输出, 分离分析和应用阶段 | 3.5 自改进机制, 3.2 输出格式 |
| `skills/loadSkillsDir.ts` | frontmatter 解析, token 估算, Progressive Disclosure 加载 | Phase C 验证, Explorer 加载 |
| `utils/skills/skillChangeDetector.ts` | 文件监听, debounced 热重载 | 编辑后实时更新 Preview |

### 7.2 DunCrew 设计系统

遵循现有设计语言:
- **色板**: Stone 基调 + Cyan/Amber/Emerald/Violet 强调色
- **字体**: Alibaba PuHuiTi 3, 技术内容用 font-mono
- **圆角**: rounded-xl (一般), rounded-2xl (面板)
- **动画**: DD-OS 缓动 [0.23, 1, 0.32, 1], Framer Motion spring
- **Glassmorphism**: bg-white/95 backdrop-blur-3xl

---

## 8. 关键风险与应对

| 风险 | 影响 | 应对 | 用户恢复路径 |
|------|------|------|-------------|
| 定界符解析失败 | 管线中断 | 自动重试 1 次 | 仍失败 → 展示原始 LLM 输出 + [手动编辑]，用户可提取有用内容 |
| temperature:0 限制探索性 | 用户想要不同写法但输出雷同 | 区分生产/探索模式 | [再试一次] + [切换探索模式] (temperature=0.4) |
| 大 SKILL.md 超过 maxTokens | 输出截断 | Phase C 检测 `===SKILL_END===` 缺失 | 提示 "文件过大" + [拆分建议] + Source tab 手动修复 |
| 自改进误判 | 无效建议堆积 | 4 种具体触发信号 + 频率控制 | 用户审核 + 一键清空队列 |
| 完整沙箱测试复杂 | 后端成本高 | Phase 1 用轻量触发测试 | 触发测试直观展示 "会/不会触发" 示例 |
| 并发读写 SKILL.md | Agent 读到半写入状态 | 原子写入 (tmp + rename) | 不需要用户干预 |
| 快照堆积占空间 | 磁盘占用增长 | 每技能上限 50 + 自动清理 | 手动删除 + 标记 "重要" 防清理 |
| Prompt 迭代后基线变化 | 回退快照后行为不一致 | 快照记录 prompt 版本号 | 回退时提示 prompt 版本差异 |
| LLM 调用超时 | 生产中断 | 超时提示 | [重试] / [切换模型] / Source tab 手动编辑 |
| 流式 Diff 增量渲染 | 实现复杂度高 | 需要 Diff 组件支持增量 | fallback 到等待完成后一次性展示 |

---

## 9. Review 反馈整合记录

v3 版本整合了以下 review 反馈 (共 16 条):

**交互优化 (6 条)**:
1. Phase A 默认跳过，直接出 Diff → 已整合到 3.1, 3.3, 4.3
2. 4-round 访谈增加快速模式 → 已整合到 3.4
3. 保留近期 3-5 次操作上下文 → 已整合到 3.3 (OperationContext), 4.3, 5.3
4. temperature 区分生产/探索模式 → 已整合到 3.6, 3.7
5. description 质量验证用 LLM 触发测试替代字符数检查 → 已整合到 3.3 Phase C+
6. Phase 1 加入轻量触发测试 → 已整合到 3.3 Phase C+, 4.5, 6

**架构补全 (5 条)**:
7. SKILL_PRODUCER_PROMPT 版本管理 → 已整合到 3.2, 3.8
8. 明确目标用户画像 → 已整合到 1.4
9. 错误恢复路径设计 → 已整合到 4.4, 8 (风险表增加恢复路径列)
10. 浏览/开发模式切换细节 → 已整合到 4.2
11. 自改进触发条件具体化 → 已整合到 3.5 (4 种信号 + 频率控制)

**落地细节 (5 条)**:
12. 流式输出解决延迟体验 → 已整合到 3.3 Phase B, 3.7, 5.1
13. XML 替换为定界符 (===SKILL_START===) → 已整合到 3.1, 3.2, 3.3, 3.7
14. 大文件截断处理策略 → 已整合到 3.3 Phase B
15. 快照存储策略 (本地文件 + 清理) → 已整合到 5.4
16. 并发访问保护 (原子写入) → 已整合到 5.5
