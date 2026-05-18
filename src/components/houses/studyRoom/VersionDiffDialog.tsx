/**
 * VersionDiffDialog — 版本对比 / 回退弹窗
 *
 * 展示内容:
 *   - 顶部: 版本元信息 (时间、字数、触发源) + 摘要 (AI 给出的 editSummary 或 trigger label)
 *   - 中部: 可展开的详细 diff (默认折叠, 点 "查看详细变更" 后渲染 hunks)
 *   - 底部: "恢复此版本" 按钮
 *
 * 数据来源:
 *   - 通过 props 传入的 versionId, 组件内部调用 store.fetchVersionDetail 拉 document 全文
 *   - oldText 即当前 session.document (对比基准), newText 为目标版本 document
 *   - 向展示语义: 把"目标版本"视作"新版", "当前文档"视作"旧版" (符合"看看如果回退到这版, 会从现在变成什么样"的用户直觉)
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, RotateCcw, ChevronDown, ChevronRight, Loader2, AlertCircle,
  Plus, Minus, Equal,
} from 'lucide-react'
import { useStore } from '@/store'
import type { DocumentVersion, DocumentVersionMeta, EditSummary } from '@/types'
import { diffText, summarizeDiffStats, type DiffHunk } from '@/services/studyRoom/diffUtil'

const SERIF = "'Georgia', 'Noto Serif SC', 'SimSun', serif"

interface Props {
  sessionId: string
  /** 当前 session 的 document (作为 diff 基准: "如果回退, 从当前变成什么样") */
  currentDocument: string
  /** 要查看的目标版本元信息 */
  versionMeta: DocumentVersionMeta
  onClose: () => void
  /** 用户点击"恢复此版本"时触发 */
  onRevert: (versionId: string) => Promise<void> | void
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function triggerLabel(trigger: string): string {
  switch (trigger) {
    case 'full_writing': return '首次生成'
    case 'edit': return '对话式修改'
    case 'revert': return '回退前快照'
    case 'manual': return '手动编辑'
    default: return trigger
  }
}

function triggerColor(trigger: string): string {
  switch (trigger) {
    case 'full_writing': return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    case 'edit': return 'bg-amber-100 text-amber-700 border-amber-200'
    case 'revert': return 'bg-stone-100 text-stone-600 border-stone-200'
    default: return 'bg-stone-100 text-stone-600 border-stone-200'
  }
}

/** 把 EditSummary (结构化) 或字符串渲染成摘要块 */
function SummaryBlock({ summary }: { summary: EditSummary | string | null | undefined }) {
  if (!summary) {
    return <p className="text-sm text-stone-400 italic">(无摘要)</p>
  }
  if (typeof summary === 'string') {
    return <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">{summary}</p>
  }
  // EditSummary 结构
  return (
    <div className="space-y-2">
      {summary.summary && (
        <p className="text-sm text-stone-800 leading-relaxed">{summary.summary}</p>
      )}
      {summary.changes && summary.changes.length > 0 && (
        <ul className="space-y-1.5 mt-2">
          {summary.changes.map((c, i) => (
            <li key={i} className="text-xs text-stone-600 pl-3 border-l-2 border-amber-200">
              <span className="font-semibold text-amber-800">{c.where}</span>
              <span className="mx-1.5 text-stone-400">·</span>
              <span>{c.what}</span>
              {c.why && (
                <div className="mt-0.5 text-[11px] text-stone-400 italic">理由: {c.why}</div>
              )}
            </li>
          ))}
        </ul>
      )}
      {summary.skipped && summary.skipped.length > 0 && (
        <div className="mt-2 text-xs text-stone-500">
          <span className="font-semibold">跳过的指令: </span>
          {summary.skipped.join(' / ')}
        </div>
      )}
    </div>
  )
}

