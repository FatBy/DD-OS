import { useMemo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, Loader2, Zap, ChevronRight, Check, AlertCircle, GitBranch } from 'lucide-react'
import { useStore } from '@/store'
import { AISummaryCard } from '@/components/ai/AISummaryCard'
import { cn } from '@/utils/cn'
import type { SkillNode } from '@/types'

// 单个技能卡片
function SkillCard({ skill, index, allSkills, highlightDep, onHighlight }: { 
  skill: SkillNode
  index: number
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
        
        {/* 状态指示 */}
        {isActive ? (
          <Check className="w-4 h-4 text-cyan-400/60 flex-shrink-0" />
        ) : (
          <span className="text-xs text-white/20">-</span>
        )}
      </div>
      
      {/* 描述 */}
      {skill.description && (
        <p className="text-xs text-white/40 mt-1.5 truncate pl-5">{skill.description}</p>
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
      {skill.version && (
        <p className="text-xs text-white/30 mt-1.5 truncate pl-5">v{skill.version}</p>
      )}
    </motion.div>
  )
}

// 技能分组
function SkillGroup({ 
  groupName, 
  skills,
  allSkills,
  expanded,
  onToggle,
  highlightDep,
  onHighlight,
}: { 
  groupName: string
  skills: SkillNode[]
  allSkills: SkillNode[]
  expanded: boolean
  onToggle: () => void
  highlightDep: string | null
  onHighlight: (id: string | null) => void
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
              <SkillCard 
                key={skill.id} 
                skill={skill} 
                index={idx}
                allSkills={allSkills}
                highlightDep={highlightDep}
                onHighlight={onHighlight}
              />
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

  const isConnected = connectionStatus === 'connected'
  const skills = storeSkills

  // 依赖高亮
  const [highlightDep, setHighlightDep] = useState<string | null>(null)

  // 按 category 分组
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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  
  // 初始化展开所有分组
  useEffect(() => {
    if (groupedSkills.size > 0 && expandedGroups.size === 0) {
      setExpandedGroups(new Set(groupedSkills.keys()))
    }
  }, [groupedSkills])

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
          
          {totalSkills > 0 && (
            <span className="ml-auto text-xs font-mono text-white/50">
              {totalSkills} skills
            </span>
          )}
        </div>

        {/* 技能树 */}
        {skills.length > 0 ? (
          <div className="space-y-2">
            {groupedSkills.size > 1 ? (
              Array.from(groupedSkills.entries()).map(([groupName, groupSkills]) => (
                <SkillGroup
                  key={groupName}
                  groupName={groupName}
                  skills={groupSkills}
                  allSkills={skills}
                  expanded={expandedGroups.has(groupName)}
                  onToggle={() => toggleGroup(groupName)}
                  highlightDep={highlightDep}
                  onHighlight={setHighlightDep}
                />
              ))
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {skills.map((skill, idx) => (
                  <SkillCard 
                    key={skill.id} 
                    skill={skill} 
                    index={idx}
                    allSkills={skills}
                    highlightDep={highlightDep}
                    onHighlight={setHighlightDep}
                  />
                ))}
              </div>
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

          {groupedSkills.size > 1 && (
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs font-mono text-white/50 uppercase mb-1">分类数</p>
              <p className="text-3xl font-bold text-purple-400">{groupedSkills.size}</p>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-white/10">
          <p className="text-xs font-mono text-white/40 leading-relaxed">
            显示所有已安装的 Agent 技能，来自 SKILL.md 文件系统。点击有依赖的技能可高亮关联项。
          </p>
        </div>
      </div>
      </div>
    </div>
  )
}
