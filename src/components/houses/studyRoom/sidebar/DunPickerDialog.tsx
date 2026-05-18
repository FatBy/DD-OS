/**
 * DunPickerDialog — 从 DunCrew-Data/duns 里挑一个 Dun 作为自习室的"写作代笔"
 *
 * 交互:
 *   - 弹出后拉全量 Dun 列表 (GET /duns)
 *   - 支持搜索 (按 name / description / tags 过滤)
 *   - 点击某条 → onPick(dun) 回调并关闭
 *   - 空列表时给出引导 (去 DunCrew-Data/duns/ 放一个 DUN.md)
 *
 * 设计:
 *   - 视觉和 DistillDialog 对齐 (同是自习室侧边栏弹出的选择器)
 *   - 不做 Dun 的创建/编辑, 那是别的界面的事; 这里只负责"选"
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Search, Loader2, AlertCircle, Feather, Check } from 'lucide-react'
import { listAvailableDuns, loadDun, type DunListItem, type LoadedDun } from '@/services/studyRoom/writingDun'

const SERIF = "'Georgia', 'Noto Serif SC', 'SimSun', serif"

interface Props {
  /** 当前已选中的 Dun id (如果有), 用于在列表里高亮 */
  currentDunId?: string | null
  /** 关闭对话框 (用户点 X 或 Esc) */
  onClose: () => void
  /** 选中一个 Dun 后触发, 传回完整 LoadedDun (含 sopContent) */
  onPick: (dun: LoadedDun) => void
}

export function DunPickerDialog({ currentDunId = null, onClose, onPick }: Props) {
  const [duns, setDuns] = useState<DunListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [pickingId, setPickingId] = useState<string | null>(null)

  // 拉列表
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listAvailableDuns()
      .then((list) => {
        if (cancelled) return
        setDuns(list)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // 搜索过滤 (前端本地过滤, 几十个 Dun 撑得住)
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase()
    if (!kw) return duns
    return duns.filter((d) => {
      if (d.name.toLowerCase().includes(kw)) return true
      if ((d.description || '').toLowerCase().includes(kw)) return true
      if ((d.tags || []).some((t) => t.toLowerCase().includes(kw))) return true
      return false
    })
  }, [duns, search])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handlePick = useCallback(async (item: DunListItem) => {
    setPickingId(item.id)
    try {
      const full = await loadDun(item.id)
      onPick(full)
    } catch (err) {
      alert(`加载 Dun 失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPickingId(null)
    }
  }, [onPick])

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg max-h-[80vh] bg-white rounded-xl shadow-2xl border border-stone-200 flex flex-col overflow-hidden"
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100 bg-gradient-to-r from-indigo-50/40 via-white to-stone-50/50 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-indigo-100/70 border border-indigo-200/70 flex items-center justify-center">
                <Feather className="w-4 h-4 text-indigo-700 stroke-[2.2]" />
              </div>
              <div>
                <p className="text-[9px] font-black text-indigo-700/70 uppercase tracking-[0.22em] leading-none">
                  Writing Dun
                </p>
                <h3 className="text-[14px] font-semibold text-stone-800 leading-tight mt-0.5" style={{ fontFamily: SERIF }}>
                  选一个 Dun 来代笔
                </h3>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded transition-colors"
              title="关闭 (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 搜索栏 */}
          <div className="px-5 py-2.5 border-b border-stone-100 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="按名称 / 描述 / 标签搜索..."
                autoFocus
                className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-stone-200 rounded-md focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <p className="text-[10px] text-stone-400 mt-1.5 leading-relaxed">
              Dun 扮演"作者", 按文风指纹把当前草稿整篇替换重写. 旧草稿自动存为历史版本.
            </p>
          </div>

          {/* 列表 */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-4 h-4 text-stone-400 animate-spin" />
              </div>
            ) : error ? (
              <div className="px-5 py-6 flex items-start gap-2 text-[12px] text-red-700 bg-red-50/40">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">加载 Dun 列表失败</p>
                  <p className="text-[11px] mt-1 text-red-600">{error}</p>
                  <p className="text-[11px] mt-2 text-stone-500">请确认后端服务 (duncrew-server.py) 已运行.</p>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-10 px-5">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-br from-indigo-50 to-indigo-100/60 border border-indigo-200/60 mb-3">
                  <Feather className="w-5 h-5 text-indigo-600" />
                </div>
                <p className="text-[12px] text-stone-600 mb-1" style={{ fontFamily: SERIF }}>
                  {search ? '没有匹配的 Dun' : '还没有任何 Dun'}
                </p>
                <p className="text-[10px] text-stone-400 italic leading-relaxed px-4">
                  {search
                    ? '换个关键词试试'
                    : '在 DunCrew-Data/duns/ 下创建子目录 + DUN.md'}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {filtered.map((d) => {
                  const isCurrent = currentDunId === d.id
                  const isPicking = pickingId === d.id
                  return (
                    <button
                      key={d.id}
                      onClick={() => handlePick(d)}
                      disabled={isPicking}
                      className={`w-full text-left px-4 py-2.5 border-b border-stone-100 transition-colors flex items-start gap-2.5 ${
                        isCurrent
                          ? 'bg-indigo-50/50 hover:bg-indigo-50/80'
                          : 'hover:bg-stone-50'
                      } disabled:opacity-50 disabled:cursor-wait`}
                    >
                      <div className="w-8 h-8 rounded-md bg-gradient-to-br from-indigo-100/80 to-indigo-50 border border-indigo-200/60 flex items-center justify-center flex-shrink-0">
                        <Feather className="w-3.5 h-3.5 text-indigo-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h4
                            className="text-[13px] font-semibold text-stone-800 truncate"
                            style={{ fontFamily: SERIF }}
                          >
                            {d.name}
                          </h4>
                          {isCurrent && (
                            <span className="flex items-center gap-0.5 text-[9px] font-bold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                              <Check className="w-2.5 h-2.5" /> 当前
                            </span>
                          )}
                          {isPicking && (
                            <Loader2 className="w-3 h-3 text-indigo-500 animate-spin flex-shrink-0" />
                          )}
                        </div>
                        {d.description && (
                          <p className="text-[10px] text-stone-500 mt-0.5 line-clamp-2 leading-relaxed">
                            {d.description}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-stone-400 flex-wrap">
                          {d.archetype && (
                            <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 font-mono">
                              {d.archetype}
                            </span>
                          )}
                          {(d.tags || []).slice(0, 3).map((t) => (
                            <span
                              key={t}
                              className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600"
                            >
                              {t}
                            </span>
                          ))}
                          {typeof d.xp === 'number' && d.xp > 0 && (
                            <span className="text-amber-600 font-mono">XP {d.xp}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* 底部提示 */}
          <div className="px-5 py-2.5 border-t border-stone-100 bg-stone-50/40 flex-shrink-0">
            <p className="text-[10px] text-stone-500 leading-relaxed">
              选择后, 在对话区发消息时 Dun 会按当前文风指纹直接改写整篇草稿.
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
