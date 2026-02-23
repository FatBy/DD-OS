// ============================================
// DD-OS 俯视角城市渲染器
// 使用 RPG Urban Pack 瓦片渲染城市
// ============================================

import type { NexusEntity } from '@/types'
import type { EntityRenderer, RenderContext, Point } from '../types'
import { getTileAtlas, TILE_SIZE } from './TileAtlas'
import { generateBuildingRecipe, type BuildingRecipe } from './BuildingGenerator'

// 缩放因子 (16px 原始尺寸太小)
const RENDER_SCALE = 3

/**
 * 从 visualDNA 获取发光颜色
 */
function getGlowColor(nexus: NexusEntity): string {
  const hue = nexus.visualDNA?.primaryHue ?? 180
  return `hsl(${hue}, 80%, 60%)`
}

/**
 * 俯视角建筑渲染器
 */
export class TopDownBuildingRenderer implements EntityRenderer {
  readonly id = 'topdown-building-renderer'

  private atlas = getTileAtlas()
  private recipeCache: Map<string, BuildingRecipe> = new Map()
  private executingNexusId: string | null = null
  private executionStartTime: number | null = null

  canRender(_nexus: NexusEntity): boolean {
    return true
  }

  setDpr(_dpr: number): void {
    // 瓦片渲染不需要 DPR 处理
  }

  setExecutionState(nexusId: string | null, startTime: number | null): void {
    this.executingNexusId = nexusId
    this.executionStartTime = startTime
  }

  private getRecipe(nexus: NexusEntity): BuildingRecipe {
    let recipe = this.recipeCache.get(nexus.id)
    if (!recipe) {
      recipe = generateBuildingRecipe(nexus)
      this.recipeCache.set(nexus.id, recipe)
    }
    return recipe
  }

  render(
    ctx: RenderContext,
    nexus: NexusEntity,
    screenPos: Point,
    isSelected: boolean,
    timestamp: number,
  ): void {
    if (!this.atlas.isLoaded()) return

    const { ctx: c, camera } = ctx
    const isExecuting = nexus.id === this.executingNexusId
    const recipe = this.getRecipe(nexus)

    // 计算缩放
    const scale = RENDER_SCALE * camera.zoom
    const tileSize = TILE_SIZE * scale

    // 建筑总尺寸
    const buildingWidth = recipe.width * tileSize
    const buildingHeight = recipe.height * tileSize

    // 建筑中心对齐到屏幕位置
    const startX = screenPos.x - buildingWidth / 2
    const startY = screenPos.y - buildingHeight / 2

    // 构造进度
    const buildProgress = nexus.constructionProgress ?? 1

    c.save()
    c.globalAlpha = 0.3 + 0.7 * buildProgress

    // 执行时发光效果
    if (isExecuting || isSelected) {
      const glowColor = getGlowColor(nexus)
      const pulse = isExecuting
        ? 0.6 + 0.4 * Math.sin(timestamp / 200)
        : 0.8
      c.shadowColor = glowColor
      c.shadowBlur = 20 * pulse
    }

    // 绘制人行道/地基
    const padTiles = 1
    const padSize = padTiles * tileSize
    c.fillStyle = '#a8a8a8'
    c.fillRect(
      startX - padSize,
      startY - padSize,
      buildingWidth + padSize * 2,
      buildingHeight + padSize * 2,
    )

    // 绘制建筑瓦片
    for (let row = 0; row < recipe.tiles.length; row++) {
      for (let col = 0; col < recipe.tiles[row].length; col++) {
        const tile = recipe.tiles[row][col]
        const x = startX + col * tileSize
        const y = startY + row * tileSize
        this.atlas.drawTile(c, tile, x, y, scale)
      }
    }

    // 选中高亮边框
    if (isSelected) {
      c.strokeStyle = getGlowColor(nexus)
      c.lineWidth = 3
      c.strokeRect(
        startX - padSize - 2,
        startY - padSize - 2,
        buildingWidth + padSize * 2 + 4,
        buildingHeight + padSize * 2 + 4,
      )
    }

    c.shadowColor = 'transparent'
    c.shadowBlur = 0
    c.globalAlpha = 1
    c.restore()

    // 标签
    if (nexus.label) {
      this.drawLabel(c, nexus, screenPos, buildingHeight / 2 + 30, isSelected)
    }

    // 执行指示器
    if (isExecuting && this.executionStartTime) {
      this.drawExecutionIndicator(c, screenPos, timestamp, nexus)
    }
  }

  private drawLabel(
    ctx: CanvasRenderingContext2D,
    nexus: NexusEntity,
    pos: Point,
    offsetY: number,
    isSelected: boolean,
  ): void {
    const label = nexus.label || nexus.id.slice(0, 8)

    ctx.font = `600 ${isSelected ? 13 : 11}px "SF Mono", "Fira Code", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    const metrics = ctx.measureText(label)
    const padding = 6
    const bgWidth = metrics.width + padding * 2
    const bgHeight = 18
    const bgX = pos.x - bgWidth / 2
    const bgY = pos.y + offsetY

    ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 4)
    ctx.fill()

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.fillStyle = isSelected ? '#1a1a2e' : '#333'
    ctx.fillText(label, pos.x, bgY + 3)
  }

  private drawExecutionIndicator(
    ctx: CanvasRenderingContext2D,
    pos: Point,
    timestamp: number,
    nexus: NexusEntity,
  ): void {
    const glowColor = getGlowColor(nexus)
    const elapsed = timestamp - (this.executionStartTime || timestamp)
    const pulse = 0.5 + 0.5 * Math.sin(elapsed / 150)

    ctx.save()
    ctx.translate(pos.x, pos.y - 50)
    ctx.rotate(elapsed / 500)

    ctx.strokeStyle = glowColor
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.globalAlpha = pulse

    ctx.beginPath()
    ctx.arc(0, 0, 14, 0, Math.PI * 1.5)
    ctx.stroke()

    ctx.restore()
  }

  invalidateCache(nexusId: string): void {
    this.recipeCache.delete(nexusId)
  }

  clearCache(): void {
    this.recipeCache.clear()
  }

  dispose(): void {
    this.recipeCache.clear()
  }
}
