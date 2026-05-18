/**
 * ArticleView — 自习室左栏: 文章展示 + 编辑
 *
 * 两种模式:
 * - preview: 渲染 Markdown (默认)
 * - edit: textarea 编辑源码
 *
 * 流式写入时自动切换到 preview 模式, 实时更新显示
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Pencil, Eye, Copy, Check } from 'lucide-react'

interface Props {
  document: string
  streaming?: boolean
  onDocumentChange: (newDoc: string) => void
}

export function ArticleView({ document, streaming, onDocumentChange }: Props) {
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [copied, setCopied] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 流式写入时自动滚动到底部
  useEffect(() => {
    if (streaming && previewRef.current) {
      previewRef.current.scrollTop = previewRef.current.scrollHeight
    }
  }, [document, streaming])

  // 流式写入时强制 preview 模式
  useEffect(() => {
    if (streaming) setMode('preview')
  }, [streaming])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(document)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard API may not be available */
    }
  }, [document])

  const handleEditChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onDocumentChange(e.target.value)
  }, [onDocumentChange])

  const isEmpty = !document.trim()

  const SERIF = "'Georgia', 'Noto Serif SC', 'SimSun', serif"

  return (
    <div className="flex flex-col h-full bg-[#fafaf8]">
      {/* 工具栏 (品牌对齐: SMALL CAPS 小标 + 琥珀按钮) */}
      <div className="flex items-center gap-1.5 px-5 py-3 border-b border-stone-200/80 bg-white/82 backdrop-blur-sm flex-shrink-0">
        <span
          className="text-[10px] font-black text-amber-700/80 uppercase tracking-[0.24em]"
        >
          Manuscript
        </span>
        <span className="w-px h-3 bg-amber-200/60 mx-1.5" aria-hidden />
        <span
          className="text-xs text-stone-500 mr-auto"
          style={{ fontFamily: SERIF }}
        >
          {streaming ? (
            <span className="text-amber-700 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
              正在书写
            </span>
          ) : isEmpty ? (
            <span className="italic text-stone-400">等待构思⋯</span>
          ) : (
            `${document.replace(/\s/g, '').length} 字`
          )}
        </span>

        {/* 模式切换 */}
        <button
          onClick={() => setMode('preview')}
          disabled={streaming}
          className={`p-1.5 rounded-md text-xs transition-colors ${
            mode === 'preview'
              ? 'bg-amber-100 text-amber-700 shadow-sm'
              : 'text-stone-400 hover:text-amber-700 hover:bg-amber-50/60'
          }`}
          title="预览"
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => { setMode('edit'); setTimeout(() => textareaRef.current?.focus(), 50) }}
          disabled={streaming}
          className={`p-1.5 rounded-md text-xs transition-colors ${
            mode === 'edit'
              ? 'bg-amber-100 text-amber-700 shadow-sm'
              : 'text-stone-400 hover:text-amber-700 hover:bg-amber-50/60'
          }`}
          title="编辑"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleCopy}
          disabled={isEmpty}
          className="p-1.5 rounded-md text-stone-400 hover:text-amber-700 hover:bg-amber-50/60 transition-colors disabled:opacity-30"
          title="复制全文"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* 内容区 (纸本质感底色) */}
      <div
        ref={previewRef}
        className="flex-1 overflow-y-auto min-h-0 bg-[linear-gradient(180deg,#fbfaf7_0%,#f3efe6_100%)]"
      >
        {isEmpty && !streaming ? (
          /* 空状态 (品牌统一: 琥珀 + SMALL CAPS) */
          <div className="flex items-center justify-center h-full px-8">
            <div className="text-center space-y-3 max-w-sm">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-amber-50 to-amber-100/60 border border-amber-200/60 mb-2">
                <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 3l4 4L7 21H3v-4L17 3z" />
                </svg>
              </div>
              <p className="text-[10px] font-black text-amber-700/80 uppercase tracking-[0.24em]">
                Blank Page
              </p>
              <p className="text-base text-stone-700" style={{ fontFamily: SERIF }}>
                在底部指令条告诉我你想写什么
              </p>
              <p className="text-xs text-stone-400 italic">
                例如："写一篇关于 AI 教育的分析报告"
              </p>
            </div>
          </div>
        ) : mode === 'edit' ? (
          /* 编辑模式 */
          <div className="mx-auto flex min-h-full max-w-[860px] px-5 py-6 lg:px-8 lg:py-8">
            <textarea
              ref={textareaRef}
              value={document}
              onChange={handleEditChange}
              className="min-h-[calc(100vh-260px)] w-full resize-none rounded-md border border-stone-200 bg-white px-8 py-7 text-sm leading-7 text-stone-800 shadow-[0_18px_45px_rgba(28,25,23,0.08)] outline-none transition-colors focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
              placeholder="在此编辑文章 Markdown..."
              spellCheck={false}
            />
          </div>
        ) : (
          /* 预览模式: 渲染 Markdown */
          <div className="mx-auto max-w-[860px] px-5 py-6 lg:px-8 lg:py-8">
            <article className="min-h-[calc(100vh-260px)] rounded-md border border-stone-200 bg-white px-8 py-8 shadow-[0_18px_45px_rgba(28,25,23,0.08)] sm:px-10">
              <div
                className="prose prose-stone prose-sm mx-auto max-w-[700px] leading-relaxed
                           prose-headings:text-stone-800 prose-headings:font-bold
                           prose-h1:text-2xl prose-h1:border-b prose-h1:border-stone-200 prose-h1:pb-3
                           prose-h2:text-lg prose-h2:mt-7
                           prose-p:text-stone-700 prose-p:leading-8
                           prose-a:text-amber-700 prose-a:no-underline hover:prose-a:underline
                           prose-blockquote:border-l-amber-300 prose-blockquote:bg-amber-50/40
                           prose-code:text-amber-700 prose-code:bg-amber-50 prose-code:px-1 prose-code:rounded"
              >
                <MarkdownRenderer content={document} />
              </div>
            </article>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 简易 Markdown 渲染器
 * 将 Markdown 文本转为 HTML (基础语法: 标题/段落/粗体/列表/引用/代码)
 * 不引入重型依赖 (react-markdown/remark 等), 保持轻量
 */
function MarkdownRenderer({ content }: { content: string }) {
  const html = markdownToHtml(content)
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}

function markdownToHtml(markdown: string): string {
  let html = markdown
    // 转义 HTML 特殊字符 (安全)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // 代码块 (```...```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) =>
    `<pre class="bg-stone-100 rounded-lg p-4 overflow-x-auto"><code>${code.trim()}</code></pre>`,
  )

  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // 标题
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // 粗体 + 斜体
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // 引用
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote><p>$1</p></blockquote>')

  // 无序列表
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)

  // 有序列表
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

  // 脚注引用 [^Lxx]
  html = html.replace(/\[\^([A-Z]\d+)\]/g, '<sup class="text-amber-600 cursor-help" title="引用 $1">[$1]</sup>')

  // 水平线
  html = html.replace(/^---$/gm, '<hr />')

  // 段落 (连续非空行)
  html = html.replace(/^(?!<[hublop]|<\/|<hr|<pre|<blockquote)(.+)$/gm, '<p>$1</p>')

  // 清理多余空行
  html = html.replace(/\n{3,}/g, '\n\n')

  return html
}
