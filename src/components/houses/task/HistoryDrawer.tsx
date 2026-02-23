import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Trash2, Clock, CheckCircle2, ChevronRight,
  Calendar, Activity, MessageSquare, Hash, StopCircle,
} from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import type { TaskItem } from '@/types'

const statusConfig: Record<string, { icon: typeof Clock; color: string; label: string }> = {
  pending: { icon: Clock, color: 'amber', label: '等待' },
  done: { icon: CheckCircle2, color: 'emerald', label: '完成' },
  terminated: { icon: StopCircle, color: 'red', label: '已终止' },
}

interface HistoryDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export function HistoryDrawer({ isOpen, onClose }: HistoryDrawerProps) {
  const activeExecutions = useStore((s) => s.activeExecutions)
  const removeActiveExecution = useStore((s) => s.removeActiveExecution)
  const clearTaskHistory = useStore((s) => s.clearTaskHistory)

  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 历史任务 = 非执行中的任务
  const historyTasks = activeExecutions
    .filter(t => t.status !== 'executing')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  const handleDelete = (id: string) => {
    removeActiveExecution(id)
    if (expandedId === id) setExpandedId(null)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 遮罩层 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/40 z-30"
            onClick={onClose}
          />

          {/* 抽屉 */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="absolute top-0 right-0 h-full w-[384px] max-w-[90%] bg-[#0a0f1e]/95 backdrop-blur-xl
                       border-l border-white/10 z-40 flex flex-col"
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between p-4 border-b border-white/10 flex-shrink-0">
              <h3 className="text-sm font-mono text-white/80">
                历史任务
                <span className="ml-2 text-xs text-white/30 bg-white/5 px-2 py-0.5 rounded">
                  {historyTasks.length}
                </span>
              </h3>
              <button
                onClick={onClose}
                className="p-1 text-white/30 hover:text-white/70 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 任务列表 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {historyTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-white/20">
                  <Clock className="w-8 h-8 mb-2" />
                  <span className="text-xs font-mono">暂无历史记录</span>
                </div>
              ) : (
                historyTasks.map((task) => (
                  <HistoryTaskCard
                    key={task.id}
                    task={task}
                    isExpanded={expandedId === task.id}
                    onToggle={() => setExpandedId(prev => prev === task.id ? null : task.id)}
                    onDelete={() => handleDelete(task.id)}
                  />
                ))
              )}
            </div>

            {/* 底部操作栏 */}
            {historyTasks.length > 0 && (
              <div className="p-3 border-t border-white/10 flex-shrink-0">
                <button
                  onClick={() => {
                    if (window.confirm('确定清空所有历史任务？')) {
                      clearTaskHistory()
                    }
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-mono
                             text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  清空全部
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function HistoryTaskCard({ task, isExpanded, onToggle, onDelete }: {
  task: TaskItem
  isExpanded: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const config = statusConfig[task.status] || statusConfig.done
  const Icon = config.icon

  return (
    <div className="group relative">
      <GlassCard
        themeColor={config.color}
        className="p-3 cursor-pointer hover:scale-[1.005] transition-transform"
        onClick={onToggle}
      >
        <div className="flex items-start gap-2.5">
          <div className={cn(
            'w-6 h-6 rounded flex items-center justify-center flex-shrink-0',
            `bg-${config.color}-500/20`
          )}>
            <Icon className={cn('w-3.5 h-3.5', `text-${config.color}-400`)} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-medium text-white/80 truncate flex-1">
                {task.title}
              </h4>
              <span className={cn(
                'text-[10px] font-mono px-1 py-0.5 rounded flex-shrink-0',
                `bg-${config.color}-500/15 text-${config.color}-400`
              )}>
                {config.label}
              </span>
            </div>

            {!isExpanded && (
              <p className="text-[11px] text-white/40 mt-0.5 line-clamp-1">
                {task.description}
              </p>
            )}

            {/* 展开详情 */}
            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 p-2 bg-white/5 rounded border border-white/10">
                    <p className="text-[11px] text-white/60 whitespace-pre-wrap leading-relaxed">
                      {task.description || '-'}
                    </p>
                  </div>

                  {task.executionOutput && (
                    <div className="mt-2 p-2 bg-emerald-500/5 rounded border border-emerald-500/15">
                      <pre className="text-[11px] text-white/60 whitespace-pre-wrap max-h-40 overflow-y-auto font-mono">
                        {task.executionOutput}
                      </pre>
                    </div>
                  )}

                  {task.executionError && (
                    <div className="mt-2 p-2 bg-red-500/5 rounded border border-red-500/15">
                      <p className="text-[11px] text-red-300/80 font-mono">{task.executionError}</p>
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-white/30">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-2.5 h-2.5" />
                      {new Date(task.timestamp).toLocaleString('zh-CN')}
                    </span>
                    {task.executionDuration !== undefined && (
                      <span className="flex items-center gap-1">
                        <Activity className="w-2.5 h-2.5" />
                        {(task.executionDuration / 1000).toFixed(1)}s
                      </span>
                    )}
                    {task.messageCount !== undefined && (
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-2.5 h-2.5" />
                        {task.messageCount}
                      </span>
                    )}
                    {task.sessionKey && (
                      <span className="flex items-center gap-1">
                        <Hash className="w-2.5 h-2.5" />
                        <span className="truncate max-w-[80px]">{task.sessionKey}</span>
                      </span>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!isExpanded && (
              <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-white/25">
                {task.executionDuration !== undefined && (
                  <span>{(task.executionDuration / 1000).toFixed(1)}s</span>
                )}
                <span>{new Date(task.timestamp).toLocaleDateString('zh-CN')}</span>
              </div>
            )}
          </div>

          <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronRight className="w-3 h-3 text-white/15 flex-shrink-0" />
          </motion.div>
        </div>
      </GlassCard>

      {/* 删除按钮 - hover 显示 */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="absolute top-2 right-2 p-1 rounded bg-red-500/0 text-red-400/0
                   group-hover:bg-red-500/15 group-hover:text-red-400 transition-all z-10"
        title="删除任务"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  )
}
