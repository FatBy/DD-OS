// ============================================
// DD-OS 等轴测城市瓦片管理器
// 管理 isometric-city 和 isometric-buildings-1 资源包
// ============================================

/**
 * 等轴测瓦片尺寸
 * isometric-city 瓦片大约是 132x101 像素
 * isometric-buildings-1 瓦片大约是 131x101 像素
 */
export const ISO_TILE_WIDTH = 132
export const ISO_TILE_HEIGHT = 101

/**
 * 等轴测瓦片类型
 */
export type IsoTileCategory = 
  | 'ground'      // 地面
  | 'road'        // 道路
  | 'building'    // 建筑
  | 'decoration'  // 装饰（树木等）
  | 'water'       // 水体

/**
 * 瓦片定义
 */
export interface IsoTileInfo {
  id: number
  name: string
  category: IsoTileCategory
  path: string
}

/**
 * 定义 isometric-city 瓦片
 */
function cityTile(id: number, name: string, category: IsoTileCategory): IsoTileInfo {
  return {
    id,
    name,
    category,
    path: `/assets/kenney/isometric-city/PNG/cityTiles_${id.toString().padStart(3, '0')}.png`,
  }
}

/**
 * 定义 isometric-buildings-1 瓦片 (ID 偏移 1000 避免冲突)
 */
function buildingTile(id: number, name: string): IsoTileInfo {
  return {
    id: 1000 + id,
    name,
    category: 'building',
    path: `/assets/kenney/isometric-buildings-1/PNG/buildingTiles_${id.toString().padStart(3, '0')}.png`,
  }
}

/**
 * 等轴测城市瓦片索引
 */
