/**
 * WriterChatPanel — 自习室右栏: 完整对话面板 v2
 *
 * 功能:
 * - 完整高度的对话界面 (不再是底部小窗)
 * - 展示 LLM 思考链 (采集证据 → 构建大纲 → 撰写中)
 * - 流式输出时实时展示
 * - @mention 技能选择 (复用 MentionDropdown)
 * - 用户随时对话推进/修改
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { Send, Loader2, X, Brain, User, Bot, Sparkles, AlertCircle, MessageCircle, Pencil, Wand2, HelpCircle, BookMarked, Check, XCircle, Paperclip, FileText } from 'lucide-react'
import { MarkdownRenderer } from '@/components/ai/markdown/MarkdownRenderer'
import { useStore } from '@/store'
import type {
  WriterChatMessage, EditSummary, WriterChatAttachment,
  WriterMessageIntent, IntentClarification, SuggestedEdit, ProfileSuggestion,
} from '@/types'
import {
  MentionDropdown,
  detectMention,
  closeMention,
  filterMentionItems,
  type MentionState,
  type MentionItem,
} from '@/components/ai/MentionDropdown'

const SERIF = "'Georgia', 'Noto Serif SC', 'SimSun', serif"
const READABLE_ATTACHMENT_EXTENSIONS = /\.(txt|md|markdown|csv|json|jsonl|log|xml|html|htm|yaml|yml|ts|tsx|js|jsx|py|css|scss|less)$/i
const MAX_ATTACHMENT_CHARS = 24000

function canReadAttachment(file: File): boolean {
  return file.type.startsWith('text/')
    || file.type === 'application/json'
    || file.type === 'application/xml'
    || READABLE_ATTACHMENT_EXTENSIONS.test(file.name)
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsText(file)
  })
}

function formatAttachmentSize(size?: number): string {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

interface Props {
  chatMessages: WriterChatMessage[]
  /** 意图澄清按钮回调 — 用户在 unclear 气泡上点 "聊聊" / "改文" / "首次写作" */
  onIntentClarify?: (clarificationMessageId: string, originalMessage: string, chosen: WriterMessageIntent) => void
  /** "应用此建议" 按钮回调 — 用户在 discuss 气泡下方点 "应用此建议" */
  onApplySuggestedEdit?: (suggestionMessageId: string, suggestion: SuggestedEdit) => void
  /**
   * 风格档案建议 "接受" 回调 — 用户在档案建议卡片上点"接受入档"时触发,
   * 上层应调用 applyProfileSuggestion 真正写入 writerProfile 并把该建议状态置为 accepted.
   */
  onAcceptProfileSuggestion?: (messageId: string, suggestionId: string) => void
  /**
   * 风格档案建议 "忽略" 回调 — 用户不想入档时触发, 上层把该建议状态置为 dismissed (不落库).
   */
  onDismissProfileSuggestion?: (messageId: string, suggestionId: string) => void
  /** 当前文章是否为空 — 空态下 unclear 的选项是 "聊聊" vs "写一篇", 非空态下是 "聊聊" vs "改文" */
  documentEmpty?: boolean
}

