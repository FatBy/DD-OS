import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { GlassCard } from './GlassCard'
import { useStore } from '@/store'
import { houseVariants, springTransition } from '@/utils/animations'
import type { HouseConfig } from '@/types'

const themeTextMap: Record<string, string> = {
  cyan: 'text-cyan-400',
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  purple: 'text-purple-400',
  slate: 'text-slate-400',
}

interface HouseContainerProps {
  house: HouseConfig
  children: ReactNode
}

export function HouseContainer({ house, children }: HouseContainerProps) {
  const setView = useStore((s) => s.setView)
  const Icon = house.icon
  const textColor = themeTextMap[house.themeColor] ?? 'text-white'

  return (
    <motion.div
      className="absolute inset-0 z-10 flex items-center justify-center p-4 md:p-8"
      variants={houseVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={springTransition}
    >
      <GlassCard
        themeColor={house.themeColor}
        className="w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden"
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <Icon className={`w-5 h-5 ${textColor}`} />
            <h2 className={`font-mono font-bold text-lg tracking-wider ${textColor}`}>
              {house.name}
            </h2>
          </div>
          <button
            onClick={() => setView('world')}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/50 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden relative">
          {children}
        </div>
      </GlassCard>
    </motion.div>
  )
}
