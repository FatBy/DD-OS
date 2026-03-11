/**
 * ErrorRecovery - 多层错误恢复服务
 *
 * 对标 OpenClaw 的 failover 机制。
 * 根据错误类型 (FailoverReason) 自动执行恢复策略：
 * - auth: 提示用户更换 API Key
 * - rate_limit: 指数退避重试 + 模型降级
 * - context_overflow: 触发 compact() 压缩上下文
 * - timeout: 退避重试 + 模型切换
 * - model_error: 模型降级
 * - network: 退避重试
 * - billing: 模型降级 + 提示用户
 */

import type { FailoverReason } from '@/types'
import { BACKOFF_CONFIG } from '@/types'
import { agentEventBus } from './agentEventBus'

// ============================================
// 错误分类器
// ============================================

/** 从原始错误提取 FailoverReason */
export function classifyError(error: any): FailoverReason {
  const message = (error?.message || '').toLowerCase()
  const status = error?.status || error?.statusCode || 0

  // HTTP 状态码判断
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limit'
  if (status === 402) return 'billing'
  if (status === 413 || message.includes('context_length') || message.includes('maximum context length') || message.includes('max tokens')) return 'context_overflow'

  // 消息内容判断
  if (message.includes('api key') || message.includes('unauthorized') || message.includes('authentication')) return 'auth'
  if (message.includes('rate limit') || message.includes('too many requests') || message.includes('quota')) return 'rate_limit'
  if (message.includes('timeout') || message.includes('timed out') || message.includes('aborted')) return 'timeout'
  if (message.includes('billing') || message.includes('insufficient') || message.includes('balance')) return 'billing'
  if (message.includes('network') || message.includes('econnrefused') || message.includes('fetch failed') || message.includes('failed to fetch')) return 'network'

  // 默认归类为模型错误
  return 'model_error'
}

// ============================================
// 模型降级链
// ============================================

/** 模型降级优先级（从强到弱） */
const MODEL_FALLBACK_CHAINS: Record<string, string[]> = {
  // OpenAI 系
  'gpt-4o':           ['gpt-4o-mini', 'gpt-3.5-turbo'],
  'gpt-4-turbo':      ['gpt-4o-mini', 'gpt-3.5-turbo'],
  'gpt-4':            ['gpt-4o-mini', 'gpt-3.5-turbo'],
  'gpt-4o-mini':      ['gpt-3.5-turbo'],
  // Claude 系
  'claude-3-opus':    ['claude-3-sonnet', 'claude-3-haiku'],
  'claude-3-sonnet':  ['claude-3-haiku'],
  'claude-3.5-sonnet': ['claude-3-sonnet', 'claude-3-haiku'],
  // DeepSeek 系
  'deepseek-chat':    ['deepseek-coder'],
  'deepseek-reasoner': ['deepseek-chat'],
}

/** 获取当前模型的降级候选 */
export function getFallbackModel(currentModel: string): string | null {
  // 精确匹配
  if (MODEL_FALLBACK_CHAINS[currentModel]) {
    return MODEL_FALLBACK_CHAINS[currentModel][0] || null
  }

  // 模糊匹配（处理版本后缀）
  for (const [key, chain] of Object.entries(MODEL_FALLBACK_CHAINS)) {
    if (currentModel.startsWith(key) || currentModel.includes(key)) {
      return chain[0] || null
    }
  }

  return null
}

// ============================================
// 退避计算
// ============================================

/** 计算指数退避等待时间 */
export function calculateBackoff(attemptIndex: number): number {
  const delay = Math.min(
    BACKOFF_CONFIG.initialMs * Math.pow(BACKOFF_CONFIG.factor, attemptIndex),
    BACKOFF_CONFIG.maxMs,
  )
  // 添加 jitter (±20%)
  const jitter = delay * 0.2 * (Math.random() * 2 - 1)
  return Math.max(0, Math.round(delay + jitter))
}

/** 等待指定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================
// Recovery Handler
// ============================================

export interface RecoveryContext {
  currentModel: string
  attemptIndex: number
  runId: string
  onModelSwitch?: (newModel: string) => void
  onCompactNeeded?: () => Promise<boolean>
}

export interface RecoveryResult {
  /** 是否应该重试 */
  shouldRetry: boolean
  /** 等待后再重试 */
  waitMs: number
  /** 切换到的新模型（如果有） */
  newModel?: string
  /** 恢复策略描述 */
  strategy: string
  /** 是否需要用户介入 */
  needsUserAction: boolean
  /** 用户提示信息 */
  userMessage?: string
}

/**
 * 根据错误类型执行恢复策略
 *
 * @returns RecoveryResult 指示调用方如何处理
 */
