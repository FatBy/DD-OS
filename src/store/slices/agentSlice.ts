import type { StateCreator } from 'zustand'
import type { AgentIdentity, AgentEvent, AgentRunStatus, LogEntry, MemoryEntry, Session } from '@/types'
import { sessionsToMemories } from '@/utils/dataMapper'

export interface AgentSlice {
  // 原始 OpenClaw 数据
  agentIdentity: AgentIdentity | null
  agentStatus: AgentRunStatus | 'idle'
  logs: LogEntry[]
  agentLoading: boolean
  
  // 映射后的 UI 数据 (记忆)
  memories: MemoryEntry[]
  selectedMemoryId: string | null
  
  // Actions
  setAgentIdentity: (identity: AgentIdentity | null) => void
  setAgentStatus: (status: AgentRunStatus | 'idle') => void
  addRunEvent: (event: AgentEvent) => void
  addLog: (log: LogEntry) => void
  clearLogs: () => void
  setAgentLoading: (loading: boolean) => void
  
  // 记忆 actions (从 sessions 生成)
  setMemoriesFromSessions: (sessions: Session[]) => void
  setSelectedMemory: (id: string | null) => void
}

const MAX_LOGS = 500

export const createAgentSlice: StateCreator<AgentSlice> = (set) => ({
  agentIdentity: null,
  agentStatus: 'idle',
  logs: [],
  agentLoading: true,
  memories: [],
  selectedMemoryId: null,

  setAgentIdentity: (identity) => set({ agentIdentity: identity, agentLoading: false }),
  
  setAgentStatus: (status) => set({ agentStatus: status }),
  
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
  
  setMemoriesFromSessions: (sessions) => set((state) => ({
    memories: sessionsToMemories(sessions),
    selectedMemoryId: state.selectedMemoryId || (sessions.length > 0 ? sessions[0].key + '-last' : null),
  })),
  
  setSelectedMemory: (id) => set({ selectedMemoryId: id }),
})
