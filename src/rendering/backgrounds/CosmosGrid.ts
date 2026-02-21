// ============================================
// Cosmos 网格渲染器
// 渲染等轴网格 (中心渐隐效果)
// ============================================

import type { GridRenderer, RenderContext } from '../types'
import { worldToScreen } from '../utils/coordinateTransforms'

export class CosmosGridRenderer implements GridRenderer {
  readonly id = 'cosmos-grid'

  render(ctx: RenderContext): void {
    const { ctx: c, camera, palette, width: w, height: h } = ctx
    
    c.save()
    c.lineWidth = 1
    
    const range = 10
    const centerX = w / 2
    const centerY = h / 2
    const maxDim = Math.max(w, h) * 0.5

    for (let i = -range; i <= range; i++) {
      const p1 = worldToScreen(-range, i, camera, w, h)
      const p2 = worldToScreen(range, i, camera, w, h)

      // 根据线段中点到屏幕中心的距离调整透明度 (中心渐隐)
      const midX1 = (p1.x + p2.x) / 2
      const midY1 = (p1.y + p2.y) / 2
      const dist1 = Math.sqrt((midX1 - centerX) ** 2 + (midY1 - centerY) ** 2)
      const fade1 = Math.min(1, Math.max(0, (dist1 / maxDim - 0.2) / 0.6))

      c.strokeStyle = `rgba(${palette.gridColor}, ${palette.gridOpacity * fade1})`
      c.beginPath()
      c.moveTo(p1.x, p1.y)
      c.lineTo(p2.x, p2.y)
      c.stroke()

      const p3 = worldToScreen(i, -range, camera, w, h)
      const p4 = worldToScreen(i, range, camera, w, h)
      const midX2 = (p3.x + p4.x) / 2
      const midY2 = (p3.y + p4.y) / 2
      const dist2 = Math.sqrt((midX2 - centerX) ** 2 + (midY2 - centerY) ** 2)
      const fade2 = Math.min(1, Math.max(0, (dist2 / maxDim - 0.2) / 0.6))

      c.strokeStyle = `rgba(${palette.gridColor}, ${palette.gridOpacity * fade2})`
      c.beginPath()
      c.moveTo(p3.x, p3.y)
      c.lineTo(p4.x, p4.y)
      c.stroke()
    }
    
    c.restore()
  }

  dispose(): void {
    // 无需清理
  }
}
