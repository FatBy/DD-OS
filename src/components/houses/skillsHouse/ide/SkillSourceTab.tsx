/**
 * SkillSourceTab - 源码编辑器
 *
 * DunCrew 暖色风格:
 * - 暖白编辑区 + stone 行号
 * - monospace 字体
 */

import { useRef, useCallback, useMemo } from 'react'
import { useStore } from '@/store'

export function SkillSourceTab() {
  const content = useStore((s) => s.activeSkillContent)
  const updateSkillContent = useStore((s) => s.updateSkillContent)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const lineCount = useMemo(() => {
    if (!content) return 1
    return content.split('\n').length
  }, [content])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateSkillContent(e.target.value)
    },
    [updateSkillContent],
  )

  // Sync scroll between gutter and textarea
  const handleScroll = useCallback(() => {
    const textarea = textareaRef.current
    const gutter = document.getElementById('source-gutter')
    if (textarea && gutter) {
      gutter.scrollTop = textarea.scrollTop
    }
  }, [])

  if (content === null) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-stone-400">
        No content to edit
      </div>
    )
  }

  return (
    <div className="flex h-full font-mono text-[13px] leading-5">
      {/* Line numbers gutter */}
      <div
        id="source-gutter"
        className="w-10 shrink-0 bg-stone-50/60 border-r border-stone-200/40 overflow-hidden select-none pt-3 pr-2 text-right"
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="text-[11px] text-stone-400/70 leading-5">
            {i + 1}
          </div>
        ))}
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        onScroll={handleScroll}
        spellCheck={false}
        className="flex-1 min-w-0 p-3 bg-transparent text-stone-800 resize-none outline-none leading-5"
        style={{
          tabSize: 2,
        }}
      />
    </div>
  )
}
