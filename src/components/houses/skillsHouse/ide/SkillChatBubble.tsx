/**
 * SkillChatBubble - 单条聊天消息气泡
 *
 * 三种角色:
 * - user: 右对齐深色气泡
 * - assistant: 左对齐浅色气泡 + MarkdownRenderer + InlineDiffCard
 * - system: 居中小字系统通知
 *
 * DunCrew 暖色风格，匹配 AIChatPanel 的消息样式
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { MarkdownRenderer } from '@/components/ai/markdown/MarkdownRenderer'
import { InlineDiffCard } from './InlineDiffCard'
import type { SkillChatMessage } from '@/store/slices/skillIDESlice'

interface SkillChatBubbleProps {
  message: SkillChatMessage
  onAcceptDiff: (diffBlockId: string) => void
  onRejectDiff: (diffBlockId: string) => void
  onAcceptAll: () => void
}

export function SkillChatBubble({
  message,
  onAcceptDiff,
  onRejectDiff,
  onAcceptAll,
}: SkillChatBubbleProps) {
  const { role, content, diffBlocks, error, reasoningContent } = message
  const hasPendingDiffs = diffBlocks?.some((b) => b.status === 'pending')
  const [reasoningExpanded, setReasoningExpanded] = useState(false)

  // ---- System message ----
  if (role === 'system') {
    return (
      <div className="flex justify-center py-1.5">
        <div className="px-3 py-1 text-[11px] text-stone-400 bg-stone-100/60 rounded-full max-w-[80%] text-center">
          {content}
        </div>
      </div>
    )
  }

  // ---- User message ----
  if (role === 'user') {
    return (
      <div className="flex justify-end gap-2 py-1.5">
        <div className="max-w-[80%] px-3.5 py-2.5 bg-stone-800 text-stone-50 text-[13px] leading-relaxed rounded-2xl rounded-tr-sm shadow-sm">
          <div className="whitespace-pre-wrap break-words">{content}</div>
        </div>
      </div>
    )
  }

  // ---- Assistant message ----
  return (
    <div className="flex justify-start gap-2 py-1.5">
      <div className={`max-w-[90%] min-w-[200px] ${
        error
          ? 'px-3.5 py-2.5 bg-[#dc7864]/10 border border-[#dc7864]/20 text-[#dc7864] rounded-2xl rounded-tl-sm'
          : 'px-3.5 py-2.5 bg-stone-50 border border-stone-100 text-stone-700 rounded-2xl rounded-tl-sm'
      }`}>
        {/* Collapsible reasoning / thinking block */}
        {reasoningContent && (
          <div className="mb-2">
            <button
              onClick={() => setReasoningExpanded(!reasoningExpanded)}
              className="flex items-center gap-1 text-[11px] font-bold text-amber-600/70 hover:text-amber-600 transition-colors"
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform ${reasoningExpanded ? '' : '-rotate-90'}`}
              />
              Thinking
              <span className="font-normal text-stone-400 ml-1">
                ({reasoningContent.length > 200 ? `${Math.ceil(reasoningContent.length / 4)} chars` : 'short'})
              </span>
            </button>
            <AnimatePresence>
              {reasoningExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-1 px-3 py-2 bg-amber-50/60 border border-amber-200/30 rounded-xl text-[12px] leading-relaxed text-stone-500 max-h-[300px] overflow-y-auto scrollbar-thin">
                    <MarkdownRenderer content={reasoningContent} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Main content */}
        {content && (
          <div className="text-[13px] leading-relaxed prose prose-stone prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0">
            <MarkdownRenderer content={content} />
          </div>
        )}

        {/* Inline diff cards */}
        {diffBlocks && diffBlocks.length > 0 && (
          <div className="mt-2">
            {diffBlocks.map((block) => (
              <InlineDiffCard
                key={block.id}
                diffBlock={block}
                onAccept={() => onAcceptDiff(block.id)}
                onReject={() => onRejectDiff(block.id)}
              />
            ))}

            {/* Accept All button (when multiple pending diffs) */}
            {hasPendingDiffs && diffBlocks.length > 1 && (
              <div className="flex justify-end mt-1.5">
                <button
                  onClick={onAcceptAll}
                  className="px-3 py-1 text-[11px] font-bold text-white bg-[#5ebab0] rounded-lg hover:bg-[#5ebab0]/90 transition-colors shadow-sm"
                >
                  Accept All
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
