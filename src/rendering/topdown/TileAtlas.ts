// ============================================
// DD-OS 瓦片图集管理器 v2
// 完整的 RPG Urban Pack tilemap 映射
// ============================================

const TILE_SIZE = 16  // 每个瓦片 16x16 像素
const ATLAS_COLS = 30 // tilemap 列数

/**
 * 瓦片类型定义
 */
export interface TileInfo {
  id: number
  name: string
  col: number
  row: number
}

/**
 * 根据 tile 编号计算行列
 */
function t(id: number, name: string): TileInfo {
  return {
    id,
    name,
    col: id % ATLAS_COLS,
    row: Math.floor(id / ATLAS_COLS),
  }
}

/**
 * 完整瓦片索引
 */
export const TILES = {
  // === 草地/地面 (第 0-1 行) ===
  GRASS_1: t(0, 'grass-1'),
  GRASS_2: t(1, 'grass-2'),
  GRASS_3: t(2, 'grass-3'),
  GRASS_DARK_1: t(30, 'grass-dark-1'),
  GRASS_DARK_2: t(31, 'grass-dark-2'),
  GRASS_FLOWER: t(32, 'grass-flower'),
  
  // === 人行道 (第 2 行) ===
  SIDEWALK: t(66, 'sidewalk'),
  SIDEWALK_EDGE_T: t(60, 'sidewalk-edge-t'),
  SIDEWALK_EDGE_B: t(90, 'sidewalk-edge-b'),
  SIDEWALK_EDGE_L: t(65, 'sidewalk-edge-l'),
  SIDEWALK_EDGE_R: t(67, 'sidewalk-edge-r'),
  
  // === 道路 (第 3-5 行) ===
  ROAD_H: t(98, 'road-h'),
  ROAD_V: t(99, 'road-v'),
  ROAD_CROSS: t(100, 'road-cross'),
  ROAD_T_UP: t(101, 'road-t-up'),
  ROAD_T_DOWN: t(102, 'road-t-down'),
  ROAD_T_LEFT: t(103, 'road-t-left'),
  ROAD_T_RIGHT: t(104, 'road-t-right'),
  ROAD_CORNER_TL: t(105, 'road-corner-tl'),
  ROAD_CORNER_TR: t(106, 'road-corner-tr'),
  ROAD_CORNER_BL: t(107, 'road-corner-bl'),
  ROAD_CORNER_BR: t(108, 'road-corner-br'),
  ROAD_END_U: t(128, 'road-end-u'),
  ROAD_END_D: t(129, 'road-end-d'),
  ROAD_END_L: t(130, 'road-end-l'),
  ROAD_END_R: t(131, 'road-end-r'),
  
  // === 遮阳棚 (多种颜色) ===
  AWNING_ORANGE_L: t(151, 'awning-orange-l'),
  AWNING_ORANGE_M: t(152, 'awning-orange-m'),
  AWNING_ORANGE_R: t(153, 'awning-orange-r'),
  AWNING_GREEN_L: t(154, 'awning-green-l'),
  AWNING_GREEN_M: t(155, 'awning-green-m'),
  AWNING_GREEN_R: t(156, 'awning-green-r'),
  AWNING_BLUE_L: t(181, 'awning-blue-l'),
  AWNING_BLUE_M: t(182, 'awning-blue-m'),
  AWNING_BLUE_R: t(183, 'awning-blue-r'),
  AWNING_RED_L: t(184, 'awning-red-l'),
  AWNING_RED_M: t(185, 'awning-red-m'),
  AWNING_RED_R: t(186, 'awning-red-r'),
  
  // === 墙壁 (棕色系) ===
  WALL_BROWN_TL: t(180, 'wall-brown-tl'),
  WALL_BROWN_T: t(181, 'wall-brown-t'),
  WALL_BROWN_TR: t(182, 'wall-brown-tr'),
  WALL_BROWN_L: t(210, 'wall-brown-l'),
  WALL_BROWN_C: t(211, 'wall-brown-c'),
  WALL_BROWN_R: t(212, 'wall-brown-r'),
  WALL_BROWN_BL: t(240, 'wall-brown-bl'),
  WALL_BROWN_B: t(241, 'wall-brown-b'),
  WALL_BROWN_BR: t(242, 'wall-brown-br'),
  
  // === 墙壁 (灰色系) ===
  WALL_GRAY_TL: t(183, 'wall-gray-tl'),
  WALL_GRAY_T: t(184, 'wall-gray-t'),
  WALL_GRAY_TR: t(185, 'wall-gray-tr'),
  WALL_GRAY_L: t(213, 'wall-gray-l'),
  WALL_GRAY_C: t(214, 'wall-gray-c'),
  WALL_GRAY_R: t(215, 'wall-gray-r'),
  WALL_GRAY_BL: t(243, 'wall-gray-bl'),
  WALL_GRAY_B: t(244, 'wall-gray-b'),
  WALL_GRAY_BR: t(245, 'wall-gray-br'),
  
  // === 玻璃橱窗/门 ===
  GLASS_WINDOW_L: t(240, 'glass-window-l'),
  GLASS_WINDOW_M: t(241, 'glass-window-m'),
  GLASS_WINDOW_R: t(242, 'glass-window-r'),
  GLASS_DOOR: t(243, 'glass-door'),
  DOOR_BROWN: t(285, 'door-brown'),
  DOOR_BLUE: t(286, 'door-blue'),
  
  // === 室内家具 ===
  SHELF_BOOKS: t(248, 'shelf-books'),
  SHELF_ITEMS: t(249, 'shelf-items'),
  COUNTER: t(247, 'counter'),
  SOFA_PURPLE: t(245, 'sofa-purple'),
  SOFA_BLUE: t(246, 'sofa-blue'),
  TABLE: t(277, 'table'),
  CHAIR: t(278, 'chair'),
  COMPUTER: t(279, 'computer'),
  PLANT_POT: t(286, 'plant-pot'),
  CRATE: t(284, 'crate'),
  
  // === 屋顶 ===
  ROOF_RED_TL: t(120, 'roof-red-tl'),
  ROOF_RED_T: t(121, 'roof-red-t'),
  ROOF_RED_TR: t(122, 'roof-red-tr'),
  ROOF_RED_L: t(150, 'roof-red-l'),
  ROOF_RED_C: t(151, 'roof-red-c'),
  ROOF_RED_R: t(152, 'roof-red-r'),
  ROOF_BLUE_TL: t(123, 'roof-blue-tl'),
  ROOF_BLUE_T: t(124, 'roof-blue-t'),
  ROOF_BLUE_TR: t(125, 'roof-blue-tr'),
  ROOF_FLAT: t(66, 'roof-flat'),
  
  // === 装饰物 ===
  TREE_1: t(287, 'tree-1'),
  TREE_2: t(288, 'tree-2'),
  BUSH: t(289, 'bush'),
  FLOWER_RED: t(317, 'flower-red'),
  FLOWER_YELLOW: t(318, 'flower-yellow'),
  LAMP_POST: t(314, 'lamp-post'),
  BENCH: t(315, 'bench'),
  TRASH_CAN: t(316, 'trash-can'),
  BIKE_RACK: t(344, 'bike-rack'),
  SIGN_POST: t(345, 'sign-post'),
  
  // === 车辆 ===
  CAR_RED_T: t(346, 'car-red-t'),
  CAR_RED_B: t(376, 'car-red-b'),
  CAR_YELLOW_T: t(347, 'car-yellow-t'),
  CAR_YELLOW_B: t(377, 'car-yellow-b'),
  CAR_GREEN_T: t(348, 'car-green-t'),
  CAR_GREEN_B: t(378, 'car-green-b'),
  
  // === 角色 (4 方向, 每方向 4 帧) ===
  CHAR_DOWN_1: t(360, 'char-down-1'),
  CHAR_DOWN_2: t(361, 'char-down-2'),
  CHAR_DOWN_3: t(362, 'char-down-3'),
  CHAR_DOWN_4: t(363, 'char-down-4'),
  CHAR_UP_1: t(390, 'char-up-1'),
  CHAR_UP_2: t(391, 'char-up-2'),
  CHAR_LEFT_1: t(420, 'char-left-1'),
  CHAR_LEFT_2: t(421, 'char-left-2'),
  CHAR_RIGHT_1: t(450, 'char-right-1'),
  CHAR_RIGHT_2: t(451, 'char-right-2'),
} as const

