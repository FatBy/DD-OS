// ============================================
// Smallville 网格/道路渲染器
// Town: MST 瓦片道路 + 人行道 + 装饰 + 围栏
// Room: 墙壁
// ============================================

import type { GridRenderer, RenderContext, GridPosition } from '../types'
import type { SmallvilleViewManager } from './SmallvilleViewManager'
import type { SmallvilleSpriteAtlas } from './SmallvilleSpriteAtlas'
import type { SvTile } from './SmallvilleTiles'
import {
  SV_ROAD_FULL, SV_TREE_LARGE, SV_BUSH, SV_TREE_SM,
  SV_LAMP, SV_BENCH_TILES, SV_FLOWERPOT, SV_TRASH,
  SV_FENCE_H, SV_GRASS,
} from './SmallvilleTiles'

const TILE_SIZE = 16
const RENDER_SCALE = 3
const TOPDOWN_TILE_SIZE = 48  // 与 village 主题一致

type RoadType = 'h' | 'v' | 'cross' | 't-up' | 't-down' | 't-left' | 't-right'
  | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br'
  | 'end-u' | 'end-d' | 'end-l' | 'end-r' | 'single'

type DecoType = 'tree1' | 'tree2' | 'bush' | 'flower-red' | 'flower-yellow'
  | 'lamp' | 'bench' | 'flowerpot' | 'trashcan' | 'fence-h'

interface Decoration {
  x: number
  y: number
  type: DecoType
}

export class SmallvilleGrid implements GridRenderer {
  readonly id = 'smallville-grid'
  private viewManager: SmallvilleViewManager
  private atlas: SmallvilleSpriteAtlas
  private nexusPositions: GridPosition[] = []
  private roadMap: Map<string, RoadType> = new Map()
  private sidewalkSet: Set<string> = new Set()
  private decorations: Decoration[] = []
  private roadPositionsList: GridPosition[] = []

  constructor(viewManager: SmallvilleViewManager, atlas: SmallvilleSpriteAtlas) {
    this.viewManager = viewManager
    this.atlas = atlas
  }

  updateNexusPositions(positions: GridPosition[]): void {
    this.nexusPositions = positions
    this.generateLayout()
  }

  getRoadPositions(): GridPosition[] {
    return this.roadPositionsList
  }

  render(ctx: RenderContext): void {
    const vm = this.viewManager

    if (vm.isInRoomView()) {
      this.renderRoomWalls(ctx)
    } else if (vm.isTransitioning()) {
      const alpha = 1 - vm.zoomProgress
      ctx.ctx.save()
      ctx.ctx.globalAlpha = alpha
      this.renderTownRoads(ctx)
      ctx.ctx.restore()

      ctx.ctx.save()
      ctx.ctx.globalAlpha = vm.zoomProgress
      this.renderRoomWalls(ctx)
      ctx.ctx.restore()
    } else {
      this.renderTownRoads(ctx)
    }
  }

  // ============================================
  // Town 道路 + 人行道 + 装饰渲染
  // ============================================

