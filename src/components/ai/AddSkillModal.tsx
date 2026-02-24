import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Puzzle, Search, Loader2 } from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import { searchSkills, type MatchResult } from '@/services/smartMatchService'
import { MatchResultCard } from './MatchResultCard'

interface AddSkillModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (skillName: string) => void
}

export function AddSkillModal({ isOpen, onClose, onConfirm }: AddSkillModalProps) {
  const [input, setInput] = useState('')
  const [searchResults, setSearchResults] = useState<MatchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const openClawSkills = useStore((s) => s.openClawSkills)

  const activeSkills = openClawSkills.filter(s => s.status === 'active')

  const handleSearch = async () => {
    const q = input.trim()
    if (!q) return
    setIsSearching(true)
    setHasSearched(true)
    try {
      const candidates = activeSkills.map(s => ({
        name: s.name,
        description: s.description,
        keywords: s.keywords,
      }))
      const results = await searchSkills(q, candidates)
      setSearchResults(results)
    } catch {
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleSelectResult = (name: string) => {
    onConfirm(name)
    resetAndClose()
  }

  const handleSelectSkill = (name: string) => {
    onConfirm(name)
    resetAndClose()
  }

  const resetAndClose = () => {
    setInput('')
    setSearchResults([])
    setHasSearched(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4"
        onClick={resetAndClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-white/10 
                     rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden max-h-[85vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Puzzle className="w-4 h-4 text-amber-400" />
              </div>
              <h2 className="text-sm font-mono font-semibold text-white/90">
                添加 SKILL
              </h2>
            </div>
            <button onClick={resetAndClose} className="p-1 text-white/30 hover:text-white/60 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content - scrollable */}
          <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
            {/* 概念说明 */}
            <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
              <p className="text-xs text-white/60 leading-relaxed">
                <span className="text-amber-400 font-semibold">SKILL</span> 是 DD-OS 
                的能力模块，每个 SKILL 定义了一套专业工作流程。添加 SKILL 后，AI 将按照对应的流程来执行任务，提升特定场景下的效果。
              </p>
            </div>

            {/* 搜索输入框 */}
            <div>
              <label className="block text-xs font-mono text-white/40 mb-2">
                描述你想要的功能
              </label>
              <div className="flex gap-2">
                <input
                  autoFocus
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="如：操作Word文档、深度调研、代码审查"
                  className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg
                           text-sm font-mono text-white/80 placeholder-white/25
                           focus:border-amber-500/40 focus:outline-none transition-colors"
                />
                <button
                  onClick={handleSearch}
                  disabled={!input.trim() || isSearching}
                  className="px-3 py-2.5 bg-amber-500/20 border border-amber-500/30 rounded-lg
                           text-amber-300 hover:bg-amber-500/30 transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                >
                  {isSearching
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Search className="w-4 h-4" />
                  }
                </button>
              </div>
            </div>

            {/* 搜索结果 */}
            {isSearching && (
              <div className="flex items-center justify-center gap-2 py-4 text-white/30">
                <Loader2 className="w-4 h-4 animate-spin text-amber-400/60" />
                <span className="text-xs font-mono">AI 正在匹配...</span>
              </div>
            )}

            {!isSearching && hasSearched && searchResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-mono text-white/30">
                  推荐结果 (点击选择)
                </p>
                {searchResults.map((result, i) => (
                  <MatchResultCard
                    key={result.name}
                    result={result}
                    accentColor="amber"
                    onClick={() => handleSelectResult(result.name)}
                    index={i}
                  />
                ))}
              </div>
            )}

            {!isSearching && hasSearched && searchResults.length === 0 && (
              <div className="text-center py-3">
                <p className="text-xs font-mono text-white/30">
                  未找到匹配技能，可从下方列表选择
                </p>
              </div>
            )}

            {/* 已加载的技能列表 */}
            {activeSkills.length > 0 && (
              <div>
                <p className="text-[11px] font-mono text-white/30 mb-2">
                  {hasSearched ? '全部已加载 SKILL' : '已加载的 SKILL (点击选择)'}
                </p>
                <div className="flex flex-wrap gap-2 max-h-[160px] overflow-y-auto">
                  {activeSkills.slice(0, 20).map((skill) => (
                    <button
                      key={skill.name}
                      onClick={() => handleSelectSkill(skill.name)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border transition-all',
                        'bg-amber-500/10 border-amber-500/15 text-amber-300 hover:bg-amber-500/20'
                      )}
                      title={skill.description || skill.name}
                    >
                      <Puzzle className="w-3 h-3" />
                      <span className="max-w-[120px] truncate">{skill.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 帮助提示 */}
            <p className="text-[10px] text-white/25 leading-relaxed">
              SKILL 通过 <code className="text-amber-300/60">skills/*/SKILL.md</code> 文件定义。
              可以在「技能屋」中浏览和管理已安装的 SKILL。
            </p>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 bg-black/20 flex-shrink-0">
            <button
              onClick={resetAndClose}
              className="px-4 py-2 text-xs font-mono text-white/50 hover:text-white/70 transition-colors"
            >
              取消
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
