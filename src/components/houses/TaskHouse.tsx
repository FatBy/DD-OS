import { useState } from 'react'
import { Loader2, History } from 'lucide-react'
import { useStore } from '@/store'
import { SilentAnalysisView } from './task/SilentAnalysisView'
import { ExecutionFocusView } from './task/ExecutionFocusView'
import { HistoryDrawer } from './task/HistoryDrawer'

export function TaskHouse() {
  const activeExecutions = useStore((s) => s.activeExecutions)
  const loading = useStore((s) => s.sessionsLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const updateActiveExecution = useStore((s) => s.updateActiveExecution)
  const abortChat = useStore((s) => s.abortChat)

  const isConnected = connectionStatus === 'connected'
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 正在执行的任务（取第一个）
  const executingTask = activeExecutions.find(t => t.status === 'executing') ?? null
  const isExecuting = executingTask !== null

  // 历史任务数量（非执行中）
  const historyCount = activeExecutions.filter(t => t.status !== 'executing').length

  // 终止任务
  const handleTerminate = (taskId: string) => {
    abortChat()
    updateActiveExecution(taskId, { status: 'terminated' })
  }

  if (loading && isConnected) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="relative flex flex-col h-full">
      {/* 历史按钮 - 固定右上角 */}
      {historyCount > 0 && (
        <button
          onClick={() => setDrawerOpen(true)}
          className="absolute top-4 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5
                     bg-white/5 border border-white/10 text-white/50 text-xs font-mono
                     rounded-lg hover:bg-white/10 hover:text-white/70 transition-colors"
        >
          <History className="w-3.5 h-3.5" />
          <span>{historyCount}</span>
        </button>
      )}

      {/* 主视图区域 */}
      {isExecuting ? (
        <ExecutionFocusView
          task={executingTask}
          onTerminate={handleTerminate}
        />
      ) : (
        <SilentAnalysisView />
      )}

      {/* 历史抽屉 */}
      <HistoryDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
