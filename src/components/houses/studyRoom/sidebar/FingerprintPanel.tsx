/**
 * FingerprintPanel — 风格指纹面板 (侧边栏子面板)
 *
 * 展示:
 *   1. 已有指纹列表 (从后端 /api/study/fingerprints 拉, 失败降级到 localStorage)
 *   2. 每个指纹可:
 *      - 应用到当前 session (写 brief.fingerprintId)
 *      - 查看详情 (展开显示 Layer 1/2/3)
 *      - 删除
 *   3. 新建入口 "+ 从文档提炼" → 弹 DistillDialog
 *
 * 应用逻辑:
 *   - brief.fingerprintId 是 session 级, 只影响当前 session
 *   - 同时会写 localStorage 'studyRoom:activeFingerprintId' 做"最近应用"
 *   - 切换 session 后需要手动应用, 避免跨 session 污染
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Palette, Plus, Trash2, Check, ChevronDown, ChevronRight, Loader2,
  FileText, Sparkles, AlertCircle, Download, Layers, Terminal, Copy,
  MessageCircle, Wand2,
} from 'lucide-react'
import { useStore } from '@/store'
import type { WriterFingerprint, WriterFingerprintMeta, WriterFingerprintDistillLog, WriterFingerprintProfile } from '@/types'
import {
  listFingerprints,
  getFingerprint,
  deleteFingerprint,
  setActiveFingerprintId,
  getActiveFingerprintId,
  fingerprintToMarkdown,
  saveFingerprint,
} from '@/services/studyRoom/styleFingerprint'
import {
  PROFILE_FIELD_SPECS_BY_LAYER,
  renderProfileFieldValue,
  type ProfileFieldSpec,
} from '@/services/studyRoom/fingerprintSchema'
import { DistillDialog } from './DistillDialog'
import { streamChat, getLLMConfig } from '@/services/llmService'

const SERIF = "'Georgia', 'Noto Serif SC', 'SimSun', serif"

interface Props {
  /** 当前 session id, 用于写 brief.fingerprintId */
  sessionId: string | null
  /** 关闭面板 */
  onClose: () => void
}

