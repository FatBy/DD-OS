import { motion, AnimatePresence } from 'framer-motion'
import { 
  X, Play, Trash2, Zap, Star, Clock, Globe2 
} from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import type { NexusArchetype } from '@/types'

// Archetype → 星球类型配置
const ARCHETYPE_CONFIG: Record<NexusArchetype, { 
  label: string 
  typeLabel: string
  color: string
  hueRange: string
}> = {
  MONOLITH: {
    label: 'Knowledge Storage',
    typeLabel: '知识星球',
    color: 'amber',
    hueRange: 'warm',
  },
  SPIRE: {
    label: 'Reasoning Engine',
    typeLabel: '推理星球',
    color: 'purple',
    hueRange: 'cool',
  },
  REACTOR: {
    label: 'Execution Core',
    typeLabel: '执行星球',
    color: 'cyan',
    hueRange: 'electric',
  },
  VAULT: {
    label: 'Memory Crystal',
    typeLabel: '记忆星球',
    color: 'emerald',
    hueRange: 'natural',
  },
}

// XP 等级阈值
const XP_THRESHOLDS = [0, 20, 100, 500] as const

function xpProgress(xp: number, level: number): number {
  if (level >= XP_THRESHOLDS.length) return 100
  const currentThreshold = XP_THRESHOLDS[level - 1]
  const nextThreshold = XP_THRESHOLDS[level] ?? XP_THRESHOLDS[XP_THRESHOLDS.length - 1] * 2
  return Math.min(100, ((xp - currentThreshold) / (nextThreshold - currentThreshold)) * 100)
}

