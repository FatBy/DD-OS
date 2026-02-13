import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Brain, Loader2, Zap, ChevronRight, Check, AlertCircle } from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import type { SkillNode } from '@/types'

// 单个技能卡片 - 通用设计
function SkillCard({ skill, index }: { skill: SkillNode; index: number }) {
  // 判断技能状态
  const isActive = skill.unlocked || skill.status === 'active'
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.5) }}
      className={cn(
        'p-2 rounded-lg border transition-all cursor-pointer hover:scale-[1.01]',
        isActive 
          ? 'bg-cyan-500/10 border-cyan-500/30 hover:border-cyan-400/50'
          : 'bg-white/5 border-white/10 hover:border-white/20'
      )}
    >
      <div className="flex items-center gap-2">
        {/* 状态指示 */}
        <div className={cn(
          'w-2 h-2 rounded-full flex-shrink-0',
          isActive ? 'bg-cyan-400' : 'bg-white/20'
        )} />
        
        {/* 技能名称 */}
        <span className={cn(
          'text-xs font-mono truncate flex-1',
          isActive ? 'text-cyan-300' : 'text-white/40'
        )}>
          {skill.name}
        </span>
        
        {/* 状态标识 */}
        {isActive ? (
          <Check className="w-3 h-3 text-cyan-400/60 flex-shrink-0" />
        ) : (
          <span className="text-[9px] text-white/20">-</span>
        )}
      </div>
      
      {/* 版本/描述 (如果有) */}
      {skill.version && (
        <p className="text-[9px] text-white/30 mt-1 truncate pl-4">v{skill.version}</p>
      )}
    </motion.div>
  )
}

// 技能分组组件 - 支持动态类别
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
      {/* 分组标题 */}
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
      
      {/* 技能列表 */}
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
  const openClawSkills = useStore((s) => s.openClawSkills)
  const loading = useStore((s) => s.channelsLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)

  const isConnected = connectionStatus === 'connected'
  
  // 使用 store 中的技能数据
  const skills = storeSkills

  // 动态分组 - 根据实际数据中的 category 或 location 字段分组
  const groupedSkills = useMemo(() => {
    if (!skills || skills.length === 0) {
      return new Map<string, SkillNode[]>()
    }
    
    const groups = new Map<string, SkillNode[]>()
    
    for (const skill of skills) {
      // 使用 category、location 或 '技能' 作为分组依据
      const groupKey = skill.category || 'Skills'
      if (!groups.has(groupKey)) {
        groups.set(groupKey, [])
      }
      groups.get(groupKey)!.push(skill)
    }
    
    return groups
  }, [skills])

  // 展开状态 - 默认全部展开
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  
  // 初始化时展开所有分组
  useMemo(() => {
    if (groupedSkills.size > 0 && expandedGroups.size === 0) {
      setExpandedGroups(new Set(groupedSkills.keys()))
    }
  }, [groupedSkills])

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(group)) {
        newSet.delete(group)
      } else {
        newSet.add(group)
      }
      return newSet
    })
  }

  // 统计
  const totalSkills = skills.length
  const activeCount = skills.filter(s => s.unlocked || s.status === 'active').length

  // 加载中状态
  if (loading && isConnected) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* 主区域: 技能列表 */}
      <div className="flex-1 p-4 overflow-y-auto">
        {/* 标题 */}
        <div className="flex items-center gap-2 mb-4">
          <Brain className="w-5 h-5 text-cyan-400" />
          <h3 className="font-mono text-sm text-cyan-300 tracking-wider">
            技能库
          </h3>
          {isConnected && totalSkills > 0 && (
            <span className="ml-auto text-[10px] font-mono text-white/40">
              {totalSkills} skills
            </span>
          )}
        </div>

        {/* 技能列表 */}
        {skills.length > 0 ? (
          <div className="space-y-1">
            {/* 如果有分组，按分组显示 */}
            {groupedSkills.size > 1 ? (
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
              /* 如果只有一个分组或无分组，直接显示所有技能 */
              <div className="grid grid-cols-2 gap-1">
                {skills.map((skill, idx) => (
                  <SkillCard key={skill.id} skill={skill} index={idx} />
                ))}
              </div>
            )}
          </div>
        ) : (
          /* 无数据提示 */
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

          {groupedSkills.size > 1 && (
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-[10px] font-mono text-white/40 uppercase">分类数</p>
              <p className="text-2xl font-bold text-purple-400">{groupedSkills.size}</p>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-white/10">
          <p className="text-[9px] font-mono text-white/30 leading-relaxed">
            技能来自 OpenClaw 的 SKILL.md 文件系统，显示所有已安装的 Agent 技能。
          </p>
        </div>
      </div>
    </div>
  )
}
