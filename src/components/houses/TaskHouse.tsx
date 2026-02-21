import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Inbox, Clock, CheckCircle2, Play,
  Loader2, MessageSquare, ChevronRight,
  Calendar, Hash, Activity, Brain, Wrench, Terminal,
  AlertCircle, ChevronDown, Trash2
} from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { AISummaryCard } from '@/components/ai/AISummaryCard'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import { useT } from '@/i18n'
import type { TranslationKey } from '@/i18n/locales/zh'
import type { TaskItem, ExecutionStep } from '@/types'

// 默认任务（根据模式显示不同内容）
const defaultTasksNative: TaskItem[] = [
  { id: '1', title: '启动 Native 服务器', description: 'python ddos-local-server.py --port 3001', status: 'done', priority: 'high', timestamp: new Date().toISOString() },
  { id: '2', title: '连接 DD-OS Native', description: '左下角选择 Native 模式并连接', status: 'pending', priority: 'high', timestamp: new Date().toISOString() },
  { id: '3', title: '开始对话', description: '通过 AI 聊天面板与 Agent 交流', status: 'pending', priority: 'medium', timestamp: new Date().toISOString() },
]

const defaultTasksOpenClaw: TaskItem[] = [
  { id: '1', title: '连接到 OpenClaw', description: '点击左下角连接面板开始', status: 'pending', priority: 'high', timestamp: new Date().toISOString() },
  { id: '2', title: '配置消息频道', description: '设置 Telegram/WhatsApp 等平台', status: 'pending', priority: 'medium', timestamp: new Date().toISOString() },
  { id: '3', title: '开始对话', description: '通过消息平台与 Agent 交流', status: 'pending', priority: 'low', timestamp: new Date().toISOString() },
]

const statusLabelKeys: Record<string, TranslationKey> = {
  pending: 'task.pending',
  executing: 'task.executing',
  done: 'task.done',
}

const statusConfig = {
  pending: { icon: Clock, color: 'amber' },
  executing: { icon: Play, color: 'cyan' },
  done: { icon: CheckCircle2, color: 'emerald' },
}

const priorityLabelKeys: Record<string, TranslationKey> = {
  high: 'task.priority_high',
  medium: 'task.priority_medium',
  low: 'task.priority_low',
}

const priorityConfig = {
  high: { color: 'red' },
  medium: { color: 'amber' },
  low: { color: 'slate' },
}

function EmptyColumn({ status }: { status: TaskItem['status'] }) {
  const t = useT()
  const emptyKeys: Record<string, TranslationKey> = {
    pending: 'task.empty_pending',
    executing: 'task.empty_executing',
    done: 'task.empty_done',
  }
  return (
    <div className="flex flex-col items-center justify-center py-8 text-white/20">
      <Inbox className="w-8 h-8 mb-2" />
      <span className="text-xs font-mono">{t(emptyKeys[status])}</span>
    </div>
  )
}

// 执行步骤图标映射
const stepTypeLabelKeys: Record<string, TranslationKey> = {
  thinking: 'task.thinking',
  tool_call: 'task.tool_call',
  tool_result: 'task.tool_result',
  output: 'task.output',
  error: 'task.error',
}

const stepTypeConfig = {
  thinking: { icon: Brain, color: 'purple' },
  tool_call: { icon: Wrench, color: 'cyan' },
  tool_result: { icon: Terminal, color: 'emerald' },
  output: { icon: MessageSquare, color: 'amber' },
  error: { icon: AlertCircle, color: 'red' },
}

