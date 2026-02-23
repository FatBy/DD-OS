// ============================================
// DD-OS 俯视角建筑渲染器 v3
// 纯色版：不依赖瓦片图集
// ============================================

import type { NexusEntity } from '@/types'
import type { EntityRenderer, RenderContext, Point } from '../types'
import { inferBuildingStyle, type BuildingStyle } from './BuildingGenerator'

const TILE_SIZE = 48

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
 * 建筑配色方案
 */
interface BuildingColors {
  wall: string
  wallDark: string
  roof: string
  door: string
  window: string
  awning: string
}

/**
 * 根据建筑风格获取配色
 */
function getBuildingColors(style: BuildingStyle, hue: number): BuildingColors {
  const baseColors: Record<BuildingStyle, BuildingColors> = {
    shop: {
      wall: '#f5e6d3',
      wallDark: '#d4c4b0',
      roof: `hsl(${hue}, 60%, 45%)`,
      door: '#8B4513',
      window: '#87CEEB',
      awning: `hsl(${hue}, 70%, 55%)`,
    },
    workshop: {
      wall: '#e8e8e8',
      wallDark: '#c0c0c0',
      roof: '#4a6fa5',
      door: '#2c5282',
      window: '#63b3ed',
      awning: '#3182ce',
    },
    library: {
      wall: '#faf3e0',
      wallDark: '#d4c4a8',
      roof: '#8b4513',
      door: '#5d4037',
      window: '#ffd54f',
      awning: '#a1887f',
    },
    factory: {
      wall: '#9e9e9e',
      wallDark: '#757575',
      roof: '#616161',
      door: '#424242',
      window: '#90caf9',
      awning: '#78909c',
    },
    vault: {
      wall: '#795548',
      wallDark: '#5d4037',
      roof: '#4e342e',
      door: '#3e2723',
      window: '#ffcc80',
      awning: '#6d4c41',
    },
    portal: {
      wall: '#e3f2fd',
      wallDark: '#bbdefb',
      roof: '#1976d2',
      door: '#0d47a1',
      window: '#64b5f6',
      awning: '#42a5f5',
    },
    archive: {
      wall: '#eceff1',
      wallDark: '#cfd8dc',
      roof: '#607d8b',
      door: '#455a64',
      window: '#90a4ae',
      awning: '#78909c',
    },
  }

  return baseColors[style] || baseColors.shop
}

/**
 * 俯视角建筑渲染器 - 纯色版本
 */
export class TopDownBuildingRenderer implements EntityRenderer {
  readonly id = 'topdown-building-renderer'

  private styleCache: Map<string, BuildingStyle> = new Map()
  private executingNexusId: string | null = null
  private executionStartTime: number | null = null

  canRender(_nexus: NexusEntity): boolean {
    return true
  }

