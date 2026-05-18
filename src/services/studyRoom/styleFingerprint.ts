/**
 * styleFingerprint — 风格指纹前端服务层
 *
 * 存储策略:
 * - 指纹列表: localStorage 'studyRoom:fingerprints:index' (WriterFingerprintMeta[])
 * - 单个指纹详情: localStorage 'studyRoom:fingerprint:{id}' (WriterFingerprint)
 * - 当前激活指纹: localStorage 'studyRoom:activeFingerprintId' (string | null)
 *
 * 为什么不统一存一个大数组:
 * - 单个指纹可能上千字 (含范文), 频繁读写全部数据浪费
 * - 列表页只需元信息, 详情页才读完整数据 (按需加载)
 *
 * 未来: 当后端实现 /api/study/fingerprints/* 时, 这层作为 shim,
 *       读写切到后端, localStorage 只作本地缓存.
 */

import type {
  FingerprintBehaviorRule,
  WriterFingerprint,
  WriterFingerprintMeta,
  WriterFingerprintMetrics,
  WriterFingerprintProfile,
  WriterFingerprintSample,
} from '@/types'

const INDEX_KEY = 'studyRoom:fingerprints:index'
const ACTIVE_KEY = 'studyRoom:activeFingerprintId'
const DETAIL_PREFIX = 'studyRoom:fingerprint:'

const API_BASE = 'http://localhost:3001'

/**
 * 多样本阈值: 当源文档数 < 此值时, LLM prompt 中强制要求跳过
 * 意象/主题层 (frequentImagery / metaphorDomain / referencePreference) 三个字段,
 * 避免单篇样本凭感觉编 "高频意象", 造成过拟合.
 *
 * 硬编码为 3: 经验值, 不走配置, 如需调整直接改此处.
 */
export const MULTI_SAMPLE_THRESHOLD = 3

// ============================================
// 本地缓存工具
// ============================================

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* noop */ }
}
function lsRemove(key: string) {
  try { localStorage.removeItem(key) } catch { /* noop */ }
}

function readIndex(): WriterFingerprintMeta[] {
  const raw = lsGet(INDEX_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeIndex(metas: WriterFingerprintMeta[]): void {
  lsSet(INDEX_KEY, JSON.stringify(metas))
}

function readDetail(id: string): WriterFingerprint | null {
  const raw = lsGet(DETAIL_PREFIX + id)
  if (!raw) return null
  try {
    return JSON.parse(raw) as WriterFingerprint
  } catch {
    return null
  }
}

function writeDetail(fp: WriterFingerprint): void {
  lsSet(DETAIL_PREFIX + fp.id, JSON.stringify(fp))
}

function removeDetail(id: string): void {
  lsRemove(DETAIL_PREFIX + id)
}

function genId(): string {
  return `fp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// ============================================
// 公共 API
// ============================================

/**
 * 列出所有指纹 (元信息)
 * 优先从后端拉, 失败则读本地
 */
export async function listFingerprints(): Promise<WriterFingerprintMeta[]> {
  try {
    const res = await fetch(`${API_BASE}/api/study/fingerprints`)
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data.fingerprints)) {
        // 同步到本地缓存
        writeIndex(data.fingerprints)
        return data.fingerprints
      }
    }
  } catch {
    // 后端不可用, 降级到本地
  }
  return readIndex()
}

/**
 * 读取单个指纹的完整详情
 */
export async function getFingerprint(id: string): Promise<WriterFingerprint | null> {
  try {
    const res = await fetch(`${API_BASE}/api/study/fingerprints/${id}`)
    if (res.ok) {
      const data = await res.json()
      if (data && data.id) {
        writeDetail(data)
        return data
      }
    }
  } catch {
    // 降级
  }
  return readDetail(id)
}

/**
 * 创建或更新指纹 (写入后端 + 本地缓存)
 */
export async function saveFingerprint(fp: WriterFingerprint): Promise<WriterFingerprint> {
  // 本地写入是先行保证: 即使后端失败也不丢
  writeDetail(fp)
  const metas = readIndex()
  const meta: WriterFingerprintMeta = {
    id: fp.id,
    name: fp.name,
    description: fp.description,
    sourceCount: fp.sourceCount,
    sourceWordCount: fp.sourceWordCount,
    createdAt: fp.createdAt,
    updatedAt: fp.updatedAt,
  }
  const idx = metas.findIndex((m) => m.id === fp.id)
  if (idx >= 0) metas[idx] = meta
  else metas.unshift(meta)
  writeIndex(metas)

  // 后端尽力同步
  try {
    await fetch(`${API_BASE}/api/study/fingerprints/${fp.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fp),
    })
  } catch {
    // 静默
  }

  return fp
}

/**
 * 删除指纹
 */
export async function deleteFingerprint(id: string): Promise<void> {
  removeDetail(id)
  const metas = readIndex().filter((m) => m.id !== id)
  writeIndex(metas)
  // 如果删的是激活的, 清空激活
  if (getActiveFingerprintId() === id) {
    setActiveFingerprintId(null)
  }
  try {
    await fetch(`${API_BASE}/api/study/fingerprints/${id}`, { method: 'DELETE' })
  } catch {
    // 静默
  }
}

/**
 * 获取当前激活的指纹 ID
 */
export function getActiveFingerprintId(): string | null {
  return lsGet(ACTIVE_KEY)
}

/**
 * 设置当前激活的指纹 ID (null 表示取消应用)
 */
export function setActiveFingerprintId(id: string | null): void {
  if (id) lsSet(ACTIVE_KEY, id)
  else lsRemove(ACTIVE_KEY)
}

/**
 * 同步获取当前激活指纹的完整详情 (从本地缓存, 不请求后端)
 * 用于 prompt 构建时的同步注入
 */
export function getActiveFingerprintSync(): WriterFingerprint | null {
  const id = getActiveFingerprintId()
  if (!id) return null
  return readDetail(id)
}

/**
 * 根据 fingerprintId 同步获取指纹详情 (从本地缓存)
 * 用于 prompt 构建
 */
