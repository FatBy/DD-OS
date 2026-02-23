// ============================================
// DD-OS 建筑渲染器 (城市主题)
// 使用 Kenney 素材包的等距建筑图片
// ============================================

import type { NexusEntity, NexusArchetype } from '@/types'
import type { EntityRenderer, RenderContext, Point, BufferCanvas } from '../types'

// 建筑素材映射 (Archetype -> 素材文件)
// 使用 Kenney isometric-buildings-1 素材
const BUILDING_SPRITES: Record<NexusArchetype, string[]> = {
  // MONOLITH: 高大的办公楼/图书馆 (多层建筑)
  MONOLITH: [
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_001.png',  // 基础带土地
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_009.png',  // 办公楼
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_017.png',  // 简洁办公楼
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_100.png',  // 小商店
  ],
  // SPIRE: 高塔/尖顶建筑
  SPIRE: [
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_003.png',
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_124.png',
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_116.png',
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_117.png',
  ],
  // REACTOR: 工厂/工业建筑 (矮胖带烟囱)
  REACTOR: [
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_002.png',  // 红色遮阳篷
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_010.png',
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_018.png',
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_026.png',
  ],
  // VAULT: 仓库/存储建筑 (方正)
  VAULT: [
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_000.png',
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_008.png',
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_016.png',
    '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_024.png',
  ],
}

// 地面/土地瓦片
const GROUND_TILE = '/assets/kenney/isometric-city/PNG/cityTiles_066.png'

// Archetype 发光颜色
const ARCHETYPE_GLOW: Record<NexusArchetype, string> = {
  MONOLITH: '#d4af37',  // 金色
  SPIRE: '#00d9ff',     // 青色
  REACTOR: '#ff6b35',   // 橙色
  VAULT: '#00ff88',     // 绿色
}

/**
 * 基于图片素材的建筑渲染器
 */
export class BuildingRenderer implements EntityRenderer {
  readonly id = 'building-renderer'
  
  private sprites: Map<string, HTMLImageElement> = new Map()
  private groundTile: HTMLImageElement | null = null
  private cache: Map<string, BufferCanvas> = new Map()
  private dpr = 1
  private executingNexusId: string | null = null
  private executionStartTime: number | null = null
  private loadedCount = 0

  constructor() {
    this.preloadSprites()
  }

  /**
   * 预加载所有建筑素材
   */
  private preloadSprites(): void {
    // 收集所有需要加载的素材
    const allSprites = new Set<string>()
    allSprites.add(GROUND_TILE)
    
    for (const sprites of Object.values(BUILDING_SPRITES)) {
      for (const sprite of sprites) {
        allSprites.add(sprite)
      }
    }
    
    // 加载地面瓦片
    this.groundTile = new Image()
    this.groundTile.src = GROUND_TILE
    this.groundTile.onload = () => this.loadedCount++
    this.groundTile.onerror = () => this.loadedCount++
    
    // 加载建筑素材
    for (const src of allSprites) {
      if (src === GROUND_TILE) continue
      const img = new Image()
      img.src = src
      img.onload = () => this.loadedCount++
      img.onerror = () => {
        console.warn(`[BuildingRenderer] Failed to load: ${src}`)
        this.loadedCount++
      }
      this.sprites.set(src, img)
    }
  }

  canRender(_nexus: NexusEntity): boolean {
    return true
  }

  setDpr(dpr: number): void {
    if (this.dpr !== dpr) {
      this.dpr = dpr
      this.clearCache()
    }
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
    const { ctx: c } = ctx
    const isExecuting = nexus.id === this.executingNexusId

    // 获取建筑图片
    const sprite = this.getBuildingSprite(nexus)
    if (!sprite || !sprite.complete || sprite.naturalWidth === 0) {
      // 回退到程序化渲染
      this.renderFallback(c, screenPos, nexus, isSelected, isExecuting, timestamp)
      return
    }

    // 计算绘制尺寸（保持原始比例，适当缩放）
    const scale = 1.2
    const drawWidth = sprite.naturalWidth * scale
    const drawHeight = sprite.naturalHeight * scale

    c.save()

    // 选中/执行时的发光效果
    if (isSelected || isExecuting) {
      const glowColor = ARCHETYPE_GLOW[nexus.archetype]
      const pulse = isExecuting 
        ? 0.6 + 0.4 * Math.sin(timestamp / 200)
        : 0.8
      
      c.shadowColor = glowColor
      c.shadowBlur = 25 * pulse
    }

    // 建造中透明度
    const buildProgress = nexus.constructionProgress ?? 1
    c.globalAlpha = 0.3 + 0.7 * buildProgress

    // 绘制建筑图片
    c.drawImage(
      sprite,
      screenPos.x - drawWidth / 2,
      screenPos.y - drawHeight + 20, // 底部对齐
      drawWidth,
      drawHeight
    )

    c.globalAlpha = 1
    c.restore()

    // 绘制标签
    if (nexus.label) {
      this.drawLabel(c, nexus, screenPos, isSelected)
    }

    // 执行中指示器
    if (isExecuting && this.executionStartTime) {
      this.drawExecutionIndicator(c, screenPos, timestamp, nexus.archetype)
    }
  }

