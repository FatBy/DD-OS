import type { StateCreator } from 'zustand'
import type { ChatMessage, AISummary, LLMConfig, ViewType, SkillEnhancement, TaskEnhancement, ExecutionStatus, ApprovalRequest } from '@/types'
import type { SkillNode, TaskItem } from '@/types'
import { getLLMConfig, saveLLMConfig, isLLMConfigured, streamChat, chat } from '@/services/llmService'
import { buildSummaryMessages, buildChatMessages, buildSkillEnhancementPrompt, buildTaskNamingPrompt, parseJSONFromLLM, parseExecutionCommands, stripExecutionBlocks } from '@/services/contextBuilder'
import { localClawService } from '@/services/LocalClawService'

// 摘要缓存时间 (5分钟)
const SUMMARY_CACHE_MS = 5 * 60 * 1000
const ENHANCEMENT_CACHE_MS = 30 * 60 * 1000 // 30分钟 - 增强结果缓存更久

// LocalStorage 键名
const STORAGE_KEYS = {
  SKILL_ENHANCEMENTS: 'ddos_skill_enhancements',
  TASK_ENHANCEMENTS: 'ddos_task_enhancements',
  SKILL_TIMESTAMP: 'ddos_skill_enhancements_ts',
  TASK_TIMESTAMP: 'ddos_task_enhancements_ts',
  CHAT_HISTORY: 'ddos_chat_history',
  EXECUTION_STATUS: 'ddos_execution_status',
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

// 聊天记录持久化
function loadChatHistory(): { messages: ChatMessage[]; statuses: Record<string, ExecutionStatus> } {
  try {
    const msgs = localStorage.getItem(STORAGE_KEYS.CHAT_HISTORY)
    const stats = localStorage.getItem(STORAGE_KEYS.EXECUTION_STATUS)
    return {
      messages: msgs ? JSON.parse(msgs) : [],
      statuses: stats ? JSON.parse(stats) : {},
    }
  } catch (e) {
    console.warn('[AI] Failed to load chat history from localStorage:', e)
    return { messages: [], statuses: {} }
  }
}

function persistChatState(messages: ChatMessage[], statuses: Record<string, ExecutionStatus>) {
  try {
    // 只存最近 50 条消息，避免 localStorage 溢出
    const trimmed = messages.slice(-50)
    // 清理 outputLines (太大不适合存 localStorage)
    const cleanStatuses: Record<string, ExecutionStatus> = {}
    for (const [k, v] of Object.entries(statuses)) {
      cleanStatuses[k] = { ...v, outputLines: undefined }
    }
    localStorage.setItem(STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(trimmed))
    localStorage.setItem(STORAGE_KEYS.EXECUTION_STATUS, JSON.stringify(cleanStatuses))
  } catch (e) {
    console.warn('[AI] Failed to persist chat state:', e)
  }
}

const emptySummary = (): AISummary => ({ content: '', loading: false, error: null, timestamp: 0 })

// 初始化时加载持久化数据
const initialSkillEnhancements = loadSkillEnhancements()
const initialTaskEnhancements = loadTaskEnhancements()
const initialChatHistory = loadChatHistory()

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

  // P3: 危险操作审批
  pendingApproval: (ApprovalRequest & { resolve: (approved: boolean) => void }) | null
  requestApproval: (req: Omit<ApprovalRequest, 'id' | 'timestamp'>) => Promise<boolean>
  respondToApproval: (approved: boolean) => void
}

