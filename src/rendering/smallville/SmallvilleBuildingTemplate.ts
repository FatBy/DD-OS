// ============================================
// Smallville 建筑模板系统
// 8 种不同风格的像素建筑，用瓦片组合生成
// ============================================

import type { SmallvilleSpriteAtlas } from './SmallvilleSpriteAtlas'
import {
  SV_ROOF_A, SV_ROOF_B, SV_ROOF_C,
  SV_WALL, SV_DOOR, SV_WINDOW,
} from './SmallvilleTiles'
import type { SvTile } from './SmallvilleTiles'

const TILE_SIZE = 16

export interface SvBuildingTemplate {
  width: number   // 瓦片宽
  height: number  // 瓦片高
  tiles: Array<{ dx: number; dy: number; col: number; row: number }>
}

function t(dx: number, dy: number, tile: SvTile): { dx: number; dy: number; col: number; row: number } {
  return { dx, dy, col: tile.col, row: tile.row }
}

// ── 模板 0: 小商铺 2×3 (ROOF_A) ──────────────
const TEMPLATE_SHOP: SvBuildingTemplate = {
  width: 2, height: 3,
  tiles: [
    t(0, 0, SV_ROOF_A.TL), t(1, 0, SV_ROOF_A.TR),
    t(0, 1, SV_WINDOW.A),  t(1, 1, SV_WALL.A),
    t(0, 2, SV_WALL.A),    t(1, 2, SV_DOOR.A),
  ],
}

// ── 模板 1: 宽商铺 3×3 (ROOF_A) ──────────────
const TEMPLATE_WIDE_SHOP: SvBuildingTemplate = {
  width: 3, height: 3,
  tiles: [
    t(0, 0, SV_ROOF_A.TL), t(1, 0, SV_ROOF_A.TL), t(2, 0, SV_ROOF_A.TR),
    t(0, 1, SV_WINDOW.A),  t(1, 1, SV_WALL.A),     t(2, 1, SV_WINDOW.A),
    t(0, 2, SV_ROOF_A.BL), t(1, 2, SV_DOOR.A),     t(2, 2, SV_ROOF_A.BR),
  ],
}

// ── 模板 2: 高楼 2×4 (ROOF_A) ────────────────
const TEMPLATE_TALL: SvBuildingTemplate = {
  width: 2, height: 4,
  tiles: [
    t(0, 0, SV_ROOF_A.TL), t(1, 0, SV_ROOF_A.TR),
    t(0, 1, SV_WINDOW.A),  t(1, 1, SV_WINDOW.B),
    t(0, 2, SV_WALL.A),    t(1, 2, SV_WALL.A),
    t(0, 3, SV_WALL.B),    t(1, 3, SV_DOOR.A),
  ],
}

// ── 模板 3: 大建筑 3×4 (ROOF_A) ──────────────
const TEMPLATE_LARGE: SvBuildingTemplate = {
  width: 3, height: 4,
  tiles: [
    t(0, 0, SV_ROOF_A.TL), t(1, 0, SV_ROOF_A.TL), t(2, 0, SV_ROOF_A.TR),
    t(0, 1, SV_WINDOW.A),  t(1, 1, SV_WALL.A),     t(2, 1, SV_WINDOW.A),
    t(0, 2, SV_WALL.A),    t(1, 2, SV_WALL.A),     t(2, 2, SV_WALL.A),
    t(0, 3, SV_ROOF_A.BL), t(1, 3, SV_DOOR.A),     t(2, 3, SV_ROOF_A.BR),
  ],
}

// ── 模板 4: B色商铺 2×3 (ROOF_B) ─────────────
const TEMPLATE_SHOP_B: SvBuildingTemplate = {
  width: 2, height: 3,
  tiles: [
    t(0, 0, SV_ROOF_B.TL), t(1, 0, SV_ROOF_B.TR),
    t(0, 1, SV_WALL.B),    t(1, 1, SV_WINDOW.B),
    t(0, 2, SV_DOOR.B),    t(1, 2, SV_WALL.C),
  ],
}

