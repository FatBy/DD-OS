import { motion } from 'framer-motion'
import { useStore } from '@/store'
import { houseRegistry } from '@/houses/registry'
import { dockIconVariants } from '@/utils/animations'
import { cn } from '@/utils/cn'

const themeColorMap: Record<string, string> = {
  cyan: 'text-cyan-400',
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  purple: 'text-purple-400',
  slate: 'text-slate-400',
}

const activeBgMap: Record<string, string> = {
  cyan: 'bg-cyan-400/20',
  emerald: 'bg-emerald-400/20',
  amber: 'bg-amber-400/20',
  purple: 'bg-purple-400/20',
  slate: 'bg-white/10',
}

const dotColorMap: Record<string, string> = {
  cyan: 'bg-cyan-400',
  emerald: 'bg-emerald-400',
  amber: 'bg-amber-400',
  purple: 'bg-purple-400',
  slate: 'bg-slate-400',
}

export function Dock() {
  const { currentView, setView } = useStore()

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40">
      <motion.div
        className="flex items-end gap-1 px-4 py-3 bg-slate-900/60 backdrop-blur-2xl rounded-2xl border border-white/15 shadow-2xl"
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.3 }}
      >
        {houseRegistry.map((house) => {
          const Icon = house.icon
          const isActive = currentView === house.id
          const textColor = themeColorMap[house.themeColor] ?? 'text-white'
          const activeBg = activeBgMap[house.themeColor] ?? 'bg-white/10'
          const dotColor = dotColorMap[house.themeColor] ?? 'bg-white'

          return (
            <div key={house.id} className="relative group">
              {/* Tooltip */}
              <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/80 backdrop-blur-md rounded-lg text-xs font-mono text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border border-white/10">
                {house.name}
              </div>

              <motion.button
                onClick={() => setView(house.id)}
                className={cn(
                  'flex flex-col items-center gap-1 p-3 rounded-xl transition-colors',
                  isActive ? activeBg : 'hover:bg-white/5'
                )}
                variants={dockIconVariants}
                whileHover="hover"
                whileTap="tap"
                transition={{ type: 'spring', stiffness: 400, damping: 15 }}
              >
                <Icon
                  className={cn(
                    'w-6 h-6 transition-colors',
                    isActive ? textColor : 'text-white/60'
                  )}
                />
              </motion.button>

              {/* Active indicator dot */}
              {isActive && (
                <motion.div
                  className={cn(
                    'absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full',
                    dotColor
                  )}
                  layoutId="dock-active-dot"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </div>
          )
        })}
      </motion.div>
    </div>
  )
}
