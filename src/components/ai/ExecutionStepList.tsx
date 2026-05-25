/**
 * ExecutionStepList - 执行步骤列表（区块1：执行记录）
 * 
 * 展示执行步骤流：thinking / tool_call / tool_result / output / error
 * 支持折叠/展开，完成后默认折叠
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import {
  CheckCircle2, AlertCircle, Loader2,
  Brain, Wrench, ChevronDown, ChevronRight,
} from 'lucide-react'
import type { ExecutionStep } from '@/types'

// ============================================
// Props
// ============================================

export interface ExecutionStepListProps {
  steps: ExecutionStep[]
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

// ============================================
// 主组件
// ============================================

export function ExecutionStepList({ steps, isCollapsed, onToggleCollapse }: ExecutionStepListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // 非折叠状态时自动滚动到底部
  useEffect(() => {
    if (!isCollapsed) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [steps.length, isCollapsed])

  const renderedSteps = useMemo(() => {
    return steps.map((step) => <StepItem key={step.id} step={step} />)
  }, [steps])

  // 折叠状态
  if (isCollapsed) {
    return (
      <div className="px-4 py-3">
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-2 w-full text-left text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ChevronRight size={14} className="shrink-0" />
          <span>展开执行详情 ({steps.length}步)</span>
        </button>
      </div>
    )
  }

  // 无步骤时显示等待
  if (steps.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
        <Loader2 size={16} className="animate-spin mr-2" />
        等待执行...
      </div>
    )
  }

  return (
    <div className="px-3 py-2">
      {/* 折叠按钮（有步骤且可折叠时） */}
      {onToggleCollapse && (
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-2 w-full text-left text-xs text-gray-400 hover:text-gray-600 mb-2 transition-colors"
        >
          <ChevronDown size={12} className="shrink-0" />
          <span>收起执行详情 ({steps.length}步)</span>
        </button>
      )}
      <div className="space-y-1">
        {renderedSteps}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ============================================
// StepItem 路由
// ============================================

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
