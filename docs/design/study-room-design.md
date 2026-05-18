# 自习室 (Study Room) 设计方案

> 图书馆页面新增 Tab: 从知识仓储到文档生产线
>
> 讨论日期: 2026-04-23
> 状态: v2.0 理性版定稿, 待实现
> 版本历史:
>   - v1.0 (2026-04-23 上午): 四环并行完整版, Pipeline 与 WriterChat 并存
>   - v1.1 (2026-04-23 中午): 增补 Dun 知识接入 (§11) 与知识回流 (§12)
>   - **v2.0 (2026-04-23 下午): 架构收敛** — 以 WriterChat 为唯一主控, Pipeline 四环降级为后台原语; MVP 状态机简化为 3 态; F 镜头从路线中移除 (改为纯文本粘贴板); SQLite 拆表; 新增中断恢复 / 错误降级 / 用户行为遥测 / Skills @mention 主动召唤等关键机制
> 作者: 伐檀

---

## 1. 背景与问题

### 1.1 当前图书馆的问题

当前图书馆 (`LibraryHouse`) 本质上是一个**只读的知识仓储**:

- `LibraryHome` — 搜索框 + 最近更新 + 分类浏览 + 健康告警, 信息密度高但**只能看**
- `LibraryContent` (WSJ Style) — 实体详情页, 展示 claims 和 relations, 漂亮但不产出新东西
- `LibrarianPanel` — 已有一个"审计"入口, 但只做知识库自身的健康维护, 不面向**下游写作消费**

用户拥有 1294 个实体、6235 条断言、1330 条关联, 这些知识在 DunCrew 里**只被 Agent 在任务执行时隐式消费**, 但当用户自己想写一篇深度文档时:

- 要手动搜索多个实体, 拼凑片段
- 要跳出图书馆去翻记忆库 (exec_trace / gene / diary)
- 要另开 AI 聊天窗, 贴进去一大堆上下文
- Skills 系统里那些专门为"写作"准备的技能 (如 `zr-style-rewriter`) 完全不会被 AI 聊天自动识别

**图书馆是输入, 聊天是黑箱, 产出是碎片。** 没有一个地方把**图书馆资料 + 各种记忆 + 网络资料 + skills** 作为**一等公民**整合进**写作这一个动作**里。

### 1.2 为什么要独立于主 Agent

主 Agent (`LocalClawService`) 的 ReAct 循环是**通用任务执行器**, 特点是:

- 工具驱动 (查文件、执行命令、MCP 调用) 的多轮对话
- 上下文是**动态拼装**的 (JIT context), 按需加载
- 输出是自然语言 + 工具调用, **没有稳定的文档形态**
- 写作过程和任务过程混杂, 产出的 Markdown 夹在 AIChat 面板里不易导出

**写作是一种特殊形态的任务**, 它不是"工具调用循环"而是"章节推演"。它需要:

- **同时**激活四种知识源 (图书馆/记忆/网络/Skills), 而不是一次只能查一种
- **议程**（大纲）在中途可演化, 不是一次规划到死
- **段落级状态机** — 草稿、已核实、被质疑、已精修, 每段独立推进
- 引用**可回溯**到源头 (实体 ID / 记忆 ID / URL), 而不是糊成一团
- 产出**独立归档到 `documents/`**, 而不是塞在聊天历史里

所以自习室不是聊天加个新皮肤, 它需要一条**独立的写作管线 (Writing Pipeline)**, 有自己的状态机、自己的提示词、自己的检索层、自己的产出归档路径。

### 1.3 目标

把图书馆 tab 从**单层知识仓储**改造为**双模式**:

- **图书馆模式** (保留不变) — 浏览、检索、审计知识库
- **自习室模式** (新增) — 基于知识库写长文档

自习室的核心价值:

1. **四源合一**: 图书馆实体、双层记忆、网络资料、Skills 指令集, 在一次会话中并行采集
2. **议程驱动**: 先由 LLM 生成可编辑的**写作议程** (Outline with Evidence Pockets), 再分段推进
3. **段级状态机**: 每段有独立状态 (`planned` / `drafting` / `grounded` / `contested` / `polished`), 可单段重写
4. **Skills 即"文体模板"**: 加载匹配的 skills 作为文体/格式/体裁指引 (如政务写作、评测报告)
5. **引用可回溯**: 段落内嵌脚注指针, 点击跳转源头

### 1.4 目标用户画像

| 用户类型 | 特征 | 自习室策略 |
|---------|------|----------|
| **知识工作者** (主要) | 已在图书馆沉淀大量实体, 需要把它们转化为对外产出 (报告、信件、公文) | 默认议程驱动 + Skills 托底, 主动推送相关实体 |
| **研究者** (次要) | 有明确主题, 需要深度融合网络资料和历史记忆 | 强调 Telescope 面板的并行召回、脚注追溯 |
| **偶发写作** (次要) | 临时要写一段话, 不想走完整流水线 | 提供 "快写 (Quick Draft)" 模式, 跳过议程直接出段 |

**设计原则**: 专家优化, 偶发友好。默认走对话式协同, 但提供 `Quick Draft` 逃生通道。

### 1.5 与 Skills IDE 的关系 (v2.0 新增)

自习室和技师培训班 IDE 共享的交互直觉是"对话驱动 + 流式渲染 + session 持久化", 但**不共享**三段定界符范式。

| 维度 | Skills IDE (技师培训班) | 自习室 (Study Room) |
|------|------------------------|---------------------|
| 数据形态 | 单文件 SKILL.md 原地修改 | 多段长文档从零到一 |
| 核心动作 | 对话 → InlineDiff → accept/reject | 对话 → 段级重写 → 状态机推进 |
| 定界符 | `<!-- analysis_start -->` 等三段符 | 无, 段落边界由 AgendaDoc 定义 |
| 产出载体 | 覆盖原 SKILL.md | 新建 documents/ 目录 |
| Chat 上下文 | 持续 chat history | **段级隔离**, 每段独立调用 |

**共享的基础设施** (Phase 2 起考虑抽取):
- `@mention` 下拉组件 (`MentionDropdown.tsx` 已存在, 自习室**直接复用**, 详见 §8.7)
- SSE 流式渲染管道 (Skills IDE 的 `skillChat` 管道)
- Session 持久化模式 (参考 `skillConversations` 的 slice 结构)

**不共享的部分**:
- 三段定界符 prompt 结构
- 单文件 Diff 流和 accept/reject 模型
- `SkillPreviewPanel` 的 Before/After 对比视图

Phase 1 **不强制**做基础设施抽取 (避免被 Skills IDE 正在演化的接口绑架), Phase 2 视情况做一次技术债清理。

---

## 2. 设计决策

经过权衡, 确定以下关键决策:

| 决策点 | 选择 | 理由 |
|--------|------|------|
| **入口位置** | 图书馆页面顶部 Tab 切换 | 保持"知识-写作"的认知临近性, 与技工学院的 "神经元/技工学院/技师培训班" 三 Tab 同构, 避免新开一个房间 |
| **控制流模型** | **WriterChat 为唯一主控**, 四环 (Intake/Telescope/Agenda/Compose) 降级为对话触发的后台原语 (v2.0 修正) | v1.0 的 "Pipeline + WriterChat 并存" 造成架构张力 — 新开发者不清楚谁主导; 收敛为单一入口后, 所有用户动作都通过 Intent 调度原语, 心智模型一致 |
| **写作单位** | 段落 (Paragraph) 级状态机, **MVP 简化为 3 态** (planned / drafting / done), 完整 6 态推迟到 Phase 2+ | 文档级原子性粒度太粗, 行级太细; 段落是作者真正迭代的单位。6 态 × stale 叠加 = 12 组合, MVP 扛不住分支复杂度, 用户手动判断质量比自动化验证更可靠 |
| **检索时机** | 议程生成时**预检索**占位, 草起时按需**再检索** | 一次全量检索会污染上下文, 按段再检索能精准但有延迟感 — 折中为 "预占位 + 按需补充" |
| **Skills 消费方式** | **双模**: (1) 被动注入 system prompt 作为"文体约束"; (2) 用户 `@skillName` 主动召唤执行 (v2.0 新增, 复用 `MentionDropdown.tsx`) | 写作既需要常态化的文体约束 (如"政务写作"全程生效), 也需要按需调用的重型技能 (如"格式化引用标准"仅在精修时触发); 单一模式会错失场景 |
| **Skills 冲突处理** (v2.0 新增) | primary > secondary > reference 三级优先级 + 冲突自动检测 (tone/structure 互斥表) + 冲突时提示用户保留一个 | 多 Skills 约束矛盾是真实场景 (政务+评测), 必须显式规约优先级, 否则 LLM 会自行折中产生四不像 |
| **记忆接入** | 只读检索 + 产出可写回为 `l1_memory` | 写作过程不污染其他记忆源, 但产出的成品段落可沉淀为偏好 |
| **网络资料** | 走主 Agent 后端的 `webSearch` 工具, 失败兜底 `onlineSearchService` | 统一网络出口, 避免新增 CORS/密钥管理 |
| **LLM 通道** | **Phase 1 直接复用 `chatBackground / streamChat`**, 不做温度曲线 (v2.0 修正); Phase 2 补 `LLMConfig.temperature` per-call override 能力后再上温度分层 | 经查 `llmService.ts`: `streamChat` 签名无 temperature 参数, 全仓仅 `soulGenerator.ts` 一处 `as any` 硬塞温度; Phase 1 假设此能力存在是不可行的, 先跑通主路径, Phase 2 再补底层 |
| **产出归档** | `DunCrew-Data/documents/{sessionId}/` 下存 `session.json / evidence.json / draft.md`, SQLite 仅存元数据索引 (v2.0 修正) | v1.0 的 `payload_json` 大字段塞 SQLite 会导致库膨胀、无法按字段查、每次全量反序列化; 拆为"元数据表 + 独立 JSON 文件"参照 Nexus experience 结构 |
| **会话持久化** | SQLite `study_sessions` 表 (仅元数据) + WAL 模式 + 写队列串行化 + 段级乐观锁 `revision` (v2.0 补强) | 段级并发可能多段同时回写, 必须开 WAL 并序列化写队列避免锁竞争; `revision` 防止中途被 abort 的段覆盖新草稿 |
| **人机交互模型** | **对话式协同写作** (WriterChat 唯一主控) + **信任模式** (confidence ≥ 0.85 时直接执行, 3s 可撤销浮条) (v2.0 补强) | 议程与段落都是**持续可被对话改动的对象**, 而不是一次生成就冻结; 高频编辑场景下每次都弹 Intent Card 确认会严重拖慢节奏, 信任模式让高置信操作直接执行, 保留 Undo 通道 || **段落渲染** | 段内**原地实时流式 + 差异高亮** (Live Paragraph Rendering) | 改写某段时, 段落内容**原地**被替换, 新增字用 token-by-token 流式, 改动区域用淡黄底色闪烁, 未改区域保持稳定 — 写作者必须看到"笔是在哪里动的" |
| **本地文档读取** | **MVP 仅支持 `.txt/.md` 拖入 + 文本粘贴板** (v2.0 降级); 完整 F 镜头 (PDF/DOCX/XLSX/PPTX/OCR) 作为**独立基础设施项目**, 不进自习室三期路线 | 18+ 格式解析依赖 pymupdf/python-docx/openpyxl/pytesseract 等后端能力, 当前 `server/handlers/parsers.py` 尚未落地, 是独立工程任务; 强行绑到自习室路线会拖垮主交付。§10 降级为"简易证据粘贴板 (Evidence Scratchpad)" |
| **Dun 知识接入** | **仅消费 Dun 对应的图书馆 Wiki 实体** (通过 `WikiEntity.dunId` 过滤), 不引入 stats/xp/artifacts | Dun 的真正"写作可用知识"已经沉淀在图书馆里 (dun_xp 信噪比低, stats 是性能数据), 自习室只需通过 L 镜头 + 当前 Dun 的 dunId 过滤即可拿到精华 |
| **知识回流** | 采纳/导出时跑一次 LLM 按 `WikiIngestAction` JSON 结构产出, 调 `POST /api/wiki/ingest` 入库 | 复用 `knowledgeIngestService.ts` 的既有 `INGEST_PROMPT` v2 格式 (Entity/Claim/Evidence), 与主 Agent 的知识摄入管线同构, 不重复造轮子; 文章是最高质量的结构化认知, 必须反哺图书馆 |
| **中断与恢复** (v2.0 新增) | 每次 LLM 调用绑定 `AbortController` 存入 `sessionState.abortMap`; 切段/改方向 = abort 当前 + 重定向; 断网后从最后一个非 `drafting` 段继续 | 长文档写作必然遇到用户中途改主意、网络闪断、段级并发取消等场景, 没有取消机制会让 UI 卡死或产生僵尸调用 |
| **错误降级** (v2.0 新增) | 统一 `WritingError` 类型 + 分级降级策略: LLM 失败保留最后成功段; JSON 解析失败重试 1 次后降级纯文本占位 (**不做**正则抽取这种不可靠兜底); 归档失败自动复制到剪贴板 + localStorage 双兜底 | 保证"用户已经看到的草稿永不丢失"; v1.0 的 happy path 假设在任何真实错误场景都站不住脚 |
| **用户行为遥测** (v2.0 新增) | Telemetry 增加 `userActions: Array<{action, sectionId, ts}>`, 捕获 rewrite / polish / lock / edit 频次, Phase 1 只记录不分析 | 用户对某段重写几次、精修后是 accept 还是再改, 是比 LLM token 更有价值的质量信号, Phase 3 可据此自适应调参 |
| **实现路线** | **v2.0 重划分**: Phase 1 对话骨架 → Phase 2a 对话式编辑 → Phase 2b 状态机完整 → Phase 3 知识回流 | Phase 2 在 v1.1 被迫膨胀, v2.0 拆成 2a/2b 独立上线; F 镜头从路线移除 |

---

## 3. 核心: 对话驱动的写作原语 (Writing Primitives)

> **这是自习室的第一等价值**。v2.0 核心架构决策: **WriterChat 是唯一主控**, 所有用户动作都通过 `WriterIntent` 调度以下四类**后台原语** (Primitives)。UI 是主控的窗口, 原语是引擎。
>
> v1.0 曾设计 "四环流水线" 作为独立于对话的主管线, 但与 WriterChat 并存造成了架构张力 (Pipeline 假设确定性推进, WriterChat 假设开放式对话, 两者互相矛盾)。v2.0 收敛为**单一入口**: 用户只通过对话/快捷键触发 Intent, Intent 调度原语, 原语产出状态变更。
>
> 本方案**刻意不采用** Skills IDE 的三段定界符范式 (见 §1.5), 但**复用** Skills IDE 已验证的交互基础设施 (`MentionDropdown.tsx` / SSE 流式管道 / session 持久化模式)。

### 3.1 控制流模型 (Control Flow)

```
                    ┌──── 用户 ────┐
                    │ (自然语言)   │
                    └──────┬───────┘
                           ↓
              ┌────────────────────────┐
              │   WriterChat (主控)     │
              │ ─ 对话输入 + @mention   │
              │ ─ 快捷键 (Cmd+Enter 等) │
              │ ─ 段卡片操作 (重写/锁定) │
              └────────────┬───────────┘
                           ↓
              ┌────────────────────────┐
              │  Intent Dispatcher     │
              │  (LLM 小模型分类, 见§8) │
              └────────────┬───────────┘
                           ↓
           ┌───────────────┴────────────────┐
           │        WriterIntent            │
           │ (15 种结构化动作, 见§8.3)       │
           └───────────────┬────────────────┘
                           ↓
       ┌───────────────────┼───────────────────┐
       ↓                   ↓                   ↓
  ┌──────────┐       ┌──────────┐        ┌──────────┐
  │ 原语 P1  │       │ 原语 P2  │        │ 原语 P3  │    P4: Contribute
  │ Intake   │       │ Telescope│        │ Agenda   │    (导出时单次触发,
  │ (入舱)   │       │ (采集)   │        │ (议程)   │     见 §12)
  └────┬─────┘       └────┬─────┘        └────┬─────┘
       ↓                  ↓                   ↓
       └──────────────────┴───────────────────┘
                          ↓
              ┌────────────────────────┐
              │   原语 P4: Compose     │
              │  (段级草起/重写/精修)   │
              └────────────┬───────────┘
                           ↓
              ┌────────────────────────┐
              │   WritingState 变更     │
              │   (段状态 + 引用池)     │
              └────────────┬───────────┘
                           ↓
              流式渲染回 Composer (见 §9)
```

### 3.1.1 四类后台原语 (Writing Primitives)

| 原语 | 触发条件 | 职责 | 是否走 LLM |
|------|----------|------|------------|
| **P1: Intake** | 新建 session 时 (一次) | 把用户意图固化为 `WritingBrief` (体裁/字数/tone/受众); 加载候选 Skills | 否 (本地规则 + 关键词匹配) |
| **P2: Telescope** | 新建 session / 用户要求"补证据" / 议程新增 section | 并行发起多路检索, 合流为 `EvidencePool` | 部分路径走 LLM (查询改写) |
| **P3: Agenda** | 用户要求"生成/调整议程" | 基于 brief + pool 产出 `AgendaDoc` (section 列表 + 每节证据分配) | 是 |
| **P4: Compose** | 用户要求"写/重写/精修某段" | 针对目标 section 独立 LLM 调用, 产出/更新 draft | 是 (每段独立一次) |

**关键约束**:
- 所有原语都是**可被 Intent 多次重入调用**的幂等操作, 不是一次性流水线
- 原语之间**不共享 chat history** (段与段独立, 避免上下文污染), 但共享 `EvidencePool` 和 `AgendaDoc`
- 原语执行统一受 §3.11 的 **AbortController + WritingError 降级**保护

### 3.1.2 与主 Agent 的区别

| 维度 | 主 Agent (LocalClawService) | 自习室 (Study Room) |
|------|---------------------------|--------------------|
| 目的 | 通用任务执行 | 专精长文档生产 |
| System prompt | `SYSTEM_PROMPT_FC` (通用) | 分原语: `INTENT_DISPATCHER_PROMPT` / `AGENDA_PROMPT` / `COMPOSE_PROMPT` |
| 调用模式 | ReAct 多轮循环 + 工具调用 | 对话驱动的原语调用, **每段独立一次**生成 |
| 温度 | 默认 (模型决定) | Phase 1 也用默认 (`streamChat` 尚未支持 per-call temperature, 见 §3.7); Phase 2 补齐底层后再做温度分层 |
| 工具访问 | 完整工具注册表 | **无 FC 工具**, 纯文本生产 + 外部注入的 Evidence + `@skill` 主动召唤 (见 §8.9) |
| 上下文 | 聊天历史 + 工具结果 | AgendaDoc 摘要 + 当前段 EvidencePocket + 邻接段末 3 句 (滑动窗口, 防累积膨胀) |
| 产出载体 | AI Chat 消息 | `DocumentDraft` 结构 + `documents/{sessionId}/document.md` 归档 |
| 失败处理 | Reflexion + 重试 | §3.11 `WritingError` 分级降级 |

### 3.2 原语 P1: Intake (意图入舱)

**职责**: 把用户的自然语言诉求固化成**写作契约** (WritingBrief), 并加载候选 Skills。**本原语纯本地运算, 不调 LLM**, 响应时间 <50ms。

**输入**:
- 用户一句话意图 (如 "写一份关于 2023 年 12 月中小企业经营信心指数的深度分析")
- 可选: 用户预选的 Skills (下拉多选或对话中 `@skillName`, 见 §8.9)
- 可选: 用户预选的图书馆实体 (从侧边栏"钉住")
- 可选: 关联的 Dun (下拉, 详见 §11)

**输出**: `WritingBrief`

```typescript
interface WritingBrief {
  id: string
  intent: string              // 用户原话
  genre: GenreHint            // 本地规则推断的体裁 (report | essay | letter | memo | tutorial | novel | custom)
  length: LengthHint          // short (<800) | medium (800-3000) | long (3000-8000) | xlong (>8000)
  tone: ToneHint[]            // formal | analytical | narrative | critical | warm | ...
  audience: string            // 本地规则推断的受众 (默认 "通用读者", 可被对话修订)
  constraints: string[]       // 用户显式约束 ("不用形容词" / "引用要带年份" / ...)
  skills: SkillRef[]          // 命中的 skills (auto + user-picked + @mention)
  pinnedEntityIds: string[]   // 用户从图书馆钉住的实体
  dunId?: string | null       // 关联的 Dun (影响 L 镜头加权, 见 §11)
  createdAt: number
}

interface SkillRef {
  name: string
  source: 'auto' | 'user' | 'mention'  // 自动匹配 / UI 多选 / 对话 @mention
  priority: 'primary' | 'secondary' | 'reference'
  // priority 决定约束冲突时的保留顺序, 详见 §3.2.2
}
```

**体裁/字数/tone 的本地推断**: 不调 LLM, 用关键词包含规则即可 (如 intent 含"报告/分析/汇报" → genre=report; 含"信/邮件/致" → genre=letter; 含"小说/故事" → genre=novel)。推断错了用户可在 Intake 表单一键切换, 也可以在对话中说"改成 essay"触发 `revise_brief` Intent (见 §8.3)。

#### 3.2.1 Skill 匹配算法: 轻量关键词包含 (v2.0 修正)

> v1.0 曾设计用 BM25 做 Skill 匹配, 但**在当前前端技术栈下不可行且不必要**:
> - 项目是纯前端 TypeScript, **没有 jieba** 等中文分词库
> - 字符 2-gram 对中文噪音严重 (如"中小企业经营信心" 2-gram 会产生"中小/小企/企业/业经/经营/营信/信心", 其中"业经""营信"是噪音)
> - 当前 skill 数量规模只有 10-20 个, BM25 打分区分度不足
>
> v2.0 改用**关键词包含 + 加权求和**, 实现零依赖、毫秒级、对中文稳健。未来 skill 数量 >100 时再考虑引入 embedding 向量匹配。

```typescript
interface ScoredSkill { skill: Skill; score: number }

function matchSkills(intent: string, skills: Skill[]): ScoredSkill[] {
  const normalizedIntent = intent.toLowerCase()
  return skills
    .filter(s => s.enabled !== false)
    .map(skill => {
      let score = 0
      // 规则 A: keywords 字段逐个检查包含, 命中 +3
      for (const kw of skill.keywords || []) {
        if (normalizedIntent.includes(kw.toLowerCase())) score += 3
      }
      // 规则 B: whenToUse 字段的句子作为"场景指示器", 命中任一关键短语 +2
      const whenToUseHints = extractKeyPhrases(skill.whenToUse || '', 5)
      for (const hint of whenToUseHints) {
        if (normalizedIntent.includes(hint)) score += 2
      }
      // 规则 C: description 子串命中 +1
      if (skill.description) {
        const descWords = tokenizeByChar(skill.description, 3)  // 字符 3-gram
        for (const w of descWords) {
          if (normalizedIntent.includes(w)) { score += 1; break }
        }
      }
      // 规则 D: tags 命中 +1.5
      for (const tag of skill.tags || []) {
        if (normalizedIntent.includes(tag.toLowerCase())) score += 1.5
      }
      // 规则 E: 写作类 toolType 加权
      if (skill.toolType === 'writing' || skill.category === 'writing') score *= 1.3
      return { skill, score }
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
}

/** 从 whenToUse 字段抽取前 N 个 2-5 字关键短语, 跳过停用词 */
function extractKeyPhrases(text: string, maxPhrases: number): string[] {
  const STOPWORDS = new Set(['的', '了', '是', '在', '和', '与', '或', '应', '可'])
  // 按标点/空格切片, 保留 2-5 字片段, 过滤停用词
  return text
    .split(/[,，。.;；:：\s]+/)
    .flatMap(seg => {
      const clean = seg.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
      if (clean.length >= 2 && clean.length <= 5 && !STOPWORDS.has(clean)) return [clean]
      return []
    })
    .slice(0, maxPhrases)
}

/** 字符 n-gram (仅用于 description 模糊命中, 不用于 intent 分词) */
function tokenizeByChar(s: string, n: number): string[] {
  const out: string[] = []
  const clean = s.replace(/\s+/g, '')
  for (let i = 0; i <= clean.length - n; i++) out.push(clean.slice(i, i + n))
  return out
}
```

