import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { 
  Monitor, Cpu, Info, Database, Upload, Download, Trash2, 
  Check, Ghost, Brain, ScrollText, RefreshCw, Server, Wifi, Sparkles, Eye, EyeOff, Type
} from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { FileDropZone } from '@/components/FileDropZone'
import { staggerContainer, staggerItem } from '@/utils/animations'
import { useStore } from '@/store'
import {
  getDataMode, setDataMode, DataMode,
  saveSoulMd, getSoulMd,
  saveIdentityMd, getIdentityMd,
  getLocalSoulData, getLocalSkills, getLocalMemories,
  parseSkillsFromText, saveSkillsJson,
  parseMemoriesFromMd, saveMemoriesJson,
  clearLocalData, hasLocalData,
  exportConfig, importConfig,
} from '@/utils/localDataProvider'
import { fetchLocalServerData, LOCAL_SERVER_URL, type LocalServerData } from '@/utils/localServerClient'
import { testConnection } from '@/services/llmService'

interface SettingToggle {
  id: string
  label: string
  description: string
  enabled: boolean
}

const settingsData: SettingToggle[] = [
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

// 数据输入组件
function DataInputSection({ 
  title, 
  icon: Icon, 
  value, 
  onChange,
  placeholder,
  onApply,
  applied,
}: {
  title: string
  icon: React.ElementType
  value: string
  onChange: (v: string) => void
  placeholder: string
  onApply: () => void
  applied: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-mono text-white/80">{title}</span>
        </div>
        <button
          onClick={onApply}
          className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
            applied 
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30'
          }`}
        >
          {applied ? <Check className="w-3 h-3" /> : '应用'}
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-32 p-3 bg-black/30 border border-white/10 rounded-lg 
                   text-xs font-mono text-white/70 placeholder-white/30
                   focus:border-cyan-500/50 focus:outline-none resize-none"
      />
    </div>
  )
}

export function SettingsHouse() {
  const [dataMode, setDataModeState] = useState<DataMode>('local')
  const [soulMd, setSoulMdInput] = useState('')
  const [identityMd, setIdentityMdInput] = useState('')
  const [skillsText, setSkillsText] = useState('')
  const [memoriesMd, setMemoriesMd] = useState('')
  
  const [soulApplied, setSoulApplied] = useState(false)
  const [skillsApplied, setSkillsApplied] = useState(false)
  const [memoriesApplied, setMemoriesApplied] = useState(false)
  
  // Store actions
  const setSoulFromParsed = useStore((s) => s.setSoulFromParsed)
  const setOpenClawSkills = useStore((s) => s.setOpenClawSkills)
  const setMemoriesFromLocal = useStore((s) => s.setMemories)
  const connectionStatus = useStore((s) => s.connectionStatus)
  
  // LLM 配置
  const llmConfig = useStore((s) => s.llmConfig)
  const setLlmConfig = useStore((s) => s.setLlmConfig)
  const setLlmConnected = useStore((s) => s.setLlmConnected)
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmBaseUrl, setLlmBaseUrl] = useState('')
  const [llmModel, setLlmModel] = useState('')
  const [llmTestStatus, setLlmTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [showApiKey, setShowApiKey] = useState(false)
  
  // UI 设置
  const [fontScale, setFontScale] = useState(() => {
    const saved = localStorage.getItem('ddos_font_scale')
    return saved ? parseFloat(saved) : 1
  })
  
  // 应用字体缩放到 CSS 变量
  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(fontScale))
    localStorage.setItem('ddos_font_scale', String(fontScale))
  }, [fontScale])
  
  // 初始化：从 localStorage 加载
  useEffect(() => {
    setDataModeState(getDataMode())
    setSoulMdInput(getSoulMd() || '')
    setIdentityMdInput(getIdentityMd() || '')
    
    const skills = getLocalSkills()
    if (skills.length > 0) {
      setSkillsText(skills.map(s => `${s.name} - ${s.description || ''} (${s.location})`).join('\n'))
    }
    
    const memories = getLocalMemories()
    if (memories.length > 0) {
      setMemoriesMd(memories.map(m => `## ${m.title}\n${m.content}`).join('\n\n'))
    }
    
    // 加载 LLM 配置
    setLlmApiKey(llmConfig.apiKey)
    setLlmBaseUrl(llmConfig.baseUrl)
    setLlmModel(llmConfig.model)
    
    // 自动加载本地数据到 store
    loadLocalDataToStore()
  }, [])
  
  // 加载本地数据到 store
  const loadLocalDataToStore = () => {
    const soulData = getLocalSoulData()
    if (soulData) {
      setSoulFromParsed({
        title: '',
        subtitle: soulData.identity.essence,
        coreTruths: soulData.coreTruths,
        boundaries: soulData.boundaries,
        vibeStatement: soulData.vibeStatement,
        continuityNote: soulData.continuityNote,
        rawContent: soulData.rawContent,
      }, null)
    }
    
    const skills = getLocalSkills()
    if (skills.length > 0) {
      setOpenClawSkills(skills)
    }
    
    const memories = getLocalMemories()
    if (memories.length > 0) {
      setMemoriesFromLocal(memories)
    }
  }
  
  // 应用 Soul 数据
  const applySoul = () => {
    saveSoulMd(soulMd)
    saveIdentityMd(identityMd)
    
    const soulData = getLocalSoulData()
    if (soulData) {
      setSoulFromParsed({
        title: '',
        subtitle: soulData.identity.essence,
        coreTruths: soulData.coreTruths,
        boundaries: soulData.boundaries,
        vibeStatement: soulData.vibeStatement,
        continuityNote: soulData.continuityNote,
        rawContent: soulData.rawContent,
      }, null)
    }
    
    setSoulApplied(true)
    setTimeout(() => setSoulApplied(false), 2000)
  }
  
  // 应用 Skills 数据
  const applySkills = () => {
    const skills = parseSkillsFromText(skillsText)
    saveSkillsJson(skills)
    setOpenClawSkills(skills)
    
    setSkillsApplied(true)
    setTimeout(() => setSkillsApplied(false), 2000)
  }
  
  // 应用 Memories 数据
  const applyMemories = () => {
    const memories = parseMemoriesFromMd(memoriesMd)
    saveMemoriesJson(memories)
    setMemoriesFromLocal(memories)
    
    setMemoriesApplied(true)
    setTimeout(() => setMemoriesApplied(false), 2000)
  }
  
  // 切换数据模式
  const toggleDataMode = (mode: DataMode) => {
    setDataModeState(mode)
    setDataMode(mode)
  }
  
  // 本地服务状态
  const [serverStatus, setServerStatus] = useState<'checking' | 'connected' | 'disconnected'>('disconnected')
  const [serverUrl, setServerUrl] = useState(LOCAL_SERVER_URL)
  
  // 检查本地服务
  const checkServer = async () => {
    setServerStatus('checking')
    try {
      const res = await fetch(`${serverUrl}/status`, { method: 'GET' })
      if (res.ok) {
        setServerStatus('connected')
      } else {
        setServerStatus('disconnected')
      }
    } catch {
      setServerStatus('disconnected')
    }
  }
  
  // 从本地服务加载数据
  const loadFromServer = async () => {
    try {
      const data = await fetchLocalServerData(serverUrl)
      
      if (data.soul?.content) {
        setSoulMdInput(data.soul.content)
        saveSoulMd(data.soul.content)
        if (data.soul.identity) {
          setIdentityMdInput(data.soul.identity)
          saveIdentityMd(data.soul.identity)
        }
      }
      
      if (data.skills && data.skills.length > 0) {
        setSkillsText(data.skills.map(s => `${s.name} - ${s.description || ''} (${s.location})`).join('\n'))
        saveSkillsJson(data.skills)
        setOpenClawSkills(data.skills)
      }
      
      if (data.memories && data.memories.length > 0) {
        setMemoriesMd(data.memories.map(m => `## ${m.title}\n${m.content}`).join('\n\n'))
        saveMemoriesJson(data.memories)
        setMemoriesFromLocal(data.memories)
      }
      
      loadLocalDataToStore()
      setServerStatus('connected')
    } catch (err) {
      console.error('Failed to load from server:', err)
      setServerStatus('disconnected')
    }
  }
  
  // 处理拖拽文件
  const handleFileDrop = (content: string, fileName: string, fileType: string) => {
    switch (fileType) {
      case 'soul':
        setSoulMdInput(content)
        saveSoulMd(content)
        applySoul()
        break
      case 'identity':
        setIdentityMdInput(content)
        saveIdentityMd(content)
        break
      case 'skills':
        if (fileName.endsWith('.json')) {
          try {
            const skills = JSON.parse(content)
            if (Array.isArray(skills)) {
              setSkillsText(skills.map((s: any) => `${s.name} - ${s.description || ''}`).join('\n'))
              saveSkillsJson(skills)
              setOpenClawSkills(skills)
            }
          } catch {}
        } else {
          setSkillsText(content)
          applySkills()
        }
        break
      case 'memory':
        setMemoriesMd(content)
        applyMemories()
        break
      case 'config':
        try {
          const config = JSON.parse(content)
          importConfig(config)
          setSoulMdInput(config.soulMd || '')
          setIdentityMdInput(config.identityMd || '')
          if (config.skills?.length) {
            setSkillsText(config.skills.map((s: any) => `${s.name} - ${s.description || ''}`).join('\n'))
          }
          loadLocalDataToStore()
        } catch {}
        break
      default:
        // 尝试自动检测
        if (content.includes('Core Truths') || content.includes('Boundaries')) {
          setSoulMdInput(content)
          saveSoulMd(content)
        }
    }
  }
  
  // 导出配置
  const handleExport = () => {
    const config = exportConfig()
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ddos-config.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  
  // 导入配置
  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        const reader = new FileReader()
        reader.onload = (ev) => {
          try {
            const config = JSON.parse(ev.target?.result as string)
            importConfig(config)
            // 重新加载
            setSoulMdInput(config.soulMd || '')
            setIdentityMdInput(config.identityMd || '')
            if (config.skills?.length) {
              setSkillsText(config.skills.map((s: any) => `${s.name} - ${s.description || ''}`).join('\n'))
            }
            loadLocalDataToStore()
          } catch (err) {
            console.error('Failed to import config:', err)
          }
        }
        reader.readAsText(file)
      }
    }
    input.click()
  }
  
  // 清除数据
  const handleClear = () => {
    if (confirm('确定要清除所有本地数据吗？')) {
      clearLocalData()
      setSoulMdInput('')
      setIdentityMdInput('')
      setSkillsText('')
      setMemoriesMd('')
    }
  }
  
  // LLM 配置保存
  const saveLlmSettings = () => {
    setLlmConfig({ apiKey: llmApiKey, baseUrl: llmBaseUrl, model: llmModel })
  }
  
  // LLM 连接测试
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

  return (
    <div className="p-6 h-full overflow-y-auto space-y-6">
      {/* 数据模式 */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-4 h-4 text-cyan-400" />
          <h3 className="font-mono text-sm text-cyan-300 tracking-wider">
            数据模式
          </h3>
        </div>
        
        <div className="flex gap-3 mb-4">
          <button
            onClick={() => toggleDataMode('local')}
            className={`flex-1 p-3 rounded-lg border font-mono text-sm transition-all ${
              dataMode === 'local'
                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                : 'bg-white/5 border-white/10 text-white/50 hover:border-white/20'
            }`}
          >
            本地模式
          </button>
          <button
            onClick={() => toggleDataMode('network')}
            className={`flex-1 p-3 rounded-lg border font-mono text-sm transition-all ${
              dataMode === 'network'
                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                : 'bg-white/5 border-white/10 text-white/50 hover:border-white/20'
            }`}
          >
            网络模式
          </button>
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={handleImport}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 
                       rounded-lg text-xs font-mono text-white/60 hover:bg-white/10 transition-colors"
          >
            <Upload className="w-3 h-3" /> 导入
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 
                       rounded-lg text-xs font-mono text-white/60 hover:bg-white/10 transition-colors"
          >
            <Download className="w-3 h-3" /> 导出
          </button>
          <button
            onClick={loadLocalDataToStore}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 
                       rounded-lg text-xs font-mono text-white/60 hover:bg-white/10 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> 刷新
          </button>
          <button
            onClick={handleClear}
            className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 
                       rounded-lg text-xs font-mono text-red-400 hover:bg-red-500/20 transition-colors"
          >
            <Trash2 className="w-3 h-3" /> 清除
          </button>
        </div>
        
        <p className="text-[10px] text-white/30 font-mono mt-2">
          {dataMode === 'local' 
            ? '本地模式：从下方输入框加载数据，无需网络连接'
            : `网络模式：从 OpenClaw Gateway 加载数据 (${connectionStatus})`}
        </p>
      </div>

      {/* 拖拽上传区域 */}
      {dataMode === 'local' && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Upload className="w-4 h-4 text-emerald-400" />
            <h3 className="font-mono text-sm text-emerald-300 tracking-wider">
              快速导入
            </h3>
          </div>
          <FileDropZone onFileDrop={handleFileDrop} />
        </div>
      )}

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
              className={`px-4 py-2 rounded-lg text-xs font-mono transition-colors ${
                llmTestStatus === 'testing'
                  ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400 animate-pulse'
                  : llmTestStatus === 'success'
                  ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
                  : llmTestStatus === 'error'
                  ? 'bg-red-500/20 border border-red-500/30 text-red-400'
                  : !llmApiKey || !llmBaseUrl || !llmModel
                  ? 'bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
                  : 'bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/30'
              }`}
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

      {/* 本地服务连接 */}
      {dataMode === 'local' && (
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Server className="w-4 h-4 text-purple-400" />
            <h3 className="font-mono text-sm text-purple-300 tracking-wider">
              本地数据服务
            </h3>
            <div className={`ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono ${
              serverStatus === 'connected' ? 'bg-emerald-500/20 text-emerald-400' :
              serverStatus === 'checking' ? 'bg-yellow-500/20 text-yellow-400' :
              'bg-white/10 text-white/40'
            }`}>
              <Wifi className="w-3 h-3" />
              {serverStatus === 'connected' ? '已连接' : 
               serverStatus === 'checking' ? '检查中...' : '未连接'}
            </div>
          </div>
          
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:3001"
              className="flex-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg 
                         text-xs font-mono text-white/70 placeholder-white/30
                         focus:border-purple-500/50 focus:outline-none"
            />
            <button
              onClick={checkServer}
              className="px-3 py-2 bg-purple-500/20 border border-purple-500/30 
                         rounded-lg text-xs font-mono text-purple-400 hover:bg-purple-500/30 transition-colors"
            >
              检测
            </button>
            <button
              onClick={loadFromServer}
              disabled={serverStatus !== 'connected'}
              className={`px-3 py-2 rounded-lg text-xs font-mono transition-colors ${
                serverStatus === 'connected'
                  ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30'
                  : 'bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
              }`}
            >
              加载数据
            </button>
          </div>
          
          <p className="text-[10px] text-white/30 font-mono">
            运行本地服务: <code className="text-purple-400">python ddos-local-server.py --path ~/clawd</code>
          </p>
        </GlassCard>
      )}

      {/* 本地数据输入 */}
      {dataMode === 'local' && (
        <div className="space-y-6">
          {/* Soul.md */}
          <GlassCard className="p-4">
            <DataInputSection
              title="SOUL.md"
              icon={Ghost}
              value={soulMd}
              onChange={setSoulMdInput}
              placeholder={`粘贴 SOUL.md 内容...

# SOUL.md - Who You Are
You're not a chatbot...

## Core Truths
Be genuinely helpful...

## Boundaries
● Private things stay private...

## Vibe
Be the assistant you'd actually want to talk to...`}
              onApply={applySoul}
              applied={soulApplied}
            />
            
            <div className="mt-3 pt-3 border-t border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-white/50">IDENTITY.md (可选)</span>
              </div>
              <textarea
                value={identityMd}
                onChange={(e) => setIdentityMdInput(e.target.value)}
                placeholder="粘贴 IDENTITY.md 内容 (可选)..."
                className="w-full h-16 p-2 bg-black/30 border border-white/10 rounded-lg 
                           text-xs font-mono text-white/70 placeholder-white/30
                           focus:border-cyan-500/50 focus:outline-none resize-none"
              />
            </div>
          </GlassCard>

          {/* Skills */}
          <GlassCard className="p-4">
            <DataInputSection
              title="技能列表"
              icon={Brain}
              value={skillsText}
              onChange={setSkillsText}
              placeholder={`每行一个技能，格式：
skill-name - 描述 (location)

例如：
github - GitHub 集成 (global)
memory-manager - 记忆管理 (local)
browser-automation - 浏览器自动化 (extension)`}
              onApply={applySkills}
              applied={skillsApplied}
            />
          </GlassCard>

          {/* Memories */}
          <GlassCard className="p-4">
            <DataInputSection
              title="记忆数据"
              icon={ScrollText}
              value={memoriesMd}
              onChange={setMemoriesMd}
              placeholder={`Markdown 格式，每个 ## 标题为一条记忆：

## 项目启动
今天开始了 DD-OS 项目开发...

## 重要决定
决定采用本地模式优先的策略...`}
              onApply={applyMemories}
              applied={memoriesApplied}
            />
          </GlassCard>
        </div>
      )}

      {/* Visual Settings */}
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

      {/* About */}
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
              <span>数据模式</span>
              <span className="text-cyan-400">{dataMode === 'local' ? '本地' : '网络'}</span>
            </div>
            <div className="flex justify-between">
              <span>本地数据</span>
              <span className={hasLocalData() ? 'text-emerald-400' : 'text-white/30'}>
                {hasLocalData() ? '已配置' : '未配置'}
              </span>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
