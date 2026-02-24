import { useState } from 'react'
import { Loader2, History, Zap } from 'lucide-react'
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

  // 正在执行的任务（支持多个同时执行）
  const executingTasks = activeExecutions.filter(t => t.status === 'executing')
  const isExecuting = executingTasks.length > 0

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
      {/* 顶部状态栏 - 多任务执行时显示 */}
      {executingTasks.length > 0 && (
        <div className="flex items-center justify-center gap-3 px-4 py-2.5 bg-cyan-500/10 border-b border-cyan-500/20">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-400 animate-pulse" />
            <span className="text-sm font-mono text-cyan-300">
              {executingTasks.length} 个任务正在执行
            </span>
          </div>
        </div>
      )}

      {/* 历史按钮 - 固定右上角 */}
      {historyCount > 0 && (
        <button
          onClick={() => setDrawerOpen(true)}
          className="absolute top-4 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5
                     bg-white/5 border border-white/10 text-white/50 text-xs font-mono
                     rounded-lg hover:bg-white/10 hover:text-white/70 transition-colors"
          style={{ top: executingTasks.length > 0 ? '3.5rem' : '1rem' }}
        >
          <History className="w-3.5 h-3.5" />
          <span>{historyCount}</span>
        </button>
      )}

      {/* 主视图区域 */}
      {isExecuting ? (
        <div className="flex-1 overflow-y-auto space-y-4">
          {executingTasks.map(task => (
            <ExecutionFocusView
              key={task.id}
              task={task}
              onTerminate={handleTerminate}
            />
          ))}
        </div>
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
