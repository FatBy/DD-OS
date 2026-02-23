import { motion } from 'framer-motion'
import { Fingerprint, Cpu, Shield, Activity, Loader2 } from 'lucide-react'
import { useStore } from '@/store'
import { SoulOrb } from '@/components/visuals/SoulOrb'
import { AISummaryCard } from '@/components/ai/AISummaryCard'
import { useT } from '@/i18n'
import type { LucideIcon } from 'lucide-react'

// HUD 面板组件：半透明磨砂玻璃风格 + 边缘发光
function HudPanel({ 
  children, 
  title, 
  icon: Icon, 
  side = 'left',
  delay = 0 
}: { 
  children: React.ReactNode
  title: string
  icon: LucideIcon
  side?: 'left' | 'right'
  delay?: number 
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: side === 'left' ? -30 : 30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.6, ease: "easeOut" }}
      className={`pointer-events-auto backdrop-blur-md bg-skin-bg-panel/40 border border-skin-border/10 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.3)] hover:bg-skin-bg-panel/60 hover:border-skin-border/20 transition-all ${side === 'left' ? 'mr-auto' : 'ml-auto'}`}
    >
      <div className="px-4 py-2 bg-skin-bg-secondary/20 border-b border-skin-border/5 flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-skin-accent-cyan" />
        <span className="text-[13px] font-mono uppercase tracking-widest text-skin-text-secondary/70">
          {title}
        </span>
      </div>
      <div className="p-4">
        {children}
      </div>
    </motion.div>
  )
}

export function SoulHouse() {
  const t = useT()
  const soulIdentity = useStore((s) => s.soulIdentity)
  const soulCoreTruths = useStore((s) => s.soulCoreTruths)
  const soulDimensions = useStore((s) => s.soulDimensions)
  const skills = useStore((s) => s.skills)
  const loading = useStore((s) => s.devicesLoading)
  
  // 1. 计算活跃技能
  const activeSkills = skills.filter(s => s.unlocked || s.status === 'active')
  const skillRatio = skills.length > 0 ? (activeSkills.length / skills.length) * 100 : 0
  
  // 2. 活跃度
  const activityLevel = Math.max(0.1, Math.min(1, activeSkills.length / (skills.length || 10)))

  // 3. 复杂度
  const complexity = Math.min(100, (soulCoreTruths.length * 8) + soulDimensions.length * 4)

  if (loading && !soulIdentity) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-skin-accent-cyan/50 font-mono text-sm gap-2">
        <Loader2 className="w-6 h-6 animate-spin" />
        {t('soul.initializing')}
      </div>
    )
  }

  return (
    <div className="relative w-full h-full bg-skin-bg-primary overflow-hidden flex flex-col">
      {/* 1. 顶部 AI 状态栏 */}
      <div className="absolute top-4 left-4 right-4 z-30 pointer-events-none">
         <div className="pointer-events-auto">
            <AISummaryCard view="soul" />
         </div>
      </div>

      {/* 2. 背景视觉核心 */}
      <div className="absolute inset-0 z-0">
        <SoulOrb 
            identity={soulIdentity ?? undefined} 
            skills={skills}          
            complexity={complexity}  
            activity={activityLevel} 
        />
        
        <div 
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
            maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
          }}
        />
      </div>

      {/* 3. 前景 HUD 层 */}
      <div className="relative z-10 w-full h-full pointer-events-none p-6 flex flex-col justify-between">
        
        <div className="h-16" />

        {/* 中间层：左右两侧 HUD 面板 */}
        <div className="flex-1 flex items-center justify-between gap-4 py-4">
          
          {/* 左侧面板组 */}
          <div className="flex flex-col gap-3 max-w-[220px] w-full">
            <HudPanel title={t('soul.identity')} icon={Fingerprint} side="left" delay={0.2}>
              <div className="space-y-2">
                <div className="text-lg font-bold text-skin-text-primary/90 tracking-wide">
                  {soulIdentity?.name || 'GENESIS'}
                </div>
                <div className="text-[13px] font-mono text-skin-accent-cyan/60">
                  {soulIdentity?.essence || 'Digital Soul Core'}
                </div>
              </div>
            </HudPanel>

            {soulCoreTruths.length > 0 && (
              <HudPanel title={t('soul.core_protocols')} icon={Shield} side="left" delay={0.4}>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {soulCoreTruths.slice(0, 4).map((truth, i) => (
                    <div key={truth.id} className="flex items-start gap-2">
                      <span className="text-[12px] font-mono text-skin-accent-cyan/60 mt-0.5">{String(i + 1).padStart(2, '0')}</span>
                      <span className="text-[11px] text-skin-text-secondary/60 leading-tight">{truth.title}</span>
                    </div>
                  ))}
                </div>
              </HudPanel>
            )}
          </div>

          {/* 右侧面板组 */}
          <div className="flex flex-col gap-3 max-w-[220px] w-full">
            <HudPanel title={t('soul.skill_matrix')} icon={Cpu} side="right" delay={0.3}>
              <div className="space-y-2">
                <div className="flex justify-between text-[11px]">
                  <span className="text-skin-text-secondary/40">{t('soul.active_total')}</span>
                  <span className="text-skin-accent-cyan font-mono font-bold">
                    {activeSkills.length} / {skills.length}
                  </span>
                </div>
                <div className="h-1.5 bg-skin-bg-secondary/30 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-gradient-to-r from-skin-accent-cyan to-skin-accent-purple rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${skillRatio}%` }}
                    transition={{ duration: 1, delay: 0.5 }}
                  />
                </div>
                <div className="text-[12px] font-mono text-skin-text-secondary/30">
                  {t('soul.activation_ratio')} {skillRatio.toFixed(1)}%
                </div>
              </div>
            </HudPanel>

            <HudPanel title={t('soul.system_status')} icon={Activity} side="right" delay={0.5}>
              <div className="space-y-2">
                <div className="flex justify-between text-[11px]">
                  <span className="text-skin-text-secondary/40">{t('soul.activity')}</span>
                  <span className="text-skin-accent-emerald font-mono">{(activityLevel * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-skin-text-secondary/40">{t('soul.complexity')}</span>
                  <span className="text-skin-accent-amber font-mono">{complexity}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-skin-text-secondary/40">{t('soul.dimensions')}</span>
                  <span className="text-skin-accent-purple font-mono">{soulDimensions.length}</span>
                </div>
              </div>
            </HudPanel>
          </div>
        </div>

        {/* 底部维度条 */}
        {soulDimensions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="flex justify-center pointer-events-auto"
          >
            <div className="flex gap-4 px-6 py-3 bg-skin-bg-panel/40 backdrop-blur-xl rounded-2xl border border-skin-border/5">
              {soulDimensions.slice(0, 6).map((d, i) => (
                <motion.div 
                  key={d.name} 
                  className="flex flex-col items-center gap-1.5 w-12"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8 + i * 0.1 }}
                >
                  <div className="h-14 w-1.5 bg-skin-bg-secondary/30 rounded-full relative overflow-hidden">
                    <motion.div 
                      className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-skin-accent-cyan via-skin-accent-purple to-skin-accent-amber rounded-full"
                      initial={{ height: 0 }}
                      animate={{ height: `${d.value}%` }}
                      transition={{ duration: 1, delay: 0.9 + i * 0.1 }}
                    />
                  </div>
                  <span className="text-[11px] text-skin-text-secondary/40 font-mono truncate max-w-full text-center">
                    {d.name}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