  private renderTownRoads(ctx: RenderContext): void {
    const { ctx: c, width, height, camera } = ctx

    const scale = RENDER_SCALE * camera.zoom
    const tileScreen = TILE_SIZE * scale
    const halfW = width / 2
    const halfH = height / 2

    // 1. 绘制人行道（建筑周围的浅色地面）
    for (const key of this.sidewalkSet) {
      const [gx, gy] = key.split(',').map(Number)
      const sx = halfW + gx * TOPDOWN_TILE_SIZE * camera.zoom + camera.x * camera.zoom
      const sy = halfH + gy * TOPDOWN_TILE_SIZE * camera.zoom + camera.y * camera.zoom

      if (sx < -tileScreen || sx > width + tileScreen ||
          sy < -tileScreen || sy > height + tileScreen) continue

      const drawX = sx - tileScreen / 2
      const drawY = sy - tileScreen / 2

      if (this.atlas.isReady()) {
        this.atlas.drawTile(c, SV_GRASS.EDGE.col, SV_GRASS.EDGE.row, drawX, drawY, scale)
      } else {
        c.fillStyle = '#a0a080'
        c.fillRect(drawX, drawY, tileScreen, tileScreen)
      }
    }

    // 2. 绘制道路
    for (const [key, roadType] of this.roadMap) {
      const [gx, gy] = key.split(',').map(Number)
      const sx = halfW + gx * TOPDOWN_TILE_SIZE * camera.zoom + camera.x * camera.zoom
      const sy = halfH + gy * TOPDOWN_TILE_SIZE * camera.zoom + camera.y * camera.zoom

      if (sx < -tileScreen || sx > width + tileScreen ||
          sy < -tileScreen || sy > height + tileScreen) continue

      const drawX = sx - tileScreen / 2
      const drawY = sy - tileScreen / 2

      if (this.atlas.isReady()) {
        const tile = this.getRoadTile(roadType, gx, gy)
        this.atlas.drawTile(c, tile.col, tile.row, drawX, drawY, scale)
      } else {
        c.fillStyle = '#8e8e8e'
        c.fillRect(drawX, drawY, tileScreen, tileScreen)
        c.strokeStyle = '#707070'
        c.lineWidth = 0.5
        c.strokeRect(drawX, drawY, tileScreen, tileScreen)
      }
    }

    // 3. 绘制装饰
    for (const deco of this.decorations) {
      const sx = halfW + deco.x * TOPDOWN_TILE_SIZE * camera.zoom + camera.x * camera.zoom
      const sy = halfH + deco.y * TOPDOWN_TILE_SIZE * camera.zoom + camera.y * camera.zoom

      if (sx < -tileScreen || sx > width + tileScreen ||
          sy < -tileScreen || sy > height + tileScreen) continue

      this.drawDecoration(c, deco.type, sx, sy, tileScreen, scale)
    }
  }

  /** 根据道路类型 + 位置奇偶性选择正确的道路瓦片 */
  private getRoadTile(roadType: RoadType, gx: number, gy: number): SvTile {
    const px = ((gx % 2) + 2) % 2  // 0 或 1
    const py = ((gy % 2) + 2) % 2

    switch (roadType) {
      case 'h':
        return px === 0 ? SV_ROAD_FULL.H1 : SV_ROAD_FULL.H2
      case 'v':
        return py === 0 ? SV_ROAD_FULL.V1 : SV_ROAD_FULL.V2
      case 'cross':
        // 十字路口用 2x2 的交替模式
        if (py === 0) return px === 0 ? SV_ROAD_FULL.V1 : SV_ROAD_FULL.V2
        return px === 0 ? SV_ROAD_FULL.H1 : SV_ROAD_FULL.H2
      case 'corner-tl': return SV_ROAD_FULL.CORNER_TL
      case 'corner-tr': return SV_ROAD_FULL.CORNER_TR
      case 'corner-bl': return SV_ROAD_FULL.CORNER_BL
      case 'corner-br': return SV_ROAD_FULL.CORNER_BR
      case 't-up':
        return px === 0 ? SV_ROAD_FULL.EDGE_T1 : SV_ROAD_FULL.EDGE_T2
      case 't-down':
        return px === 0 ? SV_ROAD_FULL.EDGE_B1 : SV_ROAD_FULL.EDGE_B2
      case 't-left':
        return py === 0 ? SV_ROAD_FULL.CORNER_TL : SV_ROAD_FULL.CORNER_BL
      case 't-right':
        return py === 0 ? SV_ROAD_FULL.CORNER_TR : SV_ROAD_FULL.CORNER_BR
      case 'end-u':   return px === 0 ? SV_ROAD_FULL.EDGE_T1 : SV_ROAD_FULL.EDGE_T2
      case 'end-d':   return px === 0 ? SV_ROAD_FULL.EDGE_B1 : SV_ROAD_FULL.EDGE_B2
      case 'end-l':   return py === 0 ? SV_ROAD_FULL.EDGE_TL : SV_ROAD_FULL.EDGE_BL
      case 'end-r':   return py === 0 ? SV_ROAD_FULL.EDGE_TR : SV_ROAD_FULL.EDGE_BR
      case 'single':
        return px === 0 ? SV_ROAD_FULL.H1 : SV_ROAD_FULL.H2
      default:
        return SV_ROAD_FULL.H1
    }
  }

