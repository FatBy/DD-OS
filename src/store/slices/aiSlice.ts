import type { StateCreator } from 'zustand'
import type { ChatMessage, AISummary, LLMConfig, ViewType, SkillEnhancement, TaskEnhancement, ExecutionStatus } from '@/types'
import type { SkillNode, TaskItem } from '@/types'
import { getLLMConfig, saveLLMConfig, isLLMConfigured, streamChat, chat } from '@/services/llmService'
import { buildSummaryMessages, buildChatMessages, buildSkillEnhancementPrompt, buildTaskNamingPrompt, parseJSONFromLLM, parseExecutionCommands, stripExecutionBlocks } from '@/services/contextBuilder'
import { localServerService } from '@/services/localServerService'

// 摘要缓存时间 (5分钟)
const SUMMARY_CACHE_MS = 5 * 60 * 1000
const ENHANCEMENT_CACHE_MS = 30 * 60 * 1000 // 30分钟 - 增强结果缓存更久

// LocalStorage 键名
const STORAGE_KEYS = {
  SKILL_ENHANCEMENTS: 'ddos_skill_enhancements',
  TASK_ENHANCEMENTS: 'ddos_task_enhancements',
  SKILL_TIMESTAMP: 'ddos_skill_enhancements_ts',
  TASK_TIMESTAMP: 'ddos_task_enhancements_ts',
}

// 从 localStorage 加载持久化数据
function loadSkillEnhancements(): { data: Record<string, SkillEnhancement>; timestamp: number } {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SKILL_ENHANCEMENTS)
    const ts = localStorage.getItem(STORAGE_KEYS.SKILL_TIMESTAMP)
    if (data && ts) {
      return { data: JSON.parse(data), timestamp: parseInt(ts, 10) }
    }
  } catch (e) {
    console.warn('[AI] Failed to load skill enhancements from localStorage:', e)
  }
  return { data: {}, timestamp: 0 }
}

function loadTaskEnhancements(): { data: Record<string, TaskEnhancement>; timestamp: number } {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.TASK_ENHANCEMENTS)
    const ts = localStorage.getItem(STORAGE_KEYS.TASK_TIMESTAMP)
    if (data && ts) {
      return { data: JSON.parse(data), timestamp: parseInt(ts, 10) }
    }
  } catch (e) {
    console.warn('[AI] Failed to load task enhancements from localStorage:', e)
  }
  return { data: {}, timestamp: 0 }
}

function saveSkillEnhancements(data: Record<string, SkillEnhancement>, timestamp: number) {
  try {
    localStorage.setItem(STORAGE_KEYS.SKILL_ENHANCEMENTS, JSON.stringify(data))
    localStorage.setItem(STORAGE_KEYS.SKILL_TIMESTAMP, timestamp.toString())
  } catch (e) {
    console.warn('[AI] Failed to save skill enhancements to localStorage:', e)
  }
}

function saveTaskEnhancements(data: Record<string, TaskEnhancement>, timestamp: number) {
  try {
    localStorage.setItem(STORAGE_KEYS.TASK_ENHANCEMENTS, JSON.stringify(data))
    localStorage.setItem(STORAGE_KEYS.TASK_TIMESTAMP, timestamp.toString())
  } catch (e) {
    console.warn('[AI] Failed to save task enhancements to localStorage:', e)
  }
}

const emptySummary = (): AISummary => ({ content: '', loading: false, error: null, timestamp: 0 })

