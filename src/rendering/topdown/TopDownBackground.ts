// ============================================
// DD-OS 俯视角背景渲染器
// 草地背景 + 道路网格
// ============================================

import type { BackgroundRenderer, RenderContext } from '../types'
import { getTileAtlas, TILE_SIZE, TILES } from './TileAtlas'

const RENDER_SCALE = 3

/**
 * 俯视角草地背景渲染器
 */
export class TopDownBackground implements BackgroundRenderer {
  readonly id = 'topdown-background'

  private atlas = getTileAtlas()

  resize(_width: number, _height: number): void {
    // 无需缓存
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height, camera } = ctx

    // 先填充纯色背景
    c.fillStyle = '#7ec850'  // 草绿色
    c.fillRect(0, 0, width, height)

    // 如果图集未加载，只显示纯色
    if (!this.atlas.isLoaded()) return

    const scale = RENDER_SCALE * camera.zoom
    const tileSize = TILE_SIZE * scale

    // 计算可见区域的瓦片范围
    const offsetX = (width / 2 + camera.x * camera.zoom) % tileSize
    const offsetY = (height / 2 + camera.y * camera.zoom) % tileSize

    const startX = -offsetX - tileSize
    const startY = -offsetY - tileSize
    const cols = Math.ceil(width / tileSize) + 3
    const rows = Math.ceil(height / tileSize) + 3

    // 绘制草地瓦片
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = startX + col * tileSize
        const y = startY + row * tileSize

        // 交替使用两种草地瓦片增加变化
        const variant = (col + row) % 2 === 0 ? TILES.GRASS : TILES.GRASS_DARK
        this.atlas.drawTile(c, variant, x, y, scale)
      }
    }
  }

  dispose(): void {
    // 无需清理
  }
}
