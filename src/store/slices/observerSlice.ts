import type { StateCreator } from 'zustand'
import type { 
  BehaviorRecord, 
  TriggerPattern, 
  BuildProposal, 
  VisualDNA,
  ExecTrace
} from '@/types'
import { chat, getLLMConfig } from '@/services/llmService'

// ============================================
// 常量配置 - 双引擎阈值
// ============================================

const BEHAVIOR_WINDOW_SIZE = 50        // 保留最近 N 条行为记录
const ANALYSIS_COOLDOWN_MS = 20000     // 分析冷却 (20秒，原 30秒)
const CONFIDENCE_THRESHOLD = 0.5       // 触发置信度阈值 (原 0.6)

// 规则引擎阈值
const RULE_ENGINE = {
  FREQUENCY_THRESHOLD: 3,         // 同一工具调用 3+ 次触发 (原 5)
  FREQUENCY_DAYS: 7,              // 在 7 天内 (原 3)
  COMPLEXITY_TURNS: 8,            // 单次执行超过 8 轮视为复杂 (原 10)
  DEPENDENCY_MIN_OCCURRENCES: 2,  // 工具链出现 2+ 次 (原 3)
  MIN_TRACES_FOR_ANALYSIS: 3,     // 至少 3 条执行记录才分析 (原 5)
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

/**
 * 同步生成 VisualDNA（用于 Observer 快速创建 Proposal）
 * 注意：这是一个简化的同步版本，完整版本在 visualHash.ts 中
 */
function generateVisualDNASync(id: string): VisualDNA {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  }
  const h = Math.abs(hash)
  
  const primaryHue = h % 360
  const geometryVariant = h % 4
  
  return {
    primaryHue,
    primarySaturation: 50 + (h >> 8) % 40,
    primaryLightness: 35 + (h >> 16) % 30,
    accentHue: (primaryHue + 60) % 360,
    textureMode: 'solid',
    glowIntensity: 0.5 + (h % 50) / 100,
    geometryVariant,
    planetTexture: (['bands', 'storm', 'core', 'crystal'] as const)[geometryVariant],
    ringCount: 1 + (h >> 4) % 3,
    ringTilts: [0.15, -0.3, 0.1].slice(0, 1 + (h >> 4) % 3),
    buildingConfig: {
      base: ['concrete', 'steel', 'glass', 'stone'][h % 4],
      body: ['office', 'lab', 'factory', 'library', 'tower', 'warehouse'][(h >> 2) % 6],
      roof: ['flat', 'dome', 'antenna', 'satellite', 'chimney', 'garden'][(h >> 4) % 6],
      themeColor: `hsl(${primaryHue}, 70%, 50%)`,
    },
  }
}

/**
 * 提取工具调用序列作为"管道签名"
 */
function extractToolPipeline(trace: ExecTrace): string {
  return trace.tools.map(t => t.name).join('→')
}

/**
 * 根据触发类型和证据生成功能目标概述
 */