// 执行步骤详情面板
function ExecutionStepsViewer({ steps, output, error, duration }: {
  steps?: ExecutionStep[]
  output?: string
  error?: string
  duration?: number
}) {
  const t = useT()
  const [stepsExpanded, setStepsExpanded] = useState(false)
  
  if (!steps?.length && !output && !error) {
    return (
      <div className="mt-2 p-3 bg-white/5 rounded-lg border border-white/10">
        <p className="text-xs text-white/40 font-mono">{t('task.no_record')}</p>
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-2">
      {/* 最终输出 / 错误 */}
      {output && (
        <div className="p-3 bg-emerald-500/5 rounded-lg border border-emerald-500/15">
          <div className="flex items-center gap-1.5 mb-1.5">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span className="text-[13px] font-mono text-emerald-400 font-medium">{t('task.exec_result')}</span>
            {duration !== undefined && (
              <span className="text-[12px] font-mono text-white/30 ml-auto">{(duration / 1000).toFixed(1)}s</span>
            )}
          </div>
          <pre className="text-xs text-white/70 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto font-mono">
            {output}
          </pre>
        </div>
      )}
      
      {error && (
        <div className="p-3 bg-red-500/5 rounded-lg border border-red-500/15">
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertCircle className="w-3 h-3 text-red-400" />
            <span className="text-[13px] font-mono text-red-400 font-medium">{t('task.exec_failed')}</span>
          </div>
          <p className="text-xs text-red-300/80 font-mono">{error}</p>
        </div>
      )}

      {/* 执行步骤折叠面板 */}
      {steps && steps.length > 0 && (
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <button
            onClick={(e) => { e.stopPropagation(); setStepsExpanded(!stepsExpanded) }}
            className="w-full flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/8 transition-colors"
          >
            <Activity className="w-3 h-3 text-white/40" />
            <span className="text-[13px] font-mono text-white/50">
              {t('task.exec_steps')} ({steps.length})
            </span>
            <motion.div 
              animate={{ rotate: stepsExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              className="ml-auto"
            >
              <ChevronDown className="w-3 h-3 text-white/30" />
            </motion.div>
          </button>
          
          <AnimatePresence>
            {stepsExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="max-h-80 overflow-y-auto">
                  {steps.map((step, i) => {
                    const sConfig = stepTypeConfig[step.type] || stepTypeConfig.output
                    const StepIcon = sConfig.icon
                    const labelKey = stepTypeLabelKeys[step.type] || 'task.output'
                    return (
                      <div 
                        key={step.id || i}
                        className="flex gap-2 px-3 py-2 border-t border-white/5 hover:bg-white/3"
                      >
                        <div className={cn(
                          'w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5',
                          `bg-${sConfig.color}-500/15`
                        )}>
                          <StepIcon className={cn('w-3 h-3', `text-${sConfig.color}-400`)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn('text-[12px] font-mono font-medium', `text-${sConfig.color}-400`)}>
                              {t(labelKey)}
                            </span>
                            {step.toolName && (
                              <span className="text-[12px] font-mono text-white/30 bg-white/5 px-1 rounded">
                                {step.toolName}
                              </span>
                            )}
                            {step.duration !== undefined && (
                              <span className="text-[11px] font-mono text-white/20 ml-auto">
                                {step.duration}ms
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-white/50 font-mono mt-0.5 whitespace-pre-wrap break-all leading-relaxed line-clamp-4">
                            {step.content}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

function TaskCard({ task, index, isExpanded, onToggle }: { 
  task: TaskItem
  index: number
  isExpanded: boolean
  onToggle: () => void
}) {
  const t = useT()
  const config = statusConfig[task.status]
  const priority = priorityConfig[task.priority]
  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <GlassCard 
        themeColor={config.color} 
        className="p-4 cursor-pointer hover:scale-[1.005] transition-transform"
        onClick={onToggle}
      >
        <div className="flex items-start gap-3">
          <div className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
            `bg-${config.color}-500/20`
          )}>
            <Icon className={cn('w-4 h-4', `text-${config.color}-400`)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-white/90 truncate">
                {task.title}
              </h4>
              <span className={cn(
                'text-[12px] font-mono px-1.5 py-0.5 rounded flex-shrink-0',
                `bg-${priority.color}-500/20 text-${priority.color}-400`
              )}>
                {t(priorityLabelKeys[task.priority])}
              </span>
            </div>
            
            {/* 折叠时显示截断描述 */}
            {!isExpanded && (
              <p className="text-xs text-white/50 mt-1 line-clamp-2">
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
                  {/* 完整描述 */}
                  <div className="mt-2 p-2.5 bg-white/5 rounded-lg border border-white/10">
                    <p className="text-xs text-white/70 whitespace-pre-wrap leading-relaxed">
                      {task.description || '—'}
                    </p>
                  </div>

                  {/* 执行步骤详情 */}
                  {(task.executionSteps || task.executionOutput || task.executionError) && (
                    <ExecutionStepsViewer
                      steps={task.executionSteps}
                      output={task.executionOutput}
                      error={task.executionError}
                      duration={task.executionDuration}
                    />
                  )}

                  {/* 元数据 */}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-mono text-white/40">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(task.timestamp).toLocaleString('zh-CN')}
                    </span>
                    {task.messageCount !== undefined && (
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" />
                        {task.messageCount} {t('task.messages')}
                      </span>
                    )}
                    {task.executionSteps && task.executionSteps.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Activity className="w-3 h-3" />
                        {task.executionSteps.length}
                      </span>
                    )}
                    {task.sessionKey && (
                      <span className="flex items-center gap-1">
                        <Hash className="w-3 h-3" />
                        <span className="truncate max-w-[120px]">{task.sessionKey}</span>
                      </span>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 折叠时的简要元数据 */}
            {!isExpanded && (
              <div className="flex items-center gap-3 mt-2 text-[12px] font-mono text-white/30">
                {task.executionSteps && task.executionSteps.length > 0 && (
                  <span className="flex items-center gap-1 text-cyan-400/50">
                    <Activity className="w-3 h-3" />
                    {task.executionSteps.length}
                  </span>
                )}
                {task.messageCount !== undefined && (
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    {task.messageCount}
                  </span>
                )}
                <span>{new Date(task.timestamp).toLocaleDateString('zh-CN')}</span>
              </div>
            )}
          </div>

          {/* 展开/折叠指示器 */}
          <motion.div
            animate={{ rotate: isExpanded ? 90 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronRight className="w-4 h-4 text-white/20 flex-shrink-0" />
          </motion.div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// System Inbox: 折叠式待处理任务面板
function SystemInbox({ 
  tasks, 
  isExpanded, 
  onToggle,
  expandedTaskId,
  onToggleTask,
}: { 
  tasks: TaskItem[]
  isExpanded: boolean
  onToggle: () => void
  expandedTaskId: string | null
  onToggleTask: (id: string) => void
}) {
  const t = useT()

  if (tasks.length === 0) return null

  return (
    <div className="mb-4 flex-shrink-0">
      <div 
        onClick={onToggle}
        className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg cursor-pointer hover:bg-amber-500/15 transition-colors"
      >
        <Inbox className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-mono text-amber-200">{t('task.inbox')}</h3>
        <span className="text-[13px] font-mono text-white/40 ml-1">{t('task.inbox_from')}</span>
        <span className="bg-amber-500/20 text-amber-300 text-[13px] font-mono px-2 py-0.5 rounded-full ml-auto">
          {tasks.length}
        </span>
        <ChevronRight className={cn(
          "w-4 h-4 text-amber-400/50 transition-transform duration-200",
          isExpanded && "rotate-90"
        )} />
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="pt-3 space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {tasks.map((task, i) => (
                <TaskCard 
                  key={task.id} 
                  task={task} 
                  index={i} 
                  isExpanded={expandedTaskId === task.id}
                  onToggle={() => onToggleTask(task.id)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function TaskHouse() {
  const t = useT()
  const storeTasks = useStore((s) => s.tasks)
  const activeExecutions = useStore((s) => s.activeExecutions)
  const loading = useStore((s) => s.sessionsLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const connectionMode = useStore((s) => s.connectionMode)
  const agentStatus = useStore((s) => s.agentStatus)
  const currentTaskDescription = useStore((s) => s.currentTaskDescription)
  const clearTaskHistory = useStore((s) => s.clearTaskHistory)
  
  const isConnected = connectionStatus === 'connected'
  const defaultTasks = connectionMode === 'native' ? defaultTasksNative : defaultTasksOpenClaw
  const hasHistory = activeExecutions.length > 0
  const tasks = (isConnected && storeTasks.length > 0) || hasHistory
    ? [...activeExecutions, ...storeTasks]
    : defaultTasks

  // 展开状态
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  // Inbox 折叠状态（默认收起）
  const [isInboxExpanded, setIsInboxExpanded] = useState(false)

  const toggleExpand = (id: string) => {
    setExpandedTaskId(prev => prev === id ? null : id)
  }

  const sortDesc = (a: TaskItem, b: TaskItem) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()

  const pendingTasks = tasks.filter((t) => t.status === 'pending').sort(sortDesc)
  const executingTasks = tasks.filter((t) => t.status === 'executing').sort(sortDesc)
  const doneTasks = tasks.filter((t) => t.status === 'done').sort(sortDesc)

  if (loading && isConnected) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
      </div>
    )
  }

  const renderColumn = (
    columnTasks: TaskItem[], 
    status: TaskItem['status'],
  ) => {
    const config = statusConfig[status]
    const Icon = config.icon
    return (
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <Icon className={cn('w-4 h-4', `text-${config.color}-400`)} />
          <h3 className={cn('font-mono text-sm tracking-wider', `text-${config.color}-300`)}>
            {t(statusLabelKeys[status])}
          </h3>
          <span className="text-[13px] font-mono text-white/40 bg-white/5 px-2 py-0.5 rounded ml-auto">
            {columnTasks.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
          {columnTasks.length === 0 ? (
            <EmptyColumn status={status} />
          ) : (
            columnTasks.map((task, i) => (
              <TaskCard 
                key={task.id} 
                task={task} 
                index={i} 
                isExpanded={expandedTaskId === task.id}
                onToggle={() => toggleExpand(task.id)}
              />
            ))
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-6">
      <AISummaryCard view="task" />

      {/* Agent 活跃任务横幅 */}
      <AnimatePresence>
        {agentStatus !== 'idle' && currentTaskDescription && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="mb-4 flex-shrink-0"
          >
            <div className={cn(
              'p-3 rounded-lg border',
              agentStatus === 'thinking'
                ? 'bg-cyan-500/10 border-cyan-500/20'
                : 'bg-amber-500/10 border-amber-500/20'
            )}>
              <div className="flex items-center gap-2">
                <Activity className={cn(
                  'w-4 h-4',
                  agentStatus === 'thinking' ? 'text-cyan-400 animate-pulse' : 'text-amber-400 animate-pulse'
                )} />
                <span className="text-xs font-mono text-white/70">
                  Agent {agentStatus === 'thinking' ? t('task.agent_thinking') : t('task.agent_executing')}
                </span>
                <span className="text-xs font-mono text-white/40 truncate flex-1">
                  {currentTaskDescription}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* System Inbox */}
      <SystemInbox
        tasks={pendingTasks}
        isExpanded={isInboxExpanded}
        onToggle={() => setIsInboxExpanded(!isInboxExpanded)}
        expandedTaskId={expandedTaskId}
        onToggleTask={toggleExpand}
      />

      {/* OS Workspace 标题 */}
      <div className="flex items-center gap-2 mb-4">
        <Hash className="w-4 h-4 text-cyan-400" />
        <h3 className="font-mono text-sm text-cyan-200 tracking-wider">OS Workspace</h3>
        {hasHistory && (
          <button
            onClick={() => { if (window.confirm('确定清除所有任务历史？')) clearTaskHistory() }}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-mono text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            {t('common.delete')}
          </button>
        )}
      </div>

      {/* 主工作区 */}
      <div className="flex flex-1 gap-4 min-h-0">
        {renderColumn(executingTasks, 'executing')}
        {renderColumn(doneTasks, 'done')}
      </div>
    </div>
  )
}