**取 top-3 作为 `auto` 候选**, 用户在 Intake UI 可 ✕ 删除或 ＋ 追加, 或通过对话 `@skillName` 主动加入 (详见 §8.9)。

#### 3.2.2 Skills 冲突解决 (v2.0 新增)

多 Skills 同时加载时约束可能**硬矛盾** (如"政务写作" 要求严谨无修辞 + "评测报告风格" 要求口语化小标题)。v2.0 引入三级优先级 + 冲突矩阵, 避免 LLM 自行折中产生四不像。

**优先级**: `primary` > `secondary` > `reference`

- 默认分配:
  - 用户在 Intake 里勾选的第一个 skill → `primary`
  - 对话中 `@mention` 的 skill → `primary` (显式召唤即最高优先)
  - 自动匹配的 top-1 → 若用户无显式指定则为 `primary`, 否则为 `secondary`
  - 其余 → `reference` (仅作为背景知识, 不强制约束)
- 最多 **1 个 primary + 2 个 secondary + 任意数 reference**, 超出时按得分截断

**冲突矩阵** (硬编码, 检测到冲突时保留 priority 更高的一方, 同级则保留第一个):

| 维度 | 互斥值对 | 触发来源 |
|------|---------|---------|
| `tone` | `formal` vs `casual` | skill.metadata.tone |
| `tone` | `objective` vs `subjective` | skill.metadata.tone |
| `person` | `first-person` vs `third-person-only` | skill.metadata.person |
| `structure` | `numbered-sections` vs `flowing-narrative` | skill.metadata.structure |
| `vocabulary` | `colloquial` vs `technical-only` | skill.metadata.vocabulary |

**检测算法**:

```typescript
interface SkillConflict {
  dimension: string
  aSkill: string
  bSkill: string
  aValue: string
  bValue: string
  resolved: 'keep-a' | 'keep-b'       // 基于 priority
  reason: string
}

function detectSkillConflicts(refs: SkillRef[], skills: Skill[]): SkillConflict[] {
  const conflicts: SkillConflict[] = []
  const EXCLUSIONS: Record<string, [string, string][]> = {
    tone: [['formal', 'casual'], ['objective', 'subjective']],
    person: [['first-person', 'third-person-only']],
    structure: [['numbered-sections', 'flowing-narrative']],
    vocabulary: [['colloquial', 'technical-only']],
  }
  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      const a = skills.find(s => s.name === refs[i].name)
      const b = skills.find(s => s.name === refs[j].name)
      if (!a?.metadata || !b?.metadata) continue
      for (const [dim, pairs] of Object.entries(EXCLUSIONS)) {
        const aVal = (a.metadata as any)[dim]
        const bVal = (b.metadata as any)[dim]
        for (const [x, y] of pairs) {
          if ((aVal === x && bVal === y) || (aVal === y && bVal === x)) {
            conflicts.push({
              dimension: dim,
              aSkill: a.name, bSkill: b.name, aValue: aVal, bValue: bVal,
              resolved: priorityRank(refs[i].priority) >= priorityRank(refs[j].priority)
                ? 'keep-a' : 'keep-b',
              reason: `${dim} 维度互斥, 保留 priority 更高的 skill`,
            })
          }
        }
      }
    }
  }
  return conflicts
}

const PRIORITY_RANK = { primary: 3, secondary: 2, reference: 1 }
const priorityRank = (p: SkillRef['priority']) => PRIORITY_RANK[p]
```

**UI 呈现**: Intake 表单和段卡片的 Skills 徽章右侧显示 ⚠ 角标, 悬浮展示冲突详情, 用户可点"调整优先级"或"移除冲突 skill"。

**注入 Prompt 的行为**: Compose 原语的 user prompt 中, 只有 `primary` 和未冲突的 `secondary` skills 的 `instructions` 被注入为约束; `reference` 类 skills 仅列出名字+ tldr (≤50 字) 作为背景提示。被"冲突淘汰"的 skill 完全不进入 prompt。

### 3.3 原语 P2: Telescope (多路并行采集)

**职责**: 并行发起检索, 合流为 `EvidencePool`。这是自习室区别于普通聊天的关键 — 多路知识源在一次往返内被看见。

**v2.0 路径规划** (根据 Phase 动态启用, 避免空壳代码):

| Phase | 启用镜头 | 数据结构 |
|-------|---------|----------|
| **Phase 1 (MVP)** | L (图书馆) + S (Skills) | 简单 `Array<EvidenceItem>`, 无 `byLens` 分桶、无 MMR、无 score 归一化 |
| **Phase 2a+** | L + S + M (记忆) | 升级为完整 `EvidencePool` 结构 |
| **Phase 2b+** | L + S + M + W (网络) | 加入 `warnings` 和查询改写 |
| **Phase 3+** | 加入文本粘贴板 (`E` lens, 简易版, 见 §10) | — |

> v1.0 曾规划第 5 路 `F (Files)` 镜头 (PDF/DOCX/XLSX/OCR 18+ 格式), v2.0 已将其**移出自习室路线图** (见 §2 决策表)。原因: 18+ 格式解析依赖 pymupdf/python-docx/openpyxl/pytesseract 等后端能力, 是独立工程任务, 不应绑定自习室交付。替代方案是 §10 的"简易证据粘贴板 (E lens, Evidence Scratchpad)", 仅支持 `.txt/.md` 拖入 + 用户粘贴文本片段。

```typescript
async function runTelescope(brief: WritingBrief, phase: PhaseLevel): Promise<EvidencePool> {
  const tasks: Promise<EvidenceItem[]>[] = [lensLibrary(brief), lensSkills(brief)]
  if (phase >= 'phase2a') tasks.push(lensMemory(brief))
  if (phase >= 'phase2b') tasks.push(lensWeb(brief))
  if (phase >= 'phase3')  tasks.push(lensScratchpad(brief))  // E lens, 见 §10
  const settled = await Promise.allSettled(tasks)
  return mergeEvidence(settled)
}
```

#### P2.L: Library Lens (图书馆镜头)

- **接口**: `GET /api/wiki/search?q={query}` (`useLibraryData.ts` 已有)
- **策略**: 发送 2-3 个查询 (原始 intent + LLM 改写的扩展查询), 合并去重
- **产出**: `EvidenceItem[]`, 每条带 `entityId / title / tldr / topClaims / score`
- **Dun 子视角** (**本镜头承担"Dun 知识接入"职责**, 详见 §11): 若 brief 指定了 `dunId` 或从主 Agent 跳转而来带着上下文 `activeDunId`, 对结果进行 `WikiEntity.dunId === activeDunId` 加权 2.0 (不是硬过滤 — 避免错过通用实体)
- **数量上限**: 20 条 (超过会挤掉其他镜头); Dun 子视角命中时额外保留 top-6 的 Dun 专属实体, 不占 20 条配额
- **用户钉住的实体**: 直接进 pool, 不受 top-20 限制, 权重 1.5

#### P2.M: Memory Lens (记忆镜头) — Phase 2a+

- **接口**: `memoryStore.search({ query, sources, useMmr: true, minScore: 0.3 })`
- **源分层** (**已修订, 剔除 `dun_xp`** — 它是"经验积分"不是"可引用知识", 写作不需要):
  - 高优先级 (默认开启): `diary`, `l1_memory`, `gene` — 用户偏好、经验、基因
  - 中优先级 (默认开启): `memory`, `session` — 通用记忆和历史会话
  - 低优先级 (默认关闭, 用户可勾选): `exec_trace` — 执行轨迹, 对写作信噪比低
  - **不接入**: `dun_xp` (性能积分, 非知识) — Dun 的真正知识已通过 L 镜头的 Dun 子视角接入, 见 §11
- **时间衰减**: 已由后端 `memoryStore` 处理 (半衰期 30 天, preference/discovery 90 天)
- **MMR 去冗余**: 启用, 避免同主题记忆挤占 pool
- **数量上限**: 15 条

#### P2.W: Web Lens (网络镜头) — Phase 2b+

- **接口**: 调用 `POST /api/tools/webSearch` (主 Agent 后端的统一出口)
- **失败兜底**: 若 webSearch 工具未配置, 降级到 `onlineSearchService.searchOnlineSkills` — 虽然这只搜 registry, 但至少能召回一些权威的技能文档链接
- **查询改写**: LLM 小模型把 intent 改写为 1-2 个搜索引擎友好的 query (异步, 带 2s 超时, 超时用原始 intent)
- **安全**: 高 `dangerLevel` 域名 (torrent / 下载站) 过滤
- **数量上限**: 8 条
- **可禁用**: brief.intent 包含 "内网 only" / "保密" 时自动跳过

#### P2.S: Skills Lens (技能镜头) — Phase 1 起

- **接口**: 读 `useStore((s) => s.skills)` 的本地状态, 不走网络
- **过滤**:
  - `enabled: true`
  - 使用 §3.2.1 的**关键词包含打分算法**取 `score > 0` 的 skill (非 BM25)
  - 用户在 Intake 钉住 / 对话 `@mention` 的 skills 直接进入 (score +100 保证必入)
- **提取**: 不加载整个 SKILL.md (太大), 只取 `description + whenToUse + instructions` 的前 800 字, 作为**写作约束说明**
- **数量上限**: 5 条 (Skills 是约束不是素材, 多了会打架); 超过上限时按 §3.2.2 冲突解决后截断

#### EvidencePool 数据结构

**v2.0 分阶段定义** — Phase 1 用简化版, Phase 2a+ 升级完整版:

```typescript
// Phase 1 简化版 (空壳代码最少)
interface EvidenceItemMVP {
  id: string              // 唯一 ID (uuid)
  lens: 'L' | 'S'
  title: string
  snippet: string         // 摘要, 不超过 400 字
  ref: EvidenceRef        // 源头可回溯 + 快照 (见下文)
}

type EvidencePoolMVP = EvidenceItemMVP[]  // 简单数组, 无分桶, 无 warnings

// Phase 2a+ 完整版
interface EvidenceItem extends EvidenceItemMVP {
  lens: 'L' | 'M' | 'W' | 'S' | 'E'   // E = 粘贴板 (非 F 镜头)
  score: number                        // 归一化到 0-1
  tags: string[]
}

type EvidenceRef =
  | { kind: 'entity'; entityId: string; claimIds?: string[]; snapshotTldr: string }
  | { kind: 'memory'; memoryId: string; source: MemorySource; snapshotTldr: string }
  | { kind: 'web'; url: string; fetchedAt: number; snapshotTldr: string }
  | { kind: 'skill'; skillName: string; section?: string; snapshotTldr: string }
  | { kind: 'scratch'; scratchId: string; sourceName: string; snapshotTldr: string }

// snapshotTldr (v2.0 新增): 引用创建时的 200 字以内摘要快照。
// 解决"三个月后回看旧文档, 源实体可能已被修改/删除, 引用依据不丢"的问题。
// runtime 就写入, 不等到归档。

interface EvidencePool {
  briefId: string
  items: EvidenceItem[]
  byLens: Record<'L' | 'M' | 'W' | 'S' | 'E', string[]>  // Phase 2a+ 启用
  gatheredAt: number
  warnings: string[]       // Phase 2b+ 启用 (如 "web search 超时 3s, 结果不完整")
}
```

**合流原则**:
- 不做跨镜头去重 — 同一个概念从不同源召回说明重要
- Phase 1: 按"Library 在前, Skills 在后"的固定顺序展示, 无打分
- Phase 2a+: 按 `lens + score desc` 排序, UI 侧提供镜头切换
- EvidencePool 全量持久化 (§3.8 持久化策略), 议程/草起从这里取 (避免二次检索)

### 3.4 原语 P3: Agenda (议程生成与编辑)

**职责**: 把 EvidencePool 编织成可执行的**写作议程** (AgendaDoc), 用户可直接在 UI 里拖拽调整, 也可通过对话 `revise_agenda` Intent 修改 (见 §8.3)。

```typescript
interface AgendaDoc {
  briefId: string
  title: string
  subtitle?: string
  sections: AgendaSection[]
  openingStance?: string       // 全文立意 (一句话)
  closingCall?: string         // 全文收束 (一句话)
  revision: number             // 每次用户编辑 + 1
}

interface AgendaSection {
  id: string
  order: number
  heading: string              // 小标题
  intent: string               // 本节要解决什么 (给 LLM 看)
  targetLength: number         // 目标字数
  evidencePocket: string[]     // 分配给本节的 EvidenceItem.id 列表
  skillHints: string[]         // 适用于本节的 skill name (子集)
  status: SectionStatus
  draft?: string               // P4 Compose 填充 (draft/rewrite/continue/expand/compress)
  polished?: string            // Phase 2b+ polish_section 填充
  footnotes?: Footnote[]       // 脚注索引 (指向 EvidenceItem)
  notes?: string               // 用户对本节的手写备注
}

// v2.0 简化: MVP 仅 3 态
type SectionStatus =
  | 'planned'       // 只有议程条目, 没草稿
  | 'drafting'      // LLM 正在草起 (含流式中)
  | 'done'          // 草稿完成 (用户手动判断质量合格)

// Phase 2+ 扩展态 (不在 MVP 实现)
type SectionStatusExt =
  | SectionStatus
  | 'grounded'      // Ground Check 通过 (Phase 2b+)
  | 'contested'     // Ground Check 失败 (Phase 2b+)
  | 'polished'      // Polish 完成 (Phase 2b+)
  | 'locked'        // 用户显式锁定, 不允许重写 (Phase 3+)
  | 'stale'         // 议程 revision 变化导致过期 (可与其他态叠加; Phase 2a+)
```

**为什么 MVP 只要 3 态**:
- 6 态 × stale 叠加 = 12 组合, 分支 UI 覆盖面太大, MVP 扛不住
- 用户手动判断质量是否合格比自动化验证更可靠且成本为零 — 信任用户, 不搞"自动评级"
- Ground Check / Polish / 锁定 等动作在 MVP 里通过 **Intent 即时触发原语**实现, 不需要持久化状态 (例如"重写本段"就是重回 `drafting`)

**LLM 调用 (Agenda 生成)** — v2.0 使用现有 `streamChat` 接口, 不假设温度支持:

```typescript
import { streamChat } from '@/services/llmService'

async function draftAgenda(
  brief: WritingBrief,
  pool: EvidencePool,
  signal: AbortSignal,                // §3.11 中断机制
): Promise<AgendaDoc> {
  const userPrompt = buildAgendaPrompt(brief, pool)
  const { content } = await streamChat(
    [
      { role: 'system', content: WRITING_CONDUCTOR_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    {
      signal,
      // temperature / responseFormat 在 Phase 1 不可用 (streamChat 未暴露 per-call override)
      // Phase 2 会补齐 LLMConfig.temperature 能力后再接通, 见 §3.7
    },
  )
  return parseAgendaJson(content, brief, pool)   // 解析失败走 §3.11 WritingError 降级
}
```

**JSON 输出的鲁棒性**: Phase 1 由 prompt 强约束 JSON (开头 `{` 结尾 `}`, 禁止围栏), 解析失败走 §3.11 的 `agenda_parse_failed` 降级策略 (重试 1 次, 二次失败降级为"单节占位议程"让用户手改, **不做**基于正则的结构抽取兜底 — 那种兜底不可靠)。Phase 2 补齐 `streamChat` 的 `response_format=json_object` 能力后移除降级路径。

**议程编辑器 (UI)**:

- 每个 section 是可拖拽的卡片
- 卡片上显示: heading、目标字数、evidence 徽章 (L3 M2 W1 S1 = 3 个图书馆、2 个记忆、1 个网页、1 个技能)
- 用户动作:
  - 拖拽重排
  - 修改 heading / intent / targetLength
  - 点击 evidence 徽章弹出抽屉, 勾选/取消证据
  - ＋ 插入新 section (空白, 用户手填 intent, 然后可触发"补充证据"重新采集)
  - 删除 section

**关键机制: 议程漂移 (Agenda Drift)** — Phase 2a+

长文档写到中段经常会发现: 某节需要拆成两节, 或两节合并更顺。允许用户在 Compose 过程中调整议程, 但:

- 已经 `done` 的 section 不能被直接删除 (提示确认)
- 改动议程 `revision + 1`, 原 `done` 段被标记 `stale` (叠加态; Phase 2a+ 启用)
- `stale` 的 draft 在 UI 上半透明显示, 提示"议程已调整, 建议重写"

### 3.5 原语 P4: Compose (段级草起/重写/精修)

**职责**: 针对指定 section 独立 LLM 调用, 产出/更新 `section.draft`。**每段一次独立调用**, 彼此不共享 chat history, 避免上下文膨胀。

**调用触发**: 不再是"遍历议程自动推进"(v1.0 那种 Pipeline 行为已被移除), 而是由 WriterChat 的 Intent 显式触发 (`draft_section / rewrite_section / polish_section` 等, 见 §8.3)。

#### 3.5.1 状态转换 (v2.0 MVP 简化版)

```
            ┌──────────┐
            │ planned  │
            └────┬─────┘
                 │ Intent: draft_section
                 ↓
            ┌──────────┐   AbortController.abort() ┌──────────┐
            │ drafting │───────────────────────→   │ planned  │  (回滚)
            └────┬─────┘                           └──────────┘
                 │ LLM 成功返回
                 ↓
            ┌──────────┐
            │   done   │
            └────┬─────┘
                 │ Intent: rewrite_section
                 ↓
              重回 drafting (保留 history)
```

**Phase 2+ 扩展路径** (不在 MVP 实现, 此处列出供未来参考):
- `done` + Intent `ground_check` → `grounded` 或 `contested`
- `done` + Intent `polish_section` → `polished`
- `done/polished` + Intent `lock_section` → `locked`
- 任意状态 + 议程 revision 变化 → 叠加 `stale`

#### 3.5.2 Draft 子阶段

**输入**:
- 本段 `AgendaSection`
- 本段 `evidencePocket` 引用的 EvidenceItem 全文
- 邻接段摘要 (前一段 polished, 后一段 planned 的 intent, 各 200 字)
- 匹配的 skills 的 `instructions` 片段
- 全文 `openingStance` (立意锚)

**不输入**:
- 聊天历史 (段与段独立)
- 远距离其他段落的全文 (只取邻接, 避免漂移)
- 非本段的 EvidencePool 条目 (杜绝"捞错证据")

**调用参数**:
- `temperature: 0.6` (给生成留空间)
- `maxTokens`: `targetLength * 2` (中文粗估 1.5 字/token, 留冗余)
- 非流式: 段是原子产出, 流式没用户价值, 反而会让 UI 闪烁
- **例外**: 长段 (targetLength > 1500 字) 启用流式, 供用户中断

**产出结构**:

```typescript
interface DraftOutput {
  body: string                      // Markdown 正文
  inlineCitations: InlineCitation[] // 内嵌引用标记的解析结果
  wordCount: number
  producerNotes?: string            // LLM 的自述 (为什么这么写), 折叠展示
}

interface InlineCitation {
  marker: string          // 原文里的 [^L12] / [^M3] 等
  evidenceId: string      // 对应 EvidenceItem.id
  quotedSnippet?: string  // 引用的原文片段
}
```

**内嵌引用语法 (自习室专用)**:

LLM 在正文里用 `[^L12]` / `[^M3]` / `[^W1]` 格式标注引用, 其中字母是镜头, 数字是 EvidenceItem 在 evidencePocket 里的顺序。后处理时转换为真实 footnote。

```markdown
2023 年 12 月中小企业经营信心指数环比上升 0.8 个点[^L12], 这与区内三产恢复
节奏一致[^M3]。但从用工端看, 降幅仍在扩大[^W1], 需关注结构性矛盾。
```

为什么不让 LLM 直接输出真实 entityId/URL: **长 ID 会被 LLM 复制错 / 截断**, 用本地短码可靠得多, 由前端做查表替换。

#### 4.3 Ground Check 子阶段 (轻量验证)

**触发**: 每段 draft 完成后**自动**执行, 不阻塞 UI (后台进行, 有 badge 提示)。

**检查项**:

| 检查 | 方法 | 严重性 |
|------|------|-------|
| 引用解析 | 所有 `[^Lx]` 能映射到真实 EvidenceItem | error |
| 引用精度 | 引用条目的 snippet 与段内上下文的 Jaccard > 0.15 (粗过滤"张冠李戴") | warning |
| 数字幻觉 | 段内出现的数字 / 日期在 evidencePocket 中能找到对应来源 | error |
| 体裁符合度 | 若 brief.genre === 'report', 检查是否出现"我觉得"等主观语 (基于 skills.constraints) | warning |
| 字数偏差 | abs(wordCount - targetLength) / targetLength < 0.4 | info |

**C1 是本地纯算法**, C2 (数字幻觉) 用一次小模型调用, 成本低。

**失败处理**:

- 全部通过 → `grounded`
- 有 warning → `grounded`, 但在 UI 上挂小黄点徽章
- 有 error → `contested`, UI 弹面板提示用户: "AI 引用了 evidencePocket 里不存在的 id, 或数字 '8.4%' 在证据里找不到来源"

#### 4.4 Polish 子阶段 (精修)

**触发**: 用户显式点击 "精修本段" 或 "一键精修全文"。

**输入**:
- `grounded` 的 draft
- 匹配 skills 的 **完整 instructions** (Polish 阶段才加载, Draft 阶段只加载片段)
- 全文已 `polished` 的段落摘要 (让精修器感知整体节奏)
- brief.tone / brief.constraints

**温度**: `0.2` — 精修是"打磨"不是"再创作", 温度低。

**不改变**:
- 引用标记的位置和数量 (精修只能重写句子, 不能捏造/删除引用)
- 段落字数 ±10% 以内 (targetLength 是契约)

**产出**: 覆盖 `section.polished`, 原 `draft` 留存于 `section.history[]` 以备回退。

#### 4.5 邻接感知 (Adjacency Awareness)

纯段级独立会导致**行文不连贯** (段与段间同一概念用不同措辞, 或上下段逻辑脱节)。Draft / Polish 都会注入:

- **前一段**: 最后 3 句原文
- **后一段**: 议程 intent 一句话

这是有意的**弱耦合**: 足够保证连贯, 不足以让 LLM 去改相邻段。

### 3.6 写作 LLM 通道 (WritingLLM)

**v2.0 修正**: v1.0 曾设计"分阶段温度曲线"(agenda=0.3 / draft=0.6 / polish=0.2 / groundCheck=0), 但实际代码调研发现:

- `src/services/llmService.ts` 的 `streamChat` 和 `chatBackground` 接口**不支持 per-call temperature override**
- 全仓仅 `soulGenerator.ts` 一处用 `as any` 硬塞 temperature, 这不是公共能力
- 因此 Phase 1 **不做温度分层**, 直接用默认温度调用 streamChat, 业务正确性与成本可控性都不受影响

**Phase 1 实现**:

```typescript
import { streamChat, chatBackground } from '@/services/llmService'

// Phase 1: 统一用默认温度, 区分只在 maxTokens / 流式与否
interface WritingLLMCallOptions {
  stage: 'agenda' | 'draft' | 'rewrite' | 'dispatch'
  signal: AbortSignal
  maxTokens?: number     // 由 caller 根据 targetLength 计算
  stream?: boolean       // draft/rewrite 为 true (段落实时渲染), agenda/dispatch 为 false
  onDelta?: (chunk: string) => void
}

async function callWritingLLM(
  messages: SimpleChatMessage[],
  options: WritingLLMCallOptions,
): Promise<{ content: string; tokensIn?: number; tokensOut?: number }> {
  if (options.stream) {
    return streamChat(messages, {
      signal: options.signal,
      onDelta: options.onDelta,
      maxTokens: options.maxTokens,
    })
  }
  const content = await chatBackground(messages, {
    signal: options.signal,
    priority: options.stage === 'dispatch' ? 10 : 5,  // dispatch 优先级最高, 用户在等
  })
  return { content: content ?? '' }
}
```

**maxTokens 规则**:
- `agenda`: 固定 4096 (议程 JSON 不会太长)
- `draft`: `max(1024, targetLength * 2)` (中文 1.5 字/token, 留冗余)
- `rewrite`: `currentLength * 1.5` (保证不超过原段过多)
- `dispatch`: 512 (Intent 分类只需返回小 JSON)

**模型覆盖**: 用户可在自习室顶栏下拉"高级"面板设置 `modelOverride` (如用便宜模型跑 dispatch, 用旗舰模型跑 draft), 配置存 `localStorage['duncrew_writing_llm_override']`, 运行时传给 `streamChat({ config: { model } })`。

