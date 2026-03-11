// ============================================
// DD-OS 像素小镇装饰渲染器
// 像素风格树木/路灯/花坛/长椅/邮箱
// ============================================

import type { DecoLayerRenderer, RenderContext, GridPosition } from '../types'
import { worldToScreen } from '../utils/coordinateTransforms'

type PropType = 'tree' | 'pine' | 'lamp' | 'bench' | 'bush' | 'flowerbed' | 'mailbox'

interface Prop {
  type: PropType
  offsetGX: number
  offsetGY: number
  size: number
  variant: number
}

// 像素风树冠颜色
const TREE_CROWNS = ['#5EAA5E', '#4D9650', '#6CB86C', '#78C478']
const PINE_COLORS = ['#3A7D44', '#2D6B36', '#4A8B50']

function hashNum(a: number, b: number, seed: number): number {
  let h = seed
  h = Math.imul(h ^ (a * 374761393), 1103515245)
  h = Math.imul(h ^ (b * 668265263), 1103515245)
  return Math.abs(h)
}

/**
 * 像素小镇装饰渲染器
 * 每个 Nexus 周围 4-7 个装饰物
 */
export class PixelTownDecoRenderer implements DecoLayerRenderer {
  readonly id = 'pixeltown-deco-renderer'

  private propsMap: Map<string, { gx: number; gy: number; props: Prop[] }> = new Map()

  updateNexusPositions(positions: GridPosition[]): void {
    const newKeys = new Set<string>()

    for (const pos of positions) {
      const key = `${pos.gridX},${pos.gridY}`
      newKeys.add(key)
      if (this.propsMap.has(key)) continue

      const props = this.generateProps(pos.gridX, pos.gridY)
      this.propsMap.set(key, { gx: pos.gridX, gy: pos.gridY, props })
    }

    for (const key of this.propsMap.keys()) {
      if (!newKeys.has(key)) this.propsMap.delete(key)
    }
  }

  private generateProps(gridX: number, gridY: number): Prop[] {
    const props: Prop[] = []
    const seed = hashNum(gridX, gridY, 77)
    const count = 4 + (seed % 4) // 4-7 个装饰

    for (let i = 0; i < count; i++) {
      const h = hashNum(gridX * 100 + i, gridY * 100 + i, seed)

      const angle = ((h % 360) / 360) * Math.PI * 2
      const dist = 0.8 + (h % 130) / 100 // 0.8 - 2.1
      const offsetGX = Math.cos(angle) * dist
      const offsetGY = Math.sin(angle) * dist

      // 类型分配 (更丰富)
      const typeRoll = h % 14
      let type: PropType
      if (typeRoll <= 3) type = 'tree'
      else if (typeRoll <= 5) type = 'pine'
      else if (typeRoll <= 7) type = 'lamp'
      else if (typeRoll <= 9) type = 'bench'
      else if (typeRoll <= 10) type = 'bush'
      else if (typeRoll <= 12) type = 'flowerbed'
      else type = 'mailbox'

      props.push({
        type,
        offsetGX,
        offsetGY,
        size: 0.6 + (h % 40) / 100,
        variant: h % 4,
      })
    }

    return props
  }

  render(ctx: RenderContext): void {
    const { ctx: c, camera, width, height } = ctx

    for (const { gx, gy, props } of this.propsMap.values()) {
      for (const prop of props) {
        const worldGX = gx + prop.offsetGX
        const worldGY = gy + prop.offsetGY
        const screen = worldToScreen(worldGX, worldGY, camera, width, height)

        if (screen.x < -80 || screen.x > width + 80 ||
            screen.y < -80 || screen.y > height + 80) {
          continue
        }

        const scale = camera.zoom * prop.size

        switch (prop.type) {
          case 'tree':
            this.drawTree(c, screen.x, screen.y, scale, prop.variant)
            break
          case 'pine':
            this.drawPine(c, screen.x, screen.y, scale, prop.variant)
            break
          case 'lamp':
            this.drawLamp(c, screen.x, screen.y, scale)
            break
          case 'bench':
            this.drawBench(c, screen.x, screen.y, scale)
            break
          case 'bush':
            this.drawBush(c, screen.x, screen.y, scale, prop.variant)
            break
          case 'flowerbed':
            this.drawFlowerbed(c, screen.x, screen.y, scale, prop.variant)
            break
          case 'mailbox':
            this.drawMailbox(c, screen.x, screen.y, scale)
            break
        }
      }
    }
  }

