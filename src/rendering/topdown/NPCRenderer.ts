// ============================================
// DD-OS 俯视角 NPC 漫游动画 v2
// NPC 在道路上随机行走
// ============================================

import type { ParticleRenderer, RenderContext, GridPosition } from '../types'
import { getTileAtlas, TILE_SIZE } from './TileAtlas'

const RENDER_SCALE = 3
const NPC_COUNT = 5  // 同屏小人数量
const WALK_SPEED = 0.015  // 移动速度 (格/帧)
const ANIM_SPEED = 180  // 动画帧间隔 (ms)

type Direction = 'up' | 'down' | 'left' | 'right'

interface NPC {
  id: number
  x: number       // 世界坐标 (格)
  y: number
  targetX: number
  targetY: number
  direction: Direction
  frame: number   // 动画帧 (0-3)
  charVariant: number  // 角色外观变体 (0-2)
  lastFrameTime: number
}

/**
 * NPC 漫游渲染器
 */
export class NPCRenderer implements ParticleRenderer {
  readonly id = 'npc-renderer'

  private atlas = getTileAtlas()
  private npcs: NPC[] = []
  private roadPositions: GridPosition[] = []
  private initialized = false

  resize(_width: number, _height: number): void {
    // 无需处理
  }

  /**
   * 更新道路位置（从 TopDownGrid 获取）
   */
  setRoadPositions(positions: GridPosition[]): void {
    this.roadPositions = positions
    
    // 只在有足够道路时初始化 NPC
    if (positions.length >= 3 && !this.initialized) {
      this.initNPCs()
      this.initialized = true
    } else if (positions.length < 3) {
      // 道路太少，清除 NPC
      this.npcs = []
      this.initialized = false
    }
  }

  private initNPCs(): void {
    this.npcs = []
    const count = Math.min(NPC_COUNT, Math.floor(this.roadPositions.length / 2))
    
    for (let i = 0; i < count; i++) {
      const pos = this.randomRoadPosition()
      this.npcs.push({
        id: i,
        x: pos.gridX,
        y: pos.gridY,
        targetX: pos.gridX,
        targetY: pos.gridY,
        direction: 'down',
        frame: 0,
        charVariant: i % 3,  // 3 种角色外观
        lastFrameTime: 0,
      })
    }
  }

  private randomRoadPosition(): GridPosition {
    if (this.roadPositions.length === 0) {
      return { gridX: 0, gridY: 0 }
    }
    const idx = Math.floor(Math.random() * this.roadPositions.length)
    return this.roadPositions[idx]
  }

  update(timestamp: number): void {
    for (const npc of this.npcs) {
      // 移动到目标
      const dx = npc.targetX - npc.x
      const dy = npc.targetY - npc.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < 0.1) {
        // 到达目标，选择新目标
        npc.x = npc.targetX
        npc.y = npc.targetY
        const newTarget = this.randomRoadPosition()
        npc.targetX = newTarget.gridX
        npc.targetY = newTarget.gridY
      } else {
        // 移动
        const moveX = (dx / dist) * WALK_SPEED
        const moveY = (dy / dist) * WALK_SPEED
        npc.x += moveX
        npc.y += moveY

        // 更新方向
        if (Math.abs(dx) > Math.abs(dy)) {
          npc.direction = dx > 0 ? 'right' : 'left'
        } else {
          npc.direction = dy > 0 ? 'down' : 'up'
        }
      }

      // 更新动画帧
      if (timestamp - npc.lastFrameTime > ANIM_SPEED) {
        npc.frame = (npc.frame + 1) % 4
        npc.lastFrameTime = timestamp
      }
    }
  }

  render(ctx: RenderContext): void {
    if (!this.atlas.isLoaded()) return
    if (this.npcs.length === 0) return

    const { ctx: c, width, height, camera } = ctx

    const scale = RENDER_SCALE * camera.zoom
    const tileSize = TILE_SIZE * scale
    const halfW = width / 2
    const halfH = height / 2

    c.save()

    for (const npc of this.npcs) {
      // 世界坐标 → 屏幕坐标
      const screenX = halfW + npc.x * tileSize + camera.x * camera.zoom
      const screenY = halfH + npc.y * tileSize + camera.y * camera.zoom

      // 视锥裁剪
      if (screenX < -tileSize || screenX > width + tileSize ||
          screenY < -tileSize || screenY > height + tileSize) {
        continue
      }

      // 绘制角色
      // 角色在 tilemap 第 12-15 行，每方向 4 帧
      // 基础列: 24 (down), 25 (up), 26 (left), 27 (right)
      // 帧偏移: 0-3
      const baseCol = 24
      const directionRow = npc.direction === 'down' ? 12 :
                          npc.direction === 'up' ? 13 :
                          npc.direction === 'left' ? 14 : 15

      const col = baseCol + npc.frame
      const row = directionRow + npc.charVariant * 4

      this.atlas.drawTileByPos(c, col, row, screenX - tileSize / 2, screenY - tileSize / 2, scale)
    }

    c.restore()
  }

  dispose(): void {
    this.npcs = []
    this.roadPositions = []
    this.initialized = false
  }
}
