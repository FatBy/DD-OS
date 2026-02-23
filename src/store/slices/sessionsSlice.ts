import type { StateCreator } from 'zustand'
import type { Session, TaskItem, ExecutionStep } from '@/types'
import { sessionsToTasks } from '@/utils/dataMapper'
import { chat, isLLMConfigured } from '@/services/llmService'

// LocalStorage 键名
const STORAGE_KEYS = {
  TASK_HISTORY: 'ddos_task_history',
  SILENT_ANALYSIS: 'ddos_silent_analysis',
}

// 静默分析状态
export interface SilentAnalysis {
  content: string
  loading: boolean
  error: string | null
  timestamp: number
  taskCountAtGen: number
}

function emptySilentAnalysis(): SilentAnalysis {
  return { content: '', loading: false, error: null, timestamp: 0, taskCountAtGen: 0 }
}

function loadSilentAnalysis(): SilentAnalysis {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SILENT_ANALYSIS)
    if (data) {
      const parsed = JSON.parse(data)
      return { ...emptySilentAnalysis(), ...parsed, loading: false }
    }
  } catch {
    // ignore
  }
  return emptySilentAnalysis()
}

function persistSilentAnalysis(analysis: SilentAnalysis) {
  try {
    const { loading: _, ...rest } = analysis
    localStorage.setItem(STORAGE_KEYS.SILENT_ANALYSIS, JSON.stringify(rest))
  } catch {
    // ignore
  }
}

// 任务历史持久化
function loadTaskHistory(): TaskItem[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.TASK_HISTORY)
    if (data) {
      return JSON.parse(data)
    }
  } catch (e) {
    console.warn('[Sessions] Failed to load task history from localStorage:', e)
  }
  return []
}

function persistTaskHistory(tasks: TaskItem[]) {
  try {
    // 只保留最近 50 条任务，清理 executionSteps 中的大数据
    const trimmed = tasks.slice(-50).map(t => ({
      ...t,
      executionSteps: t.executionSteps?.slice(-20), // 每个任务最多保留 20 个步骤
    }))
    localStorage.setItem(STORAGE_KEYS.TASK_HISTORY, JSON.stringify(trimmed))
  } catch (e) {
    console.warn('[Sessions] Failed to persist task history:', e)
  }
}

// 初始化时加载
const initialTaskHistory = loadTaskHistory()
const initialSilentAnalysis = loadSilentAnalysis()

export interface SessionsSlice {
  // 原始 OpenClaw 数据
  sessions: Session[]
  sessionsLoading: boolean
  selectedSessionKey: string | null
  
  // 映射后的 UI 数据
  tasks: TaskItem[]
  
  // Native 模式: 实时执行任务 (持久化)
  activeExecutions: TaskItem[]
  
  // 静默分析
  silentAnalysis: SilentAnalysis
  
  // Actions
  setSessions: (sessions: Session[]) => void
  addSession: (session: Session) => void
  updateSession: (key: string, updates: Partial<Session>) => void
  removeSession: (key: string) => void
  setSelectedSession: (key: string | null) => void
  setSessionsLoading: (loading: boolean) => void
  
  // Native 模式: 实时执行任务管理
  addActiveExecution: (task: TaskItem) => void
  updateActiveExecution: (id: string, updates: Partial<TaskItem>) => void
  removeActiveExecution: (id: string) => void
  appendExecutionStep: (taskId: string, step: ExecutionStep) => void
  clearTaskHistory: () => void
  
  // 静默分析
  generateSilentAnalysis: () => Promise<void>
  shouldRefreshAnalysis: () => boolean
}

