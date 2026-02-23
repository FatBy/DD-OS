// ============================================
// DD-OS 城市地块系统
// 管理地块分配、道路网格、Nexus 吸附
// ============================================

/**
 * 地块大小（等轴测网格单位）
 * 每个地块是 BLOCK_SIZE x BLOCK_SIZE 的等轴测格子
 */
export const BLOCK_SIZE = 5

/**
 * 道路宽度（格子数）
 */
export const ROAD_WIDTH = 1

/**
 * 地块信息
 */
export interface CityBlock {
  /** 地块 ID (格式: "bx,by") */
  id: string
  /** 地块网格坐标 (非等轴测坐标) */
  blockX: number
  blockY: number
  /** 地块中心的等轴测坐标 */
  centerIsoX: number
  centerIsoY: number
  /** 占用的 Nexus ID (null 表示空闲) */
  occupiedBy: string | null
}

/**
 * 道路段信息
 */
export interface RoadSegment {
  isoX: number
  isoY: number
  type: 'h' | 'v' | 'cross' | 't-up' | 't-down' | 't-left' | 't-right' |
        'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br'
}

/**
 * 城市地块系统
 * 负责：
 * 1. 地块分配和管理
 * 2. 道路网格生成
 * 3. Nexus 位置吸附
 */
export class CityBlockSystem {
  private blocks: Map<string, CityBlock> = new Map()
  private roads: Map<string, RoadSegment> = new Map()
  
  // 城市边界（地块坐标）
  private minBlockX = 0
  private maxBlockX = 0
  private minBlockY = 0
  private maxBlockY = 0
  
  // 是否需要重新生成道路
  private dirty = true

  /**
   * 将等轴测坐标转换为地块坐标
   */
  isoToBlock(isoX: number, isoY: number): { blockX: number; blockY: number } {
    // 每个地块占 BLOCK_SIZE + ROAD_WIDTH 个格子
    const cellSize = BLOCK_SIZE + ROAD_WIDTH
    return {
      blockX: Math.floor(isoX / cellSize),
      blockY: Math.floor(isoY / cellSize),
    }
  }

  /**
   * 将地块坐标转换为地块中心的等轴测坐标
   */
  blockToIsoCenter(blockX: number, blockY: number): { isoX: number; isoY: number } {
    const cellSize = BLOCK_SIZE + ROAD_WIDTH
    // 地块中心 = 地块起始 + 道路宽度 + 地块大小/2
    return {
      isoX: blockX * cellSize + ROAD_WIDTH + Math.floor(BLOCK_SIZE / 2),
      isoY: blockY * cellSize + ROAD_WIDTH + Math.floor(BLOCK_SIZE / 2),
    }
  }

  /**
   * 获取地块的等轴测边界
   */
  getBlockBounds(blockX: number, blockY: number): {
    minIsoX: number
    maxIsoX: number
    minIsoY: number
    maxIsoY: number
  } {
    const cellSize = BLOCK_SIZE + ROAD_WIDTH
    const startX = blockX * cellSize + ROAD_WIDTH
    const startY = blockY * cellSize + ROAD_WIDTH
    return {
      minIsoX: startX,
      maxIsoX: startX + BLOCK_SIZE - 1,
      minIsoY: startY,
      maxIsoY: startY + BLOCK_SIZE - 1,
    }
  }

