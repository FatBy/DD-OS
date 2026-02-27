import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence, useDragControls } from 'framer-motion'
import { 
  MessageSquare, X, Send, Trash2, Square, Sparkles, Loader2, Zap,
  Image, Paperclip, Puzzle, Server, Command, GripHorizontal, Wand2,
  PanelLeftClose, PanelLeft, CheckCircle, AlertCircle
} from 'lucide-react'
import { useStore } from '@/store'
import { isLLMConfigured } from '@/services/llmService'
import { getQuickCommands } from '@/services/contextBuilder'
import { ChatMessage, StreamingMessage } from './ChatMessage'
import { ChatErrorBoundary } from './ChatErrorBoundary'
import { AddMCPModal } from './AddMCPModal'
import { AddSkillModal } from './AddSkillModal'
import { CreateNexusModal, NexusInitialData } from '@/components/world/CreateNexusModal'
import { autoInstallSkills } from '@/services/installService'
import { ConversationSidebar } from './ConversationSidebar'
// Quest 模式已禁用
// import { SubagentMonitor } from './SubagentMonitor'
// import { QuestPlanConfirmation } from './QuestPlanConfirmation'
import { useT } from '@/i18n'

export function AIChatPanel() {
  const t = useT()
  const isOpen = useStore((s) => s.isChatOpen)
  const setIsOpen = useStore((s) => s.setChatOpen)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Array<{ type: string; name: string; data?: string; file?: File }>>([])
  const [showMCPModal, setShowMCPModal] = useState(false)
  const [showSkillModal, setShowSkillModal] = useState(false)
  const [showNexusModal, setShowNexusModal] = useState(false)
  const [nexusInitialData, setNexusInitialData] = useState<NexusInitialData | undefined>()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [parsingFiles, setParsingFiles] = useState(false)
  const [parseProgress, setParseProgress] = useState<Array<{ name: string; status: 'uploading' | 'done' | 'error' }>>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const constraintsRef = useRef<HTMLDivElement>(null)
  const dragControls = useDragControls()
  const sendingRef = useRef(false)
  const uploadAbortRef = useRef<AbortController | null>(null)
  
  // 存储后台分析的结果
  const pendingAnalysisResult = useRef<NexusInitialData | null>(null)

  const currentView = useStore((s) => s.currentView)
  // 多会话系统：从当前活动会话获取消息
  const conversations = useStore((s) => s.conversations)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const getCurrentMessages = useStore((s) => s.getCurrentMessages)
  const chatMessages = useMemo(() => getCurrentMessages(), [conversations, activeConversationId, getCurrentMessages])
  const chatStreaming = useStore((s) => s.chatStreaming)
  const chatStreamContent = useStore((s) => s.chatStreamContent)
  const chatError = useStore((s) => s.chatError)
  const sendChat = useStore((s) => s.sendChat)
  const clearChat = useStore((s) => s.clearChat)
  const abortChat = useStore((s) => s.abortChat)
  const agentStatus = useStore((s) => s.agentStatus)
  
  // Observer 观察者 - 负责分析对话
  const analyzeConversationForBuilder = useStore((s) => s.analyzeConversationForBuilder)
  const isObserverAnalyzing = useStore((s) => s.isAnalyzing)
  
  // Toast 通知
  const addToast = useStore((s) => s.addToast)

  const configured = isLLMConfigured()
  const quickCommands = getQuickCommands(currentView)

  // Ctrl/Cmd + K 全局快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(!useStore.getState().isChatOpen)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setIsOpen])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatStreamContent])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        textareaRef.current?.focus()
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
      }, 300)
    }
  }, [isOpen])

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
    }
  }, [input])

  const getServerUrl = () => {
    return localStorage.getItem('ddos_server_url') || 'http://localhost:3001'
  }

  const MAX_UPLOAD_SIZE = 10 * 1024 * 1024 // 10MB，与后端 MAX_FILE_SIZE 一致

  const handleSend = async () => {
    if (sendingRef.current) return
    const msg = input.trim()
    if ((!msg && attachments.length === 0) || chatStreaming || parsingFiles) return
    sendingRef.current = true

    // 需要上传解析的文件/图片附件
    const fileAttachments = attachments.filter(a => a.file && (a.type === 'file' || a.type === 'image'))
    // 其他附件（skill、mcp 等保持原样）
    const otherAttachments = attachments.filter(a => !a.file || (a.type !== 'file' && a.type !== 'image'))

    let fullMessage = msg

    if (fileAttachments.length > 0) {
      setParsingFiles(true)
      setParseProgress(fileAttachments.map(a => ({ name: a.name, status: 'uploading' as const })))
      uploadAbortRef.current = new AbortController()
      try {
        const parsed = await Promise.all(fileAttachments.map(async (att, idx) => {
          const formData = new FormData()
          formData.append('file', att.file!, att.name)
          const res = await fetch(`${getServerUrl()}/api/files/upload`, {
            method: 'POST',
            body: formData,
            signal: uploadAbortRef.current?.signal,
          })
          const result = await res.json()
          if (!res.ok) {
            setParseProgress(prev => prev.map((p, i) => i === idx ? { ...p, status: 'error' } : p))
            return { name: att.name, text: `[解析失败: ${result.error || '未知错误'}]` }
          }
          setParseProgress(prev => prev.map((p, i) => i === idx ? { ...p, status: 'done' } : p))
          return { name: att.name, text: result.parsedText || '[无内容]', filePath: result.filePath || '' }
        }))

        const parsedContent = parsed.map(p => {
          const header = p.filePath ? `📎 ${p.name} (路径: ${p.filePath})` : `📎 ${p.name}`
          return `${header}:\n${p.text}`
        }).join('\n\n---\n\n')
        fullMessage = fullMessage
          ? `${fullMessage}\n\n[附件解析内容]\n${parsedContent}`
          : `[附件解析内容]\n${parsedContent}`
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') {
          addToast({ type: 'info', title: '已取消', message: '文件上传已取消' })
          setParsingFiles(false)
          setParseProgress([])
          uploadAbortRef.current = null
          sendingRef.current = false
          return
        }
        console.error('文件解析失败:', e)
        const fallback = fileAttachments.map(a => `[附件: ${a.type}/${a.name}]`).join(' ')
        fullMessage = fullMessage ? `${fullMessage}\n\n${fallback}` : fallback
      } finally {
        setParsingFiles(false)
        setParseProgress([])
        uploadAbortRef.current = null
      }
    }

    if (otherAttachments.length > 0) {
      const info = otherAttachments.map(a => `[附件: ${a.type}/${a.name}]`).join(' ')
      fullMessage = fullMessage ? `${fullMessage}\n\n${info}` : info
    }

    setInput('')
    setAttachments([])
    sendChat(fullMessage, currentView)
    sendingRef.current = false
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
      if (file.size > MAX_UPLOAD_SIZE) {
        addToast({ type: 'error', title: '文件过大', message: `${file.name} 超过 10MB 限制` })
        return
      }
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = () => {
          setAttachments(prev => [...prev, {
            type: 'image',
            name: file.name,
            data: reader.result as string,
            file,
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
      if (file.size > MAX_UPLOAD_SIZE) {
        addToast({ type: 'error', title: '文件过大', message: `${file.name} 超过 10MB 限制` })
        return
      }
      setAttachments(prev => [...prev, {
        type: 'file',
        name: file.name,
        file,
      }])
    })
    e.target.value = ''
  }

  const handleCancelUpload = () => {
    uploadAbortRef.current?.abort()
  }

  const handleAddSkill = (skillName: string) => {
    setAttachments(prev => [...prev, {
      type: 'skill',
      name: skillName,
    }])
  }

  const handleAddMCP = (serverName: string) => {
    setAttachments(prev => [...prev, {
      type: 'mcp',
      name: serverName,
    }])
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const handleQuickCommand = (prompt: string) => {
    if (chatStreaming) return
    sendChat(prompt, currentView)
  }

  const visibleMsgCount = chatMessages.filter(m => m.role !== 'system').length

  /**
   * 创建 Nexus 处理
   * 流程：Observer（观察者）后台分析对话 → Toast 通知 → Builder（建构者/CreateNexusModal）展示编辑
   */
  const handleCreateNexus = useCallback(async () => {
    // 如果没有对话，直接打开空表单（建构者模式）
    if (chatMessages.length < 2) {
      setNexusInitialData(undefined)
      setShowNexusModal(true)
      return
    }

    // 显示"开始分析"Toast
    addToast({
      type: 'info',
      title: '观察者启动',
      message: '正在分析对话内容，完成后将通知你...',
      duration: 3000,
    })

    // 后台运行分析（不阻塞用户操作）
    const messagesToAnalyze = chatMessages.map(m => ({ role: m.role, content: m.content }))
    
    // 异步分析，使用 Promise 但不 await
    analyzeConversationForBuilder(messagesToAnalyze).then(async (analysisResult) => {
      if (analysisResult) {
        // 自动安装建议技能（非阻塞）
        let installSummary = ''
        if (analysisResult.suggestedSkills && analysisResult.suggestedSkills.length > 0) {
          try {
            addToast({
              type: 'info',
              title: '正在安装技能',
              message: `检测到 ${analysisResult.suggestedSkills.length} 个技能，尝试自动安装...`,
              duration: 5000,
            })
            const installedNames = useStore.getState().skills.map((s: { name?: string; id: string }) => s.name || s.id)
            const results = await autoInstallSkills(analysisResult.suggestedSkills, installedNames)
            const installed = results.filter(r => r.status === 'installed')
            const notFound = results.filter(r => r.status === 'not_found' || r.status === 'failed')
            if (installed.length > 0) {
              installSummary = `，已安装 ${installed.length} 个技能`
              // 刷新前端技能列表
              try {
                const serverUrl = localStorage.getItem('ddos_server_url') || 'http://localhost:3001'
                const res = await fetch(`${serverUrl}/skills`)
                if (res.ok) {
                  const skills = await res.json()
                  useStore.getState().setOpenClawSkills(skills)
                }
              } catch { /* 刷新失败不影响 */ }
            }
            if (notFound.length > 0) {
              installSummary += `，${notFound.length} 个未找到`
            }
          } catch {
            // 安装流程整体失败，不阻塞
            installSummary = '，技能自动安装失败'
          }
        }

        // 存储分析结果
        const resultData: NexusInitialData = {
          name: analysisResult.name,
          description: analysisResult.description,
          sopContent: analysisResult.sopContent,
          suggestedSkills: analysisResult.suggestedSkills,
          tags: analysisResult.tags,
          triggers: analysisResult.triggers,
          objective: analysisResult.objective,
          metrics: analysisResult.metrics,
          strategy: analysisResult.strategy,
          isFromChat: true,
        }
        pendingAnalysisResult.current = resultData
        
        // 显示成功 Toast（可点击打开弹窗）
        addToast({
          type: 'success',
          title: 'Nexus 分析完成',
          message: `已提取「${analysisResult.name}」${installSummary}`,
          duration: 8000,
          onClick: () => {
            // 点击 Toast 时打开 Modal 并填入数据
            setNexusInitialData(pendingAnalysisResult.current || undefined)
            setShowNexusModal(true)
          },
        })
        
        console.log('[Observer → Builder] 后台分析完成:', {
          name: analysisResult.name,
          skillCount: analysisResult.suggestedSkills?.length || 0,
          sopLength: analysisResult.sopContent?.length || 0,
        })
      } else {
        // 分析失败，提示用户手动创建
        addToast({
          type: 'warning',
          title: '分析未能提取有效内容',
          message: '点击手动创建 Nexus',
          duration: 6000,
          onClick: () => {
            setNexusInitialData(undefined)
            setShowNexusModal(true)
          },
        })
        console.log('[Observer → Builder] 分析无结果')
      }
    }).catch((error) => {
      console.error('[Observer] 分析失败:', error)
      addToast({
        type: 'error',
        title: '分析失败',
        message: '点击手动创建 Nexus',
        duration: 6000,
        onClick: () => {
          setNexusInitialData(undefined)
          setShowNexusModal(true)
        },
      })
    })
  }, [chatMessages, analyzeConversationForBuilder, addToast])

  // 关闭 Nexus Modal 时清理状态
  const handleCloseNexusModal = useCallback(() => {
    setShowNexusModal(false)
    setNexusInitialData(undefined)
  }, [])

  return (
    <>
      {/* ====== 底部胶囊触发栏 (面板关闭时显示) ====== */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 left-1/2 z-[45]
                       flex items-center gap-4 px-8 py-4 
                       bg-slate-900/80 backdrop-blur-2xl 
                       border border-white/20 rounded-2xl
                       hover:bg-slate-900/90 hover:border-white/30
                       transition-all cursor-pointer
                       shadow-[0_8px_40px_rgba(0,0,0,0.5)]
                       group"
            style={{ transform: 'translateX(-50%)' }}
          >
            <Sparkles className="w-5 h-5 text-skin-accent-amber group-hover:text-skin-accent-amber/80" />
            <span className="text-base font-mono text-white/60 group-hover:text-white/80 transition-colors">
              {t('chat.input_placeholder')}
            </span>
            <span className="flex items-center gap-1.5 text-xs font-mono text-white/30 border border-white/15 rounded-lg px-2 py-1">
              <Command className="w-3.5 h-3.5" />K
            </span>
            {visibleMsgCount > 0 && (
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-skin-accent-amber/20 text-skin-accent-amber text-xs font-mono font-bold">
                {visibleMsgCount}
              </span>
            )}
            {chatStreaming && (
              <Loader2 className="w-4 h-4 text-skin-accent-cyan animate-spin" />
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* ====== 聊天面板 (居中弹出，固定大小) ====== */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* 背景蒙版 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-[50] bg-black/40 backdrop-blur-sm"
            />
            
            {/* 拖动约束区域 */}
            <div ref={constraintsRef} className="fixed inset-0 z-[51] pointer-events-none" />
            
            {/* 居中对话面板 - 固定大小，可拖动 */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              drag
              dragListener={false}
              dragControls={dragControls}
              dragConstraints={constraintsRef}
              dragElastic={0.05}
              dragMomentum={false}
              className="fixed top-0 bottom-0 left-[70px] right-0 m-auto z-[52]
                         w-[1200px] max-w-[calc(100%-90px)] h-[80vh] max-h-[850px]
                         bg-skin-bg-primary/92 backdrop-blur-2xl 
                         border border-skin-border/20
                         rounded-2xl
                         flex flex-col overflow-hidden
                         shadow-[0_0_80px_rgba(0,0,0,0.6),0_0_30px_rgba(245,158,11,0.08)]
                         pointer-events-auto"
            >
              {/* Header - 可拖动区域 */}
              <div 
                className="flex items-center justify-between px-6 py-4 border-b border-skin-border/15 cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => dragControls.start(e)}
              >
                <div className="flex items-center gap-3">
                  <GripHorizontal className="w-4 h-4 text-skin-text-tertiary/50" />
                  {/* 侧边栏折叠按钮 */}
                  <button
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                    className="p-1.5 text-skin-text-tertiary hover:text-skin-text-secondary 
                               hover:bg-white/5 rounded-lg transition-colors"
                    title={sidebarCollapsed ? "展开会话列表" : "收起会话列表"}
                  >
                    {sidebarCollapsed ? (
                      <PanelLeft className="w-4 h-4" />
                    ) : (
                      <PanelLeftClose className="w-4 h-4" />
                    )}
                  </button>
                  <Sparkles className="w-5 h-5 text-skin-accent-amber" />
                  <span className="text-lg font-mono text-skin-accent-amber font-semibold">AI Assistant</span>
                  <span className="text-sm font-mono text-skin-text-tertiary px-2.5 py-1 bg-skin-bg-secondary/40 rounded-lg">
                    {currentView}
                  </span>
                  {agentStatus === 'thinking' && (
                    <span className="text-sm font-mono text-skin-accent-cyan animate-pulse flex items-center gap-1.5 ml-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('task.agent_thinking')}
                    </span>
                  )}
                  {agentStatus === 'executing' && (
                    <span className="text-sm font-mono text-skin-accent-amber animate-pulse flex items-center gap-1.5 ml-2">
                      <Zap className="w-3.5 h-3.5" /> {t('task.agent_executing')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* 创建 Nexus 按钮 - 更明显 */}
                  <button
                    onClick={handleCreateNexus}
                    disabled={chatStreaming || isObserverAnalyzing}
                    className="flex items-center gap-1.5 px-3 py-1.5 
                             text-sm font-mono text-amber-400 
                             bg-amber-500/10 border border-amber-500/30 rounded-lg
                             hover:bg-amber-500/20 hover:border-amber-500/40
                             transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    title="从对话创建 Nexus"
                  >
                    {isObserverAnalyzing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4" />
                    )}
                    <span>创建 Nexus</span>
                  </button>
                  <button
                    onClick={clearChat}
                    className="p-2.5 text-skin-text-tertiary hover:text-red-400 transition-colors rounded-lg hover:bg-white/5"
                    title={t('chat.clear')}
                  >
                    <Trash2 className="w-4.5 h-4.5" />
                  </button>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-2.5 text-skin-text-tertiary hover:text-skin-text-secondary transition-colors rounded-lg hover:bg-white/5"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* 主体内容区：侧边栏 + 聊天区 */}
              <div className="flex-1 flex overflow-hidden">
                {/* 会话侧边栏 */}
                <AnimatePresence mode="wait">
                  {!sidebarCollapsed && (
                    <motion.div
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 240, opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex-shrink-0 overflow-hidden"
                    >
                      <ConversationSidebar className="h-full" />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* 聊天主区域 */}
                <div className="flex-1 flex flex-col min-w-0">
                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <ChatErrorBoundary onReset={clearChat}>
                {!configured ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Sparkles className="w-16 h-16 text-skin-accent-amber/30 mb-5" />
                    <p className="text-lg font-mono text-skin-text-tertiary mb-2">{t('chat.not_configured')}</p>
                    <p className="text-base font-mono text-skin-text-tertiary/60">
                      {t('chat.configure_prompt')}
                    </p>
                  </div>
                ) : chatMessages.length === 0 && !chatStreaming ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <MessageSquare className="w-16 h-16 text-skin-text-primary/10 mb-5" />
                    <p className="text-lg font-mono text-skin-text-tertiary mb-4">
                      {t('chat.input_placeholder')}
                    </p>
                    
                    {/* 创建 Nexus 引导按钮 */}
                    <button
                      onClick={handleCreateNexus}
                      className="flex items-center gap-3 px-6 py-3.5 mb-8
                                 bg-gradient-to-r from-amber-500/20 to-cyan-500/10
                                 border border-amber-500/30 rounded-xl
                                 text-amber-400 hover:border-amber-500/50
                                 hover:from-amber-500/30 hover:to-cyan-500/15
                                 transition-all duration-300 group"
                    >
                      <Wand2 className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                      <span className="font-mono text-base font-medium">创建 Nexus</span>
                    </button>
                    
                    {quickCommands.length > 0 && (
                      <div className="flex flex-wrap gap-2.5 justify-center max-w-lg">
                        {quickCommands.map((cmd) => (
                          <button
                            key={cmd.label}
                            onClick={() => handleQuickCommand(cmd.prompt)}
                            className="px-4 py-2.5 text-sm font-mono bg-skin-bg-secondary/30 border border-skin-border/15 
                                       rounded-xl text-skin-text-secondary hover:text-skin-accent-amber hover:border-skin-accent-amber/30 
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
                      <ChatMessage key={msg.id} message={msg} containerWidth="main" />
                    ))}
                    {chatStreaming && chatStreamContent && (
                      <StreamingMessage content={chatStreamContent} />
                    )}
                    {chatError && (
                      <div className="px-5 py-4 bg-red-500/10 border border-red-500/20 rounded-xl text-base font-mono text-red-400">
                        {chatError}
                      </div>
                    )}
                    {/* Quest 交互式流程 UI - 已禁用 */}
                    {/* <QuestPhaseRenderer /> */}
                  </>
                )}
                <div ref={messagesEndRef} />
                </ChatErrorBoundary>
              </div>

              {/* Quick Commands Bar */}
              {configured && chatMessages.length > 0 && quickCommands.length > 0 && (
                <div className="px-6 py-3 border-t border-skin-border/10 flex gap-2.5 overflow-x-auto">
                  {quickCommands.map((cmd) => (
                    <button
                      key={cmd.label}
                      onClick={() => handleQuickCommand(cmd.prompt)}
                      disabled={chatStreaming}
                      className="flex-shrink-0 px-4 py-2 text-sm font-mono bg-skin-bg-secondary/30 border border-skin-border/15 
                                 rounded-xl text-skin-text-tertiary hover:text-skin-accent-amber hover:border-skin-accent-amber/30 
                                 transition-colors disabled:opacity-50"
                    >
                      {cmd.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Input */}
              {configured && (
                <div className="px-6 py-5 border-t border-skin-border/15 bg-skin-bg-secondary/25">
                  {/* 附件预览 / 解析进度 */}
                  {(attachments.length > 0 || parseProgress.length > 0) && (
                    <div className="flex flex-wrap gap-2.5 mb-4">
                      {parsingFiles ? parseProgress.map((p, idx) => (
                        <div
                          key={`parse-${idx}`}
                          className={`flex items-center gap-2 px-3.5 py-2 border rounded-xl text-sm font-mono
                            ${p.status === 'done' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                              p.status === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                              'bg-skin-bg-secondary/40 border-skin-accent-amber/30 text-skin-text-secondary'}`}
                        >
                          {p.status === 'uploading' && <Loader2 className="w-4 h-4 animate-spin text-skin-accent-amber" />}
                          {p.status === 'done' && <CheckCircle className="w-4 h-4" />}
                          {p.status === 'error' && <AlertCircle className="w-4 h-4" />}
                          <span className="max-w-[160px] truncate">{p.name}</span>
                          <span className="text-[10px] opacity-60">
                            {p.status === 'uploading' ? '解析中...' : p.status === 'done' ? '完成' : '失败'}
                          </span>
                        </div>
                      )) : attachments.map((att, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 px-3.5 py-2 bg-skin-bg-secondary/40 border border-skin-border/15 
                                     rounded-xl text-sm font-mono text-skin-text-secondary"
                        >
                          {att.type === 'image' && <Image className="w-4 h-4 text-skin-accent-emerald" />}
                          {att.type === 'file' && <Paperclip className="w-4 h-4 text-skin-accent-cyan" />}
                          {att.type === 'skill' && <Puzzle className="w-4 h-4 text-skin-accent-amber" />}
                          {att.type === 'mcp' && <Server className="w-4 h-4 text-skin-accent-purple" />}
                          <span className="max-w-[140px] truncate">{att.name}</span>
                          <button
                            onClick={() => removeAttachment(idx)}
                            className="text-skin-text-tertiary hover:text-red-400 ml-1"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* 输入框 + 按钮 */}
                  <div className="flex gap-4 items-end">
                    {/* 工具按钮 */}
                    <div className="flex gap-1.5 pb-2.5">
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
                        accept=".pdf,.docx,.pptx,.txt,.md,.csv"
                        multiple
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      <button
                        onClick={() => imageInputRef.current?.click()}
                        disabled={chatStreaming}
                        className="p-2.5 text-skin-text-tertiary hover:text-skin-accent-emerald hover:bg-skin-bg-secondary/40 
                                   rounded-xl transition-colors disabled:opacity-50"
                        title="Image"
                      >
                        <Image className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={chatStreaming}
                        className="p-2.5 text-skin-text-tertiary hover:text-skin-accent-cyan hover:bg-skin-bg-secondary/40 
                                   rounded-xl transition-colors disabled:opacity-50"
                        title="File"
                      >
                        <Paperclip className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setShowSkillModal(true)}
                        disabled={chatStreaming}
                        className="p-2.5 text-skin-text-tertiary hover:text-skin-accent-amber hover:bg-skin-bg-secondary/40 
                                   rounded-xl transition-colors disabled:opacity-50"
                        title="SKILL"
                      >
                        <Puzzle className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setShowMCPModal(true)}
                        disabled={chatStreaming}
                        className="p-2.5 text-skin-text-tertiary hover:text-skin-accent-purple hover:bg-skin-bg-secondary/40 
                                   rounded-xl transition-colors disabled:opacity-50"
                        title="MCP"
                      >
                        <Server className="w-5 h-5" />
                      </button>
                    </div>
                    
                    {/* 输入框 */}
                    <div className="flex-1">
                      <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('chat.input_placeholder')}
                        disabled={chatStreaming}
                        rows={1}
                        className="w-full px-5 py-4 bg-skin-bg-secondary/40 border border-skin-border/15 rounded-xl 
                                   text-base font-mono text-skin-text-secondary placeholder-skin-text-tertiary
                                   focus:border-skin-accent-amber/50 focus:outline-none focus:ring-2 focus:ring-skin-accent-amber/10
                                   disabled:opacity-50 resize-none min-h-[56px] max-h-[140px]"
                      />
                    </div>
                    
                    {/* 发送/停止按钮 */}
                    {parsingFiles ? (
                      <button
                        onClick={handleCancelUpload}
                        className="p-4 flex flex-col items-center gap-1 bg-skin-bg-secondary/40 border border-skin-accent-amber/30 
                                   rounded-xl hover:bg-red-500/20 hover:border-red-500/30 transition-colors group"
                        title="取消上传"
                      >
                        <Loader2 className="w-6 h-6 text-skin-accent-amber animate-spin group-hover:hidden" />
                        <X className="w-6 h-6 text-red-400 hidden group-hover:block" />
                        <span className="text-[10px] text-skin-text-tertiary group-hover:text-red-400">解析中</span>
                      </button>
                    ) : chatStreaming ? (
                      <button
                        onClick={abortChat}
                        className="p-4 bg-red-500/20 border border-red-500/30 rounded-xl 
                                   text-red-400 hover:bg-red-500/30 transition-colors"
                      >
                        <Square className="w-6 h-6" />
                      </button>
                    ) : (
                      <button
                        onClick={handleSend}
                        disabled={(!input.trim() && attachments.length === 0) || parsingFiles}
                        className="p-4 bg-skin-accent-amber/20 border border-skin-accent-amber/30 rounded-xl 
                                   text-skin-accent-amber hover:bg-skin-accent-amber/30 transition-colors
                                   disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Send className="w-6 h-6" />
                      </button>
                    )}
                  </div>
                  
                  <p className="text-sm font-mono text-skin-text-tertiary/50 mt-3 text-center">
                    Enter 发送 | Shift+Enter 换行 | Ctrl+K 关闭 | 拖动标题栏移动窗口
                  </p>
                </div>
              )}
                </div>
                {/* 关闭：聊天主区域 */}
              </div>
              {/* 关闭：主体内容区 */}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* MCP / SKILL / Nexus 引导模态框 */}
      <AddMCPModal
        isOpen={showMCPModal}
        onClose={() => setShowMCPModal(false)}
        onConfirm={handleAddMCP}
      />
      <AddSkillModal
        isOpen={showSkillModal}
        onClose={() => setShowSkillModal(false)}
        onConfirm={handleAddSkill}
      />
      <CreateNexusModal
        isOpen={showNexusModal}
        onClose={handleCloseNexusModal}
        initialData={nexusInitialData}
      />
    </>
  )
}

/**
 * Quest 阶段渲染器 - 已禁用
 * Quest 模式已禁用，所有任务走传统 ReAct 直接执行
 */
// function QuestPhaseRenderer() { ... }
