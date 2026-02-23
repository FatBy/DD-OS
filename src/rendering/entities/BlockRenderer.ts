// ============================================
// DD-OS 积木块渲染器 (极简主题)
// 纯代码生成的 3D 彩色积木块
// Stripe/纪念碑谷级高级数据可视化
// ============================================

import type { NexusEntity } from '@/types'
import type { EntityRenderer, RenderContext, Point, BufferCanvas } from '../types'
import { TILE_WIDTH, TILE_HEIGHT } from '../utils/coordinateTransforms'

// ---- 治愈系高级色盘 ----
const COLOR_PALETTE = [
  { top: '#F4A261', left: '#E76F51', right: '#E98A6C', zone: 'rgba(244, 162, 97, 0.15)' }, // 暖橘
  { top: '#2A9D8F', left: '#21867A', right: '#3DB8A9', zone: 'rgba(42, 157, 143, 0.15)' },  // 森绿
  { top: '#E9C46A', left: '#D4A348', right: '#F0D080', zone: 'rgba(233, 196, 106, 0.15)' }, // 明黄
  { top: '#8AB17D', left: '#6E9063', right: '#9EC28F', zone: 'rgba(138, 177, 125, 0.15)' }, // 草绿
  { top: '#A2D2FF', left: '#7BB8F0', right: '#B8E0FF', zone: 'rgba(162, 210, 255, 0.15)' }, // 天蓝
  { top: '#DDA0DD', left: '#BA7EBA', right: '#E8B8E8', zone: 'rgba(221, 160, 221, 0.15)' }, // 淡紫
  { top: '#FFB4A2', left: '#E69585', right: '#FFC8BA', zone: 'rgba(255, 180, 162, 0.15)' }, // 珊瑚
]

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
 * 积木块渲染器 - 极简主题
 * - 纯代码绘制 3D 彩色积木块
 * - 每个 Nexus 有专属色块地毯
 * - 执行时悬浮动画
 */
export class BlockRenderer implements EntityRenderer {
  readonly id = 'block-renderer'
  
  private cache: Map<string, BufferCanvas> = new Map()
  private dpr = 1
  private executingNexusId: string | null = null
  private executionStartTime: number | null = null

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
    const { ctx: c, camera } = ctx
    const isExecuting = nexus.id === this.executingNexusId

    // 基于 ID 计算独特的建筑特征
    const hash = getHash(nexus.id)
    const colors = COLOR_PALETTE[hash % COLOR_PALETTE.length]
    
    // 积木块高度 (Z轴)：30-90 像素
    const heightZ = 30 + (hash % 60) * camera.zoom
    
    // 积木块宽度比例 (0.5-0.8)
    const blockScale = 0.5 + ((hash % 30) / 100)
    const w = TILE_WIDTH * blockScale * camera.zoom
    const h = TILE_HEIGHT * blockScale * camera.zoom
    
    const cx = screenPos.x
    const cy = screenPos.y

    // 构造进度
    const buildProgress = nexus.constructionProgress ?? 1
    
    c.save()
    c.globalAlpha = 0.3 + 0.7 * buildProgress

    // ==========================================
    // 第一层：绘制底部的"专属色块/地毯" (Zone)
    // ==========================================
    const zoneW = TILE_WIDTH * 0.9 * camera.zoom
    const zoneH = TILE_HEIGHT * 0.9 * camera.zoom
    
    c.beginPath()
    c.moveTo(cx, cy - zoneH / 2)           // 上顶点
    c.lineTo(cx + zoneW / 2, cy)           // 右顶点
    c.lineTo(cx, cy + zoneH / 2)           // 下顶点
    c.lineTo(cx - zoneW / 2, cy)           // 左顶点
    c.closePath()
    c.fillStyle = colors.zone
    c.fill()
    
    // 画一圈细细的边框
    c.lineWidth = 1.5
    c.strokeStyle = colors.top
    c.globalAlpha = (0.3 + 0.7 * buildProgress) * 0.5
    c.stroke()
    c.globalAlpha = 0.3 + 0.7 * buildProgress

