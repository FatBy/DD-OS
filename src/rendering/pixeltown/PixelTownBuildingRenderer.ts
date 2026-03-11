// ============================================
// DD-OS 像素小镇建筑渲染器
// Canvas 2D 手绘像素风建筑
// 渐变屋顶 + 发光窗户 + 烟囱冒烟
// ============================================

import type { NexusEntity } from '@/types'
import type { EntityRenderer, RenderContext, Point } from '../types'
import { TILE_WIDTH, TILE_HEIGHT } from '../utils/coordinateTransforms'

// ---- 治愈系配色 (基于 Minimalist 7 色盘扩展) ----
const HOUSE_PALETTE = [
  { wall: '#F5E6D3', wallDark: '#E8D4BE', roof: '#E76F51', roofDark: '#C95A3E', accent: '#F4A261' },
  { wall: '#E8F0E8', wallDark: '#D4E2D4', roof: '#2A9D8F', roofDark: '#1F7A6E', accent: '#3DB8A9' },
  { wall: '#FFF8E7', wallDark: '#F0E8D4', roof: '#E9C46A', roofDark: '#C9A44A', accent: '#F0D080' },
  { wall: '#EDF4EA', wallDark: '#DCE8D6', roof: '#6E9063', roofDark: '#557548', accent: '#8AB17D' },
  { wall: '#EFF6FF', wallDark: '#DCE8F8', roof: '#5B8EC9', roofDark: '#4570A0', accent: '#A2D2FF' },
  { wall: '#F8EFF8', wallDark: '#EBD8EB', roof: '#BA7EBA', roofDark: '#985098', accent: '#DDA0DD' },
  { wall: '#FFF0ED', wallDark: '#F5DDD8', roof: '#E69585', roofDark: '#C47565', accent: '#FFB4A2' },
]

// ---- Level 配置 ----
interface LevelConfig {
  wallH: number        // 墙壁高度 (px, 基准)
  roofH: number        // 屋顶高度
  scale: number        // 整体缩放
  windows: number      // 窗户行数
  windowCols: number   // 窗户列数
  hasChimney: boolean
  hasDoor: boolean
  floors: number       // 楼层数 (视觉)
}

const LEVEL_CONFIGS: Record<number, LevelConfig> = {
  1: { wallH: 22, roofH: 14, scale: 0.45, windows: 1, windowCols: 1, hasChimney: false, hasDoor: true, floors: 1 },
  2: { wallH: 30, roofH: 16, scale: 0.55, windows: 1, windowCols: 2, hasChimney: true, hasDoor: true, floors: 1 },
  3: { wallH: 45, roofH: 18, scale: 0.65, windows: 2, windowCols: 2, hasChimney: true, hasDoor: true, floors: 2 },
  4: { wallH: 65, roofH: 20, scale: 0.75, windows: 3, windowCols: 2, hasChimney: true, hasDoor: true, floors: 3 },
}

// ---- 烟雾粒子 ----
interface SmokeParticle {
  x: number
  y: number
  size: number
  opacity: number
  age: number
  maxAge: number
  vx: number
  vy: number
}

function getHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(31, hash) + str.charCodeAt(i) | 0
  }
  return Math.abs(hash)
}

function getGlowColor(nexus: NexusEntity): string {
  const hue = nexus.visualDNA?.primaryHue ?? 180
  return `hsl(${hue}, 80%, 60%)`
}

/**
 * 像素小镇建筑渲染器
 * Canvas 2D 纯手绘风格建筑
 */
export class PixelTownBuildingRenderer implements EntityRenderer {
  readonly id = 'pixeltown-building-renderer'

  private executingNexusId: string | null = null
  private executionStartTime: number | null = null
  private smokeMap: Map<string, SmokeParticle[]> = new Map()

  canRender(_nexus: NexusEntity): boolean {
    return true
  }

