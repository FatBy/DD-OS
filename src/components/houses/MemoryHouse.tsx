import { motion } from 'framer-motion'
import { ScrollText, Clock, Tag, Inbox, Loader2, Brain, MessageCircle } from 'lucide-react'
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

function MemorySkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="p-3 bg-white/5 rounded-lg animate-pulse">
          <div className="h-4 bg-white/10 rounded w-1/3 mb-2" />
          <div className="h-3 bg-white/5 rounded w-full" />
        </div>
      ))}
    </div>
  )
}

function MemoryCard({ 
  memory, 
  isSelected, 
  onClick 
}: { 
  memory: MemoryEntry
  isSelected: boolean
  onClick: () => void 
}) {
  const isShortTerm = memory.type === 'short-term'
  
  return (
    <motion.button
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 rounded-lg border transition-all',
        isSelected
          ? 'bg-emerald-500/20 border-emerald-500/40'
          : 'bg-white/5 border-white/10 hover:bg-white/10'
      )}
      whileHover={{ x: 4 }}
    >
      <div className="flex items-start gap-2">
        <div className={cn(
          'w-2 h-2 rounded-full mt-1.5 shrink-0',
          isShortTerm ? 'bg-amber-400' : 'bg-emerald-400'
        )} />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-white/90 truncate">
            {memory.title}
          </h4>
          <p className="text-xs text-white/50 truncate mt-0.5">
            {memory.content.slice(0, 50)}...
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[9px] font-mono text-white/30">
              {new Date(memory.timestamp).toLocaleDateString('zh-CN')}
            </span>
            {memory.role && (
              <span className={cn(
                'text-[8px] font-mono px-1 rounded',
                memory.role === 'user' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-purple-500/20 text-purple-400'
              )}>
                {memory.role === 'user' ? '用户' : 'AI'}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.button>
  )
}

export function MemoryHouse() {
  const storeMemories = useStore((s) => s.memories)
  const selectedId = useStore((s) => s.selectedMemoryId)
  const setSelectedMemory = useStore((s) => s.setSelectedMemory)
  const loading = useStore((s) => s.sessionsLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)

  const isConnected = connectionStatus === 'connected'
  const memories = isConnected && storeMemories.length > 0 ? storeMemories : defaultMemories

  // 确保有选中项
  const effectiveSelectedId = selectedId || (memories.length > 0 ? memories[0].id : null)
  const selectedMemory = memories.find((m) => m.id === effectiveSelectedId)

  // 分类
  const shortTermMemories = memories.filter((m) => m.type === 'short-term')
  const longTermMemories = memories.filter((m) => m.type === 'long-term')

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
      {/* 左侧: 记忆列表 */}
      <div className="w-[40%] border-r border-white/10 p-4 overflow-y-auto">
        {/* 短期记忆 */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-amber-400" />
            <h3 className="font-mono text-xs text-amber-300 uppercase tracking-wider">
              短期记忆
            </h3>
            <span className="text-[9px] font-mono text-white/30 ml-auto">
              {shortTermMemories.length}
            </span>
          </div>
          {shortTermMemories.length === 0 ? (
            <p className="text-xs text-white/30 font-mono text-center py-4">
              暂无短期记忆
            </p>
          ) : (
            <div className="space-y-2">
              {shortTermMemories.map((memory) => (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  isSelected={effectiveSelectedId === memory.id}
                  onClick={() => setSelectedMemory(memory.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 长期记忆 */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-4 h-4 text-emerald-400" />
            <h3 className="font-mono text-xs text-emerald-300 uppercase tracking-wider">
              长期记忆
            </h3>
            <span className="text-[9px] font-mono text-white/30 ml-auto">
              {longTermMemories.length}
            </span>
          </div>
          {longTermMemories.length === 0 ? (
            <p className="text-xs text-white/30 font-mono text-center py-4">
              暂无长期记忆
            </p>
          ) : (
            <div className="space-y-2">
              {longTermMemories.map((memory) => (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  isSelected={effectiveSelectedId === memory.id}
                  onClick={() => setSelectedMemory(memory.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧: 记忆详情 */}
      <div className="flex-1 p-6 overflow-y-auto">
        {selectedMemory ? (
          <motion.div
            key={selectedMemory.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-medium text-white/90">
                  {selectedMemory.title}
                </h2>
                <div className="flex items-center gap-3 mt-2 text-xs font-mono text-white/40">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(selectedMemory.timestamp).toLocaleString('zh-CN')}
                  </span>
                  <span className={cn(
                    'px-2 py-0.5 rounded',
                    selectedMemory.type === 'short-term' 
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-emerald-500/20 text-emerald-400'
                  )}>
                    {selectedMemory.type === 'short-term' ? '短期' : '长期'}
                  </span>
                </div>
              </div>
            </div>

            <GlassCard themeColor="emerald" className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <MessageCircle className="w-4 h-4 text-emerald-400" />
                <h4 className="text-xs font-mono text-emerald-300 uppercase">内容</h4>
              </div>
              <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">
                {selectedMemory.content}
              </p>
            </GlassCard>

            {selectedMemory.tags.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Tag className="w-3 h-3 text-white/40" />
                  <span className="text-[10px] font-mono text-white/40 uppercase">标签</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedMemory.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 text-xs font-mono bg-white/5 rounded text-white/60"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-white/30">
            <Inbox className="w-16 h-16 mb-4 opacity-30" />
            <p className="text-sm font-mono">选择一条记忆查看详情</p>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
