import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  MessageSquare, X, Send, Trash2, Square, Sparkles, Loader2, Zap,
  Image, Paperclip, Puzzle, Server
} from 'lucide-react'
import { useStore } from '@/store'
import { isLLMConfigured } from '@/services/llmService'
import { getQuickCommands } from '@/services/contextBuilder'
import { ChatMessage, StreamingMessage } from './ChatMessage'
import { ChatErrorBoundary } from './ChatErrorBoundary'
import { useT } from '@/i18n'

export function AIChatPanel() {
  const t = useT()
  const isOpen = useStore((s) => s.isChatOpen)
  const setIsOpen = useStore((s) => s.setChatOpen)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Array<{ type: string; name: string; data?: string }>>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const currentView = useStore((s) => s.currentView)
  const chatMessages = useStore((s) => s.chatMessages)
  const chatStreaming = useStore((s) => s.chatStreaming)
  const chatStreamContent = useStore((s) => s.chatStreamContent)
  const chatError = useStore((s) => s.chatError)
  const sendChat = useStore((s) => s.sendChat)
  const clearChat = useStore((s) => s.clearChat)
  const abortChat = useStore((s) => s.abortChat)
  const agentStatus = useStore((s) => s.agentStatus)

  const configured = isLLMConfigured()
  const quickCommands = getQuickCommands(currentView)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatStreamContent])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 300)
    }
  }, [isOpen])

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
    }
  }, [input])

  const handleSend = () => {
    const msg = input.trim()
    if ((!msg && attachments.length === 0) || chatStreaming) return
    
    let fullMessage = msg
    if (attachments.length > 0) {
      const attachmentInfo = attachments.map(a => `[附件: ${a.type}/${a.name}]`).join(' ')
      fullMessage = fullMessage ? `${fullMessage}\n\n${attachmentInfo}` : attachmentInfo
    }
    
    setInput('')
    setAttachments([])
    sendChat(fullMessage, currentView)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = () => {
          setAttachments(prev => [...prev, {
            type: 'image',
            name: file.name,
            data: reader.result as string
          }])
        }
        reader.readAsDataURL(file)
      }
    })
    e.target.value = ''
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    
    Array.from(files).forEach(file => {
      setAttachments(prev => [...prev, {
        type: 'file',
        name: file.name
      }])
    })
    e.target.value = ''
  }

  const handleAddSkill = () => {
    const skillName = prompt('Skill name:')
    if (skillName?.trim()) {
      setAttachments(prev => [...prev, {
        type: 'skill',
        name: skillName.trim()
      }])
    }
  }

  const handleAddMCP = () => {
    const mcpServer = prompt('MCP server:')
    if (mcpServer?.trim()) {
      setAttachments(prev => [...prev, {
        type: 'mcp',
        name: mcpServer.trim()
      }])
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
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
            className="fixed right-6 bottom-28 z-[45] w-12 h-12 rounded-full 
                       bg-skin-accent-amber/20 border border-skin-accent-amber/30 
                       flex items-center justify-center
                       hover:bg-skin-accent-amber/30 transition-colors
                       shadow-[0_0_20px_rgba(245,158,11,0.15)]"
          >
            <MessageSquare className="w-5 h-5 text-skin-accent-amber" />
            {chatMessages.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-skin-accent-amber 
                             text-[12px] text-skin-bg-primary flex items-center justify-center font-bold">
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
            initial={{ width: 0 }}
            animate={{ width: 488 }}
            exit={{ width: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="h-full shrink-0 overflow-hidden"
          >
            <div className="w-[480px] h-full py-3 pr-3 pl-2 box-border">
              <div
                className="w-full h-full bg-skin-bg-primary/95 backdrop-blur-xl border border-skin-border/10 rounded-2xl
                           flex flex-col overflow-hidden
                           shadow-[0_0_40px_rgba(0,0,0,0.5)]"
              >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-skin-border/10">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-skin-accent-amber" />
                <span className="text-sm font-mono text-skin-accent-amber">AI</span>
                <span className="text-[13px] font-mono text-skin-text-tertiary px-1.5 py-0.5 bg-skin-bg-secondary/30 rounded">
                  {currentView}
                </span>
                {agentStatus === 'thinking' && (
                  <span className="text-[13px] font-mono text-skin-accent-cyan animate-pulse flex items-center gap-1 ml-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> {t('task.agent_thinking')}
                  </span>
                )}
                {agentStatus === 'executing' && (
                  <span className="text-[13px] font-mono text-skin-accent-amber animate-pulse flex items-center gap-1 ml-1">
                    <Zap className="w-3 h-3" /> {t('task.agent_executing')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={clearChat}
                  className="p-1.5 text-skin-text-tertiary hover:text-red-400 transition-colors"
                  title={t('chat.clear')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 text-skin-text-tertiary hover:text-skin-text-secondary transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <ChatErrorBoundary onReset={clearChat}>
              {!configured ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Sparkles className="w-10 h-10 text-skin-accent-amber/30 mb-3" />
                  <p className="text-sm font-mono text-skin-text-tertiary mb-2">{t('chat.not_configured')}</p>
                  <p className="text-xs font-mono text-skin-text-tertiary/60">
                    {t('chat.configure_prompt')}
                  </p>
                </div>
              ) : chatMessages.length === 0 && !chatStreaming ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <MessageSquare className="w-10 h-10 text-skin-text-primary/10 mb-3" />
                  <p className="text-sm font-mono text-skin-text-tertiary mb-4">
                    {t('chat.input_placeholder')}
                  </p>
                  {quickCommands.length > 0 && (
                    <div className="flex flex-wrap gap-2 justify-center">
                      {quickCommands.map((cmd) => (
                        <button
                          key={cmd.label}
                          onClick={() => handleQuickCommand(cmd.prompt)}
                          className="px-3 py-1.5 text-xs font-mono bg-skin-bg-secondary/30 border border-skin-border/10 
                                     rounded-lg text-skin-text-secondary hover:text-skin-accent-amber hover:border-skin-accent-amber/30 
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
              </ChatErrorBoundary>
            </div>

            {/* Quick Commands Bar */}
            {configured && chatMessages.length > 0 && quickCommands.length > 0 && (
              <div className="px-3 py-2 border-t border-skin-border/5 flex gap-1.5 overflow-x-auto">
                {quickCommands.map((cmd) => (
                  <button
                    key={cmd.label}
                    onClick={() => handleQuickCommand(cmd.prompt)}
                    disabled={chatStreaming}
                    className="flex-shrink-0 px-2 py-1 text-[13px] font-mono bg-skin-bg-secondary/30 border border-skin-border/10 
                               rounded text-skin-text-tertiary hover:text-skin-accent-amber hover:border-skin-accent-amber/30 
                               transition-colors disabled:opacity-50"
                  >
                    {cmd.label}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            {configured && (
              <div className="px-3 py-3 border-t border-skin-border/10">
                {/* 附件预览 */}
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {attachments.map((att, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-1 px-2 py-1 bg-skin-bg-secondary/30 border border-skin-border/10 
                                   rounded text-[13px] font-mono text-skin-text-secondary"
                      >
                        {att.type === 'image' && <Image className="w-3 h-3 text-skin-accent-emerald" />}
                        {att.type === 'file' && <Paperclip className="w-3 h-3 text-skin-accent-cyan" />}
                        {att.type === 'skill' && <Puzzle className="w-3 h-3 text-skin-accent-amber" />}
                        {att.type === 'mcp' && <Server className="w-3 h-3 text-skin-accent-purple" />}
                        <span className="max-w-[100px] truncate">{att.name}</span>
                        <button
                          onClick={() => removeAttachment(idx)}
                          className="text-skin-text-tertiary hover:text-red-400 ml-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* 上传按钮行 */}
                <div className="flex items-center gap-1 mb-2">
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    disabled={chatStreaming}
                    className="p-1.5 text-skin-text-tertiary hover:text-skin-accent-emerald hover:bg-skin-bg-secondary/30 
                               rounded transition-colors disabled:opacity-50"
                    title="Image"
                  >
                    <Image className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={chatStreaming}
                    className="p-1.5 text-skin-text-tertiary hover:text-skin-accent-cyan hover:bg-skin-bg-secondary/30 
                               rounded transition-colors disabled:opacity-50"
                    title="File"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleAddSkill}
                    disabled={chatStreaming}
                    className="p-1.5 text-skin-text-tertiary hover:text-skin-accent-amber hover:bg-skin-bg-secondary/30 
                               rounded transition-colors disabled:opacity-50"
                    title="SKILL"
                  >
                    <Puzzle className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleAddMCP}
                    disabled={chatStreaming}
                    className="p-1.5 text-skin-text-tertiary hover:text-skin-accent-purple hover:bg-skin-bg-secondary/30 
                               rounded transition-colors disabled:opacity-50"
                    title="MCP"
                  >
                    <Server className="w-4 h-4" />
                  </button>
                  <span className="text-[12px] font-mono text-skin-text-tertiary/60 ml-auto">
                    Shift+Enter
                  </span>
                </div>
                
                {/* 输入框 + 发送按钮 */}
                <div className="flex gap-2">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('chat.input_placeholder')}
                    disabled={chatStreaming}
                    rows={1}
                    className="flex-1 px-3 py-2 bg-skin-bg-secondary/30 border border-skin-border/10 rounded-lg 
                               text-sm font-mono text-skin-text-secondary placeholder-skin-text-tertiary
                               focus:border-skin-accent-amber/40 focus:outline-none
                               disabled:opacity-50 resize-none min-h-[40px] max-h-[120px]"
                  />
                  {chatStreaming ? (
                    <button
                      onClick={abortChat}
                      className="px-3 py-2 bg-red-500/20 border border-red-500/30 rounded-lg 
                                 text-red-400 hover:bg-red-500/30 transition-colors self-end"
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={!input.trim() && attachments.length === 0}
                      className="px-3 py-2 bg-skin-accent-amber/20 border border-skin-accent-amber/30 rounded-lg 
                                 text-skin-accent-amber hover:bg-skin-accent-amber/30 transition-colors self-end
                                 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
