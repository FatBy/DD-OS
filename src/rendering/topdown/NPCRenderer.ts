// ============================================
// DD-OS 俯视角小人漫游动画
// NPC 在道路上随机行走
// ============================================

import type { ParticleRenderer, RenderContext, GridPosition } from '../types'
import { getTileAtlas, TILE_SIZE } from './TileAtlas'

const RENDER_SCALE = 3
const NPC_COUNT = 5  // 同屏小人数量
const WALK_SPEED = 0.02  // 移动速度 (格/帧)
const ANIM_SPEED = 150  // 动画帧间隔 (ms)

type Direction = 'up' | 'down' | 'left' | 'right'

interface NPC {
  id: number
  x: number       // 世界坐标 (格)
  y: number
  targetX: number
  targetY: number
  direction: Direction
  frame: number   // 动画帧 (0-3)
  charType: number  // 角色类型 (0-5)
  lastFrameTime: number
}

// 角色动画帧位置 (tilemap 右侧)
// 保留以备后续扩展使用
// const CHAR_FRAMES: Record<Direction, { col: number, rows: number[] }> = {
//   down:  { col: 24, rows: [0, 1, 2, 3, 4, 5] },
//   ...
// }

/**
 * 小人漫游渲染器
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
    if (positions.length > 0 && !this.initialized) {
      this.initNPCs()
      this.initialized = true
    }
  }

  private initNPCs(): void {
    this.npcs = []
    for (let i = 0; i < NPC_COUNT; i++) {
      const pos = this.randomRoadPosition()
      this.npcs.push({
        id: i,
        x: pos.gridX,
        y: pos.gridY,
        targetX: pos.gridX,
        targetY: pos.gridY,
        direction: 'down',
        frame: 0,
        charType: i % 6,  // 6 种角色外观
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
      // 角色在 tilemap 右侧，每个角色一列，每方向 4 帧
      // 使用简化版本：固定使用第一个角色
      const col = 24 + npc.frame
      const row = npc.direction === 'down' ? 0 :
                  npc.direction === 'up' ? 1 :
                  npc.direction === 'left' ? 2 : 3

      this.atlas.drawTileByPos(c, col, row, screenX - tileSize / 2, screenY - tileSize / 2, scale)
    }

    c.restore()
  }

  dispose(): void {
    this.npcs = []
    this.roadPositions = []
  }
}
