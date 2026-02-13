import type { StateCreator } from 'zustand'
import type { Device, PresenceSnapshot, HealthSnapshot, SoulDimension, SoulConfig, AgentIdentity, SoulIdentity, SoulTruth, SoulBoundary } from '@/types'
import { generateSoulConfig } from '@/utils/dataMapper'

export interface DevicesSlice {
  // 原始 OpenClaw 数据
  devices: Record<string, Device>
  operators: string[]
  nodes: string[]
  health: HealthSnapshot | null
  devicesLoading: boolean
  
  // 映射后的 UI 数据 (灵魂 - 基于 SOUL.md)
  soulIdentity: SoulIdentity | null
  soulCoreTruths: SoulTruth[]
  soulBoundaries: SoulBoundary[]
  soulVibeStatement: string
  soulContinuityNote: string
  soulDimensions: SoulDimension[]
  soulPrompts: { identity: string; constraints: string; goals: string }
  soulDirty: boolean
  
  // Actions
  setPresenceSnapshot: (snapshot: PresenceSnapshot) => void
  updateDevice: (id: string, updates: Partial<Device>) => void
  removeDevice: (id: string) => void
  setHealth: (health: HealthSnapshot | null) => void
  setDevicesLoading: (loading: boolean) => void
  
  // 更新灵魂 (综合 health, presence, agent identity)
  updateSoulFromState: (identity: AgentIdentity | null) => void
  setSoulDirty: (dirty: boolean) => void
}

export const createDevicesSlice: StateCreator<DevicesSlice> = (set, get) => ({
  devices: {},
  operators: [],
  nodes: [],
  health: null,
  devicesLoading: true,
  soulIdentity: null,
  soulCoreTruths: [],
  soulBoundaries: [],
  soulVibeStatement: '',
  soulContinuityNote: '',
  soulDimensions: [],
  soulPrompts: { identity: '', constraints: '', goals: '' },
  soulDirty: false,

  setPresenceSnapshot: (snapshot) => set((state) => {
    const soulConfig = generateSoulConfig(state.health, snapshot, null)
    return {
      devices: snapshot.devices,
      operators: snapshot.operators,
      nodes: snapshot.nodes,
      devicesLoading: false,
      soulIdentity: soulConfig.identity,
      soulCoreTruths: soulConfig.coreTruths,
      soulBoundaries: soulConfig.boundaries,
      soulVibeStatement: soulConfig.vibeStatement,
      soulContinuityNote: soulConfig.continuityNote,
      soulDimensions: soulConfig.dimensions,
      soulPrompts: soulConfig.prompts,
    }
  }),
  
  updateDevice: (id, updates) => set((state) => ({
    devices: {
      ...state.devices,
      [id]: { ...state.devices[id], ...updates },
    },
  })),
  
  removeDevice: (id) => set((state) => {
    const { [id]: removed, ...rest } = state.devices
    const device = state.devices[id]
    return {
      devices: rest,
      operators: device?.role === 'operator' 
        ? state.operators.filter((o) => o !== id) 
        : state.operators,
      nodes: device?.role === 'node'
        ? state.nodes.filter((n) => n !== id)
        : state.nodes,
    }
  }),
  
  setHealth: (health) => set((state) => {
    const soulConfig = generateSoulConfig(
      health, 
      { devices: state.devices, operators: state.operators, nodes: state.nodes },
      null
    )
    return {
      health,
      soulIdentity: soulConfig.identity,
      soulCoreTruths: soulConfig.coreTruths,
      soulBoundaries: soulConfig.boundaries,
      soulVibeStatement: soulConfig.vibeStatement,
      soulContinuityNote: soulConfig.continuityNote,
      soulDimensions: soulConfig.dimensions,
      soulPrompts: soulConfig.prompts,
    }
  }),
  
  setDevicesLoading: (loading) => set({ devicesLoading: loading }),
  
  updateSoulFromState: (identity) => set((state) => {
    const soulConfig = generateSoulConfig(
      state.health,
      { devices: state.devices, operators: state.operators, nodes: state.nodes },
      identity
    )
    return {
      soulIdentity: soulConfig.identity,
      soulCoreTruths: soulConfig.coreTruths,
      soulBoundaries: soulConfig.boundaries,
      soulVibeStatement: soulConfig.vibeStatement,
      soulContinuityNote: soulConfig.continuityNote,
      soulDimensions: soulConfig.dimensions,
      soulPrompts: soulConfig.prompts,
    }
  }),
  
  setSoulDirty: (dirty) => set({ soulDirty: dirty }),
})
