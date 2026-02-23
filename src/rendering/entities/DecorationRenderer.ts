// ============================================
// DD-OS 装饰层渲染器 (城市主题)
// 程序化绘制树木和灌木，填充空地
// ============================================

import type { RenderContext, GridPosition, DecoLayerRenderer } from '../types'

// 等距瓦片尺寸（与 CityGrid 一致）
const TILE_WIDTH = 128
const TILE_HEIGHT = 64

// 装饰放置概率（0-1，越高越密集）
const DECO_PROBABILITY = 0.25

// 最小缩放阈值（zoom 过小时跳过渲染）
const MIN_ZOOM = 0.45

// 确定性哈希（与 CityGrid 同款，保证同位置结果稳定）
function decoHash(gx: number, gy: number): number {
  let h = ((gx * 478231 + gy * 891377) & 0x7fffffff)
  h = ((h >> 16) ^ h) * 0x45d9f3b
  return (h & 0x7fffffff)
}

type DecoType = 'tree' | 'bush' | 'flower'

/**
 * 城市装饰渲染器
 * 在非道路、非建筑的空地上程序化绘制树木和灌木
 * 应在建筑之前渲染，这样建筑可以遮挡装饰
 */
export class DecorationRenderer implements DecoLayerRenderer {
  readonly id = 'decoration-renderer'

  // 从 CityGrid 获取的占用信息
  private occupiedSet = new Set<string>()    // road + building + sidewalk
  private nexusPositions: GridPosition[] = []

  /**
   * 接收建筑位置和道路占用集合
   */
  updateOccupied(nexusPositions: GridPosition[], roadSet: Set<string>, sidewalkSet: Set<string>): void {
    this.nexusPositions = nexusPositions
    this.occupiedSet.clear()
    for (const key of roadSet) this.occupiedSet.add(key)
    for (const key of sidewalkSet) this.occupiedSet.add(key)
    for (const p of nexusPositions) this.occupiedSet.add(`${p.gridX},${p.gridY}`)
  }

  /**
   * 简易版本：仅基于 nexus 位置更新占用
   * 当无法获取 road/sidewalk set 时使用
   */
  updateNexusPositions(positions: GridPosition[]): void {
    const newKey = positions.map(p => `${p.gridX},${p.gridY}`).sort().join('|')
    const oldKey = this.nexusPositions.map(p => `${p.gridX},${p.gridY}`).sort().join('|')
    if (newKey === oldKey) return
    
    this.nexusPositions = positions
    // 仅标记建筑位置和周围 1 格为占用（简单近似）
    this.occupiedSet.clear()
    for (const p of positions) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          this.occupiedSet.add(`${p.gridX + dx},${p.gridY + dy}`)
        }
      }
    }
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height, camera } = ctx

    // 缩放过小时跳过
    if (camera.zoom < MIN_ZOOM) return

    const halfW = width / 2
    const halfH = height / 2

    const scale = camera.zoom * 0.8
    const tileW = TILE_WIDTH * scale
    const tileH = TILE_HEIGHT * scale

    const gridRange = Math.ceil(Math.max(width, height) / tileW) + 2

    for (let gx = -gridRange; gx <= gridRange; gx++) {
      for (let gy = -gridRange; gy <= gridRange; gy++) {
        const key = `${gx},${gy}`

        // 跳过被占用的格子
        if (this.occupiedSet.has(key)) continue

        // 确定性随机决定是否放置装饰
        const hash = decoHash(gx, gy)
        if ((hash % 100) / 100 >= DECO_PROBABILITY) continue

        // 屏幕坐标
        const screenX = halfW + (gx - gy) * (tileW / 2) + camera.x * camera.zoom
        const screenY = halfH + (gx + gy) * (tileH / 2) + camera.y * camera.zoom

        // 视锥裁剪
        if (screenX < -tileW || screenX > width + tileW ||
            screenY < -tileH * 2 || screenY > height + tileH) {
          continue
        }

        // 选择装饰类型
        const decoType = this.getDecoType(hash)
        // 在格子内的微偏移（避免整齐排列）
        const offsetX = ((hash >> 4) % 20 - 10) * scale * 0.3
        const offsetY = ((hash >> 8) % 14 - 7) * scale * 0.3

        this.drawDecoration(c, screenX + offsetX, screenY + offsetY, decoType, scale, hash)
      }
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
    const trunkH = 12 * treeScale
    const crownR = 10 * treeScale

    // 树冠颜色变体
    const greenVariant = 80 + (hash % 40)
    const hue = 100 + (hash % 30)

    // 树影
    c.globalAlpha = 0.12
    c.fillStyle = '#000'
    c.beginPath()
    c.ellipse(x, y + 2 * scale, crownR * 0.9, crownR * 0.35, 0, 0, Math.PI * 2)
    c.fill()
    c.globalAlpha = 1

    // 树干
    const trunkW = 3 * treeScale
    c.fillStyle = '#8B6914'
    c.fillRect(x - trunkW / 2, y - trunkH, trunkW, trunkH)

    // 树冠（椭球形，等距压缩）
    c.fillStyle = `hsl(${hue}, 55%, ${greenVariant * 0.4}%)`
    c.beginPath()
    c.ellipse(x, y - trunkH - crownR * 0.4, crownR, crownR * 0.75, 0, 0, Math.PI * 2)
    c.fill()

    // 树冠高光
    c.fillStyle = `hsl(${hue}, 50%, ${greenVariant * 0.4 + 12}%)`
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
    const r = 7 * bushScale
    const hue = 110 + (hash % 25)

    // 灌木阴影
    c.globalAlpha = 0.1
    c.fillStyle = '#000'
    c.beginPath()
    c.ellipse(x, y + 1 * scale, r * 0.8, r * 0.3, 0, 0, Math.PI * 2)
    c.fill()
    c.globalAlpha = 1

    // 主体
    c.fillStyle = `hsl(${hue}, 50%, 32%)`
    c.beginPath()
    c.ellipse(x, y - r * 0.3, r, r * 0.55, 0, 0, Math.PI * 2)
    c.fill()

    // 高光
    c.fillStyle = `hsl(${hue}, 45%, 42%)`
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
    const colors = ['#e74c3c', '#f39c12', '#9b59b6', '#3498db', '#e91e63']

    // 草底
    c.fillStyle = 'hsl(110, 45%, 35%)'
    c.beginPath()
    c.ellipse(x, y, 6 * fScale, 3 * fScale, 0, 0, Math.PI * 2)
    c.fill()

    // 花朵（3-4 个小圆点）
    const count = 3 + (hash % 2)
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (hash % 100) / 50
      const dist = 3 * fScale
      const fx = x + Math.cos(angle) * dist
      const fy = y - 1 * fScale + Math.sin(angle) * dist * 0.5
      
      c.fillStyle = colors[(hash + i) % colors.length]
      c.beginPath()
      c.arc(fx, fy, 1.5 * fScale, 0, Math.PI * 2)
      c.fill()
    }
  }

  dispose(): void {
    this.occupiedSet.clear()
    this.nexusPositions = []
  }
}
