/**
 * ChildAgentManager - 子智能体生成与生命周期管理
 *
 * 支持父 Agent 动态生成子 Agent 执行子任务：
 * - 限制生成深度和并行数
 * - 生命周期管理（启动/监控/完成/超时/终止）
 * - 结果聚合与上下文回传
 * - EventBus 事件通知
 * - Phase 2: 回调注入解耦 + promise 幂等闭合 + 能力矩阵
 */

import type {
  SpawnChildParams,
  SpawnChildResult,
  ChildRunRecord,
  ChildOutcome,
  AgentPhase,
  ChildContextEnvelope,
  LedgerFacts,
  BaseLedger,
} from '@/types'
import { CHILD_LIMITS } from '@/types'
import { agentEventBus } from './agentEventBus'
import { getLLMConfig } from './llmService'

// ============================================
// Phase 2: 子 Agent 执行器类型（回调注入，解除循环依赖）
// ============================================

/** 子 Agent ReAct 执行参数 */
export interface ChildReActParams {
  task: string
  systemPrompt: string
  maxTurns: number
  allowedTools: string[]
  writePrefix: string
  canSpawnChildren: boolean
  parentRunId: string
  sharedFacts: LedgerFacts
  parentLedger: BaseLedger
}

/** 子 Agent ReAct 执行结果 */
export interface ChildReActResult {
  success: boolean
  finalResponse?: string
  tokensUsed: number
  baseSequence?: string
  childFacts?: Partial<LedgerFacts>
}

/** 子 Agent 执行器回调类型（由 LocalClawService 注入） */
export type ChildReActExecutor = (params: ChildReActParams) => Promise<ChildReActResult>

// ============================================
// Phase 2: 子 Agent 能力矩阵
// ============================================

/** 子 Agent 能力约束 */
interface ChildCapabilityMatrix {
  allowedTools: string[]
  writePrefix: string
  canRunCmd: boolean
  canSpawnChildren: boolean
  maxTurns: number
}

/**
 * 根据任务和深度派生子 Agent 的能力矩阵
 *
 * 核心约束:
 * - runCmd 默认禁止（防止命令逃逸）
 * - 写文件强制隔离到 output/child-{runId}/ 前缀
 * - depth >= 1 的子 Agent 为只读模式
 */
function deriveAllowedTools(
  _task: string,
  childRunId: string,
  currentDepth: number,
): ChildCapabilityMatrix {
  const readOnlyTools = ['readFile', 'listDir', 'search', 'webSearch']

  // depth >= 1: 纯只读，不可写不可 spawn
  if (currentDepth >= 1) {
    return {
      allowedTools: readOnlyTools,
      writePrefix: '',
      canRunCmd: false,
      canSpawnChildren: false,
      maxTurns: 10,
    }
  }

  // depth 0: 可读写，不可 runCmd，depth 校验决定能否再 spawn
  return {
    allowedTools: [...readOnlyTools, 'writeFile', 'appendFile'],
    writePrefix: `output/child-${childRunId}/`,
    canRunCmd: false,
    canSpawnChildren: currentDepth + 1 < CHILD_LIMITS.maxSpawnDepth,
    maxTurns: 15,
  }
}

// ============================================
// 子智能体管理器
// ============================================

class ChildAgentManager {
  /** 活跃的子智能体记录 */
  private children = new Map<string, ChildRunRecord>()
  /** 历史记录（最近 50 条） */
  private history: ChildRunRecord[] = []
  /** 定时器引用（用于超时检测） */
  private timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Phase 2: 子 Agent 上下文信封存储（与 ChildRunRecord 分离，避免改类型） */
  private envelopes = new Map<string, ChildContextEnvelope>()
  /** Phase 2: 子 Agent 执行器回调（由 LocalClawService 注入） */
  private executor: ChildReActExecutor | null = null
  /** Phase 2: deferred promise 闭合（markCompleted/handleTimeout/kill 统一 resolve） */
  private childPromises = new Map<string, {
    resolve: (outcome: ChildOutcome) => void
    promise: Promise<ChildOutcome>
  }>()

  // ═══ Phase 2: 回调注入 ═══

  /**
   * 注入子 Agent 执行器回调。
   * 由 LocalClawService 初始化阶段调用一次，解除循环依赖。
   */
  setExecutor(executor: ChildReActExecutor): void {
    this.executor = executor
  }

  // ═══ 生成子智能体 ═══

