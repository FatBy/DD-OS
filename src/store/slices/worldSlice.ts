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
function simpleVisualDNA(id: string, archetype: NexusArchetype): VisualDNA {
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

// 初始演示建筑
function createDemoNexuses(): Map<string, NexusEntity> {
  const map = new Map<string, NexusEntity>()
  const demos: Array<{ id: string; arch: NexusArchetype; gx: number; gy: number; lv: number; xp: number }> = [
    { id: 'demo-monolith', arch: 'MONOLITH', gx: 0, gy: 0, lv: 3, xp: 120 },
    { id: 'demo-spire', arch: 'SPIRE', gx: 5, gy: 2, lv: 2, xp: 40 },
    { id: 'demo-reactor', arch: 'REACTOR', gx: -4, gy: 4, lv: 4, xp: 600 },
    { id: 'demo-vault', arch: 'VAULT', gx: 2, gy: -4, lv: 1, xp: 5 },
  ]
  for (const d of demos) {
    map.set(d.id, {
      id: d.id,
      archetype: d.arch,
      position: { gridX: d.gx, gridY: d.gy },
      level: d.lv,
      xp: d.xp,
      visualDNA: simpleVisualDNA(d.id, d.arch),
      constructionProgress: 1,
      createdAt: Date.now(),
    })
  }
  return map
}

export interface WorldSlice {
  // State
  nexuses: Map<string, NexusEntity>
  camera: CameraState
  selectedNexusId: string | null
  renderSettings: RenderSettings

  // Nexus Actions
  addNexus: (nexus: NexusEntity) => void
  removeNexus: (id: string) => void
  updateNexusXP: (id: string, xp: number) => void
  updateNexusPosition: (id: string, position: GridPosition) => void
  selectNexus: (id: string | null) => void
  tickConstructionAnimations: (deltaMs: number) => void

  // Camera Actions
  setCameraPosition: (x: number, y: number) => void
  panCamera: (dx: number, dy: number) => void
  setZoom: (zoom: number) => void
  focusOnNexus: (id: string) => void

  // Settings
  setRenderSettings: (settings: Partial<RenderSettings>) => void
}

export const createWorldSlice: StateCreator<WorldSlice> = (set, get) => ({
  // 初始状态
  nexuses: createDemoNexuses(),
  camera: { x: 0, y: 0, zoom: 1 },
  selectedNexusId: null,
  renderSettings: {
    showGrid: true,
    showParticles: true,
    showLabels: true,
    enableGlow: true,
  },

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
})