export async function handleRecovery(
  error: any,
  ctx: RecoveryContext,
): Promise<RecoveryResult> {
  const reason = classifyError(error)
  const canRetry = ctx.attemptIndex < BACKOFF_CONFIG.maxAttempts

  console.log(`[ErrorRecovery] Classified error as "${reason}", attempt ${ctx.attemptIndex + 1}/${BACKOFF_CONFIG.maxAttempts}`)

  // 发出 recovery 事件
  const fallbackModel = getFallbackModel(ctx.currentModel)

  switch (reason) {
    case 'auth':
      return {
        shouldRetry: false,
        waitMs: 0,
        strategy: 'prompt_user',
        needsUserAction: true,
        userMessage: 'API Key 无效或已过期，请在设置中更新 API Key。',
      }

    case 'billing':
      if (fallbackModel) {
        agentEventBus.failoverStart(reason, ctx.currentModel, fallbackModel)
        ctx.onModelSwitch?.(fallbackModel)
        return {
          shouldRetry: true,
          waitMs: 100,
          newModel: fallbackModel,
          strategy: 'switch_model',
          needsUserAction: false,
        }
      }
      return {
        shouldRetry: false,
        waitMs: 0,
        strategy: 'prompt_user',
        needsUserAction: true,
        userMessage: '账户余额不足，请充值或切换到免费模型。',
      }

    case 'rate_limit':
      if (canRetry) {
        const backoffMs = calculateBackoff(ctx.attemptIndex)
        agentEventBus.retry(backoffMs, reason)
        console.log(`[ErrorRecovery] Rate limited, backing off ${backoffMs}ms`)
        await sleep(backoffMs)
        return {
          shouldRetry: true,
          waitMs: backoffMs,
          strategy: 'exponential_backoff',
          needsUserAction: false,
        }
      }
      // 退避用尽，尝试模型降级
      if (fallbackModel) {
        agentEventBus.failoverStart(reason, ctx.currentModel, fallbackModel)
        ctx.onModelSwitch?.(fallbackModel)
        return {
          shouldRetry: true,
          waitMs: 500,
          newModel: fallbackModel,
          strategy: 'switch_model_after_backoff_exhausted',
          needsUserAction: false,
        }
      }
      return {
        shouldRetry: false,
        waitMs: 0,
        strategy: 'rate_limit_exhausted',
        needsUserAction: true,
        userMessage: '请求频率过高且重试已用尽，请稍后再试。',
      }

    case 'context_overflow':
      // 先尝试压缩上下文
      if (ctx.onCompactNeeded) {
        console.log('[ErrorRecovery] Context overflow, attempting compaction...')
        const compacted = await ctx.onCompactNeeded()
        if (compacted) {
          return {
            shouldRetry: true,
            waitMs: 100,
            strategy: 'compact_context',
            needsUserAction: false,
          }
        }
      }
      // 压缩失败，尝试模型降级到更大窗口
      if (fallbackModel) {
        agentEventBus.failoverStart(reason, ctx.currentModel, fallbackModel)
        ctx.onModelSwitch?.(fallbackModel)
        return {
          shouldRetry: true,
          waitMs: 200,
          newModel: fallbackModel,
          strategy: 'switch_model_larger_context',
          needsUserAction: false,
        }
      }
      return {
        shouldRetry: false,
        waitMs: 0,
        strategy: 'context_overflow_unrecoverable',
        needsUserAction: true,
        userMessage: '对话上下文超出模型最大长度，请开始新对话。',
      }

    case 'timeout':
      if (canRetry) {
        const backoffMs = calculateBackoff(ctx.attemptIndex)
        agentEventBus.retry(backoffMs, reason)
        console.log(`[ErrorRecovery] Timeout, retrying after ${backoffMs}ms`)
        await sleep(backoffMs)
        return {
          shouldRetry: true,
          waitMs: backoffMs,
          strategy: 'retry_with_backoff',
          needsUserAction: false,
        }
      }
      return {
        shouldRetry: false,
        waitMs: 0,
        strategy: 'timeout_exhausted',
        needsUserAction: true,
        userMessage: '请求多次超时，请检查网络或稍后再试。',
      }

    case 'network':
      if (canRetry) {
        const backoffMs = calculateBackoff(ctx.attemptIndex)
        agentEventBus.retry(backoffMs, reason)
        console.log(`[ErrorRecovery] Network error, retrying after ${backoffMs}ms`)
        await sleep(backoffMs)
        return {
          shouldRetry: true,
          waitMs: backoffMs,
          strategy: 'retry_with_backoff',
          needsUserAction: false,
        }
      }
      return {
        shouldRetry: false,
        waitMs: 0,
        strategy: 'network_exhausted',
        needsUserAction: true,
        userMessage: '网络连接失败，请检查网络连接。',
      }

    case 'model_error':
      if (fallbackModel) {
        agentEventBus.failoverStart(reason, ctx.currentModel, fallbackModel)
        ctx.onModelSwitch?.(fallbackModel)
        return {
          shouldRetry: true,
          waitMs: 200,
          newModel: fallbackModel,
          strategy: 'switch_model',
          needsUserAction: false,
        }
      }
      if (canRetry) {
        const backoffMs = calculateBackoff(ctx.attemptIndex)
        agentEventBus.retry(backoffMs, reason)
        await sleep(backoffMs)
        return {
          shouldRetry: true,
          waitMs: backoffMs,
          strategy: 'retry_with_backoff',
          needsUserAction: false,
        }
      }
      return {
        shouldRetry: false,
        waitMs: 0,
        strategy: 'model_error_unrecoverable',
        needsUserAction: true,
        userMessage: `模型返回错误: ${(error?.message || '未知').slice(0, 200)}`,
      }

    default:
      return {
        shouldRetry: false,
        waitMs: 0,
        strategy: 'unknown_error',
        needsUserAction: true,
        userMessage: `未知错误: ${(error?.message || '未知').slice(0, 200)}`,
      }
  }
}
