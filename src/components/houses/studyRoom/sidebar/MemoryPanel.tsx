/**
 * MemoryPanel — 自习室记忆面板 (侧边栏子面板)
 *
 * 展示三块内容, 用户能看到系统到底记了什么:
 *   1. 本 session 召回的长期记忆 (memorySnippets, 从 /api/memory/search 拉)
 *   2. 风格档案 — 累积偏好 (writerProfile.preferences, localStorage)
 *   3. 风格档案 — 避免清单 (writerProfile.avoidPatterns)
 *   4. 体裁分布 (writerProfile.genreHistogram)
 *
 * 交互:
 *   - 每条偏好/避免支持删除
 *   - 导出为 JSON (下载)
 *   - 清空档案 (带二次确认)
 *   - 刷新召回 (触发 setMemorySnippets 的 refetch, 但不同于写作流里的召回, 这里只读)
 */

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, Trash2, Download, RefreshCw, ChevronDown, ChevronRight,
  Archive, BookMarked, Ban, BarChart3, AlertTriangle,
} from 'lucide-react'
import { useStore } from '@/store'
import {
  loadWriterProfile,
  type WriterProfile,
  type WriterPreference,
  type PreferenceCategory,
} from '@/services/studyRoom/writerProfile'

const SERIF = "'Georgia', 'Noto Serif SC', 'SimSun', serif"

const CATEGORY_LABEL: Record<PreferenceCategory, string> = {
  style: '语言风格',
  structure: '结构偏好',
  vocabulary: '词汇倾向',
  citation: '引用方式',
  topic: '话题倾向',
}

interface Props {
  /** 当前 session id, 用于关联刷新召回 */
  sessionId: string | null
  /** 关闭面板 */
  onClose: () => void
}

