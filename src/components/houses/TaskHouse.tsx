import { motion } from 'framer-motion'
import { 
  Inbox, Clock, CheckCircle2, Play, AlertCircle, 
  Loader2, MessageSquare, ChevronRight 
} from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import type { TaskItem } from '@/types'

// 默认任务（未连接时显示）
const defaultTasks: TaskItem[] = [
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

function TaskSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="p-4 bg-white/5 rounded-xl animate-pulse">
          <div className="h-4 bg-white/10 rounded w-2/3 mb-2" />
          <div className="h-3 bg-white/5 rounded w-full" />
        </div>
      ))}
    </div>
  )
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

function TaskCard({ task, index }: { task: TaskItem; index: number }) {
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
        className="p-4 cursor-pointer hover:scale-[1.02] transition-transform"
      >
        <div className="flex items-start gap-3">
          <div className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center',
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
                'text-[9px] font-mono px-1.5 py-0.5 rounded',
                `bg-${priority.color}-500/20 text-${priority.color}-400`
              )}>
                {priority.label}
              </span>
            </div>
            <p className="text-xs text-white/50 mt-1 line-clamp-2">
              {task.description}
            </p>
            <div className="flex items-center gap-3 mt-2 text-[9px] font-mono text-white/30">
              {task.messageCount !== undefined && (
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" />
                  {task.messageCount}
                </span>
              )}
              <span>{new Date(task.timestamp).toLocaleDateString('zh-CN')}</span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/20" />
        </div>
      </GlassCard>
    </motion.div>
  )
}

export function TaskHouse() {
  const storeTasks = useStore((s) => s.tasks)
  const loading = useStore((s) => s.sessionsLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)
  
  const isConnected = connectionStatus === 'connected'
  const tasks = isConnected && storeTasks.length > 0 ? storeTasks : defaultTasks
  
  // 按状态分组
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

  return (
    <div className="flex h-full gap-4 p-6">
      {/* 待处理列 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-amber-400" />
          <h3 className="font-mono text-sm text-amber-300 tracking-wider">待处理</h3>
          <span className="text-[10px] font-mono text-white/40 bg-white/5 px-2 py-0.5 rounded ml-auto">
            {pendingTasks.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
          {pendingTasks.length === 0 ? (
            <EmptyColumn status="pending" />
          ) : (
            pendingTasks.map((task, i) => (
              <TaskCard key={task.id} task={task} index={i} />
            ))
          )}
        </div>
      </div>

      {/* 进行中列 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <Play className="w-4 h-4 text-cyan-400" />
          <h3 className="font-mono text-sm text-cyan-300 tracking-wider">进行中</h3>
          <span className="text-[10px] font-mono text-white/40 bg-white/5 px-2 py-0.5 rounded ml-auto">
            {executingTasks.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
          {executingTasks.length === 0 ? (
            <EmptyColumn status="executing" />
          ) : (
            executingTasks.map((task, i) => (
              <TaskCard key={task.id} task={task} index={i} />
            ))
          )}
        </div>
      </div>

      {/* 已完成列 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <h3 className="font-mono text-sm text-emerald-300 tracking-wider">已完成</h3>
          <span className="text-[10px] font-mono text-white/40 bg-white/5 px-2 py-0.5 rounded ml-auto">
            {doneTasks.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
          {doneTasks.length === 0 ? (
            <EmptyColumn status="done" />
          ) : (
            doneTasks.map((task, i) => (
              <TaskCard key={task.id} task={task} index={i} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