**Phase 2 升级路径**: 待 `llmService.ts` 补齐 `LLMConfig.temperature` 的 per-call override 能力后, 重新引入温度分层, 并把当前的 `callWritingLLM` 扩展成真正的 `WritingLLM` 类 (持有 temperature curve + metering)。届时无需修改调用方, 只需在 options 上增加 `temperature` 透传。

### 3.7 WRITING_CONDUCTOR_PROMPT (系统提示词, v1.0)

这是整条流水线的灵魂。**每个子阶段有自己的用户 prompt 模板**, 但 system prompt 只有一份 — 统一行为纲领。

```markdown
# WRITING_CONDUCTOR_PROMPT v1.0

你是 DunCrew 自习室的写作指挥者。你不是聊天机器人, 也不是通用 Agent。你的职责是根据
"写作契约 + 证据池 + 议程"的组合, 精准产出高质量的长文档段落。

## 你理解的写作契约 (WritingBrief)

- intent: 用户原话, 不要偏离
- genre: 体裁 (report / essay / letter / memo / tutorial / novel / custom)
- length: 长度档位, 决定节奏密度
- tone: 语气列表, 多个标签取交集
- audience: 受众画像, 决定用词层级
- constraints: 硬约束, 违反即算失败
- skills: 用户加载的 Skills, 每个 skill 的 instructions 是你必须遵循的**文体说明书**

## 你理解的证据池 (EvidencePool)

证据来自多个镜头 (根据 Phase 启用):
- L (Library): 知识库实体和断言, 最权威, 引用优先 — Phase 1 起
- S (Skills): 写作技能文档片段, 是约束不是素材, 禁止直接引用 — Phase 1 起
- M (Memory): 用户历史记忆, 含偏好和经验, 用于个性化表达 — Phase 2a+
- W (Web): 外部网络资料, 要注意时效 — Phase 2b+
- E (Scratchpad): 用户手动粘贴的文本片段 — Phase 3+

每条证据有唯一 id (形如 L12 / M3 / W1 / E2), 你在正文中用 `[^Lxx]` 语法标注引用。

## 你理解的议程 (AgendaDoc)

议程是契约。你被分配了一节 (section), 你只写这一节, 不要擅自写其他节。
你收到邻接段的摘要用于保持连贯, 但不允许修改邻接段, 也不允许把邻接段的内容复制到本节。

## 输出规范 (严格)

### 当你被要求生成议程时
返回 JSON 对象, 严格符合以下 schema:

```json
{
  "title": "string",
  "subtitle": "string?",
  "openingStance": "string (全文立意, 一句话)",
  "closingCall": "string (全文收束, 一句话)",
  "sections": [
    {
      "order": 1,
      "heading": "string",
      "intent": "string (本节要解决的问题, 给后续草起看)",
      "targetLength": 500,
      "evidencePocket": ["L12", "M3"],
      "skillHints": ["skill-name-1"]
    }
  ]
}
```

### 当你被要求草起本节时
返回纯 Markdown 正文, 不加外层围栏, 不加标题 (标题由议程提供), 直接写段落。
引用用 `[^Lxx]` 格式内嵌, 不要在文末列参考文献 (系统自动生成)。

### 当你被要求精修本节时
返回纯 Markdown 正文, 字数与输入相差不超过 10%, 引用标记位置和数量不变。

### 当你被要求做体裁符合度检查时 (Phase 2b+)
返回 JSON 诊断对象:

```json
{
  "genreViolations": ["第 3 句出现了口语 '我觉得'"],
  "toneViolations": []
}
```

> 注: 数字幻觉检测在 v2.0 中已改为**纯算法实现** (见 §7.6), 不再通过 LLM 核查。

## 质量规则 (CRITICAL)

1. **不要幻觉数字**: 段落里出现的任何数字、日期、百分比、金额, 必须能从 evidencePocket 中找到出处。如果证据不足以支撑某个数字, 宁可用"约""部分""个位数增长"等模糊表达, 不要编造。

2. **不要跨段引用**: 你只能引用分配给本节的 evidencePocket 条目。其他 section 的 pocket 对你不可见, 这是系统设计的隔离。

3. **Skills 是约束不是素材**:
   - S 类证据里的 instructions 描述"应该怎么写", 你要遵循
   - 但禁止把 instructions 的句子搬到正文里 (那是元信息, 不是内容)

4. **保持体裁纯度**:
   - report / memo: 客观陈述, 禁止"我"作主语
   - essay: 允许观点句, 但要基于证据
   - letter: 允许第二人称和问候语
   - tutorial: 分步骤, 祈使句为主
   - novel: 允许虚构但要基于用户 intent, 不抽象说理

5. **字数契约**: targetLength 是契约, 不是建议。±10% 以内合格, 超出要被判定为失败。

6. **邻接连贯**: 开头不要重复前一段的最后一句话, 结尾不要剧透后一段的内容。

## 你不做的事

- 不调用工具, 不访问文件系统, 不执行代码
- 不问澄清问题 (系统不提供多轮对话通道, 你必须基于现有输入一次产出)
- 不输出元评论 ("以下是我的草稿" 之类)
- 不在正文里添加水印、签名、日期等模板化内容
- 不擅自修改议程 (如果觉得议程有问题, 在 producerNotes 里提意见, 但本次产出仍按议程走)
```

### 3.8 会话与草稿持久化 (v2.0 拆表版)

**v2.0 修正**: v1.0 曾设计单表 `study_sessions(payload_json TEXT)` 塞整个 session, 但这是反模式:
- 一个 session 的 EvidencePool (50 条 × 400 字 snippet) + AgendaDoc + 全文草稿 + telemetry 容易达几百 KB
- 无法按字段查询 ("所有 report 体裁的 session"? 不行)
- 每次加载都是全量反序列化, 大 session 加载变慢

v2.0 改为**元数据 SQLite 表 + 独立 JSON 文件**混合存储, 兼顾查询与写入性能。

#### 3.8.1 存储布局

```sql
-- 1) 元数据表 (SQLite, 走 duncrew-server.py)
CREATE TABLE study_sessions (
  id           TEXT PRIMARY KEY,
  title        TEXT,
  genre        TEXT,              -- report / essay / ...
  length_hint  TEXT,              -- short / medium / long / xlong
  dun_id       TEXT,              -- 可空
  status       TEXT NOT NULL,     -- active / archived / exported
  revision     INTEGER NOT NULL DEFAULT 1,  -- 乐观并发控制
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  exported_path TEXT              -- 归档后 .md 路径
);
CREATE INDEX idx_study_sessions_status ON study_sessions(status);
CREATE INDEX idx_study_sessions_genre  ON study_sessions(genre);
CREATE INDEX idx_study_sessions_dun    ON study_sessions(dun_id);

-- 2) 段落表 (用于段级并发写, 避免整 session 锁)
CREATE TABLE study_sections (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  section_order INTEGER NOT NULL,
  status        TEXT NOT NULL,    -- planned / drafting / done
  revision      INTEGER NOT NULL DEFAULT 1,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES study_sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_study_sections_sid ON study_sections(session_id);

-- 3) 用户行为遥测 (append-only, 见 §3.10)
CREATE TABLE study_user_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  section_id  TEXT,
  action      TEXT NOT NULL,    -- draft / rewrite / polish / lock / edit / accept / reject
  payload     TEXT,             -- JSON: { confidence?, durationMs?, ... }
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_user_actions_session ON study_user_actions(session_id, created_at);
```

**大对象拆到独立 JSON 文件** (路径由 `study_sessions.id` 派生):

```
DunCrew-Data/study/{sessionId}/
├── brief.json           # WritingBrief (含 skills/pins/dunId)
├── evidence.json        # EvidencePool 全量
├── agenda.json          # AgendaDoc (含所有 section 的 draft)
├── history/
│   └── {sectionId}-{rev}.md   # 每段历史版本 (重写时滚动保留最近 5 份)
└── session.meta.json    # 汇总视图, 归档时拷贝到 documents/ 目录
```

> 类比 Nexus 的 `experience/` 目录结构 — 大对象走文件, 元数据走 SQL。

#### 3.8.2 并发与 WAL

SQLite 默认串行化写锁, 自习室段级并发 (多段同时请求 `draft_section`) 下容易成为瓶颈。v2.0 采取:

- **开启 WAL 模式** 启动时 `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;` (duncrew-server.py 启动时执行)
- **写序列化**: 后端维护一个单协程的 `write_queue`, 所有 section 状态变更走队列 (`asyncio.Queue`), 保证事务性
- **乐观并发控制**: 每次 `UPDATE study_sections` 带 `WHERE revision = :expected`, 失败时返回 409 让前端 refetch
- **大对象原子写**: JSON 文件写入使用 `write-to-temp + rename` 模式, 避免写一半崩溃

#### 3.8.3 Zustand 运行时状态

```typescript
// src/store/slices/studyRoomSlice.ts
interface StudyRoomState {
  activeSessionId: string | null
  sessions: Record<string, StudySessionRuntime>  // 加载到内存的 session 子集
  pendingSaves: Set<string>    // 5s 防抖保存队列
  abortControllers: Record<string, AbortController>  // 见 §3.10
}
```

#### 3.8.4 本地快照与崩溃恢复

- 未保存变更走 `localStorage['duncrew_study_draft_{sessionId}']`, 5s 防抖快照 + 每次 Intent 执行后立即快照
- 启动时扫描 `duncrew_study_draft_*` key, 若对应 session 的 SQLite `status != exported` 且 localStorage 快照 `updated_at` 更新, 弹出"检测到未保存变更, 是否恢复?"
- 快照内容: `agenda.json` 的 diff (base revision + patch)

#### 3.8.5 产出归档

- 路径: `DunCrew-Data/documents/{YYYY-MM-DD}-{slug(title)}/`
  - `document.md` — 正文, 尾部含自动生成的 Footnotes 区
  - `evidence.json` — 证据池快照 (便于未来复查, 含每条的 `snapshotTldr`)
  - `agenda.json` — 议程快照
  - `session.meta.json` — 会话元信息 + telemetry + userActions 汇总
- 触发时机:
  - 用户点击 "导出"
  - 所有 section 进入 `done` (MVP) 或 `polished`/`locked` (Phase 2b+) 时, 状态栏浮出"可以归档"提示, 不强制打断

#### 3.8.6 可选回写记忆

归档时询问 "是否把本文的 stance / key findings 写回 l1_memory?"
- 若选 "是", 抽取 openingStance + 每节首句, 构造 3-5 条 memory entry 通过 `memoryStore.write({ source: 'l1_memory' })` 写回
- tag 为 `['study_room', sessionId, ...genreTags]`
- 目的: 下次写作时能通过 Memory Lens 召回本文观点, 保持作者**观点一致性**

### 3.9 Quick Draft 逃生通道 (Phase 2b+)

不是所有写作都需要完整议程。用户只想"写一段 200 字的项目进展同步"时, 议程是负担。

**Quick Draft 作为 WriterChat 的特化 Intent**:

- 顶栏有 "Quick ⚡" 开关按钮 (默认关闭; 也可对话中说"快速模式"触发 `toggle_quick_mode` Intent)
- 开启后 WriterChat 的 Intent 分发规则收敛:
  - 用户首条输入 → 直接触发 `quick_compose` Intent, 跳过 Intake 表单和 Agenda 生成
  - 后端串行执行 P1(本地) → P2(简化 L+S 两路) → P4(单段 compose)
  - 输出落在 Composer 的单个 `planned` → `drafting` → `done` 段中
- **共用同一个 WriterChat/StudySession 模型**: 不创建特殊的"临时卡片", 它只是一个 `agenda.sections.length === 1` 的普通 session, 用 `brief.metadata.quickMode=true` 标记
- **归档行为**: 与普通 session 一致 (导出到 documents/), 但默认勾选"回写记忆"为关闭
- **降级规则**: 字数超过 800 或用户对该段发起 3 次以上重写时, 状态栏提示 "内容较复杂, 是否转为完整模式?" (触发 `escalate_to_full` Intent, 自动调用 P2 全量采集 + P3 生成议程)

### 3.10 中断恢复与会话控制 (v2.0 新增)

**问题**: v1.0 没有中断机制, P4 Compose 流式草起 3000 字段时用户想改第 1 段措辞、网络断了、或切了段, 都只能干等或强刷。

**解决方案**: 每次原语调用绑定 `AbortController`, 存储在 Zustand `abortControllers[sessionId]` 中。

```typescript
// src/services/studyRoom/abortManager.ts
export class StudyAbortManager {
  private controllers = new Map<string, AbortController>()

  /** 为 (sessionId, sectionId, stage) 三元组拿一个受控的 signal */
  acquire(key: string): AbortSignal {
    this.abortIfActive(key)   // 同 key 只允许一个活跃任务
    const ctrl = new AbortController()
    this.controllers.set(key, ctrl)
    return ctrl.signal
  }

  /** 显式取消某个任务 */
  abortIfActive(key: string): boolean {
    const ctrl = this.controllers.get(key)
    if (!ctrl) return false
    ctrl.abort(new WritingError({ code: 'user_aborted', stage: 'unknown', sessionId: key }))
    this.controllers.delete(key)
    return true
  }

  /** 取消某个 session 下的全部任务 (用户关闭 session / 崩溃恢复时) */
  abortAllForSession(sessionId: string): number {
    let count = 0
    for (const [key, ctrl] of this.controllers) {
      if (key.startsWith(`${sessionId}:`)) {
        ctrl.abort()
        this.controllers.delete(key)
        count++
      }
    }
    return count
  }
}
```

**使用约定**:
- key 格式: `${sessionId}:${stage}` (如 `sess123:dispatch`, `sess123:draft:sec4`)
- 用户发起新 Intent 时, 如果已有同 key 活跃任务, 先 abort 再新建 (**切段 = abort 当前 + 重定向**)
- `AbortSignal` 传给 `streamChat` / `chatBackground` / `fetch`, 底层会抛 `AbortError`
- 上层捕获 `AbortError` 后: 若 abort reason 是 `WritingError(user_aborted)` 则静默, 否则升级为 `WritingError` 走 §3.11 降级

**断网恢复**:
- 每段 `drafting` 状态下的流式片段实时存入 `agenda.json` 的 `section.draftPartial` 字段
- 网络/进程恢复后, 扫描所有 `drafting` 段, UI 显示"上次在此中断, 继续 / 重来 / 丢弃"三选一
- "继续" = 把 `draftPartial` 作为 prompt 的续写前缀, 调 LLM 补全剩余部分
- "重来" = 清空 `draftPartial`, 重新 draft
- "丢弃" = 回退到 `planned`

### 3.11 错误传播与降级 (WritingError)

**问题**: v1.0 只有 happy path, 没定义 LLM 不可用 / JSON 解析失败 / 归档失败 / 后端断开 时的行为。

**解决方案**: 统一错误类型 + 分级降级策略。

```typescript
// src/services/studyRoom/errors.ts
export type WritingErrorCode =
  | 'llm_unavailable'          // API key 过期 / 网络错
  | 'llm_rate_limited'         // 429
  | 'llm_response_invalid'     // 返回非预期格式
  | 'agenda_parse_failed'      // Agenda JSON 解析失败
  | 'evidence_not_found'       // 引用的 evidence id 不存在
  | 'section_conflict'         // SQLite 409 乐观锁冲突
  | 'persist_failed'           // JSON 文件写入失败
  | 'user_aborted'             // 用户主动取消
  | 'archive_failed'           // 归档到 documents/ 失败
  | 'unknown'

export class WritingError extends Error {
  code: WritingErrorCode
  stage: 'intake' | 'telescope' | 'agenda' | 'compose' | 'archive' | 'dispatch' | 'unknown'
  sessionId: string
  sectionId?: string
  retryable: boolean
  userMessage: string          // 面向用户的中文短句
  details?: unknown            // 原始 error, 开发者看

  constructor(init: {
    code: WritingErrorCode; stage: WritingError['stage']; sessionId: string
    sectionId?: string; retryable?: boolean; userMessage?: string; details?: unknown
  }) {
    super(init.userMessage || init.code)
    this.code = init.code
    this.stage = init.stage
    this.sessionId = init.sessionId
    this.sectionId = init.sectionId
    this.retryable = init.retryable ?? DEFAULT_RETRYABLE[init.code]
    this.userMessage = init.userMessage || DEFAULT_MESSAGE[init.code]
    this.details = init.details
  }
}
```

**分级降级策略**:

| 错误码 | 默认可重试 | 降级行为 |
|--------|-----------|---------|
| `llm_unavailable` | 是 (指数退避 3 次) | 3 次失败后: 中栏 Composer 保留已写内容, Toast "LLM 不可用, 内容已保留, 请检查 API 配置"; 提供"复制当前文档"按钮 (`navigator.clipboard.writeText`) |
| `llm_rate_limited` | 是 (等待 `retry-after` 或 10s) | 单段暂停 30s 后自动重试一次, 失败降级为 `llm_unavailable` |
| `llm_response_invalid` | 是 (重试 1 次, 加强 prompt) | 二次失败: draft 直接接受原始文本, 标记段为 `done` + warning 徽章"格式不规范, 建议重写" |
| `agenda_parse_failed` | 是 (重试 1 次) | 二次失败: 生成单节占位议程 `[{order:1, heading:'全文', intent:brief.intent, targetLength:brief.length}]`, 让用户手改 (**不做**正则结构抽取兜底) |
| `evidence_not_found` | 否 | 从正文删除该引用标记, 在 Footnote 处标注 "[引用已失效]", 段状态不降级 |
| `section_conflict` | 是 (自动 refetch+rebase 1 次) | 二次失败: 弹出冲突解决 UI (左原文 / 右新版, 用户选择) |
| `persist_failed` | 是 (写临时文件 + 重命名重试) | 二次失败: 写入 localStorage 快照 + Toast "磁盘保存失败, 变更已缓存到内存, 请导出备份" |
| `user_aborted` | 否 | 静默, 不提示 |
| `archive_failed` | 是 (重试 1 次) | 二次失败: 提供三选一 "下载 .md / 复制到剪贴板 / 重试" |

**核心不变量 (任何错误下)**: 用户已经看到的草稿内容**绝不丢失**。最坏情况: 一键复制全文到剪贴板。

### 3.12 测量驱动: 用户行为遥测 (v2.0 新增)

**问题**: v1.0 的 telemetry 只记 LLM 调用次数和耗时, 但**最有价值的信号**是"用户对某段重写了几次""精修后是接受还是再改", 这些用于未来调参 (不同体裁的默认温度/长度等)。

```typescript
interface UserActionEvent {
  sessionId: string
  sectionId?: string
  action:
    | 'intake_submit' | 'skill_mention' | 'skill_remove'
    | 'agenda_generate' | 'agenda_edit' | 'section_add' | 'section_delete' | 'section_reorder'
    | 'draft_start' | 'draft_accept' | 'draft_abort'
    | 'rewrite' | 'polish' | 'lock'
    | 'evidence_pin' | 'evidence_unpin' | 'scratchpad_paste'
    | 'export' | 'contribute'
    | 'trust_mode_toggle' | 'quick_mode_toggle'
  payload?: {
    confidence?: number         // Intent 分类置信度
    durationMs?: number         // 本次动作耗时
    iterationIndex?: number     // 对同段的第 N 次重写
    fromState?: string          // 状态迁移 from
    toState?: string            // 状态迁移 to
    [k: string]: unknown
  }
  createdAt: number
}

// 写入路径: Zustand slice -> debounced batch (1s) -> POST /api/study/{id}/actions -> SQLite
// 消费路径: 设置页 "写作行为统计" 看板 (Phase 3); 导出 session 时附在 session.meta.json
```

**遥测不做的事**:
- 不上报到任何外部服务 (纯本地)
- 不记录具体文本内容 (只记动作 + 元信息), 保护隐私
- 不阻塞 UI (失败静默)

---

## 4. UI 层设计

> UI 是写作管线的窗口。它的职责: 呈现议程、展示证据、接受段级操作、管理会话。

### 4.1 整体布局

**v2.0 布局核心**: 保留三栏主结构, 但**中栏 Composer 右侧新增 WriterChat 侧栏** (作为主控, 可折叠)。右栏 Telescope 仅显示 Phase 对应启用的镜头 Tab。

```
┌─ LibraryHouse ─────────────────────────────────────────────────────────┐
│ ┌ 浮动 Tab (左上) ──┐                                                  │
│ │ 图书馆 | 自习室 ●│                                                  │
│ └───────────────────┘                                                  │
│                                                                        │
│ ┌─ StudyRoom 四栏 (含折叠的 WriterChat) ────────────────────────────┐  │
│ │ ┌──────────┬──────────────────────┬──────────────┬────────────┐ │  │
│ │ │          │ Composer Toolbar     │ WriterChat   │            │ │  │
│ │ │ Agenda   │ [导出] [Quick⚡] [⌘I]│  (侧栏主控)   │ Telescope  │ │  │
│ │ │ Panel    ├──────────────────────┤              │            │ │  │
│ │ │          │                      │ ● 用户        │ [L] 图书馆 │ │  │
│ │ │ §1 导言  │  Paragraph Canvas     │ 把§2改得更严谨 │  ▸ 2023信心│ │  │
│ │ │  L3 S1   │  ┌──────────────┐    │ ○ AI 意图卡   │  ▸ 中小企业 │ │  │
│ │ │ §2 现象  │  │§1 done        │    │ 重写§2         │ [S] 技能   │ │  │
│ │ │  L4 M1   │  │2023年12月...  │    │ 置信 0.92 ✓   │  ▸ zr-style│ │  │
│ │ │ §3 机制  │  │[^L12] [^M3]   │    │ (信任模式直接) │ [M] 记忆   │ │  │
│ │ │  L5 S1   │  ├──────────────┤    │              │  (Phase2a+)│ │  │
│ │ │ §4 建议  │  │§2 drafting…   │    │ ● 系统        │ [W] 网络   │ │  │
│ │ │  L2 S2   │  │▱▱▱▱ 67%      │    │ 已重写完成     │  (Phase2b+)│ │  │
│ │ │          │  ├──────────────┤    │ [撤销 2.8s]   │            │ │  │
│ │ │ ＋ 添加  │  │§3 planned     │    │              │ ── 已钉 ── │ │  │
│ │ │          │  │(开始草起)      │    │ [输入@skill.] │ ⭐ L12     │ │  │
│ │ │ ── Brief ─│  └──────────────┘    │              │            │ │  │
│ │ │ 体裁 报告 │                       │              │ [搜索…]    │ │  │
│ │ │ 字数 3k  │  ┌─ Footnotes ──┐     │              │            │ │  │
│ │ │ Dun: —   │  │[L12] 2023…   │     │              │            │ │  │
│ │ └──────────┴──┴──────────────┴─────┴──────────────┴────────────┘ │  │
│ │                                                                  │  │
│ │ ┌─ 状态栏 (32px) ────────────────────────────────────────────┐   │  │
│ │ │ 4 节 · 2 done · 1 drafting · 1 planned · 1234/3000 字      │   │  │
│ │ │ LLM: 7 calls · 已保存 2s 前 · 信任模式 ON                    │   │  │
│ │ └────────────────────────────────────────────────────────────┘   │  │
│ └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

**栏位伸缩**:
- Agenda Panel: 240px 固定, 可折叠到 48px (只留色点)
- Composer: 弹性主区, 最小 520px
- WriterChat: 320px 默认, 可折叠到 0 (Cmd+Shift+C 切换), Quick 模式下自动展开
- Telescope: 280px 默认, Phase 1 只有 `[L]` 和 `[S]` 两个 Tab

### 4.2 与现有图书馆的关系

```
LibraryHouse
├── Tab "图书馆"    → 当前的 LibrarySidebar + LibraryHome/LibraryContent (保留不变)
└── Tab "自习室"    → 新增 StudyRoomView
    ├── 空会话状态  → StudyRoomEmpty (欢迎页 + 最近会话列表 + 新建按钮)
    └── 进行中会话  → StudyRoomWorkspace (三栏编辑器)
