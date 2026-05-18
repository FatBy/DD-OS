/**
 * SkillDiagnosticsBar - 底部诊断条
 *
 * DunCrew 暖色风格:
 * - 使用项目调色板 (#6cb478/#e8a838/#dc7864)
 * - 圆角 badges
 */

import { useStore } from '@/store'

export function SkillDiagnosticsBar() {
  const activeSkillName = useStore((s) => s.activeSkillName)
  const diagnostics = useStore((s) => s.diagnostics)
  const diagnosticScore = useStore((s) => s.diagnosticScore)
  const validateSkill = useStore((s) => s.validateSkill)

  if (!activeSkillName) return null

  const scoreColor =
    diagnosticScore === null
      ? 'text-stone-400'
      : diagnosticScore >= 80
        ? 'text-[#6cb478]'
        : diagnosticScore >= 50
          ? 'text-[#e8a838]'
          : 'text-[#dc7864]'

  const scoreBg =
    diagnosticScore === null
      ? 'bg-stone-100 border-stone-200/60'
      : diagnosticScore >= 80
        ? 'bg-[#6cb478]/10 border-[#6cb478]/30'
        : diagnosticScore >= 50
          ? 'bg-[#e8a838]/10 border-[#e8a838]/30'
          : 'bg-[#dc7864]/10 border-[#dc7864]/30'

  const failedItems = diagnostics?.filter((d) => !d.passed) ?? []

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-t border-stone-100">
      {/* Score badge */}
      <div
        className={`flex items-center gap-1 px-2.5 py-0.5 rounded-xl border text-[11px] font-bold ${scoreBg} ${scoreColor}`}
      >
        <span>{diagnosticScore !== null ? `${diagnosticScore}` : '--'}</span>
        <span className="text-[9px] font-normal opacity-70">/100</span>
      </div>

      {/* Diagnostic items summary */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-thin scrollbar-thumb-stone-200">
        {diagnostics ? (
          diagnostics.map((item) => (
            <span
              key={item.field}
              title={item.suggestion}
              className={`shrink-0 px-1.5 py-0.5 rounded-lg text-[10px] font-medium ${
                item.passed
                  ? 'bg-[#6cb478]/10 text-[#6cb478]'
                  : 'bg-[#dc7864]/10 text-[#dc7864]'
              }`}
            >
              {item.passed ? '\u2713' : '\u2717'} {item.field}
            </span>
          ))
        ) : (
          <span className="text-[10px] text-stone-400">Not validated</span>
        )}
      </div>

      {/* Failed count */}
      {failedItems.length > 0 && (
        <span className="text-[10px] font-bold text-[#dc7864] shrink-0">
          {failedItems.length} issue{failedItems.length > 1 ? 's' : ''}
        </span>
      )}

      {/* Validate button */}
      <button
        onClick={() => validateSkill()}
        className="shrink-0 px-2.5 py-0.5 text-[10px] font-bold text-stone-400 hover:text-[#5ebab0] hover:bg-[#5ebab0]/10 rounded-lg transition-colors"
      >
        Validate
      </button>
    </div>
  )
}