function generatePurposeSummary(trigger: TriggerPattern): string {
  // LLM 分析的第一条 evidence 通常是 summary，直接使用
  if (trigger.type === 'frequency' || trigger.type === 'complexity' || trigger.type === 'dependency') {
    // 从 evidence 中提取关键工具名
    const toolMatch = trigger.evidence[0]?.match(/工具\s*"?(\w+)"?/)
    const toolName = toolMatch?.[1]

    if (toolName) {
      return `将您频繁使用的 ${toolName} 等能力整合为专用执行节点，减少重复操作、提升效率。`
    }
    return '将检测到的行为模式固化为可复用的执行节点，提升操作效率。'
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
  "summary": "简短描述这个模式（10-20字）",
  "reasoning": "为什么需要固化这个模式",
  "suggestedName": "建议的 Nexus 名称（2-5个中文字，体现功能特点，如'文档助手'、'代码审查'、'日志分析'）",
  "suggestedSkills": ["工具名1", "工具名2"],
  "suggestedSOP": "为这个 Nexus 编写系统提示词，告诉它如何处理此类任务。必须是可执行的指令说明，50-150字。",
  "confidence": 0.1 ~ 1.0
}

如果没有明显模式，返回：{"detected": false}

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
      const suggestedSkills = topTools.slice(0, 3).map(([t]) => t)
      
      console.log(`[Observer/Rule] Frequency trigger: ${toolName} used ${count} times`)
      
      return {
        type: 'frequency' as const,
        confidence,
        evidence: [
          `工具 "${toolName}" 在 ${RULE_ENGINE.FREQUENCY_DAYS} 天内被调用 ${count} 次`,
          `高频工具: ${topTools.slice(0, 3).map(([t, c]) => `${t}(${c})`).join(', ')}`
        ],
        detectedAt: Date.now(),
        suggestedSkills,
        suggestedSOP: `你的核心任务是熟练使用 ${suggestedSkills.join('、')} 工具。请根据用户的自然语言需求，选择合适的工具完成操作。优先使用 ${toolName}，它是用户最常用的工具。`,
      }
    }

    // ========== 规则 2: 复杂度触发 ==========
    const complexTraces = traces.filter(t => (t.turnCount || 0) >= RULE_ENGINE.COMPLEXITY_TURNS)
    if (complexTraces.length >= 2) {
      const avgTurns = complexTraces.reduce((sum, t) => sum + (t.turnCount || 0), 0) / complexTraces.length
      const confidence = Math.min(0.5 + (avgTurns - RULE_ENGINE.COMPLEXITY_TURNS) * 0.05, 0.85)
      
      // 从复杂任务中提取常用工具
      const complexToolFreq: Record<string, number> = {}
      for (const trace of complexTraces) {
        for (const tool of trace.tools) {
          complexToolFreq[tool.name] = (complexToolFreq[tool.name] || 0) + 1
        }
      }
      const suggestedSkills = Object.entries(complexToolFreq)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([t]) => t)
      
      console.log(`[Observer/Rule] Complexity trigger: ${complexTraces.length} complex executions`)
      
      return {
        type: 'complexity' as const,
        confidence,
        evidence: [
          `发现 ${complexTraces.length} 次复杂执行 (平均 ${avgTurns.toFixed(1)} 轮)`,
          `示例任务: ${complexTraces[0].task.slice(0, 50)}...`
        ],
        detectedAt: Date.now(),
        suggestedSkills,
        suggestedSOP: `你是一个复杂任务处理专家。当用户提出多步骤任务时，先分析任务结构，制定执行计划，然后逐步完成。常用工具: ${suggestedSkills.join('、')}。遇到问题时主动反思并调整策略。`,
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
        detectedAt: Date.now(),
        suggestedSkills: tools,
        suggestedSOP: `你的标准作业流程(SOP)是执行以下工具链：${tools.join(' → ')}。请按顺序规划并调用这些工具完成任务。在每一步完成后验证结果，确保下一步有正确的输入。`,
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
          detectedAt: Date.now(),
          suggestedSkills: result.suggestedSkills || [],
          suggestedSOP: result.suggestedSOP || '',
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
    
    // 从 evidence 中提取名称建议
    const nameFromEvidence = trigger.evidence.find(e => e.startsWith('建议名称:'))
    let suggestedName: string
    
    if (nameFromEvidence) {
      suggestedName = nameFromEvidence.replace('建议名称:', '').trim()
    } else {
      // 生成默认名称
      const timestamp = new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
      suggestedName = `Nexus-${timestamp}`
    }

    // 生成功能目标概述
    const purposeSummary = generatePurposeSummary(trigger)
    
    // 从 trigger 提取技能和 SOP
    const boundSkillIds = trigger.suggestedSkills || []
    const sopContent = trigger.suggestedSOP || ''
    
    const proposal: BuildProposal = {
      id: proposalId,
      triggerPattern: trigger,
      suggestedName,
      previewVisualDNA: generateVisualDNASync(proposalId),
      purposeSummary,
      boundSkillIds,           // 新增：技能列表
      sopContent,              // 新增：SOP 内容
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
