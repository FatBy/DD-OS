import { useMemo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  BookOpen, Sparkles, ChevronDown, Loader2, Inbox, 
  Zap, GraduationCap, Coffee, Flame,
  Hash, MessageSquare, RefreshCw, Play
} from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import { isLLMConfigured } from '@/services/llmService'
import { useT } from '@/i18n'
import type { MemoryEntry, JournalEntry, JournalMood } from '@/types'

// ============================================
// Mood 配置
// ============================================

const moodConfig: Record<JournalMood, {
  icon: typeof Zap
  label: string
  color: string
  bgColor: string
  borderColor: string
  glowColor: string
  emoji: string
}> = {
  productive: {
    icon: Zap,
    label: '高效日',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    glowColor: 'amber',
    emoji: '⚡',
  },
  learning: {
    icon: GraduationCap,
    label: '探索日',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/30',
    glowColor: 'cyan',
    emoji: '🔍',
  },
  casual: {
    icon: Coffee,
    label: '休闲日',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    glowColor: 'emerald',
    emoji: '☕',
  },
  challenging: {
    icon: Flame,
    label: '挑战日',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30',
    glowColor: 'purple',
    emoji: '🔥',
  },
}

// ============================================
// 默认数据 (未连接时)
// ============================================

const defaultMemories: MemoryEntry[] = [
  {
    id: '1',
    title: '欢迎来到冒险日志',
    content: '这里记录着你的 AI 伙伴每天的冒险故事。连接后，对话将被自动转化为有趣的日志。',
    type: 'long-term',
    timestamp: new Date().toISOString(),
    tags: ['系统', '指南'],
  },
]

const defaultJournal: JournalEntry[] = [
  {
    id: 'demo-1',
    date: new Date().toLocaleDateString('sv-SE'),
    title: '冒险的起点',
    narrative: '今天是我来到这个世界的第一天！虽然还没有正式开始工作，但我已经迫不及待想要和你一起探索了。我感觉自己就像一本空白的日记，等待着被精彩的故事填满。让我们一起创造属于我们的冒险吧！',
    mood: 'casual',
    keyFacts: ['系统初始化', '等待连接', '准备就绪'],
    memoryCount: 1,
    generatedAt: Date.now(),
  },
]

// ============================================
// 工具函数
// ============================================

function getDisplayDate(dateStr: string): string {
  const today = new Date()
  const todayStr = today.toLocaleDateString('sv-SE')
  const yesterdayDate = new Date(today)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterdayStr = yesterdayDate.toLocaleDateString('sv-SE')

  if (dateStr === todayStr) return '今天'
  if (dateStr === yesterdayStr) return '昨天'
  
  try {
    const d = new Date(dateStr + 'T00:00:00')
    if (isNaN(d.getTime())) return dateStr
    return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(d)
  } catch {
    return dateStr
  }
}

// ============================================
// 日志英雄卡
// ============================================

