// ============================================
// DD-OS 城市网格系统 v3
// 简化版：纯色道路 + 装饰
// ============================================

import type { GridRenderer, RenderContext, GridPosition } from '../types'

/**
 * 区域类型
 */
export type ZoneType = 'urban' | 'suburban' | 'wilderness'

/**
 * 道路类型
 */
type RoadType = 'none' | 'h' | 'v' | 'cross' | 
                't-up' | 't-down' | 't-left' | 't-right' |
                'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br' |
                'end-u' | 'end-d' | 'end-l' | 'end-r'

/**
 * 装饰物
 */
interface Decoration {
  x: number
  y: number
  type: 'tree' | 'lamp' | 'bench' | 'flower'
}

/**
 * 边 (用于最小生成树)
 */
interface Edge {
  from: number
  to: number
  weight: number
}

const TILE_SIZE = 48  // 渲染尺寸

/**
 * 城市网格渲染器 - 纯色版本
 */
export class TopDownGrid implements GridRenderer {
  readonly id = 'topdown-grid'

  private nexusPositions: GridPosition[] = []
  private roadMap: Map<string, RoadType> = new Map()
  private decorations: Decoration[] = []
  private cityBounds: { minX: number, maxX: number, minY: number, maxY: number } | null = null

  updateNexusPositions(positions: GridPosition[]): void {
    this.nexusPositions = positions
    this.generateCityLayout()
  }

  private generateCityLayout(): void {
    this.roadMap.clear()
    this.decorations = []
    this.cityBounds = null

    if (this.nexusPositions.length === 0) return

    this.calculateCityBounds()
    this.generateRoadNetwork()
    this.calculateRoadTypes()
    this.generateDecorations()
  }

  private calculateCityBounds(): void {
    if (this.nexusPositions.length === 0) return

    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity

    for (const pos of this.nexusPositions) {
      minX = Math.min(minX, pos.gridX)
      maxX = Math.max(maxX, pos.gridX)
      minY = Math.min(minY, pos.gridY)
      maxY = Math.max(maxY, pos.gridY)
    }

    const padding = 3
    this.cityBounds = {
      minX: minX - padding,
      maxX: maxX + padding,
      minY: minY - padding,
      maxY: maxY + padding,
    }
  }

  getZoneType(x: number, y: number): ZoneType {
    if (!this.cityBounds) return 'wilderness'

    const { minX, maxX, minY, maxY } = this.cityBounds

    if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
      return 'urban'
    }

    const suburbanPadding = 4
    if (x >= minX - suburbanPadding && x <= maxX + suburbanPadding &&
        y >= minY - suburbanPadding && y <= maxY + suburbanPadding) {
      return 'suburban'
    }

