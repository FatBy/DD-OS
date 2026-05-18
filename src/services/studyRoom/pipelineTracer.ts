/**
 * Pipeline Tracer — 自习室管线的 phase 级可观测
 *
 * 解决的痛点: "太多隐式调用, 出了问题不知道哪段 LLM 干的"
 *
 * 设计:
 *   - 与 StudyTokenTracker 互补: 后者按 stage 累 token, 这里按 phase 记时间线
 *   - 每次顶层入口 (runFullWriting / runConversationalEdit / runWriterChat) 调用 start()
 *   - 内部关键 phase (route / tool.loop / agenda / reader / compose / stream) 各包一对 span()
 *   - 结束时 finishAndPrint() 用 console.group + console.table 打出时间线总览
 *
 * 用法:
 *   pipelineTracer.start(sessionId, 'runFullWriting')
 *   const r = await pipelineTracer.span('intent.route', async () => routeWriterMessage(...), { source: 'local' })
 *   pipelineTracer.event('recall.hit', { count: 8 })  // 不计时, 只记点
 *   pipelineTracer.finishAndPrint()
 *
 * 语义:
 *   - phase: 阶段名 (约定见下方 PHASE_TAXONOMY)
 *   - status: 'ok' | 'error' | 'skipped'
 *   - meta: 结果要点 (count / source / confidence / bytes ...)
 *
 * 不做的事:
 *   - 不做持久化 (纯 console)
 *   - 不做 UI 展示层
 *   - 不改 StudyTokenTracker
 */

/** phase 命名约定 (文档用, 不强制) */
export const PHASE_TAXONOMY = {
  'intent.route': '意图路由 (本地规则 / LLM / fallback)',
  'memory.recall': '长期记忆召回',
  'telescope': '证据并行采集 (lensLibrary + lensSkills)',
  'tool.loop': 'Function Calling 工具循环',
  'agenda.draft': '议程生成 + 自我批判',
  'compose.section': '单段并发撰写',
  'length.review': '篇幅复核',
  'stream.main': '主流式输出 (edit/discuss 的全文流)',
} as const

type PhaseStatus = 'ok' | 'error' | 'skipped'

interface PhaseRecord {
  phase: string
  startMs: number
  durationMs: number
  status: PhaseStatus
  meta?: Record<string, unknown>
  errorMessage?: string
}

class PipelineTracer {
  private sessionId: string | null = null
  private rootLabel = ''
  private startTime = 0
  private records: PhaseRecord[] = []
  /** 活动 span 栈, 允许嵌套 (span 内部可以再开 span) */
  private stack: Array<{ phase: string; startMs: number }> = []

  /** 开启一次追踪 (每个顶层入口调一次). 重复 start 会自动结束上一次. */
  start(sessionId: string, rootLabel: string): void {
    if (this.sessionId) {
      // 上一次没 finish — 强制收尾, 避免时间线串掉
      this.finishAndPrint()
    }
    this.sessionId = sessionId
    this.rootLabel = rootLabel
    this.startTime = Date.now()
    this.records = []
    this.stack = []
    console.info(
      `%c[StudyRoom Pipeline] ⏵ ${rootLabel} 开始`,
      'color:#d97706;font-weight:bold',
      { sessionId },
    )
  }

  /**
   * 包一个 async 操作为一个 phase span.
   * 成功返回原 resolve 值; 抛错时记录 error 后继续抛 (不吞异常).
   */
  async span<T>(
    phase: string,
    fn: () => Promise<T>,
    metaBefore?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.sessionId) {
      // 未 start — 直接透传, 不记录 (避免污染其他入口的时间线)
      return fn()
    }
    const startMs = Date.now() - this.startTime
    this.stack.push({ phase, startMs })
    try {
      const result = await fn()
      const durationMs = (Date.now() - this.startTime) - startMs
      this.records.push({
        phase,
        startMs,
        durationMs,
        status: 'ok',
        meta: metaBefore,
      })
      this.stack.pop()
      return result
    } catch (err) {
      const durationMs = (Date.now() - this.startTime) - startMs
      this.records.push({
        phase,
        startMs,
        durationMs,
        status: 'error',
        meta: metaBefore,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      this.stack.pop()
      throw err
    }
  }

  /**
   * 为刚刚结束的 phase 补充 meta (比如 span 内部拿到的结果要点).
   * 仅更新最后一条同名 phase 的 meta — 无匹配则静默忽略.
   */
  annotate(phase: string, meta: Record<string, unknown>): void {
    if (!this.sessionId) return
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].phase === phase) {
        this.records[i].meta = { ...this.records[i].meta, ...meta }
        return
      }
    }
  }

  /** 记一个无时长的事件点 (比如 "命中本地规则"). */
  event(phase: string, meta?: Record<string, unknown>): void {
    if (!this.sessionId) return
    const startMs = Date.now() - this.startTime
    this.records.push({
      phase,
      startMs,
      durationMs: 0,
      status: 'ok',
      meta,
    })
  }

  /** 标记一个 phase 被显式跳过 (比如 enableToolLoop=false). */
  skip(phase: string, reason?: string): void {
    if (!this.sessionId) return
    const startMs = Date.now() - this.startTime
    this.records.push({
      phase,
      startMs,
      durationMs: 0,
      status: 'skipped',
      meta: reason ? { reason } : undefined,
    })
  }

  /** 结束追踪, 打印总览. */
  finishAndPrint(): void {
    if (!this.sessionId) return
    const totalMs = Date.now() - this.startTime
    const records = this.records

    // 合计 ok/error 的 phase 耗时占比 (skipped/event 不参与)
    const timedSum = records
      .filter((r) => r.durationMs > 0)
      .reduce((acc, r) => acc + r.durationMs, 0)

    const rows = records.map((r) => {
      const metaStr = r.meta
        ? Object.entries(r.meta)
          .map(([k, v]) => `${k}=${formatMetaValue(v)}`)
          .join(' ')
        : ''
      return {
        phase: r.phase,
        '起点(ms)': r.startMs,
        '耗时(ms)': r.durationMs,
        '占比': r.durationMs > 0 && timedSum > 0
          ? `${((r.durationMs / timedSum) * 100).toFixed(1)}%`
          : '-',
        status: r.status,
        meta: metaStr,
      }
    })

    console.info(
      `%c[StudyRoom Pipeline] ⏹ ${this.rootLabel} 结束 · 总耗时 ${(totalMs / 1000).toFixed(2)}s · ${records.length} 个 phase`,
      'color:#d97706;font-weight:bold',
    )
    if (rows.length > 0 && typeof console.table === 'function') {
      console.table(rows)
    } else {
      rows.forEach((r) => console.info(`  ${r.phase}: +${r['起点(ms)']}ms, 耗时 ${r['耗时(ms)']}ms, ${r.status}${r.meta ? ` (${r.meta})` : ''}`))
    }

    this.sessionId = null
    this.records = []
    this.stack = []
  }

  /** 是否已 start (给外部判断"顶层入口 vs 内嵌调用"用, 避免重复 start). */
  isActive(): boolean {
    return this.sessionId !== null
  }
}

/** meta 值格式化: 数字保留, 字符串加引号, 对象 JSON. */
function formatMetaValue(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'string') return v.length > 40 ? `"${v.slice(0, 40)}…"` : `"${v}"`
  if (v === null || v === undefined) return String(v)
  try {
    const s = JSON.stringify(v)
    return s.length > 60 ? `${s.slice(0, 60)}…` : s
  } catch {
    return '[unserializable]'
  }
}

export const pipelineTracer = new PipelineTracer()
