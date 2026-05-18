/**
 * 瘦连接门面 — App.tsx 和 ConnectionPanel 使用
 *
 * 不直接 import LocalClawService 及其 40 个传递依赖，
 * 而是在首次需要时动态加载，降低首屏模块图大小。
 */

// 缓存完整服务实例
let _svc: Awaited<typeof import('./LocalClawService')>['localClawService'] | null = null

async function svc() {
  if (!_svc) {
    const mod = await import('./LocalClawService')
    _svc = mod.localClawService
  }
  return _svc
}

/** 注入 store 引用 */
export async function injectStore(storeActions: any): Promise<void> {
  const s = await svc()
  s.injectStore(storeActions)
}

/** 注册首次/重连回调，返回取消函数 */
export async function onConnected(
  cb: (isReconnect: boolean) => void,
): Promise<() => void> {
  const s = await svc()
  return s.onConnected(cb)
}

/** 启动自动连接，返回取消函数 */
export async function autoConnect(firstLaunch = false): Promise<() => void> {
  const s = await svc()
  return s.autoConnect(firstLaunch)
}

/** 断开连接 */
export async function disconnect(): Promise<void> {
  const s = await svc()
  s.disconnect()
}

/** 手动重试 */
export async function retry(): Promise<void> {
  const s = await svc()
  s.retry()
}
