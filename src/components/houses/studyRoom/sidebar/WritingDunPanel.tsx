/**
 * WritingDunPanel — 自习室"写作 Dun"小面板
 *
 * 位置: 堆叠在 FingerprintPanel 下方 (同一栏, 两个 section 堆叠)
 *
 * 功能:
 *   1. 展示当前 session 已加载的 Dun (如有), 显示名称/描述/头像
 *   2. 提供"选择/更换 Dun"按钮, 弹出 DunPickerDialog
 *   3. 提供"卸下 Dun"按钮, 回退到不代笔
 *   4. 一小段说明告诉用户: 发消息时 Dun 会代笔替换整篇草稿
 *
 * 不做的事:
 *   - 不做 Dun 的创建/编辑 (那是 DunHouse 的职责)
 *   - 不自己触发代笔 (代笔在 chat 提交入口触发, 这里只是"设定/卸下"控件)
 */

import { useState, useCallback } from 'react'
import { Feather, ArrowLeftRight, X, Sparkles } from 'lucide-react'
import { useStore } from '@/store'
import type { LoadedDun } from '@/services/studyRoom/writingDun'
import { DunPickerDialog } from './DunPickerDialog'

const SERIF = "'Georgia', 'Noto Serif SC', 'SimSun', serif"

interface Props {
  /** 当前 session id, 用于读写 session.loadedDun */
  sessionId: string | null
}

export function WritingDunPanel({ sessionId }: Props) {
  const loadedDun = useStore((s) =>
    sessionId ? (s.studySessions[sessionId]?.loadedDun ?? null) : null,
  )
  const setSessionDun = useStore((s) => s.setSessionDun)

  const [showPicker, setShowPicker] = useState(false)

  const handlePick = useCallback((dun: LoadedDun) => {
    if (!sessionId) return
    setSessionDun(sessionId, dun)
    setShowPicker(false)
  }, [sessionId, setSessionDun])

  const handleUnload = useCallback(() => {
    if (!sessionId) return
    const ok = window.confirm('卸下当前写作 Dun? 后续对话将不再代笔, 回到普通写作模式.')
    if (!ok) return
    setSessionDun(sessionId, null)
  }, [sessionId, setSessionDun])

  return (
    <div className="border-t border-amber-100/60 bg-gradient-to-b from-indigo-50/20 via-white to-stone-50/30">
      {/* 小头部 */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-indigo-100/40">
        <div className="w-6 h-6 rounded-md bg-indigo-100/70 border border-indigo-200/70 flex items-center justify-center flex-shrink-0">
          <Feather className="w-3 h-3 text-indigo-700 stroke-[2.2]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-black text-indigo-700/70 uppercase tracking-[0.22em] leading-none">
            Writing Dun
          </p>
          <h4 className="text-[12px] font-semibold text-stone-800 leading-tight mt-0.5" style={{ fontFamily: SERIF }}>
            写作 Dun
          </h4>
        </div>
      </div>

      {/* 内容区 */}
      <div className="px-4 py-3">
        {!sessionId ? (
          <p className="text-[10px] text-stone-400 italic leading-relaxed text-center py-2">
            先创建或选择会话才能装载 Dun
          </p>
        ) : loadedDun ? (
          <div className="space-y-2.5">
            {/* 当前 Dun 卡片 */}
            <div className="border border-indigo-200/60 rounded-lg bg-white/80 p-2.5">
              <div className="flex items-start gap-2">
                <div className="w-7 h-7 rounded-md bg-gradient-to-br from-indigo-100/90 to-indigo-50 border border-indigo-200/60 flex items-center justify-center flex-shrink-0">
                  <Feather className="w-3.5 h-3.5 text-indigo-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <h5
                    className="text-[12px] font-semibold text-stone-800 truncate"
                    style={{ fontFamily: SERIF }}
                  >
                    {loadedDun.name}
                  </h5>
                  {loadedDun.description && (
                    <p className="text-[10px] text-stone-500 mt-0.5 line-clamp-2 leading-relaxed">
                      {loadedDun.description}
                    </p>
                  )}
                  <div className="flex items-center gap-1 mt-1 text-[9px] text-stone-400 flex-wrap">
                    {loadedDun.archetype && (
                      <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 font-mono">
                        {loadedDun.archetype}
                      </span>
                    )}
                    {(loadedDun.tags || []).slice(0, 2).map((t) => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 代笔说明条 */}
            <div className="flex items-start gap-1.5 text-[10px] bg-indigo-50/40 border border-indigo-100 rounded px-2.5 py-1.5">
              <Sparkles className="w-3 h-3 text-indigo-600 flex-shrink-0 mt-0.5" />
              <p className="text-indigo-700/90 leading-relaxed">
                发消息时, 此 Dun 会按当前文风指纹<b>整篇重写</b>草稿.<br />
                旧草稿自动存为历史版本, 可随时回滚.
              </p>
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowPicker(true)}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-indigo-700 hover:text-indigo-800 bg-indigo-50/60 hover:bg-indigo-100/70 border border-indigo-200/60 rounded transition-colors"
                title="换一个 Dun"
              >
                <ArrowLeftRight className="w-2.5 h-2.5" />
                更换
              </button>
              <button
                onClick={handleUnload}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-stone-500 hover:text-red-600 bg-stone-50 hover:bg-red-50/60 border border-stone-200 hover:border-red-200 rounded transition-colors"
                title="卸下 Dun, 回到普通写作"
              >
                <X className="w-2.5 h-2.5" />
                卸下
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={() => setShowPicker(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-indigo-800 bg-gradient-to-b from-indigo-50 to-indigo-100/60 border border-indigo-200 hover:border-indigo-300 hover:from-indigo-100/80 hover:to-indigo-200/40 rounded-lg transition-colors shadow-sm"
              style={{ fontFamily: SERIF }}
            >
              <Feather className="w-3.5 h-3.5" />
              选一个 Dun 来代笔
            </button>
            <p className="text-[10px] text-stone-400 italic leading-relaxed px-1">
              装载后, 对话提交时 Dun 会按文风指纹把整篇草稿改写.
            </p>
          </div>
        )}
      </div>

      {/* 选择对话框 */}
      {showPicker && (
        <DunPickerDialog
          currentDunId={loadedDun?.id || null}
          onClose={() => setShowPicker(false)}
          onPick={handlePick}
        />
      )}
    </div>
  )
}
