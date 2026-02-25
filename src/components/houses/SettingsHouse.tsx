import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { 
  Monitor, Info, Check, Sparkles, Eye, EyeOff, Type, Wifi, WifiOff, Palette, Globe, Languages
} from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { staggerContainer, staggerItem } from '@/utils/animations'
import { useStore } from '@/store'
import { testConnection } from '@/services/llmService'
import { cn } from '@/utils/cn'
import { themes } from '@/themes'
import { useT } from '@/i18n'
import type { TranslationKey } from '@/i18n/locales/zh'
import type { ThemeName } from '@/types/theme'
import type { WorldTheme } from '@/rendering/types'

const WORLD_THEME_OPTIONS: Array<{
  id: WorldTheme
  labelKey: TranslationKey
  descKey: TranslationKey
  color: string
}> = [
  { id: 'cosmos', labelKey: 'settings.world_cosmos', descKey: 'settings.world_cosmos_desc', color: 'rgb(56, 189, 248)' },
  { id: 'cityscape', labelKey: 'settings.world_cityscape', descKey: 'settings.world_cityscape_desc', color: 'rgb(251, 191, 36)' },
  { id: 'village', labelKey: 'settings.world_village', descKey: 'settings.world_village_desc', color: 'rgb(126, 200, 80)' },
  { id: 'minimalist', labelKey: 'settings.world_minimalist', descKey: 'settings.world_minimalist_desc', color: 'rgb(168, 162, 158)' },
]

const settingsData: Array<{
  id: string
  labelKey: TranslationKey
  descKey: TranslationKey
  enabled: boolean
}> = [
  { id: 'particles', labelKey: 'settings.particles', descKey: 'settings.particles_desc', enabled: true },
  { id: 'glow', labelKey: 'settings.glow', descKey: 'settings.glow_desc', enabled: true },
]

