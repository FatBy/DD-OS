// ============================================
// DD-OS 等轴测建筑渲染器
// 使用 isometric-city 资源包
// ============================================

import type { NexusEntity } from '@/types'
import type { EntityRenderer, RenderContext, Point } from '../types'
import { inferBuildingStyle, type BuildingStyle } from '../topdown/BuildingGenerator'
import { 
  getIsometricTileAtlas, 
  BUILDING_STYLE_TILES, 
  ISO_TILE_WIDTH, 
  ISO_TILE_HEIGHT,
  type IsoTileInfo,
} from './IsometricTileAtlas'

/**
 * 从 visualDNA 获取主色调
 */
function getHue(nexus: NexusEntity): number {
  return nexus.visualDNA?.primaryHue ?? 180
}

/**
 * 从 visualDNA 获取发光颜色
 */
function getGlowColor(nexus: NexusEntity): string {
  const hue = getHue(nexus)
  return `hsl(${hue}, 80%, 60%)`
}

/**
 * 等轴测建筑渲染器
 */
export class IsometricBuildingRenderer implements EntityRenderer {
  readonly id = 'isometric-building-renderer'

  private styleCache: Map<string, BuildingStyle> = new Map()
  private tileCache: Map<string, IsoTileInfo> = new Map()
  private executingNexusId: string | null = null
  private executionStartTime: number | null = null

  canRender(_nexus: NexusEntity): boolean {
    return true
  }

  setExecutionState(nexusId: string | null, startTime: number | null): void {
    this.executingNexusId = nexusId
    this.executionStartTime = startTime
  }

  private getStyle(nexus: NexusEntity): BuildingStyle {
    let style = this.styleCache.get(nexus.id)
    if (!style) {
      style = inferBuildingStyle(nexus)
      this.styleCache.set(nexus.id, style)
    }
    return style
  }

  private getTileForBuilding(nexus: NexusEntity): IsoTileInfo | null {
    let tile = this.tileCache.get(nexus.id)
    if (tile) return tile

    const style = this.getStyle(nexus)
    const tiles = BUILDING_STYLE_TILES[style]
    
    if (!tiles || tiles.length === 0) return null

    // 基于 nexus ID 的哈希选择瓦片变体
    const hash = nexus.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
    tile = tiles[hash % tiles.length]
    this.tileCache.set(nexus.id, tile)
    
    return tile
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
    const tile = this.getTileForBuilding(nexus)
    const atlas = getIsometricTileAtlas()

    // 构造进度
    const buildProgress = nexus.constructionProgress ?? 1

    c.save()
    c.globalAlpha = 0.3 + 0.7 * buildProgress

    // 等轴测建筑缩放 - 增大建筑让其更醒目
    const scale = camera.zoom * 2.5

    // 执行时悬浮效果
    let floatY = 0
    if (isExecuting) {
      floatY = -15 + Math.sin(timestamp / 150) * 5
      // 底盘阴影
      c.fillStyle = 'rgba(0, 0, 0, 0.2)'
      c.beginPath()
      c.ellipse(
        screenPos.x,
        screenPos.y + ISO_TILE_HEIGHT * scale * 0.3,
        ISO_TILE_WIDTH * scale * 0.4,
        ISO_TILE_HEIGHT * scale * 0.15,
        0, 0, Math.PI * 2
      )
      c.fill()
    }

    // 执行/选中时发光效果
    if (isExecuting || isSelected) {
      const glowColor = getGlowColor(nexus)
      const pulse = isExecuting
        ? 0.6 + 0.4 * Math.sin(timestamp / 200)
        : 0.8
      c.shadowColor = glowColor
      c.shadowBlur = 25 * pulse
    }

    // 绘制建筑瓦片
    if (tile && atlas.isLoaded()) {
      atlas.drawTile(c, tile, screenPos.x, screenPos.y + floatY, scale)
    } else {
      // 瓦片未加载时绘制占位符
      this.drawPlaceholder(c, screenPos, scale, floatY, nexus)
    }

    // 选中高亮
    if (isSelected) {
      c.strokeStyle = getGlowColor(nexus)
      c.lineWidth = 3
      const w = ISO_TILE_WIDTH * scale
      const h = ISO_TILE_HEIGHT * scale
      c.strokeRect(
        screenPos.x - w / 2 - 4,
        screenPos.y - h / 2 - 4 + floatY,
        w + 8,
        h + 8,
      )
    }

    c.shadowColor = 'transparent'
    c.shadowBlur = 0
    c.globalAlpha = 1
    c.restore()

    // 建筑风格标签
    const style = this.getStyle(nexus)
    this.drawStyleBadge(c, style, screenPos, ISO_TILE_HEIGHT * scale * 0.4 + floatY + 10)

    // 主标签
    if (nexus.label) {
      this.drawLabel(c, nexus, screenPos, ISO_TILE_HEIGHT * scale * 0.4 + floatY + 30, isSelected)
    }

    // 执行指示器
    if (isExecuting && this.executionStartTime) {
      this.drawExecutionIndicator(c, screenPos, timestamp, nexus, floatY - ISO_TILE_HEIGHT * scale * 0.5 - 20)
    }
  }