```

**Tab 切换交互**:

| 场景 | 操作 | 行为 |
|------|------|------|
| 图书馆 → 自习室 | 点击顶部 "自习室" tab | 进入自习室空状态或上次会话 |
| 图书馆 → 自习室 | 在图书馆实体详情页点击 "用此实体写作" | 进入自习室, 自动钉住当前实体 |
| 自习室 → 图书馆 | 点击顶部 "图书馆" tab | 如有未保存 session 提示 "本次会话会被后台保存, 切换?" |
| 自习室中钉证据 | 在 Telescope 点击实体卡片的 📌 | 实体加入 pinned, 权重上调 |

**路由**: 不改变当前的单一 HouseContainer 路由, 通过 `useStore.studyRoomSlice.tabActive` 切换, 纯前端状态。

### 4.3 Agenda Panel (左栏)

**功能**:
- 议程大纲 (可拖拽重排, Phase 2a+ 启用拖拽)
- 每节显示: heading、evidence 徽章 (Phase 1: `L3 S1`; Phase 2a+: `L3 M1 S1`)、状态色点
  - MVP 配色: 灰 `planned` / 橙 `drafting` / 绿 `done`
  - Phase 2b+ 额外: 红 `contested` / 深绿 `polished` / 蓝 `locked` / 斜纹叠加 `stale`
- 点击节跳转主编辑区到对应段
- 右键菜单 (MVP): 重写 / 删除; (Phase 2b+ 扩展): 精修 / 锁定 / 降级
- 底部: Brief 摘要 (体裁/字数/语气/Dun), 可点击展开修改 → 触发议程重算

**议程重算** (v2.0 对话驱动):

- 用户可直接在对话中说 "把第 3 节拆成两节" / "我想加一节讲政策背景" → Intent Dispatcher 分类为 `revise_agenda`, 后台调 P3 原语
- 用户也可直接在左栏拖拽/右键, 等价于触发相同 Intent
- 修改规则:
  - 如果 `genre / length` 变了 → Toast "结构性变更, 建议重生议程" (给一键按钮)
  - 只是 `tone / constraints` 变了 → 保留议程; Phase 2a+ 会把 `done` 段标记为 `stale`
  - MVP 阶段不做 stale 标记 (用户自行判断)

### 4.4 Composer (中栏)

**段卡片 (ParagraphCard)** — v2.0 按 MVP 3 态简化:

每个段是一个可折叠卡片, 显示:

- 顶栏: 状态徽章 · heading · 字数 / 目标字数
- 内容: 根据状态显示
  - `planned`: 灰底, 展示 intent + evidencePocket 预览, 单个大按钮 "开始草起" (= Intent `draft_section`)
  - `drafting`: 流式增量文本 (见 §9 实时渲染), 顶部右侧有 [取消] 按钮 (= §3.10 Abort)
  - `done`: Markdown 渲染, 引用标记可悬停预览 EvidenceItem
- 底部操作栏 (MVP): [重写] [复制 Markdown] [查看源证据]
- 引用标记交互: 悬停显示 EvidenceItem 气泡 (title + snapshotTldr + 源头链接), 点击跳转到右栏 Telescope 高亮该条

**Phase 2b+ 扩展状态** (列出供未来参考, 不在 MVP 实现):
- `contested`: 红色边框, 上方黄条 "数字 8.4% 无来源" (§7.6 纯算法 Ground Check), 按钮 [重写本段] [忽略警告]
- `polished`: 深绿边框, 操作栏新增 [再次精修]
- `locked`: 蓝色边框, 正文只读, 右上角 🔒
- `stale` (叠加态): 半透明 + 黄色斜纹水印

**段级流式策略** — v2.0 统一流式:

- **所有段默认流式** (不再按字数分档), 逐 token 渲染到 Composer, 实时增量 diff 高亮
- `[^Lxx]` 标记在流式过程中先以灰色 placeholder 显示, 段结束后统一解析为可悬停徽章 (详见 §9 渲染 FSM)
- 段首 3 token 内未达首字节时 Composer 显示打字光标, 避免"一片空白"错觉
- 用户中途点 [取消]: `abortManager.abortIfActive('${sessionId}:draft:${sectionId}')`, 保留已渲染片段, 状态回 `planned`, 写入 `section.draftPartial` 以支持 §3.10 断点续写

### 4.5 Telescope Panel (右栏)

**功能**: 展示 EvidencePool, 支持按镜头切换、手动搜索补充、钉证据、查看引用。

**布局** (Phase 分阶段启用 Tab):

- Phase 1: `[全部]` `[L]` `[S]` 三 Tab
- Phase 2a+: 加 `[M]` Tab
- Phase 2b+: 加 `[W]` Tab
- Phase 3+: 加 `[E]` Tab (粘贴板, 见 §10)

**通用规则**:

- 默认 "全部" Tab, Phase 1 按"Library 在前, Skills 在后"的固定顺序排列; Phase 2a+ 按 score 混合排序
- 每个 EvidenceItem 卡片:
  - 顶栏: 镜头色标 + lens id (L12) + (Phase 2a+) score 条
  - 标题 (2 行截断)
  - snippet (3 行截断, 可展开)
  - 底栏操作: 📌 钉住 / 🔗 查看源头 / ＋ 指定到某节 pocket / 🗑 从 pool 移除
- 搜索框 "搜索证据…": 输入关键词在 pool 内做本地 `includes` 过滤 (不触发新检索)
- 底部按钮 [重新采集]: 触发 P2 原语再跑一次 (pool 合并而不是替换, 旧条目保留以维持引用稳定)

**手动补采** (通过对话或按钮):

- 对话: 用户说"给第 3 节补点证据" → Intent `supplement_evidence`, 后台调 P2 局部
- 按钮: 右下角浮动 ⊕, 弹对话框选 section + 关键词, 触发相同 Intent

**钉证据语义**:

钉 (Pin) 和分配到 pocket 是两个维度:
- Pin: 全局标记, 提示 "这条证据很重要, 议程生成时优先考虑", 体现为 P3 prompt 中的 `pinnedIds` 字段
- Pocket 分配: 该证据分配给特定 section, 决定 LLM 在 P4 能看到它

用户可同时钉 + 分配 pocket, 也可只钉不分配 (留待议程生成时自动分配)。

**空态**:

未生成议程前, Telescope 显示 "待采集, 点击下方按钮开始" / 或在 WriterChat 中说"开始采集证据", 按钮触发 P2。

### 4.6 Footnotes 区

**渲染位置**: Composer 主编辑区底部, 全文段落下方。

**内容**:

```markdown
## 参考文献 (自动生成, 导出时保留)

[L12] **2023年12月中小企业经营信心指数** (图书馆实体)
     > 2023 年 12 月经营信心指数环比上升 0.8 个点, 连续三个月回升...
     源: entity://ent-2023-12-smb-confidence

[M3] **2025-03 中小企业调研笔记** (L1 Memory)
     > 走访 12 家企业, 反映订单回暖但用工成本高...
     源: memory://mem-20250305-notes

[W1] **国家统计局 2024-01-15 公告** (Web)
     > 2023 年 12 月规模以上工业企业利润同比增长 16.8%...
     源: https://www.stats.gov.cn/...
     采集时间: 2026-04-23 10:32
```

**交互**:

- 每条可展开查看完整 snippet
- 点击 "源" 链接:
  - entity: 右栏 Telescope 高亮 + 左下角浮窗展示该实体的 WSJ 风详情 (复用 LibraryContent 组件)
  - memory: 弹出抽屉显示完整 memory entry
  - web: 外部浏览器打开 URL, 同时标记 "可能失效"
- 导出时 footnotes 区作为 Markdown 附录保留

**未引用证据的处理**:

EvidencePool 中未被任何段引用的条目不出现在 Footnotes, 但会在 `evidence.json` 归档中保留, 供未来复查。

### 4.7 状态栏

底部 32px 固定高度, 始终显示:

| 区域 | 内容 | 示例 (MVP) |
|------|------|------|
| 左 | 议程进度 | `4 节 · 2 done · 1 drafting · 1 planned` |
| 中 | 字数统计 | `1234 / 3000 字 (41%)` |
| 中右 | 信任模式 | `信任模式 ON` / `信任模式 OFF` (§8.8) |
| 右 | LLM 调用数 | `7 calls` (MVP 不显示 token/成本, 避免误导; Phase 3 可补成本看板) |
| 最右 | 保存状态 | `● 已保存 2s 前` / `○ 未保存` / `⚠ 后端断开` (WritingError 触发时) |
| 悬浮 | 撤销条 (信任模式下) | `已重写 §2 [撤销 2.8s...]` (见 §8.8) |

点击任意区域展开详情浮层。

### 4.8 Quick Draft UI — Phase 2b+

**入口**: Composer Toolbar 右侧 "Quick ⚡" 开关按钮。

**切换行为** (v2.0 修正: 不再是"临时卡片", 而是 StudySession 的一个特化配置, 见 §3.9):

- 从完整模式 → Quick: 当前 session 保留, 开启 Quick 模式后**新建**一个 `brief.metadata.quickMode=true` 的 session
- Quick session 在 Agenda Panel 只显示单节, 无拖拽排序入口
- 从 Quick → 完整模式: 对当前 Quick session 触发 `escalate_to_full` Intent, 后台自动调 P2 全量采集 + P3 生成议程, 原单段保留为议程首节

**Quick 表单** (替代 Intake 的简化版):

```
┌─ Quick Draft ──────────────────────────────┐
│ intent: [写一段 200 字的 Q1 进展同步...]   │
│ 用什么: [✓L 图书馆] [✓S 技能]               │
│        (Phase 2a+ 增 M; Phase 2b+ 增 W)     │
│ 字数: [  200  ]                             │
│                     [生成] [⌘+Enter]        │
├─────────────────────────────────────────────┤
│ (生成后在 Composer 显示单段, 带引用, 底栏    │
│  [复制] [转完整模式] [新建 Quick])           │
└─────────────────────────────────────────────┘
```

单次调用, MVP 无 Ground Check/精修。引用标记解析与普通段相同。

---

## 5. 实现路线

> v2.0 路线重排: 拆为 **Phase 1 / 2a / 2b / 3** 四阶段, 每阶段交付独立可上线的闭环, 允许对话式编辑和资料粘贴板分别独立上线。**不标注人日** — 全部由 AI 编码完成, 工期仅作为 backlog 排序依据, 不作为时间承诺。

### 5.1 Phase 1: 对话式 MVP (可独立上线)

**目标**: 跑通 "输入 intent → WriterChat 对话推进 → 输出一段文档" 的最短路径。**对话控制流与段级流式渲染是本期的核心**。

**启用能力**:
- P1 Intake (本地规则, 无 LLM)
- P2 Telescope 仅 **L + S** 两路, 简化数据结构 (无 byLens 分桶/无 score)
- P3 Agenda 生成 (一次 LLM 调用, 解析失败走 §3.11 降级)
- P4 Compose 流式草起 (每段一次调用)
- WriterChat 主控 + Intent Dispatcher (先实现 5 个核心 Intent: `draft_section / rewrite_section / revise_agenda / supplement_evidence / export_document`)
- MVP 3 态段状态机 (`planned / drafting / done`)
- AbortController 中断机制 (§3.10)
- WritingError 降级 (§3.11 的核心 5 类错误: `llm_unavailable / llm_response_invalid / agenda_parse_failed / persist_failed / user_aborted`)
- SQLite 拆表持久化 (§3.8, 含 WAL)
- 引用标记解析 (MVP 就要做, 否则文档没价值) + Footnotes 自动生成
- 5s 防抖本地快照 + 崩溃恢复

**交付文件**:

1. **UI**
   - `src/components/houses/LibraryHouse.tsx` 改为 Tab 布局 (图书馆 / 自习室)
   - `src/components/houses/library/studyRoom/StudyRoomView.tsx` — 四栏主容器
   - `StudyRoomEmpty.tsx` — 欢迎页 + 最近会话列表 + 新建按钮
   - `StudyRoomIntake.tsx` — Intake 表单 (意图 / 体裁 / 字数 / Skills 多选 / Dun 选择)
   - `AgendaPanel.tsx` / `Composer.tsx` / `ParagraphCard.tsx` / `TelescopePanel.tsx` / `WriterChatPanel.tsx` / `StatusBar.tsx`
   - `IntentCard.tsx` (见 §8 的 IntentCard 规范)
2. **服务层**
   - `src/services/studyRoom/writingService.ts` — 编排 P1-P4 原语
   - `src/services/studyRoom/intentDispatcher.ts` — Intent 分类 (调小模型) + 执行路由
   - `src/services/studyRoom/abortManager.ts` — §3.10 的 `StudyAbortManager`
   - `src/services/studyRoom/errors.ts` — §3.11 的 `WritingError` 类 + 降级路由
   - `src/services/studyRoom/lenses/library.ts` + `lenses/skills.ts` (Phase 1 只此两路)
   - `src/services/studyRoom/prompts.ts` — `WRITING_CONDUCTOR_PROMPT` + `INTENT_DISPATCHER_PROMPT` + user prompt builder
   - `src/services/studyRoom/citationParser.ts` — `[^Lxx]` 解析器
3. **Store**
   - `src/store/slices/studyRoomSlice.ts` — session / brief / pool / agenda / abortControllers / pendingSaves
4. **后端 API** (`server/handlers/study.py`)
   - `POST /api/study/sessions` / `PATCH /api/study/sessions/:id` / `GET /api/study/sessions` / `DELETE /api/study/sessions/:id`
   - `POST /api/study/sessions/:id/sections/:sid` (乐观并发)
   - JSON 大对象读写: `DunCrew-Data/study/{sid}/brief.json / evidence.json / agenda.json`
   - 启动时 `PRAGMA journal_mode=WAL`
5. **归档**
   - `exportSession(sessionId)` — 拼装 Markdown 写入 `DunCrew-Data/documents/{date}-{slug}/document.md` + 附 `evidence.json / agenda.json / session.meta.json`

**不做 (延后)**: Memory / Web 镜头、Ground Check、Polish、Quick Draft、知识回流、信任模式。

**验收**:
- 用户输入 "写一份关于 X 的报告" → 通过 WriterChat 对话推进 → 拿到一份 3-5 节、含引用脚注的 Markdown, 归档到 documents/
- 任意 drafting 段可被用户 [取消] 打断, 不丢失已渲染片段
- 议程 JSON 解析失败时, 自动降级为单节占位议程, 用户可手改

---

### 5.2 Phase 2a: 对话式编辑加强 (可独立上线, 不依赖 2b)

**定位**: Phase 1 已交付完整闭环, 2a 聚焦**对话式编辑体验**, 让高频重写场景流畅。

**启用能力**:
- 信任模式 (§8.8): `confidence ≥ 0.85` 的 Intent 直接执行 + 3s 撤销浮条
- Skills `@mention` 主动召唤 (§8.9, 复用 `MentionDropdown.tsx` + `AIChatPanel.tsx` 的现有基础设施)
- Skills 冲突检测 (§3.2.2) + UI 警示
- 补 10 个 Intent: `polish_section / lock_section / tweak_tone / add_section / delete_section / reorder_sections / revise_brief / pin_evidence / unpin_evidence / escalate_to_full`
- 断网续写 (§3.10 的 `draftPartial` 续传)
- 议程 `revision` 追踪 + `stale` 叠加态
- 议程拖拽重排 (dnd-kit)
- 段级历史: `agenda.history[]` 保留最近 5 份重写记录
- 用户行为遥测 (§3.12) 完整落地 + 设置页基础看板
- `WritingError` 降级扩展到全部 9 类

**交付文件新增**:
- `src/components/houses/library/studyRoom/UndoBar.tsx` (撤销浮条)
- `src/services/studyRoom/trustMode.ts`
- `src/services/studyRoom/skillConflictResolver.ts` — §3.2.2 的 `detectSkillConflicts`
- `src/services/studyRoom/telemetry.ts` — `UserActionEvent` 批量上报

**验收**:
- 连续"改第二段" / "更严谨一点" / "加一节结论" 三次对话, 信任模式下**无弹窗摩擦**, 每次可撤销
- `@report-style` 触发后, 该 skill 立即加入 brief 并影响下一段 compose
- 两个互斥 skill 同时加载时 UI 显示冲突徽章, 对话中可说"优先用政务风格"解决

---

### 5.3 Phase 2b: 采集加强 + Ground Check (可独立上线, 不依赖 2a)

**定位**: Phase 1 的 L+S 太单薄, 2b 把采集能力和正确性守护补齐。**与 2a 并行无耦合**, 可先上 2a 再上 2b, 也可反过来。

**启用能力**:
- P2 Telescope 增加 **M (Memory)** 镜头 (§3.3 源分层)
- P2 Telescope 增加 **W (Web)** 镜头 (调后端 `/api/tools/webSearch`, 失败兜底 `onlineSearchService`)
- EvidencePool 升级为完整 `EvidencePool` (含 `byLens` / `score` / `warnings`)
- 查询改写小模型 (异步 2s 超时)
- Ground Check 纯算法版 (§7.6): 数字集合 `D \ S` 差集检测, 零 LLM 调用
- 段级 `contested` / `polished` / `locked` 状态 + UI
- Polish 子阶段 (段级精修 LLM 调用, 维持 §3.5 的 ±10% 字数契约)
- Quick Draft 模式 (§3.9): 单节 quickMode session + Quick UI + `escalate_to_full`
- 手动补采 UI (§4.5 右下角浮按钮)
- LLM 调用遥测: token / 成本估算, 状态栏可展开

**交付文件新增**:
- `src/services/studyRoom/lenses/memory.ts` / `lenses/web.ts`
- `src/services/studyRoom/groundCheck.ts` (纯算法)
- `src/services/studyRoom/polish.ts`
- `src/services/studyRoom/queryRewrite.ts`

**验收**:
- 四路采集的 pool 在 Telescope Panel 按 score 混合排序, Tab 切换流畅
- 含 "2023 年 GDP 增长 5.2%" 但 evidencePocket 里没有 5.2% 这个数的段, 自动进入 `contested`, 段卡片顶部黄条提示
- Quick Draft 10 秒内产出 200 字段落

---

### 5.4 Phase 3: 知识回流 + 资料粘贴板 + 跨栈联动

**启用能力**:
- 知识回流 (§12): 导出时产出 WikiIngestAction, 调 `/api/wiki/ingest`, 配 Review UI (§12.9 批量预览 + 原文定位)
- 归档可选写回 `l1_memory` (observation/preference/discovery 源分类)
- **证据粘贴板 `E lens`** (§10 v2.0 降级版): 文本粘贴 + `.txt/.md` 拖入, 无 PDF/DOCX 解析, 无 OCR
- 跨栈联动: 图书馆实体详情页 "用此实体写作" 按钮 / 自习室内点击 `[^Lxx]` 跳回图书馆
- 键盘快捷键: `Cmd+Enter` 草起 / `Cmd+Shift+P` 精修 / `Cmd+L` 锁定 / `Cmd+E` 导出 / `Cmd+Shift+C` 折叠 WriterChat / `Cmd+Alt+C` 粘贴板插入
- 写作行为统计看板 (消费 §3.12 的 `userActions`, 展示重写率/体裁分布等)
- EvidenceRef 的 `snapshotTldr` 字段全面校验 (导出时确保每条都有)

**不在 v2.0 路线**:
- PDF/DOCX/XLSX/PPTX/OCR 18+ 格式解析 → 作为**独立的"文件解析基础设施"项目**, 不绑定自习室交付
- 图像 / 表格精取 / 文件块精取 API
- 沉淀到图书馆 (从粘贴板一键沉淀)

**验收**:
- 完成文档导出后, Review UI 弹出 8-15 条 Entity/Claim 候选, 每条可点"查看原文"定位到文档对应段, 批量采纳/跳过流畅
- 用户粘贴 2000 字研究片段到粘贴板, 出现在 Telescope `[E]` Tab, 可被段级引用
- 键盘操作完成全流程无需鼠标

---

## 6. 风险与缓解 (v2.0)

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| LLM 在长文档中出现**数字幻觉** | 高 | 严重 (降低产出可信度) | Phase 2b+ 纯算法 Ground Check (§7.6 数字差集 `D\S`), 0 LLM 调用, 零成本; UI 对无源数字高亮; `rewrite_section` 阶段保留原数字引用锚点 |
| 议程生成**结构性偏离**用户意图 | 中 | 高 | 议程可对话调整 + Brief 显式约束; Phase 2 补齐 `response_format=json_object` 后强 JSON 约束 |
| Web Lens 引入**过期或错误信息** | 中 | 中 | `EvidenceRef.snapshotTldr` (§3.3) 固化创建时的摘要; 导出时 footnote 注明 `fetchedAt` + "可能失效"; 高 dangerLevel 域名过滤 |
| Skills 之间**规则冲突** (如 A 要求客观, B 要求情感) | 中 | 中 | §3.2.2 冲突矩阵 + priority 排序 + UI 警示; 冲突 skill 不进 prompt; `@mention` 的 skill 默认 primary 覆盖自动匹配 |
| 长 session 状态膨胀导致**内存溢出** | 低 | 中 | EvidencePool 条目上限 50 (L 20 + M 15 + W 8 + S 5 + E 20 + buffer); `agenda.history` 每段保留最近 5 份; 大对象落独立 JSON 文件 (§3.8.1) 不常驻内存 |
| 后端 `memoryStore` / `webSearch` **不可用** | 中 | 中 | `Promise.allSettled` 隔离失败; `pool.warnings` 透传 UI; 仅用可用镜头推进; `WritingError.llm_unavailable` 降级 (§3.11) |
| 用户**高频编辑议程**导致 stale 洪水 | 低 | 低 | Phase 2a+ 才启用 stale; revision 变更 debounce 500ms; stale 段不自动重生, 等用户显式触发; MVP 完全不做 stale |
| Markdown 内容**引入非法 HTML** 被 render 执行 | 低 | 高 (XSS) | DOMPurify + react-markdown 的 `rehypeSanitize`, 不信任 LLM 输出 |
| 归档路径**重名覆盖** | 低 | 中 | slug 后缀追加时间戳 (HHMMSS); 导出前检查存在性, 冲突时用户确认; `WritingError.archive_failed` 降级提供三选一 (§3.11) |
| LLM **token 超限** (议程或长段) | 中 | 中 | Agenda 输出 maxTokens 4096; Draft 按 `max(1024, targetLength*2)` 动态 (§3.6); 超限时 Dispatcher 建议拆分 section |
| 议程 JSON **解析失败** | 中 | 中 | 重试 1 次 (Phase 1 无 response_format, 靠 prompt 强约束); 二次失败按 §3.11 `agenda_parse_failed` 降级为单节占位, 不做正则兜底 |
| 证据 pocket **分配不均** (某节 0 条, 某节 10 条) | 中 | 低 | Agenda prompt 里强制约束 "每节至少 1 条, 不超过 8 条"; UI 显示徽章让用户直观察觉并手动调整 |
| **对话摩擦**: 每次 Intent 都弹 Card 导致高频编辑难忍受 | 中 | 中 | Phase 2a+ 信任模式 (§8.8): `confidence ≥ 0.85` 直接执行 + 3s 撤销浮条; 高风险 Intent (delete/merge/regenerate/export) 永远走 Card 不信任直执行 |
| **流式中断**丢失用户已写内容 | 中 | 高 | §3.10 每次调用绑 `AbortController` + `draftPartial` 实时存盘; 断网重启后扫描并提示"继续/重来/丢弃" |
| **乐观并发冲突** (段级并发写) | 低 | 中 | §3.8.2 `UPDATE ... WHERE revision = :expected`, 409 触发 refetch; 二次冲突走 §3.11 `section_conflict` UI 让用户选版本 |
| **SQLite 写锁成为瓶颈** (段级并发) | 中 | 中 | §3.8.2 启动 WAL 模式 + `synchronous=NORMAL`; 后端单协程 `write_queue` 序列化段级写 |
| **引用源过时** (三个月后回看, 源 entity 被改) | 中 | 中 | `EvidenceRef.snapshotTldr` (§3.3) runtime 就写入, 不等归档; 导出校验每条 ref 必须带 `snapshotTldr` (Phase 3) |
| **粘贴板过量**撑爆 evidence.json | 低 | 低 | 单条 8000 字 + 总数 20 条上限 (§10.1), 前端强制校验; 超出后 UI 置灰添加按钮 |

---

## 7. 附录

### 7.1 数据流示意 (v2.0)

```
                    ┌────────────── 用户 ──────────────┐
                    │    (通过 WriterChat 输入指令)     │
                    └──────────────┬───────────────────┘
                                   ▼
                       [Intent Dispatcher §8.3]
                                   │
                                   ▼
              ┌────────── WriterIntent + IntentCard ─────────┐
              │      (信任模式 §8.8 决定是否弹卡片)            │
              └──────────────┬───────────────────────────────┘
                             ▼
         ┌───────────────────┴────────────────────┐
         │ 按 Intent 类别路由到对应后台原语         │
         └───────────────────┬────────────────────┘
                             ▼
   ┌─────────┬──────────┬──────────┬──────────┬──────────────┐
   │ P1 Intake│ P2 Tele  │ P3 Agenda│ P4 Compose│ Local (无 LLM)│
   │ (brief)  │ (scope)  │ (draft/  │ (stream) │ pin/lock/     │
   │          │ [L M W S │  revise) │          │ scratch/      │
   │          │  E]      │          │          │ reorder...    │
   └────┬─────┴────┬─────┴────┬─────┴────┬─────┴──────┬───────┘
        ▼          ▼          ▼          ▼            ▼
 WritingBrief  EvidencePool AgendaDoc  DraftOutput  AgendaDoc'
        │          │          │          │            │
        └──────────┴──────────┴──────────┴────────────┘
                             │
                             ▼
                ┌─ 乐观并发写 (§3.8.2) ─┐
                │  study_sessions        │
                │  study_sections        │
                │  study_evidence        │
                │  study_chat_turns      │
                │  study_user_actions    │  ← §3.12 遥测
                │  study_scratches (P3)  │
                └───────────┬────────────┘
                            ▼
                  [大对象落独立 JSON 文件] (§3.8.1)
                  documents/{sessionId}/session.json / evidence.json
                            │
                            ▼
                  § Phase 2b+ Ground Check (§7.6)
                  纯算法: D \ S 数字差集 + 引用存在性 + 粗匹配
                            │
                            ▼
         [段状态 done] ──── (Phase 2b+) ────→ grounded / contested
                            │
                            ▼
                  [export_document] 归档 (§3.8.5)
                  ├── documents/{date}-{slug}/document.md
                  ├── evidence.json  ◀──────── 快照 (含 snapshotTldr)
                  ├── agenda.json    ◀──────── 快照
                  └── session.meta.json
                  │
                  └──→ (可选 Phase 3) contribute → §12 知识回流 → l1_memory / wiki
