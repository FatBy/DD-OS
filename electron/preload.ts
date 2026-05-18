import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true as const,
  getServerUrl: () => 'http://127.0.0.1:3001',
  platform: process.platform,
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  // 剪贴板 API
  clipboard: {
    readFilePaths: (): Promise<string[]> => ipcRenderer.invoke('clipboard:read-file-paths'),
    readImage: (): Promise<string | null> => ipcRenderer.invoke('clipboard:read-image'),
    availableFormats: (): Promise<string[]> => ipcRenderer.invoke('clipboard:available-formats'),
  },
  // 自动更新 API
  updater: {
    onStatus: (cb: (data: Record<string, unknown>) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, data: Record<string, unknown>) => cb(data)
      ipcRenderer.on('updater:status', listener)
      return () => { ipcRenderer.removeListener('updater:status', listener) }
    },
    check: (): Promise<void> => ipcRenderer.invoke('updater:check'),
    download: (): Promise<void> => ipcRenderer.invoke('updater:download'),
    install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
    openReleases: (): Promise<void> => ipcRenderer.invoke('updater:open-releases'),
  },
  // 插件系统 API
  plugins: {
    list: (): Promise<Array<{
      id: string; name: string; version: string; description?: string;
      status: string; errorMessage?: string; hasConfigSchema: boolean;
    }>> => ipcRenderer.invoke('plugin:list'),
    getProviders: (): Promise<Array<Record<string, unknown>>> =>
      ipcRenderer.invoke('plugin:get-providers'),
    getConfig: (pluginId: string): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke('plugin:get-config', pluginId),
    setConfig: (pluginId: string, config: Record<string, unknown>): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('plugin:set-config', pluginId, config),
    getSchema: (pluginId: string): Promise<Record<string, unknown> | null> =>
      ipcRenderer.invoke('plugin:get-schema', pluginId),
    checkUpdate: (pluginId: string): Promise<{ hasUpdate: boolean; latestVersion?: string; currentVersion?: string }> =>
      ipcRenderer.invoke('plugin:check-update', pluginId),
    doUpdate: (pluginId: string): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('plugin:do-update', pluginId),
    emitHook: (hookName: string, data: Record<string, unknown>): void =>
      ipcRenderer.send('plugin:emit-hook', hookName, data),
    buildContext: (data: Record<string, unknown>): Promise<Record<string, string>> =>
      ipcRenderer.invoke('plugin:build-context', data),
    onBroadcast: (cb: (event: string, payload: unknown) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, event: string, payload: unknown) => cb(event, payload)
      ipcRenderer.on('plugin:broadcast', listener)
      return () => { ipcRenderer.removeListener('plugin:broadcast', listener) }
    },
  },
})