  /**
   * 绘制占位符（瓦片加载前）
   */
  private drawPlaceholder(
    c: CanvasRenderingContext2D,
    pos: Point,
    scale: number,
    floatY: number,
    nexus: NexusEntity,
  ): void {
    const w = ISO_TILE_WIDTH * scale
    const h = ISO_TILE_HEIGHT * scale
    const hue = getHue(nexus)

    // 等轴测菱形底座
    c.fillStyle = `hsla(${hue}, 40%, 50%, 0.6)`
    c.beginPath()
    c.moveTo(pos.x, pos.y - h * 0.3 + floatY)
    c.lineTo(pos.x + w * 0.4, pos.y + floatY)
    c.lineTo(pos.x, pos.y + h * 0.3 + floatY)
    c.lineTo(pos.x - w * 0.4, pos.y + floatY)
    c.closePath()
    c.fill()

    // 简单立方体顶面
    c.fillStyle = `hsla(${hue}, 50%, 60%, 0.8)`
    c.beginPath()
    c.moveTo(pos.x, pos.y - h * 0.6 + floatY)
    c.lineTo(pos.x + w * 0.3, pos.y - h * 0.3 + floatY)
    c.lineTo(pos.x, pos.y - h * 0.1 + floatY)
    c.lineTo(pos.x - w * 0.3, pos.y - h * 0.3 + floatY)
    c.closePath()
    c.fill()

    // 加载中文字
    c.fillStyle = '#fff'
    c.font = '10px sans-serif'
    c.textAlign = 'center'
    c.fillText('Loading...', pos.x, pos.y + floatY)
  }

  private drawStyleBadge(
    ctx: CanvasRenderingContext2D,
    style: string,
    pos: Point,
    offsetY: number,
  ): void {
    const styleLabels: Record<string, string> = {
      shop: '🏪',
      workshop: '🔧',
      library: '📚',
      factory: '🏭',
      vault: '🔐',
      portal: '🌐',
      archive: '📁',
    }
    
    const emoji = styleLabels[style] || '🏠'
    
    ctx.font = '16px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(emoji, pos.x, pos.y + offsetY)
  }

  private drawLabel(
    ctx: CanvasRenderingContext2D,
    nexus: NexusEntity,
    pos: Point,
    offsetY: number,
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
    const bgY = pos.y + offsetY

    ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 4)
    ctx.fill()

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
    offsetY: number,
  ): void {
    const glowColor = getGlowColor(nexus)
    const elapsed = timestamp - (this.executionStartTime || timestamp)
    const pulse = 0.5 + 0.5 * Math.sin(elapsed / 150)

    ctx.save()
    ctx.translate(pos.x, pos.y + offsetY)
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

  invalidateCache(nexusId: string): void {
    this.styleCache.delete(nexusId)
    this.tileCache.delete(nexusId)
  }

  clearCache(): void {
    this.styleCache.clear()
    this.tileCache.clear()
  }

  dispose(): void {
    this.styleCache.clear()
    this.tileCache.clear()
  }
}