```

**说明**:
- 流程的起点是 WriterChat 的对话输入, 而不是自动的流水线推进
- P1-P4 四类原语不是 "必经顺序", 而是 Intent 按需触发
- 无 LLM 的本地变更 (pin/lock/reorder/scratchpad_paste 等) 走 Local 分支, 不占用 LLM 配额
- 段级并发写走乐观锁 (§3.8.2), 冲突走 §3.11 `section_conflict` 降级
```

### 7.2 新增/修改文件清单

**新增** (v2.0 同步版, 按 Phase 标注启用阶段):

```
src/components/houses/library/studyRoom/
├── StudyRoomView.tsx            # 主容器                                   [P1]
├── StudyRoomEmpty.tsx           # 空会话状态 + 最近会话列表                  [P1]
├── StudyRoomWorkspace.tsx       # 四栏工作区 (含 WriterChat)                 [P1]
├── StudyRoomIntake.tsx          # Intake 表单                                [P1]
├── AgendaPanel.tsx              # 左栏                                      [P1]
├── Composer.tsx                 # 中栏                                      [P1]
├── ParagraphCard.tsx            # 段卡片 (MVP 3 态; 扩展态在 P2b)            [P1]
├── TelescopePanel.tsx           # 右栏 (P1: L+S; P2a+: +M; P2b+: +W; P3+: +E) [P1]
├── EvidenceCard.tsx             # 证据卡片                                   [P1]
├── FootnotesSection.tsx         # 底部脚注区                                 [P1]
├── WriterChatPanel.tsx          # 右侧对话侧栏                              [P1]
├── IntentCard.tsx               # 意图卡片 (§8.3)                            [P1]
├── UndoBar.tsx                  # 信任模式撤销浮条 (§8.8)                    [P2a]
├── ScratchpadPanel.tsx          # E 镜头证据粘贴板 (§10)                     [P3]
├── QuickDraftEntry.tsx          # Quick Draft 入口 (§3.9)                    [P2b]
└── useStudyRoom.ts              # 组合 hook

src/services/studyRoom/
├── writingService.ts            # 原语编排 (P1-P4 Intake/Telescope/Agenda/Compose) [P1]
├── intentDispatcher.ts          # Intent 分类 + 执行路由 (§8.3)              [P1]
├── abortManager.ts              # §3.10 StudyAbortManager                    [P1]
├── errors.ts                    # §3.11 WritingError + 降级路由               [P1]
├── prompts.ts                   # WRITING_CONDUCTOR_PROMPT + INTENT_DISPATCHER_PROMPT [P1]
├── citationParser.ts            # [^Lxx] 解析                                 [P1]
├── telemetry.ts                 # §3.12 UserActionEvent 批量上报              [P2a]
├── skillMatcher.ts              # §3.2.1 关键词包含打分 (不是 BM25)           [P1]
├── skillConflictResolver.ts     # §3.2.2 Skills 冲突矩阵                      [P2a]
├── trustMode.ts                 # §8.8 信任模式 + 撤销栈                      [P2a]
├── groundCheck.ts               # §7.6 纯算法 Ground Check                    [P2b]
├── polish.ts                    # 段级精修 (§3.5)                             [P2b]
├── queryRewrite.ts              # Web 镜头查询改写                            [P2b]
├── contributeAction.ts          # §12 知识回流 WikiIngestAction 产出          [P3]
└── lenses/
    ├── library.ts                                                          # [P1]
    ├── skills.ts                                                           # [P1]
    ├── memory.ts                                                           # [P2a]
    ├── web.ts                                                              # [P2b]
    └── scratchpad.ts                                                       # [P3]

src/store/slices/
└── studyRoomSlice.ts            # session / brief / pool / agenda /
                                 # abortControllers / pendingSaves / undoStack

server/handlers/study.py (新增):
├── POST   /api/study/sessions                  # 创建 session              [P1]
├── GET    /api/study/sessions                  # 列表 (分页 + genre/dun 过滤) [P1]
├── GET    /api/study/sessions/:id              # 读取                      [P1]
├── PATCH  /api/study/sessions/:id              # 更新元数据 (乐观并发)      [P1]
├── DELETE /api/study/sessions/:id                                          # [P1]
├── POST   /api/study/sessions/:id/sections/:sid # 段状态更新 (乐观并发)     [P1]
├── POST   /api/study/sessions/:id/actions      # 批量写入 userActions      [P2a]
├── POST   /api/study/sessions/:id/scratch      # 粘贴板添加                 [P3]
├── DELETE /api/study/sessions/:id/scratch/:sid # 粘贴板移除                 [P3]
├── POST   /api/study/sessions/:id/export       # 触发归档                   [P1]
└── SQLite schema (§3.8.1):
     - study_sessions (元数据)                                              # [P1]
     - study_sections (段元数据 + revision)                                  # [P1]
     - study_user_actions (append-only)                                     # [P2a]
    + 启动时 PRAGMA journal_mode=WAL / synchronous=NORMAL (§3.8.2)          # [P1]
    + 大对象存 DunCrew-Data/study/{sid}/*.json (§3.8.1)                     # [P1]

```

**修改** (v2.0):

```
src/components/houses/LibraryHouse.tsx
  # 引入 StudyRoomView, 顶部新增 Tab 切换 (图书馆 / 自习室)
  # 浮动 Tab 样式复用 SkillHouse.tsx 的写法

src/components/houses/library/LibraryContent.tsx
  # 实体详情页新增按钮 "用此实体写作" → 切到自习室 + 自动 pin + 带 dunId       [P3]

src/components/ai/MentionDropdown.tsx
  # 无需修改内部逻辑, WriterChat 直接复用其导出的 closeMention / MentionState   [P2a]
  # 新增 mention 类型 "skill" 的结果项渲染 (已有类似结构)

src/store/index.ts
  # 合并 studyRoomSlice

src/types.ts
  # 导出 §7.3 的全部类型 (WritingBrief / EvidenceItem / EvidenceRef /
  # AgendaDoc / AgendaSection / SectionStatus / SectionStatusExt /
  # StudySession / UserActionEvent / LLMCallRecord 等)

src/services/memoryStore.ts
  # 无需修改, 直接复用 search API; P2a 时确认 MemorySource 枚举已含
  # diary / l1_memory / gene / memory / session / exec_trace 等分层用到的源
```

### 7.3 关键类型汇总 (单一来源)

```typescript
// src/types.ts 追加

export type GenreHint = 'report' | 'essay' | 'letter' | 'memo' | 'tutorial' | 'novel' | 'custom'
export type LengthHint = 'short' | 'medium' | 'long' | 'xlong'
export type ToneHint = 'formal' | 'analytical' | 'narrative' | 'critical' | 'warm' | 'playful' | 'technical'

/** MVP 仅 3 态, 见 §3.5 */
export type SectionStatus = 'planned' | 'drafting' | 'done'
/** Phase 2b+ 扩展态, 见 §3.5 */
export type SectionStatusExt = SectionStatus | 'grounded' | 'contested' | 'polished' | 'locked' | 'stale'

/** Phase 1: 'L' | 'S'; Phase 2a+: +'M'; Phase 2b+: +'W'; Phase 3+: +'E' */
export type LensKind = 'L' | 'M' | 'W' | 'S' | 'E'

export interface SkillRef {
  name: string
  source: 'auto' | 'user' | 'mention'        // v2.0: 加 mention
  priority: 'primary' | 'secondary' | 'reference'
}

export interface WritingBrief {
  id: string
  intent: string
  genre: GenreHint
  length: LengthHint
  tone: ToneHint[]
  audience: string
  constraints: string[]
  skills: SkillRef[]
  pinnedEntityIds: string[]
  dunId?: string | null                       // v2.0: 关联 Dun, 见 §11
  metadata?: {
    quickMode?: boolean                       // v2.0: §3.9 Quick Draft 标记
    [k: string]: unknown
  }
  createdAt: number
}

/** v2.0: 所有变体均带 snapshotTldr (≤200 字), 防止源数据变更导致引用失效 */
export type EvidenceRef =
  | { kind: 'entity'; entityId: string; claimIds?: string[]; snapshotTldr: string }
  | { kind: 'memory'; memoryId: string; source: string; snapshotTldr: string }
  | { kind: 'web'; url: string; fetchedAt: number; snapshotTldr: string }
  | { kind: 'skill'; skillName: string; section?: string; snapshotTldr: string }
  | { kind: 'scratch'; scratchId: string; sourceName: string; snapshotTldr: string }

export interface EvidenceItem {
  id: string
  lens: LensKind
  title: string
  snippet: string
  ref: EvidenceRef                            // v2.0 重命名 fullRef→ref (更短)
  score?: number                              // Phase 2a+ 启用
  tags?: string[]
}

export interface EvidencePool {
  briefId: string
  items: EvidenceItem[]
  byLens?: Record<LensKind, string[]>         // Phase 2a+ 启用
  warnings?: string[]                         // Phase 2b+ 启用
  gatheredAt: number
}

export interface Footnote {
  marker: string          // [^L12]
  evidenceId: string
  label: string           // L12
}

export interface AgendaSection {
  id: string
  order: number
  heading: string
  intent: string
  targetLength: number
  evidencePocket: string[]
  skillHints: string[]
  status: SectionStatus                       // MVP: 3 态
  statusExt?: SectionStatusExt                // Phase 2b+ 覆盖 status
  draft?: string
  draftPartial?: string                       // v2.0 §3.10: 断点续写缓存
  polished?: string                           // Phase 2b+
  footnotes?: Footnote[]
  notes?: string
  revision: number                            // v2.0: 乐观并发控制
  history?: { version: number; body: string; producedAt: number }[]
  staleReason?: 'agenda_change' | 'brief_change' | null   // Phase 2a+
}

export interface AgendaDoc {
  briefId: string
  title: string
  subtitle?: string
  openingStance?: string
  closingCall?: string
  sections: AgendaSection[]
  revision: number
}

/** v2.0 §3.12 用户行为事件 */
export interface UserActionEvent {
  sessionId: string
  sectionId?: string
  action:
    | 'intake_submit' | 'skill_mention' | 'skill_remove'
    | 'agenda_generate' | 'agenda_edit' | 'section_add' | 'section_delete' | 'section_reorder'
    | 'draft_start' | 'draft_accept' | 'draft_abort'
    | 'rewrite' | 'polish' | 'lock'
    | 'evidence_pin' | 'evidence_unpin' | 'scratchpad_paste'
    | 'export' | 'contribute'
    | 'trust_mode_toggle' | 'quick_mode_toggle'
  payload?: {
    confidence?: number
    durationMs?: number
    iterationIndex?: number
    fromState?: string
    toState?: string
    [k: string]: unknown
  }
  createdAt: number
}

export interface LLMCallRecord {
  stage: 'agenda' | 'draft' | 'rewrite' | 'dispatch' | 'polish' | 'queryRewrite'
  sectionId?: string
  timestamp: number
  tokensIn?: number                           // streamChat 不总返回, 可空
  tokensOut?: number
  latencyMs: number
  model: string
  aborted?: boolean
}

export interface StudySession {
  id: string
  createdAt: number
  updatedAt: number
  revision: number                            // v2.0: 乐观并发
  brief: WritingBrief
  evidencePool: EvidencePool
  agenda: AgendaDoc
  telemetry: {
    calls: LLMCallRecord[]
    userActions: UserActionEvent[]            // v2.0 §3.12
  }
  status: 'active' | 'archived' | 'exported'
  exportedPath?: string
}
```

### 7.4 P3 Agenda User Prompt 模板 (完整)

```
你正在为以下写作任务生成议程。

## 写作契约
intent: {brief.intent}
genre: {brief.genre}
length: {brief.length} (目标总字数: {targetTotal})
tone: {brief.tone.join(', ')}
audience: {brief.audience}
constraints:
{brief.constraints.map(c => '- ' + c).join('\n')}

## 加载的 Skills (文体说明书, 冲突已按 §3.2.2 解决)
{brief.skills.map(s => `### ${s.name} (${s.priority})\n${getSkillSummary(s.name)}`).join('\n\n')}

## 证据池摘要
总计 {pool.items.length} 条, 按镜头分布: L{pool.byLens.L.length} M{pool.byLens.M.length} W{pool.byLens.W.length} S{pool.byLens.S.length} E{pool.byLens.E?.length || 0}

证据列表 (id | lens | title | snippet 首 120 字):
{pool.items.map(e => `${e.id} | ${e.lens} | ${e.title} | ${e.snippet.slice(0, 120)}`).join('\n')}

## 用户钉住的证据 (优先使用)
{brief.pinnedEvidenceIds.join(', ') || '(无)'}

## 你的任务
输出一个 AgendaDoc JSON 对象, 严格符合系统提示词中的 schema。要求:
1. sections 数量: length=short 2-3 节, medium 3-5 节, long 5-8 节, xlong 8-12 节
2. 每节 targetLength 之和 ≈ {targetTotal} 字 (±15%)
3. 每节 evidencePocket 至少 1 条, 不超过 8 条, 分配时考虑内容相关性
4. 每节 skillHints 从加载的 skills 中选 0-2 个, 仅在真正适用于本节时才填
5. openingStance 要贯穿全文, closingCall 要呼应 openingStance
6. heading 用简洁中文, 不超过 20 字

只输出 JSON, 不输出任何解释文字。
```

### 7.5 P4 Compose (Draft) User Prompt 模板 (完整)

```
你正在为以下议程的第 {section.order} 节草起正文。

## 全文立意
{agenda.openingStance}

## 本节议程
heading: {section.heading}
intent: {section.intent}
targetLength: {section.targetLength} 字 (±10%)

## 邻接上下文 (滑动窗口: 仅前一段尾 + 后一段 intent, 不注入前 N 段摘要链, 避免窗口膨胀)
前一节 ({prev.heading}) 的最后 3 句:
{prev.tailSentences}

后一节 ({next.heading}) 的 intent:
{next.intent}

## 本节证据池 (只允许引用这些 id)
{section.evidencePocket.map(eid => {
  const e = pool.items.find(x => x.id === eid)
  return `[${e.id}] (${e.lens}) ${e.title}\n${e.snippet}`
}).join('\n\n---\n\n')}

## 本节适用的 Skills (文体约束, 不可直接引用)
{section.skillHints.map(name => getSkillInstructions(name, 800)).join('\n\n---\n\n')}

## 契约约束
genre: {brief.genre}
tone: {brief.tone.join(', ')}
constraints:
{brief.constraints.map(c => '- ' + c).join('\n')}

## 你的任务
输出纯 Markdown 正文, 字数 {section.targetLength} ±10%。
引用使用 `[^Lxx]` / `[^Mxx]` / `[^Wxx]` / `[^Sxx]` / `[^Exx]` 格式内嵌, 只能引用本节证据池中的 id。
不加小标题 (议程已提供)。不在段首重复前一节的最后一句。
不得杜撰证据 id, 不得编造数字 (Ground Check 将做 D\S 差集校验, 任何无源数字将触发 contested)。
直接开始正文, 不要任何元评论。
```

### 7.6 Ground Check 纯算法版 (Phase 2b+)

**v2.0 修正**: v1.0 的数字幻觉检测用"正则抽取数字 → 小模型验证", 但这是**拿不擅长事实核查的工具去核查事实** — LLM 自己生成的数字, 再问另一个 LLM "这数字有依据吗", 准确率不会高。v2.0 改为**纯算法实现**: 从 evidencePocket 的所有 snippet 中正则提取数字集合 `S`, 从 draft 中提取数字集合 `D`, 计算 `D \ S` 就是"无来源数字"。简单、确定性、零成本。

> 语义层面的"引用是否正确"(如 snippet 说的是 2023 年 12 月 CPI, 但 draft 里把它说成 2024 年 Q1 GDP) 这种深度核查**不在 Phase 2b 范围**, 留待 Phase 3+ 引入专用核查模型时再做; MVP/Phase 2 先守住"数字必须有源"这条硬底线。

```typescript
// src/services/studyRoom/groundCheck.ts
export type GroundCheckSeverity = 'error' | 'warning' | 'info'

export interface GroundIssue {
  kind: 'citation_missing' | 'citation_mismatch' | 'numeric_hallucination' | 'genre_violation' | 'length_deviation'
  severity: GroundCheckSeverity
  location?: { charStart: number; charEnd: number }
  message: string
}

export interface GroundCheckResult {
  status: 'pass' | 'warn' | 'fail'
  issues: GroundIssue[]
}

/** 纯算法 Ground Check, 0 次 LLM 调用 */
export function runGroundCheck(
  section: AgendaSection,
  draft: DraftOutput,
  pool: EvidencePool,
  brief: WritingBrief,
): GroundCheckResult {
  const issues: GroundIssue[] = []

  // 1) 引用存在性
  for (const cite of draft.inlineCitations) {
    if (!section.evidencePocket.includes(cite.evidenceId)) {
      issues.push({
        kind: 'citation_missing',
        severity: 'error',
        message: `引用 ${cite.marker} 不在本节 evidencePocket 中`,
      })
    }
  }

  // 2) 引用语义粗匹配 (Jaccard, 纯本地)
  //    对每个被引用标记周围 80 字的窗口和源证据的 snippet 做字符 2-gram Jaccard
  //    低于 0.15 标 warning (不阻断), 说明引用锚点和上下文关联弱
  for (const cite of draft.inlineCitations) {
    const item = pool.items.find(x => x.id === cite.evidenceId)
    if (!item) continue
    const ctx = extractContext(draft.body, cite.marker, 80)
    const j = jaccardBigram(ctx, item.snippet)
    if (j < 0.15) {
      issues.push({
        kind: 'citation_mismatch',
        severity: 'warning',
        message: `引用 ${cite.marker} 的上下文与证据内容相关度低 (${j.toFixed(2)})`,
      })
    }
  }

  // 3) 数字幻觉 — 纯算法: D \ S 差集
  const numbersInDraft = extractNumbers(draft.body)
  const numbersInEvidence = new Set(
    section.evidencePocket.flatMap(id => {
      const item = pool.items.find(x => x.id === id)
      return item ? extractNumbers(item.snippet).map(n => n.value) : []
    }),
  )
  for (const num of numbersInDraft) {
    if (!numberHasSource(num, numbersInEvidence)) {
      issues.push({
        kind: 'numeric_hallucination',
        severity: 'error',
        location: { charStart: num.charStart, charEnd: num.charEnd },
        message: `数字 "${num.raw}" 在本节证据中找不到来源`,
      })
    }
  }

  // 4) 体裁违规 (规则表驱动, 正则本地匹配)
  const genreRules = GENRE_RULES[brief.genre] || []
  for (const rule of genreRules) {
    const m = draft.body.match(rule.pattern)
    if (m) {
      issues.push({
        kind: 'genre_violation',
        severity: 'warning',
        message: `${rule.name}: 匹配到 "${m[0]}"`,
      })
    }
  }

  // 5) 字数偏差
  const deviation = Math.abs(draft.wordCount - section.targetLength) / section.targetLength
  if (deviation > 0.4) {
    issues.push({
      kind: 'length_deviation',
      severity: 'info',
      message: `字数偏差 ${(deviation * 100).toFixed(0)}%`,
    })
  }

  const hasError = issues.some(i => i.severity === 'error')
  const hasWarn = issues.some(i => i.severity === 'warning')
  return {
    status: hasError ? 'fail' : hasWarn ? 'warn' : 'pass',
    issues,
  }
}
```

**关键辅助函数**:

```typescript
interface NumberMatch {
  raw: string              // "5.2%" / "126.06万亿" / "2023年" / "8,456元"
  value: number            // 规范化数值 (百分号变 0.052, "万亿" 扩成 1.26e13)
  unit?: string            // '%' | '元' | '年' | '万亿' | '人' | ...
  charStart: number
  charEnd: number
}

/**
 * 数字抽取: 匹配常见中英文数字+单位组合
 * 包含: 百分比 / 小数 / 千位分隔符 / 中文大数 (万/亿/万亿) / 年份 / 月份 / 日期
 */
export function extractNumbers(text: string): NumberMatch[] {
  const out: NumberMatch[] = []
  // 组合式正则, 顺序从严到宽
  const patterns: Array<{ re: RegExp; scale: (raw: string) => number; unit?: string }> = [
    // 百分比
    { re: /-?\d+(\.\d+)?\s*%/g, scale: s => parseFloat(s) / 100, unit: '%' },
    // 中文大数: 1.26万亿 / 500亿 / 3.2万
    { re: /-?\d+(\.\d+)?(?=(万亿|亿|万|千))(万亿|亿|万|千)/g, scale: normalizeChineseMagnitude },
    // 带千分位: 8,456 / 1,234,567
    { re: /-?\d{1,3}(,\d{3})+(\.\d+)?/g, scale: s => parseFloat(s.replace(/,/g, '')) },
    // 年份 / 月份
    { re: /(19|20|21)\d{2}\s*年/g, scale: s => parseInt(s, 10), unit: '年' },
    { re: /\b(1[0-2]|[1-9])\s*月/g, scale: s => parseInt(s, 10), unit: '月' },
    // 普通小数 / 整数 (放最后, 避免吃掉上面的捕获)
    { re: /-?\d+(\.\d+)?/g, scale: s => parseFloat(s) },
  ]
  const occupied = new Array(text.length).fill(false)
  for (const { re, scale, unit } of patterns) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0
      const end = start + m[0].length
      if (occupied.slice(start, end).some(Boolean)) continue  // 已被更具体的模式吃掉
      for (let i = start; i < end; i++) occupied[i] = true
      out.push({ raw: m[0], value: scale(m[0]), unit, charStart: start, charEnd: end })
    }
  }
  return out.sort((a, b) => a.charStart - b.charStart)
}

function normalizeChineseMagnitude(raw: string): number {
  const m = raw.match(/(-?\d+(?:\.\d+)?)(万亿|亿|万|千)/)
  if (!m) return NaN
  const base = parseFloat(m[1])
  const scale = { '千': 1e3, '万': 1e4, '亿': 1e8, '万亿': 1e12 }[m[2]] ?? 1
  return base * scale
}

