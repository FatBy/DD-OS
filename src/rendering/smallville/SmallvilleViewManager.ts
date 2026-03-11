// ============================================
// Smallville 视图状态协调器
// 管理 town ↔ room 视图切换和过渡动画
// ============================================

import type { NexusEntity } from '@/types'
import type { TileInfo } from '../topdown/TileAtlas'
import { TILES } from '../topdown/TileAtlas'

// ============================================
// 类型定义
// ============================================

export type SmallvilleViewMode = 'town' | 'zooming-in' | 'zooming-out' | 'room'

export interface Workstation {
  skillId: string
  tileX: number
  tileY: number
  furnitureType: 'computer' | 'bookshelf' | 'cabinet' | 'desk'
  tiles: Array<{ tile: TileInfo; offsetX: number; offsetY: number }>
}

export interface RoomDecoration {
  tileX: number
  tileY: number
  tile: TileInfo
}

export interface RoomLayout {
  width: number
  height: number
  workstations: Workstation[]
  decorations: RoomDecoration[]
  doorX: number
  doorY: number
}

// ============================================
// 常量
// ============================================

const ZOOM_IN_DURATION = 800   // ms
const ZOOM_OUT_DURATION = 600  // ms

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// ============================================
// SmallvilleViewManager
// ============================================

export class SmallvilleViewManager {
  private _viewMode: SmallvilleViewMode = 'town'
  private _zoomProgress = 0         // 0 = town, 1 = room
  private _zoomStartTime = 0
  private _roomNexusId: string | null = null
  private _roomNexus: NexusEntity | null = null
  private _roomLayout: RoomLayout | null = null
  private _zoomTarget = { screenX: 0, screenY: 0 }

  // --- 查询 ---

  get viewMode(): SmallvilleViewMode { return this._viewMode }
  get zoomProgress(): number { return this._zoomProgress }
  get roomNexusId(): string | null { return this._roomNexusId }
  get roomNexus(): NexusEntity | null { return this._roomNexus }
  get roomLayout(): RoomLayout | null { return this._roomLayout }
  get zoomTarget() { return this._zoomTarget }

  isInTownView(): boolean { return this._viewMode === 'town' }
  isInRoomView(): boolean { return this._viewMode === 'room' }
  isTransitioning(): boolean {
    return this._viewMode === 'zooming-in' || this._viewMode === 'zooming-out'
  }

  // --- 操作 ---

  enterRoom(nexusId: string, nexus: NexusEntity, screenX: number, screenY: number): void {
    if (this._viewMode !== 'town') return

    this._roomNexusId = nexusId
    this._roomNexus = nexus
    this._zoomTarget = { screenX, screenY }
    this._roomLayout = this.generateRoomLayout(nexus)
    this._viewMode = 'zooming-in'
    this._zoomStartTime = performance.now()
    this._zoomProgress = 0
  }

  exitRoom(): void {
    if (this._viewMode !== 'room') return

    this._viewMode = 'zooming-out'
    this._zoomStartTime = performance.now()
    this._zoomProgress = 1
  }

  update(timestamp: number): void {
    if (this._viewMode === 'zooming-in') {
      const elapsed = timestamp - this._zoomStartTime
      const raw = Math.min(1, elapsed / ZOOM_IN_DURATION)
      this._zoomProgress = easeInOutCubic(raw)

      if (raw >= 1) {
        this._viewMode = 'room'
        this._zoomProgress = 1
      }
    } else if (this._viewMode === 'zooming-out') {
      const elapsed = timestamp - this._zoomStartTime
      const raw = Math.min(1, elapsed / ZOOM_OUT_DURATION)
      this._zoomProgress = 1 - easeInOutCubic(raw)

      if (raw >= 1) {
        this._viewMode = 'town'
        this._zoomProgress = 0
        this._roomNexusId = null
        this._roomNexus = null
        this._roomLayout = null
      }
    }
  }

  // --- 房间布局生成 ---

  private generateRoomLayout(nexus: NexusEntity): RoomLayout {
    const skills = nexus.boundSkillIds || []
    const skillCount = skills.length

    // 房间尺寸
    const width = Math.min(14, Math.max(8, 4 + skillCount * 2))
    const height = Math.min(12, Math.max(8, 4 + skillCount * 2))

    // 门位置（底部中央）
    const doorX = Math.floor(width / 2)
    const doorY = height - 1

    // 沿墙壁内侧分配工作站
    const workstations: Workstation[] = []
    const wallSlots: Array<{ x: number; y: number }> = []

    // 上墙内侧（x=2..width-3, y=1）
    for (let x = 2; x <= width - 3; x += 2) {
      wallSlots.push({ x, y: 1 })
    }
    // 左墙内侧（x=1, y=2..height-3）
    for (let y = 2; y <= height - 3; y += 2) {
      wallSlots.push({ x: 1, y })
    }
    // 右墙内侧（x=width-2, y=2..height-3）
    for (let y = 2; y <= height - 3; y += 2) {
      wallSlots.push({ x: width - 2, y })
    }

    for (let i = 0; i < skillCount && i < wallSlots.length; i++) {
      const slot = wallSlots[i]
      const skillId = skills[i]
      const furnitureType = this.inferFurnitureType(skillId)
      const tiles = this.getFurnitureTiles(furnitureType)

      workstations.push({
        skillId,
        tileX: slot.x,
        tileY: slot.y,
        furnitureType,
        tiles,
      })
    }

    // 装饰物
    const decorations: RoomDecoration[] = []

    // 角落放花盆
    if (!this.hasWorkstationAt(workstations, 1, 1)) {
      decorations.push({ tileX: 1, tileY: 1, tile: TILES.PLANT_POT })
    }
    if (!this.hasWorkstationAt(workstations, width - 2, 1)) {
      decorations.push({ tileX: width - 2, tileY: 1, tile: TILES.PLANT_POT })
    }

    return { width, height, workstations, decorations, doorX, doorY }
  }

  private hasWorkstationAt(ws: Workstation[], x: number, y: number): boolean {
    return ws.some(w => w.tileX === x && w.tileY === y)
  }

  private inferFurnitureType(skillId: string): Workstation['furnitureType'] {
    const id = skillId.toLowerCase()
    if (id.includes('search') || id.includes('web') || id.includes('browse')) return 'computer'
    if (id.includes('research') || id.includes('read') || id.includes('knowledge')) return 'bookshelf'
    if (id.includes('file') || id.includes('write') || id.includes('save') || id.includes('memory')) return 'cabinet'
    return 'desk'
  }

  private getFurnitureTiles(type: Workstation['furnitureType']): Workstation['tiles'] {
    switch (type) {
      case 'computer':
        return [
          { tile: TILES.TABLE, offsetX: 0, offsetY: 0 },
          { tile: TILES.COMPUTER, offsetX: 0, offsetY: -1 },
        ]
      case 'bookshelf':
        return [
          { tile: TILES.SHELF_BOOKS, offsetX: 0, offsetY: 0 },
        ]
      case 'cabinet':
        return [
          { tile: TILES.SHELF_ITEMS, offsetX: 0, offsetY: 0 },
          { tile: TILES.CRATE, offsetX: 1, offsetY: 0 },
        ]
      case 'desk':
      default:
        return [
          { tile: TILES.TABLE, offsetX: 0, offsetY: 0 },
          { tile: TILES.CHAIR, offsetX: 0, offsetY: 1 },
        ]
    }
  }

  dispose(): void {
    this._roomLayout = null
    this._roomNexus = null
    this._roomNexusId = null
    this._viewMode = 'town'
    this._zoomProgress = 0
  }
}
