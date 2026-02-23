// ============================================
// DD-OS 瓦片图集管理器
// 加载 RPG Urban Pack tilemap 并提供切片访问
// ============================================

const TILE_SIZE = 16  // 每个瓦片 16x16 像素
const ATLAS_COLS = 30 // tilemap 列数
const ATLAS_ROWS = 12 // tilemap 行数

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
 * 预定义瓦片索引（基于 tilemap 布局）
 */
export const TILES = {
  // === 道路瓦片 (第 3-4 行, 列 8-14) ===
  ROAD_H: { id: 98, name: 'road-horizontal', col: 8, row: 3 },
  ROAD_V: { id: 99, name: 'road-vertical', col: 9, row: 3 },
  ROAD_CROSS: { id: 100, name: 'road-cross', col: 10, row: 3 },
  ROAD_T_UP: { id: 101, name: 'road-t-up', col: 11, row: 3 },
  ROAD_T_DOWN: { id: 102, name: 'road-t-down', col: 12, row: 3 },
  ROAD_T_LEFT: { id: 103, name: 'road-t-left', col: 13, row: 3 },
  ROAD_T_RIGHT: { id: 104, name: 'road-t-right', col: 8, row: 4 },
  ROAD_CORNER_TL: { id: 105, name: 'road-corner-tl', col: 9, row: 4 },
  ROAD_CORNER_TR: { id: 106, name: 'road-corner-tr', col: 10, row: 4 },
  ROAD_CORNER_BL: { id: 107, name: 'road-corner-bl', col: 11, row: 4 },
  ROAD_CORNER_BR: { id: 108, name: 'road-corner-br', col: 12, row: 4 },
  ROAD_END_U: { id: 109, name: 'road-end-up', col: 13, row: 4 },
  ROAD_END_D: { id: 110, name: 'road-end-down', col: 8, row: 5 },
  ROAD_END_L: { id: 111, name: 'road-end-left', col: 9, row: 5 },
  ROAD_END_R: { id: 112, name: 'road-end-right', col: 10, row: 5 },

  // === 草地/地面 ===
  GRASS: { id: 0, name: 'grass', col: 0, row: 0 },
  GRASS_DARK: { id: 1, name: 'grass-dark', col: 1, row: 0 },
  SIDEWALK: { id: 66, name: 'sidewalk', col: 6, row: 2 },

  // === 建筑墙壁 (棕色系) ===
  WALL_BROWN_TL: { id: 180, name: 'wall-brown-tl', col: 0, row: 6 },
  WALL_BROWN_T: { id: 181, name: 'wall-brown-t', col: 1, row: 6 },
  WALL_BROWN_TR: { id: 182, name: 'wall-brown-tr', col: 2, row: 6 },
  WALL_BROWN_L: { id: 210, name: 'wall-brown-l', col: 0, row: 7 },
  WALL_BROWN_C: { id: 211, name: 'wall-brown-c', col: 1, row: 7 },
  WALL_BROWN_R: { id: 212, name: 'wall-brown-r', col: 2, row: 7 },
  WALL_BROWN_BL: { id: 240, name: 'wall-brown-bl', col: 0, row: 8 },
  WALL_BROWN_B: { id: 241, name: 'wall-brown-b', col: 1, row: 8 },
  WALL_BROWN_BR: { id: 242, name: 'wall-brown-br', col: 2, row: 8 },

  // === 建筑墙壁 (灰色系) ===
  WALL_GRAY_TL: { id: 183, name: 'wall-gray-tl', col: 3, row: 6 },
  WALL_GRAY_T: { id: 184, name: 'wall-gray-t', col: 4, row: 6 },
  WALL_GRAY_TR: { id: 185, name: 'wall-gray-tr', col: 5, row: 6 },
  WALL_GRAY_L: { id: 213, name: 'wall-gray-l', col: 3, row: 7 },
  WALL_GRAY_C: { id: 214, name: 'wall-gray-c', col: 4, row: 7 },
  WALL_GRAY_R: { id: 215, name: 'wall-gray-r', col: 5, row: 7 },
  WALL_GRAY_BL: { id: 243, name: 'wall-gray-bl', col: 3, row: 8 },
  WALL_GRAY_B: { id: 244, name: 'wall-gray-b', col: 4, row: 8 },
  WALL_GRAY_BR: { id: 245, name: 'wall-gray-br', col: 5, row: 8 },

  // === 屋顶 (红色) ===
  ROOF_RED_TL: { id: 150, name: 'roof-red-tl', col: 15, row: 0 },
  ROOF_RED_T: { id: 151, name: 'roof-red-t', col: 16, row: 0 },
  ROOF_RED_TR: { id: 152, name: 'roof-red-tr', col: 17, row: 0 },
  ROOF_RED_L: { id: 180, name: 'roof-red-l', col: 15, row: 1 },
  ROOF_RED_C: { id: 181, name: 'roof-red-c', col: 16, row: 1 },
  ROOF_RED_R: { id: 182, name: 'roof-red-r', col: 17, row: 1 },

  // === 屋顶 (棕色) ===
  ROOF_BROWN_TL: { id: 153, name: 'roof-brown-tl', col: 18, row: 0 },
  ROOF_BROWN_T: { id: 154, name: 'roof-brown-t', col: 19, row: 0 },
  ROOF_BROWN_TR: { id: 155, name: 'roof-brown-tr', col: 20, row: 0 },
  ROOF_BROWN_L: { id: 183, name: 'roof-brown-l', col: 18, row: 1 },
  ROOF_BROWN_C: { id: 184, name: 'roof-brown-c', col: 19, row: 1 },
  ROOF_BROWN_R: { id: 185, name: 'roof-brown-r', col: 20, row: 1 },

  // === 门窗 ===
  DOOR_BROWN: { id: 186, name: 'door-brown', col: 13, row: 7 },
  DOOR_BLUE: { id: 187, name: 'door-blue', col: 14, row: 7 },
  WINDOW_1: { id: 188, name: 'window-1', col: 15, row: 7 },
  WINDOW_2: { id: 189, name: 'window-2', col: 16, row: 7 },

  // === 装饰物 ===
  TREE_1: { id: 270, name: 'tree-1', col: 14, row: 9 },
  TREE_2: { id: 271, name: 'tree-2', col: 15, row: 9 },
  BUSH_1: { id: 272, name: 'bush-1', col: 16, row: 9 },
  CAR_RED: { id: 273, name: 'car-red', col: 17, row: 9 },
  CAR_YELLOW: { id: 274, name: 'car-yellow', col: 18, row: 9 },

  // === 角色 (4 方向, 每方向 4 帧) ===
  CHAR_DOWN_1: { id: 300, name: 'char-down-1', col: 24, row: 0 },
  CHAR_DOWN_2: { id: 301, name: 'char-down-2', col: 25, row: 0 },
  CHAR_DOWN_3: { id: 302, name: 'char-down-3', col: 26, row: 0 },
  CHAR_DOWN_4: { id: 303, name: 'char-down-4', col: 27, row: 0 },
  CHAR_UP_1: { id: 304, name: 'char-up-1', col: 24, row: 1 },
  CHAR_UP_2: { id: 305, name: 'char-up-2', col: 25, row: 1 },
  CHAR_UP_3: { id: 306, name: 'char-up-3', col: 26, row: 1 },
  CHAR_UP_4: { id: 307, name: 'char-up-4', col: 27, row: 1 },
  CHAR_LEFT_1: { id: 308, name: 'char-left-1', col: 24, row: 2 },
  CHAR_LEFT_2: { id: 309, name: 'char-left-2', col: 25, row: 2 },
  CHAR_LEFT_3: { id: 310, name: 'char-left-3', col: 26, row: 2 },
  CHAR_LEFT_4: { id: 311, name: 'char-left-4', col: 27, row: 2 },
  CHAR_RIGHT_1: { id: 312, name: 'char-right-1', col: 24, row: 3 },
  CHAR_RIGHT_2: { id: 313, name: 'char-right-2', col: 25, row: 3 },
  CHAR_RIGHT_3: { id: 314, name: 'char-right-3', col: 26, row: 3 },
  CHAR_RIGHT_4: { id: 315, name: 'char-right-4', col: 27, row: 3 },
} as const

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
   * 获取瓦片尺寸
   */
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

export { TILE_SIZE, ATLAS_COLS, ATLAS_ROWS }