export function getFingerprintSync(id: string): WriterFingerprint | null {
  if (!id) return null
  return readDetail(id)
}

// ============================================
// 提炼: 调用后端 distill 端点
// ============================================

export interface DistillRequest {
  /** 源文档路径列表 (相对 DunCrew-Data/) 或直接的文本 */
  sources: Array<{ path?: string; text?: string; title?: string }>
  /** 指纹命名 */
  name: string
  /** 可选描述 */
  description?: string
  /** 是否覆盖已存在同名指纹, 默认 false (冲突时会报错) */
  overwrite?: boolean
  /**
   * 打磨模式: 如果提供了已有指纹, 本次提炼会:
   *   - 把旧指纹的 samples 文本 + 旧 profile 合并进 combinedText
   *   - LLM prompt 中告知 "在原画像基础上融合新样本修正"
   *   - 新产出的指纹 id 复用旧 id, sourceCount / sourceWordCount 累加
   *   - 保存时覆盖旧指纹 (updatedAt 更新, createdAt 保留)
   */
  refineBase?: WriterFingerprint | null
}

/** 提炼过程的日志条目 (用于 UI 时间线) */
export interface DistillLog {
  /** 时间戳 (ms) */
  time: number
  /** 级别: info 常规 / success 里程碑 / warn 警告 / error 错误 / data 数据展示 */
  level: 'info' | 'success' | 'warn' | 'error' | 'data'
  /** 简短标题 (一行内) */
  label: string
  /** 详细内容 (可选, 展开后才显示, 支持多行) */
  detail?: string
}

export interface DistillProgress {
  /**
   * 阶段枚举:
   *   reading    — 后端读取 + 算指标
   *   metrics    — 指标已生成
   *   llm_profile— L1 画像 LLM 调用中
   *   llm_l0     — L0 行为规则 LLM 调用中
   *   llm_samples— 范文细化 (预留)
   *   preview    — 草稿已生成, 等待用户保存/重试
   *   saving     — 落盘中
   *   done       — 已落盘完成
   *   error      — 出错
   */
  stage: 'reading' | 'metrics' | 'llm_profile' | 'llm_l0' | 'llm_samples' | 'preview' | 'saving' | 'done' | 'error'
  progress: number // 0-100
  message: string
  /** 累积的执行日志 (每次回调都传完整快照, 便于 UI 直接渲染) */
  logs: DistillLog[]
  /** preview 阶段会携带"待确认"的指纹草稿 (未落盘) */
  draft?: WriterFingerprint
  /** done 阶段携带已落盘的指纹 */
  result?: WriterFingerprint
  error?: string
}

/** LLM 画像调用器的返回结果 — 带上原始 prompt / response 用于日志展示 */
export interface LlmProfileResult {
  profile: WriterFingerprintProfile
  /** 系统提示词 (用于日志展示) */
  systemPrompt?: string
  /** 用户提示词 (用于日志展示) */
  userPrompt?: string
  /** LLM 原始响应文本 */
  rawResponse?: string
  /** LLM 推理内容 (DeepSeek 等思维模型的 reasoning_content) */
  reasoningContent?: string
}

/** LLM 流式事件: 每产出一块内容就回调一次, 由 distillFingerprint 更新执行日志 */
export interface LlmStreamEvent {
  /** content = 正式回答的文本; reasoning = 思维链推理过程 */
  type: 'content' | 'reasoning'
  /** 本次增量 */
  delta: string
  /** 累积的完整文本 (含本次增量) */
  accumulated: string
}

/** 提炼过程中触发 LLM 调用的接口 */
export type LlmProfileDistiller = (args: {
  combinedText: string
  metrics: WriterFingerprintMetrics
  name: string
  /** 源文档数量, 用于决定是否启用意象/主题层维度 (< MULTI_SAMPLE_THRESHOLD 时跳过) */
  sourceCount: number
  /** 是否达到多样本阈值 (sourceCount >= MULTI_SAMPLE_THRESHOLD) */
  isMultiSample: boolean
  /** 打磨模式下, 旧的画像会传进来, LLM 需要在此基础上修正 */
  basePrompt?: {
    baseProfile: WriterFingerprintProfile
    baseName: string
  } | null
  /**
   * 流式回调: LLM 每产出一块 content / reasoning 就触发一次
   * distillFingerprint 据此实时更新"LLM 推理中"占位日志的 detail,
   * 让用户看到模型正在想什么 / 吐什么, 而不是干等结果
   */
  onStream?: (event: LlmStreamEvent) => void
}) => Promise<LlmProfileResult>

/** L0 行为规则提取器的返回结果 */
export interface LlmL0Result {
  /** LLM 产出的行为规则 */
  rules: FingerprintBehaviorRule[]
  /** L0 提取可能同时产出更好的范文样本 (可选, 不覆盖则用原始的) */
  samples?: WriterFingerprintSample[]
  systemPrompt?: string
  userPrompt?: string
  rawResponse?: string
  reasoningContent?: string
}

/** L0 行为规则提取器: 在 L1 画像完成后, 从原文中提取可执行行为规则 */
export type LlmL0Extractor = (args: {
  /** L1 画像 (22 维, 作为提取锚点) */
  profile: WriterFingerprintProfile
  /** L1 量化指标 (JSON 字符串) */
  metricsJson: string
  /** 原文采样文本 */
  combinedText: string
  /** 指纹名称 */
  name: string
  /**
   * 【打磨模式新增】已有的行为规则 (来自上一轮打磨的产物).
   * LLM 应把这些规则作为迭代锚点, 而不是从零开始重写:
   *   - 新样本若印证了旧规则, 在 examples 中合并新印证片段 (共识涌现, 强化置信度)
   *   - 新样本呈现出旧规则未覆盖的模式, 才新增规则
   *   - 旧规则若在新样本中反复出现反例, 可以删改 (但必须在 reason 中说明)
   * 对齐 L1 画像的 basePrompt 迭代哲学.
   */
  baseRules?: FingerprintBehaviorRule[]
  /** 流式回调 */
  onStream?: (event: LlmStreamEvent) => void
}) => Promise<LlmL0Result>

