import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, Loader2, Zap, ChevronRight, Check, AlertCircle, Sparkles, GitBranch } from 'lucide-react'
import { useStore } from '@/store'
import { AISummaryCard } from '@/components/ai/AISummaryCard'
import { isLLMConfigured } from '@/services/llmService'
import { cn } from '@/utils/cn'
import type { SkillNode, SkillEnhancement } from '@/types'

// 单个技能卡片
function SkillCard({ skill, index, enhancement, allSkills, highlightDep, onHighlight }: { 
  skill: SkillNode
  index: number
  enhancement?: SkillEnhancement
  allSkills?: SkillNode[]
  highlightDep?: string | null
  onHighlight?: (id: string | null) => void
}) {
  const isActive = skill.unlocked || skill.status === 'active'
  const isHighlighted = highlightDep === skill.id
  const hasDeps = skill.dependencies && skill.dependencies.length > 0
  
  // 找到依赖的技能名称
  const depNames = useMemo(() => {
    if (!hasDeps || !allSkills) return []
    return skill.dependencies
      .map(depId => allSkills.find(s => s.id === depId)?.name || depId)
      .slice(0, 3)
  }, [skill.dependencies, allSkills, hasDeps])
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.5) }}
      className={cn(
        'p-3 rounded-lg border transition-all cursor-pointer hover:scale-[1.01] relative',
        isHighlighted
          ? 'bg-amber-500/15 border-amber-400/50 ring-1 ring-amber-400/30'
          : isActive 
          ? 'bg-cyan-500/10 border-cyan-500/30 hover:border-cyan-400/50'
          : 'bg-white/5 border-white/10 hover:border-white/20'
      )}
      onClick={() => onHighlight?.(hasDeps ? skill.id : null)}
    >
      <div className="flex items-center gap-2">
        {/* 状态指示 */}
        <div className={cn(
          'w-2.5 h-2.5 rounded-full flex-shrink-0',
          isActive ? 'bg-cyan-400' : 'bg-white/20'
        )} />
        
        {/* 技能名称 */}
        <span className={cn(
          'text-sm font-mono truncate flex-1',
          isActive ? 'text-cyan-300' : 'text-white/40'
        )}>
          {skill.name}
        </span>
        
        {/* 分数 */}
        {enhancement ? (
          <span className={cn(
            'text-xs font-mono flex-shrink-0 px-2 py-0.5 rounded',
            enhancement.importanceScore >= 80 ? 'bg-amber-500/20 text-amber-400' :
            enhancement.importanceScore >= 60 ? 'bg-cyan-500/20 text-cyan-400' :
            'bg-white/5 text-white/30'
          )}>
            {enhancement.importanceScore}
          </span>
        ) : isActive ? (
          <Check className="w-4 h-4 text-cyan-400/60 flex-shrink-0" />
        ) : (
          <span className="text-xs text-white/20">-</span>
        )}
      </div>
      
      {/* AI 理由 */}
      {enhancement?.reasoning && (
        <p className="text-xs text-white/40 mt-1.5 truncate pl-5">{enhancement.reasoning}</p>
      )}
      
      {/* 依赖关系 */}
      {hasDeps && depNames.length > 0 && (
        <div className="flex items-center gap-1.5 mt-2 pl-5">
          <GitBranch className="w-3 h-3 text-white/25 flex-shrink-0" />
          <span className="text-xs font-mono text-white/30 truncate">
            {depNames.join(', ')}
          </span>
        </div>
      )}
      
      {/* 版本 */}
      {!enhancement && skill.version && (
        <p className="text-xs text-white/30 mt-1.5 truncate pl-5">v{skill.version}</p>
      )}
    </motion.div>
  )
}

