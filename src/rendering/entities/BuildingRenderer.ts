// ============================================
// DD-OS 建筑渲染器 (城市主题)
// 使用 Kenney 素材包的等距建筑图片
// 支持 50+ 种建筑变体、地面阴影、执行悬浮动画
// ============================================

import type { NexusEntity } from '@/types'
import type { EntityRenderer, RenderContext, Point, BufferCanvas } from '../types'

// 可用的建筑素材列表（从 Kenney 素材包筛选出的完整建筑）
// 排除了: 地面板(x*8+5, x*8+6), 屋顶片(064-096范围)
const ALL_BUILDING_SPRITES = [
  // ---- 商业建筑 (Row 0-1) ----
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_000.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_001.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_002.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_003.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_004.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_007.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_008.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_009.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_010.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_011.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_012.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_015.png',
  // ---- 办公建筑 (Row 2-3) ----
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_016.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_017.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_018.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_019.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_020.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_023.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_024.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_025.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_026.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_027.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_028.png',
  // ---- 多样风格 (Row 4-7) ----
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_030.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_031.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_032.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_033.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_034.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_035.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_036.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_039.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_040.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_041.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_042.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_043.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_044.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_047.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_048.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_049.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_050.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_051.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_052.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_055.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_056.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_057.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_058.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_059.png',
  // ---- 高级建筑 (Row 12-15, 带底座) ----
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_100.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_101.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_102.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_103.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_108.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_109.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_110.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_111.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_116.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_117.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_118.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_119.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_124.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_125.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_126.png',
  '/assets/kenney/isometric-buildings-1/PNG/buildingTiles_127.png',
]

// 阴影配置
const SHADOW_ALPHA = 0.18
const SHADOW_RX = 40    // 椭圆阴影 X 半径
const SHADOW_RY = 12    // 椭圆阴影 Y 半径

// 悬浮动画配置
const FLOAT_AMPLITUDE = 5   // 悬浮最大像素偏移
const FLOAT_SPEED = 300     // 悬浮周期（ms 单位的 sin 分母）

/**
 * 从 visualDNA 的 primaryHue 生成发光颜色
 */
function getGlowColor(nexus: NexusEntity): string {
  const hue = nexus.visualDNA?.primaryHue ?? 180
  return `hsl(${hue}, 80%, 60%)`
}

/**
 * 基于图片素材的建筑渲染器
 * - 60+ 种建筑变体
 * - 地面椭圆阴影
 * - 执行时悬浮动画（建筑上浮 + 阴影缩小）
 * - 按素材比例自动对齐底部
 */
export class BuildingRenderer implements EntityRenderer {
  readonly id = 'building-renderer'
  
  private sprites: Map<string, HTMLImageElement> = new Map()
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
    for (const src of ALL_BUILDING_SPRITES) {
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
      this.renderFallback(c, screenPos, nexus, isSelected, isExecuting, timestamp)
      return
    }

    // 计算绘制尺寸（保持原始比例，适当缩放）
    const scale = 1.2
    const drawWidth = sprite.naturalWidth * scale
    const drawHeight = sprite.naturalHeight * scale

    // --- 悬浮动画 ---
    let yOffset = 0
    let shadowScale = 1
    if (isExecuting) {
      yOffset = -Math.sin(timestamp / FLOAT_SPEED) * FLOAT_AMPLITUDE
      // 悬浮越高阴影越小（0.7~1.0）
      shadowScale = 1 - Math.abs(Math.sin(timestamp / FLOAT_SPEED)) * 0.3
    }

    // --- 地面阴影（在建筑之前绘制）---
    c.save()
    c.globalAlpha = SHADOW_ALPHA * shadowScale
    c.fillStyle = '#000'
    c.beginPath()
    c.ellipse(
      screenPos.x,
      screenPos.y + 4, // 略低于锚点
      SHADOW_RX * shadowScale,
      SHADOW_RY * shadowScale,
      0, 0, Math.PI * 2,
    )
    c.fill()
    c.restore()

    // --- 建筑主体 ---
    c.save()

    // 选中/执行时的发光效果
    if (isSelected || isExecuting) {
      const glowColor = getGlowColor(nexus)
      const pulse = isExecuting 
        ? 0.6 + 0.4 * Math.sin(timestamp / 200)
        : 0.8
      
      c.shadowColor = glowColor
      c.shadowBlur = 25 * pulse
    }

    // 建造中透明度
    const buildProgress = nexus.constructionProgress ?? 1
    c.globalAlpha = 0.3 + 0.7 * buildProgress

    // 底部对齐：用素材自身高度的 12% 作为底部偏移量
    const baseOffset = sprite.naturalHeight * scale * 0.12
    c.drawImage(
      sprite,
      screenPos.x - drawWidth / 2,
      screenPos.y - drawHeight + baseOffset + yOffset,
      drawWidth,
      drawHeight,
    )