export function MemoryPanel({ sessionId, onClose }: Props) {
  // 注: StudyRoomSlice 的 session 字典已重命名为 studySessions, 避免和 SessionsSlice.sessions 撞名
  const session = useStore((s) => (sessionId ? s.studySessions[sessionId] : null))
  const memorySnippets = session?.memorySnippets || []

  const [profile, setProfile] = useState<WriterProfile>(() => loadWriterProfile())
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    recall: true,
    prefs: true,
    avoid: true,
    histogram: false,
  })

  // 档案可能被 toolCaller 异步写入, 监听 localStorage 变化刷新
  useEffect(() => {
    const reload = () => setProfile(loadWriterProfile())
    window.addEventListener('storage', reload)
    // 每 10 秒检查一次 (同窗口 localStorage 改动不触发 storage 事件)
    const timer = setInterval(reload, 10000)
    return () => {
      window.removeEventListener('storage', reload)
      clearInterval(timer)
    }
  }, [])

  const toggleSection = (key: string) => {
    setExpandedSections((s) => ({ ...s, [key]: !s[key] }))
  }

  // 删除一条偏好 (直接改 localStorage, 然后 reload)
  const handleDeletePreference = useCallback((id: string) => {
    const cur = loadWriterProfile()
    cur.preferences = cur.preferences.filter((p) => p.id !== id)
    cur.updatedAt = Date.now()
    try {
      localStorage.setItem('studyRoom:writerProfile', JSON.stringify(cur))
    } catch { /* 静默 */ }
    setProfile(cur)
  }, [])

  // 删除一条避免
  const handleDeleteAvoid = useCallback((idx: number) => {
    const cur = loadWriterProfile()
    cur.avoidPatterns = cur.avoidPatterns.filter((_, i) => i !== idx)
    cur.updatedAt = Date.now()
    try {
      localStorage.setItem('studyRoom:writerProfile', JSON.stringify(cur))
    } catch { /* 静默 */ }
    setProfile(cur)
  }, [])

  // 导出为 JSON
  const handleExport = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      sessionId,
      memorySnippets,
      writerProfile: profile,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `study-room-memory-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [sessionId, memorySnippets, profile])

  // 清空档案 (带确认)
  const handleClearProfile = useCallback(() => {
    const ok = window.confirm(
      '确认清空所有风格偏好、避免清单和体裁分布?\n\n' +
      `当前有 ${profile.preferences.length} 条偏好、${profile.avoidPatterns.length} 条避免。\n` +
      '(召回的长期记忆不会被清, 它们存在全局记忆系统中)',
    )
    if (!ok) return
    const empty: WriterProfile = {
      version: 1,
      preferences: [],
      avoidPatterns: [],
      genreHistogram: {},
      updatedAt: Date.now(),
    }
    try {
      localStorage.setItem('studyRoom:writerProfile', JSON.stringify(empty))
    } catch { /* 静默 */ }
    setProfile(empty)
  }, [profile])

  // 按 category 分组的偏好
  const prefsByCategory = profile.preferences.reduce<Record<string, WriterPreference[]>>(
    (acc, p) => {
      const key = p.category || 'style'
      if (!acc[key]) acc[key] = []
      acc[key].push(p)
      return acc
    }, {},
  )
  // 每组内按 confidence 倒序
  for (const k of Object.keys(prefsByCategory)) {
    prefsByCategory[k].sort((a, b) => b.confidence - a.confidence)
  }

  const histEntries = Object.entries(profile.genreHistogram).sort(([, a], [, b]) => (b || 0) - (a || 0))

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-amber-50/20 via-white to-stone-50/40">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-amber-100/60 bg-gradient-to-r from-amber-50/30 via-white/70 to-stone-50/40 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-amber-100/60 border border-amber-200/70 flex items-center justify-center flex-shrink-0">
            <Brain className="w-3.5 h-3.5 text-amber-700 stroke-[2.2]" />
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-black text-amber-700/70 uppercase tracking-[0.22em] leading-none">
              Memory
            </p>
            <h3 className="text-[14px] font-semibold text-stone-800 leading-tight mt-0.5" style={{ fontFamily: SERIF }}>
              记忆保存
            </h3>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-[11px] text-stone-400 hover:text-amber-700 px-2 py-1 rounded hover:bg-amber-50/60 transition-colors"
          title="收起面板"
        >
          收起 ▸
        </button>
      </div>

      {/* 操作栏 */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-stone-100 flex-shrink-0">
        <button
          onClick={handleExport}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-stone-600 hover:text-amber-700 hover:bg-amber-50/60 rounded transition-colors"
          title="导出为 JSON"
        >
          <Download className="w-3 h-3" /> 导出
        </button>
        <button
          onClick={() => setProfile(loadWriterProfile())}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-stone-600 hover:text-amber-700 hover:bg-amber-50/60 rounded transition-colors"
          title="刷新"
        >
          <RefreshCw className="w-3 h-3" /> 刷新
        </button>
        <div className="flex-1" />
        <button
          onClick={handleClearProfile}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-500 hover:text-red-700 hover:bg-red-50/60 rounded transition-colors"
          title="清空风格档案"
        >
          <Trash2 className="w-3 h-3" /> 清空档案
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Section 1: 长期记忆召回 */}
        <Section
          title="长期记忆 (本会话召回)"
          icon={<Archive className="w-3 h-3 text-amber-600" />}
          count={memorySnippets.length}
          expanded={expandedSections.recall}
          onToggle={() => toggleSection('recall')}
          hint="从全局记忆系统召回的相关片段, 仅作参考"
        >
          {memorySnippets.length === 0 ? (
            <EmptyHint text="暂无召回记忆" subtext="写作时会自动从全局记忆中召回相关内容" />
          ) : (
            <div className="space-y-1.5 pl-1">
              {memorySnippets.map((snip) => (
                <div
                  key={snip.id}
                  className="px-2.5 py-2 bg-white/80 border border-stone-100 rounded-md text-[11px] text-stone-700 leading-relaxed"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="px-1.5 py-0.5 bg-amber-100/60 text-amber-700 rounded text-[9px] font-mono">
                      {snip.source || 'unknown'}
                    </span>
                    {snip.score !== undefined && (
                      <span className="text-[9px] text-stone-400">
                        相关度 {(snip.score * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-3">{snip.content}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Section 2: 风格偏好 */}
        <Section
          title="风格偏好"
          icon={<BookMarked className="w-3 h-3 text-amber-600" />}
          count={profile.preferences.length}
          expanded={expandedSections.prefs}
          onToggle={() => toggleSection('prefs')}
          hint="用户累积的写作偏好, 会注入 prompt 作为硬约束"
        >
          {profile.preferences.length === 0 ? (
            <EmptyHint
              text="尚无累积偏好"
              subtext='在对话中告诉 AI "我喜欢用数据开头"等, 会自动归档到这里'
            />
          ) : (
            <div className="space-y-2 pl-1">
              {Object.entries(prefsByCategory).map(([cat, prefs]) => (
                <div key={cat}>
                  <p className="text-[9px] font-black text-stone-400 uppercase tracking-[0.18em] mb-1">
                    {CATEGORY_LABEL[cat as PreferenceCategory] || cat}
                  </p>
                  <AnimatePresence initial={false}>
                    {prefs.map((p) => (
                      <motion.div
                        key={p.id}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="group flex items-start gap-1.5 px-2 py-1.5 hover:bg-amber-50/40 rounded mb-0.5"
                      >
                        <span
                          className={`text-[10px] flex-shrink-0 mt-0.5 w-4 text-center ${
                            p.confidence >= 0.7
                              ? 'text-amber-600'
                              : p.confidence >= 0.5
                              ? 'text-stone-500'
                              : 'text-stone-300'
                          }`}
                          title={`置信度 ${(p.confidence * 100).toFixed(0)}%, ${p.signalCount} 次信号`}
                        >
                          {p.confidence >= 0.7 ? '★' : p.confidence >= 0.5 ? '·' : '○'}
                        </span>
                        <p className="flex-1 text-[11px] text-stone-700 leading-relaxed break-words">
                          {p.content}
                        </p>
                        <button
                          onClick={() => handleDeletePreference(p.id)}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 transition-all p-0.5"
                          title="删除这条偏好"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              ))}
              <p className="text-[9px] text-stone-400 px-2 pt-1 italic">
                ★ 强偏好 (≥70%) · 中偏好 (≥50%) ○ 待观察
              </p>
            </div>
          )}
        </Section>

        {/* Section 3: 避免清单 */}
        <Section
          title="明确避免"
          icon={<Ban className="w-3 h-3 text-red-500" />}
          count={profile.avoidPatterns.length}
          expanded={expandedSections.avoid}
          onToggle={() => toggleSection('avoid')}
          hint="用户明确反感的表达, AI 会严格规避"
        >
          {profile.avoidPatterns.length === 0 ? (
            <EmptyHint
              text="暂无避免清单"
              subtext='告诉 AI "别用套话" 等, 会记到这里'
            />
          ) : (
            <AnimatePresence initial={false}>
              <div className="space-y-1 pl-1">
                {profile.avoidPatterns.map((a, idx) => (
                  <motion.div
                    key={`${idx}-${a.slice(0, 20)}`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="group flex items-start gap-1.5 px-2 py-1.5 bg-red-50/40 border-l-2 border-red-200 hover:bg-red-50/60 rounded-r"
                  >
                    <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="flex-1 text-[11px] text-stone-700 leading-relaxed break-words">
                      {a}
                    </p>
                    <button
                      onClick={() => handleDeleteAvoid(idx)}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 transition-all p-0.5"
                      title="删除这条避免"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </motion.div>
                ))}
              </div>
            </AnimatePresence>
          )}
        </Section>

        {/* Section 4: 体裁分布 */}
        <Section
          title="体裁分布"
          icon={<BarChart3 className="w-3 h-3 text-stone-500" />}
          count={histEntries.length}
          expanded={expandedSections.histogram}
          onToggle={() => toggleSection('histogram')}
          hint="各体裁写作次数, 用于判断你的创作领域"
        >
          {histEntries.length === 0 ? (
            <EmptyHint text="暂无数据" subtext="完成一篇文章后会自动统计" />
          ) : (
            <div className="space-y-1 pl-1">
              {histEntries.map(([genre, count]) => {
                const total = histEntries.reduce((s, [, c]) => s + (c || 0), 0) || 1
                const pct = Math.round(((count || 0) / total) * 100)
                return (
                  <div key={genre} className="flex items-center gap-2 px-2 py-1">
                    <span className="text-[11px] text-stone-700 w-16 flex-shrink-0" style={{ fontFamily: SERIF }}>
                      {genre}
                    </span>
                    <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-400 to-amber-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-stone-500 w-10 text-right flex-shrink-0 font-mono">
                      {count} · {pct}%
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

// ---- 子组件 ----

interface SectionProps {
  title: string
  icon: React.ReactNode
  count: number
  expanded: boolean
  onToggle: () => void
  hint?: string
  children: React.ReactNode
}

function Section({ title, icon, count, expanded, onToggle, hint, children }: SectionProps) {
  return (
    <div className="border-b border-stone-100">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-amber-50/30 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
        )}
        {icon}
        <span className="text-[12px] font-semibold text-stone-700 flex-1" style={{ fontFamily: SERIF }}>
          {title}
        </span>
        <span className="text-[10px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded-full min-w-[22px] text-center">
          {count}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          {hint && (
            <p className="text-[10px] text-stone-400 italic mb-2 px-1 leading-relaxed">
              {hint}
            </p>
          )}
          {children}
        </div>
      )}
    </div>
  )
}

function EmptyHint({ text, subtext }: { text: string; subtext?: string }) {
  return (
    <div className="text-center py-4 px-2">
      <p className="text-[11px] text-stone-400">{text}</p>
      {subtext && <p className="text-[10px] text-stone-300 mt-1 italic leading-relaxed">{subtext}</p>}
    </div>
  )
}
