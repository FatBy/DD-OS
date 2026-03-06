import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Check, Play, ListChecks } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useStore } from '@/store'

// ============================================
// 建议解析器
// ============================================

export interface SuggestionItem {
  index: number
  label: string
}

export interface ParsedSuggestions {
  /** suggestions 块之前的内容 */
  contentBefore: string
  /** suggestions 块之后的内容 */
  contentAfter: string
  /** 解析出的建议列表 */
  items: SuggestionItem[]
}

const SUGGESTION_REGEX = /<!-- suggestions -->\s*\n([\s\S]*?)\n\s*<!-- \/suggestions -->/

/**
 * 从 AI 回复内容中提取 <!-- suggestions --> 块
 * 如果没有约定格式，fallback 尝试匹配"下一步建议"后的编号列表
 */
export function parseSuggestions(content: string): ParsedSuggestions | null {
  // 方案A: 约定格式
  const match = content.match(SUGGESTION_REGEX)
  if (match) {
    const block = match[1]
    const items: SuggestionItem[] = []
    const lines = block.split('\n')
    let idx = 0
    for (const line of lines) {
      const trimmed = line.trim()
      // 匹配 "- xxx" 或 "- [ ] xxx"
      const m = trimmed.match(/^-\s*(?:\[[ x]?\]\s*)?(.+)/)
      if (m) {
        items.push({ index: idx++, label: m[1].trim() })
      }
    }
    if (items.length >= 2) {
      const startIdx = content.indexOf(match[0])
      const endIdx = startIdx + match[0].length
      return {
        contentBefore: content.slice(0, startIdx).trimEnd(),
        contentAfter: content.slice(endIdx).trimStart(),
        items,
      }
    }
  }

  // 方案B: fallback — 匹配 "下一步建议" / "建议" / "你可以" 后面的编号列表
  const fallbackPattern = /(?:下一步建议|接下来可以|你可以选择|建议如下|可选操作)[：:：]?\s*\n((?:\s*(?:\d+[\.\)、]|[A-Za-z][\.\)]|-)\s+.+\n?){2,})/
  const fallbackMatch = content.match(fallbackPattern)
  if (fallbackMatch) {
    const block = fallbackMatch[1]
    const items: SuggestionItem[] = []
    let idx = 0
    const lines = block.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      // 匹配 "1. xxx" / "A. xxx" / "- xxx"
      const m = trimmed.match(/^(?:\d+[\.\)、]|[A-Za-z][\.\)]|-)\s+(.+)/)
      if (m) {
        items.push({ index: idx++, label: m[1].trim() })
      }
    }
    if (items.length >= 2) {
      const startIdx = content.indexOf(fallbackMatch[0])
      const endIdx = startIdx + fallbackMatch[0].length
      return {
        contentBefore: content.slice(0, startIdx).trimEnd(),
        contentAfter: content.slice(endIdx).trimStart(),
        items,
      }
    }
  }

  return null
}

// ============================================
// SuggestionChips UI 组件
// ============================================

interface SuggestionChipsProps {
  items: SuggestionItem[]
  /** 当前消息的完整 AI 回复内容（用作上下文） */
  aiContent: string
  /** 是否禁用（如正在流式输出时） */
  disabled?: boolean
}

export function SuggestionChips({ items, aiContent, disabled }: SuggestionChipsProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [executed, setExecuted] = useState(false)
  const sendChat = useStore((s) => s.sendChat)
  const currentView = useStore((s) => s.currentView)
  const chatStreaming = useStore((s) => s.chatStreaming)

  const isDisabled = disabled || chatStreaming || executed

  const toggleItem = (index: number) => {
    if (isDisabled) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const selectedLabels = useMemo(() => {
    return items
      .filter(item => selected.has(item.index))
      .map(item => item.label)
  }, [items, selected])

  const handleExecute = () => {
    if (selectedLabels.length === 0 || isDisabled) return

    // 构建携带上下文的消息
    const choiceList = selectedLabels.map((label, i) => `${i + 1}. ${label}`).join('\n')

    // 截取 AI 回复的关键部分作为上下文锚定（去掉 suggestion 块本身，保留核心内容）
    const contextContent = aiContent
      .replace(SUGGESTION_REGEX, '')
      .trim()
    // 限制上下文长度，避免过长
    const maxCtx = 2000
    const truncatedContext = contextContent.length > maxCtx
      ? contextContent.slice(0, maxCtx) + '...'
      : contextContent

    const message = `我选择执行以下建议：
${choiceList}

请基于之前的分析内容继续执行。之前的关键内容：
---
${truncatedContext}
---
请紧密围绕上述内容展开，不要偏离主题。`

    setExecuted(true)
    sendChat(message, currentView)
  }

  const handleSingleClick = (item: SuggestionItem) => {
    if (isDisabled) return

    const contextContent = aiContent
      .replace(SUGGESTION_REGEX, '')
      .trim()
    const maxCtx = 2000
    const truncatedContext = contextContent.length > maxCtx
      ? contextContent.slice(0, maxCtx) + '...'
      : contextContent

    const message = `我选择执行：${item.label}

请基于之前的分析内容继续执行。之前的关键内容：
---
${truncatedContext}
---
请紧密围绕上述内容展开，不要偏离主题。`

    setExecuted(true)
    sendChat(message, currentView)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="mt-3 space-y-2"
    >
      {/* 标题 */}
      <div className="flex items-center gap-1.5 text-xs text-white/40">
        <ListChecks className="w-3.5 h-3.5" />
        <span>点击选择，或多选后执行</span>
      </div>

      {/* 选项芯片 */}
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isSelected = selected.has(item.index)
          return (
            <button
              key={item.index}
              onClick={() => {
                if (selected.size === 0 && !isDisabled) {
                  // 第一次点击：直接执行单选
                  // 但如果已有选中项，则切换选择状态
                  handleSingleClick(item)
                } else {
                  toggleItem(item.index)
                }
              }}
              onContextMenu={(e) => {
                // 右键切换多选模式
                e.preventDefault()
                toggleItem(item.index)
              }}
              disabled={isDisabled}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-mono transition-all duration-150',
                'border',
                isDisabled
                  ? 'opacity-40 cursor-not-allowed'
                  : 'cursor-pointer hover:scale-[1.02] active:scale-[0.98]',
                isSelected
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                  : executed
                  ? 'bg-white/3 border-white/8 text-white/30'
                  : 'bg-white/5 border-white/12 text-white/60 hover:text-amber-400 hover:border-amber-500/30 hover:bg-amber-500/8'
              )}
            >
              {isSelected && <Check className="w-3 h-3 text-amber-400" />}
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      {/* 多选执行按钮 — 有选中项时显示 */}
      {selected.size > 0 && !executed && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="flex items-center gap-2"
        >
          <button
            onClick={handleExecute}
            disabled={isDisabled}
            className={cn(
              'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-mono transition-colors',
              'bg-amber-500/20 border border-amber-500/40 text-amber-300',
              'hover:bg-amber-500/30 active:bg-amber-500/40',
              'disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            <Play className="w-3.5 h-3.5" />
            执行选中 ({selected.size})
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-white/30 hover:text-white/50 transition-colors"
          >
            清除选择
          </button>
        </motion.div>
      )}

      {/* 已执行提示 */}
      {executed && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-400/60">
          <Check className="w-3 h-3" />
          <span>已发送执行请求</span>
        </div>
      )}
    </motion.div>
  )
}
