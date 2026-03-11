// ============================================
// Smallville NPC 漫游渲染器
// 基于 NPCRenderer v2，适配 SmallvilleViewManager
// NPC 只在 town 视图道路上行走
// ============================================

import type { ParticleRenderer, RenderContext, GridPosition } from '../types'
import type { SmallvilleViewManager } from './SmallvilleViewManager'
import type { SmallvilleSpriteAtlas } from './SmallvilleSpriteAtlas'
import { SV_CHAR_IDLE, SV_CHAR_WALK, SV_CHAR_FRAMES_PER_DIR, SV_CHAR_NAMES } from './SmallvilleTiles'

const RENDER_SCALE = 3
const TOPDOWN_TILE_SIZE = 48  // 16 * 3
const TILE_SIZE = 16
const NPC_COUNT = 5
const WALK_SPEED = 0.015
const ANIM_SPEED = 100  // ms (10 FPS for sprite animation)

type Direction = 'up' | 'down' | 'left' | 'right'

interface NPC {
  id: number
  x: number
  y: number
  targetX: number
  targetY: number
  direction: Direction
  frame: number
  charName: string
  lastFrameTime: number
}

// NPC 外观颜色 (fallback)
const NPC_COLORS = ['#e67e22', '#3498db', '#e74c3c', '#2ecc71', '#9b59b6']

// 方向指示偏移 (fallback)
const DIR_OFFSET: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

export class SmallvilleNPCRenderer implements ParticleRenderer {
  readonly id = 'smallville-npc-renderer'

  private viewManager: SmallvilleViewManager
  private atlas: SmallvilleSpriteAtlas
  private npcs: NPC[] = []
  private roadPositions: GridPosition[] = []
  private initialized = false

  constructor(viewManager: SmallvilleViewManager, atlas: SmallvilleSpriteAtlas) {
    this.viewManager = viewManager
    this.atlas = atlas
  }

  resize(_width: number, _height: number): void {}

  setRoadPositions(positions: GridPosition[]): void {
    this.roadPositions = positions

    if (positions.length >= 3 && !this.initialized) {
      this.initNPCs()
      this.initialized = true
    } else if (positions.length < 3) {
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
        charName: SV_CHAR_NAMES[i % SV_CHAR_NAMES.length],
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
    if (!this.viewManager.isInTownView()) return

    for (const npc of this.npcs) {
      const dx = npc.targetX - npc.x
      const dy = npc.targetY - npc.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < 0.1) {
        npc.x = npc.targetX
        npc.y = npc.targetY
        const newTarget = this.randomRoadPosition()
        npc.targetX = newTarget.gridX
        npc.targetY = newTarget.gridY
      } else {
        const moveX = (dx / dist) * WALK_SPEED
        const moveY = (dy / dist) * WALK_SPEED
        npc.x += moveX
        npc.y += moveY

        if (Math.abs(dx) > Math.abs(dy)) {
          npc.direction = dx > 0 ? 'right' : 'left'
        } else {
          npc.direction = dy > 0 ? 'down' : 'up'
        }
      }

      if (timestamp - npc.lastFrameTime > ANIM_SPEED) {
        npc.frame = (npc.frame + 1) % SV_CHAR_FRAMES_PER_DIR
        npc.lastFrameTime = timestamp
      }
    }
  }

  render(ctx: RenderContext): void {
    if (this.npcs.length === 0) return

    const vm = this.viewManager
    if (vm.isInRoomView()) return

    const { ctx: c, width, height, camera } = ctx

    const scale = RENDER_SCALE * camera.zoom
    const tileScreen = TILE_SIZE * scale
    const halfW = width / 2
    const halfH = height / 2

    c.save()

    if (vm.isTransitioning()) {
      c.globalAlpha = 1 - vm.zoomProgress
    }

    for (const npc of this.npcs) {
      const screenX = halfW + npc.x * TOPDOWN_TILE_SIZE * camera.zoom + camera.x * camera.zoom
      const screenY = halfH + npc.y * TOPDOWN_TILE_SIZE * camera.zoom + camera.y * camera.zoom

      if (screenX < -tileScreen || screenX > width + tileScreen ||
          screenY < -tileScreen || screenY > height + tileScreen) {
        continue
      }

      if (this.atlas.isCharReady(npc.charName)) {
        // 精灵动画渲染
        const dx = npc.targetX - npc.x
        const dy = npc.targetY - npc.y
        const isMoving = Math.sqrt(dx * dx + dy * dy) > 0.15
        const baseFrame = isMoving
          ? SV_CHAR_WALK[npc.direction]
          : SV_CHAR_IDLE[npc.direction]
        const frameIdx = baseFrame + (npc.frame % SV_CHAR_FRAMES_PER_DIR)

        // 角色精灵 16x32，居中到 NPC 位置
        this.atlas.drawCharFrame(
          c, npc.charName, frameIdx,
          screenX - tileScreen * 0.3,
          screenY - tileScreen * 0.6,
          scale,
        )
      } else {
        // 纯色圆形 fallback
        const radius = tileScreen * 0.3
        const color = NPC_COLORS[npc.id % NPC_COLORS.length]

        c.fillStyle = color
        c.beginPath()
        c.arc(screenX, screenY, radius, 0, Math.PI * 2)
        c.fill()

        c.strokeStyle = 'rgba(0,0,0,0.3)'
        c.lineWidth = 1
        c.stroke()

        c.fillStyle = '#fad0a0'
        c.beginPath()
        c.arc(screenX, screenY - radius * 0.6, radius * 0.45, 0, Math.PI * 2)
        c.fill()

        const dir = DIR_OFFSET[npc.direction]
        c.fillStyle = '#333'
        c.beginPath()
        c.arc(
          screenX + dir.dx * radius * 0.25,
          screenY - radius * 0.6 + dir.dy * radius * 0.25,
          radius * 0.12,
          0, Math.PI * 2
        )
        c.fill()
      }
    }

    c.restore()
  }

  dispose(): void {
    this.npcs = []
    this.roadPositions = []
    this.initialized = false
  }
}
