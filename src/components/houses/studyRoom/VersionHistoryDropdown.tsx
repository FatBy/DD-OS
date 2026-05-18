/**
 * VersionHistoryDropdown — 顶部"历史"下拉菜单
 *
 * 交互:
 *   - 按钮形态与 StatusBar 的"导出"胶囊保持一致, 点击展开下拉列表
 *   - 列表: 按 createdAt 倒序, 每项显示 "触发标签 · 相对时间 · 字数" + 摘要一行
 *   - 点击某项 → 打开 VersionDiffDialog 查看详细 diff / 执行回退
 *   - 点击菜单外自动关闭
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { History, ChevronDown, FileText, Pen, RotateCcw, Sparkles } from 'lucide-react'
import { useStore } from '@/store'
import type { DocumentVersionMeta, EditSummary } from '@/types'
import { VersionDiffDialog } from './VersionDiffDialog'

const SERIF = "'Georgia', 'Noto Serif SC', 'SimSun', serif"

interface Props {
  sessionId: string
  /** 当前 session 的 document, 用于 diff 基准 */
  currentDocument: string
  /** 版本列表 (按 createdAt 倒序的轻量 meta), 由外部从 session.versions 传入 */
  versions: DocumentVersionMeta[]
}

function formatRelative(ts: number): string {
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(ts).toLocaleDateString('zh-CN', {
    month: '2-digit', day: '2-digit',
  })
}

function triggerShortLabel(trigger: string): string {
  switch (trigger) {
    case 'full_writing': return '首次生成'
    case 'edit': return '修改'
    case 'revert': return '回退前'
    case 'manual': return '手动'
    default: return trigger
  }
}

function triggerIcon(trigger: string) {
  switch (trigger) {
    case 'full_writing': return <Sparkles className="w-3 h-3" />
    case 'edit': return <Pen className="w-3 h-3" />
    case 'revert': return <RotateCcw className="w-3 h-3" />
    default: return <FileText className="w-3 h-3" />
  }
}

function triggerColor(trigger: string): string {
  switch (trigger) {
    case 'full_writing': return 'text-emerald-700 bg-emerald-50 border-emerald-200'
    case 'edit': return 'text-amber-700 bg-amber-50 border-amber-200'
    case 'revert': return 'text-stone-600 bg-stone-100 border-stone-200'
    default: return 'text-stone-600 bg-stone-100 border-stone-200'
  }
}

/** 把 summary 压成一行文字, 用于列表展示 */
function summaryOneLine(summary: EditSummary | string | null | undefined): string {
  if (!summary) return ''
  if (typeof summary === 'string') return summary
  if (summary.summary) return summary.summary
  if (summary.changes && summary.changes.length > 0) {
    return summary.changes.map((c) => c.what).join('；')
  }
  return ''
}

export function VersionHistoryDropdown({ sessionId, currentDocument, versions }: Props) {
  const revertToVersion = useStore((s) => s.revertToVersion)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<DocumentVersionMeta | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        menuRef.current && !menuRef.current.contains(target) &&
        buttonRef.current && !buttonRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // 打开时计算菜单位置 (用 Portal 渲染, 避免被父容器 overflow 裁剪)
  const handleToggle = useCallback(() => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      })
    }
    setOpen((v) => !v)
  }, [open])

  const handleSelect = useCallback((v: DocumentVersionMeta) => {
    setSelected(v)
    setOpen(false)
  }, [])

  const handleRevert = useCallback(async (versionId: string) => {
    await revertToVersion(sessionId, versionId)
  }, [sessionId, revertToVersion])

  const hasVersions = versions.length > 0

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        disabled={!hasVersions}
        className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-amber-800 hover:text-amber-900 bg-white hover:bg-amber-50 border border-amber-200 hover:border-amber-300 rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
        style={{ fontFamily: SERIF, letterSpacing: '0.04em' }}
        title={hasVersions ? `${versions.length} 个历史版本` : '暂无历史版本'}
      >
        <History className="w-3.5 h-3.5" />
        历史
        {hasVersions && (
          <span className="text-[10px] font-normal text-amber-600/80 ml-0.5">
            {versions.length}
          </span>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* 下拉菜单 (Portal 避免被父容器裁剪) */}
      {menuPos && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
              style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 80 }}
              className="w-[360px] max-h-[70vh] flex flex-col bg-white border border-amber-100 rounded-xl shadow-[0_16px_48px_rgba(120,53,15,0.15)] overflow-hidden"
            >
              {/* 菜单头 */}
              <div className="px-4 py-2.5 border-b border-amber-100/60 bg-gradient-to-r from-amber-50/40 via-white to-stone-50/40 flex-shrink-0">
                <p className="text-[9px] font-black text-amber-700/70 uppercase tracking-[0.22em] leading-none">
                  Version History
                </p>
                <h4 className="text-[13px] font-semibold text-stone-800 leading-tight mt-1" style={{ fontFamily: SERIF }}>
                  历史版本 · {versions.length}
                </h4>
              </div>

              {/* 列表 */}
              <div className="flex-1 overflow-y-auto">
                {versions.map((v, idx) => {
                  const summary = summaryOneLine(v.summary)
                  const isLatest = idx === 0
                  return (
                    <button
                      key={v.id}
                      onClick={() => handleSelect(v)}
                      className="w-full text-left px-4 py-3 border-b border-stone-100 last:border-b-0 hover:bg-amber-50/40 transition-colors group"
                    >
                      {/* 第一行: 触发标签 + 相对时间 + 字数 */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${triggerColor(v.trigger)}`}>
                          {triggerIcon(v.trigger)}
                          {triggerShortLabel(v.trigger)}
                        </span>
                        {isLatest && (
                          <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full border border-amber-200">
                            最新
                          </span>
                        )}
                        <span className="text-[11px] text-stone-500">
                          {formatRelative(v.createdAt)}
                        </span>
                        <span className="flex-1" />
                        <span className="text-[11px] text-stone-400 tabular-nums" style={{ fontFamily: SERIF }}>
                          {v.wordCount.toLocaleString()} 字
                        </span>
                      </div>
                      {/* 第二行: 摘要 (一行, 溢出省略) */}
                      {summary ? (
                        <p className="text-[12px] text-stone-600 line-clamp-2 group-hover:text-stone-800 leading-snug">
                          {summary}
                        </p>
                      ) : (
                        <p className="text-[12px] text-stone-400 italic">(无摘要)</p>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* 菜单尾部提示 */}
              <div className="px-4 py-2 border-t border-stone-100 bg-stone-50/60 text-[10px] text-stone-400 leading-relaxed flex-shrink-0">
                点击任一版本查看详细变更 · 可一键恢复到该版本
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* 详情对话框 */}
      {selected && (
        <VersionDiffDialog
          sessionId={sessionId}
          currentDocument={currentDocument}
          versionMeta={selected}
          onClose={() => setSelected(null)}
          onRevert={handleRevert}
        />
      )}
    </>
  )
}
