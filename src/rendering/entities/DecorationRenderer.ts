// ============================================
// DD-OS 装饰层渲染器 (城市主题)
// 伴生模式：只在建筑周围生成树木和灌木
// 空地保持纯草地 = 荒野感
// ============================================

import type { RenderContext, GridPosition, DecoLayerRenderer } from '../types'

// 等距瓦片尺寸（与 CityGrid 一致）
const TILE_WIDTH = 128
const TILE_HEIGHT = 64

// 每个建筑周围的最大装饰数量
const MAX_DECOS_PER_NEXUS = 6

// 伴生装饰半径（距建筑 1~4 格）
const DECO_RADIUS = 4

// 每个建筑尝试放置装饰的最大次数
const MAX_ATTEMPTS = 12

// 最小缩放阈值（zoom 过小时跳过渲染）
const MIN_ZOOM = 0.45

// 确定性哈希（保证同一建筑周围的装饰位置稳定）
function decoHash(seed: string, index: number): number {
  let h = 0
  const s = seed + index.toString()
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0
  }
  return (h & 0x7fffffff)
}

// 坐标哈希（用于外观变体选择）
function coordHash(gx: number, gy: number): number {
  let h = ((gx * 478231 + gy * 891377) & 0x7fffffff)
  h = ((h >> 16) ^ h) * 0x45d9f3b
  return (h & 0x7fffffff)
}

type DecoType = 'tree' | 'bush' | 'flower'

interface DecoItem {
  gridX: number
  gridY: number
  type: DecoType
  hash: number
  offsetX: number
  offsetY: number
}

/**
 * 城市装饰渲染器（伴生模式）
 * 只在 Nexus 建筑周围 1-3 格内生成树木灌木
 * 空地 = 纯草地荒野，让用户有"填满"的欲望
 */
export class DecorationRenderer implements DecoLayerRenderer {
  readonly id = 'decoration-renderer'

  // 从 CityGrid 获取的占用信息
  private occupiedSet = new Set<string>()    // road + building + sidewalk
  private nexusPositions: GridPosition[] = []
  // 缓存生成的伴生装饰列表
  private decoItems: DecoItem[] = []
  private decoDirty = true

  /**
   * 接收建筑位置和道路占用集合
   */
  updateOccupied(nexusPositions: GridPosition[], roadSet: Set<string>, sidewalkSet: Set<string>): void {
    this.nexusPositions = nexusPositions
    this.occupiedSet.clear()
    for (const key of roadSet) this.occupiedSet.add(key)
    for (const key of sidewalkSet) this.occupiedSet.add(key)
    for (const p of nexusPositions) this.occupiedSet.add(`${p.gridX},${p.gridY}`)
    this.decoDirty = true
  }