  /** 装饰物渲染 (瓦片优先，纯色 fallback) */
  private drawDecoration(c: CanvasRenderingContext2D, type: DecoType, cx: number, cy: number, tileScreen: number, scale: number): void {
    const half = tileScreen * 0.35

    if (this.atlas.isReady()) {
      switch (type) {
        case 'tree1':
        case 'tree2': {
          const ts = TILE_SIZE * scale * 0.6
          for (let i = 0; i < SV_TREE_LARGE.length; i++) {
            const t = SV_TREE_LARGE[i]
            const dx = (i % 2) * ts - ts
            const dy = Math.floor(i / 2) * ts - ts * 2.5
            this.atlas.drawTile(c, t.col, t.row, cx + dx, cy + dy, scale * 0.6)
          }
          return
        }
        case 'bush':
          this.atlas.drawTile(c, SV_BUSH.col, SV_BUSH.row, cx - half, cy - half, scale * 0.7)
          return
        case 'flower-red':
        case 'flower-yellow':
          this.atlas.drawTile(c, SV_TREE_SM.col, SV_TREE_SM.row, cx - half * 0.6, cy - half * 0.6, scale * 0.5)
          return
        case 'lamp': {
          // 路灯: 2 瓦片高
          const ts = TILE_SIZE * scale * 0.5
          this.atlas.drawTile(c, SV_LAMP[0].col, SV_LAMP[0].row, cx - ts / 2, cy - ts * 1.5, scale * 0.5)
          this.atlas.drawTile(c, SV_LAMP[1].col, SV_LAMP[1].row, cx - ts / 2, cy - ts * 0.5, scale * 0.5)
          return
        }
        case 'bench': {
          // 长椅: 2x2 瓦片
          const ts = TILE_SIZE * scale * 0.4
          this.atlas.drawTile(c, SV_BENCH_TILES.TL.col, SV_BENCH_TILES.TL.row, cx - ts, cy - ts, scale * 0.4)
          this.atlas.drawTile(c, SV_BENCH_TILES.TR.col, SV_BENCH_TILES.TR.row, cx, cy - ts, scale * 0.4)
          this.atlas.drawTile(c, SV_BENCH_TILES.BL.col, SV_BENCH_TILES.BL.row, cx - ts, cy, scale * 0.4)
          this.atlas.drawTile(c, SV_BENCH_TILES.BR.col, SV_BENCH_TILES.BR.row, cx, cy, scale * 0.4)
          return
        }
        case 'flowerpot': {
          const ts = TILE_SIZE * scale * 0.4
          this.atlas.drawTile(c, SV_FLOWERPOT.TL.col, SV_FLOWERPOT.TL.row, cx - ts, cy - ts, scale * 0.4)
          this.atlas.drawTile(c, SV_FLOWERPOT.TR.col, SV_FLOWERPOT.TR.row, cx, cy - ts, scale * 0.4)
          this.atlas.drawTile(c, SV_FLOWERPOT.BL.col, SV_FLOWERPOT.BL.row, cx - ts, cy, scale * 0.4)
          this.atlas.drawTile(c, SV_FLOWERPOT.BR.col, SV_FLOWERPOT.BR.row, cx, cy, scale * 0.4)
          return
        }
        case 'trashcan': {
          const ts = TILE_SIZE * scale * 0.4
          this.atlas.drawTile(c, SV_TRASH.TL.col, SV_TRASH.TL.row, cx - ts, cy - ts, scale * 0.4)
          this.atlas.drawTile(c, SV_TRASH.TR.col, SV_TRASH.TR.row, cx, cy - ts, scale * 0.4)
          this.atlas.drawTile(c, SV_TRASH.BL.col, SV_TRASH.BL.row, cx - ts, cy, scale * 0.4)
          this.atlas.drawTile(c, SV_TRASH.BR.col, SV_TRASH.BR.row, cx, cy, scale * 0.4)
          return
        }
        case 'fence-h': {
          // 水平围栏: 3 瓦片宽
          const ts = TILE_SIZE * scale * 0.45
          this.atlas.drawTile(c, SV_FENCE_H.L.col, SV_FENCE_H.L.row, cx - ts * 1.5, cy - ts / 2, scale * 0.45)
          this.atlas.drawTile(c, SV_FENCE_H.M.col, SV_FENCE_H.M.row, cx - ts * 0.5, cy - ts / 2, scale * 0.45)
          this.atlas.drawTile(c, SV_FENCE_H.R.col, SV_FENCE_H.R.row, cx + ts * 0.5, cy - ts / 2, scale * 0.45)
          return
        }
        default:
          break
      }
    }

    // 纯色 fallback
    switch (type) {
      case 'tree1':
      case 'tree2':
        c.fillStyle = '#8B6914'
        c.fillRect(cx - tileScreen * 0.07, cy, tileScreen * 0.14, half)
        c.fillStyle = type === 'tree1' ? '#2d8a4e' : '#3a9d5c'
        c.beginPath()
        c.arc(cx, cy - tileScreen * 0.07, half * 0.7, 0, Math.PI * 2)
        c.fill()
        break
      case 'bush':
        c.fillStyle = '#3a7d44'
        c.beginPath()
        c.arc(cx, cy, half * 0.5, 0, Math.PI * 2)
        c.fill()
        break
      case 'flower-red':
        c.fillStyle = '#e74c3c'
        c.beginPath()
        c.arc(cx, cy, half * 0.3, 0, Math.PI * 2)
        c.fill()
        break
      case 'flower-yellow':
        c.fillStyle = '#f1c40f'
        c.beginPath()
        c.arc(cx, cy, half * 0.3, 0, Math.PI * 2)
        c.fill()
        break
      case 'lamp':
        c.fillStyle = '#555'
        c.fillRect(cx - 1, cy - half, 2, tileScreen * 0.7)
        c.fillStyle = '#ffd700'
        c.beginPath()
        c.arc(cx, cy - half, 3, 0, Math.PI * 2)
        c.fill()
        break
      case 'bench':
        c.fillStyle = '#8B4513'
        c.fillRect(cx - half * 0.5, cy - 2, tileScreen * 0.35, 4)
        break
      case 'flowerpot':
        c.fillStyle = '#b5651d'
        c.fillRect(cx - half * 0.3, cy - half * 0.3, half * 0.6, half * 0.6)
        c.fillStyle = '#27ae60'
        c.beginPath()
        c.arc(cx, cy - half * 0.4, half * 0.25, 0, Math.PI * 2)
        c.fill()
        break
      case 'trashcan':
        c.fillStyle = '#666'
        c.fillRect(cx - half * 0.25, cy - half * 0.4, half * 0.5, half * 0.6)
        break
      case 'fence-h':
        c.fillStyle = '#8B6914'
        c.fillRect(cx - half * 0.7, cy - 1, half * 1.4, 2)
        c.fillRect(cx - half * 0.7, cy - half * 0.2, 2, half * 0.4)
        c.fillRect(cx + half * 0.7, cy - half * 0.2, 2, half * 0.4)
        break
    }
  }

