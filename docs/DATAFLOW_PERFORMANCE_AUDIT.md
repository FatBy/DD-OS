# DunCrew 数据流断点与性能问题审计报告

> **审计时间**：2026-04-23
> **审计范围**：`src/services/LocalClawService.ts`（5187 行）、前端 Zustand store、`server/` 后端、记忆系统、上下文构建器
> **审计方法**：静态代码分析 + 关键路径追溯

---

## 目录

- [执行摘要](#执行摘要)
- [🔴 严重级：数据流断点](#-严重级数据流断点)
  - [1. buildDynamicContext 内部后端请求串行阻塞](#1-builddynamiccontext-内部后端请求串行阻塞)
  - [2. Context Refresh 丢失关键 Facts 数据](#2-context-refresh-丢失关键-facts-数据)
  - [3. pendingGeneMatches 跨工具泄漏导致错误归因](#3-pendinggenematches-跨工具泄漏导致错误归因)
  - [4. _loadAllDataPromise 防抖锁 5s 延迟造成幽灵数据](#4-_loadalldatapromise-防抖锁-5s-延迟造成幽灵数据)
  - [5. autoConnect 与 scheduleReconnect 双重重连路径冲突](#5-autoconnect-与-schedulereconnect-双重重连路径冲突)
  - [6. 后端 memory 写入无界线程泛滥](#6-后端-memory-写入无界线程泛滥)
- [🟡 中等级：性能陷阱](#-中等级性能陷阱)
  - [7. MAX_REACT_TURNS: 999 实际是无上限](#7-max_react_turns-999-实际是无上限)
  - [8. 消息历史只增不减，上下文无主动压缩](#8-消息历史只增不减上下文无主动压缩)
  - [9. contextCache 无淘汰策略（内存泄漏）](#9-contextcache-无淘汰策略内存泄漏)
  - [10. Zustand aiSlice 每次更新都克隆整个 Map](#10-zustand-aislice-每次更新都克隆整个-map)
  - [11. persistConversations 对每个对话独立发 HTTP](#11-persistconversations-对每个对话独立发-http)
  - [12. rankSkills 每次 build context 都全量 embedding](#12-rankskills-每次-build-context-都全量-embedding)
  - [13. startHeartbeat 15s 轮询打到重量级 /status](#13-startheartbeat-15s-轮询打到重量级-status)
- [🟢 次要问题](#-次要问题)
- [修复优先级建议](#修复优先级建议)
- [推荐修复顺序](#推荐修复顺序)

---

## 执行摘要

本次审计共发现 **17 个**可观测问题，按严重程度分为三级：

| 级别 | 数量 | 核心影响 |
|------|------|---------|
| 🔴 严重（数据流断点） | 6 | 用户体感卡顿、数据不一致、学习信号污染、OOM 风险 |
| 🟡 中等（性能陷阱） | 7 | Token 账单膨胀、长时间运行内存泄漏、重渲染卡顿 |
| 🟢 次要 | 4 | 边界条件风险、代码脆弱点 |

**核心结论**：
- `LocalClawService.ts` 单文件 5187 行，承担了连接管理、ReAct 循环、上下文构建、工具执行、Reflexion、Gene Pool、Context Refresh 等过多职责，已经成为**维护黑洞**。
- 前端 `buildDynamicContext` 的**串行 fetch**是用户体感延迟的最大来源之一（单次最长 40~60s）。
- `MAX_REACT_TURNS: 999` 配合升级机制，实际最多可跑 1059 轮，**存在 API 账单爆炸风险**。
- Zustand store 的 Map 全量克隆在 200+ 会话场景下会引起明显卡顿。

---

## 🔴 严重级：数据流断点

### 1. `buildDynamicContext` 内部后端请求串行阻塞

**位置**：`src/services/LocalClawService.ts:1570-1880`

**现象**：每次 ReAct 循环（包括每一轮对话）都会调用 `buildDynamicContext`，它内部**串行**发起大量 fetch 请求：

```
A0_wiki  ─► /api/wiki/search-render?q=...             (全局 Wiki)
A1_wiki  ─► /api/wiki/search-render?q=...&dun_id=...  (Dun Wiki)
A0_legacy─► readFileWithCache('knowledge/_index.md')
A1_legacy─► readFileWithCache('duns/{id}/knowledge/_index.md')
sopHints ─► /duns/{id}                                (SOP 内容)
Path B   ─► memoryStore.search × 2                    (L0 + Dun)
traces   ─► searchExecTraces                          (历史案例)
skills   ─► rankSkills                                (语义排序)
```

每个 `fetchWithTimeout` 超时为 **8s**，`sopEvolutionService.getContextHints` 又额外套了 **10s** 超时保护（说明历史上确实挂起过）。

**影响**：
- 正常场景：~2-5s 延迟
- 网络抖动：**单次用户输入要等 40~60s** 才进入主循环
- 用户体感：像"卡死"

**修复方案**：
```typescript
// 将无依赖的分区并行化
const [wikiGlobal, wikiDun, sopHints, memoryL0, traces, skills] =
  await Promise.allSettled([
    fetchWikiGlobal(userQuery),
    effectiveDunId ? fetchWikiDun(userQuery, effectiveDunId) : Promise.resolve(null),
    activeDunId ? withTimeout(sopEvolutionService.getContextHints(activeDunId), 10000) : Promise.resolve(null),
    memoryStore.search({...}),
    this.searchExecTraces(userQuery),
    rankSkills(userQuery, this.cachedSkills),
  ])

// 分区预算检查放到 resolve 之后统一做
```

**收益预估**：延迟从 40s 降到 8-10s（取决于最慢分区）。

---

### 2. Context Refresh 丢失关键 Facts 数据

**位置**：`src/services/LocalClawService.ts:3890-3920`

**现象**：V7 Context Refresh 阶段代码顺序有 bug：

```typescript
// 8. 重置 stale state
traceTools.length = 0                                          // ← 先清空
// 9. V8: 强制更新 Ledger Facts（escalation 时全量更新）
baseLedgerService.updateFactsFromTools(runId, traceTools)      // ← 用空数组更新
```

**影响**：
- 所有之前提取的 Facts 被**空数组覆盖**
- `_verificationCache` 与新 `traceTools.order` 索引错位
- Context Refresh 失去了"已完成工作"的结构化记忆，LLM 容易重复已完成的操作

**修复方案**：
```typescript
// 先 flush，再清空
baseLedgerService.updateFactsFromTools(runId, traceTools)
traceTools.length = 0
this._verificationCache.clear()  // 同步清理缓存
```

---

### 3. `pendingGeneMatches` 跨工具泄漏导致错误归因

**位置**：`src/services/LocalClawService.ts:3178-3195、3260-3275`

**现象**：在同一轮 LLM 响应中若有多个 `toolCalls`：

```
tc[0] = writeFile → 失败，Reflexion 注入基因 A/B/C → pendingGeneMatches = [A, B, C]
tc[1] = listDir   → 成功 → 闭环将 A/B/C 标记为 success ← 错误归因！
```

基因 A/B/C 是为 `writeFile` 失败场景注入的，但 `listDir` 成功与它们毫无关系。

**影响**：
- GenePool 学习数据被污染
- 无效基因获得"成功信号"，后续继续被注入
- 有效基因可能因巧合失败被降权

**修复方案**：
```typescript
// 按工具名键化，只在匹配工具再出现时闭环
private pendingGeneMatches: Map<string, GeneMatch[]> = new Map()

// 失败时
this.pendingGeneMatches.set(toolName, reflexionGeneMatches)

// 成功时
const matches = this.pendingGeneMatches.get(toolName)
if (matches) {
  // 闭环...
  this.pendingGeneMatches.delete(toolName)
}
```

---

### 4. `_loadAllDataPromise` 防抖锁 5s 延迟造成幽灵数据

**位置**：`src/services/LocalClawService.ts:1399-1410`

**现象**：
```typescript
private async loadAllDataToStoreDebounced(): Promise<void> {
  if (this._loadAllDataPromise) return this._loadAllDataPromise
  this._loadAllDataPromise = this.loadAllDataToStore()
  try {
    await this._loadAllDataPromise
  } finally {
    setTimeout(() => { this._loadAllDataPromise = null }, 5000)  // ⚠️ 5s 静默期
  }
}
```

**影响**：
- 技能安装/卸载完成后的 5 秒内，任何再次触发（如 `writeFile` 到 `skills/`）会直接 return 已 resolve 的 Promise
- 用户看到的 UI **不刷新**
- 代码中已出现这样的手动绕过（见 3454 行）：

```typescript
// 技能绑定是关键操作，清除防抖锁以确保立即刷新最新数据
this._loadAllDataPromise = null
await this.loadAllDataToStoreDebounced()
```

这种"在关键路径手动清锁"是典型的**设计坑兆征**。

**修复方案**：去掉 5s 延迟，改为"进行中去重"语义：
```typescript
private async loadAllDataToStoreDebounced(): Promise<void> {
  if (this._loadAllDataPromise) return this._loadAllDataPromise
  this._loadAllDataPromise = this.loadAllDataToStore()
    .finally(() => { this._loadAllDataPromise = null })  // 立即释放
  return this._loadAllDataPromise
}
```

---

### 5. `autoConnect` 与 `scheduleReconnect` 双重重连路径冲突

**位置**：`src/services/LocalClawService.ts:1116-1280`

**现象**：两套重连逻辑交错：
- `startHeartbeat` 检测断线 → 调 `autoConnect()`
- 某些路径仍然调 `scheduleReconnect()`
- 两个 `setTimeout` 都写到 `this._reconnectTimer`，**后者直接覆盖前者**
- 前一个 setTimeout 没有 clear，继续在 event loop 里跑

**影响**：
- 极端情况下同时有多个重连任务在排队
- `_reconnectAttempt` 计数错乱
- 日志里会出现"重连成功后又立即断开"的诡异行为

**修复方案**：
- 删除 `scheduleReconnect`，统一走 `autoConnect`
- 或者每次分配新 timer 前强制 `clearTimeout(this._reconnectTimer)`

---

### 6. 后端 memory 写入无界线程泛滥

**位置**：`server/handlers/memory.py:105-115、135-145、400-410`

**现象**：
```python
def handle_memory_write_batch(self, data: dict):
    # ... 批量写入 ...
    if HAS_HYBRID_SEARCH and _state._embedding_engine:
        for mid, content in written_ids:  # ← 可能有 100 条
            if content:
                threading.Thread(
                    target=index_memory_vectors,
                    args=(db, mid, content, _state._embedding_engine, _db_lock),
                    daemon=True,
                ).start()  # ← 无界创建线程
```

**影响**：
- 批量写 100 条 memory = **瞬间创建 100 个线程**
- Python GIL + SQLite `_db_lock` 的双重瓶颈，这些线程实际上**在排队消耗内存**
- 高并发下可能出现 `RuntimeError: can't start new thread`
- macOS 下线程数硬上限 ~2000，Linux 下进程 ulimit 限制

**修复方案**：
```python
# server/state.py
from concurrent.futures import ThreadPoolExecutor
_embedding_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='embed-idx')

# server/handlers/memory.py
_embedding_executor.submit(index_memory_vectors, db, mid, content, _state._embedding_engine, _db_lock)
```

---

## 🟡 中等级：性能陷阱

### 7. `MAX_REACT_TURNS: 999` 实际是无上限

**位置**：`src/services/LocalClawService.ts:154, 189-192`

```typescript
MAX_REACT_TURNS: 999,    // 无限制：让任务持续执行直到完成
DEFAULT_TURNS: 999,
// ...
ESCALATION: {
  EXTRA_TURNS: 20,
  MAX_ESCALATIONS: 3,    // 还能额外加 60 轮 = 最多 1059 轮
}
```

**影响**：
- LLM 陷入循环（错误签名去重只在同一轮 tc 间生效）
- 每轮一次 LLM 调用 + N 次 tool 调用
- **API 账单爆炸风险**：一次失败任务可能消耗 $5-$50

**修复方案**：
```typescript
DEFAULT_TURNS: 50,       // 合理上限
COMPLEX_TURNS: 100,      // 复杂任务上限
// 真正需要无限的场景使用 resume checkpoint 分段执行
```

---

### 8. 消息历史只增不减，上下文无主动压缩

**位置**：`src/services/LocalClawService.ts:2688`（FC 主循环）

**现象**：主 while 循环内 `messages.push(...)` 持续累积 tool 响应（单条最多 2500 字符），只有在 `onCompactNeeded` 被触发（API 溢出错误）时才压缩。

**影响**：
- 正常运行时完全不压缩
- 30 轮后 messages 数组通常 50KB+
- 每轮都作为 system+历史**全量发送**给 LLM
- **Token 成本与轮次数近似平方关系**

**修复方案**：每 10 轮或 messages 超过阈值时主动调用 `contextEngine.compact`：

```typescript
if (turnCount > 0 && turnCount % 10 === 0) {
  const estimatedTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : '') + 4,
    0
  )
  if (estimatedTokens > TOKEN_BUDGET * 0.6) {
    await contextEngine.compact({...})
  }
}
```

---

### 9. `contextCache` 无淘汰策略（内存泄漏）

**位置**：`src/services/LocalClawService.ts:2084`（`readFileWithCache`）

```typescript
private contextCache = new Map<string, { content: string; timestamp: number }>()
```

**现象**：
- `CACHE_TTL = 60000ms`，但代码**只在命中时检查过期**
- 从不 evict 过期条目
- 无 size cap

**影响**：长时间运行后会吃掉几百 MB（内置 SKILL.md、knowledge/、memory/*.md 全进来了）。

**修复方案**：简单 LRU（~30 行代码）或周期性清理：
```typescript
// 启动时
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of this.contextCache) {
    if (now - v.timestamp > this.CACHE_TTL) this.contextCache.delete(k)
  }
  // Size cap: 最多保留 50 条
  if (this.contextCache.size > 50) {
    const entries = [...this.contextCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
    for (let i = 0; i < entries.length - 50; i++) {
      this.contextCache.delete(entries[i][0])
    }
  }
}, 60_000)
```

---

### 10. Zustand aiSlice 每次更新都克隆整个 Map

**位置**：`src/store/slices/aiSlice.ts` （50+ 处 `new Map(state.conversations)`）

**现象**：
```typescript
set((state) => {
  const newConversations = new Map(state.conversations)  // ← O(N)
  newConversations.set(convId, {...conv, messages: [...]})
  return { conversations: newConversations }
})
```

**影响**：
- 每条流式 token / 每次工具结果都触发
- 200 个会话时，每次更新 = O(200) 分配 + GC 压力
- 流式消息场景每秒 20-50 次更新 → **明显卡顿**

**修复方案**（两选一）：

**方案 A**：引入 `immer` middleware（推荐，改动小）
```typescript
import { immer } from 'zustand/middleware/immer'
// 自动结构共享，代码可以直接 mutate
```

**方案 B**：把"当前活跃会话"从 Map 拆出来单独管理
```typescript
interface AiSlice {
  activeConv: Conversation | null  // 热路径
  conversationsMeta: Map<string, ConversationMeta>  // 冷路径（只存元数据）
  // ...
}
```

---

### 11. `persistConversations` 对每个对话独立发 HTTP

**位置**：`src/store/slices/aiSlice.ts:117-126`

```typescript
for (const conv of sorted) {
  localServerService.setData(`conv_${conv.id}`, conv).catch(() => {})
}
```

**影响**：
- 50 个会话 = 50 次独立 fetch POST
- 每次都全量 JSON 序列化
- 登录/迁移瞬间发 50+ 请求

**修复方案**：
- 新增后端接口 `POST /api/conversations/bulk-upsert`
- 或按 `updatedAt` diff 只推变化的

---

### 12. rankSkills 每次 build context 都全量 embedding

**位置**：`src/services/LocalClawService.ts:1935`

```typescript
const ranked = await rankSkills(userQuery, this.cachedSkills, 15, 0.25)
```

**现象**：
- 每次用户输入对 `cachedSkills`（可能 30+ 条）做语义相似度排序
- 技能 embedding 有预热缓存
- 但 **query embedding 每次都要重算**

**修复方案**：
1. Query embedding LRU 缓存（query → vector，size 100）
2. 先用 keyword 过滤把候选压到 ≤10 再上语义排序

---

### 13. startHeartbeat 15s 轮询打到重量级 /status

**位置**：`src/services/LocalClawService.ts:1209`

```typescript
this._heartbeatTimer = setInterval(async () => {
  const { ok } = await this.checkConnection()  // 调 /status
}, 15_000)
```

**现象**：`/status` 端点会触发多个 SQLite `COUNT(*)` 查询。

**修复方案**：新增超轻量 `/ping` 端点（只返回 `{ok:true}`），心跳改用。

---

## 🟢 次要问题

### 14. `_parseTextToolCalls` 三种格式非互斥匹配
三种 regex 依次跑，命中格式 1 后仍继续尝试。大 content 场景下是 O(3N) 而非 O(N)。

### 15. `errorSignatureHistory` 只增不清
循环内错误签名数组从不清理。长任务嵌套 resume 时会继承污染。

### 16. Python 后端 `do_POST` 同步读 body 无大小限制
```python
content_length = int(self.headers.get('Content-Length', 0))
body = self.rfile.read(content_length)...
```
恶意客户端传 `Content-Length: 10000000000` 会尝试分配 10GB buffer。应加 `MAX_BODY_SIZE = 50 * 1024 * 1024` 校验。

### 17. `flushPendingPersistence` 依赖引用共享的脆弱约定
```typescript
for (const [, data] of _pendingFlushData) {
  latestConversations = data  // 每次覆盖，依赖所有 data 指向同一 Map
}
```
当前能工作是因为所有 pending 都共享同一 `allConversations` 引用，但这是**隐式契约**，一旦有分支传不同 Map 就会丢数据。

---

## 修复优先级建议

| 优先级 | 问题编号 | 问题 | 影响 | 改造成本 |
|--------|---------|------|------|---------|
| **P0** | #1 | 串行 fetch | 每次输入 40s+ 延迟 | 中 |
| **P0** | #2 | Refresh 丢 Facts | 数据正确性 | 低 |
| **P0** | #7 | MAX_TURNS: 999 | API 账单爆炸 | 低 |
| **P1** | #6 | 后端无界线程 | OOM 风险 | 中 |
| **P1** | #8 | messages 不压缩 | Token 成本 | 中 |
| **P1** | #3 | Gene 错误归因 | 学习信号污染 | 中 |
| **P2** | #10 | Map 全量克隆 | 大会话数卡顿 | 高 |
| **P2** | #4 | 5s 静默期 | 偶发数据陈旧 | 低 |
| **P2** | #9 | 缓存无淘汰 | 长期内存泄漏 | 低 |
| **P2** | #5 | 双重重连冲突 | 连接状态错乱 | 低 |
| **P2** | #11 | 批量 persist N+1 | 迁移时卡顿 | 中 |
| **P3** | #12 | rankSkills 全量 | 输入延迟 | 低 |
| **P3** | #13 | 心跳打 /status | 后端开销 | 低 |
| **P3** | #14-17 | 边界 bug | 健壮性 | 低 |

---

## 推荐修复顺序

### 第一批（3 小时，立刻生效）
1. **#7 调低 MAX_REACT_TURNS** → 2 行改动，防账单爆炸
2. **#2 Refresh Facts 顺序 bug** → 3 行改动
3. **#4 loadAllData 静默期** → 5 行改动
4. **#16 后端 body size cap** → 5 行改动

### 第二批（1 天，体感显著提升）
5. **#1 buildDynamicContext 并行化** → 核心提速
6. **#9 contextCache LRU** → 内存曲线平稳
7. **#13 新增 /ping 轻量心跳**

### 第三批（2-3 天，长期健康）
8. **#6 后端 ThreadPoolExecutor**
9. **#8 主动压缩上下文**
10. **#3 pendingGeneMatches 按 toolName 键化**

### 第四批（需要重构评估）
11. **#10 Zustand immer middleware** → 引入依赖需测试
12. **LocalClawService.ts 拆分** → 5187 行拆为 6-8 个模块（连接/ReAct/上下文/工具/Reflexion/Gene/Trace）

---

## 附录：关键代码位置速查表

| 问题 | 文件 | 行号 |
|------|------|------|
| buildDynamicContext 串行 fetch | `src/services/LocalClawService.ts` | 1570-1880 |
| Context Refresh Facts bug | `src/services/LocalClawService.ts` | 3890-3920 |
| pendingGeneMatches | `src/services/LocalClawService.ts` | 3178-3275 |
| loadAllDataDebounced | `src/services/LocalClawService.ts` | 1399-1410 |
| autoConnect / scheduleReconnect | `src/services/LocalClawService.ts` | 1116-1280 |
| MAX_REACT_TURNS | `src/services/LocalClawService.ts` | 154 |
| contextCache | `src/services/LocalClawService.ts` | 2084 |
| messages 不压缩 | `src/services/LocalClawService.ts` | 2688 |
| rankSkills | `src/services/LocalClawService.ts` | 1935 |
| startHeartbeat | `src/services/LocalClawService.ts` | 1209 |
| aiSlice Map 克隆 | `src/store/slices/aiSlice.ts` | 全文 50+ 处 |
| persistConversations | `src/store/slices/aiSlice.ts` | 117-126 |
| 无界线程 | `server/handlers/memory.py` | 105-145, 400-410 |
| do_POST body 无限制 | `server/handler.py` | 291 |

---

**审计人**：Aone Copilot
**交付物**：本报告
**后续建议**：按推荐修复顺序分批实施，每批完成后 `npx tsc --noEmit` 验证。
