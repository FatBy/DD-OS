// ============================================
// Smallville 房间场景渲染器
// 在房间模式下绘制工作站家具和装饰物
// ============================================

import type { ParticleRenderer, RenderContext } from '../types'
import type { SmallvilleViewManager } from './SmallvilleViewManager'
import type { SmallvilleSpriteAtlas } from './SmallvilleSpriteAtlas'

const TILE_SIZE = 16
const ROOM_SCALE = 3.5  // 与 SmallvilleGrid/Background 保持一致

// 家具类型对应的纯色 fallback 配色
const FURNITURE_COLORS: Record<string, { fill: string; accent: string; label: string }> = {
  computer: { fill: '#4a6785', accent: '#87CEEB', label: 'PC' },
  bookshelf: { fill: '#8B6914', accent: '#d4a057', label: 'BOOK' },
  cabinet: { fill: '#6b5b4a', accent: '#a0896e', label: 'FILE' },
  desk: { fill: '#7a6250', accent: '#c4a882', label: 'DESK' },
}

export class SmallvilleRoomRenderer implements ParticleRenderer {
  readonly id = 'smallville-room-renderer'
  private viewManager: SmallvilleViewManager
  private atlas: SmallvilleSpriteAtlas

  constructor(viewManager: SmallvilleViewManager, atlas: SmallvilleSpriteAtlas) {
    this.viewManager = viewManager
    this.atlas = atlas
  }

  resize(_w: number, _h: number): void {}

  update(_timestamp: number): void {
    // 工作站目前为静态，无需 per-frame 更新
  }

  render(ctx: RenderContext): void {
    const vm = this.viewManager
    if (!vm.isInRoomView() && !vm.isTransitioning()) return

    const layout = vm.roomLayout
    if (!layout) return

    const { ctx: c, width, height } = ctx
    const tileScreen = TILE_SIZE * ROOM_SCALE
    const roomPixelW = layout.width * tileScreen
    const roomPixelH = layout.height * tileScreen
    const startX = (width - roomPixelW) / 2
    const startY = (height - roomPixelH) / 2

    c.save()

    // 过渡中渐入
    if (vm.isTransitioning()) {
      c.globalAlpha = vm.zoomProgress
    }

    // 绘制工作站 (atlas 暂不用于室内家具，保留纯色 fallback)
    // TODO Phase 5: 用 atlas 瓦片渲染家具
    void this.atlas
    for (const ws of layout.workstations) {
      const px = startX + ws.tileX * tileScreen
      const py = startY + ws.tileY * tileScreen
      const colors = FURNITURE_COLORS[ws.furnitureType] || FURNITURE_COLORS.desk

      // 家具主体
      c.fillStyle = colors.fill
      c.fillRect(px + 2, py + 2, tileScreen - 4, tileScreen - 4)

      // 高光边
      c.fillStyle = colors.accent
      c.fillRect(px + 3, py + 3, tileScreen - 6, 4)

      // 家具边框
      c.strokeStyle = 'rgba(0,0,0,0.2)'
      c.lineWidth = 1
      c.strokeRect(px + 2, py + 2, tileScreen - 4, tileScreen - 4)

      // 工作站标签（skill 名称缩写）
      const labelX = px + tileScreen / 2
      const labelY = py - 4
      c.fillStyle = 'rgba(255,255,255,0.6)'
      c.font = '9px monospace'
      c.textAlign = 'center'
      const shortId = ws.skillId.length > 10 ? ws.skillId.slice(0, 10) + '..' : ws.skillId
      c.fillText(shortId, labelX, labelY)
    }

    // 绘制装饰物（纯色 fallback）
    for (const deco of layout.decorations) {
      const px = startX + deco.tileX * tileScreen
      const py = startY + deco.tileY * tileScreen

      // 花盆
      c.fillStyle = '#8B4513'
      c.fillRect(px + tileScreen * 0.25, py + tileScreen * 0.5, tileScreen * 0.5, tileScreen * 0.35)
      c.fillStyle = '#2d8a4e'
      c.beginPath()
      c.arc(px + tileScreen / 2, py + tileScreen * 0.4, tileScreen * 0.25, 0, Math.PI * 2)
      c.fill()
    }

    // 房间标题
    if (vm.isInRoomView() && vm.roomNexus) {
      const title = vm.roomNexus.label || vm.roomNexus.id.slice(0, 12)
      c.fillStyle = 'rgba(255,255,255,0.85)'
      c.font = 'bold 14px monospace'
      c.textAlign = 'center'
      c.fillText(title, width / 2, startY - 12)
    }

    c.restore()
  }

  dispose(): void {}
}
