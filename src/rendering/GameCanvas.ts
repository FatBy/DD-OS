// ============================================
// GameCanvas 渲染引擎 (协调器版本)
// ============================================

import type { CameraState } from '@/types'
import type { CanvasPalette } from '@/types/theme'
import type { 
  WorldTheme, 
  RenderState, 
  RenderContext,
  Point,
} from './types'
import { RendererRegistry } from './RendererRegistry'
import { createCosmosRenderers } from './index'
import { worldToScreen as wts, screenToWorld as stw } from './utils/coordinateTransforms'
import { PlanetRenderer } from './entities/PlanetRenderer'
import { CosmosRippleRenderer } from './backgrounds/CosmosRipple'

// 默认调色板 (保持原有配色)
const DEFAULT_PALETTE: CanvasPalette = {
  spaceGradient: ['#020617', '#0a0f1e', '#060b18'],
  gridColor: '80, 160, 255',
  gridOpacity: 0.04,
  starColor: '#ffffff',
  labelSelected: 'rgba(255,255,255,0.9)',
  labelDefault: 'rgba(200, 220, 255, 0.6)',
  glowHue: 220,
  coreHue: 220,
}

/**
 * GameCanvas 渲染引擎
 * 协调各渲染器完成画面绘制
 */
export class GameCanvas {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private dpr: number = 1
  private animFrameId = 0
  private _time = 0
  private mousePos: Point = { x: 0, y: 0 }
  private palette: CanvasPalette = DEFAULT_PALETTE
  private registry: RendererRegistry

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

    // 初始化渲染器注册表
    this.registry = new RendererRegistry()
    this.registry.register('cosmos', createCosmosRenderers())
    this.registry.setTheme('cosmos')

    this.resize()
    this.render = this.render.bind(this)
    this.animFrameId = requestAnimationFrame(this.render)
    console.log('[GameCanvas] Created (Plugin Architecture)')
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

    // 通知渲染器
    const renderers = this.registry.getCurrent()
    if (renderers) {
      renderers.background.resize?.(w, h)
      for (const particle of renderers.particles) {
        particle.resize?.(w, h)
      }
      for (const entity of renderers.entities) {
        entity.clearCache?.()
      }
    }
    
    // 更新 PlanetRenderer 的 DPR
    this.updateRenderersDpr()
  }

  destroy(): void {
    cancelAnimationFrame(this.animFrameId)
    this.registry.destroy()
    console.log('[GameCanvas] Destroyed')
  }

  updateState(state: RenderState): void {
    const prevSkillCount = this.state.energyCore?.skills.length ?? -1
    const newSkillCount = state.energyCore?.skills.length ?? -1
    
    // 更新核心粒子
    if (state.energyCore && prevSkillCount !== newSkillCount) {
      const renderers = this.registry.getCurrent()
      renderers?.core.initParticles?.(state.energyCore)
    }
    
    // 更新执行状态到 PlanetRenderer
    const planetRenderer = this.getPlanetRenderer()
    if (planetRenderer) {
      planetRenderer.setExecutionState(
        state.executingNexusId ?? null,
        state.executionStartTime ?? null,
      )
    }
    
    // 更新涟漪渲染器的核心状态
    const rippleRenderer = this.getRippleRenderer()
    if (rippleRenderer && state.energyCore) {
      rippleRenderer.setCoreState(state.energyCore)
    }
    
    this.state = state
  }

  setMousePosition(x: number, y: number): void {
    this.mousePos = { x, y }
  }

  triggerRipple(x: number, y: number): void {
    const renderers = this.registry.getCurrent()
    renderers?.ripple.trigger(x, y)
  }

  setPalette(palette: CanvasPalette): void {
    this.palette = palette
  }

  // ---- Theme Management ----

  setWorldTheme(theme: WorldTheme): void {
    this.registry.setTheme(theme)
    this.updateRenderersDpr()
  }

  getWorldTheme(): WorldTheme {
    return this.registry.getCurrentTheme()
  }

  // ---- Coordinate Transforms ----

  worldToScreen(gridX: number, gridY: number, camera: CameraState): Point {
    return wts(gridX, gridY, camera, this.canvas.clientWidth, this.canvas.clientHeight)
  }

  screenToWorld(screenX: number, screenY: number, camera: CameraState): { gridX: number; gridY: number } {
    return stw(screenX, screenY, camera, this.canvas.clientWidth, this.canvas.clientHeight)
  }

  // ---- Cache Management ----

  invalidateCache(nexusId: string): void {
    const renderers = this.registry.getCurrent()
    if (renderers) {
      for (const entity of renderers.entities) {
        entity.invalidateCache?.(nexusId)
      }
    }
  }

  clearCache(): void {
    const renderers = this.registry.getCurrent()
    if (renderers) {
      for (const entity of renderers.entities) {
        entity.clearCache?.()
      }
    }
  }

  // ---- Private Methods ----

  private getPlanetRenderer(): PlanetRenderer | null {
    const renderers = this.registry.getCurrent()
    if (!renderers) return null
    const planet = renderers.entities.find(e => e.id === 'planet-renderer')
    return planet as PlanetRenderer | null
  }

  private getRippleRenderer(): CosmosRippleRenderer | null {
    const renderers = this.registry.getCurrent()
    if (!renderers) return null
    if (renderers.ripple.id === 'cosmos-ripple') {
      return renderers.ripple as CosmosRippleRenderer
    }
    return null
  }

  private updateRenderersDpr(): void {
    const planetRenderer = this.getPlanetRenderer()
    if (planetRenderer) {
      planetRenderer.setDpr(this.dpr)
    }
  }

  // ---- Main Render Loop ----

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

    const renderers = this.registry.getCurrent()
    if (!renderers) return

    this._time += 0.002

    const { camera, nexuses, selectedNexusId, renderSettings } = this.state

    // 构建渲染上下文
    const renderCtx: RenderContext = {
      ctx,
      canvas: this.canvas,
      camera,
      palette: this.palette,
      time: this._time,
      dpr: this.dpr,
      width: w,
      height: h,
    }

    // Layer 0: Deep Space (星空背景)
    if (renderSettings.showParticles) {
      renderers.background.render(renderCtx)
    }

    // Layer 1: Energy Core (能量核心)
    if (this.state.energyCore) {
      renderers.core.render(renderCtx, this.state.energyCore, this.mousePos)
    }

    // Layer 2: ISO Grid
    if (renderSettings.showGrid) {
      renderers.grid.render(renderCtx)
    }

    // Layer 3: Entities (星球/建筑/生物)
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
          
          // 找到能渲染此 Nexus 的渲染器
          for (const entityRenderer of renderers.entities) {
            if (entityRenderer.canRender(nexus)) {
              entityRenderer.render(renderCtx, nexus, screen, isSelected, timestamp)
              break
            }
          }
        }
      }
    } catch (e) {
      console.error('[GameCanvas] Entity render error:', e)
    }

    // Layer 4: Particles
    for (const particleRenderer of renderers.particles) {
      particleRenderer.update(timestamp)
      particleRenderer.render(renderCtx)
    }

    // Layer 5: Ripples (交互波纹)
    renderers.ripple.update()
    renderers.ripple.render(renderCtx)
  }
}
