// ============================================
// DD-OS 城市网格渲染器
// 等距视角的草地/土地瓦片网格
// ============================================

import type { GridRenderer, RenderContext } from '../types'

// 瓦片尺寸常量（与素材匹配）
const TILE_WIDTH = 132  // isometric-city 瓦片宽度
const TILE_HEIGHT = 66  // 高度约为宽度的一半

/**
 * 城市地面网格渲染器
 * 使用 Kenney isometric-city 草地瓦片
 */
export class CityGrid implements GridRenderer {
  readonly id = 'city-grid'
  
  private grassTile: HTMLImageElement | null = null
  private dirtTile: HTMLImageElement | null = null
  private loaded = false

  constructor() {
    this.loadTiles()
  }

  private loadTiles(): void {
    // 草地瓦片
    this.grassTile = new Image()
    this.grassTile.src = '/assets/kenney/isometric-city/PNG/cityTiles_066.png'
    
    // 备用土地瓦片
    this.dirtTile = new Image()
    this.dirtTile.src = '/assets/kenney/isometric-city/PNG/cityTiles_072.png'
    
    // 标记加载完成
    Promise.all([
      new Promise(r => { this.grassTile!.onload = r; this.grassTile!.onerror = r }),
      new Promise(r => { this.dirtTile!.onload = r; this.dirtTile!.onerror = r }),
    ]).then(() => {
      this.loaded = true
    })
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height, camera } = ctx
    
    const halfW = width / 2
    const halfH = height / 2

    // 瓦片缩放
    const scale = camera.zoom * 0.8
    const tileW = TILE_WIDTH * scale
    const tileH = TILE_HEIGHT * scale

    // 计算需要绘制的瓦片范围
    const gridRange = Math.ceil(Math.max(width, height) / tileW) + 3

    c.save()
    
    // 如果瓦片已加载，使用图片渲染
    if (this.loaded && this.grassTile && this.grassTile.complete && this.grassTile.naturalWidth > 0) {
      // 等距网格绘制
      for (let gx = -gridRange; gx <= gridRange; gx++) {
        for (let gy = -gridRange; gy <= gridRange; gy++) {
          // 等距坐标转换
          const screenX = halfW + (gx - gy) * (tileW / 2) + camera.x * camera.zoom
          const screenY = halfH + (gx + gy) * (tileH / 2) + camera.y * camera.zoom
          
          // 视锥裁剪
          if (screenX < -tileW || screenX > width + tileW ||
              screenY < -tileH * 2 || screenY > height + tileH) {
            continue
          }
          
          // 绘制草地瓦片
          c.globalAlpha = 0.4 // 半透明，不抢主角
          c.drawImage(
            this.grassTile,
            screenX - tileW / 2,
            screenY - tileH / 2,
            tileW,
            tileH
          )
        }
      }
      c.globalAlpha = 1
    } else {
      // 回退：绘制简单的等距网格线
      this.renderFallbackGrid(c, width, height, camera, tileW, tileH, halfW, halfH, gridRange)
    }

    c.restore()

    // 中心区域柔和光晕
    const centerGlow = c.createRadialGradient(halfW, halfH, 0, halfW, halfH, 400)
    centerGlow.addColorStop(0, 'rgba(150, 200, 100, 0.05)')  // 绿色调
    centerGlow.addColorStop(1, 'rgba(150, 200, 100, 0)')
    c.fillStyle = centerGlow
    c.fillRect(0, 0, width, height)
  }

  private renderFallbackGrid(
    c: CanvasRenderingContext2D,
    _width: number,
    _height: number,
    camera: { x: number; y: number; zoom: number },
    tileW: number,
    tileH: number,
    halfW: number,
    halfH: number,
    gridRange: number
  ): void {
    // 简单的等距网格线（土地色调）
    c.strokeStyle = 'rgba(139, 119, 101, 0.15)'  // 土棕色
    c.lineWidth = 1

    const offsetX = camera.x * camera.zoom
    const offsetY = camera.y * camera.zoom

    c.translate(halfW + offsetX, halfH + offsetY)

    // 绘制菱形网格
    for (let i = -gridRange; i <= gridRange; i++) {
      // 左下-右上
      c.beginPath()
      c.moveTo(i * tileW / 2, -gridRange * tileH / 2 + i * tileH / 2)
      c.lineTo(i * tileW / 2 + gridRange * tileW, gridRange * tileH / 2 + i * tileH / 2)
      c.stroke()

      // 右下-左上
      c.beginPath()
      c.moveTo(-gridRange * tileW / 2 + i * tileW / 2, i * tileH / 2)
      c.lineTo(gridRange * tileW / 2 + i * tileW / 2, i * tileH / 2 - gridRange * tileH)
      c.stroke()
    }
  }

  dispose(): void {
    this.grassTile = null
    this.dirtTile = null
  }
}
