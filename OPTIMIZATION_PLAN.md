# DunCrew 性能优化计划

> 分析日期: 2026-05-14 | 修订: 2026-05-15

## 核心原则

1. **先测量，再动刀** — 在改结构前先埋 `performance.mark` 和轻量日志，量化基线
2. **问题不是"文件大"，而是启动路径把大依赖图一次性拉进来了** — App.tsx 顶层 import LocalClawService，后者顶层 `new LocalClawService()` 同步 import 40 个服务，首屏/HMR/StrictMode 副作用均被放大
3. **瘦 facade 优先于盲拆文件** — 如果拆完仍被入口同步 import，冷启动不会变快

---

## 一、启动慢的根因

### 1. 入口依赖图一次性展开

- `App.tsx` (line 22) 顶层导入 `localClawService`
- `LocalClawService.ts` 模块顶层 `export const localClawService = new LocalClawService()`
- 构造时同步拉入 40 个 import（ReAct、记忆、Dun context、知识编译等）
- Vite dev 模式下这意味着首屏要解析 ~270 个源文件的完整依赖图

### 2. 零代码分割 / 零懒加载

- `houseRegistry.tsx` (line 3-9) 同步导入所有 7 个 House 组件
- 项目中没有任何 `React.lazy()` 或动态 `import()`
- LinkStationHouse 等 100KB 级页面被首屏强制带上

### 3. App.tsx 初始化瀑布流

useEffect 中串行执行大量操作，且部分未做幂等 guard：
- `restoreLocalCacheToStore` — localStorage 读取 + JSON.parse
- `restoreLLMConfigFromServer` — HTTP 请求
- `localClawService.autoConnect(true)` — 网络轮询（最多 60 次重试）
- `soulEvolutionService.init()` — 异步初始化
- `loadLinkStation()` — 同步解析
- `setTimeout 3s` seed Dun fallback

---

## 二、运行不稳定的根因

### 1. /status 端点不够轻量

后端使用 `ThreadingHTTPServer`（多线程），但 `/status` 请求并非纯健康探针：
- 执行 list_files、计算工具列表、读取 embedding 状态
- 启动期有 embedding preheat、trace sync、wiki index 等后台线程竞争 GIL/IO
- 心跳 15s 间隔 + 超时 5s，在高负载启动窗口容易误判为断连

```typescript
HEARTBEAT_INTERVAL = 15_000        // 15秒轮询
HEARTBEAT_FAIL_THRESHOLD = 3       // 失败 3 次触发重连
RECONNECT_MAX_ATTEMPTS_FIRST = 60  // 首次启动重试 60 次
```

### 2. 全局 60 个 setTimeout/setInterval 分布在 22 个服务中

- 竞态条件（多个重连循环并发）
- 服务卸载时定时器未必全部清理
- 多个服务同时后台轮询造成 CPU/网络压力

### 3. StrictMode 是放大器，不是根因

开发模式下 Effect 双执行让初始化更混乱，但根治方案是让初始化幂等（每个 init 都有 guard），而非直接关闭 StrictMode。

---

## 三、测量基线（Step 0）

在动任何结构之前，先埋测量点：

```typescript
// App.tsx useEffect 顶部
performance.mark('app-init-start')

// autoConnect 前后
performance.mark('autoConnect-start')
// ...connected
performance.mark('autoConnect-end')
performance.measure('autoConnect', 'autoConnect-start', 'autoConnect-end')

// House 首次渲染
performance.mark('house-first-render')

// 后端 /status 响应时间（在 checkConnection 中）
console.time('[Perf] /status')
// ...fetch
console.timeEnd('[Perf] /status')
```

确认改完后能看到首屏模块加载和连接稳定性是否真正改善。

---

## 四、落地执行顺序

### Step 1: House 懒加载

**最快见效、风险最低。**

改动范围: `src/houses/registry.tsx`

```typescript
// Before
import { TaskHouse } from '@/components/houses/TaskHouse'

// After
import { lazy } from 'react'
const TaskHouse = lazy(() => import('@/components/houses/TaskHouse'))
```

