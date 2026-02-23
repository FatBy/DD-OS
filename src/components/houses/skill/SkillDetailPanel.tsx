import { useMemo, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, ChevronRight, ChevronUp,
  TrendingUp, TrendingDown, Minus, Award, Search, ChevronDown,
  BarChart3, Star
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { skillStatsService, ABILITY_DOMAIN_CONFIGS } from '@/services/skillStatsService'
import type { SkillNode, AbilitySnapshot, DomainStats, AbilityDomain, OpenClawSkill } from '@/types'

// ============================================
// 雷达图组件 (SVG)
// ============================================

function RadarChart({ domains }: { domains: DomainStats[] }) {
  const size = 200
  const center = size / 2
  const maxRadius = 75
  const levels = 4

  const maxScore = Math.max(...domains.map(d => d.abilityScore), 1)

  const points = domains.map((domain, i) => {
    const angle = (Math.PI * 2 * i) / domains.length - Math.PI / 2
    const normalized = Math.min(domain.abilityScore / maxScore, 1)
    const r = normalized * maxRadius
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
      labelX: center + (maxRadius + 18) * Math.cos(angle),
      labelY: center + (maxRadius + 18) * Math.sin(angle),
      domain,
    }
  })

  const polygonPoints = points.map(p => `${p.x},${p.y}`).join(' ')

  const config = ABILITY_DOMAIN_CONFIGS
  const getDomainColor = (id: AbilityDomain) =>
    config.find(c => c.id === id)?.color || '#94a3b8'

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
      {/* 背景网格 */}
      {Array.from({ length: levels }, (_, i) => {
        const r = maxRadius * ((i + 1) / levels)
        const gridPoints = domains.map((_, j) => {
          const angle = (Math.PI * 2 * j) / domains.length - Math.PI / 2
          return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`
        }).join(' ')
        return (
          <polygon
            key={i}
            points={gridPoints}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
          />
        )
      })}

      {/* 轴线 */}
      {domains.map((_, i) => {
        const angle = (Math.PI * 2 * i) / domains.length - Math.PI / 2
        return (
          <line
            key={i}
            x1={center}
            y1={center}
            x2={center + maxRadius * Math.cos(angle)}
            y2={center + maxRadius * Math.sin(angle)}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
          />
        )
      })}

      {/* 数据区域 */}
      <motion.polygon
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        points={polygonPoints}
        fill="rgba(34, 211, 238, 0.15)"
        stroke="rgba(34, 211, 238, 0.6)"
        strokeWidth="2"
      />

      {/* 数据点 */}
      {points.map((p, i) => (
        <motion.circle
          key={i}
          initial={{ r: 0 }}
          animate={{ r: 3.5 }}
          transition={{ delay: i * 0.1, duration: 0.3 }}
          cx={p.x}
          cy={p.y}
          fill={getDomainColor(p.domain.domain)}
          stroke="rgba(0,0,0,0.3)"
          strokeWidth="1"
        />
      ))}

      {/* 标签 */}
      {points.map((p, i) => {
        const domainConfig = config.find(c => c.id === p.domain.domain)
        return (
          <text
            key={i}
            x={p.labelX}
            y={p.labelY}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={getDomainColor(p.domain.domain)}
            fontSize="10"
            fontFamily="monospace"
            className="select-none"
          >
            {domainConfig?.name || p.domain.domain}
          </text>
        )
      })}
    </svg>
  )
}

// ============================================
// 能力域进度条
// ============================================

function DomainBar({ stat, maxScore }: { stat: DomainStats; maxScore: number }) {
  const config = ABILITY_DOMAIN_CONFIGS.find(c => c.id === stat.domain)
  if (!config) return null

  const percent = maxScore > 0 ? Math.min((stat.abilityScore / maxScore) * 100, 100) : 0

  return (
    <div className="flex items-center gap-3 group">
      <span
        className="w-10 text-xs font-mono flex-shrink-0 text-right"
        style={{ color: config.color }}
      >
        {config.name}
      </span>
      <div className="flex-1 h-5 bg-white/5 rounded-full overflow-hidden relative">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="h-full rounded-full relative"
          style={{ backgroundColor: `${config.color}30`, borderRight: `2px solid ${config.color}` }}
        />
        <span className="absolute inset-0 flex items-center px-2 text-xs font-mono text-white/40">
          {stat.abilityScore > 0 ? stat.abilityScore.toLocaleString() : '-'}
        </span>
      </div>
      <span className="w-8 text-xs font-mono text-white/30 text-right flex-shrink-0">
        {stat.skillCount}
      </span>
      <div className="w-10 flex items-center justify-end flex-shrink-0">
        {stat.trend === 'up' ? (
          <span className="flex items-center gap-0.5 text-xs text-emerald-400">
            <TrendingUp className="w-3 h-3" />
            {stat.trendPercent > 0 ? `${stat.trendPercent}%` : ''}
          </span>
        ) : stat.trend === 'down' ? (
          <span className="flex items-center gap-0.5 text-xs text-red-400">
            <TrendingDown className="w-3 h-3" />
          </span>
        ) : (
          <Minus className="w-3 h-3 text-white/20" />
        )}
      </div>
    </div>
  )
}

// ============================================
// 成长摘要卡片
// ============================================

function GrowthSummary({ snapshot }: { snapshot: AbilitySnapshot }) {
  const { weeklyGrowth } = snapshot
  const hasGrowth = weeklyGrowth.newSkills > 0 || weeklyGrowth.scoreChange > 0

  return (
    <div className="p-3 rounded-lg bg-white/5 border border-white/10">
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-mono text-white/40 uppercase">Growth</span>
      </div>
      {hasGrowth ? (
        <div className="space-y-1">
          {weeklyGrowth.newSkills > 0 && (
            <p className="text-xs font-mono text-emerald-400">+{weeklyGrowth.newSkills} new skills</p>
          )}
          {weeklyGrowth.scoreChange > 0 && (
            <p className="text-xs font-mono text-cyan-400">+{weeklyGrowth.scoreChange.toLocaleString()} pts</p>
          )}
          {weeklyGrowth.successRateChange !== 0 && (
            <p className={cn(
              'text-xs font-mono',
              weeklyGrowth.successRateChange > 0 ? 'text-emerald-400' : 'text-red-400'
            )}>
              {weeklyGrowth.successRateChange > 0 ? '+' : ''}{weeklyGrowth.successRateChange}% success rate
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs font-mono text-white/25">No data yet</p>
      )}
    </div>
  )
}

// ============================================
// 里程碑卡片
// ============================================

const MILESTONE_LABELS: Record<string, { name: string; icon: string }> = {
  beginner: { name: '初学者', icon: '🌱' },
  intermediate: { name: '进阶者', icon: '⚡' },
  expert: { name: '专家', icon: '🎯' },
  versatile: { name: '全能', icon: '🌟' },
  veteran: { name: '老手', icon: '🏆' },
  poweruser: { name: '重度用户', icon: '💎' },
}

function MilestonesBadge({ milestones }: { milestones: string[] }) {
  if (milestones.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {milestones.map(id => {
        const label = MILESTONE_LABELS[id]
        if (!label) return null
        return (
          <motion.span
            key={id}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-xs font-mono text-amber-300"
          >
            <span>{label.icon}</span>
            {label.name}
          </motion.span>
        )
      })}
    </div>
  )
}

// ============================================
// 最近活跃技能
// ============================================

function RecentActiveSkills({ skillIds }: { skillIds: string[] }) {
  if (skillIds.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Star className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-mono text-white/40 uppercase">Recent Active</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {skillIds.slice(0, 6).map(id => {
          const stats = skillStatsService.getSkillStats(id)
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/5 border border-white/10 text-xs font-mono text-white/50"
            >
              <span className="text-cyan-400">{id}</span>
              {stats && (
                <span className="text-white/25">x{stats.callCount}</span>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ============================================
// 技能列表
// ============================================

function SkillListItem({ skill }: { skill: SkillNode }) {
  const isActive = skill.unlocked || skill.status === 'active'
  const stats = skillStatsService.getSkillStats(skill.name)
  const successRate = stats && (stats.successCount + stats.failureCount) > 0
    ? Math.round((stats.successCount / (stats.successCount + stats.failureCount)) * 100)
    : null

  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-1.5 rounded hover:bg-white/5 transition-colors',
      isActive ? 'text-white/50' : 'text-white/25'
    )}>
      <div className={cn(
        'w-1.5 h-1.5 rounded-full flex-shrink-0',
        isActive ? 'bg-cyan-400' : 'bg-white/20'
      )} />
      <span className="text-xs font-mono truncate flex-1">{skill.name}</span>
      {stats && stats.callCount > 0 && (
        <span className="text-xs font-mono text-white/20 flex-shrink-0">
          {stats.callCount}x
        </span>
      )}
      {successRate !== null && (
        <span className={cn(
          'text-xs font-mono flex-shrink-0',
          successRate >= 80 ? 'text-emerald-400/50' : successRate >= 50 ? 'text-amber-400/50' : 'text-red-400/50'
        )}>
          {successRate}%
        </span>
      )}
    </div>
  )
}

function SkillDomainGroup({
  domainId, skills, expanded, onToggle
}: {
  domainId: AbilityDomain
  skills: SkillNode[]
  expanded: boolean
  onToggle: () => void
}) {
  const config = ABILITY_DOMAIN_CONFIGS.find(c => c.id === domainId)
  if (!config || skills.length === 0) return null

  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-white/5 transition-colors"
      >
        <ChevronRight className={cn(
          'w-3 h-3 text-white/25 transition-transform',
          expanded && 'rotate-90'
        )} />
        <span className="text-xs font-mono flex-1 text-left" style={{ color: config.color }}>
          {config.name}
        </span>
        <span className="text-xs font-mono text-white/25">{skills.length}</span>
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
            {skills.map(skill => (
              <SkillListItem key={skill.id} skill={skill} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============================================
// 主组件: SkillDetailPanel
// ============================================

interface SkillDetailPanelProps {
  snapshot: AbilitySnapshot
  skills: SkillNode[]
  openClawSkills: OpenClawSkill[]
  isExpanded: boolean
  onToggle: () => void
}

export function SkillDetailPanel({ snapshot, skills, isExpanded, onToggle }: SkillDetailPanelProps) {
  const [viewMode, setViewMode] = useState<'dashboard' | 'list'>('dashboard')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set())

  const maxDomainScore = Math.max(...snapshot.domains.map(d => d.abilityScore), 1)

  const domainSkillsMap = useMemo(() => {
    const map = new Map<AbilityDomain, SkillNode[]>()
    for (const config of ABILITY_DOMAIN_CONFIGS) {
      map.set(config.id, [])
    }
    for (const skill of skills) {
      const name = skill.name.toLowerCase()
      const desc = (skill.description || '').toLowerCase()
      const combined = `${name} ${desc}`
      let matched = false
      for (const config of ABILITY_DOMAIN_CONFIGS) {
        if (config.keywords.some(kw => combined.includes(kw))) {
          map.get(config.id)!.push(skill)
          matched = true
          break
        }
      }
      if (!matched) {
        map.get('utility')!.push(skill)
      }
    }
    return map
  }, [skills])

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills
    const q = searchQuery.toLowerCase()
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q)
    )
  }, [skills, searchQuery])

  const toggleDomain = useCallback((domain: string) => {
    setExpandedDomains(prev => {
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
  }, [])

  if (skills.length === 0) return null

  return (
    <div className="mt-6">
      {/* 展开/收起按钮 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="border border-white/10 rounded-xl p-4">
              {/* 标题栏 */}
              <div className="flex items-center gap-3 mb-4">
                <Brain className="w-5 h-5 text-cyan-400" />
                <h3 className="font-mono text-sm text-cyan-300 tracking-wider">Agent Abilities</h3>

                {/* 视图切换 */}
                <div className="ml-auto flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
                  <button
                    onClick={() => setViewMode('dashboard')}
                    className={cn(
                      'px-2 py-1 text-xs font-mono rounded transition-colors',
                      viewMode === 'dashboard' ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/30 hover:text-white/50'
                    )}
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={cn(
                      'px-2 py-1 text-xs font-mono rounded transition-colors',
                      viewMode === 'list' ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/30 hover:text-white/50'
                    )}
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={onToggle}
                    className="px-2 py-1 text-xs font-mono rounded text-white/30 hover:text-white/50 transition-colors"
                    title="收起"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {viewMode === 'dashboard' ? (
                /* ==================== 仪表盘视图 ==================== */
                <div className="space-y-5">
                  {/* 顶部: 雷达图 + 成长摘要 */}
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <RadarChart domains={snapshot.domains} />
                    </div>
                    <div className="w-40 space-y-3">
                      <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-center">
                        <p className="text-xs font-mono text-white/40 uppercase mb-1">Total Score</p>
                        <motion.p
                          key={snapshot.totalScore}
                          initial={{ scale: 1.2, color: '#22d3ee' }}
                          animate={{ scale: 1, color: '#22d3ee' }}
                          className="text-2xl font-bold font-mono"
                        >
                          {snapshot.totalScore.toLocaleString()}
                        </motion.p>
                      </div>
                      <GrowthSummary snapshot={snapshot} />
                      {snapshot.milestones.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <Award className="w-3.5 h-3.5 text-amber-400" />
                            <span className="text-xs font-mono text-white/40 uppercase">Milestones</span>
                          </div>
                          <MilestonesBadge milestones={snapshot.milestones} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 能力域详情 */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-white/40 uppercase">Domain Breakdown</span>
                      <span className="text-xs font-mono text-white/20 ml-auto">Score</span>
                      <span className="text-xs font-mono text-white/20 w-8 text-right">Qty</span>
                      <span className="text-xs font-mono text-white/20 w-10 text-right">Trend</span>
                    </div>
                    {snapshot.domains
                      .sort((a, b) => b.abilityScore - a.abilityScore)
                      .map(stat => (
                        <DomainBar key={stat.domain} stat={stat} maxScore={maxDomainScore} />
                      ))
                    }
                  </div>

                  {/* 最近活跃 */}
                  <RecentActiveSkills skillIds={snapshot.recentActive} />
                </div>
              ) : (
                /* ==================== 列表视图 ==================== */
                <div className="space-y-2">
                  <div className="relative mb-3">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25" />
                    <input
                      type="text"
                      placeholder="Search skills..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-mono text-white/60 placeholder:text-white/20 focus:outline-none focus:border-cyan-500/30"
                    />
                  </div>

                  {searchQuery ? (
                    <div>
                      <p className="text-xs font-mono text-white/25 mb-2">{filteredSkills.length} results</p>
                      {filteredSkills.map(skill => (
                        <SkillListItem key={skill.id} skill={skill} />
                      ))}
                    </div>
                  ) : (
                    ABILITY_DOMAIN_CONFIGS.map(config => {
                      const domainSkills = domainSkillsMap.get(config.id) || []
                      return (
                        <SkillDomainGroup
                          key={config.id}
                          domainId={config.id}
                          skills={domainSkills}
                          expanded={expandedDomains.has(config.id)}
                          onToggle={() => toggleDomain(config.id)}
                        />
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