/**
 * 提炼新指纹 (新架构: 后端只算指标+选样本, 前端调 LLM 生成画像, 产出草稿后等待用户确认)
 *
 * 流程:
 *   阶段 1 (后端 /distill-prepare): 读文档 + Layer 1 指标 + Layer 3 范文候选
 *   阶段 2a (前端): 调用户配置的 LLM (走 streamChat) 生成 Layer 2 自然语言画像
 *   阶段 2b (前端): 基于 L1 画像 + 指标 + 原文, 提取 L0 行为规则
 *   阶段 3 (前端 preview): 返回 draft 给 UI, **不自动落盘**, 由用户决定保存 / 重试 / 取消
 *
 * 这样设计的原因:
 *   - 后端不需要管 LLM key/model, 完全复用用户前端配置
 *   - LLM 调用和对话式写作走同一条链路 (用户在设置里换模型后自动生效)
 *   - 前端能实时展示进度 + 日志 + 预览, 满足"提炼了什么要给用户看到"
 *   - 支持打磨模式, 允许用户用不同稿子反复迭代同一种风格
 */
export async function distillFingerprint(
  req: DistillRequest,
  onProgress?: (p: DistillProgress) => void,
  // 注入 LLM 调用器 (由 DistillDialog 传入, 避免循环依赖)
  llmProfileDistiller?: LlmProfileDistiller,
  // 注入 L0 行为规则提取器 (v3 新增, 可选: 不传则跳过 L0 提取)
  llmL0Extractor?: LlmL0Extractor,
): Promise<WriterFingerprint> {
  const logs: DistillLog[] = []
  const refineBase = req.refineBase || null
  const isRefine = !!refineBase

  const pushLog = (level: DistillLog['level'], label: string, detail?: string) => {
    logs.push({ time: Date.now(), level, label, detail })
  }
  const emit = (stage: DistillProgress['stage'], progress: number, message: string, extra?: Partial<DistillProgress>) => {
    onProgress?.({
      stage,
      progress,
      message,
      logs: logs.slice(),  // 快照, 避免外部持有引用
      ...extra,
    })
  }

  // ---- 启动日志 ----
  if (isRefine) {
    pushLog('info', `打磨模式: 在已有指纹 "${refineBase!.name}" 基础上迭代`,
      `已收录 ${refineBase!.sourceCount || 0} 篇 / ${refineBase!.sourceWordCount || 0} 字\n`
      + `本次新增 ${req.sources.length} 份稿件`)
  } else {
    pushLog('info', `开始提炼新指纹 "${req.name}"`, `源数量: ${req.sources.length}`)
  }
  emit('reading', 10, '读取源文档, 计算结构指标...')

  // ---- 阶段 1: 后端准备 ----
  const t0 = Date.now()
  const prepRes = await fetch(`${API_BASE}/api/study/fingerprints/distill-prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sources: req.sources }),
  })

  if (!prepRes.ok) {
    const errText = await prepRes.text().catch(() => '')
    const err = `读取/分析失败 (${prepRes.status}): ${errText || prepRes.statusText}`
    pushLog('error', '后端 distill-prepare 失败', err)
    emit('error', 0, err, { error: err })
    throw new Error(err)
  }

  const prepared = await prepRes.json() as {
    combinedText: string
    metrics: WriterFingerprintMetrics
    samples: WriterFingerprintSample[]
    sourceCount: number
    sourceWordCount: number
    sourcePaths?: string[]
  }
  const readMs = Date.now() - t0

  pushLog('success', `读取完成: ${prepared.sourceCount} 篇 / ${prepared.sourceWordCount} 字 (${readMs}ms)`,
    prepared.sourcePaths && prepared.sourcePaths.length > 0
      ? '源文件:\n' + prepared.sourcePaths.map((p) => `  - ${p}`).join('\n')
      : undefined)

  // 展示关键指标给用户看
  const m = prepared.metrics
  const metricLines: string[] = []
  if (m.avgSentenceLen !== undefined) metricLines.push(`平均句长: ${m.avgSentenceLen.toFixed(1)} 字`)
  if (m.avgParagraphLen !== undefined) metricLines.push(`平均段长: ${m.avgParagraphLen.toFixed(0)} 字`)
  if (m.shortSentenceRate !== undefined) metricLines.push(`短句占比: ${(m.shortSentenceRate * 100).toFixed(1)}%`)
  if (m.longSentenceRate !== undefined) metricLines.push(`长句占比: ${(m.longSentenceRate * 100).toFixed(1)}%`)
  if (m.formalityScore !== undefined) {
    const tone = m.formalityScore > 0.3 ? '书面' : m.formalityScore < -0.3 ? '口语' : '中性'
    metricLines.push(`书面/口语倾向: ${tone} (${m.formalityScore.toFixed(2)})`)
  }
  if (m.idiomDensity !== undefined) metricLines.push(`成语密度: ${m.idiomDensity.toFixed(1)} / 千字`)
  if (m.rhetoricRate !== undefined) metricLines.push(`设问反问率: ${m.rhetoricRate.toFixed(1)} / 千字`)
  pushLog('data', '结构指标 (Layer 1)', metricLines.join('\n'))

  // 范文候选
  if (prepared.samples.length > 0) {
    const sampleDetail = prepared.samples.map((s, i) =>
      `[${i + 1}]${s.source ? ` 来自《${s.source}》` : ''}${s.reason ? ` · ${s.reason}` : ''}\n`
      + `    ${s.text.slice(0, 120)}${s.text.length > 120 ? '…' : ''}`,
    ).join('\n\n')
    pushLog('data', `范文样本 (Layer 3) × ${prepared.samples.length}`, sampleDetail)
  }
  emit('metrics', 35, '结构指标已生成')

  // ---- 打磨模式: 把旧样本文本合并进 combinedText ----
  let combinedForLlm = prepared.combinedText
  if (isRefine && refineBase!.samples.length > 0) {
    const oldText = refineBase!.samples
      .map((s, i) => `[旧范文 ${i + 1}${s.source ? ` · ${s.source}` : ''}]\n${s.text}`)
      .join('\n\n')
    combinedForLlm = `${oldText}\n\n===== 以下是本次新增的稿件 =====\n\n${prepared.combinedText}`
    pushLog('info', `打磨模式: 已合并 ${refineBase!.samples.length} 段旧范文 + 新稿件供 LLM 参考`)
  }

  // ---- 阶段 2: 前端调 LLM 生成 Layer 2 画像 ----
  emit('llm_profile', 50, '调用 LLM 归纳风格画像 (可能需要 10-30 秒)...')
  pushLog('info', '调用 LLM 归纳风格画像',
    `输入: 指标 ${Object.keys(prepared.metrics).length} 项 + 文本 ${combinedForLlm.length} 字`
    + (isRefine ? '\n模式: 基于旧画像融合修正' : ''))

  // 打磨模式下累计样本数 = 旧的 + 新的 (意象层判断以累计为准, 更符合直觉)
  const effectiveSourceCount = isRefine
    ? (refineBase!.sourceCount || 0) + prepared.sourceCount
    : prepared.sourceCount
  const isMultiSample = effectiveSourceCount >= MULTI_SAMPLE_THRESHOLD

  if (!isMultiSample) {
    pushLog('warn',
      `样本数 ${effectiveSourceCount} < ${MULTI_SAMPLE_THRESHOLD}, 意象/主题层将跳过`,
      '避免单篇样本凭感觉编 "高频意象 / 隐喻来源 / 引用偏好", 等样本累积到 3 篇再提取。')
  }

  let profile: WriterFingerprintProfile = {}
  if (llmProfileDistiller) {
    // ---- 流式占位日志: 让用户实时看到 LLM 正在想/吐什么, 而不是干等 10-30 秒 ----
    // 先插入一条 label="LLM 推理中..." 的日志, 记住它在 logs 数组里的下标,
    // LLM 每产出一块 token 就原地更新它的 detail 和 label, 再节流 emit 给 UI 重绘.
    const streamingLogIdx = logs.length
    logs.push({
      time: Date.now(),
      level: 'info',
      label: 'LLM 推理中... (等待首字)',
      detail: '',
    })
    emit('llm_profile', 50, '等待 LLM 首字响应...')

    // 节流: 至少 STREAM_EMIT_INTERVAL_MS 毫秒或累积 STREAM_EMIT_MIN_DELTA 字才 emit 一次
    const STREAM_EMIT_INTERVAL_MS = 180
    const STREAM_EMIT_MIN_DELTA = 60
    let lastEmitAt = 0
    let lastEmittedTotalLen = 0
    let reasoningAccum = ''
    let contentAccum = ''
    const streamStart = Date.now()

    const composeStreamDetail = (): string => {
      const parts: string[] = []
      if (reasoningAccum) {
        parts.push(`[思维链 reasoning · ${reasoningAccum.length} 字]\n${reasoningAccum}`)
      }
      if (contentAccum) {
        parts.push(`[正式输出 content · ${contentAccum.length} 字]\n${contentAccum}`)
      }
      return parts.join('\n\n')
    }

    const flushStreamingLog = (force: boolean) => {
      const now = Date.now()
      const totalLen = reasoningAccum.length + contentAccum.length
      const intervalOk = now - lastEmitAt >= STREAM_EMIT_INTERVAL_MS
      const deltaOk = totalLen - lastEmittedTotalLen >= STREAM_EMIT_MIN_DELTA
      if (!force && !intervalOk && !deltaOk) return

      lastEmitAt = now
      lastEmittedTotalLen = totalLen
      const elapsedMs = now - streamStart
      const entry = logs[streamingLogIdx]
      if (entry) {
        const parts: string[] = []
        if (reasoningAccum.length > 0) parts.push(`reasoning ${reasoningAccum.length} 字`)
        if (contentAccum.length > 0) parts.push(`content ${contentAccum.length} 字`)
        const meta = parts.length > 0 ? ` · ${parts.join(' / ')}` : ''
        entry.label = `LLM 推理中 (${(elapsedMs / 1000).toFixed(1)}s${meta})`
        entry.detail = composeStreamDetail()
      }

      // 进度条微动 (50 → 70), 基于内容长度模糊推进, 避免用户以为卡死
      const softProgress = Math.min(70, 50 + Math.floor(totalLen / 120))
      const tailPreview = (contentAccum || reasoningAccum).slice(-40).replace(/\s+/g, ' ')
      emit(
        'llm_profile',
        softProgress,
        tailPreview
          ? `LLM 产出中: …${tailPreview}`
          : 'LLM 正在思考...',
      )
    }

    try {
      const t1 = Date.now()
      const llmResult = await llmProfileDistiller({
        combinedText: combinedForLlm,
        metrics: prepared.metrics,
        name: req.name,
        sourceCount: effectiveSourceCount,
        isMultiSample,
        basePrompt: isRefine
          ? { baseProfile: refineBase!.profile, baseName: refineBase!.name }
          : null,
        onStream: (ev) => {
          if (ev.type === 'reasoning') {
            reasoningAccum = ev.accumulated
          } else {
            contentAccum = ev.accumulated
          }
          flushStreamingLog(false)
        },
      })
      profile = llmResult.profile
      const llmMs = Date.now() - t1

      // 如果调用器本身提供了最终累计 (不走 onStream 的旧实现), 覆盖累积值
      if (llmResult.reasoningContent) reasoningAccum = llmResult.reasoningContent
      if (llmResult.rawResponse) contentAccum = llmResult.rawResponse

      // 收尾: 把占位日志定格为"推理完成"
      const finalEntry = logs[streamingLogIdx]
      if (finalEntry) {
        const parts: string[] = []
        if (reasoningAccum.length > 0) parts.push(`reasoning ${reasoningAccum.length} 字`)
        if (contentAccum.length > 0) parts.push(`content ${contentAccum.length} 字`)
        const meta = parts.length > 0 ? ` · ${parts.join(' / ')}` : ''
        finalEntry.level = 'success'
        finalEntry.label = `LLM 推理完成 (${llmMs}ms${meta})`
        finalEntry.detail = composeStreamDetail() || '(LLM 未返回任何内容)'
      }

      // 记录 LLM 的 prompt, 让用户回溯"我们问了什么"
      if (llmResult.systemPrompt) {
        pushLog('data', 'LLM System Prompt', llmResult.systemPrompt)
      }
      if (llmResult.userPrompt) {
        const up = llmResult.userPrompt
        pushLog('data', 'LLM User Prompt',
          up.length > 3000 ? up.slice(0, 3000) + `\n\n... (省略 ${up.length - 3000} 字)` : up)
      }

      // 解析后的画像
      const profileDetail = Object.entries(profile)
        .filter(([, v]) => v && String(v).trim())
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('\n\n')
      pushLog('success', `风格画像解析完成 (${Object.keys(profile).length} 个维度)`, profileDetail)
    } catch (err) {
      // 异常: 把占位日志标红, 保留已产出的片段方便排查
      const msg = err instanceof Error ? err.message : String(err)
      const failEntry = logs[streamingLogIdx]
      if (failEntry) {
        failEntry.level = 'error'
        failEntry.label = 'LLM 推理中断'
        const streamDump = composeStreamDetail()
        failEntry.detail = streamDump
          ? `${streamDump}\n\n----- 错误 -----\n${msg}`
          : msg
      }
      const e = `LLM 画像生成失败: ${msg}`
      pushLog('error', 'LLM 画像生成失败', msg)
      emit('error', 0, e, { error: e })
      throw new Error(e)
    }
  } else {
    profile = {
      sentenceStyle: `平均句长 ${prepared.metrics.avgSentenceLen?.toFixed(1) || '?'} 字, 请手动补充`,
      paragraphing: `平均段长 ${prepared.metrics.avgParagraphLen?.toFixed(0) || '?'} 字`,
    }
    pushLog('warn', '未配置 LLM 调用器, 使用指标推断的最小画像')
  }

  // ---- 阶段 2b: L0 行为规则提取 (以 L1 画像+指标为锚, 从原文中提取可执行规则) ----
  let behaviorRules: FingerprintBehaviorRule[] | undefined
  let l0Samples: WriterFingerprintSample[] | undefined

  if (llmL0Extractor && Object.keys(profile).length > 0) {
    emit('llm_l0', 72, '调用 LLM 提取 L0 行为规则 (以 L1 画像为锚)...')
    pushLog('info', '调用 LLM 提取 L0 行为规则',
      `输入: L1 画像 ${Object.keys(profile).length} 维 + 指标 ${Object.keys(prepared.metrics).length} 项 + 文本 ${combinedForLlm.length} 字`)

    // 流式占位日志
    const l0StreamLogIdx = logs.length
    logs.push({
      time: Date.now(),
      level: 'info',
      label: 'L0 提取中... (等待首字)',
      detail: '',
    })
    emit('llm_l0', 72, '等待 L0 提取 LLM 首字响应...')

    let l0ReasoningAccum = ''
    let l0ContentAccum = ''
    const l0StreamStart = Date.now()

    const L0_STREAM_INTERVAL_MS = 180
    const L0_STREAM_MIN_DELTA = 60
    let l0LastEmitAt = 0
    let l0LastEmittedLen = 0

    const flushL0StreamLog = (force: boolean) => {
      const now = Date.now()
      const totalLen = l0ReasoningAccum.length + l0ContentAccum.length
      const intervalOk = now - l0LastEmitAt >= L0_STREAM_INTERVAL_MS
      const deltaOk = totalLen - l0LastEmittedLen >= L0_STREAM_MIN_DELTA
      if (!force && !intervalOk && !deltaOk) return

      l0LastEmitAt = now
      l0LastEmittedLen = totalLen
      const elapsedMs = now - l0StreamStart
      const entry = logs[l0StreamLogIdx]
      if (entry) {
        const parts: string[] = []
        if (l0ReasoningAccum.length > 0) parts.push(`reasoning ${l0ReasoningAccum.length} 字`)
        if (l0ContentAccum.length > 0) parts.push(`content ${l0ContentAccum.length} 字`)
        const meta = parts.length > 0 ? ` · ${parts.join(' / ')}` : ''
        entry.label = `L0 提取中 (${(elapsedMs / 1000).toFixed(1)}s${meta})`
        const detailParts: string[] = []
        if (l0ReasoningAccum) detailParts.push(`[思维链 reasoning · ${l0ReasoningAccum.length} 字]\n${l0ReasoningAccum}`)
        if (l0ContentAccum) detailParts.push(`[正式输出 content · ${l0ContentAccum.length} 字]\n${l0ContentAccum}`)
        entry.detail = detailParts.join('\n\n')
      }

      const softProgress = Math.min(82, 72 + Math.floor(totalLen / 150))
      const tailPreview = (l0ContentAccum || l0ReasoningAccum).slice(-40).replace(/\s+/g, ' ')
      emit('llm_l0', softProgress, tailPreview ? `L0 提取中: …${tailPreview}` : 'LLM 正在提取行为规则...')
    }

    try {
      const metricsJson = JSON.stringify(prepared.metrics, null, 2)
      const t2 = Date.now()
      // 【打磨模式保护】把旧规则传给 LLM 作为迭代锚点, 而不是从零重写
      // 对齐 L1 画像的 basePrompt 设计 — 同样的迭代哲学, 不让好规则凭空消失
      const baseRules = isRefine && refineBase!.behaviorRules && refineBase!.behaviorRules.length > 0
        ? refineBase!.behaviorRules
        : undefined
      if (baseRules) {
        pushLog('info',
          `打磨模式: 传入旧规则 ${baseRules.length} 条给 LLM 作为迭代锚点`,
          '对齐 L1 画像的迭代哲学: LLM 应在旧规则基础上印证/补充, 而非从零重写.')
      }
      const l0Result = await llmL0Extractor({
        profile,
        metricsJson,
        combinedText: combinedForLlm,
        name: req.name,
        baseRules,
        onStream: (ev: LlmStreamEvent) => {
          if (ev.type === 'reasoning') {
            l0ReasoningAccum = ev.accumulated
          } else {
            l0ContentAccum = ev.accumulated
          }
          flushL0StreamLog(false)
        },
      })
      const l0Ms = Date.now() - t2

      if (l0Result.reasoningContent) l0ReasoningAccum = l0Result.reasoningContent
      if (l0Result.rawResponse) l0ContentAccum = l0Result.rawResponse

      const l0FinalEntry = logs[l0StreamLogIdx]
      if (l0FinalEntry) {
        const parts: string[] = []
        if (l0ReasoningAccum.length > 0) parts.push(`reasoning ${l0ReasoningAccum.length} 字`)
        if (l0ContentAccum.length > 0) parts.push(`content ${l0ContentAccum.length} 字`)
        const meta = parts.length > 0 ? ` · ${parts.join(' / ')}` : ''
        l0FinalEntry.level = 'success'
        l0FinalEntry.label = `L0 提取完成 (${l0Ms}ms${meta})`
        const detailParts: string[] = []
        if (l0ReasoningAccum) detailParts.push(`[思维链 reasoning · ${l0ReasoningAccum.length} 字]\n${l0ReasoningAccum}`)
        if (l0ContentAccum) detailParts.push(`[正式输出 content · ${l0ContentAccum.length} 字]\n${l0ContentAccum}`)
        l0FinalEntry.detail = detailParts.join('\n\n') || '(LLM 未返回任何内容)'
      }

      if (l0Result.systemPrompt) {
        pushLog('data', 'L0 System Prompt', l0Result.systemPrompt)
      }
      if (l0Result.userPrompt) {
        const up = l0Result.userPrompt
        pushLog('data', 'L0 User Prompt',
          up.length > 3000 ? up.slice(0, 3000) + `\n\n... (省略 ${up.length - 3000} 字)` : up)
      }

      behaviorRules = l0Result.rules
      l0Samples = l0Result.samples

      if (l0Result.rules.length > 0) {
        const ruleDetail = l0Result.rules.map((r, i) =>
          `[${i + 1}] When: ${r.when}\n    Do: ${r.do}\n    Not: ${r.not}${r.example ? `\n    例: "${r.example}"` : ''}`,
        ).join('\n\n')
        pushLog('success', `L0 行为规则提取完成 (${l0Result.rules.length} 条)`, ruleDetail)
      } else {
        pushLog('warn', 'L0 提取未产出任何行为规则', '可能样本太少或风格不够独特')
      }
    } catch (err) {
      // L0 提取失败不阻断整个流程, 降级为无 behaviorRules
      const msg = err instanceof Error ? err.message : String(err)
      const l0FailEntry = logs[l0StreamLogIdx]
      if (l0FailEntry) {
        l0FailEntry.level = 'error'
        l0FailEntry.label = 'L0 提取中断'
        const detailParts: string[] = []
        if (l0ReasoningAccum) detailParts.push(`[思维链 reasoning]\n${l0ReasoningAccum}`)
        if (l0ContentAccum) detailParts.push(`[正式输出 content]\n${l0ContentAccum}`)
        const streamDump = detailParts.join('\n\n')
        l0FailEntry.detail = streamDump
          ? `${streamDump}\n\n----- 错误 -----\n${msg}`
          : msg
      }
      pushLog('warn', 'L0 行为规则提取失败, 将降级使用旧格式', msg)
    }
  } else if (!llmL0Extractor) {
    pushLog('info', '未配置 L0 提取器, 跳过行为规则提取')
  }

  // ---- 阶段 3: 组装草稿 (不落盘!), 返回 preview 供用户确认 ----
  const now = Date.now()
  const mergedMetrics = isRefine
    ? mergeMetrics(refineBase!.metrics, prepared.metrics)
    : prepared.metrics
  const mergedSamples = (() => {
    // L0 提取可能产出更好的范文, 如果有则合并 (去重)
    const baseSamples = isRefine
      ? dedupSamples([...refineBase!.samples, ...prepared.samples]).slice(0, 6)
      : prepared.samples
    if (l0Samples && l0Samples.length > 0) {
      return dedupSamples([...l0Samples, ...baseSamples]).slice(0, 6)
    }
    return baseSamples
  })()
  const mergedSourceCount = (isRefine ? (refineBase!.sourceCount || 0) : 0) + prepared.sourceCount
  const mergedWordCount = (isRefine ? (refineBase!.sourceWordCount || 0) : 0) + prepared.sourceWordCount
  const mergedPaths = isRefine
    ? Array.from(new Set([...(refineBase!.sourcePaths || []), ...(prepared.sourcePaths || [])]))
    : prepared.sourcePaths

  // 【打磨模式保护】behaviorRules 合并策略 — 对齐范文/指标的迭代哲学:
  // - 非打磨: 直接用新规则 (可能为空)
  // - 打磨 + L0 成功: 新规则优先 + 按 when+do 指纹去重的旧规则兜底补入
  //   (LLM 已经通过 baseRules 做过印证强化, 这里再做一次保险合并, 防止 LLM 漏掉旧规则)
  // - 打磨 + L0 失败: 保留旧规则, 绝不擦除 — 这是关键的失败保护
  const mergedBehaviorRules: FingerprintBehaviorRule[] | undefined = (() => {
    const newRules = (behaviorRules && behaviorRules.length > 0) ? behaviorRules : []
    const oldRules = (isRefine && refineBase!.behaviorRules && refineBase!.behaviorRules.length > 0)
      ? refineBase!.behaviorRules
      : []

    if (!isRefine) {
      return newRules.length > 0 ? newRules : undefined
    }

    // --- 以下均为打磨分支 ---
    if (newRules.length === 0) {
      // 失败保护: L0 提取失败或没产出, 保留旧规则不擦除
      if (oldRules.length > 0) {
        pushLog('warn',
          `L0 提取未产出新规则, 保留原有 ${oldRules.length} 条行为规则`,
          '失败保护: 避免打磨反而让既有的高质量规则凭空消失.')
        return oldRules
      }
      return undefined
    }

    // 新规则优先, 按 when+do 指纹去重后, 把旧规则里没被覆盖的补入兜底
    const merged = mergeBehaviorRules(newRules, oldRules)
    const kept = merged.length - newRules.length
    if (kept > 0) {
      pushLog('info',
        `L0 规则合并: 新规则 ${newRules.length} 条 + 兜底保留旧规则 ${kept} 条 = 共 ${merged.length} 条`,
        '打磨策略: 新规则优先, 旧规则里 LLM 未复用的按 when+do 指纹去重兜底, 避免清零重来.')
    }
    return merged
  })()

  const draft: WriterFingerprint = {
    id: isRefine ? refineBase!.id : genId(),
    name: req.name,
    description: req.description,
    metrics: mergedMetrics,
    profile,
    samples: mergedSamples,
    behaviorRules: mergedBehaviorRules,
    sourceCount: mergedSourceCount,
    sourceWordCount: mergedWordCount,
    sourcePaths: mergedPaths,
    createdAt: isRefine ? refineBase!.createdAt : now,
    updatedAt: now,
    distillLog: logs.slice(),
  }

  const rulesSummary = mergedBehaviorRules && mergedBehaviorRules.length > 0 ? ` / L0 规则: ${mergedBehaviorRules.length} 条` : ''
  pushLog('success', '草稿已生成, 等待用户确认保存',
    `维度: ${Object.keys(profile).filter((k) => profile[k as keyof WriterFingerprintProfile]).length} / 范文: ${mergedSamples.length} 段${rulesSummary}`)

  // 进入 preview 阶段, 把 draft 交给 UI, 由 UI 决定下一步
  emit('preview', 85, isRefine ? '预览打磨后的指纹' : '预览提炼出的指纹', {
    draft,
  })

  // 这里不主动落盘, 由上层 (DistillDialog) 在用户点"保存"时调 commitDistilledFingerprint
  return draft
}

// ---- 打磨模式辅助: 指标加权合并 (旧 0.4 : 新 0.6) ----
function mergeMetrics(
  base: WriterFingerprintMetrics,
  incoming: WriterFingerprintMetrics,
): WriterFingerprintMetrics {
  const keys = new Set([...Object.keys(base), ...Object.keys(incoming)])
  const merged: WriterFingerprintMetrics = {}
  for (const k of keys) {
    const a = base[k]
    const b = incoming[k]
    if (typeof a === 'number' && typeof b === 'number') {
      merged[k] = a * 0.4 + b * 0.6
    } else if (typeof b === 'number') {
      merged[k] = b
    } else if (typeof a === 'number') {
      merged[k] = a
    }
  }
  return merged
}

// ---- 打磨模式辅助: 样本去重 (按文本前 50 字) ----
function dedupSamples(samples: WriterFingerprintSample[]): WriterFingerprintSample[] {
  const seen = new Set<string>()
  const out: WriterFingerprintSample[] = []
  for (const s of samples) {
    const key = s.text.slice(0, 50)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

/**
 * 打磨模式辅助: 行为规则合并 (新规则优先, 旧规则按 when+do 指纹去重后兜底补入).
 *
 * 设计意图 (对齐 L1 画像的 basePrompt 迭代哲学):
 *   LLM 已经通过 baseRules 参数做过"印证强化"的智能合并,
 *   这里再做一次确定性兜底 — 即使 LLM 忽略了某条旧规则, 也不让它凭空消失.
 *
 * 去重指纹: `when|do` 字符串归一化 (空白折叠 + 小写 + 去标点).
 *   选这两个字段是因为它们共同界定了"这是关于什么情境下做什么"的语言游戏,
 *   `not` 和 `examples` 会因打磨而变化, 不参与同一性判断.
 *
 * 合并规则:
 *   - 新规则先全部保留 (按 LLM 返回顺序 = 区分度降序)
 *   - 旧规则里指纹未被新规则覆盖的, 追加到末尾
 *   - 重复的旧规则丢弃 (LLM 已经保留或升级过它)
 */
function mergeBehaviorRules(
  newRules: FingerprintBehaviorRule[],
  oldRules: FingerprintBehaviorRule[],
): FingerprintBehaviorRule[] {
  const fingerprintOf = (r: FingerprintBehaviorRule): string => {
    const normalize = (s: string | undefined) => (s || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[.,;:!?。，；：！？、()（）"'"'`]/g, '')
      .trim()
    return `${normalize(r.when)}|${normalize(r.do)}`
  }

  const seen = new Set<string>()
  const merged: FingerprintBehaviorRule[] = []

  for (const rule of newRules) {
    const key = fingerprintOf(rule)
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(rule)
  }

  for (const rule of oldRules) {
    const key = fingerprintOf(rule)
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(rule)
  }

  return merged
}

