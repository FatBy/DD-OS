// ============================================
// DD-OS 像素小镇网格渲染器
// 微弱的暖色圆点标示空间
// ============================================

import type { GridRenderer, RenderContext, GridPosition } from '../types'
import { TILE_WIDTH, TILE_HEIGHT } from '../utils/coordinateTransforms'

/**
 * 像素小镇网格渲染器
 * 暖色调微弱圆点
 */
export class PixelTownGrid implements GridRenderer {
  readonly id = 'pixeltown-grid'

  private nexusSet = new Set<string>()

  updateNexusPositions(positions: GridPosition[]): void {
    this.nexusSet.clear()
    for (const p of positions) {
      this.nexusSet.add(`${p.gridX},${p.gridY}`)
    }
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height, camera } = ctx

    const GRID_SIZE = 25

    c.save()

    // 暖色调圆点 (比 Minimalist 稍暖)
    c.fillStyle = 'rgba(160, 140, 120, 0.06)'

    const halfW = width / 2
    const halfH = height / 2
    const scale = camera.zoom * 0.8
    const tileW = TILE_WIDTH * scale
    const tileH = TILE_HEIGHT * scale

    for (let gx = -GRID_SIZE; gx <= GRID_SIZE; gx++) {
      for (let gy = -GRID_SIZE; gy <= GRID_SIZE; gy++) {
        const screenX = halfW + (gx - gy) * (tileW / 2) + camera.x * camera.zoom
        const screenY = halfH + (gx + gy) * (tileH / 2) + camera.y * camera.zoom

        if (screenX < -50 || screenX > width + 50 ||
            screenY < -50 || screenY > height + 50) {
          continue
        }

        const dotRadius = Math.max(1.2, 2 * camera.zoom)

        c.beginPath()
        c.arc(screenX, screenY, dotRadius, 0, Math.PI * 2)
        c.fill()
      }
    }

    c.restore()
  }

  dispose(): void {
    this.nexusSet.clear()
  }
}