export const createSessionsSlice: StateCreator<SessionsSlice> = (set, get) => ({
  sessions: [],
  sessionsLoading: true,
  selectedSessionKey: null,
  tasks: [],
  // 从 localStorage 恢复任务历史
  activeExecutions: initialTaskHistory,
  silentAnalysis: initialSilentAnalysis,

  setSessions: (sessions) => set({ 
    sessions, 
    tasks: sessionsToTasks(sessions),
    sessionsLoading: false,
  }),
  
  addSession: (session) => set((state) => {
    const newSessions = [session, ...state.sessions]
    return {
      sessions: newSessions,
      tasks: sessionsToTasks(newSessions),
    }
  }),
  
  updateSession: (key, updates) => set((state) => {
    const newSessions = state.sessions.map((s) =>
      s.key === key ? { ...s, ...updates } : s
    )
    return {
      sessions: newSessions,
      tasks: sessionsToTasks(newSessions),
    }
  }),
  
  removeSession: (key) => set((state) => {
    const newSessions = state.sessions.filter((s) => s.key !== key)
    return {
      sessions: newSessions,
      tasks: sessionsToTasks(newSessions),
      selectedSessionKey: state.selectedSessionKey === key ? null : state.selectedSessionKey,
    }
  }),
  
  setSelectedSession: (key) => set({ selectedSessionKey: key }),
  
  setSessionsLoading: (loading) => set({ sessionsLoading: loading }),
  
  // Native 模式: 实时执行任务管理 (带持久化)
  addActiveExecution: (task) => set((state) => {
    const newExecutions = [...state.activeExecutions, task].slice(-50)
    persistTaskHistory(newExecutions)
    return { activeExecutions: newExecutions }
  }),
  
  updateActiveExecution: (id, updates) => set((state) => {
    const newExecutions = state.activeExecutions.map(t =>
      t.id === id ? { ...t, ...updates } : t
    )
    persistTaskHistory(newExecutions)
    return { activeExecutions: newExecutions }
  }),
  
  removeActiveExecution: (id) => set((state) => {
    const newExecutions = state.activeExecutions.filter(t => t.id !== id)
    persistTaskHistory(newExecutions)
    return { activeExecutions: newExecutions }
  }),
  
  // 追加执行步骤到指定任务
  appendExecutionStep: (taskId, step) => set((state) => {
    const newExecutions = state.activeExecutions.map(t => {
      if (t.id !== taskId) return t
      const existingSteps = t.executionSteps || []
      return {
        ...t,
        executionSteps: [...existingSteps, step].slice(-50), // 最多保留 50 步
      }
    })
    // 不在每一步都持久化，避免频繁写入
    return { activeExecutions: newExecutions }
  }),
  
  clearTaskHistory: () => {
    localStorage.removeItem(STORAGE_KEYS.TASK_HISTORY)
    localStorage.removeItem(STORAGE_KEYS.SILENT_ANALYSIS)
    set({ activeExecutions: [], silentAnalysis: emptySilentAnalysis() })
  },

  // 静默分析
  shouldRefreshAnalysis: () => {
    const { silentAnalysis, activeExecutions } = get()
    const doneCount = activeExecutions.filter(
      t => t.status === 'done' || t.status === 'terminated'
    ).length

    // 首次加载 / 无缓存
    if (silentAnalysis.timestamp === 0) return doneCount > 0

    // 新增 3+ 完成任务
    return doneCount - silentAnalysis.taskCountAtGen >= 3
  },

  generateSilentAnalysis: async () => {
    if (!isLLMConfigured()) return
    
    const { silentAnalysis, activeExecutions } = get()
    if (silentAnalysis.loading) return

    const doneTasks = activeExecutions.filter(
      t => t.status === 'done' || t.status === 'terminated'
    )

    if (doneTasks.length === 0) return

    set({ silentAnalysis: { ...get().silentAnalysis, loading: true, error: null } })

    try {
      const taskSummaries = doneTasks.slice(-20).map(t => {
        const duration = t.executionDuration
          ? `${(t.executionDuration / 1000).toFixed(1)}s`
          : '未知'
        const status = t.status === 'done'
          ? (t.executionError ? '完成(有错误)' : '成功')
          : '已终止'
        return `- [${t.title}] ${status} | 耗时 ${duration}${t.executionError ? ` | 错误: ${t.executionError.slice(0, 60)}` : ''}`
      }).join('\n')

      const messages = [
        {
          role: 'system' as const,
          content: '你是 DD-OS 任务分析师。基于历史任务执行记录，用简洁的叙事语气总结 Agent 的能力画像。包括：擅长什么类型任务、哪些容易失败、平均执行效率、改进建议。限制在 3-4 句话以内，使用中文。',
        },
        {
          role: 'user' as const,
          content: `历史任务 (${doneTasks.length} 条):\n${taskSummaries}`,
        },
      ]

      const content = await chat(messages)

      const newAnalysis: SilentAnalysis = {
        content,
        loading: false,
        error: null,
        timestamp: Date.now(),
        taskCountAtGen: doneTasks.length,
      }
      persistSilentAnalysis(newAnalysis)
      set({ silentAnalysis: newAnalysis })
    } catch (err: any) {
      set({
        silentAnalysis: {
          ...get().silentAnalysis,
          loading: false,
          error: err.message || '分析失败',
        },
      })
    }
  },
})