  /**
   * 分配地块给 Nexus
   * 如果给定位置的地块已被占用，会寻找最近的空闲地块
   */
  allocateBlock(nexusId: string, preferredIsoX: number, preferredIsoY: number): CityBlock {
    const { blockX, blockY } = this.isoToBlock(preferredIsoX, preferredIsoY)
    const blockId = `${blockX},${blockY}`
    
    // 检查首选地块是否空闲
    let block = this.blocks.get(blockId)
    if (!block || block.occupiedBy === null) {
      // 创建或更新地块
      const center = this.blockToIsoCenter(blockX, blockY)
      block = {
        id: blockId,
        blockX,
        blockY,
        centerIsoX: center.isoX,
        centerIsoY: center.isoY,
        occupiedBy: nexusId,
      }
      this.blocks.set(blockId, block)
      this.updateBounds(blockX, blockY)
      this.dirty = true
      return block
    }
    
    // 首选地块已被占用，寻找最近的空闲地块（螺旋搜索）
    for (let radius = 1; radius <= 10; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue
          
          const newBlockX = blockX + dx
          const newBlockY = blockY + dy
          const newBlockId = `${newBlockX},${newBlockY}`
          
          const existing = this.blocks.get(newBlockId)
          if (!existing || existing.occupiedBy === null) {
            const center = this.blockToIsoCenter(newBlockX, newBlockY)
            const newBlock: CityBlock = {
              id: newBlockId,
              blockX: newBlockX,
              blockY: newBlockY,
              centerIsoX: center.isoX,
              centerIsoY: center.isoY,
              occupiedBy: nexusId,
            }
            this.blocks.set(newBlockId, newBlock)
            this.updateBounds(newBlockX, newBlockY)
            this.dirty = true
            return newBlock
          }
        }
      }
    }
    
    // 实在找不到，返回首选位置（会重叠）
    const center = this.blockToIsoCenter(blockX, blockY)
    return {
      id: blockId,
      blockX,
      blockY,
      centerIsoX: center.isoX,
      centerIsoY: center.isoY,
      occupiedBy: nexusId,
    }
  }

  /**
   * 释放地块
   */
  releaseBlock(nexusId: string): void {
    for (const block of this.blocks.values()) {
      if (block.occupiedBy === nexusId) {
        block.occupiedBy = null
        this.dirty = true
        return
      }
    }
  }

  /**
   * 获取 Nexus 应该吸附到的等轴测坐标
   */
  snapToBlockCenter(isoX: number, isoY: number): { isoX: number; isoY: number } {
    const { blockX, blockY } = this.isoToBlock(isoX, isoY)
    return this.blockToIsoCenter(blockX, blockY)
  }

  /**
   * 更新城市边界
   */
  private updateBounds(blockX: number, blockY: number): void {
    this.minBlockX = Math.min(this.minBlockX, blockX)
    this.maxBlockX = Math.max(this.maxBlockX, blockX)
    this.minBlockY = Math.min(this.minBlockY, blockY)
    this.maxBlockY = Math.max(this.maxBlockY, blockY)
  }

  /**
   * 生成道路网格
   * 道路在地块边界形成井字形网格
   */
  generateRoads(): void {
    if (!this.dirty) return
    
    this.roads.clear()
    
    // 如果没有地块，不生成道路
    if (this.blocks.size === 0) return
    
    const cellSize = BLOCK_SIZE + ROAD_WIDTH
    
    // 扩展边界以包含周边道路
    const extendedMinX = this.minBlockX - 1
    const extendedMaxX = this.maxBlockX + 1
    const extendedMinY = this.minBlockY - 1
    const extendedMaxY = this.maxBlockY + 1
    
    // 生成水平道路线
    for (let by = extendedMinY; by <= extendedMaxY + 1; by++) {
      const isoY = by * cellSize
      for (let bx = extendedMinX; bx <= extendedMaxX; bx++) {
        for (let dx = 0; dx < cellSize; dx++) {
          const isoX = bx * cellSize + dx
          this.markRoad(isoX, isoY)
        }
      }
    }
    
    // 生成垂直道路线
    for (let bx = extendedMinX; bx <= extendedMaxX + 1; bx++) {
      const isoX = bx * cellSize
      for (let by = extendedMinY; by <= extendedMaxY; by++) {
        for (let dy = 0; dy < cellSize; dy++) {
          const isoY = by * cellSize + dy
          this.markRoad(isoX, isoY)
        }
      }
    }
    
    // 计算道路类型（直行、拐角、T字、十字）
    this.calculateRoadTypes()
    
    this.dirty = false
  }

  private markRoad(isoX: number, isoY: number): void {
    const key = `${isoX},${isoY}`
    if (!this.roads.has(key)) {
      this.roads.set(key, { isoX, isoY, type: 'h' })
    }
  }

  private hasRoad(isoX: number, isoY: number): boolean {
    return this.roads.has(`${isoX},${isoY}`)
  }

  private calculateRoadTypes(): void {
    for (const [, road] of this.roads) {
      const { isoX, isoY } = road
      
      const up = this.hasRoad(isoX, isoY - 1)
      const down = this.hasRoad(isoX, isoY + 1)
      const left = this.hasRoad(isoX - 1, isoY)
      const right = this.hasRoad(isoX + 1, isoY)
      
      const count = [up, down, left, right].filter(Boolean).length
      
      if (count === 4) {
        road.type = 'cross'
      } else if (count === 3) {
        if (!up) road.type = 't-down'
        else if (!down) road.type = 't-up'
        else if (!left) road.type = 't-right'
        else road.type = 't-left'
      } else if (count === 2) {
        if (up && down) road.type = 'v'
        else if (left && right) road.type = 'h'
        else if (down && right) road.type = 'corner-tl'
        else if (down && left) road.type = 'corner-tr'
        else if (up && right) road.type = 'corner-bl'
        else if (up && left) road.type = 'corner-br'
      } else if (count === 1) {
        if (up || down) road.type = 'v'
        else road.type = 'h'
      }
    }
  }

  /**
   * 获取所有道路段
   */
  getRoads(): RoadSegment[] {
    this.generateRoads()
    return [...this.roads.values()]
  }

  /**
   * 获取所有被占用的地块
   */
  getOccupiedBlocks(): CityBlock[] {
    return [...this.blocks.values()].filter(b => b.occupiedBy !== null)
  }

  /**
   * 获取城市边界（等轴测坐标）
   */
  getCityBounds(): {
    minIsoX: number
    maxIsoX: number
    minIsoY: number
    maxIsoY: number
  } | null {
    if (this.blocks.size === 0) return null
    
    const cellSize = BLOCK_SIZE + ROAD_WIDTH
    return {
      minIsoX: (this.minBlockX - 1) * cellSize,
      maxIsoX: (this.maxBlockX + 2) * cellSize,
      minIsoY: (this.minBlockY - 1) * cellSize,
      maxIsoY: (this.maxBlockY + 2) * cellSize,
    }
  }

  /**
   * 检查某个等轴测坐标是否在道路上
   */
  isOnRoad(isoX: number, isoY: number): boolean {
    return this.roads.has(`${isoX},${isoY}`)
  }

  /**
   * 检查某个等轴测坐标是否在某个地块内部
   */
  isInsideBlock(isoX: number, isoY: number): boolean {
    const { blockX, blockY } = this.isoToBlock(isoX, isoY)
    const bounds = this.getBlockBounds(blockX, blockY)
    return isoX >= bounds.minIsoX && isoX <= bounds.maxIsoX &&
           isoY >= bounds.minIsoY && isoY <= bounds.maxIsoY
  }

  /**
   * 同步 Nexus 位置到地块系统
   */
  syncNexusPositions(positions: Array<{ id: string; gridX: number; gridY: number }>): void {
    // 清除所有占用
    for (const block of this.blocks.values()) {
      block.occupiedBy = null
    }
    
    // 重新分配
    for (const { id, gridX, gridY } of positions) {
      this.allocateBlock(id, gridX, gridY)
    }
  }

  /**
   * 清空
   */
  clear(): void {
    this.blocks.clear()
    this.roads.clear()
    this.minBlockX = 0
    this.maxBlockX = 0
    this.minBlockY = 0
    this.maxBlockY = 0
    this.dirty = true
  }
}

// 单例
let instance: CityBlockSystem | null = null

export function getCityBlockSystem(): CityBlockSystem {
  if (!instance) {
    instance = new CityBlockSystem()
  }
  return instance
}
