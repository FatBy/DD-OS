// ============================================
// DD-OS 城市网格渲染器
// 等距视角的草地/道路/人行道混合网格
// ============================================

import type { GridRenderer, RenderContext, GridPosition } from '../types'

// 瓦片尺寸常量（与素材匹配）
const TILE_WIDTH = 128
const TILE_HEIGHT = 64

// 瓦片类型枚举
type TileType = 'grass' | 'road_ne' | 'road_nw' | 'road_cross' | 'road_curve' | 'sidewalk' | 'parking'

// 瓦片素材映射
const TILE_SPRITES: Record<TileType, string[]> = {
  grass:      [
    '/assets/kenney/isometric-city/PNG/cityTiles_066.png',
    '/assets/kenney/isometric-city/PNG/cityTiles_074.png',
  ],
  road_ne:    ['/assets/kenney/isometric-city/PNG/cityTiles_005.png'],
  road_nw:    ['/assets/kenney/isometric-city/PNG/cityTiles_009.png'],
  road_cross: ['/assets/kenney/isometric-city/PNG/cityTiles_063.png'],
  road_curve: ['/assets/kenney/isometric-city/PNG/cityTiles_027.png'],
  sidewalk:   [
    '/assets/kenney/isometric-city/PNG/cityTiles_073.png',
    '/assets/kenney/isometric-city/PNG/cityTiles_079.png',
  ],
  parking:    ['/assets/kenney/isometric-city/PNG/cityTiles_080.png'],
}

// 简易坐标哈希（确定性随机，避免闪烁）
function tileHash(gx: number, gy: number): number {
  let h = ((gx * 374761 + gy * 668265) & 0x7fffffff)
  h = ((h >> 16) ^ h) * 0x45d9f3b
  return (h & 0x7fffffff)
}

/**
 * 城市地面网格渲染器
 * 自动在建筑周围生成道路网络，其余区域铺设草地
 */
export class CityGrid implements GridRenderer {
  readonly id = 'city-grid'
  
  private sprites = new Map<string, HTMLImageElement>()
  private loaded = false
  private loadedCount = 0
  private totalCount = 0

  // 道路网络缓存
  private roadSet = new Set<string>()        // "gx,gy" → 是道路
  private sidewalkSet = new Set<string>()    // "gx,gy" → 是人行道
  private nexusSet = new Set<string>()       // "gx,gy" → 有建筑
  private roadDirty = true                   // 需要重新生成

  constructor() {
    this.loadTiles()
  }

  private loadTiles(): void {
    const allPaths = new Set<string>()
    for (const paths of Object.values(TILE_SPRITES)) {
      for (const p of paths) allPaths.add(p)
    }
    
    this.totalCount = allPaths.size
    
    for (const src of allPaths) {
      const img = new Image()
      img.src = src
      img.onload = () => {
        this.loadedCount++
        if (this.loadedCount >= this.totalCount) this.loaded = true
      }
      img.onerror = () => {
        this.loadedCount++
        if (this.loadedCount >= this.totalCount) this.loaded = true
      }
      this.sprites.set(src, img)
    }
  }

  /**
   * 接收 Nexus 位置列表，生成道路网络
   */
  updateNexusPositions(positions: GridPosition[]): void {
    // 检查是否有变化
    const newKey = positions.map(p => `${p.gridX},${p.gridY}`).sort().join('|')
    const oldKey = [...this.nexusSet].sort().join('|')
    if (newKey === oldKey) return
    
    this.nexusSet.clear()
    for (const p of positions) {
      this.nexusSet.add(`${p.gridX},${p.gridY}`)
    }
    this.roadDirty = true
  }

  /**
   * 基于建筑位置生成道路网络
   * 策略：每个建筑向四个方向延伸 3 格道路，交汇处自然形成路网
   */
  private buildRoadNetwork(): void {
    if (!this.roadDirty) return
    this.roadDirty = false
    
    this.roadSet.clear()
    this.sidewalkSet.clear()
    
    const buildingPositions: GridPosition[] = []
    for (const key of this.nexusSet) {
      const [gx, gy] = key.split(',').map(Number)
      buildingPositions.push({ gridX: gx, gridY: gy })
    }
    
    if (buildingPositions.length === 0) return
    
    // 为每个建筑铺设十字形道路
    const ROAD_EXTEND = 3
    for (const pos of buildingPositions) {
      // 向四个等距方向延伸道路
      for (let d = 1; d <= ROAD_EXTEND; d++) {
        // NE-SW 方向（gridX 变化）
        this.roadSet.add(`${pos.gridX + d},${pos.gridY}`)
        this.roadSet.add(`${pos.gridX - d},${pos.gridY}`)
        // NW-SE 方向（gridY 变化）
        this.roadSet.add(`${pos.gridX},${pos.gridY + d}`)
        this.roadSet.add(`${pos.gridX},${pos.gridY - d}`)
      }
    }
    
    // 移除建筑占据的格子上的道路
    for (const key of this.nexusSet) {
      this.roadSet.delete(key)
    }
    
    // 在道路旁边生成人行道（与道路相邻且不是道路/建筑的格子）
    for (const roadKey of this.roadSet) {
      const [rx, ry] = roadKey.split(',').map(Number)
      const neighbors = [
        `${rx + 1},${ry}`, `${rx - 1},${ry}`,
        `${rx},${ry + 1}`, `${rx},${ry - 1}`,
      ]
      for (const nk of neighbors) {
        if (!this.roadSet.has(nk) && !this.nexusSet.has(nk)) {
          this.sidewalkSet.add(nk)
        }
      }
    }
  }