  // ============================================
  // Room 墙壁渲染
  // ============================================

  private renderRoomWalls(ctx: RenderContext): void {
    const { ctx: c, width, height } = ctx
    const vm = this.viewManager
    const layout = vm.roomLayout
    if (!layout) return

    const roomScale = 3.5
    const tileScreen = TILE_SIZE * roomScale
    const roomPixelW = layout.width * tileScreen
    const roomPixelH = layout.height * tileScreen
    const startX = (width - roomPixelW) / 2
    const startY = (height - roomPixelH) / 2

    for (let tx = 0; tx < layout.width; tx++) {
      for (let ty = 0; ty < layout.height; ty++) {
        const px = startX + tx * tileScreen
        const py = startY + ty * tileScreen

        const isTop = ty === 0
        const isBottom = ty === layout.height - 1
        const isLeft = tx === 0
        const isRight = tx === layout.width - 1
        const isEdge = isTop || isBottom || isLeft || isRight

        if (!isEdge) continue

        if (isBottom && tx === layout.doorX) {
          c.fillStyle = '#5d4037'
          c.fillRect(px, py, tileScreen, tileScreen)
          c.fillStyle = '#ffd700'
          c.beginPath()
          c.arc(px + tileScreen * 0.7, py + tileScreen * 0.5, 2, 0, Math.PI * 2)
          c.fill()
          continue
        }

        c.fillStyle = '#6d5d4b'
        c.fillRect(px, py, tileScreen, tileScreen)
        c.strokeStyle = '#5a4d3d'
        c.lineWidth = 1
        c.strokeRect(px + 0.5, py + 0.5, tileScreen - 1, tileScreen - 1)
      }
    }
  }

