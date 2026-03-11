// ============================================
// Smallville 背景渲染器
// Town: 瓦片草地  |  Room: 深色背景 + 地板
// ============================================

import type { BackgroundRenderer, RenderContext } from '../types'
import type { SmallvilleViewManager } from './SmallvilleViewManager'
import type { SmallvilleSpriteAtlas } from './SmallvilleSpriteAtlas'
import { SV_GRASS } from './SmallvilleTiles'
import type { SvTile } from './SmallvilleTiles'

const TILE_SIZE = 16
const RENDER_SCALE = 3  // 16px * 3 = 48px per tile on screen

// ── 值噪声 (Value Noise) ──────────────────────────
// 用于生成自然的草地色块分布，替代逐瓦片均匀随机

function hash2d(ix: number, iy: number): number {
  let n = ix * 73856093 ^ iy * 19349663
  n = ((n >> 13) ^ n)
  n = (n * (n * n * 15731 + 789221) + 1376312589)
  return ((n & 0x7fffffff) / 0x7fffffff)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash2d(ix, iy),     b = hash2d(ix + 1, iy)
  const c = hash2d(ix, iy + 1), d = hash2d(ix + 1, iy + 1)
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy)
}

/** 根据噪声值选择草地瓦片 */
function selectGrassTile(noise: number): SvTile {
  if (noise < 0.60) return SV_GRASS.MAIN   // 60% 主草地
  if (noise < 0.80) return SV_GRASS.LIGHT  // 20% 浅色
  return SV_GRASS.EDGE                     // 20% 边缘变体
}

/** 根据噪声值选择 fallback 颜色 */
function selectGrassColor(noise: number): string {
  if (noise < 0.60) return '#7ec850'
  if (noise < 0.80) return '#6db848'
  return '#8ed860'
}

export class SmallvilleBackground implements BackgroundRenderer {
  readonly id = 'smallville-background'
  private viewManager: SmallvilleViewManager
  private atlas: SmallvilleSpriteAtlas

  constructor(viewManager: SmallvilleViewManager, atlas: SmallvilleSpriteAtlas) {
    this.viewManager = viewManager
    this.atlas = atlas
  }

  render(ctx: RenderContext): void {
    const { ctx: c } = ctx
    const vm = this.viewManager

    if (vm.isInRoomView()) {
      this.renderRoomBackground(c, ctx)
    } else if (vm.isTransitioning()) {
      this.renderTownBackground(c, ctx)
      const alpha = vm.zoomProgress
      c.save()
      c.globalAlpha = alpha
      this.renderRoomBackground(c, ctx)
      c.restore()
    } else {
      this.renderTownBackground(c, ctx)
    }
  }

  private renderTownBackground(c: CanvasRenderingContext2D, ctx: RenderContext): void {
    const { width, height, camera } = ctx

    const scale = RENDER_SCALE * camera.zoom
    const tileScreen = TILE_SIZE * scale

    const offsetX = ((width / 2 + camera.x * camera.zoom) % tileScreen + tileScreen) % tileScreen
    const offsetY = ((height / 2 + camera.y * camera.zoom) % tileScreen + tileScreen) % tileScreen

    for (let sy = -tileScreen + offsetY; sy < height + tileScreen; sy += tileScreen) {
      for (let sx = -tileScreen + offsetX; sx < width + tileScreen; sx += tileScreen) {
        const worldTileX = Math.floor((sx - width / 2 - camera.x * camera.zoom) / tileScreen)
        const worldTileY = Math.floor((sy - height / 2 - camera.y * camera.zoom) / tileScreen)

        // 值噪声生成自然的草地色块 (频率 0.12 ≈ 每 8 瓦片一个渐变周期)
        const noise = valueNoise(worldTileX * 0.12, worldTileY * 0.12)

        if (this.atlas.isReady()) {
          const tile = selectGrassTile(noise)
          this.atlas.drawTile(c, tile.col, tile.row, sx, sy, scale)
        } else {
          c.fillStyle = selectGrassColor(noise)
          c.fillRect(sx, sy, tileScreen, tileScreen)
        }
      }
    }
  }

  private renderRoomBackground(c: CanvasRenderingContext2D, ctx: RenderContext): void {
    const { width, height } = ctx

    c.fillStyle = '#1a1a2e'
    c.fillRect(0, 0, width, height)

    const vm = this.viewManager
    const layout = vm.roomLayout
    if (!layout) return

    const roomScale = 3.5
    const tileScreen = TILE_SIZE * roomScale
    const roomPixelW = layout.width * tileScreen
    const roomPixelH = layout.height * tileScreen
    const startX = (width - roomPixelW) / 2
    const startY = (height - roomPixelH) / 2

    for (let ty = 1; ty < layout.height - 1; ty++) {
      for (let tx = 1; tx < layout.width - 1; tx++) {
        const isLight = (tx + ty) % 2 === 0
        c.fillStyle = isLight ? '#5c4a3a' : '#4d3d2f'
        c.fillRect(startX + tx * tileScreen, startY + ty * tileScreen, tileScreen, tileScreen)
      }
    }
  }

  dispose(): void {}
}