export const ISO_TILES = {
  // === 地面/基础 (isometric-city) ===
  GROUND_PLAIN: cityTile(66, 'ground-plain', 'ground'),
  GROUND_GRASS: cityTile(72, 'ground-grass', 'ground'),
  
  // === 道路 (isometric-city) ===
  ROAD_STRAIGHT_H: cityTile(94, 'road-straight-h', 'road'),
  ROAD_STRAIGHT_V: cityTile(95, 'road-straight-v', 'road'),
  ROAD_CORNER_1: cityTile(96, 'road-corner-1', 'road'),
  ROAD_CORNER_2: cityTile(97, 'road-corner-2', 'road'),
  ROAD_CORNER_3: cityTile(98, 'road-corner-3', 'road'),
  ROAD_CROSS: cityTile(99, 'road-cross', 'road'),
  ROAD_T_1: cityTile(100, 'road-t-1', 'road'),
  ROAD_T_2: cityTile(101, 'road-t-2', 'road'),
  ROAD_T_3: cityTile(102, 'road-t-3', 'road'),
  
  // === 装饰（树木）(isometric-city) ===
  TREE_ROAD_1: cityTile(36, 'tree-road-1', 'decoration'),
  TREE_ROAD_2: cityTile(44, 'tree-road-2', 'decoration'),
  TREE_SINGLE: cityTile(67, 'tree-single', 'decoration'),
  TREE_GRASS_1: cityTile(75, 'tree-grass-1', 'decoration'),
  TREE_GRASS_2: cityTile(83, 'tree-grass-2', 'decoration'),
  
  // === 水体 (isometric-city) ===
  POOL_1: cityTile(46, 'pool-1', 'water'),
  POOL_2: cityTile(53, 'pool-2', 'water'),
  POOL_3: cityTile(60, 'pool-3', 'water'),
  
  // === 高层建筑 (isometric-buildings-1) - 摩天大楼 ===
  SKYSCRAPER_BLUE_1: buildingTile(0, 'skyscraper-blue-1'),
  SKYSCRAPER_BLUE_2: buildingTile(1, 'skyscraper-blue-2'),
  SKYSCRAPER_BLUE_3: buildingTile(2, 'skyscraper-blue-3'),
  SKYSCRAPER_GREEN_1: buildingTile(8, 'skyscraper-green-1'),
  SKYSCRAPER_GREEN_2: buildingTile(9, 'skyscraper-green-2'),
  SKYSCRAPER_ORANGE_1: buildingTile(16, 'skyscraper-orange-1'),
  SKYSCRAPER_ORANGE_2: buildingTile(17, 'skyscraper-orange-2'),
  SKYSCRAPER_RED_1: buildingTile(24, 'skyscraper-red-1'),
  SKYSCRAPER_RED_2: buildingTile(25, 'skyscraper-red-2'),
  
  // === 中层建筑 (isometric-buildings-1) - 办公楼 ===
  OFFICE_BLUE_1: buildingTile(3, 'office-blue-1'),
  OFFICE_BLUE_2: buildingTile(4, 'office-blue-2'),
  OFFICE_GREEN_1: buildingTile(10, 'office-green-1'),
  OFFICE_GREEN_2: buildingTile(11, 'office-green-2'),
  OFFICE_ORANGE_1: buildingTile(18, 'office-orange-1'),
  OFFICE_ORANGE_2: buildingTile(19, 'office-orange-2'),
  OFFICE_RED_1: buildingTile(26, 'office-red-1'),
  OFFICE_RED_2: buildingTile(27, 'office-red-2'),
  
  // === 低层建筑 (isometric-buildings-1) - 商店/住宅 ===
  SHOP_BLUE_1: buildingTile(5, 'shop-blue-1'),
  SHOP_BLUE_2: buildingTile(6, 'shop-blue-2'),
  SHOP_GREEN_1: buildingTile(12, 'shop-green-1'),
  SHOP_GREEN_2: buildingTile(13, 'shop-green-2'),
  SHOP_ORANGE_1: buildingTile(20, 'shop-orange-1'),
  SHOP_ORANGE_2: buildingTile(21, 'shop-orange-2'),
  SHOP_RED_1: buildingTile(28, 'shop-red-1'),
  SHOP_RED_2: buildingTile(29, 'shop-red-2'),
  
  // === 特殊建筑 (isometric-buildings-1) ===
  WAREHOUSE_1: buildingTile(32, 'warehouse-1'),
  WAREHOUSE_2: buildingTile(33, 'warehouse-2'),
  WAREHOUSE_3: buildingTile(40, 'warehouse-3'),
  FACTORY_1: buildingTile(48, 'factory-1'),
  FACTORY_2: buildingTile(49, 'factory-2'),
  FACTORY_3: buildingTile(56, 'factory-3'),
  
  // === 住宅 (isometric-buildings-1) ===
  HOUSE_1: buildingTile(64, 'house-1'),
  HOUSE_2: buildingTile(65, 'house-2'),
  HOUSE_3: buildingTile(72, 'house-3'),
  HOUSE_4: buildingTile(73, 'house-4'),
  
  // === 公共建筑 (isometric-buildings-1) ===
  HOSPITAL: buildingTile(80, 'hospital'),
  SCHOOL: buildingTile(81, 'school'),
  LIBRARY: buildingTile(88, 'library'),
  MUSEUM: buildingTile(89, 'museum'),
} as const

/**
 * 建筑类型到瓦片的映射 (根据 Nexus 风格选择合适的建筑)
 */
