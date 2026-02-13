import type { StateCreator } from 'zustand'
import type { Device, PresenceSnapshot, HealthSnapshot, SoulDimension, AgentIdentity, SoulIdentity, SoulTruth, SoulBoundary } from '@/types'
import { healthToSoulDimensions } from '@/utils/dataMapper'
import type { ParsedSoul } from '@/utils/soulParser'

export interface DevicesSlice {
  // 原始 OpenClaw 数据
  devices: Record<string, Device>
  operators: string[]
  nodes: string[]
  health: HealthSnapshot | null
  devicesLoading: boolean
  
  // SOUL.md 原始内容
  soulRawContent: string
  
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
  
  // 从解析后的 SOUL.md 设置灵魂数据
  setSoulFromParsed: (parsed: ParsedSoul, agentIdentity: AgentIdentity | null) => void
  
  // 更新灵魂维度 (基于 health, presence)
  updateSoulDimensions: (identity: AgentIdentity | null) => void
  
  // 兼容旧接口
  updateSoulFromState: (identity: AgentIdentity | null) => void
  setSoulDirty: (dirty: boolean) => void
}

export const createDevicesSlice: StateCreator<DevicesSlice> = (set, get) => ({
  devices: {},
  operators: [],
  nodes: [],
  health: null,
  devicesLoading: true,
  soulRawContent: '',
  soulIdentity: null,
  soulCoreTruths: [],
  soulBoundaries: [],
  soulVibeStatement: '',
  soulContinuityNote: '',
  soulDimensions: [],
  soulPrompts: { identity: '', constraints: '', goals: '' },
  soulDirty: false,

  setPresenceSnapshot: (snapshot) => set((state) => {
    // 只更新 presence 相关数据和维度，不覆盖已解析的 soul 内容
    const dimensions = healthToSoulDimensions(state.health, snapshot, null)
    return {
      devices: snapshot.devices,
      operators: snapshot.operators,
      nodes: snapshot.nodes,
      devicesLoading: false,
      soulDimensions: dimensions,
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
    // 只更新 health 和维度，不覆盖已解析的 soul 内容
    const dimensions = healthToSoulDimensions(
      health, 
      { operators: state.operators, nodes: state.nodes },
      null
    )
    return {
      health,
      soulDimensions: dimensions,
    }
  }),
  
  setDevicesLoading: (loading) => set({ devicesLoading: loading }),
  
  // 从解析后的 SOUL.md 设置灵魂数据
  setSoulFromParsed: (parsed, agentIdentity) => set((state) => {
    const identity: SoulIdentity = {
      name: agentIdentity?.name || 'OpenClaw Agent',
      essence: parsed.subtitle || parsed.title || 'AI Assistant',
      vibe: parsed.vibeStatement ? parsed.vibeStatement.slice(0, 100) : '',
      symbol: agentIdentity?.emoji || '🤖',
    }
    
    // 生成 prompts (兼容旧版)
    const prompts = {
      identity: agentIdentity 
        ? `I'm ${agentIdentity.name || 'OpenClaw Agent'}, ID: ${agentIdentity.agentId}. ${agentIdentity.emoji || '🤖'}`
        : 'Connected, waiting for agent identity...',
      constraints: state.health
        ? `Status: ${state.health.status}\nUptime: ${Math.floor(state.health.uptime / 3600000)}h\nVersion: ${state.health.version || 'unknown'}`
        : 'Loading system status...',
      goals: `Operators: ${state.operators.length}\nNodes: ${state.nodes.length}`,
    }
    
    return {
      soulRawContent: parsed.rawContent,
      soulIdentity: identity,
      soulCoreTruths: parsed.coreTruths,
      soulBoundaries: parsed.boundaries,
      soulVibeStatement: parsed.vibeStatement,
      soulContinuityNote: parsed.continuityNote,
      soulPrompts: prompts,
    }
  }),
  
  // 更新灵魂维度 (基于 health, presence)
  updateSoulDimensions: (identity) => set((state) => {
    const dimensions = healthToSoulDimensions(
      state.health,
      { operators: state.operators, nodes: state.nodes },
      identity
    )
    return { soulDimensions: dimensions }
  }),
  
  // 兼容旧接口 - 只更新维度，不覆盖解析的内容
  updateSoulFromState: (identity) => set((state) => {
    const dimensions = healthToSoulDimensions(
      state.health,
      { operators: state.operators, nodes: state.nodes },
      identity
    )
    
    // 如果还没有解析过 SOUL.md，设置默认 identity
    if (!state.soulIdentity && identity) {
      return {
        soulDimensions: dimensions,
        soulIdentity: {
          name: identity.name || 'OpenClaw Agent',
          essence: 'AI Assistant',
          vibe: '',
          symbol: identity.emoji || '🤖',
        },
      }
    }
    
    // 如果已经有 identity，只更新 name 和 emoji
    if (state.soulIdentity && identity) {
      return {
        soulDimensions: dimensions,
        soulIdentity: {
          ...state.soulIdentity,
          name: identity.name || state.soulIdentity.name,
          symbol: identity.emoji || state.soulIdentity.symbol,
        },
      }
    }
    
    return { soulDimensions: dimensions }
  }),
  
  setSoulDirty: (dirty) => set({ soulDirty: dirty }),
})
