// ============================================
// DD-OS 极简背景渲染器
// 纯净浅色背景 + 淡淡光晕
// ============================================

import type { BackgroundRenderer, RenderContext } from '../types'

/**
 * 极简背景渲染器
 * 展厅级纯净背景
 */
export class MinimalistBackground implements BackgroundRenderer {
  readonly id = 'minimalist-background'

  resize(_width: number, _height: number): void {
    // 无需缓存尺寸
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height } = ctx

    // 纯净的浅色背景（石膏白/米白）
    const bgGradient = c.createLinearGradient(0, 0, 0, height)
    bgGradient.addColorStop(0, '#FAFAFA')      // 纯净米白
    bgGradient.addColorStop(0.5, '#F5F5F5')    // 稍暖
    bgGradient.addColorStop(1, '#F0F0F0')      // 底部稍深
    c.fillStyle = bgGradient
    c.fillRect(0, 0, width, height)

    // 右上方淡淡的暖色光晕（模拟自然光）
    const sunX = width * 0.8
    const sunY = height * 0.15
    const sunGlow = c.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(width, height) * 0.5)
    sunGlow.addColorStop(0, 'rgba(255, 245, 220, 0.15)')
    sunGlow.addColorStop(0.3, 'rgba(255, 240, 200, 0.08)')
    sunGlow.addColorStop(1, 'rgba(255, 240, 200, 0)')
    c.fillStyle = sunGlow
    c.fillRect(0, 0, width, height)

    // 左下方淡淡的冷色调（增加空间感）
    const coolX = width * 0.2
    const coolY = height * 0.85
    const coolGlow = c.createRadialGradient(coolX, coolY, 0, coolX, coolY, Math.max(width, height) * 0.4)
    coolGlow.addColorStop(0, 'rgba(200, 220, 255, 0.08)')
    coolGlow.addColorStop(1, 'rgba(200, 220, 255, 0)')
    c.fillStyle = coolGlow
    c.fillRect(0, 0, width, height)
  }

  dispose(): void {
    // 无需清理
  }
}
