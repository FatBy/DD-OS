/**
 * StatusBar — 自习室顶部状态栏 (品牌统一版)
 *
 * 视觉语言向"知识图书馆"主页看齐:
 * - 琥珀色系点缀 + serif 标题字
 * - 品牌胶囊 Tab + SMALL CAPS 副标
 * - 克制的阴影 + 纸本质感
 */

import { Download, ArrowLeft, BookOpen } from 'lucide-react'
import { useStore } from '@/store'
import type { StudySessionRuntime } from '@/types'
import { HouseTabSwitcher } from '../HouseTabSwitcher'
import { VersionHistoryDropdown } from './VersionHistoryDropdown'

interface Props {
  session: StudySessionRuntime
  statusLabel?: string
  onExport: () => void
}

const SERIF = "'Georgia', 'Noto Serif SC', 'SimSun', serif"

export function StatusBar({ session, statusLabel, onExport }: Props) {
  const setActiveSession = useStore((s) => s.setActiveSession)

  const wordCount = session.document.replace(/\s/g, '').length

  return (
    <div className="flex items-center gap-3 px-5 py-3 bg-gradient-to-r from-amber-50/40 via-white/90 to-stone-50/60 border-b border-amber-100/60 backdrop-blur-sm flex-shrink-0 shadow-[0_1px_0_rgba(120,53,15,0.03)]">
      {/* Tab 切换器 (品牌胶囊, 放大更显眼) */}
      <HouseTabSwitcher size="compact" />

      {/* 装饰性细分隔 */}
      <div className="w-px h-6 bg-gradient-to-b from-transparent via-amber-200/70 to-transparent flex-shrink-0" aria-hidden />

      {/* 返回 */}
      <button
        onClick={() => setActiveSession(null)}
        className="p-2 text-stone-400 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
        title="返回会话列表"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>

      {/* 标题 (品牌 serif + SMALL CAPS 副标) */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-amber-100/60 border border-amber-200/70 flex-shrink-0">
          <BookOpen className="w-3.5 h-3.5 text-amber-700 stroke-[2.2]" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[9px] font-black text-amber-700/70 uppercase tracking-[0.22em] leading-none">
            Study · Draft
          </span>
          <h2
            className="text-[15px] font-semibold text-stone-800 truncate max-w-[360px] leading-tight mt-0.5"
            style={{ fontFamily: SERIF }}
          >
            {session.brief.intent.slice(0, 60)}
          </h2>
        </div>
      </div>

      {/* 字数 */}
      {wordCount > 0 && (
        <span
          className="text-xs text-stone-500 flex-shrink-0 ml-2 px-2 py-0.5 bg-stone-100/70 rounded-full border border-stone-200/60"
          style={{ fontFamily: SERIF }}
        >
          {wordCount.toLocaleString()} 字
        </span>
      )}

      {/* 状态指示 */}
      {statusLabel && (
        <span className="text-xs text-amber-700 animate-pulse flex-shrink-0 flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full" />
          {statusLabel}
        </span>
      )}

      <div className="flex-1" />

      {/* 历史版本下拉 (胶囊, 与导出按钮风格一致) */}
      <VersionHistoryDropdown
        sessionId={session.id}
        currentDocument={session.document}
        versions={session.versions || []}
      />

      {/* 导出 (品牌胶囊) */}
      <button
        onClick={onExport}
        disabled={!session.document.trim()}
        className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-amber-800 hover:text-amber-900 bg-white hover:bg-amber-50 border border-amber-200 hover:border-amber-300 rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
        style={{ fontFamily: SERIF, letterSpacing: '0.04em' }}
      >
        <Download className="w-3.5 h-3.5" />
        导出
      </button>
    </div>
  )
}
