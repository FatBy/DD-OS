import { motion, AnimatePresence } from 'framer-motion'
import { X, Sparkles, Building2 } from 'lucide-react'
import { useStore } from '@/store'

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
        position: { gridX, gridY },
        level: 1,
        xp: 0,
        visualDNA: accepted.previewVisualDNA,
        label: accepted.suggestedName,
        constructionProgress: 0, // 开始建造动画
        createdAt: Date.now(),
        // 传入技能和 SOP
        boundSkillIds: accepted.boundSkillIds || [],
        sopContent: accepted.sopContent || '',
        flavorText: `由 Observer 在 ${new Date().toLocaleDateString()} 创建`,
      })
    }
  }
  
  if (!currentProposal) return null
  
  // 从 previewVisualDNA 获取动态颜色
  const hue = currentProposal.previewVisualDNA?.primaryHue ?? 180
  const dynamicBg = { backgroundColor: `hsla(${hue}, 70%, 50%, 0.1)` }
  const dynamicBorder = { borderColor: `hsla(${hue}, 70%, 50%, 0.3)` }
  const dynamicText = { color: `hsl(${hue}, 80%, 65%)` }
  const dynamicBgHover = { backgroundColor: `hsla(${hue}, 70%, 50%, 0.2)` }
  
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 背景遮罩 - 提高 z-index 确保在最上层 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={rejectProposal}
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-[100]"
          />
          
          {/* 弹窗 - 使用 inset-0 m-auto 实现居中，避免与 framer-motion transform 冲突 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-[101] m-auto
                       w-[90%] max-w-md h-fit
                       bg-slate-900/98 border-2 border-amber-500/40 
                       rounded-2xl shadow-[0_0_60px_rgba(245,158,11,0.3)]
                       overflow-hidden"
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
              
              {/* 预览 - 使用动态颜色 */}
              <div className="flex items-center gap-6 mb-4">
                <div 
                  className="w-24 h-24 rounded-lg flex items-center justify-center flex-shrink-0 border"
                  style={{ ...dynamicBg, ...dynamicBorder }}
                >
                  <span className="text-4xl">🏗️</span>
                </div>
                
                <div className="flex-1 min-w-0">
                  <h3 className="font-mono text-lg text-white/90 mb-1">
                    {currentProposal.suggestedName}
                  </h3>
                  <p className="text-xs font-mono" style={dynamicText}>
                    Nexus
                  </p>
                  <p className="text-xs text-white/50 mt-1">
                    基于行为模式创建
                  </p>
                </div>
              </div>
              
              {/* 功能目标概述 */}
              <div 
                className="mb-6 p-3 rounded-lg border-l-2"
                style={{ ...dynamicBg, borderLeftColor: `hsla(${hue}, 70%, 50%, 0.5)` }}
              >
                <p className="text-xs text-white/70 leading-relaxed">
                  {currentProposal.purposeSummary}
                </p>
              </div>
              
              {/* 触发证据 */}
              <div className="mb-6 p-3 bg-white/5 rounded-lg border border-white/5">
                <p className="text-[13px] font-mono text-white/40 mb-2">检测依据：</p>
                <div className="space-y-1">
                  {currentProposal.triggerPattern.evidence.slice(0, 3).map((ev, i) => (
                    <p key={i} className="text-xs font-mono text-white/60 truncate">
                      • {ev}
                    </p>
                  ))}
                </div>
                <p className="text-[13px] font-mono text-white/30 mt-2">
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
                  className="flex-1 py-2.5 px-4 rounded-lg flex items-center justify-center gap-2
                           text-sm font-mono transition-colors border"
                  style={{ ...dynamicBg, ...dynamicBorder, ...dynamicText }}
                  onMouseOver={(e) => Object.assign(e.currentTarget.style, dynamicBgHover)}
                  onMouseOut={(e) => Object.assign(e.currentTarget.style, dynamicBg)}
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
