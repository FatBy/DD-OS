import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  X, Play, Trash2, Star, Clock, Globe2, 
  ChevronDown, ChevronRight, Puzzle, Cpu,
  BookOpen, Zap, CheckCircle2, XCircle
} from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import type { NexusArchetype, NexusExperience } from '@/types'

// Archetype config
const ARCHETYPE_CONFIG: Record<NexusArchetype, { 
  label: string 
  typeLabel: string
  color: string
  bgClass: string
  borderClass: string
  textClass: string
}> = {
  MONOLITH: {
    label: 'Knowledge Storage',
    typeLabel: '知识星球',
    color: 'amber',
    bgClass: 'bg-amber-500/20',
    borderClass: 'border-amber-500/30',
    textClass: 'text-amber-300',
  },
  SPIRE: {
    label: 'Reasoning Engine',
    typeLabel: '推理星球',
    color: 'purple',
    bgClass: 'bg-purple-500/20',
    borderClass: 'border-purple-500/30',
    textClass: 'text-purple-300',
  },
  REACTOR: {
    label: 'Execution Core',
    typeLabel: '执行星球',
    color: 'cyan',
    bgClass: 'bg-cyan-500/20',
    borderClass: 'border-cyan-500/30',
    textClass: 'text-cyan-300',
  },
  VAULT: {
    label: 'Memory Crystal',
    typeLabel: '记忆星球',
    color: 'emerald',
    bgClass: 'bg-emerald-500/20',
    borderClass: 'border-emerald-500/30',
    textClass: 'text-emerald-300',
  },
}

const XP_THRESHOLDS = [0, 20, 100, 500] as const

function xpProgress(xp: number, level: number): number {
  if (level >= XP_THRESHOLDS.length) return 100
  const currentThreshold = XP_THRESHOLDS[level - 1]
  const nextThreshold = XP_THRESHOLDS[level] ?? XP_THRESHOLDS[XP_THRESHOLDS.length - 1] * 2
  return Math.min(100, ((xp - currentThreshold) / (nextThreshold - currentThreshold)) * 100)
}

