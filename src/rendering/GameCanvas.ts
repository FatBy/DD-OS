import type { NexusEntity, CameraState, RenderSettings } from '@/types'

// ============================================
// 常量 & 配置
// ============================================

const TILE_WIDTH = 128
const TILE_HEIGHT = 64

// 星球基础尺寸 (按等级 1-4)
const NEXUS_BASE_SIZE = [40, 56, 72, 90] as const

// Archetype → 星球视觉配置
const ARCHETYPE_PLANET_STYLE: Record<string, {
  ringCount: number       // 星环数量
  ringTilts: number[]     // 各环倾角
  textureType: 'bands' | 'core' | 'crystal' | 'storm'
  atmosphereScale: number // 大气层相对半径
}> = {
  MONOLITH: { ringCount: 2, ringTilts: [0.15, -0.3], textureType: 'bands', atmosphereScale: 1.6 },
  SPIRE:    { ringCount: 1, ringTilts: [0.5],         textureType: 'storm', atmosphereScale: 1.4 },
  REACTOR:  { ringCount: 3, ringTilts: [0, 0.5, -0.4], textureType: 'core', atmosphereScale: 1.8 },
  VAULT:    { ringCount: 1, ringTilts: [0.2],         textureType: 'crystal', atmosphereScale: 1.5 },
}

interface Particle {
  x: number; y: number
  size: number
  speedX: number; speedY: number
  opacity: number
}

// 能量核心状态 (由 WorldView 从 store 计算后传入)
interface EnergyCoreState {
  name: string            // identity.name → 颜色哈希种子
  skills: Array<{ id: string; active: boolean }>
  complexity: number      // 0-100
  activity: number        // 0-1
  turbulence: number      // 0-1
}

interface CoreParticle {
  id: string
  angle: number
  speed: number
  radiusX: number
  radiusY: number
  tilt: number
  color: string
  size: number
  alpha: number
  active: boolean
  yRatio: number  // 稳定的 Y 轴压扁比例
}

interface Ripple {
  x: number; y: number
  radius: number; alpha: number
}

interface RenderState {
  nexuses: Map<string, NexusEntity>
  camera: CameraState
  selectedNexusId: string | null
  renderSettings: RenderSettings
  energyCore?: EnergyCoreState
  // 执行状态
  executingNexusId?: string | null
  executionStartTime?: number | null
}

// 兼容类型定义
type BufferCanvas = HTMLCanvasElement | OffscreenCanvas
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// ============================================
// 辅助函数
// ============================================

