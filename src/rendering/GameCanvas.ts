import type { NexusEntity, CameraState, RenderSettings } from '@/types'

// ============================================
// 常量
// ============================================

const TILE_WIDTH = 64
const TILE_HEIGHT = 32
const PARTICLE_COUNT = 60
const CONNECTION_RADIUS = 120

interface Particle {
  x: number
  y: number
  size: number
  speedX: number
  speedY: number
  opacity: number
}

interface RenderState {
  nexuses: Map<string, NexusEntity>
  camera: CameraState
  selectedNexusId: string | null
  renderSettings: RenderSettings
}

// 兼容类型定义
type BufferCanvas = HTMLCanvasElement | OffscreenCanvas
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// 建筑基础尺寸 (按等级)
const NEXUS_BASE_SIZE = [32, 48, 64, 80] as const

// ============================================
// 辅助函数：创建离屏缓冲 (OffscreenCanvas 降级兼容)
// ============================================

function createBufferCanvas(w: number, h: number): BufferCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const oc = new OffscreenCanvas(w, h)
      // 验证 2d 上下文可用
      const testCtx = oc.getContext('2d')
      if (testCtx) return oc
    } catch (_e) {
      console.warn('[GameCanvas] OffscreenCanvas not available, using fallback')
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
// GameCanvas 渲染引擎
// ============================================

export class GameCanvas {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private dpr: number = 1
  private animFrameId = 0
  private nexusCache: Map<string, BufferCanvas> = new Map()
  private particles: Particle[] = []

  // 当前渲染状态 (由 React 注入)
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

    this.initParticles()
    this.resize()
    this.render = this.render.bind(this)
    this.animFrameId = requestAnimationFrame(this.render)
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
  }

  destroy(): void {
    cancelAnimationFrame(this.animFrameId)
    this.nexusCache.clear()
  }

  updateState(state: RenderState): void {
    this.state = state
  }

  // ---- Coordinate Transforms ----

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

  // ---- 粒子初始化 ----

  private initParticles(): void {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.particles.push({
        x: Math.random() * 2000,
        y: Math.random() * 1200,
        size: Math.random() * 2 + 0.5,
        speedX: (Math.random() - 0.5) * 0.3,
        speedY: (Math.random() - 0.5) * 0.3,
        opacity: Math.random() * 0.5 + 0.1,
      })
    }
  }

  // ---- 主渲染循环 ----

  private render(timestamp: number): void {
    this.animFrameId = requestAnimationFrame(this.render)

    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) return

    const ctx = this.ctx
    ctx.clearRect(0, 0, w, h)

    const { camera, nexuses, selectedNexusId, renderSettings } = this.state

    // Layer 1: Background
    if (renderSettings.showParticles) {
      this.renderLayer1_Background(ctx, w, h)
    }

    // Layer 2: ISO Grid
    if (renderSettings.showGrid) {
      this.renderLayer2_IsoGrid(ctx, w, h, camera)
    }

    // Layer 3: Nexuses (try-catch 保护渲染循环)
    try {
      if (nexuses && nexuses.size > 0) {
        this.renderLayer3_Nexuses(ctx, w, h, nexuses, camera, selectedNexusId, timestamp)
      }
    } catch (e) {
      console.error('[GameCanvas] Layer 3 render error:', e)
    }

    // Layer 4: Effects
    if (renderSettings.enableGlow) {
      this.renderLayer4_Effects(ctx, w, h, nexuses, camera, timestamp)
    }
  }

  // ---- Layer 1: 背景粒子 ----

  private renderLayer1_Background(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    for (const p of this.particles) {
      p.x += p.speedX
      p.y += p.speedY
      if (p.x < 0) p.x = w
      if (p.x > w) p.x = 0
      if (p.y < 0) p.y = h
      if (p.y > h) p.y = 0

      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(100, 200, 255, ${p.opacity})`
      ctx.fill()
    }

    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const dx = this.particles[i].x - this.particles[j].x
        const dy = this.particles[i].y - this.particles[j].y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < CONNECTION_RADIUS) {
          ctx.beginPath()
          ctx.moveTo(this.particles[i].x, this.particles[i].y)
          ctx.lineTo(this.particles[j].x, this.particles[j].y)
          ctx.strokeStyle = `rgba(100, 200, 255, ${0.08 * (1 - dist / CONNECTION_RADIUS)})`
          ctx.lineWidth = 1
          ctx.stroke()
        }
      }
    }
  }

  // ---- Layer 2: 等轴网格 ----

  private renderLayer2_IsoGrid(ctx: CanvasRenderingContext2D, _w: number, _h: number, camera: CameraState): void {
    ctx.save()
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.12)'
    ctx.lineWidth = 1

    const gridRange = 12

    for (let i = -gridRange; i <= gridRange; i++) {
      const startH = this.worldToScreen(-gridRange, i, camera)
      const endH = this.worldToScreen(gridRange, i, camera)
      ctx.beginPath()
      ctx.moveTo(startH.x, startH.y)
      ctx.lineTo(endH.x, endH.y)
      ctx.stroke()

      const startV = this.worldToScreen(i, -gridRange, camera)
      const endV = this.worldToScreen(i, gridRange, camera)
      ctx.beginPath()
      ctx.moveTo(startV.x, startV.y)
      ctx.lineTo(endV.x, endV.y)
      ctx.stroke()
    }

    ctx.restore()
  }

  // ---- Layer 3: 建筑 ----

  private renderLayer3_Nexuses(
    ctx: CanvasRenderingContext2D,
    _w: number, _h: number,
    nexuses: Map<string, NexusEntity>,
    camera: CameraState,
    selectedId: string | null,
    timestamp: number,
  ): void {
    if (!nexuses || typeof nexuses.values !== 'function') return

    const sorted = [...nexuses.values()].sort(
      (a, b) => (a.position.gridX + a.position.gridY) - (b.position.gridX + b.position.gridY)
    )

    for (const nexus of sorted) {
      const screen = this.worldToScreen(nexus.position.gridX, nexus.position.gridY, camera)
      const isSelected = nexus.id === selectedId
      this.renderNexus(ctx, nexus, screen.x, screen.y, isSelected, timestamp)
    }
  }

  // ---- 单个建筑渲染 ----

  private renderNexus(
    ctx: CanvasRenderingContext2D,
    nexus: NexusEntity,
    screenX: number,
    screenY: number,
    isSelected: boolean,
    timestamp: number,
  ): void {
    const baseSize = NEXUS_BASE_SIZE[nexus.level - 1]
    const zoom = this.state.camera.zoom
    const size = baseSize * zoom
    const progress = nexus.constructionProgress

    ctx.save()
    ctx.translate(screenX, screenY)

    if (progress < 1) {
      this.renderConstruction(ctx, nexus, size, progress, timestamp)
    } else {
      const cacheKey = `${nexus.id}_lv${nexus.level}_done`
      let cached = this.nexusCache.get(cacheKey)
      if (!cached) {
        cached = this.createNexusCache(nexus, size)
        if (cached) {
          this.nexusCache.set(cacheKey, cached)
        }
      }
      if (cached) {
        const pad = 4
        const cw = size + pad * 2
        const ch = size + pad * 2
        ctx.drawImage(cached as CanvasImageSource, -cw / 2, -ch + pad, cw, ch)
      }
    }

    if (isSelected) {
      ctx.strokeStyle = 'rgba(255, 255, 100, 0.8)'
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      ctx.strokeRect(-size / 2 - 4, -size - 4, size + 8, size + 8)
      ctx.setLineDash([])
    }

    if (this.state.renderSettings.showLabels && nexus.label) {
      ctx.fillStyle = 'rgba(200, 220, 255, 0.8)'
      ctx.font = `${11 * zoom}px monospace`
      ctx.textAlign = 'center'
      ctx.fillText(nexus.label, 0, -size - 8)
    }

    ctx.restore()
  }

  // ---- 建造动画 (3 阶段) ----

  private renderConstruction(
    ctx: CanvasRenderingContext2D,
    nexus: NexusEntity,
    size: number,
    progress: number,
    _timestamp: number,
  ): void {
    const { primaryHue: hue, primarySaturation: sat, primaryLightness: lit } = nexus.visualDNA
    const w = size
    const h = size

    if (progress < 0.33) {
      const alpha = 0.3 + progress * 2
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${lit}%, ${alpha})`
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      this.drawArchetypeOutline(ctx, nexus.archetype, w, h)
      ctx.setLineDash([])
    } else if (progress < 0.66) {
      const fillRatio = (progress - 0.33) / 0.33
      ctx.save()
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${lit}%, 0.6)`
      ctx.lineWidth = 1
      this.drawArchetypeOutline(ctx, nexus.archetype, w, h)
      ctx.beginPath()
      ctx.rect(-w / 2, -h * fillRatio, w, h * fillRatio)
      ctx.clip()
      ctx.fillStyle = `hsla(${hue}, ${sat}%, ${lit}%, 0.4)`
      this.fillArchetypeShape(ctx, nexus.archetype, w, h)
      ctx.restore()
    } else {
      const solidAlpha = 0.4 + (progress - 0.66) / 0.34 * 0.6
      ctx.fillStyle = `hsla(${hue}, ${sat}%, ${lit}%, ${solidAlpha})`
      this.fillArchetypeShape(ctx, nexus.archetype, w, h)
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${lit + 20}%, ${solidAlpha})`
      ctx.lineWidth = 1
      this.drawArchetypeOutline(ctx, nexus.archetype, w, h)

      if (progress > 0.95) {
        const flash = (progress - 0.95) / 0.05
        ctx.fillStyle = `rgba(255, 255, 255, ${(1 - flash) * 0.3})`
        ctx.fillRect(-w / 2, -h, w, h)
      }
    }
  }

  // ---- Archetype 轮廓绘制 ----

  private drawArchetypeOutline(ctx: Ctx2D, archetype: string, w: number, h: number): void {
    switch (archetype) {
      case 'MONOLITH':
        ctx.strokeRect(-w / 2, -h, w, h)
        break
      case 'SPIRE':
        ctx.beginPath()
        ctx.moveTo(0, -h)
        ctx.lineTo(w / 2, 0)
        ctx.lineTo(-w / 2, 0)
        ctx.closePath()
        ctx.stroke()
        break
      case 'REACTOR':
        ctx.beginPath()
        ctx.arc(0, -h / 2, w / 2, 0, Math.PI * 2)
        ctx.stroke()
        break
      case 'VAULT':
        this.drawHexOutline(ctx, w, h)
        break
    }
  }

  private fillArchetypeShape(ctx: Ctx2D, archetype: string, w: number, h: number): void {
    switch (archetype) {
      case 'MONOLITH':
        ctx.fillRect(-w / 2, -h, w, h)
        break
      case 'SPIRE':
        ctx.beginPath()
        ctx.moveTo(0, -h)
        ctx.lineTo(w / 2, 0)
        ctx.lineTo(-w / 2, 0)
        ctx.closePath()
        ctx.fill()
        break
      case 'REACTOR':
        ctx.beginPath()
        ctx.arc(0, -h / 2, w / 2, 0, Math.PI * 2)
        ctx.fill()
        break
      case 'VAULT':
        this.fillHexShape(ctx, w, h)
        break
    }
  }

  private drawHexOutline(ctx: Ctx2D, w: number, h: number): void {
    const r = w / 2
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6
      const px = Math.cos(angle) * r
      const py = Math.sin(angle) * r - h / 2
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.stroke()
  }

  private fillHexShape(ctx: Ctx2D, w: number, h: number): void {
    const r = w / 2
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6
      const px = Math.cos(angle) * r
      const py = Math.sin(angle) * r - h / 2
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
  }

  // ---- 缓存创建 (兼容 OffscreenCanvas 降级) ----

  private createNexusCache(nexus: NexusEntity, size: number): BufferCanvas | null {
    const padding = 4
    const cw = size + padding * 2
    const ch = size + padding * 2

    try {
      const buffer = createBufferCanvas(cw * this.dpr, ch * this.dpr)
      const octx = getBufferContext(buffer)
      if (!octx) return null

      octx.scale(this.dpr, this.dpr)
      octx.translate(cw / 2, ch - padding)

      switch (nexus.archetype) {
        case 'MONOLITH':
          this.renderMonolith(octx, nexus, size, size)
          break
        case 'SPIRE':
          this.renderSpire(octx, nexus, size, size)
          break
        case 'REACTOR':
          this.renderReactor(octx, nexus, size, size)
          break
        case 'VAULT':
          this.renderVault(octx, nexus, size, size)
          break
      }

      return buffer
    } catch (e) {
      console.error('[GameCanvas] Cache creation failed:', e)
      return null
    }
  }

  // ---- MONOLITH: 堆叠方块 (知识) ----

  private renderMonolith(ctx: Ctx2D, nexus: NexusEntity, w: number, h: number): void {
    const { primaryHue: hue, primarySaturation: sat, primaryLightness: lit, accentHue } = nexus.visualDNA
    const blocks = nexus.level
    const blockH = h / 4
    const blockW = w * 0.8

    for (let i = 0; i < blocks; i++) {
      const y = -i * blockH
      const shade = lit - i * 5

      ctx.fillStyle = `hsl(${hue}, ${sat}%, ${shade}%)`
      ctx.fillRect(-blockW / 2, y - blockH, blockW, blockH * 0.9)

      ctx.fillStyle = `hsl(${hue}, ${sat}%, ${shade + 10}%)`
      ctx.fillRect(-blockW / 2, y - blockH, blockW, blockH * 0.15)

      ctx.strokeStyle = `hsl(${accentHue}, ${sat}%, ${lit + 15}%)`
      ctx.lineWidth = 1
      ctx.strokeRect(-blockW / 2, y - blockH, blockW, blockH * 0.9)
    }

    if (nexus.level >= 3) {
      ctx.shadowColor = `hsl(${hue}, ${sat}%, ${lit + 20}%)`
      ctx.shadowBlur = 8 * nexus.visualDNA.glowIntensity
      ctx.strokeStyle = `hsla(${accentHue}, 80%, 70%, 0.3)`
      ctx.lineWidth = 1
      ctx.strokeRect(-blockW / 2 - 2, -blocks * blockH - 2, blockW + 4, blocks * blockH + 2)
      ctx.shadowBlur = 0
    }
  }

  // ---- SPIRE: 塔尖 (推理) ----

  private renderSpire(ctx: Ctx2D, nexus: NexusEntity, w: number, h: number): void {
    const { primaryHue: hue, primarySaturation: sat, primaryLightness: lit, accentHue } = nexus.visualDNA
    const segments = nexus.level

    for (let i = 0; i < segments; i++) {
      const segH = h / (segments + 1)
      const baseWidth = w * (1 - i * 0.2) * 0.5
      const topWidth = w * (1 - (i + 1) * 0.2) * 0.5
      const y = -i * segH
      const shade = lit + i * 5

      ctx.beginPath()
      ctx.moveTo(-baseWidth, y)
      ctx.lineTo(baseWidth, y)
      ctx.lineTo(topWidth, y - segH)
      ctx.lineTo(-topWidth, y - segH)
      ctx.closePath()
      ctx.fillStyle = `hsl(${hue}, ${sat}%, ${shade}%)`
      ctx.fill()
      ctx.strokeStyle = `hsl(${accentHue}, ${sat}%, ${lit + 15}%)`
      ctx.lineWidth = 1
      ctx.stroke()
    }

    const tipY = -segments * (h / (segments + 1))
    const tipW = w * (1 - segments * 0.2) * 0.5
    ctx.beginPath()
    ctx.moveTo(-tipW, tipY)
    ctx.lineTo(0, tipY - h / (segments + 1))
    ctx.lineTo(tipW, tipY)
    ctx.closePath()
    ctx.fillStyle = `hsl(${accentHue}, ${sat + 10}%, ${lit + 10}%)`
    ctx.fill()

    if (nexus.level >= 3) {
      const antennaTop = tipY - h / (segments + 1) - 8
      ctx.beginPath()
      ctx.moveTo(0, tipY - h / (segments + 1))
      ctx.lineTo(0, antennaTop)
      ctx.strokeStyle = `hsl(${accentHue}, 80%, 70%)`
      ctx.lineWidth = 1.5
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(0, antennaTop, 2, 0, Math.PI * 2)
      ctx.fillStyle = `hsl(${accentHue}, 80%, 80%)`
      ctx.fill()
    }
  }

  // ---- REACTOR: 旋转球体 (执行) ----

  private renderReactor(ctx: Ctx2D, nexus: NexusEntity, w: number, h: number): void {
    const { primaryHue: hue, primarySaturation: sat, primaryLightness: lit, accentHue, glowIntensity } = nexus.visualDNA
    const r = w * 0.35
    const cy = -h / 2

    const gradient = ctx.createRadialGradient(0, cy, 0, 0, cy, r)
    gradient.addColorStop(0, `hsl(${hue}, ${sat}%, ${lit + 20}%)`)
    gradient.addColorStop(0.7, `hsl(${hue}, ${sat}%, ${lit}%)`)
    gradient.addColorStop(1, `hsl(${hue}, ${sat}%, ${lit - 10}%)`)

    ctx.beginPath()
    ctx.arc(0, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.fill()

    const rings = Math.min(nexus.level, 3)
    for (let i = 0; i < rings; i++) {
      const ringR = r + 6 + i * 6
      ctx.beginPath()
      ctx.ellipse(0, cy, ringR, ringR * 0.3, 0, 0, Math.PI * 2)
      ctx.strokeStyle = `hsla(${accentHue}, 80%, 70%, ${0.4 - i * 0.1})`
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    if (nexus.level >= 4) {
      ctx.beginPath()
      ctx.arc(0, cy, r * 0.3, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(${accentHue}, 90%, 85%, ${0.6 * glowIntensity})`
      ctx.fill()
    }
  }

  // ---- VAULT: 六角水晶 (记忆) ----

  private renderVault(ctx: Ctx2D, nexus: NexusEntity, w: number, h: number): void {
    const { primaryHue: hue, primarySaturation: sat, primaryLightness: lit, accentHue, glowIntensity } = nexus.visualDNA
    const r = w * 0.4
    const cy = -h / 2

    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6
      const px = Math.cos(angle) * r
      const py = Math.sin(angle) * r + cy
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${lit}%, 0.8)`
    ctx.fill()
    ctx.strokeStyle = `hsl(${accentHue}, ${sat}%, ${lit + 15}%)`
    ctx.lineWidth = 1.5
    ctx.stroke()

    if (nexus.level >= 2) {
      const innerR = r * 0.6
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6
        const px = Math.cos(angle) * innerR
        const py = Math.sin(angle) * innerR + cy
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.strokeStyle = `hsla(${accentHue}, 60%, 60%, 0.4)`
      ctx.lineWidth = 1
      ctx.stroke()
    }

    if (nexus.level >= 3) {
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6
        ctx.beginPath()
        ctx.moveTo(0, cy)
        ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r + cy)
        ctx.strokeStyle = `hsla(${accentHue}, 70%, 70%, 0.2)`
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }

    if (nexus.level >= 4) {
      const glowGradient = ctx.createRadialGradient(0, cy, 0, 0, cy, r * 0.5)
      glowGradient.addColorStop(0, `hsla(${accentHue}, 90%, 85%, ${0.5 * glowIntensity})`)
      glowGradient.addColorStop(1, `hsla(${accentHue}, 90%, 85%, 0)`)
      ctx.beginPath()
      ctx.arc(0, cy, r * 0.5, 0, Math.PI * 2)
      ctx.fillStyle = glowGradient
      ctx.fill()
    }
  }

  // ---- Layer 4: 效果层 ----

  private renderLayer4_Effects(
    ctx: CanvasRenderingContext2D,
    _w: number, _h: number,
    nexuses: Map<string, NexusEntity>,
    camera: CameraState,
    timestamp: number,
  ): void {
    const selectedId = this.state.selectedNexusId
    if (selectedId) {
      const nexus = nexuses.get(selectedId)
      if (nexus) {
        const screen = this.worldToScreen(nexus.position.gridX, nexus.position.gridY, camera)
        const baseSize = NEXUS_BASE_SIZE[nexus.level - 1] * camera.zoom
        const pulse = Math.sin(timestamp / 500) * 0.3 + 0.7

        ctx.save()
        ctx.globalAlpha = 0.15 * pulse
        ctx.fillStyle = `hsl(${nexus.visualDNA.primaryHue}, 80%, 70%)`
        ctx.beginPath()
        ctx.arc(screen.x, screen.y - baseSize / 2, baseSize * 0.8, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    for (const nexus of nexuses.values()) {
      if (nexus.constructionProgress < 1) {
        const screen = this.worldToScreen(nexus.position.gridX, nexus.position.gridY, camera)
        const baseSize = NEXUS_BASE_SIZE[nexus.level - 1] * camera.zoom
        const sparkCount = 3
        for (let i = 0; i < sparkCount; i++) {
          const sparkPhase = (timestamp / 300 + i * 2) % (Math.PI * 2)
          const sx = screen.x + Math.cos(sparkPhase) * baseSize * 0.5
          const sy = screen.y - baseSize * nexus.constructionProgress + Math.sin(sparkPhase) * 4
          ctx.beginPath()
          ctx.arc(sx, sy, 1.5, 0, Math.PI * 2)
          ctx.fillStyle = `hsla(${nexus.visualDNA.accentHue}, 80%, 80%, 0.6)`
          ctx.fill()
        }
      }
    }
  }

  // ---- 缓存管理 ----

  invalidateCache(nexusId: string): void {
    for (const key of this.nexusCache.keys()) {
      if (key.startsWith(nexusId)) {
        this.nexusCache.delete(key)
      }
    }
  }

  clearCache(): void {
    this.nexusCache.clear()
  }
}
