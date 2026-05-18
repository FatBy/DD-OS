interface MemoryStatusBarProps {
  l0Count: number
  traceCount: number
  solidificationPercent: number
}

export function MemoryStatusBar({
  l0Count,
  traceCount,
  solidificationPercent,
}: MemoryStatusBarProps) {
  return (
    <div className="h-10 flex items-center justify-between px-5 bg-white/50 backdrop-blur-lg border-t border-white/40 shrink-0">
      {/* 左侧统计 */}
      <span className="text-xs text-stone-500">
        {l0Count} 条核心记忆 · {traceCount} 条轨迹 · {solidificationPercent}% 固化
      </span>

      {/* 右侧固化进度条 */}
      <div className="flex items-center gap-2">
        <div className="w-24 h-1.5 rounded-full bg-stone-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400/80 to-emerald-500/80 transition-all duration-500"
            style={{ width: `${solidificationPercent}%` }}
          />
        </div>
      </div>
    </div>
  )
}
