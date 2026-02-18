import type { StateCreator } from 'zustand'
import type { AgentIdentity, AgentEvent, AgentRunStatus, LogEntry, MemoryEntry, JournalEntry, Session } from '@/types'
import { sessionsToMemories } from '@/utils/dataMapper'

export interface AgentSlice {
  // 原始 OpenClaw 数据
  agentIdentity: AgentIdentity | null
  agentStatus: AgentRunStatus | 'idle'
  logs: LogEntry[]
  agentLoading: boolean
  
  // 当前任务上下文 (Native 模式 Agent 状态广播)
  currentTaskDescription: string | null
  currentTaskId: string | null
  
  // 映射后的 UI 数据 (记忆)
  memories: MemoryEntry[]
  selectedMemoryId: string | null
  
  // 冒险日志 (AI 生成的叙事)
  journalEntries: JournalEntry[]
  journalLoading: boolean
  
  // Actions
  setAgentIdentity: (identity: AgentIdentity | null) => void
  setAgentStatus: (status: AgentRunStatus | 'idle') => void
  setCurrentTask: (id: string | null, description: string | null) => void
  addRunEvent: (event: AgentEvent) => void
  addLog: (log: LogEntry) => void
  clearLogs: () => void
  setAgentLoading: (loading: boolean) => void
  
  // 记忆 actions
  setMemories: (memories: MemoryEntry[]) => void
  setMemoriesFromSessions: (sessions: Session[]) => void
  setSelectedMemory: (id: string | null) => void
  
  // 日志 actions
  setJournalEntries: (entries: JournalEntry[]) => void
  setJournalLoading: (loading: boolean) => void
}

const MAX_LOGS = 500

export const createAgentSlice: StateCreator<AgentSlice> = (set) => ({
  agentIdentity: null,
  agentStatus: 'idle',
  logs: [],
  agentLoading: true,
  currentTaskDescription: null,
  currentTaskId: null,
  memories: [],
  selectedMemoryId: null,
  journalEntries: [],
  journalLoading: false,

  setAgentIdentity: (identity) => set({ agentIdentity: identity, agentLoading: false }),
  
  setAgentStatus: (status) => set({ agentStatus: status }),
  
  setCurrentTask: (id, description) => set({ currentTaskId: id, currentTaskDescription: description }),
  
  addRunEvent: (event) => set((state) => ({
    logs: [...state.logs, {
      id: `${event.runId}-${event.seq}`,
      timestamp: event.ts,
      level: 'info' as const,
      message: `[${event.stream}] ${JSON.stringify(event.data).slice(0, 200)}`,
    }].slice(-MAX_LOGS),
  })),
  
  addLog: (log) => set((state) => ({
    logs: [...state.logs, log].slice(-MAX_LOGS),
  })),
  
  clearLogs: () => set({ logs: [] }),
  
  setAgentLoading: (loading) => set({ agentLoading: loading }),
  
  setMemories: (memories) => set({ memories }),
  
  setMemoriesFromSessions: (sessions) => set((state) => ({
    memories: sessionsToMemories(sessions),
    selectedMemoryId: state.selectedMemoryId || (sessions.length > 0 ? sessions[0].key + '-last' : null),
  })),
  
  setSelectedMemory: (id) => set({ selectedMemoryId: id }),
  
  setJournalEntries: (entries) => set({ journalEntries: entries }),
  setJournalLoading: (loading) => set({ journalLoading: loading }),
})
