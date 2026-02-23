// ============================================
// DD-OS 俯视角道路网格渲染器
// 自动连接建筑的道路系统
// ============================================

import type { GridRenderer, RenderContext, GridPosition } from '../types'
import { getTileAtlas, TILE_SIZE, TILES, type TileInfo } from './TileAtlas'

const RENDER_SCALE = 3

type RoadType = 'none' | 'h' | 'v' | 'cross' | 't-up' | 't-down' | 't-left' | 't-right' |
                'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br' |
                'end-u' | 'end-d' | 'end-l' | 'end-r'

/**
 * 俯视角道路网格渲染器
 */
export class TopDownGrid implements GridRenderer {
  readonly id = 'topdown-grid'

  private atlas = getTileAtlas()
  private nexusPositions: GridPosition[] = []
  private roadMap: Map<string, RoadType> = new Map()

  updateNexusPositions(positions: GridPosition[]): void {
    this.nexusPositions = positions
    this.generateRoadNetwork()
  }

  /**
   * 生成道路网络
   * 简单策略：从每个建筑向中心铺设道路
   */
  private generateRoadNetwork(): void {
    this.roadMap.clear()

    if (this.nexusPositions.length === 0) return

    // 计算建筑中心
    let centerX = 0, centerY = 0
    for (const pos of this.nexusPositions) {
      centerX += pos.gridX
      centerY += pos.gridY
    }
    centerX = Math.round(centerX / this.nexusPositions.length)
    centerY = Math.round(centerY / this.nexusPositions.length)

    // 从每个建筑铺设道路到中心主干道
    for (const pos of this.nexusPositions) {
      // 水平连接
      const startX = Math.min(pos.gridX, centerX)
      const endX = Math.max(pos.gridX, centerX)
      for (let x = startX; x <= endX; x++) {
        this.markRoad(x, pos.gridY)
      }

      // 垂直连接
      const startY = Math.min(pos.gridY, centerY)
      const endY = Math.max(pos.gridY, centerY)
      for (let y = startY; y <= endY; y++) {
        this.markRoad(centerX, y)
      }
    }

    // 主干道 (中心十字)
    for (let x = centerX - 5; x <= centerX + 5; x++) {
      this.markRoad(x, centerY)
    }
    for (let y = centerY - 5; y <= centerY + 5; y++) {
      this.markRoad(centerX, y)
    }

    // 确定每个格子的道路类型
    this.calculateRoadTypes()
  }

  private markRoad(x: number, y: number): void {
    const key = `${x},${y}`
    if (!this.roadMap.has(key)) {
      this.roadMap.set(key, 'h')  // 临时标记
    }
  }

  private hasRoad(x: number, y: number): boolean {
    return this.roadMap.has(`${x},${y}`)
  }

  private calculateRoadTypes(): void {
    for (const [key] of this.roadMap) {
      const [x, y] = key.split(',').map(Number)

      const up = this.hasRoad(x, y - 1)
      const down = this.hasRoad(x, y + 1)
      const left = this.hasRoad(x - 1, y)
      const right = this.hasRoad(x + 1, y)

      const count = [up, down, left, right].filter(Boolean).length
      let type: RoadType = 'none'

      if (count === 4) {
        type = 'cross'
      } else if (count === 3) {
        if (!up) type = 't-up'
        else if (!down) type = 't-down'
        else if (!left) type = 't-left'
        else type = 't-right'
      } else if (count === 2) {
        if (up && down) type = 'v'
        else if (left && right) type = 'h'
        else if (up && right) type = 'corner-bl'
        else if (up && left) type = 'corner-br'
        else if (down && right) type = 'corner-tl'
        else if (down && left) type = 'corner-tr'
      } else if (count === 1) {
        if (up) type = 'end-d'
        else if (down) type = 'end-u'
        else if (left) type = 'end-r'
        else type = 'end-l'
      } else {
        type = 'h'  // 孤立点
      }

      this.roadMap.set(key, type)
    }
  }

  private getRoadTile(type: RoadType): TileInfo {
    switch (type) {
      case 'h': return TILES.ROAD_H
      case 'v': return TILES.ROAD_V
      case 'cross': return TILES.ROAD_CROSS
      case 't-up': return TILES.ROAD_T_UP
      case 't-down': return TILES.ROAD_T_DOWN
      case 't-left': return TILES.ROAD_T_LEFT
      case 't-right': return TILES.ROAD_T_RIGHT
      case 'corner-tl': return TILES.ROAD_CORNER_TL
      case 'corner-tr': return TILES.ROAD_CORNER_TR
      case 'corner-bl': return TILES.ROAD_CORNER_BL
      case 'corner-br': return TILES.ROAD_CORNER_BR
      case 'end-u': return TILES.ROAD_END_U
      case 'end-d': return TILES.ROAD_END_D
      case 'end-l': return TILES.ROAD_END_L
      case 'end-r': return TILES.ROAD_END_R
      default: return TILES.ROAD_H
    }
  }

  render(ctx: RenderContext): void {
    if (!this.atlas.isLoaded()) return
    if (this.roadMap.size === 0) return

    const { ctx: c, width, height, camera } = ctx

    const scale = RENDER_SCALE * camera.zoom
    const tileSize = TILE_SIZE * scale
    const halfW = width / 2
    const halfH = height / 2

    c.save()

    // 遍历所有道路格子
    for (const [key, type] of this.roadMap) {
      const [gx, gy] = key.split(',').map(Number)

      // 世界坐标 → 屏幕坐标 (俯视角)
      const screenX = halfW + gx * tileSize + camera.x * camera.zoom
      const screenY = halfH + gy * tileSize + camera.y * camera.zoom

      // 视锥裁剪
      if (screenX < -tileSize * 2 || screenX > width + tileSize * 2 ||
          screenY < -tileSize * 2 || screenY > height + tileSize * 2) {
        continue
      }

      const tile = this.getRoadTile(type)
      this.atlas.drawTile(c, tile, screenX - tileSize / 2, screenY - tileSize / 2, scale)
    }

    c.restore()
  }

  dispose(): void {
    this.roadMap.clear()
    this.nexusPositions = []
  }
}
