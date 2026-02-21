import type { StateCreator } from 'zustand'
import type { 
  BehaviorRecord, 
  TriggerPattern, 
  BuildProposal, 
  NexusArchetype,
  VisualDNA,
  ExecTrace
} from '@/types'
import { chat, getLLMConfig } from '@/services/llmService'

// ============================================
// 常量配置 - 双引擎阈值
// ============================================

const BEHAVIOR_WINDOW_SIZE = 50        // 保留最近 N 条行为记录
const ANALYSIS_COOLDOWN_MS = 30000     // 分析冷却 (30秒)
const CONFIDENCE_THRESHOLD = 0.6       // 触发置信度阈值

// 规则引擎阈值
const RULE_ENGINE = {
  FREQUENCY_THRESHOLD: 5,         // 同一工具调用 5+ 次触发
  FREQUENCY_DAYS: 3,              // 在 3 天内
  COMPLEXITY_TURNS: 10,           // 单次执行超过 10 轮视为复杂
  DEPENDENCY_MIN_OCCURRENCES: 3,  // 工具链出现 3+ 次
  MIN_TRACES_FOR_ANALYSIS: 5,     // 至少 5 条执行记录才分析
}

// 后端 API
const SERVER_URL = 'http://localhost:3001'

// ============================================
// Slice 类型定义
// ============================================

interface TraceStats {
  totalExecutions: number
  toolFrequency: Record<string, number>
  nexusFrequency: Record<string, number>
  avgTurnsPerExecution: number
  totalErrors: number
  timeRangeDays: number
}

export interface ObserverSlice {
  // State
  behaviorRecords: BehaviorRecord[]
  currentProposal: BuildProposal | null
  lastAnalysisTime: number
  isAnalyzing: boolean
  nexusPanelOpen: boolean
  selectedNexusForPanel: string | null
  // 双引擎状态
  lastRuleCheckTime: number
  cachedTraces: ExecTrace[]
  cachedStats: TraceStats | null

