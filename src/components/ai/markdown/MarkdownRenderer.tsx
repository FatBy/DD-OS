import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'heading'
}

const components: Components = {
  h1: ({ children, ...props }) => {
    const text = String(children)
    return <h1 id={slugify(text)} {...props}>{children}</h1>
  },
  h2: ({ children, ...props }) => {
    const text = String(children)
    return <h2 id={slugify(text)} {...props}>{children}</h2>
  },
  h3: ({ children, ...props }) => {
    const text = String(children)
    return <h3 id={slugify(text)} {...props}>{children}</h3>
  },
  a: ({ children, href, ...props }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
  ),
  pre: ({ children, ...props }) => (
    <pre className="bg-gray-900/60 border border-white/10 rounded-lg p-4 overflow-x-auto" {...props}>
      {children}
    </pre>
  ),
  code: ({ children, className, ...props }) => {
    const isBlock = className?.includes('language-')
    if (isBlock) {
      return <code className={`${className || ''} text-sm`} {...props}>{children}</code>
    }
    return (
      <code className="text-emerald-400 bg-gray-800/50 px-1.5 py-0.5 rounded text-sm" {...props}>
        {children}
      </code>
    )
  },
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto my-4">
      <table className="min-w-full border border-gray-700/50 text-sm" {...props}>{children}</table>
    </div>
  ),
  th: ({ children, ...props }) => (
    <th className="bg-gray-800/60 border border-gray-700/50 px-3 py-2 text-left text-white/80 font-medium" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="border border-gray-700/50 px-3 py-2 text-gray-300" {...props}>{children}</td>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote className="border-l-4 border-cyan-500/40 pl-4 italic text-gray-400 my-4" {...props}>
      {children}
    </blockquote>
  ),
}

interface MarkdownRendererProps {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const rendered = useMemo(() => (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  ), [content])

  return (
    <div className={`prose prose-invert prose-sm max-w-none ${className || ''}`}>
      {rendered}
    </div>
  )
}
