import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Brain, Loader2, Zap, ChevronRight, Check, AlertCircle, Sparkles } from 'lucide-react'
import { useStore } from '@/store'
import { AISummaryCard } from '@/components/ai/AISummaryCard'
import { isLLMConfigured } from '@/services/llmService'
import { cn } from '@/utils/cn'
import type { SkillNode, SkillEnhancement } from '@/types'

// 排名徽章颜色
const RANK_STYLES: Record<number, string> = {
  1: 'bg-amber-400 text-slate-900',    // 金
  2: 'bg-slate-300 text-slate-900',     // 银
  3: 'bg-amber-700 text-white',         // 铜
}

// 单个技能卡片
function SkillCard({ skill, index, enhancement, rank }: { 
  skill: SkillNode
  index: number
  enhancement?: SkillEnhancement
  rank?: number
}) {
  const isActive = skill.unlocked || skill.status === 'active'
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.5) }}
      className={cn(
        'p-2 rounded-lg border transition-all cursor-pointer hover:scale-[1.01] relative',
        isActive 
          ? 'bg-cyan-500/10 border-cyan-500/30 hover:border-cyan-400/50'
          : 'bg-white/5 border-white/10 hover:border-white/20'
      )}
    >
      <div className="flex items-center gap-2">
        {/* 排名徽章 */}
        {rank && rank <= 3 ? (
          <div className={cn(
            'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold',
            RANK_STYLES[rank]
          )}>
            {rank}
          </div>
        ) : rank ? (
          <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 bg-white/10 text-[9px] font-mono text-white/40">
            {rank}
          </div>
        ) : (
          <div className={cn(
            'w-2 h-2 rounded-full flex-shrink-0',
            isActive ? 'bg-cyan-400' : 'bg-white/20'
          )} />
        )}
        
        {/* 技能名称 */}
        <span className={cn(
          'text-xs font-mono truncate flex-1',
          isActive ? 'text-cyan-300' : 'text-white/40'
        )}>
          {skill.name}
        </span>
        
        {/* 分数或状态 */}
        {enhancement ? (
          <span className={cn(
            'text-[9px] font-mono flex-shrink-0 px-1.5 py-0.5 rounded',
            enhancement.importanceScore >= 80 ? 'bg-amber-500/20 text-amber-400' :
            enhancement.importanceScore >= 60 ? 'bg-cyan-500/20 text-cyan-400' :
            'bg-white/5 text-white/30'
          )}>
            {enhancement.importanceScore}
          </span>
        ) : isActive ? (
          <Check className="w-3 h-3 text-cyan-400/60 flex-shrink-0" />
        ) : (
          <span className="text-[9px] text-white/20">-</span>
        )}
      </div>
      
      {/* AI 理由 (如果有) */}
      {enhancement?.reasoning && (
        <p className="text-[9px] text-white/30 mt-1 truncate pl-7">{enhancement.reasoning}</p>
      )}
      
      {/* 版本 */}
      {!enhancement && skill.version && (
        <p className="text-[9px] text-white/30 mt-1 truncate pl-4">v{skill.version}</p>
      )}
    </motion.div>
  )
}

