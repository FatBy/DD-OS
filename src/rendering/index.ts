// ============================================
// DD-OS 渲染器集合工厂
// ============================================

import type { RendererSet } from './types'
import { CosmosBackgroundRenderer } from './backgrounds/CosmosBackground'
import { CosmosGridRenderer } from './backgrounds/CosmosGrid'
import { CosmosRippleRenderer } from './backgrounds/CosmosRipple'
import { PlanetRenderer } from './entities/PlanetRenderer'
// CosmosCoreRenderer 已禁用 - 不再渲染中心核心
// import { CosmosCoreRenderer } from './cores/CosmosCore'

// 极简主题
import { MinimalistBackground } from './backgrounds/MinimalistBackground'
import { MinimalistGrid } from './backgrounds/MinimalistGrid'
import { BlockRenderer } from './entities/BlockRenderer'
import { MinimalistDecoRenderer } from './decorations/MinimalistDecoRenderer'

// 村庄主题 (纯色俯视角)
import { TopDownBackground } from './topdown/TopDownBackground'
import { TopDownGrid } from './topdown/TopDownGrid'
import { TopDownBuildingRenderer } from './topdown/TopDownBuildingRenderer'
import { NPCRenderer } from './topdown/NPCRenderer'

// 等轴测城市主题 (isometric-city 资源包)
import { IsometricBackground } from './isometric/IsometricBackground'
import { IsometricGrid } from './isometric/IsometricGrid'
import { IsometricBuildingRenderer } from './isometric/IsometricBuildingRenderer'

// Smallville 像素 RPG 村庄主题
import { SmallvilleViewManager, SmallvilleBackground, SmallvilleGrid, SmallvilleBuildingRenderer, SmallvilleNPCRenderer } from './smallville'
import { SmallvilleRoomRenderer } from './smallville/SmallvilleRoomRenderer'
import { SmallvilleAgentRenderer } from './smallville/SmallvilleAgentRenderer'
import { SmallvilleSpriteAtlas } from './smallville/SmallvilleSpriteAtlas'

// 像素小镇主题 (Canvas 手绘风格)
import { PixelTownBackground } from './pixeltown/PixelTownBackground'
import { PixelTownGrid } from './pixeltown/PixelTownGrid'
import { PixelTownBuildingRenderer } from './pixeltown/PixelTownBuildingRenderer'
import { PixelTownDecoRenderer } from './pixeltown/PixelTownDecoRenderer'

/**
 * 创建 Cosmos 主题渲染器集合
 */
export function createCosmosRenderers(): RendererSet {
  return {
    background: new CosmosBackgroundRenderer(),
    grid: new CosmosGridRenderer(),
    entities: [new PlanetRenderer()],
    particles: [], // 星空粒子已集成在 background 中
    // core 已移除 - 不再渲染中心能量核心
    ripple: new CosmosRippleRenderer(),
  }
}

/**
 * 创建 Cityscape 主题渲染器集合
 * 等轴测城市 (isometric-city 2.5D 资源)
 */
export function createCityscapeRenderers(): RendererSet {
  return {
    background: new IsometricBackground(),
    grid: new IsometricGrid(),
    entities: [new IsometricBuildingRenderer()],
    particles: [],
    ripple: new CosmosRippleRenderer(),
  }
}

/**
 * 创建 Village 主题渲染器集合
 * 纯色俯视角村庄
 */
export function createVillageRenderers(): RendererSet {
  const npcRenderer = new NPCRenderer()
  return {
    background: new TopDownBackground(),
    grid: new TopDownGrid(),
    entities: [new TopDownBuildingRenderer()],
    particles: [npcRenderer],  // NPC 作为粒子渲染
    ripple: new CosmosRippleRenderer(),
  }
}

/**
 * 创建 Minimalist 主题渲染器集合
 * 治愈系几何积木 - Stripe/Monument Valley 风格
 */
export function createMinimalistRenderers(): RendererSet {
  return {
    background: new MinimalistBackground(),
    grid: new MinimalistGrid(),
    decorations: new MinimalistDecoRenderer(),
    entities: [new BlockRenderer()],
    particles: [],
    ripple: new CosmosRippleRenderer(),
  }
}

/**
 * 创建 Smallville 主题渲染器集合
 * 像素 RPG 村庄 (Kenney RPG Urban Pack 瓦片)
 */
export function createSmallvilleRenderers(): RendererSet {
  const atlas = new SmallvilleSpriteAtlas()
  const viewManager = new SmallvilleViewManager()
  const grid = new SmallvilleGrid(viewManager, atlas)
  const npcRenderer = new SmallvilleNPCRenderer(viewManager, atlas)
  const roomRenderer = new SmallvilleRoomRenderer(viewManager, atlas)
  const agentRenderer = new SmallvilleAgentRenderer(viewManager, atlas)
  return {
    background: new SmallvilleBackground(viewManager, atlas),
    grid,
    entities: [new SmallvilleBuildingRenderer(viewManager, atlas)],
    particles: [npcRenderer, roomRenderer, agentRenderer],
    ripple: new CosmosRippleRenderer(),
  }
}

/**
 * 创建 PixelTown 主题渲染器集合
 * Canvas 手绘像素小镇 - 基于 Minimalist 设计语言
 */
export function createPixelTownRenderers(): RendererSet {
  return {
    background: new PixelTownBackground(),
    grid: new PixelTownGrid(),
    decorations: new PixelTownDecoRenderer(),
    entities: [new PixelTownBuildingRenderer()],
    particles: [],
    ripple: new CosmosRippleRenderer(),
  }
}

// 导出所有类型
export * from './types'

// 导出注册表
export { RendererRegistry, createEmptyRendererSet, mergeRendererSets } from './RendererRegistry'

// 导出工具函数
export { worldToScreen, screenToWorld, isInViewport, TILE_WIDTH, TILE_HEIGHT } from './utils/coordinateTransforms'
export { createBufferCanvas, getBufferContext, LRUCache, RenderCacheManager } from './utils/cacheManager'

// 导出渲染器类 (供扩展使用)
export { CosmosBackgroundRenderer } from './backgrounds/CosmosBackground'
export { CosmosGridRenderer } from './backgrounds/CosmosGrid'
export { CosmosRippleRenderer } from './backgrounds/CosmosRipple'
export { PlanetRenderer } from './entities/PlanetRenderer'
export { CosmosCoreRenderer } from './cores/CosmosCore'

// 极简主题渲染器
export { MinimalistBackground } from './backgrounds/MinimalistBackground'
export { MinimalistGrid } from './backgrounds/MinimalistGrid'
export { BlockRenderer } from './entities/BlockRenderer'
export { MinimalistDecoRenderer } from './decorations/MinimalistDecoRenderer'

// 俯视角村庄渲染器
export * from './topdown'

// 等轴测城市渲染器
export * from './isometric'

// Smallville 像素 RPG 村庄渲染器
export * from './smallville'

// 像素小镇渲染器 (Canvas 手绘)
export * from './pixeltown'
