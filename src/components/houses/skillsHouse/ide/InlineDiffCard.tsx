/**
 * InlineDiffCard - 内嵌 Diff 卡片
 *
 * 在聊天气泡中显示 LLM 提出的代码变更。
 * 使用 diff 库计算行级差异，支持 Accept/Reject 操作。
 *
 * DunCrew 暖色风格: #6cb478 added, #dc7864 removed, #5ebab0 accept button
 */

import { useMemo, useState } from 'react'
import { diffLines } from 'diff'
import { motion } from 'framer-motion'
import { Check, X, ChevronDown, ChevronUp } from 'lucide-react'
import type { DiffBlock } from '@/store/slices/skillIDESlice'

interface InlineDiffCardProps {
  diffBlock: DiffBlock
  onAccept: () => void
  onReject: () => void
}

export function InlineDiffCard({ diffBlock, onAccept, onReject }: InlineDiffCardProps) {
  const [collapsed, setCollapsed] = useState(false)

  const changes = useMemo(
    () => diffLines(diffBlock.original, diffBlock.proposed),
    [diffBlock.original, diffBlock.proposed],
  )

  // 统计增删行数
  let addedLines = 0
  let removedLines = 0
  for (const change of changes) {
    const count = (change.value.match(/\n/g) || []).length + (change.value.endsWith('\n') ? 0 : 1)
    if (change.added) addedLines += count
    if (change.removed) removedLines += count
  }

  const isPending = diffBlock.status === 'pending'
  const isAccepted = diffBlock.status === 'accepted'
  const isRejected = diffBlock.status === 'rejected'

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`my-2 border rounded-2xl overflow-hidden ${
        isAccepted
          ? 'border-[#6cb478]/40 bg-[#6cb478]/5'
          : isRejected
            ? 'border-stone-200/40 bg-stone-50/50 opacity-60'
            : 'border-stone-200/60 bg-white'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-stone-100/60">
        <div className="flex items-center gap-2">
          {/* Status badge */}
          {isAccepted && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-[#6cb478]">
              <Check className="w-3 h-3" /> Accepted
            </span>
          )}
          {isRejected && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-stone-400">
              <X className="w-3 h-3" /> Rejected
            </span>
          )}
          {isPending && (
            <span className="text-[10px] font-bold text-stone-500">Proposed Changes</span>
          )}

          {/* Diff stats */}
          <span className="text-[10px] font-mono font-bold text-[#6cb478]">+{addedLines}</span>
          <span className="text-[10px] font-mono font-bold text-[#dc7864]">-{removedLines}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-0.5 text-stone-400 hover:text-stone-600 transition-colors"
          >
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>

          {/* Accept / Reject buttons */}
          {isPending && (
            <>
              <button
                onClick={onReject}
                className="px-2 py-0.5 text-[10px] font-bold text-stone-500 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
              >
                Reject
              </button>
              <button
                onClick={onAccept}
                className="px-2 py-0.5 text-[10px] font-bold text-white bg-[#5ebab0] hover:bg-[#5ebab0]/90 rounded-lg transition-colors shadow-sm"
              >
                Accept
              </button>
            </>
          )}
        </div>
      </div>

      {/* Diff content */}
      {!collapsed && (
        <div className="max-h-[240px] overflow-auto font-mono text-[11px] leading-5">
          {changes.map((change, idx) => {
            const lines = change.value.split('\n')
            if (lines[lines.length - 1] === '') lines.pop()

            return lines.map((line, lineIdx) => {
              let bgClass = ''
              let textClass = 'text-stone-600'
              let prefix = ' '

              if (change.added) {
                bgClass = 'bg-[#6cb478]/8'
                textClass = 'text-[#3c6b42]'
                prefix = '+'
              } else if (change.removed) {
                bgClass = 'bg-[#dc7864]/8'
                textClass = 'text-[#8b3a2c]'
                prefix = '-'
              }

              return (
                <div
                  key={`${idx}-${lineIdx}`}
                  className={`flex ${bgClass}`}
                >
                  <span className={`w-5 shrink-0 text-center text-[10px] select-none ${
                    change.added ? 'text-[#6cb478]' : change.removed ? 'text-[#dc7864]' : 'text-stone-300'
                  }`}>
                    {prefix}
                  </span>
                  <span className={`flex-1 px-2 whitespace-pre ${textClass}`}>
                    {line}
                  </span>
                </div>
              )
            })
          })}
        </div>
      )}
    </motion.div>
  )
}