// 技能分组组件
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
    <div className="mb-2">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
      >
        <ChevronRight className={cn(
          'w-3 h-3 text-white/30 transition-transform',
          expanded && 'rotate-90'
        )} />
        <span className="text-xs font-mono text-white/70 flex-1 text-left truncate">
          {groupName}
        </span>
        <span className="text-[10px] font-mono text-cyan-400/60">
          {activeCount}/{skills.length}
        </span>
      </button>
      
      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="mt-1 grid grid-cols-2 gap-1 pl-3"
        >
          {skills.map((skill, idx) => (
            <SkillCard key={skill.id} skill={skill} index={idx} />
          ))}
        </motion.div>
      )}
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

  // 首次进入自动触发 AI 分析
  useEffect(() => {
    if (configured && skills.length > 0) {
      enhanceSkills(skills)
    }
  }, [configured, skills.length])

  // AI 排序后的技能列表
  const rankedSkills = useMemo(() => {
    if (!hasEnhancements) return null
    
    return [...skills]
      .sort((a, b) => {
        const scoreA = skillEnhancements[a.id]?.importanceScore ?? 0
        const scoreB = skillEnhancements[b.id]?.importanceScore ?? 0
        return scoreB - scoreA
      })
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

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  
  useMemo(() => {
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
      {/* 主区域: 技能列表 */}
      <div className="flex-1 p-4 overflow-y-auto">
        {/* 标题 */}
        <div className="flex items-center gap-2 mb-4">
          <Brain className="w-5 h-5 text-cyan-400" />
          <h3 className="font-mono text-sm text-cyan-300 tracking-wider">
            技能库
          </h3>
          
          {/* AI 排序按钮 */}
          {configured && skills.length > 0 && (
            <button
              onClick={handleAIRefresh}
              disabled={skillEnhancementsLoading}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors',
                hasEnhancements
                  ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400'
                  : 'bg-white/5 border border-white/10 text-white/40 hover:text-amber-400 hover:border-amber-500/30'
              )}
            >
              {skillEnhancementsLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              {hasEnhancements ? 'AI 已排序' : 'AI 排序'}
            </button>
          )}
          
          {totalSkills > 0 && (
            <span className="ml-auto text-[10px] font-mono text-white/40">
              {totalSkills} skills
            </span>
          )}
        </div>

        {/* 技能列表 */}
        {skills.length > 0 ? (
          <div className="space-y-1">
            {/* AI 排序模式: 平铺排名列表 */}
            {rankedSkills ? (
              <div className="grid grid-cols-2 gap-1">
                {rankedSkills.map((skill, idx) => (
                  <SkillCard 
                    key={skill.id} 
                    skill={skill} 
                    index={idx} 
                    enhancement={skillEnhancements[skill.id]}
                    rank={idx + 1}
                  />
                ))}
              </div>
            ) : skillEnhancementsLoading ? (
              /* AI 加载中骨架屏 */
              <div className="grid grid-cols-2 gap-1">
                {skills.map((skill, idx) => (
                  <div key={skill.id} className="p-2 rounded-lg border border-white/10 bg-white/5">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-white/10 animate-pulse" />
                      <span className="text-xs font-mono text-white/40 truncate flex-1">{skill.name}</span>
                      <div className="w-6 h-4 rounded bg-white/10 animate-pulse" />
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
                <div className="grid grid-cols-2 gap-1">
                  {skills.map((skill, idx) => (
                    <SkillCard key={skill.id} skill={skill} index={idx} />
                  ))}
                </div>
              )
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <AlertCircle className="w-8 h-8 text-white/20 mb-3" />
            <p className="text-white/40 text-sm font-mono">
              {isConnected ? '暂无技能数据' : '未连接'}
            </p>
            <p className="text-white/20 text-xs font-mono mt-1">
              {isConnected 
                ? '请检查 OpenClaw 的 skills.list API' 
                : '请先连接到 OpenClaw Gateway'}
            </p>
          </div>
        )}
      </div>

      {/* 侧边栏: 统计 */}
      <div className="w-44 border-l border-white/10 p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-cyan-400" />
          <h4 className="font-mono text-xs text-cyan-300 uppercase">统计</h4>
        </div>

        <div className="space-y-3">
          <div className="p-3 bg-white/5 rounded-lg">
            <p className="text-[10px] font-mono text-white/40 uppercase">总技能</p>
            <p className="text-2xl font-bold text-cyan-400">{totalSkills}</p>
          </div>

          <div className="p-3 bg-white/5 rounded-lg">
            <p className="text-[10px] font-mono text-white/40 uppercase">已激活</p>
            <p className="text-2xl font-bold text-emerald-400">
              {activeCount}
            </p>
          </div>

          {!hasEnhancements && groupedSkills.size > 1 && (
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-[10px] font-mono text-white/40 uppercase">分类数</p>
              <p className="text-2xl font-bold text-purple-400">{groupedSkills.size}</p>
            </div>
          )}

          {hasEnhancements && (
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-[10px] font-mono text-white/40 uppercase">AI 分析</p>
              <p className="text-lg font-bold text-amber-400">
                {Object.keys(skillEnhancements).length} 项
              </p>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-white/10">
          <p className="text-[9px] font-mono text-white/30 leading-relaxed">
            {hasEnhancements 
              ? 'AI 已按重要度排序技能。点击 AI 排序按钮可刷新分析。'
              : '技能来自 OpenClaw 的 SKILL.md 文件系统，显示所有已安装的 Agent 技能。'
            }
          </p>
        </div>
      </div>
      </div>
    </div>
  )
}
