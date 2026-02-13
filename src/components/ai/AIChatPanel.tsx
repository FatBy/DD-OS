import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  MessageSquare, X, Send, Trash2, Square, Sparkles
} from 'lucide-react'
import { useStore } from '@/store'
import { isLLMConfigured } from '@/services/llmService'
import { getQuickCommands } from '@/services/contextBuilder'
import { ChatMessage, StreamingMessage } from './ChatMessage'

export function AIChatPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const currentView = useStore((s) => s.currentView)
  const chatMessages = useStore((s) => s.chatMessages)
  const chatStreaming = useStore((s) => s.chatStreaming)
  const chatStreamContent = useStore((s) => s.chatStreamContent)
  const chatError = useStore((s) => s.chatError)
  const sendChat = useStore((s) => s.sendChat)
  const clearChat = useStore((s) => s.clearChat)
  const abortChat = useStore((s) => s.abortChat)

  const configured = isLLMConfigured()
  const quickCommands = getQuickCommands(currentView)

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatStreamContent])

  // 打开面板时聚焦输入框
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [isOpen])

  const handleSend = () => {
    const msg = input.trim()
    if (!msg || chatStreaming) return
    setInput('')
    sendChat(msg, currentView)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleQuickCommand = (prompt: string) => {
    if (chatStreaming) return
    sendChat(prompt, currentView)
  }

  return (
    <>
      {/* 浮动按钮 */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => setIsOpen(true)}
            className="fixed right-6 bottom-24 z-40 w-12 h-12 rounded-full 
                       bg-amber-500/20 border border-amber-500/30 
                       flex items-center justify-center
                       hover:bg-amber-500/30 transition-colors
                       shadow-[0_0_20px_rgba(245,158,11,0.15)]"
          >
            <MessageSquare className="w-5 h-5 text-amber-400" />
            {chatMessages.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 
                             text-[9px] text-white flex items-center justify-center font-bold">
                {chatMessages.filter(m => m.role !== 'system').length}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* 聊天面板 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 300 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed right-4 bottom-4 top-4 w-[380px] z-50
                       bg-slate-950/95 backdrop-blur-xl border border-white/10 rounded-2xl
                       flex flex-col overflow-hidden
                       shadow-[0_0_40px_rgba(0,0,0,0.5)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-mono text-amber-300">AI 助手</span>
                <span className="text-[10px] font-mono text-white/30 px-1.5 py-0.5 bg-white/5 rounded">
                  {currentView}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={clearChat}
                  className="p-1.5 text-white/30 hover:text-red-400 transition-colors"
                  title="清空对话"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 text-white/30 hover:text-white/60 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {!configured ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Sparkles className="w-10 h-10 text-amber-400/30 mb-3" />
                  <p className="text-sm font-mono text-white/40 mb-2">AI 未配置</p>
                  <p className="text-xs font-mono text-white/25">
                    前往设置页面配置 LLM API Key 和 Base URL
                  </p>
                </div>
              ) : chatMessages.length === 0 && !chatStreaming ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <MessageSquare className="w-10 h-10 text-white/10 mb-3" />
                  <p className="text-sm font-mono text-white/30 mb-4">
                    开始对话或使用快捷指令
                  </p>
                  {/* 快捷指令 */}
                  {quickCommands.length > 0 && (
                    <div className="flex flex-wrap gap-2 justify-center">
                      {quickCommands.map((cmd) => (
                        <button
                          key={cmd.label}
                          onClick={() => handleQuickCommand(cmd.prompt)}
                          className="px-3 py-1.5 text-xs font-mono bg-white/5 border border-white/10 
                                     rounded-lg text-white/50 hover:text-amber-400 hover:border-amber-500/30 
                                     transition-colors"
                        >
                          {cmd.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {chatMessages.filter(m => m.role !== 'system').map((msg) => (
                    <ChatMessage key={msg.id} message={msg} />
                  ))}
                  {chatStreaming && chatStreamContent && (
                    <StreamingMessage content={chatStreamContent} />
                  )}
                  {chatError && (
                    <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs font-mono text-red-400">
                      {chatError}
                    </div>
                  )}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Commands Bar (when in conversation) */}
            {configured && chatMessages.length > 0 && quickCommands.length > 0 && (
              <div className="px-3 py-2 border-t border-white/5 flex gap-1.5 overflow-x-auto">
                {quickCommands.map((cmd) => (
                  <button
                    key={cmd.label}
                    onClick={() => handleQuickCommand(cmd.prompt)}
                    disabled={chatStreaming}
                    className="flex-shrink-0 px-2 py-1 text-[10px] font-mono bg-white/5 border border-white/10 
                               rounded text-white/40 hover:text-amber-400 hover:border-amber-500/30 
                               transition-colors disabled:opacity-50"
                  >
                    {cmd.label}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            {configured && (
              <div className="px-3 py-3 border-t border-white/10">
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="输入消息..."
                    disabled={chatStreaming}
                    className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg 
                               text-xs font-mono text-white/80 placeholder-white/30
                               focus:border-amber-500/40 focus:outline-none
                               disabled:opacity-50"
                  />
                  {chatStreaming ? (
                    <button
                      onClick={abortChat}
                      className="px-3 py-2 bg-red-500/20 border border-red-500/30 rounded-lg 
                                 text-red-400 hover:bg-red-500/30 transition-colors"
                    >
                      <Square className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={!input.trim()}
                      className="px-3 py-2 bg-amber-500/20 border border-amber-500/30 rounded-lg 
                                 text-amber-400 hover:bg-amber-500/30 transition-colors
                                 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
