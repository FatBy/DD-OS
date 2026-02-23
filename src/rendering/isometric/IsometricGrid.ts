// ============================================
// DD-OS 等轴测网格/道路渲染器 (地块网格版)
// 使用 CityBlockSystem 管理固定井字形道路
// ============================================

import type { GridRenderer, RenderContext, GridPosition } from '../types'
import { 
  getIsometricTileAtlas, 
  ISO_TILES,
  ISO_TILE_WIDTH,
  ISO_TILE_HEIGHT,
  type IsoTileInfo,
} from './IsometricTileAtlas'
import { getCityBlockSystem, type RoadSegment } from './CityBlockSystem'

/**
 * 装饰物
 */
interface Decoration {
  isoX: number
  isoY: number
  tile: IsoTileInfo
}

/**
 * 等轴测网格渲染器 (地块网格版)
 * 使用 CityBlockSystem 生成固定井字形道路网格
 * 每个 Nexus 占据一个被道路围绕的完整地块
 */
export class IsometricGrid implements GridRenderer {
  readonly id = 'isometric-grid'

  private decorations: Decoration[] = []
  private lastNexusHash = ''

  updateNexusPositions(positions: GridPosition[]): void {
    // 同步到地块系统
    const blockSystem = getCityBlockSystem()
    
    // 计算位置哈希，只有变化时才重新生成
    const posHash = positions.map(p => `${p.gridX},${p.gridY}`).join('|')
    if (posHash === this.lastNexusHash) return
    this.lastNexusHash = posHash
    
    // 清空并重新分配地块
    blockSystem.clear()
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i]
      // 使用位置作为临时 ID（实际应用中应该用 nexus.id）
      blockSystem.allocateBlock(`nexus-${pos.gridX}-${pos.gridY}`, pos.gridX, pos.gridY)
    }
    
    // 重新生成装饰
    this.generateDecorations()
  }

  /**
   * 在地块内部生成装饰物（树木、草地等）
   */
  private generateDecorations(): void {
    this.decorations = []
    
    const blockSystem = getCityBlockSystem()
    const occupiedBlocks = blockSystem.getOccupiedBlocks()
    
    if (occupiedBlocks.length === 0) return

    const treeTiles = [
      ISO_TILES.TREE_SINGLE,
      ISO_TILES.TREE_GRASS_1,
      ISO_TILES.TREE_GRASS_2,
    ]

    // 遍历所有被占用的地块，在地块内部生成装饰
    for (const block of occupiedBlocks) {
      const blockBounds = blockSystem.getBlockBounds(block.blockX, block.blockY)
      
      // 在地块内部随机放置装饰（避开中心建筑位置）
      for (let x = blockBounds.minIsoX; x <= blockBounds.maxIsoX; x++) {
        for (let y = blockBounds.minIsoY; y <= blockBounds.maxIsoY; y++) {
          // 避开地块中心（建筑位置，3x3 范围）
          const dx = Math.abs(x - block.centerIsoX)
          const dy = Math.abs(y - block.centerIsoY)
          if (dx <= 1 && dy <= 1) continue
          
          // 随机决定是否放置装饰
          const hash = Math.abs((x * 73856093) ^ (y * 19349663)) % 100
          if (hash < 20) {
            const tileIdx = hash % treeTiles.length
            this.decorations.push({
              isoX: x,
              isoY: y,
              tile: treeTiles[tileIdx],
            })
          }
        }
      }
    }
  }

  /**
   * 获取道路类型对应的瓦片
   */
  private getRoadTile(type: RoadSegment['type']): IsoTileInfo {
    switch (type) {
      case 'h':
        return ISO_TILES.ROAD_STRAIGHT_H
      case 'v':
        return ISO_TILES.ROAD_STRAIGHT_V
      case 'cross':
        return ISO_TILES.ROAD_CROSS
      case 't-up':
        return ISO_TILES.ROAD_T_1
      case 't-down':
        return ISO_TILES.ROAD_T_2
      case 't-left':
      case 't-right':
        return ISO_TILES.ROAD_T_3
      case 'corner-tl':
        return ISO_TILES.ROAD_CORNER_1
      case 'corner-tr':
        return ISO_TILES.ROAD_CORNER_2
      case 'corner-bl':
      case 'corner-br':
        return ISO_TILES.ROAD_CORNER_3
      default:
        return ISO_TILES.ROAD_STRAIGHT_H
    }
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height, camera } = ctx
    const atlas = getIsometricTileAtlas()
    const blockSystem = getCityBlockSystem()

    if (!atlas.isLoaded()) return

    const tileW = ISO_TILE_WIDTH * camera.zoom * 0.5
    const tileH = ISO_TILE_HEIGHT * camera.zoom * 0.5
    const halfW = width / 2
    const halfH = height / 2

    // 获取道路
    const roads = blockSystem.getRoads()
    
    // 收集所有需要渲染的对象并按 Y 坐标排序（Y-sorting）
    const renderQueue: Array<{
      screenX: number
      screenY: number
      isoY: number
      isoX: number
      type: 'road' | 'deco'
      data: RoadSegment | Decoration
    }> = []

    // 添加道路（不再渲染草地背景，保持简洁）
    for (const road of roads) {
      const screenX = halfW + (road.isoX - road.isoY) * tileW * 0.5 + camera.x * camera.zoom
      const screenY = halfH + (road.isoX + road.isoY) * tileH * 0.5 + camera.y * camera.zoom

      if (screenX < -tileW * 2 || screenX > width + tileW * 2 ||
          screenY < -tileH * 2 || screenY > height + tileH * 2) {
        continue
      }

      renderQueue.push({ 
        screenX, 
        screenY, 
        isoY: road.isoY, 
        isoX: road.isoX,
        type: 'road', 
        data: road 
      })
    }

    // 添加装饰
    for (const deco of this.decorations) {
      const screenX = halfW + (deco.isoX - deco.isoY) * tileW * 0.5 + camera.x * camera.zoom
      const screenY = halfH + (deco.isoX + deco.isoY) * tileH * 0.5 + camera.y * camera.zoom

      if (screenX < -tileW || screenX > width + tileW ||
          screenY < -tileH * 2 || screenY > height + tileH * 2) {
        continue
      }

      renderQueue.push({ 
        screenX, 
        screenY, 
        isoY: deco.isoY, 
        isoX: deco.isoX,
        type: 'deco', 
        data: deco 
      })
    }

    // Y-sorting: 按等轴测坐标排序 (先 Y 后 X)
    renderQueue.sort((a, b) => {
      const yDiff = a.isoY - b.isoY
      if (yDiff !== 0) return yDiff
      return a.isoX - b.isoX
    })

    // 渲染
    for (const item of renderQueue) {
      if (item.type === 'road') {
        const road = item.data as RoadSegment
        const roadTile = this.getRoadTile(road.type)
        atlas.drawTile(c, roadTile, item.screenX, item.screenY, camera.zoom * 0.5)
      } else {
        const deco = item.data as Decoration
        atlas.drawTile(c, deco.tile, item.screenX, item.screenY, camera.zoom * 0.5)
      }
    }
  }

  dispose(): void {
    this.decorations = []
    this.lastNexusHash = ''
    getCityBlockSystem().clear()
  }
}