    // ==========================================
    // 第二层：绘制 3D 积木模型
    // ==========================================
    
    // 执行时悬浮效果
    let floatY = 0
    if (isExecuting) {
      floatY = -12 + Math.sin(timestamp / 150) * 4
      // 底盘阴影
      c.fillStyle = 'rgba(0, 0, 0, 0.15)'
      c.beginPath()
      c.ellipse(cx, cy + 2, w / 2.5, h / 3, 0, 0, Math.PI * 2)
      c.fill()
    }

    const baseY = cy + floatY

    // 选中/执行时的发光效果
    if (isSelected || isExecuting) {
      const glowColor = getGlowColor(nexus)
      const pulse = isExecuting
        ? 0.6 + 0.4 * Math.sin(timestamp / 200)
        : 0.8
      c.shadowColor = glowColor
      c.shadowBlur = 25 * pulse
    }

    // --- 绘制左侧面 (深色背光面) ---
    c.beginPath()
    c.moveTo(cx - w / 2, baseY)                    // 左
    c.lineTo(cx, baseY + h / 2)                    // 下
    c.lineTo(cx, baseY + h / 2 - heightZ)          // 往上拉伸
    c.lineTo(cx - w / 2, baseY - heightZ)          // 左上
    c.closePath()
    c.fillStyle = colors.left
    c.fill()
    c.strokeStyle = 'rgba(0, 0, 0, 0.1)'
    c.lineWidth = 1
    c.stroke()

    // --- 绘制右侧面 (浅色向光面) ---
    c.beginPath()
    c.moveTo(cx, baseY + h / 2)                    // 下
    c.lineTo(cx + w / 2, baseY)                    // 右
    c.lineTo(cx + w / 2, baseY - heightZ)          // 右上
    c.lineTo(cx, baseY + h / 2 - heightZ)          // 往上拉伸
    c.closePath()
    c.fillStyle = colors.right
    c.fill()
    c.stroke()

    // --- 绘制顶面 ---
    c.beginPath()
    c.moveTo(cx, baseY - h / 2 - heightZ)          // 顶上
    c.lineTo(cx + w / 2, baseY - heightZ)          // 顶右
    c.lineTo(cx, baseY + h / 2 - heightZ)          // 顶下
    c.lineTo(cx - w / 2, baseY - heightZ)          // 顶左
    c.closePath()
    c.fillStyle = colors.top
    c.fill()
    
    // 选中时顶面高亮
    if (isSelected) {
      c.fillStyle = 'rgba(255, 255, 255, 0.35)'
      c.fill()
    }
    c.stroke()

    // 重置阴影
    c.shadowColor = 'transparent'
    c.shadowBlur = 0
    c.globalAlpha = 1
    c.restore()

    // 标签
    if (nexus.label) {
      this.drawLabel(c, nexus, screenPos, isSelected, floatY, heightZ)
    }

    // 执行指示器
    if (isExecuting && this.executionStartTime) {
      this.drawExecutionIndicator(c, screenPos, timestamp, nexus, floatY, heightZ)
    }
  }

  private drawLabel(
    ctx: CanvasRenderingContext2D,
    nexus: NexusEntity,
    pos: Point,
    isSelected: boolean,
    _floatY: number,
    _heightZ: number,
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
    // 标签放在积木下方
    const bgY = pos.y + 20
    
    ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.75)'
    ctx.beginPath()
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 4)
    ctx.fill()
    
    // 边框
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)'
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
    heightZ: number,
  ): void {
    const glowColor = getGlowColor(nexus)
    const elapsed = timestamp - (this.executionStartTime || timestamp)
    const pulse = 0.5 + 0.5 * Math.sin(elapsed / 150)
    
    ctx.save()
    // 指示器放在积木顶部上方
    ctx.translate(pos.x, pos.y + floatY - heightZ - 25)
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
    this.cache.delete(nexusId)
  }

  clearCache(): void {
    this.cache.clear()
  }

  dispose(): void {
    this.cache.clear()
  }
}
