/**
 * TelescopePanel — 左栏证据池面板
 */

import { Database } from 'lucide-react'
import type { EvidenceItem } from '@/types'
import { EvidenceCard } from './EvidenceCard'

interface Props {
  pool: EvidenceItem[]
}

export function TelescopePanel({ pool }: Props) {
  if (pool.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <Database className="w-5 h-5 text-stone-300 mb-2" />
        <p className="text-xs text-stone-400">尚无证据</p>
      </div>
    )
  }

  return (
    <div className="p-3">
      <div className="flex items-center gap-2 mb-2">
        <Database className="w-3.5 h-3.5 text-stone-400" />
        <span className="text-xs font-bold text-stone-500">
          证据池 ({pool.length})
        </span>
      </div>
      <div className="space-y-1.5">
        {pool.map((item, idx) => (
          <EvidenceCard key={item.id} item={item} index={idx} />
        ))}
      </div>
    </div>
  )
}
