import { useState } from 'react'
import { Loader2, Zap, Clock, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import { SilentAnalysisView } from './task/SilentAnalysisView'
import { ExecutionFocusView } from './task/ExecutionFocusView'
import { HistoryDrawer } from './task/HistoryDrawer'

type TabType = 'executing' | 'history' | 'interrupted'

interface TabConfig {
  id: TabType
  label: string
  icon: typeof Zap
  color: string
}

const TABS: TabConfig[] = [
  { id: 'executing', label: '执行中', icon: Zap, color: 'cyan' },
  { id: 'history', label: '历史', icon: CheckCircle2, color: 'emerald' },
  { id: 'interrupted', label: '已中断', icon: AlertTriangle, color: 'amber' },
]

export function TaskHouse() {
  const activeExecutions = useStore((s) => s.activeExecutions)
  const loading = useStore((s) => s.sessionsLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const updateActiveExecution = useStore((s) => s.updateActiveExecution)
  const abortChat = useStore((s) => s.abortChat)

  const isConnected = connectionStatus === 'connected'
  const [activeTab, setActiveTab] = useState<TabType>('executing')
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 按状态分类任务
  const executingTasks = activeExecutions.filter(t => t.status === 'executing')
  const historyTasks = activeExecutions.filter(t => t.status === 'done' || t.status === 'terminated')
  const interruptedTasks = activeExecutions.filter(t => t.status === 'interrupted')

  // Tab 计数
  const tabCounts: Record<TabType, number> = {
    executing: executingTasks.length,
    history: historyTasks.length,
    interrupted: interruptedTasks.length,
  }

  // 如果有执行中的任务，自动切换到执行中 Tab
  const hasExecuting = executingTasks.length > 0
  const currentTab = hasExecuting && activeTab !== 'executing' ? 'executing' : activeTab

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
      {/* Tab 栏 */}
      <div className="flex items-center gap-1 px-4 py-3 border-b border-white/10 bg-black/20">
        {TABS.map((tab) => {
          const count = tabCounts[tab.id]
          const isActive = currentTab === tab.id
          const Icon = tab.icon
          
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono transition-all',
                isActive
                  ? `bg-${tab.color}-500/20 border border-${tab.color}-500/30 text-${tab.color}-300`
                  : 'bg-white/5 border border-transparent text-white/50 hover:bg-white/10 hover:text-white/70'
              )}
              style={isActive ? {
                backgroundColor: `rgb(var(--color-${tab.color}-500) / 0.2)`,
                borderColor: `rgb(var(--color-${tab.color}-500) / 0.3)`,
              } : undefined}
            >
              <Icon className={cn(
                'w-3.5 h-3.5',
                isActive && tab.id === 'executing' && 'animate-pulse'
              )} />
              <span>{tab.label}</span>
              {count > 0 && (
                <span className={cn(
                  'px-1.5 py-0.5 rounded-full text-[10px] font-bold',
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'bg-white/10 text-white/60'
                )}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 主视图区域 */}
      <div className="flex-1 overflow-y-auto">
        {currentTab === 'executing' && (
          <>
            {executingTasks.length > 0 ? (
              <div className="p-4 space-y-4">
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
          </>
        )}

        {currentTab === 'history' && (
          <>
            {historyTasks.length > 0 ? (
              <div className="p-4">
                <HistoryDrawer
                  isOpen={true}
                  onClose={() => {}}
                  inline={true}
                  tasks={historyTasks}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-16 text-white/30">
                <Clock className="w-10 h-10 mb-3 opacity-50" />
                <p className="text-sm font-mono">暂无历史任务</p>
                <p className="text-xs font-mono mt-1 text-white/20">
                  完成的任务将显示在这里
                </p>
              </div>
            )}
          </>
        )}

        {currentTab === 'interrupted' && (
          <>
            {interruptedTasks.length > 0 ? (
              <div className="p-4">
                <HistoryDrawer
                  isOpen={true}
                  onClose={() => {}}
                  inline={true}
                  tasks={interruptedTasks}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-16 text-white/30">
                <AlertTriangle className="w-10 h-10 mb-3 opacity-50" />
                <p className="text-sm font-mono">暂无中断任务</p>
                <p className="text-xs font-mono mt-1 text-white/20">
                  页面刷新时中断的任务将显示在这里
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* 保留原有的抽屉功能，用于快速访问 */}
      <HistoryDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
