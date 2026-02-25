/**
 * 子代理监控组件
 * 显示当前运行的子代理状态
 */

import { motion, AnimatePresence } from 'framer-motion'
import { 
  Bot, 
  CheckCircle, 
  XCircle, 
  Loader2,
  Search,
  FileCode,
  Cpu
} from 'lucide-react'
import type { Subagent } from '@/types'

interface SubagentMonitorProps {
  subagents: Subagent[]
  compact?: boolean
}

export function SubagentMonitor({ subagents, compact = false }: SubagentMonitorProps) {
  if (subagents.length === 0) return null

  const getTypeIcon = (type: Subagent['type']) => {
    switch (type) {
      case 'explore': return <Search className="w-3.5 h-3.5" />
      case 'plan': return <FileCode className="w-3.5 h-3.5" />
      case 'execute': return <Cpu className="w-3.5 h-3.5" />
      default: return <Bot className="w-3.5 h-3.5" />
    }
  }

  const getStatusIcon = (status: Subagent['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-3.5 h-3.5 text-green-400" />
      case 'failed':
        return <XCircle className="w-3.5 h-3.5 text-red-400" />
      case 'running':
        return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
      default:
        return <Bot className="w-3.5 h-3.5 text-gray-400" />
    }
  }

  const getStatusColor = (status: Subagent['status']) => {
    switch (status) {
      case 'completed': return 'border-green-500/30 bg-green-900/20'
      case 'failed': return 'border-red-500/30 bg-red-900/20'
      case 'running': return 'border-blue-500/30 bg-blue-900/20'
      default: return 'border-gray-700 bg-gray-800/50'
    }
  }

  // 统计信息
  const running = subagents.filter(a => a.status === 'running').length
  const completed = subagents.filter(a => a.status === 'completed').length
  const failed = subagents.filter(a => a.status === 'failed').length

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700">
        <Bot className="w-4 h-4 text-purple-400" />
        <span className="text-xs text-gray-400">
          {running > 0 && <span className="text-blue-400">{running} 运行中</span>}
          {completed > 0 && <span className="text-green-400 ml-2">{completed} 完成</span>}
          {failed > 0 && <span className="text-red-400 ml-2">{failed} 失败</span>}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-gray-300">子代理</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {running > 0 && (
            <span className="flex items-center gap-1 text-blue-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              {running}
            </span>
          )}
          {completed > 0 && (
            <span className="flex items-center gap-1 text-green-400">
              <CheckCircle className="w-3 h-3" />
              {completed}
            </span>
          )}
          {failed > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <XCircle className="w-3 h-3" />
              {failed}
            </span>
          )}
        </div>
      </div>

      {/* Agent List */}
      <div className="space-y-1.5">
        <AnimatePresence mode="popLayout">
          {subagents.map(agent => (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className={`p-2 rounded border ${getStatusColor(agent.status)} transition-colors`}
            >
              <div className="flex items-start gap-2">
                <span className="text-purple-400 mt-0.5">
                  {getTypeIcon(agent.type)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-200 truncate">
                      {agent.task.slice(0, 40)}
                      {agent.task.length > 40 && '...'}
                    </span>
                    {getStatusIcon(agent.status)}
                  </div>
                  
                  {/* Progress bar for running agents */}
                  {agent.status === 'running' && agent.progress !== undefined && (
                    <div className="mt-1.5 h-1 bg-gray-700 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${agent.progress}%` }}
                        className="h-full bg-blue-500 rounded-full"
                      />
                    </div>
                  )}
                  
                  {/* Result preview for completed agents */}
                  {agent.status === 'completed' && agent.result && (
                    <p className="mt-1 text-xs text-gray-400 line-clamp-1">
                      {agent.result.slice(0, 60)}...
                    </p>
                  )}
                  
                  {/* Error message for failed agents */}
                  {agent.status === 'failed' && agent.error && (
                    <p className="mt-1 text-xs text-red-400 line-clamp-1">
                      {agent.error}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default SubagentMonitor
