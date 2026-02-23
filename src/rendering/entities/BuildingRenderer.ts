// ============================================
// DD-OS 建筑渲染器 (Kenney 素材版)
// 使用 isometric-buildings-1 PNG 素材
// ============================================

import type { NexusEntity } from '@/types'
import type { EntityRenderer, RenderContext, Point } from '../types'

// ---- 建筑素材配置 ----
// 选取视觉效果好的建筑素材 (避免重复和奇怪的)
const BUILDING_TILES = [
  'buildingTiles_001.png', // 红色商店
  'buildingTiles_002.png', // 红色高楼
  'buildingTiles_003.png', // 红色双层
  'buildingTiles_009.png', // 蓝色商店
  'buildingTiles_010.png', // 蓝色高楼
  'buildingTiles_017.png', // 灰色商店
  'buildingTiles_018.png', // 灰色高楼
  'buildingTiles_025.png', // 黄色商店
  'buildingTiles_026.png', // 黄色高楼
  'buildingTiles_033.png', // 绿色商店
  'buildingTiles_034.png', // 绿色高楼
  'buildingTiles_040.png', // 紫色商店
  'buildingTiles_041.png', // 紫色高楼
  'buildingTiles_085.png', // 塔楼A
  'buildingTiles_092.png', // 塔楼B
  'buildingTiles_093.png', // 塔楼C
]

const ASSET_BASE = '/assets/kenney/isometric-buildings-1/PNG/'

/**
 * 简易哈希，用于确定性随机
 */
function getHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(31, hash) + str.charCodeAt(i) | 0
  }
  return Math.abs(hash)
}

/**
 * 从 visualDNA 的 primaryHue 生成发光颜色
 */
function getGlowColor(nexus: NexusEntity): string {
  const hue = nexus.visualDNA?.primaryHue ?? 180
  return `hsl(${hue}, 80%, 60%)`
}

/**
 * 建筑渲染器 - Kenney 素材版
 * - 使用预制 PNG 建筑素材
 * - 执行时悬浮动画
 * - 选中时发光效果
 */
export class BuildingRenderer implements EntityRenderer {
  readonly id = 'building-renderer'
  
  private images: Map<string, HTMLImageElement> = new Map()
  private loadingPromises: Map<string, Promise<HTMLImageElement>> = new Map()
  private executingNexusId: string | null = null
  private executionStartTime: number | null = null

  constructor() {
    this.preloadImages()
  }

  private async preloadImages(): Promise<void> {
    const promises = BUILDING_TILES.map(tile => this.loadImage(tile))
    await Promise.all(promises)
    console.log('[BuildingRenderer] All building images loaded')
  }

