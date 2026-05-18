/**
 * SkillPreviewTab - Markdown 预览
 *
 * DunCrew 暖色风格:
 * - 暖白 frontmatter 卡片 (stone 色系)
 * - Score badge 使用项目调色板
 * - prose-stone 排版
 */

import { useMemo } from 'react'
import { useStore } from '@/store'
import { MarkdownRenderer } from '@/components/ai/markdown/MarkdownRenderer'

/** 从 SKILL.md 内容分离 frontmatter 和 body */
function parseFrontmatter(content: string): { fields: Record<string, string>; body: string } {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/)
  if (!match) return { fields: {}, body: content }

  const fields: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w[\w.]*)\s*:\s*(.+)$/)
    if (m) {
      fields[m[1]] = m[2].trim()
    }
  }
  return { fields, body: match[2] }
}

export function SkillPreviewTab() {
  const content = useStore((s) => s.activeSkillContent)
  const diagnosticScore = useStore((s) => s.diagnosticScore)

  const { fields, body } = useMemo(
    () => parseFrontmatter(content || ''),
    [content],
  )

  if (!content) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-stone-400">
        No content to preview
      </div>
    )
  }

  return (
    <div className="p-5 max-w-3xl mx-auto">
      {/* Frontmatter card */}
      {Object.keys(fields).length > 0 && (
        <div className="mb-5 p-4 bg-stone-50/80 border border-stone-200/60 rounded-2xl">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black text-stone-400 uppercase tracking-[0.15em]">
              Frontmatter
            </span>
            {diagnosticScore !== null && (
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  diagnosticScore >= 80
                    ? 'bg-[#6cb478]/10 text-[#6cb478] border-[#6cb478]/30'
                    : diagnosticScore >= 50
                      ? 'bg-[#e8a838]/10 text-[#e8a838] border-[#e8a838]/30'
                      : 'bg-[#dc7864]/10 text-[#dc7864] border-[#dc7864]/30'
                }`}
              >
                Score: {diagnosticScore}
              </span>
            )}
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            {Object.entries(fields).map(([key, val]) => (
              <div key={key} className="contents">
                <span className="text-[11px] font-mono font-bold text-[#5ebab0]">{key}</span>
                <span className="text-[11px] text-stone-600 truncate">{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Markdown body */}
      <div className="prose prose-stone prose-sm max-w-none">
        <MarkdownRenderer content={body} />
      </div>
    </div>
  )
}
