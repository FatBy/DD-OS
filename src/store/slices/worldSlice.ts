import type { StateCreator } from 'zustand'
import type { NexusEntity, CameraState, GridPosition, RenderSettings, NexusArchetype, VisualDNA } from '@/types'
import type { WorldTheme } from '@/rendering/types'

// XP 等级阈值
const XP_THRESHOLDS = [0, 20, 100, 500] as const

// localStorage key for Nexus persistence
const NEXUS_STORAGE_KEY = 'ddos_nexuses'

export function xpToLevel(xp: number): number {
  for (let i = XP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= XP_THRESHOLDS[i]) return i + 1
  }
  return 1
}

// ---- localStorage 持久化 ----

function saveNexusesToStorage(nexuses: Map<string, NexusEntity>): void {
  try {
    const arr = Array.from(nexuses.values())
    localStorage.setItem(NEXUS_STORAGE_KEY, JSON.stringify(arr))
  } catch (e) {
    console.warn('[WorldSlice] Failed to save nexuses to localStorage:', e)
  }
}

function loadNexusesFromStorage(): Map<string, NexusEntity> {
  try {
    const saved = localStorage.getItem(NEXUS_STORAGE_KEY)
    if (saved) {
      const arr: NexusEntity[] = JSON.parse(saved)
      const map = new Map<string, NexusEntity>()
      for (const nexus of arr) {
        map.set(nexus.id, nexus)
      }
      return map
    }
  } catch (e) {
    console.warn('[WorldSlice] Failed to load nexuses from localStorage:', e)
  }
  return new Map<string, NexusEntity>()
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

// 初始状态: 从 localStorage 加载或空世界
function createDemoNexuses(): Map<string, NexusEntity> {
  return loadNexusesFromStorage()
}

// 用于从服务器数据自动分配 grid 位置（考虑已存在的位置避免重叠）
const PREDEFINED_POSITIONS: GridPosition[] = [
  { gridX: 3, gridY: -2 },
  { gridX: -2, gridY: 3 },
  { gridX: 4, gridY: 1 },
  { gridX: -1, gridY: -3 },
  { gridX: 0, gridY: 4 },
  { gridX: 5, gridY: -1 },
  { gridX: -3, gridY: 0 },
  { gridX: 2, gridY: 5 },
  { gridX: -4, gridY: 2 },
  { gridX: 1, gridY: -4 },
  { gridX: 6, gridY: 2 },
  { gridX: -2, gridY: -2 },
]

function assignGridPosition(existingNexuses: Map<string, NexusEntity>): GridPosition {
  // 收集已占用的位置
  const occupied = new Set<string>()
  for (const nexus of existingNexuses.values()) {
    if (nexus.position) {
      occupied.add(`${nexus.position.gridX},${nexus.position.gridY}`)
    }
  }
  
  // 找到第一个未被占用的预定义位置
  for (const pos of PREDEFINED_POSITIONS) {
    const key = `${pos.gridX},${pos.gridY}`
    if (!occupied.has(key)) {
      return pos
    }
  }
  
  // 所有预定义位置都被占用时，生成随机位置
  const randomOffset = () => Math.floor(Math.random() * 10) - 5
  return {
    gridX: randomOffset() + 7,
    gridY: randomOffset() - 5,
  }
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
  worldTheme: WorldTheme
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
  setWorldTheme: (theme: WorldTheme) => void

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
  worldTheme: 'cosmos' as WorldTheme,
  // 执行状态初始值
  executingNexusId: null,
  executionStartTime: null,
  lastExecutionResult: null,

  // ---- Nexus Actions ----

  addNexus: (nexus) => set((state) => {
    const next = new Map(state.nexuses)
    next.set(nexus.id, nexus)
    saveNexusesToStorage(next)
    return { nexuses: next }
  }),

  removeNexus: (id) => set((state) => {
    const next = new Map(state.nexuses)
    next.delete(id)
    saveNexusesToStorage(next)
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
    saveNexusesToStorage(next)
    return { nexuses: next }
  }),

  updateNexusPosition: (id, position) => set((state) => {
    const nexus = state.nexuses.get(id)
    if (!nexus) return state
    const next = new Map(state.nexuses)
    next.set(id, { ...nexus, position })
    saveNexusesToStorage(next)
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
        position: existing?.position || assignGridPosition(next),
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
    saveNexusesToStorage(next)
    return { nexuses: next }
  }),

  tickConstructionAnimations: (deltaMs) => set((state) => {
    let changed = false
    let anyCompleted = false
    const next = new Map(state.nexuses)
    for (const [id, nexus] of next) {
      if (nexus.constructionProgress < 1) {
        changed = true
        const progress = Math.min(1, nexus.constructionProgress + deltaMs / 3000)
        next.set(id, { ...nexus, constructionProgress: progress })
        if (progress >= 1) anyCompleted = true
      }
    }
    // 仅在有建造完成时保存到 localStorage（避免频繁写入）
    if (anyCompleted) {
      saveNexusesToStorage(next)
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

  setWorldTheme: (theme) => set({ worldTheme: theme }),

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