function JournalHeroCard({ 
  entry, 
  isExpanded, 
  onToggle,
  index 
}: { 
  entry: JournalEntry
  isExpanded: boolean
  onToggle: () => void
  index: number
}) {
  const t = useT()
  const mood = moodConfig[entry.mood]
  const MoodIcon = mood.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.08, 0.4), duration: 0.4 }}
    >
      <GlassCard
        themeColor={mood.glowColor}
        className={cn(
          'p-0 overflow-hidden cursor-pointer transition-all duration-300',
          'hover:scale-[1.01] hover:shadow-lg',
          isExpanded && 'ring-1'
        )}
        onClick={onToggle}
      >
        {/* 顶部 Mood 条带 */}
        <div className={cn(
          'h-1 w-full',
          entry.mood === 'productive' && 'bg-gradient-to-r from-amber-500 to-orange-500',
          entry.mood === 'learning' && 'bg-gradient-to-r from-cyan-500 to-blue-500',
          entry.mood === 'casual' && 'bg-gradient-to-r from-emerald-500 to-teal-500',
          entry.mood === 'challenging' && 'bg-gradient-to-r from-purple-500 to-pink-500',
        )} />

        <div className="p-5">
          {/* 头部：日期 + Mood */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">{mood.emoji}</span>
              <div>
                <p className="text-[13px] font-mono text-white/40 uppercase tracking-wider">
                  {getDisplayDate(entry.date)}
                </p>
                <h3 className="text-base font-medium text-white/90 leading-tight">
                  {entry.title}
                </h3>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn(
                'px-2 py-1 rounded-full text-[13px] font-mono flex items-center gap-1',
                mood.bgColor, mood.color
              )}>
                <MoodIcon className="w-3 h-3" />
                {mood.label}
              </span>
              <motion.div
                animate={{ rotate: isExpanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown className="w-4 h-4 text-white/20" />
              </motion.div>
            </div>
          </div>

          {/* 叙事预览 / 完整展示 */}
          <AnimatePresence initial={false}>
            {isExpanded ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <p className="text-sm text-white/70 leading-relaxed mb-4 whitespace-pre-wrap">
                  {entry.narrative}
                </p>

                {/* 关键事实芯片 */}
                {entry.keyFacts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {entry.keyFacts.map((fact, i) => (
                      <span
                        key={i}
                        className={cn(
                          'px-2.5 py-1 rounded-full text-[13px] font-mono',
                          'bg-white/5 text-white/50 border border-white/10',
                          'flex items-center gap-1'
                        )}
                      >
                        <Hash className="w-2.5 h-2.5" />
                        {fact}
                      </span>
                    ))}
                  </div>
                )}

                {/* 底部信息 */}
                <div className="flex items-center justify-between pt-3 border-t border-white/5">
                  <div className="flex items-center gap-1 text-[13px] font-mono text-white/30">
                    <MessageSquare className="w-3 h-3" />
                    <span>{entry.memoryCount} {t('memory.conversations')}</span>
                  </div>
                  <span className="text-[12px] font-mono text-white/20">
                    {entry.date}
                  </span>
                </div>
              </motion.div>
            ) : (
              <p className="text-xs text-white/50 line-clamp-2 leading-relaxed">
                {entry.narrative}
              </p>
            )}
          </AnimatePresence>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============================================
// 原始记忆折叠面板
// ============================================

