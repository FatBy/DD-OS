import type { StateCreator } from 'zustand'
import type { NexusEntity, CameraState, GridPosition, RenderSettings, NexusArchetype, VisualDNA } from '@/types'

// XP 等级阈值
const XP_THRESHOLDS = [0, 20, 100, 500] as const

export function xpToLevel(xp: number): number {
  for (let i = XP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= XP_THRESHOLDS[i]) return i + 1
  }
  return 1
}

// ISO 投影常量
const TILE_WIDTH = 128
const TILE_HEIGHT = 64

// 简易同步哈希 -> VisualDNA (不依赖 crypto.subtle)
export function simpleVisualDNA(id: string, archetype: NexusArchetype): VisualDNA {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  }
  const h = Math.abs(hash)
  return {
    primaryHue: h % 360,
    primarySaturation: 50 + (h >> 8) % 40,
    primaryLightness: 35 + (h >> 16) % 30,
    accentHue: (h % 360 + 60) % 360,
    archetype,
    textureMode: 'solid',
    glowIntensity: 0.5 + ((h >> 4) % 50) / 100,
    geometryVariant: h % 4,
  }
}

// 初始状态: 空世界，等待 Observer 涌现
function createDemoNexuses(): Map<string, NexusEntity> {
  return new Map<string, NexusEntity>()
}

// 用于从服务器数据自动分配 grid 位置
let nextGridSlot = 0
function assignGridPosition(): GridPosition {
  const positions: GridPosition[] = [
    { gridX: 3, gridY: -2 },
    { gridX: -2, gridY: 3 },
    { gridX: 4, gridY: 1 },
    { gridX: -1, gridY: -3 },
    { gridX: 0, gridY: 4 },
    { gridX: 5, gridY: -1 },
    { gridX: -3, gridY: 0 },
    { gridX: 2, gridY: 5 },
  ]
  const pos = positions[nextGridSlot % positions.length]
  nextGridSlot++
  return pos
}

// 执行结果类型
export interface NexusExecutionResult {
  nexusId: string
  nexusName: string
  status: 'success' | 'error'
  output?: string
  error?: string
  timestamp: number
}

export interface WorldSlice {
  // State
  nexuses: Map<string, NexusEntity>
  camera: CameraState
  selectedNexusId: string | null
  activeNexusId: string | null
  renderSettings: RenderSettings
  // 执行状态追踪
  executingNexusId: string | null
  executionStartTime: number | null
  lastExecutionResult: NexusExecutionResult | null

  // Nexus Actions
  addNexus: (nexus: NexusEntity) => void
  removeNexus: (id: string) => void
  updateNexusXP: (id: string, xp: number) => void
  updateNexusPosition: (id: string, position: GridPosition) => void
  selectNexus: (id: string | null) => void
  setActiveNexus: (id: string | null) => void
  setNexusesFromServer: (nexuses: Array<Partial<NexusEntity> & { id: string; name?: string; description?: string; sopContent?: string }>) => void
  tickConstructionAnimations: (deltaMs: number) => void

  // Camera Actions
  setCameraPosition: (x: number, y: number) => void
  panCamera: (dx: number, dy: number) => void
  setZoom: (zoom: number) => void
  focusOnNexus: (id: string) => void

  // Settings
  setRenderSettings: (settings: Partial<RenderSettings>) => void

  // Execution Actions
  startNexusExecution: (nexusId: string) => void
  completeNexusExecution: (nexusId: string, result: Omit<NexusExecutionResult, 'nexusId' | 'nexusName' | 'timestamp'>) => void
}

