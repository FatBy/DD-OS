import type { StateCreator } from 'zustand'
import type { DunEntity, CameraState, GridPosition, RenderSettings, VisualDNA, DunScoring, DunLLMBinding } from '@/types'
import { createInitialScoring } from '@/types'
import { normalizeScoring } from '@/services/dunScoringService'
import type { WorldTheme } from '@/rendering/types'
import { localServerService } from '@/services/localServerService'
import { assignUniqueSpecies } from '@/components/dashboard/dunGrowth'
import type { AnimalSpecies } from '@/components/dashboard/dunGrowth'

/** 建造动画总时长 (ms) */
const CONSTRUCTION_DURATION_MS = 3000

/**
 * 基于 createdAt 时间戳计算建造进度 (0~1)
 * 无论 tick 循环是否运行、页面是否刷新，进度始终正确
 */
export function getConstructionProgress(dun: DunEntity): number {
  // constructionProgress === 1 说明已标记完成，直接返回
  if (dun.constructionProgress >= 1) return 1
  // 如果 constructionProgress 已经是 1 (旧数据)
  const elapsed = Date.now() - dun.createdAt
  if (elapsed >= CONSTRUCTION_DURATION_MS) return 1
  return Math.min(1, elapsed / CONSTRUCTION_DURATION_MS)
}

// 后端数据键名
const DATA_KEY_DUNS = 'duns_state'
const DATA_KEY_DELETED_DUN_IDS = 'deleted_dun_ids'

// localStorage key for Dun persistence (备份/缓存)
const DUN_STORAGE_KEY = 'duncrew_duns'

// localStorage key for deleted Dun IDs (防止文件系统 Dun 被重新加载)
const DELETED_DUN_IDS_KEY = 'duncrew_deleted_dun_ids'

/** 解析 Dun 的显示名称，按优先级取第一个有效值 */
function resolveDunLabel(serverLabel: string | undefined, name: string | undefined, existingLabel: string | undefined, id: string): string {
  return serverLabel || name || existingLabel || id
}

// 区分"首次加载"和"运行时新增"：首次加载时新 Dun 直接显示，运行时新增播放建造动画
let _initialLoadDone = false

// P0-PERF: tickConstructionAnimations 节流 —— 100ms 内最多更新一次
let _lastTickTime = 0

// ---- 持久化函数 (后端 + localStorage 双写) ----

function loadDeletedDunIds(): Set<string> {
  try {
    // 迁移逻辑：如果旧键存在但新键不存在，迁移数据
    const oldKey = 'duncrew_deleted_nexus_ids'
    const oldData = localStorage.getItem(oldKey)
    if (oldData && !localStorage.getItem(DELETED_DUN_IDS_KEY)) {
      localStorage.setItem(DELETED_DUN_IDS_KEY, oldData)
      localStorage.removeItem(oldKey)
      console.log('[WorldSlice] Migrated localStorage: duncrew_deleted_nexus_ids → duncrew_deleted_dun_ids')
    }
    
    const saved = localStorage.getItem(DELETED_DUN_IDS_KEY)
    if (saved) return new Set(JSON.parse(saved))
  } catch { /* ignore */ }
  return new Set()
}

function saveDeletedDunIds(ids: Set<string>): void {
  try {
    const arr = [...ids]
    // 同步写入 localStorage（快速缓存）
    localStorage.setItem(DELETED_DUN_IDS_KEY, JSON.stringify(arr))
    // 异步写入后端（持久化，防止 localStorage 被清除后丢失）
    localServerService.setData(DATA_KEY_DELETED_DUN_IDS, arr).catch(() => {
      console.warn('[WorldSlice] Failed to save deleted dun ids to server')
    })
  } catch { /* ignore */ }
}

function saveDunsToStorage(duns: Map<string, DunEntity>): void {
  try {
    const arr = Array.from(duns.values())
    // 同步写入 localStorage (快速缓存)
    localStorage.setItem(DUN_STORAGE_KEY, JSON.stringify(arr))
    // 异步写入后端 (持久化)
    localServerService.setData(DATA_KEY_DUNS, arr).catch(() => {
      console.warn('[WorldSlice] Failed to save duns to server')
    })
  } catch (e) {
    console.warn('[WorldSlice] Failed to save duns to localStorage:', e)
  }
}

