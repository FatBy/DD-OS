import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Brain, Loader2, Zap, X, ChevronRight } from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import type { SkillNode, SkillCategory } from '@/types'

// 默认技能（未连接时显示示例）
const defaultSkills: SkillNode[] = [
  { id: 'tmux', name: 'Tmux', x: 0, y: 0, level: 80, unlocked: true, dependencies: [], category: 'core', status: 'active' },
  { id: 'github', name: 'GitHub', x: 0, y: 0, level: 80, unlocked: true, dependencies: [], category: 'core', status: 'active' },
  { id: 'weather', name: 'Weather', x: 0, y: 0, level: 60, unlocked: true, dependencies: [], category: 'core', status: 'active' },
  { id: 'animations', name: 'Animations', x: 0, y: 0, level: 0, unlocked: false, dependencies: [], category: 'creative', status: 'inactive' },
  { id: 'agent-memory', name: 'Agent Memory', x: 0, y: 0, level: 80, unlocked: true, dependencies: [], category: 'ai', status: 'active' },
  { id: 'multi-search', name: 'Multi Search', x: 0, y: 0, level: 80, unlocked: true, dependencies: [], category: 'search', status: 'active' },
]

// 类别图标和颜色配置
const categoryMeta: Record<SkillCategory, { icon: string; color: string; label: string }> = {
  core: { icon: '🔧', color: 'cyan', label: '核心工具' },
  creative: { icon: '🎨', color: 'pink', label: '创作设计' },
  ai: { icon: '🧠', color: 'purple', label: 'AI记忆' },
  search: { icon: '🌐', color: 'emerald', label: '搜索网络' },
  integration: { icon: '🔌', color: 'amber', label: '通道集成' },
  domain: { icon: '🎯', color: 'red', label: '专业领域' },
  devops: { icon: '⚡', color: 'blue', label: '开发运维' },
  other: { icon: '📦', color: 'gray', label: '其他' },
}

// 单个技能卡片
function SkillCard({ skill, index }: { skill: SkillNode; index: number }) {
  const isActive = skill.status === 'active'
  const meta = categoryMeta[skill.category || 'other']
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02 }}
      className={cn(
        'p-2 rounded-lg border transition-all cursor-pointer hover:scale-[1.02]',
        isActive 
          ? 'bg-cyan-500/10 border-cyan-500/30 hover:border-cyan-400/50'
          : 'bg-white/5 border-white/10 hover:border-white/20'
      )}
    >
      <div className="flex items-center gap-2">
        {/* 状态指示 */}
        <div className={cn(
          'w-2 h-2 rounded-full',
          isActive ? 'bg-cyan-400' : 'bg-white/20'
        )} />
        
        {/* 技能名称 */}
        <span className={cn(
          'text-xs font-mono truncate flex-1',
          isActive ? 'text-cyan-300' : 'text-white/40'
        )}>
          {skill.name}
        </span>
        
        {/* 等级/状态 */}
        {isActive ? (
          <span className="text-[9px] font-mono text-cyan-400/60">
            Lv.{skill.level}
          </span>
        ) : (
          <X className="w-3 h-3 text-white/20" />
        )}
      </div>
    </motion.div>
  )
}