export function FingerprintPanel({ sessionId, onClose }: Props) {
  const session = useStore((s) => (sessionId ? s.studySessions[sessionId] : null))
  const updateBriefFingerprint = useStore((s) => s.updateBriefFingerprint)

  const [metas, setMetas] = useState<WriterFingerprintMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailsCache, setDetailsCache] = useState<Record<string, WriterFingerprint>>({})
  const [showDistill, setShowDistill] = useState(false)
  /** 打磨模式目标: 不为 null 时打开对话框并传入 refineBase */
  const [refineTarget, setRefineTarget] = useState<WriterFingerprint | null>(null)
  const [chatEditTarget, setChatEditTarget] = useState<WriterFingerprint | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const activeId = session?.brief.fingerprintId || null
  // 全局"最近应用"仅用于 session 未指定时的展示暗示 (不自动应用)
  const lastUsedId = getActiveFingerprintId()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await listFingerprints()
      setMetas(list)
    } catch (err) {
      console.warn('[FingerprintPanel] list failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 展开查看详情 (按需拉)
  const handleToggleExpand = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (!detailsCache[id]) {
      const fp = await getFingerprint(id)
      if (fp) {
        setDetailsCache((c) => ({ ...c, [id]: fp }))
      }
    }
  }, [expandedId, detailsCache])

  // 应用到当前 session
  const handleApply = useCallback((id: string) => {
    if (!sessionId) {
      alert('请先创建或选择一个自习室会话, 再应用指纹')
      return
    }
    const newId = activeId === id ? null : id  // 再次点击取消应用
    updateBriefFingerprint(newId)
    setActiveFingerprintId(newId)  // 记录"最近应用"
  }, [sessionId, activeId, updateBriefFingerprint])

  // 删除指纹
  const handleDelete = useCallback(async (id: string, name: string) => {
    const ok = window.confirm(`确认删除文风指纹 "${name}"?\n此操作不可撤销。`)
    if (!ok) return
    setDeletingId(id)
    try {
      await deleteFingerprint(id)
      // 如果删的是当前应用的, 清空 brief 字段
      if (activeId === id && sessionId) {
        updateBriefFingerprint(null)
      }
      setMetas((list) => list.filter((m) => m.id !== id))
      setDetailsCache((c) => {
        const next = { ...c }
        delete next[id]
        return next
      })
      if (expandedId === id) setExpandedId(null)
    } catch (err) {
      alert(`删除失败: ${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setDeletingId(null)
    }
  }, [activeId, sessionId, updateBriefFingerprint, expandedId])

  // 打磨: 在已有指纹基础上用新稿件继续打磨
  const handleRefine = useCallback(async (id: string) => {
    let fp = detailsCache[id]
    if (!fp) {
      const fetched = await getFingerprint(id)
      if (!fetched) {
        alert('读取指纹详情失败, 无法打磨')
        return
      }
      fp = fetched
      setDetailsCache((c) => ({ ...c, [id]: fetched }))
    }
    setRefineTarget(fp)
  }, [detailsCache])

  const handleChatEdit = useCallback(async (id: string) => {
    let fp = detailsCache[id]
    if (!fp) {
      const fetched = await getFingerprint(id)
      if (!fetched) {
        alert('读取指纹详情失败，无法对话修改')
        return
      }
      fp = fetched
      setDetailsCache((c) => ({ ...c, [id]: fetched }))
    }
    setChatEditTarget(fp)
  }, [detailsCache])

  // 导出单个指纹为 md
  const handleExport = useCallback(async (id: string, name: string) => {
    let fp = detailsCache[id]
    if (!fp) {
      const fetched = await getFingerprint(id)
      if (!fetched) {
        alert('读取指纹详情失败')
        return
      }
      fp = fetched
      setDetailsCache((c) => ({ ...c, [id]: fetched }))
    }
    const md = fingerprintToMarkdown(fp)
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fingerprint-${name.replace(/[^\w\u4e00-\u9fa5-]/g, '_')}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [detailsCache])

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-amber-50/20 via-white to-stone-50/40">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-amber-100/60 bg-gradient-to-r from-amber-50/30 via-white/70 to-stone-50/40 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-amber-100/60 border border-amber-200/70 flex items-center justify-center flex-shrink-0">
            <Palette className="w-3.5 h-3.5 text-amber-700 stroke-[2.2]" />
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-black text-amber-700/70 uppercase tracking-[0.22em] leading-none">
              Fingerprint
            </p>
            <h3 className="text-[14px] font-semibold text-stone-800 leading-tight mt-0.5" style={{ fontFamily: SERIF }}>
              文风指纹
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
      <div className="px-4 py-2.5 border-b border-stone-100 flex-shrink-0">
        <button
          onClick={() => setShowDistill(true)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-amber-800 bg-gradient-to-b from-amber-50 to-amber-100/60 border border-amber-200 hover:border-amber-300 hover:from-amber-100/80 hover:to-amber-200/40 rounded-lg transition-colors shadow-sm"
          style={{ fontFamily: SERIF }}
        >
          <Plus className="w-3.5 h-3.5" />
          从文档提炼新风格
        </button>
      </div>

      {/* 当前 session 状态提示 */}
      {sessionId && activeId && (
        <div className="px-4 py-2 border-b border-amber-100/40 bg-amber-50/30 flex items-center gap-2 flex-shrink-0">
          <Sparkles className="w-3 h-3 text-amber-600 flex-shrink-0" />
          <p className="text-[10px] text-amber-800 flex-1 leading-relaxed">
            本会话正在应用:{' '}
            <span className="font-semibold" style={{ fontFamily: SERIF }}>
              {metas.find((m) => m.id === activeId)?.name || '(已删除)'}
            </span>
          </p>
        </div>
      )}
      {sessionId && !activeId && lastUsedId && metas.some((m) => m.id === lastUsedId) && (
        <div className="px-4 py-2 border-b border-stone-100 bg-stone-50/40 flex items-center gap-2 flex-shrink-0">
          <AlertCircle className="w-3 h-3 text-stone-400 flex-shrink-0" />
          <p className="text-[10px] text-stone-500 flex-1 leading-relaxed">
            本会话未应用指纹 (上次用过:{' '}
            <span className="text-stone-600">{metas.find((m) => m.id === lastUsedId)?.name}</span>)
          </p>
        </div>
      )}

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 text-stone-400 animate-spin" />
          </div>
        ) : metas.length === 0 ? (
          <div className="text-center py-10 px-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-br from-amber-50 to-amber-100/60 border border-amber-200/60 mb-3">
              <Palette className="w-5 h-5 text-amber-600" />
            </div>
            <p className="text-[12px] text-stone-600 mb-1" style={{ fontFamily: SERIF }}>
              还没有任何文风指纹
            </p>
            <p className="text-[10px] text-stone-400 italic leading-relaxed px-4">
              点击上方按钮, 从你已有的文章中
              <br />
              提炼一份文风模板
            </p>
          </div>
        ) : (
          <div className="py-1">
            {metas.map((m) => {
              const isActive = activeId === m.id
              const isExpanded = expandedId === m.id
              const detail = detailsCache[m.id]
              const isDeleting = deletingId === m.id

              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`border-b border-stone-100 ${isActive ? 'bg-amber-50/40' : ''}`}
                >
                  <div className="px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() => handleToggleExpand(m.id)}
                        className="mt-0.5 text-stone-400 hover:text-amber-700 transition-colors flex-shrink-0"
                        title={isExpanded ? '收起详情' : '展开详情'}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h4
                            className="text-[13px] font-semibold text-stone-800 truncate"
                            style={{ fontFamily: SERIF }}
                          >
                            {m.name}
                          </h4>
                          {isActive && (
                            <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                              <Check className="w-2.5 h-2.5" /> 应用中
                            </span>
                          )}
                        </div>
                        {m.description && (
                          <p className="text-[10px] text-stone-500 mt-0.5 line-clamp-2">
                            {m.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-stone-400">
                          <span className="flex items-center gap-0.5">
                            <FileText className="w-2.5 h-2.5" />
                            {m.sourceCount || 0} 篇
                          </span>
                          {m.sourceWordCount !== undefined && (
                            <span>{(m.sourceWordCount / 1000).toFixed(1)}k 字</span>
                          )}
                          <span className="truncate">
                            {new Date(m.updatedAt).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 操作按钮行 */}
                    <div className="flex items-center gap-1 mt-2 pl-5">
                      <button
                        onClick={() => handleApply(m.id)}
                        disabled={!sessionId}
                        className={`px-2.5 py-1 text-[10px] font-medium rounded transition-colors flex items-center gap-1 ${
                          isActive
                            ? 'bg-amber-100 text-amber-800 hover:bg-amber-200/80'
                            : 'bg-stone-100 text-stone-600 hover:bg-amber-100 hover:text-amber-800'
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                        title={!sessionId ? '先创建会话才能应用' : isActive ? '点击取消应用' : '应用到当前会话'}
                      >
                        {isActive ? (
                          <>取消应用</>
                        ) : (
                          <>
                            <Sparkles className="w-2.5 h-2.5" /> 应用到当前
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleRefine(m.id)}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] text-stone-600 hover:text-amber-800 hover:bg-amber-50/80 border border-transparent hover:border-amber-200 rounded transition-colors"
                        title="用新稿件继续打磨这个风格 (反复迭代)"
                      >
                        <Layers className="w-2.5 h-2.5" />
                        继续打磨
                      </button>
                      <button
                        onClick={() => handleChatEdit(m.id)}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] text-stone-600 hover:text-indigo-700 hover:bg-indigo-50/80 border border-transparent hover:border-indigo-200 rounded transition-colors"
                        title="用自然语言直接修改这份文风指纹"
                      >
                        <MessageCircle className="w-2.5 h-2.5" />
                        对话修改
                      </button>
                      <button
                        onClick={() => handleExport(m.id, m.name)}
                        className="px-2 py-1 text-[10px] text-stone-500 hover:text-amber-700 hover:bg-amber-50/60 rounded transition-colors"
                        title="导出为 Markdown"
                      >
                        <Download className="w-2.5 h-2.5" />
                      </button>
                      <div className="flex-1" />
                      <button
                        onClick={() => handleDelete(m.id, m.name)}
                        disabled={isDeleting}
                        className="px-2 py-1 text-[10px] text-stone-400 hover:text-red-500 hover:bg-red-50/60 rounded transition-colors disabled:opacity-40"
                        title="删除"
                      >
                        {isDeleting ? (
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-2.5 h-2.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* 展开详情: 三层内容 */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-3 pt-0 bg-stone-50/30 space-y-2">
                          {detail ? (
                            <FingerprintDetail fp={detail} />
                          ) : (
                            <div className="flex items-center gap-2 text-[11px] text-stone-400 py-3">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              读取详情...
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* 提炼对话框 (新建 or 打磨) */}
      {(showDistill || refineTarget) && (
        <DistillDialog
          refineBase={refineTarget}
          onClose={() => {
            setShowDistill(false)
            setRefineTarget(null)
          }}
          onSuccess={(fp) => {
            const wasRefine = !!refineTarget
            setShowDistill(false)
            setRefineTarget(null)
            refresh()
            // 打磨模式: id 不变, 刷新详情缓存, 保持展开
            if (wasRefine) {
              setDetailsCache((c) => ({ ...c, [fp.id]: fp }))
              setExpandedId(fp.id)
              return
            }
            // 新建模式: 询问是否应用到当前 session
            if (sessionId && window.confirm(`已提炼出文风 "${fp.name}"。\n\n是否立即应用到当前会话?`)) {
              updateBriefFingerprint(fp.id)
              setActiveFingerprintId(fp.id)
            }
          }}
        />
      )}

      {chatEditTarget && (
        <FingerprintChatEditDialog
          fingerprint={chatEditTarget}
          onClose={() => setChatEditTarget(null)}
          onSaved={(fp) => {
            setChatEditTarget(null)
            setDetailsCache((c) => ({ ...c, [fp.id]: fp }))
            setExpandedId(fp.id)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function extractJsonObject(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?\s*|\s*```$/gm, '').trim()
  try {
    return JSON.parse(stripped)
  } catch {
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(stripped.slice(start, end + 1))
    }
    throw new Error('模型没有返回可解析的 JSON')
  }
}

function normalizeEditedFingerprint(base: WriterFingerprint, parsed: unknown): WriterFingerprint {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('模型返回格式不是对象')
  }
  const raw = parsed as Partial<WriterFingerprint>
  return {
    ...base,
    ...raw,
    id: base.id,
    createdAt: base.createdAt,
    updatedAt: Date.now(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : base.name,
    description: typeof raw.description === 'string' ? raw.description : base.description,
    metrics: raw.metrics || base.metrics,
    profile: raw.profile || base.profile,
    samples: Array.isArray(raw.samples) ? raw.samples : base.samples,
    behaviorRules: Array.isArray(raw.behaviorRules) ? raw.behaviorRules : base.behaviorRules,
  }
}

function FingerprintChatEditDialog({
  fingerprint,
  onClose,
  onSaved,
}: {
  fingerprint: WriterFingerprint
  onClose: () => void
  onSaved: (fp: WriterFingerprint) => void
}) {
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<WriterFingerprint | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runEdit = useCallback(async () => {
    if (!instruction.trim() || busy) return
    setBusy(true)
    setError(null)
    setPreview(null)
    try {
      const config = getLLMConfig()
      if (!config.apiKey || !config.baseUrl || !config.model) {
        throw new Error('LLM 未配置，请先在设置中配置模型')
      }

      const currentJson = JSON.stringify(fingerprint, null, 2)
      const systemPrompt = [
        '你是 DunCrew 的文风指纹编辑器。',
        '用户会给你一份 WriterFingerprint JSON 和自然语言修改要求。',
        '你必须返回修改后的完整 WriterFingerprint JSON 对象，不要返回 Markdown，不要解释。',
        '必须保留 id、createdAt、sourceCount、sourceWordCount、metrics、samples 中没有被要求修改的内容。',
        '可以修改 name、description、profile、behaviorRules、samples 等字段。',
      ].join('\n')
      const userPrompt = `当前文风指纹:\n\`\`\`json\n${currentJson}\n\`\`\`\n\n修改要求:\n${instruction.trim()}\n\n请返回修改后的完整 JSON。`

      let output = ''
      const result = await streamChat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        (chunk) => { output += chunk },
        undefined,
        config,
      )
      const parsed = extractJsonObject(result.content || output)
      setPreview(normalizeEditedFingerprint(fingerprint, parsed))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [busy, fingerprint, instruction])

  const savePreview = useCallback(async () => {
    if (!preview || busy) return
    setBusy(true)
    setError(null)
    try {
      const saved = await saveFingerprint(preview)
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [busy, onSaved, preview])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        className="flex max-h-[86vh] w-[680px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-white to-stone-50 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-indigo-200 bg-indigo-100/80">
              <MessageCircle className="h-4 w-4 text-indigo-700" />
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-indigo-700/70">
                Edit Fingerprint
              </p>
              <h3 className="mt-0.5 text-[15px] font-semibold leading-tight text-stone-800" style={{ fontFamily: SERIF }}>
                对话修改：{fingerprint.name}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-stone-700">
              你想怎么改这份文风指纹？
            </label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={5}
              placeholder="例如：把表达调得更正式，减少口语化提示；保留长句和数据密集特征，但删掉过度营销化的措辞。"
              className="w-full resize-none rounded-lg border border-stone-200 bg-stone-50/50 px-3 py-2 text-sm leading-relaxed text-stone-800 outline-none transition-colors focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              disabled={busy}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {preview && (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/30 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-indigo-700" />
                <span className="text-[11px] font-semibold text-indigo-800">已生成修改预览</span>
              </div>
              <div className="max-h-[260px] overflow-y-auto rounded border border-stone-200 bg-white p-3 text-[11px] leading-relaxed text-stone-600">
                <FingerprintDetail fp={preview} />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-stone-100 bg-stone-50/50 px-5 py-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-40"
          >
            取消
          </button>
          <button
            onClick={runEdit}
            disabled={!instruction.trim() || busy}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && !preview ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            生成修改
          </button>
          <button
            onClick={savePreview}
            disabled={!preview || busy}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && preview ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            保存覆盖
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ---- 展开详情展示三层内容 ----

function FingerprintDetail({ fp }: { fp: WriterFingerprint }) {
  // Layer 1: 指标 (与 DistillPreview 对齐, 扩展展示新增的 9 个指标)
  const metricItems: Array<[string, string]> = []
  const m = fp.metrics || {}
  if (m.avgSentenceLen !== undefined) metricItems.push(['平均句长', `${m.avgSentenceLen.toFixed(1)} 字`])
  if (m.avgParagraphLen !== undefined) metricItems.push(['平均段长', `${m.avgParagraphLen.toFixed(0)} 字`])
  if (m.shortSentenceRate !== undefined) metricItems.push(['短句占比', `${Math.round(m.shortSentenceRate * 100)}%`])
  if (m.longSentenceRate !== undefined) metricItems.push(['长句占比', `${Math.round(m.longSentenceRate * 100)}%`])
  if (m.formalityScore !== undefined) {
    const tone = m.formalityScore > 0.3 ? '书面' : m.formalityScore < -0.3 ? '口语' : '中性'
    metricItems.push(['倾向', `${tone} (${m.formalityScore.toFixed(2)})`])
  }
  if (m.idiomDensity !== undefined) metricItems.push(['成语密度', `${m.idiomDensity.toFixed(1)}/千字`])
  if (m.firstPersonRate !== undefined) metricItems.push(['第一人称', `${m.firstPersonRate.toFixed(1)}/千字`])
  if (m.rhetoricRate !== undefined) metricItems.push(['设问/反问', `${m.rhetoricRate.toFixed(1)}/千字`])
  // 扩展指标 (支撑 Layer 2 的话语/态度/结构维度)
  if (m.conjunctionDensity !== undefined) metricItems.push(['关联词', `${m.conjunctionDensity.toFixed(1)}/千字`])
  if (m.modalDensity !== undefined) metricItems.push(['模态词', `${m.modalDensity.toFixed(1)}/千字`])
  if (m.questionDensity !== undefined) metricItems.push(['问句密度', `${m.questionDensity.toFixed(1)}/千字`])
  if (m.rhetoricalQuestionRate !== undefined) metricItems.push(['反问占比', `${Math.round(m.rhetoricalQuestionRate * 100)}%`])
  if (m.assertionDensity !== undefined) metricItems.push(['段首断言', `${Math.round(m.assertionDensity * 100)}%`])
  if (m.addressYou !== undefined) metricItems.push(['称"你"', `${m.addressYou.toFixed(1)}/千字`])
  if (m.addressYouFormal !== undefined) metricItems.push(['称"您"', `${m.addressYouFormal.toFixed(1)}/千字`])
  if (m.addressWe !== undefined) metricItems.push(['称"我们"', `${m.addressWe.toFixed(1)}/千字`])
  if (m.addressEveryone !== undefined) metricItems.push(['称"大家"', `${m.addressEveryone.toFixed(1)}/千字`])

  const profile = fp.profile || {}

  // Layer 2: 统计有值字段数 (含向后兼容的 opening/closing)
  const filledProfileCount = PROFILE_FIELD_SPECS_BY_LAYER.reduce((acc, group) => {
    return acc + group.fields.filter((spec) => renderProfileFieldValue(spec, profile[spec.key]) !== null).length
  }, 0) + (profile.opening && !profile.hookPattern ? 1 : 0) + (profile.closing && !profile.closingPattern ? 1 : 0)

  // L0: 行为规则折叠态 (默认收起, 面板空间紧凑, 避免规则过多把其他信息挤下去)
  const behaviorRules = fp.behaviorRules || []
  const [l0Expanded, setL0Expanded] = useState(false)

  return (
    <div className="space-y-2">
      {/* L0: 行为规则 (放最前面, 默认折叠) */}
      {behaviorRules.length > 0 && (
        <div>
          <button
            onClick={() => setL0Expanded((v) => !v)}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-md bg-emerald-50/50 border border-emerald-100 hover:bg-emerald-50/80 hover:border-emerald-200 transition-colors"
            title={l0Expanded ? '收起行为规则' : '展开行为规则'}
          >
            <span className="flex items-center gap-1.5">
              {l0Expanded ? (
                <ChevronDown className="w-3 h-3 text-emerald-700" />
              ) : (
                <ChevronRight className="w-3 h-3 text-emerald-700" />
              )}
              <span className="text-[9px] font-black text-emerald-700/90 uppercase tracking-[0.18em]">
                L0 · 行为规则
              </span>
              <span className="text-[10px] text-emerald-700/80 font-mono">
                ({behaviorRules.length})
              </span>
            </span>
            <span className="text-[9px] text-emerald-700/60">
              {l0Expanded ? '收起' : '展开'}
            </span>
          </button>
          <AnimatePresence initial={false}>
            {l0Expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <div className="space-y-1 mt-1.5">
                  {behaviorRules.map((rule, i) => {
                    // 阶段 1: 优先多例 examples[], 回退到单例 example (旧指纹兼容)
                    const exs = (rule.examples && rule.examples.length > 0)
                      ? rule.examples
                      : (rule.example ? [rule.example] : [])
                    return (
                      <div
                        key={i}
                        className="border border-emerald-100 rounded bg-emerald-50/25 px-2 py-1.5 space-y-0.5"
                      >
                        <div className="flex items-start gap-1 text-[10px] leading-relaxed">
                          <span className="font-semibold text-emerald-800 flex-shrink-0 w-8">When</span>
                          <span className="text-stone-700">{rule.when}</span>
                        </div>
                        <div className="flex items-start gap-1 text-[10px] leading-relaxed">
                          <span className="font-semibold text-emerald-800 flex-shrink-0 w-8">Do</span>
                          <span className="text-stone-700">{rule.do}</span>
                        </div>
                        <div className="flex items-start gap-1 text-[10px] leading-relaxed">
                          <span className="font-semibold text-emerald-800 flex-shrink-0 w-8">Not</span>
                          <span className="text-stone-500">{rule.not}</span>
                        </div>
                        {exs.length > 0 && (
                          <div className="flex items-start gap-1 text-[10px] leading-relaxed">
                            <span className="font-semibold text-emerald-800 flex-shrink-0 w-8">
                              {exs.length > 1 ? `Ex×${exs.length}` : 'Ex'}
                            </span>
                            <div className="flex-1 space-y-0.5">
                              {exs.map((ex, j) => (
                                <div
                                  key={j}
                                  className="text-stone-500 italic"
                                  style={{ fontFamily: SERIF }}
                                >
                                  {exs.length > 1 ? '· ' : ''}"{ex}"
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Layer 1: 指标 */}
      {metricItems.length > 0 && (
        <div>
          <p className="text-[9px] font-black text-stone-400 uppercase tracking-[0.18em] mb-1">
            结构指标
          </p>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {metricItems.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-[10px]">
                <span className="text-stone-500">{k}</span>
                <span className="text-stone-700 font-mono">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Layer 2: 画像 — 分 6 层渲染, 按 3 形态分支 */}
      {filledProfileCount > 0 && (
        <div>
          <p className="text-[9px] font-black text-stone-400 uppercase tracking-[0.18em] mb-1 mt-2">
            风格画像 ({filledProfileCount} 维)
          </p>
          <div className="space-y-1.5">
            {PROFILE_FIELD_SPECS_BY_LAYER.map((group) => {
              const renderedFields = group.fields
                .map((spec) => ({ spec, value: profile[spec.key] }))
                .filter(({ spec, value }) => renderProfileFieldValue(spec, value) !== null)
              const legacyOpening = group.layer === 'macro' && !profile.hookPattern && profile.opening
              const legacyClosing = group.layer === 'macro' && !profile.closingPattern && profile.closing
              if (renderedFields.length === 0 && !legacyOpening && !legacyClosing) return null
              return (
                <div key={group.layer}>
                  <p className="text-[9px] font-black text-amber-700/80 tracking-[0.1em] mb-0.5">
                    {group.label}
                  </p>
                  <div className="space-y-0.5 pl-1">
                    {legacyOpening && (
                      <FingerprintDetailRow label="开篇 (旧版)" shape="string" rendered={profile.opening!} />
                    )}
                    {renderedFields.map(({ spec, value }) => (
                      <FingerprintDetailRow
                        key={spec.key}
                        label={spec.label}
                        shape={spec.shape}
                        rendered={renderProfileFieldValue(spec, value)!}
                        rawValue={value}
                      />
                    ))}
                    {legacyClosing && (
                      <FingerprintDetailRow label="收束 (旧版)" shape="string" rendered={profile.closing!} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Layer 3: 范文 */}
      {fp.samples && fp.samples.length > 0 && (
        <div>
          <p className="text-[9px] font-black text-stone-400 uppercase tracking-[0.18em] mb-1 mt-2">
            范文样本 ({fp.samples.length})
          </p>
          <div className="space-y-1.5">
            {fp.samples.map((s, i) => (
              <div key={i} className="bg-white/70 border border-stone-200/70 rounded p-2">
                {s.source && (
                  <p className="text-[9px] text-stone-400 mb-1">
                    来自《{s.source}》{s.reason ? ` · ${s.reason}` : ''}
                  </p>
                )}
                <p
                  className="text-[10px] text-stone-600 leading-relaxed line-clamp-4"
                  style={{ fontFamily: SERIF }}
                >
                  {s.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 历史提炼日志: 保存后仍可回看"提炼过程" */}
      {fp.distillLog && fp.distillLog.length > 0 && (
        <DistillLogHistory logs={fp.distillLog} />
      )}
    </div>
  )
}

// ---- 单行画像字段渲染器 (FingerprintDetail 内用) ----
//
// 与 DistillDialog.tsx 里的 ProfileFieldRow 对应, 但样式更紧凑 (面板内空间小, 不加分隔线).
// 按 3 形态分支:
//   - string:    单行文字
//   - enum/enumPair: 小号 chip (primary 高亮, secondary 次级) + 描述
//   - appeal:    细进度条 (logos/pathos/ethos) + 描述
function FingerprintDetailRow({
  label,
  shape,
  rendered,
  rawValue,
}: {
  label: string
  shape: ProfileFieldSpec['shape']
  rendered: string
  rawValue?: WriterFingerprintProfile[keyof WriterFingerprintProfile]
}) {
  if (shape === 'appeal' && rawValue && typeof rawValue === 'object' && 'logos' in rawValue) {
    const v = rawValue as { logos: number; pathos: number; ethos: number; description: string }
    const pct = (n: number) => `${Math.round(n * 100)}%`
    return (
      <div className="text-[10px] leading-relaxed">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-stone-600 w-[68px] flex-shrink-0">{label}:</span>
          <div className="flex h-1.5 rounded-sm overflow-hidden bg-stone-100 flex-1" title={`逻辑${pct(v.logos)}/情感${pct(v.pathos)}/人格${pct(v.ethos)}`}>
            <div className="bg-indigo-400" style={{ width: pct(v.logos) }} />
            <div className="bg-rose-400" style={{ width: pct(v.pathos) }} />
            <div className="bg-emerald-400" style={{ width: pct(v.ethos) }} />
          </div>
          <span className="text-[9px] text-stone-500 font-mono flex-shrink-0">
            {pct(v.logos)}/{pct(v.pathos)}/{pct(v.ethos)}
          </span>
        </div>
        <p className="text-stone-700 pl-[72px] mt-0.5">{v.description}</p>
      </div>
    )
  }

  if ((shape === 'enum' || shape === 'enumPair') && rawValue && typeof rawValue === 'object') {
    // rendered 格式: "标签 — 描述", 从这里拆
    const dashIdx = rendered.indexOf(' — ')
    const chipText = dashIdx > 0 ? rendered.slice(0, dashIdx) : rendered
    const bodyText = dashIdx > 0 ? rendered.slice(dashIdx + 3) : ''
    return (
      <div className="text-[10px] leading-relaxed">
        <div className="flex items-start gap-1.5">
          <span className="font-semibold text-stone-600 w-[68px] flex-shrink-0 pt-0.5">{label}:</span>
          <div className="flex flex-wrap gap-1 flex-1">
            {chipText.split(' + ').map((part, i) => (
              <span
                key={i}
                className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                  i === 0
                    ? 'bg-amber-200/60 text-amber-900 font-semibold'
                    : 'bg-stone-100 text-stone-600'
                }`}
              >
                {part}
              </span>
            ))}
          </div>
        </div>
        {bodyText && <p className="text-stone-700 pl-[72px] mt-0.5">{bodyText}</p>}
      </div>
    )
  }

  // string / 向后兼容的旧字段
  return (
    <div className="text-[10px] leading-relaxed">
      <span className="font-semibold text-stone-600">{label}:</span>{' '}
      <span className="text-stone-700">{rendered}</span>
    </div>
  )
}

// ---- 历史提炼日志展示 (保存后回看) ----

function DistillLogHistory({ logs }: { logs: WriterFingerprintDistillLog[] }) {
  const [expanded, setExpanded] = useState(false)
  const [detailOpen, setDetailOpen] = useState<Record<number, boolean>>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  const levelColor: Record<WriterFingerprintDistillLog['level'], string> = {
    info: 'bg-stone-300',
    success: 'bg-green-500',
    warn: 'bg-amber-500',
    error: 'bg-red-500',
    data: 'bg-indigo-400',
  }
  const levelText: Record<WriterFingerprintDistillLog['level'], string> = {
    info: 'text-stone-500',
    success: 'text-green-700',
    warn: 'text-amber-700',
    error: 'text-red-700',
    data: 'text-indigo-700',
  }

  const formatTime = (t: number) => {
    const d = new Date(t)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  }

  const copyAll = async () => {
    const text = logs
      .map((l) => `[${formatTime(l.time)}] [${l.level}] ${l.label}${l.detail ? '\n' + l.detail : ''}`)
      .join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 忽略
    }
  }

  return (
    <div className="mt-2">
      <p className="text-[9px] font-black text-stone-400 uppercase tracking-[0.18em] mb-1">
        提炼过程 ({logs.length} 条)
      </p>
      <div className="border border-stone-200 rounded-md bg-white/60 overflow-hidden">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-[10px] text-stone-600 hover:bg-stone-100/70 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Terminal className="w-3 h-3" />
            <span className="font-semibold">{expanded ? '收起日志' : '查看提炼日志'}</span>
          </span>
          <span className="flex items-center gap-1">
            {expanded && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); copyAll() }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); copyAll() } }}
                className="text-stone-400 hover:text-stone-700 p-0.5 rounded cursor-pointer"
                title="复制全部日志"
              >
                <Copy className="w-3 h-3" />
              </span>
            )}
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
        </button>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-stone-200"
            >
              <div ref={scrollRef} className="max-h-[240px] overflow-y-auto p-1.5 space-y-0.5">
                {logs.map((log, i) => {
                  const isOpen = detailOpen[i]
                  const canExpand = !!log.detail
                  return (
                    <div key={i} className="text-[10px] leading-relaxed">
                      <div
                        className={`flex items-start gap-1.5 ${canExpand ? 'cursor-pointer hover:bg-stone-50' : ''} rounded px-1 py-0.5`}
                        onClick={() => canExpand && setDetailOpen((s) => ({ ...s, [i]: !s[i] }))}
                      >
                        <span className="font-mono text-stone-400 flex-shrink-0 pt-0.5 w-[52px]">
                          {formatTime(log.time)}
                        </span>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${levelColor[log.level]}`} />
                        <span className={`flex-1 ${levelText[log.level]}`}>
                          {log.label}
                        </span>
                        {canExpand && (
                          <span className="text-stone-400 flex-shrink-0 pt-0.5">
                            {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </span>
                        )}
                      </div>
                      {canExpand && isOpen && (
                        <pre className="ml-[64px] mr-1 mt-1 mb-1 px-2 py-1.5 text-[10px] text-stone-600 bg-stone-50 border border-stone-200 rounded font-mono whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
                          {log.detail}
                        </pre>
                      )}
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
