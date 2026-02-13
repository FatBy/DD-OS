import { motion } from 'framer-motion'
import { User, Bot, AlertCircle } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { ChatMessage as ChatMessageType } from '@/types'

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
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
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
