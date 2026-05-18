/**
 * MarkdownDocPanel - Markdown 文档查看面板
 * 
 * 在右侧 Tab 中渲染 Markdown 文件内容，支持：
 * - 通过后端 API 读取文件
 * - 内容缓存
 * - 加载/错误状态
 * - 刷新 & 复制路径
 */

import { useState, useEffect, useCallback } from 'react'
import { FileText, Copy, CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react'
import { MarkdownRenderer } from './markdown/MarkdownRenderer'
import { getServerUrl } from '@/utils/env'

interface MarkdownDocPanelProps {
  filePath: string
  content?: string
  onContentLoaded?: (content: string) => void
}

export function MarkdownDocPanel({ filePath, content, onContentLoaded }: MarkdownDocPanelProps) {
  const [docContent, setDocContent] = useState<string>(content || '')
  const [loading, setLoading] = useState(!content)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const fileName = filePath.split(/[/\\]/).pop() || '文档'

  const loadContent = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const serverUrl = getServerUrl()
      const res = await fetch(`${serverUrl}/api/tools/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'readFile', args: { path: filePath } }),
      })
      if (!res.ok) throw new Error(`读取失败: ${res.status}`)
      const data = await res.json()
      if (data.status === 'error') {
        throw new Error(data.error || '读取文件失败')
      }
      const text = data.result ?? ''
      setDocContent(text)
      onContentLoaded?.(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取文件失败')
    } finally {
      setLoading(false)
    }
  }, [filePath, onContentLoaded])

  useEffect(() => {
    if (!content) loadContent()
  }, [filePath]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopyPath = () => {
    navigator.clipboard.writeText(filePath).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100 shrink-0">
        <FileText size={14} className="text-emerald-500 shrink-0" />
        <span className="text-sm font-medium text-gray-700 truncate">{fileName}</span>
        <span className="text-xs text-gray-400 truncate flex-1 ml-1">{filePath}</span>
        <button onClick={handleCopyPath} className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors" title="复制路径">
          {copied ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
        </button>
        <button onClick={loadContent} className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors" title="刷新">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
            <RefreshCw size={24} className="animate-spin" />
            <span className="text-sm">加载中...</span>
          </div>
        )}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <AlertCircle size={24} className="text-red-400" />
            <span className="text-sm text-red-500">{error}</span>
            <button onClick={loadContent} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600 transition-colors">
              重试
            </button>
          </div>
        )}
        {!loading && !error && docContent && (
          <MarkdownRenderer content={docContent} />
        )}
        {!loading && !error && !docContent && (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            文档内容为空
          </div>
        )}
      </div>
    </div>
  )
}