// 星球 SVG 预览 (与 Canvas 风格一致)
function PlanetPreview({ hue, accentHue, level }: { hue: number; accentHue: number; level: number }) {
  const r = 28
  const cx = 50, cy = 50
  const ringR = r * 1.5
  return (
    <div className="relative w-24 h-24">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        {/* 大气光晕 */}
        <defs>
          <radialGradient id="atmo" cx="50%" cy="50%" r="50%">
            <stop offset="40%" stopColor={`hsl(${hue}, 80%, 60%)`} stopOpacity="0.15" />
            <stop offset="100%" stopColor={`hsl(${hue}, 80%, 60%)`} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="body" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stopColor={`hsl(${hue}, 70%, 75%)`} />
            <stop offset="50%" stopColor={`hsl(${hue}, 65%, 55%)`} />
            <stop offset="100%" stopColor={`hsl(${hue}, 60%, 25%)`} />
          </radialGradient>
        </defs>
        
        {/* 大气 */}
        <circle cx={cx} cy={cy} r={r * 1.6} fill="url(#atmo)" />
        
        {/* 后部星环 */}
        <ellipse cx={cx} cy={cy} rx={ringR} ry={ringR * 0.22} 
          fill="none" stroke={`hsl(${accentHue}, 70%, 65%)`} strokeWidth="1.5" strokeOpacity="0.25"
          strokeDasharray="2 4"
          clipPath="url(#backClip)"
        />
        
        {/* 球体 */}
        <circle cx={cx} cy={cy} r={r} fill="url(#body)" />
        
        {/* 前部星环 */}
        <ellipse cx={cx} cy={cy} rx={ringR} ry={ringR * 0.22} 
          fill="none" stroke={`hsl(${accentHue}, 75%, 70%)`} strokeWidth="2" strokeOpacity="0.5"
        />
        
        {/* 高光弧 */}
        <ellipse cx={cx - 6} cy={cy - 8} rx={10} ry={3.5} 
          fill="white" opacity="0.12" transform="rotate(-15 44 42)" 
        />
        
        {/* Level 指示 */}
        {level >= 3 && (
          <circle cx={cx} cy={cy} r={r * 0.25} 
            fill={`hsl(${accentHue}, 90%, 85%)`} opacity="0.3" 
          />
        )}
      </svg>
      {/* CSS 光晕 */}
      <div 
        className="absolute inset-0 rounded-full blur-xl opacity-15"
        style={{ backgroundColor: `hsl(${hue}, 70%, 55%)` }}
      />
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
      sendChat(`Execute skill: ${boundSkill.name}`, 'world')
    }
    closeNexusPanel()
  }
  
  const handleDelete = () => {
    if (confirm('Decommission this planet node? This action is irreversible.')) {
      removeNexus(nexus.id)
      closeNexusPanel()
    }
  }
  
  return (
    <AnimatePresence>
      {nexusPanelOpen && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeNexusPanel}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          />
          
          {/* 侧滑面板 */}
          <motion.div
            initial={{ opacity: 0, x: 340 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 340 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-[340px] z-50
                       bg-slate-950/95 backdrop-blur-xl border-l border-white/10
                       flex flex-col overflow-hidden
                       shadow-[-20px_0_60px_rgba(0,0,0,0.6)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <Globe2 className={cn('w-5 h-5', `text-${archConfig.color}-400`)} />
                <div>
                  <h2 className="font-mono text-sm font-semibold text-white/90 tracking-wide uppercase">
                    {nexus.label || `Node-${nexus.id.slice(-6)}`}
                  </h2>
                  <p className="text-[10px] font-mono text-white/40 mt-0.5">
                    LV.{nexus.level} {archConfig.typeLabel}
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
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              
              {/* 星球预览 + 等级 */}
              <div className="flex items-center gap-5">
                <PlanetPreview 
                  hue={nexus.visualDNA.primaryHue}
                  accentHue={nexus.visualDNA.accentHue}
                  level={nexus.level}
                />
                
                <div className="flex-1 space-y-3">
                  {/* Level */}
                  <div className="flex items-center gap-2">
                    <Star className={cn('w-4 h-4', `text-${archConfig.color}-400`)} />
                    <span className="text-[10px] font-mono text-white/50 uppercase">Level</span>
                    <span className={cn('text-2xl font-bold font-mono', `text-${archConfig.color}-400`)}>
                      {nexus.level}
                    </span>
                  </div>
                  
                  {/* XP Bar */}
                  <div>
                    <div className="flex justify-between text-[10px] font-mono text-white/40 mb-1">
                      <span>XP</span>
                      <span>{nexus.xp}</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                        className={cn('h-full rounded-full', `bg-${archConfig.color}-500`)}
                      />
                    </div>
                  </div>
                  
                  {/* Type */}
                  <div className="text-[10px] font-mono text-white/30">
                    Type: {archConfig.label}
                  </div>
                </div>
              </div>
              
              {/* 活跃模块 (绑定技能) */}
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[10px] font-mono text-white/50 uppercase tracking-wider">Active Module</span>
                </div>
                {boundSkill ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-mono text-white/80 font-medium">{boundSkill.name}</span>
                      <span className={cn(
                        'text-[9px] font-mono px-2 py-0.5 rounded-full',
                        boundSkill.status === 'active' 
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                          : 'bg-white/5 text-white/40 border border-white/10'
                      )}>
                        {boundSkill.status === 'active' ? 'ONLINE' : 'STANDBY'}
                      </span>
                    </div>
                    {boundSkill.description && (
                      <p className="text-[11px] font-mono text-white/30 leading-relaxed">
                        {boundSkill.description}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs font-mono text-white/20 italic">No module bound</p>
                )}
              </div>
              
              {/* 星球属性 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                  <div className="text-[9px] font-mono text-white/30 mb-1">PRIMARY HUE</div>
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: `hsl(${nexus.visualDNA.primaryHue}, 70%, 55%)` }} 
                    />
                    <span className="text-xs font-mono text-white/60">{nexus.visualDNA.primaryHue}</span>
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                  <div className="text-[9px] font-mono text-white/30 mb-1">GLOW</div>
                  <span className="text-xs font-mono text-white/60">
                    {(nexus.visualDNA.glowIntensity * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              
              {/* 时间信息 */}
              <div className="flex items-center gap-2 text-[10px] font-mono text-white/25">
                <Clock className="w-3 h-3" />
                <span>Created {new Date(nexus.createdAt).toLocaleDateString()}</span>
                {nexus.lastUsedAt && (
                  <>
                    <span className="text-white/10">|</span>
                    <span>Last used {new Date(nexus.lastUsedAt).toLocaleDateString()}</span>
                  </>
                )}
              </div>
              
              {/* Flavor Text */}
              {nexus.flavorText && (
                <div className="p-3 rounded-lg bg-gradient-to-b from-white/[0.03] to-transparent border-l-2 border-white/10">
                  <p className="text-[11px] font-mono text-white/40 italic leading-relaxed">
                    "{nexus.flavorText}"
                  </p>
                </div>
              )}
            </div>
            
            {/* 底部操作 */}
            <div className="p-4 border-t border-white/10 space-y-2 bg-black/20">
              {boundSkill && (
                <button
                  onClick={handleExecute}
                  className={cn(
                    'w-full py-3 px-4 rounded-lg flex items-center justify-center gap-2',
                    'text-sm font-mono font-medium tracking-wider uppercase transition-all',
                    `bg-${archConfig.color}-500/20 border border-${archConfig.color}-500/30`,
                    `text-${archConfig.color}-300 hover:bg-${archConfig.color}-500/30 hover:border-${archConfig.color}-500/40`
                  )}
                >
                  <Play className="w-4 h-4" />
                  Initialize Sequence
                </button>
              )}
              
              <button
                onClick={handleDelete}
                className="w-full py-2 px-4 rounded-lg flex items-center justify-center gap-2
                         text-[11px] font-mono text-red-400/50 hover:text-red-400
                         border border-red-500/10 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Decommission Node
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
