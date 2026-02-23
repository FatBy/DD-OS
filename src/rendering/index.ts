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
// 城市主题
import { CityBackground } from './backgrounds/CityBackground'
import { CityGrid } from './backgrounds/CityGrid'
import { BuildingRenderer } from './entities/BuildingRenderer'
import { DecorationRenderer } from './entities/DecorationRenderer'

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
 */
export function createCityscapeRenderers(): RendererSet {
  return {
    background: new CityBackground(),
    grid: new CityGrid(),
    decorations: new DecorationRenderer(),
    entities: [new BuildingRenderer()],
    particles: [], // 城市主题暂无粒子效果
    // core 已移除 - 不再渲染中心能量核心
    ripple: new CosmosRippleRenderer(), // 复用涟漪效果
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
// 城市主题渲染器
export { CityBackground } from './backgrounds/CityBackground'
export { CityGrid } from './backgrounds/CityGrid'
export { BuildingRenderer } from './entities/BuildingRenderer'
export { DecorationRenderer } from './entities/DecorationRenderer'