  /**
   * 生成子智能体
   *
   * 检查深度/并行限制 → 创建会话 → 注册记录 → 发出事件
   */
  async spawn(
    _parentRunId: string,
    parentSessionId: string,
    params: SpawnChildParams,
    currentDepth: number = 0,
  ): Promise<SpawnChildResult> {
    // 1. 深度检查
    if (currentDepth >= CHILD_LIMITS.maxSpawnDepth) {
      console.warn(`[ChildAgent] Spawn rejected: depth ${currentDepth} >= max ${CHILD_LIMITS.maxSpawnDepth}`)
      return {
        status: 'forbidden',
        error: `子智能体嵌套深度超出限制 (max: ${CHILD_LIMITS.maxSpawnDepth})`,
      }
    }

    // 2. 并行数检查
    const activeCount = this.getActiveCount()
    if (activeCount >= CHILD_LIMITS.maxChildrenPerSession) {
      console.warn(`[ChildAgent] Spawn rejected: ${activeCount} active >= max ${CHILD_LIMITS.maxChildrenPerSession}`)
      return {
        status: 'forbidden',
        error: `并行子智能体数超出限制 (max: ${CHILD_LIMITS.maxChildrenPerSession})`,
      }
    }

    // 3. 创建子运行记录
    const childRunId = `child-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const childSessionId = `session-child-${Date.now()}`
    const model = params.model || getLLMConfig().model || 'unknown'
    const dunId = params.dunId || 'default'

    const record: ChildRunRecord = {
      runId: childRunId,
      childSessionId,
      parentSessionId,
      dunId,
      dunLabel: dunId,
      task: params.task,
      status: 'pending',
      depth: currentDepth + 1,
      model,
      createdAt: Date.now(),
      turns: 0,
      toolsCalled: [],
      currentPhase: 'idle',
    }

    this.children.set(childRunId, record)

    // Phase 2: 存储上下文信封（如果有）
    if (params.contextEnvelope) {
      this.envelopes.set(childRunId, params.contextEnvelope)
    }

    // 4. 发出子智能体生成事件
    agentEventBus.childSpawned({
      childRunId,
      childSessionId,
      dunId,
      task: params.task,
      depth: currentDepth + 1,
      model,
    })

    // 5. 设置超时
    const timeoutMs = (params.timeout || CHILD_LIMITS.defaultTimeoutSeconds) * 1000
    const timer = setTimeout(() => {
      this.handleTimeout(childRunId)
    }, timeoutMs)
    this.timeoutTimers.set(childRunId, timer)

    console.log(`[ChildAgent] Spawned ${childRunId} for task: "${params.task.slice(0, 80)}" (depth: ${currentDepth + 1}, timeout: ${timeoutMs}ms)`)

    return {
      status: 'accepted',
      childSessionId,
      runId: childRunId,
      dunId,
    }
  }

  // ═══ V8: 碱基 Ledger 驱动的 spawn ═══

  /**
   * V8: 带上下文信封的 spawn（由 Transcriptase 触发）
   *
   * 相比普通 spawn，额外携带 ChildContextEnvelope（mRNA），
   * 子 Agent 可以从中获取父 Ledger 快照和共享 facts。
   */
  async spawnWithEnvelope(
    _parentRunId: string,
    parentSessionId: string,
    params: SpawnChildParams,
    envelope: ChildContextEnvelope,
    currentDepth: number = 0,
  ): Promise<SpawnChildResult> {
    // 将 envelope 附加到 params
    const enrichedParams: SpawnChildParams = {
      ...params,
      contextEnvelope: envelope,
      // 使用 envelope 的超时设置
      timeout: Math.ceil(envelope.returnContract.maxDurationMs / 1000),
    }

    // 复用现有 spawn 逻辑
    const result = await this.spawn(_parentRunId, parentSessionId, enrichedParams, currentDepth)

    if (result.status === 'accepted' && result.runId) {
      console.log(`[ChildAgent] V8: Spawned with envelope, parent seq: ${envelope.parentBaseSequence.slice(0, 40)}...`)
    }

    return result
  }

  // ═══ Phase 2: 子 Agent 执行 ═══

  /**
   * 启动子 Agent 的 ReAct 执行循环。
   *
   * 返回 deferred promise：
   * - markCompleted / handleTimeout / kill 中任一触发时 resolve
   * - 三个出口收敛到 markCompleted，保证 promise 只 resolve 一次（幂等）
   */
  executeChild(childRunId: string): Promise<ChildOutcome> {
    if (!this.executor) {
      throw new Error('Executor not set. Call setExecutor() first.')
    }

    // 创建 deferred promise
    let resolvePromise!: (outcome: ChildOutcome) => void
    const promise = new Promise<ChildOutcome>(resolve => {
      resolvePromise = resolve
    })
    this.childPromises.set(childRunId, { resolve: resolvePromise, promise })

    const record = this.children.get(childRunId)
    if (!record) {
      const fallback: ChildOutcome = {
        success: false,
        error: 'Child not found',
        tokensUsed: 0,
        durationMs: 0,
        scoreChange: 0,
        genesHarvested: 0,
        terminationReason: 'error',
      }
      resolvePromise(fallback)
      this.childPromises.delete(childRunId)
      return promise
    }

    this.markRunning(childRunId)
    const capabilities = deriveAllowedTools(record.task, childRunId, record.depth)
    const envelope = this.envelopes.get(childRunId)

    // 构建子 Agent 系统提示词
    const systemPrompt = this.buildChildSystemPrompt(envelope, record.task)

    // 异步启动 ReAct 循环（不 await，父循环继续）
    this.executor({
      task: record.task,
      systemPrompt,
      maxTurns: capabilities.maxTurns,
      parentLedger: envelope?.parentLedgerSnapshot || { runId: '', dunId: '', entries: [], features: {}, milestones: [], facts: { completedActions: [], discoveredResources: [], failedApproaches: [], currentObjective: '', subObjectives: [] }, createdAt: Date.now(), updatedAt: Date.now() },
      sharedFacts: envelope?.sharedFacts || { completedActions: [], discoveredResources: [], failedApproaches: [], currentObjective: '', subObjectives: [] },
      allowedTools: capabilities.allowedTools,
      writePrefix: capabilities.writePrefix,
      canSpawnChildren: capabilities.canSpawnChildren,
      parentRunId: envelope?.returnContract.reportBackTo || '',
    }).then(result => {
      // 正常完成（.then 路径）
      const outcome: ChildOutcome = {
        success: result.success,
        result: result.finalResponse,
        tokensUsed: result.tokensUsed,
        durationMs: Date.now() - (record.startedAt || record.createdAt),
        scoreChange: result.success ? 5 : -2,
        genesHarvested: 0,
        childBaseSequence: result.baseSequence,
        childFacts: result.childFacts,
        terminationReason: result.success ? 'completed' : 'error',
      }
      this.markCompleted(childRunId, outcome)
    }).catch(err => {
      // 异常路径
      const outcome: ChildOutcome = {
        success: false,
        error: String(err?.message || err),
        tokensUsed: 0,
        durationMs: Date.now() - (record.startedAt || record.createdAt),
        scoreChange: -2,
        genesHarvested: 0,
        terminationReason: 'error',
      }
      this.markCompleted(childRunId, outcome)
    })

    return promise
  }

  // ═══ 生命周期管理 ═══

  /** 标记子智能体开始执行 */
  markRunning(childRunId: string): void {
    const record = this.children.get(childRunId)
    if (!record) return

    record.status = 'running'
    record.startedAt = Date.now()
    record.currentPhase = 'planning'
  }

  /** 更新子智能体进度 */
  updateProgress(childRunId: string, phase: AgentPhase, turns: number, currentTool?: string): void {
    const record = this.children.get(childRunId)
    if (!record) return

    record.currentPhase = phase
    record.turns = turns
    if (currentTool) {
      record.toolsCalled.push(currentTool)
    }

    agentEventBus.childProgress(childRunId, phase, turns, currentTool)
  }

  /**
   * 标记子智能体完成（三出口收敛点）
   *
   * 幂等守卫: children.delete 后第二次调用命中 if (!record) return。
   * 保证: 事件不会双发、history 不会双录、promise 不会双 resolve。
   *
   * v5: 使用 terminationReason 保留 killed/timeout 语义，
   * 不再被 success 三元判定覆盖。
   */
  markCompleted(childRunId: string, outcome: ChildOutcome): void {
    const record = this.children.get(childRunId)
    if (!record) return  // ← 幂等守卫

    // 清除超时定时器
    const timer = this.timeoutTimers.get(childRunId)
    if (timer) {
      clearTimeout(timer)
      this.timeoutTimers.delete(childRunId)
    }

    // v5: 优先用 terminationReason，否则按 success 判定
    record.status = outcome.terminationReason || (outcome.success ? 'completed' : 'error')
    record.endedAt = Date.now()
    record.outcome = outcome

    // 发出完成事件
    agentEventBus.childCompleted({
      childRunId,
      dunId: record.dunId,
      success: outcome.success,
      result: outcome.result,
      error: outcome.error,
      durationMs: outcome.durationMs,
      scoreChange: outcome.scoreChange,
      genesHarvested: outcome.genesHarvested,
    })

    // 移到历史（此后 .get(childRunId) 返回 undefined，保证幂等）
    this.children.delete(childRunId)
    this.history.push(record)
    if (this.history.length > 50) {
      this.history = this.history.slice(-50)
    }

    // Phase 2: 闭合 deferred promise
    const deferred = this.childPromises.get(childRunId)
    if (deferred) {
      deferred.resolve(outcome)
      this.childPromises.delete(childRunId)
    }

    // 清理信封
    this.envelopes.delete(childRunId)

    console.log(`[ChildAgent] ${childRunId} completed: success=${outcome.success}, reason=${outcome.terminationReason || 'n/a'}, duration=${outcome.durationMs}ms`)
  }

  /**
   * 终止子智能体（收敛到 markCompleted）
   *
   * v5: 通过 terminationReason='killed' 保留 kill 语义。
   * markCompleted 的幂等守卫保证: 如果 .then 已先完成，此调用为 no-op。
   */
  kill(childRunId: string, reason: string = 'User killed'): void {
    const record = this.children.get(childRunId)
    if (!record) return

    this.markCompleted(childRunId, {
      success: false,
      error: reason,
      tokensUsed: 0,
      durationMs: Date.now() - (record.startedAt || record.createdAt),
      scoreChange: 0,
      genesHarvested: 0,
      terminationReason: 'killed',
    })
  }

  // ═══ 查询 ═══

  /** 获取活跃子智能体数量（只计活跃，不含父/已完成） */
  getActiveCount(): number {
    return this.children.size
  }

  /** 获取活跃子智能体列表 */
  getActiveChildren(): ChildRunRecord[] {
    return Array.from(this.children.values())
  }

  /** 获取历史记录 */
  getHistory(limit: number = 20): ChildRunRecord[] {
    return this.history.slice(-limit)
  }

  /** 获取指定子智能体记录 */
  getChild(childRunId: string): ChildRunRecord | undefined {
    return this.children.get(childRunId) || this.history.find(h => h.runId === childRunId)
  }

  // ═══ 内部方法 ═══

  /**
   * 处理超时（收敛到 markCompleted）
   *
   * v5: 先获取 record 计算真实 durationMs（不再硬编码 defaultTimeoutSeconds * 1000）。
   * markCompleted 的幂等守卫保证: 如果 .then 已先完成，此调用为 no-op。
   */
  private handleTimeout(childRunId: string): void {
    const record = this.children.get(childRunId)
    if (!record) return  // 已被 .then 先完成了

    console.warn(`[ChildAgent] ${childRunId} timed out after ${CHILD_LIMITS.defaultTimeoutSeconds}s`)

    this.markCompleted(childRunId, {
      success: false,
      error: `子智能体执行超时 (${CHILD_LIMITS.defaultTimeoutSeconds}s)`,
      tokensUsed: 0,
      durationMs: Date.now() - (record.startedAt || record.createdAt),
      scoreChange: -5,
      genesHarvested: 0,
      terminationReason: 'timeout',
    })
  }

  /**
   * 构建子 Agent 系统提示词
   */
  private buildChildSystemPrompt(envelope: ChildContextEnvelope | undefined, task: string): string {
    if (!envelope) {
      return `你是一个专注的子智能体。\n\n你的任务: ${task}\n\n要求:\n1. 只做你被分配的任务，不要发散\n2. 如果 10 步内无法完成，提交当前进展并退出`
    }

    const completedActions = envelope.sharedFacts.completedActions.slice(-5).join(', ') || '无'
    const failedApproaches = envelope.sharedFacts.failedApproaches.join(', ') || '无'
    const discoveredResources = envelope.sharedFacts.discoveredResources.slice(-10).join(', ') || '无'

    return `你是一个专注的子智能体。

你的任务: ${envelope.assignedTask}

上下文:
- 父 Agent 已完成: ${completedActions}
- 已知失败路径: ${failedApproaches}
- 已发现资源: ${discoveredResources}

要求:
1. 只做你被分配的任务，不要发散
2. 如果 10 步内无法完成，提交当前进展并退出
3. 不要重复父 Agent 已失败的方法`
  }

  /** 清理所有子智能体 */
  disposeAll(): void {
    for (const [id] of this.children) {
      this.kill(id, 'Parent disposed')
    }
    for (const [, timer] of this.timeoutTimers) {
      clearTimeout(timer)
    }
    this.timeoutTimers.clear()
    this.envelopes.clear()
    this.childPromises.clear()
  }
}

// 导出单例
export const childAgentManager = new ChildAgentManager()