  /**
   * 获取某个格子应该使用的瓦片类型
   */
  private getTileForPosition(gx: number, gy: number): TileType {
    const key = `${gx},${gy}`
    
    // 建筑所在格子 → 停车场/柏油
    if (this.nexusSet.has(key)) return 'parking'
    
    // 道路格子 → 根据连接方向选择
    if (this.roadSet.has(key)) {
      const hasNE = this.roadSet.has(`${gx + 1},${gy}`) || this.nexusSet.has(`${gx + 1},${gy}`)
      const hasSW = this.roadSet.has(`${gx - 1},${gy}`) || this.nexusSet.has(`${gx - 1},${gy}`)
      const hasNW = this.roadSet.has(`${gx},${gy - 1}`) || this.nexusSet.has(`${gx},${gy - 1}`)
      const hasSE = this.roadSet.has(`${gx},${gy + 1}`) || this.nexusSet.has(`${gx},${gy + 1}`)
      
      const horizontal = hasNE || hasSW
      const vertical = hasNW || hasSE
      
      if (horizontal && vertical) return 'road_cross'
      if (horizontal) return 'road_ne'
      if (vertical) return 'road_nw'
      return 'road_ne' // fallback
    }
    
    // 人行道
    if (this.sidewalkSet.has(key)) return 'sidewalk'
    
    // 默认草地
    return 'grass'
  }

  /**
   * 根据类型和坐标获取具体的素材图片
   */
  private getSpriteForTile(type: TileType, gx: number, gy: number): HTMLImageElement | null {
    const paths = TILE_SPRITES[type]
    if (!paths || paths.length === 0) return null
    
    // 基于坐标 hash 选择变体（避免所有格子用同一张图）
    const idx = tileHash(gx, gy) % paths.length
    return this.sprites.get(paths[idx]) || null
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height, camera } = ctx
    
    // 确保道路网络是最新的
    this.buildRoadNetwork()
    
    const halfW = width / 2
    const halfH = height / 2

    // 瓦片缩放
    const scale = camera.zoom * 0.8
    const tileW = TILE_WIDTH * scale
    const tileH = TILE_HEIGHT * scale

    // 计算需要绘制的瓦片范围
    const gridRange = Math.ceil(Math.max(width, height) / tileW) + 3

    c.save()
    
    if (this.loaded) {
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
          
          // 选择瓦片类型和素材
          const tileType = this.getTileForPosition(gx, gy)
          const sprite = this.getSpriteForTile(tileType, gx, gy)
          
          if (sprite && sprite.complete && sprite.naturalWidth > 0) {
            // 道路和建筑下方完全不透明，草地略微透明
            c.globalAlpha = tileType === 'grass' ? 0.85 : 0.95
            c.drawImage(
              sprite,
              screenX - tileW / 2,
              screenY - tileH / 2,
              tileW,
              tileH
            )
          }
        }
      }
      c.globalAlpha = 1
    } else {
      // 回退：简单的等距网格线
      this.renderFallbackGrid(c, camera, tileW, tileH, halfW, halfH, gridRange)
    }

    c.restore()

    // 中心区域柔和光晕（绿色调）
    const centerGlow = c.createRadialGradient(halfW, halfH, 0, halfW, halfH, 400)
    centerGlow.addColorStop(0, 'rgba(150, 200, 100, 0.04)')
    centerGlow.addColorStop(1, 'rgba(150, 200, 100, 0)')
    c.fillStyle = centerGlow
    c.fillRect(0, 0, width, height)
  }

  private renderFallbackGrid(
    c: CanvasRenderingContext2D,
    camera: { x: number; y: number; zoom: number },
    tileW: number,
    tileH: number,
    halfW: number,
    halfH: number,
    gridRange: number
  ): void {
    c.strokeStyle = 'rgba(139, 119, 101, 0.15)'
    c.lineWidth = 1

    const offsetX = camera.x * camera.zoom
    const offsetY = camera.y * camera.zoom

    c.translate(halfW + offsetX, halfH + offsetY)

    for (let i = -gridRange; i <= gridRange; i++) {
      c.beginPath()
      c.moveTo(i * tileW / 2, -gridRange * tileH / 2 + i * tileH / 2)
      c.lineTo(i * tileW / 2 + gridRange * tileW, gridRange * tileH / 2 + i * tileH / 2)
      c.stroke()

      c.beginPath()
      c.moveTo(-gridRange * tileW / 2 + i * tileW / 2, i * tileH / 2)
      c.lineTo(gridRange * tileW / 2 + i * tileW / 2, i * tileH / 2 - gridRange * tileH)
      c.stroke()
    }
  }

  dispose(): void {
    this.sprites.clear()
    this.roadSet.clear()
    this.sidewalkSet.clear()
    this.nexusSet.clear()
  }
}