/** 单个 diff hunk 的渲染 */
function HunkView({ hunk }: { hunk: DiffHunk }) {
  return (
    <div className="font-mono text-[12px] leading-relaxed border border-stone-200 rounded-lg overflow-hidden">
      {hunk.lines.map((line, i) => {
        const bg = line.op === 'add'
          ? 'bg-emerald-50 border-l-2 border-emerald-400'
          : line.op === 'remove'
            ? 'bg-rose-50 border-l-2 border-rose-400'
            : 'bg-white border-l-2 border-transparent'
        const textCls = line.op === 'add'
          ? 'text-emerald-900'
          : line.op === 'remove'
            ? 'text-rose-900'
            : 'text-stone-600'
        const marker = line.op === 'add' ? '+' : line.op === 'remove' ? '-' : ' '
        return (
          <div key={i} className={`flex gap-2 px-2 py-0.5 ${bg}`}>
            <span className="select-none text-stone-300 w-8 text-right flex-shrink-0">
              {line.oldLineNo ?? ''}
            </span>
            <span className="select-none text-stone-300 w-8 text-right flex-shrink-0">
              {line.newLineNo ?? ''}
            </span>
            <span className="select-none text-stone-400 w-3 flex-shrink-0">{marker}</span>
            <span className={`flex-1 whitespace-pre-wrap break-words ${textCls}`}>
              {line.text || ' '}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function VersionDiffDialog({ sessionId, currentDocument, versionMeta, onClose, onRevert }: Props) {
  const fetchVersionDetail = useStore((s) => s.fetchVersionDetail)
  const [detail, setDetail] = useState<DocumentVersion | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [reverting, setReverting] = useState(false)

  // 拉取版本全文
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    fetchVersionDetail(sessionId, versionMeta.id)
      .then((v) => {
        if (cancelled) return
        if (!v) {
          setLoadError('未能加载版本内容, 版本可能已被清理')
        } else {
          setDetail(v)
        }
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, versionMeta.id, fetchVersionDetail])

  // 计算 diff: 把"目标历史版本"视作新版, "当前文档"视作旧版
  // 语义上是"回退到这版, 会把当前变成什么样"
  const diff = useMemo(() => {
    if (!detail || typeof detail.document !== 'string') return null
    return diffText(currentDocument, detail.document)
  }, [detail, currentDocument])

  const handleRevert = useCallback(async () => {
    if (reverting) return
    const ok = window.confirm(
      `确认把文章回退到这个版本?\n\n` +
      `· 当前文档会先被自动存为一个"回退前快照", 不会丢失\n` +
      `· 此操作可以再回退一次 (找回当前内容)`,
    )
    if (!ok) return
    setReverting(true)
    try {
      await onRevert(versionMeta.id)
      onClose()
    } finally {
      setReverting(false)
    }
  }, [reverting, onRevert, versionMeta.id, onClose])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/20 backdrop-blur-sm p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
        className="relative w-full max-w-3xl max-h-[85vh] flex flex-col bg-white rounded-2xl border border-amber-100 shadow-[0_20px_60px_rgba(120,53,15,0.15)] overflow-hidden"
      >
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-amber-100/60 bg-gradient-to-r from-amber-50/40 via-white to-stone-50/40 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex flex-col min-w-0">
              <span className="text-[9px] font-black text-amber-700/70 uppercase tracking-[0.22em] leading-none">
                Version Preview
              </span>
              <h3 className="text-[15px] font-semibold text-stone-800 leading-tight mt-1" style={{ fontFamily: SERIF }}>
                历史版本 · {formatTime(versionMeta.createdAt)}
              </h3>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${triggerColor(versionMeta.trigger)}`}>
              {triggerLabel(versionMeta.trigger)}
            </span>
            <span className="text-[11px] text-stone-500 px-2 py-0.5 bg-stone-100 rounded-full border border-stone-200" style={{ fontFamily: SERIF }}>
              {versionMeta.wordCount.toLocaleString()} 字
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 摘要块 */}
          <section>
            <h4 className="text-[11px] font-black text-stone-500 uppercase tracking-[0.18em] mb-2">
              Summary · 摘要
            </h4>
            <div className="p-3.5 bg-amber-50/30 border border-amber-100/80 rounded-lg">
              <SummaryBlock summary={versionMeta.summary} />
            </div>
          </section>

          {/* Diff 折叠区 */}
          <section>
            <button
              onClick={() => setDiffOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3.5 py-2.5 bg-white border border-stone-200 rounded-lg hover:border-amber-300 hover:bg-amber-50/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                {diffOpen ? (
                  <ChevronDown className="w-4 h-4 text-stone-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-stone-500" />
                )}
                <span className="text-sm font-semibold text-stone-700">
                  查看详细变更
                </span>
              </div>
              <span className="text-xs text-stone-500">
                {loading ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> 加载中
                  </span>
                ) : diff ? (
                  <span className="inline-flex items-center gap-3">
                    {diff.identical ? (
                      <span className="inline-flex items-center gap-1 text-stone-400">
                        <Equal className="w-3 h-3" /> 无变化
                      </span>
                    ) : (
                      <>
                        {diff.stats.addedLines > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-emerald-600">
                            <Plus className="w-3 h-3" />{diff.stats.addedLines}
                          </span>
                        )}
                        {diff.stats.removedLines > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-rose-600">
                            <Minus className="w-3 h-3" />{diff.stats.removedLines}
                          </span>
                        )}
                        <span className="text-stone-500">{summarizeDiffStats(diff.stats)}</span>
                      </>
                    )}
                  </span>
                ) : null}
              </span>
            </button>
            <AnimatePresence initial={false}>
              {diffOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 space-y-3">
                    {loading && (
                      <div className="flex items-center gap-2 text-sm text-stone-500 py-4 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> 加载版本内容...
                      </div>
                    )}
                    {loadError && (
                      <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{loadError}</span>
                      </div>
                    )}
                    {diff && diff.identical && (
                      <div className="text-sm text-stone-500 italic text-center py-6">
                        此版本与当前文档内容完全相同
                      </div>
                    )}
                    {diff && !diff.identical && diff.hunks.map((hunk, i) => (
                      <HunkView key={i} hunk={hunk} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </div>

        {/* 底栏 */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-stone-100 bg-stone-50/50 flex-shrink-0">
          <span className="text-[11px] text-stone-400">
            ID: <code className="text-stone-500">{versionMeta.id.slice(0, 20)}</code>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-semibold text-stone-600 hover:text-stone-800 bg-white hover:bg-stone-100 border border-stone-200 rounded-full transition-colors"
              style={{ fontFamily: SERIF, letterSpacing: '0.04em' }}
            >
              关闭
            </button>
            <button
              onClick={handleRevert}
              disabled={reverting || loading || !!loadError}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              style={{ fontFamily: SERIF, letterSpacing: '0.04em' }}
            >
              {reverting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              恢复此版本
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
