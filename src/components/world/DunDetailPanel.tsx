import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import {
  Activity,
  AlertCircle,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Download,
  Edit2,
  FileText,
  GripVertical,
  History,
  Layers3,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  Puzzle,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { MarkdownRenderer } from '@/components/ai/markdown/MarkdownRenderer'
import { AchievementBadges } from '@/components/dashboard/AchievementBadges'
import {
  EMOTION_LABELS,
  STAGE_LABELS,
  getDefaultSpecies,
  getDunEmoji,
  getEmotionState,
  getGrowthStage,
  type AnimalSpecies,
  type GrowthStage,
} from '@/components/dashboard/dunGrowth'
import { FileCard } from '@/components/shared/FileCard'
import { useStore } from '@/store'
import { getConstructionProgress } from '@/store/slices/worldSlice'
import { searchOnlineSkills } from '@/services/onlineSearchService'
import { installSkill, triggerHotReload } from '@/services/installService'
import { dunScoringService } from '@/services/dunScoringService'
import { agentEventBus } from '@/services/agentEventBus'
import { dunManager } from '@/services/dunManager'
import {
  buildAbilitySummary,
  buildGrowthProfile,
  formatEvidenceLevel,
  getEvidenceTone,
  selectDunExecutionState,
  type CapabilityClaim,
  type CareerItem,
  type DunAbilitySummary,
  type EvidenceLevel,
  type GrowthEvent,
  type TrustAdviceItem,
} from '@/services/dunProfileService'
import { getServerUrl } from '@/utils/env'
import { formatTime } from '@/utils/formatTime'
import { cn } from '@/utils/cn'
import type { DunEntity, DunExperience, DunLLMBinding, DunScoring, TaskItem } from '@/types'
import { SCORE_TIER_COLORS, getScoreTier } from '@/types'
import { DunKnowledgeTab } from './DunKnowledgeTab'

type DetailView = 'career' | 'stack' | 'ability' | 'sop' | 'skills' | 'records' | 'artifacts' | 'knowledge'

type BoundSkill = {
  id: string
  name: string
  description?: string
  status: string
  unlocked?: boolean
}

type AvailableSkill = {
  id: string
  name: string
  description?: string
  status?: string
}

const CONSTRUCTION_DURATION_MS = 3000

const TIER_LABELS: Record<string, string> = {
  Expert: '专家',
  Capable: '胜任',
  Learning: '学习中',
  Weak: '薄弱',
}

const DETAIL_NAV: Array<{ id: DetailView; label: string; icon: LucideIcon }> = [
  { id: 'career', label: '成长档案', icon: Sparkles },
  { id: 'stack', label: '工作栈', icon: Layers3 },
  { id: 'ability', label: '能力证据', icon: Brain },
  { id: 'sop', label: 'SOP', icon: BookOpen },
  { id: 'skills', label: 'Skills', icon: Puzzle },
  { id: 'records', label: '记录', icon: History },
  { id: 'artifacts', label: '产出', icon: FileText },
  { id: 'knowledge', label: '知识', icon: BookOpen },
]

function getDynamicConfig(dun: DunEntity | undefined) {
  const hue = dun?.visualDNA?.primaryHue ?? 180
  return {
    hue,
    label: dun?.flavorText?.slice(0, 20) || 'Dun',
    typeLabel: dun?.label || 'Dun',
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function evidenceClassName(level: EvidenceLevel): string {
  const tone = getEvidenceTone(level)
  if (tone === 'emerald') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
  if (tone === 'blue') return 'border-blue-500/30 bg-blue-500/10 text-blue-700'
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700'
}

function EvidenceBadge({ level }: { level: EvidenceLevel }) {
  return (
    <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-[11px] font-mono border', evidenceClassName(level))}>
      {formatEvidenceLevel(level)}
    </span>
  )
}

function SectionHeader({ icon: Icon, title, action }: { icon: LucideIcon; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-stone-500" />
      <h3 className="text-sm font-semibold text-stone-700">{title}</h3>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  )
}

function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="py-12 text-center">
      <Icon className="w-8 h-8 mx-auto text-stone-300" />
      <p className="mt-3 text-sm font-mono text-stone-500">{title}</p>
      <p className="mt-1 text-xs text-stone-400">{description}</p>
    </div>
  )
}

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
      <p className="text-[11px] font-mono uppercase text-stone-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-stone-700">{value}</p>
    </div>
  )
}

function CapabilityCard({ claim, compact = false }: { claim: CapabilityClaim; compact?: boolean }) {
  const pct = Math.round(claim.passRate * 100)
  const lower = claim.wilsonLowerBound != null ? Math.round(claim.wilsonLowerBound * 100) : null

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="flex items-start gap-3">
        <EvidenceBadge level={claim.evidenceLevel} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-stone-800">{claim.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">{claim.narrative}</p>
        </div>
      </div>
      {!compact && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <StatPill label="证据" value={claim.evidenceCount} />
          <StatPill label="通过率" value={`${pct}%`} />
          <StatPill label="下界" value={lower == null ? '—' : `${lower}%`} />
        </div>
      )}
    </div>
  )
}

function TrustAdviceList({ items, emptyLabel }: { items: TrustAdviceItem[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-400">{emptyLabel}</p>
  }
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={`${item.taskType}-${index}`} className="rounded-lg border border-stone-200 bg-white p-3">
          <div className="flex items-center gap-2">
            <EvidenceBadge level={item.evidenceLevel} />
            <span className="text-sm font-semibold text-stone-800">{item.taskType}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-stone-500">{item.reason}</p>
        </div>
      ))}
    </div>
  )
}