export function WriterChatPanel({
  chatMessages,
  onIntentClarify, onApplySuggestedEdit,
  onAcceptProfileSuggestion, onDismissProfileSuggestion,
  documentEmpty = false,
}: Props) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-white via-[#fbfaf7] to-stone-50/80">
      {/* 对话头部 (品牌对齐: 双层标题 SMALL CAPS + serif) */}
      <div className="px-4 py-3 border-b border-stone-200/80 flex items-center gap-2 flex-shrink-0 bg-white/85 backdrop-blur-sm">
        <span className="text-[10px] font-black text-amber-700/80 uppercase tracking-[0.24em]">
          Conversation
        </span>
        <span className="w-px h-3 bg-amber-200/60 mx-0.5" aria-hidden />
        <h3 className="text-sm font-semibold text-stone-700" style={{ fontFamily: SERIF }}>
          对话
        </h3>
        <span className="ml-auto text-[11px] text-stone-400 font-mono">
          {chatMessages.length}
        </span>
      </div>

      {/* 消息列表 (完整高度滚动区) */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
        {chatMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full px-6">
            <div className="text-center space-y-3 max-w-xs">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-amber-50 to-amber-100/60 border border-amber-200/60 mb-1">
                <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.24 4.76a2.5 2.5 0 00-3.54 0L5 16.46V19h2.54L19.24 7.3a2.5 2.5 0 000-3.54h1z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 5l4 4" />
                </svg>
              </div>
              <p className="text-[10px] font-black text-amber-700/80 uppercase tracking-[0.24em]">
                Start Writing
              </p>
              <p className="text-base text-stone-700" style={{ fontFamily: SERIF }}>
                输入写作指令开始
              </p>
              <p className="text-xs text-stone-400 italic">
                例如："写一篇关于 AI 教育的分析报告"
              </p>
            </div>
          </div>
        ) : (
          chatMessages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              documentEmpty={documentEmpty}
              onIntentClarify={onIntentClarify}
              onApplySuggestedEdit={onApplySuggestedEdit}
              onAcceptProfileSuggestion={onAcceptProfileSuggestion}
              onDismissProfileSuggestion={onDismissProfileSuggestion}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}

interface WriterInstructionBarProps {
  onSubmit: (message: string, attachments?: WriterChatAttachment[]) => void
  sending?: boolean
}

export function WriterInstructionBar({ onSubmit, sending = false }: WriterInstructionBarProps) {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<WriterChatAttachment[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isComposingRef = useRef(false)

  const [mention, setMention] = useState<MentionState>({
    isOpen: false, query: '', activeCategory: null, activeIndex: 0, mentionStart: -1,
  })

  const openClawSkills = useStore((s) => s.openClawSkills)
  const mentionItems = useMemo<MentionItem[]>(() =>
    openClawSkills
      .filter((s) => s.status === 'active')
      .map((s) => ({
        category: 'skill' as const,
        name: s.name,
        displayName: s.emoji ? `${s.emoji} ${s.name}` : s.name,
        description: s.description || '',
        keywords: s.keywords,
      })),
    [openClawSkills],
  )

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInput(value)
    if (!isComposingRef.current) {
      const cursorPos = e.target.selectionStart ?? value.length
      setMention(detectMention(value, cursorPos))
    }
  }, [])

  const handleMentionSelect = useCallback((item: MentionItem) => {
    const before = input.slice(0, mention.mentionStart)
    const after = input.slice(inputRef.current?.selectionStart ?? input.length)
    setInput(before + after)
    setAttachments((prev) => {
      if (prev.some((a) => a.name === item.name)) return prev
      return [...prev, { type: 'skill', name: item.name }]
    })
    setMention(closeMention())
    inputRef.current?.focus()
  }, [input, mention.mentionStart])

  const removeAttachment = useCallback((name: string) => {
    setAttachments((prev) => prev.filter((a) => a.name !== name))
  }, [])

  const handleFilesSelected = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const nextAttachments: WriterChatAttachment[] = []

    for (const file of Array.from(files)) {
      if (!canReadAttachment(file)) {
        nextAttachments.push({
          type: 'file',
          name: file.name,
          mimeType: file.type,
          size: file.size,
          error: '暂不支持读取此类型，只会把文件名作为上下文',
        })
        continue
      }

      try {
        const raw = await readFileAsText(file)
        const clipped = raw.length > MAX_ATTACHMENT_CHARS
        nextAttachments.push({
          type: 'file',
          name: file.name,
          mimeType: file.type,
          size: file.size,
          content: clipped
            ? `${raw.slice(0, MAX_ATTACHMENT_CHARS)}\n\n[文件过长，已读取前 ${MAX_ATTACHMENT_CHARS.toLocaleString()} 个字符]`
            : raw,
          error: clipped ? '文件较长，已读取前段内容' : undefined,
        })
      } catch (err) {
        nextAttachments.push({
          type: 'file',
          name: file.name,
          mimeType: file.type,
          size: file.size,
          error: err instanceof Error ? err.message : '读取失败',
        })
      }
    }

    setAttachments((prev) => {
      const withoutSameFiles = prev.filter((item) =>
        item.type !== 'file' || !nextAttachments.some((next) => next.name === item.name),
      )
      return [...withoutSameFiles, ...nextAttachments]
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || sending) return
    const currentAttachments = attachments.length > 0 ? [...attachments] : undefined
    setInput('')
    setAttachments([])
    setMention(closeMention())
    onSubmit(trimmed, currentAttachments)
  }, [input, sending, attachments, onSubmit])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current) return

    if (mention.isOpen) {
      const categoryItems = mention.activeCategory
        ? mentionItems.filter(i => i.category === mention.activeCategory)
        : mentionItems
      const filtered = filterMentionItems(categoryItems, mention.query)

      if (filtered.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setMention((m) => ({ ...m, activeIndex: (m.activeIndex + 1) % filtered.length }))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setMention((m) => ({ ...m, activeIndex: (m.activeIndex - 1 + filtered.length) % filtered.length }))
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          const idx = Math.min(mention.activeIndex, filtered.length - 1)
          if (filtered[idx]) handleMentionSelect(filtered[idx])
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(closeMention())
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="relative z-20 flex-shrink-0 border-t border-stone-200/80 bg-white/88 px-4 py-3 shadow-[0_-10px_30px_rgba(28,25,23,0.06)] backdrop-blur-xl">
      <div className="relative mx-auto max-w-[1180px]">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((att) => (
              <span
                key={`${att.type}-${att.name}`}
                className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                  att.type === 'file'
                    ? 'border-stone-200 bg-white text-stone-700'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
                title={att.type === 'file'
                  ? `${att.name}${att.size ? ` · ${formatAttachmentSize(att.size)}` : ''}${att.error ? ` · ${att.error}` : ''}`
                  : `@${att.name}`}
              >
                {att.type === 'file' ? <FileText className="h-3 w-3" /> : null}
                {att.type === 'skill' ? `@${att.name}` : att.name}
                {att.type === 'file' && att.size ? (
                  <span className="text-stone-400">{formatAttachmentSize(att.size)}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeAttachment(att.name)}
                  className="rounded p-0.5 text-stone-400 hover:bg-white hover:text-red-500"
                  title="移除"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-3 rounded-xl border border-stone-200 bg-[#fffdf8] p-2.5 shadow-[0_8px_28px_rgba(120,53,15,0.08)] transition-all focus-within:border-amber-300 focus-within:ring-2 focus-within:ring-amber-100">
          <div className="hidden min-w-[96px] flex-col px-2 pb-1 sm:flex">
            <span className="text-[9px] font-black uppercase tracking-[0.22em] text-amber-700/70">
              Command
            </span>
            <span className="mt-0.5 text-xs font-semibold text-stone-700" style={{ fontFamily: SERIF }}>
              写作指令
            </span>
          </div>
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { isComposingRef.current = true }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false
              const cursorPos = (e.target as HTMLTextAreaElement).selectionStart ?? input.length
              setMention(detectMention((e.target as HTMLTextAreaElement).value, cursorPos))
            }}
            rows={2}
            placeholder="输入写作指令...（@技能名 添加写作约束）"
            className="max-h-32 min-h-[48px] flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-relaxed text-stone-800 outline-none placeholder:text-stone-400"
            disabled={sending}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFilesSelected(e.currentTarget.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-500 transition-colors hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
            title="添加附件"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!input.trim() || sending}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
            title="发送"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>

        <MentionDropdown
          isOpen={mention.isOpen}
          query={mention.query}
          activeCategory={mention.activeCategory}
          items={mentionItems}
          activeIndex={mention.activeIndex}
          onSelect={handleMentionSelect}
          onActiveIndexChange={(idx) => setMention((m) => ({ ...m, activeIndex: idx }))}
        />
      </div>
    </div>
  )
}

/**
 * 消息气泡组件
 */
interface MessageBubbleProps {
  message: WriterChatMessage
  documentEmpty?: boolean
  onIntentClarify?: (clarificationMessageId: string, originalMessage: string, chosen: WriterMessageIntent) => void
  onApplySuggestedEdit?: (suggestionMessageId: string, suggestion: SuggestedEdit) => void
  onAcceptProfileSuggestion?: (messageId: string, suggestionId: string) => void
  onDismissProfileSuggestion?: (messageId: string, suggestionId: string) => void
}

function MessageBubble({
  message, documentEmpty = false, onIntentClarify, onApplySuggestedEdit,
  onAcceptProfileSuggestion, onDismissProfileSuggestion,
}: MessageBubbleProps) {
  if (message.role === 'thinking') {
    return <ThinkingBubble message={message} />
  }

  if (message.role === 'user') {
    return (
      <div className="flex items-start gap-2 justify-end">
        <div className="max-w-[92%] px-3 py-2 bg-amber-500 text-white rounded-2xl rounded-tr-md shadow-sm">
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.content}</p>
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-amber-400/30">
              {message.attachments.map((att) => (
                <span key={`${att.type}-${att.name}`} className="inline-flex items-center gap-1 text-[10px] bg-amber-400/30 px-1.5 py-0.5 rounded-full">
                  {att.type === 'file' ? <FileText className="h-2.5 w-2.5" /> : null}
                  {att.type === 'skill' ? `@${att.name}` : att.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center flex-shrink-0 mt-0.5">
          <User className="w-3.5 h-3.5 text-stone-500" />
        </div>
      </div>
    )
  }

  // assistant
  return (
    <div className="flex items-start gap-2">
      <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Bot className="w-3.5 h-3.5 text-emerald-600" />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {message.content && (
          <div className="px-3 py-2 bg-white border border-stone-200 rounded-2xl rounded-tl-md shadow-sm">
            {message.streaming ? (
              <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap break-words animate-pulse">
                {message.content}
                <span className="inline-block w-1.5 h-4 bg-amber-500 ml-0.5 animate-pulse rounded-sm" />
              </p>
            ) : (
              <MarkdownRenderer
                content={message.content}
                className="text-sm text-stone-700 leading-relaxed break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              />
            )}
          </div>
        )}
        {/* 意图澄清快捷按钮 (unclear 场景) */}
        {message.intentClarification && onIntentClarify && (
          <IntentClarifyBar
            messageId={message.id}
            clarification={message.intentClarification}
            documentEmpty={documentEmpty}
            onChoose={onIntentClarify}
          />
        )}
        {/* 变更摘要卡片 (edit 完成后) */}
        {message.editSummary && <EditSummaryCard summary={message.editSummary} />}
        {/* "应用此建议" 按钮 (discuss 完成后, 如果 AI 附带了 suggestedEdit) */}
        {message.suggestedEdit && onApplySuggestedEdit && (
          <SuggestedEditCard
            messageId={message.id}
            suggestion={message.suggestedEdit}
            onApply={onApplySuggestedEdit}
          />
        )}
        {/* 风格档案待确认建议 (LLM 在 tool loop 中提议入档时渲染) */}
        {message.profileSuggestions && message.profileSuggestions.length > 0
          && onAcceptProfileSuggestion && onDismissProfileSuggestion && (
          <ProfileSuggestionsCard
            messageId={message.id}
            suggestions={message.profileSuggestions}
            onAccept={onAcceptProfileSuggestion}
            onDismiss={onDismissProfileSuggestion}
          />
        )}
      </div>
    </div>
  )
}

/**
 * 风格档案建议卡片 — LLM 在 tool loop 中通过 append_to_memory 提议把某条内容
 * 加到"偏好清单"或"避免清单"时, 把这些建议呈现给用户, 点"接受入档"才真正写入
 * writerProfile (localStorage).
 *
 * 为什么要这样改 (Phase 5): 此前 LLM 调 append_to_memory 直接落库, 用户无感知,
 * 档案里会堆积一些陈旧或不准确的偏好, 后续生成出问题还溯源不到. 改为确认制后,
 * 档案积累过程完全可见可控.
 */
function ProfileSuggestionsCard({
  messageId, suggestions, onAccept, onDismiss,
}: {
  messageId: string
  suggestions: ProfileSuggestion[]
  onAccept: (messageId: string, suggestionId: string) => void
  onDismiss: (messageId: string, suggestionId: string) => void
}) {
  return (
    <div className="border border-violet-200/70 bg-gradient-to-br from-violet-50/60 to-purple-50/40 rounded-xl overflow-hidden shadow-sm">
      <div className="px-3 py-2 flex items-start gap-2 border-b border-violet-100/80">
        <BookMarked className="w-3.5 h-3.5 text-violet-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold text-violet-700 uppercase tracking-wider mb-0.5">
            想把这些记入写作档案吗?
          </div>
          <p className="text-xs text-stone-600 leading-snug">
            我注意到你对写作有一些偏好, 但不想默默记下来. 你来决定哪些值得长期保留:
          </p>
        </div>
      </div>
      <div className="px-3 py-2 space-y-2">
        {suggestions.map((s) => (
          <ProfileSuggestionRow
            key={s.id}
            suggestion={s}
            onAccept={() => onAccept(messageId, s.id)}
            onDismiss={() => onDismiss(messageId, s.id)}
          />
        ))}
      </div>
    </div>
  )
}

function ProfileSuggestionRow({
  suggestion, onAccept, onDismiss,
}: {
  suggestion: ProfileSuggestion
  onAccept: () => void
  onDismiss: () => void
}) {
  const status = suggestion.status || 'pending'
  const isAvoid = suggestion.kind === 'avoid'
  const kindLabel = isAvoid ? '避免' : categoryLabelCN(suggestion.category)
  const kindBadgeCls = isAvoid
    ? 'text-red-700 bg-red-50 border-red-200'
    : 'text-violet-700 bg-violet-50 border-violet-200'

  return (
    <div className="bg-white/70 border border-violet-100 rounded-md p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${kindBadgeCls}`}>
          {kindLabel}
        </span>
        {status === 'accepted' && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600">
            <Check className="w-2.5 h-2.5" /> 已入档
          </span>
        )}
        {status === 'dismissed' && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-stone-400">
            <XCircle className="w-2.5 h-2.5" /> 已忽略
          </span>
        )}
      </div>
      <p className="text-xs text-stone-700 leading-relaxed">{suggestion.content}</p>
      {suggestion.reason && (
        <p className="text-[11px] text-stone-400 leading-relaxed italic">{suggestion.reason}</p>
      )}
      {status === 'pending' && (
        <div className="flex gap-2 pt-0.5">
          <button
            onClick={onAccept}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium text-white bg-violet-500 hover:bg-violet-600 rounded-md transition-colors"
          >
            <Check className="w-3 h-3" />
            接受入档
          </button>
          <button
            onClick={onDismiss}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 rounded-md transition-colors"
          >
            <XCircle className="w-3 h-3" />
            忽略
          </button>
        </div>
      )}
    </div>
  )
}

/** 把 preference category 翻成短中文徽标 (避免和 prompts.ts 里的 categoryLabel 重名, 用 CN 后缀) */
function categoryLabelCN(cat?: ProfileSuggestion['category']): string {
  switch (cat) {
    case 'structure': return '结构'
    case 'vocabulary': return '词汇'
    case 'citation': return '引用'
    case 'topic': return '话题'
    case 'style':
    default:
      return '风格'
  }
}

/**
 * 意图澄清按钮条 — 分类器给出 unclear 时, 让用户用一键按钮明确意图.
 */
function IntentClarifyBar({
  messageId, clarification, documentEmpty, onChoose,
}: {
  messageId: string
  clarification: IntentClarification
  documentEmpty: boolean
  onChoose: (clarificationMessageId: string, originalMessage: string, chosen: WriterMessageIntent) => void
}) {
  const resolved = clarification.resolved === true

  return (
    <div className="border border-sky-200/70 bg-gradient-to-br from-sky-50/60 to-blue-50/40 rounded-xl overflow-hidden shadow-sm">
      <div className="px-3 py-2 flex items-start gap-2 border-b border-sky-100/80">
        <HelpCircle className="w-3.5 h-3.5 text-sky-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold text-sky-700 uppercase tracking-wider mb-0.5">
            请确认
          </div>
          <p className="text-xs text-stone-600 leading-snug">
            {resolved ? '你已选择了处理方式' : '点一下按钮告诉我该怎么处理:'}
          </p>
        </div>
      </div>
      <div className="px-3 py-2 flex flex-wrap gap-2">
        <button
          disabled={resolved}
          onClick={() => onChoose(messageId, clarification.originalMessage, 'discuss')}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-sky-700 bg-white border border-sky-200 rounded-full hover:bg-sky-100/50 hover:border-sky-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <MessageCircle className="w-3 h-3" />
          聊聊这段内容
        </button>
        {documentEmpty ? (
          <button
            disabled={resolved}
            onClick={() => onChoose(messageId, clarification.originalMessage, 'write')}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-amber-700 bg-white border border-amber-200 rounded-full hover:bg-amber-100/50 hover:border-amber-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Wand2 className="w-3 h-3" />
            直接写一篇
          </button>
        ) : (
          <button
            disabled={resolved}
            onClick={() => onChoose(messageId, clarification.originalMessage, 'edit')}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-amber-700 bg-white border border-amber-200 rounded-full hover:bg-amber-100/50 hover:border-amber-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Pencil className="w-3 h-3" />
            帮我改文章
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * 建议修改卡片 — discuss 模式 AI 给出 suggestedEdit 时, 提供 "应用此建议" 一键转 edit.
 */
function SuggestedEditCard({
  messageId, suggestion, onApply,
}: {
  messageId: string
  suggestion: SuggestedEdit
  onApply: (suggestionMessageId: string, suggestion: SuggestedEdit) => void
}) {
  const applied = suggestion.applied === true

  return (
    <div className="border border-emerald-200/70 bg-gradient-to-br from-emerald-50/60 to-teal-50/40 rounded-xl overflow-hidden shadow-sm">
      <div className="px-3 py-2 flex items-start gap-2">
        <Sparkles className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mb-0.5">
            建议修改
          </div>
          <p className="text-sm text-stone-800 leading-snug">{suggestion.summary}</p>
          <p className="text-[11px] text-stone-500 mt-1 leading-relaxed">
            <span className="text-stone-400">指令: </span>{suggestion.instruction}
          </p>
        </div>
      </div>
      <div className="px-3 pb-2">
        <button
          disabled={applied}
          onClick={() => onApply(messageId, suggestion)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Wand2 className="w-3 h-3" />
          {applied ? '已应用' : '应用此建议并改文'}
        </button>
      </div>
    </div>
  )
}

/**
 * 变更摘要卡片 — 展示 AI 对一次修改的结构化反馈
 */
function EditSummaryCard({ summary }: { summary: EditSummary }) {
  const [expanded, setExpanded] = useState(true)
  const hasChanges = summary.changes && summary.changes.length > 0
  const hasSkipped = summary.skipped && summary.skipped.length > 0

  const delta = summary.wordCountDelta
  const deltaText = delta
    ? (() => {
        const diff = delta[1] - delta[0]
        const sign = diff > 0 ? '+' : ''
        return `${delta[0]} → ${delta[1]} 字 (${sign}${diff})`
      })()
    : null

  return (
    <div className="border border-amber-200/80 bg-gradient-to-br from-amber-50/60 to-orange-50/40 rounded-xl overflow-hidden shadow-sm">
      {/* 头部: summary + 折叠按钮 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-start gap-2 hover:bg-amber-100/30 transition-colors text-left"
      >
        <Sparkles className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-0.5">
            变更反馈
          </div>
          <p className="text-sm text-stone-800 leading-snug">
            {summary.summary}
          </p>
          {deltaText && (
            <p className="text-[10px] text-stone-500 mt-0.5">{deltaText}</p>
          )}
        </div>
        <span className="text-[10px] text-stone-400 mt-1">
          {expanded ? '收起' : `${summary.changes.length} 处`}
        </span>
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-amber-200/60">
          {hasChanges && summary.changes.map((change, i) => (
            <div key={i} className="bg-white/70 border border-amber-100 rounded-md p-2 space-y-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center text-[10px] font-mono font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                  {change.where}
                </span>
              </div>
              <p className="text-xs text-stone-700 leading-relaxed">
                <span className="text-stone-400">改动:</span> {change.what}
              </p>
              {change.why && (
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  <span className="text-stone-400">理由:</span> {change.why}
                </p>
              )}
            </div>
          ))}

          {hasSkipped && (
            <div className="bg-red-50/60 border border-red-200/60 rounded-md p-2">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertCircle className="w-3 h-3 text-red-500" />
                <span className="text-[10px] font-semibold text-red-600 uppercase tracking-wider">
                  未执行
                </span>
              </div>
              <ul className="text-[11px] text-stone-600 space-y-0.5 pl-4 list-disc">
                {summary.skipped!.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 思考气泡 — 支持折叠/展开 + 流式自动滚动
 * 因为推理内容可能很长 (DeepSeek-Reasoner 经常数百字), 需要:
 * - 流式中: 固定最大高度 + 内部滚动 + 自动滚到底部
 * - 非流式: 默认折叠, 点击展开查看完整推理
 */
function ThinkingBubble({ message }: { message: WriterChatMessage }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // 流式时自动滚到底部
  useEffect(() => {
    if (message.streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [message.content, message.streaming])

  return (
    <div className="flex items-start gap-2">
      <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Brain className={`w-3.5 h-3.5 text-amber-600 ${message.streaming ? 'animate-pulse' : ''}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] font-medium text-amber-600 uppercase tracking-wider">
            {message.thinkingLabel || '思考中'}
          </span>
          {message.streaming && (
            <span className="text-[10px] text-amber-500 animate-pulse">● 流式</span>
          )}
        </div>
        <div
          ref={scrollRef}
          className={`
            text-xs text-stone-500 leading-relaxed whitespace-pre-wrap break-words
            pl-3 border-l-2 border-amber-200 bg-amber-50/30 rounded-r-md py-1.5 pr-2
            transition-all
          `}
        >
          {message.content}
          {message.streaming && (
            <span className="inline-block w-1 h-3 bg-amber-400 ml-0.5 animate-pulse rounded-sm" />
          )}
        </div>
      </div>
    </div>
  )
}
