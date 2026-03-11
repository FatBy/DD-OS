import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { Loader2, Zap, Search, Download, Store, ChevronUp, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@/store'
import { skillStatsService } from '@/services/skillStatsService'
import { SoulOrb } from '@/components/visuals/SoulOrb'
import { HudPanel } from '@/components/ui/HudPanel'
import { SkillDetailPanel } from './skill/SkillDetailPanel'
import { SkillParticleTooltip } from './skill/SkillParticleTooltip'
import { SkillParticleCard } from './skill/SkillParticleCard'
import type { ClawHubSkillSummary } from '@/types'

// ── MarketplaceTab (内联，保持不变) ────────────────

function MarketplaceTab() {
  const searchResults = useStore(s => s.clawHubSearchResults)
  const searchLoading = useStore(s => s.clawHubSearchLoading)
  const clawHubSearch = useStore(s => s.clawHubSearch)
  const clawHubInstallSkill = useStore(s => s.clawHubInstallSkill)
  const installing = useStore(s => s.clawHubInstalling)
  const storeSkills = useStore(s => s.skills)
  const [query, setQuery] = useState('')

  const handleSearch = useCallback(() => {
    if (query.trim()) clawHubSearch(query.trim())
  }, [query, clawHubSearch])

  const handleInstall = async (skill: ClawHubSkillSummary) => {
    const archiveUrl = `https://clawhub.ai/api/v1/download/${encodeURIComponent(skill.slug)}`
    await clawHubInstallSkill(skill.slug, archiveUrl)
  }

  const isInstalled = (skillName: string) =>
    storeSkills.some(s => s.name.toLowerCase() === skillName.toLowerCase() || s.id?.toLowerCase() === skillName.toLowerCase())

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="搜索 ClawHub 技能..."
            className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none"
          />
        </div>
        <button onClick={handleSearch} disabled={searchLoading || !query.trim()}
          className="px-4 py-2 text-sm font-medium bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 disabled:opacity-50 transition-colors">
          {searchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '搜索'}
        </button>
      </div>
      {searchLoading && <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 text-cyan-400 animate-spin" /></div>}
      {!searchLoading && searchResults.length > 0 && (
        <div className="space-y-2">
          {searchResults.map(skill => {
            const installed = isInstalled(skill.name)
            const isInstalling = !!installing[skill.slug]
            return (
              <div key={skill.slug} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5 hover:border-white/10 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  {skill.emoji && <span className="text-xl shrink-0">{skill.emoji}</span>}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white/90">{skill.name}</span>
                      <span className="text-xs text-white/40">v{skill.version}</span>
                      <span className="text-xs text-white/30">by @{skill.author}</span>
                    </div>
                    <p className="text-xs text-white/50 truncate">{skill.description}</p>
                    {skill.tags.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {skill.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 text-[10px] bg-white/5 text-white/40 rounded">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <span className="text-xs text-white/30">{skill.downloads >= 1000 ? `${(skill.downloads / 1000).toFixed(1)}k` : skill.downloads}</span>
                  {installed ? (
                    <span className="px-3 py-1.5 text-xs text-emerald-400 bg-emerald-500/10 rounded-md">已安装</span>
                  ) : (
                    <button onClick={() => handleInstall(skill)} disabled={isInstalling}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-cyan-500/20 text-cyan-400 rounded-md hover:bg-cyan-500/30 disabled:opacity-50 transition-colors">
                      {isInstalling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                      {isInstalling ? '安装中' : '安装'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {!searchLoading && searchResults.length === 0 && query && <div className="text-center py-8 text-white/30 text-sm">未找到匹配的技能</div>}
      {!query && searchResults.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-white/40">
          <Store className="w-10 h-10 mb-3" />
          <p className="text-sm text-white/50">输入关键词搜索 ClawHub 技能市场</p>
        </div>
      )}
    </div>
  )
}

// ── SkillHouse 主组件 ──────────────────────────────

export function SkillHouse() {
  const storeSkills = useStore(s => s.skills)
  const openClawSkills = useStore(s => s.openClawSkills)
  const loading = useStore(s => s.channelsLoading)
  const connectionStatus = useStore(s => s.connectionStatus)
  const storeSnapshot = useStore(s => s.skillStatsSnapshot)
  const statsVersion = useStore(s => s.skillStatsVersion)
  const skillAnalysis = useStore(s => s.skillAnalysis)
  const soulIdentity = useStore(s => s.soulIdentity)

  const isConnected = connectionStatus === 'connected'
  const [activeTab, setActiveTab] = useState<'local' | 'marketplace'>('local')
  const [isDetailExpanded, setIsDetailExpanded] = useState(false)
  const [pulsingIds, setPulsingIds] = useState<string[]>([])
  const prevRecentRef = useRef<string[]>([])

  // hover / click 状态
  const [hoveredSkill, setHoveredSkill] = useState<{ id: string; x: number; y: number } | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<{ id: string; x: number; y: number } | null>(null)

  const snapshot = useMemo(() => {
    return storeSnapshot ?? skillStatsService.computeSnapshot(openClawSkills)
  }, [storeSnapshot, openClawSkills])

  // 脉冲联动：检测 recentActive 变化
  useEffect(() => {
    const prev = prevRecentRef.current
    const curr = snapshot.recentActive || []
    const newIds = curr.filter(id => !prev.includes(id))
    if (newIds.length > 0) {
      setPulsingIds(p => [...p, ...newIds])
      setTimeout(() => {
        setPulsingIds(p => p.filter(id => !newIds.includes(id)))
      }, 2000)
    }
    prevRecentRef.current = curr
  }, [snapshot.recentActive])

  // 活跃度/复杂度
  const activeSkills = useMemo(() => storeSkills.filter(s => s.unlocked || s.status === 'active'), [storeSkills])
  const activityLevel = storeSkills.length > 0 ? Math.min(activeSkills.length / storeSkills.length, 1) : 0.1
  const complexityValue = Math.min(snapshot.totalScore / 10, 100)

  // 球心 AI 摘要 (精简两句话)
  const summaryText = useMemo(() => {
    if (skillAnalysis.loading) return null
    if (!skillAnalysis.summary) return null
    // 取第一句
    const sentences = skillAnalysis.summary.split(/[。！？.!?]/).filter(Boolean)
    return sentences.length > 0 ? sentences[0] + '。' : null
  }, [skillAnalysis.summary, skillAnalysis.loading])

  // 查找技能信息
  const findSkill = useCallback((id: string) => {
    return storeSkills.find(s => s.id === id || s.name === id)
  }, [storeSkills])

  const handleParticleHover = useCallback((id: string | null, x: number, y: number) => {
    setHoveredSkill(id ? { id, x, y } : null)
  }, [])

  const handleParticleClick = useCallback((id: string, pos: { x: number; y: number }) => {
    setSelectedSkill(prev => prev?.id === id ? null : { id, ...pos })
    setHoveredSkill(null)
  }, [])

  if (loading && isConnected) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 text-cyan-400 animate-spin" /></div>
  }

  const centerContent = (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.8, duration: 0.8 }}
      className="text-center max-w-xs cursor-pointer"
      onClick={() => setIsDetailExpanded(true)}
    >
      {skillAnalysis.loading ? (
        <div className="space-y-2">
          <div className="h-3 w-40 mx-auto bg-white/10 rounded animate-pulse" />
          <div className="h-3 w-32 mx-auto bg-white/10 rounded animate-pulse" />
        </div>
      ) : summaryText ? (
        <>
          <p className="text-xs font-mono text-white/70 leading-relaxed drop-shadow-[0_0_8px_rgba(0,0,0,0.8)]">
            {summaryText}
          </p>
          <p className="text-[10px] text-cyan-400/60 mt-2 hover:text-cyan-400 transition-colors">
            查看详情 →
          </p>
        </>
      ) : (
        <p className="text-xs font-mono text-white/30">
          {storeSkills.length > 0 ? '点击生成 AI 能力画像' : '等待技能加载...'}
        </p>
      )}
    </motion.div>
  )

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Layer 0: SoulOrb 全屏背景 */}
      <div className="absolute inset-0">
        <SoulOrb
          identity={soulIdentity || undefined}
          skills={storeSkills}
          complexity={complexityValue}
          activity={activityLevel}
          interactive
          onParticleClick={handleParticleClick}
          onParticleHover={handleParticleHover}
          pulsingSkillIds={pulsingIds}
          centerContent={centerContent}
        />
      </div>

      {/* 网格叠加 */}
      <div className="absolute inset-0 pointer-events-none z-[1]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
          maskImage: 'radial-gradient(ellipse at center, transparent 30%, black 70%)',
        }}
      />

      {/* Layer 1: 浮动 Tab (左上) */}
      <div className="absolute top-4 left-4 z-20 pointer-events-auto">
        <div className="flex gap-1 p-1 backdrop-blur-md bg-skin-bg-panel/50 border border-skin-border/10 rounded-lg">
          <button
            onClick={() => { setActiveTab('local'); setSelectedSkill(null) }}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${activeTab === 'local' ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/50 hover:text-white/70'}`}
          >
            本地技能
          </button>
          <button
            onClick={() => { setActiveTab('marketplace'); setSelectedSkill(null) }}
            className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-colors ${activeTab === 'marketplace' ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/50 hover:text-white/70'}`}
          >
            <Store className="w-3 h-3" />
            市场
          </button>
        </div>
      </div>

      {/* Layer 1: Stats HUD (右上) */}
      <div className="absolute top-4 right-4 z-20 pointer-events-none">
        <HudPanel title="Stats" icon={Zap} side="right" delay={0.3}>
          <div className="space-y-2 min-w-[100px]">
            <div>
              <p className="text-[10px] font-mono text-white/40 uppercase">Skills</p>
              <p className="text-lg font-bold text-cyan-400">{storeSkills.length}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-white/40 uppercase">Domains</p>
              <p className="text-lg font-bold text-purple-400">{snapshot.domains.filter(d => d.skillCount > 0).length}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-white/40 uppercase">Active</p>
              <p className="text-lg font-bold text-emerald-400">{activeSkills.length}</p>
            </div>
          </div>
        </HudPanel>
      </div>

      {/* Layer 2: Particle Tooltip */}
      <AnimatePresence>
        {hoveredSkill && !selectedSkill && (() => {
          const skill = findSkill(hoveredSkill.id)
          return skill ? (
            <SkillParticleTooltip
              key="tooltip"
              skillName={skill.name}
              isActive={skill.unlocked || skill.status === 'active'}
              x={hoveredSkill.x}
              y={hoveredSkill.y}
            />
          ) : null
        })()}
      </AnimatePresence>

      {/* Layer 2: Particle Detail Card */}
      <AnimatePresence>
        {selectedSkill && (() => {
          const skill = findSkill(selectedSkill.id)
          return skill ? (
            <SkillParticleCard
              key="card"
              skillId={skill.id || skill.name}
              skillName={skill.name}
              description={skill.description}
              isActive={skill.unlocked || skill.status === 'active'}
              x={selectedSkill.x}
              y={selectedSkill.y}
              onClose={() => setSelectedSkill(null)}
            />
          ) : null
        })()}
      </AnimatePresence>

      {/* Layer 3: Marketplace 浮层 */}
      <AnimatePresence>
        {activeTab === 'marketplace' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 bg-skin-bg-primary/90 backdrop-blur-xl overflow-y-auto p-6 pt-16"
          >
            <button onClick={() => setActiveTab('local')}
              className="absolute top-4 right-4 p-2 rounded-lg hover:bg-white/10 transition-colors z-40">
              <X className="w-5 h-5 text-white/60" />
            </button>
            <MarketplaceTab />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Layer 4: 底部展开按钮 */}
      {!isDetailExpanded && activeTab === 'local' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
          <button
            onClick={() => setIsDetailExpanded(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 backdrop-blur-md bg-skin-bg-panel/50 border border-skin-border/10 rounded-full text-xs text-white/50 hover:text-white/80 hover:bg-skin-bg-panel/70 transition-all"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            能力详情
          </button>
        </div>
      )}

      {/* Layer 5: 详情面板 (从底部滑入) */}
      <AnimatePresence>
        {isDetailExpanded && activeTab === 'local' && (
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="absolute inset-0 z-40 bg-skin-bg-primary/95 backdrop-blur-xl overflow-y-auto"
          >
            <div className="max-w-4xl mx-auto p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-mono text-cyan-400 uppercase tracking-wider">Agent Abilities</h3>
                <button onClick={() => setIsDetailExpanded(false)}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                  <X className="w-4 h-4 text-white/60" />
                </button>
              </div>
              <SkillDetailPanel
                snapshot={snapshot}
                skills={storeSkills}
                openClawSkills={openClawSkills}
                isExpanded={true}
                onToggle={() => setIsDetailExpanded(false)}
                statsVersion={statsVersion}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
