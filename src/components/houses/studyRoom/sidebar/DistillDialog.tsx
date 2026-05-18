/**
 * DistillDialog — 风格指纹"从文档提炼"对话框
 *
 * 流程:
 *   1. 用户选源: (a) 从 DunCrew-Data 下的文档列表勾选  (b) 直接粘贴文本
 *   2. 命名 + 可选描述
 *   3. 点"开始提炼" → 进度条
 *      - 阶段 1: POST /api/study/fingerprints/distill-prepare (读文档 + 算指标 + 选范文)
 *      - 阶段 2: 前端调 streamChat (用户配置的 LLM) 生成 Layer 2 画像
 *      - 阶段 3: PUT /api/study/fingerprints/:id 落盘
 *   4. 成功 → onSuccess(fp), 父组件可选是否立即应用到当前 session
 *
 * 关键设计:
 *   - 不阻塞 UI, 进度通过 onProgress 回调实时更新
 *   - 支持中途取消 (abortController)
 *   - 源文档最少 1 篇, 最多 10 篇 (避免 prompt 过大 + LLM 费用失控)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, FileText, Loader2, Search, Check, AlertCircle,
  Sparkles, FilePlus, ClipboardPaste, Clock,
  ChevronDown, ChevronRight, Layers, RotateCcw, Save,
  Terminal, Copy,
} from 'lucide-react'
import type { WriterFingerprint, WriterFingerprintProfile, WriterFingerprintMetrics, FingerprintBehaviorRule, WriterFingerprintSample } from '@/types'
import {
  distillFingerprint,
  commitDistilledFingerprint,
  MULTI_SAMPLE_THRESHOLD,
  type DistillProgress,
  type DistillLog,
  type LlmProfileResult,
  type LlmL0Result,
} from '@/services/studyRoom/styleFingerprint'
import {
  parseProfileFromLlm,
  buildProfileSchemaPrompt,
  PROFILE_FIELD_SPECS_BY_LAYER,
  renderProfileFieldValue,
} from '@/services/studyRoom/fingerprintSchema'
import { L0_EXTRACTION_SYSTEM_PROMPT, buildL0ExtractionPrompt } from '@/services/studyRoom/prompts'
import { streamChat, getLLMConfig } from '@/services/llmService'

const SERIF = "'Georgia', 'Noto Serif SC', 'SimSun', serif"
// 127.0.0.1 而非 localhost，避免被系统代理(Clash/V2rayN 等)劫持导致 ERR_EMPTY_RESPONSE
const API_BASE = 'http://127.0.0.1:3001'

const MAX_SOURCES = 10

interface DocItem {
  path: string
  name: string
  size: number
  updatedAt: number
}

interface Props {
  onClose: () => void
  onSuccess: (fp: WriterFingerprint) => void
  /**
   * 打磨模式: 传入已有指纹后, 对话框标题和提炼行为都会变:
   *   - 标题显示 "打磨文风: XX"
   *   - name / description 默认用旧值 (只读)
   *   - 新选的源会和旧样本合并后重新提炼, 覆盖保存到原 id
   */
  refineBase?: WriterFingerprint | null
}

type Tab = 'files' | 'paste'

