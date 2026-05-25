/**
 * 统一环境检测工具
 * 集中管理所有运行环境判断和后端 URL 路由
 */

// TypeScript 全局类型声明
declare global {
  interface Window {
    electronAPI?: {
      isElectron: true
      getServerUrl: () => string
      platform: string
      lightMode?: boolean
      getAppInfo: () => Promise<{ version: string; platform: string; isPackaged: boolean; lightMode?: boolean }>
      updater?: {
        onStatus: (cb: (data: Record<string, unknown>) => void) => () => void
        check: () => Promise<void>
        download: () => Promise<void>
        install: () => Promise<void>
        openReleases: () => Promise<void>
      }
      plugins?: {
        list: () => Promise<Array<{
          id: string; name: string; version: string; description?: string;
          status: string; errorMessage?: string; hasConfigSchema: boolean;
        }>>
        getProviders: () => Promise<Array<Record<string, unknown>>>
        getConfig: (pluginId: string) => Promise<Record<string, unknown>>
        setConfig: (pluginId: string, config: Record<string, unknown>) => Promise<{ ok: boolean }>
        getSchema: (pluginId: string) => Promise<Record<string, unknown> | null>
        checkUpdate: (pluginId: string) => Promise<{ hasUpdate: boolean; latestVersion?: string; currentVersion?: string }>
        doUpdate: (pluginId: string) => Promise<{ ok: boolean; message?: string }>
        emitHook: (hookName: string, data: Record<string, unknown>) => void
        buildContext: (data: Record<string, unknown>) => Promise<Record<string, string>>
        onBroadcast: (cb: (event: string, payload: unknown) => void) => () => void
      }
    }
    __TAURI__?: unknown
  }
}

/** 开发模式 */
export const isDevMode: boolean = import.meta.env?.DEV ?? false

/** Electron 桌面应用模式 */
export const isElectronMode: boolean =
  typeof window !== 'undefined' && !!window.electronAPI?.isElectron

/** Tauri 桌面应用模式（保留兼容） */
export const isTauriMode: boolean =
  typeof window !== 'undefined' && '__TAURI__' in window

/** 任意桌面应用模式 */
export const isDesktopApp: boolean = isElectronMode || isTauriMode

function isTruthyFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function readViteFlag(name: string): unknown {
  const env = import.meta.env as Record<string, unknown>
  return env[`VITE_${name}`]
}

function readLocalFlag(name: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(`duncrew_${name.toLowerCase()}`)
  } catch {
    return null
  }
}

/** Lightweight frontend mode. Enable with VITE_DUNCREW_LIGHT=1 or localStorage duncrew_light=1. */
export function isLightMode(): boolean {
  return (
    isTruthyFlag(readViteFlag('DUNCREW_LIGHT')) ||
    isTruthyFlag(readLocalFlag('light')) ||
    (typeof window !== 'undefined' && window.electronAPI?.lightMode === true)
  )
}

/**
 * Feature gate for optional frontend work. In light mode, optional features are off
 * unless explicitly forced with VITE_DUNCREW_ENABLE_<FEATURE>=1 or localStorage.
 */
export function isFrontendFeatureDisabled(feature: string): boolean {
  const normalized = feature.toUpperCase()
  const localName = normalized.toLowerCase()

  if (
    isTruthyFlag(readViteFlag(`DUNCREW_ENABLE_${normalized}`)) ||
    isTruthyFlag(readLocalFlag(`enable_${localName}`))
  ) {
    return false
  }

  return (
    isLightMode() ||
    isTruthyFlag(readViteFlag(`DUNCREW_DISABLE_${normalized}`)) ||
    isTruthyFlag(readLocalFlag(`disable_${localName}`))
  )
}

/**
 * 获取后端服务器 URL
 * - Electron 模式：127.0.0.1:3001
 * - Tauri 模式：127.0.0.1:3001
 * - 开发模式：localhost:3001
 * - 浏览器直连生产模式：空字符串（相对路径，Python 同域托管）
 */
export function getServerUrl(): string {
  if (isElectronMode) return 'http://127.0.0.1:3001'
  if (isTauriMode) return 'http://127.0.0.1:3001'
  if (isDevMode) return 'http://localhost:3001'
  return '' // 生产模式: 相对路径
}