  private loadImage(filename: string): Promise<HTMLImageElement> {
    // 避免重复加载
    const existing = this.loadingPromises.get(filename)
    if (existing) return existing

    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        this.images.set(filename, img)
        resolve(img)
      }
      img.onerror = () => {
        console.warn(`[BuildingRenderer] Failed to load: ${filename}`)
        reject(new Error(`Failed to load ${filename}`))
      }
      img.src = ASSET_BASE + filename
    })

    this.loadingPromises.set(filename, promise)
    return promise
  }

  canRender(_nexus: NexusEntity): boolean {
    return true
  }

  setDpr(_dpr: number): void {
    // PNG 渲染由浏览器处理 DPR
  }

  setExecutionState(nexusId: string | null, startTime: number | null): void {
    this.executingNexusId = nexusId
    this.executionStartTime = startTime
  }

  render(
    ctx: RenderContext,
    nexus: NexusEntity,
    screenPos: Point,
    isSelected: boolean,
    timestamp: number,
  ): void {
    const { ctx: c, camera } = ctx
    const isExecuting = nexus.id === this.executingNexusId

    // 基于 ID 选择建筑样式
    const hash = getHash(nexus.id)
    const tileIndex = hash % BUILDING_TILES.length
    const tileName = BUILDING_TILES[tileIndex]
    const img = this.images.get(tileName)

    // 如果图片还没加载完，先画一个占位
    if (!img) {
      this.drawPlaceholder(c, screenPos, camera.zoom, isSelected)
      return
    }

    // 建筑缩放 (原始素材约 130x110)
    const scale = camera.zoom * 0.85
    const drawWidth = img.width * scale
    const drawHeight = img.height * scale

    // 构造进度
    const buildProgress = nexus.constructionProgress ?? 1

    c.save()
    c.globalAlpha = 0.3 + 0.7 * buildProgress

    // 执行时悬浮效果
    let floatY = 0
    if (isExecuting) {
      floatY = -12 + Math.sin(timestamp / 150) * 4
      // 底盘阴影
      c.fillStyle = 'rgba(0, 0, 0, 0.2)'
      c.beginPath()
      c.ellipse(screenPos.x, screenPos.y + 5, drawWidth * 0.35, drawHeight * 0.15, 0, 0, Math.PI * 2)
      c.fill()
    }

    // 选中/执行时的发光效果
    if (isSelected || isExecuting) {
      const glowColor = getGlowColor(nexus)
      const pulse = isExecuting
        ? 0.6 + 0.4 * Math.sin(timestamp / 200)
        : 0.8
      c.shadowColor = glowColor
      c.shadowBlur = 25 * pulse
    }

    // 绘制建筑图片
    // 定位：图片底部中心对齐到屏幕位置
    const drawX = screenPos.x - drawWidth / 2
    const drawY = screenPos.y - drawHeight * 0.75 + floatY  // 75% 高度作为接地点
    
    c.drawImage(img, drawX, drawY, drawWidth, drawHeight)

    // 选中时叠加高亮
    if (isSelected) {
      c.globalCompositeOperation = 'overlay'
      c.fillStyle = 'rgba(255, 255, 255, 0.15)'
      c.fillRect(drawX, drawY, drawWidth, drawHeight)
      c.globalCompositeOperation = 'source-over'
    }

    // 重置阴影
    c.shadowColor = 'transparent'
    c.shadowBlur = 0
    c.globalAlpha = 1
    c.restore()

    // 标签
    if (nexus.label) {
      this.drawLabel(c, nexus, screenPos, isSelected)
    }

    // 执行指示器
    if (isExecuting && this.executionStartTime) {
      this.drawExecutionIndicator(c, screenPos, timestamp, nexus, floatY, drawHeight)
    }
  }

  private drawPlaceholder(
    ctx: CanvasRenderingContext2D,
    pos: Point,
    zoom: number,
    isSelected: boolean,
  ): void {
    const size = 50 * zoom
    
    ctx.save()
    ctx.globalAlpha = 0.5
    
    // 简单的等距方块占位
    ctx.fillStyle = isSelected ? '#64B5F6' : '#90A4AE'
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y - size * 0.6)
    ctx.lineTo(pos.x + size / 2, pos.y - size * 0.3)
    ctx.lineTo(pos.x, pos.y)
    ctx.lineTo(pos.x - size / 2, pos.y - size * 0.3)
    ctx.closePath()
    ctx.fill()
    
    // 加载动画点
    const dotPhase = (Date.now() / 300) % 3
    ctx.fillStyle = '#fff'
    for (let i = 0; i < 3; i++) {
      const alpha = i === Math.floor(dotPhase) ? 1 : 0.3
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(pos.x - 10 + i * 10, pos.y - size * 0.3, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    
    ctx.restore()
  }

  private drawLabel(
    ctx: CanvasRenderingContext2D,
    nexus: NexusEntity,
    pos: Point,
    isSelected: boolean,
  ): void {
    const label = nexus.label || nexus.id.slice(0, 8)
    
    ctx.font = `600 ${isSelected ? 13 : 11}px "SF Mono", "Fira Code", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    
    const metrics = ctx.measureText(label)
    const padding = 6
    const bgWidth = metrics.width + padding * 2
    const bgHeight = 18
    const bgX = pos.x - bgWidth / 2
    // 标签放在建筑下方
    const bgY = pos.y + 20
    
    ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 4)
    ctx.fill()
    
    // 边框
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)'
    ctx.lineWidth = 1
    ctx.stroke()
    
    ctx.fillStyle = isSelected ? '#1a1a2e' : '#333'
    ctx.fillText(label, pos.x, bgY + 3)
  }

  private drawExecutionIndicator(
    ctx: CanvasRenderingContext2D,
    pos: Point,
    timestamp: number,
    nexus: NexusEntity,
    floatY: number,
    buildingHeight: number,
  ): void {
    const glowColor = getGlowColor(nexus)
    const elapsed = timestamp - (this.executionStartTime || timestamp)
    const pulse = 0.5 + 0.5 * Math.sin(elapsed / 150)
    
    ctx.save()
    // 指示器放在建筑顶部上方
    ctx.translate(pos.x, pos.y + floatY - buildingHeight * 0.75 - 15)
    ctx.rotate(elapsed / 500)
    
    ctx.strokeStyle = glowColor
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.globalAlpha = pulse
    
    ctx.beginPath()
    ctx.arc(0, 0, 14, 0, Math.PI * 1.5)
    ctx.stroke()
    
    ctx.restore()
  }

  invalidateCache(_nexusId: string): void {
    // PNG 图片不需要单独缓存管理
  }

  clearCache(): void {
    // PNG 由浏览器管理
  }

  dispose(): void {
    this.images.clear()
    this.loadingPromises.clear()
  }
}
