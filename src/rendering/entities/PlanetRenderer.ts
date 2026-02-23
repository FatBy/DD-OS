// ============================================
// 星球渲染器
// 渲染 Nexus 节点为星球形态
// ============================================

import type { NexusEntity } from '@/types'
import type { EntityRenderer, RenderContext, Point, PlanetStyle, BufferCanvas, Ctx2D } from '../types'
import { createBufferCanvas, getBufferContext, RenderCacheManager } from '../utils/cacheManager'

// 星球基础尺寸 (按等级 1-4)
const NEXUS_BASE_SIZE = [40, 56, 72, 90] as const

/**
 * 从 visualDNA 获取星球样式参数
 */
function getPlanetStyle(nexus: NexusEntity): PlanetStyle {
  const dna = nexus.visualDNA
  return {
    ringCount: dna?.ringCount ?? 2,
    ringTilts: dna?.ringTilts ?? [0.15, -0.3],
    textureType: dna?.planetTexture ?? 'bands',
    atmosphereScale: 1.4 + (dna?.glowIntensity ?? 0.5) * 0.6,  // 1.4 - 2.0 基于 glowIntensity
  }
}

export class PlanetRenderer implements EntityRenderer {
  readonly id = 'planet-renderer'
  
  private cacheManager: RenderCacheManager
  private executingNexusId: string | null = null
  private executionStartTime: number | null = null

  constructor() {
    this.cacheManager = new RenderCacheManager(50)
  }

  setDpr(dpr: number): void {
    this.cacheManager.setDpr(dpr)
  }

  setExecutionState(nexusId: string | null, startTime: number | null): void {
    this.executingNexusId = nexusId
    this.executionStartTime = startTime
  }

  canRender(_nexus: NexusEntity): boolean {
    return true // 所有 Nexus 都渲染为星球
  }

  render(
    ctx: RenderContext,
    nexus: NexusEntity,
    screenPos: Point,
    isSelected: boolean,
    timestamp: number,
  ): void {
    const { ctx: c, camera, palette } = ctx
    const zoom = camera.zoom
    const levelIdx = Math.min(nexus.level - 1, NEXUS_BASE_SIZE.length - 1)
    const baseSize = NEXUS_BASE_SIZE[levelIdx]
    const size = baseSize * zoom * (isSelected ? 1.08 : 1.0)
    const { primaryHue: hue, accentHue } = nexus.visualDNA
    const { x, y } = screenPos

    // 建造中的星球 (全息投影效果)
    if (nexus.constructionProgress < 1) {
      this.renderConstruction(c, nexus, x, y, size, timestamp)
      return
    }

    // === 1. 绘制缓存的星球本体 ===
    const cacheKey = `planet_${nexus.id}_lv${nexus.level}_h${hue}`
    let cached = this.cacheManager.get(cacheKey)
    if (!cached) {
      cached = this.createPlanetCache(nexus, Math.round(baseSize * 2.5)) ?? undefined
      if (cached) this.cacheManager.set(cacheKey, cached)
    }
    if (cached) {
      const drawSize = size * 2.5 / 2
      c.drawImage(cached as CanvasImageSource, x - drawSize, y - drawSize, drawSize * 2, drawSize * 2)
    }

    // === 2. 实时动画：卫星轨道 (绑定的 Skill) ===
    if (nexus.boundSkillId) {
      this.renderSatellite(c, nexus, x, y, size, timestamp, accentHue)
    }

    // === 3. 选中效果 ===
    if (isSelected) {
      this.renderSelection(c, x, y, size, hue, timestamp)
    }

    // === 4. 执行中动画 ===
    if (this.executingNexusId === nexus.id) {
      this.renderExecutionAnimation(c, nexus, x, y, size, timestamp)
    }

    // === 5. 标签 ===
    if (nexus.label) {
      c.fillStyle = isSelected ? palette.labelSelected : palette.labelDefault
      c.font = `${isSelected ? 'bold ' : ''}${10 * zoom}px monospace`
      c.textAlign = 'center'
      c.fillText(nexus.label, x, y + size * 0.55 + 12 * zoom)
    }
  }