/**
 * 保存草稿 (用户在 preview 阶段点"保存" 时调用)
 */
export async function commitDistilledFingerprint(
  draft: WriterFingerprint,
  onProgress?: (p: DistillProgress) => void,
): Promise<WriterFingerprint> {
  const logs = draft.distillLog ? draft.distillLog.slice() : []
  const push = (level: DistillLog['level'], label: string, detail?: string) => {
    logs.push({ time: Date.now(), level, label, detail })
  }

  push('info', '用户确认保存, 正在落盘...')
  onProgress?.({ stage: 'saving', progress: 92, message: '保存指纹...', logs: logs.slice() })

  const toSave: WriterFingerprint = {
    ...draft,
    updatedAt: Date.now(),
    distillLog: logs.slice(),
  }
  const saved = await saveFingerprint(toSave)

  push('success', `指纹 "${saved.name}" 已保存`, `id: ${saved.id}`)
  onProgress?.({
    stage: 'done',
    progress: 100,
    message: `指纹 "${saved.name}" 已生成`,
    logs: logs.slice(),
    result: saved,
  })
  return saved
}

// ============================================
// Mock/本地创建 (用于 UI 演示或离线场景)
// ============================================

/**
 * 创建一个空指纹 (手动编辑用)
 */
export function createEmptyFingerprint(name: string, description?: string): WriterFingerprint {
  const now = Date.now()
  return {
    id: genId(),
    name,
    description,
    metrics: {},
    profile: {},
    samples: [],
    sourceCount: 0,
    sourceWordCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 工具函数: 把指纹的 Layer 1+2+3 编译成 markdown (导出用)
 */
export function fingerprintToMarkdown(fp: WriterFingerprint): string {
  const lines: string[] = []
  lines.push(`# ${fp.name}`)
  if (fp.description) lines.push(`\n> ${fp.description}\n`)

  lines.push('\n## Layer 1: 结构化指标\n')
  for (const [k, v] of Object.entries(fp.metrics)) {
    if (v === undefined) continue
    lines.push(`- **${k}**: ${typeof v === 'number' ? v.toFixed(2) : v}`)
  }

  lines.push('\n## Layer 2: 自然语言画像\n')
  // 分 6 层输出, 结构化字段展开成 "类型 | 描述" 形式
  const layerGroups: Array<{ title: string; fields: Array<keyof WriterFingerprintProfile> }> = [
    { title: '微观语言层', fields: ['sentenceStyle', 'rhetoric', 'vocabulary', 'paragraphing', 'citation', 'avoid'] },
    { title: '话语/论证层', fields: ['argumentPattern', 'evidencePreference', 'counterArgHandling', 'argumentDepth', 'transitionStyle', 'informationDensity'] },
    { title: '说服力层', fields: ['appealBalance', 'emotionalTriggers', 'credibilityBuilding'] },
    { title: '态度层', fields: ['certaintyLevel', 'emotionalTemperature', 'readerDistance'] },
    { title: '意象/主题层', fields: ['frequentImagery', 'metaphorDomain', 'referencePreference'] },
    { title: '宏观结构层', fields: ['hookPattern', 'pacingPattern', 'turnPoints', 'closingPattern'] },
  ]
  const fieldLabels: Partial<Record<keyof WriterFingerprintProfile, string>> = {
    sentenceStyle: '句式特点', rhetoric: '修辞偏好', vocabulary: '词汇倾向',
    paragraphing: '段落组织', citation: '引用方式', avoid: '明确避免',
    argumentPattern: '论证模式', evidencePreference: '证据偏好',
    counterArgHandling: '反方处理', argumentDepth: '论证深度',
    transitionStyle: '过渡方式', informationDensity: '信息密度',
    appealBalance: 'Logos/Pathos/Ethos 配比', emotionalTriggers: '情绪调动手法',
    credibilityBuilding: '可信度建立',
    certaintyLevel: '确定性程度', emotionalTemperature: '情感温度', readerDistance: '读者距离',
    frequentImagery: '高频意象', metaphorDomain: '隐喻来源', referencePreference: '引用偏好',
    hookPattern: '开篇策略', pacingPattern: '推进节奏', turnPoints: '转折设置', closingPattern: '收尾策略',
  }
  const renderProfileValue = (v: unknown): string | null => {
    if (v == null) return null
    if (typeof v === 'string') {
      const s = v.trim()
      return s || null
    }
    if (typeof v === 'object') {
      const obj = v as Record<string, unknown>
      // AppealBalanceField
      if (typeof obj.logos === 'number' && typeof obj.pathos === 'number' && typeof obj.ethos === 'number') {
        const pct = (n: number) => `${Math.round(n * 100)}%`
        return `逻辑 ${pct(obj.logos)} / 情感 ${pct(obj.pathos)} / 人格 ${pct(obj.ethos)}${obj.description ? ` — ${obj.description}` : ''}`
      }
      // EnumPairField
      if (typeof obj.primary === 'string') {
        const head = obj.secondary ? `${obj.primary} + ${obj.secondary}` : `${obj.primary}`
        return `${head}${obj.description ? ` — ${obj.description}` : ''}`
      }
      // EnumField
      if (typeof obj.type === 'string') {
        return `${obj.type}${obj.description ? ` — ${obj.description}` : ''}`
      }
    }
    return null
  }
  for (const group of layerGroups) {
    const groupLines: string[] = []
    for (const field of group.fields) {
      const label = fieldLabels[field]
      if (!label) continue
      const rendered = renderProfileValue(fp.profile[field])
      if (rendered) groupLines.push(`- **${label}**: ${rendered}`)
    }
    // 向后兼容: 旧 opening/closing 在对应组内降级显示
    if (group.title === '宏观结构层') {
      if (!fp.profile.hookPattern && fp.profile.opening) {
        groupLines.unshift(`- **开篇风格 (旧版)**: ${fp.profile.opening}`)
      }
      if (!fp.profile.closingPattern && fp.profile.closing) {
        groupLines.push(`- **收束风格 (旧版)**: ${fp.profile.closing}`)
      }
    }
    if (groupLines.length > 0) {
      lines.push(`### ${group.title}\n${groupLines.join('\n')}\n`)
    }
  }

  if (fp.samples.length > 0) {
    lines.push('\n## Layer 3: 范文样本\n')
    fp.samples.forEach((s, i) => {
      lines.push(`### 范文 ${i + 1}${s.source ? ` (来自 ${s.source})` : ''}\n`)
      if (s.reason) lines.push(`> ${s.reason}\n`)
      lines.push('```')
      lines.push(s.text)
      lines.push('```\n')
    })
  }

  return lines.join('\n')
}

// re-export types for consumers that only import from this module
export type { WriterFingerprint, WriterFingerprintMeta, WriterFingerprintMetrics, WriterFingerprintProfile, WriterFingerprintSample }
