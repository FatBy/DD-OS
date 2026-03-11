/**
 * AgentEventBus - 有状态事件转换器
 * 
 * 对标 OpenClaw pi-embedded-subscribe.ts 的事件广播机制。
 * 维护 AgentRunState，通过发布/订阅模式向 UI 层广播执行状态变化。
 */

import type {
  AgentRunState,
  AgentEventEnvelope,
  AgentEventStream,
  AgentEventBus as IAgentEventBus,
  AgentPhase,
  ToolCallSummary,
  FailoverReason,
} from '@/types'
import { createInitialRunState } from '@/types'

type Listener = (event: AgentEventEnvelope) => void

class AgentEventBusImpl implements IAgentEventBus {
  private state: AgentRunState | null = null
  private listeners = new Set<Listener>()
  private streamListeners = new Map<AgentEventStream, Set<Listener>>()
  private eventLog = new Map<string, AgentEventEnvelope[]>() // runId → events
  private seq = 0

  // ═══ 核心 API ═══

  emit(partial: Omit<AgentEventEnvelope, 'seq' | 'ts'>): void {
    const event: AgentEventEnvelope = {
      ...partial,
      seq: this.seq++,
      ts: Date.now(),
    }

    // 持久化到事件日志
    const runId = event.runId
    if (!this.eventLog.has(runId)) {
      this.eventLog.set(runId, [])
    }
    this.eventLog.get(runId)!.push(event)

    // 更新内部状态
    this.applyEventToState(event)

    // 广播到所有监听者
    for (const listener of this.listeners) {
      try { listener(event) } catch (e) { console.error('[EventBus] listener error:', e) }
    }

    // 广播到 stream 特定监听者
    const streamSet = this.streamListeners.get(event.stream as AgentEventStream)
    if (streamSet) {
      for (const listener of streamSet) {
        try { listener(event) } catch (e) { console.error('[EventBus] stream listener error:', e) }
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  subscribeStream(stream: AgentEventStream, listener: Listener): () => void {
    if (!this.streamListeners.has(stream)) {
      this.streamListeners.set(stream, new Set())
    }
    this.streamListeners.get(stream)!.add(listener)
    return () => { this.streamListeners.get(stream)?.delete(listener) }
  }

  getState(): AgentRunState {
    if (!this.state) {
      return createInitialRunState('none', 'none')
    }
    return this.state
  }

  getEvents(runId: string): AgentEventEnvelope[] {
    return this.eventLog.get(runId) ?? []
  }

  reset(): void {
    this.state = null
    this.seq = 0
    // 保留 eventLog 以供历史查询，但清空监听者
  }

  // ═══ Run 生命周期便捷方法 ═══

  startRun(runId: string, model: string, nexusId?: string, nexusScore?: number, tokenBudget?: number): void {
    this.state = createInitialRunState(runId, model, nexusId)
    if (nexusScore !== undefined) this.state.nexusScore = nexusScore
    if (tokenBudget !== undefined) this.state.tokenBudget = tokenBudget
    this.seq = 0

    this.emit({
      runId,
      stream: 'lifecycle',
      type: 'run_start',
      data: {
        runId,
        nexusId: nexusId ?? null,
        model,
        nexusScore: nexusScore ?? 50,
        tokenBudget: tokenBudget ?? 0,
      },
    })
  }

  endRun(data: {
    success: boolean
    turns: number
    tokensUsed: number
    toolsCalled: number
    durationMs: number
    scoreChange: number
  }): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'lifecycle',
      type: 'run_end',
      data: {
        ...data,
        reflexionCount: this.state.reflexionCount,
        compactionCount: this.state.compactionCount,
        childrenSpawned: this.state.activeChildren.length + this.state.childrenCompleted + this.state.childrenFailed,
        childrenCompleted: this.state.childrenCompleted,
      },
    })
  }

  changePhase(to: AgentPhase, reason?: string): void {
    if (!this.state) return
    const from = this.state.phase
    if (from === to) return
    this.emit({
      runId: this.state.runId,
      stream: 'lifecycle',
      type: 'phase_change',
      data: { from, to, reason },
    })
  }

  // ═══ 工具事件便捷方法 ═══