  // ============================================
  // 布局生成
  // ============================================

  private generateLayout(): void {
    this.roadMap.clear()
    this.sidewalkSet.clear()
    this.decorations = []
    this.roadPositionsList = []

    if (this.nexusPositions.length === 0) return

    this.generateRoadNetwork()
    this.generateSidewalks()
    this.calculateRoadTypes()
    this.generateDecorations()

    for (const [key] of this.roadMap) {
      const [x, y] = key.split(',').map(Number)
      this.roadPositionsList.push({ gridX: x, gridY: y })
    }
  }

  private generateRoadNetwork(): void {
    const positions = this.nexusPositions
    const n = positions.length
    if (n <= 1) return

    const inMST = new Set<number>([0])

    while (inMST.size < n) {
      let bestEdge: { from: number; to: number; weight: number } | null = null

      for (const fromIdx of inMST) {
        for (let toIdx = 0; toIdx < n; toIdx++) {
          if (inMST.has(toIdx)) continue
          const dx = Math.abs(positions[fromIdx].gridX - positions[toIdx].gridX)
          const dy = Math.abs(positions[fromIdx].gridY - positions[toIdx].gridY)
          const weight = dx + dy
          if (!bestEdge || weight < bestEdge.weight) {
            bestEdge = { from: fromIdx, to: toIdx, weight }
          }
        }
      }

      if (!bestEdge) break
      inMST.add(bestEdge.to)
      this.createRoadBetween(positions[bestEdge.from], positions[bestEdge.to])
    }
  }

  private createRoadBetween(from: GridPosition, to: GridPosition): void {
    const x1 = from.gridX, y1 = from.gridY
    const x2 = to.gridX, y2 = to.gridY

    const stepX = x1 <= x2 ? 1 : -1
    for (let x = x1; x !== x2; x += stepX) {
      this.markRoad(x, y1)
    }
    const stepY = y1 <= y2 ? 1 : -1
    for (let y = y1; y !== y2 + stepY; y += stepY) {
      this.markRoad(x2, y)
    }
  }

  private markRoad(x: number, y: number): void {
    this.roadMap.set(`${x},${y}`, 'single')
  }

  private hasRoad(x: number, y: number): boolean {
    return this.roadMap.has(`${x},${y}`)
  }

  private isNearNexus(x: number, y: number): boolean {
    return this.nexusPositions.some(
      p => Math.abs(p.gridX - x) <= 1 && Math.abs(p.gridY - y) <= 1
    )
  }