/**
 * 判断 draft 中的一个数字是否在证据数字集合里找到来源。
 * 策略:
 *   - 年份 / 月份类: 要求证据集合含完全相等的数值
 *   - 其他数值: 允许 ±1% 容差 (LLM 可能会保留不同精度, 如 5.2% 和 0.0518 都算命中)
 */
function numberHasSource(target: NumberMatch, evidenceValues: Set<number>): boolean {
  if (!Number.isFinite(target.value)) return true  // 解析失败不误报
  if (target.unit === '年' || target.unit === '月') {
    return evidenceValues.has(target.value)
  }
  for (const v of evidenceValues) {
    if (v === target.value) return true
    if (v !== 0 && Math.abs((target.value - v) / v) < 0.01) return true
  }
  return false
}

/** 字符 2-gram Jaccard, 对中文稳健, 不需分词 */
export function jaccardBigram(a: string, b: string): number {
  const grams = (s: string) => {
    const clean = s.replace(/\s+/g, '')
    const g = new Set<string>()
    for (let i = 0; i < clean.length - 1; i++) g.add(clean.slice(i, i + 2))
    return g
  }
  const A = grams(a), B = grams(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}

/** 在 body 中定位 marker, 向左右各取 radius 字作为上下文窗口 */
export function extractContext(body: string, marker: string, radius: number): string {
  const idx = body.indexOf(marker)
  if (idx < 0) return ''
  return body.slice(Math.max(0, idx - radius), Math.min(body.length, idx + marker.length + radius))
}

// 体裁规则表 (MVP 覆盖 6 种体裁, custom 不注册规则)
const GENRE_RULES: Record<GenreHint, Array<{ name: string; pattern: RegExp }>> = {
  report:   [
    { name: '避免第一人称', pattern: /我觉得|我认为|我想/ },
    { name: '避免口语词',   pattern: /特别特别|超级|真的很/ },
  ],
  memo:     [{ name: '避免第一人称', pattern: /我觉得|我认为/ }],
  essay:    [],
  letter:   [],
  tutorial: [{ name: '应使用祈使语气', pattern: /^(可能|也许|大概)/m }],
  novel:    [],
  custom:   [],
}
```

**性能保证**:
- 纯本地运算, 典型 3000 字段落 + 50 条证据在 Chromium V8 下 <20ms
- 0 次 LLM 调用, 0 次网络请求
- 可在段完成 `drafting` 时立即同步触发, 不需要 async 排队

**触发路径**:
- Phase 2b+ 的 `done` → `grounded/contested` 转换由 `runGroundCheck` 的返回状态决定:
  - `pass` / `warn` → `grounded`
  - `fail` → `contested` (UI 段卡片上方展示 issues 列表, 提供 [重写] / [忽略并锁定] 按钮)

### 7.8 与主 Agent 工具的隔离声明

本设计**刻意不让自习室成为主 Agent 的一个工具**, 理由:

1. 主 Agent 的 ReAct 循环追求"工具调用-观察-反思"的闭环, 而写作是开放式创作, 两者控制流冲突
2. 主 Agent 的每次工具调用都是"无状态"的, 而写作 session 是长生命周期的有状态流程
3. 如果把自习室做成工具, LLM 会以自己的意图调用它, 而不是用户主动发起, 这会让用户失去对写作过程的掌控感

**但两个系统有清晰的互操作协议**:

- 主 Agent 可以通过**启动命令**打开自习室: "帮我用自习室写一份 XX 报告" → 主 Agent 构造 WritingBrief → 切换视图到自习室 → 交接
- 自习室产出的文档归档到 `DunCrew-Data/documents/`, 主 Agent 的 `readFile` 工具可以读取
- 自习室回写的 `l1_memory` 会被主 Agent 的下一次 Memory Lens 自然召回

### 7.9 不做的事 (Non-goals)

- 不做**多人协同编辑** (单机单用户, 不引入 CRDT 或 OT)
- 不做**版本分支** (回滚只有线性历史, 不是 git 分支)
- 不做**富文本编辑** (只输出 Markdown, 不支持图文混排控件)
- 不做**实时多 Agent 写作** (本期不实现 "辩手/编辑/读者" 多角色协作, 留到未来迭代)
- 不做**跨 session 上下文共享** (每个 session 独立, 不做长程记忆)
- 不做**自动发布** (不集成博客/飞书/语雀 API, 产物只落到本地 documents/)

---

## 8. 对话式协同写作 (Conversational Co-Writing)

> 这一章回应了 "写作必须是对话式推进" 的核心诉求。
>
> §3 描述的四环流水线是**骨架** (数据流与状态机), §8 描述的是**血肉** (人机如何持续对话驱动骨架)。两者缺一不可 — 只有骨架是"一次成稿再也改不动", 只有对话是"聊天跑偏无产出"。

### 8.1 设计原则

**议程和段落都是对话的对象, 而不是一次生成就冻结。** 用户对自习室说的每一句话, 都应该:

1. 明确其**意图归属** (改议程 / 改某段 / 补证据 / 问问题 / 导出)
2. 精确落到**单一作用域** (全局 / 某节 / 某段 / 某句)
3. 产生**可回溯的变更** (revision + 1, 旧版本留痕)

我们把这条对话通道叫 **WriterChat** — 它不是主 Agent 的聊天, 也不是通用 Copilot。它是专为本会话写作上下文设计的指令入口。

### 8.2 WriterChat 侧栏

WriterChat **占据右栏的下半部分** (上半是 Telescope 证据池), 或用户可切换为全屏侧栏。UI 规格 (v2.0):

```
┌─ Telescope Panel ──────────────┐
│ [L][M][W][S][E]  搜索栏          │  ← E = 粘贴板 (Phase 3+), 无 F
│ ... 证据列表 ...                 │
├────────────────────────────────┤
│ ◉ WriterChat                    │
│ ─────────────────────────────── │
│ 用户: 把第二段再写长一点, 加上   │
│       2023 年 GDP 数据           │
│  · 识别为 [rewrite_section]     │
│  · 作用域: §2 (现象)             │
│  · 自动补采: L+W 镜头搜"GDP"    │
│  · confidence: 0.91             │
│  ▸ [执行] [调整] [取消]          │
│    (信任模式开启时直接执行 +     │
│     3s 撤销浮条)                 │
│                                 │
│ 助手: 已补采 3 条证据(W12/W15/   │
│       L33), 已追加到 §2 pocket   │
│       正在重写 §2...             │
│  ▸ 段落原地流式中 (见 §2 卡片)   │
│                                 │
│ 用户: @report-style 语气太严肃  │
│  · 识别为 [tweak_tone + skill]  │
│  · 作用域: 全局 brief.tone       │
│  · 附加 skill: report-style      │
│  ▸ [执行] [调整] [取消]          │
│ ─────────────────────────────── │
│ [输入指令...]         [∧历史][⚙] │
└────────────────────────────────┘
```

**关键机制**:

- 每条用户指令先由 **Intent Dispatcher** (§8.3) 解析出 **IntentCard** (含 confidence)
- **信任模式关闭**: IntentCard 以气泡形式弹出, 用户点 [执行] 才真正执行 — 避免"误伤全局"或"理解错意图就开始改"
- **信任模式开启** (§8.8): `confidence ≥ 0.85` 且非高风险 Intent 直接执行 + 3s 可撤销浮条, 高频编辑场景零摩擦
- [调整] 允许用户修正作用域 (如 "不, 是改第三段不是第二段")
- 支持 `@mention` (§8.9): `@skill:xxx` / `@dun:xxx` / `@entity:xxx` 在输入框触发下拉, 复用 `src/components/ai/MentionDropdown.tsx`
- 历史对话沉淀到 `study_chat_turns` 表 (§3.8.2), **不注入 LLM 的生产 prompt** (Dispatcher 只读最近 3 条结构化 Intent, 避免噪音污染)

### 8.3 Intent Dispatcher (意图分派器)

所有用户指令都经过一次**轻量 LLM 分类**, 产出结构化 Intent:

```typescript
// v2.0 修正: 移除所有 file/shelf 相关 Intent (F 镜头已移出路线图, §10 已降级为粘贴板)
// 新增: draft_section / focus_section / skill_mention / skill_remove / scratchpad_paste /
//       toggle_trust_mode / toggle_quick_mode / escalate_to_full / contribute / pin/unpin_evidence

type WriterIntent =
  // Compose 类 (P4 原语)
  | { kind: 'draft_section'; sectionId: string; hint?: string }                                        // [P1] 首次草起
  | { kind: 'rewrite_section'; sectionId: string; instruction: string; scope: 'full' | 'range'; charRange?: [number, number] }  // [P1]
  | { kind: 'continue_section'; sectionId: string; hint?: string }                                    // [P2a]
  | { kind: 'expand_section'; sectionId: string; deltaLength: number; angle?: string }                // [P2a]
  | { kind: 'compress_section'; sectionId: string; targetLength: number }                             // [P2a]
  | { kind: 'polish_section'; sectionId: string; focus?: 'tone' | 'clarity' | 'density' }             // [P2b]
  | { kind: 'lock_section'; sectionId: string }                                                        // [P2b]
  // Agenda 类 (P3 原语)
  | { kind: 'revise_agenda'; instruction: string }                                                    // [P1] 对话驱动调整
  | { kind: 'add_section'; afterSectionId: string; heading: string; intent: string }                  // [P2a]
  | { kind: 'delete_section'; sectionId: string }                                                      // [P2a]
  | { kind: 'reorder_sections'; newOrder: string[] }                                                  // [P2a]
  | { kind: 'merge_sections'; sectionIds: string[] }                                                  // [P2a]
  | { kind: 'split_section'; sectionId: string; splitHint: string }                                   // [P2a]
  | { kind: 'regenerate_agenda'; keepDone: boolean }                                                  // [P2a]
  // Brief 类 (P1 原语重入)
  | { kind: 'revise_brief'; patch: Partial<WritingBrief> }                                            // [P2a]
  | { kind: 'tweak_tone'; target: 'global' | { sectionId: string }; direction: string }               // [P2a] "松一点/严谨一点"
  // Skills 类
  | { kind: 'skill_mention'; skillName: string; priority?: SkillRef['priority'] }                      // [P2a] @mention 触发
  | { kind: 'skill_remove'; skillName: string }                                                        // [P2a]
  // Evidence 类 (P2 原语)
  | { kind: 'supplement_evidence'; sectionId?: string; query: string; lenses?: LensKind[] }           // [P1]
  | { kind: 'pin_evidence'; evidenceId: string }                                                       // [P2a]
  | { kind: 'unpin_evidence'; evidenceId: string }                                                     // [P2a]
  | { kind: 'scratchpad_paste'; title?: string; content: string; sourceName?: string }                // [P3] E 镜头
  // UI / 模式类
  | { kind: 'focus_section'; sectionId: string }                                                       // [P1] 切段 (隐含 abort 当前)
  | { kind: 'toggle_trust_mode'; on: boolean }                                                         // [P2a]
  | { kind: 'toggle_quick_mode'; on: boolean }                                                         // [P2b]
  | { kind: 'escalate_to_full' }                                                                       // [P2b] Quick → Full
  // 问答 / 导出 / 回流
  | { kind: 'ask_question'; question: string }                                                         // [P1] 纯问答, 不动文档
  | { kind: 'export_document' }                                                                        // [P1]
  | { kind: 'contribute' }                                                                              // [P3] 触发 §12 知识回流
  | { kind: 'unknown'; raw: string }

interface IntentCard {
  intent: WriterIntent
  scopeDescription: string     // "§2 (现象)" / "全局契约" / "§3 第 4-7 句"
  plannedActions: string[]     // ["补采 L+W 镜头 3 条", "重写 §2", "触发 Ground Check"]
  estimatedCost: { llmCalls: number; tokens: number }
  confidence: number           // 0-1, 低于 0.6 强制用户确认, 高于 0.85 可走信任模式直接执行
}
```

**Dispatcher 调用** — 使用 §3.6 的 `callWritingLLM` (Phase 1 无 temperature 覆盖):

```typescript
import { callWritingLLM } from '@/services/studyRoom/writingService'

async function dispatchIntent(
  raw: string,
  attachments: WriterChatAttachment[],    // §8.9: @mention 带入的 skills/duns/entities
  session: StudySession,
  signal: AbortSignal,
): Promise<IntentCard> {
  const { content } = await callWritingLLM(
    [
      { role: 'system', content: INTENT_DISPATCHER_PROMPT },
      { role: 'user', content: buildDispatcherPrompt(raw, attachments, session) },
    ],
    { stage: 'dispatch', signal, maxTokens: 512, stream: false },
  )
  return parseAndValidateIntent(content, attachments, session)   // 解析失败走 §3.11 llm_response_invalid 降级
}
```

**Dispatcher 的上下文注入** (让它知道"哪段是哪段"):

- 议程大纲 (所有 section 的 id + heading + 当前状态)
- Brief 摘要 (genre + tone + 约束 + 当前加载的 skills 列表)
- 最近 3 条用户指令的 Intent (让"再改一点"这种指代成立)
- `attachments` (来自 @mention 的 skills / duns / entities / scratches)
- 当前 UI 焦点 (`focusedSectionId`)
- 粘贴板条目列表 (Phase 3+, 仅 id + title, 不含 content)

**不注入**:
- 段落正文 (太长, Dispatcher 只分类不写字)
- 完整 EvidencePool (Dispatcher 只关心"要不要补采", 不关心现有证据细节)
- 聊天历史的自然语言消息 (只用最近 3 条结构化 Intent, 防污染)

### 8.4 指代消解 (Reference Resolution)

用户说 "把刚才那段" / "上面那节" / "第二个要点" 时, Dispatcher 要能消解指代:

| 表达 | 消解规则 |
|------|---------|
| "这段" / "当前段" | 光标当前所在段 (UI 维护 `uiState.focusedSectionId`) |
| "上一段" / "前面那段" | focusedSectionId 的 order - 1 |
| "刚才改的段" | 最近一次 `rewrite_section` / `polish_section` 的 target |
| "第 N 段" / "第 N 节" | 按 order 排序 |
| "导言那段" / "关于 XX 的段" | 按 heading 模糊匹配 (Jaccard bigram, 见 §7.6) |
| "整篇" / "全文" | 全局作用域 |
| "这条证据" / "那条记忆" | 最近一次 `supplement_evidence` / `pin_evidence` 的 target, 或右栏选中的 EvidenceItem |
| "这段资料" / "刚粘的" | Phase 3+: 最近一次 `scratchpad_paste` 的 scratchId |

消解失败 (confidence < 0.6) 时, Intent Card 显示**待选项**:

```
⚠ 无法确定"那段"指的是哪一节, 请选择:
  ○ §2 现象 (刚才写过)
  ○ §3 机制 (光标所在)
  ○ 重新描述
```

### 8.5 指令执行生命周期

```
用户输入 raw (可含 @mention 产生的 attachments)
    ↓
[Dispatcher] → IntentCard (带 confidence)
    ↓
[TrustMode.decide] (§8.8)
    ├─ auto_execute (confidence ≥ 0.85 且非高风险)  → 直接执行 + 3s 撤销浮条
    └─ show_card                                    → WriterChat 弹卡片气泡
         ↓
         用户 [执行] / [调整] / [取消]
             ↓ 执行
[Intent Executor] → 调度具体原语:
  draft_section / rewrite_section / continue / expand / compress
                   → P4 Compose (流式, 默认温度)
  polish_section   → Phase 2b+ 的 polish 子阶段
  lock_section     → Phase 2b+: 段状态 → locked, 无 LLM 调用
  revise_agenda / regenerate_agenda / add_section / delete_section
                   → P3 Agenda (按 `keepDone` 决定是否保留已完成段)
  merge_sections / split_section / reorder_sections
                   → 本地 AgendaDoc 结构变更 + 标记受影响段 stale (P2a+)
  revise_brief / tweak_tone
                   → Brief patch + revision + 1 + 受影响段标 stale (P2a+)
  supplement_evidence
                   → P2 局部 Telescope (按指定 lenses 并行)
  pin_evidence / unpin_evidence / scratchpad_paste
                   → 本地 EvidencePool 变更, 无 LLM 调用
  skill_mention / skill_remove
                   → brief.skills 更新 + §3.2.2 冲突检测
  focus_section    → `abortManager.abortIfActive(当前段)` + 聚焦新段
  toggle_trust_mode / toggle_quick_mode
                   → 本地 UI 切换, 写入 userActions 遥测
  escalate_to_full → 当前 Quick session 的 brief.metadata.quickMode=false + 触发 P2 全量采集 + P3 议程
  ask_question     → 单次 `callWritingLLM` 问答, 不改文档
  export_document  → §3.8.5 归档流程
  contribute       → §12 Contribution Pipeline (Phase 3+)
    ↓
动作完成 → 在 WriterChat 以助手气泡汇报结果 (§8.11 错误走 WritingError 模板)
    ↓
如果产生段落变更 → 触发 §9 的 Live Paragraph Rendering
```

### 8.6 INTENT_DISPATCHER_PROMPT (系统提示词, v1.0)

```markdown
# INTENT_DISPATCHER_PROMPT v1.0

你是 DunCrew 自习室的指令分派器。你的唯一职责是把用户的自然语言指令分类为结构化 WriterIntent, 绝不写文档正文, 绝不做创作。

## 上下文

你会收到:
- 当前议程 (sections 的 id / heading / order / status)
- Brief 摘要 (genre / tone / length + 当前加载的 skills)
- 最近 3 条用户指令的历史 Intent
- 来自 @mention 的 attachments (skills / duns / entities / scratches)
- 当前 UI 焦点 (focusedSectionId, 如果有)
- 粘贴板条目列表 (Phase 3+, 仅 id + title)

## 输出规范

返回 JSON 对象, 严格符合 §8.3 列出的任一 WriterIntent 变体:

```json
{
  "intent": {
    "kind": "rewrite_section",
    "sectionId": "sec-02",
    "instruction": "加入 GDP 数据并扩展到 600 字",
    "scope": "full"
  },
  "scopeDescription": "§2 现象",
  "plannedActions": ["L+W 镜头补采 GDP 相关证据", "P4 Compose 重写 §2"],
  "estimatedCost": { "llmCalls": 2, "tokens": 4500 },
  "confidence": 0.88
}
```

## 分派规则

1. **优先匹配精确动词**: "精修/润色/调语气" → polish_section; "改写/重写" → rewrite_section; "扩写/展开/写长一点" → expand_section; "压缩/砍短" → compress_section; "继续/接着写" → continue_section; "锁定/定稿" → lock_section
2. **指代消解**: 用 UI 焦点 + 最近 Intent 消解 "这段/那节/刚才的" (见 §8.4 消解表)
3. **作用域最小化**: 能落到单段就不扩到全局。"语气改一下" 如果在光标段里, 就是 `tweak_tone(target={sectionId})`; 如果在全局空白处, 才是 `tweak_tone(target='global')` 或 `revise_brief`
4. **证据类指令**: "加上 2023 数据" / "再搜一下这个" → `supplement_evidence`, 不是 rewrite; "把这段记下来" / "粘一下" → `scratchpad_paste` (Phase 3+)
5. **Skills @mention**: 输入中含 `@skillName` → 主 Intent + 附加 `skill_mention` (priority=primary); 输入 "移除/不用 xxx skill" → `skill_remove`
5. **问答 vs 改动**: 如果用户只是问 "这段为什么这么写" / "有哪些证据", 归为 ask_question, 不触发改动
6. **置信度门槛**: 如果指代无法明确, confidence < 0.6, 让 UI 弹选择器; 不要猜

## 你不做的事

- 不写任何段落正文
- 不判断指令的"好坏", 只分类
- 不主动补全用户没说的参数 (如果用户没说字数, 不要编造)
- 不调用任何工具

只输出 JSON。
```

### 8.7 对话历史与 Session 的关系

```typescript
interface ChatTurn {
  id: string
  timestamp: number
  userRaw: string
  intent: WriterIntent
  intentConfidence: number
  userDecision: 'executed' | 'adjusted' | 'cancelled'
  resultSummary?: string        // "已重写 §2, 字数 623, 引用 3 条"
  linkedRevision?: number       // 关联到 AgendaDoc.revision
}

// 追加到 StudySession
interface StudySession {
  // ... 原有字段
  chatHistory: ChatTurn[]       // 所有对话回合
}
```

**LLM prompt 中的注入策略** (非常关键, 避免噪音):

- **Dispatcher** 注入最近 3 条 Intent (用于指代消解)
- **Writer (P3/P4 原语)** **不注入**聊天历史 — 只注入当前任务的 Brief + EvidencePocket + 邻接段
- **WriterChat 的助手气泡**由执行结果模板渲染, 不走 LLM (节省 token, 保证事实)

### 8.8 信任模式 (Trust Mode) — Phase 2a+

**问题**: v1.0 每次对话操作都经 "LLM 分类 → IntentCard 展示 → 用户点击执行" 三步, 对连续调整五六段的高频编辑场景摩擦过大。

**方案**: 基于 `confidence` 的分级执行策略 + 可撤销浮条。

```typescript
// src/services/studyRoom/trustMode.ts
export type TrustDecision =
  | { mode: 'auto_execute'; undoWindowMs: number }   // 直接执行 + 撤销浮条
  | { mode: 'show_card' }                            // 走原 IntentCard 流程

const CONFIDENCE_AUTO = 0.85
const CONFIDENCE_CARD = 0.60
const UNDO_WINDOW_MS = 3000

// 一类高风险 Intent 永远走 Card, 不参与信任模式
const MUST_CONFIRM_INTENTS = new Set<WriterIntent['kind']>([
  'delete_section',       // 删节不可逆
  'merge_sections',       // 影响多节
  'regenerate_agenda',    // 全局重建
  'export',               // 出稿动作
  'escalate_to_full',     // 模式升级 (Quick → Full)
])

export function decide(intent: WriterIntent, confidence: number, trustOn: boolean): TrustDecision {
  if (!trustOn) return { mode: 'show_card' }
  if (MUST_CONFIRM_INTENTS.has(intent.kind)) return { mode: 'show_card' }
  if (confidence < CONFIDENCE_AUTO) return { mode: 'show_card' }
  return { mode: 'auto_execute', undoWindowMs: UNDO_WINDOW_MS }
}
```

**UI 呈现**:

- 顶栏有 "信任模式" 开关, 默认 **OFF** (首次使用用户明确开启, 避免意外)
- 开启后, `confidence ≥ 0.85` 且非高风险 Intent 直接执行:
  - 状态栏 3 秒浮现 `已重写 §2 [撤销 2.8s...]`
  - 3 秒内点 [撤销] → 调用 `trustMode.undo(turnId)`, 回滚 section 到上一个 revision
  - 3 秒后浮条消失, 变更定稿 (仍可走普通 rewrite 再改)
- `confidence 0.60-0.85` 走原 IntentCard 流程 (用户明确点 [执行])
- `confidence < 0.60` Intent Card 强制显示消解待选项 (见 §8.4)

**撤销栈** (仅信任模式):

```typescript
interface UndoEntry {
  turnId: string
  sessionId: string
  sectionId?: string
  beforeRevision: number       // AgendaDoc.revision 或 section.revision
  beforeSnapshot: string       // JSON 序列化的被修改对象
  expiresAt: number
}
// Zustand: studyRoomSlice.undoStack: UndoEntry[]
// TTL = 3000ms, 过期自动出栈; 最多保留 10 条
```

**可观测性**: 每次 `auto_execute` 路径触发, `UserActionEvent` 写入 `trust_mode_toggle: false` → `true` 切换; 每次 undo 写入 `action='draft_abort'` + `payload.confidence`, 供未来调整阈值。

### 8.9 Skills @mention 主动召唤 — Phase 2a+

**问题**: v1.0 Skills 只靠自动匹配 (§3.2.1), 用户没有"主动指派"通道。当用户清楚知道想用某个特定 Skill 时, 必须绕回 Intake 表单勾选, 无法在对话中即时切入。

**方案**: 复用 DunCrew 已有的 `@mention` 基础设施 (零造轮子)。

**现有基础设施** (调研 `src/components/ai/MentionDropdown.tsx` + `AIChatPanel.tsx` 确认):

- `MentionDropdown` 组件已支持 skill / mcp / dun 三类 mention, 导出 `closeMention` / `MentionState` / `detectMention`
- `AIChatPanel.tsx` 的 `handleMentionSelect` 流程把选中项作为 `attachments` 注入消息
- WriterChat 侧栏输入框直接复用这套 UI, 不新写下拉组件

**在自习室的语义**:

```typescript
// WriterChat 输入框检测 "@" 触发 MentionDropdown
// 用户选中一个 skill 后, 输入框渲染为 "@report-style 把第二段改得更严谨"
// 提交时带 attachments: [{ kind: 'skill', name: 'report-style' }]

export interface WriterChatAttachment {
  kind: 'skill' | 'dun' | 'entity' | 'file'
  id: string                 // skill.name / dunId / entityId / scratchId
  displayName: string
}

// Intent Dispatcher 读取 attachments 作为先验, 优先于自动匹配
function mergeSkillsFromMentions(
  brief: WritingBrief,
  mentions: WriterChatAttachment[],
): WritingBrief {
  const skillMentions = mentions.filter(a => a.kind === 'skill')
  const existing = new Set(brief.skills.map(s => s.name))
  const added: SkillRef[] = skillMentions
    .filter(m => !existing.has(m.id))
    .map(m => ({ name: m.id, source: 'mention' as const, priority: 'primary' as const }))
  return { ...brief, skills: [...brief.skills, ...added] }
}
```

**行为约定**:

- `@skill` 召唤的 skill **默认 priority = primary**, 覆盖自动匹配的结果
- 如果用户在一次对话里 `@` 了多个 skill, 按提及顺序分配 `primary / secondary / reference`
- 冲突检测 (§3.2.2) 仍然生效: `@政务写作 @评测报告风格` 会弹冲突警示, 并按 priority 保留 `政务写作`
- 被 `@` 的 skill 在 `brief.skills` 里持久化, 直到用户显式移除 (对话 "移除 @xxx" → `skill_remove` Intent, 或 Intake 面板点 ✕)
- 同样支持 `@dun:novel-master` 切换关联 Dun (影响 L 镜头加权, 见 §11); `@entity:ent-xxx` 钉图书馆实体
- **不支持** `@file:xxx` 直接召唤 (MVP 没有文件架; Phase 3 的粘贴板用 `@scratch:xxx`)

**UI 示例**:

```
[输入指令...  @report|
            ┌─────────────────────────┐
            │ ⚑ report-style          │
            │   政务报告风格           │
            │ ⚑ report-formal         │
            │   正式报告模板           │
            └─────────────────────────┘
```

选择后输入框变成:

```
[@report-style  把§2改得更严谨 ...]
 └─ 气泡标签, 可 ✕ 移除
```

提交后 IntentCard 显示:

```
识别为 [段级重写 + 临时启用 skill]
作用域: §2 现象
启用 Skills: report-style (primary, 新增)
▸ [执行] [调整] [取消]
```

### 8.10 对话中断与重入 — Phase 1 起

**与 §3.10 的关系**: §3.10 定义了 `StudyAbortManager` 的底层机制; §8.10 定义 WriterChat 层面的用户感知与对话回路。

**典型场景**:

| 场景 | 用户动作 | 系统行为 |
|------|---------|---------|
| 正在流式 §2, 用户想改 §1 | 点 §1 卡片 → Intent "focus_section" | `abortManager.abortIfActive('${sid}:draft:sec2')`; §2 状态回 `planned` 保留 `draftPartial`; 光标跳到 §1 |
| 正在流式 §2, 用户发新指令"改§3" | WriterChat 输入 "§3 再扩充 200 字" | Dispatcher 识别为 `rewrite_section(§3)`; 提示 "§2 正在流式, 执行此操作会取消 §2, 继续?" → 用户确认后 abort §2 + 开始 §3 |
| 流式过程中断网 | 网络恢复 | §3.10 的 `draftPartial` 扫描 → Composer 顶部浮条 "§2 上次在此中断 [继续 / 重来 / 丢弃]"; WriterChat 追加一条助手消息记录此次中断 |
| 用户主动取消某次重写 | 段卡片 [取消] | 同第 1 行; WriterChat 末尾助手消息 "已取消 §2 重写, 已保留 487 字片段" |

**ChatTurn 的中断记录**:

```typescript
// 追加字段
interface ChatTurn {
  // ... 原有字段
  execution: {
    status: 'pending' | 'running' | 'completed' | 'aborted' | 'failed'
    abortedAt?: number
    abortReason?: 'user_switch_section' | 'user_explicit_cancel' | 'network_lost' | 'superseded_by_new_intent'
    error?: { code: WritingErrorCode; message: string }
    partialOutputLen?: number   // 已产出字符数 (中断时)
  }
}
```

**重入语义**:

- 同一 Intent 的"再来一次"走**新 ChatTurn**, 不是同 turn 继续 — 保证每次尝试都可独立回溯
- `draftPartial` 续写视为新 ChatTurn, 但 `payload.continuedFromTurnId` 指向被中断的上一 turn

### 8.11 WriterChat 的 WritingError 集成 — Phase 1 起

**与 §3.11 的关系**: §3.11 定义了统一 `WritingError` 类型与分级降级策略; §8.11 规定这些错误在 WriterChat 对话流里的呈现。

**错误消息呈现**:

| 错误码 | WriterChat 助手消息模板 | 附加按钮 |
|--------|------------------------|----------|
| `llm_unavailable` | `⚠ LLM 暂时不可用 (第 ${attempt} 次重试中, 已写内容已保留)` | [重试] [复制全文] [检查 API 配置] |
| `llm_rate_limited` | `⏳ 模型被限流, 约 ${wait}s 后自动重试` | [立即重试] [取消本次] |
| `llm_response_invalid` | `⚠ 模型返回格式异常, 已降级接受原始文本 (段加黄色 badge)` | [重写本段] [查看原始输出] |
| `agenda_parse_failed` | `⚠ 议程解析失败, 已降级为单节占位议程, 请手动调整` | [手动编辑议程] [重新生成议程] |
| `evidence_not_found` | `已从正文移除失效引用 [^L99], 段状态不变` | [查看详情] |
| `section_conflict` | `✋ 检测到段冲突 (可能在其他地方被修改), 请选择保留哪个版本` | [保留当前] [使用远程] [合并查看] |
| `persist_failed` | `⚠ 磁盘保存失败, 变更已缓存到内存, 请及时导出备份` | [导出] [重试保存] |
| `archive_failed` | `⚠ 归档失败 (${reason}), 文档内容完整保留` | [下载 .md] [复制到剪贴板] [重试] |
| `user_aborted` | (静默, 不发助手消息, 只状态栏短提示) | — |

**关键不变量** (WriterChat 层面):

1. **任何错误**下, 错误消息都以助手气泡形式写入 `ChatTurn.execution.error` + `ChatTurn.resultSummary`, 用户后续可滚动回查
2. **LLM 调用错误** → 已写内容保留, 绝不清空 Composer
3. 错误消息**不注入到下一次 Dispatcher prompt**, 避免 "LLM 看到错误后尝试去解释/补救"
4. 高频重复错误 (同一错误码在 30s 内发生 ≥3 次) 自动降级为 Toast + 状态栏红点, 避免聊天流被错误刷屏

**与遥测的联动** (§3.12):

- 每个 `ChatTurn.execution.status !== 'completed'` 的结局都写入 `UserActionEvent`, `payload.error.code` 带错误码
- 未来设置页看板可统计"哪种 Intent 在哪种 Phase 最常失败", 用于 prompt / 算法迭代

---

## 9. 段落实时渲染协议 (Live Paragraph Rendering)

> 这一章回应了 "要有一个修改段落的渲染, 实时能看到" 的诉求。

### 9.1 设计目标

写作者对"笔的移动"极度敏感。Skills IDE 的 Diff 是"前后对比", 适合审核代码; 但写作者要的是**"看到 AI 此时在写哪个字"** — 这是一种创作临场感, 不能用 Diff 替代。

具体目标:

1. **原地性**: 段落不跳位不抖动, 旧内容被**原地替换**, 不是新开一块然后旧块消失
2. **流式粒度**: token 级增量, 不等整段完成
3. **可感知的改动区域**: 改写/扩写时, 新字用**淡黄底色淡入**, 未改字保持稳定
4. **可中断**: 任何时候用户可点 [停止] 或 [保留已生成部分]
5. **回滚**: 生成中途或完成后, 可一键回到执行前的段落内容

### 9.2 段落渲染状态机 (Rendering FSM)

独立于 §3.5 的业务状态机, 仅管 UI 渲染:

```
stable (稳态, 显示 polished/draft 正文)
    │ 收到 Intent 执行
    ↓
diffing (准备期, 200ms, 展示骨架+倒计时)
    │ 第一个 token 到达
    ↓
streaming (流式中)
    ├─ token in → 追加到 buffer, 重渲染 delta 区
    ├─ 用户点 [停止] → finalizing (保留已有)
    ├─ 用户点 [回滚] → rolling_back → stable (原内容)
    └─ LLM 结束 → finalizing
    ↓
finalizing (后处理: 解析引用标记 + 高亮改动区)
    │ 500ms 过渡
    ↓
highlighted (改动区高亮显示 3s)
    │ 3s 超时 或 用户点击段外
    ↓
stable
```

### 9.3 流式协议: LiveSegment Event Stream

WritingLLM 对 P4 Compose 长段生成返回 **流式事件**, 事件类型 (通过 `streamChat` 的 onToken 回调在前端组装):

```typescript
type LiveSegmentEvent =
  | { type: 'start'; sectionId: string; targetLength: number; expectedTokens: number }
  | { type: 'token'; text: string; index: number }        // 第 index 个 token, 追加
  | { type: 'citation'; marker: string; position: number } // 引用标记, 位置
  | { type: 'heartbeat'; elapsed: number }                 // 心跳, 无输出超过 3s 发一次
  | { type: 'end'; reason: 'complete' | 'stop' | 'error'; finalText: string; usage: Usage }
  | { type: 'error'; code: string; message: string }
```

**前端消费**:

```typescript
function consumeLiveSegment(events: AsyncIterable<LiveSegmentEvent>, section: AgendaSection) {
  const renderer = new LiveParagraphRenderer(section)
  for await (const ev of events) {
    switch (ev.type) {
      case 'start':
        renderer.beginDiff(section.draft || section.polished || '')
        break
      case 'token':
        renderer.appendToken(ev.text)   // 触发 React 局部 rerender
        break
      case 'citation':
        renderer.markCitation(ev.marker, ev.position)
        break
      case 'end':
        renderer.finalize(ev.finalText)
        break
      case 'error':
        renderer.abort(ev.message)
        break
    }
  }
}
```

### 9.4 原地替换算法 (In-Place Diff Highlight)

新旧两版段落要**对齐显示**, 改动区淡黄高亮:

```typescript
interface HighlightSpan {
  text: string
  kind: 'keep' | 'insert' | 'delete' | 'modify'
}

function computeInPlaceDiff(oldText: string, newText: string): HighlightSpan[] {
  // 使用 diff-match-patch 的 char-level diff
  // 然后合并相邻的 insert+delete 为 modify, 减少视觉碎片
  const chunks = diffMatchPatch(oldText, newText)
  return coalesceToSpans(chunks)
}
```

**渲染规则**:

- `keep` → 普通颜色, 无背景
- `insert` (新增) → 背景 `#fff9c4` (淡黄), 3s 后淡出为无背景
- `delete` (删除) → 流式期间用灰色删除线保留 0.8s, 然后消失 (给人"抹掉"的观感)
- `modify` → 背景 `#fff3cd` (淡橙), 3s 后淡出

**连续插入的防抖**:

流式期间每 200ms 最多触发一次完整 diff 计算, token 级增量直接追加到末尾 (因为增量必然是 insert at end)。只有在 `finalize` 阶段做完整 diff — 此时 LLM 可能改动了中间段落 (非末尾追加)。

### 9.5 LiveParagraphRenderer 组件

```typescript
interface LiveParagraphRendererProps {
  section: AgendaSection
  stream?: AsyncIterable<LiveSegmentEvent>   // 有流则进入流式模式
  onAccept: (finalText: string) => void
  onReject: () => void                        // 回滚到原文
  onStop: () => void                          // 停止生成, 保留当前
}
```

**状态切换期间的 UI**:

| FSM 状态 | UI 表现 |
|---------|--------|
| stable | 纯 Markdown 渲染, 无进度指示 |
| diffing | 段顶部出现 1px 蓝色进度条, 正文半透明 |
| streaming | 原文灰色淡出, 新文本 token-by-token 追加并黄底高亮, 右上角 "生成中 (▸ 停止)" |
| finalizing | 500ms 过渡动画: 整段背景一次性闪烁 |
| highlighted | 改动区淡黄, 右上角 [保留 ✓] [回滚 ↶] 两按钮, 3s 无操作自动保留并退回 stable |

### 9.6 作用域渲染 (Range vs Full)

Intent Card 的 `scope` 决定渲染范围:

- `scope: 'full'` — 整段进入流式
- `scope: 'range'` (改某几句) — 仅选中的字符范围进入流式, 段内其他部分保持 stable
  - 用户可在段落上拖选 + 右键 "改写选中"
  - 选中范围被替换为 placeholder `⋯⋯生成中⋯⋯`, token 流式填入

### 9.7 断联恢复

网络抖动导致 SSE 断流时:

- 心跳超时 10s → Renderer 进入 `streaming_stalled`, 上方出现红色提示 "连接中断, 已生成 XX 字"
- 用户可选 [重试续写] (把已生成部分作为 prompt 前缀喂回 LLM, 请求继续) / [保留已生成] / [放弃]
- 已生成的部分本地 localStorage 备份, 刷新不丢

### 9.8 成本控制

- 长段流式 (>1500 字) 默认开启
- 短段 (≤1500 字) 使用**伪流式**: 一次性拿到结果, 前端按 20ms/token 节流播放 — 体验一致, 但后端 API 只调一次, 更稳定

---

## 10. 证据粘贴板 (Evidence Scratchpad, E Lens) — Phase 3+

> **v2.0 重大降级**: v1.0 曾设计"资料架 + 第 5 镜头 F"支持 18+ 格式 (PDF/DOCX/XLSX/PPTX/OCR) 的本地文档解析与复制。v2.0 自查发现:
>
> 1. 18+ 格式解析依赖 pymupdf / python-docx / openpyxl / pytesseract 等重型后端能力, 是**独立的工程项目**, 复杂度不低于自习室本身, 不应绑定自习室交付
> 2. 当前 `server/handlers/parsers.py` 的现有能力**仅支持 multipart upload 触发**, 没有"按本地路径直读 + 增量缓存 + 块精取 + 本地 BM25/embedding 检索"这一整套, 全部都是空中楼阁
> 3. 强行把 F 镜头绑进自习室会让路线图膨胀数倍, 违反"单个 Phase 可独立上线"原则
>
> **v2.0 替代方案**: 自习室仅内置一个**极简的文本粘贴板** (Evidence Scratchpad, `E` lens), 满足"用户手头有研究片段想带入写作"的核心场景。PDF/DOCX 解析等能力**完全移出本路线图**, 作为未来独立的"文件解析基础设施"项目单独推进; 一旦该项目就绪, 粘贴板可平滑升级为当初的 F 镜头 (接口兼容)。

### 10.1 定位与能力边界

粘贴板是自习室的**单栏轻量 UI**, 挂在左栏 Agenda Panel 下方可折叠。用户把研究片段粘贴进来, 它们立即成为 EvidencePool 里的 `E` 类条目, 供议程分配与段内引用。

**Phase 3 仅支持**:
- 用户**手动粘贴**文本 (上限单条 8000 字符, 总上限 20 条/session)
- 拖入 `.txt` / `.md` 文件 (纯文本读取, 使用浏览器 `File.text()` API, 零后端依赖)

**Phase 3 不做**:
- PDF / DOCX / XLSX / PPTX / EPUB / ODT / HTML 解析 → 完全移出路线图
- 图像 OCR → 完全移出路线图
- 本地 BM25 / embedding 检索 → 完全移出路线图; 粘贴板内搜索用前端 `includes` 即可 (20 条规模不需要索引)
- 块精取 / 页码映射 / 表格精取 → 完全移出路线图
- "沉淀到图书馆" 一键入库 → 已由 §12 知识回流覆盖 (导出文档时整体回流)
- 转写复制 / 摘要复制 → 与 §8 的 `rewrite_section` / 对话式改写重复, 不单独实现

### 10.2 数据结构与 API

```typescript
// src/types.ts 追加
export interface ScratchpadItem {
  id: string                // 'scratch_xxx'
  sessionId: string
  title: string             // 默认取首行前 40 字, 可手改
  content: string           // 正文, ≤ 8000 字
  sourceName?: string       // 用户手填 (如 "XX 研究报告 p12")
  tags: string[]
  createdAt: number
}

// EvidenceItem 的 lens='E' 来源于此
```

**后端 API** (仅 2 个, 极简):

```
POST   /api/study/sessions/:sid/scratch    body: { title, content, sourceName?, tags? }
DELETE /api/study/sessions/:sid/scratch/:id
```

存储: 直接作为 `EvidencePool.items` 的一部分写入 `DunCrew-Data/study/{sid}/evidence.json`; 不建独立表 (规模小, 没必要)。

### 10.3 UI

```
┌─ 证据粘贴板 (E) ─────────────────┐
│ [+ 粘贴文本] [拖入 .txt/.md]      │
│ ─────────────────────────────── │
│ 📎 E1 · 研究片段 A (450 字)       │
│    源: XX 研究报告 p12            │
│    [预览] [引用到§..] [✕]         │
│ 📎 E2 · 市场调研备忘 (1200 字)    │
│    [预览] [引用到§..] [✕]         │
│ ...                              │
└──────────────────────────────────┘
```

**交互**:
- **粘贴**: 点按钮弹对话框 (title / content / sourceName / tags), 提交后即进入 pool 的 `E` Tab
- **拖入**: 拖 `.txt/.md` 到区域, 读取文本后同上 (超过 8000 字截断并提示)
- **预览**: 弹抽屉显示完整 content
- **引用到§..**: 下拉选 section, 把此 item 加入目标 pocket
- **✕**: 从 pool 移除, 已引用该条的段标记 `stale` (Phase 2a+) 或 Toast 警告 (MVP 已过)

### 10.4 E 类证据的引用语法与 Footnote

与 L/M/W/S 一致用 `[^Exx]` 格式。Footnote 渲染:

```markdown
[E1] **研究片段 A** (用户粘贴, 来源: XX 研究报告 p12)
     > 研究结果显示...(前 200 字预览, 可展开)
     粘贴于: 2026-04-23 10:42
```

### 10.5 与 Phase 2b+ 证据池的集成

- `lensScratchpad(brief)`: 直接读取当前 session 的 ScratchpadItem[] 转为 `EvidenceItem`, 无匹配/打分, 全部进入 pool (因为是用户显式添加的)
- `snapshotTldr` (§3.3): 粘贴板项的 tldr = content 首 200 字 + "..."
- 归档: `evidence.json` 中完整保留 content (粘贴板本身体量小, 全量保留不占空间)

### 10.6 升级路径 (未来)

当独立的"文件解析基础设施"项目就绪后:
- 粘贴板可演进为完整的"资料架": 拖入 PDF/DOCX 后调用新的 `POST /api/files/parse` 得到 ScratchpadItem 级片段, 多个片段共享 `sourceFileId`
- `EvidenceRef` 新增 `{ kind: 'file'; fileId; page?; range? }` 变体 (类型已在 §3.3 预留)
- UI 从"单栏列表"演进为"文件卡片 + 片段子列表"
- 所有 E 类引用在迁移脚本下自动升级为 `file` 引用

本章到此为止的所有设计, 在升级后**保持 100% 向前兼容**。

---

## 11. Dun 知识接入 (Dun Wiki Integration)

> 这一章回应了 "自习室要能调用 Dun 的知识" 的诉求。
>
> **核心决策: 只取 Dun 在图书馆中的 Wiki 实体, 不引入 Dun 的其他维度**。原因在 §11.1 展开。

### 11.1 为什么只取 Wiki

项目中 Dun 系统暴露了多维数据: `DunStats` (性能统计) / `DunCapabilityInfo` (能力关键词) / `DunArtifactInfo` (产出物索引) / `dun_xp` 记忆源 / 以及**图书馆中该 Dun 沉淀的 Wiki 实体** (通过 `WikiEntity.dunId` 关联)。

对写作场景做严格筛选:

| 维度 | 是否接入 | 原因 |
|------|---------|------|
| `WikiEntity` (dunId 过滤) | **✅ 接入** | 这是 Dun 在图书馆里沉淀的**结构化认知** (Entity + Claims + Evidence), 正是写作需要的 "可引用知识" |
| `DunCapabilityInfo` | ❌ 不接入 | 是"能力路由"元数据 (关键词 → 哪个 Dun 接手), 不是写作素材 |
| `DunStats` | ❌ 不接入 | 是性能统计 (任务数/成功率/工具用量), 对写作无意义 |
| `DunArtifactInfo` | ❌ 不接入 | 是产出物路径索引, 写作者需要用具体文件就走 F 镜头 (§10) 显式选 |
| `dun_xp` 记忆源 | ❌ 不接入 | 是 Dun 的"经验积分", 本质是成长日志碎片, 信噪比远低于 Wiki 沉淀; §3.3 M 镜头已明确剔除 |
| `duns/*/NEXUS.md` 定义文件 | ❌ 不接入 | 是 Dun 的身份描述, 不是知识; 若用户需要可通过 F 镜头手动加载 |

**一句话**: Dun 的"写作可用知识"其实**已经全部沉淀在图书馆了**, 所以 "Dun 知识接入" 本质是 "**L 镜头 + dunId 维度的加权**"。

### 11.2 如何确定当前 Dun

三种来源, 优先级从高到低:

1. **显式指定**: P1 Intake 表单中提供 "关联 Dun" 下拉 (可选), 显示 `getDuns()` 中所有 Dun 的 `id + label + emoji`; 用户选后写入 `brief.dunId`
2. **跨页面携带**: 主 Agent 在某个 Dun 上下文中说 "帮我用自习室写一份报告" → 主 Agent 在跳转时传 `activeDunId` 给 `studyRoomSlice`, 自动填入 Intake 表单 (可修改)
3. **未关联**: 默认 `brief.dunId = null`, L 镜头不做 Dun 加权, 走通用图书馆检索

### 11.3 L 镜头的 Dun 子视角实现

```typescript
async function lensLibrary(brief: WritingBrief): Promise<EvidenceItem[]> {
  // 1. 原始查询 + LLM 扩展查询并行
  const queries = [brief.intent, ...(await rewriteQueries(brief.intent, 2))]
  const raw = await Promise.all(queries.map(q =>
    fetch(`${getServerUrl()}/api/wiki/search?q=${encodeURIComponent(q)}&limit=30`).then(r => r.json())
  ))

  // 2. 合并去重
  const merged = dedupeById(raw.flatMap(r => r.results as WikiSearchHit[]))

  // 3. Dun 子视角加权
  if (brief.dunId) {
    for (const hit of merged) {
      if (hit.dunId === brief.dunId) {
        hit.score *= 2.0      // Dun 专属实体提权
      }
    }
  }

  // 4. 排序 + 取 top20 + Dun 专属 top6 保底
  const sorted = merged.sort((a, b) => b.score - a.score)
  const top20 = sorted.slice(0, 20)

  let dunSpecific: WikiSearchHit[] = []
  if (brief.dunId) {
    const dunOnly = sorted.filter(h => h.dunId === brief.dunId && !top20.includes(h))
    dunSpecific = dunOnly.slice(0, 6)   // 额外保底 6 条, 不占 top20 名额
  }

  // 5. 转为 EvidenceItem
  return [...top20, ...dunSpecific].map(hit => toEvidenceItem(hit, 'L'))
}
```

**为什么是加权 2.0 而不是硬过滤**:

- 写作经常需要**引用跨 Dun 的通用知识** (如 `paper-killer` Dun 写论文, 但要引用一个不属于任何 Dun 的通用术语)
- 硬过滤会让 L 镜头在小 Dun 场景下召回过少
- 2.0 加权能让 Dun 专属实体"抢占大多数名额", 同时保留通用实体的进入通道
- 额外的 top6 Dun 专属保底是"安全网": 即使加权后被挤出 top20, 至少还有 6 条 Dun 专属结果必然入 pool

### 11.4 UI 呈现

**Intake 表单**:

```
┌─ 新建会话 ─────────────────────────┐
│ 意图: [写一篇关于...              ]  │
│ 体裁: [报告 ▾]  字数: [medium ▾]    │
│ 关联 Dun (可选):                     │
│   [⚙ 无 ▾]                          │
│   ▸ 🔍 competitive-analyst           │
│   ▸ 📖 novel-master                  │
│   ▸ 📝 paper-killer                  │
│   ▸ ⚖ private-lawyer                 │
│   ▸ 📱 xiaohongshu-writer            │
│   ▸ ☯ zhouyi-diviner                 │
│ 加载 Skills: [...]                   │
│ [创建会话]                           │
└─────────────────────────────────────┘
```

**Telescope 面板 L 镜头 Tab 的子分段**:

```
[L] 图书馆 (26)
  ├─ 🎯 Dun 专属 (8) ← 只在 brief.dunId 非空时展示
  │   · ent-paper-method (paper-killer)
  │   · ent-citation-style
  │   · ...
  └─ 🌐 通用 (18)
      · ent-2023-smb-confidence
      · ...
```

Dun 专属条目在卡片左上角加一个 🎯 角标, 颜色与该 Dun 的主题色一致, 让作者一眼知道"这条是从我当前 Dun 的积累里来的"。

### 11.5 Brief 类型增量

```typescript
// src/types.ts 追加到 WritingBrief
export interface WritingBrief {
  // ... 原有字段
  dunId?: string | null      // 关联的 Dun, 影响 L 镜头加权
}
```

### 11.6 Footnotes 标注

L 类 Footnote 如果命中 Dun 专属, 在源头标注中追加 Dun 归属:

```markdown
[L12] **论文研究方法论** (图书馆实体 · 🎯 paper-killer)
     > 实证研究应遵循...
     源: entity://ent-paper-method
     Dun: paper-killer
```

便于作者日后复查时知道"这条知识是我在哪个 Dun 的语境下沉淀的"。

### 11.7 `useStore` 依赖声明

自习室**不直接**调用 `DunManagerService` 的 `getDunStats / registerAllDunCapabilities / getArtifacts` 等方法。仅读:

- `useStore((s) => s.duns)` — 拿 `Map<string, DunEntity>` 以渲染 Intake 下拉
- `useStore((s) => s.activeDunId)` — 当用户是从主 Agent 某个 Dun 上下文跳转来的, 自动填入

所有 Dun 专属知识都通过**图书馆的 `/api/wiki/search`** 统一通道拉取, 一条数据只有一条进入路径 — 这符合 §1.2 的架构纪律。

---

## 12. 知识回流 (Knowledge Contribution)

> 这一章回应了 "最终采纳的文章, 应该给图书馆做贡献, 跑一次大模型, 按照图书馆的知识卡片 JSON 格式产出, 并更新到图书馆" 的诉求。

### 12.1 触发时机

知识回流**不是导出的必选步骤**, 而是一个**显式的独立动作**, 时机如下:

1. **导出归档对话框**: 用户点 [导出] 后, 对话框底部出现一个可选项 ☑ "提炼知识回流图书馆 (推荐)", 默认勾选
2. **事后补提炼**: 已归档的会话, 在 "最近会话" 列表每个卡片右下角有 🔁 按钮, 点击触发
3. **按段贡献** (Phase 3 进阶): 任一段被标记为 `locked` (用户明确锁定为终稿) 时, 弹出 toast "要立即把这段沉淀进图书馆吗?"

**不自动触发**的理由: 草稿阶段的内容不值得入库; 入库是对知识库的写入, 必须用户显式确认。

### 12.2 数据契约: 复用 `WikiIngestAction`

**核心决策: 复用 `src/services/knowledgeIngestService.ts` 中的 `INGEST_PROMPT` (v2, Entity-Claim-Evidence) 和 `WikiIngestAction` 类型, 不自造格式。**

这样做的好处:

- 与主 Agent 知识摄入管线**同构**, 图书馆看不出"来自自习室"和"来自主 Agent"的区别
- 后端 `/api/wiki/ingest` 路由无需改造
- `INGEST_PROMPT` 已经包含 Entity 去重判断 / Claim 冲突检测 / 粒度控制等精细规则, 无需重写

引用的类型 (来自 `knowledgeIngestService.ts` 已有定义):

```typescript
interface IngestEntity {
  id?: string            // 更新已有 entity 时提供
  title: string
  type?: string          // concept | topic | person | event | ...
  tldr?: string
  tags?: string[]
  slug?: string
}

interface IngestClaim {
  content: string
  type?: string          // metric | insight | pattern | fact
  value?: string
  trend?: string         // up | down | stable (仅 metric)
  confidence?: number
  evidence?: {
    source_name: string
    chunk_text?: string
  }
}

interface IngestRelation {
  target_title: string
  type: string           // related_to | contradicts | subtopic_of
  description?: string
}

interface WikiIngestAction {
  op: 'create' | 'update' | 'noop'
  entity?: IngestEntity
  claims?: IngestClaim[]
  relations?: IngestRelation[]
}
```

### 12.3 Contribution Pipeline (五步)

```
采纳的文章 (polished/locked 段落合集 + footnotes)
    │
    ▼
[Step 1] 段级拆分: 每个 polished/locked section 作为一个"知识单元"候选
    │
    ▼
[Step 2] 预获取 Entity 索引:
  GET /api/wiki/entities?dun_id={brief.dunId || ''}  → EntityIndexEntry[]
  (给 LLM 做去重判断)
    │
    ▼
[Step 3] 逐单元调 LLM (并行, 最多 3 并发):
  systemPrompt = CONTRIBUTION_PROMPT (基于 INGEST_PROMPT 微调, 见 §12.4)
  user msg    = {entity 索引 + 段落正文 + 段内 footnotes + brief 元信息}
  温度: 0 (确定性)
  输出: WikiIngestAction JSON
    │
    ▼
[Step 4] Contribution Review UI:
  把每个 action 渲染为可编辑卡片:
   - op (create / update / noop) 可切换
   - entity.title / tldr / tags 可编辑
   - claims 列表可增删改
   - relations 列表可增删改
  用户 [接受] / [修改] / [跳过]
    │
    ▼
[Step 5] 批量 POST:
  对所有 action === 'accepted' 的项:
    POST /api/wiki/ingest  (复用已有路由, body 见 knowledgeIngestService.postIngest)
  每条独立失败隔离, 汇总结果展示
    │
    ▼
写入 session.contribution 记录 + 触发图书馆 Store 刷新
```

**为什么要 Review 而不是直接入库**:

- 自习室文章可能包含**场景化的话语** (如"我认为"), 不适合直接变成 Claim
- LLM 提炼可能**粒度失当** (把一个大概念拆成多个小 Entity, 或反过来)
- 入库是对全局知识的写入, 用户必须有最终确认权
- Review UI 的代价很低 (卡片展示), 收益很高 (避免污染图书馆)

### 12.4 CONTRIBUTION_PROMPT (基于 INGEST_PROMPT 微调)

**不重写 `INGEST_PROMPT`**, 而是在调用时**前置追加**以下自习室专用说明:

```markdown
# 本次调用来自自习室 (Study Room) 的知识回流

你将处理一份已被用户采纳的文章段落。相比主 Agent 的常规 ingest, 本次:

1. **证据来源是确定的**: 段落内嵌了 `[^Lxx] / [^Mxx] / [^Wxx] / [^Fxx]` 引用标记, 对应 footnotes 中的具体源头 — 在生成 claims 时, evidence.source_name 必须精确到这些具体源头 (如 "2023年报.pdf 第5页" / "entity://ent-xxx")
2. **Dun 归属**: 本次回流关联的 Dun 是 `{brief.dunId || '无'}` — 如果 op=create, entity 应在后端写入时自动打上 dunId (后端路由支持), 你无需在 JSON 中输出 dunId
3. **体裁感知**:
   - genre=report/memo: 段落偏事实, 可提取 metric 和 fact
   - genre=essay: 段落偏观点, 提取 insight 要把"作者观点"标在 content 中 (如 "作者认为...")
   - genre=novel: op 默认为 noop (小说不是知识)
4. **段落的 heading 是强信号**: heading 常常就是 Entity 的候选 title
5. **粒度控制加强**: 一段话最多产出 1 个 Entity + 3 个 Claims; 如果一段涵盖多个概念, 只提取**最核心**的那个, 不要贪多

其余规则遵循 INGEST_PROMPT 的既有约束。

---

(以下接原始 INGEST_PROMPT 全文)
```

在 `contributionService.ts` 中, 通过简单字符串拼接即可:

```typescript
const systemPrompt = CONTRIBUTION_PREFIX + '\n\n---\n\n' + INGEST_PROMPT
```

### 12.5 UI: Contribution Review 面板

**入口**: 导出对话框勾选 "提炼知识回流图书馆" 后, 点 [下一步]; 或会话卡片 🔁 按钮。

**布局** (模态对话框, 800px 宽):

```
┌─ 知识回流审核 ──────────────────────────────────────┐
│ 文章: 《2023 年中小企业经营信心分析》                │
│ Dun: paper-killer                                   │
│ 总计 4 节 → 生成 3 个知识卡片 (第 4 节 noop)         │
│ ───────────────────────────────────────────────── │
│ ┌─ 卡片 1/3  ─ 来自 §2 现象 ─────────────────────┐ │
│ │ op: [create ▾]                                  │ │
│ │ title: [中小企业经营信心指数          ]          │ │
│ │ type:  [metric ▾]    tldr: [反映宏观...]        │ │
│ │ tags:  [经济, 指数, 中小企业]                    │ │
│ │ ─ Claims ────────────────────────────── [+新增] │ │
│ │ 1. 2023年12月环比上升0.8个点  [metric] ✎  ✕    │ │
│ │    evidence: 2023年12月指数报告                  │ │
│ │ 2. 连续三个月回升  [pattern] ✎  ✕               │ │
│ │ ─ Relations ─────────────────────────  [+新增] │ │
│ │ → related_to: 宏观经济景气指数                  │ │
│ │ [✓ 接受] [✎ 编辑后接受] [⊘ 跳过此卡]           │ │
│ └────────────────────────────────────────────────┘ │
│ ┌─ 卡片 2/3  ─ 来自 §3 机制 ─────────────── (折叠)┐│
│ └────────────────────────────────────────────────┘ │
│ ┌─ 卡片 3/3  ─ 来自 §5 建议 ─────────────── (折叠)┐│
│ └────────────────────────────────────────────────┘ │
│ ───────────────────────────────────────────────── │
│ [全部接受 (3)]  [批量跳过]  [关闭]                  │
└─────────────────────────────────────────────────────┘
```

**交互**:

- 每个卡片可折叠, 默认展开 top-3 (节数多时只展开 top-3, 减轻认知负担)
- 冲突预警: 若 LLM 判断 op=update 但用户改成 create, UI 红字警告 "这会导致与现有实体 XX 重复"
- Claim/Relation 的 evidence 字段不可手动改 (必须来自 footnote), 但可切换不同 footnote 作为引用
- [全部接受] 一键批量入库, 实时进度条

### 12.6 后端路由对接

**不新增路由**, 直接调现有 `POST /api/wiki/ingest` (`knowledgeIngestService.postIngest` 的目标)。

Body 格式与 `WikiIngestAction` 一致, 额外携带 `source_context` 字段标注回流来源:

```json
{
  "op": "create",
  "entity": {...},
  "claims": [...],
  "relations": [...],
  "_source": {
    "kind": "study_room",
    "sessionId": "study_xxx",
    "sectionId": "sec-02",
    "exportedPath": "documents/2026-04-23-smb-confidence/document.md"
  }
}
```

后端 `_source` 字段可选, 已有代码会忽略未知字段; 若后端愿意扩展, 可在 `wiki_ingests` 表加一列存 `source_kind='study_room'`, 用于后续审计 "这条知识是从哪篇文章来的"。

### 12.7 Contribution 记录

```typescript
interface ContributionRecord {
  sessionId: string
  exportedAt: number
  dunId: string | null
  totalSections: number
  generatedActions: number   // LLM 产出的非 noop action 数
  acceptedActions: number    // 用户最终接受的数
  skippedActions: number
  failedActions: Array<{ sectionId: string; error: string }>
  entitiesCreated: string[]  // 新建的 entity id
  entitiesUpdated: string[]  // 更新的 entity id
  llmTokensIn: number
  llmTokensOut: number
}

// 追加到 StudySession
interface StudySession {
  // ... 原有字段
  contributions: ContributionRecord[]   // 一个 session 可多次回流
}
```

展示位置: 会话卡片底部以徽章呈现 "📚 回流 3 条", 点击弹出详情面板。

### 12.8 失败处理

| 故障 | 缓解 |
|------|------|
| LLM 调用失败 (超时/网络) | 段级独立并发, 失败的段进入 retry 队列; 全部失败后允许用户重跑整个回流 |
| 返回的 JSON 解析失败 | 重试 1 次 (温度降到 0); 二次失败时该卡片标注 "LLM 输出不符合规范", 跳过 |
| `/api/wiki/ingest` 失败 | 逐条入库, 失败条加红色徽章 + 错误原因, 允许单独重试 |
| 用户全部跳过 | 记录 `contribution: { acceptedActions: 0 }`, UI 明示 "本次未贡献任何知识" |

### 12.9 反哺闭环

这是自习室设计上**最重要的闭环**:

```
图书馆知识 ─→ 自习室写作 ─→ 采纳的文章 ─→ LLM 提炼 ─→ 图书馆知识 (增量)
    ↑                                                           │
    └─── 下次写作时 L 镜头召回更丰富 ←─────────────────────────┘
```

用户每写一篇高质量文章, 图书馆就变得更智能; 下次写作时自习室召回的素材就更精准。这是自习室区别于一次性聊天的本质价值之一。

---

## 13. §7 附录的增量更新 (v2.0)

以下内容**以增量方式** patch 到 §7 附录中, 避免重复。v2.0 已移除全部 Source Shelf / F 镜头 / BM25 / 工期人日相关内容。

### 13.1 §7.2 文件清单增量 (v2.0 完整版见 §7.2 正文, 此处仅列出 §8-§12 引入的新增项)

```
src/components/houses/library/studyRoom/
├── WriterChat.tsx                 # §8 对话侧栏 (气泡 + IntentCard)                        [P1]
├── IntentCard.tsx                 # §8 意图确认卡片                                         [P1]
├── TrustModeIndicator.tsx         # §8.8 状态栏撤销浮条                                     [P2a]
├── LiveParagraphRenderer.tsx      # §9 流式原地渲染组件                                     [P1]
├── inPlaceDiff.ts                 # §9 diff-match-patch 封装                               [P1]
├── useLiveSegmentStream.ts        # §9 流式消费 hook (对接 llmService.streamChat)          [P1]
├── ScratchpadPanel.tsx            # §10 E 镜头粘贴板 UI (可折叠侧边面板)                     [P3]
├── ScratchItemCard.tsx            # §10 单条粘贴条目卡片                                    [P3]
├── DunLinkSelector.tsx            # §11 Intake 表单中的 Dun 关联下拉                         [P1]
├── ContributionReviewDialog.tsx   # §12 知识回流审核对话框                                  [P3]
├── ContributionCard.tsx           # §12 单个 Entity 卡片 (可编辑)                            [P3]
└── useContribution.ts             # §12 回流流水线 hook                                     [P3]

src/services/studyRoom/
├── intentDispatcher.ts            # §8 Intent Dispatcher + WriterIntent 解析                [P1]
├── trustMode.ts                   # §8.8 信任模式决策 + undo 栈                              [P2a]
├── referenceResolver.ts           # §8.4 指代消解                                           [P1]
├── contributionService.ts         # §12 回流主入口 (§12.3 五步流水线)                         [P3]
└── scratchpadService.ts           # §10 粘贴板增删 + 导出归档                                [P3]

duncrew-server.py 新增 SQLite schema (完整 DDL 见 §3.8.2):
├── study_sessions                 # 会话元数据
├── study_sections                 # 段级独立行, 支持乐观锁 + 乐观并发
├── study_evidence                 # 证据池, 含 snapshotTldr
├── study_chat_turns               # 对话回合 + 执行状态
├── study_user_actions             # §3.12 用户行为遥测
├── study_scratches                # §10 粘贴板 (Phase 3)
└── study_contributions            # §12 回流记录 (Phase 3)

v2.0 明确不引入 / 不创建的文件 (避免误实现):
- ❌ SourceShelf.tsx / ShelfFileCard.tsx / FilePreviewDrawer.tsx / CopyFromFileDialog.tsx / useSourceShelf.ts
- ❌ shelfService.ts
- ❌ skillBm25.ts / tokenizeZh.ts (BM25 改为 skillMatcher.ts 关键词包含)
- ❌ temperatureCurve.ts (温度曲线已移除, 等待底层 per-call override 能力)
- ❌ POST /api/study/files/*  (F 镜头全部路由)
- ❌ study_files 表
```

### 13.2 §7.3 类型导出清单 (v2.0)

以下类型均在正文各章给出定义, 此处仅列模块级导出清单, 方便其他模块 import:

```typescript
// 从 src/services/studyRoom/types.ts 导出 (正文见 §7.3 + §3.3 + §3.5)
export type GenreHint
export type ToneHint
export type LensKind                          // 'L' | 'M' | 'W' | 'S' | 'E'  (无 'F')
export type SectionStatus                     // 'planned' | 'drafting' | 'done'   — MVP 3 态
export type SectionStatusExt                  // Phase 2b+ 扩展: + 'polished' | 'locked' | 'grounded' | 'contested'
export interface SkillRef
export interface WritingBrief
export interface AgendaSection
export interface AgendaDoc
export interface EvidenceSnippet
export type EvidenceRef                       // 含 snapshotTldr (§3.3)
export interface EvidencePool
export interface DraftOutput
export interface StudySession
export interface UserActionEvent              // §3.12
export interface WritingError                 // §3.11

// 从 src/services/studyRoom/intentDispatcher.ts 导出 (§8)
export type WriterIntent                      // 所有 intent 变体联合, v2.0 完整清单见 §8.3
export interface IntentCard
export interface ChatTurn                     // 含 execution 子对象, §8.10
export interface WriterChatAttachment         // §8.9 @mention 携带

// 从 src/services/studyRoom/trustMode.ts 导出 (§8.8)
export type TrustDecision
export interface UndoEntry

// 从 src/services/studyRoom/liveSegment.ts 导出 (§9)
export type LiveSegmentEvent
export type RenderingFSMState                 // 'stable' | 'diffing' | 'streaming' | 'streaming_stalled' | 'finalizing' | 'highlighted' | 'rolling_back'
export interface HighlightSpan

// 从 src/services/studyRoom/groundCheck.ts 导出 (§7.6)
export interface GroundIssue
export interface GroundCheckResult
export function runGroundCheck(section, draft, pool, brief): GroundCheckResult
export function extractNumbers(text: string): NumberToken[]
export function jaccardBigram(a: string, b: string): number

// 从 src/services/studyRoom/skillMatcher.ts 导出 (§3.2)
export interface SkillMatchResult
export function matchSkillsByKeyword(intent: string, skills: Skill[]): SkillMatchResult[]
export function resolveSkillConflicts(picked: SkillRef[]): { accepted: SkillRef[]; rejected: Array<{ skill: SkillRef; reason: string }> }

// 从 src/services/studyRoom/abortManager.ts 导出 (§3.10)
export class StudyAbortManager
export interface AbortKey

// 从 src/services/studyRoom/telemetry.ts 导出 (§3.12)
export function recordUserAction(event: UserActionEvent): Promise<void>
export function flushTelemetry(sessionId: string): Promise<void>

// 从 src/services/studyRoom/scratchpadService.ts 导出 (§10)
export interface ScratchItem
export function addScratch(sessionId, content, meta): Promise<ScratchItem>
export function removeScratch(scratchId): Promise<void>

// 从 src/services/studyRoom/contributionService.ts 导出 (§12)
export interface ContributionRecord
// WikiIngestAction / IngestEntity / IngestClaim / IngestRelation 复用 knowledgeIngestService.ts 已有定义, 不重复导出
```

### 13.3 §7.4 ~ §7.5 Prompt 模板增量

**新增 INTENT_DISPATCHER_PROMPT** — §8.6 已给出完整内容。关键特性: `temperature=0`, `maxTokens=512`, 不注入段落正文, 只分类不创作。

**新增 CONTRIBUTION_PREFIX** — §12.4 已给出, 通过字符串拼接前置到 `knowledgeIngestService.INGEST_PROMPT` 之前:

```typescript
// src/services/studyRoom/contributionService.ts
import { INGEST_PROMPT } from '@/services/knowledgeIngestService'
const CONTRIBUTION_PREFIX = `# 本次调用来自自习室 (Study Room) 的知识回流 ...`   // §12.4 完整内容
const systemPrompt = CONTRIBUTION_PREFIX + '\n\n---\n\n' + INGEST_PROMPT
```

**Compose (P4) User Prompt 的证据引用约束** — 统一模板, v1.0 "quote_from_file / copy_from_file" 模板已随 F 镜头整体移除:

```
## 证据约束
- EvidencePocket 中每条 snippet 都带 id (形如 L12 / M03 / W05 / S02 / E07)
- 正文需要引用时, 在相应语句末尾追加 `[^Lxx]` / `[^Exx]` 等标记
- 不得编造证据 id, 不得杜撰未出现在 pocket 中的数据或引语
- 如需插入粘贴板 (E) 原文片段, 必须保留原文语义 (改写允许), 并保留 `[^Exx]` 标记
```

### 13.4 §6 风险表已在 v2.0 正文中合并为一张完整表 (共 18 行), 不再在此处二次追加。 v1.1 附录里列的 "Dispatcher 误分类 / SSE 中断 / 文件解析失败 / OCR 错字 / 路径泄露 / verbatim 版权 / 文件被 OS 删除 / Dun 加权过度 / 回流低质 / 回流冲突 / 小说误回流 / 回流失败影响导出" 等条目, 已分别并入 §6 或被 §10 粘贴板降级后整体移除。

### 13.5 §5 实现路线 (v2.0 终版, 不含人日估算)

v2.0 路线图按 **Phase 1 / 2a / 2b / 3** 四段式推进, 具体交付物见 §5 正文。每阶段的验收标准聚焦"用户可感知的端到端能力", 不绑定具体工期 — 项目由 AI 协作推进, 按批次产出, 工期由实际迭代节奏决定。

四阶段的新增原语覆盖度 (便于追溯):

| 阶段 | 新增 Intent 数 | 新增原语 | 新增镜头 | 新增能力 |
|------|--------------|---------|---------|---------|
| P1   | 7 (draft / rewrite / revise_agenda / supplement_evidence / focus_section / ask_question / export_document) | P1 Intake, P2 Telescope (L+S+M), P3 Agenda, P4 Compose | L / S / M | 对话式 MVP + 流式渲染 + 归档 |
| P2a  | +11 (continue / expand / compress / add_section / delete_section / reorder / merge / split / revise_brief / tweak_tone / skill_mention / skill_remove / pin / unpin / toggle_trust_mode) | 段编辑全集 + 信任模式 + @mention | + W | 对话式编辑加强 |
| P2b  | +4 (polish_section / lock_section / toggle_quick_mode / escalate_to_full) | Polish + Ground Check 纯算法版 | — | 精修 + 质检 + Quick/Full 双模 |
| P3   | +2 (scratchpad_paste / contribute) | E 镜头 + 回流 Pipeline | + E | 粘贴板 + 知识回流闭环 |

键盘快捷键 (四阶段累积):
- `Cmd+K` 聚焦 WriterChat 输入           — P1
- `Esc`   中止当前流式 / 关闭浮层           — P1
- `Cmd+Enter` 提交 IntentCard            — P1
- `Cmd+T`  切换信任模式                   — P2a
- `Cmd+Z`  撤销 trustMode 自动执行 (3s 内有效) — P2a
- `Cmd+Shift+V` 粘贴到粘贴板 E 镜头       — P3
- `Cmd+Shift+L` 触发 lock_section         — P2b

---

**文档结束 · v2.0 · WriterChat 为唯一主控 + 四类后台原语 + MVP 三态机 + 信任模式 + 粘贴板替代文件架 · 已删除 F 镜头 / BM25 / 温度曲线 / payload_json / 人日估算 · 待评审**
