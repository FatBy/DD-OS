import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Wifi, WifiOff, RefreshCw, AlertCircle, ChevronUp, ChevronDown,
  Power, PowerOff, Activity, Clock, Key, Eye, EyeOff, Globe
} from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import { openClawService } from '@/services/OpenClawService'

// 存储 keys
const TOKEN_STORAGE_KEY = 'openclaw_auth_token'
const GATEWAY_STORAGE_KEY = 'openclaw_gateway_url'

const statusConfig = {
  disconnected: {
    color: 'bg-slate-400',
    textColor: 'text-slate-400',
    icon: WifiOff,
    label: '未连接',
    pulse: false,
  },
  connecting: {
    color: 'bg-cyan-400',
    textColor: 'text-cyan-400',
    icon: Wifi,
    label: '连接中...',
    pulse: true,
  },
  connected: {
    color: 'bg-emerald-400',
    textColor: 'text-emerald-400',
    icon: Wifi,
    label: '已连接',
    pulse: true,
  },
  reconnecting: {
    color: 'bg-amber-400',
    textColor: 'text-amber-400',
    icon: RefreshCw,
    label: '重连中',
    pulse: true,
  },
  error: {
    color: 'bg-red-400',
    textColor: 'text-red-400',
    icon: AlertCircle,
    label: '连接失败',
    pulse: false,
  },
}

