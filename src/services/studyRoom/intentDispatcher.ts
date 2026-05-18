/**
 * Intent Dispatcher — LLM 意图分类 + 信任模式
 *
 * 流程:
 * 1. 先尝试本地快速匹配 (skill_mention / skill_remove / export)
 * 2. 其余走 chatBackground LLM 分类
 * 3. 根据 confidence 决定: >= 0.85 自动执行 (trust), < 0.85 确认卡片
 *
 * 本文件还导出 routeWriterMessage: Workspace 入口的粗粒度路由
 * (discuss / edit / write / unclear), 本地规则兜 80% 明确场景, 模糊才降级调 LLM.
 */

import type {
  WriterIntent, IntentCard, AgendaDoc, WritingBrief,
  WriterChatAttachment, LensKind,
  WriterMessageIntent, WriterChatMessage,
} from '@/types'
import { chatBackground } from '@/services/llmService'
import { INTENT_DISPATCHER_PROMPT, buildDispatcherPrompt } from './prompts'
import { WritingError } from './errors'
import { pipelineTracer } from './pipelineTracer'

// ============================================
// 常量
// ============================================

const TRUST_THRESHOLD = 0.85

const INTENT_SCOPE_LABELS: Record<string, string> = {
  draft_section: '草起段落',
  rewrite_section: '改写段落',
  revise_agenda: '修改议程',
  supplement_evidence: '补充证据',
  export_document: '导出全文',
  focus_section: '聚焦段落',
  ask_question: '提问',
  skill_mention: '添加技能',
  skill_remove: '移除技能',
  unknown: '未识别',
}

// ============================================
// 本地快速匹配 (不需要 LLM)
// ============================================

function tryLocalMatch(
  userMessage: string,
  attachments?: WriterChatAttachment[],
): IntentCard | null {
  // @mention skill 附件 → skill_mention
  if (attachments && attachments.length > 0) {
    const skillAttach = attachments.find((a) => a.type === 'skill')
    if (skillAttach) {
      const intent: WriterIntent = {
        kind: 'skill_mention',
        skillName: skillAttach.name,
        priority: 'primary',
      }
      return {
        intent,
        scopeDescription: `添加技能: ${skillAttach.name}`,
        plannedActions: ['将技能加入写作契约', '后续段落遵循此技能约束'],
        confidence: 0.98,
      }
    }
  }

  const trimmed = userMessage.trim()

  // "导出" / "export"
  if (/^(导出|输出|下载|export)\s*[全整]?[文篇]?$/i.test(trimmed)) {
    return {
      intent: { kind: 'export_document' },
      scopeDescription: '导出全文为 Markdown',
      plannedActions: ['合并所有段落', '生成完整文档', '保存到本地'],
      confidence: 0.95,
    }
  }

  // 移除技能: "移除/删除 @xxx" 或 "不要用 xxx 技能"
  const removeMatch = trimmed.match(/^(?:移除|删除|去掉|不要用?)\s*@?(.+?)(?:\s*技能)?$/)
  if (removeMatch) {
    return {
      intent: { kind: 'skill_remove', skillName: removeMatch[1].trim() },
      scopeDescription: `移除技能: ${removeMatch[1].trim()}`,
      plannedActions: ['从写作契约中移除此技能'],
      confidence: 0.92,
    }
  }

  return null
}

// ============================================
// LLM 分类
// ============================================

interface DispatchContext {
  agenda?: AgendaDoc | null
  brief?: WritingBrief
  recentIntents?: Array<{ kind: string; sectionId?: string }>
  focusedSectionId?: string | null
  attachments?: WriterChatAttachment[]
}

async function classifyWithLLM(
  userMessage: string,
  context: DispatchContext,
  signal?: AbortSignal,
): Promise<IntentCard> {
  const userPrompt = buildDispatcherPrompt(userMessage, context)
  const messages = [
    { role: 'system' as const, content: INTENT_DISPATCHER_PROMPT },
    { role: 'user' as const, content: userPrompt },
  ]

  const raw = await chatBackground(messages, { signal, priority: 5 })

  if (!raw) {
    return fallbackUnknown(userMessage)
  }

  try {
    // 清理 markdown 代码块包裹
    let cleaned = raw.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    }

    const parsed = JSON.parse(cleaned)
    const intent = normalizeIntent(parsed.intent)
    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5

    return {
      intent,
      scopeDescription: parsed.scopeDescription
        || INTENT_SCOPE_LABELS[intent.kind]
        || '操作',
      plannedActions: Array.isArray(parsed.plannedActions)
        ? parsed.plannedActions
        : [],
      confidence,
    }
  } catch {
    return fallbackUnknown(userMessage)
  }
}

