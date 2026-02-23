// ============================================
// DD-OS 建筑生成器
// 根据 Nexus 属性生成俯视角建筑布局
// ============================================

import type { NexusEntity } from '@/types'
import { TILES, type TileInfo } from './TileAtlas'

/**
 * 建筑配方 - 定义建筑的瓦片组成
 */
export interface BuildingRecipe {
  width: number      // 建筑宽度 (瓦片数)
  height: number     // 建筑高度 (瓦片数)
  tiles: TileInfo[][]  // 瓦片矩阵 [row][col]
  doorPos: { col: number, row: number }  // 门的位置
}

/**
 * 建筑风格主题
 */
export type BuildingStyle = 'brown' | 'gray' | 'red' | 'blue'

/**
 * 简易哈希函数
 */
function getHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(31, hash) + str.charCodeAt(i) | 0
  }
  return Math.abs(hash)
}

/**
 * 根据 Nexus 类型获取建筑风格
 */
function getStyleForArchetype(archetype?: string): BuildingStyle {
  switch (archetype) {
    case 'MONOLITH': return 'gray'   // 知识库 - 灰色庄重
    case 'SPIRE': return 'blue'      // 推理塔 - 蓝色科技
    case 'REACTOR': return 'red'     // 执行器 - 红色动力
    case 'VAULT': return 'brown'     // 记忆库 - 棕色温暖
    default: return 'brown'
  }
}

/**
 * 生成墙壁瓦片集
 */
function getWallTiles(style: BuildingStyle) {
  if (style === 'gray' || style === 'blue') {
    return {
      tl: TILES.WALL_GRAY_TL,
      t: TILES.WALL_GRAY_T,
      tr: TILES.WALL_GRAY_TR,
      l: TILES.WALL_GRAY_L,
      c: TILES.WALL_GRAY_C,
      r: TILES.WALL_GRAY_R,
      bl: TILES.WALL_GRAY_BL,
      b: TILES.WALL_GRAY_B,
      br: TILES.WALL_GRAY_BR,
    }
  }
  return {
    tl: TILES.WALL_BROWN_TL,
    t: TILES.WALL_BROWN_T,
    tr: TILES.WALL_BROWN_TR,
    l: TILES.WALL_BROWN_L,
    c: TILES.WALL_BROWN_C,
    r: TILES.WALL_BROWN_R,
    bl: TILES.WALL_BROWN_BL,
    b: TILES.WALL_BROWN_B,
    br: TILES.WALL_BROWN_BR,
  }
}

/**
 * 生成屋顶瓦片集
 */
function getRoofTiles(style: BuildingStyle) {
  if (style === 'red' || style === 'gray') {
    return {
      tl: TILES.ROOF_RED_TL,
      t: TILES.ROOF_RED_T,
      tr: TILES.ROOF_RED_TR,
      l: TILES.ROOF_RED_L,
      c: TILES.ROOF_RED_C,
      r: TILES.ROOF_RED_R,
    }
  }
  return {
    tl: TILES.ROOF_BROWN_TL,
    t: TILES.ROOF_BROWN_T,
    tr: TILES.ROOF_BROWN_TR,
    l: TILES.ROOF_BROWN_L,
    c: TILES.ROOF_BROWN_C,
    r: TILES.ROOF_BROWN_R,
  }
}

/**
 * 生成建筑配方
 */
export function generateBuildingRecipe(nexus: NexusEntity): BuildingRecipe {
  const hash = getHash(nexus.id)
  const style = getStyleForArchetype(nexus.archetype)
  
  // 建筑尺寸基于哈希值 (2-4 宽, 2-3 高)
  const width = 2 + (hash % 3)   // 2, 3, 4
  const height = 2 + (hash % 2)  // 2, 3
  
  const walls = getWallTiles(style)
  const roof = getRoofTiles(style)
  
  // 生成瓦片矩阵
  const tiles: TileInfo[][] = []
  
  // 屋顶层 (顶部 1 行)
  const roofRow: TileInfo[] = []
  for (let col = 0; col < width; col++) {
    if (col === 0) roofRow.push(roof.tl)
    else if (col === width - 1) roofRow.push(roof.tr)
    else roofRow.push(roof.t)
  }
  tiles.push(roofRow)
  
  // 屋顶下半部分 (第 2 行)
  const roofRow2: TileInfo[] = []
  for (let col = 0; col < width; col++) {
    if (col === 0) roofRow2.push(roof.l)
    else if (col === width - 1) roofRow2.push(roof.r)
    else roofRow2.push(roof.c)
  }
  tiles.push(roofRow2)
  
  // 墙壁层 (中间若干行)
  const wallRows = height - 1  // 除去屋顶，剩余墙壁行数
  for (let row = 0; row < wallRows; row++) {
    const wallRow: TileInfo[] = []
    const isBottom = row === wallRows - 1
    
    for (let col = 0; col < width; col++) {
      if (isBottom) {
        // 底部行
        if (col === 0) wallRow.push(walls.bl)
        else if (col === width - 1) wallRow.push(walls.br)
        else wallRow.push(walls.b)
      } else {
        // 中间行
        if (col === 0) wallRow.push(walls.l)
        else if (col === width - 1) wallRow.push(walls.r)
        else wallRow.push(walls.c)
      }
    }
    tiles.push(wallRow)
  }
  
  // 门的位置 (底部中间)
  const doorCol = Math.floor(width / 2)
  const doorRow = tiles.length - 1
  
  // 替换门瓦片
  const doorTile = style === 'blue' ? TILES.DOOR_BLUE : TILES.DOOR_BROWN
  tiles[doorRow][doorCol] = doorTile
  
  // 添加窗户 (如果建筑够宽)
  if (width >= 3 && wallRows >= 1) {
    const windowRow = tiles.length - 2  // 门上方一行
    if (windowRow >= 2) {  // 确保不是屋顶
      for (let col = 0; col < width; col++) {
        if (col !== doorCol && col !== 0 && col !== width - 1) {
          tiles[windowRow][col] = hash % 2 === 0 ? TILES.WINDOW_1 : TILES.WINDOW_2
        }
      }
    }
  }
  
  return {
    width,
    height: tiles.length,
    tiles,
    doorPos: { col: doorCol, row: doorRow },
  }
}

/**
 * 建筑样式预览 (用于调试)
 */
export function describeBuildingRecipe(recipe: BuildingRecipe): string {
  let desc = `Building ${recipe.width}x${recipe.height}\n`
  for (let row = 0; row < recipe.tiles.length; row++) {
    desc += recipe.tiles[row].map(t => t.name.slice(0, 4)).join(' | ') + '\n'
  }
  return desc
}
