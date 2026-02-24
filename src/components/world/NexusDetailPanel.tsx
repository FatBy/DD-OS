import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence, useDragControls } from 'framer-motion'
import { 
  X, Play, Trash2, Star, Clock, Globe2, 
  ChevronDown, ChevronRight, Puzzle, Cpu,
  BookOpen, Zap, CheckCircle2, XCircle, Timer, Target, TrendingUp, AlertCircle,
  Loader2, Pause, SkipForward, Activity, Edit2,
  Send, Square, MessageSquare, ArrowLeft, GripVertical, Search
} from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import { useT } from '@/i18n'
import { ChatMessage as ChatMessageComponent, StreamingMessage } from '@/components/ai/ChatMessage'
import { ChatErrorBoundary } from '@/components/ai/ChatErrorBoundary'
import type { NexusEntity, NexusExperience } from '@/types'

// 建造总时长（与 worldSlice tickConstructionAnimations 中的 3000ms 一致）
const CONSTRUCTION_DURATION_MS = 3000

/**
 * 基于 visualDNA 动态生成颜色配置
 */
function getDynamicConfig(nexus: NexusEntity | undefined) {
  if (!nexus) {
    return {
      label: 'Nexus',
      typeLabel: 'Nexus',
      typeLabelCity: 'Building',
      bgClass: 'bg-slate-500/20',
      borderClass: 'border-slate-500/30',
      textClass: 'text-slate-300',
      hue: 180,
    }
  }
  
  const hue = nexus.visualDNA?.primaryHue ?? 180
  
  // 动态生成 CSS 类名（使用 HSL 内联样式）
  return {
    label: nexus.flavorText?.slice(0, 20) || 'Nexus',
    typeLabel: nexus.label || 'Nexus',
    typeLabelCity: nexus.label || 'Building',
    // 使用 Tailwind 兼容的动态样式
    bgClass: '', // 将改用内联样式
    borderClass: '', // 将改用内联样式
    textClass: '', // 将改用内联样式
    hue,
  }
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
  const t = useT()
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
  const tasks = useStore((s) => s.tasks)
  const activeExecutions = useStore((s) => s.activeExecutions)
  const worldTheme = useStore((s) => s.worldTheme)

  // 搜索技能功能
  const openNexusPanelWithInput = useStore((s) => s.openNexusPanelWithInput)
  const pendingNexusChatInput = useStore((s) => s.pendingNexusChatInput)
  const clearPendingInput = useStore((s) => s.clearPendingInput)

  // Nexus 独立对话 (Phase 2)
  const sendNexusChat = useStore((s) => s.sendNexusChat)
  const clearNexusChat = useStore((s) => s.clearNexusChat)
  const nexusChatMap = useStore((s) => s.nexusChatMap)
  const nexusChatStreaming = useStore((s) => s.nexusChatStreaming)
  const nexusChatStreamContent = useStore((s) => s.nexusChatStreamContent)
  
  const [showModelConfig, setShowModelConfig] = useState(false)
  const [showSOP, setShowSOP] = useState(true)  // 默认展开 SOP
  const [showTaskDetail, setShowTaskDetail] = useState(false)  // 任务流程默认折叠
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [customApiKey, setCustomApiKey] = useState('')
  const [experiences, setExperiences] = useState<NexusExperience[]>([])
  
  // 名称编辑状态
  const [isEditingName, setIsEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState('')

  // 执行视图状态: 'info' = 详情视图, 'chat' = 对话视图
  const [panelMode, setPanelMode] = useState<'info' | 'chat'>('info')
  const [nexusInput, setNexusInput] = useState('')
  const nexusMsgEndRef = useRef<HTMLDivElement>(null)
  const nexusInputRef = useRef<HTMLTextAreaElement>(null)
  const constraintsRef = useRef<HTMLDivElement>(null)
  const dragControls = useDragControls()
  
  const nexus = selectedNexusForPanel ? nexuses.get(selectedNexusForPanel) : null
  
  // Resolve all bound skills (标记未加载为 unavailable)
  const boundSkills = useMemo(() => {
    if (!nexus) return []
    const ids = nexus.boundSkillIds || nexus.skillDependencies || (nexus.boundSkillId ? [nexus.boundSkillId] : [])
    return ids.map(id => {
      const fromStore = skills.find(s => s.id === id || s.name === id)
      const fromOC = openClawSkills.find(s => s.name === id)
      if (fromStore) return fromStore
      if (fromOC) return { id: fromOC.name, name: fromOC.name, description: fromOC.description, status: 'active' as const, unlocked: true }
      return { id, name: id, description: '', status: 'unavailable' as const, unlocked: false }
    }) as Array<{ id: string; name: string; description?: string; status: string; unlocked?: boolean }>
  }, [nexus, skills, openClawSkills])

  // File-based Nexus can execute even without bound skills (it has SOP)
  const canExecute = boundSkills.length > 0 || !!nexus?.sopContent

  // 查找与当前 Nexus 关联的活跃任务
  const activeTask = useMemo(() => {
    if (!nexus) return null
    const allTasks = [...activeExecutions, ...tasks]
    // 找到正在执行且关联到此 Nexus 的任务
    return allTasks.find(t => 
      t.status === 'executing' && 
      t.taskPlan?.nexusId === nexus.id
    ) || null
  }, [nexus, activeExecutions, tasks])

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
  
  // 面板打开/关闭时处理状态
  useEffect(() => {
    if (!nexusPanelOpen) {
      setIsEditingName(false)
      setEditNameValue('')
      setNexusInput('')
    } else if (selectedNexusForPanel) {
      // 如果有预填输入，自动切换到 chat 模式并填入
      if (pendingNexusChatInput) {
        setPanelMode('chat')
        setNexusInput(pendingNexusChatInput)
        clearPendingInput()
        setTimeout(() => nexusInputRef.current?.focus(), 200)
      } else {
        // 打开时：如果有活跃任务或已有对话记录，直接显示 chat 视图
        const hasChatHistory = (nexusChatMap[selectedNexusForPanel] || []).length > 0
        const hasActiveTask = activeExecutions.some(t => 
          t.status === 'executing' && t.taskPlan?.nexusId === selectedNexusForPanel
        )
        setPanelMode((hasChatHistory || hasActiveTask) ? 'chat' : 'info')
      }
    }
  }, [nexusPanelOpen, selectedNexusForPanel, pendingNexusChatInput])

  // Nexus 对话自动滚动
  const nexusMsgs = selectedNexusForPanel ? (nexusChatMap[selectedNexusForPanel] || []) : []
  const isNexusStreaming = nexusChatStreaming === selectedNexusForPanel

  useEffect(() => {
    nexusMsgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [nexusMsgs, nexusChatStreamContent])

  useEffect(() => {
    if (panelMode === 'chat') {
      setTimeout(() => nexusInputRef.current?.focus(), 200)
    }
  }, [panelMode])
  
  if (!nexus) return null
  
  const archConfig = getDynamicConfig(nexus)
  const hue = archConfig.hue
  // 动态颜色样式
  const dynamicColor = `hsl(${hue}, 80%, 70%)`
  const dynamicBg = { backgroundColor: `hsla(${hue}, 70%, 50%, 0.2)` }
  const dynamicBorder = { borderColor: `hsla(${hue}, 70%, 50%, 0.3)` }
  const dynamicText = { color: dynamicColor }
  const progress = xpProgress(nexus.xp, nexus.level)
  
  // 保存名称修改
  const handleSaveName = async () => {
    setIsEditingName(false)
    const trimmedName = editNameValue.trim()
    if (!trimmedName || trimmedName === nexus.label) return
    
    try {
      const serverUrl = localStorage.getItem('ddos_server_url') || 'http://localhost:3001'
      const res = await fetch(`${serverUrl}/nexuses/${nexus.id}/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName })
      })
      
      if (res.ok) {
        // 更新本地状态
        removeNexus(nexus.id)
        addNexus({ ...nexus, label: trimmedName })
      }
    } catch (e) {
      console.error('Failed to update nexus name', e)
    }
  }
  
  // Which model is being used
  const activeModel = nexus.customModel 
    ? { label: nexus.customModel.model, isCustom: true }
    : { label: llmConfig.model || 'Not configured', isCustom: false }
  
  const handleExecute = () => {
    // Phase 1+2: 切换到面板内对话视图，而不是跳到全局聊天
    setPanelMode('chat')
    setTimeout(() => nexusInputRef.current?.focus(), 200)
  }

  const handleDeactivate = () => {
    setActiveNexus(null)
  }

  // Nexus 独立对话发送
  const handleNexusSend = () => {
    const msg = nexusInput.trim()
    if (!msg || isNexusStreaming || !nexus) return
    setNexusInput('')
    sendNexusChat(nexus.id, msg)
  }

  const handleNexusKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleNexusSend()
    }
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
    const confirmMsg = (worldTheme === 'cityscape' || worldTheme === 'village')
      ? '确定要拆除这座建筑吗？此操作不可撤销。'
      : '确定要停用这颗星球节点吗？此操作不可撤销。'
    if (confirm(confirmMsg)) {
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
            className="fixed inset-0 bg-black/15 z-40"
          />
          
          {/* 拖动约束区域 */}
          <div ref={constraintsRef} className="fixed inset-0 z-[49] pointer-events-none" />
          
          <motion.div
            initial={{ opacity: 0, x: 480 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 480 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            drag
            dragControls={dragControls}
            dragConstraints={constraintsRef}
            dragElastic={0.05}
            dragMomentum={false}
            className="fixed right-4 top-4 bottom-4 w-[480px] z-50
                       bg-slate-950/95 backdrop-blur-xl border border-white/10
                       rounded-2xl
                       flex flex-col overflow-hidden
                       shadow-[-20px_0_60px_rgba(0,0,0,0.6)]
                       pointer-events-auto"
          >
            {/* Header - 可拖动区域 */}
            <div 
              className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02] cursor-grab active:cursor-grabbing"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="flex items-center gap-3">
                {panelMode === 'chat' ? (
                  <>
                    <button
                      onClick={() => setPanelMode('info')}
                      className="p-1 text-white/40 hover:text-white/70 transition-colors rounded hover:bg-white/10"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <div>
                      <h2 className="font-mono text-sm font-semibold text-white/90 tracking-wide uppercase flex items-center gap-2">
                        <MessageSquare className="w-4 h-4" style={dynamicText} />
                        {nexus.label || `Node-${nexus.id.slice(-6)}`}
                      </h2>
                      <p className="text-[11px] font-mono text-white/30 mt-0.5">
                        {isNexusStreaming ? '执行中...' : `${nexusMsgs.filter(m => m.role !== 'system').length} 条消息`}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <GripVertical className="w-4 h-4 text-white/20" />
                    <Globe2 className="w-5 h-5" style={dynamicText} />
                    <div>
                      {/* 名称编辑 */}
                      <div className="flex items-center gap-2 group">
                        {isEditingName ? (
                          <input 
                            autoFocus
                            className="bg-black/40 text-white/90 px-2 py-1 rounded border border-white/20 outline-none font-mono text-base font-semibold w-48 uppercase tracking-wide"
                            value={editNameValue}
                            onChange={e => setEditNameValue(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                            onBlur={handleSaveName}
                          />
                        ) : (
                          <>
                            <h2 className="font-mono text-base font-semibold text-white/90 tracking-wide uppercase">
                              {nexus.label || `Node-${nexus.id.slice(-6)}`}
                            </h2>
                            <button 
                              onClick={() => { setIsEditingName(true); setEditNameValue(nexus.label || nexus.id) }}
                              className="opacity-0 group-hover:opacity-100 p-1 text-white/40 hover:text-white/80 transition-opacity rounded hover:bg-white/10"
                              title="编辑名称"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                      <p className="text-xs font-mono text-white/40 mt-0.5">
                        LV.{nexus.level} {nexus.label || 'Nexus'}
                      </p>
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1">
                {panelMode === 'chat' && nexusMsgs.length > 0 && (
                  <button
                    onClick={() => nexus && clearNexusChat(nexus.id)}
                    className="p-1.5 text-white/25 hover:text-red-400 transition-colors"
                    title="清空对话"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={closeNexusPanel} className="p-1.5 text-white/30 hover:text-white/60 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            {/* Content: 根据 panelMode 切换 info / chat */}
            {panelMode === 'chat' ? (
              /* ====== 对话视图 ====== */
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  <ChatErrorBoundary onReset={() => nexus && clearNexusChat(nexus.id)}>
                    {nexusMsgs.length === 0 && !isNexusStreaming ? (
                      <div className="flex flex-col items-center justify-center h-full text-center">
                        <MessageSquare className="w-10 h-10 text-white/10 mb-3" />
                        <p className="text-sm font-mono text-white/40 mb-2">
                          输入任务，{nexus.label || 'Nexus'} 将按 SOP 执行
                        </p>
                        {nexus.flavorText && (
                          <p className="text-xs font-mono text-white/25 italic">
                            "{nexus.flavorText}"
                          </p>
                        )}
                      </div>
                    ) : (
                      <>
                        {nexusMsgs.filter(m => m.role !== 'system').map((msg) => (
                          <ChatMessageComponent key={msg.id} message={msg} />
                        ))}
                        {isNexusStreaming && nexusChatStreamContent && (
                          <StreamingMessage content={nexusChatStreamContent} />
                        )}
                      </>
                    )}
                    <div ref={nexusMsgEndRef} />
                  </ChatErrorBoundary>
                </div>
                
                {/* Nexus 输入框 */}
                <div className="px-4 py-3 border-t border-white/10 bg-black/20">
                  <div className="flex gap-2">
                    <textarea
                      ref={nexusInputRef}
                      value={nexusInput}
                      onChange={(e) => setNexusInput(e.target.value)}
                      onKeyDown={handleNexusKeyDown}
                      placeholder={`对 ${nexus.label || 'Nexus'} 说...`}
                      disabled={isNexusStreaming}
                      rows={1}
                      className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg 
                                 text-sm font-mono text-white/80 placeholder-white/25
                                 focus:border-white/25 focus:outline-none
                                 disabled:opacity-50 resize-none min-h-[40px] max-h-[100px]"
                    />
                    {isNexusStreaming ? (
                      <button
                        onClick={() => {/* TODO: abort nexus chat */}}
                        className="px-3 py-2 bg-red-500/20 border border-red-500/30 rounded-lg 
                                   text-red-400 hover:bg-red-500/30 transition-colors self-end"
                      >
                        <Square className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={handleNexusSend}
                        disabled={!nexusInput.trim()}
                        className="px-3 py-2 rounded-lg transition-colors self-end
                                   disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: `${dynamicColor}20`,
                          borderWidth: 1,
                          borderColor: `${dynamicColor}40`,
                          color: dynamicColor,
                        }}
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
            /* ====== 详情视图 (原有内容) ====== */
            <>
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
                      className="absolute inset-0 rounded-full border-2 border-dashed"
                      style={dynamicBorder}
                      animate={{ rotate: 360 }}
                      transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                    />
                    {/* 中层脉冲 */}
                    <motion.div 
                      className="absolute inset-4 rounded-full"
                      style={dynamicBg}
                      animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.6, 0.3] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                    {/* 核心 */}
                    <div className="absolute inset-8 rounded-full flex items-center justify-center" style={dynamicBg}>
                      <span className="text-2xl">🔨</span>
                    </div>
                  </div>
                  
                  {/* 进度文字 */}
                  <div className="text-center space-y-2">
                    <p className="text-lg font-mono font-semibold" style={dynamicText}>
                      {t('nexus.constructing')}
                    </p>
                    <p className="text-sm font-mono text-white/40">
                      {t('nexus.constructing_matter')}
                    </p>
                  </div>
                  
                  {/* 进度条 */}
                  <div className="w-48">
                    <div className="flex justify-between text-xs font-mono text-white/40 mb-1">
                      <span>{t('nexus.constructing_progress')}</span>
                      <span>{Math.round(nexus.constructionProgress * 100)}%</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${nexus.constructionProgress * 100}%` }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                        className="h-full rounded-full"
                        style={dynamicBg}
                      />
                    </div>
                    {/* 预估剩余时间 */}
                    <div className="flex items-center justify-center gap-1.5 mt-2">
                      <Timer className="w-3 h-3 text-white/30" />
                      <span className="text-xs font-mono text-white/40">
                        {t('nexus.constructing_eta')}{' '}
                        <span style={dynamicText}>
                          {Math.max(0, Math.ceil((1 - nexus.constructionProgress) * CONSTRUCTION_DURATION_MS / 1000))}
                        </span>
                        {t('nexus.constructing_eta_seconds')}
                      </span>
                    </div>
                  </div>
                  
                  <p className="text-xs font-mono text-white/30 text-center max-w-xs">
                    {t('nexus.constructing_hint')}
                    <br />{t('nexus.constructing_done_hint')}
                  </p>
                </motion.div>
              )}

              {/* === 正常内容（仅在建造完成后显示） === */}
              {nexus.constructionProgress >= 1 && (
                <>
              {/* Planet preview + level */}
              <div className="flex items-center gap-4">
                <PlanetPreview 
                  hue={nexus.visualDNA?.primaryHue ?? 180}
                  accentHue={nexus.visualDNA?.accentHue ?? 240}
                  level={nexus.level}
                />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Star className="w-4 h-4" style={dynamicText} />
                    <span className="text-xs font-mono text-white/50 uppercase">Level</span>
                    <span className="text-3xl font-bold font-mono" style={dynamicText}>
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
                        className="h-full rounded-full"
                        style={dynamicBg}
                      />
                    </div>
                  </div>
                  <div className="text-xs font-mono text-white/30">
                    {nexus.flavorText?.slice(0, 30) || 'Nexus'}
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
                    ? 'border hover:brightness-125 active:scale-[0.98]'
                    : 'bg-white/5 border border-white/10 text-white/20 cursor-not-allowed'
                )}
                style={canExecute ? { ...dynamicBg, ...dynamicBorder, ...dynamicText } : undefined}
              >
                {/* Glow effect on hover */}
                {canExecute && (
                  <div 
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity blur-xl"
                    style={dynamicBg}
                  />
                )}
                <Play className="w-5 h-5 relative z-10" />
                <span className="relative z-10">
                  {canExecute ? 'Execute' : 'No Skills Bound'}
                </span>
              </button>

              {/* 一句话介绍 */}
              {nexus.flavorText && (
                <p className="text-sm font-mono text-white/40 text-center leading-relaxed -mt-2">
                  {nexus.flavorText}
                </p>
              )}
              
              {/* ==================== Bound Skills ==================== */}
              <div className="p-5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center gap-2 mb-3">
                  <Puzzle className="w-4 h-4" style={dynamicText} />
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
                            'text-[13px] font-mono px-2 py-0.5 rounded-full',
                            skill.status === 'active' 
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                              : 'bg-red-500/20 text-red-400 border border-red-500/20'
                          )}>
                            {skill.status === 'active' ? 'ONLINE' : 'UNAVAILABLE'}
                          </span>
                        </div>
                        {skill.status === 'active' && skill.description && (
                          <p className="text-xs font-mono text-white/30 leading-relaxed line-clamp-2">
                            {skill.description}
                          </p>
                        )}
                        {skill.status !== 'active' && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <button
                              onClick={() => {
                                // 打开 skill-scout 面板并预填搜索请求
                                const searchQuery = `帮我搜索并安装 "${skill.name}" 技能`
                                openNexusPanelWithInput('skill-scout', searchQuery)
                              }}
                              className="text-[11px] font-mono px-2 py-1 rounded bg-amber-500/10 text-amber-400/70 border border-amber-500/15 hover:bg-amber-500/20 hover:text-amber-400 transition-colors flex items-center gap-1"
                            >
                              <Search className="w-3 h-3" />
                              搜索并加载
                            </button>
                            <button
                              onClick={() => {
                                if (!nexus) return
                                const ids = nexus.boundSkillIds || nexus.skillDependencies || []
                                const updated = { ...nexus, boundSkillIds: ids.filter(sid => sid !== skill.id && sid !== skill.name) }
                                removeNexus(nexus.id)
                                addNexus(updated)
                              }}
                              className="text-[11px] font-mono px-2 py-1 rounded bg-red-500/10 text-red-400/70 border border-red-500/15 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                            >
                              移除
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm font-mono text-white/20 italic">No skills bound to this Nexus</p>
                )}
              </div>

              {/* ==================== Objective Function (目标函数) ==================== */}
              {(nexus.objective || nexus.metrics || nexus.strategy) && (
                <div className="p-5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-4 h-4" style={dynamicText} />
                    <span className="text-xs font-mono text-white/50 uppercase tracking-wider">
                      Objective Function
                    </span>
                  </div>
                  
                  {nexus.objective && (
                    <div className="mb-4">
                      <p className="text-sm text-white/80 leading-relaxed">{nexus.objective}</p>
                    </div>
                  )}
                  
                  {nexus.strategy && (
                    <div className="mb-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <div className="flex items-center gap-1.5 mb-2">
                        <TrendingUp className="w-3 h-3 text-white/40" />
                        <span className="text-xs font-mono text-white/40 uppercase">Strategy</span>
                      </div>
                      <p className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap">{nexus.strategy}</p>
                    </div>
                  )}
                  
                  {nexus.metrics && nexus.metrics.length > 0 && (
                    <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <div className="flex items-center gap-1.5 mb-2">
                        <AlertCircle className="w-3 h-3 text-white/40" />
                        <span className="text-xs font-mono text-white/40 uppercase">Success Metrics</span>
                      </div>
                      <ul className="space-y-1">
                        {nexus.metrics.map((metric, i) => (
                          <li key={i} className="text-xs text-white/50 flex items-start gap-2">
                            <span className="text-white/30">•</span>
                            <span>{metric}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

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
                    className="text-[13px] font-mono px-3 py-1 rounded bg-white/5 text-white/40 hover:text-white/60 border border-white/10 transition-colors"
                  >
                    Deactivate
                  </button>
                </div>
              )}

              {/* ==================== Task Execution Progress ==================== */}
              {activeTask?.taskPlan && activeTask.taskPlan.subTasks && (
                <div className="p-5 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
                  <button
                    onClick={() => setShowTaskDetail(!showTaskDetail)}
                    className="w-full flex items-center gap-2"
                  >
                    <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
                    <span className="text-xs font-mono text-cyan-400 uppercase tracking-wider">
                      Task Execution
                    </span>
                    <span className="ml-auto text-xs font-mono text-white/30">
                      {(activeTask.taskPlan.subTasks || []).filter(t => t.status === 'done').length}/{(activeTask.taskPlan.subTasks || []).length}
                    </span>
                    {showTaskDetail 
                      ? <ChevronDown className="w-3 h-3 text-white/30" />
                      : <ChevronRight className="w-3 h-3 text-white/30" />
                    }
                  </button>
                  
                  {/* 进度条（始终显示） */}
                  <div className="mt-3">
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ 
                          width: `${Math.round(
                            (activeTask.taskPlan.subTasks.filter(t => t.status === 'done' || t.status === 'skipped').length / 
                             activeTask.taskPlan.subTasks.length) * 100
                          )}%` 
                        }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500"
                      />
                    </div>
                  </div>
                  
                  {/* 详情（折叠） */}
                  <AnimatePresence initial={false}>
                    {showTaskDetail && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 pt-3 border-t border-cyan-500/10">
                  {/* 子任务状态统计 */}
                  <div className="flex flex-wrap gap-2 mb-3 text-[11px] font-mono">
                    {activeTask.taskPlan.subTasks.filter(t => t.status === 'executing').length > 0 && (
                      <span className="flex items-center gap-1 text-cyan-400">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {activeTask.taskPlan.subTasks.filter(t => t.status === 'executing').length} 执行中
                      </span>
                    )}
                    {activeTask.taskPlan.subTasks.filter(t => t.status === 'blocked').length > 0 && (
                      <span className="flex items-center gap-1 text-amber-400">
                        <Pause className="w-3 h-3" />
                        {activeTask.taskPlan.subTasks.filter(t => t.status === 'blocked').length} 阻塞
                      </span>
                    )}
                    {activeTask.taskPlan.subTasks.filter(t => t.status === 'failed').length > 0 && (
                      <span className="flex items-center gap-1 text-red-400">
                        <XCircle className="w-3 h-3" />
                        {activeTask.taskPlan.subTasks.filter(t => t.status === 'failed').length} 失败
                      </span>
                    )}
                    {activeTask.taskPlan.subTasks.filter(t => t.status === 'paused_for_approval').length > 0 && (
                      <span className="flex items-center gap-1 text-yellow-400">
                        <AlertCircle className="w-3 h-3" />
                        {activeTask.taskPlan.subTasks.filter(t => t.status === 'paused_for_approval').length} 待确认
                      </span>
                    )}
                  </div>
                  
                  {/* 子任务列表 */}
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {activeTask.taskPlan.subTasks.map(subTask => {
                      const statusConfig: Record<string, { icon: typeof CheckCircle2; color: string }> = {
                        pending: { icon: Clock, color: 'slate' },
                        ready: { icon: Play, color: 'green' },
                        executing: { icon: Loader2, color: 'cyan' },
                        done: { icon: CheckCircle2, color: 'emerald' },
                        failed: { icon: XCircle, color: 'red' },
                        blocked: { icon: Pause, color: 'amber' },
                        skipped: { icon: SkipForward, color: 'slate' },
                        paused_for_approval: { icon: AlertCircle, color: 'yellow' },
                      }
                      const config = statusConfig[subTask.status] || statusConfig.pending
                      const StatusIcon = config.icon
                      const isExecuting = subTask.status === 'executing'
                      
                      return (
                        <div 
                          key={subTask.id}
                          className={cn(
                            'p-2 rounded-lg border flex items-start gap-2 transition-all',
                            subTask.status === 'done' && 'bg-emerald-500/5 border-emerald-500/15',
                            subTask.status === 'failed' && 'bg-red-500/5 border-red-500/15',
                            subTask.status === 'executing' && 'bg-cyan-500/5 border-cyan-500/20',
                            subTask.status === 'blocked' && 'bg-amber-500/5 border-amber-500/15',
                            subTask.status === 'paused_for_approval' && 'bg-yellow-500/5 border-yellow-500/20',
                            (subTask.status === 'pending' || subTask.status === 'ready' || subTask.status === 'skipped') && 'bg-white/[0.02] border-white/[0.05]'
                          )}
                        >
                          <div className={cn('w-4 h-4 flex items-center justify-center flex-shrink-0', `text-${config.color}-400`)}>
                            <StatusIcon className={cn('w-3 h-3', isExecuting && 'animate-spin')} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] text-white/60 line-clamp-1">{subTask.description}</p>
                            {subTask.error && (
                              <p className="text-[10px] text-red-400/70 mt-0.5 line-clamp-1">✗ {subTask.error}</p>
                            )}
                            {subTask.status === 'blocked' && subTask.blockReason && (
                              <p className="text-[10px] text-amber-400/70 mt-0.5 line-clamp-2">⚠ {subTask.blockReason}</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
              
              {/* ==================== SOP Section ==================== */}
              {nexus.sopContent && (
                <div className="p-5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <button
                    onClick={() => setShowSOP(!showSOP)}
                    className="w-full flex items-center gap-2"
                  >
                    <BookOpen className="w-4 h-4" style={dynamicText} />
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
                    <Star className="w-4 h-4" style={dynamicText} />
                    <span className="text-xs font-mono text-white/50 uppercase tracking-wider">
                      Experience Log
                    </span>
                    <span className="ml-auto text-xs font-mono text-white/25">
                      {experiences.length}
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                    {experiences.map((exp, i) => (
                      <div 
                        key={i}
                        className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04] flex items-center gap-2"
                      >
                        {exp.outcome === 'success' 
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        }
                        <p className="text-xs font-mono text-white/50 truncate">
                          {exp.title}
                        </p>
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
                          <label className="text-[13px] font-mono text-white/30 uppercase mb-1 block">Base URL</label>
                          <input
                            type="text"
                            value={customBaseUrl}
                            onChange={e => setCustomBaseUrl(e.target.value)}
                            placeholder={llmConfig.baseUrl || 'https://api.openai.com/v1'}
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm font-mono text-white/70 placeholder:text-white/15 focus:outline-none focus:border-cyan-500/30"
                          />
                        </div>
                        <div>
                          <label className="text-[13px] font-mono text-white/30 uppercase mb-1 block">Model</label>
                          <input
                            type="text"
                            value={customModel}
                            onChange={e => setCustomModel(e.target.value)}
                            placeholder={llmConfig.model || 'gpt-4o'}
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm font-mono text-white/70 placeholder:text-white/15 focus:outline-none focus:border-cyan-500/30"
                          />
                        </div>
                        <div>
                          <label className="text-[13px] font-mono text-white/30 uppercase mb-1 block">API Key (optional, uses global if empty)</label>
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
            </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