export const BUILDING_STYLE_TILES: Record<string, IsoTileInfo[]> = {
  // 商店类 - 低层建筑
  shop: [
    ISO_TILES.SHOP_BLUE_1, ISO_TILES.SHOP_BLUE_2,
    ISO_TILES.SHOP_GREEN_1, ISO_TILES.SHOP_GREEN_2,
    ISO_TILES.SHOP_ORANGE_1, ISO_TILES.SHOP_ORANGE_2,
  ],
  
  // 工作坊类 - 工厂建筑
  workshop: [
    ISO_TILES.FACTORY_1, ISO_TILES.FACTORY_2, ISO_TILES.FACTORY_3,
    ISO_TILES.WAREHOUSE_1, ISO_TILES.WAREHOUSE_2,
  ],
  
  // 图书馆类 - 公共建筑
  library: [
    ISO_TILES.LIBRARY, ISO_TILES.MUSEUM,
    ISO_TILES.OFFICE_BLUE_1, ISO_TILES.OFFICE_GREEN_1,
  ],
  
  // 工厂类 - 工业建筑
  factory: [
    ISO_TILES.FACTORY_1, ISO_TILES.FACTORY_2, ISO_TILES.FACTORY_3,
    ISO_TILES.WAREHOUSE_1, ISO_TILES.WAREHOUSE_2, ISO_TILES.WAREHOUSE_3,
  ],
  
  // 保险库类 - 办公楼
  vault: [
    ISO_TILES.OFFICE_BLUE_1, ISO_TILES.OFFICE_BLUE_2,
    ISO_TILES.OFFICE_RED_1, ISO_TILES.OFFICE_RED_2,
  ],
  
  // 传送门类 - 摩天大楼
  portal: [
    ISO_TILES.SKYSCRAPER_BLUE_1, ISO_TILES.SKYSCRAPER_BLUE_2,
    ISO_TILES.SKYSCRAPER_GREEN_1, ISO_TILES.SKYSCRAPER_ORANGE_1,
  ],
  
  // 档案馆类 - 中层建筑
  archive: [
    ISO_TILES.OFFICE_GREEN_1, ISO_TILES.OFFICE_GREEN_2,
    ISO_TILES.OFFICE_ORANGE_1, ISO_TILES.OFFICE_ORANGE_2,
  ],
  
  // 默认 - 混合建筑
  default: [
    ISO_TILES.OFFICE_BLUE_1, ISO_TILES.SHOP_GREEN_1,
    ISO_TILES.SKYSCRAPER_BLUE_1, ISO_TILES.HOUSE_1,
  ],
}

/**
 * 等轴测瓦片图集管理器
 */
export class IsometricTileAtlas {
  private images: Map<number, HTMLImageElement> = new Map()
  private loadPromises: Map<number, Promise<HTMLImageElement>> = new Map()
  private loadedCount = 0
  private totalCount = 0

  constructor() {
    // 预加载常用瓦片
    this.preloadTiles()
  }

  private preloadTiles(): void {
    const tilesToLoad = Object.values(ISO_TILES)
    this.totalCount = tilesToLoad.length

    for (const tile of tilesToLoad) {
      this.loadTile(tile.id, tile.path)
    }
  }

  private loadTile(id: number, path: string): Promise<HTMLImageElement> {
    if (this.loadPromises.has(id)) {
      return this.loadPromises.get(id)!
    }

    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        this.images.set(id, img)
        this.loadedCount++
        resolve(img)
      }
      img.onerror = () => {
        console.warn(`[IsometricTileAtlas] Failed to load tile ${id}: ${path}`)
        reject(new Error(`Failed to load tile ${id}`))
      }
      img.src = path
    })

    this.loadPromises.set(id, promise)
    return promise
  }

  async waitForLoad(): Promise<void> {
    await Promise.allSettled(this.loadPromises.values())
    console.log(`[IsometricTileAtlas] Loaded ${this.loadedCount}/${this.totalCount} tiles`)
  }

  isLoaded(): boolean {
    return this.loadedCount > 0
  }

  getLoadProgress(): number {
    return this.totalCount > 0 ? this.loadedCount / this.totalCount : 0
  }

  /**
   * 获取瓦片图像
   */
  getImage(tileId: number): HTMLImageElement | null {
    return this.images.get(tileId) || null
  }

  /**
   * 绘制等轴测瓦片
   */
  drawTile(
    ctx: CanvasRenderingContext2D,
    tile: IsoTileInfo,
    x: number,
    y: number,
    scale: number = 1,
  ): void {
    const img = this.images.get(tile.id)
    if (!img) return

    const w = img.width * scale
    const h = img.height * scale

    // 等轴测瓦片中心对齐
    ctx.drawImage(img, x - w / 2, y - h / 2, w, h)
  }

  dispose(): void {
    this.images.clear()
    this.loadPromises.clear()
    this.loadedCount = 0
  }
}

// 单例
let atlasInstance: IsometricTileAtlas | null = null

export function getIsometricTileAtlas(): IsometricTileAtlas {
  if (!atlasInstance) {
    atlasInstance = new IsometricTileAtlas()
  }
  return atlasInstance
}