  /**
   * 圆形树冠的落叶树
   */
  private drawTree(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    scale: number, variant: number,
  ): void {
    const trunkW = 2.5 * scale
    const trunkH = 7 * scale
    const crownR = 7 * scale

    // 树影
    ctx.fillStyle = 'rgba(0, 0, 0, 0.06)'
    ctx.beginPath()
    ctx.ellipse(x, y + 1, crownR * 0.7, crownR * 0.3, 0, 0, Math.PI * 2)
    ctx.fill()

    // 树干
    ctx.fillStyle = '#8B6F4E'
    ctx.fillRect(x - trunkW / 2, y - trunkH, trunkW, trunkH)

    // 树冠 (圆形 + 高光)
    const color = TREE_CROWNS[variant % TREE_CROWNS.length]
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y - trunkH - crownR * 0.5, crownR, 0, Math.PI * 2)
    ctx.fill()

    // 高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.beginPath()
    ctx.arc(x - crownR * 0.2, y - trunkH - crownR * 0.8, crownR * 0.5, 0, Math.PI * 2)
    ctx.fill()
  }

  /**
   * 三角形松树
   */
  private drawPine(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    scale: number, variant: number,
  ): void {
    const trunkW = 2 * scale
    const trunkH = 5 * scale
    const color = PINE_COLORS[variant % PINE_COLORS.length]

    // 树影
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)'
    ctx.beginPath()
    ctx.ellipse(x, y + 1, 5 * scale, 2 * scale, 0, 0, Math.PI * 2)
    ctx.fill()

    // 树干
    ctx.fillStyle = '#7A5C3E'
    ctx.fillRect(x - trunkW / 2, y - trunkH, trunkW, trunkH)

    // 三层三角形
    for (let i = 0; i < 3; i++) {
      const layerW = (10 - i * 2) * scale
      const layerH = 6 * scale
      const baseY = y - trunkH - i * layerH * 0.6

      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(x, baseY - layerH)
      ctx.lineTo(x + layerW / 2, baseY)
      ctx.lineTo(x - layerW / 2, baseY)
      ctx.closePath()
      ctx.fill()
    }
  }

  /**
   * 路灯 (暖黄光)
   */
  private drawLamp(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    scale: number,
  ): void {
    const poleH = 14 * scale
    const bulbR = 2.5 * scale
    const glowR = 16 * scale

    // 灯柱
    ctx.strokeStyle = '#888'
    ctx.lineWidth = 1.5 * scale
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x, y - poleH)
    ctx.stroke()

    // 灯帽 (小横杠)
    ctx.beginPath()
    ctx.moveTo(x - 3 * scale, y - poleH)
    ctx.lineTo(x + 3 * scale, y - poleH)
    ctx.stroke()

    // 暖光晕
    const glow = ctx.createRadialGradient(x, y - poleH, 0, x, y - poleH, glowR)
    glow.addColorStop(0, 'rgba(255, 230, 160, 0.15)')
    glow.addColorStop(1, 'rgba(255, 230, 160, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y - poleH, glowR, 0, Math.PI * 2)
    ctx.fill()

    // 灯头
    ctx.fillStyle = '#FFD966'
    ctx.beginPath()
    ctx.arc(x, y - poleH, bulbR, 0, Math.PI * 2)
    ctx.fill()
  }

  /**
   * 长椅
   */
  private drawBench(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    scale: number,
  ): void {
    const seatW = 10 * scale
    const seatH = 2.5 * scale
    const legH = 3.5 * scale
    const legW = 1 * scale

    // 座面 (木色)
    ctx.fillStyle = '#C4956A'
    ctx.fillRect(x - seatW / 2, y - seatH - legH, seatW, seatH)

    // 靠背
    ctx.fillStyle = '#B88A60'
    ctx.fillRect(x - seatW / 2, y - seatH - legH - 3 * scale, seatW, 1.5 * scale)

    // 腿
    ctx.fillStyle = '#8B6F4E'
    ctx.fillRect(x - seatW / 2 + 1 * scale, y - legH, legW, legH)
    ctx.fillRect(x + seatW / 2 - 2 * scale, y - legH, legW, legH)
  }

  /**
   * 灌木 (多圆重叠)
   */
  private drawBush(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    scale: number, variant: number,
  ): void {
    const colors = ['#7BBF7B', '#6DA86D', '#88C888', '#5E9E5E']
    const baseColor = colors[variant % colors.length]
    const r1 = 4 * scale
    const r2 = 3.5 * scale

    ctx.fillStyle = baseColor
    ctx.globalAlpha = 0.85

    ctx.beginPath()
    ctx.arc(x, y - r1, r1, 0, Math.PI * 2)
    ctx.fill()

    ctx.globalAlpha = 0.7
    ctx.beginPath()
    ctx.arc(x - r1 * 0.6, y - r2 * 0.5, r2, 0, Math.PI * 2)
    ctx.fill()

    ctx.beginPath()
    ctx.arc(x + r1 * 0.5, y - r2 * 0.4, r2 * 0.9, 0, Math.PI * 2)
    ctx.fill()

    ctx.globalAlpha = 1
  }

  /**
   * 花坛 (彩色小点)
   */
  private drawFlowerbed(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    scale: number, variant: number,
  ): void {
    // 土壤基座
    ctx.fillStyle = '#A08060'
    ctx.fillRect(x - 5 * scale, y - 2 * scale, 10 * scale, 2 * scale)

    // 绿叶底
    ctx.fillStyle = '#6BAB6B'
    ctx.beginPath()
    ctx.ellipse(x, y - 3 * scale, 5 * scale, 2 * scale, 0, 0, Math.PI * 2)
    ctx.fill()

    // 彩色花朵
    const flowerColors = [
      ['#FF6B8A', '#FFB347', '#FF69B4'],
      ['#87CEEB', '#DDA0DD', '#FFD700'],
      ['#FF4444', '#FF8C00', '#FFFF44'],
      ['#FF69B4', '#BA55D3', '#FF6347'],
    ]
    const palette = flowerColors[variant % flowerColors.length]

    for (let i = 0; i < 5; i++) {
      const fx = x + (i - 2) * 2 * scale + (i % 2) * scale
      const fy = y - 4 * scale - (i % 2) * scale
      ctx.fillStyle = palette[i % palette.length]
      ctx.beginPath()
      ctx.arc(fx, fy, 1.2 * scale, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  /**
   * 邮箱
   */
  private drawMailbox(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    scale: number,
  ): void {
    const postW = 1.5 * scale
    const postH = 8 * scale
    const boxW = 5 * scale
    const boxH = 4 * scale

    // 立柱
    ctx.fillStyle = '#8B7355'
    ctx.fillRect(x - postW / 2, y - postH, postW, postH)

    // 信箱主体 (蓝色)
    ctx.fillStyle = '#5B8EC9'
    ctx.fillRect(x - boxW / 2, y - postH - boxH * 0.3, boxW, boxH)

    // 信箱顶部 (圆弧)
    ctx.fillStyle = '#4A7AB5'
    ctx.beginPath()
    ctx.ellipse(x, y - postH - boxH * 0.3, boxW / 2, 1.5 * scale, 0, Math.PI, Math.PI * 2)
    ctx.fill()
  }

  dispose(): void {
    this.propsMap.clear()
  }
}
