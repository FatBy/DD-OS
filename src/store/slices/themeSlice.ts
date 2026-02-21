// ============================================
// DD-OS 主题状态管理
// ============================================

import type { StateCreator } from 'zustand'
import type { ThemeName } from '@/types/theme'
import { themes, getTheme } from '@/themes'
import { applyThemeToDOM, getCanvasPalette } from '@/utils/themeUtils'
import type { CanvasPalette } from '@/types/theme'

// LocalStorage 键名
const THEME_STORAGE_KEY = 'ddos_theme'

// 从 localStorage 读取主题
function loadTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved && saved in themes) {
      return saved as ThemeName
    }
  } catch (e) {
    console.warn('[Theme] Failed to load theme from localStorage:', e)
  }
  return 'default'
}

// 保存主题到 localStorage
function saveTheme(name: ThemeName): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, name)
  } catch (e) {
    console.warn('[Theme] Failed to save theme to localStorage:', e)
  }
}

export interface ThemeSlice {
  // 状态
  currentTheme: ThemeName
  
  // 计算属性
  canvasPalette: CanvasPalette
  
  // Actions
  setTheme: (name: ThemeName) => void
  initTheme: () => void
}

export const createThemeSlice: StateCreator<ThemeSlice> = (set, get) => {
  // 初始主题
  const initialTheme = loadTheme()
  const initialPalette = getCanvasPalette(getTheme(initialTheme))
  
  return {
    currentTheme: initialTheme,
    canvasPalette: initialPalette,
    
    setTheme: (name) => {
      const theme = getTheme(name)
      
      // 应用到 DOM
      applyThemeToDOM(theme)
      
      // 保存到 localStorage
      saveTheme(name)
      
      // 更新状态
      set({
        currentTheme: name,
        canvasPalette: getCanvasPalette(theme),
      })
    },
    
    initTheme: () => {
      const { currentTheme } = get()
      const theme = getTheme(currentTheme)
      applyThemeToDOM(theme)
    },
  }
}