  /**
   * 根据 Nexus 获取对应的建筑素材
   */
  private getBuildingSprite(nexus: NexusEntity): HTMLImageElement | null {
    const sprites = BUILDING_SPRITES[nexus.archetype]
    if (!sprites || sprites.length === 0) return null
    
    // 使用 nexus.id 的 hash 来确定使用哪个变体
    let hash = 0
    for (let i = 0; i < nexus.id.length; i++) {
      hash = ((hash << 5) - hash + nexus.id.charCodeAt(i)) | 0
    }
    const variantIndex = Math.abs(hash) % sprites.length
    
    return this.sprites.get(sprites[variantIndex]) || null
  }

  /**
   * 程序化回退渲染（当图片未加载时）
   */
  private renderFallback(
    c: CanvasRenderingContext2D,
    pos: Point,
    nexus: NexusEntity,
    isSelected: boolean,
    isExecuting: boolean,
    timestamp: number,
  ): void {
    const colors = {
      MONOLITH: '#8B7355',
      SPIRE: '#6B8E9F',
      REACTOR: '#9F6B6B',
      VAULT: '#6B9F6B',
    }
    
    const size = {
      MONOLITH: { w: 50, h: 70 },
      SPIRE: { w: 35, h: 90 },
      REACTOR: { w: 60, h: 50 },
      VAULT: { w: 50, h: 45 },
    }

    const { w, h } = size[nexus.archetype]
    const color = colors[nexus.archetype]
    const isoW = w * 0.5
    const isoD = w * 0.3

    c.save()

    if (isSelected || isExecuting) {
      const pulse = isExecuting ? 0.6 + 0.4 * Math.sin(timestamp / 200) : 0.8
      c.shadowColor = ARCHETYPE_GLOW[nexus.archetype]
      c.shadowBlur = 20 * pulse
    }

    // 简化的等距建筑
    // 左面
    c.fillStyle = color
    c.beginPath()
    c.moveTo(pos.x, pos.y)
    c.lineTo(pos.x - isoW, pos.y - isoD)
    c.lineTo(pos.x - isoW, pos.y - isoD - h)
    c.lineTo(pos.x, pos.y - h)
    c.closePath()
    c.fill()

    // 右面
    c.fillStyle = this.lighten(color, 0.2)
    c.beginPath()
    c.moveTo(pos.x, pos.y)
    c.lineTo(pos.x + isoW, pos.y - isoD)
    c.lineTo(pos.x + isoW, pos.y - isoD - h)
    c.lineTo(pos.x, pos.y - h)
    c.closePath()
    c.fill()

    // 顶面
    c.fillStyle = this.lighten(color, 0.4)
    c.beginPath()
    c.moveTo(pos.x, pos.y - h)
    c.lineTo(pos.x - isoW, pos.y - isoD - h)
    c.lineTo(pos.x, pos.y - isoD * 2 - h)
    c.lineTo(pos.x + isoW, pos.y - isoD - h)
    c.closePath()
    c.fill()

    c.restore()

    // 标签
    if (nexus.label) {
      this.drawLabel(c, nexus, pos, isSelected)
    }
  }

  private lighten(color: string, amount: number): string {
    const num = parseInt(color.replace('#', ''), 16)
    const r = Math.min(255, ((num >> 16) & 0xff) + Math.floor(255 * amount))
    const g = Math.min(255, ((num >> 8) & 0xff) + Math.floor(255 * amount))
    const b = Math.min(255, (num & 0xff) + Math.floor(255 * amount))
    return `rgb(${r},${g},${b})`
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
    
    // 背景
    const metrics = ctx.measureText(label)
    const padding = 6
    const bgWidth = metrics.width + padding * 2
    const bgHeight = 18
    const bgX = pos.x - bgWidth / 2
    const bgY = pos.y + 15
    
    ctx.fillStyle = isSelected ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.55)'
    ctx.beginPath()
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 4)
    ctx.fill()
    
    // 文字
    ctx.fillStyle = isSelected ? '#fff' : 'rgba(255,255,255,0.85)'
    ctx.fillText(label, pos.x, bgY + 3)
  }

  private drawExecutionIndicator(
    ctx: CanvasRenderingContext2D,
    pos: Point,
    timestamp: number,
    archetype: NexusArchetype,
  ): void {
    const glowColor = ARCHETYPE_GLOW[archetype]
    const elapsed = timestamp - (this.executionStartTime || timestamp)
    const pulse = 0.5 + 0.5 * Math.sin(elapsed / 150)
    
    // 旋转进度环
    ctx.save()
    ctx.translate(pos.x, pos.y - 80)
    ctx.rotate(elapsed / 500)
    
    ctx.strokeStyle = glowColor
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.globalAlpha = pulse
    
    ctx.beginPath()
    ctx.arc(0, 0, 18, 0, Math.PI * 1.5)
    ctx.stroke()
    
    ctx.restore()
  }

  // 缓存管理
  invalidateCache(nexusId: string): void {
    this.cache.delete(nexusId)
  }

  clearCache(): void {
    this.cache.clear()
  }

  dispose(): void {
    this.cache.clear()
    this.sprites.clear()
    this.groundTile = null
  }
}
