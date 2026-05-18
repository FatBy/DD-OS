/**
 * DunCrew Plugin Host
 *
 * Electron 主进程中的插件运行时宿主。
 * 职责：发现、加载、管理插件生命周期，提供 Hook 事件系统和 IPC 桥接。
 */

import { app, ipcMain, BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

// ============================================
// 类型定义
// ============================================

interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  entry: string
  updateUrl?: string
  configSchema?: Record<string, unknown>
}

interface PluginInstance {
  manifest: PluginManifest
  status: 'loaded' | 'error'
  errorMessage?: string
  pluginDir: string
  deactivate?: () => Promise<void> | void
}

interface ProviderConfig {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  apiProtocol: 'openai' | 'anthropic' | 'auto'
  models: Array<{
    id: string
    name: string
    contextWindow?: number
    maxTokens?: number
    reasoning?: boolean
    input?: string[]
  }>
}

type HookHandler = (event: Record<string, unknown>) => Promise<unknown> | unknown

interface PluginAPI {
  pluginConfig: Record<string, unknown>
  pluginDataDir: string
  logger: {
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
  on: (hookName: string, handler: HookHandler) => void
  saveConfig: (config: Record<string, unknown>) => void
  registerProvider: (provider: ProviderConfig) => void
  removeProvider: (providerId: string) => void
  broadcast: (event: string, payload: unknown) => void
}

// ============================================
// PluginHost
// ============================================

export class PluginHost {
  private mainWindow: BrowserWindow
  private plugins: Map<string, PluginInstance> = new Map()
  private hookRegistry: Map<string, Set<HookHandler>> = new Map()
  private registeredProviders: Map<string, ProviderConfig> = new Map()
  private configDir: string
  private userPluginDir: string
  private builtinPluginDir: string
  private _shutdown = false

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
    const userData = app.getPath('userData')
    this.configDir = path.join(userData, 'plugin-configs')
    this.userPluginDir = path.join(userData, 'plugins')
    // 内置插件：开发模式从项目目录读，生产模式从 resources 读
    this.builtinPluginDir = app.isPackaged
      ? path.join(process.resourcesPath, 'plugins')
      : path.join(__dirname, 'plugins')
  }

  async initialize(): Promise<void> {
    // 确保配置目录存在
    this.ensureDir(this.configDir)
    this.ensureDir(this.userPluginDir)

    // 注册 IPC handlers
    this.registerIPC()

    // 发现并加载插件
    await this.loadAllPlugins()

    console.log(`[PluginHost] Initialized: ${this.plugins.size} plugin(s) loaded`)
  }

  shutdown(): void {
    if (this._shutdown) return
    this._shutdown = true

    for (const [id, plugin] of this.plugins) {
      try {
        plugin.deactivate?.()
      } catch {
        // 退出阶段静默忽略所有错误（stdout/窗口可能已不可用）
      }
    }
    this.plugins.clear()
    this.hookRegistry.clear()
  }

  // ============================================
  // 插件发现与加载
  // ============================================

  private async loadAllPlugins(): Promise<void> {
    const pluginDirs: string[] = []

    // 1. 内置插件
    if (fs.existsSync(this.builtinPluginDir)) {
      for (const name of fs.readdirSync(this.builtinPluginDir)) {
        const dir = path.join(this.builtinPluginDir, name)
        if (fs.statSync(dir).isDirectory()) {
          pluginDirs.push(dir)
        }
      }
    }

    // 2. 用户插件
    if (fs.existsSync(this.userPluginDir)) {
      for (const name of fs.readdirSync(this.userPluginDir)) {
        const dir = path.join(this.userPluginDir, name)
        if (fs.statSync(dir).isDirectory()) {
          pluginDirs.push(dir)
        }
      }
    }

    for (const dir of pluginDirs) {
      await this.loadPlugin(dir)
    }
  }

  private async loadPlugin(pluginDir: string): Promise<void> {
    const manifestPath = path.join(pluginDir, 'plugin.json')
    if (!fs.existsSync(manifestPath)) {
      console.warn(`[PluginHost] No plugin.json in ${pluginDir}, skipping`)
      return
    }

    let manifest: PluginManifest
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    } catch (err) {
      console.error(`[PluginHost] Failed to parse plugin.json in ${pluginDir}:`, err)
      return
    }

    if (!manifest.id || !manifest.entry) {
      console.error(`[PluginHost] Invalid manifest in ${pluginDir}: missing id or entry`)
      return
    }

    // 跳过已加载的同 ID 插件（内置优先）
    if (this.plugins.has(manifest.id)) {
      console.warn(`[PluginHost] Plugin ${manifest.id} already loaded, skipping ${pluginDir}`)
      return
    }

