/**
 * IntentCardUI — 意图确认卡片
 *
 * 当 confidence < 0.85 时显示, 让用户确认/取消操作
 */

import { motion } from 'framer-motion'
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import type { IntentCard } from '@/types'

interface Props {
  card: IntentCard
  onConfirm: () => void
  onCancel: () => void
}

const KIND_LABELS: Record<string, string> = {
  draft_section: '草起段落',
  rewrite_section: '改写段落',
  revise_agenda: '修改议程',
  supplement_evidence: '补充证据',
  export_document: '导出全文',
  focus_section: '聚焦段落',
  ask_question: '提问',
  skill_mention: '添加技能',
  skill_remove: '移除技能',
  unknown: '未识别',
}

export function IntentCardUI({ card, onConfirm, onCancel }: Props) {
  const confPct = `${(card.confidence * 100).toFixed(0)}%`
  const isLow = card.confidence < 0.5

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.97 }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      className="mx-2 mb-2 p-3 bg-amber-50/80 border border-amber-200 rounded-2xl backdrop-blur-sm"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isLow ? 'text-red-400' : 'text-amber-500'}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-stone-700">
              {KIND_LABELS[card.intent.kind] || card.intent.kind}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                isLow ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
              }`}
            >
              {confPct}
            </span>
          </div>
          <p className="text-xs text-stone-600 mb-1.5">{card.scopeDescription}</p>
          {card.plannedActions.length > 0 && (
            <ul className="mb-2">
              {card.plannedActions.map((a, i) => (
                <li key={i} className="text-[11px] text-stone-500 flex items-center gap-1">
                  <span className="text-stone-300">-</span> {a}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onConfirm}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-md transition-colors"
            >
              <CheckCircle className="w-3 h-3" />
              执行
            </button>
            <button
              onClick={onCancel}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-stone-500 bg-stone-100 hover:bg-stone-200 rounded-md transition-colors"
            >
              <XCircle className="w-3 h-3" />
              取消
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
