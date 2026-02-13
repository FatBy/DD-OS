import type { StateCreator } from 'zustand'
import type { Session, TaskItem } from '@/types'
import { sessionsToTasks } from '@/utils/dataMapper'

export interface SessionsSlice {
  // 原始 OpenClaw 数据
  sessions: Session[]
  sessionsLoading: boolean
  selectedSessionKey: string | null
  
  // 映射后的 UI 数据
  tasks: TaskItem[]
  
  // Actions
  setSessions: (sessions: Session[]) => void
  addSession: (session: Session) => void
  updateSession: (key: string, updates: Partial<Session>) => void
  removeSession: (key: string) => void
  setSelectedSession: (key: string | null) => void
  setSessionsLoading: (loading: boolean) => void
}

export const createSessionsSlice: StateCreator<SessionsSlice> = (set) => ({
  sessions: [],
  sessionsLoading: true,
  selectedSessionKey: null,
  tasks: [],

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
})
