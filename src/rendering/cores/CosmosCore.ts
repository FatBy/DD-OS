// ============================================
// Cosmos 能量核心渲染器
// 渲染中央能量核心 (Lissajous 纹路 + 技能粒子)
// ============================================

import type { EnergyCoreRenderer, RenderContext, EnergyCoreState, Point, CoreParticle } from '../types'

/**
 * 基于名字生成唯一配色方案
 */
function getCoreColors(name: string): {
  core: string
  glow: string
  skillActive: string
  skillInactive: string
  hue: number
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

export class CosmosCoreRenderer implements EnergyCoreRenderer {
  readonly id = 'cosmos-core'
  
  private particles: CoreParticle[] = []
  private lastSkillCount = -1

  initParticles(core: EnergyCoreState): void {
    const colors = getCoreColors(core.name)

    const sourceData = core.skills.length > 0
      ? core.skills
      : Array.from({ length: 20 }, (_, i) => ({ id: `dummy-${i}`, active: Math.random() > 0.7 }))

    this.particles = sourceData.map((skill, i) => ({
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
    
    this.lastSkillCount = core.skills.length
  }

  render(
    ctx: RenderContext,
    coreState: EnergyCoreState,
    mousePos: Point,
  ): void {
    const { ctx: c, width: w, height: h, time } = ctx
    
    // 检查是否需要重新初始化粒子
    if (coreState.skills.length !== this.lastSkillCount) {
      this.initParticles(coreState)
    }

    const colors = getCoreColors(coreState.name)
    const minDim = Math.min(w, h)
    const coreR = minDim * 0.16

    // 视差偏移
    const cx = w / 2 + mousePos.x * 15
    const cy = h / 2 + mousePos.y * 15

    const speedMult = 1 + coreState.activity * 2

    // Layer A: 核心光晕 (呼吸效果)
    this.renderCoreGlow(c, cx, cy, w, h, coreR, colors, time, speedMult)

    // Layer B: 核心本体 (Lissajous 纹路)
    this.renderCoreBody(c, cx, cy, coreR, colors, coreState, time * speedMult)

    // Layer C: 技能粒子轨道
    this.renderCoreParticles(c, cx, cy, w, h, minDim, colors, speedMult)
  }

  private renderCoreGlow(
    c: CanvasRenderingContext2D,
    cx: number, cy: number,
    w: number, h: number,
    coreR: number,
    colors: ReturnType<typeof getCoreColors>,
    time: number,
    speedMult: number,
  ): void {
    const breath = Math.sin(time * speedMult * 1.5) * 0.05 + 1

    // 外层大范围光晕
    const outerGlow = c.createRadialGradient(cx, cy, coreR * 0.3, cx, cy, coreR * 6 * breath)
    outerGlow.addColorStop(0, `hsla(${colors.hue}, 70%, 50%, 0.15)`)
    outerGlow.addColorStop(0.3, `hsla(${colors.hue}, 60%, 40%, 0.06)`)
    outerGlow.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = outerGlow
    c.fillRect(0, 0, w, h)

    // 内层高亮光晕
    const innerGlow = c.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3 * breath)
    innerGlow.addColorStop(0, colors.glow)
    innerGlow.addColorStop(0.4, `hsla(${colors.hue}, 80%, 60%, 0.12)`)
    innerGlow.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = innerGlow
    c.fillRect(0, 0, w, h)
  }

  private renderCoreBody(
    c: CanvasRenderingContext2D,
    cx: number, cy: number,
    coreR: number,
    colors: ReturnType<typeof getCoreColors>,
    core: EnergyCoreState,
    time: number,
  ): void {
    c.save()
    c.beginPath()
    c.arc(cx, cy, coreR, 0, Math.PI * 2)
    c.clip()

    // 背景深色球体
    const bgGrad = c.createRadialGradient(cx - coreR * 0.3, cy - coreR * 0.3, 0, cx, cy, coreR)
    bgGrad.addColorStop(0, 'hsla(0, 0%, 15%, 1)')
    bgGrad.addColorStop(1, 'hsla(0, 0%, 5%, 1)')
    c.fillStyle = bgGrad
    c.fill()

    // Lissajous 能量纹路
    const lineCount = 6 + Math.floor(core.complexity / 10)
    c.strokeStyle = colors.core
    c.lineWidth = 1.5
    c.globalAlpha = 0.5

    for (let i = 0; i < lineCount; i++) {
      c.beginPath()
      const phase = (i / lineCount) * Math.PI * 2

      for (let x = -coreR; x <= coreR; x += 2) {
        const turbMod = core.turbulence * Math.sin(time * 0.5 + x * 0.1) * 0.2
        const yBase = Math.sin(x / coreR * Math.PI + time + phase + turbMod) * (coreR * 0.4)
        const scale = Math.sqrt(Math.max(0, 1 - (x / coreR) ** 2))

        const rot = time * 0.2
        const rx = x * Math.cos(rot) - yBase * scale * Math.sin(rot)
        const ry = x * Math.sin(rot) + yBase * scale * Math.cos(rot)

        if (x === -coreR) c.moveTo(cx + rx, cy + ry)
        else c.lineTo(cx + rx, cy + ry)
      }
      c.stroke()
    }

    c.globalAlpha = 1
    c.restore()

    // 球体边缘光晕
    const rimGlow = c.createRadialGradient(cx, cy, coreR * 0.85, cx, cy, coreR * 1.15)
    rimGlow.addColorStop(0, 'rgba(0,0,0,0)')
    rimGlow.addColorStop(0.5, `hsla(${colors.hue}, 80%, 60%, 0.25)`)
    rimGlow.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = rimGlow
    c.beginPath()
    c.arc(cx, cy, coreR * 1.15, 0, Math.PI * 2)
    c.fill()
  }

  private renderCoreParticles(
    c: CanvasRenderingContext2D,
    cx: number, cy: number,
    w: number, h: number,
    minDim: number,
    colors: ReturnType<typeof getCoreColors>,
    speedMult: number,
  ): void {
    const margin = 50

    for (const p of this.particles) {
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
      c.beginPath()
      c.arc(screenX, screenY, p.size * pScale, 0, Math.PI * 2)
      c.fillStyle = p.color
      c.globalAlpha = Math.max(0.05, alpha)
      c.fill()

      // 低频能量连接线
      if (p.active && Math.random() > 0.99) {
        c.beginPath()
        c.moveTo(screenX, screenY)
        c.lineTo(cx, cy)
        c.strokeStyle = colors.skillActive
        c.lineWidth = 0.5
        c.globalAlpha = 0.3
        c.stroke()
      }
    }
    c.globalAlpha = 1
  }

  dispose(): void {
    this.particles = []
    this.lastSkillCount = -1
  }
}
