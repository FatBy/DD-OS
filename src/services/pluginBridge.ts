/**
 * PluginBridge - 前端与 Electron 插件系统的 IPC 桥接
 *
 * 封装 window.electronAPI.plugins 调用，提供类型安全的异步 API。
 * 非 Electron 环境下所有方法返回空值/no-op。
 */

import { isElectronMode } from '@/utils/env'

// ============================================
// 类型定义
// ============================================

export interface PluginInfo {
  id: string
  name: string
  version: string
  description?: string
  status: string
  errorMessage?: string
  hasConfigSchema: boolean
}

export interface PluginUpdateInfo {
  hasUpdate: boolean
  latestVersion?: string
  currentVersion?: string
}

// ============================================
// 桥接 API
// ============================================

function getPluginsAPI() {
  if (!isElectronMode) return null
  return (window as Window & { electronAPI?: { plugins?: Record<string, unknown> } }).electronAPI?.plugins as {
    list: () => Promise<PluginInfo[]>
    getProviders: () => Promise<Array<Record<string, unknown>>>
    getConfig: (pluginId: string) => Promise<Record<string, unknown>>
    setConfig: (pluginId: string, config: Record<string, unknown>) => Promise<{ ok: boolean }>
    getSchema: (pluginId: string) => Promise<Record<string, unknown> | null>
    checkUpdate: (pluginId: string) => Promise<PluginUpdateInfo>
    doUpdate: (pluginId: string) => Promise<{ ok: boolean; message?: string }>
    emitHook: (hookName: string, data: Record<string, unknown>) => void
    buildContext: (data: Record<string, unknown>) => Promise<Record<string, string>>
    onBroadcast: (cb: (event: string, payload: unknown) => void) => () => void
  } | undefined
}

/** 获取已加载的插件列表 */
export async function listPlugins(): Promise<PluginInfo[]> {
  const api = getPluginsAPI()
  if (!api) return []
  try {
    return await api.list()
  } catch (err) {
    console.error('[PluginBridge] list failed:', err)
    return []
  }
}

/** 获取插件配置 */
export async function getPluginConfig(pluginId: string): Promise<Record<string, unknown>> {
  const api = getPluginsAPI()
  if (!api) return {}
  try {
    return await api.getConfig(pluginId)
  } catch (err) {
    console.error('[PluginBridge] getConfig failed:', err)
    return {}
  }
}

/** 保存插件配置 */
export async function setPluginConfig(pluginId: string, config: Record<string, unknown>): Promise<boolean> {
  const api = getPluginsAPI()
  if (!api) return false
  try {
    const result = await api.setConfig(pluginId, config)
    return result.ok
  } catch (err) {
    console.error('[PluginBridge] setConfig failed:', err)
    return false
  }
}

/** 获取插件配置 Schema（JSON Schema） */
export async function getPluginSchema(pluginId: string): Promise<Record<string, unknown> | null> {
  const api = getPluginsAPI()
  if (!api) return null
  try {
    return await api.getSchema(pluginId)
  } catch (err) {
    console.error('[PluginBridge] getSchema failed:', err)
    return null
  }
}

/** 检查插件更新 */
export async function checkPluginUpdate(pluginId: string): Promise<PluginUpdateInfo> {
  const api = getPluginsAPI()
  if (!api) return { hasUpdate: false }
  try {
    return await api.checkUpdate(pluginId)
  } catch (err) {
    console.error('[PluginBridge] checkUpdate failed:', err)
    return { hasUpdate: false }
  }
}

/** 执行插件更新 */
export async function doPluginUpdate(pluginId: string): Promise<{ ok: boolean; message?: string }> {
  const api = getPluginsAPI()
  if (!api) return { ok: false, message: 'Not in Electron mode' }
  try {
    return await api.doUpdate(pluginId)
  } catch (err) {
    console.error('[PluginBridge] doUpdate failed:', err)
    return { ok: false, message: String(err) }
  }
}

/** 发送 Hook 事件到插件系统（fire-and-forget） */
export function emitPluginHook(hookName: string, data: Record<string, unknown>): void {
  const api = getPluginsAPI()
  if (!api) return
  try {
    api.emitHook(hookName, data)
  } catch (err) {
    console.error('[PluginBridge] emitHook failed:', err)
  }
}

/** 调用 before_prompt_build Hook（需要返回值） */
export async function buildPluginContext(data: Record<string, unknown>): Promise<Record<string, string>> {
  const api = getPluginsAPI()
  if (!api) return {}
  try {
    return await api.buildContext(data)
  } catch (err) {
    console.error('[PluginBridge] buildContext failed:', err)
    return {}
  }
}

/** 监听插件广播事件 */
export function onPluginBroadcast(cb: (event: string, payload: unknown) => void): () => void {
  const api = getPluginsAPI()
  if (!api) return () => {}
  try {
    return api.onBroadcast(cb)
  } catch (err) {
    console.error('[PluginBridge] onBroadcast failed:', err)
    return () => {}
  }
}

/**
 * 初始化插件广播监听器
 * 1. 主动拉取已注册的 Provider（解决启动时序问题）
 * 2. 监听后续的 Provider 注册/移除广播
 */
export function initPluginBroadcastListener(storeActions: {
  addProvider: (provider: {
    id: string; label: string; baseUrl: string; apiKey: string;
    apiProtocol: string; source: string; models: Array<{
      id: string; name: string; contextWindow?: number; maxTokens?: number;
      reasoning?: boolean; input?: string[];
    }>; createdAt: number; updatedAt: number;
  }) => void
  removeProvider: (id: string) => void
  getProviders: () => Array<{ id: string }>
}): () => void {
  const api = getPluginsAPI()

  // 主动拉取已注册的 Provider（插件在主进程启动时已注册，广播可能已错过）
  if (api) {
    api.getProviders().then((providers) => {
      for (const p of providers) {
        const existing = storeActions.getProviders()
        const provider = p as { id: string; label: string; baseUrl: string; apiKey: string; apiProtocol: string; models: Array<{ id: string; name: string }> }
        if (!existing.some(ep => ep.id === provider.id)) {
          const now = Date.now()
          storeActions.addProvider({
            ...provider,
            source: 'plugin',
            createdAt: now,
            updatedAt: now,
          })
          console.log(`[PluginBridge] Provider synced from plugin: ${provider.label}`)
        }
      }
    }).catch((err) => {
      console.error('[PluginBridge] Failed to fetch plugin providers:', err)
    })
  }

  // 监听后续广播
  return onPluginBroadcast((event, payload) => {
    if (event === 'plugin:provider-registered') {
      const p = payload as {
        id: string; label: string; baseUrl: string; apiKey: string;
        apiProtocol: string; models: Array<{
          id: string; name: string; contextWindow?: number; maxTokens?: number;
          reasoning?: boolean; input?: string[];
        }>
      }
      const existing = storeActions.getProviders()
      if (existing.some(ep => ep.id === p.id)) return
      const now = Date.now()
      storeActions.addProvider({
        ...p,
        source: 'plugin',
        createdAt: now,
        updatedAt: now,
      })
      console.log(`[PluginBridge] Provider registered from plugin: ${p.label}`)
    } else if (event === 'plugin:provider-removed') {
      const { providerId } = payload as { providerId: string }
      storeActions.removeProvider(providerId)
      console.log(`[PluginBridge] Provider removed by plugin: ${providerId}`)
    }
  })
}