// 初始化时加载持久化数据
const initialSkillEnhancements = loadSkillEnhancements()
const initialTaskEnhancements = loadTaskEnhancements()

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

  // AI 执行
  executionStatuses: Record<string, ExecutionStatus>
  updateExecutionStatus: (id: string, updates: Partial<ExecutionStatus>) => void
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
  // 从 localStorage 恢复持久化数据
  skillEnhancements: initialSkillEnhancements.data,
  skillEnhancementsLoading: false,
  skillEnhancementsTimestamp: initialSkillEnhancements.timestamp,
  taskEnhancements: initialTaskEnhancements.data,
  taskEnhancementsLoading: false,
  taskEnhancementsTimestamp: initialTaskEnhancements.timestamp,
  executionStatuses: {},

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
        connectionStatus: state.connectionStatus || 'disconnected',
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

      // 流式完成，检测执行命令
      const commands = parseExecutionCommands(fullContent)
      const displayContent = commands.length > 0 ? stripExecutionBlocks(fullContent) : fullContent

      // 添加 assistant 消息
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: displayContent,
        timestamp: Date.now(),
      }

      set((state) => ({
        chatMessages: [...state.chatMessages, assistantMsg],
        chatStreaming: false,
        chatStreamContent: '',
        _chatAbort: null,
      }))

      // 通过本地服务执行 OpenClaw 任务
      if (commands.length > 0) {
        for (const cmd of commands) {
          const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          
          // 先检查本地服务是否可用
          const serverAvailable = await localServerService.checkStatus()
          
          if (!serverAvailable) {
            // 本地服务不可用，显示任务建议（降级方案）
            const suggestionMsg: ChatMessage = {
              id: execId,
              role: 'assistant',
              content: cmd.prompt,
              timestamp: Date.now(),
              execution: {
                id: execId,
                status: 'suggestion',
                timestamp: Date.now(),
              },
            }
            set((state) => ({
              chatMessages: [...state.chatMessages, suggestionMsg],
            }))
            continue
          }
          
          // 创建执行中状态消息
          const execMsg: ChatMessage = {
            id: execId,
            role: 'assistant',
            content: cmd.prompt,
            timestamp: Date.now(),
            execution: {
              id: execId,
              status: 'pending',
              timestamp: Date.now(),
            },
          }
          set((state) => ({
            chatMessages: [...state.chatMessages, execMsg],
            executionStatuses: { 
              ...state.executionStatuses, 
              [execId]: execMsg.execution! 
            },
          }))
          
          // 异步执行任务
          try {
            const result = await localServerService.executeTask(cmd.prompt)
            
            // 更新为 running 状态
            const runningStatus: ExecutionStatus = {
              id: execId,
              status: 'running',
              sessionKey: result.taskId,
              timestamp: Date.now(),
            }
            set((state) => ({
              executionStatuses: { ...state.executionStatuses, [execId]: runningStatus },
              chatMessages: state.chatMessages.map(m =>
                m.id === execId ? { ...m, execution: runningStatus } : m
              ),
            }))
            
            // 轮询任务状态
            localServerService.pollTaskStatus(
              result.taskId,
              (status) => {
                // 截断过长的输出，防止渲染崩溃
                const maxOutputLen = 5000
                const truncatedOutput = status.output && status.output.length > maxOutputLen
                  ? status.output.slice(0, maxOutputLen) + '\n\n... [输出过长，已截断]'
                  : status.output

                const finalStatus: ExecutionStatus = {
                  id: execId,
                  status: status.status === 'done' ? 'success' : status.status === 'error' ? 'error' : 'running',
                  sessionKey: result.taskId,
                  output: truncatedOutput,
                  error: status.error,
                  timestamp: Date.now(),
                }
                set((state) => ({
                  executionStatuses: { ...state.executionStatuses, [execId]: finalStatus },
                  chatMessages: state.chatMessages.map(m =>
                    m.id === execId ? { ...m, execution: finalStatus } : m
                  ),
                }))
              }
            )
          } catch (err: any) {
            // 执行失败
            const errorStatus: ExecutionStatus = {
              id: execId,
              status: 'error',
              error: err.message,
              timestamp: Date.now(),
            }
            set((state) => ({
              executionStatuses: { ...state.executionStatuses, [execId]: errorStatus },
              chatMessages: state.chatMessages.map(m =>
                m.id === execId ? { ...m, execution: errorStatus } : m
              ),
            }))
          }
        }
      }
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
      const parsed = parseJSONFromLLM<Array<{ skillId: string; importanceScore: number; reasoning: string; subCategory?: string }>>(response)

      const enhancementMap: Record<string, SkillEnhancement> = {}
      for (const item of parsed) {
        enhancementMap[item.skillId] = {
          skillId: item.skillId,
          importanceScore: item.importanceScore,
          reasoning: item.reasoning,
          subCategory: item.subCategory || '其他',
        }
      }

      const timestamp = Date.now()
      
      // 保存到 localStorage
      saveSkillEnhancements(enhancementMap, timestamp)

      set({
        skillEnhancements: enhancementMap,
        skillEnhancementsLoading: false,
        skillEnhancementsTimestamp: timestamp,
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

      const timestamp = Date.now()
      
      // 保存到 localStorage
      saveTaskEnhancements(enhancementMap, timestamp)

      set({
        taskEnhancements: enhancementMap,
        taskEnhancementsLoading: false,
        taskEnhancementsTimestamp: timestamp,
      })
    } catch (err: any) {
      console.error('[AI] enhanceTaskNames failed:', err)
      set({ taskEnhancementsLoading: false })
    }
  },

  clearSkillEnhancements: () => {
    // 同时清除 localStorage
    localStorage.removeItem(STORAGE_KEYS.SKILL_ENHANCEMENTS)
    localStorage.removeItem(STORAGE_KEYS.SKILL_TIMESTAMP)
    set({ skillEnhancements: {}, skillEnhancementsTimestamp: 0 })
  },

  clearTaskEnhancements: () => {
    // 同时清除 localStorage
    localStorage.removeItem(STORAGE_KEYS.TASK_ENHANCEMENTS)
    localStorage.removeItem(STORAGE_KEYS.TASK_TIMESTAMP)
    set({ taskEnhancements: {}, taskEnhancementsTimestamp: 0 })
  },

  updateExecutionStatus: (id, updates) => {
    set((state) => {
      const current = state.executionStatuses[id]
      if (!current) return state
      const updated = { ...current, ...updates }
      return {
        executionStatuses: { ...state.executionStatuses, [id]: updated },
        chatMessages: state.chatMessages.map(m =>
          m.id === id ? { ...m, execution: updated } : m
        ),
      }
    })
  },
})