  // Actions
  addBehaviorRecord: (record: Omit<BehaviorRecord, 'id' | 'timestamp' | 'keywords'>) => void
  analyze: () => Promise<TriggerPattern | null>
  analyzeWithRuleEngine: () => Promise<TriggerPattern | null>
  analyzeWithLLM: (traces: ExecTrace[], stats: TraceStats) => Promise<TriggerPattern | null>
  fetchRecentTraces: () => Promise<{ traces: ExecTrace[]; stats: TraceStats } | null>
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

/**
 * 提取工具调用序列作为"管道签名"
 */
function extractToolPipeline(trace: ExecTrace): string {
  return trace.tools.map(t => t.name).join('→')
}

/**
 * 根据工具类型推断 Archetype
 */
function inferArchetypeFromTools(topTools: string[]): NexusArchetype {
  const toolCategories: Record<string, NexusArchetype> = {
    // REACTOR: 执行/工具型
    runCmd: 'REACTOR',
    writeFile: 'REACTOR',
    appendFile: 'REACTOR',
    deleteFile: 'REACTOR',
    installPackage: 'REACTOR',
    // SPIRE: 推理/分析型
    readFile: 'SPIRE',
    searchCode: 'SPIRE',
    codeAnalysis: 'SPIRE',
    // VAULT: 存储/记忆型
    saveMemory: 'VAULT',
    searchMemory: 'VAULT',
    listFiles: 'VAULT',
    // MONOLITH: 知识/搜索型
    webSearch: 'MONOLITH',
    webFetch: 'MONOLITH',
  }
  
  const archetypeCounts: Record<NexusArchetype, number> = {
    REACTOR: 0, SPIRE: 0, VAULT: 0, MONOLITH: 0
  }
  
  for (const tool of topTools) {
    const archetype = toolCategories[tool]
    if (archetype) {
      archetypeCounts[archetype]++
    }
  }
  
  // 返回最高频的 archetype
  return Object.entries(archetypeCounts)
    .sort(([, a], [, b]) => b - a)[0][0] as NexusArchetype
}

/**
 * 根据触发类型和证据生成功能目标概述
 */
function generatePurposeSummary(trigger: TriggerPattern, archetype: NexusArchetype): string {
  // LLM 分析的第一条 evidence 通常是 summary，直接使用
  if (trigger.type === 'frequency' || trigger.type === 'complexity' || trigger.type === 'dependency') {
    // 从 evidence 中提取关键工具名
    const toolMatch = trigger.evidence[0]?.match(/工具\s*"?(\w+)"?/)
    const toolName = toolMatch?.[1]

    const archetypePurpose: Record<NexusArchetype, string> = {
      MONOLITH: toolName
        ? `将您频繁使用的 ${toolName} 等信息检索能力整合为专用知识采集节点，减少重复搜索、自动沉淀关键信息。`
        : '将分散的知识获取行为整合为统一的信息中枢，自动积累和结构化您的知识资产。',
      SPIRE: '将反复出现的复杂多步骤推理封装为可复用模板，降低每次执行的规划开销。',
      REACTOR: toolName
        ? `将高频使用的 ${toolName} 等执行工具封装为自动化流程，减少手动操作步骤。`
        : '将重复性执行操作固化为一键自动化流程，提升日常任务处理效率。',
      VAULT: '将频繁访问的数据和记忆整合为快速检索中心，缩短信息查找路径。',
    }
    return archetypePurpose[archetype]
  }

  if (trigger.type === 'periodic') {
    return '将周期性重复任务固化为自动触发的执行节点，实现定时自动化。'
  }

  // fallback: LLM 分析可能在 evidence[0] 有 summary
  const llmSummary = trigger.evidence[0]
  if (llmSummary && !llmSummary.startsWith('建议名称:')) {
    return llmSummary
  }

  return '将检测到的行为模式固化为可复用的执行节点，提升操作效率。'
}

// ============================================
// LLM 模式分析提示词 (语义引擎)
// ============================================

const ANALYST_SYSTEM_PROMPT = `你是 DD-OS 系统的"观察者"。分析用户的执行日志，识别可固化的行为模式。

输入格式：执行统计 + 工具频率 + 执行追踪样本

判定标准：
1. **频率性 (frequency)**：用户反复解决同一类问题
2. **复杂性 (complexity)**：执行复杂的多步骤任务
3. **依赖性 (dependency)**：固定的工具调用链（如: search→read→write）
4. **周期性 (periodic)**：周期性行为模式

如果发现模式，返回 JSON：
{
  "detected": true,
  "type": "frequency" | "complexity" | "dependency" | "periodic",
  "archetype": "VAULT" | "SPIRE" | "REACTOR" | "MONOLITH",
  "summary": "简短描述这个模式（10-20字）",
  "reasoning": "为什么需要固化这个模式",
  "suggestedName": "建议的 Nexus 名称（2-5个中文字，体现功能特点，如'文档助手'、'代码审查'、'日志分析'）",
  "confidence": 0.1 ~ 1.0
}

如果没有明显模式，返回：{"detected": false}

Archetype 指南：
- VAULT (存储/记忆): 数据管理、日志查询
- SPIRE (推理/流程): 代码分析、Debug、逻辑推理
- REACTOR (执行/工具): 文件操作、命令执行、部署
- MONOLITH (知识/概念): 搜索、学习、知识获取

只输出 JSON。`

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
  lastRuleCheckTime: 0,
  cachedTraces: [],
  cachedStats: null,

  // Actions
  addBehaviorRecord: (record) => {
    const newRecord: BehaviorRecord = {
      ...record,
      id: generateId(),
      timestamp: Date.now(),
      keywords: [],
    }
    
    set((state) => {
      const updatedRecords = [
        ...state.behaviorRecords.slice(-BEHAVIOR_WINDOW_SIZE + 1),
        newRecord,
      ]

      // 检查是否应该触发分析
      const shouldTriggerAnalysis = 
        (Date.now() - state.lastAnalysisTime > ANALYSIS_COOLDOWN_MS) &&
        !state.isAnalyzing &&
        !state.currentProposal

      if (shouldTriggerAnalysis) {
        // 异步触发双引擎分析
        setTimeout(() => get().analyze(), 100)
      }

      return { behaviorRecords: updatedRecords }
    })
  },