  /** 在建筑周围生成人行道 */
  private generateSidewalks(): void {
    for (const pos of this.nexusPositions) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const x = pos.gridX + dx
          const y = pos.gridY + dy
          const key = `${x},${y}`
          if (this.roadMap.has(key)) continue
          // 不覆盖建筑正下方
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) continue
          this.sidewalkSet.add(key)
        }
      }
    }
  }

  private calculateRoadTypes(): void {
    for (const [key] of this.roadMap) {
      const [x, y] = key.split(',').map(Number)
      const up = this.hasRoad(x, y - 1)
      const down = this.hasRoad(x, y + 1)
      const left = this.hasRoad(x - 1, y)
      const right = this.hasRoad(x + 1, y)
      const count = [up, down, left, right].filter(Boolean).length

      let type: RoadType = 'single'
      if (count === 4) type = 'cross'
      else if (count === 3) {
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

  /** 生成装饰物（分区 + 聚类逻辑） */
  private generateDecorations(): void {
    if (this.nexusPositions.length === 0) return

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of this.nexusPositions) {
      if (p.gridX < minX) minX = p.gridX
      if (p.gridX > maxX) maxX = p.gridX
      if (p.gridY < minY) minY = p.gridY
      if (p.gridY > maxY) maxY = p.gridY
    }

    // 记录已放置的树的位置（用于聚类）
    const treePositions: Set<string> = new Set()

    // 道路旁类型
    const roadDecos: DecoType[] = ['lamp', 'bench', 'trashcan']
    // 建筑旁类型
    const buildingDecos: DecoType[] = ['flowerpot', 'flower-red', 'flower-yellow']
    // 开阔地类型
    const openDecos: DecoType[] = ['tree1', 'tree2', 'bush', 'flower-red', 'flower-yellow']

    const pad = 5  // 扩大装饰范围
    for (let x = minX - pad; x <= maxX + pad; x++) {
      for (let y = minY - pad; y <= maxY + pad; y++) {
        if (this.hasRoad(x, y)) continue
        if (this.isNearNexus(x, y)) continue

        const hash = Math.abs((x * 73856093) ^ (y * 19349663)) % 1000
        const hash2 = Math.abs((x * 11 + y * 7))

        // 判断区域类型
        const distToRoad = this.distToNearestRoad(x, y)
        const distToBuilding = this.distToNearestNexus(x, y)

        if (distToRoad === 1 && !this.sidewalkSet.has(`${x},${y}`)) {
          // 道路旁: 12% 概率
          if (hash < 120) {
            const type = roadDecos[hash2 % roadDecos.length]
            this.decorations.push({ x, y, type })
          }
        } else if (distToBuilding <= 3 && distToBuilding > 1) {
          // 建筑旁: 18% 概率
          if (hash < 180) {
            // 围栏优先 (在边缘)
            if (distToBuilding === 3 && hash < 80) {
              this.decorations.push({ x, y, type: 'fence-h' })
            } else {
              const type = buildingDecos[hash2 % buildingDecos.length]
              this.decorations.push({ x, y, type })
            }
          }
        } else {
          // 开阔地: 基础 8%，附近有树时 20%
          const nearTree = this.hasNearbyTree(x, y, treePositions)
          const threshold = nearTree ? 200 : 80
          if (hash < threshold) {
            const type = openDecos[hash2 % openDecos.length]
            this.decorations.push({ x, y, type })
            if (type === 'tree1' || type === 'tree2') {
              treePositions.add(`${x},${y}`)
            }
          }
        }
      }
    }
  }

  private distToNearestRoad(x: number, y: number): number {
    let minDist = Infinity
    for (const [key] of this.roadMap) {
      const [rx, ry] = key.split(',').map(Number)
      const dist = Math.abs(rx - x) + Math.abs(ry - y)
      if (dist < minDist) minDist = dist
    }
    return minDist
  }

  private distToNearestNexus(x: number, y: number): number {
    let minDist = Infinity
    for (const p of this.nexusPositions) {
      const dist = Math.abs(p.gridX - x) + Math.abs(p.gridY - y)
      if (dist < minDist) minDist = dist
    }
    return minDist
  }

  private hasNearbyTree(x: number, y: number, trees: Set<string>): boolean {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (dx === 0 && dy === 0) continue
        if (trees.has(`${x + dx},${y + dy}`)) return true
      }
    }
    return false
  }

  dispose(): void {
    this.roadMap.clear()
    this.sidewalkSet.clear()
    this.decorations = []
  }
}
