// ============================================
// DD-OS 像素小镇背景渲染器
// 基于 Minimalist 背景，增加暖色黄昏色调
// ============================================

import type { BackgroundRenderer, RenderContext } from '../types'

interface DustParticle {
  x: number
  y: number
  size: number
  baseOpacity: number
  speedX: number
  speedY: number
  phase: number
  warm: boolean
}

/**
 * 像素小镇背景渲染器
 * 温暖的浅色背景 + 黄昏光晕 + 浮动光尘
 */
export class PixelTownBackground implements BackgroundRenderer {
  readonly id = 'pixeltown-background'

  private particles: DustParticle[] = []
  private w = 1920
  private h = 1080

  constructor() {
    this.initParticles()
  }

  private initParticles(): void {
    this.particles = []
    for (let i = 0; i < 30; i++) {
      this.particles.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        size: 1 + Math.random() * 2.5,
        baseOpacity: 0.06 + Math.random() * 0.12,
        speedX: (Math.random() - 0.5) * 0.35,
        speedY: (Math.random() - 0.5) * 0.25,
        phase: Math.random() * Math.PI * 2,
        warm: i < 22, // 73% 暖色
      })
    }
  }

  resize(width: number, height: number): void {
    this.w = width
    this.h = height
    for (const p of this.particles) {
      if (p.x > width) p.x = Math.random() * width
      if (p.y > height) p.y = Math.random() * height
    }
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height, time } = ctx

    // ---- 1. 温暖的浅色背景 (微黄/杏色调) ----
    const bgGradient = c.createLinearGradient(0, 0, 0, height)
    bgGradient.addColorStop(0, '#FBF8F3')    // 暖白
    bgGradient.addColorStop(0.4, '#F8F4ED')  // 米色
    bgGradient.addColorStop(1, '#F3EDE4')    // 暖灰
    c.fillStyle = bgGradient
    c.fillRect(0, 0, width, height)

    // ---- 2. 右上暖色光晕 (夕阳感) ----
    const sunX = width * 0.78
    const sunY = height * 0.12
    const sunBreath = 1 + 0.06 * Math.sin(time * 1.2)
    const sunRadius = Math.max(width, height) * 0.5 * sunBreath
    const sunAlpha = 0.18 * (0.9 + 0.1 * Math.sin(time * 1.0))

    const sunGlow = c.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunRadius)
    sunGlow.addColorStop(0, `rgba(255, 220, 180, ${sunAlpha})`)
    sunGlow.addColorStop(0.3, `rgba(255, 200, 150, ${sunAlpha * 0.5})`)
    sunGlow.addColorStop(1, 'rgba(255, 200, 150, 0)')
    c.fillStyle = sunGlow
    c.fillRect(0, 0, width, height)

    // ---- 3. 左下淡蓝光晕 (天空反射) ----
    const coolX = width * 0.18
    const coolY = height * 0.88
    const coolBreath = 1 + 0.04 * Math.sin(time * 1.6 + Math.PI)
    const coolRadius = Math.max(width, height) * 0.35 * coolBreath
    const coolAlpha = 0.06 * (0.9 + 0.1 * Math.sin(time * 1.3 + Math.PI))

    const coolGlow = c.createRadialGradient(coolX, coolY, 0, coolX, coolY, coolRadius)
    coolGlow.addColorStop(0, `rgba(180, 210, 240, ${coolAlpha})`)
    coolGlow.addColorStop(1, 'rgba(180, 210, 240, 0)')
    c.fillStyle = coolGlow
    c.fillRect(0, 0, width, height)

    // ---- 4. 浮动光尘 ----
    for (const p of this.particles) {
      p.x += p.speedX
      p.y += p.speedY

      if (p.x < 0) p.x += width
      else if (p.x > width) p.x -= width
      if (p.y < 0) p.y += height
      else if (p.y > height) p.y -= height

      const alpha = p.baseOpacity * (0.7 + 0.3 * Math.sin(time * 3 + p.phase))
      if (alpha < 0.01) continue

      c.beginPath()
      c.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      c.fillStyle = p.warm
        ? `rgba(255, 225, 180, ${alpha})`
        : `rgba(200, 220, 245, ${alpha})`
      c.fill()
    }
  }

  dispose(): void {
    this.particles = []
  }
}