export function DistillDialog({ onClose, onSuccess, refineBase = null }: Props) {
  const isRefine = !!refineBase
  const [tab, setTab] = useState<Tab>('files')

  // 文档列表
  const [docs, setDocs] = useState<DocItem[]>([])
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  // 粘贴文本
  const [pastedText, setPastedText] = useState('')
  const [pastedTitle, setPastedTitle] = useState('')

  // 指纹元信息 (打磨模式下用旧值作为初始值, 不允许改)
  const [name, setName] = useState(refineBase?.name || '')
  const [description, setDescription] = useState(refineBase?.description || '')

  // 提炼状态
  const [distilling, setDistilling] = useState(false)
  const [progress, setProgress] = useState<DistillProgress | null>(null)
  // preview 阶段的草稿 (独立保留, 即使 progress 变了也能回到预览)
  const [draft, setDraft] = useState<WriterFingerprint | null>(null)
  const [saving, setSaving] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // 拉文档列表
  useEffect(() => {
    let cancelled = false
    setLoadingDocs(true)
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    params.set('limit', '200')
    fetch(`${API_BASE}/api/study/documents?${params.toString()}`)
      .then((r) => r.ok ? r.json() : { documents: [] })
      .then((data) => {
        if (cancelled) return
        setDocs(data.documents || [])
      })
      .catch(() => {
        if (!cancelled) setDocs([])
      })
      .finally(() => {
        if (!cancelled) setLoadingDocs(false)
      })
    return () => { cancelled = true }
  }, [search])

  const toggleDoc = useCallback((path: string) => {
    setSelectedPaths((cur) => {
      const next = new Set(cur)
      if (next.has(path)) {
        next.delete(path)
      } else {
        if (next.size >= MAX_SOURCES) {
          alert(`最多选 ${MAX_SOURCES} 篇, 否则 LLM 处理不过来`)
          return cur
        }
        next.add(path)
      }
      return next
    })
  }, [])

  // 校验能否开始
  const canStart = (() => {
    if (!name.trim()) return false
    if (distilling) return false
    if (tab === 'files') return selectedPaths.size > 0
    if (tab === 'paste') return pastedText.trim().length > 200
    return false
  })()

  // LLM 画像生成器: 注入给 distillFingerprint
  // 返回 LlmProfileResult, 把 prompt / rawResponse 原样回传, 用于日志展示
  //
  // 解析行为 (由 parseProfileFromLlm 负责, 集中在 fingerprintSchema.ts):
  //   - 描述型 (string): 非空字符串直接采纳
  //   - 枚举型 ({type,description} / {primary,secondary?,description}): 枚举值必须在白名单内, description 必填
  //   - 配比型 (appealBalance): logos+pathos+ethos 超出 ±0.05 会被归一化到 1
  //   - 任何不合格字段会被丢弃并记入 warnings (用于提炼日志展示)
  const llmProfileDistiller = useCallback(async (args: {
    combinedText: string
    metrics: WriterFingerprintMetrics
    name: string
    sourceCount: number
    isMultiSample: boolean
    basePrompt?: {
      baseProfile: WriterFingerprintProfile
      baseName: string
    } | null
    onStream?: (event: { type: 'content' | 'reasoning'; delta: string; accumulated: string }) => void
  }): Promise<LlmProfileResult> => {
    const config = getLLMConfig()
    if (!config.apiKey || !config.baseUrl || !config.model) {
      throw new Error('LLM 未配置, 请先在设置中配置模型')
    }

    const metricsJson = JSON.stringify(args.metrics, null, 2)
    const snippet = args.combinedText.slice(0, 6000)
    const refineHint = args.basePrompt
      ? `\n注意: 这次是在已有风格画像基础上做迭代打磨, 请在保留原画像核心特征的前提下, 根据新样本修正和丰富细节。原画像仅作参考, 如新样本呈现出明显不同的倾向, 以新样本为准。`
      : ''
    const sampleHint = args.isMultiSample
      ? `样本数 ${args.sourceCount} 篇 (≥ ${MULTI_SAMPLE_THRESHOLD}), 意象/主题层维度可以归纳。`
      : `样本数 ${args.sourceCount} 篇 (< ${MULTI_SAMPLE_THRESHOLD}), 意象/主题层必须置 null, 严禁凭感觉编造 "高频意象 / 隐喻来源 / 引用偏好"。`

    const systemPrompt = `你是一个文风分析师。根据给定的文章样本和结构化指标, 归纳出一份包含 22 个维度的结构化"文风画像"。
画像必须具体、可操作, 让另一个 AI 看到后能照着写出相同风格的新文章。
分析时请同时参考 Layer 1 的量化指标 (如 conjunctionDensity / modalDensity / addressYou 等) 和原文样本, 如直觉与指标不符, 请以指标为锚重新判断。
${sampleHint}${refineHint}`

    const basePart = args.basePrompt
      ? `\n## 原有画像 (需在此基础上迭代打磨)\n\`\`\`json\n${JSON.stringify(args.basePrompt.baseProfile, null, 2)}\n\`\`\`\n`
      : ''

    const schemaPrompt = buildProfileSchemaPrompt(args.isMultiSample)

    const userPrompt = `风格命名: ${args.name}
${basePart}
## 结构化指标 (Layer 1, 量化锚点)
\`\`\`json
${metricsJson}
\`\`\`

## 文章样本 (前 6000 字)
${snippet}

## 输出任务
${schemaPrompt}`

    abortRef.current = new AbortController()

    // 流式转发: 把 streamChat 的 content / reasoning 增量通过 onStream 上报给 distillFingerprint,
    // 让执行日志面板能实时展示 LLM 正在"想什么 / 吐什么", 而不是干等 10-30 秒
    let contentAccum = ''
    let reasoningAccum = ''
    const result = await streamChat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      (chunk) => {
        contentAccum += chunk
        args.onStream?.({ type: 'content', delta: chunk, accumulated: contentAccum })
      },
      abortRef.current.signal,
      config,
      undefined,
      (chunk) => {
        reasoningAccum += chunk
        args.onStream?.({ type: 'reasoning', delta: chunk, accumulated: reasoningAccum })
      },
    )

    const rawResponse = result.content
    let content = rawResponse.trim()
    // 去掉可能的代码块包裹 (LLM 经常忽略 "不要代码块" 的指令)
    content = content.replace(/^```(?:json)?\s*|\s*```$/gm, '').trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error(`LLM 返回的 JSON 无法解析: ${content.slice(0, 200)}`)
    }

    // 严格解析: 每个字段按 shape 校验, 不合格直接丢弃, warnings 回写到 rawResponse 末尾供日志展示
    const { profile, warnings } = parseProfileFromLlm(parsed)
    const augmentedRawResponse = warnings.length > 0
      ? `${rawResponse}\n\n----- 解析 warnings -----\n${warnings.map((w) => '· ' + w).join('\n')}`
      : rawResponse

    return {
      profile,
      systemPrompt,
      userPrompt,
      rawResponse: augmentedRawResponse,
      reasoningContent: result.reasoningContent,
    }
  }, [])

  // L0 行为规则提取器: 基于 L1 画像+指标+原文, 提取可执行行为规则
  // 【打磨模式保护】接受 baseRules 参数, 把旧规则透传给 prompt 作为迭代锚点
  const llmL0Extractor = useCallback(async (args: {
    profile: WriterFingerprintProfile
    metricsJson: string
    combinedText: string
    name: string
    baseRules?: FingerprintBehaviorRule[]
    onStream?: (event: { type: 'content' | 'reasoning'; delta: string; accumulated: string }) => void
  }): Promise<LlmL0Result> => {
    const config = getLLMConfig()
    if (!config.apiKey || !config.baseUrl || !config.model) {
      throw new Error('LLM 未配置, 请先在设置中配置模型')
    }

    const snippet = args.combinedText.slice(0, 8000)
    const systemPrompt = L0_EXTRACTION_SYSTEM_PROMPT
    const userPrompt = buildL0ExtractionPrompt(args.profile, args.metricsJson, snippet, args.name, args.baseRules)

    const l0Abort = new AbortController()

    let contentAccum = ''
    let reasoningAccum = ''
    const result = await streamChat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      (chunk) => {
        contentAccum += chunk
        args.onStream?.({ type: 'content', delta: chunk, accumulated: contentAccum })
      },
      l0Abort.signal,
      config,
      undefined,
      (chunk) => {
        reasoningAccum += chunk
        args.onStream?.({ type: 'reasoning', delta: chunk, accumulated: reasoningAccum })
      },
    )

    const rawResponse = result.content
    let content = rawResponse.trim()
    content = content.replace(/^```(?:json)?\s*|\s*```$/gm, '').trim()

    let parsed: { rules?: unknown[]; samples?: unknown[] }
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error(`L0 LLM 返回的 JSON 无法解析: ${content.slice(0, 200)}`)
    }

    // 解析 rules
    // 【阶段 1】examples 升格为主字段 (多源印证 ≥ 2 条), example 单数保留向后兼容
    const rules: FingerprintBehaviorRule[] = []
    if (Array.isArray(parsed.rules)) {
      for (const raw of parsed.rules) {
        if (raw && typeof raw === 'object') {
          const r = raw as Record<string, unknown>
          const when = typeof r.when === 'string' ? r.when.trim() : ''
          const doField = typeof r.do === 'string' ? r.do.trim() : ''
          const not = typeof r.not === 'string' ? r.not.trim() : ''
          if (when && doField && not) {
            const rule: FingerprintBehaviorRule = { when, do: doField, not }

            // 优先读多例字段 examples[], 再回退到旧单例字段 example
            if (Array.isArray(r.examples)) {
              const exs = r.examples
                .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
                .map((s) => s.trim())
              if (exs.length > 0) rule.examples = exs
            }
            if (typeof r.example === 'string' && r.example.trim()) {
              // 同时把单例写入 rule.example 保留旧字段 (不覆盖已有 examples)
              rule.example = r.example.trim()
              // 如果 LLM 只给了单例而没给 examples 数组, 把它升级成单元素数组
              // 让渲染层统一走 examples 路径
              if (!rule.examples || rule.examples.length === 0) {
                rule.examples = [rule.example]
              }
            }
            rules.push(rule)
          }
        }
      }
    }

    // 解析 samples (可选)
    const samples: WriterFingerprintSample[] = []
    if (Array.isArray(parsed.samples)) {
      for (const raw of parsed.samples) {
        if (raw && typeof raw === 'object') {
          const s = raw as Record<string, unknown>
          const text = typeof s.text === 'string' ? s.text.trim() : ''
          if (text.length > 50) {
            samples.push({
              text,
              reason: typeof s.reason === 'string' ? s.reason.trim() : undefined,
            })
          }
        }
      }
    }

    return {
      rules,
      samples: samples.length > 0 ? samples : undefined,
      systemPrompt,
      userPrompt,
      rawResponse,
      reasoningContent: result.reasoningContent,
    }
  }, [])

  const runDistill = useCallback(async () => {
    const sources = tab === 'files'
      ? Array.from(selectedPaths).map((p) => ({ path: p }))
      : [{ text: pastedText, title: pastedTitle.trim() || '粘贴文本' }]

    setDistilling(true)
    setDraft(null)
    setProgress({ stage: 'reading', progress: 5, message: '开始...', logs: [] })

    try {
      const result = await distillFingerprint(
        {
          sources,
          name: name.trim(),
          description: description.trim() || undefined,
          refineBase,
        },
        (p) => setProgress(p),
        llmProfileDistiller,
        llmL0Extractor,
      )
      // 进入 preview: 停在对话框里, 等用户确认保存
      setDraft(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setProgress((cur) => ({
        stage: 'error',
        progress: 0,
        message: msg,
        error: msg,
        logs: cur?.logs || [],
      }))
    } finally {
      setDistilling(false)
    }
  }, [tab, selectedPaths, pastedText, pastedTitle, name, description, refineBase, llmProfileDistiller, llmL0Extractor])

  const handleStart = useCallback(() => {
    if (!canStart) return
    runDistill()
  }, [canStart, runDistill])

  // 预览阶段: 用同样的源再跑一次 (给不同的随机性结果)
  const handleRetry = useCallback(() => {
    runDistill()
  }, [runDistill])

  // 预览阶段: 确认保存草稿
  const handleSave = useCallback(async () => {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await commitDistilledFingerprint(draft, (p) => setProgress(p))
      onSuccess(saved)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setProgress((cur) => ({
        stage: 'error',
        progress: 0,
        message: msg,
        error: msg,
        logs: cur?.logs || [],
      }))
    } finally {
      setSaving(false)
    }
  }, [draft, onSuccess])

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
    }
    onClose()
  }, [onClose])

  // 是否处于 preview 阶段 (有 draft 且没在 distilling / saving)
  const isPreview = !!draft && !distilling && !saving && progress?.stage === 'preview'
  // 是否处于错误阶段
  const isError = progress?.stage === 'error'
  // 是否在"进行中"状态 (含 saving)
  const busy = distilling || saving

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-sm"
      onClick={(e) => {
        // 点击背景关闭 (未提炼中才允许)
        if (e.target === e.currentTarget && !distilling) onClose()
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 20 }}
        className="w-[560px] max-w-[92vw] max-h-[85vh] flex flex-col bg-white rounded-xl shadow-2xl border border-stone-200 overflow-hidden"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-amber-100/70 bg-gradient-to-r from-amber-50/50 via-white to-stone-50/40 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-amber-100/80 border border-amber-200 flex items-center justify-center">
              {isRefine ? (
                <Layers className="w-4 h-4 text-amber-700" />
              ) : (
                <Sparkles className="w-4 h-4 text-amber-700" />
              )}
            </div>
            <div>
              <p className="text-[9px] font-black text-amber-700/70 uppercase tracking-[0.22em] leading-none">
                {isRefine ? 'Refine Fingerprint' : 'Distill Fingerprint'}
              </p>
              <h3 className="text-[15px] font-semibold text-stone-800 leading-tight mt-0.5" style={{ fontFamily: SERIF }}>
                {isRefine ? `打磨文风：${refineBase!.name}` : '从文档提炼文风'}
              </h3>
              {isRefine && (
                <p className="text-[10px] text-stone-500 mt-0.5">
                  已收录 {refineBase!.sourceCount || 0} 篇 / {((refineBase!.sourceWordCount || 0) / 1000).toFixed(1)}k 字 · 再喂新稿件继续迭代
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleCancel}
            disabled={busy}
            className="text-stone-400 hover:text-stone-700 disabled:opacity-40 p-1 rounded hover:bg-stone-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {isPreview && draft ? (
            <DistillPreview
              draft={draft}
              logs={progress?.logs || []}
              isRefine={isRefine}
            />
          ) : busy || isError ? (
            <DistillingProgress progress={progress} />
          ) : (
            <div className="p-5 space-y-4">
              {/* 命名 */}
              <div>
                <label className="text-[11px] font-semibold text-stone-700 block mb-1.5">
                  指纹名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如: 严肃学术体 / 钱钟书风 / 自黑自嘲口语"
                  className="w-full px-3 py-2 text-[13px] border border-stone-200 rounded-md focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:bg-stone-50 disabled:text-stone-500"
                  style={{ fontFamily: SERIF }}
                  maxLength={50}
                  disabled={isRefine}
                  title={isRefine ? '打磨模式下名称沿用原指纹' : undefined}
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-stone-700 block mb-1.5">
                  描述 <span className="text-stone-400 font-normal">(可选)</span>
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="这个风格的用途或特点, 一句话即可"
                  className="w-full px-3 py-2 text-[12px] border border-stone-200 rounded-md focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                  maxLength={120}
                />
              </div>

              {/* 源选择: Tab 切换 */}
              <div>
                <label className="text-[11px] font-semibold text-stone-700 block mb-1.5">
                  {isRefine ? '新增稿件' : '源文档'} <span className="text-red-500">*</span>
                  <span className="text-stone-400 font-normal ml-1">
                    (最多 {MAX_SOURCES} 篇)
                  </span>
                </label>
                <div className="flex border border-stone-200 rounded-md p-0.5 bg-stone-50 mb-2">
                  <button
                    onClick={() => setTab('files')}
                    className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[11px] rounded transition-colors ${
                      tab === 'files'
                        ? 'bg-white text-amber-800 font-semibold shadow-sm'
                        : 'text-stone-500 hover:text-stone-700'
                    }`}
                  >
                    <FileText className="w-3 h-3" />
                    从已有文档选
                  </button>
                  <button
                    onClick={() => setTab('paste')}
                    className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[11px] rounded transition-colors ${
                      tab === 'paste'
                        ? 'bg-white text-amber-800 font-semibold shadow-sm'
                        : 'text-stone-500 hover:text-stone-700'
                    }`}
                  >
                    <ClipboardPaste className="w-3 h-3" />
                    直接粘贴文本
                  </button>
                </div>

                {tab === 'files' && (
                  <FileSelector
                    docs={docs}
                    loading={loadingDocs}
                    search={search}
                    onSearchChange={setSearch}
                    selectedPaths={selectedPaths}
                    onToggle={toggleDoc}
                    formatTime={formatTime}
                  />
                )}

                {tab === 'paste' && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={pastedTitle}
                      onChange={(e) => setPastedTitle(e.target.value)}
                      placeholder="样本标题 (可选)"
                      className="w-full px-2.5 py-1.5 text-[12px] border border-stone-200 rounded focus:outline-none focus:border-amber-400"
                    />
                    <textarea
                      value={pastedText}
                      onChange={(e) => setPastedText(e.target.value)}
                      placeholder="粘贴 1-3 篇代表性文本, 越多越好 (至少 200 字)"
                      rows={8}
                      className="w-full px-3 py-2 text-[12px] border border-stone-200 rounded-md focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 font-mono leading-relaxed"
                    />
                    <p className="text-[10px] text-stone-400">
                      当前 {pastedText.replace(/\s/g, '').length} 字
                      {pastedText.replace(/\s/g, '').length < 200 && (
                        <span className="text-amber-600 ml-1">(建议至少 200 字才有统计意义)</span>
                      )}
                    </p>
                  </div>
                )}
              </div>

              {/* 提示 */}
              <div className="flex items-start gap-2 text-[10px] text-stone-500 bg-amber-50/40 border border-amber-100 rounded-md px-3 py-2 leading-relaxed">
                <AlertCircle className="w-3 h-3 text-amber-600 flex-shrink-0 mt-0.5" />
                <p>
                  {isRefine ? (
                    <>打磨模式会把<strong>旧范文 + 新稿件</strong>合并喂给 LLM, 在原画像基础上修正细节。你可以反复用不同稿子打磨同一种风格。</>
                  ) : (
                    <>提炼过程会调用你当前配置的 LLM. 样本越多越能提炼出稳定风格 (建议 3+ 篇 / 总字数 3000+). 提炼完会先<strong>预览</strong>, 确认无误再保存。</>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 — 根据阶段切换 */}
        {isPreview ? (
          <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-stone-100 bg-stone-50/60 flex-shrink-0">
            <button
              onClick={handleRetry}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-stone-600 hover:bg-stone-100 rounded transition-colors disabled:opacity-40"
              title="用同样的源再跑一次 LLM, 看看有没有更满意的结果"
            >
              <RotateCcw className="w-3 h-3" />
              再试一次
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="px-4 py-1.5 text-[12px] text-stone-600 hover:bg-stone-100 rounded transition-colors disabled:opacity-40"
              >
                放弃
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-semibold text-white bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 rounded shadow-sm disabled:opacity-40 transition-all"
              >
                {saving ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                {isRefine ? '覆盖保存' : '保存指纹'}
              </button>
            </div>
          </div>
        ) : isError ? (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-stone-100 bg-stone-50/60 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-[12px] text-stone-600 hover:bg-stone-100 rounded transition-colors"
            >
              关闭
            </button>
            <button
              onClick={handleRetry}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-semibold text-white bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 rounded shadow-sm"
            >
              <RotateCcw className="w-3 h-3" />
              重试
            </button>
          </div>
        ) : !busy ? (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-stone-100 bg-stone-50/60 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-[12px] text-stone-600 hover:bg-stone-100 rounded transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleStart}
              disabled={!canStart}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-semibold text-white bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 rounded shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {isRefine ? <Layers className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
              {isRefine ? '开始打磨' : '开始提炼'}
            </button>
          </div>
        ) : null}
      </motion.div>
    </motion.div>
  )
}

