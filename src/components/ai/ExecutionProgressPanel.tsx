/**
 * ExecutionProgressPanel - 右侧执行进展面板
 * 
 * 展示当前任务的执行进展：
 * - 执行中模式：实时步骤流（thinking / tool_call / tool_result / error）
 * - 完成模式：结构化摘要（parseExecutionSummary）
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import {
  X, CheckCircle2, AlertCircle, Loader2,
  Brain, Wrench, ChevronDown, ChevronRight,
  Copy, Clock, FileText, BarChart3, Eye,
} from 'lucide-react'
import { useStore } from '@/store'
import { parseExecutionSummary } from '@/services/executionSummaryParser'
import type { ExecutionSummary } from '@/services/executionSummaryParser'
import type { ExecutionStep, TaskItem } from '@/types'

// ============================================
// Props
// ============================================

interface ExecutionProgressPanelProps {
  taskId?: string
  onClose?: () => void
}

// ============================================
// 主组件
// ============================================

export function ExecutionProgressPanel({ taskId, onClose }: ExecutionProgressPanelProps) {
  const activeExecutions = useStore((s) => s.activeExecutions)

  const task: TaskItem | undefined = useMemo(() => {
    if (taskId) return activeExecutions.find(t => t.id === taskId)
    return (
      activeExecutions.find(t => ['executing', 'retrying'].includes(t.status)) ||
      activeExecutions[activeExecutions.length - 1]
    )
  }, [taskId, activeExecutions])

  if (!task) {
    return (
      <div className="flex flex-col h-full bg-gray-50/50 border-l border-gray-100">
        <div className="flex items-center justify-center h-full text-gray-400 text-sm">
          暂无执行任务
        </div>
      </div>
    )
  }

  const isExecuting = task.status === 'executing' || task.status === 'retrying'
  const isDone = task.status === 'done' || task.status === 'terminated' || task.status === 'error'

  return (
    <div className="flex flex-col h-full bg-gray-50/50 border-l border-gray-100 overflow-hidden">
      {/* Header */}
      <PanelHeader task={task} onClose={onClose} />

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isExecuting && <StepStream steps={task.executionSteps ?? []} />}
        {isDone && <StructuredSummary task={task} />}
        {!isExecuting && !isDone && <StepStream steps={task.executionSteps ?? []} />}
      </div>
    </div>
  )
}

// ============================================
// Header
// ============================================

function PanelHeader({ task, onClose }: { task: TaskItem; onClose?: () => void }) {
  const title = task.title || task.description?.slice(0, 50) || '未命名任务'

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0 bg-white">
      <div className="flex-1 min-w-0">
        <h3 className="text-base font-semibold text-gray-800 truncate">{title}</h3>
      </div>
      <StatusBadge status={task.status} />
      {onClose && (
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: TaskItem['status'] }) {
  if (status === 'executing' || status === 'retrying') {
    return (
      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-600">
        <Loader2 size={12} className="animate-spin" />
        执行中
      </span>
    )
  }
  if (status === 'done') {
    return (
      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600">
        <CheckCircle2 size={12} />
        已完成
      </span>
    )
  }
  if (status === 'error' || status === 'terminated') {
    return (
      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-red-50 text-red-600">
        <AlertCircle size={12} />
        {status === 'terminated' ? '已终止' : '失败'}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
      {status}
    </span>
  )
}

// ============================================
// StepStream - 执行中的实时步骤流
// ============================================

function StepStream({ steps }: { steps: ExecutionStep[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps.length])

  const renderedSteps = useMemo(() => {
    return steps.map((step) => <StepItem key={step.id} step={step} />)
  }, [steps])

  if (steps.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
        <Loader2 size={16} className="animate-spin mr-2" />
        等待执行...
      </div>
    )
  }

  return (
    <div className="px-3 py-2 space-y-1">
      {renderedSteps}
      <div ref={bottomRef} />
    </div>
  )
}

function StepItem({ step }: { step: ExecutionStep }) {
  switch (step.type) {
    case 'thinking':
      return <ThinkingStep step={step} />
    case 'tool_call':
      return <ToolCallStep step={step} />
    case 'tool_result':
      return <ToolResultStep step={step} />
    case 'error':
      return <ErrorStep step={step} />
    case 'output':
      return <OutputStep step={step} />
    default:
      return null
  }
}

// ---- ThinkingStep ----
function ThinkingStep({ step }: { step: ExecutionStep }) {
  const [expanded, setExpanded] = useState(false)
  const preview = step.content.slice(0, 30) + (step.content.length > 30 ? '...' : '')

  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left text-xs text-gray-500 hover:text-gray-700"
      >
        <Brain size={12} className="shrink-0 text-gray-400" />
        <span className="flex-1 truncate">{expanded ? '思考过程' : preview}</span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {expanded && (
        <pre className="mt-2 text-xs text-gray-500 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
          {step.content}
        </pre>
      )}
    </div>
  )
}

