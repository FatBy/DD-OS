import { motion } from 'framer-motion'
import { Ghost, Sparkles, Heart, Shield, Compass, Loader2 } from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { RadarChart } from '@/components/effects/RadarChart'
import { useStore } from '@/store'
import type { SoulDimension, SoulTruth, SoulBoundary } from '@/types'

// 默认灵魂维度（未连接时显示）
const defaultDimensions: SoulDimension[] = [
  { name: '真诚', value: 90 },
  { name: '智慧', value: 85 },
  { name: '信任', value: 80 },
  { name: '尊重', value: 95 },
  { name: '能力', value: 75 },
  { name: '温暖', value: 88 },
]

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
  const storeDimensions = useStore((s) => s.soulDimensions)
  const loading = useStore((s) => s.devicesLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const agentIdentity = useStore((s) => s.agentIdentity)

  const isConnected = connectionStatus === 'connected'
  
  // 使用真实数据或默认值
  const dimensions = isConnected && storeDimensions.length > 0 
    ? storeDimensions 
    : defaultDimensions
  
  const identity = soulIdentity || {
    name: 'OpenClaw Agent',
    essence: 'AI 助手',
    vibe: '智能、可靠',
    symbol: '🤖',
  }
  
  const coreTruths = soulCoreTruths.length > 0 ? soulCoreTruths : [
    { id: 'genuine', title: '真诚帮助', principle: 'Be genuinely helpful.', description: '用行动说话，真正的帮助比客套话更有价值' },
    { id: 'opinions', title: '拥有观点', principle: 'Have opinions.', description: '可以不同意，可以有偏好' },
    { id: 'trust', title: '赢得信任', principle: 'Earn trust through competence.', description: '通过能力和尊重赢得信任' },
  ]
  
  const boundaries = soulBoundaries.length > 0 ? soulBoundaries : [
    { id: 'privacy', rule: '隐私第一：私密的事情永远保持私密' },
    { id: 'ask', rule: '怀疑时先问：对外部行动不确定时先询问' },
  ]

  if (loading && isConnected) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左侧: 身份与雷达图 */}
      <div className="w-[35%] flex flex-col p-4 border-r border-white/10 overflow-y-auto">
        {/* 身份标识 */}
        <div className="text-center mb-4">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200 }}
            className="text-5xl mb-2"
          >
            {identity.symbol}
          </motion.div>
          <h2 className="text-lg font-bold text-purple-300">{identity.name}</h2>
          <p className="text-xs text-white/50 mt-1">{identity.essence}</p>
          <p className="text-[10px] text-purple-400/60 mt-1">✨ {identity.vibe}</p>
        </div>

        {/* 雷达图 */}
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <RadarChart dimensions={dimensions} size={200} color="#a855f7" />
        </div>

        {/* 维度条 */}
        <div className="mt-4 space-y-1.5">
          {dimensions.slice(0, 6).map((d) => (
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
      </div>

      {/* 右侧: 灵魂内容 */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {/* 标题 */}
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <h3 className="font-mono text-sm text-purple-300 tracking-wider">
            灵魂核心
          </h3>
          {isConnected && (
            <span className="ml-auto text-[9px] font-mono text-white/30">
              SOUL.md
            </span>
          )}
        </div>

        {/* 核心真理 */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Heart className="w-3 h-3 text-pink-400" />
            <h4 className="text-xs font-mono text-pink-300 uppercase">核心真理</h4>
          </div>
          <div className="grid gap-2">
            {coreTruths.map((truth, idx) => (
              <TruthCard key={truth.id} truth={truth} index={idx} />
            ))}
          </div>
        </div>

        {/* 边界原则 */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-3 h-3 text-amber-400" />
            <h4 className="text-xs font-mono text-amber-300 uppercase">边界原则</h4>
          </div>
          <div className="p-3 bg-amber-500/5 rounded-lg border border-amber-500/10 space-y-2">
            {boundaries.map((boundary, idx) => (
              <BoundaryItem key={boundary.id} boundary={boundary} index={idx} />
            ))}
          </div>
        </div>

        {/* 氛围宣言 */}
        {(soulVibeStatement || !isConnected) && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Compass className="w-3 h-3 text-cyan-400" />
              <h4 className="text-xs font-mono text-cyan-300 uppercase">存在氛围</h4>
            </div>
            <div className="p-3 bg-cyan-500/5 rounded-lg border border-cyan-500/10">
              <p className="text-xs text-white/60 italic">
                "{soulVibeStatement || "Be the assistant you'd actually want to talk to."}"
              </p>
            </div>
          </div>
        )}

        {/* 连续性说明 */}
        {(soulContinuityNote || !isConnected) && (
          <div className="pt-2 border-t border-white/5">
            <p className="text-[9px] font-mono text-white/30 leading-relaxed">
              🔄 {soulContinuityNote || '每次会话重新醒来，文件就是记忆。阅读它们、更新它们，这是持续存在的方式。'}
            </p>
          </div>
        )}

        {/* 未连接提示 */}
        {!isConnected && (
          <div className="mt-4 p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
            <p className="text-[10px] text-purple-300 font-mono">
              💡 连接到 OpenClaw Gateway 后，灵魂塔将显示 Agent 的真实 SOUL.md 配置
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
