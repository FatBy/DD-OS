import { useState, useMemo, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { User, Bot, AlertCircle, Clock, Loader2, CheckCircle2, XCircle, Zap, Copy, Check, MessageSquare, ChevronDown } from 'lucide-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { cn } from '@/utils/cn'
import type { ChatMessage as ChatMessageType, ExecutionStatus } from '@/types'

// 虚拟化日志查看器
function LogViewer({ lines }: { lines: string[] }) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [atBottom, setAtBottom] = useState(true)
  
  // 当有新行且用户在底部时自动滚动
  useEffect(() => {
    if (atBottom && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({ index: lines.length - 1, behavior: 'smooth' })
    }
  }, [lines.length, atBottom])

  return (
    <Virtuoso
      ref={virtuosoRef}
      style={{ height: '10rem' }}
      data={lines}
      atBottomStateChange={setAtBottom}
      itemContent={(_index: number, line: string) => (
        <div className="text-xs font-mono text-emerald-400/80 leading-relaxed px-1 min-h-[1.25rem]">
          {line || '\u00A0'}
        </div>
      )}
    />
  )
}

// 执行状态卡片
function ExecutionCard({ execution, content }: { execution: ExecutionStatus; content?: string }) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  
  // 按行分割日志输出，使用 outputLines 或从 output 计算
  const logLines = useMemo(() => {
    if (execution.outputLines && execution.outputLines.length > 0) {
      return execution.outputLines
    }
    if (execution.output) {
      return execution.output.split('\n')
    }
    return []
  }, [execution.outputLines, execution.output])
  
  // 日志摘要（显示最后一行非空内容）
  const logSummary = useMemo(() => {
    const nonEmptyLines = logLines.filter(l => l.trim())
    return nonEmptyLines.length > 0 ? nonEmptyLines[nonEmptyLines.length - 1] : ''
  }, [logLines])
  
  // 任务建议模式（本地服务不可用时的降级方案）
  if (execution.status === 'suggestion') {
    const handleCopy = async () => {
      if (content) {
        await navigator.clipboard.writeText(content)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    }
    
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-3 p-3 rounded-lg border bg-purple-500/10 border-purple-500/30"
      >
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-mono text-purple-400 font-medium">
            任务建议
          </span>
          <span className="text-[10px] font-mono text-white/30 ml-auto">
            本地服务未启动
          </span>
        </div>
        
        <p className="text-xs font-mono text-white/70 mb-3 leading-relaxed">
          {content}
        </p>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors',
              copied
                ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
                : 'bg-white/5 border border-white/10 text-white/60 hover:text-purple-400 hover:border-purple-500/30'
            )}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                已复制
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                复制任务
              </>
            )}
          </button>
          <span className="text-[10px] font-mono text-white/30">
            启动 ddos-local-server.py 以执行任务
          </span>
        </div>
      </motion.div>
    )
  }
  
  // 原有执行状态模式
  const configs: Record<string, { icon: typeof Clock; color: string; label: string }> = {
    pending: { icon: Clock, color: 'amber', label: '准备执行...' },
    running: { icon: Loader2, color: 'cyan', label: '执行中...' },
    success: { icon: CheckCircle2, color: 'emerald', label: '执行完成' },
    error: { icon: XCircle, color: 'red', label: '执行失败' },
  }
  const config = configs[execution.status] || configs.pending
  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'mt-3 p-3 rounded-lg border',
        execution.status === 'success' ? 'bg-emerald-500/10 border-emerald-500/30' :
        execution.status === 'error' ? 'bg-red-500/10 border-red-500/30' :
        execution.status === 'running' ? 'bg-cyan-500/10 border-cyan-500/30' :
        'bg-amber-500/10 border-amber-500/30'
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <Zap className={cn('w-4 h-4', `text-${config.color}-400`)} />
        <Icon className={cn(
          'w-4 h-4',
          `text-${config.color}-400`,
          execution.status === 'running' && 'animate-spin'
        )} />
        <span className={cn('text-xs font-mono font-medium', `text-${config.color}-400`)}>
          {config.label}
        </span>
        {execution.sessionKey && (
          <span className="text-[10px] font-mono text-white/30 ml-auto">
            ID: {execution.sessionKey}
          </span>
        )}
      </div>
      
      {/* 任务内容 */}
      <p className="text-xs font-mono text-white/60 mb-2 leading-relaxed">
        {content}
      </p>
      
      {/* 执行输出 - 可折叠 */}
      {logLines.length > 0 && (
        <div className="mt-2 bg-black/20 rounded border border-white/5">
          {/* 折叠标题栏 */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 transition-colors"
          >
            <ChevronDown 
              className={cn(
                'w-3 h-3 text-white/40 transition-transform',
                expanded && 'rotate-180'
              )} 
            />
            <span className="text-[10px] font-mono text-white/40">
              输出 ({logLines.length} 行)
            </span>
            {!expanded && logSummary && (
              <span className="flex-1 text-[10px] font-mono text-emerald-400/60 truncate text-left">
                {logSummary.slice(0, 40)}{logSummary.length > 40 ? '...' : ''}
              </span>
            )}
          </button>
          
          {/* 可展开的日志内容 */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <LogViewer lines={logLines} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      
      {/* 错误信息 */}
      {execution.error && (
        <div className="mt-2 p-2 bg-red-500/5 rounded border border-red-500/20">
          <p className="text-[10px] font-mono text-red-400/60 mb-1">错误:</p>
          <p className="text-xs font-mono text-red-400/80">
            {execution.error}
          </p>
        </div>
      )}
    </motion.div>
  )
}

interface ChatMessageProps {
  message: ChatMessageType
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isError = message.error

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex gap-2',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div className={cn(
        'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0',
        isUser ? 'bg-cyan-500/20' : 'bg-amber-500/20'
      )}>
        {isUser 
          ? <User className="w-3.5 h-3.5 text-cyan-400" />
          : <Bot className="w-3.5 h-3.5 text-amber-400" />
        }
      </div>

      {/* Content */}
      <div className={cn(
        'max-w-[80%] px-3 py-2 rounded-lg text-xs font-mono leading-relaxed',
        isUser
          ? 'bg-cyan-500/10 border border-cyan-500/20 text-white/80'
          : isError
          ? 'bg-red-500/10 border border-red-500/20 text-red-300'
          : 'bg-white/5 border border-white/10 text-white/70'
      )}>
        {isError && (
          <div className="flex items-center gap-1 mb-1 text-red-400">
            <AlertCircle className="w-3 h-3" />
            <span className="text-[10px]">错误</span>
          </div>
        )}
        {/* 任务建议时不显示普通内容 */}
        {!(message.execution?.status === 'suggestion') && (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        )}
        {message.execution && <ExecutionCard execution={message.execution} content={message.content} />}
      </div>
    </motion.div>
  )
}

interface StreamingMessageProps {
  content: string
}

export function StreamingMessage({ content }: StreamingMessageProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-2"
    >
      <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 bg-amber-500/20">
        <Bot className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
      </div>
      <div className="max-w-[80%] px-3 py-2 rounded-lg text-xs font-mono leading-relaxed bg-white/5 border border-amber-500/20 text-white/70">
        <div className="whitespace-pre-wrap break-words">
          {content}
          <span className="inline-block w-1.5 h-3.5 bg-amber-400/60 ml-0.5 animate-pulse" />
        </div>
      </div>
    </motion.div>
  )
}
