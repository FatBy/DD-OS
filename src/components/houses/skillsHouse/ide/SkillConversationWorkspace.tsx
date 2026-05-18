/**
 * SkillConversationWorkspace - 对话式工作区 (中间面板)
 *
 * 替代旧的 SkillWorkspace，核心交互区域:
 * - 顶部: 技能名 + 保存按钮 + 预览面板切换
 * - 中间: 聊天消息列表 (含流式输出)
 * - 底部: 输入区 (Enter发送, Shift+Enter换行)
 *
 * DunCrew 暖色治愈风格
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Send, Square, Eye, EyeOff, Save, AlertTriangle } from 'lucide-react'
import { useStore } from '@/store'
import { SkillChatBubble } from './SkillChatBubble'
import { MarkdownRenderer } from '@/components/ai/markdown/MarkdownRenderer'

export function SkillConversationWorkspace() {
  const activeSkillName = useStore((s) => s.activeSkillName)
  const activeSkillDirty = useStore((s) => s.activeSkillDirty)
  const activeSkillTruncated = useStore((s) => s.activeSkillTruncated)
  const activeSkillConvId = useStore((s) => s.activeSkillConvId)
  const skillConversations = useStore((s) => s.skillConversations)
  const skillChatStreaming = useStore((s) => s.skillChatStreaming)
  const skillChatStreamContent = useStore((s) => s.skillChatStreamContent)
  const skillChatReasoningContent = useStore((s) => s.skillChatReasoningContent)
  const temperatureMode = useStore((s) => s.temperatureMode)
  const previewPanelOpen = useStore((s) => s.previewPanelOpen)
  const sendSkillChat = useStore((s) => s.sendSkillChat)
  const cancelSkillChat = useStore((s) => s.cancelSkillChat)
  const saveSkill = useStore((s) => s.saveSkill)
  const setPreviewPanelOpen = useStore((s) => s.setPreviewPanelOpen)
  const acceptDiffBlock = useStore((s) => s.acceptDiffBlock)
  const rejectDiffBlock = useStore((s) => s.rejectDiffBlock)
  const acceptAllDiffs = useStore((s) => s.acceptAllDiffs)

  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 当前会话
  const conversation = activeSkillConvId
    ? skillConversations.get(activeSkillConvId)
    : null
  const messages = conversation?.messages ?? []

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, skillChatStreamContent, skillChatReasoningContent])

  // Ctrl+S 快捷键
  const handleGlobalKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (activeSkillTruncated) return
        saveSkill()
      }
    },
    [saveSkill, activeSkillTruncated],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [handleGlobalKeyDown])

  // 发送消息
  const handleSend = () => {
    if (!input.trim() || skillChatStreaming || activeSkillTruncated) return
    sendSkillChat(input.trim())
    setInput('')
    // 重置 textarea 高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  // 键盘事件: Enter 发送, Shift+Enter 换行, Escape 取消
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape' && skillChatStreaming) {
      cancelSkillChat()
    }
  }

  // Textarea 自动增高
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  // Empty state: 没有打开技能
  if (!activeSkillName) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-white/40 backdrop-blur-xl rounded-[24px] border border-stone-200/40">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-stone-100/80 flex items-center justify-center">
            <span className="text-3xl">{'\u{1F4AC}'}</span>
          </div>
          <div className="text-sm font-bold text-stone-500 mb-1">No skill open</div>
          <div className="text-xs text-stone-400 max-w-[220px]">
            Select a skill from the explorer to start a conversation
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white/95 backdrop-blur-3xl rounded-[24px] border border-white/80 shadow-[0_20px_60px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* ---- Header ---- */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2.5 border-b border-stone-100">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-xs font-bold text-stone-700 truncate max-w-[200px]">
            {activeSkillName}
          </span>
          {activeSkillDirty && (
            <span className="w-2 h-2 rounded-full bg-[#e8a838] shrink-0" title="Unsaved changes" />
          )}
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              temperatureMode === 'production' ? 'bg-[#5ebab0]' : 'bg-[#e8a838]'
            }`}
            title={temperatureMode === 'production' ? 'T=0 Precise' : 'T=0.3 Creative'}
          />
        </div>

        <button
          onClick={() => saveSkill()}
          disabled={!activeSkillDirty || activeSkillTruncated}
          className="p-1.5 text-stone-400 hover:text-[#5ebab0] disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-lg hover:bg-stone-50"
          title={activeSkillTruncated ? '内容已被截断，保存已禁用' : 'Save (Ctrl+S)'}
        >
          <Save className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setPreviewPanelOpen(!previewPanelOpen)}
          className={`p-1.5 rounded-lg transition-colors ${
            previewPanelOpen
              ? 'text-[#5ebab0] bg-[#5ebab0]/10'
              : 'text-stone-400 hover:text-[#5ebab0] hover:bg-stone-50'
          }`}
          title="Toggle Preview"
        >
          {previewPanelOpen ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* ---- Truncation banner ---- */}
      {activeSkillTruncated && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-[#dc7864]/10 border-b border-[#dc7864]/30 text-[12px] text-[#a8523f]">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div className="flex-1 leading-relaxed">
            <span className="font-bold">内容可能不完整</span>
            ：此 skill 超过 10000 字符，后端 <code className="px-1 py-0.5 bg-white/60 rounded text-[11px]">/raw</code> 路由仅返回前 10000 字。为避免覆盖丢失尾部，
            <span className="font-bold">保存与对话已禁用</span>
            。修复需后端补 <code className="px-1 py-0.5 bg-white/60 rounded text-[11px]">/skills/:name/content</code> 路由（见三合一方案技术债 #3）。
          </div>
        </div>
      )}

      {/* ---- Message list ---- */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-0.5 scrollbar-thin scrollbar-thumb-stone-200">
        {messages.map((msg) => (
          <SkillChatBubble
            key={msg.id}
            message={msg}
            onAcceptDiff={(diffBlockId) => acceptDiffBlock(msg.id, diffBlockId)}
            onRejectDiff={(diffBlockId) => rejectDiffBlock(msg.id, diffBlockId)}
            onAcceptAll={() => acceptAllDiffs(msg.id)}
          />
        ))}

        {/* Streaming indicator */}
        {skillChatStreaming && (
          <div className="flex justify-start gap-2 py-1.5">
            <div className="max-w-[90%] min-w-[200px] px-3.5 py-2.5 bg-stone-50 border border-stone-100 text-stone-700 rounded-2xl rounded-tl-sm">
              {/* Reasoning / thinking 实时流 */}
              {skillChatReasoningContent && (
                <div className="mb-2 px-3 py-2 bg-amber-50/80 border border-amber-200/40 rounded-xl">
                  <div className="flex items-center gap-1.5 mb-1">
                    <motion.span
                      animate={{ opacity: [1, 0.4, 1] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                      className="w-1.5 h-1.5 rounded-full bg-[#e8a838]"
                    />
                    <span className="text-[11px] font-bold text-amber-600/80">Thinking</span>
                  </div>
                  <div className="text-[12px] leading-relaxed text-stone-500 max-h-[200px] overflow-y-auto scrollbar-thin">
                    <MarkdownRenderer content={skillChatReasoningContent} />
                  </div>
                </div>
              )}

              {/* 主内容流 */}
              {skillChatStreamContent ? (
                <div className="text-[13px] leading-relaxed prose prose-stone prose-sm max-w-none [&_p]:my-1">
                  <MarkdownRenderer content={skillChatStreamContent} />
                </div>
              ) : !skillChatReasoningContent ? (
                <div className="flex items-center gap-2">
                  <motion.span
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="w-2 h-2 rounded-full bg-[#5ebab0]"
                  />
                  <span className="text-xs text-stone-400">Thinking...</span>
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ---- Input area ---- */}
      <div className="px-4 pb-3 pt-2 border-t border-stone-100/60">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={activeSkillTruncated ? '内容被截断，对话已禁用' : 'Describe what you want to change...'}
            disabled={skillChatStreaming || activeSkillTruncated}
            rows={1}
            className="flex-1 min-h-[36px] max-h-[120px] px-3.5 py-2 text-[13px] bg-stone-50/80 border border-stone-200/60 rounded-xl outline-none focus:border-[#5ebab0] focus:ring-1 focus:ring-[#5ebab0]/20 resize-none text-stone-700 placeholder:text-stone-400 transition-colors disabled:opacity-50"
          />
          {skillChatStreaming ? (
            <button
              onClick={cancelSkillChat}
              className="shrink-0 p-2 text-[#dc7864] bg-[#dc7864]/10 border border-[#dc7864]/30 rounded-xl hover:bg-[#dc7864]/15 transition-colors"
              title="Cancel (Esc)"
            >
              <Square className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || activeSkillTruncated}
              className="shrink-0 p-2 text-white bg-[#5ebab0] rounded-xl hover:bg-[#5ebab0]/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shadow-sm"
              title={activeSkillTruncated ? '内容被截断，对话已禁用' : 'Send (Enter)'}
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
