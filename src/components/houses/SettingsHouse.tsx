import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { 
  Monitor, Info, Check, Sparkles, Eye, EyeOff, Type, Wifi, WifiOff
} from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { staggerContainer, staggerItem } from '@/utils/animations'
import { useStore } from '@/store'
import { testConnection } from '@/services/llmService'
import { cn } from '@/utils/cn'

const settingsData = [
  {
    id: 'particles',
    label: '粒子动画',
    description: '世界背景中的浮动粒子效果',
    enabled: true,
  },
  {
    id: 'glow',
    label: '发光特效',
    description: '节点和连线的发光效果',
    enabled: true,
  },
]

export function SettingsHouse() {
  // Store 状态
  const connectionStatus = useStore((s) => s.connectionStatus)
  const connectionMode = useStore((s) => s.connectionMode)
  const agentStatus = useStore((s) => s.agentStatus)
  const skills = useStore((s) => s.skills)
  const memories = useStore((s) => s.memories)
  const soulCoreTruths = useStore((s) => s.soulCoreTruths)

  // LLM 配置
  const llmConfig = useStore((s) => s.llmConfig)
  const setLlmConfig = useStore((s) => s.setLlmConfig)
  const setLlmConnected = useStore((s) => s.setLlmConnected)
  const [llmApiKey, setLlmApiKey] = useState(llmConfig.apiKey || '')
  const [llmBaseUrl, setLlmBaseUrl] = useState(llmConfig.baseUrl || '')
  const [llmModel, setLlmModel] = useState(llmConfig.model || '')
  const [llmTestStatus, setLlmTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [showApiKey, setShowApiKey] = useState(false)
  
  // UI 设置
  const [fontScale, setFontScale] = useState(() => {
    const saved = localStorage.getItem('ddos_font_scale')
    return saved ? parseFloat(saved) : 1
  })
  
  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(fontScale))
    localStorage.setItem('ddos_font_scale', String(fontScale))
  }, [fontScale])

  // 自动保存 LLM 配置
  useEffect(() => {
    if (llmApiKey || llmBaseUrl || llmModel) {
      setLlmConfig({ apiKey: llmApiKey, baseUrl: llmBaseUrl, model: llmModel })
    }
  }, [llmApiKey, llmBaseUrl, llmModel])
  
  const saveLlmSettings = () => {
    setLlmConfig({ apiKey: llmApiKey, baseUrl: llmBaseUrl, model: llmModel })
  }

  const handleTestLlm = async () => {
    saveLlmSettings()
    setLlmTestStatus('testing')
    try {
      const ok = await testConnection({ apiKey: llmApiKey, baseUrl: llmBaseUrl, model: llmModel })
      setLlmTestStatus(ok ? 'success' : 'error')
      setLlmConnected(ok)
      setTimeout(() => setLlmTestStatus('idle'), 3000)
    } catch {
      setLlmTestStatus('error')
      setLlmConnected(false)
      setTimeout(() => setLlmTestStatus('idle'), 3000)
    }
  }

  const isConnected = connectionStatus === 'connected'

  return (
    <div className="p-6 h-full overflow-y-auto space-y-6">

      {/* 连接状态概览 */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          {isConnected ? (
            <Wifi className="w-4 h-4 text-emerald-400" />
          ) : (
            <WifiOff className="w-4 h-4 text-white/30" />
          )}
          <h3 className="font-mono text-sm text-slate-300 tracking-wider">
            系统状态
          </h3>
        </div>

        <GlassCard className="p-4">
          <div className="space-y-2 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-white/50">连接模式</span>
              <span className={cn(
                isConnected ? 'text-emerald-400' : 'text-white/30'
              )}>
                {connectionMode === 'native' ? 'Native' : 'OpenClaw'} · {isConnected ? '已连接' : '未连接'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Agent 状态</span>
              <span className={cn(
                agentStatus === 'idle' ? 'text-white/40' :
                agentStatus === 'thinking' ? 'text-cyan-400' :
                agentStatus === 'executing' ? 'text-amber-400' :
                'text-red-400'
              )}>
                {agentStatus === 'idle' ? '空闲' :
                 agentStatus === 'thinking' ? '思考中' :
                 agentStatus === 'executing' ? '执行中' :
                 agentStatus}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">已加载数据</span>
              <span className="text-white/60">
                Soul {soulCoreTruths.length > 0 ? '✓' : '–'} · 
                Skills {skills.length} · 
                Memories {memories.length}
              </span>
            </div>
          </div>
          {isConnected && (
            <p className="text-[10px] text-white/20 font-mono mt-3 border-t border-white/5 pt-2">
              数据在连接时自动从后端同步，无需手动加载
            </p>
          )}
        </GlassCard>
      </div>

      {/* AI 能力配置 */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h3 className="font-mono text-sm text-amber-300 tracking-wider">
            AI 能力配置
          </h3>
        </div>
        
        <GlassCard className="p-4 space-y-3">
          <div>
            <label className="text-xs font-mono text-white/50 mb-1 block">API Base URL</label>
            <input
              type="text"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              onBlur={saveLlmSettings}
              placeholder="https://api.deepseek.com/v1"
              className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg 
                         text-xs font-mono text-white/70 placeholder-white/30
                         focus:border-amber-500/50 focus:outline-none"
            />
          </div>
          
          <div>
            <label className="text-xs font-mono text-white/50 mb-1 block">API Key</label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                  onBlur={saveLlmSettings}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 pr-8 bg-black/30 border border-white/10 rounded-lg 
                             text-xs font-mono text-white/70 placeholder-white/30
                             focus:border-amber-500/50 focus:outline-none"
                />
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                >
                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
          
          <div>
            <label className="text-xs font-mono text-white/50 mb-1 block">Model</label>
            <input
              type="text"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              onBlur={saveLlmSettings}
              placeholder="deepseek-chat"
              className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg 
                         text-xs font-mono text-white/70 placeholder-white/30
                         focus:border-amber-500/50 focus:outline-none"
            />
          </div>
          
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleTestLlm}
              disabled={llmTestStatus === 'testing' || !llmApiKey || !llmBaseUrl || !llmModel}
              className={cn(
                'px-4 py-2 rounded-lg text-xs font-mono transition-colors',
                llmTestStatus === 'testing'
                  ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400 animate-pulse'
                  : llmTestStatus === 'success'
                  ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
                  : llmTestStatus === 'error'
                  ? 'bg-red-500/20 border border-red-500/30 text-red-400'
                  : !llmApiKey || !llmBaseUrl || !llmModel
                  ? 'bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
                  : 'bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/30'
              )}
            >
              {llmTestStatus === 'testing' ? '测试中...' : 
               llmTestStatus === 'success' ? '连接成功' : 
               llmTestStatus === 'error' ? '连接失败' : '测试连接'}
            </button>
            
            {llmTestStatus === 'success' && (
              <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                <Check className="w-3 h-3" /> AI 已就绪
              </span>
            )}
          </div>
          
          <p className="text-[10px] text-white/30 font-mono">
            支持所有兼容 OpenAI 格式的 API（DeepSeek、GPT-4、Claude 代理等）
          </p>
        </GlassCard>
      </div>

      {/* 视觉设置 */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <div className="flex items-center gap-2 mb-4">
          <Monitor className="w-4 h-4 text-slate-400" />
          <h3 className="font-mono text-sm text-slate-300 tracking-wider">
            视觉设置
          </h3>
        </div>

        <div className="space-y-3">
          {settingsData.map((setting) => (
            <motion.div key={setting.id} variants={staggerItem}>
              <GlassCard className="p-4 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-mono text-white/80">
                    {setting.label}
                  </h4>
                  <p className="text-xs text-white/40 mt-0.5">
                    {setting.description}
                  </p>
                </div>
                <div className="w-10 h-5 bg-white/10 rounded-full relative cursor-pointer border border-white/10">
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                      setting.enabled
                        ? 'left-5 bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.5)]'
                        : 'left-0.5 bg-white/30'
                    }`}
                  />
                </div>
              </GlassCard>
            </motion.div>
          ))}
          
          {/* 字体缩放 */}
          <motion.div variants={staggerItem}>
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Type className="w-4 h-4 text-cyan-400" />
                <h4 className="text-sm font-mono text-white/80">字体大小</h4>
                <span className="ml-auto text-xs font-mono text-cyan-400">
                  {Math.round(fontScale * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.8"
                max="1.5"
                step="0.1"
                value={fontScale}
                onChange={(e) => setFontScale(parseFloat(e.target.value))}
                className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer
                           [&::-webkit-slider-thumb]:appearance-none
                           [&::-webkit-slider-thumb]:w-4
                           [&::-webkit-slider-thumb]:h-4
                           [&::-webkit-slider-thumb]:rounded-full
                           [&::-webkit-slider-thumb]:bg-cyan-400
                           [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(34,211,238,0.5)]
                           [&::-webkit-slider-thumb]:cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono text-white/30 mt-1">
                <span>80%</span>
                <span>100%</span>
                <span>150%</span>
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </motion.div>

      {/* 关于 */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Info className="w-4 h-4 text-slate-400" />
          <h3 className="font-mono text-sm text-slate-300 tracking-wider">
            关于
          </h3>
        </div>
        <GlassCard className="p-4">
          <div className="space-y-2 font-mono text-xs text-white/50">
            <div className="flex justify-between">
              <span>版本</span>
              <span className="text-white/70">DD-OS v1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span>运行模式</span>
              <span className="text-cyan-400">
                {connectionMode === 'native' ? 'Native (本地)' : 'OpenClaw (网络)'}
              </span>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