// ---- ToolCallStep ----
function ToolCallStep({ step }: { step: ExecutionStep }) {
  const [expanded, setExpanded] = useState(false)
  const argsSummary = step.toolArgs
    ? Object.entries(step.toolArgs).slice(0, 3).map(([k, v]) => {
        const val = typeof v === 'string' ? v.slice(0, 30) : JSON.stringify(v)?.slice(0, 30)
        return `${k}: ${val}`
      }).join(', ')
    : ''

  return (
    <div className="rounded-xl border-l-[3px] border-blue-400 bg-white border border-gray-100 px-3 py-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <Wrench size={12} className="shrink-0 text-blue-500" />
        <span className="text-xs font-medium text-gray-700">{step.toolName || '工具调用'}</span>
        {step.duration != null && (
          <span className="text-[10px] text-gray-400 ml-auto">{step.duration}ms</span>
        )}
        {expanded ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
      </button>
      {!expanded && argsSummary && (
        <p className="mt-1 text-[11px] text-gray-400 truncate pl-5">{argsSummary}</p>
      )}
      {expanded && step.toolArgs && (
        <pre className="mt-2 text-[11px] text-gray-500 whitespace-pre-wrap break-words max-h-40 overflow-y-auto pl-5">
          {JSON.stringify(step.toolArgs, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ---- ToolResultStep ----
function ToolResultStep({ step }: { step: ExecutionStep }) {
  const [expanded, setExpanded] = useState(false)
  const isError = step.content.toLowerCase().includes('error') || step.content.toLowerCase().includes('失败')
  const borderColor = isError ? 'border-red-400' : 'border-emerald-400'
  const iconColor = isError ? 'text-red-500' : 'text-emerald-500'

  return (
    <div className={`rounded-xl border-l-[3px] ${borderColor} bg-white border border-gray-100 px-3 py-2`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        {isError ? <AlertCircle size={12} className={iconColor} /> : <CheckCircle2 size={12} className={iconColor} />}
        <span className="text-xs text-gray-600">
          {isError ? '执行失败' : '执行成功'}
        </span>
        {expanded ? <ChevronDown size={12} className="text-gray-400 ml-auto" /> : <ChevronRight size={12} className="text-gray-400 ml-auto" />}
      </button>
      {expanded && (
        <pre className="mt-2 text-[11px] text-gray-500 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
          {step.content}
        </pre>
      )}
    </div>
  )
}

// ---- ErrorStep ----
function ErrorStep({ step }: { step: ExecutionStep }) {
  return (
    <div className="rounded-xl bg-red-50 px-3 py-2">
      <div className="flex items-center gap-2">
        <AlertCircle size={12} className="text-red-500 shrink-0" />
        <span className="text-xs text-red-600 font-medium">错误</span>
      </div>
      <p className="mt-1 text-[11px] text-red-500 whitespace-pre-wrap break-words">
        {step.content}
      </p>
    </div>
  )
}

// ---- OutputStep ----
function OutputStep({ step }: { step: ExecutionStep }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <p className="text-xs text-gray-600 whitespace-pre-wrap break-words">
        {step.content}
      </p>
    </div>
  )
}

// ============================================
// StructuredSummary - 完成后的结构化摘要
// ============================================

function StructuredSummary({ task }: { task: TaskItem }) {
  const summary: ExecutionSummary = useMemo(() => parseExecutionSummary(task), [task])

  return (
    <div className="px-4 py-3 space-y-4">
      {/* 状态 + 耗时 */}
      <div className="flex items-center gap-3">
        <SummaryStatusBadge status={summary.status} />
        <span className="text-sm text-gray-400 flex items-center gap-1">
          <Clock size={14} />
          {formatDuration(summary.duration)}
        </span>
      </div>

      {/* Findings */}
      {summary.findings.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">发现</h4>
          <ul className="space-y-1.5">
            {summary.findings.slice(0, 10).map((f: string, i: number) => (
              <li key={i} className="text-[13px] text-gray-600 flex items-start gap-2">
                <span className="text-gray-400 mt-0.5">•</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 工具调用统计 */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1">
          <BarChart3 size={14} />
          工具调用
        </h4>
        <div className="flex gap-4 text-sm">
          <span className="text-gray-500">
            总计 <span className="text-lg font-bold text-gray-800">{summary.toolStats.total}</span>
          </span>
          <span className="text-emerald-600">
            成功 <span className="text-lg font-bold">{summary.toolStats.success}</span>
          </span>
          {summary.toolStats.failed > 0 && (
            <span className="text-red-500">
              失败 <span className="text-lg font-bold">{summary.toolStats.failed}</span>
            </span>
          )}
        </div>
      </div>

      {/* Tool Breakdown */}
      {summary.toolBreakdown.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">工具明细</h4>
          <div className="rounded-xl border border-gray-100 overflow-hidden bg-white">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-1.5 text-sm font-medium text-gray-500">工具</th>
                  <th className="text-right px-3 py-1.5 text-sm font-medium text-gray-500">次数</th>
                  <th className="text-right px-3 py-1.5 text-sm font-medium text-gray-500">平均耗时</th>
                </tr>
              </thead>
              <tbody>
                {summary.toolBreakdown.map((tb: { name: string; count: number; avgLatency: number }) => (
                  <tr key={tb.name} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 text-[13px] text-gray-700">{tb.name}</td>
                    <td className="text-right px-3 py-1.5 text-[13px] text-gray-500">{tb.count}</td>
                    <td className="text-right px-3 py-1.5 text-[13px] text-gray-400">{tb.avgLatency}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Created Files */}
      {summary.createdFiles.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-gray-700 mb-2 flex items-center gap-1">
            <FileText size={12} />
            创建文件
          </h4>
          <div className="space-y-1">
            {summary.createdFiles.map((file: { filePath: string; fileName: string }) => (
              <FileItem key={file.filePath} file={file} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryStatusBadge({ status }: { status: ExecutionSummary['status'] }) {
  const config = {
    success: { label: '成功', cls: 'bg-emerald-50 text-emerald-600' },
    partial: { label: '部分完成', cls: 'bg-yellow-50 text-yellow-600' },
    failed: { label: '失败', cls: 'bg-red-50 text-red-600' },
  }
  const { label, cls } = config[status] as { label: string; cls: string }

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${cls}`}>
      {label}
    </span>
  )
}

function FileItem({ file }: { file: { filePath: string; fileName: string } }) {
  const [copied, setCopied] = useState(false)
  const requestOpenDocument = useStore(s => s.requestOpenDocument)
  const isMd = /\.(md|markdown)$/i.test(file.fileName)

  const handleCopy = () => {
    navigator.clipboard.writeText(file.filePath).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const handleView = () => {
    requestOpenDocument(file.filePath, file.fileName)
  }

  return (
    <div className="flex items-center gap-2 group px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">
      <FileText size={12} className="text-gray-400 shrink-0" />
      <span className="text-sm text-gray-600 truncate flex-1">{file.fileName}</span>
      {isMd && (
        <button
          onClick={handleView}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 transition-all"
          title="查看文档"
        >
          <Eye size={12} />
        </button>
      )}
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-all"
        title="复制路径"
      >
        {copied ? <CheckCircle2 size={12} className="text-emerald-500" /> : <Copy size={12} />}
      </button>
    </div>
  )
}

// ============================================
// Utils
// ============================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60000)
  const sec = Math.round((ms % 60000) / 1000)
  return `${min}m ${sec}s`
}
