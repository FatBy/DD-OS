/**
 * ParagraphCard — 单节段落卡片
 *
 * 三态展示:
 * - planned: 占位 + 点击可 draft
 * - drafting: 流式 raw text
 * - done: Markdown 渲染
 */

import { motion } from 'framer-motion'
import { Loader2, Sparkles } from 'lucide-react'
import type { AgendaSection } from '@/types'

const FONT_SERIF = "'Georgia', 'Noto Serif SC', 'SimSun', serif"

interface Props {
  section: AgendaSection
  isFocused: boolean
  onClick: () => void
}

export function ParagraphCard({ section, isFocused, onClick }: Props) {
  const borderClass = isFocused
    ? 'border-amber-300 shadow-sm shadow-amber-100'
    : 'border-transparent hover:border-stone-200'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      whileHover={{ y: -1 }}
      className={`rounded-2xl border-2 transition-colors cursor-pointer ${borderClass}`}
      onClick={onClick}
    >
      {/* 标题 */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <span className="text-[10px] font-bold text-stone-400 uppercase">
          {section.order}
        </span>
        <h3 className="text-sm font-bold text-stone-700" style={{ fontFamily: FONT_SERIF }}>{section.heading}</h3>
        {section.status === 'drafting' && (
          <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />
        )}
        {section.status === 'done' && (
          <span className="text-[10px] text-emerald-500 font-medium">done</span>
        )}
      </div>

      {/* 内容区 */}
      <div className="px-4 pb-4">
        {section.status === 'planned' && (
          <div className="flex items-center gap-2 py-6 justify-center text-stone-400">
            <Sparkles className="w-4 h-4" />
            <span className="text-xs">点击开始撰写</span>
          </div>
        )}

        {section.status === 'drafting' && (
          <div className="text-sm text-stone-600 leading-relaxed whitespace-pre-wrap">
            {section.draftPartial || ''}
            <span className="inline-block w-1.5 h-4 bg-amber-400 animate-pulse ml-0.5 -mb-0.5 rounded-sm" />
          </div>
        )}

        {section.status === 'done' && section.draft && (
          <div className="prose prose-sm prose-stone max-w-none">
            {/* 简单 Markdown 渲染: 段落分割 */}
            {section.draft.split('\n\n').map((para, i) => (
              <p key={i} className="text-sm text-stone-700 leading-relaxed mb-2">
                {para}
              </p>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