  /**
   * 从后端获取最近的执行日志
   */
  fetchRecentTraces: async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/traces/recent?days=${RULE_ENGINE.FREQUENCY_DAYS}&limit=100`)
      if (!res.ok) return null
      const data = await res.json()
      return {
        traces: data.traces || [],
        stats: data.stats || {
          totalExecutions: 0,
          toolFrequency: {},
          nexusFrequency: {},
          avgTurnsPerExecution: 0,
          totalErrors: 0,
          timeRangeDays: RULE_ENGINE.FREQUENCY_DAYS,
        }
      }
    } catch (err) {
      console.warn('[Observer] Failed to fetch traces:', err)
      return null
    }
  },

  /**
   * 主分析入口 - 双引擎协同
   */
  analyze: async () => {
    const { isAnalyzing, currentProposal } = get()
    
    if (isAnalyzing) return null
    if (currentProposal?.status === 'pending') return null
    
    set({ isAnalyzing: true, lastAnalysisTime: Date.now() })
    console.log('[Observer] Starting dual-engine analysis...')

    try {
      // Phase 1: 规则引擎 (本地, 不消耗 Token)
      const ruleTrigger = await get().analyzeWithRuleEngine()
      if (ruleTrigger) {
        console.log('[Observer] Rule engine detected pattern:', ruleTrigger.type)
        get().createProposal(ruleTrigger)
        return ruleTrigger
      }

      // Phase 2: LLM 语义引擎 (消耗 Token, 仅在规则引擎无结果时)
      const config = getLLMConfig()
      if (!config.apiKey) {
        console.log('[Observer] No LLM API key, skipping semantic analysis')
        return null
      }

      const { cachedTraces, cachedStats } = get()
      if (cachedTraces.length >= RULE_ENGINE.MIN_TRACES_FOR_ANALYSIS && cachedStats) {
        const llmTrigger = await get().analyzeWithLLM(cachedTraces, cachedStats)
        if (llmTrigger) {
          console.log('[Observer] LLM engine detected pattern:', llmTrigger.type)
          get().createProposal(llmTrigger)
          return llmTrigger
        }
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

  /**
   * 规则引擎分析 (本地, 零 Token 消耗)
   */
  analyzeWithRuleEngine: async () => {
    console.log('[Observer/Rule] Starting rule-based analysis...')
    
    // 获取最近的执行日志
    const data = await get().fetchRecentTraces()
    if (!data) return null
    
    const { traces, stats } = data
    set({ cachedTraces: traces, cachedStats: stats })
    
    if (traces.length < RULE_ENGINE.MIN_TRACES_FOR_ANALYSIS) {
      console.log(`[Observer/Rule] Not enough traces (${traces.length} < ${RULE_ENGINE.MIN_TRACES_FOR_ANALYSIS})`)
      return null
    }

    // ========== 规则 1: 频率触发 ==========
    const topTools = Object.entries(stats.toolFrequency)
      .filter(([, count]) => count >= RULE_ENGINE.FREQUENCY_THRESHOLD)
      .sort(([, a], [, b]) => b - a)
    
    if (topTools.length > 0) {
      const [toolName, count] = topTools[0]
      const confidence = Math.min(0.5 + (count - RULE_ENGINE.FREQUENCY_THRESHOLD) * 0.1, 0.9)
      
      console.log(`[Observer/Rule] Frequency trigger: ${toolName} used ${count} times`)
      
      return {
        type: 'frequency' as const,
        confidence,
        evidence: [
          `工具 "${toolName}" 在 ${RULE_ENGINE.FREQUENCY_DAYS} 天内被调用 ${count} 次`,
          `高频工具: ${topTools.slice(0, 3).map(([t, c]) => `${t}(${c})`).join(', ')}`
        ],
        suggestedArchetype: inferArchetypeFromTools(topTools.map(([t]) => t)),
        detectedAt: Date.now(),
      }
    }

    // ========== 规则 2: 复杂度触发 ==========
    const complexTraces = traces.filter(t => (t.turnCount || 0) >= RULE_ENGINE.COMPLEXITY_TURNS)
    if (complexTraces.length >= 2) {
      const avgTurns = complexTraces.reduce((sum, t) => sum + (t.turnCount || 0), 0) / complexTraces.length
      const confidence = Math.min(0.5 + (avgTurns - RULE_ENGINE.COMPLEXITY_TURNS) * 0.05, 0.85)
      
      console.log(`[Observer/Rule] Complexity trigger: ${complexTraces.length} complex executions`)
      
      return {
        type: 'complexity' as const,
        confidence,
        evidence: [
          `发现 ${complexTraces.length} 次复杂执行 (平均 ${avgTurns.toFixed(1)} 轮)`,
          `示例任务: ${complexTraces[0].task.slice(0, 50)}...`
        ],
        suggestedArchetype: 'SPIRE',
        detectedAt: Date.now(),
      }
    }

    // ========== 规则 3: 依赖触发 (工具链检测) ==========
    const pipelineFreq: Record<string, number> = {}
    for (const trace of traces) {
      if (trace.tools.length >= 2) {
        const pipeline = extractToolPipeline(trace)
        pipelineFreq[pipeline] = (pipelineFreq[pipeline] || 0) + 1
      }
    }
    
    const frequentPipelines = Object.entries(pipelineFreq)
      .filter(([, count]) => count >= RULE_ENGINE.DEPENDENCY_MIN_OCCURRENCES)
      .sort(([, a], [, b]) => b - a)
    
    if (frequentPipelines.length > 0) {
      const [pipeline, count] = frequentPipelines[0]
      const tools = pipeline.split('→')
      const confidence = Math.min(0.55 + count * 0.1, 0.85)
      
      console.log(`[Observer/Rule] Dependency trigger: pipeline "${pipeline}" appeared ${count} times`)
      
      return {
        type: 'dependency' as const,
        confidence,
        evidence: [
          `工具链 "${pipeline}" 重复出现 ${count} 次`,
          `涉及工具: ${tools.join(', ')}`
        ],
        suggestedArchetype: inferArchetypeFromTools(tools),
        detectedAt: Date.now(),
      }
    }

    console.log('[Observer/Rule] No rule-based pattern detected')
    return null
  },

  /**
   * LLM 语义引擎分析
   */
  analyzeWithLLM: async (traces: ExecTrace[], stats: TraceStats) => {
    console.log('[Observer/LLM] Starting semantic analysis...')
    
    // 准备分析数据
    const summaryData = {
      totalExecutions: stats.totalExecutions,
      avgTurns: stats.avgTurnsPerExecution.toFixed(1),
      topTools: Object.entries(stats.toolFrequency)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([t, c]) => `${t}: ${c}次`),
      recentTasks: traces.slice(0, 10).map(t => ({
        task: t.task.slice(0, 80),
        tools: t.tools.map(tool => tool.name).join('→'),
        turns: t.turnCount || 'N/A',
        success: t.success,
      })),
    }

    const userPrompt = `执行统计 (过去 ${RULE_ENGINE.FREQUENCY_DAYS} 天):
- 总执行次数: ${summaryData.totalExecutions}
- 平均轮次: ${summaryData.avgTurns}
- 高频工具: ${summaryData.topTools.join(', ')}

最近执行样本:
${summaryData.recentTasks.map((t, i) => 
  `${i + 1}. "${t.task}" → [${t.tools}] (${t.turns}轮, ${t.success ? '成功' : '失败'})`
).join('\n')}

请分析是否存在可固化的行为模式。`

    try {
      const response = await chat(
        [
          { role: 'system', content: ANALYST_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        { temperature: 0.3 } as any
      )

      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        console.warn('[Observer/LLM] Invalid JSON response')
        return null
      }
      
      const result = JSON.parse(jsonMatch[0])
      console.log('[Observer/LLM] Analysis result:', result)

      if (result.detected && result.confidence >= CONFIDENCE_THRESHOLD) {
        return {
          type: result.type,
          confidence: result.confidence,
          evidence: [
            result.summary,
            result.reasoning,
            result.suggestedName ? `建议名称: ${result.suggestedName}` : ''
          ].filter(Boolean),
          suggestedArchetype: result.archetype,
          detectedAt: Date.now(),
        }
      }

      return null
    } catch (error) {
      console.warn('[Observer/LLM] Analysis failed:', error)
      return null
    }
  },

  createProposal: (trigger) => {
    const proposalId = generateId()
    const archetype = trigger.suggestedArchetype
    
    // 从 evidence 中提取名称建议
    const nameFromEvidence = trigger.evidence.find(e => e.startsWith('建议名称:'))
    let suggestedName: string
    
    if (nameFromEvidence) {
      suggestedName = nameFromEvidence.replace('建议名称:', '').trim()
    } else {
      // 基于 Archetype 生成默认名称
      const archetypeLabels: Record<string, string> = {
        VAULT: '记忆库',
        SPIRE: '推理塔',
        REACTOR: '执行核',
        MONOLITH: '知识碑',
      }
      const baseLabel = archetypeLabels[archetype] || 'Nexus'
      const timestamp = new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
      suggestedName = `${baseLabel}-${timestamp}`
    }

    // 生成功能目标概述
    const purposeSummary = generatePurposeSummary(trigger, archetype)
    
    const proposal: BuildProposal = {
      id: proposalId,
      triggerPattern: trigger,
      suggestedName,
      suggestedArchetype: archetype,
      previewVisualDNA: generateVisualDNA(proposalId, archetype),
      purposeSummary,
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