/**
 * 将 LLM 返回的 raw intent 规范化为 WriterIntent
 */
function normalizeIntent(raw: Record<string, unknown>): WriterIntent {
  const kind = raw?.kind as string
  switch (kind) {
    case 'draft_section':
      return {
        kind: 'draft_section',
        sectionId: (raw.sectionId as string) || '',
        hint: raw.hint as string | undefined,
      }
    case 'rewrite_section':
      return {
        kind: 'rewrite_section',
        sectionId: (raw.sectionId as string) || '',
        instruction: (raw.instruction as string) || '',
      }
    case 'revise_agenda':
      return {
        kind: 'revise_agenda',
        instruction: (raw.instruction as string) || '',
      }
    case 'supplement_evidence':
      return {
        kind: 'supplement_evidence',
        query: (raw.query as string) || '',
        lenses: raw.lenses as LensKind[] | undefined,
      }
    case 'export_document':
      return { kind: 'export_document' }
    case 'focus_section':
      return {
        kind: 'focus_section',
        sectionId: (raw.sectionId as string) || '',
      }
    case 'ask_question':
      return {
        kind: 'ask_question',
        question: (raw.question as string) || '',
      }
    case 'skill_mention':
      return {
        kind: 'skill_mention',
        skillName: (raw.skillName as string) || '',
      }
    case 'skill_remove':
      return {
        kind: 'skill_remove',
        skillName: (raw.skillName as string) || '',
      }
    default:
      return { kind: 'unknown', raw: JSON.stringify(raw) }
  }
}

function fallbackUnknown(userMessage: string): IntentCard {
  return {
    intent: { kind: 'unknown', raw: userMessage },
    scopeDescription: '未识别',
    plannedActions: [],
    confidence: 0,
  }
}

// ============================================
// 主入口
// ============================================

/**
 * 分派用户指令为结构化 IntentCard
 *
 * @returns IntentCard（含 confidence）
 */
export async function dispatchIntent(
  userMessage: string,
  context: DispatchContext,
  signal?: AbortSignal,
): Promise<IntentCard> {
  // 1. 先尝试本地快速匹配
  const local = tryLocalMatch(userMessage, context.attachments)
  if (local) return local

  // 2. LLM 分类
  try {
    return await classifyWithLLM(userMessage, context, signal)
  } catch (err) {
    if (signal?.aborted) {
      throw new WritingError({
        code: 'user_aborted',
        stage: 'dispatch',
        sessionId: context.brief?.id || 'unknown',
      })
    }
    // LLM 失败 → fallback unknown
    console.warn('[IntentDispatcher] LLM classification failed:', err)
    return fallbackUnknown(userMessage)
  }
}

/**
 * 信任模式判定: 是否应自动执行
 */
export function shouldAutoExecute(
  card: IntentCard,
  trustMode: boolean,
): boolean {
  if (!trustMode) return false
  if (card.confidence < TRUST_THRESHOLD) return false
  // 不自动执行的 intent 类型
  if (card.intent.kind === 'unknown') return false
  return true
}

/**
 * 对 IntentCard 生成确认描述 (用于 IntentCard UI 渲染)
 */
export function describeIntentCard(card: IntentCard): string {
  const label = INTENT_SCOPE_LABELS[card.intent.kind] || card.intent.kind
  const actions = card.plannedActions.length > 0
    ? card.plannedActions.map((a) => `  - ${a}`).join('\n')
    : '  (无明确操作)'
  const conf = `${(card.confidence * 100).toFixed(0)}%`
  return `[${label}] (${conf})\n${card.scopeDescription}\n${actions}`
}

// ============================================
// routeWriterMessage — Workspace 入口的粗粒度路由
// ============================================
//
// 与 dispatchIntent 的区别:
//   - dispatchIntent: 决定"改什么节/做什么细粒度动作" (draft_section / rewrite_section / ...)
//   - routeWriterMessage: 决定"走哪条管线" (discuss / edit / write / unclear)
//
// 设计动机:
//   原先每次用户发消息都必调一次 ~200 token 的 LLM 分类 (classifyWriterIntent),
//   这是首字延迟的大头. 80% 场景其实用本地规则就能直接判定.
//   本地命中 → 直接返回, confidence=1.0, source='local' (零延迟)
//   本地模糊 → 降级调 LLM (保留现有兜底能力, source='llm')

/** routeWriterMessage 结果 */
export interface RouteResult {
  intent: WriterMessageIntent
  confidence: number
  reason: string
  /** 来源: 本地规则命中 还是 LLM 降级分类 */
  source: 'local' | 'llm' | 'fallback'
}