  toolStart(toolName: string, callId: string, args: Record<string, unknown>, isMutating: boolean): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'tool',
      type: 'tool_start',
      data: { toolName, callId, args, isMutating },
    })
  }

  toolEnd(callId: string, toolName: string, success: boolean, result: string, durationMs: number, dimensionScoreChange?: number): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'tool',
      type: 'tool_end',
      data: { callId, toolName, success, result, durationMs, dimensionScoreChange },
    })
  }

  toolError(callId: string, toolName: string, error: string, isMutating: boolean): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'tool',
      type: 'tool_error',
      data: { callId, toolName, error, isMutating },
    })
  }

  // ═══ 上下文事件便捷方法 ═══

  compactionStart(tokensBefore: number, trigger: 'overflow' | 'budget' | 'proactive'): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'context',
      type: 'compaction_start',
      data: { tokensBefore, trigger },
    })
  }

  compactionEnd(tokensBefore: number, tokensAfter: number, success: boolean, summary?: string): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'context',
      type: 'compaction_end',
      data: { tokensBefore, tokensAfter, success, summary },
    })
  }

  tokenWarning(used: number, budget: number): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'context',
      type: 'token_warning',
      data: { used, budget, percentage: budget > 0 ? Math.round((used / budget) * 100) : 0 },
    })
  }

  // ═══ Reflexion 事件便捷方法 ═══

  reflexionStart(failedTool: string, error: string): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'reflexion',
      type: 'reflexion_start',
      data: {
        failedTool,
        error,
        reflexionIndex: this.state.reflexionCount,
        nexusScore: this.state.nexusScore,
      },
    })
  }

  reflexionEnd(insight: string, strategy: string): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'reflexion',
      type: 'reflexion_end',
      data: {
        insight,
        strategy,
        reflexionIndex: this.state.reflexionCount,
      },
    })
  }

  // ═══ Recovery 事件便捷方法 ═══

  failoverStart(reason: FailoverReason, fromModel: string, toModel: string): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'recovery',
      type: 'failover_start',
      data: { reason, fromModel, toModel, attemptIndex: this.state.attemptIndex },
    })
  }

  retry(backoffMs: number, reason: FailoverReason): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'recovery',
      type: 'retry',
      data: { attemptIndex: this.state.attemptIndex, backoffMs, reason },
    })
  }

  // ═══ Approval 事件便捷方法 ═══

  approvalRequired(requestId: string, command: string, toolName: string, risk: 'high' | 'critical', reason: string): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'approval',
      type: 'approval_required',
      data: { requestId, command, toolName, risk, reason },
    })
  }

  approvalResolved(requestId: string, approved: boolean, resolvedBy: 'user' | 'auto'): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'approval',
      type: 'approval_resolved',
      data: { requestId, approved, resolvedBy },
    })
  }

  // ═══ Plan 事件便捷方法 ═══

  stepStart(stepIndex: number, totalSteps: number, description: string, dependsOn: string[] = []): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'plan',
      type: 'step_start',
      data: { stepIndex, totalSteps, description, dependsOn },
    })
  }

  stepComplete(stepIndex: number, success: boolean, durationMs: number, result?: string, error?: string): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'plan',
      type: 'step_complete',
      data: { stepIndex, success, result, error, durationMs },
    })
  }

  // ═══ Child 事件便捷方法 ═══

  childSpawned(data: { childRunId: string; childSessionId: string; nexusId: string; task: string; depth: number; model: string }): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'child',
      type: 'child_spawned',
      data,
    })
  }

  childProgress(childRunId: string, phase: AgentPhase, turns: number, currentTool?: string): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'child',
      type: 'child_progress',
      data: { childRunId, phase, turns, currentTool },
    })
  }

  childCompleted(data: { childRunId: string; nexusId: string; success: boolean; result?: string; error?: string; durationMs: number; scoreChange: number; genesHarvested: number }): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'child',
      type: 'child_completed',
      data,
    })
  }

  // ═══ Assistant 事件便捷方法 ═══

  messageStart(): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'assistant',
      type: 'message_start',
      data: { messageIndex: this.state.assistantMessageIndex },
    })
  }

  textDelta(delta: string, fullText: string): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'assistant',
      type: 'text_delta',
      data: { delta, fullText },
    })
  }

  thinkingDelta(delta: string): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'assistant',
      type: 'thinking_delta',
      data: { delta },
    })
  }

  messageEnd(finalText: string): void {
    if (!this.state) return
    this.emit({
      runId: this.state.runId,
      stream: 'assistant',
      type: 'message_end',
      data: { finalText, messageIndex: this.state.assistantMessageIndex },
    })
  }

  // ═══ 内部：事件 → 状态更新 ═══

  private applyEventToState(event: AgentEventEnvelope): void {
    if (!this.state) return
    const s = this.state
    const d = event.data

    switch (event.stream) {
      case 'lifecycle':
        if (event.type === 'phase_change') {
          s.phase = d.to as AgentPhase
        } else if (event.type === 'run_end') {
          s.phase = (d.success as boolean) ? 'done' : 'error'
        }
        break

      case 'assistant':
        if (event.type === 'message_start') {
          s.assistantMessageIndex = d.messageIndex as number
          s.deltaBuffer = ''
          s.suppressLateChunks = false
        } else if (event.type === 'text_delta') {
          s.deltaBuffer += d.delta as string
          s.lastStreamedText = d.fullText as string
        } else if (event.type === 'thinking_delta') {
          s.reasoningBuffer += d.delta as string
          s.reasoningStreamOpen = true
        } else if (event.type === 'message_end') {
          s.assistantTexts.push(d.finalText as string)
          s.suppressLateChunks = true
          s.reasoningStreamOpen = false
        }
        break

      case 'tool':
        if (event.type === 'tool_start') {
          s.currentTool = {
            name: d.toolName as string,
            callId: d.callId as string,
            startTime: event.ts,
            args: d.args as Record<string, unknown>,
          }
          s.phase = 'executing'
        } else if (event.type === 'tool_end') {
          const summary: ToolCallSummary = {
            callId: d.callId as string,
            toolName: d.toolName as string,
            args: s.currentTool?.args ?? {},
            status: (d.success as boolean) ? 'success' : 'error',
            result: d.success ? d.result as string : undefined,
            error: d.success ? undefined : d.result as string,
            durationMs: d.durationMs as number,
            isMutating: false,
            timestamp: event.ts,
          }
          s.toolHistory.push(summary)
          s.currentTool = null
          if (!(d.success as boolean)) {
            s.lastToolError = {
              toolName: d.toolName as string,
              error: d.result as string,
              isMutating: false,
            }
          }
        } else if (event.type === 'tool_error') {
          s.lastToolError = {
            toolName: d.toolName as string,
            error: d.error as string,
            isMutating: d.isMutating as boolean,
          }
          s.currentTool = null
        }
        break

      case 'context':
        if (event.type === 'compaction_start') {
          s.compactionInFlight = true
          s.tokensBefore = d.tokensBefore as number
          s.phase = 'compacting'
        } else if (event.type === 'compaction_end') {
          s.compactionInFlight = false
          s.tokensAfter = d.tokensAfter as number
          if (d.success) s.compactionCount++
        } else if (event.type === 'token_warning') {
          s.tokenUsed = d.used as number
          s.tokenBudget = d.budget as number
          s.tokenPercentage = d.percentage as number
        }
        break

      case 'recovery':
        if (event.type === 'failover_start') {
          s.failoverReason = d.reason as FailoverReason
          s.currentModel = d.toModel as string
          s.phase = 'recovering'
        } else if (event.type === 'retry') {
          s.attemptIndex = d.attemptIndex as number
        }
        break

      case 'reflexion':
        if (event.type === 'reflexion_start') {
          s.phase = 'reflecting'
        } else if (event.type === 'reflexion_end') {
          s.reflexionCount++
        }
        break

      case 'approval':
        if (event.type === 'approval_required') {
          s.approvalPending = true
          s.phase = 'waiting_approval'
          s.approvalRequest = {
            id: d.requestId as string,
            toolName: d.toolName as string,
            args: {},
            dangerLevel: d.risk as 'high' | 'critical',
            reason: d.reason as string,
            timestamp: event.ts,
          }
        } else if (event.type === 'approval_resolved') {
          s.approvalPending = false
          s.approvalRequest = null
        }
        break

      case 'plan':
        if (event.type === 'step_start') {
          s.planProgress = {
            total: d.totalSteps as number,
            completed: s.planProgress?.completed ?? 0,
            currentStep: d.description as string,
          }
        } else if (event.type === 'step_complete') {
          if (s.planProgress) {
            s.planProgress.completed++
          }
        }
        break

      case 'child':
        if (event.type === 'child_spawned') {
          s.activeChildren.push(d.childRunId as string)
        } else if (event.type === 'child_completed') {
          s.activeChildren = s.activeChildren.filter(id => id !== d.childRunId)
          if (d.success as boolean) {
            s.childrenCompleted++
          } else {
            s.childrenFailed++
          }
        }
        break
    }
  }

  // ═══ 清理 ═══

  /** 清理旧 run 的事件日志，保留最近 N 个 */
  pruneEventLog(keepRecent: number = 10): void {
    const runIds = Array.from(this.eventLog.keys())
    if (runIds.length <= keepRecent) return
    const toRemove = runIds.slice(0, runIds.length - keepRecent)
    for (const runId of toRemove) {
      this.eventLog.delete(runId)
    }
  }
}

// 导出单例
export const agentEventBus = new AgentEventBusImpl()
