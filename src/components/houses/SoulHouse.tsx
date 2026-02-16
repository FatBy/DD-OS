import { motion } from 'framer-motion'
import { Ghost, Sparkles, Shield, Fingerprint, Loader2, AlertCircle, Zap } from 'lucide-react'
import { useStore } from '@/store'
import { SoulOrb } from '@/components/visuals/SoulOrb'
import { AISummaryCard } from '@/components/ai/AISummaryCard'
import type { SoulTruth, SoulBoundary } from '@/types'

// HUD 悬浮卡片
function HudCard({ 
  children, 
  className = "", 
  delay = 0 
}: { 
  children: React.ReactNode
  className?: string
  delay?: number 
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.5 }}
      className={`absolute p-4 bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl ${className}`}
    >
      {children}
    </motion.div>
  )
}

// 核心真理条目
function TruthItem({ truth, index }: { truth: SoulTruth; index: number }) {
  return (
    <motion.div 
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.5 + index * 0.1 }}
      className="border-l-2 border-cyan-500/30 pl-3 py-1.5"
    >
      <span className="block text-sm text-cyan-100 font-medium">{truth.title}</span>
      <span className="block text-[10px] text-white/40 mt-0.5 leading-relaxed line-clamp-2">
        {truth.principle}
      </span>
    </motion.div>
  )
}

// 边界规则条目
function BoundaryItem({ boundary, index }: { boundary: SoulBoundary; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.6 + index * 0.05 }}
      className="flex items-start gap-2 text-xs"
    >
      <Shield className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
      <span className="text-white/60 line-clamp-2">{boundary.rule}</span>
    </motion.div>
  )
}