export function SettingsHouse() {
  const t = useT()

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
  
  // 主题设置
  const currentTheme = useStore((s) => s.currentTheme)
  const setTheme = useStore((s) => s.setTheme)
  
  // 世界主题
  const worldTheme = useStore((s) => s.worldTheme)
  const setWorldTheme = useStore((s) => s.setWorldTheme)

  // 语言设置
  const locale = useStore((s) => s.locale)
  const setLocale = useStore((s) => s.setLocale)
  
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
            {t('settings.system_status')}
          </h3>
        </div>

        <GlassCard className="p-4">
          <div className="space-y-2 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-white/50">{t('settings.connection_mode')}</span>
              <span className={cn(
                isConnected ? 'text-emerald-400' : 'text-white/30'
              )}>
                {connectionMode === 'native' ? 'Native' : 'DD-OS Cloud'} · {isConnected ? t('settings.connected') : t('settings.disconnected')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">{t('settings.agent_status')}</span>
              <span className={cn(
                agentStatus === 'idle' ? 'text-white/40' :
                agentStatus === 'thinking' ? 'text-cyan-400' :
                agentStatus === 'executing' ? 'text-amber-400' :
                'text-red-400'
              )}>
                {agentStatus === 'idle' ? t('settings.agent_idle') :
                 agentStatus === 'thinking' ? t('settings.agent_thinking') :
                 agentStatus === 'executing' ? t('settings.agent_executing') :
                 agentStatus}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">{t('settings.loaded_data')}</span>
              <span className="text-white/60">
                Soul {soulCoreTruths.length > 0 ? '✓' : '–'} · 
                Skills {skills.length} · 
                Memories {memories.length}
              </span>
            </div>
          </div>
          {isConnected && (
            <p className="text-[13px] text-white/20 font-mono mt-3 border-t border-white/5 pt-2">
              {t('settings.auto_sync_hint')}
            </p>
          )}
        </GlassCard>
      </div>

      {/* AI 能力配置 */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h3 className="font-mono text-sm text-amber-300 tracking-wider">
            {t('settings.ai_config')}
          </h3>
        </div>
        
        <GlassCard className="p-4 space-y-3">
          <div>
            <label className="text-xs font-mono text-white/50 mb-1 block">{t('settings.api_base_url')}</label>
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
            <label className="text-xs font-mono text-white/50 mb-1 block">{t('settings.api_key')}</label>
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
            <label className="text-xs font-mono text-white/50 mb-1 block">{t('settings.model')}</label>
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
              {llmTestStatus === 'testing' ? t('settings.testing') : 
               llmTestStatus === 'success' ? t('settings.test_success') : 
               llmTestStatus === 'error' ? t('settings.test_failed') : t('settings.test_connection')}
            </button>
            
            {llmTestStatus === 'success' && (
              <span className="text-[13px] text-emerald-400 font-mono flex items-center gap-1">
                <Check className="w-3 h-3" /> {t('settings.ai_ready')}
              </span>
            )}
          </div>
          
          <p className="text-[13px] text-white/30 font-mono">
            {t('settings.api_compat_hint')}
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
            {t('settings.visual')}
          </h3>
        </div>

        <div className="space-y-3">
          {settingsData.map((setting) => (
            <motion.div key={setting.id} variants={staggerItem}>
              <GlassCard className="p-4 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-mono text-white/80">
                    {t(setting.labelKey)}
                  </h4>
                  <p className="text-xs text-white/40 mt-0.5">
                    {t(setting.descKey)}
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
                <h4 className="text-sm font-mono text-white/80">{t('settings.font_size')}</h4>
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
              <div className="flex justify-between text-[13px] font-mono text-white/30 mt-1">
                <span>80%</span>
                <span>100%</span>
                <span>150%</span>
              </div>
            </GlassCard>
          </motion.div>

          {/* 主题切换 */}
          <motion.div variants={staggerItem}>
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Palette className="w-4 h-4 text-skin-accent-purple" />
                <h4 className="text-sm font-mono text-skin-text-secondary">{t('settings.ui_theme')}</h4>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(themes) as ThemeName[]).map((themeName) => {
                  const theme = themes[themeName]
                  const isActive = currentTheme === themeName
                  return (
                    <button
                      key={themeName}
                      onClick={() => setTheme(themeName)}
                      className={cn(
                        'relative p-3 rounded-lg border transition-all',
                        isActive
                          ? 'border-skin-accent-cyan bg-skin-accent-cyan/10'
                          : 'border-skin-border/20 hover:border-skin-border/40 bg-skin-bg-secondary/20'
                      )}
                    >
                      {/* 主题预览色块 */}
                      <div className="flex gap-1 mb-2 justify-center">
                        <div 
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: `rgb(${theme.colors.accentCyan})` }}
                        />
                        <div 
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: `rgb(${theme.colors.accentAmber})` }}
                        />
                        <div 
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: `rgb(${theme.colors.accentPurple})` }}
                        />
                      </div>
                      <span className={cn(
                        'text-[13px] font-mono block text-center',
                        isActive ? 'text-skin-accent-cyan' : 'text-skin-text-tertiary'
                      )}>
                        {theme.label}
                      </span>
                      {isActive && (
                        <div className="absolute top-1 right-1">
                          <Check className="w-3 h-3 text-skin-accent-cyan" />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
              <p className="text-[13px] text-skin-text-tertiary font-mono mt-3">
                {t('settings.theme_apply_hint')}
              </p>
            </GlassCard>
          </motion.div>

          {/* 世界主题 */}
          <motion.div variants={staggerItem}>
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Globe className="w-4 h-4 text-skin-accent-cyan" />
                <h4 className="text-sm font-mono text-skin-text-secondary">{t('settings.world_theme')}</h4>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {WORLD_THEME_OPTIONS.map((option) => {
                  const isActive = worldTheme === option.id
                  // cosmos/cityscape/village/minimalist 已实现，wildlife 开发中
                  const isAvailable = option.id === 'cosmos' || option.id === 'cityscape' || option.id === 'village' || option.id === 'minimalist'
                  return (
                    <button
                      key={option.id}
                      onClick={() => isAvailable && setWorldTheme(option.id)}
                      className={cn(
                        'relative p-3 rounded-lg border transition-all',
                        !isAvailable && 'opacity-40 cursor-not-allowed',
                        isActive
                          ? 'border-skin-accent-cyan bg-skin-accent-cyan/10'
                          : 'border-skin-border/20 hover:border-skin-border/40 bg-skin-bg-secondary/20'
                      )}
                    >
                      <div 
                        className="w-4 h-4 rounded-full mx-auto mb-2"
                        style={{ backgroundColor: option.color }}
                      />
                      <span className={cn(
                        'text-[13px] font-mono block text-center',
                        isActive ? 'text-skin-accent-cyan' : 'text-skin-text-tertiary'
                      )}>
                        {t(option.labelKey)}
                      </span>
                      <span className="text-[11px] font-mono block text-center text-skin-text-tertiary mt-0.5">
                        {isAvailable ? t(option.descKey) : t('settings.world_dev')}
                      </span>
                      {isActive && (
                        <div className="absolute top-1 right-1">
                          <Check className="w-3 h-3 text-skin-accent-cyan" />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
              <p className="text-[13px] text-skin-text-tertiary font-mono mt-3">
                {t('settings.world_theme_hint')}
              </p>
            </GlassCard>
          </motion.div>

          {/* 语言切换 */}
          <motion.div variants={staggerItem}>
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Languages className="w-4 h-4 text-skin-accent-cyan" />
                <h4 className="text-sm font-mono text-skin-text-secondary">{t('settings.language')}</h4>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setLocale('zh')}
                  className={cn(
                    'relative p-3 rounded-lg border transition-all',
                    locale === 'zh'
                      ? 'border-skin-accent-cyan bg-skin-accent-cyan/10'
                      : 'border-skin-border/20 hover:border-skin-border/40 bg-skin-bg-secondary/20'
                  )}
                >
                  <span className={cn(
                    'text-[13px] font-mono block text-center',
                    locale === 'zh' ? 'text-skin-accent-cyan' : 'text-skin-text-tertiary'
                  )}>
                    中文
                  </span>
                  {locale === 'zh' && (
                    <div className="absolute top-1 right-1">
                      <Check className="w-3 h-3 text-skin-accent-cyan" />
                    </div>
                  )}
                </button>
                <button
                  onClick={() => setLocale('en')}
                  className={cn(
                    'relative p-3 rounded-lg border transition-all',
                    locale === 'en'
                      ? 'border-skin-accent-cyan bg-skin-accent-cyan/10'
                      : 'border-skin-border/20 hover:border-skin-border/40 bg-skin-bg-secondary/20'
                  )}
                >
                  <span className={cn(
                    'text-[13px] font-mono block text-center',
                    locale === 'en' ? 'text-skin-accent-cyan' : 'text-skin-text-tertiary'
                  )}>
                    English
                  </span>
                  {locale === 'en' && (
                    <div className="absolute top-1 right-1">
                      <Check className="w-3 h-3 text-skin-accent-cyan" />
                    </div>
                  )}
                </button>
              </div>
              <p className="text-[13px] text-skin-text-tertiary font-mono mt-3">
                {t('settings.language_hint')}
              </p>
            </GlassCard>
          </motion.div>
        </div>
      </motion.div>

      {/* 关于 */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Info className="w-4 h-4 text-slate-400" />
          <h3 className="font-mono text-sm text-slate-300 tracking-wider">
            {t('settings.about')}
          </h3>
        </div>
        <GlassCard className="p-4">
          <div className="space-y-2 font-mono text-xs text-white/50">
            <div className="flex justify-between">
              <span>{t('settings.version')}</span>
              <span className="text-white/70">DD-OS v1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span>{t('settings.run_mode')}</span>
              <span className="text-cyan-400">
                {connectionMode === 'native' ? t('settings.native_local') : t('settings.openclaw_network')}
              </span>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