/** 本地编辑动词 (祈使型, 指向已有文本): "改/删/加/写/润色/扩/缩/换/调整" 等 */
const LOCAL_EDIT_VERBS = /(^|[，,。；\s])(改|删|加|写成|润色|扩写|缩写|换成|调整|修改|重写|替换|精简|扩展|压缩|打磨|优化(一?下)?)/
/** 本地创作动词 (从零): "写一篇/起草/帮我写/来一份" 等 */
const LOCAL_WRITE_VERBS = /(写一?篇|写一段|起草|帮我写|来一份|来一篇|草拟|创作一?篇)/
/** 本地讨论标志: 疑问句、求分析、求观点 */
const LOCAL_DISCUSS_QUESTION = /(^|\s)(为什么|怎么|如何|是不是|对吗|你觉得|你认为|能否|可否|为啥)/
const LOCAL_DISCUSS_TAIL = /(吗|呢|\?|？)\s*$/
const LOCAL_DISCUSS_ANALYZE = /(分析一?下|讲讲|聊聊|说说|点评|评价|看法|观点)/
/** 深度打磨触发词: "深度打磨" "帮我抠逻辑" "压力测试" "挑战一下" "找漏洞" "经得起问吗" */
const LOCAL_DELIBERATE = /(深度打磨|抠.{0,2}逻辑|压力测试|挑战一下|找.{0,3}漏洞|经得起.{0,3}(问|挑战)|红队|逻辑审查|帮我诊断)/

/**
 * 本地规则分类 (纯同步, 0ms). 返回 null 表示"本地判不准, 需要降级到 LLM".
 *
 * 导出给 Dun 路径使用: Dun 模式下只用本地规则的 discuss 判定,
 * 不降级到 LLM — 避免引入 3s 等待, 保持"加载 Dun 就直接代笔"的快感.
 *
 * 硬规则顺序 (前者命中即定):
 *   1. 文档空态 + 创作动词 → write
 *   2. 文档非空 + 编辑动词 → edit
 *   3. 明显疑问/讨论标志 → discuss
 *   4. 文档空态 + 短消息 (< 15 字, 无编辑/讨论标志) → write (默认意图)
 *   5. 同时命中 edit + discuss 信号 → null (让 LLM 兜底)
 */
export function localRoute(
  userMessage: string,
  currentDocument: string,
): RouteResult | null {
  const msg = userMessage.trim()
  if (msg.length === 0) return null

  const docEmpty = !currentDocument || currentDocument.trim().length === 0
  const charCount = msg.replace(/\s/g, '').length

  const hitEditVerb = LOCAL_EDIT_VERBS.test(msg)
  const hitWriteVerb = LOCAL_WRITE_VERBS.test(msg)
  const hitQuestion = LOCAL_DISCUSS_QUESTION.test(msg) || LOCAL_DISCUSS_TAIL.test(msg)
  const hitAnalyze = LOCAL_DISCUSS_ANALYZE.test(msg)
  const hitDiscuss = hitQuestion || hitAnalyze

  // 规则 0: 深度打磨触发词 + 文档非空 → deliberate
  if (!docEmpty && LOCAL_DELIBERATE.test(msg)) {
    return {
      intent: 'deliberate',
      confidence: 0.95,
      reason: 'local: 深度打磨触发词命中',
      source: 'local',
    }
  }

  // 规则 1: 明确的创作动词 → write (优先级最高, 不受文档状态影响)
  if (hitWriteVerb && !hitDiscuss) {
    return {
      intent: 'write',
      confidence: 0.95,
      reason: 'local: 创作动词命中',
      source: 'local',
    }
  }

  // 规则 2: 文档非空 + 编辑动词 + 无讨论信号 → edit
  if (!docEmpty && hitEditVerb && !hitDiscuss) {
    return {
      intent: 'edit',
      confidence: 0.9,
      reason: 'local: 编辑动词 + 文档非空',
      source: 'local',
    }
  }

  // 规则 3: 明显疑问/讨论 + 无编辑动词 → discuss
  if (hitDiscuss && !hitEditVerb && !hitWriteVerb) {
    return {
      intent: 'discuss',
      confidence: 0.88,
      reason: 'local: 疑问/讨论标志命中',
      source: 'local',
    }
  }

  // 规则 4: 文档空态 + 短消息 (≤ 15 字) + 无讨论信号 → write
  // (典型: 用户刚进自习室, 打了个简短的主题就回车. 应该默认是想写.)
  if (docEmpty && charCount <= 15 && !hitDiscuss && !hitEditVerb) {
    return {
      intent: 'write',
      confidence: 0.85,
      reason: 'local: 空文档 + 短消息',
      source: 'local',
    }
  }

  // 规则 5: 文档空态 + 非问句 + 没有编辑动词 + 有内容描述 (≥ 10 字) → write
  // (典型: "关于 AI 教育的报告, 要分析三个层面..." 这种带描述的写作需求)
  if (docEmpty && !hitDiscuss && !hitEditVerb && charCount >= 10) {
    return {
      intent: 'write',
      confidence: 0.8,
      reason: 'local: 空文档 + 无讨论信号',
      source: 'local',
    }
  }

  // 规则 6: 同时命中 edit + discuss 信号 → 不判定, 让 LLM 兜底
  // 规则 7: 文档非空 + 短消息 (≤ 8 字) 且无任何信号 → 不判定, 让 LLM 兜底
  //          (例: 用户发 "嗯" "好的" 这种, 需要看上下文)
  return null
}