    const entryPath = path.join(pluginDir, manifest.entry)
    if (!fs.existsSync(entryPath)) {
      console.error(`[PluginHost] Entry file not found: ${entryPath}`)
      this.plugins.set(manifest.id, {
        manifest,
        status: 'error',
        errorMessage: `Entry file not found: ${manifest.entry}`,
        pluginDir,
      })
      return
    }

    try {
      const pluginConfig = this.loadPluginConfig(manifest.id)
      const api = this.buildPluginAPI(manifest.id, pluginConfig, pluginDir)

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pluginModule = require(entryPath)
      const activateFn = pluginModule.activate || pluginModule.default?.activate || pluginModule.default

      if (typeof activateFn !== 'function') {
        throw new Error('Plugin must export an activate function')
      }

      const result = await activateFn(api)

      this.plugins.set(manifest.id, {
        manifest,
        status: 'loaded',
        pluginDir,
        deactivate: result?.deactivate,
      })

      console.log(`[PluginHost] Loaded plugin: ${manifest.name} v${manifest.version}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[PluginHost] Failed to load plugin ${manifest.id}:`, message)
      this.plugins.set(manifest.id, {
        manifest,
        status: 'error',
        errorMessage: message,
        pluginDir,
      })
    }
  }

  // ============================================
  // PluginAPI 工厂
  // ============================================

  private buildPluginAPI(
    pluginId: string,
    pluginConfig: Record<string, unknown>,
    pluginDir: string
  ): PluginAPI {
    const pluginDataDir = path.join(this.configDir, pluginId + '-data')
    this.ensureDir(pluginDataDir)

    return {
      pluginConfig,
      pluginDataDir,
      logger: {
        info: (...args: unknown[]) => { if (!this._shutdown) console.log(`[Plugin:${pluginId}]`, ...args) },
        warn: (...args: unknown[]) => { if (!this._shutdown) console.warn(`[Plugin:${pluginId}]`, ...args) },
        error: (...args: unknown[]) => { if (!this._shutdown) console.error(`[Plugin:${pluginId}]`, ...args) },
      },
      on: (hookName: string, handler: HookHandler) => {
        if (!this.hookRegistry.has(hookName)) {
          this.hookRegistry.set(hookName, new Set())
        }
        this.hookRegistry.get(hookName)!.add(handler)
      },
      saveConfig: (config: Record<string, unknown>) => {
        this.savePluginConfig(pluginId, config)
      },
      registerProvider: (provider: ProviderConfig) => {
        this.registeredProviders.set(provider.id, provider)
        this.broadcast('plugin:provider-registered', provider)
      },
      removeProvider: (providerId: string) => {
        this.registeredProviders.delete(providerId)
        this.broadcast('plugin:provider-removed', { providerId })
      },
      broadcast: (event: string, payload: unknown) => {
        this.broadcast(event, payload)
      },
    }
  }

  // ============================================
  // Hook 系统
  // ============================================

  async triggerHook(hookName: string, data: Record<string, unknown>): Promise<void> {
    const handlers = this.hookRegistry.get(hookName)
    if (!handlers || handlers.size === 0) return

    const TIMEOUT_MS = 5000
    const promises = Array.from(handlers).map((handler) =>
      Promise.race([
        Promise.resolve(handler(data)),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Hook handler timeout (${TIMEOUT_MS}ms)`)), TIMEOUT_MS)
        ),
      ]).catch((err) => {
        console.error(`[PluginHost] Hook ${hookName} handler error:`, err)
      })
    )

    await Promise.allSettled(promises)
  }

  async triggerHookWithReturn(
    hookName: string,
    data: Record<string, unknown>
  ): Promise<Record<string, string>> {
    const handlers = this.hookRegistry.get(hookName)
    if (!handlers || handlers.size === 0) return {}

    const TIMEOUT_MS = 3000
    const results = await Promise.allSettled(
      Array.from(handlers).map((handler) =>
        Promise.race([
          Promise.resolve(handler(data)),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Hook timeout (${TIMEOUT_MS}ms)`)), TIMEOUT_MS)
          ),
        ])
      )
    )

    // 合并所有成功的返回值
    const merged: Record<string, string> = {}
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value && typeof result.value === 'object') {
        const val = result.value as Record<string, string>
        if (val.prependSystemContext) {
          merged.prependSystemContext = (merged.prependSystemContext || '') + '\n' + val.prependSystemContext
        }
        if (val.prependContext) {
          merged.prependContext = (merged.prependContext || '') + '\n' + val.prependContext
        }
      }
    }

    return merged
  }

  // ============================================
  // 插件配置持久化
  // ============================================

  private loadPluginConfig(pluginId: string): Record<string, unknown> {
    const configPath = path.join(this.configDir, `${pluginId}.json`)
    try {
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      }
    } catch (err) {
      console.error(`[PluginHost] Failed to read config for ${pluginId}:`, err)
    }
    return {}
  }

  private savePluginConfig(pluginId: string, config: Record<string, unknown>): void {
    const configPath = path.join(this.configDir, `${pluginId}.json`)
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    } catch (err) {
      console.error(`[PluginHost] Failed to save config for ${pluginId}:`, err)
    }
  }

  // ============================================
  // 插件更新
  // ============================================

  private async checkPluginUpdate(pluginId: string): Promise<{
    hasUpdate: boolean
    latestVersion?: string
    currentVersion?: string
  }> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) return { hasUpdate: false }

    const updateUrl = plugin.manifest.updateUrl
    if (!updateUrl) return { hasUpdate: false, currentVersion: plugin.manifest.version }

    try {
      const https = await import('https')
      const http = await import('http')
      const fetcher = updateUrl.startsWith('https') ? https : http

      const response = await new Promise<string>((resolve, reject) => {
        const req = fetcher.get(updateUrl, { timeout: 10000 }, (res) => {
          let data = ''
          res.on('data', (chunk: Buffer) => { data += chunk.toString() })
          res.on('end', () => resolve(data))
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
      })

      const info = JSON.parse(response)
      const latestVersion = info.version as string
      const hasUpdate = latestVersion !== plugin.manifest.version

      return { hasUpdate, latestVersion, currentVersion: plugin.manifest.version }
    } catch (err) {
      console.error(`[PluginHost] Update check failed for ${pluginId}:`, err)
      return { hasUpdate: false, currentVersion: plugin.manifest.version }
    }
  }

  // ============================================
  // IPC 注册
  // ============================================

  private registerIPC(): void {
    // 获取插件列表
    ipcMain.handle('plugin:list', () => {
      const list: Array<{
        id: string
        name: string
        version: string
        description?: string
        status: string
        errorMessage?: string
        hasConfigSchema: boolean
      }> = []

      for (const [id, plugin] of this.plugins) {
        list.push({
          id,
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          description: plugin.manifest.description,
          status: plugin.status,
          errorMessage: plugin.errorMessage,
          hasConfigSchema: !!plugin.manifest.configSchema,
        })
      }

      return list
    })

    // 获取所有已注册的 Provider（渲染进程启动后拉取）
    ipcMain.handle('plugin:get-providers', () => {
      return Array.from(this.registeredProviders.values())
    })

    // 获取插件配置
    ipcMain.handle('plugin:get-config', (_event, pluginId: string) => {
      return this.loadPluginConfig(pluginId)
    })

    // 保存插件配置（保存后重新加载插件）
    ipcMain.handle('plugin:set-config', async (_event, pluginId: string, config: Record<string, unknown>) => {
      this.savePluginConfig(pluginId, config)

      // 重新激活插件以应用新配置
      const plugin = this.plugins.get(pluginId)
      if (plugin && plugin.status === 'loaded') {
        try {
          await plugin.deactivate?.()
        } catch { /* ignore */ }

        // 清除该插件注册的 hooks
        for (const handlers of this.hookRegistry.values()) {
          // 无法精确区分哪个 handler 属于哪个插件，全部重载更安全
        }

        // 重新加载
        this.plugins.delete(pluginId)
        this.hookRegistry.clear() // 简单起见清除所有 hook，重新加载所有插件
        await this.loadAllPlugins()

        this.broadcast('plugin:config-changed', { pluginId })
      }

      return { ok: true }
    })

    // 获取插件配置 Schema
    ipcMain.handle('plugin:get-schema', (_event, pluginId: string) => {
      const plugin = this.plugins.get(pluginId)
      return plugin?.manifest.configSchema || null
    })

    // 检查插件更新
    ipcMain.handle('plugin:check-update', async (_event, pluginId: string) => {
      return this.checkPluginUpdate(pluginId)
    })

    // 执行插件更新（预留，具体下载逻辑依赖 updateUrl 返回的格式）
    ipcMain.handle('plugin:do-update', async (_event, pluginId: string) => {
      console.log(`[PluginHost] Plugin update requested for ${pluginId} (not yet implemented)`)
      return { ok: false, message: 'Plugin update not yet implemented' }
    })

    // 前端 Hook 事件转发（fire-and-forget）
    ipcMain.on('plugin:emit-hook', (_event, hookName: string, data: Record<string, unknown>) => {
      this.triggerHook(hookName, data).catch((err) => {
        console.error(`[PluginHost] Hook ${hookName} trigger error:`, err)
      })
    })

    // before_prompt_build（需要返回值）
    ipcMain.handle('plugin:build-context', async (_event, data: Record<string, unknown>) => {
      return this.triggerHookWithReturn('before_prompt_build', data)
    })
  }

  // ============================================
  // 工具方法
  // ============================================

  private broadcast(event: string, payload: unknown): void {
    try {
      if (!this._shutdown && this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('plugin:broadcast', event, payload)
      }
    } catch {
      // 窗口可能已关闭
    }
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }
}
