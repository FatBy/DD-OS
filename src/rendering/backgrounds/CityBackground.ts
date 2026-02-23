// ============================================
// DD-OS 城市背景渲染器 (Kenney 素材风格)
// 暖色调城市场景背景
// ============================================

import type { BackgroundRenderer, RenderContext } from '../types'

/**
 * 城市背景渲染器
 * 配合 Kenney isometric 素材的暖色调
 */
export class CityBackground implements BackgroundRenderer {
  readonly id = 'city-background'

  resize(_width: number, _height: number): void {
    // 无需缓存尺寸
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height } = ctx

    // 暖色调渐变背景（配合 Kenney 素材的土壤色）
    const bgGradient = c.createLinearGradient(0, 0, 0, height)
    bgGradient.addColorStop(0, '#E8E4DF')      // 浅米灰
    bgGradient.addColorStop(0.4, '#DDD8D0')    // 暖灰
    bgGradient.addColorStop(1, '#D5CFC5')      // 稍深的暖灰
    c.fillStyle = bgGradient
    c.fillRect(0, 0, width, height)

    // 右上方阳光效果
    const sunX = width * 0.85
    const sunY = height * 0.1
    const sunGlow = c.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(width, height) * 0.6)
    sunGlow.addColorStop(0, 'rgba(255, 250, 235, 0.25)')
    sunGlow.addColorStop(0.2, 'rgba(255, 245, 220, 0.12)')
    sunGlow.addColorStop(1, 'rgba(255, 245, 220, 0)')
    c.fillStyle = sunGlow
    c.fillRect(0, 0, width, height)

    // 底部稍暗的环境遮挡
    const aoGradient = c.createLinearGradient(0, height * 0.7, 0, height)
    aoGradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
    aoGradient.addColorStop(1, 'rgba(0, 0, 0, 0.05)')
    c.fillStyle = aoGradient
    c.fillRect(0, 0, width, height)
  }

  dispose(): void {
    // 无需清理
  }
}
