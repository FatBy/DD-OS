/**
 * Quest 计划确认组件
 * 展示探索结果和生成的计划，供用户确认、编辑或取消
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  CheckCircle, 
  XCircle, 
  Edit3, 
  ChevronDown, 
  ChevronRight,
  Search,
  Code,
  FileText,
  AlertCircle
} from 'lucide-react'
import type { QuestSession, TaskPlan, ExplorationResult, SubTask } from '@/types'

interface QuestPlanConfirmationProps {
  session: QuestSession
  onConfirm: () => void
  onEdit?: (plan: TaskPlan) => void
  onCancel: () => void
}

export function QuestPlanConfirmation({ 
  session, 
  onConfirm, 
  onEdit, 
  onCancel 
}: QuestPlanConfirmationProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    exploration: true,
    plan: true,
  })
  const [_editingTaskId, setEditingTaskId] = useState<string | null>(null)

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const getSourceIcon = (source: ExplorationResult['source']) => {
    switch (source) {
      case 'codebase': return <Search className="w-4 h-4" />
      case 'symbol': return <Code className="w-4 h-4" />
      case 'file': return <FileText className="w-4 h-4" />
      default: return <Search className="w-4 h-4" />
    }
  }

  const getStatusColor = (status: SubTask['status']) => {
    switch (status) {
      case 'done': return 'text-green-400'
      case 'executing': return 'text-blue-400'
      case 'failed': return 'text-red-400'
      case 'blocked': return 'text-orange-400'
      default: return 'text-gray-400'
    }
  }

  if (!session.proposedPlan) {
    return (
      <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
        <div className="flex items-center gap-2 text-yellow-400">
          <AlertCircle className="w-5 h-5" />
          <span>正在生成计划...</span>
        </div>
      </div>
    )
  }

  const plan = session.proposedPlan

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gray-900/80 backdrop-blur-sm rounded-lg border border-gray-700 overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-blue-900/50 to-purple-900/50 border-b border-gray-700">
        <h3 className="text-lg font-semibold text-white">{plan.title || '任务计划'}</h3>
        <p className="text-sm text-gray-400 mt-1">{session.userGoal.slice(0, 100)}...</p>
      </div>

      {/* Exploration Results */}
      {session.explorationResults.length > 0 && (
        <div className="border-b border-gray-700">
          <button
            onClick={() => toggleSection('exploration')}
            className="w-full px-4 py-2 flex items-center justify-between text-left hover:bg-gray-800/50 transition-colors"
          >
            <span className="text-sm font-medium text-gray-300">
              探索结果 ({session.explorationResults.length})
            </span>
            {expandedSections.exploration ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            )}
          </button>
          
          <AnimatePresence>
            {expandedSections.exploration && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-3 space-y-2">
                  {session.explorationResults.map((result, idx) => (
                    <div 
                      key={idx}
                      className="p-2 bg-gray-800/50 rounded border border-gray-700/50"
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-blue-400">{getSourceIcon(result.source)}</span>
                        <span className="text-gray-300 font-medium">{result.query}</span>
                        <span className="text-xs text-gray-500 ml-auto">{result.source}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                        {result.summary}
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Task Plan */}
      <div className="border-b border-gray-700">
        <button
          onClick={() => toggleSection('plan')}
          className="w-full px-4 py-2 flex items-center justify-between text-left hover:bg-gray-800/50 transition-colors"
        >
          <span className="text-sm font-medium text-gray-300">
            执行计划 ({plan.subTasks.length} 步)
          </span>
          {expandedSections.plan ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </button>
        
        <AnimatePresence>
          {expandedSections.plan && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 space-y-2">
                {plan.subTasks.map((task, idx) => (
                  <div 
                    key={task.id}
                    className="flex items-start gap-3 p-2 bg-gray-800/30 rounded"
                  >
                    <span className="text-xs text-gray-500 w-5 text-center pt-0.5">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${getStatusColor(task.status)}`}>
                        {task.description}
                      </p>
                      {task.toolHint && (
                        <span className="text-xs text-gray-500">
                          工具: {task.toolHint}
                        </span>
                      )}
                      {task.dependsOn.length > 0 && (
                        <span className="text-xs text-gray-500 ml-2">
                          依赖: {task.dependsOn.join(', ')}
                        </span>
                      )}
                    </div>
                    {onEdit && (
                      <button
                        onClick={() => setEditingTaskId(task.id)}
                        className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 flex items-center justify-end gap-3 bg-gray-800/30">
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
        >
          <XCircle className="w-4 h-4" />
          取消
        </button>
        {onEdit && (
          <button
            onClick={() => onEdit(plan)}
            className="px-4 py-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1.5"
          >
            <Edit3 className="w-4 h-4" />
            修改
          </button>
        )}
        <button
          onClick={onConfirm}
          className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-500 text-white rounded transition-colors flex items-center gap-1.5"
        >
          <CheckCircle className="w-4 h-4" />
          确认执行
        </button>
      </div>
    </motion.div>
  )
}

export default QuestPlanConfirmation
