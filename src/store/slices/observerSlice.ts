import type { StateCreator } from 'zustand'
import type { 
  BehaviorRecord, 
  TriggerPattern, 
  BuildProposal, 
  NexusArchetype,
  VisualDNA 
} from '@/types'

// ============================================
// 常量配置
// ============================================

const BEHAVIOR_WINDOW_SIZE = 50        // 保留最近 N 条行为记录
const FREQUENCY_THRESHOLD = 3          // 频率触发阈值（7天内出现次数）
const CONFIDENCE_THRESHOLD = 0.6       // 触发置信度阈值
const ANALYSIS_COOLDOWN_MS = 30000     // 分析冷却时间（避免频繁触发）

// 触发类型 → 推荐 Archetype 映射
const TRIGGER_ARCHETYPE_MAP: Record<TriggerPattern['type'], NexusArchetype> = {
  frequency: 'VAULT',      // 频繁访问 → 记忆/存储类
  complexity: 'SPIRE',     // 复杂流程 → 推理/流程类
  dependency: 'REACTOR',   // 环境依赖 → 执行/集成类
  periodic: 'MONOLITH',    // 周期性 → 知识/定时类
}

// ============================================
// Slice 类型定义
// ============================================

export interface ObserverSlice {
  // State
  behaviorRecords: BehaviorRecord[]
  currentProposal: BuildProposal | null
  lastAnalysisTime: number
  nexusPanelOpen: boolean
  selectedNexusForPanel: string | null

  // Actions
  addBehaviorRecord: (record: Omit<BehaviorRecord, 'id' | 'timestamp'>) => void
  analyze: () => TriggerPattern | null
  createProposal: (trigger: TriggerPattern) => void
  acceptProposal: () => BuildProposal | null
  rejectProposal: () => void
  clearProposal: () => void
  
  // Panel Actions
  openNexusPanel: (nexusId: string) => void
  closeNexusPanel: () => void
}

// ============================================
// 辅助函数
// ============================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// 简易关键词提取
function extractKeywords(content: string): string[] {
  // 移除标点，转小写，分词
  const words = content
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)
  
  // 过滤常见停用词
  const stopWords = new Set([
    '的', '是', '在', '了', '和', '与', '或', '这', '那', '有', '我', '你', '他',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'this', 'that', 'what', 'which',
    '帮', '请', '能', '可以', '怎么', '如何',
  ])
  
  return [...new Set(words.filter(w => !stopWords.has(w)))].slice(0, 10)
}

// 简易 VisualDNA 生成（基于字符串哈希）
function generateVisualDNA(id: string, archetype: NexusArchetype): VisualDNA {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  }
  const h = Math.abs(hash)
  
  return {
    primaryHue: h % 360,
    primarySaturation: 50 + (h >> 8) % 40,
    primaryLightness: 35 + (h >> 16) % 30,
    accentHue: (h % 360 + 60) % 360,
    archetype,
    textureMode: 'solid',
    glowIntensity: 0.5 + (h % 50) / 100,
    geometryVariant: h % 4,
  }
}

// ============================================
// 频率检测器
// ============================================

function detectFrequencyPattern(records: BehaviorRecord[]): TriggerPattern | null {
  if (records.length < FREQUENCY_THRESHOLD) return null
  
  // 统计关键词频率
  const keywordCount = new Map<string, number>()
  const now = Date.now()
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
  
  const recentRecords = records.filter(r => r.timestamp > sevenDaysAgo)
  
  for (const record of recentRecords) {
    for (const keyword of record.keywords) {
      keywordCount.set(keyword, (keywordCount.get(keyword) || 0) + 1)
    }
  }
  
  // 找到高频关键词
  let topKeyword = ''
  let topCount = 0
  for (const [keyword, count] of keywordCount) {
    if (count > topCount) {
      topCount = count
      topKeyword = keyword
    }
  }
  
  if (topCount < FREQUENCY_THRESHOLD) return null
  
  // 收集证据
  const evidence = recentRecords
    .filter(r => r.keywords.includes(topKeyword))
    .slice(-3)
    .map(r => r.content.slice(0, 50) + (r.content.length > 50 ? '...' : ''))
  
  const confidence = Math.min(topCount / 10, 1)
  
  return {
    type: 'frequency',
    confidence,
    evidence,
    suggestedArchetype: TRIGGER_ARCHETYPE_MAP.frequency,
    detectedAt: now,
  }
}

