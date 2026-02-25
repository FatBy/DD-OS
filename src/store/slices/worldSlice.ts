import type { StateCreator } from 'zustand'
import type { NexusEntity, CameraState, GridPosition, RenderSettings, VisualDNA, BuildingConfig } from '@/types'
import type { WorldTheme } from '@/rendering/types'
import { getCityBlockSystem } from '@/rendering/isometric/CityBlockSystem'

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

// 建筑配置生成数组
const BODY_TYPES = ['office', 'lab', 'factory', 'library', 'tower', 'warehouse']
const ROOF_TYPES = ['flat', 'dome', 'antenna', 'satellite', 'chimney', 'garden']
const BASE_TYPES = ['concrete', 'steel', 'glass', 'stone']
const PLANET_TEXTURES = ['bands', 'storm', 'core', 'crystal'] as const

// 简易同步哈希 -> VisualDNA (不依赖 crypto.subtle)
export function simpleVisualDNA(id: string): VisualDNA {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  }
  const h = Math.abs(hash)
  
  const primaryHue = h % 360
  const geometryVariant = h % 4
  
  // 动态生成建筑配置
  const buildingConfig: BuildingConfig = {
    base: BASE_TYPES[h % BASE_TYPES.length],
    body: BODY_TYPES[(h >> 2) % BODY_TYPES.length],
    roof: ROOF_TYPES[(h >> 4) % ROOF_TYPES.length],
    themeColor: `hsl(${primaryHue}, 70%, 50%)`,
  }
  
  return {
    primaryHue,
    primarySaturation: 50 + (h >> 8) % 40,
    primaryLightness: 35 + (h >> 16) % 30,
    accentHue: (primaryHue + 60) % 360,
    textureMode: 'solid',
    glowIntensity: 0.5 + ((h >> 4) % 50) / 100,
    geometryVariant,
    planetTexture: PLANET_TEXTURES[geometryVariant],
    ringCount: 1 + (h >> 6) % 3,
    ringTilts: [0.15, -0.3, 0.1].slice(0, 1 + (h >> 6) % 3),
    buildingConfig,
  }
}

// 初始状态: 从 localStorage 加载或空世界
function createDemoNexuses(): Map<string, NexusEntity> {
  return loadNexusesFromStorage()
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
  worldTheme: 'minimalist' as WorldTheme,
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
    
    // 使用地块系统吸附位置到地块中心
    const blockSystem = getCityBlockSystem()
    const snappedPos = blockSystem.snapToBlockCenter(position.gridX, position.gridY)
    const snappedPosition = { gridX: snappedPos.isoX, gridY: snappedPos.isoY }
    
    const next = new Map(state.nexuses)
    next.set(id, { ...nexus, position: snappedPosition })
    saveNexusesToStorage(next)
    return { nexuses: next }
  }),

  selectNexus: (id) => set({ selectedNexusId: id }),

  setActiveNexus: (id) => set({ activeNexusId: id }),

  setNexusesFromServer: (nexuses) => set((state) => {
    const next = new Map(state.nexuses)
    const blockSystem = getCityBlockSystem()
    
    // 清空地块系统，重新分配
    blockSystem.clear()
    
    for (const serverNexus of nexuses) {
      const existing = next.get(serverNexus.id)
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
          textureMode: serverVDNA.textureMode ?? 'solid',
          glowIntensity: serverVDNA.glowIntensity ?? 0.7,
          geometryVariant: serverVDNA.geometryVariant ?? 0,
        }
      } else {
        visualDNA = existing?.visualDNA || simpleVisualDNA(serverNexus.id)
      }

      // 强制重新分配地块位置（确保每个 Nexus 独占一个地块）
      const block = blockSystem.allocateBlock(serverNexus.id, 
        existing?.position?.gridX ?? 0, 
        existing?.position?.gridY ?? 0
      )
      const snappedPosition = { gridX: block.centerIsoX, gridY: block.centerIsoY }

      next.set(serverNexus.id, {
        // 保留前端已有的状态 (constructionProgress 等)
        ...existing,
        // 从服务器合并的数据
        id: serverNexus.id,
        position: snappedPosition,  // 使用吸附后的位置
        level: xpToLevel(xp),
        xp,
        visualDNA,
        label: serverNexus.label || serverNexus.name || serverNexus.id,
        constructionProgress: existing?.constructionProgress ?? 1,
        createdAt: existing?.createdAt || Date.now(),
        // 统一使用 boundSkillIds
        boundSkillIds: serverNexus.boundSkillIds || [],
        flavorText: serverNexus.flavorText || serverNexus.description || '',
        // Phase 4: File-based Nexus fields
        sopContent: serverNexus.sopContent,
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
