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

// 俯视角城市主题 (RPG Urban Pack)
import { TopDownBackground } from './topdown/TopDownBackground'
import { TopDownGrid } from './topdown/TopDownGrid'
import { TopDownBuildingRenderer } from './topdown/TopDownBuildingRenderer'
import { NPCRenderer } from './topdown/NPCRenderer'

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
 * RPG Urban Pack 俯视角城市
 */
export function createCityscapeRenderers(): RendererSet {
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
    entities: [new BlockRenderer()],
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

// 俯视角城市渲染器
export * from './topdown'