export function ConnectionPanel() {
  const [isExpanded, setIsExpanded] = useState(false)
  const [token, setToken] = useState('')
  const [gatewayUrl, setGatewayUrl] = useState('')
  const [showToken, setShowToken] = useState(false)
  
  const status = useStore((s) => s.connectionStatus)
  const reconnectAttempt = useStore((s) => s.reconnectAttempt)
  const reconnectCountdown = useStore((s) => s.reconnectCountdown)
  const connectionError = useStore((s) => s.connectionError)
  const agentStatus = useStore((s) => s.agentStatus)
  const logs = useStore((s) => s.logs)

  // 从 localStorage 加载配置
  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY)
    const savedGateway = localStorage.getItem(GATEWAY_STORAGE_KEY)
    if (savedToken) {
      setToken(savedToken)
    }
    if (savedGateway) {
      setGatewayUrl(savedGateway)
    }
  }, [])

  const config = statusConfig[status]
  const Icon = config.icon

  const handleConnect = () => {
    // 保存配置到 localStorage
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token)
    }
    if (gatewayUrl) {
      localStorage.setItem(GATEWAY_STORAGE_KEY, gatewayUrl)
    }
    openClawService.setGatewayUrl(gatewayUrl)
    openClawService.setAuthToken(token)
    openClawService.connect().catch(console.error)
  }

  const handleDisconnect = () => {
    openClawService.disconnect()
  }

  const handleRetry = () => {
    openClawService.setGatewayUrl(gatewayUrl)
    openClawService.setAuthToken(token)
    openClawService.retry()
  }

  const isConnected = status === 'connected'
  const isConnecting = status === 'connecting' || status === 'reconnecting'

  // 最近5条日志
  const recentLogs = logs.slice(-5).reverse()

  return (
    <div className="fixed bottom-6 left-6 z-40">
      {/* 主状态栏 - 可点击展开 */}
      <motion.div
        className={cn(
          'flex items-center gap-2 px-3 py-2 bg-slate-900/80 backdrop-blur-xl rounded-xl border border-white/10 cursor-pointer hover:bg-slate-900/90 transition-colors',
          isExpanded && 'rounded-b-none border-b-0'
        )}
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5 }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* 状态指示点 */}
        <div className="relative">
          <div className={cn('w-2.5 h-2.5 rounded-full', config.color)} />
          {config.pulse && (
            <motion.div
              className={cn('absolute inset-0 w-2.5 h-2.5 rounded-full', config.color)}
              animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </div>

        {/* 状态图标 */}
        <Icon
          className={cn(
            'w-3.5 h-3.5',
            config.textColor,
            status === 'reconnecting' && 'animate-spin'
          )}
        />

        {/* 状态文字 */}
        <span className={cn('text-xs font-mono', config.textColor)}>
          {config.label}
          {status === 'reconnecting' && reconnectAttempt > 0 && (
            <span className="ml-1 opacity-70">({reconnectAttempt}/10)</span>
          )}
          {status === 'reconnecting' && reconnectCountdown !== null && (
            <span className="ml-1 opacity-70">{reconnectCountdown}s</span>
          )}
        </span>

        {/* 展开/收起指示 */}
        <div className="ml-auto pl-2 border-l border-white/10">
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-white/40" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 text-white/40" />
          )}
        </div>
      </motion.div>

      {/* 展开面板 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="w-80 bg-slate-900/80 backdrop-blur-xl rounded-b-xl border border-t-0 border-white/10 p-4 space-y-4">
              {/* Gateway 地址输入 */}
              {!isConnected && (
                <div className="space-y-2">
                  <h4 className="text-xs font-mono text-white/50 uppercase tracking-wider flex items-center gap-1">
                    <Globe className="w-3 h-3" /> Gateway 地址 (可选)
                  </h4>
                  <input
                    type="text"
                    value={gatewayUrl}
                    onChange={(e) => setGatewayUrl(e.target.value)}
                    placeholder="留空使用代理，或填 IP:18789 直连"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white/80 placeholder:text-white/30 focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20 transition-all"
                  />
                  <p className="text-[9px] text-white/30 font-mono">
                    留空 = 通过 Vite/nginx 代理；填写 = 浏览器直连
                  </p>
                </div>
              )}

              {/* Token 输入 */}
              {!isConnected && (
                <div className="space-y-2">
                  <h4 className="text-xs font-mono text-white/50 uppercase tracking-wider flex items-center gap-1">
                    <Key className="w-3 h-3" /> 认证令牌
                  </h4>
                  <div className="relative">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="输入 OpenClaw Token..."
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 pr-10 text-xs font-mono text-white/80 placeholder:text-white/30 focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/70 transition-colors"
                    >
                      {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-[9px] text-white/30 font-mono">
                    运行 <code className="text-cyan-400/70">openclaw auth token</code> 获取令牌
                  </p>
                </div>
              )}

              {/* 连接控制 */}
              <div className="space-y-3">
                <h4 className="text-xs font-mono text-white/50 uppercase tracking-wider">
                  连接控制
                </h4>
                
                <div className="flex gap-2">
                  {!isConnected && !isConnecting && (
                    <button
                      onClick={handleConnect}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg border border-emerald-500/30 transition-colors text-xs font-mono"
                    >
                      <Power className="w-3.5 h-3.5" />
                      连接
                    </button>
                  )}
                  
                  {isConnected && (
                    <button
                      onClick={handleDisconnect}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg border border-red-500/30 transition-colors text-xs font-mono"
                    >
                      <PowerOff className="w-3.5 h-3.5" />
                      断开
                    </button>
                  )}

                  {isConnecting && (
                    <button
                      onClick={handleDisconnect}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-lg border border-amber-500/30 transition-colors text-xs font-mono"
                    >
                      <PowerOff className="w-3.5 h-3.5" />
                      取消
                    </button>
                  )}

                  {status === 'error' && (
                    <button
                      onClick={handleRetry}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded-lg border border-cyan-500/30 transition-colors text-xs font-mono"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      重试
                    </button>
                  )}
                </div>

                {/* 错误信息 */}
                {connectionError && (
                  <div className="p-2 bg-red-500/10 rounded-lg border border-red-500/20">
                    <p className="text-[10px] font-mono text-red-400">{connectionError}</p>
                  </div>
                )}
              </div>

              {/* Agent 状态 */}
              {isConnected && (
                <div className="space-y-2">
                  <h4 className="text-xs font-mono text-white/50 uppercase tracking-wider">
                    Agent 状态
                  </h4>
                  <div className="flex items-center gap-2 p-2 bg-white/5 rounded-lg">
                    <Activity className={cn(
                      'w-4 h-4',
                      agentStatus === 'idle' && 'text-slate-400',
                      agentStatus === 'thinking' && 'text-cyan-400 animate-pulse',
                      agentStatus === 'executing' && 'text-amber-400 animate-pulse',
                      agentStatus === 'error' && 'text-red-400'
                    )} />
                    <span className="text-xs font-mono text-white/70 capitalize">
                      {agentStatus === 'idle' && '空闲'}
                      {agentStatus === 'thinking' && '思考中...'}
                      {agentStatus === 'executing' && '执行中...'}
                      {agentStatus === 'error' && '错误'}
                    </span>
                  </div>
                </div>
              )}

              {/* 连接信息 */}
              <div className="space-y-2">
                <h4 className="text-xs font-mono text-white/50 uppercase tracking-wider">
                  连接信息
                </h4>
                <div className="space-y-1.5 text-[10px] font-mono">
                  <div className="flex justify-between text-white/40">
                    <span className="flex items-center gap-1">
                      <Globe className="w-3 h-3" /> Gateway
                    </span>
                    <span className="text-white/60 truncate max-w-[140px]">
                      {gatewayUrl || '127.0.0.1:18789'}
                    </span>
                  </div>
                  <div className="flex justify-between text-white/40">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> 心跳
                    </span>
                    <span className="text-white/60">15s / 30s 超时</span>
                  </div>
                  <div className="flex justify-between text-white/40">
                    <span className="flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" /> 重连
                    </span>
                    <span className="text-white/60">指数退避 (最多10次)</span>
                  </div>
                </div>
              </div>

              {/* 最近日志 */}
              {recentLogs.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-mono text-white/50 uppercase tracking-wider">
                    最近日志
                  </h4>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {recentLogs.map((log) => {
                      const time = log.timestamp 
                        ? new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })
                        : '--:--:--'
                      return (
                        <div
                          key={log.id}
                          className={cn(
                            'text-[9px] font-mono p-1.5 rounded bg-white/5 truncate',
                            log.level === 'error' && 'text-red-400',
                            log.level === 'warn' && 'text-amber-400',
                            log.level === 'info' && 'text-white/50'
                          )}
                        >
                          [{time}] {log.message}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
