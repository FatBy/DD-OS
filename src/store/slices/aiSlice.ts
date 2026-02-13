import type { StateCreator } from 'zustand'
import type { ChatMessage, AISummary, LLMConfig, ViewType, SkillEnhancement, TaskEnhancement } from '@/types'
import type { SkillNode, TaskItem } from '@/types'
import { getLLMConfig, saveLLMConfig, isLLMConfigured, streamChat, chat } from '@/services/llmService'
import { buildSummaryMessages, buildChatMessages, buildSkillEnhancementPrompt, buildTaskNamingPrompt, parseJSONFromLLM } from '@/services/contextBuilder'

// 摘要缓存时间 (5分钟)
const SUMMARY_CACHE_MS = 5 * 60 * 1000
const ENHANCEMENT_CACHE_MS = 5 * 60 * 1000

const emptySummary = (): AISummary => ({ content: '', loading: false, error: null, timestamp: 0 })

export interface AiSlice {
  // LLM 配置
  llmConfig: LLMConfig
  llmConnected: boolean

  // 每页独立摘要
  summaries: Record<string, AISummary>

  // 全局聊天
  chatMessages: ChatMessage[]
  chatStreaming: boolean
  chatStreamContent: string
  chatContext: ViewType
  chatError: string | null

  // AbortController 引用
  _chatAbort: AbortController | null

  // Actions
  setLlmConfig: (config: Partial<LLMConfig>) => void
  setLlmConnected: (connected: boolean) => void

  // 摘要
  generateSummary: (view: ViewType) => Promise<void>
  getSummary: (view: ViewType) => AISummary
  clearSummary: (view: ViewType) => void

  // 聊天
  sendChat: (message: string, view: ViewType) => Promise<void>
  clearChat: () => void
  abortChat: () => void
  setChatContext: (view: ViewType) => void

  // AI 增强
  skillEnhancements: Record<string, SkillEnhancement>
  skillEnhancementsLoading: boolean
  skillEnhancementsTimestamp: number
  taskEnhancements: Record<string, TaskEnhancement>
  taskEnhancementsLoading: boolean
  taskEnhancementsTimestamp: number

  enhanceSkills: (skills: SkillNode[]) => Promise<void>
  enhanceTaskNames: (tasks: TaskItem[]) => Promise<void>
  clearSkillEnhancements: () => void
  clearTaskEnhancements: () => void
}

