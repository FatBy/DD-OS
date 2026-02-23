// ============================================
// DD-OS 城市网格渲染器 (等距线条风格)
// 配合 Kenney 素材的等距网格线
// ============================================

import type { GridRenderer, RenderContext, GridPosition } from '../types'
import { TILE_WIDTH, TILE_HEIGHT } from '../utils/coordinateTransforms'

/**
 * 城市地面网格渲染器
 * 等距线条风格 - 浅色网格线标示空间
 */
export class CityGrid implements GridRenderer {
  readonly id = 'city-grid'

  // Nexus 位置缓存
  private nexusSet = new Set<string>()

  // 公开接口（保持兼容）
  getRoadSet(): Set<string> { return new Set() }
  getSidewalkSet(): Set<string> { return new Set() }

  updateNexusPositions(positions: GridPosition[]): void {
    this.nexusSet.clear()
    for (const p of positions) {
      this.nexusSet.add(`${p.gridX},${p.gridY}`)
    }
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height, camera } = ctx

    const GRID_SIZE = 30 // 渲染范围

    c.save()

    const halfW = width / 2
    const halfH = height / 2
    const scale = camera.zoom * 0.8
    const tileW = TILE_WIDTH * scale
    const tileH = TILE_HEIGHT * scale

    // 绘制等距网格线
    c.strokeStyle = 'rgba(180, 170, 155, 0.3)'
    c.lineWidth = 1

    // 绘制主对角线方向的网格线 (gx 固定)
    for (let gx = -GRID_SIZE; gx <= GRID_SIZE; gx++) {
      const startGy = -GRID_SIZE
      const endGy = GRID_SIZE
      
      const startX = halfW + (gx - startGy) * (tileW / 2) + camera.x * camera.zoom
      const startY = halfH + (gx + startGy) * (tileH / 2) + camera.y * camera.zoom
      const endX = halfW + (gx - endGy) * (tileW / 2) + camera.x * camera.zoom
      const endY = halfH + (gx + endGy) * (tileH / 2) + camera.y * camera.zoom
      
      c.beginPath()
      c.moveTo(startX, startY)
      c.lineTo(endX, endY)
      c.stroke()
    }

    // 绘制副对角线方向的网格线 (gy 固定)
    for (let gy = -GRID_SIZE; gy <= GRID_SIZE; gy++) {
      const startGx = -GRID_SIZE
      const endGx = GRID_SIZE
      
      const startX = halfW + (startGx - gy) * (tileW / 2) + camera.x * camera.zoom
      const startY = halfH + (startGx + gy) * (tileH / 2) + camera.y * camera.zoom
      const endX = halfW + (endGx - gy) * (tileW / 2) + camera.x * camera.zoom
      const endY = halfH + (endGx + gy) * (tileH / 2) + camera.y * camera.zoom
      
      c.beginPath()
      c.moveTo(startX, startY)
      c.lineTo(endX, endY)
      c.stroke()
    }

    // 在格点上绘制小圆点（交叉点强调）
    c.fillStyle = 'rgba(160, 150, 135, 0.25)'
    for (let gx = -GRID_SIZE; gx <= GRID_SIZE; gx += 2) {
      for (let gy = -GRID_SIZE; gy <= GRID_SIZE; gy += 2) {
        const screenX = halfW + (gx - gy) * (tileW / 2) + camera.x * camera.zoom
        const screenY = halfH + (gx + gy) * (tileH / 2) + camera.y * camera.zoom

        // 视锥裁剪
        if (screenX < -50 || screenX > width + 50 ||
            screenY < -50 || screenY > height + 50) {
          continue
        }

        const dotRadius = Math.max(1.5, 2.5 * camera.zoom)
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
