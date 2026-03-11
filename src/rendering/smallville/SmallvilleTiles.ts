// ============================================
// Smallville 瓦片 ID 常量
// 来源: map.json 频率分析 + sprites.png 视觉验证
// 转换公式: col = (gid-1) % 176, row = floor((gid-1) / 176)
// ============================================

export interface SvTile {
  col: number
  row: number
}

// === 草地 ===
export const SV_GRASS = {
  MAIN:  { col: 53, row: 2 } as SvTile,  // GID 406, 最常用草地 (6763次)
  LIGHT: { col: 43, row: 6 } as SvTile,  // GID 1100, 浅色变体 (2218次)
  EDGE:  { col: 52, row: 2 } as SvTile,  // GID 405, 草地边缘 (691次)
}

// 草地变体数组 (供 hash 随机选取)
export const SV_GRASS_VARIANTS: SvTile[] = [
  SV_GRASS.MAIN,
  SV_GRASS.LIGHT,
  SV_GRASS.EDGE,
]

// === 道路 - 完整 4x4 道路网格 (cols 42-45, rows 1-4) ===
// 从 map.json sidewalks 层频率分析验证
export const SV_ROAD = {
  A1: { col: 43, row: 2 } as SvTile,  // GID 396 水平左
  A2: { col: 44, row: 2 } as SvTile,  // GID 397 水平右
  B1: { col: 43, row: 3 } as SvTile,  // GID 572 垂直上 (修正: 原 col:44)
  B2: { col: 44, row: 3 } as SvTile,  // GID 573 垂直下
  C1: { col: 43, row: 1 } as SvTile,  // GID 220 上边缘左
  C2: { col: 44, row: 1 } as SvTile,  // GID 221 上边缘右
  D1: { col: 43, row: 4 } as SvTile,  // GID 748 下边缘左
  D2: { col: 44, row: 4 } as SvTile,  // GID 749 下边缘右
}

export const SV_ROAD_FULL = {
  // Row 1: 顶部边缘
  EDGE_TL: { col: 42, row: 1 } as SvTile,   // GID 219
  EDGE_T1: { col: 43, row: 1 } as SvTile,   // GID 220
  EDGE_T2: { col: 44, row: 1 } as SvTile,   // GID 221
  EDGE_TR: { col: 45, row: 1 } as SvTile,   // GID 222
  // Row 2: 水平道路 + 角
  CORNER_TL: { col: 42, row: 2 } as SvTile,  // GID 395
  H1:        { col: 43, row: 2 } as SvTile,  // GID 396
  H2:        { col: 44, row: 2 } as SvTile,  // GID 397
  CORNER_TR: { col: 45, row: 2 } as SvTile,  // GID 398
  // Row 3: 垂直道路 + 角
  CORNER_BL: { col: 42, row: 3 } as SvTile,  // GID 571
  V1:        { col: 43, row: 3 } as SvTile,  // GID 572
  V2:        { col: 44, row: 3 } as SvTile,  // GID 573
  CORNER_BR: { col: 45, row: 3 } as SvTile,  // GID 574
  // Row 4: 底部边缘
  EDGE_BL: { col: 42, row: 4 } as SvTile,   // GID 747
  EDGE_B1: { col: 43, row: 4 } as SvTile,   // GID 748
  EDGE_B2: { col: 44, row: 4 } as SvTile,   // GID 749
  EDGE_BR: { col: 45, row: 4 } as SvTile,   // GID 750
}

// === 围栏 ===
export const SV_FENCE = {
  V: { col: 34, row: 6 } as SvTile,   // GID 1091, 竖向围栏 (1210次)
}

// 水平围栏 (从 map.json sidewalk_objects 层提取)
export const SV_FENCE_H = {
  L: { col: 22, row: 33 } as SvTile,  // GID 5831
  M: { col: 23, row: 33 } as SvTile,  // GID 5832
  R: { col: 24, row: 33 } as SvTile,  // GID 5833
}

// === 树木/灌木 ===
// 大树: 2x3 瓦片 (从上到下、从左到右)
export const SV_TREE_LARGE: SvTile[] = [
  { col: 62, row: 142 }, { col: 63, row: 142 },  // 顶部
  { col: 62, row: 143 }, { col: 63, row: 143 },  // 中部
  { col: 62, row: 144 }, { col: 63, row: 144 },  // 底部
]

