/**
 * EvidenceCard — 单条证据卡片
 */

import { motion } from 'framer-motion'
import type { EvidenceItem } from '@/types'

interface Props {
  item: EvidenceItem
  index: number
}

const LENS_COLORS: Record<string, string> = {
  L: 'bg-blue-100 text-blue-700',
  S: 'bg-purple-100 text-purple-700',
}

export function EvidenceCard({ item, index }: Props) {
  const label = `${item.lens}${index + 1}`
  const colorClass = LENS_COLORS[item.lens] || 'bg-stone-100 text-stone-600'

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03, ease: [0.23, 1, 0.32, 1] }}
      whileHover={{ x: 2 }}
      className="px-2.5 py-2 rounded-xl border border-stone-100 hover:border-stone-200 bg-white/60 transition-colors"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${colorClass}`}>
          {label}
        </span>
        <span className="text-xs font-medium text-stone-700 truncate">{item.title}</span>
      </div>
      <p className="text-[11px] text-stone-500 line-clamp-2">{item.snippet}</p>
    </motion.div>
  )
}
