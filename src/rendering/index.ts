// ============================================
// Cosmos 主题渲染器集合工厂
// ============================================

import type { RendererSet } from './types'
import { CosmosBackgroundRenderer } from './backgrounds/CosmosBackground'
import { CosmosGridRenderer } from './backgrounds/CosmosGrid'
import { CosmosRippleRenderer } from './backgrounds/CosmosRipple'
import { PlanetRenderer } from './entities/PlanetRenderer'
import { CosmosCoreRenderer } from './cores/CosmosCore'

/**
 * 创建 Cosmos 主题渲染器集合
 */
export function createCosmosRenderers(): RendererSet {
  return {
    background: new CosmosBackgroundRenderer(),
    grid: new CosmosGridRenderer(),
    entities: [new PlanetRenderer()],
    particles: [], // 星空粒子已集成在 background 中
    core: new CosmosCoreRenderer(),
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
