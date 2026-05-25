/**
 * ExecutionSummaryCard - 执行完成摘要卡片（区块2）
 * 
 * 展示执行完成后的结构化信息：
 * - 成功/失败状态 + 耗时
 * - 工具调用清单
 * - 产出文件列表
 * - 输出预览
 */

import { useState } from 'react'
import {
  CheckCircle2, AlertCircle, Clock,
  Wrench, FileText, ChevronDown, ChevronRight,
} from 'lucide-react'
import type { ExecutionSummary } from '@/types'

// ============================================
// Props
// ============================================

export interface ExecutionSummaryCardProps {
  summary: ExecutionSummary
  duration?: number  // ms, 由外部计算 (completedAt - openedAt)
}

// ============================================
// 主组件
// ============================================

export function ExecutionSummaryCard({ summary, duration }: ExecutionSummaryCardProps) {
  const [outputExpanded, setOutputExpanded] = useState(false)
  const isSuccess = summary.success
  const bgClass = isSuccess ? 'bg-emerald-50/50 border-emerald-100' : 'bg-red-50/50 border-red-100'

  // 计算耗时
  const durationMs = duration ?? 0

  return (
    <div className={`rounded-xl p-4 border mx-3 my-2 ${bgClass}`}>
      {/* 顶部：状态 + 耗时 */}
      <div className="flex items-center gap-3 mb-3">
        {isSuccess ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
            <CheckCircle2 size={12} />
            执行成功
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
            <AlertCircle size={12} />
            执行失败
          </span>
        )}
        {durationMs > 0 && (
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Clock size={12} />
            {formatDuration(durationMs)}
          </span>
        )}
      </div>

      {/* 工具清单 */}
      {summary.toolsUsed.length > 0 && (
        <div className="mb-3">
          <h4 className="text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1">
            <Wrench size={11} />
            工具调用
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {summary.toolsUsed.map((tool, i) => (
              <span
                key={`${tool.name}-${i}`}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${
                  tool.status === 'success'
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-red-50 text-red-600'
                }`}
              >
                {tool.status === 'success' ? (
                  <CheckCircle2 size={10} />
                ) : (
                  <AlertCircle size={10} />
                )}
                {tool.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 产出文件 */}
      {summary.filesCreated.length > 0 && (
        <div className="mb-3">
          <h4 className="text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1">
            <FileText size={11} />
            产出文件
          </h4>
          <div className="space-y-1">
            {summary.filesCreated.map((file, i) => (
              <div
                key={`${file.path}-${i}`}
                className="flex items-center gap-2 px-2 py-1 rounded-lg bg-white/60 text-[11px] text-gray-600"
              >
                <FileText size={10} className="text-gray-400 shrink-0" />
                <span className="truncate">{file.name}</span>
                <span className="text-[10px] text-gray-400 truncate ml-auto">{file.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 输出预览 */}
      {summary.outputPreview && (
        <div>
          <button
            onClick={() => setOutputExpanded(!outputExpanded)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            {outputExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>输出预览</span>
          </button>
          <div
            className={`mt-1 text-[11px] text-gray-500 whitespace-pre-wrap break-words ${
              outputExpanded ? '' : 'line-clamp-3'
            }`}
          >
            {summary.outputPreview}
          </div>
        </div>
      )}
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