export const createWorldSlice: StateCreator<WorldSlice> = (set, get) => ({
  // 初始状态
  nexuses: createDemoNexuses(),
  camera: { x: 0, y: 0, zoom: 1 },
  selectedNexusId: null,
  activeNexusId: null,
  renderSettings: {
    showGrid: true,
    showParticles: true,
    showLabels: true,
    enableGlow: true,
  },
  // 执行状态初始值
  executingNexusId: null,
  executionStartTime: null,
  lastExecutionResult: null,

  // ---- Nexus Actions ----

  addNexus: (nexus) => set((state) => {
    const next = new Map(state.nexuses)
    next.set(nexus.id, nexus)
    return { nexuses: next }
  }),

  removeNexus: (id) => set((state) => {
    const next = new Map(state.nexuses)
    next.delete(id)
    return {
      nexuses: next,
      selectedNexusId: state.selectedNexusId === id ? null : state.selectedNexusId,
      activeNexusId: state.activeNexusId === id ? null : state.activeNexusId,
    }
  }),

  updateNexusXP: (id, xp) => set((state) => {
    const nexus = state.nexuses.get(id)
    if (!nexus) return state
    const next = new Map(state.nexuses)
    const newLevel = xpToLevel(xp)
    next.set(id, { ...nexus, xp, level: newLevel })
    return { nexuses: next }
  }),

  updateNexusPosition: (id, position) => set((state) => {
    const nexus = state.nexuses.get(id)
    if (!nexus) return state
    const next = new Map(state.nexuses)
    next.set(id, { ...nexus, position })
    return { nexuses: next }
  }),

  selectNexus: (id) => set({ selectedNexusId: id }),

  setActiveNexus: (id) => set({ activeNexusId: id }),

  setNexusesFromServer: (nexuses) => set((state) => {
    const next = new Map(state.nexuses)
    for (const serverNexus of nexuses) {
      const existing = next.get(serverNexus.id)
      const archetype = (serverNexus.archetype || 'REACTOR') as NexusArchetype
      const xp = serverNexus.xp || 0

      // 构建 VisualDNA：优先使用服务器提供的 visual_dna，否则从 ID 生成
      let visualDNA: VisualDNA
      const serverVDNA = serverNexus.visualDNA
      if (serverVDNA && typeof serverVDNA === 'object' && 'primaryHue' in serverVDNA) {
        visualDNA = {
          primaryHue: serverVDNA.primaryHue ?? 180,
          primarySaturation: serverVDNA.primarySaturation ?? 70,
          primaryLightness: serverVDNA.primaryLightness ?? 50,
          accentHue: serverVDNA.accentHue ?? 240,
          archetype,
          textureMode: serverVDNA.textureMode ?? 'solid',
          glowIntensity: serverVDNA.glowIntensity ?? 0.7,
          geometryVariant: serverVDNA.geometryVariant ?? 0,
        }
      } else {
        visualDNA = existing?.visualDNA || simpleVisualDNA(serverNexus.id, archetype)
      }

      next.set(serverNexus.id, {
        // 保留前端已有的状态 (position, constructionProgress 等)
        ...existing,
        // 从服务器合并的数据
        id: serverNexus.id,
        archetype,
        position: existing?.position || assignGridPosition(),
        level: xpToLevel(xp),
        xp,
        visualDNA,
        label: serverNexus.label || serverNexus.name || serverNexus.id,
        constructionProgress: existing?.constructionProgress ?? 1,
        createdAt: existing?.createdAt || Date.now(),
        // 映射 skillDependencies 到 boundSkillIds
        boundSkillIds: serverNexus.skillDependencies || serverNexus.boundSkillIds || [],
        flavorText: serverNexus.flavorText || serverNexus.description || '',
        // Phase 4: File-based Nexus fields
        sopContent: serverNexus.sopContent,
        skillDependencies: serverNexus.skillDependencies,
        triggers: serverNexus.triggers,
        version: serverNexus.version,
        location: serverNexus.location,
        path: serverNexus.path,
        // Phase 5: 目标函数驱动 (Objective-Driven Execution)
        objective: serverNexus.objective,
        metrics: serverNexus.metrics,
        strategy: serverNexus.strategy,
      })
    }
    return { nexuses: next }
  }),

  tickConstructionAnimations: (deltaMs) => set((state) => {
    let changed = false
    const next = new Map(state.nexuses)
    for (const [id, nexus] of next) {
      if (nexus.constructionProgress < 1) {
        changed = true
        const progress = Math.min(1, nexus.constructionProgress + deltaMs / 3000)
        next.set(id, { ...nexus, constructionProgress: progress })
      }
    }
    return changed ? { nexuses: next } : state
  }),

  // ---- Camera Actions ----

  setCameraPosition: (x, y) => set({ camera: { ...get().camera, x, y } }),

  panCamera: (dx, dy) => set((state) => ({
    camera: {
      ...state.camera,
      x: state.camera.x + dx,
      y: state.camera.y + dy,
    },
  })),

  setZoom: (zoom) => set((state) => ({
    camera: {
      ...state.camera,
      zoom: Math.max(0.5, Math.min(2.0, zoom)),
    },
  })),

  focusOnNexus: (id) => {
    const nexus = get().nexuses.get(id)
    if (!nexus) return
    const { gridX, gridY } = nexus.position
    // ISO 投影：将 grid 坐标转为世界中心偏移
    const worldX = (gridX - gridY) * TILE_WIDTH / 2
    const worldY = (gridX + gridY) * TILE_HEIGHT / 2
    set({
      camera: { ...get().camera, x: -worldX, y: -worldY },
      selectedNexusId: id,
    })
  },

  // ---- Settings ----

  setRenderSettings: (settings) => set((state) => ({
    renderSettings: { ...state.renderSettings, ...settings },
  })),

  // ---- Execution Actions ----

  startNexusExecution: (nexusId) => set({
    executingNexusId: nexusId,
    executionStartTime: Date.now(),
  }),

  completeNexusExecution: (nexusId, result) => set((state) => {
    // 仅当完成的是当前正在执行的 Nexus 时才更新
    if (state.executingNexusId !== nexusId) return state
    const nexus = state.nexuses.get(nexusId)
    return {
      executingNexusId: null,
      executionStartTime: null,
      lastExecutionResult: {
        nexusId,
        nexusName: nexus?.label || nexusId,
        status: result.status,
        output: result.output,
        error: result.error,
        timestamp: Date.now(),
      },
    }
  }),
})