// 技能类别分组
function SkillCategoryGroup({ 
  category, 
  skills,
  expanded,
  onToggle
}: { 
  category: SkillCategory
  skills: SkillNode[]
  expanded: boolean
  onToggle: () => void
}) {
  const meta = categoryMeta[category]
  const activeCount = skills.filter(s => s.status === 'active').length
  
  return (
    <div className="mb-3">
      {/* 类别标题 */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
      >
        <span className="text-base">{meta.icon}</span>
        <span className="text-xs font-mono text-white/70 flex-1 text-left">
          {meta.label}
        </span>
        <span className={cn(
          'text-[10px] font-mono px-1.5 py-0.5 rounded',
          `bg-${meta.color}-500/20 text-${meta.color}-400`
        )}>
          {activeCount}/{skills.length}
        </span>
        <ChevronRight className={cn(
          'w-3 h-3 text-white/30 transition-transform',
          expanded && 'rotate-90'
        )} />
      </button>
      
      {/* 技能列表 */}
      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="mt-2 grid grid-cols-2 gap-1.5 pl-2"
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

  const isConnected = connectionStatus === 'connected'
  const skills = isConnected && storeSkills.length > 0 ? storeSkills : defaultSkills

  // 按类别分组
  const skillsByCategory = useMemo(() => {
    const grouped = new Map<SkillCategory, SkillNode[]>()
    
    for (const skill of skills) {
      const cat = skill.category || 'other'
      if (!grouped.has(cat)) {
        grouped.set(cat, [])
      }
      grouped.get(cat)!.push(skill)
    }
    
    // 按类别顺序排序
    const order: SkillCategory[] = ['core', 'creative', 'ai', 'search', 'integration', 'domain', 'devops', 'other']
    return order
      .filter(cat => grouped.has(cat))
      .map(cat => ({ category: cat, skills: grouped.get(cat)! }))
  }, [skills])

  // 展开状态 (默认全部展开)
  const [expandedCategories, setExpandedCategories] = useState<Set<SkillCategory>>(
    () => new Set(['core', 'creative', 'ai', 'search', 'integration', 'domain', 'devops', 'other'])
  )

  const toggleCategory = (cat: SkillCategory) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev)
      if (newSet.has(cat)) {
        newSet.delete(cat)
      } else {
        newSet.add(cat)
      }
      return newSet
    })
  }

  // 统计
  const activeCount = skills.filter(s => s.status === 'active').length
  const totalSkills = skills.length

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
          {isConnected && (
            <span className="ml-auto text-[10px] font-mono text-white/40">
              OpenClaw Skills
            </span>
          )}
        </div>

        {/* 技能分组列表 */}
        <div className="space-y-1">
          {skillsByCategory.map(({ category, skills: catSkills }) => (
            <SkillCategoryGroup
              key={category}
              category={category}
              skills={catSkills}
              expanded={expandedCategories.has(category)}
              onToggle={() => toggleCategory(category)}
            />
          ))}
        </div>

        {/* 无数据提示 */}
        {skills.length === 0 && !loading && (
          <div className="text-center py-8">
            <p className="text-white/40 text-sm font-mono">暂无技能数据</p>
            <p className="text-white/20 text-xs font-mono mt-1">
              请检查 OpenClaw Gateway 的 skills.list API
            </p>
          </div>
        )}
      </div>

      {/* 侧边栏: 统计 */}
      <div className="w-48 border-l border-white/10 p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-cyan-400" />
          <h4 className="font-mono text-xs text-cyan-300 uppercase">统计</h4>
        </div>

        <div className="space-y-3">
          <div className="p-3 bg-white/5 rounded-lg">
            <p className="text-[10px] font-mono text-white/40 uppercase">已激活</p>
            <p className="text-2xl font-bold text-cyan-400">
              {activeCount}<span className="text-sm text-white/30">/{totalSkills}</span>
            </p>
          </div>

          <div className="p-3 bg-white/5 rounded-lg">
            <p className="text-[10px] font-mono text-white/40 uppercase">技能类别</p>
            <p className="text-2xl font-bold text-emerald-400">{skillsByCategory.length}</p>
          </div>
        </div>

        {/* 类别统计 */}
        <div className="pt-4 border-t border-white/10 space-y-2">
          {skillsByCategory.slice(0, 5).map(({ category, skills: catSkills }) => {
            const meta = categoryMeta[category]
            const active = catSkills.filter(s => s.status === 'active').length
            return (
              <div key={category} className="flex items-center gap-2 text-[10px] font-mono">
                <span>{meta.icon}</span>
                <span className="text-white/50 flex-1">{meta.label}</span>
                <span className="text-white/30">{active}/{catSkills.length}</span>
              </div>
            )
          })}
        </div>

        <div className="pt-4 border-t border-white/10">
          <p className="text-[9px] font-mono text-white/30 leading-relaxed">
            技能来自 SKILL.md 文件系统，包括核心工具、创作设计、AI记忆等多个类别。
          </p>
        </div>
      </div>
    </div>
  )
}
