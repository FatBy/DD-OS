/**
 * Recovery Signal (C) — 自修复能力观测信号
 *
 * 从 ExecTrace 中检测失败后的行为模式，判断 Agent 是否展现适应性修复。
 * 不用"是否换碱基类型"这种粗粒度判断，而是看：
 *   - 是否换工具
 *   - 是否换路径/资源
 *   - 是否换参数
 *   - 是否先读错误信息再行动
 *   - 是否重复同一失败签名（blind retry）
 */

import type { ExecTrace, ExecTraceToolCall } from '@/types'

export type RecoveryType =
  | 'tool_switch'
  | 'path_switch'
  | 'param_variation'
  | 'read_error_first'
  | 'escalation'
  | 'blind_retry'
  | 'unknown'

export interface RecoveryEvent {
  failureStepOrder: number
  failedTool: string
  failureSignature: string
  recoveryType: RecoveryType
  recoveryBases: string
  recoveryEffective: boolean | null
}

export interface RecoveryScore {
  score: number
  events: RecoveryEvent[]
  blindRetryCount: number
  adaptiveCount: number
  totalFailures: number
}

const RECOVERY_WINDOW = 3

function computeFailureSignature(tool: ExecTraceToolCall): string {
  const path = tool.args?.filePath || tool.args?.path || tool.args?.file || tool.args?.url || ''
  const errorPrefix = tool.result ? tool.result.slice(0, 50).replace(/\s+/g, ' ') : ''
  return `${tool.name}|${String(path).slice(0, 40)}|${errorPrefix}`
}

function extractPath(tool: ExecTraceToolCall): string | null {
  const p = tool.args?.filePath || tool.args?.path || tool.args?.file || tool.args?.directory || tool.args?.url
  return typeof p === 'string' ? p : null
}

function argsFingerprint(args: Record<string, unknown>): string {
  return Object.keys(args).sort().join(',')
}

export function classifyRecovery(
  failedStep: ExecTraceToolCall,
  nextSteps: ExecTraceToolCall[],
): RecoveryType {
  if (nextSteps.length === 0) return 'unknown'

  const next = nextSteps[0]
  const failedPath = extractPath(failedStep)
  const nextPath = extractPath(next)

  if (next.baseType === 'V' || next.baseType === 'P') {
    return 'escalation'
  }

  if (next.name !== failedStep.name) {
    if (next.baseType === 'X' && nextSteps.length > 1 && nextSteps[1].baseType !== 'X') {
      return 'read_error_first'
    }
    return 'tool_switch'
  }

  if (failedPath && nextPath && failedPath !== nextPath) {
    return 'path_switch'
  }

  if (next.name === failedStep.name) {
    const failedFingerprint = argsFingerprint(failedStep.args || {})
    const nextFingerprint = argsFingerprint(next.args || {})
    if (failedFingerprint !== nextFingerprint) {
      return 'param_variation'
    }

    const failSig = computeFailureSignature(failedStep)
    const nextSig = computeFailureSignature(next)
    if (failSig === nextSig) {
      return 'blind_retry'
    }
    return 'param_variation'
  }

  return 'unknown'
}

export function computeRecoveryScore(trace: ExecTrace): RecoveryScore {
  const tools = trace.tools || []
  const events: RecoveryEvent[] = []
  let blindRetryCount = 0
  let adaptiveCount = 0

  for (let i = 0; i < tools.length; i++) {
    if (tools[i].status !== 'error') continue

    const failedStep = tools[i]
    const nextSteps = tools.slice(i + 1, i + 1 + RECOVERY_WINDOW)
    if (nextSteps.length === 0) continue

    const recoveryType = classifyRecovery(failedStep, nextSteps)
    const recoveryBases = nextSteps.map(s => s.baseType || '?').join('-')

    const laterSteps = tools.slice(i + 1, i + 6)
    const hasSuccessAfter = laterSteps.some(s => s.status === 'success')
    const recoveryEffective = laterSteps.length > 0 ? hasSuccessAfter : null

    if (recoveryType === 'blind_retry') {
      blindRetryCount++
    } else if (recoveryType !== 'unknown') {
      adaptiveCount++
    }

    events.push({
      failureStepOrder: failedStep.order,
      failedTool: failedStep.name,
      failureSignature: computeFailureSignature(failedStep),
      recoveryType,
      recoveryBases,
      recoveryEffective,
    })
  }

  const totalFailures = events.length
  const score = totalFailures > 0
    ? adaptiveCount / totalFailures
    : 1.0

  return { score, events, blindRetryCount, adaptiveCount, totalFailures }
}
