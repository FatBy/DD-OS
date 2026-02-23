// ============================================
// DD-OS 城市背景渲染器
// 自然风格的天空背景（蓝天白云）
// ============================================

import type { BackgroundRenderer, RenderContext } from '../types'

/**
 * 自然风格城市背景渲染器
 * 蓝天白云 + 远景山丘
 */
export class CityBackground implements BackgroundRenderer {
  readonly id = 'city-background'
  
  private clouds: Array<{
    x: number
    y: number
    width: number
    height: number
    speed: number
    opacity: number
  }> = []
  
  private hills: Array<{
    x: number
    width: number
    height: number
    color: string
  }> = []
  
  private width = 0
  private height = 0

  constructor() {
    // 延迟初始化
  }

  private initialize(width: number, height: number): void {
    this.width = width
    this.height = height
    
    // 生成云朵
    this.clouds = []
    const cloudCount = Math.ceil(width / 200) + 3
    for (let i = 0; i < cloudCount; i++) {
      this.clouds.push({
        x: Math.random() * width * 1.5 - width * 0.25,
        y: 30 + Math.random() * (height * 0.25),
        width: 80 + Math.random() * 120,
        height: 30 + Math.random() * 40,
        speed: 0.1 + Math.random() * 0.2,
        opacity: 0.6 + Math.random() * 0.3,
      })
    }
    
    // 生成远景山丘
    this.hills = []
    let x = -50
    const hillCount = Math.ceil(width / 80) + 2
    for (let i = 0; i < hillCount; i++) {
      const hWidth = 100 + Math.random() * 150
      this.hills.push({
        x,
        width: hWidth,
        height: 40 + Math.random() * 60,
        color: `hsl(${100 + Math.random() * 30}, ${20 + Math.random() * 15}%, ${60 + Math.random() * 15}%)`,
      })
      x += hWidth * 0.6
    }
  }

  resize(width: number, height: number): void {
    if (this.width !== width || this.height !== height) {
      this.initialize(width, height)
    }
  }

  render(ctx: RenderContext): void {
    const { ctx: c, width, height } = ctx
    
    if (this.width !== width || this.height !== height) {
      this.initialize(width, height)
    }

    // 天空渐变背景（日间蓝天）
    const skyGradient = c.createLinearGradient(0, 0, 0, height)
    skyGradient.addColorStop(0, '#87CEEB')    // 天蓝色
    skyGradient.addColorStop(0.3, '#B0E0E6')  // 淡蓝色
    skyGradient.addColorStop(0.7, '#E0F4FF')  // 接近白色
    skyGradient.addColorStop(1, '#F5FFFA')    // 薄荷色调
    c.fillStyle = skyGradient
    c.fillRect(0, 0, width, height)

    // 太阳光晕
    const sunX = width * 0.8
    const sunY = height * 0.15
    const sunGlow = c.createRadialGradient(sunX, sunY, 0, sunX, sunY, 150)
    sunGlow.addColorStop(0, 'rgba(255, 255, 200, 0.4)')
    sunGlow.addColorStop(0.3, 'rgba(255, 250, 180, 0.2)')
    sunGlow.addColorStop(1, 'rgba(255, 250, 180, 0)')
    c.fillStyle = sunGlow
    c.fillRect(0, 0, width, height)

    // 绘制云朵（缓慢移动）
    c.fillStyle = 'rgba(255, 255, 255, 0.8)'
    for (const cloud of this.clouds) {
      // 更新位置
      cloud.x += cloud.speed
      if (cloud.x > width + cloud.width) {
        cloud.x = -cloud.width * 2
      }
      
      c.globalAlpha = cloud.opacity
      this.drawCloud(c, cloud.x, cloud.y, cloud.width, cloud.height)
    }
    c.globalAlpha = 1

    // 远景山丘
    const hillBaseY = height - 30
    for (const hill of this.hills) {
      c.fillStyle = hill.color
      c.beginPath()
      c.moveTo(hill.x, hillBaseY)
      // 绘制平滑的山丘曲线
      c.quadraticCurveTo(
        hill.x + hill.width / 2,
        hillBaseY - hill.height,
        hill.x + hill.width,
        hillBaseY
      )
      c.closePath()
      c.fill()
    }

    // 地面渐变（草地感）
    const groundGradient = c.createLinearGradient(0, hillBaseY, 0, height)
    groundGradient.addColorStop(0, 'rgba(144, 190, 109, 0.5)')  // 草绿色
    groundGradient.addColorStop(1, 'rgba(139, 195, 74, 0.3)')   // 浅草绿
    c.fillStyle = groundGradient
    c.fillRect(0, hillBaseY, width, height - hillBaseY)
  }

  /**
   * 绘制卡通风格云朵
   */
  private drawCloud(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    c.beginPath()
    // 多个圆组成云朵
    const r = h * 0.5
    c.arc(x + w * 0.3, y + r, r * 0.8, 0, Math.PI * 2)
    c.arc(x + w * 0.5, y + r * 0.7, r, 0, Math.PI * 2)
    c.arc(x + w * 0.7, y + r, r * 0.9, 0, Math.PI * 2)
    c.arc(x + w * 0.4, y + r * 1.2, r * 0.6, 0, Math.PI * 2)
    c.arc(x + w * 0.6, y + r * 1.2, r * 0.7, 0, Math.PI * 2)
    c.fill()
  }

  dispose(): void {
    this.clouds = []
    this.hills = []
  }
}