function loadDunsFromStorage(): Map<string, DunEntity> {
  try {
    // 迁移逻辑：如果旧键存在但新键不存在，迁移数据
    const oldKey = 'duncrew_nexuses'
    const oldData = localStorage.getItem(oldKey)
    if (oldData && !localStorage.getItem(DUN_STORAGE_KEY)) {
      localStorage.setItem(DUN_STORAGE_KEY, oldData)
      localStorage.removeItem(oldKey)
      console.log('[WorldSlice] Migrated localStorage: duncrew_nexuses → duncrew_duns')
    }
    
    const saved = localStorage.getItem(DUN_STORAGE_KEY)
    if (saved) {
      const arr: DunEntity[] = JSON.parse(saved)
      const map = new Map<string, DunEntity>()
      
      // 同 label 去重：如果多个实体有相同 label，保留有 SOP/技能的那个
      const labelMap = new Map<string, DunEntity>()
      for (const dun of arr) {
        const label = dun.label || dun.id
        const existing = labelMap.get(label)
        if (!existing) {
          labelMap.set(label, dun)
          map.set(dun.id, dun)
        } else {
          // 比较丰富度：SOP 长度 + 技能数
          const existingScore = (existing.sopContent?.length || 0) + (existing.boundSkillIds?.length || 0) * 100
          const newScore = (dun.sopContent?.length || 0) + (dun.boundSkillIds?.length || 0) * 100
          if (newScore > existingScore) {
            // 新实体更丰富：替换旧的，并合并 scoring
            map.delete(existing.id)
            const bestScoring = (dun.scoring?.totalRuns ?? 0) >= (existing.scoring?.totalRuns ?? 0) ? dun.scoring : existing.scoring
            map.set(dun.id, { ...dun, scoring: bestScoring || dun.scoring })
            labelMap.set(label, dun)
          } else {
            // 旧的更丰富：跳过新的，但合并 scoring
            const bestScoring = (existing.scoring?.totalRuns ?? 0) >= (dun.scoring?.totalRuns ?? 0) ? existing.scoring : dun.scoring
            if (bestScoring && (bestScoring.totalRuns ?? 0) > (existing.scoring?.totalRuns ?? 0)) {
              map.set(existing.id, { ...existing, scoring: bestScoring })
            }
          }
        }
      }
      return map
    }
  } catch (e) {
    console.warn('[WorldSlice] Failed to load duns from localStorage:', e)
  }
  return new Map<string, DunEntity>()
}

// ISO 投影常量
const TILE_WIDTH = 128
const TILE_HEIGHT = 64

// 简易同步哈希 -> VisualDNA (不依赖 crypto.subtle)
export function simpleVisualDNA(id: string): VisualDNA {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  }
  const h = Math.abs(hash)
  
  const primaryHue = h % 360
  const geometryVariant = h % 4
  
  return {
    primaryHue,
    primarySaturation: 50 + (h >> 8) % 40,
    primaryLightness: 35 + (h >> 16) % 30,
    accentHue: (primaryHue + 60) % 360,
    textureMode: 'solid',
    glowIntensity: 0.5 + ((h >> 4) % 50) / 100,
    geometryVariant,
  }
}

// 初始状态: 从 localStorage 加载或空世界
function createDemoDuns(): Map<string, DunEntity> {
  return loadDunsFromStorage()
}

// 执行结果类型
export interface DunExecutionResult {
  dunId: string
  dunName: string
  status: 'success' | 'error'
  output?: string
  error?: string
  timestamp: number
}

export interface WorldSlice {
  // State
  duns: Map<string, DunEntity>
  camera: CameraState
  selectedDunId: string | null
  activeDunId: string | null
  renderSettings: RenderSettings
  worldTheme: WorldTheme
  // 执行状态追踪
  executingDunId: string | null
  executionStartTime: number | null
  lastExecutionResult: DunExecutionResult | null

  // Dun Actions
  addDun: (dun: DunEntity) => void
  removeDun: (id: string) => void
  updateDun: (id: string, updates: Partial<DunEntity>) => void
  updateDunScoring: (id: string, scoring: DunScoring) => void
  updateDunPosition: (id: string, position: GridPosition) => void
  selectDun: (id: string | null) => void
  setActiveDun: (id: string | null) => void
  setDunsFromServer: (duns: Array<Partial<DunEntity> & { id: string; name?: string; description?: string; sopContent?: string }>) => void
  tickConstructionAnimations: (deltaMs: number) => void

  // Camera Actions
  setCameraPosition: (x: number, y: number) => void
  panCamera: (dx: number, dy: number) => void
  setZoom: (zoom: number) => void
  focusOnDun: (id: string) => void

  // Settings
  setRenderSettings: (settings: Partial<RenderSettings>) => void
  setWorldTheme: (theme: WorldTheme) => void

  // Execution Actions
  startDunExecution: (dunId: string) => void
  completeDunExecution: (dunId: string, result: Omit<DunExecutionResult, 'dunId' | 'dunName' | 'timestamp'>) => void

  // Skill Binding (Agent 通过 Extension 绑定技能)
  bindSkillToDun: (dunId: string, skillName: string) => void
  unbindSkillFromDun: (dunId: string, skillName: string) => void

  // Per-Dun LLM Binding
  saveDunLLMBinding: (dunId: string, binding: DunLLMBinding | null) => Promise<void>

