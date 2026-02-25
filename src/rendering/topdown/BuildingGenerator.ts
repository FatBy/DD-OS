// ============================================
// DD-OS 建筑生成器 v2
// 能力域推断 + 美观建筑模板
// ============================================

import type { NexusEntity } from '@/types'
import { TILES, AWNING_COLORS, type TileInfo } from './TileAtlas'

/**
 * 建筑配方 - 定义建筑的瓦片组成
 */
export interface BuildingRecipe {
  width: number        // 建筑宽度 (瓦片数)
  height: number       // 建筑高度 (瓦片数)
  tiles: (TileInfo | null)[][]  // 瓦片矩阵 [row][col], null 表示透明
  style: BuildingStyle // 建筑风格
}

/**
 * 建筑风格 (对应不同能力域)
 */
export type BuildingStyle = 
  | 'shop'       // 默认商铺 - 遮阳棚 + 橱窗
  | 'workshop'   // 工作室 - 代码/开发类
  | 'library'    // 图书馆 - 搜索/知识类
  | 'factory'    // 工厂 - 自动化/流程类
  | 'vault'      // 保险库 - 记忆/存储类
  | 'portal'     // 传送门 - 浏览器/网络类
  | 'archive'    // 档案馆 - 文件/文档类

/**
 * 能力域定义 - 用于从 Skill 推断建筑风格
 */
const CAPABILITY_DOMAINS: Record<string, { keywords: string[], style: BuildingStyle }> = {
  code: { 
    keywords: ['code', 'programming', '编程', '代码', 'dev', 'script', 'compile', 'debug'],
    style: 'workshop'
  },
  search: { 
    keywords: ['search', 'find', '搜索', '查找', 'query', 'lookup', 'index'],
    style: 'library'
  },
  automation: { 
    keywords: ['auto', 'workflow', '自动化', '流程', 'schedule', 'cron', 'trigger'],
    style: 'factory'
  },
  memory: { 
    keywords: ['memory', 'remember', '记忆', '存储', 'cache', 'store', 'persist'],
    style: 'vault'
  },
  browser: { 
    keywords: ['browser', 'web', '浏览器', '网页', 'http', 'url', 'fetch'],
    style: 'portal'
  },
  file: { 
    keywords: ['file', 'document', '文件', '文档', 'read', 'write', 'folder'],
    style: 'archive'
  },
}

/**
 * 简易哈希函数 - 用于确定性随机
 */
function getHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(31, hash) + str.charCodeAt(i) | 0
  }
  return Math.abs(hash)
}

/**
 * 从 Skill 信息推断建筑风格
 */
export function inferBuildingStyle(nexus: NexusEntity): BuildingStyle {
  // 收集所有相关文本
  const texts: string[] = []
  
  if (nexus.label) texts.push(nexus.label.toLowerCase())
  if (nexus.flavorText) texts.push(nexus.flavorText.toLowerCase())
  if (nexus.sopContent) texts.push(nexus.sopContent.toLowerCase())
  if (nexus.boundSkillIds) {
    texts.push(...nexus.boundSkillIds.map(s => s.toLowerCase()))
  }
  
  const combinedText = texts.join(' ')
  
  // 匹配能力域
  for (const [, config] of Object.entries(CAPABILITY_DOMAINS)) {
    if (config.keywords.some(kw => combinedText.includes(kw))) {
      return config.style
    }
  }
  
  return 'shop' // 默认商铺风格
}

/**
 * 根据 primaryHue 选择遮阳棚颜色
 */
function getAwningColor(hue: number): keyof typeof AWNING_COLORS {
  // 将色相映射到 4 种遮阳棚颜色
  if (hue < 45 || hue >= 315) return 'red'      // 红色系
  if (hue < 135) return 'orange'                 // 橙黄绿
  if (hue < 225) return 'blue'                   // 蓝青色
  return 'green'                                 // 绿色系
}

