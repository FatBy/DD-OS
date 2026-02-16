import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Inbox, Clock, CheckCircle2, Play,
  Loader2, MessageSquare, ChevronRight, Sparkles,
  Calendar, Hash
} from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { AISummaryCard } from '@/components/ai/AISummaryCard'
import { useStore } from '@/store'
import { isLLMConfigured } from '@/services/llmService'
import { cn } from '@/utils/cn'
import type { TaskItem, TaskEnhancement } from '@/types'

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

const statusConfig = {
  pending: { icon: Clock, color: 'amber', label: '待处理' },
  executing: { icon: Play, color: 'cyan', label: '进行中' },
  done: { icon: CheckCircle2, color: 'emerald', label: '已完成' },
}

const priorityConfig = {
  high: { color: 'red', label: '高' },
  medium: { color: 'amber', label: '中' },
  low: { color: 'slate', label: '低' },
}

function EmptyColumn({ status }: { status: TaskItem['status'] }) {
  const config = statusConfig[status]
  return (
    <div className="flex flex-col items-center justify-center py-8 text-white/20">
      <Inbox className="w-8 h-8 mb-2" />
      <span className="text-xs font-mono">暂无{config.label}任务</span>
    </div>
  )
}

function TaskCard({ task, index, enhancement, isEnhancing, isExpanded, onToggle }: { 
  task: TaskItem
  index: number
  enhancement?: TaskEnhancement
  isEnhancing?: boolean
  isExpanded: boolean
  onToggle: () => void
}) {
  const config = statusConfig[task.status]
  const priority = priorityConfig[task.priority]
  const Icon = config.icon

  const displayTitle = enhancement?.naturalTitle || task.title
  const hasAITitle = !!enhancement?.naturalTitle

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
              {isEnhancing && !enhancement ? (
                <div className="h-4 bg-white/10 rounded w-2/3 animate-pulse" />
              ) : (
                <h4 className="text-sm font-medium text-white/90 truncate">
                  {displayTitle}
                </h4>
              )}
              <span className={cn(
                'text-[9px] font-mono px-1.5 py-0.5 rounded flex-shrink-0',
                `bg-${priority.color}-500/20 text-${priority.color}-400`
              )}>
                {priority.label}
              </span>
            </div>
            {/* 原始标题（AI 命名后显示） */}
            {hasAITitle && (
              <p className="text-[9px] font-mono text-white/25 mt-0.5 truncate">
                {task.title}
              </p>
            )}
            
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
                      {task.description || '暂无详细描述'}
                    </p>
                  </div>

                  {/* 元数据 */}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] font-mono text-white/40">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(task.timestamp).toLocaleString('zh-CN')}
                    </span>
                    {task.messageCount !== undefined && (
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" />
                        {task.messageCount} 条消息
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
              <div className="flex items-center gap-3 mt-2 text-[9px] font-mono text-white/30">
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
  taskEnhancements,
  isEnhancing,
  expandedTaskId,
  onToggleTask,
}: { 
  tasks: TaskItem[]
  isExpanded: boolean
  onToggle: () => void
  taskEnhancements: Record<string, TaskEnhancement>
  isEnhancing: boolean
  expandedTaskId: string | null
  onToggleTask: (id: string) => void
}) {
  if (tasks.length === 0) return null

  return (
    <div className="mb-4 flex-shrink-0">
      <div 
        onClick={onToggle}
        className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg cursor-pointer hover:bg-amber-500/15 transition-colors"
      >
        <Inbox className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-mono text-amber-200">System Inbox</h3>
        <span className="text-[10px] font-mono text-white/40 ml-1">来自 IM / 系统</span>
        <span className="bg-amber-500/20 text-amber-300 text-[10px] font-mono px-2 py-0.5 rounded-full ml-auto">
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
                  enhancement={taskEnhancements[task.id]}
                  isEnhancing={isEnhancing}
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
  const storeTasks = useStore((s) => s.tasks)
  const loading = useStore((s) => s.sessionsLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const connectionMode = useStore((s) => s.connectionMode)
  
  // AI 增强
  const taskEnhancements = useStore((s) => s.taskEnhancements)
  const taskEnhancementsLoading = useStore((s) => s.taskEnhancementsLoading)
  const enhanceTaskNames = useStore((s) => s.enhanceTaskNames)
  const clearTaskEnhancements = useStore((s) => s.clearTaskEnhancements)
  
  const isConnected = connectionStatus === 'connected'
  const defaultTasks = connectionMode === 'native' ? defaultTasksNative : defaultTasksOpenClaw
  const tasks = isConnected && storeTasks.length > 0 ? storeTasks : defaultTasks
  const configured = isLLMConfigured()
  const hasEnhancements = Object.keys(taskEnhancements).length > 0

  // 展开状态
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  // Inbox 折叠状态（默认收起）
  const [isInboxExpanded, setIsInboxExpanded] = useState(false)

  const toggleExpand = (id: string) => {
    setExpandedTaskId(prev => prev === id ? null : id)
  }

  // 首次进入自动触发 AI 命名
  useEffect(() => {
    if (configured && tasks.length > 0) {
      enhanceTaskNames(tasks)
    }
  }, [configured, tasks.length])

  const handleAIRefresh = () => {
    clearTaskEnhancements()
    enhanceTaskNames(tasks)
  }
  
  // 分类：Pending → System Inbox，Executing/Done → OS Workspace
  const pendingTasks = tasks.filter((t) => t.status === 'pending')
  const executingTasks = tasks.filter((t) => t.status === 'executing')
  const doneTasks = tasks.filter((t) => t.status === 'done')

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
    config: typeof statusConfig[keyof typeof statusConfig]
  ) => {
    const Icon = config.icon
    return (
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <Icon className={cn('w-4 h-4', `text-${config.color}-400`)} />
          <h3 className={cn('font-mono text-sm tracking-wider', `text-${config.color}-300`)}>
            {config.label}
          </h3>
          <span className="text-[10px] font-mono text-white/40 bg-white/5 px-2 py-0.5 rounded ml-auto">
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
                enhancement={taskEnhancements[task.id]}
                isEnhancing={taskEnhancementsLoading}
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
      
      {/* AI 命名控制栏 */}
      {configured && tasks.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={handleAIRefresh}
            disabled={taskEnhancementsLoading}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors',
              hasEnhancements
                ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400'
                : 'bg-white/5 border border-white/10 text-white/40 hover:text-amber-400 hover:border-amber-500/30'
            )}
          >
            {taskEnhancementsLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            {hasEnhancements ? 'AI 已优化标题' : 'AI 优化标题'}
          </button>
        </div>
      )}

      {/* System Inbox: 折叠式待处理任务 */}
      <SystemInbox
        tasks={pendingTasks}
        isExpanded={isInboxExpanded}
        onToggle={() => setIsInboxExpanded(!isInboxExpanded)}
        taskEnhancements={taskEnhancements}
        isEnhancing={taskEnhancementsLoading}
        expandedTaskId={expandedTaskId}
        onToggleTask={toggleExpand}
      />

      {/* OS Workspace 标题 */}
      <div className="flex items-center gap-2 mb-4">
        <Hash className="w-4 h-4 text-cyan-400" />
        <h3 className="font-mono text-sm text-cyan-200 tracking-wider">OS Workspace</h3>
      </div>

      {/* 主工作区: 进行中 & 已完成 */}
      <div className="flex flex-1 gap-4 min-h-0">
        {renderColumn(executingTasks, 'executing', statusConfig.executing)}
        {renderColumn(doneTasks, 'done', statusConfig.done)}
      </div>
    </div>
  )
}
