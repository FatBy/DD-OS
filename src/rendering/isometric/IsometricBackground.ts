// ============================================
// DD-OS 等轴测背景渲染器
// 使用 isometric-city 资源包
// ============================================

import type { BackgroundRenderer, RenderContext } from '../types'

/**
 * 等轴测背景渲染器
 * 渲染地面瓦片
 */
export class IsometricBackground implements BackgroundRenderer {
  readonly id = 'isometric-background'

  resize(_width: number, _height: number): void {
    // 无需特殊处理
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height } = ctx

    // 纯色背景，不渲染地面瓦片
    c.fillStyle = '#d4c9a8'  // 温暖的米色背景
    c.fillRect(0, 0, width, height)
  }

  dispose(): void {
    // 无需清理
  }
}