// ============================================
// Slice 创建函数
// ============================================

export const createObserverSlice: StateCreator<
  ObserverSlice,
  [],
  [],
  ObserverSlice
> = (set, get) => ({
  // Initial State
  behaviorRecords: [],
  currentProposal: null,
  lastAnalysisTime: 0,
  nexusPanelOpen: false,
  selectedNexusForPanel: null,

  // Actions
  addBehaviorRecord: (record) => {
    const newRecord: BehaviorRecord = {
      ...record,
      id: generateId(),
      timestamp: Date.now(),
      keywords: record.keywords.length > 0 
        ? record.keywords 
        : extractKeywords(record.content),
    }
    
    set((state) => ({
      behaviorRecords: [
        ...state.behaviorRecords.slice(-BEHAVIOR_WINDOW_SIZE + 1),
        newRecord,
      ],
    }))
  },

  analyze: () => {
    const { behaviorRecords, lastAnalysisTime, currentProposal } = get()
    const now = Date.now()
    
    // 冷却检查
    if (now - lastAnalysisTime < ANALYSIS_COOLDOWN_MS) return null
    
    // 如果已有待处理提议，不重复分析
    if (currentProposal && currentProposal.status === 'pending') return null
    
    set({ lastAnalysisTime: now })
    
    // 运行频率检测器（MVP 版本只实现这一个）
    const frequencyTrigger = detectFrequencyPattern(behaviorRecords)
    
    if (frequencyTrigger && frequencyTrigger.confidence >= CONFIDENCE_THRESHOLD) {
      return frequencyTrigger
    }
    
    // TODO: 后续添加其他检测器
    // const complexityTrigger = detectComplexityPattern(...)
    // const dependencyTrigger = detectDependencyPattern(...)
    // const periodicTrigger = detectPeriodicPattern(...)
    
    return null
  },

  createProposal: (trigger) => {
    const proposalId = generateId()
    const archetype = trigger.suggestedArchetype
    
    // 生成建议名称
    const evidence = trigger.evidence[0] || ''
    const suggestedName = evidence.length > 20 
      ? evidence.slice(0, 20) + ' Tower'
      : evidence + ' Nexus'
    
    const proposal: BuildProposal = {
      id: proposalId,
      triggerPattern: trigger,
      suggestedName,
      suggestedArchetype: archetype,
      previewVisualDNA: generateVisualDNA(proposalId, archetype),
      status: 'pending',
      createdAt: Date.now(),
    }
    
    set({ currentProposal: proposal })
  },

  acceptProposal: () => {
    const { currentProposal } = get()
    if (!currentProposal || currentProposal.status !== 'pending') return null
    
    const accepted: BuildProposal = {
      ...currentProposal,
      status: 'accepted',
    }
    
    set({ currentProposal: accepted })
    return accepted
  },

  rejectProposal: () => {
    const { currentProposal } = get()
    if (!currentProposal) return
    
    set({
      currentProposal: {
        ...currentProposal,
        status: 'rejected',
      },
    })
    
    // 延迟清除
    setTimeout(() => {
      set({ currentProposal: null })
    }, 500)
  },

  clearProposal: () => {
    set({ currentProposal: null })
  },

  // Panel Actions
  openNexusPanel: (nexusId) => {
    set({
      nexusPanelOpen: true,
      selectedNexusForPanel: nexusId,
    })
  },

  closeNexusPanel: () => {
    set({
      nexusPanelOpen: false,
      selectedNexusForPanel: null,
    })
  },
})