  setDpr(_dpr: number): void {
    // Reserved for future high-DPI buffer support
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

    const hash = getHash(nexus.id)
    const colors = HOUSE_PALETTE[hash % HOUSE_PALETTE.length]
    const level = Math.min(Math.max(nexus.level || 1, 1), 4)
    const cfg = LEVEL_CONFIGS[level]

    const wallH = cfg.wallH * camera.zoom
    const roofH = cfg.roofH * camera.zoom
    const blockScale = cfg.scale + ((hash % 10) / 100)
    const w = TILE_WIDTH * blockScale * camera.zoom
    const h = TILE_HEIGHT * blockScale * camera.zoom

    const cx = screenPos.x
    const cy = screenPos.y
    const buildProgress = nexus.constructionProgress ?? 1

    c.save()
    c.globalAlpha = 0.3 + 0.7 * buildProgress

    // ============ Zone 地毯 ============
    const zoneW = TILE_WIDTH * 0.9 * camera.zoom
    const zoneH = TILE_HEIGHT * 0.9 * camera.zoom
    c.beginPath()
    c.moveTo(cx, cy - zoneH / 2)
    c.lineTo(cx + zoneW / 2, cy)
    c.lineTo(cx, cy + zoneH / 2)
    c.lineTo(cx - zoneW / 2, cy)
    c.closePath()
    c.fillStyle = `rgba(${this.hexToRgb(colors.roof)}, 0.1)`
    c.fill()

    // ============ 执行悬浮 ============
    let floatY = 0
    if (isExecuting) {
      floatY = -12 + Math.sin(timestamp / 150) * 4
      c.fillStyle = 'rgba(0, 0, 0, 0.12)'
      c.beginPath()
      c.ellipse(cx, cy + 2, w / 2.5, h / 3, 0, 0, Math.PI * 2)
      c.fill()
    }
    const baseY = cy + floatY

    // 选中/执行发光
    if (isSelected || isExecuting) {
      const glowColor = getGlowColor(nexus)
      const pulse = isExecuting ? 0.6 + 0.4 * Math.sin(timestamp / 200) : 0.8
      c.shadowColor = glowColor
      c.shadowBlur = 25 * pulse
    }

    // ============ 墙壁 ============
    // 左面墙 (深色面)
    c.beginPath()
    c.moveTo(cx - w / 2, baseY)
    c.lineTo(cx, baseY + h / 2)
    c.lineTo(cx, baseY + h / 2 - wallH)
    c.lineTo(cx - w / 2, baseY - wallH)
    c.closePath()
    c.fillStyle = colors.wallDark
    c.fill()
    c.strokeStyle = 'rgba(0,0,0,0.08)'
    c.lineWidth = 1
    c.stroke()

    // 右面墙 (亮色面)
    c.beginPath()
    c.moveTo(cx, baseY + h / 2)
    c.lineTo(cx + w / 2, baseY)
    c.lineTo(cx + w / 2, baseY - wallH)
    c.lineTo(cx, baseY + h / 2 - wallH)
    c.closePath()
    c.fillStyle = colors.wall
    c.fill()
    c.strokeStyle = 'rgba(0,0,0,0.08)'
    c.lineWidth = 1
    c.stroke()

    // ============ 窗户 (发光) ============
    this.drawWindows(c, cx, baseY, w, h, wallH, cfg, hash, timestamp, colors)

    // ============ 门 ============
    if (cfg.hasDoor) {
      this.drawDoor(c, cx, baseY, w, h, wallH, camera.zoom, colors)
    }

    // ============ 屋顶 (渐变) ============
    this.drawRoof(c, cx, baseY, w, h, wallH, roofH, colors, isSelected)

    // ============ 烟囱 + 烟雾 ============
    if (cfg.hasChimney) {
      this.drawChimney(c, cx, baseY, w, h, wallH, roofH, camera.zoom, colors, nexus.id, timestamp)
    }

    // 重置阴影
    c.shadowColor = 'transparent'
    c.shadowBlur = 0
    c.globalAlpha = 1
    c.restore()

    // 标签
    if (nexus.label) {
      this.drawLabel(c, nexus, screenPos, isSelected, floatY, wallH + roofH)
    }

    // 执行指示器
    if (isExecuting && this.executionStartTime) {
      this.drawExecutionIndicator(c, screenPos, timestamp, nexus, floatY, wallH + roofH)
    }
  }

