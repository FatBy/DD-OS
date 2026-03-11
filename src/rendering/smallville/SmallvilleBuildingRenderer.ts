// ============================================
// Smallville 建筑渲染器
// 纯色像素风建筑（不依赖 tilemap ID 准确性）
// ============================================

import type { EntityRenderer, RenderContext, Point } from '../types'
import type { NexusEntity } from '@/types'
import type { SmallvilleViewManager } from './SmallvilleViewManager'
import type { SmallvilleSpriteAtlas } from './SmallvilleSpriteAtlas'
import { selectBuildingTemplate, drawBuildingTemplate } from './SmallvilleBuildingTemplate'
import type { SvBuildingTemplate } from './SmallvilleBuildingTemplate'

const TILE_SIZE = 16
const RENDER_SCALE = 3

// 建筑配色方案
const BUILDING_PALETTES = [
  { roof: '#c0392b', wall: '#d5c4a1', awning: '#e67e22', door: '#5d4037' },
  { roof: '#2980b9', wall: '#d5c4a1', awning: '#27ae60', door: '#5d4037' },
  { roof: '#8e44ad', wall: '#ddd0c8', awning: '#e74c3c', door: '#4e342e' },
  { roof: '#16a085', wall: '#ece0ce', awning: '#f39c12', door: '#5d4037' },
]

export class SmallvilleBuildingRenderer implements EntityRenderer {
  readonly id = 'smallville-building'
  readonly viewManager: SmallvilleViewManager
  private atlas: SmallvilleSpriteAtlas
  private executingNexusId: string | null = null
  private templateCache: Map<string, SvBuildingTemplate> = new Map()

  constructor(viewManager: SmallvilleViewManager, atlas: SmallvilleSpriteAtlas) {
    this.viewManager = viewManager
    this.atlas = atlas
  }

  canRender(_nexus: NexusEntity): boolean {
    return true
  }

  setExecutionState(nexusId: string | null, _startTime: number | null): void {
    this.executingNexusId = nexusId
  }

  render(
    ctx: RenderContext,
    nexus: NexusEntity,
    screenPos: Point,
    isSelected: boolean,
    timestamp: number,
  ): void {
    const vm = this.viewManager
    if (vm.isInRoomView()) return

    if (vm.isTransitioning()) {
      const alpha = 1 - vm.zoomProgress
      if (alpha <= 0.01) return
      ctx.ctx.save()
      ctx.ctx.globalAlpha = alpha
      this.renderBuilding(ctx, nexus, screenPos, isSelected, timestamp)
      ctx.ctx.restore()
      return
    }

    this.renderBuilding(ctx, nexus, screenPos, isSelected, timestamp)
  }

  private renderBuilding(
    ctx: RenderContext,
    nexus: NexusEntity,
    screenPos: Point,
    isSelected: boolean,
    timestamp: number,
  ): void {
    const { ctx: c, camera } = ctx
    const isExecuting = this.executingNexusId === nexus.id

    const scale = RENDER_SCALE * camera.zoom
    const ts = TILE_SIZE * scale

    // 获取/缓存建筑模板
    let template = this.templateCache.get(nexus.id)
    if (!template) {
      template = selectBuildingTemplate(nexus.id, nexus.level)
      this.templateCache.set(nexus.id, template)
    }

    const w = template.width * ts
    const h = template.height * ts

    const baseX = screenPos.x - w / 2
    let baseY = screenPos.y - h / 2

    // 执行中：悬浮
    if (isExecuting) {
      baseY += -6 * camera.zoom + Math.sin(timestamp / 150) * 2 * camera.zoom
    }

    // === 阴影 (底部+右侧投影) ===
    c.fillStyle = 'rgba(0,0,0,0.12)'
    c.fillRect(baseX + 2, baseY + h, w + 2, 4 * camera.zoom)    // 底部
    c.fillRect(baseX + w, baseY + 2, 3 * camera.zoom, h)         // 右侧

    // === 建筑主体 ===
    if (this.atlas.isReady()) {
      drawBuildingTemplate(c, this.atlas, template, baseX, baseY, scale)
    } else {
      // 纯色 fallback
      const hash = this.hashString(nexus.id)
      const palette = BUILDING_PALETTES[hash % BUILDING_PALETTES.length]

      // 屋顶
      c.fillStyle = palette.roof
      c.fillRect(baseX - 2, baseY, w + 4, ts * 0.8)
      c.fillStyle = 'rgba(255,255,255,0.2)'
      c.fillRect(baseX - 2, baseY, w + 4, ts * 0.25)

      // 遮阳棚
      c.fillStyle = palette.awning
      c.fillRect(baseX - 1, baseY + ts * 0.8, w + 2, ts * 0.4)

      // 墙壁
      const wallTop = baseY + ts * 1.2
      const wallH = h - ts * 1.2
      c.fillStyle = palette.wall
      c.fillRect(baseX, wallTop, w, wallH)
      c.strokeStyle = 'rgba(0,0,0,0.15)'
      c.lineWidth = 1
      c.strokeRect(baseX, wallTop, w, wallH)

      // 窗户
      const winSize = ts * 0.35
      const winY = wallTop + ts * 0.2
      c.fillStyle = '#87CEEB'
      c.fillRect(baseX + ts * 0.2, winY, winSize, winSize)
      c.strokeStyle = '#5a8ea0'
      c.lineWidth = 1
      c.strokeRect(baseX + ts * 0.2, winY, winSize, winSize)
      c.fillStyle = '#87CEEB'
      c.fillRect(baseX + w - ts * 0.2 - winSize, winY, winSize, winSize)
      c.strokeRect(baseX + w - ts * 0.2 - winSize, winY, winSize, winSize)

      // 门
      const doorW = ts * 0.4
      const doorH = ts * 0.7
      const doorX = baseX + (w - doorW) / 2
      const doorY = baseY + h - doorH
      c.fillStyle = palette.door
      c.fillRect(doorX, doorY, doorW, doorH)
      c.fillStyle = '#ffd700'
      c.beginPath()
      c.arc(doorX + doorW * 0.75, doorY + doorH * 0.55, 1.5 * camera.zoom, 0, Math.PI * 2)
      c.fill()
    }

    // === 选中效果 ===
    if (isSelected) {
      c.strokeStyle = '#ffd700'
      c.lineWidth = 2
      c.setLineDash([4, 2])
      c.strokeRect(baseX - 3, baseY - 3, w + 6, h + 6)
      c.setLineDash([])
    }

    // === 执行中光效 ===
    if (isExecuting) {
      const pulse = 0.3 + Math.sin(timestamp / 300) * 0.2
      c.save()
      c.shadowColor = '#00ff88'
      c.shadowBlur = 15 * camera.zoom
      c.globalAlpha = pulse
      c.strokeStyle = '#00ff88'
      c.lineWidth = 2
      c.strokeRect(baseX - 4, baseY - 4, w + 8, h + 8)
      c.restore()
    }

    // === 标签 ===
    const label = nexus.label || nexus.id.slice(0, 8)
    c.fillStyle = isSelected ? '#ffd700' : 'rgba(255,255,255,0.85)'
    c.font = `bold ${Math.round(10 * camera.zoom)}px monospace`
    c.textAlign = 'center'
    c.fillText(label, screenPos.x, baseY - 5 * camera.zoom)
  }

  private hashString(s: string): number {
    let hash = 0
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i)
      hash |= 0
    }
    return Math.abs(hash)
  }

  clearCache(): void {}
  dispose(): void {}
}
