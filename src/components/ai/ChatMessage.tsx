import { useState } from 'react'
import { motion } from 'framer-motion'
import { User, Bot, AlertCircle, Clock, Loader2, CheckCircle2, XCircle, Zap, Copy, Check, MessageSquare } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { ChatMessage as ChatMessageType, ExecutionStatus } from '@/types'

// 执行状态卡片
function ExecutionCard({ execution, content }: { execution: ExecutionStatus; content?: string }) {
  const [copied, setCopied] = useState(false)
  
  // 任务建议模式
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
            发送到 Telegram/WhatsApp 等渠道执行
          </span>
        </div>
      </motion.div>
    )
  }
  
  // 原有执行状态模式
  const configs: Record<string, { icon: typeof Clock; color: string; label: string }> = {
    pending: { icon: Clock, color: 'amber', label: '等待执行...' },
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
        'mt-2 p-2.5 rounded-lg border',
        `bg-${config.color}-500/10 border-${config.color}-500/20`
      )}
    >
      <div className="flex items-center gap-2">
        <Zap className={cn('w-3 h-3', `text-${config.color}-400`)} />
        <Icon className={cn(
          'w-3.5 h-3.5',
          `text-${config.color}-400`,
          execution.status === 'running' && 'animate-spin'
        )} />
        <span className={cn('text-[10px] font-mono', `text-${config.color}-400`)}>
          {config.label}
        </span>
        {execution.sessionKey && (
          <span className="text-[9px] font-mono text-white/20 ml-auto truncate max-w-[120px]">
            {execution.sessionKey}
          </span>
        )}
      </div>
      {execution.output && (
        <p className="text-[10px] font-mono text-white/50 mt-1.5 whitespace-pre-wrap line-clamp-3">
          {execution.output}
        </p>
      )}
      {execution.error && (
        <p className="text-[10px] font-mono text-red-400/80 mt-1.5">
          {execution.error}
        </p>
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