/**
 * 遮阳棚颜色组
 */
export const AWNING_COLORS = {
  orange: { l: TILES.AWNING_ORANGE_L, m: TILES.AWNING_ORANGE_M, r: TILES.AWNING_ORANGE_R },
  green: { l: TILES.AWNING_GREEN_L, m: TILES.AWNING_GREEN_M, r: TILES.AWNING_GREEN_R },
  blue: { l: TILES.AWNING_BLUE_L, m: TILES.AWNING_BLUE_M, r: TILES.AWNING_BLUE_R },
  red: { l: TILES.AWNING_RED_L, m: TILES.AWNING_RED_M, r: TILES.AWNING_RED_R },
}

/**
 * 瓦片图集管理器
 */
export class TileAtlas {
  private image: HTMLImageElement | null = null
  private loaded = false
  private loadPromise: Promise<void> | null = null

  constructor() {
    this.loadPromise = this.load()
  }

  private async load(): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        this.image = img
        this.loaded = true
        console.log('[TileAtlas] Loaded RPG Urban Pack tilemap')
        resolve()
      }
      img.onerror = () => {
        console.error('[TileAtlas] Failed to load tilemap')
        reject(new Error('Failed to load tilemap'))
      }
      img.src = '/assets/kenney/rpg-urban-pack/Tilemap/tilemap.png'
    })
  }

  async waitForLoad(): Promise<void> {
    if (this.loaded) return
    await this.loadPromise
  }

  isLoaded(): boolean {
    return this.loaded
  }

  /**
   * 绘制单个瓦片到 canvas
   */
  drawTile(
    ctx: CanvasRenderingContext2D,
    tile: TileInfo,
    x: number,
    y: number,
    scale: number = 1,
  ): void {
    if (!this.image) return

    const sx = tile.col * TILE_SIZE
    const sy = tile.row * TILE_SIZE
    const destSize = TILE_SIZE * scale

    ctx.drawImage(
      this.image,
      sx, sy, TILE_SIZE, TILE_SIZE,
      x, y, destSize, destSize,
    )
  }

  /**
   * 按行列绘制瓦片
   */
  drawTileByPos(
    ctx: CanvasRenderingContext2D,
    col: number,
    row: number,
    x: number,
    y: number,
    scale: number = 1,
  ): void {
    if (!this.image) return

    const sx = col * TILE_SIZE
    const sy = row * TILE_SIZE
    const destSize = TILE_SIZE * scale

    ctx.drawImage(
      this.image,
      sx, sy, TILE_SIZE, TILE_SIZE,
      x, y, destSize, destSize,
    )
  }

  /**
   * 按 tile ID 绘制瓦片
   */
  drawTileById(
    ctx: CanvasRenderingContext2D,
    tileId: number,
    x: number,
    y: number,
    scale: number = 1,
  ): void {
    const col = tileId % ATLAS_COLS
    const row = Math.floor(tileId / ATLAS_COLS)
    this.drawTileByPos(ctx, col, row, x, y, scale)
  }

  getTileSize(): number {
    return TILE_SIZE
  }

  dispose(): void {
    this.image = null
    this.loaded = false
  }
}

// 单例
let atlasInstance: TileAtlas | null = null

export function getTileAtlas(): TileAtlas {
  if (!atlasInstance) {
    atlasInstance = new TileAtlas()
  }
  return atlasInstance
}

export { TILE_SIZE, ATLAS_COLS }
