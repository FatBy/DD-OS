// ============================================
// Cosmos 背景渲染器
// 渲染深空星空 + 星云尘埃
// ============================================

import type { BackgroundRenderer, RenderContext, BackgroundParticle } from '../types'

export class CosmosBackgroundRenderer implements BackgroundRenderer {
  readonly id = 'cosmos-background'
  
  private particles: BackgroundParticle[] = []
  private initialized = false

  constructor() {
    this.initParticles()
  }

  private initParticles(): void {
    if (this.initialized) return
    
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
    this.initialized = true
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width: w, height: h, palette, time } = ctx
    const cx = w / 2
    const cy = h / 2

    // A. 深空基底渐变
    const bgGrad = c.createLinearGradient(0, 0, 0, h)
    bgGrad.addColorStop(0, palette.spaceGradient[0])
    bgGrad.addColorStop(0.5, palette.spaceGradient[1])
    bgGrad.addColorStop(1, palette.spaceGradient[2])
    c.fillStyle = bgGrad
    c.fillRect(0, 0, w, h)

    // B. 中心呼吸光晕 (模拟星系核心辐射)
    const pulse = Math.sin(time) * 0.08 + 1
    const maxDim = Math.max(w, h)
    const glowGrad = c.createRadialGradient(cx, cy, 0, cx, cy, maxDim * 0.7 * pulse)
    glowGrad.addColorStop(0, `hsla(${palette.glowHue}, 60%, 12%, ${0.12 * pulse})`)
    glowGrad.addColorStop(0.4, `hsla(${palette.glowHue + 30}, 50%, 8%, ${0.06 * pulse})`)
    glowGrad.addColorStop(1, 'transparent')
    c.fillStyle = glowGrad
    c.fillRect(0, 0, w, h)

    // C. 星空粒子 (带闪烁效果)
    for (const p of this.particles) {
      p.x += p.speedX
      p.y += p.speedY
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0
      if (p.y < 0) p.y = h; if (p.y > h) p.y = 0

      const twinkle = Math.sin(time * 3 + p.x * 0.1 + p.y * 0.1) * 0.15 + 0.85
      c.globalAlpha = p.opacity * twinkle
      c.fillStyle = palette.starColor
      c.beginPath()
      c.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      c.fill()
    }
    c.globalAlpha = 1

    // D. 漂浮星云尘埃 (大型半透明光斑)
    for (let i = 0; i < 6; i++) {
      const nx = (Math.sin(i * 73.7 + time * 0.15) * 0.4 + 0.5) * w
      const ny = (Math.cos(i * 127.3 + time * 0.1) * 0.4 + 0.5) * h
      const nr = maxDim * (0.08 + Math.sin(time + i * 2) * 0.02)
      const alpha = (Math.sin(time * 0.8 + i * 1.5) + 1) * 0.01 + 0.005

      const nebulaGrad = c.createRadialGradient(nx, ny, 0, nx, ny, nr)
      nebulaGrad.addColorStop(0, `hsla(${palette.glowHue + i * 25}, 50%, 45%, ${alpha})`)
      nebulaGrad.addColorStop(1, 'transparent')
      c.fillStyle = nebulaGrad
      c.fillRect(nx - nr, ny - nr, nr * 2, nr * 2)
    }
  }

  resize(width: number, height: number): void {
    // 重置粒子位置到新边界内
    for (const p of this.particles) {
      if (p.x > width) p.x = Math.random() * width
      if (p.y > height) p.y = Math.random() * height
    }
  }

  dispose(): void {
    this.particles = []
    this.initialized = false
  }
}
