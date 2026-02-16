import { motion, AnimatePresence } from 'framer-motion'
import { 
  X, Play, Trash2, Building2, Zap, Star, Clock 
} from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import type { NexusArchetype } from '@/types'
import { xpToLevel } from '@/store/slices/worldSlice'

// Archetype 配置
const ARCHETYPE_CONFIG: Record<NexusArchetype, { 
  icon: string
  label: string 
  description: string
  color: string
}> = {
  MONOLITH: {
    icon: '🏛️',
    label: '知识巨碑',
    description: '存储与知识积累',
    color: 'amber',
  },
  SPIRE: {
    icon: '🗼',
    label: '推理尖塔',
    description: '复杂流程与推理',
    color: 'purple',
  },
  REACTOR: {
    icon: '⚛️',
    label: '执行反应堆',
    description: '执行与集成',
    color: 'cyan',
  },
  VAULT: {
    icon: '💎',
    label: '记忆水晶库',
    description: '频繁访问与记忆',
    color: 'emerald',
  },
}

// XP 等级阈值（与 worldSlice 保持一致）
const XP_THRESHOLDS = [0, 20, 100, 500] as const

// 计算到下一级的进度百分比
function xpProgress(xp: number, level: number): number {
  if (level >= XP_THRESHOLDS.length) return 100
  const currentThreshold = XP_THRESHOLDS[level - 1]
  const nextThreshold = XP_THRESHOLDS[level] ?? XP_THRESHOLDS[XP_THRESHOLDS.length - 1] * 2
  return Math.min(100, ((xp - currentThreshold) / (nextThreshold - currentThreshold)) * 100)
}

// 简单的 SVG 预览
function NexusPreview({ archetype, color }: { archetype: NexusArchetype; color: string }) {
  return (
    <div className="relative w-20 h-20">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        {archetype === 'MONOLITH' && (
          <>
            <rect x="25" y="55" width="50" height="35" fill={`hsl(var(--${color}))`} opacity="0.8" rx="2" />
            <rect x="30" y="30" width="40" height="25" fill={`hsl(var(--${color}))`} opacity="0.6" rx="2" />
            <rect x="35" y="10" width="30" height="20" fill={`hsl(var(--${color}))`} opacity="0.4" rx="2" />
          </>
        )}
        {archetype === 'SPIRE' && (
          <polygon 
            points="50,5 80,90 20,90" 
            fill={`hsl(var(--${color}))`} 
            opacity="0.8" 
          />
        )}
        {archetype === 'REACTOR' && (
          <>
            <circle cx="50" cy="50" r="22" fill={`hsl(var(--${color}))`} opacity="0.8" />
            <ellipse cx="50" cy="50" rx="35" ry="12" fill="none" stroke={`hsl(var(--${color}))`} strokeWidth="2" opacity="0.5" />
            <ellipse cx="50" cy="50" rx="35" ry="12" fill="none" stroke={`hsl(var(--${color}))`} strokeWidth="2" opacity="0.5" transform="rotate(60 50 50)" />
          </>
        )}
        {archetype === 'VAULT' && (
          <polygon 
            points="50,10 85,35 85,70 50,95 15,70 15,35" 
            fill={`hsl(var(--${color}))`} 
            opacity="0.8" 
          />
        )}
      </svg>
      {/* 发光效果 */}
      <div className={cn(
        'absolute inset-0 rounded-full blur-xl opacity-20',
        `bg-${color}-500`
      )} />
    </div>
  )
}

