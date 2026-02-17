import type { StateCreator } from 'zustand'
import type { Session, TaskItem, ExecutionStep } from '@/types'
import { sessionsToTasks } from '@/utils/dataMapper'

// LocalStorage 键名
const STORAGE_KEYS = {
  TASK_HISTORY: 'ddos_task_history',
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

export interface SessionsSlice {
  // 原始 OpenClaw 数据
  sessions: Session[]
  sessionsLoading: boolean
  selectedSessionKey: string | null
  
  // 映射后的 UI 数据
  tasks: TaskItem[]
  
  // Native 模式: 实时执行任务 (持久化)
  activeExecutions: TaskItem[]
  
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
}

export const createSessionsSlice: StateCreator<SessionsSlice> = (set, get) => ({
  sessions: [],
  sessionsLoading: true,
  selectedSessionKey: null,
  tasks: [],
  // 从 localStorage 恢复任务历史
  activeExecutions: initialTaskHistory,

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
    set({ activeExecutions: [] })
  },
})
