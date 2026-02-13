import { motion } from 'framer-motion'
import { Ghost, Sparkles, User, ShieldAlert, Target, Loader2 } from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { RadarChart } from '@/components/effects/RadarChart'
import { useStore } from '@/store'
import type { SoulDimension } from '@/types'

// 默认灵魂维度（未连接时显示）
const defaultDimensions: SoulDimension[] = [
  { name: '生命力', value: 50 },
  { name: '经验', value: 0 },
  { name: '感知', value: 25 },
  { name: '力量', value: 20 },
  { name: '智慧', value: 0 },
  { name: '连接', value: 0 },
]

interface PromptModule {
  id: string
  title: string
  icon: typeof User
  field: 'identity' | 'constraints' | 'goals'
}

const promptModules: PromptModule[] = [
  {
    id: 'identity',
    title: '身份',
    icon: User,
    field: 'identity',
  },
  {
    id: 'constraints',
    title: '状态',
    icon: ShieldAlert,
    field: 'constraints',
  },
  {
    id: 'goals',
    title: '连接',
    icon: Target,
    field: 'goals',
  },
]

export function SoulHouse() {
  const storeDimensions = useStore((s) => s.soulDimensions)
  const storePrompts = useStore((s) => s.soulPrompts)
  const loading = useStore((s) => s.devicesLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const agentIdentity = useStore((s) => s.agentIdentity)

  const isConnected = connectionStatus === 'connected'
  
  // 使用真实数据或默认值
  const dimensions = isConnected && storeDimensions.length > 0 
    ? storeDimensions 
    : defaultDimensions
  
  const prompts = isConnected && storePrompts.identity
    ? storePrompts
    : {
        identity: '等待连接到 OpenClaw Gateway...',
        constraints: '系统状态未知',
        goals: '等待设备连接...',
      }

  if (loading && isConnected) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* 左侧: 雷达图 */}
      <div className="w-[40%] flex flex-col items-center justify-center p-6 border-r border-white/10">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <h3 className="font-mono text-sm text-purple-300 tracking-wider">
            灵魂维度
          </h3>
        </div>

        {/* Agent 身份显示 */}
        {isConnected && agentIdentity && (
          <div className="mb-4 flex items-center gap-3">
            <span className="text-3xl">{agentIdentity.emoji || '🤖'}</span>
            <div>
              <p className="text-sm font-medium text-white/90">
                {agentIdentity.name || 'OpenClaw Agent'}
              </p>
              <p className="text-[9px] font-mono text-white/40">
                {agentIdentity.agentId}
              </p>
            </div>
          </div>
        )}

        <RadarChart dimensions={dimensions} size={260} color="#a855f7" />

        {/* 维度条 */}
        <div className="mt-6 w-full max-w-[260px] space-y-2">
          {dimensions.map((d) => (
            <div key={d.name} className="flex items-center gap-3">
              <span className="text-[11px] font-mono text-white/50 w-12 text-right">
                {d.name}
              </span>
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-purple-500/60 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${d.value}%` }}
                  transition={{ duration: 1, delay: 0.2 }}
                />
              </div>
              <span className="text-[10px] font-mono text-purple-400 w-8">
                {d.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧: 状态信息 */}
      <div className="flex-1 p-6 overflow-y-auto space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={cn(
            'w-2 h-2 rounded-full',
            isConnected ? 'bg-purple-400 animate-pulse' : 'bg-white/30'
          )} />
          <h3 className="font-mono text-sm text-purple-300 tracking-wider">
            灵魂核心状态
          </h3>
        </div>

        {promptModules.map((mod, idx) => {
          const Icon = mod.icon
          const content = prompts[mod.field]
          
          return (
            <motion.div
              key={mod.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.15, type: 'spring', stiffness: 200 }}
            >
              <GlassCard themeColor="purple" className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="w-4 h-4 text-purple-400" />
                  <h4 className="font-mono text-sm font-bold text-purple-300">
                    {mod.title}
                  </h4>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                  <p className="text-sm text-white/70 font-mono whitespace-pre-wrap">
                    {content || '暂无数据'}
                  </p>
                </div>
              </GlassCard>
            </motion.div>
          )
        })}

        {/* 连接提示 */}
        {!isConnected && (
          <div className="mt-4 p-4 bg-purple-500/10 rounded-xl border border-purple-500/20">
            <p className="text-xs text-purple-300 font-mono">
              💡 连接到 OpenClaw Gateway 后，灵魂塔将显示：
            </p>
            <ul className="mt-2 text-[10px] text-white/50 space-y-1 font-mono">
              <li>• Agent 身份与状态</li>
              <li>• 系统健康度 → 生命力</li>
              <li>• 运行时间 → 经验值</li>
              <li>• 操作者数量 → 感知</li>
              <li>• 节点数量 → 力量</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

// cn utility inline for this file
function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}