export const SV_BUSH:     SvTile = { col: 63, row: 140 }  // GID 24704
export const SV_TREE_SM:  SvTile = { col: 23, row: 28 }   // GID 4952, 小树

// === 装饰物 (从 map.json sidewalk_objects 层提取) ===
// 路灯 (2 瓦片高)
export const SV_LAMP: SvTile[] = [
  { col: 61, row: 138 },  // 顶部
  { col: 61, row: 139 },  // 底部
]

// 长椅 (2x2)
export const SV_BENCH_TILES = {
  TL: { col: 28, row: 10 } as SvTile,
  TR: { col: 29, row: 10 } as SvTile,
  BL: { col: 28, row: 11 } as SvTile,
  BR: { col: 29, row: 11 } as SvTile,
}

// 花盆 (2x2)
export const SV_FLOWERPOT = {
  TL: { col: 60, row: 11 } as SvTile,
  TR: { col: 61, row: 11 } as SvTile,
  BL: { col: 60, row: 12 } as SvTile,
  BR: { col: 61, row: 12 } as SvTile,
}

// 垃圾桶 (2x2)
export const SV_TRASH = {
  TL: { col: 20, row: 5 } as SvTile,
  TR: { col: 21, row: 5 } as SvTile,
  BL: { col: 20, row: 6 } as SvTile,
  BR: { col: 21, row: 6 } as SvTile,
}

// === 建筑 - 屋顶 A (红/暗色系, 已验证) ===
export const SV_ROOF_A = {
  TL: { col: 144, row: 123 } as SvTile,  // GID 21793
  TR: { col: 145, row: 123 } as SvTile,
  BL: { col: 144, row: 124 } as SvTile,
  BR: { col: 145, row: 124 } as SvTile,
}

// 屋顶 B (邻近区域, 不同颜色)
export const SV_ROOF_B = {
  TL: { col: 146, row: 123 } as SvTile,
  TR: { col: 147, row: 123 } as SvTile,
  BL: { col: 146, row: 124 } as SvTile,
  BR: { col: 147, row: 124 } as SvTile,
}

// 屋顶 C (另一组)
export const SV_ROOF_C = {
  TL: { col: 148, row: 123 } as SvTile,
  TR: { col: 149, row: 123 } as SvTile,
  BL: { col: 148, row: 124 } as SvTile,
  BR: { col: 149, row: 124 } as SvTile,
}

// === 建筑 - 墙壁 ===
export const SV_WALL = {
  A: { col: 143, row: 124 } as SvTile,   // GID 21968, 米色墙壁
  B: { col: 143, row: 125 } as SvTile,   // 下方一行，墙壁变体
  C: { col: 144, row: 125 } as SvTile,   // 另一墙壁变体
}

// === 建筑 - 门/窗 ===
export const SV_DOOR = {
  A: { col: 145, row: 125 } as SvTile,   // 门瓦片
  B: { col: 146, row: 125 } as SvTile,   // 门变体
}

export const SV_WINDOW = {
  A: { col: 142, row: 124 } as SvTile,   // 窗户瓦片
  B: { col: 143, row: 123 } as SvTile,   // 窗户变体
}

// === 角色精灵帧索引常量 ===
export type CharDirection = 'up' | 'down' | 'left' | 'right'

export const SV_CHAR_IDLE: Record<CharDirection, number> = {
  right: 24,  // frames 24-29 (6帧)
  up:    30,  // frames 30-35
  left:  36,  // frames 36-41
  down:  42,  // frames 42-47
}

export const SV_CHAR_WALK: Record<CharDirection, number> = {
  right: 48,  // frames 48-53 (6帧)
  up:    54,  // frames 54-59
  left:  60,  // frames 60-65
  down:  66,  // frames 66-71
}

export const SV_CHAR_FRAMES_PER_DIR = 6
export const SV_CHAR_FPS = 10  // 100ms per frame
export const SV_CHAR_NAMES = ['adam', 'bob', 'alex', 'amelia'] as const