/**
 * 生成商铺建筑 (默认样式)
 * 特点：遮阳棚 + 玻璃橱窗 + 室内货架
 */
function generateShopBuilding(nexus: NexusEntity, hash: number): BuildingRecipe {
  const width = 3 + (hash % 2)  // 3-4 格宽
  const height = 3
  const hue = nexus.visualDNA?.primaryHue ?? 180
  const awning = AWNING_COLORS[getAwningColor(hue)]
  
  const tiles: (TileInfo | null)[][] = []
  
  // 第 1 行：遮阳棚
  const awningRow: (TileInfo | null)[] = []
  for (let i = 0; i < width; i++) {
    if (i === 0) awningRow.push(awning.l)
    else if (i === width - 1) awningRow.push(awning.r)
    else awningRow.push(awning.m)
  }
  tiles.push(awningRow)
  
  // 第 2 行：玻璃橱窗 + 室内
  const windowRow: (TileInfo | null)[] = []
  for (let i = 0; i < width; i++) {
    if (i === 0) windowRow.push(TILES.GLASS_WINDOW_L)
    else if (i === width - 1) windowRow.push(TILES.GLASS_WINDOW_R)
    else windowRow.push(hash % 2 === 0 ? TILES.SHELF_BOOKS : TILES.SHELF_ITEMS)
  }
  tiles.push(windowRow)
  
  // 第 3 行：门 + 地板
  const doorRow: (TileInfo | null)[] = []
  const doorPos = Math.floor(width / 2)
  for (let i = 0; i < width; i++) {
    if (i === doorPos) doorRow.push(TILES.GLASS_DOOR)
    else doorRow.push(TILES.SIDEWALK)
  }
  tiles.push(doorRow)
  
  return { width, height, tiles, style: 'shop' }
}

/**
 * 生成工作室建筑 (代码/开发类)
 * 特点：大窗户 + 电脑设备
 */
function generateWorkshopBuilding(nexus: NexusEntity, hash: number): BuildingRecipe {
  const width = 3 + (hash % 2)
  const height = 3
  const hue = nexus.visualDNA?.primaryHue ?? 200
  const awning = AWNING_COLORS[hue < 180 ? 'blue' : 'green']
  
  const tiles: (TileInfo | null)[][] = []
  
  // 第 1 行：蓝色遮阳棚
  const topRow: (TileInfo | null)[] = []
  for (let i = 0; i < width; i++) {
    if (i === 0) topRow.push(awning.l)
    else if (i === width - 1) topRow.push(awning.r)
    else topRow.push(awning.m)
  }
  tiles.push(topRow)
  
  // 第 2 行：窗户 + 电脑
  const midRow: (TileInfo | null)[] = []
  for (let i = 0; i < width; i++) {
    if (i === 0 || i === width - 1) midRow.push(TILES.GLASS_WINDOW_L)
    else midRow.push(TILES.COMPUTER)
  }
  tiles.push(midRow)
  
  // 第 3 行：门
  const botRow: (TileInfo | null)[] = []
  const doorPos = Math.floor(width / 2)
  for (let i = 0; i < width; i++) {
    if (i === doorPos) botRow.push(TILES.DOOR_BLUE)
    else botRow.push(TILES.SIDEWALK)
  }
  tiles.push(botRow)
  
  return { width, height, tiles, style: 'workshop' }
}

/**
 * 生成图书馆建筑 (搜索/知识类)
 * 特点：书架 + 大窗户 + 安静氛围
 */