// ── 模板 5: B色宽屋 3×3 (ROOF_B) ─────────────
const TEMPLATE_HOUSE_B: SvBuildingTemplate = {
  width: 3, height: 3,
  tiles: [
    t(0, 0, SV_ROOF_B.TL), t(1, 0, SV_ROOF_B.TL), t(2, 0, SV_ROOF_B.TR),
    t(0, 1, SV_WINDOW.B),  t(1, 1, SV_WALL.B),     t(2, 1, SV_WINDOW.B),
    t(0, 2, SV_ROOF_B.BL), t(1, 2, SV_DOOR.B),     t(2, 2, SV_ROOF_B.BR),
  ],
}

// ── 模板 6: 塔楼 2×5 (ROOF_C) ────────────────
const TEMPLATE_TOWER: SvBuildingTemplate = {
  width: 2, height: 5,
  tiles: [
    t(0, 0, SV_ROOF_C.TL), t(1, 0, SV_ROOF_C.TR),
    t(0, 1, SV_WINDOW.A),  t(1, 1, SV_WINDOW.B),
    t(0, 2, SV_WALL.C),    t(1, 2, SV_WALL.C),
    t(0, 3, SV_WINDOW.B),  t(1, 3, SV_WINDOW.A),
    t(0, 4, SV_WALL.B),    t(1, 4, SV_DOOR.A),
  ],
}

// ── 模板 7: 豪宅 4×4 (ROOF_C) ────────────────
const TEMPLATE_MANSION: SvBuildingTemplate = {
  width: 4, height: 4,
  tiles: [
    t(0, 0, SV_ROOF_C.TL), t(1, 0, SV_ROOF_C.TL), t(2, 0, SV_ROOF_C.TL), t(3, 0, SV_ROOF_C.TR),
    t(0, 1, SV_WINDOW.A),  t(1, 1, SV_WALL.C),     t(2, 1, SV_WALL.C),     t(3, 1, SV_WINDOW.A),
    t(0, 2, SV_WALL.B),    t(1, 2, SV_WINDOW.B),   t(2, 2, SV_WINDOW.B),   t(3, 2, SV_WALL.B),
    t(0, 3, SV_ROOF_C.BL), t(1, 3, SV_DOOR.B),     t(2, 3, SV_WALL.C),     t(3, 3, SV_ROOF_C.BR),
  ],
}

// ── 模板数组 ──────────────────────────────────
// 索引 0-3: 小型/中型 (level 1-2 偏好)
// 索引 4-7: 中型/大型 (level 3-4 偏好)
const TEMPLATES: SvBuildingTemplate[] = [
  TEMPLATE_SHOP,       // 0: 2×3 小商铺
  TEMPLATE_WIDE_SHOP,  // 1: 3×3 宽商铺
  TEMPLATE_TALL,       // 2: 2×4 高楼
  TEMPLATE_LARGE,      // 3: 3×4 大建筑
  TEMPLATE_SHOP_B,     // 4: 2×3 B色商铺
  TEMPLATE_HOUSE_B,    // 5: 3×3 B色宽屋
  TEMPLATE_TOWER,      // 6: 2×5 塔楼
  TEMPLATE_MANSION,    // 7: 4×4 豪宅
]

/** 根据 nexusId + level 确定性选择建筑模板 */
export function selectBuildingTemplate(nexusId: string, level?: number): SvBuildingTemplate {
  const hash = hashString(nexusId)
  if (level !== undefined && level >= 3) {
    // 高等级偏向大型模板 (4-7)
    return TEMPLATES[4 + (hash % 4)]
  }
  // 默认/低等级: 全范围选择
  return TEMPLATES[hash % TEMPLATES.length]
}

/** 渲染建筑模板 */
export function drawBuildingTemplate(
  ctx: CanvasRenderingContext2D,
  atlas: SmallvilleSpriteAtlas,
  template: SvBuildingTemplate,
  baseX: number,
  baseY: number,
  scale: number,
): void {
  for (const tile of template.tiles) {
    atlas.drawTile(
      ctx,
      tile.col, tile.row,
      baseX + tile.dx * TILE_SIZE * scale,
      baseY + tile.dy * TILE_SIZE * scale,
      scale,
    )
  }
}

function hashString(s: string): number {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}