// AI 子分类组
function SubCategoryGroup({
  subCategory,
  skills,
  enhancements,
  allSkills,
  expanded,
  onToggle,
  highlightDep,
  onHighlight,
}: {
  subCategory: string
  skills: SkillNode[]
  enhancements: Record<string, SkillEnhancement>
  allSkills: SkillNode[]
  expanded: boolean
  onToggle: () => void
  highlightDep: string | null
  onHighlight: (id: string | null) => void
}) {
  const activeCount = skills.filter(s => s.unlocked || s.status === 'active').length
  // 按重要度排序（子分类内）
  const sortedSkills = useMemo(() => {
    return [...skills].sort((a, b) => {
      const sa = enhancements[a.id]?.importanceScore ?? 0
      const sb = enhancements[b.id]?.importanceScore ?? 0
      return sb - sa
    })
  }, [skills, enhancements])

  return (
    <div className="mb-2">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-white/5 transition-colors"
      >
        <div className="w-2.5 h-2.5 rounded-full bg-amber-400/40 flex-shrink-0" />
        <ChevronRight className={cn(
          'w-4 h-4 text-white/30 transition-transform',
          expanded && 'rotate-90'
        )} />
        <span className="text-sm font-mono text-white/60 flex-1 text-left truncate">
          {subCategory}
        </span>
        <span className="text-xs font-mono text-cyan-400/60">
          {activeCount}/{skills.length}
        </span>
      </button>
      
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-2 pl-8 pr-2 mt-2">
              {sortedSkills.map((skill, idx) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  index={idx}
                  enhancement={enhancements[skill.id]}
                  allSkills={allSkills}
                  highlightDep={highlightDep}
                  onHighlight={onHighlight}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// 顶层分类组
function CategoryGroup({
  category,
  subGroups,
  enhancements,
  allSkills,
  expandedSubs,
  onToggleSub,
  expanded,
  onToggle,
  highlightDep,
  onHighlight,
}: {
  category: string
  subGroups: Map<string, SkillNode[]>
  enhancements: Record<string, SkillEnhancement>
  allSkills: SkillNode[]
  expandedSubs: Set<string>
  onToggleSub: (key: string) => void
  expanded: boolean
  onToggle: () => void
  highlightDep: string | null
  onHighlight: (id: string | null) => void
}) {
  const totalSkills = Array.from(subGroups.values()).reduce((sum, s) => sum + s.length, 0)
  const activeSkills = Array.from(subGroups.values())
    .flat()
    .filter(s => s.unlocked || s.status === 'active').length

  return (
    <div className="mb-4 border border-white/10 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 bg-white/5 hover:bg-white/8 transition-colors"
      >
        <ChevronRight className={cn(
          'w-4 h-4 text-cyan-400/60 transition-transform',
          expanded && 'rotate-90'
        )} />
        <span className="text-sm font-mono text-cyan-400 uppercase flex-1 text-left font-medium">
          {category}
        </span>
        <span className="text-sm font-mono text-cyan-400/60">
          {activeSkills}/{totalSkills}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-3">
              {Array.from(subGroups.entries()).map(([sub, subSkills]) => (
                <SubCategoryGroup
                  key={sub}
                  subCategory={sub}
                  skills={subSkills}
                  enhancements={enhancements}
                  allSkills={allSkills}
                  expanded={expandedSubs.has(`${category}::${sub}`)}
                  onToggle={() => onToggleSub(`${category}::${sub}`)}
                  highlightDep={highlightDep}
                  onHighlight={onHighlight}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// 原始分组（无 AI 时）
function SkillGroup({ 
  groupName, 
  skills,
  expanded,
  onToggle
}: { 
  groupName: string
  skills: SkillNode[]
  expanded: boolean
  onToggle: () => void
}) {
  const activeCount = skills.filter(s => s.unlocked || s.status === 'active').length
  
  return (
    <div className="mb-3">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
      >
        <ChevronRight className={cn(
          'w-4 h-4 text-white/40 transition-transform',
          expanded && 'rotate-90'
        )} />
        <span className="text-sm font-mono text-white/70 flex-1 text-left truncate">
          {groupName}
        </span>
        <span className="text-sm font-mono text-cyan-400/70">
          {activeCount}/{skills.length}
        </span>
      </button>
      
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-2 grid grid-cols-2 gap-2 pl-4"
          >
            {skills.map((skill, idx) => (
              <SkillCard key={skill.id} skill={skill} index={idx} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function SkillHouse() {
  const storeSkills = useStore((s) => s.skills)
  const loading = useStore((s) => s.channelsLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)
  
  // AI 增强
  const skillEnhancements = useStore((s) => s.skillEnhancements)
  const skillEnhancementsLoading = useStore((s) => s.skillEnhancementsLoading)
  const enhanceSkills = useStore((s) => s.enhanceSkills)
  const clearSkillEnhancements = useStore((s) => s.clearSkillEnhancements)

  const isConnected = connectionStatus === 'connected'
  const skills = storeSkills
  const configured = isLLMConfigured()
  const hasEnhancements = Object.keys(skillEnhancements).length > 0

  // 依赖高亮
  const [highlightDep, setHighlightDep] = useState<string | null>(null)

  // 首次进入自动触发 AI 分析
  useEffect(() => {
    if (configured && skills.length > 0) {
      enhanceSkills(skills)
    }
  }, [configured, skills.length])

  // AI 层级分组: category → subCategory → skills
  const hierarchicalGroups = useMemo(() => {
    if (!hasEnhancements) return null
    
    const topLevel = new Map<string, Map<string, SkillNode[]>>()
    
    for (const skill of skills) {
      const enhancement = skillEnhancements[skill.id]
      const category = skill.category || 'Skills'
      const subCategory = enhancement?.subCategory || '其他'
      
      if (!topLevel.has(category)) {
        topLevel.set(category, new Map())
      }
      const subMap = topLevel.get(category)!
      if (!subMap.has(subCategory)) {
        subMap.set(subCategory, [])
      }
      subMap.get(subCategory)!.push(skill)
    }
    
    return topLevel
  }, [skills, skillEnhancements, hasEnhancements])

  // 原始分组（无 AI 时使用）
  const groupedSkills = useMemo(() => {
    if (!skills || skills.length === 0) return new Map<string, SkillNode[]>()
    const groups = new Map<string, SkillNode[]>()
    for (const skill of skills) {
      const groupKey = skill.category || 'Skills'
      if (!groups.has(groupKey)) groups.set(groupKey, [])
      groups.get(groupKey)!.push(skill)
    }
    return groups
  }, [skills])

  // 展开状态
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  
  // 初始化展开所有
  useEffect(() => {
    if (hierarchicalGroups && expandedCategories.size === 0) {
      setExpandedCategories(new Set(hierarchicalGroups.keys()))
      const allSubs = new Set<string>()
      hierarchicalGroups.forEach((subMap, cat) => {
        subMap.forEach((_, sub) => allSubs.add(`${cat}::${sub}`))
      })
      setExpandedSubs(allSubs)
    }
  }, [hierarchicalGroups])

  useEffect(() => {
    if (groupedSkills.size > 0 && expandedGroups.size === 0 && !hasEnhancements) {
      setExpandedGroups(new Set(groupedSkills.keys()))
    }
  }, [groupedSkills, hasEnhancements])

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev)
      if (newSet.has(cat)) newSet.delete(cat)
      else newSet.add(cat)
      return newSet
    })
  }

  const toggleSub = (key: string) => {
    setExpandedSubs(prev => {
      const newSet = new Set(prev)
      if (newSet.has(key)) newSet.delete(key)
      else newSet.add(key)
      return newSet
    })
  }

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(group)) newSet.delete(group)
      else newSet.add(group)
      return newSet
    })
  }

  const totalSkills = skills.length
  const activeCount = skills.filter(s => s.unlocked || s.status === 'active').length

  // AI 子分类统计
  const subCategoryCounts = useMemo(() => {
    if (!hasEnhancements) return new Map<string, number>()
    const counts = new Map<string, number>()
    Object.values(skillEnhancements).forEach(e => {
      const cat = e.subCategory || '其他'
      counts.set(cat, (counts.get(cat) || 0) + 1)
    })
    return counts
  }, [skillEnhancements, hasEnhancements])

  const handleAIRefresh = () => {
    clearSkillEnhancements()
    enhanceSkills(skills)
  }

  if (loading && isConnected) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4">
        <AISummaryCard view="skill" />
      </div>
      <div className="flex flex-1 min-h-0">
      {/* 主区域: 技能树 */}
      <div className="flex-1 p-4 overflow-y-auto">
        {/* 标题 */}
        <div className="flex items-center gap-3 mb-5">
          <Brain className="w-6 h-6 text-cyan-400" />
          <h3 className="font-mono text-base text-cyan-300 tracking-wider font-medium">
            技能树
          </h3>
          
          {/* AI 分析按钮 */}
          {configured && skills.length > 0 && (
            <button
              onClick={handleAIRefresh}
              disabled={skillEnhancementsLoading}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors',
                hasEnhancements
                  ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400'
                  : 'bg-white/5 border border-white/10 text-white/40 hover:text-amber-400 hover:border-amber-500/30'
              )}
            >
              {skillEnhancementsLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {hasEnhancements ? 'AI 已分析' : 'AI 分析'}
            </button>
          )}
          
          {totalSkills > 0 && (
            <span className="ml-auto text-xs font-mono text-white/50">
              {totalSkills} skills
            </span>
          )}
        </div>

        {/* 技能树 */}
        {skills.length > 0 ? (
          <div className="space-y-2">
            {/* AI 层级树模式 */}
            {hierarchicalGroups ? (
              Array.from(hierarchicalGroups.entries()).map(([category, subGroups]) => (
                <CategoryGroup
                  key={category}
                  category={category}
                  subGroups={subGroups}
                  enhancements={skillEnhancements}
                  allSkills={skills}
                  expandedSubs={expandedSubs}
                  onToggleSub={toggleSub}
                  expanded={expandedCategories.has(category)}
                  onToggle={() => toggleCategory(category)}
                  highlightDep={highlightDep}
                  onHighlight={setHighlightDep}
                />
              ))
            ) : skillEnhancementsLoading ? (
              /* AI 加载中骨架屏 */
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="border border-white/10 rounded-lg p-4">
                    <div className="h-5 bg-white/10 rounded w-28 mb-4 animate-pulse" />
                    <div className="grid grid-cols-2 gap-2">
                      {skills.slice(0, 4).map((skill) => (
                        <div key={`skel-${i}-${skill.id}`} className="p-3 rounded-lg border border-white/10 bg-white/5">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full bg-white/10 animate-pulse" />
                            <span className="text-sm font-mono text-white/40 truncate flex-1">{skill.name}</span>
                            <div className="w-8 h-5 rounded bg-white/10 animate-pulse" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* 原始分组模式 */
              groupedSkills.size > 1 ? (
                Array.from(groupedSkills.entries()).map(([groupName, groupSkills]) => (
                  <SkillGroup
                    key={groupName}
                    groupName={groupName}
                    skills={groupSkills}
                    expanded={expandedGroups.has(groupName)}
                    onToggle={() => toggleGroup(groupName)}
                  />
                ))
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {skills.map((skill, idx) => (
                    <SkillCard key={skill.id} skill={skill} index={idx} />
                  ))}
                </div>
              )
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <AlertCircle className="w-10 h-10 text-white/20 mb-4" />
            <p className="text-white/50 text-sm font-mono">
              {isConnected ? '暂无技能数据' : '未连接'}
            </p>
            <p className="text-white/30 text-xs font-mono mt-2">
              {isConnected 
                ? '技能加载后将显示在这里' 
                : '请先在左下角连接面板中连接'}
            </p>
          </div>
        )}
      </div>

      {/* 侧边栏: 统计 */}
      <div className="w-48 border-l border-white/10 p-4 space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-5 h-5 text-cyan-400" />
          <h4 className="font-mono text-sm text-cyan-300 uppercase font-medium">统计</h4>
        </div>

        <div className="space-y-4">
          <div className="p-3 bg-white/5 rounded-lg">
            <p className="text-xs font-mono text-white/50 uppercase mb-1">总技能</p>
            <p className="text-3xl font-bold text-cyan-400">{totalSkills}</p>
          </div>

          <div className="p-3 bg-white/5 rounded-lg">
            <p className="text-xs font-mono text-white/50 uppercase mb-1">已激活</p>
            <p className="text-3xl font-bold text-emerald-400">
              {activeCount}
            </p>
          </div>

          {!hasEnhancements && groupedSkills.size > 1 && (
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs font-mono text-white/50 uppercase mb-1">分类数</p>
              <p className="text-3xl font-bold text-purple-400">{groupedSkills.size}</p>
            </div>
          )}

          {/* AI 分类统计 */}
          {hasEnhancements && subCategoryCounts.size > 0 && (
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs font-mono text-white/50 uppercase mb-3">AI 分类</p>
              <div className="space-y-2">
                {Array.from(subCategoryCounts.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, count]) => (
                    <div key={cat} className="flex items-center justify-between">
                      <span className="text-xs font-mono text-white/60 truncate">{cat}</span>
                      <span className="text-xs font-mono text-amber-400">{count}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-white/10">
          <p className="text-xs font-mono text-white/40 leading-relaxed">
            {hasEnhancements 
              ? 'AI 已按功能分类技能并评估重要度。点击有依赖的技能可高亮关联项。'
              : '显示所有已安装的 Agent 技能，来自 SKILL.md 文件系统。'
            }
          </p>
        </div>
      </div>
      </div>
    </div>
  )
}