function generateLibraryBuilding(_nexus: NexusEntity, hash: number): BuildingRecipe {
  const width = 4 + (hash % 2)  // 4-5 格宽（图书馆较大）
  const height = 4
  
  const tiles: (TileInfo | null)[][] = []
  
  // 第 1 行：屋顶
  const roofRow: (TileInfo | null)[] = []
  for (let i = 0; i < width; i++) {
    if (i === 0) roofRow.push(TILES.ROOF_RED_TL)
    else if (i === width - 1) roofRow.push(TILES.ROOF_RED_TR)
    else roofRow.push(TILES.ROOF_RED_T)
  }
  tiles.push(roofRow)
  
  // 第 2 行：上层窗户
  const upperRow: (TileInfo | null)[] = []
  for (let i = 0; i < width; i++) {
    if (i === 0) upperRow.push(TILES.WALL_GRAY_L)
    else if (i === width - 1) upperRow.push(TILES.WALL_GRAY_R)
    else upperRow.push(hash % 2 === 0 ? TILES.GLASS_WINDOW_M : TILES.WALL_GRAY_C)
  }
  tiles.push(upperRow)
  
  // 第 3 行：书架区
  const shelfRow: (TileInfo | null)[] = []
  for (let i = 0; i < width; i++) {
    if (i === 0) shelfRow.push(TILES.GLASS_WINDOW_L)
    else if (i === width - 1) shelfRow.push(TILES.GLASS_WINDOW_R)
    else shelfRow.push(TILES.SHELF_BOOKS)
  }
  tiles.push(shelfRow)
  
  // 第 4 行：门
  const doorRow: (TileInfo | null)[] = []
  const doorPos = Math.floor(width / 2)
  for (let i = 0; i < width; i++) {
    if (i === doorPos) doorRow.push(TILES.GLASS_DOOR)
    else if (i === doorPos - 1 || i === doorPos + 1) doorRow.push(TILES.PLANT_POT)
    else doorRow.push(TILES.SIDEWALK)
  }
  tiles.push(doorRow)
  
  return { width, height, tiles, style: 'library' }
}

/**
 * 生成工厂建筑 (自动化类)
 * 特点：烟囱 + 工业风格
 */
function generateFactoryBuilding(_nexus: NexusEntity, hash: number): BuildingRecipe {
  const width = 4
  const height = 3
  
  const tiles: (TileInfo | null)[][] = []
  
  // 第 1 行：平屋顶 + 烟囱
  const roofRow: (TileInfo | null)[] = []
  for (let i = 0; i < width; i++) {
    if (i === width - 1) roofRow.push(TILES.LAMP_POST) // 模拟烟囱
    else roofRow.push(TILES.ROOF_FLAT)
  }
  tiles.push(roofRow)
  
  // 第 2 行：工业窗户
  const midRow: (TileInfo | null)[] = []
  for (let i = 0; i < width; i++) {
    if (i === 0) midRow.push(TILES.WALL_GRAY_L)
    else if (i === width - 1) midRow.push(TILES.WALL_GRAY_R)
    else midRow.push(TILES.CRATE)
  }
  tiles.push(midRow)
  
  // 第 3 行：大门
  const doorRow: (TileInfo | null)[] = []
  for (let i = 0; i < width; i++) {
    if (i === 1 || i === 2) doorRow.push(hash % 2 === 0 ? TILES.DOOR_BROWN : TILES.GLASS_DOOR)
    else doorRow.push(TILES.WALL_GRAY_B)
  }
  tiles.push(doorRow)
  
  return { width, height, tiles, style: 'factory' }
}

/**
 * 生成保险库建筑 (记忆/存储类)
 * 特点：厚重 + 安全感
 */
function generateVaultBuilding(_nexus: NexusEntity, hash: number): BuildingRecipe {
  const width = 3
  const height = 3
  
  const tiles: (TileInfo | null)[][] = []
  
  // 第 1 行：厚重屋顶
  const roofRow: (TileInfo | null)[] = [
    TILES.WALL_BROWN_TL,
    TILES.WALL_BROWN_T,
    TILES.WALL_BROWN_TR,
  ]
  tiles.push(roofRow)
  
  // 第 2 行：保险柜
  const midRow: (TileInfo | null)[] = [
    TILES.WALL_BROWN_L,
    hash % 2 === 0 ? TILES.CRATE : TILES.SHELF_ITEMS,
    TILES.WALL_BROWN_R,
  ]
  tiles.push(midRow)
  
  // 第 3 行：厚重大门
  const doorRow: (TileInfo | null)[] = [
    TILES.WALL_BROWN_BL,
    TILES.DOOR_BROWN,
    TILES.WALL_BROWN_BR,
  ]
  tiles.push(doorRow)
  
  return { width, height, tiles, style: 'vault' }
}