    c.globalAlpha = 1
    c.restore()

    // 标签（不受悬浮影响，始终在锚点下方）
    if (nexus.label) {
      this.drawLabel(c, nexus, screenPos, isSelected)
    }

    // 执行中旋转指示器
    if (isExecuting && this.executionStartTime) {
      this.drawExecutionIndicator(c, screenPos, timestamp, nexus, yOffset)
    }
  }

  /**
   * 根据 Nexus 获取对应的建筑素材（基于 ID 哈希）
   */
  private getBuildingSprite(nexus: NexusEntity): HTMLImageElement | null {
    let hash = 0
    for (let i = 0; i < nexus.id.length; i++) {
      hash = ((hash << 5) - hash + nexus.id.charCodeAt(i)) | 0
    }
    const spriteIndex = Math.abs(hash) % ALL_BUILDING_SPRITES.length
    return this.sprites.get(ALL_BUILDING_SPRITES[spriteIndex]) || null
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
    const hue = nexus.visualDNA?.primaryHue ?? 180
    const sat = nexus.visualDNA?.primarySaturation ?? 60
    const light = nexus.visualDNA?.primaryLightness ?? 45
    const color = `hsl(${hue}, ${sat}%, ${light}%)`
    
    const variant = nexus.visualDNA?.geometryVariant ?? 0
    const sizes = [
      { w: 50, h: 70 },
      { w: 35, h: 90 },
      { w: 60, h: 50 },
      { w: 50, h: 45 },
    ]
    const { w, h } = sizes[variant % sizes.length]
    const isoW = w * 0.5
    const isoD = w * 0.3

    // 悬浮偏移
    let yOff = 0
    let shadowSc = 1
    if (isExecuting) {
      yOff = -Math.sin(timestamp / FLOAT_SPEED) * FLOAT_AMPLITUDE
      shadowSc = 1 - Math.abs(Math.sin(timestamp / FLOAT_SPEED)) * 0.3
    }

    // 地面阴影
    c.save()
    c.globalAlpha = SHADOW_ALPHA * shadowSc
    c.fillStyle = '#000'
    c.beginPath()
    c.ellipse(pos.x, pos.y + 4, SHADOW_RX * shadowSc, SHADOW_RY * shadowSc, 0, 0, Math.PI * 2)
    c.fill()
    c.restore()

    c.save()

    if (isSelected || isExecuting) {
      const pulse = isExecuting ? 0.6 + 0.4 * Math.sin(timestamp / 200) : 0.8
      c.shadowColor = getGlowColor(nexus)
      c.shadowBlur = 20 * pulse
    }

    const py = pos.y + yOff

    // 左面
    c.fillStyle = color
    c.beginPath()
    c.moveTo(pos.x, py)
    c.lineTo(pos.x - isoW, py - isoD)
    c.lineTo(pos.x - isoW, py - isoD - h)
    c.lineTo(pos.x, py - h)
    c.closePath()
    c.fill()

    // 右面
    c.fillStyle = `hsl(${hue}, ${sat}%, ${Math.min(100, light + 15)}%)`
    c.beginPath()
    c.moveTo(pos.x, py)
    c.lineTo(pos.x + isoW, py - isoD)
    c.lineTo(pos.x + isoW, py - isoD - h)
    c.lineTo(pos.x, py - h)
    c.closePath()
    c.fill()

    // 顶面
    c.fillStyle = `hsl(${hue}, ${sat}%, ${Math.min(100, light + 25)}%)`
    c.beginPath()
    c.moveTo(pos.x, py - h)
    c.lineTo(pos.x - isoW, py - isoD - h)
    c.lineTo(pos.x, py - isoD * 2 - h)
    c.lineTo(pos.x + isoW, py - isoD - h)
    c.closePath()
    c.fill()

    c.restore()

    if (nexus.label) {
      this.drawLabel(c, nexus, pos, isSelected)
    }
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
    const bgY = pos.y + 15
    
    ctx.fillStyle = isSelected ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.55)'
    ctx.beginPath()
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 4)
    ctx.fill()
    
    ctx.fillStyle = isSelected ? '#fff' : 'rgba(255,255,255,0.85)'
    ctx.fillText(label, pos.x, bgY + 3)
  }

  private drawExecutionIndicator(
    ctx: CanvasRenderingContext2D,
    pos: Point,
    timestamp: number,
    nexus: NexusEntity,
    yOffset: number,
  ): void {
    const glowColor = getGlowColor(nexus)
    const elapsed = timestamp - (this.executionStartTime || timestamp)
    const pulse = 0.5 + 0.5 * Math.sin(elapsed / 150)
    
    ctx.save()
    ctx.translate(pos.x, pos.y - 80 + yOffset)
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
  }
}
