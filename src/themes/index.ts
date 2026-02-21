// ============================================
// DD-OS 主题配置
// ============================================

import type { Theme, ThemeName } from '@/types/theme'

// ============================================
// 默认主题：深色科技风
// ============================================
const defaultTheme: Theme = {
  name: 'default',
  label: '深空科技',
  description: '默认深色主题，科技感强',
  colors: {
    // 背景系 (RGB 值)
    bgPrimary: '2 6 23',        // #020617 slate-950
    bgSecondary: '15 23 42',    // #0f172a slate-900
    bgPanel: '0 0 0',           // black
    bgElevated: '30 41 59',     // #1e293b slate-800

    // 文本系
    textPrimary: '255 255 255',   // white
    textSecondary: '148 163 184', // slate-400
    textMuted: '100 116 139',     // slate-500

    // 边框
    borderSubtle: '255 255 255',  // white (with opacity)
    borderMedium: '255 255 255',

    // 强调色
    accentCyan: '34 211 238',     // cyan-400
    accentAmber: '251 191 36',    // amber-400
    accentEmerald: '52 211 153',  // emerald-400
    accentPurple: '168 85 247',   // purple-400
    accentRed: '248 113 113',     // red-400
  },
  canvas: {
    spaceGradient: ['#020617', '#0a0f1e', '#060b18'],
    gridColor: '80, 160, 255',
    gridOpacity: 0.04,
    starColor: '#ffffff',
    labelSelected: 'rgba(255,255,255,0.9)',
    labelDefault: 'rgba(200, 220, 255, 0.6)',
    glowHue: 220,
    coreHue: 220,
  },
}

// ============================================
// 赛博朋克主题
// ============================================
const cyberpunkTheme: Theme = {
  name: 'cyberpunk',
  label: '赛博朋克',
  description: '霓虹紫粉，高饱和度',
  colors: {
    // 背景系 - 深紫黑
    bgPrimary: '10 0 20',         // 深紫黑
    bgSecondary: '20 10 35',      // 暗紫
    bgPanel: '5 0 10',            // 极深紫
    bgElevated: '30 15 50',       // 提升紫

    // 文本系
    textPrimary: '240 240 255',   // 冷白
    textSecondary: '180 160 220', // 淡紫
    textMuted: '120 100 160',     // 暗紫灰

    // 边框 - 霓虹粉
    borderSubtle: '255 0 128',    // 霓虹粉
    borderMedium: '255 0 128',

    // 强调色 - 霓虹色系
    accentCyan: '0 255 255',      // 霓虹青
    accentAmber: '255 200 0',     // 金黄
    accentEmerald: '0 255 128',   // 霓虹绿
    accentPurple: '200 0 255',    // 霓虹紫
    accentRed: '255 50 100',      // 霓虹红
  },
  canvas: {
    spaceGradient: ['#050014', '#0f0028', '#080018'],
    gridColor: '255, 0, 128',
    gridOpacity: 0.08,
    starColor: '#ff00ff',
    labelSelected: 'rgba(255,200,255,0.95)',
    labelDefault: 'rgba(200, 150, 255, 0.7)',
    glowHue: 300,  // 紫红色系
    coreHue: 280,
  },
}

// ============================================
// 纯净白昼主题
// ============================================
const lightTheme: Theme = {
  name: 'light',
  label: '纯净白昼',
  description: '明亮清新，护眼模式',
  colors: {
    // 背景系 - 浅色
    bgPrimary: '248 250 252',     // slate-50
    bgSecondary: '241 245 249',   // slate-100
    bgPanel: '255 255 255',       // white
    bgElevated: '226 232 240',    // slate-200

    // 文本系 - 深色
    textPrimary: '15 23 42',      // slate-900
    textSecondary: '71 85 105',   // slate-600
    textMuted: '148 163 184',     // slate-400

    // 边框 - 浅灰
    borderSubtle: '0 0 0',        // black (with opacity)
    borderMedium: '0 0 0',

    // 强调色 - 柔和版本
    accentCyan: '6 182 212',      // cyan-500
    accentAmber: '245 158 11',    // amber-500
    accentEmerald: '16 185 129',  // emerald-500
    accentPurple: '139 92 246',   // purple-500
    accentRed: '239 68 68',       // red-500
  },
  canvas: {
    spaceGradient: ['#f8fafc', '#e2e8f0', '#f1f5f9'],
    gridColor: '100, 116, 139',
    gridOpacity: 0.1,
    starColor: '#64748b',
    labelSelected: 'rgba(15,23,42,0.9)',
    labelDefault: 'rgba(71, 85, 105, 0.7)',
    glowHue: 210,
    coreHue: 200,
  },
}

// ============================================
// 导出
// ============================================

export const themes: Record<ThemeName, Theme> = {
  default: defaultTheme,
  cyberpunk: cyberpunkTheme,
  light: lightTheme,
}

export function getTheme(name: ThemeName): Theme {
  return themes[name] || themes.default
}

export const themeNames: ThemeName[] = ['default', 'cyberpunk', 'light']