/**
 * 生成传送门建筑 (浏览器/网络类)
 * 特点：现代 + 科技感
 */
function generatePortalBuilding(nexus: NexusEntity, hash: number): BuildingRecipe {
  const width = 3
  const height = 3
  const hue = nexus.visualDNA?.primaryHue ?? 220
  const awning = AWNING_COLORS[hue < 200 ? 'blue' : 'green']
  
  const tiles: (TileInfo | null)[][] = []
  
  // 第 1 行：现代遮阳棚
  tiles.push([awning.l, awning.m, awning.r])
  
  // 第 2 行：全玻璃
  tiles.push([
    TILES.GLASS_WINDOW_L,
    hash % 2 === 0 ? TILES.COMPUTER : TILES.GLASS_WINDOW_M,
    TILES.GLASS_WINDOW_R,
  ])
  
  // 第 3 行：玻璃门
  tiles.push([
    TILES.SIDEWALK,
    TILES.GLASS_DOOR,
    TILES.SIDEWALK,
  ])
  
  return { width, height, tiles, style: 'portal' }
}

/**
 * 生成档案馆建筑 (文件/文档类)
 * 特点：整洁 + 文件柜
 */
function generateArchiveBuilding(_nexus: NexusEntity, hash: number): BuildingRecipe {
  const width = 4
  const height = 3
  
  const tiles: (TileInfo | null)[][] = []
  
  // 第 1 行：屋顶
  tiles.push([
    TILES.ROOF_BLUE_TL,
    TILES.ROOF_BLUE_T,
    TILES.ROOF_BLUE_T,
    TILES.ROOF_BLUE_TR,
  ])
  
  // 第 2 行：文件柜区
  tiles.push([
    TILES.WALL_GRAY_L,
    TILES.SHELF_BOOKS,
    TILES.SHELF_ITEMS,
    TILES.WALL_GRAY_R,
  ])
  
  // 第 3 行：入口
  tiles.push([
    TILES.SIDEWALK,
    hash % 2 === 0 ? TILES.DOOR_BLUE : TILES.GLASS_DOOR,
    TILES.PLANT_POT,
    TILES.SIDEWALK,
  ])
  
  return { width, height, tiles, style: 'archive' }
}

/**
 * 根据 Nexus 生成建筑配方
 */
export function generateBuildingRecipe(nexus: NexusEntity): BuildingRecipe {
  const style = inferBuildingStyle(nexus)
  const hash = getHash(nexus.id)
  
  switch (style) {
    case 'workshop':
      return generateWorkshopBuilding(nexus, hash)
    case 'library':
      return generateLibraryBuilding(nexus, hash)
    case 'factory':
      return generateFactoryBuilding(nexus, hash)
    case 'vault':
      return generateVaultBuilding(nexus, hash)
    case 'portal':
      return generatePortalBuilding(nexus, hash)
    case 'archive':
      return generateArchiveBuilding(nexus, hash)
    case 'shop':
    default:
      return generateShopBuilding(nexus, hash)
  }
}

/**
 * 建筑样式预览 (用于调试)
 */
export function describeBuildingRecipe(recipe: BuildingRecipe): string {
  let desc = `Building [${recipe.style}] ${recipe.width}x${recipe.height}\n`
  for (let row = 0; row < recipe.tiles.length; row++) {
    desc += recipe.tiles[row].map(t => t?.name.slice(0, 6) ?? '------').join(' | ') + '\n'
  }
  return desc
}
