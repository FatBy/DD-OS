import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, X, Trash2 } from 'lucide-react'
import { useStore } from '@/store'

export function InterruptedTasksWarning() {
  const hasInterruptedTasks = useStore((s) => s.hasInterruptedTasks)
  const activeExecutions = useStore((s) => s.activeExecutions)
  const markInterruptedTasksAsFailed = useStore((s) => s.markInterruptedTasksAsFailed)
  const dismissInterruptedTasksWarning = useStore((s) => s.dismissInterruptedTasksWarning)

  const interruptedCount = activeExecutions.filter(t => t.status === 'executing').length

  if (!hasInterruptedTasks || interruptedCount === 0) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[100]
                   bg-amber-900/95 backdrop-blur-xl border border-amber-500/30
                   rounded-xl shadow-[0_8px_32px_rgba(245,158,11,0.3)]
                   p-4 max-w-md w-[90vw]"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-mono font-semibold text-amber-200 mb-1">
              检测到中断的任务
            </h3>
            <p className="text-xs text-amber-200/70 mb-3">
              发现 {interruptedCount} 个任务在页面刷新时被中断。这些任务无法自动恢复。
            </p>
            
            <div className="flex items-center gap-2">
              <button
                onClick={markInterruptedTasksAsFailed}
                className="flex items-center gap-1.5 px-3 py-1.5 
                         bg-amber-500/20 border border-amber-500/30 
                         text-amber-200 text-xs font-mono rounded-lg
                         hover:bg-amber-500/30 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                标记为已中断
              </button>
              
              <button
                onClick={dismissInterruptedTasksWarning}
                className="flex items-center gap-1.5 px-3 py-1.5 
                         bg-white/5 border border-white/10 
                         text-white/60 text-xs font-mono rounded-lg
                         hover:bg-white/10 transition-colors"
              >
                稍后处理
              </button>
            </div>
          </div>
          
          <button
            onClick={dismissInterruptedTasksWarning}
            className="p-1 hover:bg-white/10 rounded transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4 text-white/40" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
