/**
 * SkillDiffView - Diff 可视化
 *
 * DunCrew 暖色风格:
 * - 使用项目调色板 (#6cb478 added, #dc7864 removed)
 * - 圆角容器
 */

import { useMemo } from 'react'
import { diffLines } from 'diff'
import { useStore } from '@/store'

export function SkillDiffView() {
  const pendingDiff = useStore((s) => s.pendingDiff)
  const applyDiff = useStore((s) => s.applyDiff)
  const rejectDiff = useStore((s) => s.rejectDiff)

  const changes = useMemo(() => {
    if (!pendingDiff) return []
    return diffLines(pendingDiff.original, pendingDiff.proposed)
  }, [pendingDiff])

  if (!pendingDiff) return null

  // Count additions and removals
  let addedLines = 0
  let removedLines = 0
  for (const change of changes) {
    const count = (change.value.match(/\n/g) || []).length + (change.value.endsWith('\n') ? 0 : 1)
    if (change.added) addedLines += count
    if (change.removed) removedLines += count
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-100/60">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-stone-600">Changes</span>
          <span className="text-[10px] font-mono font-bold text-[#6cb478]">+{addedLines}</span>
          <span className="text-[10px] font-mono font-bold text-[#dc7864]">-{removedLines}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={rejectDiff}
            className="px-2.5 py-1 text-[11px] font-bold text-stone-500 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
          >
            Reject
          </button>
          <button
            onClick={() => applyDiff()}
            className="px-2.5 py-1 text-[11px] font-bold text-white bg-[#5ebab0] hover:bg-[#5ebab0]/90 rounded-lg transition-colors shadow-sm"
          >
            Accept
          </button>
        </div>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-auto font-mono text-[12px] leading-5">
        {changes.map((change, idx) => {
          const lines = change.value.split('\n')
          if (lines[lines.length - 1] === '') lines.pop()

          return lines.map((line, lineIdx) => {
            let bgClass = ''
            let textClass = 'text-stone-700'
            let prefix = ' '

            if (change.added) {
              bgClass = 'bg-[#6cb478]/8'
              textClass = 'text-[#3c6b42]'
              prefix = '+'
            } else if (change.removed) {
              bgClass = 'bg-[#dc7864]/8'
              textClass = 'text-[#8b3a2c]'
              prefix = '-'
            }

            return (
              <div
                key={`${idx}-${lineIdx}`}
                className={`flex ${bgClass} border-b border-stone-50`}
              >
                <span className={`w-5 shrink-0 text-center text-[10px] ${
                  change.added ? 'text-[#6cb478]' : change.removed ? 'text-[#dc7864]' : 'text-stone-300'
                }`}>
                  {prefix}
                </span>
                <span className={`flex-1 px-2 whitespace-pre ${textClass}`}>
                  {line}
                </span>
              </div>
            )
          })
        })}
      </div>
    </div>
  )
}
