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
    console.log('[GameCanvas] Created. Canvas size:', canvas.clientWidth, 'x', canvas.clientHeight)
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
    console.log('[GameCanvas] Destroyed')
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

  private _lastLogTime = 0

  private render(timestamp: number): void {
    this.animFrameId = requestAnimationFrame(this.render)

    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w === 0 || h === 0) {
      if (timestamp - this._lastLogTime > 3000) {
        console.warn('[GameCanvas] Canvas size is 0:', w, 'x', h)
        this._lastLogTime = timestamp
      }
      return
    }

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

  // ---- 建造动画 (3 阶段 - 全息投影风格) ----

  private renderConstruction(
    ctx: CanvasRenderingContext2D,
    nexus: NexusEntity,
    size: number,
    progress: number,
    _timestamp: number,
  ): void {
    const { primaryHue: hue, primarySaturation: sat, primaryLightness: lit, accentHue } = nexus.visualDNA
    const w = size
    const h = size

    if (progress < 0.33) {
      // Stage 1: 全息蓝图 (虚线轮廓闪烁)
      const alpha = 0.15 + progress * 1.5
      ctx.strokeStyle = `hsla(${accentHue}, 70%, 70%, ${alpha})`
      ctx.lineWidth = 1
      ctx.setLineDash([2, 4])
      this.drawArchetypeOutline(ctx, nexus.archetype, w, h)
      ctx.setLineDash([])

      // 扫描线
      const scanY = -h * (progress / 0.33)
      const scanGrad = ctx.createLinearGradient(-w / 2, scanY, w / 2, scanY)
      scanGrad.addColorStop(0, `hsla(${accentHue}, 90%, 80%, 0)`)
      scanGrad.addColorStop(0.5, `hsla(${accentHue}, 90%, 80%, ${alpha * 0.5})`)
      scanGrad.addColorStop(1, `hsla(${accentHue}, 90%, 80%, 0)`)
      ctx.strokeStyle = scanGrad
      ctx.lineWidth = 1.5
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(-w / 2, scanY)
      ctx.lineTo(w / 2, scanY)
      ctx.stroke()

    } else if (progress < 0.66) {
      // Stage 2: 从底部物质化填充
      const fillRatio = (progress - 0.33) / 0.33
      
      // 轮廓保持可见
      ctx.strokeStyle = `hsla(${accentHue}, 70%, 70%, 0.4)`
      ctx.lineWidth = 1
      this.drawArchetypeOutline(ctx, nexus.archetype, w, h)

      // 裁剪区域从底部填充
      ctx.save()
      ctx.beginPath()
      ctx.rect(-w / 2 - 4, -h * fillRatio, w + 8, h * fillRatio + 4)
      ctx.clip()

      // 半透明填充 (带能量感渐变)
      const fillGrad = ctx.createLinearGradient(0, 0, 0, -h)
      fillGrad.addColorStop(0, `hsla(${hue}, ${sat}%, ${lit}%, 0.5)`)
      fillGrad.addColorStop(1, `hsla(${hue}, ${sat}%, ${lit + 10}%, 0.2)`)
      ctx.fillStyle = fillGrad
      this.fillArchetypeShape(ctx, nexus.archetype, w, h)

      ctx.restore()

      // 填充边缘光线
      const edgeY = -h * fillRatio
      const edgeGrad = ctx.createLinearGradient(-w / 2, edgeY, w / 2, edgeY)
      edgeGrad.addColorStop(0, `hsla(${accentHue}, 90%, 80%, 0)`)
      edgeGrad.addColorStop(0.5, `hsla(${accentHue}, 90%, 80%, 0.6)`)
      edgeGrad.addColorStop(1, `hsla(${accentHue}, 90%, 80%, 0)`)
      ctx.strokeStyle = edgeGrad
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(-w / 2, edgeY)
      ctx.lineTo(w / 2, edgeY)
      ctx.stroke()

    } else {
      // Stage 3: 完全凝固 + 闪光结束
      const solidAlpha = 0.5 + (progress - 0.66) / 0.34 * 0.5

      const bodyGrad = ctx.createLinearGradient(0, 0, 0, -h)
      bodyGrad.addColorStop(0, `hsla(${hue}, ${sat}%, ${lit - 5}%, ${solidAlpha})`)
      bodyGrad.addColorStop(1, `hsla(${hue}, ${sat}%, ${lit + 5}%, ${solidAlpha * 0.8})`)
      ctx.fillStyle = bodyGrad
      this.fillArchetypeShape(ctx, nexus.archetype, w, h)

      ctx.strokeStyle = `hsla(${accentHue}, ${sat}%, ${lit + 20}%, ${solidAlpha * 0.7})`
      ctx.lineWidth = 1
      this.drawArchetypeOutline(ctx, nexus.archetype, w, h)

      // 完成闪光 (最后 5%)
      if (progress > 0.95) {
        const flash = (progress - 0.95) / 0.05
        const flashAlpha = (1 - flash) * 0.5
        ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`
        ctx.fillRect(-w / 2 - 2, -h - 2, w + 4, h + 4)

        // 四角能量爆发
        const burstR = w * 0.3 * flash
        ctx.strokeStyle = `hsla(${accentHue}, 90%, 85%, ${flashAlpha})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(0, -h / 2, burstR, 0, Math.PI * 2)
        ctx.stroke()
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

  // ---- MONOLITH: 全息数据块堆叠 (知识) ----

  private renderMonolith(ctx: Ctx2D, nexus: NexusEntity, w: number, h: number): void {
    const { primaryHue: hue, primarySaturation: sat, primaryLightness: lit, accentHue, glowIntensity } = nexus.visualDNA
    const blocks = nexus.level
    const blockH = h / 4
    const blockW = w * 0.8
    const gap = 2 // 块间间距

    // 底部投影光晕
    const baseGlow = ctx.createRadialGradient(0, 2, 0, 0, 2, blockW * 0.7)
    baseGlow.addColorStop(0, `hsla(${hue}, ${sat}%, ${lit}%, 0.15)`)
    baseGlow.addColorStop(1, `hsla(${hue}, ${sat}%, ${lit}%, 0)`)
    ctx.fillStyle = baseGlow
    ctx.fillRect(-blockW, -4, blockW * 2, 8)

    for (let i = 0; i < blocks; i++) {
      const y = -i * (blockH + gap)
      const shade = lit - i * 3
      const bh = blockH * 0.88

      // 块体渐变填充 (底深顶亮，模拟光照)
      const blockGrad = ctx.createLinearGradient(0, y, 0, y - bh)
      blockGrad.addColorStop(0, `hsla(${hue}, ${sat}%, ${shade - 8}%, 0.9)`)
      blockGrad.addColorStop(0.5, `hsla(${hue}, ${sat}%, ${shade}%, 0.85)`)
      blockGrad.addColorStop(1, `hsla(${hue}, ${sat}%, ${shade + 5}%, 0.8)`)
      ctx.fillStyle = blockGrad
      ctx.fillRect(-blockW / 2, y - bh, blockW, bh)

      // 顶部高亮条 (全息扫描线感)
      const topGrad = ctx.createLinearGradient(-blockW / 2, 0, blockW / 2, 0)
      topGrad.addColorStop(0, `hsla(${accentHue}, 90%, 80%, 0)`)
      topGrad.addColorStop(0.3, `hsla(${accentHue}, 90%, 80%, 0.5)`)
      topGrad.addColorStop(0.7, `hsla(${accentHue}, 90%, 80%, 0.5)`)
      topGrad.addColorStop(1, `hsla(${accentHue}, 90%, 80%, 0)`)
      ctx.fillStyle = topGrad
      ctx.fillRect(-blockW / 2, y - bh, blockW, bh * 0.12)

      // 内部电路纹路 (水平细线)
      ctx.strokeStyle = `hsla(${accentHue}, 70%, 70%, 0.15)`
      ctx.lineWidth = 0.5
      const lineCount = 2 + i
      for (let j = 1; j <= lineCount; j++) {
        const ly = y - bh * (j / (lineCount + 1))
        ctx.beginPath()
        ctx.moveTo(-blockW / 2 + 3, ly)
        ctx.lineTo(blockW / 2 - 3, ly)
        ctx.stroke()
      }

      // 边框 (上亮下暗)
      ctx.strokeStyle = `hsla(${accentHue}, ${sat}%, ${lit + 20}%, 0.6)`
      ctx.lineWidth = 1
      ctx.strokeRect(-blockW / 2, y - bh, blockW, bh)

      // 左侧面 (等轴伪 3D)
      ctx.fillStyle = `hsla(${hue}, ${sat}%, ${shade - 12}%, 0.5)`
      ctx.beginPath()
      ctx.moveTo(-blockW / 2, y)
      ctx.lineTo(-blockW / 2, y - bh)
      ctx.lineTo(-blockW / 2 - 4, y - bh + 3)
      ctx.lineTo(-blockW / 2 - 4, y + 3)
      ctx.closePath()
      ctx.fill()
    }

    // Level 3+: 外围能量场
    if (nexus.level >= 3) {
      const totalH = blocks * (blockH + gap)
      ctx.shadowColor = `hsla(${accentHue}, 90%, 70%, ${0.4 * glowIntensity})`
      ctx.shadowBlur = 12 * glowIntensity
      ctx.strokeStyle = `hsla(${accentHue}, 80%, 70%, 0.25)`
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.strokeRect(-blockW / 2 - 5, -totalH - 3, blockW + 10, totalH + 6)
      ctx.setLineDash([])
      ctx.shadowBlur = 0
    }

    // Level 4: 顶部全息指示灯
    if (nexus.level >= 4) {
      const topY = -blocks * (blockH + gap) - 6
      const indicatorGlow = ctx.createRadialGradient(0, topY, 0, 0, topY, 5)
      indicatorGlow.addColorStop(0, `hsla(${accentHue}, 95%, 85%, 0.8)`)
      indicatorGlow.addColorStop(1, `hsla(${accentHue}, 95%, 85%, 0)`)
      ctx.fillStyle = indicatorGlow
      ctx.beginPath()
      ctx.arc(0, topY, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = `hsla(${accentHue}, 95%, 90%, 1)`
      ctx.beginPath()
      ctx.arc(0, topY, 1.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ---- SPIRE: 水晶尖塔 (推理) ----

  private renderSpire(ctx: Ctx2D, nexus: NexusEntity, w: number, h: number): void {
    const { primaryHue: hue, primarySaturation: sat, primaryLightness: lit, accentHue, glowIntensity } = nexus.visualDNA
    const segments = nexus.level
    const totalSegH = h / (segments + 1)

    // 底部投影
    const baseGlow = ctx.createRadialGradient(0, 2, 0, 0, 2, w * 0.5)
    baseGlow.addColorStop(0, `hsla(${hue}, ${sat}%, ${lit}%, 0.12)`)
    baseGlow.addColorStop(1, `hsla(${hue}, ${sat}%, ${lit}%, 0)`)
    ctx.fillStyle = baseGlow
    ctx.fillRect(-w * 0.5, -3, w, 6)

    for (let i = 0; i < segments; i++) {
      const segH = totalSegH
      const baseWidth = w * (1 - i * 0.18) * 0.5
      const topWidth = w * (1 - (i + 1) * 0.18) * 0.5
      const y = -i * segH
      const shade = lit + i * 4

      // 主体梯形渐变 (从底部暗到顶部亮)
      const segGrad = ctx.createLinearGradient(0, y, 0, y - segH)
      segGrad.addColorStop(0, `hsla(${hue}, ${sat}%, ${shade - 5}%, 0.85)`)
      segGrad.addColorStop(0.6, `hsla(${hue}, ${sat}%, ${shade + 3}%, 0.75)`)
      segGrad.addColorStop(1, `hsla(${hue}, ${sat}%, ${shade + 8}%, 0.65)`)

      ctx.beginPath()
      ctx.moveTo(-baseWidth, y)
      ctx.lineTo(baseWidth, y)
      ctx.lineTo(topWidth, y - segH)
      ctx.lineTo(-topWidth, y - segH)
      ctx.closePath()
      ctx.fillStyle = segGrad
      ctx.fill()

      // 内部中线 (能量脊柱)
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(0, y - segH)
      ctx.strokeStyle = `hsla(${accentHue}, 80%, 75%, 0.2)`
      ctx.lineWidth = 0.8
      ctx.stroke()

      // 发光边框
      ctx.beginPath()
      ctx.moveTo(-baseWidth, y)
      ctx.lineTo(baseWidth, y)
      ctx.lineTo(topWidth, y - segH)
      ctx.lineTo(-topWidth, y - segH)
      ctx.closePath()
      ctx.strokeStyle = `hsla(${accentHue}, ${sat}%, ${lit + 20}%, 0.5)`
      ctx.lineWidth = 1
      ctx.stroke()

      // 段间高亮分隔线
      if (i > 0) {
        const lineGrad = ctx.createLinearGradient(-baseWidth, 0, baseWidth, 0)
        lineGrad.addColorStop(0, `hsla(${accentHue}, 90%, 80%, 0)`)
        lineGrad.addColorStop(0.5, `hsla(${accentHue}, 90%, 80%, 0.6)`)
        lineGrad.addColorStop(1, `hsla(${accentHue}, 90%, 80%, 0)`)
        ctx.beginPath()
        ctx.moveTo(-baseWidth, y)
        ctx.lineTo(baseWidth, y)
        ctx.strokeStyle = lineGrad
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }

    // 顶部尖顶 (强调色发光三角)
    const tipY = -segments * totalSegH
    const tipW = w * (1 - segments * 0.18) * 0.5
    const tipTopY = tipY - totalSegH

    const tipGrad = ctx.createLinearGradient(0, tipY, 0, tipTopY)
    tipGrad.addColorStop(0, `hsla(${accentHue}, ${sat + 10}%, ${lit + 5}%, 0.8)`)
    tipGrad.addColorStop(1, `hsla(${accentHue}, 95%, 85%, 0.9)`)

    ctx.beginPath()
    ctx.moveTo(-tipW, tipY)
    ctx.lineTo(0, tipTopY)
    ctx.lineTo(tipW, tipY)
    ctx.closePath()
    ctx.fillStyle = tipGrad
    ctx.fill()
    ctx.strokeStyle = `hsla(${accentHue}, 90%, 80%, 0.6)`
    ctx.lineWidth = 1
    ctx.stroke()

    // Level 3+: 天线 + 顶部能量球
    if (nexus.level >= 3) {
      const antennaTop = tipTopY - 10
      ctx.beginPath()
      ctx.moveTo(0, tipTopY)
      ctx.lineTo(0, antennaTop)
      ctx.strokeStyle = `hsla(${accentHue}, 80%, 70%, 0.7)`
      ctx.lineWidth = 1.5
      ctx.stroke()

      // 能量球 (多层光晕)
      const orbGlow = ctx.createRadialGradient(0, antennaTop, 0, 0, antennaTop, 6)
      orbGlow.addColorStop(0, `hsla(${accentHue}, 95%, 90%, 0.9)`)
      orbGlow.addColorStop(0.5, `hsla(${accentHue}, 90%, 70%, 0.4)`)
      orbGlow.addColorStop(1, `hsla(${accentHue}, 90%, 70%, 0)`)
      ctx.fillStyle = orbGlow
      ctx.beginPath()
      ctx.arc(0, antennaTop, 6, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = `hsla(${accentHue}, 95%, 95%, 1)`
      ctx.beginPath()
      ctx.arc(0, antennaTop, 2, 0, Math.PI * 2)
      ctx.fill()
    }

    // Level 4: 侧面能量翼
    if (nexus.level >= 4) {
      ctx.shadowColor = `hsla(${accentHue}, 90%, 70%, ${0.5 * glowIntensity})`
      ctx.shadowBlur = 10 * glowIntensity

      const wingY = -h * 0.45
      ctx.strokeStyle = `hsla(${accentHue}, 80%, 70%, 0.3)`
      ctx.lineWidth = 0.8
      // 左翼
      ctx.beginPath()
      ctx.moveTo(-2, wingY)
      ctx.quadraticCurveTo(-w * 0.5, wingY - 5, -w * 0.45, wingY + 5)
      ctx.stroke()
      // 右翼
      ctx.beginPath()
      ctx.moveTo(2, wingY)
      ctx.quadraticCurveTo(w * 0.5, wingY - 5, w * 0.45, wingY + 5)
      ctx.stroke()

      ctx.shadowBlur = 0
    }
  }

  // ---- REACTOR: 等离子核心球 (执行) ----

  private renderReactor(ctx: Ctx2D, nexus: NexusEntity, w: number, h: number): void {
    const { primaryHue: hue, primarySaturation: sat, primaryLightness: lit, accentHue, glowIntensity } = nexus.visualDNA
    const r = w * 0.35
    const cy = -h / 2

    // 外围能量场 (最底层光晕)
    const outerGlow = ctx.createRadialGradient(0, cy, r * 0.8, 0, cy, r * 2.2)
    outerGlow.addColorStop(0, `hsla(${hue}, ${sat}%, ${lit}%, 0.08)`)
    outerGlow.addColorStop(1, `hsla(${hue}, ${sat}%, ${lit}%, 0)`)
    ctx.fillStyle = outerGlow
    ctx.beginPath()
    ctx.arc(0, cy, r * 2.2, 0, Math.PI * 2)
    ctx.fill()

    // 球体主体 (多层径向渐变模拟 3D)
    const sphereGrad = ctx.createRadialGradient(-r * 0.25, cy - r * 0.2, 0, 0, cy, r)
    sphereGrad.addColorStop(0, `hsla(${hue}, ${sat - 10}%, ${lit + 30}%, 1)`)   // 高光点
    sphereGrad.addColorStop(0.3, `hsla(${hue}, ${sat}%, ${lit + 10}%, 0.95)`)   // 亮面
    sphereGrad.addColorStop(0.7, `hsla(${hue}, ${sat}%, ${lit}%, 0.9)`)          // 中间色
    sphereGrad.addColorStop(1, `hsla(${hue}, ${sat + 5}%, ${lit - 15}%, 0.85)`)  // 暗缘

    ctx.beginPath()
    ctx.arc(0, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = sphereGrad
    ctx.fill()

    // 球面高光弧 (玻璃反射)
    ctx.beginPath()
    ctx.ellipse(-r * 0.15, cy - r * 0.35, r * 0.35, r * 0.12, -0.3, 0, Math.PI * 2)
    ctx.fillStyle = `hsla(0, 0%, 100%, 0.15)`
    ctx.fill()

    // 轨道环 (多条椭圆轨道，不同倾角)
    const rings = Math.min(nexus.level, 3)
    const ringTilts = [0, 0.5, -0.4] // 倾角(弧度)

    for (let i = 0; i < rings; i++) {
      const ringR = r + 5 + i * 7
      const tilt = ringTilts[i] || 0
      const alpha = 0.5 - i * 0.12

      ctx.save()
      ctx.translate(0, cy)
      ctx.rotate(tilt)

      // 环本体
      ctx.beginPath()
      ctx.ellipse(0, 0, ringR, ringR * 0.28, 0, 0, Math.PI * 2)
      ctx.strokeStyle = `hsla(${accentHue}, 85%, 72%, ${alpha})`
      ctx.lineWidth = 1.2
      ctx.stroke()

      // 环上的刻度标记 (能量节点)
      const nodeCount = 4 + i * 2
      for (let j = 0; j < nodeCount; j++) {
        const angle = (Math.PI * 2 * j) / nodeCount
        const nx = Math.cos(angle) * ringR
        const ny = Math.sin(angle) * ringR * 0.28
        ctx.fillStyle = `hsla(${accentHue}, 90%, 80%, ${alpha * 0.6})`
        ctx.beginPath()
        ctx.arc(nx, ny, 1, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.restore()
    }

    // Level 4+: 核心能量点 (内核发光)
    if (nexus.level >= 4) {
      const coreGlow = ctx.createRadialGradient(0, cy, 0, 0, cy, r * 0.4)
      coreGlow.addColorStop(0, `hsla(${accentHue}, 95%, 92%, ${0.7 * glowIntensity})`)
      coreGlow.addColorStop(0.4, `hsla(${accentHue}, 90%, 80%, ${0.3 * glowIntensity})`)
      coreGlow.addColorStop(1, `hsla(${accentHue}, 90%, 80%, 0)`)
      ctx.fillStyle = coreGlow
      ctx.beginPath()
      ctx.arc(0, cy, r * 0.4, 0, Math.PI * 2)
      ctx.fill()

      // 核心最亮点
      ctx.fillStyle = `hsla(${accentHue}, 95%, 95%, 0.9)`
      ctx.beginPath()
      ctx.arc(0, cy, 2, 0, Math.PI * 2)
      ctx.fill()
    }

    // 球体边缘描边 (微弱)
    ctx.beginPath()
    ctx.arc(0, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = `hsla(${accentHue}, 70%, 60%, 0.3)`
    ctx.lineWidth = 0.8
    ctx.stroke()
  }

  // ---- VAULT: 数据水晶 (记忆) ----

  private renderVault(ctx: Ctx2D, nexus: NexusEntity, w: number, h: number): void {
    const { primaryHue: hue, primarySaturation: sat, primaryLightness: lit, accentHue, glowIntensity } = nexus.visualDNA
    const r = w * 0.4
    const cy = -h / 2

    // 底部光影投射
    const baseGlow = ctx.createRadialGradient(0, cy + r + 4, 0, 0, cy + r + 4, r * 0.8)
    baseGlow.addColorStop(0, `hsla(${hue}, ${sat}%, ${lit}%, 0.1)`)
    baseGlow.addColorStop(1, `hsla(${hue}, ${sat}%, ${lit}%, 0)`)
    ctx.fillStyle = baseGlow
    ctx.beginPath()
    ctx.arc(0, cy + r + 4, r * 0.8, 0, Math.PI * 2)
    ctx.fill()

    // 外层六边形 (渐变填充 - 顶亮底暗模拟水晶切面)
    const hexGrad = ctx.createLinearGradient(0, cy - r, 0, cy + r)
    hexGrad.addColorStop(0, `hsla(${hue}, ${sat}%, ${lit + 12}%, 0.85)`)
    hexGrad.addColorStop(0.5, `hsla(${hue}, ${sat}%, ${lit}%, 0.75)`)
    hexGrad.addColorStop(1, `hsla(${hue}, ${sat}%, ${lit - 10}%, 0.65)`)

    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6
      const px = Math.cos(angle) * r
      const py = Math.sin(angle) * r + cy
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fillStyle = hexGrad
    ctx.fill()

    // 外边框 (双层：内细外粗)
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6
      const px = Math.cos(angle) * r
      const py = Math.sin(angle) * r + cy
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.strokeStyle = `hsla(${accentHue}, ${sat}%, ${lit + 20}%, 0.6)`
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Level 2+: 内六边形 (水晶内部结构)
    if (nexus.level >= 2) {
      const innerR = r * 0.55
      const innerGrad = ctx.createLinearGradient(0, cy - innerR, 0, cy + innerR)
      innerGrad.addColorStop(0, `hsla(${accentHue}, 70%, 65%, 0.25)`)
      innerGrad.addColorStop(1, `hsla(${accentHue}, 70%, 45%, 0.15)`)

      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6
        const px = Math.cos(angle) * innerR
        const py = Math.sin(angle) * innerR + cy
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fillStyle = innerGrad
      ctx.fill()
      ctx.strokeStyle = `hsla(${accentHue}, 60%, 60%, 0.35)`
      ctx.lineWidth = 0.8
      ctx.stroke()
    }

    // Level 3+: 辐射线 (中心到每个顶点的数据流)
    if (nexus.level >= 3) {
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6
        const outerX = Math.cos(angle) * r
        const outerY = Math.sin(angle) * r + cy

        // 辐射线渐变 (中心亮到边缘暗)
        const lineGrad = ctx.createLinearGradient(0, cy, outerX, outerY)
        lineGrad.addColorStop(0, `hsla(${accentHue}, 80%, 75%, 0.4)`)
        lineGrad.addColorStop(1, `hsla(${accentHue}, 80%, 75%, 0.05)`)

        ctx.beginPath()
        ctx.moveTo(0, cy)
        ctx.lineTo(outerX, outerY)
        ctx.strokeStyle = lineGrad
        ctx.lineWidth = 0.8
        ctx.stroke()

        // 顶点能量节点
        ctx.fillStyle = `hsla(${accentHue}, 85%, 80%, 0.5)`
        ctx.beginPath()
        ctx.arc(outerX, outerY, 1.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Level 4: 核心光晕 (数据核心发光)
    if (nexus.level >= 4) {
      const coreR = r * 0.3
      const coreGrad = ctx.createRadialGradient(0, cy, 0, 0, cy, coreR)
      coreGrad.addColorStop(0, `hsla(${accentHue}, 95%, 90%, ${0.6 * glowIntensity})`)
      coreGrad.addColorStop(0.5, `hsla(${accentHue}, 90%, 75%, ${0.3 * glowIntensity})`)
      coreGrad.addColorStop(1, `hsla(${accentHue}, 90%, 70%, 0)`)

      ctx.fillStyle = coreGrad
      ctx.beginPath()
      ctx.arc(0, cy, coreR, 0, Math.PI * 2)
      ctx.fill()

      // 最亮核心点
      ctx.fillStyle = `hsla(${accentHue}, 95%, 95%, 0.8)`
      ctx.beginPath()
      ctx.arc(0, cy, 1.5, 0, Math.PI * 2)
      ctx.fill()

      // 外围光圈辉光
      ctx.shadowColor = `hsla(${accentHue}, 90%, 70%, ${0.4 * glowIntensity})`
      ctx.shadowBlur = 10 * glowIntensity
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6
        const px = Math.cos(angle) * r
        const py = Math.sin(angle) * r + cy
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.strokeStyle = `hsla(${accentHue}, 80%, 70%, 0.2)`
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  }

  // ---- Layer 4: 效果层 (选中脉冲 + 建造火花 + 呼吸光晕) ----

  private renderLayer4_Effects(
    ctx: CanvasRenderingContext2D,
    _w: number, _h: number,
    nexuses: Map<string, NexusEntity>,
    camera: CameraState,
    timestamp: number,
  ): void {
    const selectedId = this.state.selectedNexusId

    // 选中实例: 多层脉冲光圈
    if (selectedId) {
      const nexus = nexuses.get(selectedId)
      if (nexus) {
        const screen = this.worldToScreen(nexus.position.gridX, nexus.position.gridY, camera)
        const baseSize = NEXUS_BASE_SIZE[nexus.level - 1] * camera.zoom
        const { primaryHue: hue } = nexus.visualDNA
        const pulse = Math.sin(timestamp / 500) * 0.3 + 0.7
        const pulse2 = Math.sin(timestamp / 300) * 0.2 + 0.8

        ctx.save()

        // 外圈呼吸光晕
        const glowR = baseSize * 0.9 * pulse2
        const selGlow = ctx.createRadialGradient(
          screen.x, screen.y - baseSize / 2, glowR * 0.3,
          screen.x, screen.y - baseSize / 2, glowR
        )
        selGlow.addColorStop(0, `hsla(${hue}, 80%, 70%, ${0.12 * pulse})`)
        selGlow.addColorStop(1, `hsla(${hue}, 80%, 70%, 0)`)
        ctx.fillStyle = selGlow
        ctx.beginPath()
        ctx.arc(screen.x, screen.y - baseSize / 2, glowR, 0, Math.PI * 2)
        ctx.fill()

        // 旋转选框 (双虚线菱形)
        const rot = timestamp / 2000
        ctx.translate(screen.x, screen.y - baseSize / 2)
        ctx.rotate(rot)
        ctx.strokeStyle = `hsla(50, 90%, 75%, ${0.6 * pulse})`
        ctx.lineWidth = 1.5
        ctx.setLineDash([3, 5])
        const diamond = baseSize * 0.6
        ctx.beginPath()
        ctx.moveTo(0, -diamond)
        ctx.lineTo(diamond, 0)
        ctx.lineTo(0, diamond)
        ctx.lineTo(-diamond, 0)
        ctx.closePath()
        ctx.stroke()
        ctx.setLineDash([])

        ctx.restore()
      }
    }

    // 已完成建筑: 微弱呼吸光点
    for (const nexus of nexuses.values()) {
      if (nexus.constructionProgress >= 1 && nexus.level >= 3) {
        const screen = this.worldToScreen(nexus.position.gridX, nexus.position.gridY, camera)
        const baseSize = NEXUS_BASE_SIZE[nexus.level - 1] * camera.zoom
        const { accentHue } = nexus.visualDNA
        const breath = Math.sin(timestamp / 1500 + nexus.position.gridX) * 0.4 + 0.6

        ctx.fillStyle = `hsla(${accentHue}, 85%, 80%, ${0.08 * breath})`
        ctx.beginPath()
        ctx.arc(screen.x, screen.y - baseSize / 2, baseSize * 0.6, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // 建造中: 上升能量火花
    for (const nexus of nexuses.values()) {
      if (nexus.constructionProgress < 1) {
        const screen = this.worldToScreen(nexus.position.gridX, nexus.position.gridY, camera)
        const baseSize = NEXUS_BASE_SIZE[nexus.level - 1] * camera.zoom
        const { accentHue } = nexus.visualDNA
        const sparkCount = 4 + nexus.level

        for (let i = 0; i < sparkCount; i++) {
          const phase = (timestamp / 250 + i * 1.7) % (Math.PI * 2)
          const progress = (Math.sin(phase) + 1) / 2 // 0-1 上下循环
          const sx = screen.x + Math.cos(phase * 2.3 + i) * baseSize * 0.4
          const sy = screen.y - baseSize * nexus.constructionProgress * progress
          const sparkAlpha = (1 - progress) * 0.7

          // 火花本体
          ctx.beginPath()
          ctx.arc(sx, sy, 1.5, 0, Math.PI * 2)
          ctx.fillStyle = `hsla(${accentHue}, 85%, 80%, ${sparkAlpha})`
          ctx.fill()

          // 火花尾迹
          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.lineTo(sx, sy + 4)
          ctx.strokeStyle = `hsla(${accentHue}, 85%, 80%, ${sparkAlpha * 0.3})`
          ctx.lineWidth = 0.5
          ctx.stroke()
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
