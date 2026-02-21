// ============================================
// Cosmos 涟漪渲染器
// 渲染交互波纹效果
// ============================================

import type { RippleRenderer, RenderContext, Ripple, EnergyCoreState } from '../types'

/**
 * 基于名字生成颜色 hue (与 CosmosCore 保持一致)
 */
function getHueFromName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash % 360)
}

export class CosmosRippleRenderer implements RippleRenderer {
  readonly id = 'cosmos-ripple'
  
  private ripples: Ripple[] = []
  private maxRipples = 10
  private coreState: EnergyCoreState | null = null

  trigger(x: number, y: number): void {
    if (this.ripples.length >= this.maxRipples) return
    this.ripples.push({ x, y, radius: 0, alpha: 0.8 })
  }

  setCoreState(core: EnergyCoreState | null): void {
    this.coreState = core
  }

  update(): void {
    this.ripples = this.ripples.filter(r => {
      r.radius += 4
      r.alpha -= 0.015
      return r.alpha > 0
    })
  }

  render(ctx: RenderContext): void {
    if (this.ripples.length === 0) return
    
    const { ctx: c } = ctx
    
    // 根据核心状态决定涟漪颜色
    const hue = this.coreState ? getHueFromName(this.coreState.name) : 220
    const strokeColor = `hsla(${hue}, 80%, 70%,`

    for (const r of this.ripples) {
      c.beginPath()
      c.arc(r.x, r.y, r.radius, 0, Math.PI * 2)
      c.strokeStyle = `${strokeColor} ${r.alpha})`
      c.lineWidth = 2
      c.stroke()
    }
  }

  dispose(): void {
    this.ripples = []
    this.coreState = null
  }
}