function RawMemoryPanel({ memories }: { memories: MemoryEntry[] }) {
  const t = useT()
  const [isOpen, setIsOpen] = useState(false)

  if (memories.length === 0) return null

  return (
    <div className="mt-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-[13px] font-mono text-white/30 hover:text-white/50 transition-colors"
      >
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="w-3 h-3" />
        </motion.div>
        {t('memory.raw_data')} ({memories.length})
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-1.5 max-h-60 overflow-y-auto">
              {memories.map(mem => (
                <div
                  key={mem.id}
                  className="px-3 py-2 bg-white/[0.03] rounded-lg border border-white/5"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn(
                      'text-[12px] px-1.5 py-0.5 rounded font-mono',
                      mem.type === 'short-term' 
                        ? 'bg-amber-500/15 text-amber-400/70' 
                        : 'bg-emerald-500/15 text-emerald-400/70'
                    )}>
                      {mem.type === 'short-term' ? t('memory.short_term') : t('memory.long_term')}
                    </span>
                    {mem.role && (
                      <span className={cn(
                        'text-[12px] px-1 rounded font-mono',
                        mem.role === 'user' ? 'text-cyan-400/60' : 'text-purple-400/60'
                      )}>
                        {mem.role === 'user' ? t('memory.user') : t('memory.ai')}
                      </span>
                    )}
                    <span className="text-[12px] font-mono text-white/25 ml-auto">
                      {(() => {
                        try {
                          const d = new Date(mem.timestamp)
                          return isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', {
                            hour: '2-digit', minute: '2-digit', hour12: false
                          }).format(d)
                        } catch { return '' }
                      })()}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/50 line-clamp-2">{mem.content}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============================================
// 统计侧边栏
// ============================================

function JournalStats({ 
  journalEntries, 
  memories,
  onGenerate,
  isGenerating,
  llmReady,
}: { 
  journalEntries: JournalEntry[]
  memories: MemoryEntry[]
  onGenerate: () => void
  isGenerating: boolean
  llmReady: boolean
}) {
  const t = useT()

  // Mood 分布统计
  const moodCounts = useMemo(() => {
    const counts: Record<JournalMood, number> = { productive: 0, learning: 0, casual: 0, challenging: 0 }
    journalEntries.forEach(e => { counts[e.mood]++ })
    return counts
  }, [journalEntries])

  const totalDays = journalEntries.length
  const totalMemories = memories.length
  const hasMemories = memories.length > 0

  return (
    <div className="w-48 border-l border-white/10 p-4 space-y-4 flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <BookOpen className="w-4 h-4 text-emerald-400" />
        <h4 className="font-mono text-xs text-emerald-300 uppercase">{t('memory.stats')}</h4>
      </div>

      {/* 核心运行按钮 */}
      <button
        onClick={onGenerate}
        disabled={isGenerating || !llmReady || !hasMemories}
        className={cn(
          'group relative w-full flex items-center justify-center gap-2.5',
          'py-3 px-4 rounded-xl font-mono text-sm font-medium',
          'transition-all duration-300 overflow-hidden',
          'border',
          isGenerating
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 cursor-wait'
            : !llmReady || !hasMemories
              ? 'bg-white/5 border-white/10 text-white/25 cursor-not-allowed'
              : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 hover:border-emerald-400/60 hover:shadow-lg hover:shadow-emerald-500/10 active:scale-[0.97]'
        )}
      >
        {/* 按钮光晕背景 */}
        {!isGenerating && llmReady && hasMemories && (
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/5 to-emerald-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        )}
        
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{t('memory.generating')}</span>
          </>
        ) : (
          <>
            <div className={cn(
              'flex items-center justify-center w-6 h-6 rounded-lg',
              llmReady && hasMemories 
                ? 'bg-emerald-500/20 group-hover:bg-emerald-500/30' 
                : 'bg-white/5'
            )}>
              <Play className="w-3.5 h-3.5 ml-0.5" />
            </div>
            <span>{t('memory.generate')}</span>
          </>
        )}
      </button>

      {!llmReady && (
        <p className="text-[12px] font-mono text-amber-400/50 leading-relaxed">
          {t('memory.llm_hint')}
        </p>
      )}

      <div className="space-y-3">
        <div className="p-3 bg-white/5 rounded-lg">
          <p className="text-[13px] font-mono text-white/40 uppercase">{t('memory.adventure_days')}</p>
          <p className="text-2xl font-bold text-emerald-400">{totalDays}</p>
        </div>

        <div className="p-3 bg-white/5 rounded-lg">
          <p className="text-[13px] font-mono text-white/40 uppercase">{t('memory.total_memories')}</p>
          <p className="text-2xl font-bold text-cyan-400">{totalMemories}</p>
        </div>

        {/* Mood 分布 */}
        {totalDays > 0 && (
          <div className="p-3 bg-white/5 rounded-lg space-y-2">
            <p className="text-[13px] font-mono text-white/40 uppercase">{t('memory.mood_distribution')}</p>
            {(Object.entries(moodCounts) as [JournalMood, number][])
              .filter(([, count]) => count > 0)
              .sort(([, a], [, b]) => b - a)
              .map(([mood, count]) => {
                const cfg = moodConfig[mood]
                return (
                  <div key={mood} className="flex items-center gap-2">
                    <span className="text-sm">{cfg.emoji}</span>
                    <div className="flex-1">
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${(count / totalDays) * 100}%` }}
                          transition={{ duration: 0.6, delay: 0.2 }}
                          className={cn(
                            'h-full rounded-full',
                            mood === 'productive' && 'bg-amber-400',
                            mood === 'learning' && 'bg-cyan-400',
                            mood === 'casual' && 'bg-emerald-400',
                            mood === 'challenging' && 'bg-purple-400',
                          )}
                        />
                      </div>
                    </div>
                    <span className="text-[13px] font-mono text-white/40 w-4 text-right">{count}</span>
                  </div>
                )
              })
            }
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-white/10 mt-auto">
        <p className="text-[12px] font-mono text-white/30 leading-relaxed">
          {t('memory.instructions')}
        </p>
      </div>
    </div>
  )
}

// ============================================
// 主组件
// ============================================

export function MemoryHouse() {
  const t = useT()
  const storeMemories = useStore((s) => s.memories)
  const journalEntries = useStore((s) => s.journalEntries)
  const journalLoading = useStore((s) => s.journalLoading)
  const loading = useStore((s) => s.sessionsLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const generateJournal = useStore((s) => s.generateJournal)

  const isConnected = connectionStatus === 'connected'
  const memories = isConnected && storeMemories.length > 0 ? storeMemories : defaultMemories
  const journals = isConnected && journalEntries.length > 0 ? journalEntries : defaultJournal
  const llmReady = isLLMConfigured()

  // 按日期降序排列，最新日志显示在最上方
  const sortedJournals = useMemo(() => 
    [...journals].sort((a, b) => b.date.localeCompare(a.date)),
    [journals]
  )

  // 展开状态
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id)
  }

  // 自动生成日志（当记忆加载完成且 LLM 可用时）
  useEffect(() => {
    if (isConnected && llmReady && storeMemories.length > 0 && journalEntries.length === 0) {
      generateJournal(storeMemories)
    }
  }, [isConnected, llmReady, storeMemories.length, journalEntries.length, generateJournal, storeMemories])

  // 手动刷新
  const handleRefresh = () => {
    if (llmReady && memories.length > 0 && !journalLoading) {
      try { localStorage.removeItem('ddos_journal_entries') } catch {}
      useStore.getState().setJournalEntries([])
      generateJournal(memories)
    }
  }

  if (loading && isConnected) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* LLM 未配置提示 */}
      {!llmReady && isConnected && storeMemories.length > 0 && (
        <div className="mx-4 mt-4 px-4 py-3 bg-white/5 border border-white/10 rounded-lg">
          <div className="flex items-center gap-2 text-xs font-mono text-white/40">
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t('memory.llm_not_configured')}</span>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* 主区域: 冒险日志 */}
        <div className="flex-1 p-6 overflow-y-auto">
          {/* 标题栏 */}
          <div className="flex items-center gap-2 mb-6">
            <BookOpen className="w-5 h-5 text-emerald-400" />
            <h3 className="font-mono text-sm text-emerald-300 tracking-wider">
              {t('memory.title')}
            </h3>
            <span className="ml-auto flex items-center gap-2">
              {journalLoading && (
                <span className="flex items-center gap-1 text-[13px] font-mono text-amber-400/60">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t('memory.generating')}
                </span>
              )}
              {llmReady && (
                <button
                  onClick={handleRefresh}
                  disabled={journalLoading}
                  className="p-1 text-white/30 hover:text-emerald-400 transition-colors disabled:opacity-30"
                  title={t('memory.regenerate')}
                >
                  <RefreshCw className={cn('w-3.5 h-3.5', journalLoading && 'animate-spin')} />
                </button>
              )}
              <span className="text-[13px] font-mono text-white/40">
                {sortedJournals.length} {t('memory.entries_count')}
              </span>
            </span>
          </div>

          {sortedJournals.length > 0 ? (
            <div className="space-y-4">
              {sortedJournals.map((entry, idx) => (
                <JournalHeroCard
                  key={entry.id}
                  entry={entry}
                  isExpanded={expandedId === entry.id}
                  onToggle={() => toggleExpand(entry.id)}
                  index={idx}
                />
              ))}

              {/* 底部：原始记忆折叠面板 */}
              <RawMemoryPanel memories={memories} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Inbox className="w-16 h-16 text-white/10 mb-4" />
              <p className="text-sm font-mono text-white/40">
                {isConnected ? t('memory.no_entries') : t('memory.not_connected')}
              </p>
              <p className="text-xs font-mono text-white/25 mt-1">
                {isConnected
                  ? t('memory.no_entries_desc')
                  : t('memory.connect_prompt')}
              </p>
            </div>
          )}
        </div>

        {/* 侧边栏: 统计 */}
        <JournalStats 
          journalEntries={sortedJournals} 
          memories={memories} 
          onGenerate={handleRefresh}
          isGenerating={journalLoading}
          llmReady={llmReady}
        />
      </div>
    </div>
  )
}