function CareerItemCard({ item }: { item: CareerItem }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="flex items-start gap-2">
        {item.kind === 'highlight'
          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-stone-800">{item.title}</p>
            <EvidenceBadge level={item.evidenceLevel} />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">{item.summary}</p>
          {item.learnedChange && (
            <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">{item.learnedChange}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function GrowthTimeline({ events }: { events: GrowthEvent[] }) {
  if (events.length === 0) {
    return <EmptyState icon={History} title="暂无成长事件" description="完成更多任务后，这里会出现可追溯的成长记录。" />
  }
  return (
    <div className="space-y-3">
      {events.map(event => (
        <div key={event.id} className="relative rounded-lg border border-stone-200 bg-white p-3">
          <div className="flex items-center gap-2">
            <EvidenceBadge level={event.evidenceLevel} />
            <span className="text-xs font-mono text-stone-400">{new Date(event.date).toLocaleDateString()}</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-stone-800">{event.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">{event.firstPersonSummary}</p>
        </div>
      ))}
    </div>
  )
}

function DetailShell({
  activeView,
  onSelectView,
  onClose,
  children,
}: {
  activeView: DetailView
  onSelectView: (view: DetailView) => void
  onClose: () => void
  children: React.ReactNode
}) {
  const activeConfig = DETAIL_NAV.find(item => item.id === activeView) ?? DETAIL_NAV[0]
  const ActiveIcon = activeConfig.icon

  return (
    <motion.div
      initial={{ opacity: 0, x: -28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -28 }}
      transition={{ type: 'spring', damping: 26, stiffness: 280 }}
      className="fixed left-4 top-4 bottom-4 right-[456px] z-50 min-w-[420px] overflow-hidden rounded-xl border border-stone-200 bg-white/95 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex h-full">
        <aside className="w-44 shrink-0 border-r border-stone-200 bg-stone-50 p-3">
          <div className="mb-3 flex items-center gap-2 px-2 py-1">
            <ActiveIcon className="h-4 w-4 text-stone-500" />
            <span className="text-xs font-mono font-semibold uppercase text-stone-500">Dun Detail</span>
          </div>
          <nav className="space-y-1">
            {DETAIL_NAV.map(item => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectView(item.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                    activeView === item.id
                      ? 'bg-white text-stone-900 shadow-sm'
                      : 'text-stone-500 hover:bg-white/70 hover:text-stone-800',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
            <div className="flex items-center gap-2">
              <ActiveIcon className="h-5 w-5 text-stone-600" />
              <h2 className="text-lg font-semibold text-stone-900">{activeConfig.label}</h2>
            </div>
            <button onClick={onClose} className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
              <X className="h-5 w-5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
        </section>
      </div>
    </motion.div>
  )
}

export function DunDetailPanel() {
  const dunPanelOpen = useStore((s) => s.dunPanelOpen)
  const selectedDunForPanel = useStore((s) => s.selectedDunForPanel)
  const closeDunPanel = useStore((s) => s.closeDunPanel)
  const duns = useStore((s) => s.duns)
  const removeDun = useStore((s) => s.removeDun)
  const addDun = useStore((s) => s.addDun)
  const skills = useStore((s) => s.skills)
  const openClawSkills = useStore((s) => s.openClawSkills)
  const setActiveDun = useStore((s) => s.setActiveDun)
  const activeDunId = useStore((s) => s.activeDunId)
  const tasks = useStore((s) => s.tasks)
  const activeExecutions = useStore((s) => s.activeExecutions)
  const addToast = useStore((s) => s.addToast)
  const providers = useStore((s) => s.linkStation.providers)
  const saveDunLLMBinding = useStore((s) => s.saveDunLLMBinding)
  const pendingDunChatInput = useStore((s) => s.pendingDunChatInput)
  const clearPendingInput = useStore((s) => s.clearPendingInput)
  const createNewDunConversation = useStore((s) => s.createNewDunConversation)
  const getOrCreateDunConversation = useStore((s) => s.getOrCreateDunConversation)
  const switchConversation = useStore((s) => s.switchConversation)
  const setChatOpen = useStore((s) => s.setChatOpen)
  const conversations = useStore((s) => s.conversations)

  const [detailView, setDetailView] = useState<DetailView | null>(null)
  const [showModelConfig, setShowModelConfig] = useState(false)
  const [showTaskDetail, setShowTaskDetail] = useState(false)
  const [showSkillPicker, setShowSkillPicker] = useState(false)
  const [skillSearchQuery, setSkillSearchQuery] = useState('')
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null)
  const [bindingProviderId, setBindingProviderId] = useState('')
  const [bindingModelId, setBindingModelId] = useState('')
  const [bindingTemperature, setBindingTemperature] = useState(0.7)
  const [useCustomTemp, setUseCustomTemp] = useState(false)
  const [experiences, setExperiences] = useState<DunExperience[]>([])
  const [scoring, setScoring] = useState<DunScoring | null>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState('')

  const importFileRef = useRef<HTMLInputElement>(null)
  const constraintsRef = useRef<HTMLDivElement>(null)
  const dragControls = useDragControls()

  const dun = selectedDunForPanel ? duns.get(selectedDunForPanel) ?? null : null
  const buildProgress = dun ? getConstructionProgress(dun) : 1
  const isBuilding = buildProgress < 1

  const boundSkills = useMemo<BoundSkill[]>(() => {
    if (!dun) return []
    const ids = dun.boundSkillIds || []
    return ids.map(id => {
      const normalized = id.toLowerCase().trim()
      const fromStore = skills.find(skill =>
        skill.id?.toLowerCase() === normalized ||
        skill.name?.toLowerCase() === normalized ||
        skill.skillName?.toLowerCase() === normalized,
      )
      const fromOpenClaw = openClawSkills.find(skill => skill.name?.toLowerCase() === normalized)
      if (fromStore) {
        return {
          id: fromStore.id || fromStore.name || id,
          name: fromStore.name || fromStore.id || id,
          description: fromStore.description,
          status: String(fromStore.status || 'active'),
          unlocked: fromStore.unlocked,
        }
      }
      if (fromOpenClaw) {
        const realStatus = fromOpenClaw.status === 'active'
          ? 'active'
          : fromOpenClaw.status === 'inactive'
            ? 'inactive'
            : 'error'
        return {
          id: fromOpenClaw.name,
          name: fromOpenClaw.name,
          description: fromOpenClaw.description,
          status: realStatus,
          unlocked: realStatus === 'active',
        }
      }
      return { id, name: id, description: '', status: 'unavailable', unlocked: false }
    })
  }, [dun, openClawSkills, skills])

  const availableSkillsForPicker = useMemo<AvailableSkill[]>(() => {
    const boundIds = new Set((dun?.boundSkillIds || []).map(id => id.toLowerCase().trim()))
    const allSkills: AvailableSkill[] = []
    const seen = new Set<string>()

    for (const skill of skills) {
      const key = (skill.name || skill.id || '').toLowerCase().trim()
      if (key && !seen.has(key) && !boundIds.has(key)) {
        seen.add(key)
        allSkills.push({
          id: skill.id || skill.name || '',
          name: skill.name || skill.id || '',
          description: skill.description,
          status: String(skill.status || ''),
        })
      }
    }

    for (const skill of openClawSkills) {
      const key = (skill.name || '').toLowerCase().trim()
      if (key && !seen.has(key) && !boundIds.has(key)) {
        seen.add(key)
        allSkills.push({ id: skill.name || '', name: skill.name || '', description: skill.description, status: skill.status })
      }
    }

    if (!skillSearchQuery) return allSkills
    const query = skillSearchQuery.toLowerCase()
    return allSkills.filter(skill =>
      skill.name.toLowerCase().includes(query) ||
      skill.description?.toLowerCase().includes(query),
    )
  }, [dun?.boundSkillIds, openClawSkills, skillSearchQuery, skills])

  const artifacts = useMemo(() => {
    if (!dun?.id) return []
    return dunManager.getDunArtifacts(dun.id)
  }, [dun?.id, experiences.length, scoring?.lastUpdated])

  const abilitySummary = useMemo<DunAbilitySummary | null>(() => {
    if (!dun) return null
    return buildAbilitySummary({ dun, scoring, experiences, artifacts })
  }, [artifacts, dun, experiences, scoring])

  const growthProfile = useMemo(() => {
    if (!dun) return null
    return buildGrowthProfile({ dun, scoring, experiences, artifacts })
  }, [artifacts, dun, experiences, scoring])

  const executionState = useMemo(() => {
    if (!dun) return { state: 'idle' as const, source: 'none' as const }
    return selectDunExecutionState(dun.id, activeExecutions, tasks)
  }, [activeExecutions, dun, tasks])

  const activeTask = useMemo<TaskItem | null>(() => {
    if (!dun) return null
    const allTasks = [...activeExecutions, ...tasks]
    return allTasks.find(task =>
      ['executing', 'retrying', 'paused', 'error'].includes(task.status) &&
      (task.taskPlan?.dunId === dun.id || task.checkpoint?.dunId === dun.id),
    ) || null
  }, [activeExecutions, dun, tasks])

  const dunConversations = useMemo(() => {
    if (!dun) return []
    return [...conversations.values()]
      .filter(conversation => conversation.type === 'dun' && conversation.dunId === dun.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [conversations, dun])

  const selectedProvider = useMemo(() => {
    if (!bindingProviderId) return null
    return providers.find(provider => provider.id === bindingProviderId) ?? null
  }, [bindingProviderId, providers])

  const bindingStatus = useMemo(() => {
    if (dun?.llmBinding) {
      const provider = providers.find(item => item.id === dun.llmBinding?.providerId)
      const providerLabel = provider?.label || dun.llmBinding.providerId
      const modelLabel = provider?.models.find(model => model.id === dun.llmBinding?.modelId)?.name || dun.llmBinding.modelId
      return { label: `${providerLabel} / ${modelLabel}`, isCustom: true }
    }
    return { label: '使用全局配置', isCustom: false }
  }, [dun?.llmBinding, providers])

  const canExecute = boundSkills.length > 0 || !!dun?.sopContent

  useEffect(() => {
    if (!dun?.id || !dunPanelOpen) return
    const serverUrl = localStorage.getItem('duncrew_server_url') || getServerUrl()
    fetch(`${serverUrl}/duns/${dun.id}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.recentExperiences) setExperiences(data.recentExperiences)
      })
      .catch(() => {})
  }, [dun?.id, dunPanelOpen])

  useEffect(() => {
    if (!dun?.id || !dunPanelOpen) {
      setScoring(null)
      return
    }
    const cached = dunScoringService.getScoring(dun.id)
    if (cached) {
      setScoring(cached)
      return
    }
    const serverUrl = localStorage.getItem('duncrew_server_url') || getServerUrl()
    dunScoringService.loadFromServer(dun.id, serverUrl)
      .then(loaded => setScoring(loaded || dunScoringService.getOrCreate(dun.id)))
      .catch(() => setScoring(dunScoringService.getOrCreate(dun.id)))
  }, [dun?.id, dunPanelOpen])

  useEffect(() => {
    if (!dun?.id) return
    return agentEventBus.subscribe((event) => {
      if (event.type !== 'run_end') return
      const updated = dunScoringService.getScoring(dun.id)
      if (updated) setScoring({ ...updated })
    })
  }, [dun?.id])

  useEffect(() => {
    if (!dunPanelOpen) {
      setDetailView(null)
      setIsEditingName(false)
      setEditNameValue('')
      return
    }

    if (selectedDunForPanel && pendingDunChatInput) {
      getOrCreateDunConversation(selectedDunForPanel)
      setChatOpen(true)
      clearPendingInput()
    }
  }, [clearPendingInput, dunPanelOpen, getOrCreateDunConversation, pendingDunChatInput, selectedDunForPanel, setChatOpen])

  useEffect(() => {
    if (!dun) return
    if (dun.llmBinding) {
      setBindingProviderId(dun.llmBinding.providerId)
      setBindingModelId(dun.llmBinding.modelId)
      setBindingTemperature(dun.llmBinding.temperature ?? 0.7)
      setUseCustomTemp(dun.llmBinding.temperature != null)
      return
    }
    setBindingProviderId('')
    setBindingModelId('')
    setBindingTemperature(0.7)
    setUseCustomTemp(false)
  }, [dun?.id, dun?.llmBinding, dunPanelOpen])

  useEffect(() => {
    if (!dunPanelOpen) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (detailView) {
        setDetailView(null)
        return
      }
      closeDunPanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeDunPanel, detailView, dunPanelOpen])

  if (!dun) return null

  const archConfig = getDynamicConfig(dun)
  const hue = archConfig.hue
  const dynamicColor = `hsl(${hue}, 80%, 42%)`
  const dynamicBg = { backgroundColor: `hsla(${hue}, 75%, 50%, 0.12)` }
  const dynamicBorder = { borderColor: `hsla(${hue}, 70%, 45%, 0.28)` }
  const dynamicText = { color: dynamicColor }
  const scoreTier = scoring ? getScoreTier(scoring.score) : 'Learning'
  const tierColor = SCORE_TIER_COLORS[scoreTier]
  const toolDims = scoring?.dimensions ? Object.values(scoring.dimensions) : []
  const recentRuns = scoring?.recentRuns || []
  const species = (dun.species as AnimalSpecies | undefined) || getDefaultSpecies(dun.id)
  const stage: GrowthStage = scoring ? getGrowthStage(scoring.score, scoring.totalRuns) : 'egg'
  const emoji = getDunEmoji(species, scoring ?? undefined)
  const emotion = scoring ? getEmotionState(scoring.streak) : 'neutral'

  const openDetail = (view: DetailView) => {
    setDetailView(view)
  }

  const handleSaveName = async () => {
    setIsEditingName(false)
    const trimmedName = editNameValue.trim()
    if (!trimmedName || trimmedName === dun.label) return

    try {
      const serverUrl = localStorage.getItem('duncrew_server_url') || getServerUrl()
      const res = await fetch(`${serverUrl}/duns/${dun.id}/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      })
      if (res.ok) {
        removeDun(dun.id)
        addDun({ ...dun, label: trimmedName })
      }
    } catch (error) {
      console.error('Failed to update dun name', error)
    }
  }

  const handleSaveBinding = async () => {
    if (!bindingProviderId || !bindingModelId) {
      await saveDunLLMBinding(dun.id, null)
      addToast({ type: 'success', title: '已切换为全局配置' })
    } else {
      const binding: DunLLMBinding = {
        providerId: bindingProviderId,
        modelId: bindingModelId,
        ...(useCustomTemp ? { temperature: bindingTemperature } : {}),
      }
      await saveDunLLMBinding(dun.id, binding)
      addToast({ type: 'success', title: '模型绑定已保存' })
    }
    setShowModelConfig(false)
  }

  const handleClearBinding = async () => {
    await saveDunLLMBinding(dun.id, null)
    setBindingProviderId('')
    setBindingModelId('')
    setBindingTemperature(0.7)
    setUseCustomTemp(false)
    setShowModelConfig(false)
    addToast({ type: 'success', title: '已清除模型绑定' })
  }

  const handleExecute = () => {
    createNewDunConversation(dun.id)
    setChatOpen(true)
  }

  const handleDeactivate = () => {
    setActiveDun(null)
  }

  const handleDelete = () => {
    if (!confirm('确定要删除此 Dun 吗？此操作不可撤销。')) return
    removeDun(dun.id)
    closeDunPanel()
  }

  const handleExportDun = () => {
    const exportData = {
      exportVersion: 1,
      id: dun.id,
      label: dun.label,
      scoring: dun.scoring,
      visualDNA: dun.visualDNA,
      position: dun.position,
      boundSkillIds: dun.boundSkillIds,
      flavorText: dun.flavorText,
      sopContent: dun.sopContent,
      triggers: dun.triggers,
      version: dun.version,
      objective: dun.objective,
      metrics: dun.metrics,
      strategy: dun.strategy,
      customModel: dun.customModel,
      llmBinding: dun.llmBinding,
      createdAt: dun.createdAt,
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(dun.label || dun.id).replace(/[^a-zA-Z0-9\u4e00-\u9fff-_]/g, '_')}.dun.json`
    a.click()
    URL.revokeObjectURL(url)
    addToast({ type: 'success', title: 'Dun 配置已导出' })
  }

  const handleImportDun = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        if (!data.label && !data.id) {
          addToast({ type: 'error', title: '无效的 Dun 配置文件' })
          return
        }
        const newId = `imported-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        addDun({
          ...data,
          id: newId,
          position: { gridX: Math.floor(Math.random() * 6) - 3, gridY: Math.floor(Math.random() * 6) - 3 },
          constructionProgress: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: `imported:${file.name}`,
        })
        addToast({ type: 'success', title: `已导入 Dun: ${data.label || data.id}` })
      } catch {
        addToast({ type: 'error', title: '文件解析失败，请检查 JSON 格式' })
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  const handleBindSkill = (skillName: string) => {
    const existing = dun.boundSkillIds || []
    if (existing.includes(skillName)) return
    removeDun(dun.id)
    addDun({ ...dun, boundSkillIds: [...existing, skillName] })
    addToast({ type: 'success', title: `已绑定技能: ${skillName}` })
  }

  const handleRemoveSkill = (skillName: string) => {
    const serverUrl = localStorage.getItem('duncrew_server_url') || getServerUrl()
    fetch(`${serverUrl}/duns/${dun.id}/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove', skillId: skillName }),
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const updatedSkills = data?.skillDependencies || (dun.boundSkillIds || []).filter(skill => skill !== skillName)
        removeDun(dun.id)
        addDun({ ...dun, boundSkillIds: updatedSkills })
        addToast({ type: 'success', title: `已移除技能: ${skillName}` })
      })
      .catch(() => addToast({ type: 'error', title: `移除失败: ${skillName}` }))
  }

  const handleSearchAndInstallSkill = async (skillName: string) => {
    setInstallingSkillId(skillName)
    try {
      const results = await searchOnlineSkills(skillName)
      if (results.length === 0) {
        addToast({ type: 'warning', title: `未找到 "${skillName}" 的在线技能` })
        return
      }

      const matched = results[0]
      const installResult = await installSkill(matched)
      if (!installResult.success) {
        addToast({ type: 'error', title: `安装失败: ${installResult.message}` })
        return
      }

      await triggerHotReload().catch(() => {})
      let freshSkills: typeof openClawSkills = []
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 300))
        try {
          const serverUrl = localStorage.getItem('duncrew_server_url') || getServerUrl()
          const res = await fetch(`${serverUrl}/skills`)
          if (!res.ok) continue
          freshSkills = await res.json()
          if (freshSkills.some(skill => skill.name?.toLowerCase() === matched.name.toLowerCase())) break
        } catch {
          // retry
        }
      }

      if (freshSkills.length > 0) {
        useStore.getState().setOpenClawSkills(freshSkills)
      }

      const deduped = [...new Set((dun.boundSkillIds || []).map(id => id === skillName ? matched.name : id))]
      removeDun(dun.id)
      addDun({ ...dun, boundSkillIds: deduped })
      addToast({ type: 'success', title: `技能 "${matched.name}" 安装并绑定成功` })
    } catch {
      addToast({ type: 'error', title: '搜索安装失败' })
    } finally {
      setInstallingSkillId(null)
    }
  }

  const renderCareerView = () => {
    if (!growthProfile || !abilitySummary) return null
    return (
      <div className="space-y-6">
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-4xl">
              {emoji}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-mono uppercase text-stone-400">Career Profile</p>
              <h3 className="mt-1 text-xl font-semibold text-stone-900">{growthProfile.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{growthProfile.selfIntro}</p>
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-right">
              <p className="text-xs font-mono text-stone-400">阶段</p>
              <p className="text-sm font-semibold text-stone-800">{growthProfile.stage}</p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-3 gap-3">
          <StatPill label="Runs" value={scoring?.totalRuns ?? 0} />
          <StatPill label="Success" value={scoring ? `${Math.round(scoring.successRate * 100)}%` : '—'} />
          <StatPill label="Trend" value={abilitySummary.recentTrend} />
        </section>

        <section className="space-y-3">
          <SectionHeader icon={Brain} title="能力画像" />
          {growthProfile.strengths.length > 0
            ? <div className="grid gap-3">{growthProfile.strengths.map(claim => <CapabilityCard key={claim.id} claim={claim} />)}</div>
            : <EmptyState icon={Brain} title="暂无能力声明" description="需要更多执行样本和验证证据。" />}
        </section>

        <section className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <SectionHeader icon={CheckCircle2} title="代表作" />
            {growthProfile.highlights.length > 0
              ? growthProfile.highlights.map(item => <CareerItemCard key={item.id} item={item} />)
              : <EmptyState icon={FileText} title="暂无代表作" description="产出文件或成功经验会出现在这里。" />}
          </div>
          <div className="space-y-3">
            <SectionHeader icon={AlertCircle} title="教训本" />
            {growthProfile.lessons.length > 0
              ? growthProfile.lessons.map(item => <CareerItemCard key={item.id} item={item} />)
              : <EmptyState icon={AlertCircle} title="暂无教训" description="失败样本会先作为待复盘记录进入这里。" />}
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeader icon={History} title="成长时间线" />
          <GrowthTimeline events={growthProfile.timeline} />
        </section>
      </div>
    )
  }

  const renderStackView = () => (
    <div className="space-y-5">
      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <SectionHeader
          icon={Cpu}
          title="模型绑定"
          action={(
            <span className={cn(
              'rounded border px-2 py-0.5 text-xs font-mono',
              bindingStatus.isCustom ? 'border-amber-500/30 bg-amber-500/10 text-amber-700' : 'border-stone-200 bg-stone-50 text-stone-500',
            )}>
              {bindingStatus.isCustom ? '独立绑定' : '全局'}
            </span>
          )}
        />
        <p className="mt-2 text-sm text-stone-600">{bindingStatus.label}</p>
        {dun.customModel && !dun.llmBinding && (
          <p className="mt-2 flex items-center gap-1 text-xs text-amber-600">
            <AlertCircle className="h-3.5 w-3.5" />
            当前使用旧版自定义模型配置，建议迁移到新版绑定。
          </p>
        )}

        <button
          onClick={() => setShowModelConfig(!showModelConfig)}
          className="mt-4 flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50"
        >
          {showModelConfig ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          配置模型
        </button>

        <AnimatePresence initial={false}>
          {showModelConfig && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-4 space-y-4 border-t border-stone-200 pt-4">
                <label className="block">
                  <span className="text-xs font-mono uppercase text-stone-400">Provider</span>
                  <select
                    value={bindingProviderId}
                    onChange={event => {
                      setBindingProviderId(event.target.value)
                      setBindingModelId('')
                    }}
                    className="mt-1 w-full rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 outline-none focus:border-cyan-400"
                  >
                    <option value="">使用全局配置</option>
                    {providers.map(provider => (
                      <option key={provider.id} value={provider.id}>{provider.label}</option>
                    ))}
                  </select>
                </label>

                {selectedProvider && (
                  <label className="block">
                    <span className="text-xs font-mono uppercase text-stone-400">Model</span>
                    <select
                      value={bindingModelId}
                      onChange={event => setBindingModelId(event.target.value)}
                      className="mt-1 w-full rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 outline-none focus:border-cyan-400"
                    >
                      <option value="">请选择模型</option>
                      {selectedProvider.models.map(model => (
                        <option key={model.id} value={model.id}>{model.name || model.id}</option>
                      ))}
                    </select>
                  </label>
                )}

                {selectedProvider && bindingModelId && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-mono uppercase text-stone-400">Temperature</span>
                      <button
                        onClick={() => setUseCustomTemp(!useCustomTemp)}
                        className={cn(
                          'rounded border px-2 py-1 text-xs font-mono',
                          useCustomTemp ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700' : 'border-stone-200 text-stone-500',
                        )}
                      >
                        {useCustomTemp ? '自定义' : '使用默认'}
                      </button>
                    </div>
                    {useCustomTemp && (
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={0}
                          max={2}
                          step={0.1}
                          value={bindingTemperature}
                          onChange={event => setBindingTemperature(Number(event.target.value))}
                          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-stone-200"
                        />
                        <span className="w-10 text-right text-sm font-mono text-stone-600">{bindingTemperature.toFixed(1)}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <button onClick={handleSaveBinding} className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-mono text-cyan-700 hover:bg-cyan-500/15">
                    保存
                  </button>
                  {dun.llmBinding && (
                    <button onClick={handleClearBinding} className="rounded-md border border-stone-200 px-4 py-2 text-sm font-mono text-stone-600 hover:bg-stone-50">
                      恢复全局
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <SectionHeader icon={Puzzle} title="Skills" />
          <p className="mt-2 text-2xl font-semibold text-stone-900">{boundSkills.filter(skill => skill.status === 'active').length}/{boundSkills.length}</p>
          <p className="text-xs text-stone-400">active / bound</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <SectionHeader icon={BookOpen} title="SOP" />
          <p className="mt-2 text-2xl font-semibold text-stone-900">{dun.version || '1.0'}</p>
          <p className="text-xs text-stone-400">{dun.metrics?.length ?? 0} metrics</p>
        </div>
      </section>
    </div>
  )

  const renderSkillsView = () => (
    <div className="space-y-5">
      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <SectionHeader
          icon={Puzzle}
          title="绑定技能"
          action={(
            <button
              onClick={() => { setShowSkillPicker(!showSkillPicker); setSkillSearchQuery('') }}
              className="rounded-md border border-stone-200 p-1.5 text-stone-500 hover:bg-stone-50"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        />

        <AnimatePresence>
          {showSkillPicker && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    value={skillSearchQuery}
                    onChange={event => setSkillSearchQuery(event.target.value)}
                    placeholder="搜索可绑定技能"
                    className="w-full rounded-md border border-stone-200 bg-white py-2 pl-9 pr-3 text-sm text-stone-700 outline-none focus:border-cyan-400"
                  />
                </div>
                <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                  {availableSkillsForPicker.map(skill => (
                    <button
                      key={skill.id}
                      onClick={() => handleBindSkill(skill.name)}
                      className="w-full rounded-md border border-stone-200 bg-white p-3 text-left hover:border-cyan-300"
                    >
                      <p className="text-sm font-semibold text-stone-800">{skill.name}</p>
                      {skill.description && <p className="mt-1 line-clamp-2 text-xs text-stone-500">{skill.description}</p>}
                    </button>
                  ))}
                  {availableSkillsForPicker.length === 0 && <p className="py-4 text-center text-xs text-stone-400">没有可绑定的技能</p>}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-4 space-y-2">
          {boundSkills.length > 0 ? boundSkills.map(skill => (
            <div key={skill.id} className="rounded-lg border border-stone-200 bg-white p-3">
              <div className="flex items-start gap-3">
                <div className={cn(
                  'mt-1 h-2.5 w-2.5 rounded-full',
                  skill.status === 'active' ? 'bg-emerald-500' : skill.status === 'unavailable' ? 'bg-amber-500' : 'bg-red-500',
                )} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-stone-800">{skill.name}</p>
                    <span className="rounded bg-stone-100 px-2 py-0.5 text-[11px] font-mono text-stone-500">{skill.status}</span>
                  </div>
                  {skill.description && <p className="mt-1 line-clamp-2 text-xs text-stone-500">{skill.description}</p>}
                  {skill.status !== 'active' && (
                    <button
                      onClick={() => handleSearchAndInstallSkill(skill.name)}
                      disabled={installingSkillId === skill.name}
                      className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 disabled:cursor-wait"
                    >
                      {installingSkillId === skill.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                      搜索并安装
                    </button>
                  )}
                </div>
                <button onClick={() => handleRemoveSkill(skill.name)} className="rounded-md border border-red-500/20 px-2 py-1 text-xs text-red-500 hover:bg-red-50">
                  移除
                </button>
              </div>
            </div>
          )) : <EmptyState icon={Puzzle} title="未绑定技能" description="绑定技能后，这个 Dun 才有可调用的外部能力。" />}
        </div>
      </section>
    </div>
  )

  const renderSopView = () => (
    <div className="space-y-4">
      {dun.sopRewriteInfo && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-800">
            SOP 已于 {new Date(dun.sopRewriteInfo.rewrittenAt).toLocaleDateString()} 自动优化
          </p>
          <p className="mt-1 text-xs text-amber-700">
            基于 {dun.sopRewriteInfo.basedOnExecutions || '?'} 次执行数据，触发级别 {dun.sopRewriteInfo.triggerLevel || 'STANDARD'}。
          </p>
        </div>
      )}
      {dun.sopContent
        ? (
          <div className="rounded-xl border border-stone-200 bg-white p-5">
            <MarkdownRenderer content={dun.sopContent} className="text-sm text-stone-700" />
          </div>
        )
        : <EmptyState icon={BookOpen} title="暂无 SOP" description="此 Dun 尚未定义标准操作流程。" />}
    </div>
  )

  const renderAbilityView = () => {
    if (!abilitySummary) return null
    return (
      <div className="space-y-6">
        <section className="grid grid-cols-4 gap-3">
          <StatPill label="Status" value={abilitySummary.overallStatus} />
          <StatPill label="Trend" value={abilitySummary.recentTrend} />
          <StatPill label="Score" value={scoring?.score ?? 0} />
          <StatPill label="Runs" value={scoring?.totalRuns ?? 0} />
        </section>

        <section className="space-y-3">
          <SectionHeader icon={Brain} title="能力声明" />
          {abilitySummary.strongest.length > 0
            ? abilitySummary.strongest.map(claim => <CapabilityCard key={claim.id} claim={claim} />)
            : <EmptyState icon={Brain} title="暂无能力声明" description="完成任务后会先出现统计推断，再逐步升级为验证证据。" />}
        </section>

        <section className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <SectionHeader icon={ShieldCheck} title="可委托边界" />
            <TrustAdviceList items={abilitySummary.trustAdvice.safeToDelegate} emptyLabel="还没有达到统计显著的强委托建议。" />
          </div>
          <div className="space-y-3">
            <SectionHeader icon={AlertCircle} title="需复核边界" />
            <TrustAdviceList items={abilitySummary.trustAdvice.needsReview} emptyLabel="暂无需复核提示。" />
          </div>
        </section>

        {toolDims.length > 0 && (
          <section className="space-y-3">
            <SectionHeader icon={Puzzle} title="工具维度" />
            <div className="space-y-2">
              {toolDims.sort((a, b) => b.calls - a.calls).map(dim => {
                const successPct = dim.calls > 0 ? Math.round((dim.successes / dim.calls) * 100) : 0
                return (
                  <div key={dim.toolName} className="rounded-lg border border-stone-200 bg-white p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-semibold text-stone-700">{dim.toolName}</span>
                      <span className="font-mono text-sm" style={{ color: tierColor }}>{dim.score}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                      <div className="h-full rounded-full" style={{ width: `${dim.score}%`, backgroundColor: tierColor }} />
                    </div>
                    <div className="mt-2 flex gap-4 text-xs text-stone-400">
                      <span>{dim.calls} calls</span>
                      <span>{successPct}% success</span>
                      <span>{formatDuration(dim.avgDurationMs)} avg</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <AchievementBadges dunId={dun.id} />
      </div>
    )
  }

  const renderRecordsView = () => (
    <div className="space-y-5">
      {activeTask?.taskPlan?.subTasks && (
        <section className="rounded-xl border border-cyan-500/20 bg-cyan-50 p-5">
          <SectionHeader icon={Activity} title="当前执行" />
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full bg-cyan-500"
              style={{ width: `${executionState.progressPercent ?? activeTask.taskPlan.progress ?? 0}%` }}
            />
          </div>
          <button
            onClick={() => setShowTaskDetail(!showTaskDetail)}
            className="mt-3 flex items-center gap-2 text-sm text-cyan-700"
          >
            {showTaskDetail ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {executionState.progressLabel || `${activeTask.taskPlan.progress}%`}
          </button>
          {showTaskDetail && (
            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
              {activeTask.taskPlan.subTasks.map(subTask => (
                <div key={subTask.id} className="rounded-lg border border-cyan-100 bg-white p-2">
                  <p className="text-sm text-stone-700">{subTask.description}</p>
                  <p className="mt-1 text-xs font-mono text-stone-400">{subTask.status}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {recentRuns.length > 0 && (
        <section className="space-y-3">
          <SectionHeader icon={Activity} title="最近 runs" />
          <div className="space-y-2">
            {[...recentRuns].reverse().map((run, index) => (
              <div key={`${run.runId}-${index}`} className={cn(
                'rounded-lg border p-3',
                run.success ? 'border-emerald-500/20 bg-emerald-50' : 'border-red-500/20 bg-red-50',
              )}>
                <div className="flex items-start gap-2">
                  {run.success ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 text-red-600" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-stone-800">{run.task}</p>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs font-mono text-stone-500">
                      <span>{run.scoreChange > 0 ? '+' : ''}{run.scoreChange}</span>
                      <span>{run.turns} turns</span>
                      <span>{formatDuration(run.durationMs)}</span>
                      <span>{formatTime(run.timestamp)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {experiences.length > 0 && (
        <section className="space-y-3">
          <SectionHeader icon={History} title="Experience Log" />
          {experiences.map((exp, index) => (
            <div key={`${exp.title}-${index}`} className="rounded-lg border border-stone-200 bg-white p-3">
              <div className="flex items-start gap-2">
                {exp.outcome === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 text-red-500" />}
                <div>
                  <p className="text-sm font-semibold text-stone-800">{exp.title}</p>
                  <p className="mt-1 text-xs text-stone-500">{exp.content}</p>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {dunConversations.length > 0 && (
        <section className="space-y-3">
          <SectionHeader icon={MessageSquare} title="对话记录" />
          {dunConversations.map(conversation => (
            <button
              key={conversation.id}
              onClick={() => {
                switchConversation(conversation.id)
                setChatOpen(true)
              }}
              className="flex w-full items-center gap-3 rounded-lg border border-stone-200 bg-white p-3 text-left hover:bg-stone-50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-stone-800">{conversation.title}</p>
                <p className="mt-1 text-xs text-stone-400">{conversation.messages.length} 条消息 · {formatTime(conversation.updatedAt)}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-stone-400" />
            </button>
          ))}
        </section>
      )}
    </div>
  )

  const renderArtifactsView = () => (
    <div className="space-y-3">
      {artifacts.length > 0
        ? artifacts.map((artifact, index) => (
          <FileCard
            key={`${artifact.path}-${index}`}
            filePath={artifact.path}
            fileName={artifact.name}
            fileSize={artifact.size}
          />
        ))
        : <EmptyState icon={FileText} title="暂无产出文件" description="Dun 执行任务产生的文件会自动显示在这里。" />}
    </div>
  )

  const renderDetailContent = () => {
    switch (detailView) {
      case 'career':
        return renderCareerView()
      case 'stack':
        return renderStackView()
      case 'ability':
        return renderAbilityView()
      case 'sop':
        return renderSopView()
      case 'skills':
        return renderSkillsView()
      case 'records':
        return renderRecordsView()
      case 'artifacts':
        return renderArtifactsView()
      case 'knowledge':
        return <DunKnowledgeTab dunId={dun.id} />
      default:
        return null
    }
  }

  const statusLabel = executionState.state === 'idle'
    ? '空闲'
    : executionState.state === 'waiting_user'
      ? '等待确认'
      : executionState.state === 'error'
        ? '异常'
        : executionState.state === 'paused'
          ? '已暂停'
          : '执行中'

  return (
    <>
      <AnimatePresence>
        {dunPanelOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeDunPanel}
              className="fixed inset-0 z-40 bg-stone-900/10"
            />

            <AnimatePresence>
              {detailView && (
                <DetailShell
                  activeView={detailView}
                  onSelectView={setDetailView}
                  onClose={() => setDetailView(null)}
                >
                  {renderDetailContent()}
                </DetailShell>
              )}
            </AnimatePresence>

            <div ref={constraintsRef} className="pointer-events-none fixed inset-0 z-[59]" />

            <motion.div
              initial={{ opacity: 0, x: 440 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 440 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              drag
              dragListener={false}
              dragControls={dragControls}
              dragConstraints={constraintsRef}
              dragElastic={0.05}
              dragMomentum={false}
              className="pointer-events-auto fixed bottom-4 right-4 top-4 z-[60] flex w-[420px] flex-col overflow-hidden rounded-xl border border-stone-200 bg-white/95 shadow-2xl backdrop-blur-xl"
            >
              <header
                className="cursor-grab border-b border-stone-200 bg-stone-50 px-5 py-4 active:cursor-grabbing"
                onPointerDown={(event) => dragControls.start(event)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <GripVertical className="h-4 w-4 shrink-0 text-stone-300" />
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border text-2xl" style={{ ...dynamicBg, ...dynamicBorder }}>
                      {emoji}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 group">
                        {isEditingName ? (
                          <input
                            autoFocus
                            value={editNameValue}
                            onChange={event => setEditNameValue(event.target.value)}
                            onKeyDown={event => event.key === 'Enter' && handleSaveName()}
                            onBlur={handleSaveName}
                            className="w-52 rounded-md border border-stone-200 bg-white px-2 py-1 text-sm font-semibold text-stone-800 outline-none"
                          />
                        ) : (
                          <>
                            <h2 className="truncate text-base font-semibold text-stone-900">{dun.label || `Dun-${dun.id.slice(-6)}`}</h2>
                            <button
                              onClick={() => { setIsEditingName(true); setEditNameValue(dun.label || dun.id) }}
                              className="rounded p-1 text-stone-300 opacity-0 transition-opacity hover:bg-stone-100 hover:text-stone-700 group-hover:opacity-100"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-stone-500">
                        {STAGE_LABELS[stage]} · {EMOTION_LABELS[emotion]} · <span style={dynamicText}>{TIER_LABELS[scoreTier] || scoreTier}</span>
                      </p>
                    </div>
                  </div>
                  <button onClick={closeDunPanel} className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {isBuilding ? (
                  <div className="flex h-full flex-col items-center justify-center gap-5 py-16 text-center">
                    <div className="relative h-28 w-28">
                      <motion.div
                        className="absolute inset-0 rounded-full border-2 border-dashed"
                        style={dynamicBorder}
                        animate={{ rotate: 360 }}
                        transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                      />
                      <motion.div
                        className="absolute inset-4 rounded-full"
                        style={dynamicBg}
                        animate={{ scale: [1, 1.1, 1], opacity: [0.35, 0.65, 0.35] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                      <div className="absolute inset-8 flex items-center justify-center rounded-full" style={dynamicBg}>
                        <Zap className="h-6 w-6" style={dynamicText} />
                      </div>
                    </div>
                    <div>
                      <p className="text-lg font-semibold" style={dynamicText}>正在建造 Dun</p>
                      <p className="mt-1 text-sm text-stone-500">初始化工作栈与身份资料</p>
                    </div>
                    <div className="w-56">
                      <div className="mb-1 flex justify-between text-xs font-mono text-stone-400">
                        <span>Progress</span>
                        <span>{Math.round(buildProgress * 100)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${buildProgress * 100}%` }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: dynamicColor }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-stone-400">
                        约 {Math.max(0, Math.ceil((1 - buildProgress) * CONSTRUCTION_DURATION_MS / 1000))} 秒后完成
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <section className="rounded-lg border border-stone-200 bg-white p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-mono uppercase text-stone-400">当前目标</p>
                          <p className="mt-1 line-clamp-2 text-sm font-semibold text-stone-800">
                            {executionState.goalLabel || dun.objective || '暂无活跃目标'}
                          </p>
                        </div>
                        <span className={cn(
                          'rounded px-2 py-1 text-xs font-mono',
                          executionState.state === 'running'
                            ? 'bg-cyan-500/10 text-cyan-700'
                            : executionState.state === 'error'
                              ? 'bg-red-500/10 text-red-700'
                              : 'bg-stone-100 text-stone-500',
                        )}>
                          {statusLabel}
                        </span>
                      </div>
                      {executionState.currentStep && (
                        <p className="mt-2 text-xs text-stone-500">{executionState.currentStep}</p>
                      )}
                    </section>

                    <section className="rounded-lg border border-stone-200 bg-white p-4">
                      <SectionHeader icon={Layers3} title="模型 / skills / SOP" />
                      <div className="mt-3 space-y-2">
                        <button
                          onClick={() => { openDetail('stack'); setShowModelConfig(true) }}
                          className="flex w-full items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-left hover:bg-white"
                        >
                          <Cpu className="h-4 w-4 text-stone-500" />
                          <span className="min-w-0 flex-1 truncate text-sm text-stone-700">{bindingStatus.label}</span>
                          <ChevronRight className="h-4 w-4 text-stone-400" />
                        </button>
                        <button
                          onClick={() => openDetail('skills')}
                          className="flex w-full items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-left hover:bg-white"
                        >
                          <Puzzle className="h-4 w-4 text-stone-500" />
                          <span className="min-w-0 flex-1 text-sm text-stone-700">
                            已绑 {boundSkills.length} skills · {boundSkills.filter(skill => skill.status === 'active').length} active
                          </span>
                          <ChevronRight className="h-4 w-4 text-stone-400" />
                        </button>
                        <button
                          onClick={() => openDetail('sop')}
                          className="flex w-full items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-left hover:bg-white"
                        >
                          <BookOpen className="h-4 w-4 text-stone-500" />
                          <span className="min-w-0 flex-1 truncate text-sm text-stone-700">
                            SOP {dun.version || '1.0'} · {dun.metrics?.length ?? 0} metrics
                          </span>
                          <ChevronRight className="h-4 w-4 text-stone-400" />
                        </button>
                      </div>
                    </section>

                    <button
                      onClick={handleExecute}
                      disabled={!canExecute}
                      className={cn(
                        'flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold transition-all',
                        canExecute ? 'hover:brightness-105 active:scale-[0.99]' : 'cursor-not-allowed border-stone-200 bg-stone-50 text-stone-300',
                      )}
                      style={canExecute ? { ...dynamicBg, ...dynamicBorder, ...dynamicText } : undefined}
                    >
                      <Play className="h-4 w-4" />
                      {canExecute ? 'Execute' : '需要 SOP 或 skill'}
                    </button>

                    {activeDunId === dun.id && (
                      <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-50 px-3 py-2">
                        <span className="flex items-center gap-2 text-sm text-emerald-700">
                          <Zap className="h-4 w-4" />
                          Active Dun
                        </span>
                        <button onClick={handleDeactivate} className="text-xs font-mono text-emerald-700 hover:underline">Deactivate</button>
                      </div>
                    )}

                    <section className="rounded-lg border border-stone-200 bg-white p-4">
                      <SectionHeader
                        icon={Brain}
                        title="能力摘要"
                        action={<button onClick={() => openDetail('ability')} className="text-xs font-mono text-stone-500 hover:text-stone-800">展开</button>}
                      />
                      <div className="mt-3 space-y-2">
                        {abilitySummary?.strongest.slice(0, 2).map(claim => (
                          <CapabilityCard key={claim.id} claim={claim} compact />
                        ))}
                        {(!abilitySummary || abilitySummary.strongest.length === 0) && (
                          <p className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-400">暂无能力声明。</p>
                        )}
                      </div>
                    </section>

                    <section className="grid grid-cols-2 gap-3">
                      <button onClick={() => openDetail('records')} className="rounded-lg border border-stone-200 bg-white p-3 text-left hover:bg-stone-50">
                        <Activity className="h-4 w-4 text-stone-500" />
                        <p className="mt-2 text-sm font-semibold text-stone-800">记录</p>
                        <p className="text-xs text-stone-400">{recentRuns.length} runs · {experiences.length} exp</p>
                      </button>
                      <button onClick={() => openDetail('artifacts')} className="rounded-lg border border-stone-200 bg-white p-3 text-left hover:bg-stone-50">
                        <FileText className="h-4 w-4 text-stone-500" />
                        <p className="mt-2 text-sm font-semibold text-stone-800">产出</p>
                        <p className="text-xs text-stone-400">{artifacts.length} files</p>
                      </button>
                    </section>

                    <button
                      onClick={() => openDetail('career')}
                      className="w-full rounded-lg border border-stone-200 bg-white p-4 text-left hover:bg-stone-50"
                    >
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4" style={dynamicText} />
                        <span className="text-sm font-semibold text-stone-800">成长档案</span>
                        <ChevronRight className="ml-auto h-4 w-4 text-stone-400" />
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-stone-500">
                        {growthProfile?.selfIntro || '完成更多任务后，这里会形成履历、代表作和教训本。'}
                      </p>
                    </button>

                    <button
                      onClick={() => openDetail('knowledge')}
                      className="flex w-full items-center gap-2 rounded-lg border border-stone-200 bg-white px-4 py-3 text-left hover:bg-stone-50"
                    >
                      <BookOpen className="h-4 w-4 text-stone-500" />
                      <span className="text-sm font-semibold text-stone-800">知识库</span>
                      <ChevronRight className="ml-auto h-4 w-4 text-stone-400" />
                    </button>
                  </div>
                )}
              </div>

              <footer className="border-t border-stone-200 bg-stone-50 p-4">
                <div className="flex gap-2">
                  <button
                    onClick={handleExportDun}
                    className="flex flex-1 items-center justify-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-2 text-xs font-mono text-stone-600 hover:bg-stone-100"
                  >
                    <Download className="h-3.5 w-3.5" />
                    导出
                  </button>
                  <button
                    onClick={() => importFileRef.current?.click()}
                    className="flex flex-1 items-center justify-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-2 text-xs font-mono text-stone-600 hover:bg-stone-100"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    导入
                  </button>
                  <button
                    onClick={handleDelete}
                    className="flex items-center justify-center rounded-md border border-red-500/20 bg-white px-3 py-2 text-xs font-mono text-red-500 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <input
                    ref={importFileRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportDun}
                    className="hidden"
                  />
                </div>
              </footer>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
