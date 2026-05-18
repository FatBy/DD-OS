/**
 * WritingError — 自习室统一错误类型 + 分级降级策略
 */

export type WritingErrorCode =
  | 'llm_unavailable'
  | 'llm_rate_limited'
  | 'llm_response_invalid'
  | 'agenda_parse_failed'
  | 'evidence_not_found'
  | 'section_conflict'
  | 'persist_failed'
  | 'user_aborted'
  | 'archive_failed'
  | 'unknown'

export type WritingStage =
  | 'intake' | 'telescope' | 'agenda' | 'compose'
  | 'archive' | 'dispatch' | 'unknown'

const DEFAULT_RETRYABLE: Record<WritingErrorCode, boolean> = {
  llm_unavailable: true,
  llm_rate_limited: true,
  llm_response_invalid: true,
  agenda_parse_failed: true,
  evidence_not_found: false,
  section_conflict: true,
  persist_failed: true,
  user_aborted: false,
  archive_failed: true,
  unknown: false,
}

const DEFAULT_MESSAGE: Record<WritingErrorCode, string> = {
  llm_unavailable: 'AI 服务暂时不可用，正在重试...',
  llm_rate_limited: '请求频率过高，稍后自动重试',
  llm_response_invalid: 'AI 返回了意外的格式，正在重试...',
  agenda_parse_failed: '议程解析失败，将使用简化版议程',
  evidence_not_found: '引用的证据已失效',
  section_conflict: '段落版本冲突，正在重新加载...',
  persist_failed: '保存失败，已备份到本地缓存',
  user_aborted: '',
  archive_failed: '导出失败，请尝试复制到剪贴板',
  unknown: '发生未知错误',
}

export class WritingError extends Error {
  code: WritingErrorCode
  stage: WritingStage
  sessionId: string
  sectionId?: string
  retryable: boolean
  userMessage: string
  details?: unknown

  constructor(init: {
    code: WritingErrorCode
    stage: WritingStage
    sessionId: string
    sectionId?: string
    retryable?: boolean
    userMessage?: string
    details?: unknown
  }) {
    super(init.userMessage || DEFAULT_MESSAGE[init.code] || init.code)
    this.name = 'WritingError'
    this.code = init.code
    this.stage = init.stage
    this.sessionId = init.sessionId
    this.sectionId = init.sectionId
    this.retryable = init.retryable ?? DEFAULT_RETRYABLE[init.code]
    this.userMessage = init.userMessage || DEFAULT_MESSAGE[init.code]
    this.details = init.details
  }
}

/**
 * 带指数退避的重试封装
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseDelay?: number; onRetry?: (attempt: number, err: unknown) => void } = {},
): Promise<T> {
  const { maxRetries = 1, baseDelay = 1000, onRetry } = opts
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, err)
        await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt)))
      }
    }
  }
  throw lastError
}