  /**
   * 简易版本：仅基于 nexus 位置更新占用
   */
  updateNexusPositions(positions: GridPosition[]): void {
    const newKey = positions.map(p => `${p.gridX},${p.gridY}`).sort().join('|')
    const oldKey = this.nexusPositions.map(p => `${p.gridX},${p.gridY}`).sort().join('|')
    if (newKey === oldKey) return
    
    this.nexusPositions = positions
    this.occupiedSet.clear()
    for (const p of positions) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          this.occupiedSet.add(`${p.gridX + dx},${p.gridY + dy}`)
        }
      }
    }
    this.decoDirty = true
  }

  /**
   * 生成伴生装饰：为每个建筑周围放置 3-6 棵树/灌木（避开道路）
   */
  private buildDecoList(): void {
    if (!this.decoDirty) return
    this.decoDirty = false
    this.decoItems = []

    const placedSet = new Set<string>()
    // 把建筑位置标记为不可种树
    for (const key of this.occupiedSet) placedSet.add(key)

    // 重建道路网络（与 CityGrid 同逻辑），避免在路上种树
    const ROAD_EXTEND = 5
    for (const nexus of this.nexusPositions) {
      for (let d = 1; d <= ROAD_EXTEND; d++) {
        placedSet.add(`${nexus.gridX + d},${nexus.gridY}`)
        placedSet.add(`${nexus.gridX - d},${nexus.gridY}`)
        placedSet.add(`${nexus.gridX},${nexus.gridY + d}`)
        placedSet.add(`${nexus.gridX},${nexus.gridY - d}`)
      }
      // 道路旁人行道也不种树
      for (let d = 1; d <= ROAD_EXTEND; d++) {
        const roadPositions = [
          [nexus.gridX + d, nexus.gridY],
          [nexus.gridX - d, nexus.gridY],
          [nexus.gridX, nexus.gridY + d],
          [nexus.gridX, nexus.gridY - d],
        ]
        for (const [rx, ry] of roadPositions) {
          placedSet.add(`${rx + 1},${ry}`)
          placedSet.add(`${rx - 1},${ry}`)
          placedSet.add(`${rx},${ry + 1}`)
          placedSet.add(`${rx},${ry - 1}`)
        }
      }
    }

    for (const nexus of this.nexusPositions) {
      const seed = `${nexus.gridX},${nexus.gridY}`
      const targetCount = 3 + (decoHash(seed, 0) % (MAX_DECOS_PER_NEXUS - 2))
      let placed = 0

      for (let i = 0; i < MAX_ATTEMPTS && placed < targetCount; i++) {
        const h = decoHash(seed, i + 1)
        // 在建筑周围 1~DECO_RADIUS 格内选位置
        const dx = (h % (DECO_RADIUS * 2 + 1)) - DECO_RADIUS
        const dy = (decoHash(seed, i + 50) % (DECO_RADIUS * 2 + 1)) - DECO_RADIUS
        // 不能在建筑正中心
        if (dx === 0 && dy === 0) continue

        const gx = nexus.gridX + dx
        const gy = nexus.gridY + dy
        const key = `${gx},${gy}`

        // 跳过已占用或已种树的位置
        if (placedSet.has(key)) continue
        placedSet.add(key)

        const hash = coordHash(gx, gy)
        const type = this.getDecoType(hash)
        const offsetX = ((hash >> 4) % 20 - 10) * 0.3
        const offsetY = ((hash >> 8) % 14 - 7) * 0.3

        this.decoItems.push({ gridX: gx, gridY: gy, type, hash, offsetX, offsetY })
        placed++
      }
    }
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height, camera } = ctx

    // 缩放过小时跳过
    if (camera.zoom < MIN_ZOOM) return
    // 没有建筑则不渲染
    if (this.nexusPositions.length === 0) return

    this.buildDecoList()

    const halfW = width / 2
    const halfH = height / 2
    const scale = camera.zoom * 0.8
    const tileW = TILE_WIDTH * scale
    const tileH = TILE_HEIGHT * scale

    for (const item of this.decoItems) {
      // 屏幕坐标
      const screenX = halfW + (item.gridX - item.gridY) * (tileW / 2) + camera.x * camera.zoom
      const screenY = halfH + (item.gridX + item.gridY) * (tileH / 2) + camera.y * camera.zoom

      // 视锥裁剪
      if (screenX < -tileW * 1.5 || screenX > width + tileW * 1.5 ||
          screenY < -tileH * 4 || screenY > height + tileH * 1.5) {
        continue
      }

      const ox = item.offsetX * scale
      const oy = item.offsetY * scale
      this.drawDecoration(c, screenX + ox, screenY + oy, item.type, scale, item.hash)
    }
  }

  private getDecoType(hash: number): DecoType {
    const r = hash % 10
    if (r < 5) return 'tree'
    if (r < 8) return 'bush'
    return 'flower'
  }

  /**
   * 程序化绘制装饰物
   */
  private drawDecoration(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    type: DecoType,
    scale: number,
    hash: number,
  ): void {
    c.save()

    switch (type) {
      case 'tree':
        this.drawTree(c, x, y, scale, hash)
        break
      case 'bush':
        this.drawBush(c, x, y, scale, hash)
        break
      case 'flower':
        this.drawFlowerPatch(c, x, y, scale, hash)
        break
    }

    c.restore()
  }

  /**
   * 绘制等距树木（棕色树干 + 绿色树冠）
   */
  private drawTree(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    hash: number,
  ): void {
    const treeScale = (0.7 + (hash % 30) / 100) * scale
    const trunkH = 30 * treeScale
    const crownR = 26 * treeScale

    // 树冠颜色变体（明亮暖绿，匹配治愈系 CityGrid）
    const hue = 95 + (hash % 30)
    const lightness = 42 + (hash % 15)

    // 树影
    c.globalAlpha = 0.15
    c.fillStyle = '#000'
    c.beginPath()
    c.ellipse(x, y + 3 * scale, crownR * 0.9, crownR * 0.35, 0, 0, Math.PI * 2)
    c.fill()
    c.globalAlpha = 1

    // 树干
    const trunkW = 7 * treeScale
    c.fillStyle = '#A0784C'
    c.fillRect(x - trunkW / 2, y - trunkH, trunkW, trunkH)

    // 树干暗面（右侧）
    c.fillStyle = '#8B6640'
    c.fillRect(x, y - trunkH, trunkW / 2, trunkH)

    // 树冠（椭球形，等距压缩）
    c.fillStyle = `hsl(${hue}, 60%, ${lightness}%)`
    c.beginPath()
    c.ellipse(x, y - trunkH - crownR * 0.4, crownR, crownR * 0.75, 0, 0, Math.PI * 2)
    c.fill()

    // 树冠高光
    c.fillStyle = `hsl(${hue}, 55%, ${lightness + 14}%)`
    c.beginPath()
    c.ellipse(x - crownR * 0.15, y - trunkH - crownR * 0.6, crownR * 0.6, crownR * 0.4, 0, 0, Math.PI * 2)
    c.fill()
  }

  /**
   * 绘制灌木（圆形绿色丛）
   */
  private drawBush(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    hash: number,
  ): void {
    const bushScale = (0.6 + (hash % 25) / 100) * scale
    const r = 18 * bushScale
    const hue = 100 + (hash % 25)

    // 灌木阴影
    c.globalAlpha = 0.12
    c.fillStyle = '#000'
    c.beginPath()
    c.ellipse(x, y + 2 * scale, r * 0.8, r * 0.3, 0, 0, Math.PI * 2)
    c.fill()
    c.globalAlpha = 1

    // 主体
    c.fillStyle = `hsl(${hue}, 55%, 40%)`
    c.beginPath()
    c.ellipse(x, y - r * 0.3, r, r * 0.55, 0, 0, Math.PI * 2)
    c.fill()

    // 高光
    c.fillStyle = `hsl(${hue}, 50%, 52%)`
    c.beginPath()
    c.ellipse(x - r * 0.1, y - r * 0.45, r * 0.55, r * 0.3, 0, 0, Math.PI * 2)
    c.fill()
  }

  /**
   * 绘制花丛（几个彩色小点）
   */
  private drawFlowerPatch(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    hash: number,
  ): void {
    const fScale = (0.5 + (hash % 20) / 100) * scale
    const colors = ['#FF6B6B', '#FFD93D', '#C084FC', '#60A5FA', '#FF85A2']

    // 草底
    c.fillStyle = 'hsl(100, 50%, 45%)'
    c.beginPath()
    c.ellipse(x, y, 14 * fScale, 7 * fScale, 0, 0, Math.PI * 2)
    c.fill()

    // 花朵（3-4 个小圆点）
    const count = 3 + (hash % 2)
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (hash % 100) / 50
      const dist = 7 * fScale
      const fx = x + Math.cos(angle) * dist
      const fy = y - 2 * fScale + Math.sin(angle) * dist * 0.5
      
      c.fillStyle = colors[(hash + i) % colors.length]
      c.beginPath()
      c.arc(fx, fy, 3.5 * fScale, 0, Math.PI * 2)
      c.fill()

      // 花心高光
      c.fillStyle = 'rgba(255, 255, 200, 0.5)'
      c.beginPath()
      c.arc(fx - fScale * 0.3, fy - fScale * 0.3, 1.2 * fScale, 0, Math.PI * 2)
      c.fill()
    }
  }

  dispose(): void {
    this.occupiedSet.clear()
    this.nexusPositions = []
    this.decoItems = []
  }
}