/**
 * routeWriterMessage — Workspace 入口的粗粒度路由.
 *
 * 路由策略:
 *   1. 本地规则命中 → 直接返回 (零延迟, confidence ≥ 0.8, source='local')
 *   2. 本地模糊 → 降级调 LLM 分类 (保留现有能力, source='llm')
 *   3. LLM 不可用 / 失败 → fallback: 文档空→write, 文档非空→edit (source='fallback')
 *
 * @param llmFallback 当本地规则判不准时使用的 LLM 分类函数. 由调用方注入,
 *                    避免 intentDispatcher 反向依赖 writingService, 保持分层.
 */
export async function routeWriterMessage(
  userMessage: string,
  options: {
    currentDocument: string
    chatHistory?: WriterChatMessage[]
    signal?: AbortSignal
  },
  llmFallback: (
    userMessage: string,
    opts: { currentDocument: string; chatHistory?: WriterChatMessage[]; signal?: AbortSignal },
  ) => Promise<{ intent: WriterMessageIntent; confidence: number; reason: string }>,
): Promise<RouteResult> {
  // Pipeline trace: 这是一个独立的 "意图路由" phase.
  // 仅在 tracer 未激活时自启一次 mini 会话 (因为 routeWriterMessage 是 Workspace 分发前的独立步骤,
  // 后续的 runFullWriting/runConversationalEdit/runWriterChat 会再各自 start 一次).
  const ownsTracer = !pipelineTracer.isActive()
  if (ownsTracer) {
    pipelineTracer.start('intent-route', 'routeWriterMessage')
  }

  try {
    // Step 1: 本地规则
    const local = localRoute(userMessage, options.currentDocument)
    if (local) {
      pipelineTracer.event('intent.route', {
        source: 'local',
        intent: local.intent,
        confidence: local.confidence,
      })
      return local
    }

    // Step 2: 降级 LLM 分类 (3 秒硬超时, 避免后端代理 504 拖 30+ 秒)
    const LLM_ROUTE_TIMEOUT_MS = 3000
    try {
      const llmResult = await pipelineTracer.span('intent.route.llm', () =>
        Promise.race<{ intent: WriterMessageIntent; confidence: number; reason: string }>([
          llmFallback(userMessage, options),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`intent.route.llm timeout ${LLM_ROUTE_TIMEOUT_MS}ms`)),
              LLM_ROUTE_TIMEOUT_MS,
            ),
          ),
        ]),
      )
      const source = llmResult.confidence > 0 ? 'llm' : 'fallback'
      pipelineTracer.annotate('intent.route.llm', {
        source,
        intent: llmResult.intent,
        confidence: llmResult.confidence,
      })
      return {
        intent: llmResult.intent,
        confidence: llmResult.confidence,
        reason: llmResult.reason || 'llm classified',
        source,
      }
    } catch (err) {
      if (options.signal?.aborted) throw err
      console.warn('[routeWriterMessage] LLM fallback failed (or timed out):', err)
      // Step 3: 硬 fallback — 文档空→write, 文档非空→edit
      const docEmpty = !options.currentDocument || options.currentDocument.trim().length === 0
      const result: RouteResult = {
        intent: docEmpty ? 'write' : 'edit',
        confidence: 0,
        reason: 'fallback: classifier unavailable or timeout',
        source: 'fallback',
      }
      pipelineTracer.event('intent.route.hard_fallback', { intent: result.intent })
      return result
    }
  } finally {
    if (ownsTracer) pipelineTracer.finishAndPrint()
  }
}