export const createAiSlice: StateCreator<AiSlice, [], [], AiSlice> = (set, get) => ({
  llmConfig: getLLMConfig(),
  llmConnected: false,
  summaries: {},
  chatMessages: [],
  chatStreaming: false,
  chatStreamContent: '',
  chatContext: 'world',
  chatError: null,
  _chatAbort: null,
  skillEnhancements: {},
  skillEnhancementsLoading: false,
  skillEnhancementsTimestamp: 0,
  taskEnhancements: {},
  taskEnhancementsLoading: false,
  taskEnhancementsTimestamp: 0,

  setLlmConfig: (config) => {
    saveLLMConfig(config)
    set((state) => ({
      llmConfig: { ...state.llmConfig, ...config },
    }))
  },

  setLlmConnected: (connected) => set({ llmConnected: connected }),

  getSummary: (view) => {
    return get().summaries[view] || emptySummary()
  },

  generateSummary: async (view) => {
    if (!isLLMConfigured()) return

    const current = get().summaries[view]
    // 缓存未过期则跳过
    if (current && current.content && !current.error && Date.now() - current.timestamp < SUMMARY_CACHE_MS) {
      return
    }

    // 设置 loading
    set((state) => ({
      summaries: {
        ...state.summaries,
        [view]: { content: '', loading: true, error: null, timestamp: 0 },
      },
    }))

    try {
      // 从 store 获取当前数据 - 使用 get() 获取完整 state
      const state = get() as any
      const storeData = {
        tasks: state.tasks || [],
        skills: state.skills || [],
        memories: state.memories || [],
        soulCoreTruths: state.soulCoreTruths || [],
        soulBoundaries: state.soulBoundaries || [],
        soulVibeStatement: state.soulVibeStatement || '',
        soulRawContent: state.soulRawContent || '',
      }

      const messages = buildSummaryMessages(view, storeData)
      const content = await chat(messages)

      set((state) => ({
        summaries: {
          ...state.summaries,
          [view]: { content, loading: false, error: null, timestamp: Date.now() },
        },
      }))
    } catch (err: any) {
      set((state) => ({
        summaries: {
          ...state.summaries,
          [view]: { content: '', loading: false, error: err.message, timestamp: 0 },
        },
      }))
    }
  },

  clearSummary: (view) => {
    set((state) => ({
      summaries: {
        ...state.summaries,
        [view]: emptySummary(),
      },
    }))
  },

  sendChat: async (message, view) => {
    if (!isLLMConfigured()) return

    // 中止之前的请求
    const prevAbort = get()._chatAbort
    if (prevAbort) prevAbort.abort()

    const abortController = new AbortController()

    // 添加用户消息
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
    }

    set((state) => ({
      chatMessages: [...state.chatMessages, userMsg],
      chatStreaming: true,
      chatStreamContent: '',
      chatError: null,
      chatContext: view,
      _chatAbort: abortController,
    }))

    try {
      const state = get() as any
      const storeData = {
        tasks: state.tasks || [],
        skills: state.skills || [],
        memories: state.memories || [],
        soulCoreTruths: state.soulCoreTruths || [],
        soulBoundaries: state.soulBoundaries || [],
        soulVibeStatement: state.soulVibeStatement || '',
        soulRawContent: state.soulRawContent || '',
      }

      const history = get().chatMessages
      const messages = buildChatMessages(view, storeData, history, message)

      let fullContent = ''

      await streamChat(
        messages,
        (chunk) => {
          fullContent += chunk
          set({ chatStreamContent: fullContent })
        },
        abortController.signal,
      )

      // 流式完成，添加 assistant 消息
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: fullContent,
        timestamp: Date.now(),
      }

      set((state) => ({
        chatMessages: [...state.chatMessages, assistantMsg],
        chatStreaming: false,
        chatStreamContent: '',
        _chatAbort: null,
      }))
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // 用户取消，保留已收到的内容
        const partial = get().chatStreamContent
        if (partial) {
          const assistantMsg: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: partial + ' [已中断]',
            timestamp: Date.now(),
          }
          set((state) => ({
            chatMessages: [...state.chatMessages, assistantMsg],
            chatStreaming: false,
            chatStreamContent: '',
            _chatAbort: null,
          }))
        } else {
          set({ chatStreaming: false, chatStreamContent: '', _chatAbort: null })
        }
      } else {
        set({
          chatStreaming: false,
          chatStreamContent: '',
          chatError: err.message,
          _chatAbort: null,
        })
      }
    }
  },

  clearChat: () => {
    const abort = get()._chatAbort
    if (abort) abort.abort()
    set({ chatMessages: [], chatStreaming: false, chatStreamContent: '', chatError: null, _chatAbort: null })
  },

  abortChat: () => {
    const abort = get()._chatAbort
    if (abort) abort.abort()
  },

  setChatContext: (view) => set({ chatContext: view }),

  // ============================================
  // AI 增强 Actions
  // ============================================

  enhanceSkills: async (skills) => {
    if (!isLLMConfigured() || skills.length === 0) return

    // 缓存检查
    const ts = get().skillEnhancementsTimestamp
    if (ts && Date.now() - ts < ENHANCEMENT_CACHE_MS && Object.keys(get().skillEnhancements).length > 0) {
      return
    }

    set({ skillEnhancementsLoading: true })

    try {
      const messages = buildSkillEnhancementPrompt(skills)
      const response = await chat(messages)
      const parsed = parseJSONFromLLM<Array<{ skillId: string; importanceScore: number; reasoning: string }>>(response)

      const enhancementMap: Record<string, SkillEnhancement> = {}
      for (const item of parsed) {
        enhancementMap[item.skillId] = {
          skillId: item.skillId,
          importanceScore: item.importanceScore,
          reasoning: item.reasoning,
        }
      }

      set({
        skillEnhancements: enhancementMap,
        skillEnhancementsLoading: false,
        skillEnhancementsTimestamp: Date.now(),
      })
    } catch (err: any) {
      console.error('[AI] enhanceSkills failed:', err)
      set({ skillEnhancementsLoading: false })
    }
  },

  enhanceTaskNames: async (tasks) => {
    if (!isLLMConfigured() || tasks.length === 0) return

    // 缓存检查
    const ts = get().taskEnhancementsTimestamp
    if (ts && Date.now() - ts < ENHANCEMENT_CACHE_MS && Object.keys(get().taskEnhancements).length > 0) {
      return
    }

    set({ taskEnhancementsLoading: true })

    try {
      const messages = buildTaskNamingPrompt(tasks)
      const response = await chat(messages)
      const parsed = parseJSONFromLLM<Array<{ taskId: string; naturalTitle: string }>>(response)

      const enhancementMap: Record<string, TaskEnhancement> = {}
      for (const item of parsed) {
        enhancementMap[item.taskId] = {
          taskId: item.taskId,
          naturalTitle: item.naturalTitle,
        }
      }

      set({
        taskEnhancements: enhancementMap,
        taskEnhancementsLoading: false,
        taskEnhancementsTimestamp: Date.now(),
      })
    } catch (err: any) {
      console.error('[AI] enhanceTaskNames failed:', err)
      set({ taskEnhancementsLoading: false })
    }
  },

  clearSkillEnhancements: () => {
    set({ skillEnhancements: {}, skillEnhancementsTimestamp: 0 })
  },

  clearTaskEnhancements: () => {
    set({ taskEnhancements: {}, taskEnhancementsTimestamp: 0 })
  },
})
