import { motion } from 'framer-motion'
import { Ghost, Sparkles, Heart, Shield, Compass, Loader2, AlertCircle } from 'lucide-react'
import { RadarChart } from '@/components/effects/RadarChart'
import { AISummaryCard } from '@/components/ai/AISummaryCard'
import { useStore } from '@/store'
import type { SoulDimension, SoulTruth, SoulBoundary } from '@/types'

// 核心真理卡片
function TruthCard({ truth, index }: { truth: SoulTruth; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/20 hover:border-purple-400/40 transition-colors"
    >
      <h4 className="text-sm font-bold text-purple-300 mb-1">{truth.title}</h4>
      <p className="text-[10px] font-mono text-white/40 italic mb-2">"{truth.principle}"</p>
      <p className="text-xs text-white/60">{truth.description}</p>
    </motion.div>
  )
}

// 边界规则条目
function BoundaryItem({ boundary, index }: { boundary: SoulBoundary; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-start gap-2 text-xs"
    >
      <Shield className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
      <span className="text-white/60">{boundary.rule}</span>
    </motion.div>
  )
}

export function SoulHouse() {
  const soulIdentity = useStore((s) => s.soulIdentity)
  const soulCoreTruths = useStore((s) => s.soulCoreTruths)
  const soulBoundaries = useStore((s) => s.soulBoundaries)
  const soulVibeStatement = useStore((s) => s.soulVibeStatement)
  const soulContinuityNote = useStore((s) => s.soulContinuityNote)
  const soulRawContent = useStore((s) => s.soulRawContent)
  const storeDimensions = useStore((s) => s.soulDimensions)
  const loading = useStore((s) => s.devicesLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)

  const isConnected = connectionStatus === 'connected'
  const hasSoulData = soulCoreTruths.length > 0 || soulBoundaries.length > 0 || soulRawContent

  // 加载中状态
  if (loading && isConnected) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
      </div>
    )
  }

  // 未连接或无数据状态
  if (!isConnected || !hasSoulData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Ghost className="w-16 h-16 text-purple-400/30 mb-4" />
        <h3 className="text-lg font-mono text-purple-300 mb-2">灵魂塔</h3>
        <p className="text-white/40 text-sm mb-4 max-w-md">
          {isConnected 
            ? '无法读取 SOUL.md 文件。请确保 OpenClaw Gateway 支持 files.read API。'
            : '连接到 OpenClaw Gateway 后，将显示 Agent 的 SOUL.md 配置。'}
        </p>
        <div className="flex items-center gap-2 text-[10px] text-white/30 font-mono">
          <AlertCircle className="w-3 h-3" />
          <span>{isConnected ? '等待 SOUL.md 数据...' : '未连接'}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 pt-4">
        <AISummaryCard view="soul" />
      </div>
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* 左侧: 身份与雷达图 */}
      <div className="w-[35%] flex flex-col p-4 border-r border-white/10 overflow-y-auto">
        {/* 身份标识 */}
        {soulIdentity && (
          <div className="text-center mb-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200 }}
              className="text-5xl mb-2"
            >
              {soulIdentity.symbol}
            </motion.div>
            <h2 className="text-lg font-bold text-purple-300">{soulIdentity.name}</h2>
            <p className="text-xs text-white/50 mt-1">{soulIdentity.essence}</p>
            {soulIdentity.vibe && (
              <p className="text-[10px] text-purple-400/60 mt-1 line-clamp-2">✨ {soulIdentity.vibe}</p>
            )}
          </div>
        )}

        {/* 雷达图 (如果有维度数据) */}
        {storeDimensions.length > 0 && (
          <>
            <div className="flex-1 flex items-center justify-center min-h-[200px]">
              <RadarChart dimensions={storeDimensions} size={200} color="#a855f7" />
            </div>

            {/* 维度条 */}
            <div className="mt-4 space-y-1.5">
              {storeDimensions.slice(0, 6).map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-white/40 w-10 text-right">
                    {d.name}
                  </span>
                  <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-purple-500/60 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${d.value}%` }}
                      transition={{ duration: 0.8, delay: 0.2 }}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-purple-400/60 w-6">
                    {d.value}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 右侧: 灵魂内容 */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {/* 标题 */}
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <h3 className="font-mono text-sm text-purple-300 tracking-wider">
            灵魂核心
          </h3>
          <span className="ml-auto text-[9px] font-mono text-white/30">
            SOUL.md
          </span>
        </div>

        {/* 核心真理 */}
        {soulCoreTruths.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Heart className="w-3 h-3 text-pink-400" />
              <h4 className="text-xs font-mono text-pink-300 uppercase">Core Truths</h4>
            </div>
            <div className="grid gap-2">
              {soulCoreTruths.map((truth, idx) => (
                <TruthCard key={truth.id} truth={truth} index={idx} />
              ))}
            </div>
          </div>
        )}

        {/* 边界原则 */}
        {soulBoundaries.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-3 h-3 text-amber-400" />
              <h4 className="text-xs font-mono text-amber-300 uppercase">Boundaries</h4>
            </div>
            <div className="p-3 bg-amber-500/5 rounded-lg border border-amber-500/10 space-y-2">
              {soulBoundaries.map((boundary, idx) => (
                <BoundaryItem key={boundary.id} boundary={boundary} index={idx} />
              ))}
            </div>
          </div>
        )}

        {/* 氛围宣言 */}
        {soulVibeStatement && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Compass className="w-3 h-3 text-cyan-400" />
              <h4 className="text-xs font-mono text-cyan-300 uppercase">Vibe</h4>
            </div>
            <div className="p-3 bg-cyan-500/5 rounded-lg border border-cyan-500/10">
              <p className="text-xs text-white/60 italic">
                "{soulVibeStatement}"
              </p>
            </div>
          </div>
        )}

        {/* 连续性说明 */}
        {soulContinuityNote && (
          <div className="pt-2 border-t border-white/5">
            <p className="text-[9px] font-mono text-white/30 leading-relaxed">
              🔄 {soulContinuityNote}
            </p>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
