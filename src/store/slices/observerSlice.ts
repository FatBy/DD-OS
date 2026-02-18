import type { StateCreator } from 'zustand'
import type { 
  BehaviorRecord, 
  TriggerPattern, 
  BuildProposal, 
  NexusArchetype,
  VisualDNA 
} from '@/types'
import { chat, getLLMConfig } from '@/services/llmService'

// ============================================
// 常量配置
// ============================================

const BEHAVIOR_WINDOW_SIZE = 50        // 保留最近 N 条行为记录
const ANALYSIS_TRIGGER_COUNT = 5       // 积累多少条记录触发一次深度分析
const ANALYSIS_COOLDOWN_MS = 60000     // 分析冷却 (1分钟)，避免过于频繁消耗 Token
const CONFIDENCE_THRESHOLD = 0.6       // 触发置信度阈值

// ============================================
// Slice 类型定义
// ============================================

export interface ObserverSlice {
  // State
  behaviorRecords: BehaviorRecord[]
  currentProposal: BuildProposal | null
  lastAnalysisTime: number
  isAnalyzing: boolean
  nexusPanelOpen: boolean
  selectedNexusForPanel: string | null

  // Actions
  addBehaviorRecord: (record: Omit<BehaviorRecord, 'id' | 'timestamp' | 'keywords'>) => void
  analyze: () => Promise<TriggerPattern | null>
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
// LLM 模式分析提示词
// ============================================

const ANALYST_SYSTEM_PROMPT = `你是 DD-OS 系统的"观察者"。你的任务是分析用户的近期操作记录，判断是否"涌现"出了某种固定的行为模式或需求。

判定标准：
1. **频率性 (frequency)**：用户是否在反复尝试解决同一类问题？
2. **复杂性 (complexity)**：用户是否在执行一系列复杂的、关联的指令？
3. **工具依赖 (dependency)**：用户是否频繁使用某类特定的工具（如代码搜索、文件操作）？
4. **周期性 (periodic)**：用户是否有某种周期性的行为模式？

如果发现模式，返回 JSON：
{
  "detected": true,
  "type": "frequency" | "complexity" | "dependency" | "periodic",
  "archetype": "VAULT" | "SPIRE" | "REACTOR" | "MONOLITH",
  "summary": "简短描述这个模式（10-20字）",
  "reasoning": "为什么你认为这是一个需要固化的模式",
  "confidence": 0.1 ~ 1.0
}

如果没有明显模式，返回：{"detected": false}

Archetype 指南：
- VAULT (存储/记忆): 频繁查询、回顾、存储数据
- SPIRE (推理/流程): 复杂的逻辑分析、代码编写、Debug
- REACTOR (执行/工具): 频繁调用外部工具、API、文件操作
- MONOLITH (知识/概念): 针对特定领域的深度探索

只输出 JSON，不要有其他文字。`

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
  isAnalyzing: false,
  nexusPanelOpen: false,
  selectedNexusForPanel: null,

  // Actions
  addBehaviorRecord: (record) => {
    const newRecord: BehaviorRecord = {
      ...record,
      id: generateId(),
      timestamp: Date.now(),
      keywords: [], // 不再使用正则提取，由 LLM 分析
    }
    
    set((state) => {
      const updatedRecords = [
        ...state.behaviorRecords.slice(-BEHAVIOR_WINDOW_SIZE + 1),
        newRecord,
      ]

      // 自动触发检查
      const shouldTriggerAnalysis = 
        updatedRecords.length >= ANALYSIS_TRIGGER_COUNT &&
        (Date.now() - state.lastAnalysisTime > ANALYSIS_COOLDOWN_MS) &&
        !state.isAnalyzing &&
        !state.currentProposal

      // 异步触发分析（不阻塞 UI）
      if (shouldTriggerAnalysis) {
        setTimeout(() => get().analyze(), 0)
      }

      return { behaviorRecords: updatedRecords }
    })
  },

  analyze: async () => {
    const { behaviorRecords, isAnalyzing, currentProposal } = get()
    const config = getLLMConfig()
    
    // 卫语句
    if (isAnalyzing) return null
    if (!config.apiKey) {
      console.log('[Observer] No LLM API key configured, skipping analysis')
      return null
    }
    if (behaviorRecords.length < 3) return null
    if (currentProposal?.status === 'pending') return null
    
    set({ isAnalyzing: true, lastAnalysisTime: Date.now() })
    console.log('[Observer] Starting LLM-powered behavior analysis...')

    try {
      // 准备最近 N 条记录
      const recentLogs = behaviorRecords.slice(-10).map(r => {
        const time = new Date(r.timestamp).toLocaleTimeString('zh-CN')
        return `[${time}] ${r.type}: ${r.content.slice(0, 100)}`
      }).join('\n')

      // 调用 LLM 分析
      const response = await chat(
        [
          { role: 'system', content: ANALYST_SYSTEM_PROMPT },
          { role: 'user', content: `最近的用户行为记录：\n${recentLogs}` }
        ],
        { temperature: 0.3 } as any // 低温获得稳定输出
      )

      // 解析 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        console.warn('[Observer] Invalid JSON response:', response)
        return null
      }
      
      const result = JSON.parse(jsonMatch[0])
      console.log('[Observer] Analysis result:', result)

      if (result.detected && result.confidence >= CONFIDENCE_THRESHOLD) {
        const trigger: TriggerPattern = {
          type: result.type,
          confidence: result.confidence,
          evidence: [result.summary, result.reasoning],
          suggestedArchetype: result.archetype,
          detectedAt: Date.now()
        }
        
        console.log('[Observer] Pattern detected! Creating proposal...')
        get().createProposal(trigger)
        return trigger
      }

      console.log('[Observer] No significant pattern detected')
      return null

    } catch (error) {
      console.warn('[Observer] Analysis failed:', error)
      return null
    } finally {
      set({ isAnalyzing: false })
    }
  },

  createProposal: (trigger) => {
    const proposalId = generateId()
    const archetype = trigger.suggestedArchetype
    
    // 使用 LLM 分析结果中的 summary 作为名称
    const summary = trigger.evidence[0] || ''
    const suggestedName = summary.length > 15 
      ? summary.slice(0, 15) + '...'
      : summary || 'New Nexus'
    
    const proposal: BuildProposal = {
      id: proposalId,
      triggerPattern: trigger,
      suggestedName,
      suggestedArchetype: archetype,
      previewVisualDNA: generateVisualDNA(proposalId, archetype),
      status: 'pending',
      createdAt: Date.now(),
    }
    
    console.log('[Observer] Proposal created:', proposal)
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
