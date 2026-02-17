import { motion, AnimatePresence } from 'framer-motion'
import { X, Sparkles, Building2 } from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import type { NexusArchetype } from '@/types'

// Archetype 图标和描述
const ARCHETYPE_INFO: Record<NexusArchetype, { 
  icon: string
  label: string 
  description: string
  color: string
}> = {
  MONOLITH: {
    icon: '🏛️',
    label: '知识巨碑',
    description: '存储与知识积累',
    color: 'amber',
  },
  SPIRE: {
    icon: '🗼',
    label: '推理尖塔',
    description: '复杂流程与推理',
    color: 'purple',
  },
  REACTOR: {
    icon: '⚛️',
    label: '执行反应堆',
    description: '执行与集成',
    color: 'cyan',
  },
  VAULT: {
    icon: '💎',
    label: '记忆水晶库',
    description: '频繁访问与记忆',
    color: 'emerald',
  },
}

export function BuildProposalModal() {
  const currentProposal = useStore((s) => s.currentProposal)
  const acceptProposal = useStore((s) => s.acceptProposal)
  const rejectProposal = useStore((s) => s.rejectProposal)
  const addNexus = useStore((s) => s.addNexus)
  
  const isOpen = currentProposal?.status === 'pending'
  
  const handleAccept = () => {
    const accepted = acceptProposal()
    if (accepted) {
      // 创建新的 Nexus
      const nexusId = `nexus-${Date.now()}`
      
      // 找一个空闲位置（简单实现：随机偏移）
      const gridX = Math.floor(Math.random() * 6) - 3
      const gridY = Math.floor(Math.random() * 6) - 3
      
      addNexus({
        id: nexusId,
        archetype: accepted.suggestedArchetype,
        position: { gridX, gridY },
        level: 1,
        xp: 0,
        visualDNA: accepted.previewVisualDNA,
        label: accepted.suggestedName,
        constructionProgress: 0, // 开始建造动画
        createdAt: Date.now(),
        boundSkillId: accepted.boundSkillId,
        flavorText: `由 Observer 在 ${new Date().toLocaleDateString()} 创建`,
      })
    }
  }
  
  if (!currentProposal) return null
  
  const archInfo = ARCHETYPE_INFO[currentProposal.suggestedArchetype]
  
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={rejectProposal}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />
          
          {/* 弹窗 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                       w-[90%] max-w-md bg-slate-900/95 border border-white/10 
                       rounded-xl shadow-2xl overflow-hidden"
          >
            {/* 头部 */}
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <span className="font-mono text-sm text-amber-400">Observer Signal</span>
              </div>
              <button 
                onClick={rejectProposal}
                className="p-1 hover:bg-white/10 rounded transition-colors"
              >
                <X className="w-4 h-4 text-white/50" />
              </button>
            </div>
            
            {/* 内容 */}
            <div className="p-6">
              <p className="text-sm text-white/80 mb-6 leading-relaxed">
                指挥官，我检测到您的行为模式。是否将此固化为 Nexus？
              </p>
              
              {/* Archetype 预览 */}
              <div className="flex items-center gap-6 mb-6">
                <div className={cn(
                  'w-24 h-24 rounded-lg flex items-center justify-center',
                  `bg-${archInfo.color}-500/10 border border-${archInfo.color}-500/30`
                )}>
                  <span className="text-4xl">{archInfo.icon}</span>
                </div>
                
                <div className="flex-1">
                  <h3 className="font-mono text-lg text-white/90 mb-1">
                    {currentProposal.suggestedName}
                  </h3>
                  <p className={cn('text-xs font-mono', `text-${archInfo.color}-400`)}>
                    {archInfo.label}
                  </p>
                  <p className="text-xs text-white/50 mt-1">
                    {archInfo.description}
                  </p>
                </div>
              </div>
              
              {/* 触发证据 */}
              <div className="mb-6 p-3 bg-white/5 rounded-lg border border-white/5">
                <p className="text-[10px] font-mono text-white/40 mb-2">检测依据：</p>
                <div className="space-y-1">
                  {currentProposal.triggerPattern.evidence.slice(0, 3).map((ev, i) => (
                    <p key={i} className="text-xs font-mono text-white/60 truncate">
                      • {ev}
                    </p>
                  ))}
                </div>
                <p className="text-[10px] font-mono text-white/30 mt-2">
                  置信度: {Math.round(currentProposal.triggerPattern.confidence * 100)}%
                </p>
              </div>
              
              {/* 按钮 */}
              <div className="flex gap-3">
                <button
                  onClick={rejectProposal}
                  className="flex-1 py-2.5 px-4 rounded-lg border border-white/10 
                           text-sm font-mono text-white/60 hover:bg-white/5 transition-colors"
                >
                  稍后再说
                </button>
                <button
                  onClick={handleAccept}
                  className={cn(
                    'flex-1 py-2.5 px-4 rounded-lg flex items-center justify-center gap-2',
                    'text-sm font-mono transition-colors',
                    `bg-${archInfo.color}-500/20 border border-${archInfo.color}-500/30`,
                    `text-${archInfo.color}-400 hover:bg-${archInfo.color}-500/30`
                  )}
                >
                  <Building2 className="w-4 h-4" />
                  建造
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