// Planet SVG preview
function PlanetPreview({ hue, accentHue, level }: { hue: number; accentHue: number; level: number }) {
  const r = 28
  const cx = 50, cy = 50
  const ringR = r * 1.5
  return (
    <div className="relative w-24 h-24">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <defs>
          <radialGradient id="ndp-atmo" cx="50%" cy="50%" r="50%">
            <stop offset="40%" stopColor={`hsl(${hue}, 80%, 60%)`} stopOpacity="0.15" />
            <stop offset="100%" stopColor={`hsl(${hue}, 80%, 60%)`} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="ndp-body" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stopColor={`hsl(${hue}, 70%, 75%)`} />
            <stop offset="50%" stopColor={`hsl(${hue}, 65%, 55%)`} />
            <stop offset="100%" stopColor={`hsl(${hue}, 60%, 25%)`} />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r * 1.6} fill="url(#ndp-atmo)" />
        <ellipse cx={cx} cy={cy} rx={ringR} ry={ringR * 0.22} 
          fill="none" stroke={`hsl(${accentHue}, 70%, 65%)`} strokeWidth="1.5" strokeOpacity="0.25"
          strokeDasharray="2 4"
        />
        <circle cx={cx} cy={cy} r={r} fill="url(#ndp-body)" />
        <ellipse cx={cx} cy={cy} rx={ringR} ry={ringR * 0.22} 
          fill="none" stroke={`hsl(${accentHue}, 75%, 70%)`} strokeWidth="2" strokeOpacity="0.5"
        />
        <ellipse cx={cx - 6} cy={cy - 8} rx={10} ry={3.5} 
          fill="white" opacity="0.12" transform="rotate(-15 44 42)" 
        />
        {level >= 3 && (
          <circle cx={cx} cy={cy} r={r * 0.25} 
            fill={`hsl(${accentHue}, 90%, 85%)`} opacity="0.3" 
          />
        )}
      </svg>
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
  const addNexus = useStore((s) => s.addNexus)
  const skills = useStore((s) => s.skills)
  const openClawSkills = useStore((s) => s.openClawSkills)
  const llmConfig = useStore((s) => s.llmConfig)
  const setActiveNexus = useStore((s) => s.setActiveNexus)
  const activeNexusId = useStore((s) => s.activeNexusId)
  const setChatOpen = useStore((s) => s.setChatOpen)
  const addNexusActivationMessage = useStore((s) => s.addNexusActivationMessage)
  
  const [showModelConfig, setShowModelConfig] = useState(false)
  const [showSOP, setShowSOP] = useState(false)
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [customApiKey, setCustomApiKey] = useState('')
  const [experiences, setExperiences] = useState<NexusExperience[]>([])
  
  const nexus = selectedNexusForPanel ? nexuses.get(selectedNexusForPanel) : null
  
  // Resolve all bound skills
  const boundSkills = useMemo(() => {
    if (!nexus) return []
    const ids = nexus.boundSkillIds || (nexus.boundSkillId ? [nexus.boundSkillId] : [])
    return ids.map(id => {
      // Match by id or name
      const fromStore = skills.find(s => s.id === id || s.name === id)
      const fromOC = openClawSkills.find(s => s.name === id)
      return fromStore || (fromOC ? { id: fromOC.name, name: fromOC.name, description: fromOC.description, status: 'active' as const, unlocked: true } : null)
    }).filter(Boolean) as Array<{ id: string; name: string; description?: string; status: string }>
  }, [nexus, skills, openClawSkills])

  // File-based Nexus can execute even without bound skills (it has SOP)
  const canExecute = boundSkills.length > 0 || !!nexus?.sopContent

  // Load experiences from server when panel opens
  useEffect(() => {
    if (!nexus?.id || !nexusPanelOpen) return
    const serverUrl = localStorage.getItem('ddos_server_url') || 'http://localhost:3001'
    fetch(`${serverUrl}/nexuses/${nexus.id}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.recentExperiences) {
          setExperiences(data.recentExperiences)
        }
      })
      .catch(() => {})
  }, [nexus?.id, nexusPanelOpen])
  
  if (!nexus) return null
  
  const archConfig = ARCHETYPE_CONFIG[nexus.archetype]
  const progress = xpProgress(nexus.xp, nexus.level)
  
  // Which model is being used
  const activeModel = nexus.customModel 
    ? { label: nexus.customModel.model, isCustom: true }
    : { label: llmConfig.model || 'Not configured', isCustom: false }
  
  const handleExecute = () => {
    // Activate this Nexus for the ReAct loop
    setActiveNexus(nexus.id)
    // Close panel and open chat for user to input their task
    closeNexusPanel()
    setChatOpen(true)
    // Add activation message to chat
    addNexusActivationMessage(nexus.label || nexus.id, nexus.flavorText)
    // The Nexus context (SOP, constraints) will be injected automatically
  }

  const handleDeactivate = () => {
    setActiveNexus(null)
  }
  
  const handleSaveModel = () => {
    if (!nexus) return
    const updated = { ...nexus }
    if (customBaseUrl && customModel) {
      updated.customModel = {
        baseUrl: customBaseUrl,
        model: customModel,
        apiKey: customApiKey || undefined,
      }
    } else {
      updated.customModel = undefined
    }
    // Update via remove + add
    removeNexus(nexus.id)
    addNexus(updated)
    setShowModelConfig(false)
  }
  
  const handleClearModel = () => {
    if (!nexus) return
    const updated = { ...nexus, customModel: undefined }
    removeNexus(nexus.id)
    addNexus(updated)
    setCustomBaseUrl('')
    setCustomModel('')
    setCustomApiKey('')
    setShowModelConfig(false)
  }
  
  const handleDelete = () => {
    if (confirm('Decommission this planet node? This action is irreversible.')) {
      removeNexus(nexus.id)
      closeNexusPanel()
    }
  }

  // Initialize model config fields when opening
  const handleToggleModelConfig = () => {
    if (!showModelConfig && nexus.customModel) {
      setCustomBaseUrl(nexus.customModel.baseUrl)
      setCustomModel(nexus.customModel.model)
      setCustomApiKey(nexus.customModel.apiKey || '')
    }
    setShowModelConfig(!showModelConfig)
  }
  
  return (
    <AnimatePresence>
      {nexusPanelOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeNexusPanel}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          />
          
          <motion.div
            initial={{ opacity: 0, x: 480 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 480 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-[480px] z-50
                       bg-slate-950/95 backdrop-blur-xl border-l border-white/10
                       flex flex-col overflow-hidden
                       shadow-[-20px_0_60px_rgba(0,0,0,0.6)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <Globe2 className={cn('w-5 h-5', archConfig.textClass)} />
                <div>
                  <h2 className="font-mono text-base font-semibold text-white/90 tracking-wide uppercase">
                    {nexus.label || `Node-${nexus.id.slice(-6)}`}
                  </h2>
                  <p className="text-xs font-mono text-white/40 mt-0.5">
                    LV.{nexus.level} {archConfig.typeLabel}
                  </p>
                </div>
              </div>
              <button onClick={closeNexusPanel} className="p-1.5 text-white/30 hover:text-white/60 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              
              {/* === 建造中状态 === */}
              {nexus.constructionProgress < 1 && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-16 space-y-6"
                >
                  {/* 建造动画 */}
                  <div className="relative w-32 h-32">
                    {/* 外层旋转光环 */}
                    <motion.div 
                      className={cn('absolute inset-0 rounded-full border-2 border-dashed', archConfig.borderClass)}
                      animate={{ rotate: 360 }}
                      transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                    />
                    {/* 中层脉冲 */}
                    <motion.div 
                      className={cn('absolute inset-4 rounded-full', archConfig.bgClass)}
                      animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.6, 0.3] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                    {/* 核心 */}
                    <div className={cn('absolute inset-8 rounded-full flex items-center justify-center', archConfig.bgClass)}>
                      <span className="text-2xl">🔨</span>
                    </div>
                  </div>
                  
                  {/* 进度文字 */}
                  <div className="text-center space-y-2">
                    <p className={cn('text-lg font-mono font-semibold', archConfig.textClass)}>
                      星球建造中
                    </p>
                    <p className="text-sm font-mono text-white/40">
                      物质正在凝聚...
                    </p>
                  </div>
                  
                  {/* 进度条 */}
                  <div className="w-48">
                    <div className="flex justify-between text-xs font-mono text-white/40 mb-1">
                      <span>建造进度</span>
                      <span>{Math.round(nexus.constructionProgress * 100)}%</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${nexus.constructionProgress * 100}%` }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                        className={cn('h-full rounded-full', archConfig.bgClass)}
                      />
                    </div>
                  </div>
                  
                  <p className="text-xs font-mono text-white/30 text-center max-w-xs">
                    Nexus 正在从虚空中凝聚，请稍候...
                    <br />建造完成后即可使用
                  </p>
                </motion.div>
              )}

              {/* === 正常内容（仅在建造完成后显示） === */}
              {nexus.constructionProgress >= 1 && (
                <>
              {/* Planet preview + level */}
              <div className="flex items-center gap-4">
                <PlanetPreview 
                  hue={nexus.visualDNA.primaryHue}
                  accentHue={nexus.visualDNA.accentHue}
                  level={nexus.level}
                />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Star className={cn('w-4 h-4', archConfig.textClass)} />
                    <span className="text-xs font-mono text-white/50 uppercase">Level</span>
                    <span className={cn('text-3xl font-bold font-mono', archConfig.textClass)}>
                      {nexus.level}
                    </span>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs font-mono text-white/40 mb-1">
                      <span>XP</span>
                      <span>{nexus.xp}</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                        className={cn('h-full rounded-full', archConfig.bgClass)}
                      />
                    </div>
                  </div>
                  <div className="text-xs font-mono text-white/30">
                    Type: {archConfig.label}
                  </div>
                </div>
              </div>

              {/* ==================== Execute Button ==================== */}
              <button
                onClick={handleExecute}
                disabled={!canExecute}
                className={cn(
                  'w-full py-4 px-5 rounded-xl flex items-center justify-center gap-3',
                  'text-base font-mono font-semibold tracking-wider uppercase transition-all',
                  'group relative overflow-hidden',
                  canExecute
                    ? `${archConfig.bgClass} border ${archConfig.borderClass} ${archConfig.textClass} hover:brightness-125 active:scale-[0.98]`
                    : 'bg-white/5 border border-white/10 text-white/20 cursor-not-allowed'
                )}
              >
                {/* Glow effect on hover */}
                {canExecute && (
                  <div className={cn(
                    'absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity',
                    archConfig.bgClass, 'blur-xl'
                  )} />
                )}
                <Play className="w-5 h-5 relative z-10" />
                <span className="relative z-10">
                  {canExecute ? 'Execute' : 'No Skills Bound'}
                </span>
              </button>
              
              {/* ==================== Bound Skills ==================== */}
              <div className="p-5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center gap-2 mb-3">
                  <Puzzle className={cn('w-4 h-4', archConfig.textClass)} />
                  <span className="text-xs font-mono text-white/50 uppercase tracking-wider">
                    Bound Skills
                  </span>
                  <span className="ml-auto text-xs font-mono text-white/25">
                    {boundSkills.length}
                  </span>
                </div>
                
                {boundSkills.length > 0 ? (
                  <div className="space-y-2.5">
                    {boundSkills.map(skill => (
                      <div 
                        key={skill.id}
                        className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-mono text-white/80 font-medium">{skill.name}</span>
                          <span className={cn(
                            'text-[10px] font-mono px-2 py-0.5 rounded-full',
                            skill.status === 'active' 
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                              : 'bg-white/5 text-white/40 border border-white/10'
                          )}>
                            {skill.status === 'active' ? 'ONLINE' : 'STANDBY'}
                          </span>
                        </div>
                        {skill.description && (
                          <p className="text-xs font-mono text-white/30 leading-relaxed line-clamp-2">
                            {skill.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm font-mono text-white/20 italic">No skills bound to this Nexus</p>
                )}
              </div>

              {/* ==================== Active Nexus Indicator ==================== */}
              {activeNexusId === nexus.id && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono text-emerald-400 uppercase tracking-wider">
                      Active Nexus
                    </span>
                  </div>
                  <button
                    onClick={handleDeactivate}
                    className="text-[10px] font-mono px-3 py-1 rounded bg-white/5 text-white/40 hover:text-white/60 border border-white/10 transition-colors"
                  >
                    Deactivate
                  </button>
                </div>
              )}
              
              {/* ==================== SOP Section ==================== */}
              {nexus.sopContent && (
                <div className="p-5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <button
                    onClick={() => setShowSOP(!showSOP)}
                    className="w-full flex items-center gap-2"
                  >
                    <BookOpen className={cn('w-4 h-4', archConfig.textClass)} />
                    <span className="text-xs font-mono text-white/50 uppercase tracking-wider">
                      Mission & SOP
                    </span>
                    <span className="ml-auto text-xs font-mono text-white/25">
                      {nexus.version || '1.0.0'}
                    </span>
                    {showSOP 
                      ? <ChevronDown className="w-3 h-3 text-white/30" />
                      : <ChevronRight className="w-3 h-3 text-white/30" />
                    }
                  </button>
                  
                  <AnimatePresence initial={false}>
                    {showSOP && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 pt-3 border-t border-white/5">
                          <pre className="text-xs font-mono text-white/40 leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                            {nexus.sopContent}
                          </pre>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* ==================== Experience Section ==================== */}
              {experiences.length > 0 && (
                <div className="p-5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="flex items-center gap-2 mb-3">
                    <Star className={cn('w-4 h-4', archConfig.textClass)} />
                    <span className="text-xs font-mono text-white/50 uppercase tracking-wider">
                      Experience Log
                    </span>
                    <span className="ml-auto text-xs font-mono text-white/25">
                      {experiences.length}
                    </span>
                  </div>
                  <div className="space-y-2 max-h-[240px] overflow-y-auto">
                    {experiences.map((exp, i) => (
                      <div 
                        key={i}
                        className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] flex items-start gap-2"
                      >
                        {exp.outcome === 'success' 
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                          : <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                        }
                        <div className="min-w-0">
                          <p className="text-xs font-mono text-white/50 truncate">
                            {exp.title}
                          </p>
                          {exp.content && (
                            <p className="text-[10px] font-mono text-white/25 truncate mt-0.5">
                              {exp.content.split('\n')[0]}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* ==================== Model Config ==================== */}
              <div className="p-5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <button
                  onClick={handleToggleModelConfig}
                  className="w-full flex items-center gap-2"
                >
                  <Cpu className="w-4 h-4 text-white/40" />
                  <span className="text-xs font-mono text-white/50 uppercase tracking-wider">
                    Model
                  </span>
                  <span className={cn(
                    'ml-auto text-xs font-mono px-2 py-0.5 rounded',
                    activeModel.isCustom 
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                      : 'text-white/30'
                  )}>
                    {activeModel.isCustom ? 'Custom' : 'Global'}
                  </span>
                  {showModelConfig 
                    ? <ChevronDown className="w-3 h-3 text-white/30" />
                    : <ChevronRight className="w-3 h-3 text-white/30" />
                  }
                </button>
                
                <p className="text-xs font-mono text-white/25 mt-1.5 truncate">
                  {activeModel.label}
                </p>
                
                <AnimatePresence initial={false}>
                  {showModelConfig && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
                        <div>
                          <label className="text-[10px] font-mono text-white/30 uppercase mb-1 block">Base URL</label>
                          <input
                            type="text"
                            value={customBaseUrl}
                            onChange={e => setCustomBaseUrl(e.target.value)}
                            placeholder={llmConfig.baseUrl || 'https://api.openai.com/v1'}
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm font-mono text-white/70 placeholder:text-white/15 focus:outline-none focus:border-cyan-500/30"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-mono text-white/30 uppercase mb-1 block">Model</label>
                          <input
                            type="text"
                            value={customModel}
                            onChange={e => setCustomModel(e.target.value)}
                            placeholder={llmConfig.model || 'gpt-4o'}
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm font-mono text-white/70 placeholder:text-white/15 focus:outline-none focus:border-cyan-500/30"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-mono text-white/30 uppercase mb-1 block">API Key (optional, uses global if empty)</label>
                          <input
                            type="password"
                            value={customApiKey}
                            onChange={e => setCustomApiKey(e.target.value)}
                            placeholder="Leave empty for global key"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm font-mono text-white/70 placeholder:text-white/15 focus:outline-none focus:border-cyan-500/30"
                          />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={handleSaveModel}
                            className="flex-1 py-2 px-4 rounded text-xs font-mono bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/30 transition-colors"
                          >
                            Save
                          </button>
                          {nexus.customModel && (
                            <button
                              onClick={handleClearModel}
                              className="py-2 px-4 rounded text-xs font-mono bg-white/5 border border-white/10 text-white/40 hover:text-white/60 transition-colors"
                            >
                              Reset to Global
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              
              {/* Flavor Text */}
              {nexus.flavorText && (
                <div className="p-4 rounded-lg bg-gradient-to-b from-white/[0.03] to-transparent border-l-2 border-white/10">
                  <p className="text-sm font-mono text-white/40 italic leading-relaxed">
                    "{nexus.flavorText}"
                  </p>
                </div>
              )}
              
              {/* Time info */}
              <div className="flex items-center gap-2 text-xs font-mono text-white/25">
                <Clock className="w-4 h-4" />
                <span>Created {new Date(nexus.createdAt).toLocaleDateString()}</span>
                {nexus.lastUsedAt && (
                  <>
                    <span className="text-white/10">|</span>
                    <span>Last used {new Date(nexus.lastUsedAt).toLocaleDateString()}</span>
                  </>
                )}
              </div>
              </>
              )}
            </div>
            
            {/* Footer */}
            <div className="p-5 border-t border-white/10 bg-black/20">
              <button
                onClick={handleDelete}
                className="w-full py-2.5 px-4 rounded-lg flex items-center justify-center gap-2
                         text-sm font-mono text-red-400/50 hover:text-red-400
                         border border-red-500/10 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Decommission Node
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
