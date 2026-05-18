/**
 * FootnotesSection — 文末脚注列表
 */

interface Props {
  footnotes: Array<{ marker: string; label: string }>
}

export function FootnotesSection({ footnotes }: Props) {
  if (footnotes.length === 0) return null

  return (
    <div className="mt-10 pt-4 border-t border-stone-200">
      <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">
        参考文献
      </h4>
      <ol className="space-y-1">
        {footnotes.map((fn, i) => (
          <li key={i} className="text-[11px] text-stone-500 flex items-start gap-1.5">
            <span className="text-[10px] font-bold text-stone-400 mt-0.5 flex-shrink-0">
              [{fn.marker}]
            </span>
            <span>{fn.label}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