  // 从后端加载数据 (应用启动后调用)
  loadDunsFromServer: () => Promise<void>
  
  // OpenClaw agents → DunCrew Duns 同步
  syncAgentsAsDuns: (agents: Array<{ id: string; name?: string; identity?: { name?: string; emoji?: string } }>, skills: Array<{ name: string; description?: string; status?: string }>) => void
}

export const createWorldSlice: StateCreator<WorldSlice> = (set, get) => ({
  // 初始状态
  duns: createDemoDuns(),
  camera: { x: 0, y: 0, zoom: 1 },
  selectedDunId: null,
  activeDunId: null,
  renderSettings: {
    showGrid: true,
    showParticles: true,
    showLabels: true,
    enableGlow: true,
  },
  worldTheme: 'dashboard' as WorldTheme,
  // 执行状态初始值
  executingDunId: null,
  executionStartTime: null,
  lastExecutionResult: null,

  // ---- Dun Actions ----

  addDun: (dun) => set((state) => {
    const next = new Map(state.duns)
    next.set(dun.id, { ...dun, updatedAt: Date.now() })
    saveDunsToStorage(next)
    // 从已删除列表中移除（处理 removeDun+addDun 更新模式）
    const deleted = loadDeletedDunIds()
    if (deleted.has(dun.id)) {
      deleted.delete(dun.id)
      saveDeletedDunIds(deleted)
    }
    return { duns: next }
  }),

  removeDun: (id) => set((state) => {
    const next = new Map(state.duns)
    next.delete(id)
    saveDunsToStorage(next)
    // 记录已删除的 ID，防止文件系统 Dun 被重新加载
    const deleted = loadDeletedDunIds()
    deleted.add(id)
    saveDeletedDunIds(deleted)
    // 异步通知后端归档文件系统上的 DUN.md 目录（防止再次被扫描到）
    const serverUrl = localServerService.getServerUrl()
    fetch(`${serverUrl}/duns/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {
      console.warn('[WorldSlice] Failed to archive dun on server:', id)
    })
    return {
      duns: next,
      selectedDunId: state.selectedDunId === id ? null : state.selectedDunId,
      activeDunId: state.activeDunId === id ? null : state.activeDunId,
    }
  }),

  updateDun: (id, updates) => set((state) => {
    const dun = state.duns.get(id)
    if (!dun) return state
    const next = new Map(state.duns)
    next.set(id, { ...dun, ...updates, updatedAt: Date.now() })
    saveDunsToStorage(next)
    return { duns: next }
  }),

  updateDunScoring: (id, scoring) => set((state) => {
    const dun = state.duns.get(id)
    if (!dun) return state
    const next = new Map(state.duns)
    next.set(id, { ...dun, scoring, updatedAt: Date.now() })
    saveDunsToStorage(next)
    return { duns: next }
  }),

  bindSkillToDun: (dunId, skillName) => set((state) => {
    const dun = state.duns.get(dunId)
    if (!dun) return state
    const existing = dun.boundSkillIds || []
    if (existing.includes(skillName)) return state
    const next = new Map(state.duns)
    next.set(dunId, { ...dun, boundSkillIds: [...existing, skillName], updatedAt: Date.now() })
    saveDunsToStorage(next)
    return { duns: next }
  }),

  unbindSkillFromDun: (dunId, skillName) => set((state) => {
    const dun = state.duns.get(dunId)
    if (!dun) return state
    const existing = dun.boundSkillIds || []
    if (!existing.includes(skillName)) return state
    const next = new Map(state.duns)
    next.set(dunId, { ...dun, boundSkillIds: existing.filter(s => s !== skillName), updatedAt: Date.now() })
    saveDunsToStorage(next)
    return { duns: next }
  }),

  saveDunLLMBinding: async (dunId, binding) => {
    const baseUrl = localServerService.getServerUrl()
    const res = await fetch(`${baseUrl}/duns/${encodeURIComponent(dunId)}/llm-binding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(binding ? {
        providerId: binding.providerId,
        modelId: binding.modelId,
        ...(binding.temperature != null ? { temperature: binding.temperature } : {}),
      } : null),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`保存 LLM Binding 失败: HTTP ${res.status} ${errText}`)
    }
    // 更新 store
    set((state) => {
      const dun = state.duns.get(dunId)
      if (!dun) return state
      const next = new Map(state.duns)
      next.set(dunId, { ...dun, llmBinding: binding ?? undefined, updatedAt: Date.now() })
      saveDunsToStorage(next)
      return { duns: next }
    })
  },

  updateDunPosition: (id, position) => set((state) => {
    const dun = state.duns.get(id)
    if (!dun) return state
    
    // 简单网格吸附
    const snappedPosition = { gridX: Math.round(position.gridX), gridY: Math.round(position.gridY) }
    
    const next = new Map(state.duns)
    next.set(id, { ...dun, position: snappedPosition, updatedAt: Date.now() })
    saveDunsToStorage(next)
    return { duns: next }
  }),

  selectDun: (id) => set({ selectedDunId: id }),

  setActiveDun: (id) => set({ activeDunId: id }),

  setDunsFromServer: (serverDuns) => set((state) => {
    const next = new Map(state.duns)
    
    // 加载已删除的 Dun ID 列表，跳过被用户手动删除的 Dun
    const deletedIds = loadDeletedDunIds()
    
    // 使用已占用位置集合来避免重叠
    const usedPositions = new Set<string>()
    for (const [, n] of next) {
      usedPositions.add(`${n.position.gridX},${n.position.gridY}`)
    }
    
    let autoIdx = 0
    
    for (const serverDun of serverDuns) {
      // 跳过用户已手动删除的 Dun（防止文件系统 Dun 被重新加载）
      if (deletedIds.has(serverDun.id)) continue
      
      const existing = next.get(serverDun.id)

      // V2: 合并 scoring (本地已有分数优先，防止服务器空数据覆盖)
      const serverScoring = serverDun.scoring
      const hasRealServerScoring = serverScoring && typeof serverScoring === 'object' && (serverScoring.score > 0 || serverScoring.totalRuns > 0)
      const scoring = hasRealServerScoring ? normalizeScoring(serverScoring as unknown as Record<string, unknown>) : (existing?.scoring || createInitialScoring())

      // 构建 VisualDNA：优先使用服务器提供的 visual_dna，否则从 ID 生成
      let visualDNA: VisualDNA
      const serverVDNA = serverDun.visualDNA
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
        visualDNA = existing?.visualDNA || simpleVisualDNA(serverDun.id)
      }

      // 位置分配：优先保留已有位置，否则按网格递增分配
      let position = existing?.position
      if (!position || (position.gridX === 0 && position.gridY === 0 && usedPositions.has('0,0'))) {
        // 简单行布局：每行5个，间距2
        let gx = 0, gy = 0
        do {
          autoIdx++
          gx = (autoIdx % 5) * 2 - 4
          gy = Math.floor(autoIdx / 5) * 2 - 2
        } while (usedPositions.has(`${gx},${gy}`))
        position = { gridX: gx, gridY: gy }
      }
      usedPositions.add(`${position.gridX},${position.gridY}`)

      // species 分配：优先保留已有，否则分配唯一种族
      const usedSpecies = new Set<AnimalSpecies>()
      for (const [did, d] of next) {
        if (did !== serverDun.id && d.species) usedSpecies.add(d.species as AnimalSpecies)
      }
      const species = existing?.species || assignUniqueSpecies(serverDun.id, usedSpecies)

      next.set(serverDun.id, {
        // 保留前端已有的状态 (constructionProgress 等)
        ...existing,
        // 从服务器合并的数据
        id: serverDun.id,
        position,
        scoring,
        visualDNA,
        species,
        label: serverDun.label || serverDun.name || serverDun.id,
        constructionProgress: existing?.constructionProgress ?? (_initialLoadDone ? 0 : 1),
        createdAt: existing?.createdAt || Date.now(),
        // 统一使用 boundSkillIds (后端字段名为 skillDependencies)
        boundSkillIds: (serverDun as any).skillDependencies || serverDun.boundSkillIds || [],
        flavorText: serverDun.flavorText || (serverDun as any).description || '',
        // Phase 4: File-based Dun fields
        sopContent: serverDun.sopContent,
        triggers: serverDun.triggers,
        version: serverDun.version,
        location: serverDun.location,
        path: serverDun.path,
        projectPath: (serverDun as any).projectPath || existing?.projectPath,
        // Phase 5: 目标函数驱动 (Objective-Driven Execution)
        objective: serverDun.objective,
        metrics: serverDun.metrics,
        strategy: serverDun.strategy,
        skillsConfirmed: (serverDun as any).skillsConfirmed || existing?.skillsConfirmed || false,
        // Phase 6: Per-Dun LLM Binding
        llmBinding: (serverDun as any).llmBinding || existing?.llmBinding,
      })
    }
    saveDunsToStorage(next)
    return { duns: next }
  }),

  tickConstructionAnimations: (_deltaMs) => set((state) => {
    // P0-PERF: 100ms 节流，避免每帧创建新 Map
    const now = Date.now()
    if (now - _lastTickTime < 100) {
      return state
    }
    _lastTickTime = now

    // V2: 基于 createdAt 时间戳判定建造完成，不再依赖逐帧递增
    // 此函数只负责将已超时的 Dun 标记为 constructionProgress=1 并持久化
    let anyCompleted = false
    let hasBuilding = false
    const next = new Map(state.duns)

    for (const [id, dun] of next) {
      if (dun.constructionProgress < 1) {
        const elapsed = now - dun.createdAt
        if (elapsed >= CONSTRUCTION_DURATION_MS) {
          // 时间已到，标记为完成
          next.set(id, { ...dun, constructionProgress: 1 })
          anyCompleted = true
        } else {
          hasBuilding = true
        }
      }
    }

    if (anyCompleted) {
      saveDunsToStorage(next)
      return { duns: next }
    }
    // 仍有建造中但未完成的 → 需要触发重渲染让 UI 显示实时进度
    // 返回新 Map 引用来触发 Zustand 通知
    if (hasBuilding) {
      return { duns: new Map(state.duns) }
    }
    return state
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

  focusOnDun: (id) => {
    const dun = get().duns.get(id)
    if (!dun) return
    const { gridX, gridY } = dun.position
    // ISO 投影：将 grid 坐标转为世界中心偏移
    const worldX = (gridX - gridY) * TILE_WIDTH / 2
    const worldY = (gridX + gridY) * TILE_HEIGHT / 2
    set({
      camera: { ...get().camera, x: -worldX, y: -worldY },
      selectedDunId: id,
    })
  },

  // ---- Settings ----

  setRenderSettings: (settings) => set((state) => ({
    renderSettings: { ...state.renderSettings, ...settings },
  })),

  setWorldTheme: (theme) => set({ worldTheme: theme }),

  // ---- Execution Actions ----

  startDunExecution: (dunId) => set((state) => {
    // 更新 lastUsedAt 时间戳
    const dun = state.duns.get(dunId)
    if (dun) {
      const next = new Map(state.duns)
      next.set(dunId, { ...dun, lastUsedAt: Date.now(), updatedAt: Date.now() })
      saveDunsToStorage(next)
      return {
        duns: next,
        executingDunId: dunId,
        executionStartTime: Date.now(),
      }
    }
    return {
      executingDunId: dunId,
      executionStartTime: Date.now(),
    }
  }),

  completeDunExecution: (dunId, result) => set((state) => {
    // 仅当完成的是当前正在执行的 Dun 时才更新
    if (state.executingDunId !== dunId) return state
    const dun = state.duns.get(dunId)

    // 更新 dun 实体的 updatedAt 并持久化
    let nextDuns = state.duns
    if (dun) {
      nextDuns = new Map(state.duns)
      nextDuns.set(dunId, { ...dun, updatedAt: Date.now() })
      saveDunsToStorage(nextDuns)
    }

    return {
      duns: nextDuns,
      executingDunId: null,
      executionStartTime: null,
      lastExecutionResult: {
        dunId,
        dunName: dun?.label || dunId,
        status: result.status,
        output: result.output,
        error: result.error,
        timestamp: Date.now(),
      },
    }
  }),

  // 从后端加载数据 (应用启动后调用)
  // 合并三个数据源: 当前 store(初始化时从 localStorage 加载) + 后端 + localStorage
  loadDunsFromServer: async () => {
    try {
      // 0. 加载已删除的 Dun ID 列表（从 localStorage + 后端双源合并，防止任一丢失）
      const localDeletedIds = loadDeletedDunIds()
      let backendDeletedIds: string[] = []
      try {
        backendDeletedIds = await localServerService.getData<string[]>(DATA_KEY_DELETED_DUN_IDS) || []
      } catch { /* 后端不可用时仍用本地数据 */ }
      const deletedIds = new Set([...localDeletedIds, ...backendDeletedIds])
      // 合并后回写 localStorage，确保两端一致
      if (backendDeletedIds.length > 0 && backendDeletedIds.some(id => !localDeletedIds.has(id))) {
        saveDeletedDunIds(deletedIds)
      }
      
      // 1. 当前 store 数据 (初始化时已从 localStorage 加载)
      const storeDuns = get().duns
      
      // 2. 读取后端数据
      const serverDuns = await localServerService.getData<DunEntity[]>(DATA_KEY_DUNS)
      
      // 3. 读取 localStorage 数据 (可能有其他 tab 写入的新数据)
      const localDuns = loadDunsFromStorage()
      
      // 4. 合并三方数据 (以 updatedAt/createdAt 最新者为准)
      const mergedMap = new Map<string, DunEntity>()
      
      // 辅助函数：合并两个 DunEntity 时，始终保留 totalRuns 更高的 scoring
      // 防止空评分（错误目录事件等）因时间戳更新而覆盖历史评分
      const pickBetterScoring = (a?: DunScoring, b?: DunScoring): DunScoring | undefined => {
        const aRuns = a?.totalRuns ?? 0
        const bRuns = b?.totalRuns ?? 0
        if (aRuns >= bRuns) return a
        return b
      }

      // 先添加当前 store 数据（跳过已删除的）
      for (const [id, dun] of storeDuns) {
        if (!deletedIds.has(id)) mergedMap.set(id, dun)
      }
      
      // 再合并 localStorage 数据 (如果更新，跳过已删除的)
      for (const [id, localDun] of localDuns) {
        if (deletedIds.has(id)) continue
        const existing = mergedMap.get(id)
        const localTime = localDun.updatedAt || localDun.createdAt || 0
        const existingTime = existing?.updatedAt || existing?.createdAt || 0
        if (!existing || localTime > existingTime) {
          // 保留 totalRuns 更高的 scoring，防止空评分覆盖历史数据
          const bestScoring = existing ? pickBetterScoring(localDun.scoring, existing.scoring) : localDun.scoring
          mergedMap.set(id, { ...localDun, scoring: bestScoring || localDun.scoring })
        } else if (existing) {
          // existing 胜出，但仍检查 localDun 是否有更好的 scoring
          const bestScoring = pickBetterScoring(existing.scoring, localDun.scoring)
          if (bestScoring && (bestScoring.totalRuns ?? 0) > (existing.scoring?.totalRuns ?? 0)) {
            mergedMap.set(id, { ...existing, scoring: bestScoring })
          }
        }
      }
      
      // 最后合并后端数据 (如果更新，跳过已删除的)
      if (serverDuns && serverDuns.length > 0) {
        for (const serverDun of serverDuns) {
          if (deletedIds.has(serverDun.id)) continue
          const existing = mergedMap.get(serverDun.id)
          
          // 保护本地已有的 scoring：服务器数据通常不含 scoring
          const sScoring = serverDun.scoring
          const hasRealScoring = sScoring && typeof sScoring === 'object' && (sScoring.score > 0 || sScoring.totalRuns > 0)
          
          if (!existing) {
            // 新 Dun：直接添加
            mergedMap.set(serverDun.id, serverDun)
          } else {
            // 已存在：合并服务器的元数据字段
            // scoring 保护：取 totalRuns 最高者，防止空评分覆盖真实历史数据
            const serverNormalized = hasRealScoring ? normalizeScoring(sScoring as unknown as Record<string, unknown>) : undefined
            const preservedScoring = pickBetterScoring(existing.scoring, serverNormalized) || existing.scoring || createInitialScoring()
            mergedMap.set(serverDun.id, {
              ...existing,
              // 从服务器更新的元数据字段
              label: resolveDunLabel(serverDun.label, (serverDun as any).name, existing.label, serverDun.id),
              flavorText: serverDun.flavorText || (serverDun as any).description || existing.flavorText,
              boundSkillIds: (serverDun as any).skillDependencies || serverDun.boundSkillIds || existing.boundSkillIds,
              sopContent: serverDun.sopContent || existing.sopContent,
              triggers: serverDun.triggers || existing.triggers,
              version: serverDun.version || existing.version,
              path: serverDun.path || existing.path,
              projectPath: (serverDun as any).projectPath || existing.projectPath,
              location: serverDun.location || existing.location,
              objective: serverDun.objective || existing.objective,
              metrics: serverDun.metrics || existing.metrics,
              strategy: serverDun.strategy || existing.strategy,
              skillsConfirmed: (serverDun as any).skillsConfirmed || existing.skillsConfirmed || false,
              // Per-Dun LLM Binding
              llmBinding: (serverDun as any).llmBinding || existing.llmBinding,
              // 保留 totalRuns 更高的 scoring
              scoring: preservedScoring!,
              position: existing.position,
              visualDNA: existing.visualDNA,
              createdAt: existing.createdAt,
              updatedAt: existing.updatedAt,
              constructionProgress: existing.constructionProgress,
            })
          }
        }
      }
      
      // ── 幽灵实体去重 ──
      // 核心问题：localStorage 和 SQLite(getData) 都可能包含历史幽灵数据，
      // 唯一可信的真相来源是磁盘扫描（GET /duns）。
      // 策略：从 GET /duns 获取磁盘上实际存在的 Dun 列表，不在列表中的即为幽灵。
      try {
        const baseUrl = localServerService.getServerUrl()
        const scanRes = await fetch(`${baseUrl}/duns`, { signal: AbortSignal.timeout(5000) })
        if (scanRes.ok) {
          const diskDuns = await scanRes.json() as Array<{ id: string; label?: string; name?: string; sopContent?: string; skillDependencies?: string[] }>
          const diskIdSet = new Set(diskDuns.map(d => d.id))
          const diskLabelToId = new Map<string, string>()
          for (const d of diskDuns) {
            const label = d.label || d.name || ''
            if (label) diskLabelToId.set(label, d.id)
          }

          // ── 同 label 磁盘去重 ──
          // 当两个磁盘目录有相同 label 时（如 agent-economy-researcher 和 智能体经济研究员），
          // 保留有更丰富内容（SOP/技能）的那个，移除影子目录对应的实体
          const labelToDiskDuns = new Map<string, typeof diskDuns>()
          for (const d of diskDuns) {
            const lbl = d.label || d.name || d.id
            const arr = labelToDiskDuns.get(lbl) || []
            arr.push(d)
            labelToDiskDuns.set(lbl, arr)
          }
          const shadowDiskIds = new Set<string>()
          for (const [, group] of labelToDiskDuns) {
            if (group.length <= 1) continue
            // 按内容丰富度排序：有 SOP 和技能的排前面
            group.sort((a, b) => {
              const aScore = (a.sopContent?.length || 0) + (a.skillDependencies?.length || 0) * 100
              const bScore = (b.sopContent?.length || 0) + (b.skillDependencies?.length || 0) * 100
              return bScore - aScore
            })
            // 保留第一个（最丰富），其余标记为影子
            for (let i = 1; i < group.length; i++) {
              shadowDiskIds.add(group[i].id)
              console.log(`[World] Disk label dedup: ${group[i].id} is shadow of ${group[0].id}`)
            }
          }

          const ghostIds: string[] = []
          const RECENT_THRESHOLD = 5 * 60 * 1000
          const now = Date.now()

          for (const [id, dun] of mergedMap) {
            // 磁盘影子目录 → 合并数据后移除
            if (shadowDiskIds.has(id)) {
              const label = dun.label || ''
              const canonicalId = diskLabelToId.get(label)
              if (canonicalId && canonicalId !== id && mergedMap.has(canonicalId)) {
                const canonical = mergedMap.get(canonicalId)!
                if (dun.sopContent && !canonical.sopContent) canonical.sopContent = dun.sopContent
                const dunRuns = dun.scoring?.totalRuns ?? 0
                const canonRuns = canonical.scoring?.totalRuns ?? 0
                if (dunRuns > canonRuns) canonical.scoring = dun.scoring
                if (!canonical.visualDNA && dun.visualDNA) canonical.visualDNA = dun.visualDNA
                if (!canonical.species && dun.species) canonical.species = dun.species
              }
              ghostIds.push(id)
              continue
            }
            // 磁盘上存在此 ID → 合法
            if (diskIdSet.has(id)) continue
            // 刚创建的保留（可能还没同步到磁盘）
            if (now - (dun.createdAt || 0) < RECENT_THRESHOLD) continue

            const label = dun.label || ''
            const canonicalId = diskLabelToId.get(label)

            if (canonicalId && mergedMap.has(canonicalId)) {
              // 同 label 的 canonical 存在 → 合并数据后移除自己
              const canonical = mergedMap.get(canonicalId)!
              if (dun.sopContent && !canonical.sopContent) canonical.sopContent = dun.sopContent
              if (dun.scoring && dun.scoring.totalRuns > 0 && (!canonical.scoring || canonical.scoring.totalRuns === 0)) {
                canonical.scoring = dun.scoring
              }
              if (!canonical.visualDNA && dun.visualDNA) canonical.visualDNA = dun.visualDNA
              if (!canonical.species && dun.species) canonical.species = dun.species
            }
            // 不在磁盘上、也过了保护期 → 幽灵/孤立，移除
            ghostIds.push(id)
          }

          if (ghostIds.length > 0) {
            for (const gid of ghostIds) mergedMap.delete(gid)
            console.log(`[World] Disk-scan dedup: removed ${ghostIds.length} ghost/orphan entities`, ghostIds)
          }

          // ── SQLite scoring 权威修正 ──
          // /duns API 返回的 scoring 来自 dun_scoring SQLite 表，是评分的权威数据源。
          // 如果 mergedMap 中的 scoring (来自 localStorage/duns_state) 比 SQLite 更差，
          // 说明曾被污染，用 SQLite 的数据修正。
          for (const diskDun of diskDuns) {
            const ds = (diskDun as any).scoring
            if (!ds || typeof ds !== 'object') continue
            const dsRuns = ds.totalRuns ?? ds.totalExecutions ?? 0
            if (dsRuns <= 0) continue

            // 按 id 匹配
            const existing = mergedMap.get(diskDun.id)
            if (existing) {
              const existingRuns = existing.scoring?.totalRuns ?? 0
              if (dsRuns > existingRuns) {
                existing.scoring = normalizeScoring(ds as Record<string, unknown>)
                console.log(`[World] SQLite scoring fix: ${diskDun.id} runs ${existingRuns} → ${dsRuns}`)
              }
            }
            // 按 label 匹配 (解决 dir_name 与中文 label 不一致的情况)
            const diskLabel = (diskDun as any).label || (diskDun as any).name || ''
            if (diskLabel && diskLabel !== diskDun.id) {
              const byLabel = mergedMap.get(diskLabel)
              if (byLabel) {
                const byLabelRuns = byLabel.scoring?.totalRuns ?? 0
                if (dsRuns > byLabelRuns) {
                  byLabel.scoring = normalizeScoring(ds as Record<string, unknown>)
                  console.log(`[World] SQLite scoring fix (label): ${diskLabel} runs ${byLabelRuns} → ${dsRuns}`)
                }
              }
            }
          }

          // ── 磁盘 SOP 权威修正 ──
          // /duns 磁盘扫描直接读取 DUN.md，是 sopContent 的权威来源。
          // shadow promote 后磁盘 SOP 已更新，必须覆盖 localStorage/store 中的旧版本。
          for (const diskDun of diskDuns) {
            if (!diskDun.sopContent) continue
            const existing = mergedMap.get(diskDun.id)
            if (existing && existing.sopContent !== diskDun.sopContent) {
              mergedMap.set(diskDun.id, { ...existing, sopContent: diskDun.sopContent })
              console.log(`[World] Disk SOP authority fix: ${diskDun.id} sopContent updated from disk`)
            }
          }
        }
      } catch (e) {
        console.warn('[World] Disk-scan dedup failed (non-critical):', e)
      }

      if (mergedMap.size > 0) {
        set({ duns: mergedMap })
        
        // 5. 双写同步 (确保浏览器数据也推送到后端)
        const mergedArray = [...mergedMap.values()]
        localStorage.setItem(DUN_STORAGE_KEY, JSON.stringify(mergedArray))
        localServerService.setData(DATA_KEY_DUNS, mergedArray).catch(() => {})
        
        console.log('[World] Merged dunes from 3 sources:',
          'store=' + storeDuns.size,
          'localStorage=' + localDuns.size,
          'server=' + (serverDuns?.length || 0),
          '→ total=' + mergedMap.size)
      }
    } catch (error) {
      console.warn('[World] Failed to load from server, keeping current store data:', error)
      // 失败时确保当前 store 数据推送到后端
      const current = get().duns
      if (current.size > 0) {
        const arr = [...current.values()]
        localServerService.setData(DATA_KEY_DUNS, arr).catch(() => {})
      }
    }
    // 标记首次加载完成，后续 setDunesFromServer 中新 Dun 将触发建造动画
    _initialLoadDone = true
  },
  
  syncAgentsAsDuns: (agents, _skills) => set((state) => {
    const next = new Map(state.duns)
    let changed = false
    
    // 收集已占用位置
    const usedPositions = new Set<string>()
    for (const [, dun] of next) {
      usedPositions.add(`${dun.position.gridX},${dun.position.gridY}`)
    }
    
    let autoIdx = 0
    
    for (const agent of agents) {
      const agentId = `oc-agent-${agent.id}`
      const existing = next.get(agentId)
      
      // 如果已存在且不是 OpenClaw 源的 Dun，跳过（不覆盖用户创建的）
      if (existing && !existing.source?.startsWith('openclaw')) continue
      
      const displayName = agent.name || agent.identity?.name || agent.id
      const visualDNA = existing?.visualDNA || simpleVisualDNA(agentId)
      
      // 位置分配：保留已有位置或分配新位置
      let position = existing?.position
      if (!position || (position.gridX === 0 && position.gridY === 0 && usedPositions.has('0,0'))) {
        let gx = 0, gy = 0
        do {
          autoIdx++
          gx = (autoIdx % 5) * 2 - 4
          gy = Math.floor(autoIdx / 5) * 2 - 2
        } while (usedPositions.has(`${gx},${gy}`))
        position = { gridX: gx, gridY: gy }
      }
      usedPositions.add(`${position.gridX},${position.gridY}`)

      // species 分配
      const usedSpeciesOC = new Set<AnimalSpecies>()
      for (const [did, d] of next) {
        if (did !== agentId && d.species) usedSpeciesOC.add(d.species as AnimalSpecies)
      }
      const species = existing?.species || assignUniqueSpecies(agentId, usedSpeciesOC)
      
      next.set(agentId, {
        ...existing,
        id: agentId,
        label: displayName,
        flavorText: `OpenClaw Agent: ${agent.id}`,
        position,
        scoring: existing?.scoring || createInitialScoring(),
        visualDNA,
        species,
        constructionProgress: 1,
        createdAt: existing?.createdAt || Date.now(),
        boundSkillIds: existing?.boundSkillIds || [],
        source: `openclaw:${agent.id}`,
        // 保留 identity 信息
        agentIdentity: agent.identity ? {
          name: agent.identity.name,
          emoji: agent.identity.emoji,
        } : undefined,
      } as DunEntity)
      changed = true
    }
    
    if (changed) {
      console.log('[World] Synced OpenClaw agents as Dunes:', agents.map(a => a.id))
      saveDunsToStorage(next)
    }
    return changed ? { duns: next } : {}
  }),
})