    return 'wilderness'
  }

  /**
   * 使用 Prim 算法生成最小生成树道路
   */
  private generateRoadNetwork(): void {
    const n = this.nexusPositions.length
    if (n <= 1) return

    const edges: Edge[] = []
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = this.nexusPositions[i].gridX - this.nexusPositions[j].gridX
        const dy = this.nexusPositions[i].gridY - this.nexusPositions[j].gridY
        const weight = Math.abs(dx) + Math.abs(dy)
        edges.push({ from: i, to: j, weight })
      }
    }

    const inMST = new Set<number>([0])
    const mstEdges: Edge[] = []

    while (inMST.size < n) {
      let minEdge: Edge | null = null
      let minWeight = Infinity

      for (const edge of edges) {
        const fromIn = inMST.has(edge.from)
        const toIn = inMST.has(edge.to)

        if (fromIn !== toIn && edge.weight < minWeight) {
          minWeight = edge.weight
          minEdge = edge
        }
      }

      if (minEdge) {
        mstEdges.push(minEdge)
        inMST.add(minEdge.from)
        inMST.add(minEdge.to)
      } else {
        break
      }
    }

    for (const edge of mstEdges) {
      const from = this.nexusPositions[edge.from]
      const to = this.nexusPositions[edge.to]
      this.createRoadBetween(from, to)
    }
  }

  private createRoadBetween(from: GridPosition, to: GridPosition): void {
    const { gridX: x1, gridY: y1 } = from
    const { gridX: x2, gridY: y2 } = to

    // 先水平再垂直
    const startX = Math.min(x1, x2)
    const endX = Math.max(x1, x2)
    for (let x = startX; x <= endX; x++) {
      this.markRoad(x, y1)
    }

    const startY = Math.min(y1, y2)
    const endY = Math.max(y1, y2)
    for (let y = startY; y <= endY; y++) {
      this.markRoad(x2, y)
    }
  }

  private markRoad(x: number, y: number): void {
    const key = `${x},${y}`
    if (!this.roadMap.has(key)) {
      this.roadMap.set(key, 'h')
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
      let type: RoadType = 'h'

      if (count === 4) {
        type = 'cross'
      } else if (count === 3) {
        if (!up) type = 't-down'
        else if (!down) type = 't-up'
        else if (!left) type = 't-right'
        else type = 't-left'
      } else if (count === 2) {
        if (up && down) type = 'v'
        else if (left && right) type = 'h'
        else if (down && right) type = 'corner-tl'
        else if (down && left) type = 'corner-tr'
        else if (up && right) type = 'corner-bl'
        else if (up && left) type = 'corner-br'
      } else if (count === 1) {
        if (up) type = 'end-d'
        else if (down) type = 'end-u'
        else if (left) type = 'end-r'
        else type = 'end-l'
      }

      this.roadMap.set(key, type)
    }
  }

  private generateDecorations(): void {
    if (!this.cityBounds) return

    const { minX, maxX, minY, maxY } = this.cityBounds

    for (let x = minX - 2; x <= maxX + 2; x++) {
      for (let y = minY - 2; y <= maxY + 2; y++) {
        if (this.hasRoad(x, y)) continue
        if (this.nexusPositions.some(p => 
          Math.abs(p.gridX - x) < 2 && Math.abs(p.gridY - y) < 2
        )) continue

        const hash = Math.abs((x * 73856093) ^ (y * 19349663)) % 100

        if (hash < 8) {
          this.decorations.push({ x, y, type: 'tree' })
        } else if (hash < 12) {
          this.decorations.push({ x, y, type: 'flower' })
        }
      }
    }

    // 道路旁放路灯
    for (const [key] of this.roadMap) {
      const [x, y] = key.split(',').map(Number)
      if ((x + y) % 5 === 0) {
        const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]]
        for (const [dx, dy] of offsets) {
          const nx = x + dx
          const ny = y + dy
          if (!this.hasRoad(nx, ny) && 
              !this.decorations.some(d => d.x === nx && d.y === ny) &&
              !this.nexusPositions.some(p => Math.abs(p.gridX - nx) < 2 && Math.abs(p.gridY - ny) < 2)) {
            this.decorations.push({ x: nx, y: ny, type: 'lamp' })
            break
          }
        }
      }
    }
  }

  getRoadPositions(): GridPosition[] {
    const positions: GridPosition[] = []
    for (const [key] of this.roadMap) {
      const [x, y] = key.split(',').map(Number)
      positions.push({ gridX: x, gridY: y })
    }
    return positions
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height, camera } = ctx

    const tileSize = TILE_SIZE * camera.zoom
    const halfW = width / 2
    const halfH = height / 2

    c.save()

    // 绘制道路
    for (const [key, type] of this.roadMap) {
      const [gx, gy] = key.split(',').map(Number)

      const screenX = halfW + gx * tileSize + camera.x * camera.zoom
      const screenY = halfH + gy * tileSize + camera.y * camera.zoom

      if (screenX < -tileSize * 2 || screenX > width + tileSize * 2 ||
          screenY < -tileSize * 2 || screenY > height + tileSize * 2) {
        continue
      }

      this.drawRoad(c, screenX, screenY, tileSize, type)
    }

    // 绘制装饰物
    for (const deco of this.decorations) {
      const screenX = halfW + deco.x * tileSize + camera.x * camera.zoom
      const screenY = halfH + deco.y * tileSize + camera.y * camera.zoom

      if (screenX < -tileSize || screenX > width + tileSize ||
          screenY < -tileSize || screenY > height + tileSize) {
        continue
      }

      this.drawDecoration(c, screenX, screenY, tileSize, deco.type)
    }

    c.restore()
  }

  /**
   * 绘制道路（纯色版）
   */
  private drawRoad(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    type: RoadType
  ): void {
    const half = size / 2

    // 道路底色（深灰色）
    c.fillStyle = '#5a5a5a'
    c.fillRect(x - half, y - half, size, size)

    // 根据道路类型绘制白色标线
    c.strokeStyle = '#ffffff'
    c.lineWidth = Math.max(2, size / 16)
    c.setLineDash([size / 8, size / 8])

    c.beginPath()

    switch (type) {
      case 'h':
        c.moveTo(x - half, y)
        c.lineTo(x + half, y)
        break
      case 'v':
        c.moveTo(x, y - half)
        c.lineTo(x, y + half)
        break
      case 'cross':
        c.moveTo(x - half, y)
        c.lineTo(x + half, y)
        c.moveTo(x, y - half)
        c.lineTo(x, y + half)
        break
      case 't-up':
      case 't-down':
        c.moveTo(x - half, y)
        c.lineTo(x + half, y)
        if (type === 't-up') {
          c.moveTo(x, y)
          c.lineTo(x, y - half)
        } else {
          c.moveTo(x, y)
          c.lineTo(x, y + half)
        }
        break
      case 't-left':
      case 't-right':
        c.moveTo(x, y - half)
        c.lineTo(x, y + half)
        if (type === 't-left') {
          c.moveTo(x, y)
          c.lineTo(x - half, y)
        } else {
          c.moveTo(x, y)
          c.lineTo(x + half, y)
        }
        break
      case 'corner-tl':
        c.moveTo(x + half, y)
        c.lineTo(x, y)
        c.lineTo(x, y + half)
        break
      case 'corner-tr':
        c.moveTo(x - half, y)
        c.lineTo(x, y)
        c.lineTo(x, y + half)
        break
      case 'corner-bl':
        c.moveTo(x + half, y)
        c.lineTo(x, y)
        c.lineTo(x, y - half)
        break
      case 'corner-br':
        c.moveTo(x - half, y)
        c.lineTo(x, y)
        c.lineTo(x, y - half)
        break
      default:
        // 端点
        c.arc(x, y, size / 6, 0, Math.PI * 2)
        break
    }

    c.stroke()
    c.setLineDash([])

    // 道路边缘（人行道）
    c.strokeStyle = '#c0c0c0'
    c.lineWidth = Math.max(1, size / 24)
    c.strokeRect(x - half + 2, y - half + 2, size - 4, size - 4)
  }

  /**
   * 绘制装饰物（纯色版）
   */
  private drawDecoration(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    type: 'tree' | 'lamp' | 'bench' | 'flower'
  ): void {
    const half = size / 2

    switch (type) {
      case 'tree':
        // 树干
        c.fillStyle = '#8B4513'
        c.fillRect(x - size / 12, y, size / 6, half * 0.6)
        // 树冠
        c.fillStyle = '#228B22'
        c.beginPath()
        c.arc(x, y - size / 6, half * 0.5, 0, Math.PI * 2)
        c.fill()
        // 深色树冠高光
        c.fillStyle = '#006400'
        c.beginPath()
        c.arc(x - size / 10, y - size / 4, half * 0.25, 0, Math.PI * 2)
        c.fill()
        break

      case 'lamp':
        // 灯杆
        c.fillStyle = '#4a4a4a'
        c.fillRect(x - size / 20, y - half * 0.3, size / 10, half * 0.8)
        // 灯罩
        c.fillStyle = '#FFD700'
        c.beginPath()
        c.arc(x, y - half * 0.4, size / 8, 0, Math.PI * 2)
        c.fill()
        break

      case 'flower':
        // 花朵
        const colors = ['#FF69B4', '#FFD700', '#FF6347', '#9370DB']
        const color = colors[Math.abs(Math.floor(x + y)) % colors.length]
        c.fillStyle = color
        c.beginPath()
        c.arc(x, y, size / 6, 0, Math.PI * 2)
        c.fill()
        // 花心
        c.fillStyle = '#FFD700'
        c.beginPath()
        c.arc(x, y, size / 12, 0, Math.PI * 2)
        c.fill()
        break

      case 'bench':
        c.fillStyle = '#8B4513'
        c.fillRect(x - half * 0.4, y - size / 10, half * 0.8, size / 5)
        break
    }
  }

  dispose(): void {
    this.roadMap.clear()
    this.decorations = []
    this.nexusPositions = []
  }
}