function createBufferCanvas(w: number, h: number): BufferCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const oc = new OffscreenCanvas(w, h)
      const testCtx = oc.getContext('2d')
      if (testCtx) return oc
    } catch (_e) {
      console.warn('[GameCanvas] OffscreenCanvas fallback')
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

function getBufferContext(canvas: BufferCanvas): Ctx2D | null {
  return canvas.getContext('2d') as Ctx2D | null
}

// ============================================
// GameCanvas 渲染引擎 (行星版)
// ============================================

export class GameCanvas {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private dpr: number = 1
  private animFrameId = 0
  private nexusCache: Map<string, BufferCanvas> = new Map()
  private particles: Particle[] = []
  private _time = 0  // 全局时间（驱动呼吸光晕等动态效果）
  private coreParticles: CoreParticle[] = []
  private mousePos = { x: 0, y: 0 }
  private ripples: Ripple[] = []

  private state: RenderState = {
    nexuses: new Map(),
    camera: { x: 0, y: 0, zoom: 1 },
    selectedNexusId: null,
    renderSettings: { showGrid: true, showParticles: true, showLabels: true, enableGlow: true },
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get 2d context')
    this.ctx = ctx

    this.initBgParticles()
    this.resize()
    this.render = this.render.bind(this)
    this.animFrameId = requestAnimationFrame(this.render)
    console.log('[GameCanvas] Created (Planet Mode)')
  }

  // ---- Lifecycle ----

  resize(): void {
    this.dpr = window.devicePixelRatio || 1
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) return
    this.canvas.width = w * this.dpr
    this.canvas.height = h * this.dpr
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.nexusCache.clear() // 尺寸改变需重绘缓存
  }

  destroy(): void {
    cancelAnimationFrame(this.animFrameId)
    this.nexusCache.clear()
    this.coreParticles = []
    this.ripples = []
    console.log('[GameCanvas] Destroyed')
  }

  updateState(state: RenderState): void {
    const prevSkillCount = this.state.energyCore?.skills.length ?? -1
    const newSkillCount = state.energyCore?.skills.length ?? -1
    if (state.energyCore && prevSkillCount !== newSkillCount) {
      this.initCoreParticles(state.energyCore)
    }
    this.state = state
  }

  setMousePosition(x: number, y: number): void {
    this.mousePos = { x, y }
  }

  triggerRipple(x: number, y: number): void {
    if (this.ripples.length >= 10) return
    this.ripples.push({ x, y, radius: 0, alpha: 0.8 })
  }

  // ---- Coordinate Transforms (ISO) ----

  worldToScreen(gridX: number, gridY: number, camera: CameraState): { x: number; y: number } {
    const cx = this.canvas.clientWidth / 2
    const cy = this.canvas.clientHeight / 2
    const x = (gridX - gridY) * (TILE_WIDTH / 2) * camera.zoom + cx + camera.x * camera.zoom
    const y = (gridX + gridY) * (TILE_HEIGHT / 2) * camera.zoom + cy + camera.y * camera.zoom
    return { x, y }
  }

  screenToWorld(screenX: number, screenY: number, camera: CameraState): { gridX: number; gridY: number } {
    const cx = this.canvas.clientWidth / 2
    const cy = this.canvas.clientHeight / 2
    const sx = (screenX - cx - camera.x * camera.zoom) / camera.zoom
    const sy = (screenY - cy - camera.y * camera.zoom) / camera.zoom
    const gridX = (sx / (TILE_WIDTH / 2) + sy / (TILE_HEIGHT / 2)) / 2
    const gridY = (sy / (TILE_HEIGHT / 2) - sx / (TILE_WIDTH / 2)) / 2
    return { gridX, gridY }
  }

  // ---- 背景粒子 (星空) ----

  private initBgParticles(): void {
    for (let i = 0; i < 80; i++) {
      this.particles.push({
        x: Math.random() * 2000,
        y: Math.random() * 1200,
        size: Math.random() * 1.8 + 0.2,
        speedX: (Math.random() - 0.5) * 0.12,
        speedY: (Math.random() - 0.5) * 0.12,
        opacity: Math.random() * 0.6 + 0.1,
      })
    }
  }

  // ---- 主渲染循环 ----

  private _lastLogTime = 0

  private render(timestamp: number): void {
    this.animFrameId = requestAnimationFrame(this.render)
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) {
      if (timestamp - this._lastLogTime > 3000) {
        console.warn('[GameCanvas] Canvas size is 0')
        this._lastLogTime = timestamp
      }
      return
    }

    const ctx = this.ctx
    ctx.clearRect(0, 0, w, h)

    const { camera, nexuses, selectedNexusId, renderSettings } = this.state

    // Layer 0: Deep Space (星空背景)
    if (renderSettings.showParticles) {
      this.renderStarfield(ctx, w, h)
    }

    // Layer 1: Energy Core (能量核心 - 星空之上，网格之下)
    if (this.state.energyCore) {
      this.renderEnergyCore(ctx, w, h)
    }

    // Layer 2: ISO Grid
    if (renderSettings.showGrid) {
      this.renderIsoGrid(ctx, camera)
    }

    // Layer 3: Planet Nodes (排序确保正确遮挡)
    try {
      if (nexuses && nexuses.size > 0) {
        const sorted = [...nexuses.values()].sort(
          (a, b) => (a.position.gridX + a.position.gridY) - (b.position.gridX + b.position.gridY)
        )
        for (const nexus of sorted) {
          const screen = this.worldToScreen(nexus.position.gridX, nexus.position.gridY, camera)
          // 视锥剔除
          if (screen.x < -120 || screen.x > w + 120 || screen.y < -120 || screen.y > h + 120) continue
          const isSelected = nexus.id === selectedNexusId
          this.renderPlanetNode(ctx, nexus, screen.x, screen.y, isSelected, timestamp)
        }
      }
    } catch (e) {
      console.error('[GameCanvas] Planet render error:', e)
    }

    // Layer 4: Ripples (交互波纹 - 最顶层)
    this.updateRipples()
    if (this.ripples.length > 0) {
      this.renderRipples(ctx, w, h)
    }
  }

  // ---- Layer 1: 深空背景 (星空 + 氛围光晕 + 宇宙尘埃) ----

  private renderStarfield(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this._time += 0.002

    const cx = w / 2
    const cy = h / 2
    const time = this._time

    // A. 深空基底渐变 (深蓝→近黑，比纯黑更有层次)
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h)
    bgGrad.addColorStop(0, '#020617')  // Slate-950
    bgGrad.addColorStop(0.5, '#0a0f1e') // 深靛蓝
    bgGrad.addColorStop(1, '#060b18')
    ctx.fillStyle = bgGrad
    ctx.fillRect(0, 0, w, h)

    // B. 中心呼吸光晕 (模拟星系核心辐射，与 SoulOrb 同款效果)
    const pulse = Math.sin(time) * 0.08 + 1
    const maxDim = Math.max(w, h)
    const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxDim * 0.7 * pulse)
    glowGrad.addColorStop(0, `hsla(220, 60%, 12%, ${0.12 * pulse})`)
    glowGrad.addColorStop(0.4, `hsla(250, 50%, 8%, ${0.06 * pulse})`)
    glowGrad.addColorStop(1, 'transparent')
    ctx.fillStyle = glowGrad
    ctx.fillRect(0, 0, w, h)

    // C. 星空粒子 (原有逻辑增强：闪烁)
    for (const p of this.particles) {
      p.x += p.speedX
      p.y += p.speedY
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0
      if (p.y < 0) p.y = h; if (p.y > h) p.y = 0

      // 微弱闪烁效果
      const twinkle = Math.sin(time * 3 + p.x * 0.1 + p.y * 0.1) * 0.15 + 0.85
      ctx.globalAlpha = p.opacity * twinkle
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    // D. 漂浮星云尘埃 (大型半透明光斑，增加空间深度)
    for (let i = 0; i < 6; i++) {
      const nx = (Math.sin(i * 73.7 + time * 0.15) * 0.4 + 0.5) * w
      const ny = (Math.cos(i * 127.3 + time * 0.1) * 0.4 + 0.5) * h
      const nr = maxDim * (0.08 + Math.sin(time + i * 2) * 0.02)
      const alpha = (Math.sin(time * 0.8 + i * 1.5) + 1) * 0.01 + 0.005

      const nebulaGrad = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr)
      nebulaGrad.addColorStop(0, `hsla(${220 + i * 25}, 50%, 45%, ${alpha})`)
      nebulaGrad.addColorStop(1, 'transparent')
      ctx.fillStyle = nebulaGrad
      ctx.fillRect(nx - nr, ny - nr, nr * 2, nr * 2)
    }
  }

  // ---- Layer 2: 等轴网格 ----

  private renderIsoGrid(ctx: CanvasRenderingContext2D, camera: CameraState): void {
    ctx.save()
    ctx.lineWidth = 1
    const range = 10
    const centerX = this.canvas.clientWidth / 2
    const centerY = this.canvas.clientHeight / 2
    const maxDim = Math.max(this.canvas.clientWidth, this.canvas.clientHeight) * 0.5

    for (let i = -range; i <= range; i++) {
      const p1 = this.worldToScreen(-range, i, camera)
      const p2 = this.worldToScreen(range, i, camera)

      // 根据线段中点到屏幕中心的距离调整透明度（中心渐隐）
      const midX1 = (p1.x + p2.x) / 2
      const midY1 = (p1.y + p2.y) / 2
      const dist1 = Math.sqrt((midX1 - centerX) ** 2 + (midY1 - centerY) ** 2)
      const fade1 = Math.min(1, Math.max(0, (dist1 / maxDim - 0.2) / 0.6))

      ctx.strokeStyle = `rgba(80, 160, 255, ${0.04 * fade1})`
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke()

      const p3 = this.worldToScreen(i, -range, camera)
      const p4 = this.worldToScreen(i, range, camera)
      const midX2 = (p3.x + p4.x) / 2
      const midY2 = (p3.y + p4.y) / 2
      const dist2 = Math.sqrt((midX2 - centerX) ** 2 + (midY2 - centerY) ** 2)
      const fade2 = Math.min(1, Math.max(0, (dist2 / maxDim - 0.2) / 0.6))

      ctx.strokeStyle = `rgba(80, 160, 255, ${0.04 * fade2})`
      ctx.beginPath(); ctx.moveTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.stroke()
    }
    ctx.restore()
  }

  // ================================================================
  // 核心：星球节点渲染
  // ================================================================

  private renderPlanetNode(
    ctx: CanvasRenderingContext2D,
    nexus: NexusEntity,
    x: number, y: number,
    isSelected: boolean,
    timestamp: number,
  ): void {
    const zoom = this.state.camera.zoom
    const levelIdx = Math.min(nexus.level - 1, NEXUS_BASE_SIZE.length - 1)
    const baseSize = NEXUS_BASE_SIZE[levelIdx]
    const size = baseSize * zoom * (isSelected ? 1.08 : 1.0)
    const { primaryHue: hue, accentHue } = nexus.visualDNA

    // 建造中的星球 (全息投影效果)
    if (nexus.constructionProgress < 1) {
      this.renderPlanetConstruction(ctx, nexus, x, y, size, timestamp)
      return
    }

    // === 1. 绘制缓存的星球本体 ===
    const cacheKey = `planet_${nexus.id}_lv${nexus.level}_h${hue}`
    let cached = this.nexusCache.get(cacheKey)
    if (!cached) {
      cached = this.createPlanetCache(nexus, Math.round(baseSize * 2.5)) ?? undefined
      if (cached) this.nexusCache.set(cacheKey, cached)
    }
    if (cached) {
      const drawSize = size * 2.5 / 2 // 缓存含光晕，比球体大
      ctx.drawImage(cached as CanvasImageSource, x - drawSize, y - drawSize, drawSize * 2, drawSize * 2)
    }

    // === 2. 实时动画：卫星轨道 (绑定的 Skill) ===
    if (nexus.boundSkillId) {
      const orbitSpeed = 0.0015
      const angle = timestamp * orbitSpeed + nexus.position.gridX * 7
      const orbitRx = size * 0.7
      const orbitRy = orbitRx * 0.35 // 压扁做 ISO 透视

      // 轨道线 (半透明椭圆)
      ctx.beginPath()
      ctx.ellipse(x, y, orbitRx, orbitRy, 0, 0, Math.PI * 2)
      ctx.strokeStyle = `hsla(${accentHue}, 60%, 60%, 0.15)`
      ctx.lineWidth = 1
      ctx.stroke()

      // 卫星本体
      const satX = x + Math.cos(angle) * orbitRx
      const satY = y + Math.sin(angle) * orbitRy
      const satR = size * 0.1

      // 卫星光晕
      const satGlow = ctx.createRadialGradient(satX, satY, 0, satX, satY, satR * 3)
      satGlow.addColorStop(0, `hsla(${accentHue}, 90%, 75%, 0.4)`)
      satGlow.addColorStop(1, `hsla(${accentHue}, 90%, 75%, 0)`)
      ctx.fillStyle = satGlow
      ctx.beginPath()
      ctx.arc(satX, satY, satR * 3, 0, Math.PI * 2)
      ctx.fill()

      // 卫星核心
      ctx.fillStyle = `hsl(${accentHue}, 90%, 80%)`
      ctx.beginPath()
      ctx.arc(satX, satY, satR, 0, Math.PI * 2)
      ctx.fill()
    }

    // === 3. 选中效果 ===
    if (isSelected) {
      const pulse = Math.sin(timestamp / 400) * 0.3 + 0.7
      const ringR = size * 0.55

      // 呼吸光晕
      const selGlow = ctx.createRadialGradient(x, y, ringR * 0.5, x, y, ringR * 1.2)
      selGlow.addColorStop(0, `hsla(${hue}, 80%, 70%, ${0.08 * pulse})`)
      selGlow.addColorStop(1, `hsla(${hue}, 80%, 70%, 0)`)
      ctx.fillStyle = selGlow
      ctx.beginPath()
      ctx.arc(x, y, ringR * 1.2, 0, Math.PI * 2)
      ctx.fill()

      // 旋转虚线圆
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(timestamp / 3000)
      ctx.beginPath()
      ctx.arc(0, 0, ringR, 0, Math.PI * 2)
      ctx.strokeStyle = `hsla(50, 90%, 75%, ${0.5 * pulse})`
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 6])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    // === 4. 执行中动画 ===
    if (this.state.executingNexusId === nexus.id) {
      this.renderExecutionAnimation(ctx, nexus, x, y, size, timestamp)
    }

    // === 5. 标签 ===
    if (this.state.renderSettings.showLabels && nexus.label) {
      ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(200, 220, 255, 0.6)'
      ctx.font = `${isSelected ? 'bold ' : ''}${10 * zoom}px monospace`
      ctx.textAlign = 'center'
      ctx.fillText(nexus.label, x, y + size * 0.55 + 12 * zoom)
    }
  }

  // ---- 建造中的星球 (全息凝聚效果) ----

  private renderPlanetConstruction(
    ctx: CanvasRenderingContext2D,
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
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.strokeStyle = `hsla(${accentHue}, 70%, 70%, ${alpha})`
      ctx.lineWidth = 1
      ctx.setLineDash([3, 5])
      ctx.stroke()
      ctx.setLineDash([])

      // 旋转扫描弧
      const scanAngle = (timestamp / 500) % (Math.PI * 2)
      ctx.beginPath()
      ctx.arc(x, y, r, scanAngle, scanAngle + 0.8)
      ctx.strokeStyle = `hsla(${accentHue}, 90%, 80%, ${alpha * 0.8})`
      ctx.lineWidth = 2
      ctx.stroke()

    // 阶段 2 (0.33-0.66): 物质化填充
    } else if (progress < 0.66) {
      const fillRatio = (progress - 0.33) / 0.33
      // 轮廓
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.strokeStyle = `hsla(${accentHue}, 70%, 70%, 0.4)`
      ctx.lineWidth = 1
      ctx.stroke()

      // 从底部填充的裁剪
      ctx.save()
      ctx.beginPath()
      ctx.rect(x - r - 2, y + r - r * 2 * fillRatio, r * 2 + 4, r * 2 * fillRatio + 2)
      ctx.clip()

      const fillGrad = ctx.createRadialGradient(x, y, 0, x, y, r)
      fillGrad.addColorStop(0, `hsla(${hue}, ${sat}%, ${lit + 10}%, 0.5)`)
      fillGrad.addColorStop(1, `hsla(${hue}, ${sat}%, ${lit}%, 0.25)`)
      ctx.fillStyle = fillGrad
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

    // 阶段 3 (0.66-1): 凝固 + 闪光
    } else {
      const solidAlpha = 0.4 + (progress - 0.66) / 0.34 * 0.6
      const bodyGrad = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r)
      bodyGrad.addColorStop(0, `hsla(${hue}, ${sat}%, ${lit + 15}%, ${solidAlpha})`)
      bodyGrad.addColorStop(1, `hsla(${hue}, ${sat}%, ${lit - 10}%, ${solidAlpha * 0.7})`)
      ctx.fillStyle = bodyGrad
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()

      // 闪光结束
      if (progress > 0.95) {
        const flash = (progress - 0.95) / 0.05
        const flashR = r * (1 + flash * 0.5)
        ctx.beginPath()
        ctx.arc(x, y, flashR, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(255,255,255,${(1 - flash) * 0.5})`
        ctx.lineWidth = 2
        ctx.stroke()
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

      ctx.fillStyle = `hsla(${accentHue}, 85%, 80%, ${sparkAlpha})`
      ctx.beginPath()
      ctx.arc(sx, sy, 1.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ---- 执行中的动画效果 (脉冲光环 + 旋转能量弧) ----

  private renderExecutionAnimation(
    ctx: CanvasRenderingContext2D,
    nexus: NexusEntity,
    x: number, y: number,
    size: number,
    timestamp: number,
  ): void {
    const { primaryHue: hue, accentHue } = nexus.visualDNA
    const r = size * 0.5
    const executionTime = this.state.executionStartTime
      ? timestamp - this.state.executionStartTime
      : 0

    // 长时间执行警告 (>10秒 变黄色)
    const isWarning = executionTime > 10000
    const warningHue = isWarning ? 45 : hue // 黄色警告

    // === 1. 外层脉冲光环 (600ms 周期) ===
    const pulse = Math.sin(timestamp / 300) * 0.5 + 0.5 // 0-1 脉冲
    const pulseR = r * (1.3 + pulse * 0.3)
    const pulseAlpha = 0.3 + pulse * 0.3

    const pulseGlow = ctx.createRadialGradient(x, y, r * 0.8, x, y, pulseR)
    pulseGlow.addColorStop(0, `hsla(${warningHue}, 80%, 60%, ${pulseAlpha * 0.3})`)
    pulseGlow.addColorStop(0.5, `hsla(${warningHue}, 80%, 60%, ${pulseAlpha * 0.15})`)
    pulseGlow.addColorStop(1, `hsla(${warningHue}, 80%, 60%, 0)`)
    ctx.fillStyle = pulseGlow
    ctx.beginPath()
    ctx.arc(x, y, pulseR, 0, Math.PI * 2)
    ctx.fill()

    // === 2. 旋转能量弧 (3 条弧线，2000ms 周期) ===
    const rotationAngle = (timestamp / 2000) * Math.PI * 2
    const arcR = r * 1.15

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rotationAngle)

    for (let i = 0; i < 3; i++) {
      const arcStartAngle = (Math.PI * 2 / 3) * i
      const arcLength = Math.PI / 3 + Math.sin(timestamp / 400 + i) * 0.2

      ctx.beginPath()
      ctx.arc(0, 0, arcR, arcStartAngle, arcStartAngle + arcLength)
      ctx.strokeStyle = `hsla(${accentHue}, 90%, 70%, ${0.6 + Math.sin(timestamp / 200 + i) * 0.2})`
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.stroke()

      // 弧线末端小光点
      const endAngle = arcStartAngle + arcLength
      const dotX = Math.cos(endAngle) * arcR
      const dotY = Math.sin(endAngle) * arcR
      ctx.fillStyle = `hsla(${accentHue}, 95%, 80%, 0.9)`
      ctx.beginPath()
      ctx.arc(dotX, dotY, 3, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()

    // === 3. 中心微闪烁 ===
    const centerFlicker = Math.sin(timestamp / 100) * 0.1 + 0.2
    const centerGlow = ctx.createRadialGradient(x, y, 0, x, y, r * 0.4)
    centerGlow.addColorStop(0, `hsla(${warningHue}, 90%, 80%, ${centerFlicker})`)
    centerGlow.addColorStop(1, `hsla(${warningHue}, 90%, 80%, 0)`)
    ctx.fillStyle = centerGlow
    ctx.beginPath()
    ctx.arc(x, y, r * 0.4, 0, Math.PI * 2)
    ctx.fill()
  }

  // ================================================================
  // 缓存生成：绘制星球静态图层
  // ================================================================

  private createPlanetCache(nexus: NexusEntity, pxSize: number): BufferCanvas | null {
    try {
      const buffer = createBufferCanvas(pxSize * this.dpr, pxSize * this.dpr)
      const ctx = getBufferContext(buffer)
      if (!ctx) return null

      ctx.scale(this.dpr, this.dpr)

      const { primaryHue: h, primarySaturation: s, primaryLightness: l, accentHue: ah, glowIntensity } = nexus.visualDNA
      const style = ARCHETYPE_PLANET_STYLE[nexus.archetype] || ARCHETYPE_PLANET_STYLE.REACTOR
      const cx = pxSize / 2
      const cy = pxSize / 2
      const r = pxSize * 0.28 // 星球核心半径

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

      // --- 2. 星环 (在星球后面绘制下半部分) ---
      const ringsBehind = () => {
        for (let i = 0; i < style.ringCount; i++) {
          const ringR = r * (1.5 + i * 0.35)
          const tilt = style.ringTilts[i] || 0
          const alpha = 0.35 - i * 0.08

          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate(tilt)

          // 只画下半部分 (被星球遮挡的部分在后面)
          ctx.beginPath()
          ctx.ellipse(0, 0, ringR, ringR * 0.25, 0, 0, Math.PI)
          ctx.strokeStyle = `hsla(${ah}, 70%, 65%, ${alpha * 0.5})`
          ctx.lineWidth = 2 + (nexus.level >= 3 ? 1 : 0)
          ctx.stroke()

          ctx.restore()
        }
      }

      // --- 3. 星球本体 ---
      const drawPlanetBody = () => {
        // 球体渐变 (偏移高光模拟 3D)
        const body = ctx.createRadialGradient(
          cx - r * 0.3, cy - r * 0.25, 0,
          cx, cy, r
        )
        body.addColorStop(0, `hsl(${h}, ${Math.min(100, s + 10)}%, ${Math.min(90, l + 25)}%)`) // 高光
        body.addColorStop(0.35, `hsl(${h}, ${s}%, ${l + 8}%)`)
        body.addColorStop(0.7, `hsl(${h}, ${s}%, ${l}%)`)
        body.addColorStop(1, `hsl(${h}, ${s}%, ${Math.max(10, l - 20)}%)`) // 暗缘

        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = body
        ctx.fill()

        // 球面纹理 (根据 Archetype)
        ctx.save()
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.clip()

        if (style.textureType === 'bands') {
          // 气态巨行星条纹
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
          // 反应堆核心亮点
          const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.45)
          core.addColorStop(0, `hsla(${ah}, 95%, 90%, 0.4)`)
          core.addColorStop(1, `hsla(${ah}, 95%, 90%, 0)`)
          ctx.fillStyle = core
          ctx.beginPath()
          ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2)
          ctx.fill()
        } else if (style.textureType === 'crystal') {
          // 水晶切面线
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
          // 风暴漩涡
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

        // 球面高光弧 (玻璃反射)
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

      // --- 4. 星环前半部分 (覆盖在星球上面) ---
      const ringsFront = () => {
        for (let i = 0; i < style.ringCount; i++) {
          const ringR = r * (1.5 + i * 0.35)
          const tilt = style.ringTilts[i] || 0
          const alpha = 0.4 - i * 0.08

          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate(tilt)

          // 上半部分 (在星球前面)
          ctx.beginPath()
          ctx.ellipse(0, 0, ringR, ringR * 0.25, 0, Math.PI, Math.PI * 2)
          ctx.strokeStyle = `hsla(${ah}, 75%, 70%, ${alpha})`
          ctx.lineWidth = 2 + (nexus.level >= 3 ? 1 : 0)
          ctx.stroke()

          // 环上的小亮点
          if (nexus.level >= 2) {
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

      // --- 5. Level 4: 核心光晕 ---
      const drawCoreGlow = () => {
        if (nexus.level >= 4) {
          const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.5)
          glow.addColorStop(0, `hsla(${ah}, 95%, 90%, ${0.5 * glowIntensity})`)
          glow.addColorStop(1, `hsla(${ah}, 95%, 90%, 0)`)
          ctx.fillStyle = glow
          ctx.beginPath()
          ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // 按正确图层顺序绘制
      ringsBehind()
      drawPlanetBody()
      drawCoreGlow()
      ringsFront()

      return buffer
    } catch (e) {
      console.error('[GameCanvas] Planet cache creation failed:', e)
      return null
    }
  }

  // ---- 缓存管理 ----

  invalidateCache(nexusId: string): void {
    for (const key of this.nexusCache.keys()) {
      if (key.startsWith(`planet_${nexusId}`)) {
        this.nexusCache.delete(key)
      }
    }
  }

  clearCache(): void {
    this.nexusCache.clear()
  }

  // ================================================================
  // 能量核心渲染系统
  // ================================================================

  // 基于名字生成唯一配色方案 (移植自 SoulOrb.tsx)
  private getCoreColors(name: string): {
    core: string; glow: string; skillActive: string; skillInactive: string; hue: number
  } {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    const h = Math.abs(hash % 360)
    return {
      core: `hsla(${h}, 85%, 60%, 1)`,
      glow: `hsla(${h}, 90%, 70%, 0.5)`,
      skillActive: `hsla(${h}, 95%, 85%, 1)`,
      skillInactive: `hsla(${(h + 180) % 360}, 10%, 40%, 0.2)`,
      hue: h,
    }
  }

  // 初始化核心粒子 (每个技能 = 一个粒子)
  private initCoreParticles(core: EnergyCoreState): void {
    const colors = this.getCoreColors(core.name)

    const sourceData = core.skills.length > 0
      ? core.skills
      : Array.from({ length: 20 }, (_, i) => ({ id: `dummy-${i}`, active: Math.random() > 0.7 }))

    this.coreParticles = sourceData.map((skill, i) => ({
      id: skill.id,
      angle: (Math.PI * 2 * i) / (sourceData.length || 1),
      speed: (skill.active ? 0.008 : 0.003) * (Math.random() * 0.5 + 0.8),
      radiusX: 100,
      radiusY: 100,
      tilt: Math.random() * Math.PI * 2,
      color: skill.active ? colors.skillActive : colors.skillInactive,
      size: skill.active ? Math.random() * 2 + 1.5 : Math.random() + 0.5,
      alpha: skill.active ? 0.9 : 0.3,
      active: skill.active,
      yRatio: 0.6 + Math.random() * 0.3,
    }))
  }

  // 能量核心主渲染入口
  private renderEnergyCore(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const core = this.state.energyCore
    if (!core) return

    const colors = this.getCoreColors(core.name)
    const minDim = Math.min(w, h)
    const coreR = minDim * 0.16

    // 视差偏移
    const cx = w / 2 + this.mousePos.x * 15
    const cy = h / 2 + this.mousePos.y * 15

    const speedMult = 1 + core.activity * 2
    const time = this._time * speedMult

    // Layer A: 核心光晕 (呼吸效果) — 双层光晕增强视觉存在感
    const breath = Math.sin(time * 1.5) * 0.05 + 1

    // 外层大范围光晕
    const outerGlow = ctx.createRadialGradient(cx, cy, coreR * 0.3, cx, cy, coreR * 6 * breath)
    outerGlow.addColorStop(0, `hsla(${colors.hue}, 70%, 50%, 0.15)`)
    outerGlow.addColorStop(0.3, `hsla(${colors.hue}, 60%, 40%, 0.06)`)
    outerGlow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = outerGlow
    ctx.fillRect(0, 0, w, h)

    // 内层高亮光晕
    const innerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3 * breath)
    innerGlow.addColorStop(0, colors.glow)
    innerGlow.addColorStop(0.4, `hsla(${colors.hue}, 80%, 60%, 0.12)`)
    innerGlow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = innerGlow
    ctx.fillRect(0, 0, w, h)

    // Layer B: 核心本体 (Lissajous 纹路)
    this.renderCoreBody(ctx, cx, cy, coreR, colors, core, time)

    // Layer C: 技能粒子轨道
    this.renderCoreParticles(ctx, cx, cy, w, h, minDim, colors, core, speedMult)
  }

  // 核心本体: 黑色球体 + Lissajous 能量纹路
  private renderCoreBody(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, coreR: number,
    colors: ReturnType<GameCanvas['getCoreColors']>,
    core: EnergyCoreState,
    time: number,
  ): void {
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
    ctx.clip()

    // 背景深色球体
    const bgGrad = ctx.createRadialGradient(cx - coreR * 0.3, cy - coreR * 0.3, 0, cx, cy, coreR)
    bgGrad.addColorStop(0, 'hsla(0, 0%, 15%, 1)')
    bgGrad.addColorStop(1, 'hsla(0, 0%, 5%, 1)')
    ctx.fillStyle = bgGrad
    ctx.fill()

    // Lissajous 能量纹路
    const lineCount = 6 + Math.floor(core.complexity / 10)
    ctx.strokeStyle = colors.core
    ctx.lineWidth = 1.5
    ctx.globalAlpha = 0.5

    for (let i = 0; i < lineCount; i++) {
      ctx.beginPath()
      const phase = (i / lineCount) * Math.PI * 2

      for (let x = -coreR; x <= coreR; x += 2) {
        const turbMod = core.turbulence * Math.sin(time * 0.5 + x * 0.1) * 0.2
        const yBase = Math.sin(x / coreR * Math.PI + time + phase + turbMod) * (coreR * 0.4)
        const scale = Math.sqrt(Math.max(0, 1 - (x / coreR) ** 2))

        // 2D 旋转模拟球体自转
        const rot = time * 0.2
        const rx = x * Math.cos(rot) - yBase * scale * Math.sin(rot)
        const ry = x * Math.sin(rot) + yBase * scale * Math.cos(rot)

        if (x === -coreR) ctx.moveTo(cx + rx, cy + ry)
        else ctx.lineTo(cx + rx, cy + ry)
      }
      ctx.stroke()
    }

    ctx.globalAlpha = 1
    ctx.restore()

    // 球体边缘光晕 (增强轮廓感)
    const rimGlow = ctx.createRadialGradient(cx, cy, coreR * 0.85, cx, cy, coreR * 1.15)
    rimGlow.addColorStop(0, 'rgba(0,0,0,0)')
    rimGlow.addColorStop(0.5, `hsla(${colors.hue}, 80%, 60%, 0.25)`)
    rimGlow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = rimGlow
    ctx.beginPath()
    ctx.arc(cx, cy, coreR * 1.15, 0, Math.PI * 2)
    ctx.fill()
  }

  // 技能粒子: 3D 轨道投影
  private renderCoreParticles(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    w: number, h: number,
    minDim: number,
    colors: ReturnType<GameCanvas['getCoreColors']>,
    _core: EnergyCoreState,
    speedMult: number,
  ): void {
    const margin = 50

    for (const p of this.coreParticles) {
      p.angle += p.speed * speedMult

      // 动态轨道半径
      const baseR = minDim * (p.active ? 0.2 : 0.35)
      p.radiusX = baseR
      p.radiusY = baseR * p.yRatio

      // 3D 轨道坐标
      const ux = Math.cos(p.angle) * p.radiusX
      const uy = Math.sin(p.angle) * p.radiusY

      // 倾角旋转 -> 3D 投影
      const cosT = Math.cos(p.tilt)
      const sinT = Math.sin(p.tilt)
      const x = ux * cosT - uy * sinT
      const y = ux * sinT + uy * cosT
      const z = Math.sin(p.angle)

      const screenX = cx + x
      const screenY = cy + y

      // 视锥剔除
      if (screenX < -margin || screenX > w + margin ||
          screenY < -margin || screenY > h + margin) continue

      const pScale = 1 + z * 0.25
      const alpha = p.alpha * (0.6 + z * 0.4)

      // 绘制粒子
      ctx.beginPath()
      ctx.arc(screenX, screenY, p.size * pScale, 0, Math.PI * 2)
      ctx.fillStyle = p.color
      ctx.globalAlpha = Math.max(0.05, alpha)
      ctx.fill()

      // 低频能量连接线
      if (p.active && Math.random() > 0.99) {
        ctx.beginPath()
        ctx.moveTo(screenX, screenY)
        ctx.lineTo(cx, cy)
        ctx.strokeStyle = colors.skillActive
        ctx.lineWidth = 0.5
        ctx.globalAlpha = 0.3
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }

  // 波纹更新
  private updateRipples(): void {
    this.ripples = this.ripples.filter(r => {
      r.radius += 4
      r.alpha -= 0.015
      return r.alpha > 0
    })
  }

  // 波纹渲染
  private renderRipples(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    const colors = this.state.energyCore
      ? this.getCoreColors(this.state.energyCore.name)
      : null
    const strokeColor = colors ? `hsla(${colors.hue}, 80%, 70%,` : 'rgba(255, 255, 255,'

    for (const r of this.ripples) {
      ctx.beginPath()
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2)
      ctx.strokeStyle = `${strokeColor} ${r.alpha})`
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }
}