  private renderSatellite(
    c: CanvasRenderingContext2D,
    nexus: NexusEntity,
    x: number, y: number,
    size: number,
    timestamp: number,
    accentHue: number,
  ): void {
    const orbitSpeed = 0.0015
    const angle = timestamp * orbitSpeed + nexus.position.gridX * 7
    const orbitRx = size * 0.7
    const orbitRy = orbitRx * 0.35

    // 轨道线
    c.beginPath()
    c.ellipse(x, y, orbitRx, orbitRy, 0, 0, Math.PI * 2)
    c.strokeStyle = `hsla(${accentHue}, 60%, 60%, 0.15)`
    c.lineWidth = 1
    c.stroke()

    // 卫星本体
    const satX = x + Math.cos(angle) * orbitRx
    const satY = y + Math.sin(angle) * orbitRy
    const satR = size * 0.1

    // 卫星光晕
    const satGlow = c.createRadialGradient(satX, satY, 0, satX, satY, satR * 3)
    satGlow.addColorStop(0, `hsla(${accentHue}, 90%, 75%, 0.4)`)
    satGlow.addColorStop(1, `hsla(${accentHue}, 90%, 75%, 0)`)
    c.fillStyle = satGlow
    c.beginPath()
    c.arc(satX, satY, satR * 3, 0, Math.PI * 2)
    c.fill()

    // 卫星核心
    c.fillStyle = `hsl(${accentHue}, 90%, 80%)`
    c.beginPath()
    c.arc(satX, satY, satR, 0, Math.PI * 2)
    c.fill()
  }

  private renderSelection(
    c: CanvasRenderingContext2D,
    x: number, y: number,
    size: number,
    hue: number,
    timestamp: number,
  ): void {
    const pulse = Math.sin(timestamp / 400) * 0.3 + 0.7
    const ringR = size * 0.55

    // 呼吸光晕
    const selGlow = c.createRadialGradient(x, y, ringR * 0.5, x, y, ringR * 1.2)
    selGlow.addColorStop(0, `hsla(${hue}, 80%, 70%, ${0.08 * pulse})`)
    selGlow.addColorStop(1, `hsla(${hue}, 80%, 70%, 0)`)
    c.fillStyle = selGlow
    c.beginPath()
    c.arc(x, y, ringR * 1.2, 0, Math.PI * 2)
    c.fill()

    // 旋转虚线圆
    c.save()
    c.translate(x, y)
    c.rotate(timestamp / 3000)
    c.beginPath()
    c.arc(0, 0, ringR, 0, Math.PI * 2)
    c.strokeStyle = `hsla(50, 90%, 75%, ${0.5 * pulse})`
    c.lineWidth = 1.5
    c.setLineDash([4, 6])
    c.stroke()
    c.setLineDash([])
    c.restore()
  }

  private renderConstruction(
    c: CanvasRenderingContext2D,
    nexus: NexusEntity,
    x: number, y: number,
    size: number,
    timestamp: number,
  ): void {
    const { primaryHue: hue, primarySaturation: sat, primaryLightness: lit, accentHue } = nexus.visualDNA
    const progress = nexus.constructionProgress
    const r = size * 0.4

    // 阶段 1 (0-0.33): 虚线轮廓 + 扫描线
    if (progress < 0.33) {
      const alpha = 0.15 + progress * 2
      c.beginPath()
      c.arc(x, y, r, 0, Math.PI * 2)
      c.strokeStyle = `hsla(${accentHue}, 70%, 70%, ${alpha})`
      c.lineWidth = 1
      c.setLineDash([3, 5])
      c.stroke()
      c.setLineDash([])

      const scanAngle = (timestamp / 500) % (Math.PI * 2)
      c.beginPath()
      c.arc(x, y, r, scanAngle, scanAngle + 0.8)
      c.strokeStyle = `hsla(${accentHue}, 90%, 80%, ${alpha * 0.8})`
      c.lineWidth = 2
      c.stroke()

    // 阶段 2 (0.33-0.66): 物质化填充
    } else if (progress < 0.66) {
      const fillRatio = (progress - 0.33) / 0.33
      c.beginPath()
      c.arc(x, y, r, 0, Math.PI * 2)
      c.strokeStyle = `hsla(${accentHue}, 70%, 70%, 0.4)`
      c.lineWidth = 1
      c.stroke()

      c.save()
      c.beginPath()
      c.rect(x - r - 2, y + r - r * 2 * fillRatio, r * 2 + 4, r * 2 * fillRatio + 2)
      c.clip()

      const fillGrad = c.createRadialGradient(x, y, 0, x, y, r)
      fillGrad.addColorStop(0, `hsla(${hue}, ${sat}%, ${lit + 10}%, 0.5)`)
      fillGrad.addColorStop(1, `hsla(${hue}, ${sat}%, ${lit}%, 0.25)`)
      c.fillStyle = fillGrad
      c.beginPath()
      c.arc(x, y, r, 0, Math.PI * 2)
      c.fill()
      c.restore()

    // 阶段 3 (0.66-1): 凝固 + 闪光
    } else {
      const solidAlpha = 0.4 + (progress - 0.66) / 0.34 * 0.6
      const bodyGrad = c.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r)
      bodyGrad.addColorStop(0, `hsla(${hue}, ${sat}%, ${lit + 15}%, ${solidAlpha})`)
      bodyGrad.addColorStop(1, `hsla(${hue}, ${sat}%, ${lit - 10}%, ${solidAlpha * 0.7})`)
      c.fillStyle = bodyGrad
      c.beginPath()
      c.arc(x, y, r, 0, Math.PI * 2)
      c.fill()

      if (progress > 0.95) {
        const flash = (progress - 0.95) / 0.05
        const flashR = r * (1 + flash * 0.5)
        c.beginPath()
        c.arc(x, y, flashR, 0, Math.PI * 2)
        c.strokeStyle = `rgba(255,255,255,${(1 - flash) * 0.5})`
        c.lineWidth = 2
        c.stroke()
      }
    }

