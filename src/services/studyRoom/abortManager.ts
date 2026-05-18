/**
 * StudyAbortManager — 自习室 LLM 调用中断管理
 *
 * 每次 LLM 调用绑定一个 AbortController，
 * key 格式: `${sessionId}:${stage}:${sectionId}`
 */

class StudyAbortManager {
  private controllers = new Map<string, AbortController>()

  /** 创建并返回一个 AbortController，如果 key 已存在则先 abort 旧的 */
  acquire(key: string): AbortController {
    const existing = this.controllers.get(key)
    if (existing) {
      existing.abort()
    }
    const ctrl = new AbortController()
    this.controllers.set(key, ctrl)
    return ctrl
  }

  /** 获取已有的 signal（不创建新的） */
  getSignal(key: string): AbortSignal | undefined {
    return this.controllers.get(key)?.signal
  }

  /** 中断指定 key 的调用 */
  abort(key: string): void {
    const ctrl = this.controllers.get(key)
    if (ctrl) {
      ctrl.abort()
      this.controllers.delete(key)
    }
  }

  /** 中断指定 session 的所有调用 */
  abortAllForSession(sessionId: string): void {
    for (const [key, ctrl] of this.controllers.entries()) {
      if (key.startsWith(`${sessionId}:`)) {
        ctrl.abort()
        this.controllers.delete(key)
      }
    }
  }

  /** 清除已完成的 key（不 abort） */
  release(key: string): void {
    this.controllers.delete(key)
  }

  /** 构建标准 key */
  static key(sessionId: string, stage: string, sectionId?: string): string {
    return sectionId ? `${sessionId}:${stage}:${sectionId}` : `${sessionId}:${stage}`
  }
}

export const studyAbortManager = new StudyAbortManager()