  // ============================================================
  // 窗户绘制 - 暖黄色发光
  // ============================================================
  private drawWindows(
    ctx: CanvasRenderingContext2D,
    cx: number, baseY: number,
    w: number, h: number, wallH: number,
    cfg: LevelConfig, hash: number,
    timestamp: number, _colors: typeof HOUSE_PALETTE[0],
  ): void {
    const winW = w * 0.09
    const winH = wallH * 0.12
    const vertPad = wallH * 0.18

    // 窗户发光脉冲 (微妙)
    const glowPulse = 0.85 + 0.15 * Math.sin(timestamp / 800 + hash * 0.1)

    // --- 左面窗户 ---
    for (let row = 0; row < cfg.windows; row++) {
      for (let col = 0; col < cfg.windowCols; col++) {
        const tH = (col + 1) / (cfg.windowCols + 1)
        const tV = (row + 1) / (cfg.windows + 1)
        const yOff = vertPad + (wallH - vertPad * 2) * (1 - tV)

        const faceX = cx - w / 2 + (w / 2) * tH
        const faceY = baseY + (h / 2) * tH

        // 窗户背景 (暖黄)
        ctx.fillStyle = `rgba(255, 230, 150, ${0.7 * glowPulse})`
        ctx.fillRect(faceX - winW / 2, faceY - yOff - winH / 2, winW, winH)

        // 窗户光晕
        const glow = ctx.createRadialGradient(
          faceX, faceY - yOff,
          0, faceX, faceY - yOff,
          winW * 2,
        )
        glow.addColorStop(0, `rgba(255, 240, 180, ${0.12 * glowPulse})`)
        glow.addColorStop(1, 'rgba(255, 240, 180, 0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(faceX, faceY - yOff, winW * 2, 0, Math.PI * 2)
        ctx.fill()

        // 窗框
        ctx.strokeStyle = `rgba(0,0,0,0.12)`
        ctx.lineWidth = 0.6
        ctx.strokeRect(faceX - winW / 2, faceY - yOff - winH / 2, winW, winH)
        // 十字窗框
        ctx.beginPath()
        ctx.moveTo(faceX, faceY - yOff - winH / 2)
        ctx.lineTo(faceX, faceY - yOff + winH / 2)
        ctx.moveTo(faceX - winW / 2, faceY - yOff)
        ctx.lineTo(faceX + winW / 2, faceY - yOff)
        ctx.stroke()
      }
    }

    // --- 右面窗户 ---
    for (let row = 0; row < cfg.windows; row++) {
      for (let col = 0; col < cfg.windowCols; col++) {
        const tH = (col + 1) / (cfg.windowCols + 1)
        const tV = (row + 1) / (cfg.windows + 1)
        const yOff = vertPad + (wallH - vertPad * 2) * (1 - tV)

        const faceX = cx + (w / 2) * tH
        const faceY = baseY + h / 2 - (h / 2) * tH

        ctx.fillStyle = `rgba(255, 230, 150, ${0.6 * glowPulse})`
        ctx.fillRect(faceX - winW / 2, faceY - yOff - winH / 2, winW, winH)

        const glow = ctx.createRadialGradient(
          faceX, faceY - yOff,
          0, faceX, faceY - yOff,
          winW * 2,
        )
        glow.addColorStop(0, `rgba(255, 240, 180, ${0.1 * glowPulse})`)
        glow.addColorStop(1, 'rgba(255, 240, 180, 0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(faceX, faceY - yOff, winW * 2, 0, Math.PI * 2)
        ctx.fill()

        ctx.strokeStyle = `rgba(0,0,0,0.1)`
        ctx.lineWidth = 0.6
        ctx.strokeRect(faceX - winW / 2, faceY - yOff - winH / 2, winW, winH)
        ctx.beginPath()
        ctx.moveTo(faceX, faceY - yOff - winH / 2)
        ctx.lineTo(faceX, faceY - yOff + winH / 2)
        ctx.moveTo(faceX - winW / 2, faceY - yOff)
        ctx.lineTo(faceX + winW / 2, faceY - yOff)
        ctx.stroke()
      }
    }
  }

  // ============================================================
  // 门 - 深色木门 + 把手
  // ============================================================
  private drawDoor(
    ctx: CanvasRenderingContext2D,
    cx: number, baseY: number,
    w: number, h: number, wallH: number,
    zoom: number, colors: typeof HOUSE_PALETTE[0],
  ): void {
    const doorW = w * 0.11
    const doorH = wallH * 0.35
    // 门画在右面墙的中心底部
    const doorX = cx + w * 0.2
    const doorBaseY = baseY + h * 0.2 // 门底部贴墙底
    const doorTopY = doorBaseY - doorH

    ctx.fillStyle = colors.roofDark
    ctx.fillRect(doorX - doorW / 2, doorTopY, doorW, doorH)

    // 门框
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'
    ctx.lineWidth = 0.8
    ctx.strokeRect(doorX - doorW / 2, doorTopY, doorW, doorH)

    // 门把手 (小圆点)
    ctx.fillStyle = '#D4A860'
    ctx.beginPath()
    ctx.arc(doorX + doorW * 0.2, doorBaseY - doorH * 0.4, 1 * zoom, 0, Math.PI * 2)
    ctx.fill()
  }

  // ============================================================
  // 屋顶 - 渐变人字形
  // ============================================================
  private drawRoof(
    ctx: CanvasRenderingContext2D,
    cx: number, baseY: number,
    w: number, h: number,
    wallH: number, roofH: number,
    colors: typeof HOUSE_PALETTE[0],
    isSelected: boolean,
  ): void {
    // 等轴测视角的屋顶: 从墙壁顶部延伸出人字形
    // 墙壁顶面四角
    const topUp = { x: cx, y: baseY - h / 2 - wallH }
    const topRight = { x: cx + w / 2, y: baseY - wallH }
    const topDown = { x: cx, y: baseY + h / 2 - wallH }
    const topLeft = { x: cx - w / 2, y: baseY - wallH }

    // 屋脊线 (沿前后方向, 提高 roofH)
    const ridgeFront = { x: cx, y: topUp.y - roofH }
    const ridgeBack = { x: cx, y: topDown.y - roofH }

    // --- 左侧坡面 (深色) ---
    ctx.beginPath()
    ctx.moveTo(topUp.x, topUp.y)
    ctx.lineTo(topLeft.x, topLeft.y)
    ctx.lineTo(topDown.x, topDown.y)
    ctx.lineTo(ridgeBack.x, ridgeBack.y)
    ctx.lineTo(ridgeFront.x, ridgeFront.y)
    ctx.closePath()

    // 渐变: 从屋脊(亮) → 边缘(暗)
    const leftGrad = ctx.createLinearGradient(cx, ridgeFront.y, topLeft.x, topLeft.y)
    leftGrad.addColorStop(0, colors.roof)
    leftGrad.addColorStop(1, colors.roofDark)
    ctx.fillStyle = leftGrad
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.1)'
    ctx.lineWidth = 1
    ctx.stroke()

    // --- 右侧坡面 (亮色) ---
    ctx.beginPath()
    ctx.moveTo(topUp.x, topUp.y)
    ctx.lineTo(topRight.x, topRight.y)
    ctx.lineTo(topDown.x, topDown.y)
    ctx.lineTo(ridgeBack.x, ridgeBack.y)
    ctx.lineTo(ridgeFront.x, ridgeFront.y)
    ctx.closePath()

    const rightGrad = ctx.createLinearGradient(cx, ridgeFront.y, topRight.x, topRight.y)
    rightGrad.addColorStop(0, colors.accent)
    rightGrad.addColorStop(1, colors.roof)
    ctx.fillStyle = rightGrad
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'
    ctx.lineWidth = 1
    ctx.stroke()

    // --- 屋脊线高光 ---
    ctx.beginPath()
    ctx.moveTo(ridgeFront.x, ridgeFront.y)
    ctx.lineTo(ridgeBack.x, ridgeBack.y)
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // 选中白色高光
    if (isSelected) {
      ctx.beginPath()
      ctx.moveTo(ridgeFront.x, ridgeFront.y)
      ctx.lineTo(topRight.x, topRight.y)
      ctx.lineTo(topDown.x, topDown.y)
      ctx.lineTo(ridgeBack.x, ridgeBack.y)
      ctx.closePath()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
      ctx.fill()
    }
  }

  // ============================================================
  // 烟囱 + 烟雾动画
  // ============================================================
  private drawChimney(
    ctx: CanvasRenderingContext2D,
    cx: number, baseY: number,
    w: number, _h: number,
    wallH: number, roofH: number,
    zoom: number,
    colors: typeof HOUSE_PALETTE[0],
    nexusId: string,
    timestamp: number,
  ): void {
    // 烟囱位置: 右坡面上方偏后
    const chimneyX = cx + w * 0.15
    const chimneyBaseY = baseY - wallH - roofH * 0.4
    const chimneyW = 4 * zoom
    const chimneyH = 8 * zoom

    // 烟囱主体
    ctx.fillStyle = colors.roofDark
    ctx.fillRect(chimneyX - chimneyW / 2, chimneyBaseY - chimneyH, chimneyW, chimneyH)

    // 烟囱顶部装饰线
    ctx.fillStyle = colors.roof
    ctx.fillRect(chimneyX - chimneyW / 2 - 1, chimneyBaseY - chimneyH, chimneyW + 2, 2 * zoom)

    // 烟雾粒子
    this.updateAndDrawSmoke(ctx, nexusId, chimneyX, chimneyBaseY - chimneyH, zoom, timestamp)
  }

  private updateAndDrawSmoke(
    ctx: CanvasRenderingContext2D,
    nexusId: string,
    x: number, y: number,
    zoom: number,
    timestamp: number,
  ): void {
    let particles = this.smokeMap.get(nexusId)
    if (!particles) {
      particles = []
      this.smokeMap.set(nexusId, particles)
    }

    // 每帧生成新烟雾 (约每 300ms 一个)
    const spawnRate = 300
    const shouldSpawn = particles.length === 0 ||
      (particles.length < 6 && timestamp % spawnRate < 20)

    if (shouldSpawn) {
      particles.push({
        x: x + (Math.random() - 0.5) * 2 * zoom,
        y,
        size: (1.5 + Math.random()) * zoom,
        opacity: 0.25 + Math.random() * 0.1,
        age: 0,
        maxAge: 1500 + Math.random() * 800,
        vx: (Math.random() - 0.3) * 0.15 * zoom,
        vy: -0.3 * zoom,
      })
    }

    // 更新和绘制
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]
      p.age += 16 // ~60fps
      p.x += p.vx
      p.y += p.vy
      p.vy *= 0.995 // 减速
      p.size += 0.02 * zoom // 膨胀

      const life = p.age / p.maxAge
      if (life >= 1) {
        particles.splice(i, 1)
        continue
      }

      // 渐隐
      const alpha = p.opacity * (1 - life * life)
      if (alpha < 0.01) continue

      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(200, 200, 210, ${alpha})`
      ctx.fill()
    }
  }

  // ============================================================
  // 标签
  // ============================================================
  private drawLabel(
    ctx: CanvasRenderingContext2D,
    nexus: NexusEntity,
    pos: Point,
    isSelected: boolean,
    _floatY: number,
    _totalH: number,
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
    const bgY = pos.y + 20

    ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.75)'
    ctx.beginPath()
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 4)
    ctx.fill()

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.fillStyle = isSelected ? '#1a1a2e' : '#333'
    ctx.fillText(label, pos.x, bgY + 3)
  }

  // ============================================================
  // 执行指示器
  // ============================================================
  private drawExecutionIndicator(
    ctx: CanvasRenderingContext2D,
    pos: Point,
    timestamp: number,
    nexus: NexusEntity,
    floatY: number,
    totalH: number,
  ): void {
    const glowColor = getGlowColor(nexus)
    const elapsed = timestamp - (this.executionStartTime || timestamp)
    const pulse = 0.5 + 0.5 * Math.sin(elapsed / 150)

    ctx.save()
    ctx.translate(pos.x, pos.y + floatY - totalH - 25)
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

  // ---- Utility ----

  private hexToRgb(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `${r}, ${g}, ${b}`
  }

  invalidateCache(nexusId: string): void {
    this.smokeMap.delete(nexusId)
  }

  clearCache(): void {
    this.smokeMap.clear()
  }

  dispose(): void {
    this.smokeMap.clear()
  }
}
