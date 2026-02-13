import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Brain, Loader2, Zap } from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import type { SkillNode } from '@/types'

// 默认技能节点（未连接时显示）
const defaultSkills: SkillNode[] = [
  { id: 'webchat', name: 'WebChat', x: 250, y: 80, level: 50, unlocked: true, dependencies: [] },
  { id: 'telegram', name: 'Telegram', x: 150, y: 180, level: 0, unlocked: false, dependencies: ['webchat'] },
  { id: 'whatsapp', name: 'WhatsApp', x: 350, y: 180, level: 0, unlocked: false, dependencies: ['webchat'] },
  { id: 'discord', name: 'Discord', x: 100, y: 300, level: 0, unlocked: false, dependencies: ['telegram'] },
  { id: 'slack', name: 'Slack', x: 250, y: 300, level: 0, unlocked: false, dependencies: ['telegram', 'whatsapp'] },
  { id: 'signal', name: 'Signal', x: 400, y: 300, level: 0, unlocked: false, dependencies: ['whatsapp'] },
]

function SkillNodeComponent({ node, allNodes }: { node: SkillNode; allNodes: SkillNode[] }) {
  const nodeMap = useMemo(() => 
    Object.fromEntries(allNodes.map(n => [n.id, n])),
    [allNodes]
  )

  return (
    <g>
      {/* 依赖连线 */}
      {node.dependencies.map((depId) => {
        const dep = nodeMap[depId]
        if (!dep) return null
        return (
          <motion.line
            key={`${node.id}-${depId}`}
            x1={dep.x}
            y1={dep.y}
            x2={node.x}
            y2={node.y}
            stroke={node.unlocked ? 'rgba(34, 211, 238, 0.3)' : 'rgba(255, 255, 255, 0.1)'}
            strokeWidth={node.unlocked ? 2 : 1}
            strokeDasharray={node.unlocked ? '0' : '4 4'}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1, delay: 0.2 }}
          />
        )
      })}

      {/* 节点 */}
      <motion.g
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
      >
        {/* 光晕效果 */}
        {node.unlocked && (
          <motion.circle
            cx={node.x}
            cy={node.y}
            r={35}
            fill="url(#glowGradient)"
            opacity={0.5}
            animate={{
              r: [35, 40, 35],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        )}

        {/* 主圆 */}
        <circle
          cx={node.x}
          cy={node.y}
          r={30}
          fill={node.unlocked ? 'rgba(34, 211, 238, 0.2)' : 'rgba(255, 255, 255, 0.05)'}
          stroke={node.unlocked ? 'rgba(34, 211, 238, 0.6)' : 'rgba(255, 255, 255, 0.2)'}
          strokeWidth={2}
          className="cursor-pointer hover:stroke-cyan-400 transition-colors"
        />

        {/* 等级指示器 */}
        {node.unlocked && (
          <motion.circle
            cx={node.x}
            cy={node.y}
            r={28}
            fill="none"
            stroke="rgba(34, 211, 238, 0.8)"
            strokeWidth={3}
            strokeDasharray={`${(node.level / 100) * 175.9} 175.9`}
            strokeLinecap="round"
            transform={`rotate(-90 ${node.x} ${node.y})`}
            initial={{ strokeDasharray: '0 175.9' }}
            animate={{ strokeDasharray: `${(node.level / 100) * 175.9} 175.9` }}
            transition={{ duration: 1, delay: 0.5 }}
          />
        )}

        {/* 图标/文字 */}
        <text
          x={node.x}
          y={node.y + 4}
          textAnchor="middle"
          className={cn(
            'text-xs font-mono select-none pointer-events-none',
            node.unlocked ? 'fill-cyan-300' : 'fill-white/30'
          )}
        >
          {node.name.slice(0, 6)}
        </text>

        {/* 等级标签 */}
        {node.unlocked && (
          <g>
            <rect
              x={node.x - 15}
              y={node.y + 35}
              width={30}
              height={16}
              rx={4}
              fill="rgba(34, 211, 238, 0.2)"
              stroke="rgba(34, 211, 238, 0.4)"
              strokeWidth={1}
            />
            <text
              x={node.x}
              y={node.y + 47}
              textAnchor="middle"
              className="text-[9px] font-mono fill-cyan-400 select-none pointer-events-none"
            >
              Lv.{node.level}
            </text>
          </g>
        )}

        {/* 锁定标记 */}
        {!node.unlocked && (
          <text
            x={node.x}
            y={node.y + 45}
            textAnchor="middle"
            className="text-[8px] font-mono fill-white/20 select-none"
          >
            🔒
          </text>
        )}
      </motion.g>
    </g>
  )
}

export function SkillHouse() {
  const storeSkills = useStore((s) => s.skills)
  const loading = useStore((s) => s.channelsLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)

  const isConnected = connectionStatus === 'connected'
  const skills = isConnected && storeSkills.length > 0 ? storeSkills : defaultSkills

  // 统计
  const unlockedCount = skills.filter(s => s.unlocked).length
  const totalLevel = skills.reduce((sum, s) => sum + s.level, 0)

  if (loading && isConnected) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* 主区域: 技能树可视化 */}
      <div className="flex-1 relative overflow-hidden">
        <svg className="w-full h-full" viewBox="0 0 500 600">
          <defs>
            <radialGradient id="glowGradient">
              <stop offset="0%" stopColor="rgba(34, 211, 238, 0.4)" />
              <stop offset="100%" stopColor="rgba(34, 211, 238, 0)" />
            </radialGradient>
          </defs>

          {/* 背景网格 */}
          <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path
              d="M 50 0 L 0 0 0 50"
              fill="none"
              stroke="rgba(255,255,255,0.03)"
              strokeWidth="1"
            />
          </pattern>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* 技能节点 */}
          {skills.map((node) => (
            <SkillNodeComponent key={node.id} node={node} allNodes={skills} />
          ))}
        </svg>

        {/* 标题 */}
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <Brain className="w-5 h-5 text-cyan-400" />
          <h3 className="font-mono text-sm text-cyan-300 tracking-wider">
            频道技能树
          </h3>
        </div>
      </div>

      {/* 侧边栏: 统计 */}
      <div className="w-48 border-l border-white/10 p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-cyan-400" />
          <h4 className="font-mono text-xs text-cyan-300 uppercase">统计</h4>
        </div>

        <div className="space-y-3">
          <div className="p-3 bg-white/5 rounded-lg">
            <p className="text-[10px] font-mono text-white/40 uppercase">已解锁</p>
            <p className="text-2xl font-bold text-cyan-400">
              {unlockedCount}<span className="text-sm text-white/30">/{skills.length}</span>
            </p>
          </div>

          <div className="p-3 bg-white/5 rounded-lg">
            <p className="text-[10px] font-mono text-white/40 uppercase">总等级</p>
            <p className="text-2xl font-bold text-emerald-400">{totalLevel}</p>
          </div>
        </div>

        <div className="pt-4 border-t border-white/10">
          <p className="text-[9px] font-mono text-white/30 leading-relaxed">
            连接更多消息平台以解锁新技能。每个平台的连接账户数决定技能等级。
          </p>
        </div>
      </div>
    </div>
  )
}
