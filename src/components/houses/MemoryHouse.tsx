import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ScrollText, Clock, Inbox, Loader2, Brain, ChevronDown } from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { AISummaryCard } from '@/components/ai/AISummaryCard'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import type { MemoryEntry } from '@/types'

// 默认记忆（未连接时显示）
const defaultMemories: MemoryEntry[] = [
  {
    id: '1',
    title: '欢迎来到记忆宫殿',
    content: '这里存储着 Agent 的所有对话记忆。连接到 OpenClaw Gateway 后，会话历史将显示在这里。',
    type: 'long-term',
    timestamp: new Date().toISOString(),
    tags: ['系统', '指南'],
  },
  {
    id: '2',
    title: '短期记忆',
    content: '最近 24 小时内的对话会被标记为短期记忆，显示在最前面。',
    type: 'short-term',
    timestamp: new Date().toISOString(),
    tags: ['系统'],
  },
  {
    id: '3',
    title: '长期记忆',
    content: '超过 24 小时的对话会转为长期记忆，永久保存。',
    type: 'long-term',
    timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
    tags: ['系统'],
  },
]

interface TimelineGroup {
  date: string
  displayDate: string
  memories: MemoryEntry[]
}

function getDisplayDate(dateStr: string): string {
  const today = new Date()
  const date = new Date(dateStr)
  const todayStr = today.toISOString().split('T')[0]
  const yesterdayDate = new Date(today)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterdayStr = yesterdayDate.toISOString().split('T')[0]

  if (dateStr === todayStr) return '今天'
  if (dateStr === yesterdayStr) return '昨天'
  return dateStr
}

