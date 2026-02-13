import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { 
  Monitor, Cpu, Info, Database, Upload, Download, Trash2, 
  Check, Ghost, Brain, ScrollText, RefreshCw
} from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
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
import { openClawSkillsToNodes } from '@/utils/dataMapper'

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