    // 建造火花
    const sparkCount = 3 + nexus.level
    for (let i = 0; i < sparkCount; i++) {
      const phase = (timestamp / 300 + i * 1.5) % (Math.PI * 2)
      const sparkDist = r * (0.8 + Math.sin(phase) * 0.4)
      const sparkAngle = phase * 2.3 + i
      const sx = x + Math.cos(sparkAngle) * sparkDist
      const sy = y + Math.sin(sparkAngle) * sparkDist
      const sparkAlpha = (1 - progress) * 0.6

      c.fillStyle = `hsla(${accentHue}, 85%, 80%, ${sparkAlpha})`
      c.beginPath()
      c.arc(sx, sy, 1.2, 0, Math.PI * 2)
      c.fill()
    }
  }

  private renderExecutionAnimation(
    c: CanvasRenderingContext2D,
    nexus: NexusEntity,
    x: number, y: number,
    size: number,
    timestamp: number,
  ): void {
    const { primaryHue: hue, accentHue } = nexus.visualDNA
    const r = size * 0.5
    const executionTime = this.executionStartTime
      ? timestamp - this.executionStartTime
      : 0

    const isWarning = executionTime > 10000
    const warningHue = isWarning ? 45 : hue

    // === 1. 外层脉冲光环 ===
    const pulse = Math.sin(timestamp / 300) * 0.5 + 0.5
    const pulseR = r * (1.3 + pulse * 0.3)
    const pulseAlpha = 0.3 + pulse * 0.3

    const pulseGlow = c.createRadialGradient(x, y, r * 0.8, x, y, pulseR)
    pulseGlow.addColorStop(0, `hsla(${warningHue}, 80%, 60%, ${pulseAlpha * 0.3})`)
    pulseGlow.addColorStop(0.5, `hsla(${warningHue}, 80%, 60%, ${pulseAlpha * 0.15})`)
    pulseGlow.addColorStop(1, `hsla(${warningHue}, 80%, 60%, 0)`)
    c.fillStyle = pulseGlow
    c.beginPath()
    c.arc(x, y, pulseR, 0, Math.PI * 2)
    c.fill()

    // === 2. 旋转能量弧 ===
    const rotationAngle = (timestamp / 2000) * Math.PI * 2
    const arcR = r * 1.15

    c.save()
    c.translate(x, y)
    c.rotate(rotationAngle)

    for (let i = 0; i < 3; i++) {
      const arcStartAngle = (Math.PI * 2 / 3) * i
      const arcLength = Math.PI / 3 + Math.sin(timestamp / 400 + i) * 0.2

      c.beginPath()
      c.arc(0, 0, arcR, arcStartAngle, arcStartAngle + arcLength)
      c.strokeStyle = `hsla(${accentHue}, 90%, 70%, ${0.6 + Math.sin(timestamp / 200 + i) * 0.2})`
      c.lineWidth = 2
      c.lineCap = 'round'
      c.stroke()

      const endAngle = arcStartAngle + arcLength
      const dotX = Math.cos(endAngle) * arcR
      const dotY = Math.sin(endAngle) * arcR
      c.fillStyle = `hsla(${accentHue}, 95%, 80%, 0.9)`
      c.beginPath()
      c.arc(dotX, dotY, 3, 0, Math.PI * 2)
      c.fill()
    }

    c.restore()

    // === 3. 中心微闪烁 ===
    const centerFlicker = Math.sin(timestamp / 100) * 0.1 + 0.2
    const centerGlow = c.createRadialGradient(x, y, 0, x, y, r * 0.4)
    centerGlow.addColorStop(0, `hsla(${warningHue}, 90%, 80%, ${centerFlicker})`)
    centerGlow.addColorStop(1, `hsla(${warningHue}, 90%, 80%, 0)`)
    c.fillStyle = centerGlow
    c.beginPath()
    c.arc(x, y, r * 0.4, 0, Math.PI * 2)
    c.fill()
  }

  private createPlanetCache(nexus: NexusEntity, pxSize: number): BufferCanvas | null {
    const dpr = this.cacheManager.getDpr()
    
    try {
      const buffer = createBufferCanvas(pxSize * dpr, pxSize * dpr)
      const ctx = getBufferContext(buffer)
      if (!ctx) return null

      ctx.scale(dpr, dpr)

      const { primaryHue: h, primarySaturation: s, primaryLightness: l, accentHue: ah, glowIntensity } = nexus.visualDNA
      const style = getPlanetStyle(nexus)
      const cx = pxSize / 2
      const cy = pxSize / 2
      const r = pxSize * 0.28

      // --- 1. 大气层光晕 ---
      const atmoR = r * style.atmosphereScale
      const atmo = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, atmoR)
      atmo.addColorStop(0, `hsla(${h}, ${s}%, ${l}%, 0.2)`)
      atmo.addColorStop(0.6, `hsla(${h}, ${s}%, ${l}%, 0.06)`)
      atmo.addColorStop(1, `hsla(${h}, ${s}%, ${l}%, 0)`)
      ctx.fillStyle = atmo
      ctx.beginPath()
      ctx.arc(cx, cy, atmoR, 0, Math.PI * 2)
      ctx.fill()

      // --- 2. 星环 (后面) ---
      this.drawRingsBehind(ctx, cx, cy, r, style, ah, nexus.level)
      
      // --- 3. 星球本体 ---
      this.drawPlanetBody(ctx, cx, cy, r, h, s, l, ah, style)
      
      // --- 4. Level 4 核心光晕 ---
      if (nexus.level >= 4) {
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.5)
        glow.addColorStop(0, `hsla(${ah}, 95%, 90%, ${0.5 * glowIntensity})`)
        glow.addColorStop(1, `hsla(${ah}, 95%, 90%, 0)`)
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2)
        ctx.fill()
      }
      
      // --- 5. 星环 (前面) ---
      this.drawRingsFront(ctx, cx, cy, r, style, ah, nexus.level)

      return buffer
    } catch (e) {
      console.error('[PlanetRenderer] Cache creation failed:', e)
      return null
    }
  }

  private drawRingsBehind(
    ctx: Ctx2D,
    cx: number, cy: number, r: number,
    style: PlanetStyle,
    ah: number,
    level: number,
  ): void {
    for (let i = 0; i < style.ringCount; i++) {
      const ringR = r * (1.5 + i * 0.35)
      const tilt = style.ringTilts[i] || 0
      const alpha = 0.35 - i * 0.08

      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(tilt)

      ctx.beginPath()
      ctx.ellipse(0, 0, ringR, ringR * 0.25, 0, 0, Math.PI)
      ctx.strokeStyle = `hsla(${ah}, 70%, 65%, ${alpha * 0.5})`
      ctx.lineWidth = 2 + (level >= 3 ? 1 : 0)
      ctx.stroke()

      ctx.restore()
    }
  }

  private drawRingsFront(
    ctx: Ctx2D,
    cx: number, cy: number, r: number,
    style: PlanetStyle,
    ah: number,
    level: number,
  ): void {
    for (let i = 0; i < style.ringCount; i++) {
      const ringR = r * (1.5 + i * 0.35)
      const tilt = style.ringTilts[i] || 0
      const alpha = 0.4 - i * 0.08

      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(tilt)

      ctx.beginPath()
      ctx.ellipse(0, 0, ringR, ringR * 0.25, 0, Math.PI, Math.PI * 2)
      ctx.strokeStyle = `hsla(${ah}, 75%, 70%, ${alpha})`
      ctx.lineWidth = 2 + (level >= 3 ? 1 : 0)
      ctx.stroke()

      if (level >= 2) {
        const dotCount = 3 + i * 2
        for (let j = 0; j < dotCount; j++) {
          const dotAngle = Math.PI + (Math.PI * j) / dotCount
          const dx = Math.cos(dotAngle) * ringR
          const dy = Math.sin(dotAngle) * ringR * 0.25
          ctx.fillStyle = `hsla(${ah}, 90%, 80%, ${alpha * 0.5})`
          ctx.beginPath()
          ctx.arc(dx, dy, 1, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      ctx.restore()
    }
  }

  private drawPlanetBody(
    ctx: Ctx2D,
    cx: number, cy: number, r: number,
    h: number, s: number, l: number,
    ah: number,
    style: PlanetStyle,
  ): void {
    // 球体渐变
    const body = ctx.createRadialGradient(
      cx - r * 0.3, cy - r * 0.25, 0,
      cx, cy, r
    )
    body.addColorStop(0, `hsl(${h}, ${Math.min(100, s + 10)}%, ${Math.min(90, l + 25)}%)`)
    body.addColorStop(0.35, `hsl(${h}, ${s}%, ${l + 8}%)`)
    body.addColorStop(0.7, `hsl(${h}, ${s}%, ${l}%)`)
    body.addColorStop(1, `hsl(${h}, ${s}%, ${Math.max(10, l - 20)}%)`)

    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = body
    ctx.fill()

    // 球面纹理
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.clip()

    if (style.textureType === 'bands') {
      ctx.globalCompositeOperation = 'overlay'
      for (let i = 0; i < 4; i++) {
        const bandY = cy - r * 0.6 + i * r * 0.35
        const bandH = r * 0.12
        ctx.fillStyle = `hsla(${(h + 20) % 360}, ${s - 10}%, ${l - 5}%, 0.25)`
        ctx.beginPath()
        ctx.ellipse(cx, bandY, r * 0.95, bandH, 0.08 * i, 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (style.textureType === 'core') {
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.45)
      core.addColorStop(0, `hsla(${ah}, 95%, 90%, 0.4)`)
      core.addColorStop(1, `hsla(${ah}, 95%, 90%, 0)`)
      ctx.fillStyle = core
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2)
      ctx.fill()
    } else if (style.textureType === 'crystal') {
      ctx.strokeStyle = `hsla(${ah}, 60%, 70%, 0.2)`
      ctx.lineWidth = 0.8
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r)
        ctx.stroke()
      }
    } else if (style.textureType === 'storm') {
      ctx.globalCompositeOperation = 'overlay'
      const stormGrad = ctx.createRadialGradient(cx + r * 0.15, cy + r * 0.1, 0, cx, cy, r * 0.6)
      stormGrad.addColorStop(0, `hsla(${(h + 30) % 360}, ${s}%, ${l + 15}%, 0.3)`)
      stormGrad.addColorStop(1, `hsla(${h}, ${s}%, ${l}%, 0)`)
      ctx.fillStyle = stormGrad
      ctx.beginPath()
      ctx.arc(cx + r * 0.15, cy + r * 0.1, r * 0.6, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
    ctx.globalCompositeOperation = 'source-over'

    // 球面高光弧
    ctx.beginPath()
    ctx.ellipse(cx - r * 0.2, cy - r * 0.3, r * 0.3, r * 0.1, -0.3, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
    ctx.fill()

    // 球体边缘描边
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = `hsla(${ah}, 50%, 50%, 0.2)`
    ctx.lineWidth = 0.8
    ctx.stroke()
  }

  getCache(nexus: NexusEntity): BufferCanvas | null {
    const { primaryHue: hue } = nexus.visualDNA
    const cacheKey = `planet_${nexus.id}_lv${nexus.level}_h${hue}`
    return this.cacheManager.get(cacheKey) ?? null
  }

  invalidateCache(nexusId: string): void {
    this.cacheManager.invalidate(nexusId)
  }

  clearCache(): void {
    this.cacheManager.clear()
  }

  dispose(): void {
    this.cacheManager.clear()
  }
}
