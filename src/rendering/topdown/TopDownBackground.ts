// ============================================
// DD-OS 俯视角背景渲染器 v3
// 简化版：纯色草地背景
// ============================================

import type { BackgroundRenderer, RenderContext, GridPosition } from '../types'

/**
 * 俯视角背景渲染器
 * 使用纯色渲染，不依赖瓦片图集
 */
export class TopDownBackground implements BackgroundRenderer {
  readonly id = 'topdown-background'

  /**
   * 更新 Nexus 位置（保留接口兼容性）
   */
  updateNexusPositions(_positions: GridPosition[]): void {
    // 纯色背景不需要根据 Nexus 位置变化
  }

  resize(_width: number, _height: number): void {
    // 无需缓存
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height } = ctx

    // 纯色草地背景
    c.fillStyle = '#7ec850'
    c.fillRect(0, 0, width, height)

    // 添加一些纹理感
    this.drawGrassPattern(c, width, height, ctx.camera)
  }

  /**
   * 绘制草地纹理图案
   */
  private drawGrassPattern(
    c: CanvasRenderingContext2D,
    width: number,
    height: number,
    camera: { x: number, y: number, zoom: number }
  ): void {
    const gridSize = 48 * camera.zoom
    const offsetX = (camera.x * camera.zoom) % gridSize
    const offsetY = (camera.y * camera.zoom) % gridSize

    // 绘制浅色格子图案
    c.fillStyle = 'rgba(100, 180, 60, 0.3)'

    for (let y = -gridSize + offsetY; y < height + gridSize; y += gridSize * 2) {
      for (let x = -gridSize + offsetX; x < width + gridSize; x += gridSize * 2) {
        c.fillRect(x, y, gridSize, gridSize)
        c.fillRect(x + gridSize, y + gridSize, gridSize, gridSize)
      }
    }

    // 随机小草点缀（基于坐标的确定性随机）
    c.fillStyle = 'rgba(60, 140, 40, 0.4)'
    const dotSize = 4 * camera.zoom

    for (let y = 0; y < height; y += 32) {
      for (let x = 0; x < width; x += 32) {
        const worldX = (x - width / 2 - camera.x * camera.zoom) / camera.zoom
        const worldY = (y - height / 2 - camera.y * camera.zoom) / camera.zoom
        const hash = Math.abs((Math.floor(worldX) * 73856093) ^ (Math.floor(worldY) * 19349663)) % 100

        if (hash < 15) {
          c.beginPath()
          c.arc(x, y, dotSize, 0, Math.PI * 2)
          c.fill()
        }
      }
    }
  }

  dispose(): void {
    // 无需清理
  }
}
