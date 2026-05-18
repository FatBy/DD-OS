/**
 * Composer — 右栏写作区主面板
 *
 * 按 agenda sections 顺序渲染 ParagraphCard
 * 流式中显示 raw text, done 状态显示 Markdown
 */

import { FileText } from 'lucide-react'
import type { AgendaDoc, AgendaSection, EvidenceItem } from '@/types'
import { ParagraphCard } from './ParagraphCard'
import { FootnotesSection } from './FootnotesSection'

const FONT_SERIF = "'Georgia', 'Noto Serif SC', 'SimSun', serif"

interface Props {
  agenda: AgendaDoc | null
  focusedSectionId: string | null
  evidencePool: EvidenceItem[]
  onSectionClick: (section: AgendaSection) => void
}

export function Composer({ agenda, focusedSectionId, evidencePool, onSectionClick }: Props) {
  // evidencePool 保留在 Props 契约中, 预留给 FootnotesSection 内嵌预览 / 引用跳转使用
  void evidencePool
  if (!agenda) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <FileText className="w-8 h-8 text-stone-300 mb-3" />
        <p className="text-sm text-stone-400">等待议程生成...</p>
      </div>
    )
  }

  // 收集所有已完成段落的脚注
  const allFootnotes: Array<{ marker: string; label: string }> = []
  for (const sec of agenda.sections) {
    if (sec.footnotes) {
      for (const fn of sec.footnotes) {
        allFootnotes.push({ marker: fn.marker, label: fn.label })
      }
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      {/* 文档标题 */}
      <div className="mb-8">
        <h1 className="text-xl font-bold text-stone-800" style={{ fontFamily: FONT_SERIF }}>{agenda.title}</h1>
        {agenda.subtitle && (
          <p className="text-sm text-stone-500 mt-1">{agenda.subtitle}</p>
        )}
      </div>

      {/* 段落 */}
      <div className="space-y-6">
        {agenda.sections.map((sec) => (
          <ParagraphCard
            key={sec.id}
            section={sec}
            isFocused={sec.id === focusedSectionId}
            onClick={() => onSectionClick(sec)}
          />
        ))}
      </div>

      {/* 脚注 */}
      {allFootnotes.length > 0 && (
        <FootnotesSection footnotes={allFootnotes} />
      )}
    </div>
  )
}