export function NexusDetailPanel() {
  const nexusPanelOpen = useStore((s) => s.nexusPanelOpen)
  const selectedNexusForPanel = useStore((s) => s.selectedNexusForPanel)
  const closeNexusPanel = useStore((s) => s.closeNexusPanel)
  const nexuses = useStore((s) => s.nexuses)
  const removeNexus = useStore((s) => s.removeNexus)
  const skills = useStore((s) => s.skills)
  const sendChat = useStore((s) => s.sendChat)
  
  const nexus = selectedNexusForPanel ? nexuses.get(selectedNexusForPanel) : null
  
  if (!nexus) return null
  
  const archConfig = ARCHETYPE_CONFIG[nexus.archetype]
  const progress = xpProgress(nexus.xp, nexus.level)
  const boundSkill = nexus.boundSkillId 
    ? skills.find(s => s.id === nexus.boundSkillId)
    : null
  
  const handleExecute = () => {
    if (boundSkill) {
      sendChat(`执行技能: ${boundSkill.name}`, 'world')
    }
    closeNexusPanel()
  }
  
  const handleDelete = () => {
    if (confirm('确定要拆除这个 Nexus 吗？此操作不可恢复。')) {
      removeNexus(nexus.id)
      closeNexusPanel()
    }
  }
  
  return (
    <AnimatePresence>
      {nexusPanelOpen && (
        <>
          {/* 背景遮罩 - 点击关闭 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeNexusPanel}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          />
          
          {/* 侧滑面板 */}
          <motion.div
            initial={{ opacity: 0, x: 320 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 320 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-[320px] z-50
                       bg-slate-950/95 backdrop-blur-xl border-l border-white/10
                       flex flex-col overflow-hidden
                       shadow-[-20px_0_60px_rgba(0,0,0,0.5)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{archConfig.icon}</span>
                <div>
                  <h2 className="font-mono text-sm text-white/90">
                    {nexus.label || `Nexus-${nexus.id.slice(-6)}`}
                  </h2>
                  <p className={cn('text-[10px] font-mono', `text-${archConfig.color}-400`)}>
                    {archConfig.label}
                  </p>
                </div>
              </div>
              <button
                onClick={closeNexusPanel}
                className="p-1.5 text-white/30 hover:text-white/60 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* 预览 + 等级 */}
              <div className="flex items-center gap-4">
                <div className={cn(
                  'rounded-lg p-2 flex items-center justify-center',
                  `bg-${archConfig.color}-500/10 border border-${archConfig.color}-500/20`
                )}>
                  <NexusPreview archetype={nexus.archetype} color={archConfig.color} />
                </div>
                
                <div className="flex-1 space-y-3">
                  {/* Level */}
                  <div className="flex items-center gap-2">
                    <Star className={cn('w-4 h-4', `text-${archConfig.color}-400`)} />
                    <span className="text-xs font-mono text-white/70">等级</span>
                    <span className={cn('text-lg font-bold font-mono', `text-${archConfig.color}-400`)}>
                      {nexus.level}
                    </span>
                  </div>
                  
                  {/* XP Bar */}
                  <div>
                    <div className="flex justify-between text-[10px] font-mono text-white/40 mb-1">
                      <span>经验值</span>
                      <span>{nexus.xp} XP</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.5 }}
                        className={cn('h-full rounded-full', `bg-${archConfig.color}-500`)}
                      />
                    </div>
                  </div>
                </div>
              </div>
              
              {/* 属性描述 */}
              <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                <p className="text-[10px] font-mono text-white/40 mb-1">属性</p>
                <p className="text-xs font-mono text-white/60">
                  {archConfig.description}
                </p>
              </div>
              
              {/* 绑定技能 */}
              <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[10px] font-mono text-white/40">绑定技能</span>
                </div>
                {boundSkill ? (
                  <div className="flex items-center gap-2">
                    <Building2 className={cn('w-4 h-4', `text-${archConfig.color}-400`)} />
                    <span className="text-xs font-mono text-white/80">{boundSkill.name}</span>
                    <span className={cn(
                      'ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded',
                      boundSkill.status === 'active' 
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-white/10 text-white/40'
                    )}>
                      {boundSkill.status === 'active' ? '活跃' : '休眠'}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs font-mono text-white/30 italic">未绑定技能</p>
                )}
              </div>
              
              {/* 时间信息 */}
              <div className="flex items-center gap-4 text-[10px] font-mono text-white/30">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>创建于 {new Date(nexus.createdAt).toLocaleDateString()}</span>
                </div>
                {nexus.lastUsedAt && (
                  <span>最近使用 {new Date(nexus.lastUsedAt).toLocaleDateString()}</span>
                )}
              </div>
              
              {/* Flavor Text */}
              {nexus.flavorText && (
                <div className="p-3 bg-gradient-to-b from-white/5 to-transparent rounded-lg border-l-2 border-white/10">
                  <p className="text-xs font-mono text-white/50 italic leading-relaxed">
                    "{nexus.flavorText}"
                  </p>
                </div>
              )}
            </div>
            
            {/* 底部操作按钮 */}
            <div className="p-4 border-t border-white/10 space-y-2">
              {boundSkill && (
                <button
                  onClick={handleExecute}
                  className={cn(
                    'w-full py-2.5 px-4 rounded-lg flex items-center justify-center gap-2',
                    'text-sm font-mono transition-colors',
                    `bg-${archConfig.color}-500/20 border border-${archConfig.color}-500/30`,
                    `text-${archConfig.color}-400 hover:bg-${archConfig.color}-500/30`
                  )}
                >
                  <Play className="w-4 h-4" />
                  执行
                </button>
              )}
              
              <button
                onClick={handleDelete}
                className="w-full py-2 px-4 rounded-lg flex items-center justify-center gap-2
                         text-xs font-mono text-red-400/70 hover:text-red-400
                         border border-red-500/20 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                拆除 Nexus
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