同时在 `HouseContainer` 中包裹 `<Suspense fallback={<Skeleton />}>`。

预期效果: 首屏模块数减少 50%+，非活跃 House 不再阻塞加载。

---

### Step 2: 新增 /healthz 极轻量端点

**心跳只打这个；/status 保留业务信息但做缓存。**

改动范围: `duncrew-server.py`

```python
# /healthz — 纯存活探针，零业务逻辑
def handle_healthz(self):
    self.send_json({"ok": True, "ts": time.time()})
```

前端 `LocalClawService.ts` 心跳改为打 `/healthz`：
- 响应 <5ms，不受 embedding/index 等后台线程影响
- `/status` 加内存缓存（TTL 10s），仅在需要业务数据时调用

---

### Step 3: App.tsx 初始化幂等化

**将启动副作用收拢，确保 StrictMode 双执行不出问题。**

收拢对象:
- `soulEvolutionService.init()` — 内部加 `if (this._initialized) return`
- `loadLinkStation()` — 加 guard 防重入
- seed Dun setTimeout — 检查是否已注册过

原则: 每个 init 方法内部都要有明确的幂等 guard，而非依赖外部只调用一次。

---

### Step 4: 引入瘦 facade

**让 App.tsx 和连接面板不再 import 重型 LocalClawService。**

新建 `src/services/connectionClient.ts`：
- 只暴露 `connect / disconnect / checkHealth / onConnected / onDisconnected`
- 零重型 import（不依赖 ReAct/Memory/Dun/Knowledge 模块）
- App.tsx 和 ConnectionPanel 改为 import 这个轻量模块

`LocalClawService` 本体改为在 `startTask()` 时才被动态加载：
```typescript
// connectionClient.ts
async startTask(task: string) {
  const { localClawService } = await import('./LocalClawService')
  return localClawService.executeTask(task)
}
```

预期效果: 首屏依赖图从 ~270 模块降到 ~60-80 模块。

---

### Step 5: 按运行路径动态加载重型模块

**ReAct / ToolExecutor / Context / Memory 等模块在真正执行任务时才加载。**

在 LocalClawService 内部将顶层 import 改为延迟加载：

```typescript
// Before (顶层)
import { transcriptaseEngine } from './transcriptaseEngine'
import { knowledgeIngestService } from './knowledgeIngestService'

// After (按需)
private async getTranscriptaseEngine() {
  if (!this._transcriptaseEngine) {
    const { transcriptaseEngine } = await import('./transcriptaseEngine')
    this._transcriptaseEngine = transcriptaseEngine
  }
  return this._transcriptaseEngine
}
```

按使用频率分层：
- **始终加载**: llmService (chat/stream 核心)、prompts
- **首次任务时加载**: ReAct loop、contextBuilder、memoryStore
- **特定功能时加载**: genePoolService、sopEvolutionService、transcriptaseEngine、knowledgeIngestService

---

## 五、不做 / 降优先级的事项

| 措施 | 原因 |
|------|------|
| `optimizeDeps.include` | Vite dev 已自动预构建 node_modules 依赖，收益不大 |
| 直接关闭 StrictMode | 是放大器不是根因，优先做幂等化 |
| 盲目拆分 LocalClawService 为多文件 | 如果仍被入口同步 import，冷启动不会变快 |
| Store 拆分为多个独立 store | 收益相对小，改动面大，留作长期项 |

---

## 六、数据参考

| 指标 | 当前值 |
|------|--------|
| 总源文件数 | 270 |
| 总代码行数 | 92,071 |
| services/ 代码行数 | 34,406 (37%) |
| 最大单文件 | LocalClawService.ts (5,449 行 / 229.7 KB) |
| LocalClawService 顶层 import 数 | 40 |
| Store Slice 数量 | 16 |
| 组件数量 | 100+ |
| node_modules 子目录数 | 2,252 |
| 全局定时器使用次数 | 60 (分布在 22 个文件) |
| 后端线程模型 | ThreadingHTTPServer (多线程) |