export function SoulHouse() {
  const soulIdentity = useStore((s) => s.soulIdentity)
  const soulCoreTruths = useStore((s) => s.soulCoreTruths)
  const soulBoundaries = useStore((s) => s.soulBoundaries)
  const soulVibeStatement = useStore((s) => s.soulVibeStatement)
  const soulDimensions = useStore((s) => s.soulDimensions)
  const soulRawContent = useStore((s) => s.soulRawContent)
  const loading = useStore((s) => s.devicesLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)

  const isConnected = connectionStatus === 'connected'
  const hasSoulData = soulCoreTruths.length > 0 || soulBoundaries.length > 0 || soulRawContent
  
  // 计算复杂度 (0-100) - 用于控制视觉效果
  const complexity = Math.min(100, (soulCoreTruths.length * 12) + (soulDimensions.length * 8) + (soulBoundaries.length * 5))

  // 加载中状态
  if (loading && isConnected) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-950">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <Loader2 className="w-10 h-10 text-purple-400 animate-spin" />
          <span className="text-sm font-mono text-purple-300/60">Initializing Soul Matrix...</span>
        </motion.div>
      </div>
    )
  }

  // 未连接或无数据状态
  if (!isConnected || !hasSoulData) {
    return (
      <div className="relative w-full h-full bg-slate-950 overflow-hidden">
        {/* 即使无数据也显示默认的 Orb */}
        <div className="absolute inset-0">
          <SoulOrb complexity={20} activity={0.3} />
        </div>
        
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl p-8 max-w-md"
          >
            <Ghost className="w-16 h-16 text-purple-400/40 mx-auto mb-4" />
            <h3 className="text-xl font-mono text-purple-300 mb-2">Soul Matrix</h3>
            <p className="text-white/50 text-sm mb-4">
              {isConnected 
                ? 'Unable to read SOUL.md configuration. Ensure OpenClaw Gateway supports files.read API.'
                : 'Connect to OpenClaw Gateway to initialize the Soul Matrix.'}
            </p>
            <div className="flex items-center justify-center gap-2 text-[10px] text-white/30 font-mono">
              <AlertCircle className="w-3 h-3" />
              <span>{isConnected ? 'Awaiting SOUL.md...' : 'Disconnected'}</span>
            </div>
          </motion.div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden">
      {/* 顶部 AI 状态栏 */}
      <div className="absolute top-4 left-4 right-4 z-30">
        <AISummaryCard view="soul" />
      </div>

      {/* 核心视觉层：SoulOrb 占据整个背景 */}
      <div className="absolute inset-0 z-0">
        <SoulOrb 
          identity={soulIdentity} 
          complexity={complexity} 
          activity={0.7}
        />
      </div>

      {/* 前景 UI 层：HUD 布局 */}
      <div className="relative z-10 w-full h-full pointer-events-none">
        
        {/* 左侧：Vibe & Identity */}
        {soulVibeStatement && (
          <HudCard className="top-1/4 left-6 max-w-[240px] pointer-events-auto" delay={0.2}>
            <div className="flex items-center gap-2 mb-2 text-purple-300">
              <Fingerprint className="w-4 h-4" />
              <span className="text-[10px] font-mono uppercase tracking-wider">Identity Signature</span>
            </div>
            <p className="text-sm text-white/80 leading-relaxed italic">
              "{soulVibeStatement}"
            </p>
            {soulIdentity?.vibe && (
              <p className="text-[10px] text-purple-400/60 mt-2 flex items-center gap-1">
                <Zap className="w-3 h-3" />
                {soulIdentity.vibe}
              </p>
            )}
          </HudCard>
        )}

        {/* 右侧：Core Truths */}
        {soulCoreTruths.length > 0 && (
          <HudCard className="top-1/4 right-6 max-w-[280px] pointer-events-auto" delay={0.4}>
            <div className="flex items-center gap-2 mb-3 text-cyan-300">
              <Sparkles className="w-4 h-4" />
              <span className="text-[10px] font-mono uppercase tracking-wider">Core Protocols</span>
              <span className="ml-auto text-[9px] text-white/30">{soulCoreTruths.length}</span>
            </div>
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-2 custom-scrollbar">
              {soulCoreTruths.map((truth, idx) => (
                <TruthItem key={truth.id} truth={truth} index={idx} />
              ))}
            </div>
          </HudCard>
        )}

        {/* 左下：Boundaries */}
        {soulBoundaries.length > 0 && (
          <HudCard className="bottom-32 left-6 max-w-[260px] pointer-events-auto" delay={0.5}>
            <div className="flex items-center gap-2 mb-2 text-amber-300">
              <Shield className="w-4 h-4" />
              <span className="text-[10px] font-mono uppercase tracking-wider">Boundaries</span>
              <span className="ml-auto text-[9px] text-white/30">{soulBoundaries.length}</span>
            </div>
            <div className="space-y-2 max-h-[150px] overflow-y-auto pr-2 custom-scrollbar">
              {soulBoundaries.slice(0, 5).map((boundary, idx) => (
                <BoundaryItem key={boundary.id} boundary={boundary} index={idx} />
              ))}
              {soulBoundaries.length > 5 && (
                <p className="text-[9px] text-white/30 font-mono">
                  +{soulBoundaries.length - 5} more...
                </p>
              )}
            </div>
          </HudCard>
        )}

        {/* 底部：能力维度条 */}
        {soulDimensions.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-auto"
          >
            <div className="flex gap-5 px-6 py-4 bg-black/50 backdrop-blur-xl rounded-2xl border border-white/5">
              {soulDimensions.slice(0, 6).map((d, i) => (
                <motion.div 
                  key={d.name} 
                  className="flex flex-col items-center gap-2 w-14"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8 + i * 0.1 }}
                >
                  <div className="h-20 w-2 bg-white/10 rounded-full relative overflow-hidden">
                    <motion.div 
                      className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-purple-600 via-purple-500 to-pink-400 rounded-full"
                      initial={{ height: 0 }}
                      animate={{ height: `${d.value}%` }}
                      transition={{ duration: 1, delay: 0.9 + i * 0.1 }}
                    />
                  </div>
                  <span className="text-[9px] text-white/50 font-mono truncate max-w-full text-center">
                    {d.name}
                  </span>
                  <span className="text-[10px] text-purple-400/80 font-mono font-bold">
                    {d.value}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
      
      {/* 装饰性网格背景 */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />
    </div>
  )
}
