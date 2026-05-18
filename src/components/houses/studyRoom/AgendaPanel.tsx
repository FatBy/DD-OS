/**
 * AgendaPanel — 左栏议程面板
 *
 * 显示议程标题、各节状态、可点击触发 draft
 */

import { FileText, Loader2, CheckCircle2, Circle } from 'lucide-react'
import type { AgendaDoc, AgendaSection } from '@/types'

interface Props {
  agenda: AgendaDoc | null
  focusedSectionId: string | null
  onSectionClick: (section: AgendaSection) => void
  stage: string
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  planned: <Circle className="w-3.5 h-3.5 text-stone-300" />,
  drafting: <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />,
  done: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
}

export function AgendaPanel({ agenda, focusedSectionId, onSectionClick, stage }: Props) {
  if (!agenda) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        {stage === 'agenda' || stage === 'telescope' ? (
          <>
            <Loader2 className="w-6 h-6 text-amber-500 animate-spin mb-3" />
            <p className="text-xs text-stone-500">
              {stage === 'telescope' ? '正在采集证据...' : '正在生成议程...'}
            </p>
          </>
        ) : (
          <>
            <FileText className="w-6 h-6 text-stone-300 mb-3" />
            <p className="text-xs text-stone-400">尚无议程</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="p-3">
      {/* 标题 */}
      <div className="mb-3">
        <h3 className="text-sm font-bold text-stone-800">{agenda.title}</h3>
        {agenda.subtitle && (
          <p className="text-xs text-stone-500 mt-0.5">{agenda.subtitle}</p>
        )}
        {agenda.openingStance && (
          <p className="text-[11px] text-stone-400 mt-1 italic">{agenda.openingStance}</p>
        )}
      </div>

      {/* 段落列表 */}
      <div className="space-y-1.5">
        {agenda.sections.map((sec) => {
          const isFocused = sec.id === focusedSectionId
          return (
            <button
              key={sec.id}
              onClick={() => onSectionClick(sec)}
              className={`w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-lg transition-all ${
                isFocused
                  ? 'bg-amber-50 border border-amber-200 shadow-sm'
                  : 'hover:bg-stone-50 border border-transparent'
              }`}
            >
              <span className="mt-0.5 flex-shrink-0">{STATUS_ICON[sec.status || 'planned']}</span>
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-medium truncate ${isFocused ? 'text-amber-700' : 'text-stone-700'}`}>
                  {sec.heading}
                </p>
                <p className="text-[10px] text-stone-400 truncate">{sec.intent}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-stone-300">{sec.targetLength} 字</span>
                  {sec.evidencePocket.length > 0 && (
                    <span className="text-[10px] text-stone-300">
                      {sec.evidencePocket.length} 条证据
                    </span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* 收束 */}
      {agenda.closingCall && (
        <p className="text-[11px] text-stone-400 mt-3 italic px-2">{agenda.closingCall}</p>
      )}
    </div>
  )
}
