import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { 
  Monitor, Info, Check, Type, Wifi, WifiOff, Globe, Languages, Store, LogOut, Loader2,
  Puzzle, RefreshCw, Save, AlertCircle, ChevronDown, ChevronUp
} from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { staggerContainer, staggerItem } from '@/utils/animations'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import { isElectronMode } from '@/utils/env'
import { useT } from '@/i18n'
import {
  listPlugins, getPluginConfig, setPluginConfig, getPluginSchema, checkPluginUpdate,
  type PluginInfo
} from '@/services/pluginBridge'
import type { TranslationKey } from '@/i18n/locales/zh'
import type { WorldTheme } from '@/rendering/types'

const WORLD_THEME_OPTIONS: Array<{
  id: WorldTheme
  labelKey: TranslationKey
  descKey: TranslationKey
  color: string
}> = [
  { id: 'dashboard', labelKey: 'settings.world_dashboard', descKey: 'settings.world_dashboard_desc', color: 'rgb(232, 168, 56)' },
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

function PluginSettingsSection() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingConfig, setEditingConfig] = useState<Record<string, unknown> | null>(null)
  const [configSchema, setConfigSchema] = useState<Record<string, unknown> | null>(null)
  const [saving, setSaving] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<Record<string, { checking: boolean; hasUpdate?: boolean; latestVersion?: string }>>({})

  const loadPlugins = useCallback(async () => {
    setLoading(true)
    try {
      const list = await listPlugins()
      setPlugins(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPlugins() }, [loadPlugins])

  const handleExpand = async (pluginId: string) => {
    if (expandedId === pluginId) {
      setExpandedId(null)
      setEditingConfig(null)
      setConfigSchema(null)
      return
    }
    setExpandedId(pluginId)
    const [config, schema] = await Promise.all([
      getPluginConfig(pluginId),
      getPluginSchema(pluginId),
    ])
    setEditingConfig(config)
    setConfigSchema(schema)
  }

  const handleSave = async (pluginId: string) => {
    if (!editingConfig) return
    setSaving(true)
    try {
      await setPluginConfig(pluginId, editingConfig)
      await loadPlugins()
    } finally {
      setSaving(false)
    }
  }

  const handleCheckUpdate = async (pluginId: string) => {
    setUpdateStatus(prev => ({ ...prev, [pluginId]: { checking: true } }))
    try {
      const info = await checkPluginUpdate(pluginId)
      setUpdateStatus(prev => ({ ...prev, [pluginId]: { checking: false, ...info } }))
    } catch {
      setUpdateStatus(prev => ({ ...prev, [pluginId]: { checking: false } }))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-stone-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        加载插件...
      </div>
    )
  }

  if (plugins.length === 0) {
    return <p className="text-xs text-stone-400">暂无已安装的插件</p>
  }

  return (
    <div className="space-y-2">
      {plugins.map((plugin) => {
        const isExpanded = expandedId === plugin.id
        const update = updateStatus[plugin.id]
        return (
          <div key={plugin.id} className="border border-stone-200 rounded-lg overflow-hidden">
            <button
              onClick={() => handleExpand(plugin.id)}
              className="w-full flex items-center justify-between p-3 hover:bg-stone-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className={cn(
                  'w-2 h-2 rounded-full',
                  plugin.status === 'loaded' ? 'bg-emerald-400' : 'bg-red-400'
                )} />
                <span className="text-sm font-mono text-stone-700">{plugin.name}</span>
                <span className="text-[11px] text-stone-400">v{plugin.version}</span>
              </div>
              {isExpanded ? <ChevronUp className="w-4 h-4 text-stone-400" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
            </button>

            {isExpanded && (
              <div className="px-3 pb-3 space-y-3 border-t border-stone-100">
                {plugin.description && (
                  <p className="text-xs text-stone-400 pt-2">{plugin.description}</p>
                )}

                {plugin.status === 'error' && plugin.errorMessage && (
                  <div className="flex items-start gap-2 text-xs text-red-400 bg-red-50 rounded p-2">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{plugin.errorMessage}</span>
                  </div>
                )}

                {/* 配置编辑器 */}
                {plugin.hasConfigSchema && editingConfig && configSchema && (
                  <div className="space-y-2">
                    <SchemaConfigEditor
                      schema={configSchema}
                      config={editingConfig}
                      onChange={setEditingConfig}
                    />
                    <button
                      onClick={() => handleSave(plugin.id)}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-cyan-500/20 text-cyan-500 rounded-lg hover:bg-cyan-500/30 disabled:opacity-50 transition-colors"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      保存配置
                    </button>
                  </div>
                )}

                {/* 检查更新 */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCheckUpdate(plugin.id)}
                    disabled={update?.checking}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-stone-500 border border-stone-200 rounded-lg hover:bg-stone-50 disabled:opacity-50 transition-colors"
                  >
                    {update?.checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    检查更新
                  </button>
                  {update && !update.checking && (
                    <span className={cn('text-xs font-mono', update.hasUpdate ? 'text-amber-500' : 'text-stone-400')}>
                      {update.hasUpdate ? `新版本: v${update.latestVersion}` : '已是最新'}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 基于 JSON Schema 的简易配置编辑器 */
function SchemaConfigEditor({
  schema,
  config,
  onChange,
  prefix = '',
}: {
  schema: Record<string, unknown>
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
  prefix?: string
}) {
  const properties = (schema as { properties?: Record<string, Record<string, unknown>> }).properties
  if (!properties) return null

  const updateField = (key: string, value: unknown) => {
    onChange({ ...config, [key]: value })
  }

  return (
    <div className="space-y-2">
      {Object.entries(properties).map(([key, prop]) => {
        const fieldType = prop.type as string
        const title = (prop.title as string) || key
        const description = prop.description as string | undefined
        const currentValue = config[key]
        const fullKey = prefix ? `${prefix}.${key}` : key

        if (fieldType === 'object') {
          return (
            <div key={fullKey} className="pl-3 border-l-2 border-stone-200">
              <p className="text-xs font-mono text-stone-600 mb-1">{title}</p>
              <SchemaConfigEditor
                schema={prop}
                config={(currentValue as Record<string, unknown>) || {}}
                onChange={(nested) => updateField(key, nested)}
                prefix={fullKey}
              />
            </div>
          )
        }

        if (fieldType === 'boolean') {
          return (
            <label key={fullKey} className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-xs font-mono text-stone-600">{title}</span>
                {description && <p className="text-[11px] text-stone-400">{description}</p>}
              </div>
              <input
                type="checkbox"
                checked={!!currentValue}
                onChange={(e) => updateField(key, e.target.checked)}
                className="w-4 h-4 rounded border-stone-300 text-cyan-500 focus:ring-cyan-400"
              />
            </label>
          )
        }

        // string / number
        return (
          <div key={fullKey}>
            <label className="text-xs font-mono text-stone-600">{title}</label>
            {description && <p className="text-[11px] text-stone-400">{description}</p>}
            <input
              type={fieldType === 'number' ? 'number' : 'text'}
              value={(currentValue as string | number) ?? (prop.default as string | number) ?? ''}
              onChange={(e) => updateField(key, fieldType === 'number' ? Number(e.target.value) : e.target.value)}
              placeholder={(prop.default as string) || ''}
              className="mt-1 w-full px-2 py-1.5 text-xs font-mono bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:border-cyan-400 text-stone-700"
            />
          </div>
        )
      })}
    </div>
  )
}

function ClawHubAccountSection() {
  const isAuthenticated = useStore(s => s.clawHubAuthenticated)
  const user = useStore(s => s.clawHubUser)
  const authLoading = useStore(s => s.clawHubAuthLoading)
  const login = useStore(s => s.clawHubLogin)
  const logout = useStore(s => s.clawHubLogout)
  const validateToken = useStore(s => s.clawHubValidateToken)

  // 启动时验证 token
  useEffect(() => {
    validateToken()
  }, [])

  if (authLoading) {
    return (
      <div className="flex items-center gap-2 text-stone-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        验证中...
      </div>
    )
  }

  if (isAuthenticated && user) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {user.avatar && (
              <img src={user.avatar} alt="" className="w-8 h-8 rounded-full" />
            )}
            <div>
              <p className="text-sm text-stone-800 font-medium">{user.username}</p>
              <p className="text-xs text-stone-400">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-emerald-500/10 text-emerald-400 rounded-full">
              <Check className="w-3 h-3" />
              已连接
            </span>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-stone-400 hover:text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-100/80 transition-colors"
        >
          <LogOut className="w-3 h-3" />
          断开连接
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-400">
        连接 ClawHub 账户以发布和管理你的技能。
      </p>
      <button
        onClick={() => login()}
        disabled={authLoading}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 disabled:opacity-50 transition-colors"
      >
        <Store className="w-4 h-4" />
        连接 ClawHub
      </button>
    </div>
  )
}

export function SettingsHouse() {
  const t = useT()

  // Store 状态
  const connectionStatus = useStore((s) => s.connectionStatus)
  const agentStatus = useStore((s) => s.agentStatus)
  const skills = useStore((s) => s.skills)
  const memories = useStore((s) => s.memories)
  const soulCoreTruths = useStore((s) => s.soulCoreTruths)

  // UI 设置
  const [fontScale, setFontScale] = useState(() => {
    const saved = localStorage.getItem('duncrew_font_scale')
    return saved ? parseFloat(saved) : 1
  })
  
  // 世界主题
  const worldTheme = useStore((s) => s.worldTheme)
  const setWorldTheme = useStore((s) => s.setWorldTheme)

  // 语言设置
  const locale = useStore((s) => s.locale)
  const setLocale = useStore((s) => s.setLocale)
  
  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(fontScale))
    localStorage.setItem('duncrew_font_scale', String(fontScale))
  }, [fontScale])

  const isConnected = connectionStatus === 'connected'

  return (
    <div className="p-6 h-full overflow-y-auto space-y-6">

      {/* 连接状态概览 */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          {isConnected ? (
            <Wifi className="w-4 h-4 text-emerald-400" />
          ) : (
            <WifiOff className="w-4 h-4 text-stone-300" />
          )}
          <h3 className="font-mono text-sm text-stone-400 tracking-wider">
            {t('settings.system_status')}
          </h3>
        </div>

        <GlassCard className="p-4">
          <div className="space-y-2 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-stone-400">{t('settings.connection_mode')}</span>
              <span className={cn(
                isConnected ? 'text-emerald-400' : 'text-stone-300'
              )}>
                Native · {isConnected ? t('settings.connected') : t('settings.disconnected')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-400">{t('settings.agent_status')}</span>
              <span className={cn(
                agentStatus === 'idle' ? 'text-stone-400' :
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
              <span className="text-stone-400">{t('settings.loaded_data')}</span>
              <span className="text-stone-500">
                Soul {soulCoreTruths.length > 0 ? '✓' : '–'} · 
                Skills {skills.length} · 
                Memories {memories.length}
              </span>
            </div>
          </div>
          {isConnected && (
            <p className="text-[13px] text-stone-300 font-mono mt-3 border-t border-stone-100 pt-2">
              {t('settings.auto_sync_hint')}
            </p>
          )}
        </GlassCard>
      </div>

      {/* 视觉设置 */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <div className="flex items-center gap-2 mb-4">
          <Monitor className="w-4 h-4 text-stone-400" />
          <h3 className="font-mono text-sm text-stone-400 tracking-wider">
            {t('settings.visual')}
          </h3>
        </div>

        <div className="space-y-3">
          {settingsData.map((setting) => (
            <motion.div key={setting.id} variants={staggerItem}>
              <GlassCard className="p-4 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-mono text-stone-700">
                    {t(setting.labelKey)}
                  </h4>
                  <p className="text-xs text-stone-400 mt-0.5">
                    {t(setting.descKey)}
                  </p>
                </div>
                <div className="w-10 h-5 bg-stone-100 rounded-full relative cursor-pointer border border-stone-200">
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
                <h4 className="text-sm font-mono text-stone-700">{t('settings.font_size')}</h4>
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
                className="w-full h-2 bg-stone-100 rounded-lg appearance-none cursor-pointer
                           [&::-webkit-slider-thumb]:appearance-none
                           [&::-webkit-slider-thumb]:w-4
                           [&::-webkit-slider-thumb]:h-4
                           [&::-webkit-slider-thumb]:rounded-full
                           [&::-webkit-slider-thumb]:bg-cyan-400
                           [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(34,211,238,0.5)]
                           [&::-webkit-slider-thumb]:cursor-pointer"
              />
              <div className="flex justify-between text-[13px] font-mono text-stone-300 mt-1">
                <span>80%</span>
                <span>100%</span>
                <span>150%</span>
              </div>
            </GlassCard>
          </motion.div>

          {/* 世界主题 */}
          <motion.div variants={staggerItem}>
            <GlassCard className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Globe className="w-4 h-4 text-skin-accent-cyan" />
                <h4 className="text-sm font-mono text-skin-text-secondary">{t('settings.world_theme')}</h4>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {WORLD_THEME_OPTIONS.map((option) => {
                  const isActive = worldTheme === option.id
                  return (
                    <button
                      key={option.id}
                      onClick={() => setWorldTheme(option.id)}
                      className={cn(
                        'relative p-3 rounded-lg border transition-all',
                        isActive
                          ? 'border-skin-accent-cyan bg-skin-accent-cyan/10'
                          : 'border-stone-200 hover:border-skin-border/40 bg-skin-bg-secondary/20'
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
                        {t(option.descKey)}
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
                      : 'border-stone-200 hover:border-skin-border/40 bg-skin-bg-secondary/20'
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
                      : 'border-stone-200 hover:border-skin-border/40 bg-skin-bg-secondary/20'
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
          <Info className="w-4 h-4 text-stone-400" />
          <h3 className="font-mono text-sm text-stone-400 tracking-wider">
            {t('settings.about')}
          </h3>
        </div>
        <GlassCard className="p-4">
          <div className="space-y-2 font-mono text-xs text-stone-400">
            <div className="flex justify-between">
              <span>{t('settings.version')}</span>
              <span className="text-stone-600">DunCrew v1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span>{t('settings.run_mode')}</span>
              <span className="text-cyan-400">
                {t('settings.native_local')}
              </span>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* ClawHub 账户 */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Store className="w-4 h-4 text-cyan-400" />
          <h3 className="font-mono text-sm text-cyan-300 tracking-wider">
            ClawHub 账户
          </h3>
        </div>
        <GlassCard className="p-4">
          <ClawHubAccountSection />
        </GlassCard>
      </div>

      {/* 插件管理 (仅 Electron 模式) */}
      {isElectronMode && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Puzzle className="w-4 h-4 text-cyan-400" />
            <h3 className="font-mono text-sm text-cyan-300 tracking-wider">
              插件管理
            </h3>
          </div>
          <GlassCard className="p-4">
            <PluginSettingsSection />
          </GlassCard>
        </div>
      )}
    </div>
  )
}
