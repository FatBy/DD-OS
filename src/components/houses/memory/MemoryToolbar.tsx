import { useState, useCallback, useRef } from 'react'
import { Search, RefreshCw, Brain, Route, Share2, Download, BookOpen } from 'lucide-react'
import { cn } from '@/utils/cn'
import { memoryStore } from '@/services/memoryStore'

export type MemoryTab = 'wall' | 'traces' | 'graph' | 'diary'

interface MemoryToolbarProps {
  activeTab: MemoryTab
  onTabChange: (tab: MemoryTab) => void
  l0Count: number
  traceCount: number
  onSearch: (query: string) => Promise<void>
  onRefresh: () => Promise<void>
  loading: boolean
}

const tabs: { key: MemoryTab; label: string; icon: typeof Brain }[] = [
  { key: 'wall', label: '核心记忆', icon: Brain },
  { key: 'traces', label: '执行分析', icon: Route },
  { key: 'graph', label: '概念图谱', icon: Share2 },
  { key: 'diary', label: '日记', icon: BookOpen },
]

export function MemoryToolbar({
  activeTab,
  onTabChange,
  l0Count,
  traceCount,
  onSearch,
  onRefresh,
  loading,
}: MemoryToolbarProps) {
  const [searchValue, setSearchValue] = useState('')
  const [exporting, setExporting] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // V10 / P3: 导出当前 active 记忆为 Markdown 文件
  const handleExport = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
      const md = await memoryStore.exportToMarkdown({ onlyActive: true })
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      anchor.download = `duncrew-memory-${stamp}.md`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.warn('[MemoryToolbar] Export failed:', err)
    } finally {
      setExporting(false)
    }
  }, [exporting])

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setSearchValue(val)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onSearch(val)
      }, 300)
    },
    [onSearch],
  )

  return (
    <div className="h-14 flex items-center gap-4 px-5 bg-white/60 backdrop-blur-xl border-b border-white/40 shrink-0">
      {/* 搜索框 */}
      <div className="relative w-52">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
        <input
          type="text"
          value={searchValue}
          onChange={handleSearchChange}
          placeholder="搜索记忆..."
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-xl bg-white/50 border border-stone-200/50 text-stone-700 placeholder:text-stone-300 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 transition-colors"
        />
      </div>

      {/* Tab 切换 */}
      <div className="flex items-center gap-1 rounded-xl p-0.5">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onTabChange(key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all',
              activeTab === key
                ? 'bg-emerald-500/10 text-emerald-700'
                : 'text-stone-500 hover:text-stone-700 hover:bg-white/50',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {/* 导出 Markdown */}
      <button
        onClick={handleExport}
        disabled={exporting}
        className="p-1.5 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-white/60 transition-colors disabled:opacity-30"
        title="导出为 Markdown"
      >
        <Download className={cn('w-4 h-4', exporting && 'animate-pulse')} />
      </button>

      {/* 刷新 + 统计 */}
      <button
        onClick={onRefresh}
        disabled={loading}
        className="p-1.5 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-white/60 transition-colors disabled:opacity-30"
        title="刷新数据"
      >
        <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
      </button>

      <span className="text-sm font-medium text-stone-400">
        {l0Count} 核心 · {traceCount} 轨迹
      </span>
    </div>
  )
}