export const createAiSlice: StateCreator<AiSlice, [], [], AiSlice> = (set, get) => ({
  llmConfig: getLLMConfig(),
  llmConnected: false,
  summaries: {},
  chatMessages: initialChatHistory.messages,
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
  executionStatuses: initialChatHistory.statuses,

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
    // 持久化用户消息
    persistChatState(get().chatMessages, get().executionStatuses)

    try {
      const state = get() as any
      const connectionMode = state.connectionMode || 'native'
      const connectionStatus = state.connectionStatus || 'disconnected'
      const isNativeConnected = connectionMode === 'native' && connectionStatus === 'connected'

      // ========== Native 模式: 直通 ReAct (跳过前端 LLM) ==========
      if (isNativeConnected) {
        const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const execStartTime = Date.now()
        
        // 1. 创建占位消息 (聊天面板只显示简要状态)
        const placeholderMsg: ChatMessage = {
          id: execId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          execution: { id: execId, status: 'running', timestamp: Date.now() },
        }
        set((s) => ({
          chatMessages: [...s.chatMessages, placeholderMsg],
          chatStreaming: true,
          chatStreamContent: '',
          executionStatuses: { ...s.executionStatuses, [execId]: placeholderMsg.execution! },
        }))

        // 2. 创建实时任务 (在 TaskHouse 显示，含执行步骤)
        const fullState = get() as any
        fullState.addActiveExecution?.({
          id: execId,
          title: message.slice(0, 50),
          description: message,
          status: 'executing',
          priority: 'high',
          timestamp: new Date().toISOString(),
          executionSteps: [],
        })

        // 3. 直接调用 ReAct 循环
        try {
          const result = await localClawService.sendMessage(
            message,
            // onUpdate: 仅更新流式内容指示
            (content) => {
              set({ chatStreamContent: '...' })
            },
            // onStep: 将执行步骤追加到任务屋
            (step) => {
              (get() as any).appendExecutionStep?.(execId, step)
            }
          )

          // 4. 完成 - 聊天面板显示最终结果（普通文本消息）
          const execDuration = Date.now() - execStartTime
          set((s) => ({
            chatStreaming: false,
            chatStreamContent: '',
            _chatAbort: null,
            executionStatuses: {
              ...s.executionStatuses,
              [execId]: { id: execId, status: 'success', output: result, timestamp: Date.now() },
            },
            // 替换占位消息为最终结果（无 execution 卡片）
            chatMessages: s.chatMessages.map(m =>
              m.id === execId ? { ...m, content: result, execution: undefined } : m
            ),
          }))
          // 更新任务状态 + 存储执行结果
          fullState.updateActiveExecution?.(execId, {
            status: 'done',
            executionOutput: result,
            executionDuration: execDuration,
          })
          persistChatState(get().chatMessages, get().executionStatuses)

        } catch (err: any) {
          const execDuration = Date.now() - execStartTime
          set((s) => ({
            chatStreaming: false,
            chatStreamContent: '',
            _chatAbort: null,
            executionStatuses: {
              ...s.executionStatuses,
              [execId]: { id: execId, status: 'error', error: err.message, timestamp: Date.now() },
            },
            // 显示错误消息（普通文本，无执行卡片）
            chatMessages: s.chatMessages.map(m =>
              m.id === execId ? { ...m, content: `执行失败: ${err.message}`, error: true, execution: undefined } : m
            ),
          }))
          fullState.updateActiveExecution?.(execId, {
            status: 'done',
            executionError: err.message,
            executionDuration: execDuration,
          })
          persistChatState(get().chatMessages, get().executionStatuses)
        }

        // Observer 集成
        if (fullState.addBehaviorRecord && fullState.analyze && fullState.createProposal) {
          fullState.addBehaviorRecord({ type: 'chat', content: message, keywords: [] })
          const trigger = fullState.analyze()
          if (trigger) fullState.createProposal(trigger)
        }

        return // Native 分支结束，不进入 OpenClaw/前端 LLM 流程
      }

      // ========== OpenClaw / 未连接模式: 保持原有前端 LLM 流程 ==========
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
      // 持久化 assistant 消息
      persistChatState(get().chatMessages, get().executionStatuses)

      // === Observer 集成：记录行为并分析 ===
      const fullState = get() as any
      if (fullState.addBehaviorRecord && fullState.analyze && fullState.createProposal) {
        // 记录用户行为
        fullState.addBehaviorRecord({
          type: 'chat',
          content: message,
          keywords: [], // 由 observerSlice 自动提取
        })
        
        // 触发分析（会检查冷却时间）
        const trigger = fullState.analyze()
        if (trigger) {
          fullState.createProposal(trigger)
        }
      }

      // 通过 LocalClawService 执行任务 (Native 模式)
      if (commands.length > 0) {
        for (const cmd of commands) {
          const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          
          // 检查 Native 服务是否可用
          const serverAvailable = await localClawService.checkStatus()
          
          if (!serverAvailable) {
            // 服务不可用，显示任务建议
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
              status: 'running',
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
          
          // 使用 LocalClawService ReAct 循环执行任务
          try {
            const result = await localClawService.sendMessage(
              cmd.prompt,
              (content) => {
                // 流式更新输出
                const outputLines = content.split('\n')
                const updatedStatus: ExecutionStatus = {
                  id: execId,
                  status: 'running',
                  output: content,
                  outputLines,
                  timestamp: Date.now(),
                }
                set((state) => ({
                  executionStatuses: { ...state.executionStatuses, [execId]: updatedStatus },
                  chatMessages: state.chatMessages.map(m =>
                    m.id === execId ? { ...m, execution: updatedStatus } : m
                  ),
                }))
              }
            )
            
            // 执行完成
            const finalStatus: ExecutionStatus = {
              id: execId,
              status: 'success',
              output: result,
              outputLines: result.split('\n'),
              timestamp: Date.now(),
            }
            set((state) => ({
              executionStatuses: { ...state.executionStatuses, [execId]: finalStatus },
              chatMessages: state.chatMessages.map(m =>
                m.id === execId ? { ...m, execution: finalStatus } : m
              ),
            }))
            persistChatState(get().chatMessages, get().executionStatuses)
            
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
    localStorage.removeItem(STORAGE_KEYS.CHAT_HISTORY)
    localStorage.removeItem(STORAGE_KEYS.EXECUTION_STATUS)
    set({ chatMessages: [], chatStreaming: false, chatStreamContent: '', chatError: null, _chatAbort: null, executionStatuses: {} })
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
      const newStatuses = { ...state.executionStatuses, [id]: updated }
      const newMessages = state.chatMessages.map(m =>
        m.id === id ? { ...m, execution: updated } : m
      )
      // 持久化
      persistChatState(newMessages, newStatuses)
      return {
        executionStatuses: newStatuses,
        chatMessages: newMessages,
      }
    })
  },

  // P3: 危险操作审批
  pendingApproval: null,

  requestApproval: (req) => {
    return new Promise((resolve) => {
      const approvalRequest = {
        ...req,
        id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        resolve, // 存储 Promise 的 resolver
      }
      set({ pendingApproval: approvalRequest })

      // 60秒超时自动拒绝
      setTimeout(() => {
        const current = get().pendingApproval
        if (current && current.id === approvalRequest.id) {
          console.log('[Approval] Auto-reject due to timeout')
          set({ pendingApproval: null })
          resolve(false)
        }
      }, 60000)
    })
  },

  respondToApproval: (approved) => {
    const pending = get().pendingApproval
    if (pending) {
      pending.resolve(approved)
      set({ pendingApproval: null })
      console.log(`[Approval] User ${approved ? 'approved' : 'rejected'} operation: ${pending.toolName}`)
    }
  },
})