// ---- 文档选择子组件 ----

interface FileSelectorProps {
  docs: DocItem[]
  loading: boolean
  search: string
  onSearchChange: (v: string) => void
  selectedPaths: Set<string>
  onToggle: (path: string) => void
  formatTime: (ts: number) => string
}

function FileSelector({
  docs, loading, search, onSearchChange, selectedPaths, onToggle, formatTime,
}: FileSelectorProps) {
  return (
    <div className="border border-stone-200 rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-stone-100 bg-stone-50/60">
        <Search className="w-3 h-3 text-stone-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="按文件名搜索..."
          className="flex-1 text-[11px] bg-transparent border-none focus:outline-none"
        />
        <span className="text-[10px] text-stone-400">
          已选 {selectedPaths.size}
        </span>
      </div>
      <div className="max-h-[220px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-3.5 h-3.5 text-stone-400 animate-spin" />
          </div>
        ) : docs.length === 0 ? (
          <div className="text-center py-6 px-3">
            <FilePlus className="w-5 h-5 text-stone-300 mx-auto mb-1" />
            <p className="text-[11px] text-stone-400">
              {search ? '没有匹配的文档' : '暂无可用文档'}
            </p>
            <p className="text-[10px] text-stone-300 mt-1 leading-relaxed">
              文档扫描路径: DunCrew-Data/documents、nexuses、study/_exports
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {docs.map((doc) => {
              const isSelected = selectedPaths.has(doc.path)
              return (
                <motion.button
                  key={doc.path}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={() => onToggle(doc.path)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left border-b border-stone-50 last:border-b-0 hover:bg-amber-50/40 transition-colors ${
                    isSelected ? 'bg-amber-50/60' : ''
                  }`}
                >
                  <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                    isSelected
                      ? 'border-amber-500 bg-amber-500'
                      : 'border-stone-300 bg-white'
                  }`}>
                    {isSelected && <Check className="w-2 h-2 text-white stroke-[3]" />}
                  </div>
                  <FileText className="w-3 h-3 text-stone-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-stone-700 truncate">
                      {doc.name}
                    </p>
                    <p className="text-[9px] text-stone-400 truncate">
                      {doc.path}
                    </p>
                  </div>
                  <span className="text-[9px] text-stone-400 flex items-center gap-0.5 flex-shrink-0">
                    <Clock className="w-2.5 h-2.5" />
                    {formatTime(doc.updatedAt)}
                  </span>
                  <span className="text-[9px] text-stone-400 font-mono flex-shrink-0 w-10 text-right">
                    {(doc.size / 1024).toFixed(1)}k
                  </span>
                </motion.button>
              )
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}

// ---- 进度条子组件 ----

const STAGE_LABEL: Record<DistillProgress['stage'], string> = {
  reading: '① 读取源文档',
  metrics: '② 计算结构指标',
  llm_profile: '③ LLM 归纳风格画像',
  llm_l0: '④ LLM 提取行为规则',
  llm_samples: '⑤ 挑选范文样本',
  preview: '⑥ 预览待确认',
  saving: '⑦ 保存指纹',
  done: '完成',
  error: '出错',
}

function DistillingProgress({ progress }: { progress: DistillProgress | null }) {
  if (!progress) {
    return (
      <div className="p-8 text-center">
        <Loader2 className="w-5 h-5 text-stone-400 animate-spin mx-auto mb-2" />
        <p className="text-[12px] text-stone-500">准备中...</p>
      </div>
    )
  }

  const isError = progress.stage === 'error'
  const isDone = progress.stage === 'done'

  return (
    <div className="p-6 space-y-4">
      {/* 进度条 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-semibold text-stone-700" style={{ fontFamily: SERIF }}>
            {STAGE_LABEL[progress.stage]}
          </span>
          <span className="text-[11px] text-stone-500 font-mono">
            {progress.progress}%
          </span>
        </div>
        <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress.progress}%` }}
            transition={{ duration: 0.3 }}
            className={`h-full ${
              isError
                ? 'bg-red-500'
                : isDone
                ? 'bg-green-500'
                : 'bg-gradient-to-r from-amber-400 to-amber-500'
            }`}
          />
        </div>
      </div>

      {/* 当前消息 */}
      <div className={`rounded-md px-3 py-2.5 text-[11px] leading-relaxed flex items-start gap-2 ${
        isError
          ? 'bg-red-50 border border-red-200 text-red-700'
          : isDone
          ? 'bg-green-50 border border-green-200 text-green-700'
          : 'bg-amber-50/50 border border-amber-100 text-stone-700'
      }`}>
        {isError ? (
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        ) : isDone ? (
          <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        ) : (
          <Loader2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 animate-spin" />
        )}
        <p className="whitespace-pre-wrap">{progress.message}</p>
      </div>

      {/* 阶段列表 (可视化) */}
      <div className="space-y-1 text-[10px] text-stone-400">
        {(['reading', 'metrics', 'llm_profile', 'llm_l0', 'preview', 'saving'] as const).map((s) => {
          const order = { reading: 1, metrics: 2, llm_profile: 3, llm_l0: 4, preview: 5, saving: 6 }
          const curOrder = order[progress.stage as keyof typeof order] || (isDone ? 6 : 0)
          const passed = order[s] < curOrder || isDone
          const active = progress.stage === s
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${
                passed ? 'bg-green-500' : active ? 'bg-amber-500 animate-pulse' : 'bg-stone-300'
              }`} />
              <span className={passed ? 'text-stone-500' : active ? 'text-amber-700 font-semibold' : ''}>
                {STAGE_LABEL[s]}
              </span>
            </div>
          )
        })}
      </div>

      {/* 执行日志时间线 */}
      <LogTimeline logs={progress.logs || []} defaultExpanded />
    </div>
  )
}

// ---- 日志时间线 ----

function LogTimeline({
  logs,
  defaultExpanded = false,
  title = '执行日志',
}: {
  logs: DistillLog[]
  defaultExpanded?: boolean
  title?: string
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [detailOpen, setDetailOpen] = useState<Record<number, boolean>>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  // 新日志自动滚到底
  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs.length, expanded])

  if (!logs || logs.length === 0) return null

  const levelColor: Record<DistillLog['level'], string> = {
    info: 'text-stone-500 bg-stone-300',
    success: 'text-green-700 bg-green-500',
    warn: 'text-amber-700 bg-amber-500',
    error: 'text-red-700 bg-red-500',
    data: 'text-indigo-700 bg-indigo-400',
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
    <div className="border border-stone-200 rounded-md bg-stone-50/40 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-stone-600 hover:bg-stone-100/70 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Terminal className="w-3 h-3" />
          <span className="font-semibold">{title}</span>
          <span className="text-stone-400">({logs.length})</span>
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
            <div ref={scrollRef} className="max-h-[260px] overflow-y-auto p-2 space-y-1">
              {logs.map((log, i) => {
                const isOpen = detailOpen[i]
                const canExpand = !!log.detail
                return (
                  <div key={i} className="text-[10px] leading-relaxed">
                    <div
                      className={`flex items-start gap-2 ${canExpand ? 'cursor-pointer hover:bg-white/80' : ''} rounded px-1.5 py-1`}
                      onClick={() => canExpand && setDetailOpen((s) => ({ ...s, [i]: !s[i] }))}
                    >
                      <span className="font-mono text-stone-400 flex-shrink-0 pt-0.5 w-[52px]">
                        {formatTime(log.time)}
                      </span>
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${levelColor[log.level].split(' ')[1]}`}
                      />
                      <span className={`flex-1 ${levelColor[log.level].split(' ')[0]}`}>
                        {log.label}
                      </span>
                      {canExpand && (
                        <span className="text-stone-400 flex-shrink-0 pt-0.5">
                          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </span>
                      )}
                    </div>
                    {canExpand && isOpen && (
                      <pre className="ml-[66px] mr-1.5 mt-1 mb-1 px-2 py-1.5 text-[10px] text-stone-600 bg-white border border-stone-200 rounded font-mono whitespace-pre-wrap break-words max-h-[220px] overflow-y-auto">
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
  )
}

// ---- 单行画像字段渲染器: 按 3 形态分支 (描述 / 枚举 / 配比) ----
//
// 渲染规则:
//   - string: 单段文字
//   - enum / enumPair: 顶部 chip 标签 (primary/type 高亮, secondary 次级) + 下方描述
//   - appeal: 三段式百分比进度条 (logos/pathos/ethos) + 下方描述
function ProfileFieldRow({
  label,
  shape,
  rendered,
  rawValue,
}: {
  label: string
  shape: import('@/services/studyRoom/fingerprintSchema').ProfileFormShape
  rendered: string
  /** 原始值, 枚举/配比形态需要拿原始字段渲染 chip/进度条 */
  rawValue?: WriterFingerprintProfile[keyof WriterFingerprintProfile]
}) {
  if (shape === 'appeal' && rawValue && typeof rawValue === 'object' && 'logos' in rawValue) {
    const v = rawValue as { logos: number; pathos: number; ethos: number; description: string }
    const pct = (n: number) => `${Math.round(n * 100)}%`
    return (
      <div className="px-3 py-2">
        <p className="text-[10px] font-semibold text-amber-800 mb-1" style={{ fontFamily: SERIF }}>
          {label}
        </p>
        <div className="flex h-2 rounded-sm overflow-hidden bg-stone-100 mb-1">
          <div className="bg-indigo-400" style={{ width: pct(v.logos) }} title={`Logos ${pct(v.logos)}`} />
          <div className="bg-rose-400" style={{ width: pct(v.pathos) }} title={`Pathos ${pct(v.pathos)}`} />
          <div className="bg-emerald-400" style={{ width: pct(v.ethos) }} title={`Ethos ${pct(v.ethos)}`} />
        </div>
        <div className="flex justify-between text-[9px] text-stone-500 font-mono mb-1">
          <span>逻辑 {pct(v.logos)}</span>
          <span>情感 {pct(v.pathos)}</span>
          <span>人格 {pct(v.ethos)}</span>
        </div>
        <p className="text-[11px] text-stone-700 leading-relaxed">{v.description}</p>
      </div>
    )
  }

  if ((shape === 'enum' || shape === 'enumPair') && rawValue && typeof rawValue === 'object') {
    // union 类型到 Record 的直转被 TS 禁止, 先走 unknown
    const obj = rawValue as unknown as Record<string, unknown>
    // 从 rendered 反向取 chip 内容: rendered 格式固定是 "标签 — 描述"
    // 但为了避免反向解析, 直接从 rawValue 提取 type / primary / secondary
    const chipTop: string | null = typeof obj.type === 'string'
      ? String(obj.type)
      : typeof obj.primary === 'string'
        ? String(obj.primary)
        : null
    const chipSecondary: string | null = typeof obj.secondary === 'string' ? String(obj.secondary) : null
    const description = typeof obj.description === 'string' ? obj.description : rendered
    // rendered 已经帮我们把英文 key 映射成中文了, 从 rendered 里切 " — " 之前的部分更可靠
    const dashIdx = rendered.indexOf(' — ')
    const chipText = dashIdx > 0 ? rendered.slice(0, dashIdx) : (chipTop || '')
    const bodyText = dashIdx > 0 ? rendered.slice(dashIdx + 3) : description

    return (
      <div className="px-3 py-2">
        <p className="text-[10px] font-semibold text-amber-800 mb-1" style={{ fontFamily: SERIF }}>
          {label}
        </p>
        <div className="flex flex-wrap gap-1 mb-1">
          {chipText.split(' + ').map((part, i) => (
            <span
              key={i}
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                i === 0
                  ? 'bg-amber-200/70 text-amber-900 font-semibold'
                  : 'bg-stone-100 text-stone-600'
              }`}
            >
              {part}
            </span>
          ))}
          {!chipText && chipSecondary && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-stone-100 text-stone-600">
              {chipSecondary}
            </span>
          )}
        </div>
        <p className="text-[11px] text-stone-700 leading-relaxed">{bodyText}</p>
      </div>
    )
  }

  // string / 向后兼容的旧 opening / closing
  return (
    <div className="px-3 py-2">
      <p className="text-[10px] font-semibold text-amber-800 mb-0.5" style={{ fontFamily: SERIF }}>
        {label}
      </p>
      <p className="text-[11px] text-stone-700 leading-relaxed">{rendered}</p>
    </div>
  )
}

// ---- 预览子组件: 提炼完成后, 保存前让用户先看 ----

function DistillPreview({
  draft,
  logs,
  isRefine,
}: {
  draft: WriterFingerprint
  logs: DistillLog[]
  isRefine: boolean
}) {
  // 结构指标: Layer 1 关键锚点, 扩展后展示更多指标 (支撑下面 Layer 2 的新维度)
  const metricItems: Array<[string, string]> = []
  const m = draft.metrics || {}
  if (m.avgSentenceLen !== undefined) metricItems.push(['平均句长', `${m.avgSentenceLen.toFixed(1)} 字`])
  if (m.avgParagraphLen !== undefined) metricItems.push(['平均段长', `${m.avgParagraphLen.toFixed(0)} 字`])
  if (m.shortSentenceRate !== undefined) metricItems.push(['短句占比', `${Math.round(m.shortSentenceRate * 100)}%`])
  if (m.longSentenceRate !== undefined) metricItems.push(['长句占比', `${Math.round(m.longSentenceRate * 100)}%`])
  if (m.formalityScore !== undefined) {
    const tone = m.formalityScore > 0.3 ? '书面' : m.formalityScore < -0.3 ? '口语' : '中性'
    metricItems.push(['倾向', `${tone} (${m.formalityScore.toFixed(2)})`])
  }
  if (m.idiomDensity !== undefined) metricItems.push(['成语密度', `${m.idiomDensity.toFixed(1)} / 千字`])
  if (m.rhetoricRate !== undefined) metricItems.push(['设问反问', `${m.rhetoricRate.toFixed(1)} / 千字`])
  if (m.firstPersonRate !== undefined) metricItems.push(['第一人称', `${m.firstPersonRate.toFixed(1)} / 千字`])
  // 扩展指标
  if (m.conjunctionDensity !== undefined) metricItems.push(['关联词密度', `${m.conjunctionDensity.toFixed(1)} / 千字`])
  if (m.modalDensity !== undefined) metricItems.push(['模态词密度', `${m.modalDensity.toFixed(1)} / 千字`])
  if (m.questionDensity !== undefined) metricItems.push(['问句密度', `${m.questionDensity.toFixed(1)} / 千字`])
  if (m.rhetoricalQuestionRate !== undefined) metricItems.push(['反问占比', `${Math.round(m.rhetoricalQuestionRate * 100)}%`])
  if (m.assertionDensity !== undefined) metricItems.push(['段首断言', `${Math.round(m.assertionDensity * 100)}%`])
  if (m.addressYou !== undefined) metricItems.push(['称"你"', `${m.addressYou.toFixed(1)} / 千字`])
  if (m.addressYouFormal !== undefined) metricItems.push(['称"您"', `${m.addressYouFormal.toFixed(1)} / 千字`])
  if (m.addressWe !== undefined) metricItems.push(['称"我们"', `${m.addressWe.toFixed(1)} / 千字`])
  if (m.addressEveryone !== undefined) metricItems.push(['称"大家"', `${m.addressEveryone.toFixed(1)} / 千字`])

  // Layer 2: 按 6 层分组渲染, 每层内再按字段的 shape 走对应形态
  // 仅统计"实际有值"的字段 (LLM 可能跳过很多, 比如样本不足的意象层)
  const filledProfileCount = PROFILE_FIELD_SPECS_BY_LAYER.reduce((acc, group) => {
    return acc + group.fields.filter((spec) => {
      const v = draft.profile[spec.key]
      return renderProfileFieldValue(spec, v) !== null
    }).length
  }, 0)
  // 向后兼容: 旧 opening/closing 也计入
  if (draft.profile.opening) { /* noop, only for count inclusion check below */ }

  return (
    <div className="p-5 space-y-4">
      {/* 提示条 */}
      <div className="flex items-start gap-2 text-[11px] bg-green-50 border border-green-200 text-green-800 rounded-md px-3 py-2 leading-relaxed">
        <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">
            {isRefine ? '打磨完成, 请确认' : '提炼完成, 请确认'}
          </p>
          <p className="text-[10px] text-green-700/80 mt-0.5">
            {filledProfileCount} 个画像维度{draft.behaviorRules && draft.behaviorRules.length > 0 ? ` · ${draft.behaviorRules.length} 条行为规则` : ''} · {draft.samples.length} 段范文 · {draft.sourceCount || 0} 篇 / {((draft.sourceWordCount || 0) / 1000).toFixed(1)}k 字
            {isRefine && ' · 保存将覆盖原指纹'}
          </p>
        </div>
      </div>

      {/* 提炼过程日志 (默认展开, 满足"提炼过程要打印出来") */}
      <LogTimeline logs={logs} defaultExpanded title="提炼过程" />

      {/* Layer 2: 风格画像 — 分 6 层渲染, 每字段按 3 形态 */}
      <div>
        <p className="text-[9px] font-black text-amber-700/80 uppercase tracking-[0.22em] mb-1.5">
          Layer 2 · 风格画像
        </p>
        {filledProfileCount === 0 && !draft.profile.opening && !draft.profile.closing ? (
          <div className="border border-amber-100 rounded-md bg-amber-50/30 px-3 py-4 text-center text-[10px] text-stone-400">
            LLM 未返回任何画像字段
          </div>
        ) : (
          <div className="space-y-2">
            {PROFILE_FIELD_SPECS_BY_LAYER.map((group) => {
              const renderedFields = group.fields
                .map((spec) => ({ spec, value: draft.profile[spec.key] }))
                .filter(({ spec, value }) => renderProfileFieldValue(spec, value) !== null)
              // 宏观结构层附加旧 opening/closing 的向后兼容展示
              const legacyOpening = group.layer === 'macro' && !draft.profile.hookPattern && draft.profile.opening
              const legacyClosing = group.layer === 'macro' && !draft.profile.closingPattern && draft.profile.closing
              if (renderedFields.length === 0 && !legacyOpening && !legacyClosing) return null
              return (
                <div key={group.layer} className="border border-amber-100 rounded-md bg-amber-50/30 overflow-hidden">
                  <div className="px-3 py-1.5 bg-amber-100/60 border-b border-amber-100">
                    <p className="text-[9px] font-black text-amber-800/90 uppercase tracking-[0.2em]">
                      {group.label}
                    </p>
                  </div>
                  <div className="divide-y divide-amber-100/60">
                    {legacyOpening && (
                      <ProfileFieldRow label="开篇风格 (旧版)" shape="string" rendered={draft.profile.opening!} />
                    )}
                    {renderedFields.map(({ spec, value }) => (
                      <ProfileFieldRow
                        key={spec.key}
                        label={spec.label}
                        shape={spec.shape}
                        rendered={renderProfileFieldValue(spec, value)!}
                        rawValue={value}
                      />
                    ))}
                    {legacyClosing && (
                      <ProfileFieldRow label="收束风格 (旧版)" shape="string" rendered={draft.profile.closing!} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* L0: 行为规则 — 阶段 1: 多例渲染 (examples[] 优先, example 回退) */}
      {draft.behaviorRules && draft.behaviorRules.length > 0 && (
        <div>
          <p className="text-[9px] font-black text-emerald-700/80 uppercase tracking-[0.22em] mb-1.5">
            L0 · 行为规则 ({draft.behaviorRules.length})
          </p>
          <div className="space-y-1.5">
            {draft.behaviorRules.map((rule, i) => {
              const exs = (rule.examples && rule.examples.length > 0)
                ? rule.examples
                : (rule.example ? [rule.example] : [])
              return (
                <div key={i} className="border border-emerald-100 rounded-md bg-emerald-50/30 overflow-hidden">
                  <div className="px-3 py-2 space-y-1">
                    <div className="flex items-start gap-1.5 text-[10px]">
                      <span className="font-semibold text-emerald-800 flex-shrink-0 w-10">When</span>
                      <span className="text-stone-700">{rule.when}</span>
                    </div>
                    <div className="flex items-start gap-1.5 text-[10px]">
                      <span className="font-semibold text-emerald-800 flex-shrink-0 w-10">Do</span>
                      <span className="text-stone-700">{rule.do}</span>
                    </div>
                    <div className="flex items-start gap-1.5 text-[10px]">
                      <span className="font-semibold text-emerald-800 flex-shrink-0 w-10">Not</span>
                      <span className="text-stone-500">{rule.not}</span>
                    </div>
                    {exs.length > 0 && (
                      <div className="flex items-start gap-1.5 text-[10px]">
                        <span className="font-semibold text-emerald-800 flex-shrink-0 w-10">
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
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Layer 1: 结构指标 */}
      {metricItems.length > 0 && (
        <div>
          <p className="text-[9px] font-black text-stone-500 uppercase tracking-[0.22em] mb-1.5">
            Layer 1 · 结构指标
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 bg-stone-50/60 border border-stone-200 rounded-md px-3 py-2">
            {metricItems.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-[10px]">
                <span className="text-stone-500">{k}</span>
                <span className="text-stone-700 font-mono">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Layer 3: 范文样本 */}
      {draft.samples.length > 0 && (
        <div>
          <p className="text-[9px] font-black text-stone-500 uppercase tracking-[0.22em] mb-1.5">
            Layer 3 · 范文样本 ({draft.samples.length})
          </p>
          <div className="space-y-1.5">
            {draft.samples.map((s, i) => (
              <div key={i} className="bg-white border border-stone-200 rounded-md p-2">
                {(s.source || s.reason) && (
                  <p className="text-[9px] text-stone-400 mb-1">
                    {s.source && <>来自《{s.source}》</>}
                    {s.reason && <> · {s.reason}</>}
                  </p>
                )}
                <p className="text-[10px] text-stone-600 leading-relaxed whitespace-pre-wrap" style={{ fontFamily: SERIF }}>
                  {s.text.length > 400 ? s.text.slice(0, 400) + '…' : s.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
