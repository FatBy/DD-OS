# Amendment ↔ Memory Supersede 对齐评审

> V10 记忆系统升级的配套评审文档。用于厘清"用户主动声明的偏好（Amendment）"和"系统自动识别的记忆（memory）"两套机制在查询时的协同规则，避免矛盾。

## 背景

DunCrew 存在两套相关但独立的偏好/事实追踪机制：

| 机制        | 来源                           | 存储                          | 触发           |
| ----------- | ------------------------------ | ----------------------------- | -------------- |
| Amendment   | 用户通过 UI **主动**声明的修正 | `store.amendments` + 后端同步 | 用户点按 UI    |
| Memory L0   | 执行后 Consolidator **自动**识别 | `memory` 表（SQLite）         | 每次 ReAct 结束 |
| Memory 三态 | V10 supersede 机制             | `memory.status` 字段          | LLM 判断事实变化 |

在 V10 升级前，这两套机制在 `buildDynamicContext` 中都注入到 LLM，但：

- Amendment 放在 `misc` 分区（最低优先级，预算紧时最先被截断）
- Memory L0 放在 `memory` 分区（中等优先级，永远会被注入）

**结果是**：用户在 UI 上明确声明"我改用 pnpm 了"，但如果 `memory` 里还有一条过期的"用户偏好 npm"没被 supersede，LLM 会优先看到 memory 层的陈述，反而忽略 Amendment。

## V10 对齐原则

**信任层级（从高到低）**：

```
1. 用户主动声明 (Amendment)         ← 用户在 UI 上明确说的
2. 用户主动声明 (SOUL.md edits)     ← 用户直接编辑 Soul 文件
3. 系统识别并 active 的 memory      ← Consolidator 写入的 L0
4. 历史 trace / exec_trace          ← 工具执行记录
```

**查询时的具体落地（buildDynamicContext 注入顺序）**：

| 顺序 | 内容                              | 分区       |
| ---- | --------------------------------- | ---------- |
| 0    | 指代消解提示 (anaphoraHint)       | identity   |
| 1    | SOUL.md 核心人格摘要              | identity   |
| 2    | **Amendment（V10 新位置）**        | identity   |
| 3    | Dun SOP + performance insight     | identity   |
| 4    | Wiki 全局知识（语义 top-5）       | memory     |
| 5    | L0 核心记忆（active status）      | memory     |
| 6    | Dun 最近记忆（保底）              | memory     |
| 7    | Traces / 历史成功案例             | traces     |
| 8    | Skills                            | skills     |
| 9    | 文件注册表 / 其他                 | misc       |

LLM 按 prompt 先后顺序形成"最早看到的内容权重更高"的隐式优先级，因此 Amendment 在 memory 之前，天然压过 memory 中的观察型陈述。

## 不统一存储的理由

评审时有人提议"让 Amendment 和 memory supersede 共享同一张表"。**不采纳**，理由：

1. **信任级别不同**：Amendment 是用户主动按下按钮的声明，memory supersede 是 LLM 判断的事实变化；把两者混在一起会让 LLM 无法区分权重。
2. **触发机制不同**：Amendment 只能用户手动改（审批/归档/权重调整）；memory supersede 由 Consolidator 自动触发。混存后手动/自动的边界会模糊。
3. **UI 交互不同**：Amendment 有专门的审批队列 UI（`SoulEvolutionHouse`），memory 只在 `MemoryHouse` 里展示。混存后 UI 要被迫支持两种交互流。

## 必须保证的"不矛盾"规则

V10 实现层已经保证下列规则（代码层 + 运行时）：

### 规则 1：Amendment 覆盖 memory 的同主题陈述

实现：注入顺序把 Amendment 放在 memory 前（本次 V10 改动）。
LLM 看到"用户偏好修正案 → pnpm"之后再看到 memory 里的"用户偏好 npm"，在 system prompt 的"前者压后者"规约下，会优先采信前者。

### 规则 2：Memory 中被 supersede 的条目永不注入

实现：后端所有 `SELECT ... FROM memory` 查询（包括 FTS5 / 向量 / by_dun / decay）都追加 `AND status = 'active'`（V10 已全部落地到 `server/db.py` / `server/handlers/memory.py` / `hybrid_search.py`）。

### 规则 3：Amendment 的状态变化不污染 memory 表

实现：Amendment 独立存储于 `store.amendments`，不与 `memory` 表双写。Amendment 的增删改完全走 `soulAmendmentSlice`，不经过 `memoryStore`。

### 规则 4：Consolidator 在写 memory 时不能与 Amendment 撞车

当前实现：Consolidator 的 LLM prompt 里已经注入了"相关已有记忆"（V10 P0-C-2），让 LLM 能判断 SUPERSEDE/CONFLICT/SKIP。但**尚未**注入 Amendment 列表，因此 Consolidator 可能写出与 Amendment 冲突的新 memory。

**结论**：此场景不是高频问题（Amendment 主要关于偏好类主题，Consolidator 主要沉淀行为模式），但作为**后续优化项**列在文末。

## 待优化项（非阻塞）

1. **Consolidator 注入 Amendment 摘要**：在 `buildConsolidationPrompt` 的 payload 里新增 `activeAmendments` 段，让 LLM 在写新 memory 时能看到用户已声明的偏好，避免写入冲突条目。优先级 P2.5，成本 ~20 行代码。
2. **memory.status='conflicted' 时，若冲突方已有 Amendment 覆盖，自动 resolve**：例如 memory 有两条冲突"偏好 npm" vs "偏好 pnpm"，此时 Amendment 明确说"用 pnpm"，可自动把后者升为 active、前者归档。这是数据清洁度优化，但容易误伤，建议人工复核。P3。
3. **UI 曝光**：在 `MemoryHouse` 的条目列表上，如果某条 memory 与某个 Amendment 主题一致，在 UI 上加一个 "↗ Amendment" 角标，让用户知道这条 memory 已被 Amendment 覆盖。P3。

## 验收要点

- [x] `buildDynamicContext` 中 Amendment 出现在 memory 注入之前
- [x] Amendment 原先在 `misc` 分区的注入已删除，避免重复
- [x] memory 查询一律带 `status='active'` 过滤
- [x] Amendment 的权重系统（hitCount + 时间衰减）保持原样，没被 memory supersede 机制替代
- [ ] （后续）Consolidator prompt 中增加 Amendment 段