  setDpr(_dpr: number): void {
    // 纯色渲染不需要 DPR 处理
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

  render(
    ctx: RenderContext,
    nexus: NexusEntity,
    screenPos: Point,
    isSelected: boolean,
    timestamp: number,
  ): void {
    const { ctx: c, camera } = ctx
    const isExecuting = nexus.id === this.executingNexusId
    const style = this.getStyle(nexus)
    const hue = getHue(nexus)
    const colors = getBuildingColors(style, hue)

    // 计算缩放
    const tileSize = TILE_SIZE * camera.zoom

    // 建筑尺寸 (3x3 格子)
    const buildingWidth = tileSize * 3
    const buildingHeight = tileSize * 2.5

    // 建筑中心对齐到屏幕位置
    const startX = screenPos.x - buildingWidth / 2
    const startY = screenPos.y - buildingHeight / 2

    // 构造进度
    const buildProgress = nexus.constructionProgress ?? 1

    c.save()
    c.globalAlpha = 0.3 + 0.7 * buildProgress

    // 执行时悬浮效果
    let floatY = 0
    if (isExecuting) {
      floatY = -8 + Math.sin(timestamp / 150) * 3
      // 底盘阴影
      c.fillStyle = 'rgba(0, 0, 0, 0.15)'
      c.beginPath()
      c.ellipse(
        screenPos.x,
        screenPos.y + buildingHeight / 2 + 5,
        buildingWidth * 0.4,
        buildingHeight * 0.12,
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
      c.shadowBlur = 20 * pulse
    }

    // 绘制建筑
    this.drawBuilding(c, startX, startY + floatY, buildingWidth, buildingHeight, colors, style)

    // 选中高亮边框
    if (isSelected) {
      c.strokeStyle = getGlowColor(nexus)
      c.lineWidth = 3
      c.strokeRect(
        startX - 4,
        startY - 4 + floatY,
        buildingWidth + 8,
        buildingHeight + 8,
      )
    }

    c.shadowColor = 'transparent'
    c.shadowBlur = 0
    c.globalAlpha = 1
    c.restore()

    // 建筑风格标签
    this.drawStyleBadge(c, style, screenPos, buildingHeight / 2 + floatY + 15)

    // 主标签
    if (nexus.label) {
      this.drawLabel(c, nexus, screenPos, buildingHeight / 2 + floatY + 35, isSelected)
    }

    // 执行指示器
    if (isExecuting && this.executionStartTime) {
      this.drawExecutionIndicator(c, screenPos, timestamp, nexus, floatY - buildingHeight / 2 - 20)
    }
  }

  /**
   * 绘制建筑主体
   */
  private drawBuilding(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    colors: BuildingColors,
    style: BuildingStyle,
  ): void {
    const roofHeight = h * 0.25
    const bodyHeight = h - roofHeight

    // 建筑基座（人行道）
    c.fillStyle = '#d0d0d0'
    c.fillRect(x - 8, y + h - 4, w + 16, 12)

    // 主体墙壁
    c.fillStyle = colors.wall
    c.fillRect(x, y + roofHeight, w, bodyHeight)

    // 墙壁边框/阴影
    c.strokeStyle = colors.wallDark
    c.lineWidth = 2
    c.strokeRect(x, y + roofHeight, w, bodyHeight)

    // 屋顶
    c.fillStyle = colors.roof
    c.beginPath()
    c.moveTo(x - 5, y + roofHeight)
    c.lineTo(x + w / 2, y)
    c.lineTo(x + w + 5, y + roofHeight)
    c.closePath()
    c.fill()

    // 屋顶边框
    c.strokeStyle = colors.wallDark
    c.lineWidth = 1
    c.stroke()

    // 遮阳棚
    const awningY = y + roofHeight + bodyHeight * 0.1
    const awningHeight = bodyHeight * 0.15
    c.fillStyle = colors.awning
    c.beginPath()
    c.moveTo(x, awningY)
    c.lineTo(x + w, awningY)
    c.lineTo(x + w + 8, awningY + awningHeight)
    c.lineTo(x - 8, awningY + awningHeight)
    c.closePath()
    c.fill()

    // 遮阳棚条纹
    c.strokeStyle = 'rgba(255,255,255,0.3)'
    c.lineWidth = 2
    for (let i = 0; i < 5; i++) {
      const stripeX = x + (w / 5) * i + w / 10
      c.beginPath()
      c.moveTo(stripeX, awningY)
      c.lineTo(stripeX, awningY + awningHeight)
      c.stroke()
    }

    // 窗户
    const windowY = awningY + awningHeight + bodyHeight * 0.1
    const windowHeight = bodyHeight * 0.25
    const windowWidth = w * 0.25
    const windowGap = w * 0.1

    c.fillStyle = colors.window
    // 左窗
    c.fillRect(x + windowGap, windowY, windowWidth, windowHeight)
    // 右窗
    c.fillRect(x + w - windowGap - windowWidth, windowY, windowWidth, windowHeight)

    // 窗户框架
    c.strokeStyle = colors.wallDark
    c.lineWidth = 1
    c.strokeRect(x + windowGap, windowY, windowWidth, windowHeight)
    c.strokeRect(x + w - windowGap - windowWidth, windowY, windowWidth, windowHeight)

    // 窗户十字框
    c.beginPath()
    c.moveTo(x + windowGap + windowWidth / 2, windowY)
    c.lineTo(x + windowGap + windowWidth / 2, windowY + windowHeight)
    c.moveTo(x + windowGap, windowY + windowHeight / 2)
    c.lineTo(x + windowGap + windowWidth, windowY + windowHeight / 2)
    c.stroke()

    c.beginPath()
    c.moveTo(x + w - windowGap - windowWidth / 2, windowY)
    c.lineTo(x + w - windowGap - windowWidth / 2, windowY + windowHeight)
    c.moveTo(x + w - windowGap - windowWidth, windowY + windowHeight / 2)
    c.lineTo(x + w - windowGap, windowY + windowHeight / 2)
    c.stroke()

    // 门
    const doorWidth = w * 0.2
    const doorHeight = bodyHeight * 0.4
    const doorX = x + w / 2 - doorWidth / 2
    const doorY = y + h - doorHeight

    c.fillStyle = colors.door
    c.fillRect(doorX, doorY, doorWidth, doorHeight)

    // 门框
    c.strokeStyle = colors.wallDark
    c.lineWidth = 2
    c.strokeRect(doorX, doorY, doorWidth, doorHeight)

    // 门把手
    c.fillStyle = '#FFD700'
    c.beginPath()
    c.arc(doorX + doorWidth * 0.75, doorY + doorHeight * 0.5, 3, 0, Math.PI * 2)
    c.fill()

    // 根据风格添加特殊装饰
    this.drawStyleDecoration(c, x, y, w, h, roofHeight, style, colors)
  }

  /**
   * 根据建筑风格添加特殊装饰
   */
  private drawStyleDecoration(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    roofHeight: number,
    style: BuildingStyle,
    colors: BuildingColors,
  ): void {
    switch (style) {
      case 'factory':
        // 烟囱
        c.fillStyle = colors.wallDark
        c.fillRect(x + w - 20, y - 15, 12, roofHeight + 15)
        // 烟
        c.fillStyle = 'rgba(128, 128, 128, 0.5)'
        c.beginPath()
        c.arc(x + w - 14, y - 25, 8, 0, Math.PI * 2)
        c.fill()
        break

      case 'library':
        // 书本招牌
        c.fillStyle = '#8B4513'
        c.fillRect(x + w / 2 - 15, y + roofHeight - 5, 30, 10)
        c.fillStyle = '#FFF'
        c.font = '8px sans-serif'
        c.textAlign = 'center'
        c.fillText('BOOKS', x + w / 2, y + roofHeight + 3)
        break

      case 'portal':
        // 信号天线
        c.strokeStyle = colors.wallDark
        c.lineWidth = 2
        c.beginPath()
        c.moveTo(x + w / 2, y)
        c.lineTo(x + w / 2, y - 20)
        c.stroke()
        // 信号波
        c.strokeStyle = colors.awning
        c.lineWidth = 1
        for (let i = 1; i <= 3; i++) {
          c.beginPath()
          c.arc(x + w / 2, y - 20, i * 5, Math.PI * 1.2, Math.PI * 1.8)
          c.stroke()
        }
        break

      case 'vault':
        // 加固门框
        c.strokeStyle = '#FFD700'
        c.lineWidth = 3
        const doorX = x + w / 2 - w * 0.1
        const doorY = y + h - (h - roofHeight) * 0.4
        c.strokeRect(doorX - 5, doorY - 5, w * 0.2 + 10, (h - roofHeight) * 0.4 + 5)
        break
    }
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
  }

  clearCache(): void {
    this.styleCache.clear()
  }

  dispose(): void {
    this.styleCache.clear()
  }
}
