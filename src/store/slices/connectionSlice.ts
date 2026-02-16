import type { StateCreator } from 'zustand'
import type { ConnectionStatus, Toast } from '@/types'

export type ConnectionMode = 'native' | 'openclaw'

export interface ConnectionSlice {
  // 状态
  connectionStatus: ConnectionStatus
  connectionMode: ConnectionMode
  connectionError: string | null
  reconnectAttempt: number
  reconnectCountdown: number | null
  toasts: Toast[]
  
  // Actions
  setConnectionStatus: (status: ConnectionStatus) => void
  setConnectionMode: (mode: ConnectionMode) => void
  setConnectionError: (error: string | null) => void
  setReconnectAttempt: (attempt: number) => void
  setReconnectCountdown: (countdown: number | null) => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

export const createConnectionSlice: StateCreator<ConnectionSlice> = (set) => ({
  // 初始状态
  connectionStatus: 'disconnected',
  connectionMode: 'native',
  connectionError: null,
  reconnectAttempt: 0,
  reconnectCountdown: null,
  toasts: [],

  // Actions
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  
  setConnectionMode: (mode) => set({ connectionMode: mode }),
  
  setConnectionError: (error) => set({ connectionError: error }),
  
  setReconnectAttempt: (attempt) => set({ reconnectAttempt: attempt }),
  
  setReconnectCountdown: (countdown) => set({ reconnectCountdown: countdown }),
  
  addToast: (toast) => set((state) => ({
    toasts: [
      ...state.toasts,
      {
        ...toast,
        id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        duration: toast.duration ?? 4000,
      },
    ],
  })),
  
  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id),
  })),
})