// 时间轴记忆卡片
function TimelineMemoryCard({ 
  memory, 
  index,
  isExpanded,
  onToggle
}: { 
  memory: MemoryEntry
  index: number
  isExpanded: boolean
  onToggle: () => void
}) {
  const isShortTerm = memory.type === 'short-term'
  const time = new Date(memory.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.5) }}
      className="relative pl-8 pb-6"
    >
      {/* 连接点 */}
      <div className={cn(
        'absolute left-0 top-2 w-3 h-3 rounded-full border-2 border-slate-950',
        isShortTerm ? 'bg-amber-400' : 'bg-emerald-400'
      )} />

      {/* 时间标签 */}
      <div className="text-[10px] font-mono text-white/30 mb-1.5 flex items-center gap-2">
        <span>{time}</span>
        <span className={cn(
          'px-1.5 py-0.5 rounded',
          isShortTerm ? 'bg-amber-500/15 text-amber-400/70' : 'bg-emerald-500/15 text-emerald-400/70'
        )}>
          {isShortTerm ? '短期' : '长期'}
        </span>
        {memory.role && (
          <span className={cn(
            'px-1 rounded',
            memory.role === 'user' ? 'bg-cyan-500/15 text-cyan-400/70' : 'bg-purple-500/15 text-purple-400/70'
          )}>
            {memory.role === 'user' ? '用户' : 'AI'}
          </span>
        )}
      </div>

      {/* 记忆卡片 */}
      <GlassCard
        themeColor={isShortTerm ? 'amber' : 'emerald'}
        className="p-4 cursor-pointer hover:scale-[1.005] transition-transform"
        onClick={onToggle}
      >
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-medium text-white/90">
            {memory.title}
          </h4>
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="w-4 h-4 text-white/20 flex-shrink-0" />
          </motion.div>
        </div>

        {/* 预览/展开内容 */}
        <AnimatePresence initial={false}>
          {isExpanded ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <p className="text-sm text-white/70 mt-2 whitespace-pre-wrap leading-relaxed">
                {memory.content}
              </p>
              {memory.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {memory.tags.map(tag => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 text-[9px] font-mono bg-white/5 rounded text-white/50"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-[9px] font-mono text-white/25 mt-2">
                {new Date(memory.timestamp).toLocaleString('zh-CN')}
              </div>
            </motion.div>
          ) : (
            <p className="text-xs text-white/50 mt-1 line-clamp-2">
              {memory.content}
            </p>
          )}
        </AnimatePresence>

        {/* 折叠状态下的标签预览 */}
        {!isExpanded && memory.tags.length > 0 && (
          <div className="flex gap-1 mt-2">
            {memory.tags.slice(0, 3).map(tag => (
              <span
                key={tag}
                className="text-[9px] font-mono text-white/30"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}

// 日期分组标题
function TimelineDateHeader({ group }: { group: TimelineGroup }) {
  return (
    <div className="relative pl-8 pb-4 pt-2">
      {/* 日期大节点 */}
      <div className="absolute left-[-4px] top-2 w-5 h-5 rounded-full bg-emerald-500/30 border-2 border-emerald-400/60 flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
      </div>

      <div className="flex items-center gap-3">
        <h3 className="text-sm font-mono text-white/70 font-medium">
          {group.displayDate}
        </h3>
        <span className="text-[10px] font-mono text-white/30 bg-white/5 px-2 py-0.5 rounded">
          {group.memories.length} 条记忆
        </span>
      </div>
    </div>
  )
}

export function MemoryHouse() {
  const storeMemories = useStore((s) => s.memories)
  const loading = useStore((s) => s.sessionsLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)

  const isConnected = connectionStatus === 'connected'
  const memories = isConnected && storeMemories.length > 0 ? storeMemories : defaultMemories

  // 展开状态
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id)
  }

  // 按日期分组并排序（编年体：从早到晚）
  const timelineGroups = useMemo<TimelineGroup[]>(() => {
    if (!memories || memories.length === 0) return []

    const groups = new Map<string, MemoryEntry[]>()

    for (const mem of memories) {
      const date = new Date(mem.timestamp).toISOString().split('T')[0]
      if (!groups.has(date)) groups.set(date, [])
      groups.get(date)!.push(mem)
    }

    return Array.from(groups.entries())
      .map(([date, mems]) => ({
        date,
        displayDate: getDisplayDate(date),
        memories: mems.sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        ),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [memories])

  // 统计
  const totalMemories = memories.length
  const shortTermCount = memories.filter(m => m.type === 'short-term').length
  const longTermCount = memories.filter(m => m.type === 'long-term').length

  if (loading && isConnected) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4">
        <AISummaryCard view="memory" />
      </div>

      <div className="flex flex-1 min-h-0">
        {/* 主区域: 时间轴 */}
        <div className="flex-1 p-6 overflow-y-auto">
          {/* 标题 */}
          <div className="flex items-center gap-2 mb-6">
            <ScrollText className="w-5 h-5 text-emerald-400" />
            <h3 className="font-mono text-sm text-emerald-300 tracking-wider">
              记忆编年史
            </h3>
            <span className="ml-auto text-[10px] font-mono text-white/40">
              {totalMemories} 条记忆
            </span>
          </div>

          {memories.length > 0 ? (
            <div className="relative">
              {/* 垂直时间线 */}
              <div className="absolute left-[5px] top-4 bottom-0 w-0.5 bg-gradient-to-b from-emerald-500/40 via-white/10 to-transparent" />

              {/* 时间轴内容 */}
              {timelineGroups.map((group) => (
                <div key={group.date} className="mb-6">
                  <TimelineDateHeader group={group} />
                  {group.memories.map((memory, idx) => (
                    <TimelineMemoryCard
                      key={memory.id}
                      memory={memory}
                      index={idx}
                      isExpanded={expandedId === memory.id}
                      onToggle={() => toggleExpand(memory.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Inbox className="w-16 h-16 text-white/10 mb-4" />
              <p className="text-sm font-mono text-white/40">
                {isConnected ? '暂无记忆数据' : '未连接'}
              </p>
              <p className="text-xs font-mono text-white/25 mt-1">
                {isConnected
                  ? '对话开始后，记忆将自动出现在时间轴上'
                  : '请先连接到 OpenClaw Gateway'}
              </p>
            </div>
          )}
        </div>

        {/* 侧边栏: 统计 */}
        <div className="w-44 border-l border-white/10 p-4 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Brain className="w-4 h-4 text-emerald-400" />
            <h4 className="font-mono text-xs text-emerald-300 uppercase">统计</h4>
          </div>

          <div className="space-y-3">
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-[10px] font-mono text-white/40 uppercase">总记忆</p>
              <p className="text-2xl font-bold text-emerald-400">{totalMemories}</p>
            </div>

            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-[10px] font-mono text-white/40 uppercase flex items-center gap-1">
                <Clock className="w-3 h-3" /> 短期
              </p>
              <p className="text-2xl font-bold text-amber-400">{shortTermCount}</p>
            </div>

            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-[10px] font-mono text-white/40 uppercase flex items-center gap-1">
                <Brain className="w-3 h-3" /> 长期
              </p>
              <p className="text-2xl font-bold text-emerald-400">{longTermCount}</p>
            </div>

            {timelineGroups.length > 0 && (
              <div className="p-3 bg-white/5 rounded-lg">
                <p className="text-[10px] font-mono text-white/40 uppercase">时间跨度</p>
                <p className="text-lg font-bold text-purple-400">{timelineGroups.length} 天</p>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-white/10">
            <p className="text-[9px] font-mono text-white/30 leading-relaxed">
              记忆按时间顺序排列，点击卡片展开查看完整内容。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
