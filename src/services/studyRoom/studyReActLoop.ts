/**
 * studyReActLoop.ts — 自习室 Dun 专属 ReAct 循环
 *
 * 和主 ReAct 引擎 (LocalClawService.runReActLoopFC) 的差异:
 * - 工具集: 自习室专用 (read_draft / write_draft / read_fingerprint / ask_user + 只读后端工具)
 * - 轮数: 20 上限 (vs 全局 100), 写作不该拖
 * - 简化: 无 Reflexion / Critic / GenePool / Governor / ContextEngine (自习室用不上重武器)
 * - 保留: 持续对话历史 (Q4=b) + 经验回写 (Q5=a, consolidatePostExecution 正常跑)
 * - 草稿: 全程留在前端 session 内存, 旧稿进版本系统, 永不触达本地磁盘的 writeFile
 *
 * 使命 (简言):
 *   让一个"真正的 Dun" (有工具 / 会探查 / 能反思) 在自习室里专心写稿,
 *   而不是把 Dun 矮化成 prompt 的流式代笔.
 */

import type { WriterFingerprint, WriterChatMessage, ExecTrace, ExecTraceToolCall } from '@/types'
import type { LoadedDun } from '@/services/studyRoom/writingDun'
import {
  streamChat,
  convertToolInfoToFunctions,
  getLLMConfig,
  type SimpleChatMessage,
  type FCToolCall,
} from '@/services/llmService'
import {
  executeStudyTool,
  STUDY_REACT_TOOLS,
  type StudyReActToolContext,
  type StudyToolResult,
} from '@/services/studyRoom/studyReActTools'
import { formatFingerprint } from '@/services/studyRoom/prompts'
import { dunManager } from '@/services/dunManager'
import { dunScoringService } from '@/services/dunScoringService'
import {
  consolidatePostExecution,
  type ConsolidationPayload,
  type ConsolidatorStoreActions,
} from '@/services/postExecutionConsolidator'
import { getServerUrl } from '@/utils/env'

// ============================================
// 配置常量 (自习室专属, 和 LocalClawService.CONFIG 独立)
// ============================================

const STUDY_CONFIG = {
  /** Q3=b: 自习室 ReAct 最多 20 轮 */
  MAX_ROUNDS: 20,
  /** Q4=b: 对话历史注入最多保留最近 N 条 user/assistant 消息 */
  MAX_HISTORY_MESSAGES: 8,
  /** 历史消息单条超过此长度截断 (防上下文膨胀) */
  MAX_HISTORY_MESSAGE_CHARS: 600,
  /** 工具调用前端 UI 摘要最大长度 */
  MAX_UI_SUMMARY_CHARS: 80,
  /** 单轮 LLM 调用超时 (ms) */
  LLM_ROUND_TIMEOUT: 120000,
}

// ============================================
// 类型: 入口签名 + 回调
// ============================================

/**
 * 循环运行时的回调 — 让调用方 (StudyRoomWorkspace) 把每个事件渲染到对话栏 UI.
 * 所有回调都是同步 / 触发即返回, 不应抛错 (抛错会打断循环).
 */
export interface StudyReActCallbacks {
  /**
   * LLM 产出的 assistant 文本增量 (可能跨多轮, 每轮末尾收一次).
   * 典型用途: 在对话栏维护一个 thinking 气泡, 每轮把 reasoningContent 或 content 追加上去.
   */
  onThinking?: (round: number, chunkText: string) => void

  /**
   * 每个 tool call 开始时触发.
   * 典型 UI: thinking 气泡标签切换为 "调用 {tool}...", 短暂渲染关键参数.
   */
  onToolCall?: (round: number, toolName: string, args: Record<string, unknown>) => void

  /**
   * 每个 tool call 结束时触发.
   * 典型 UI: thinking 气泡追加 "{tool} ✓ {uiSummary}".
   */
  onToolResult?: (
    round: number,
    toolName: string,
    result: StudyToolResult,
  ) => void

  /**
   * write_draft 工具成功调用时触发 — 调用方应做两件事:
   * 1. saveVersion(旧草稿, trigger='full_writing') — 把被替换的那版存为历史
   * 2. updateDocument(新草稿) — 把 session.document 切到新版本
   *
   * 注意: 这个回调在循环内部被 await, 所以**必须**是 async 并返回, 否则新草稿不会进 session 状态.
   * 回调 throw 会导致 write_draft 工具结果变成 error, LLM 会在下一轮得知并决定重试或放弃.
   */
  onDraftWrite: (newDraft: string) => Promise<void>

  /**
   * ask_user 工具调用时, 循环会同步挂起等用户回答.
   * 当前版本暂不实现 (STUDY_REACT_TOOLS 里 ask_user 会降级为"LLM 自主决策"),
   * 留着这个钩子给后续做"弹出输入框 -> await 用户确认"时用.
   */
  onAskUser?: (question: string) => Promise<string>

  /**
   * 循环结束时触发一次 (无论成功/失败/中止).
   * phase 区分终止原因, 便于 UI 展示不同提示.
   */
  onDone?: (phase: StudyReActCompletionPhase, summary: string, rounds: number) => void
}

export type StudyReActCompletionPhase =
  | 'natural'        // LLM 在未调 write_draft 情况下结束对话 (可能是回答问题 / 讨论)
  | 'draft_finalized' // 调了 write_draft 且循环正常结束 (主路径)
  | 'max_rounds'     // 达 20 轮上限强制结束
  | 'aborted'        // 用户 signal.abort()
  | 'error'          // 未捕获异常 (LLM 调不通 / 后端宕了)

/** 入口参数 */
export interface RunStudyReActParams {
  /** session id — 经验回写/日志标识 */
  sessionId: string
  /** 扮演作者的 Dun */
  dun: LoadedDun
  /** 当前 session 的文风指纹 (优先级高于 Dun 人设里的风格描述) */
  fingerprint: WriterFingerprint | null
  /** 用户这一轮输入 */
  userMessage: string
  /** 近期对话 (最多 N 条会注入) */
  chatHistory: WriterChatMessage[]
  /** 当前草稿全文 (read_draft 的数据源, 也是 saveVersion 的"旧版") */
  getCurrentDraft: () => string
  /** 回调 */
  callbacks: StudyReActCallbacks
  /** 中止信号 (用户点停止时) */
  signal?: AbortSignal
  /**
   * 可选: Consolidator 需要的 store actions.
   * 类型和 @/services/postExecutionConsolidator#ConsolidatorStoreActions 保持一致,
   * 这样调用方从 store 里取出来的 actions 可以原样传入, 不需要做类型转换.
   */
  storeActions?: ConsolidatorStoreActions
}

/** 入口返回值 */
export interface RunStudyReActResult {
  /** 终止相位 */
  phase: StudyReActCompletionPhase
  /** 最终草稿 (调过 write_draft 的话是新版, 否则是原版) */
  finalDraft: string
  /** LLM 最后一轮的 assistant 文本 (给用户看的收尾总结) */
  finalResponse: string
  /** 实际走过的轮数 */
  rounds: number
  /** 追踪 id (经验回写用) */
  traceId: string
  /** 是否调过 write_draft (决定版本系统是否要多存一份) */
  didWriteDraft: boolean
}

// ============================================
// System Prompt 构建
// ============================================

/**
 * 构造自习室 ReAct 模式下的 system prompt.
 *
 * 分层 (从上到下优先级递减, 但文风指纹除外 — 它放在最后但标注"最高优先级"):
 * 1. 角色锚定: 你是 {Dun.name}, 你的人设
 * 2. Dun SOP (方法论 / 写作习惯)
 * 3. 目标函数 (可选)
 * 4. 文风指纹 (最高优先级)
 * 5. 工作模式: ReAct 协议 + 工具使用策略 + 收尾规则
 */
export function buildStudyReActSystemPrompt(
  dun: LoadedDun,
  fingerprint: WriterFingerprint | null,
): string {
  const sections: string[] = []

  // 1. 角色锚定
  sections.push(
    `# 你是 ${dun.name}`,
    dun.description ? `> ${dun.description}` : '',
    `**角色类型**: ${dun.archetype}${dun.tags.length > 0 ? ` · 标签: ${dun.tags.join(' / ')}` : ''}`,
  )

  // 2. Dun 的 SOP (方法论 / 写作偏好)
  if (dun.sopContent && dun.sopContent.trim()) {
    sections.push(
      `## 你的写作方法论 (来自 DUN.md)`,
      dun.sopContent.trim(),
    )
  }

  // 3. 目标函数 (可选)
  if (dun.objective && dun.objective.trim()) {
    const objLines = [`## 你的使命`, dun.objective.trim()]
    if (dun.strategy && dun.strategy.trim()) {
      objLines.push(`**策略**: ${dun.strategy.trim()}`)
    }
    sections.push(objLines.join('\n'))
  }

  // 4. 文风指纹 — 最高优先级
  const fingerprintBlock = formatFingerprint(fingerprint)
  if (fingerprintBlock) {
    sections.push(fingerprintBlock)
  }

  // 5. ReAct 工作模式 — 最小权力干预版
  //    设计原则: 只说清楚"你能做什么 / 机制是怎样的 / 输出格式要求",
  //              不替 Dun 决定"该做什么 / 做几次 / 什么时候停".
  //    过往版本里的"1-3 次探查就该动笔 / 调完 write_draft 不要再调 / 简短汇报 1-3 句"
  //    等先验纪律已被移除 — 那些是以效率为名的隐形决策, 会把放权得到的自主性慢慢又收回去.
  sections.push(
    [
      `---`,
      `## 工作模式`,
      ``,
      `这是一个自习室 ReAct 循环, 你最多可以循环 ${STUDY_CONFIG.MAX_ROUNDS} 轮.`,
      `每一轮你二选一:`,
      `- **调工具** (返回 function_call): 探查 / 查资料 / 修改草稿`,
      `- **直接回复** (不调工具): 本轮对话结束, 内容返回给用户`,
      ``,
      `你有哪些工具, 各自用途和入参请看每个工具自己的 description.`,
      `**如何使用 / 什么时候用 / 用几次, 全部由你自己判断.**`,
      ``,
      `## 几条必须知道的机制事实 (不是规则, 是客观机制)`,
      ``,
      `- \`write_draft\` 是**全文替换**模式: 调用它等于整篇重写, 旧版会自动存入历史版本. 如果你只想改局部, 需要先 \`read_draft\` 拿全文, 自己改完之后把完整新全文传进去.`,
      `- 同一个工具用同样的参数调两次, 会拿到同样的结果 — 这是模型机制, 不是规则. 所以重复调没有信息增益.`,
      `- \`ask_user\` 在当前自习室**不一定能阻塞等用户答复**. 工具返回内容会明确告诉你这次是"真的拿到用户回答"还是"已降级, 请自主决策". 请根据返回内容判断下一步, 不要默认它一定失败或一定成功.`,
      ``,
      `## 输出格式 (纯技术约束, 不涉及风格)`,
      ``,
      `- 最终回复**不要贴整篇正文** — 正文已通过 \`write_draft\` 进入左栏草稿, 如果回复里再贴一遍, UI 会变成两份全文, 对话栏会被撑爆.`,
      `- 调 \`write_draft\` 时, \`content\` 参数是 Markdown 正文本身 — 不要包在 \`\`\` 代码块里, 也不要在开头加"好的/下面是草稿:"之类的引导语.`,
      `- **风格冲突仲裁**: 如果你的人设风格和文风指纹冲突, 按指纹走 (指纹是从用户自己的范文提炼的, 比人设里的通用描述更贴这个具体用户).`,
    ].join('\n'),
  )

  return sections.filter((s) => s && s.trim()).join('\n\n')
}

// ============================================
// 主循环
// ============================================

/**
 * 运行一次自习室 ReAct 写作循环.
 *
 * 协议:
 * - 每轮调用 streamChat(messages, onChunk, signal, config, tools)
 * - 拿到 {content, toolCalls, finishReason}:
 *   - 有 toolCalls: 顺序执行每个 tool, 把 assistant 带 tool_calls 的消息 + tool 结果消息 push 回 messages, 进入下一轮
 *   - 无 toolCalls: 视为收尾, 记录 content 为 finalResponse 并退出
 * - 20 轮到顶强制收尾
 *
 * 经验回写是 fire-and-forget, 不阻塞返回.
 */
export async function runStudyReAct(
  params: RunStudyReActParams,
): Promise<RunStudyReActResult> {
  const {
    sessionId,
    dun,
    fingerprint,
    userMessage,
    chatHistory,
    getCurrentDraft,
    callbacks,
    signal,
    storeActions,
  } = params

  const traceId = `study-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const runStartTime = Date.now()

  // ---------- 1. 构造初始 messages ----------
  const systemPrompt = buildStudyReActSystemPrompt(dun, fingerprint)
  const messages: SimpleChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ]

  // 注入历史: 只取 user/assistant (跳过 thinking/system), 截断长消息
  const recentHistory = chatHistory
    .slice(-STUDY_CONFIG.MAX_HISTORY_MESSAGES * 2) // 粗取两倍, 过滤后再截到 MAX
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-STUDY_CONFIG.MAX_HISTORY_MESSAGES)
  for (const m of recentHistory) {
    const truncated =
      (m.content || '').length > STUDY_CONFIG.MAX_HISTORY_MESSAGE_CHARS
        ? m.content.slice(0, STUDY_CONFIG.MAX_HISTORY_MESSAGE_CHARS) + '\n...(已截断)'
        : m.content
    messages.push({
      role: m.role as 'user' | 'assistant',
      content: truncated || '',
    })
  }

  // 本轮用户消息
  messages.push({ role: 'user', content: userMessage })

  // ---------- 2. 准备工具 schema + 执行上下文 ----------
  const tools = convertToolInfoToFunctions(STUDY_REACT_TOOLS)

  // didWriteDraft 要在回调内修改, 但回调签名里不能带 ref — 用闭包变量桥接
  let didWriteDraft = false
  let latestDraftAfterWrite = ''

  const toolCtx: StudyReActToolContext = {
    sessionId,
    getDraft: getCurrentDraft,
    onDraftWrite: async (newDraft) => {
      didWriteDraft = true
      latestDraftAfterWrite = newDraft
      await callbacks.onDraftWrite(newDraft)
    },
    getFingerprint: () => fingerprint,
    onAskUser: callbacks.onAskUser,
    signal,
  }

  // ---------- 3. 追踪数据 (经验回写用) ----------
  const traceTools: ExecTraceToolCall[] = []

  // ---------- 4. 循环体 ----------
  let round = 0
  let finalResponse = ''
  let phase: StudyReActCompletionPhase = 'natural'

  try {
    while (round < STUDY_CONFIG.MAX_ROUNDS) {
      // 中止检查
      if (signal?.aborted) {
        phase = 'aborted'
        finalResponse = finalResponse || '任务已被用户中止。'
        break
      }

      round++

      // ---------- 4.1 LLM 调用 (流式) ----------
      // 注意两路流:
      //   onChunk          -> delta.content (正文)
      //   onReasoningChunk -> delta.reasoning_content (DeepSeek-R1 / QwQ 等思维模型的"思考"文本)
      // 两路都转发给 callbacks.onThinking, 让 UI 的 thinking 气泡能同时看到思考过程 + 正文.
      // 丢掉 reasoningContent 会让思维模型的推理对用户完全不可见, 体验严重割裂.
      let roundText = ''
      const streamResult = await streamChat(
        messages,
        (chunk) => {
          roundText += chunk
          callbacks.onThinking?.(round, chunk)
        },
        signal,
        undefined,
        tools,
        (reasoningChunk) => {
          // 思维文本不计入 roundText (不作为 finalResponse 的候选), 但展示给 UI
          callbacks.onThinking?.(round, reasoningChunk)
        },
      )

      const assistantText = streamResult.content || ''
      const reasoningContent = streamResult.reasoningContent || ''
      const toolCalls: FCToolCall[] = streamResult.toolCalls || []

      // ---------- 4.2 无 tool call: 视为收尾 ----------
      if (toolCalls.length === 0) {
        finalResponse = assistantText || roundText || finalResponse
        phase = didWriteDraft ? 'draft_finalized' : 'natural'

        // 把收尾的 assistant 消息推进 messages (保持对话一致性)
        // 携带 reasoning_content — DeepSeek 思维模式下一轮调用需要它, 否则部分 provider 会报错
        if (assistantText || reasoningContent) {
          messages.push({
            role: 'assistant',
            content: assistantText,
            ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
          })
        }
        break
      }

      // ---------- 4.3 有 tool call: 先把 assistant 带 tool_calls 的消息推进去 ----------
      messages.push({
        role: 'assistant',
        content: assistantText || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      })

      // ---------- 4.4 顺序执行所有 tool call ----------
      for (const tc of toolCalls) {
        // 中止检查 — 工具间隙也要检查, 防止中止信号被遗漏
        if (signal?.aborted) {
          phase = 'aborted'
          finalResponse = finalResponse || '任务已被用户中止。'
          break
        }

        const toolName = tc.function.name
        let toolArgs: Record<string, unknown> = {}
        try {
          toolArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
        } catch {
          // 参数解析失败, 构造 error 结果让 LLM 自己看到
          const errResult: StudyToolResult = {
            status: 'error',
            result: `工具 ${toolName} 的参数不是合法 JSON: ${tc.function.arguments?.slice(0, 200) || '(空)'}. 请检查 arguments 格式.`,
            uiSummary: `${toolName} 参数错误`,
          }
          callbacks.onToolCall?.(round, toolName, {})
          callbacks.onToolResult?.(round, toolName, errResult)
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: toolName,
            content: errResult.result,
          })
          traceTools.push({
            name: toolName,
            args: {},
            status: 'error',
            result: errResult.result,
            latency: 0,
            order: traceTools.length + 1,
          })
          continue
        }

        callbacks.onToolCall?.(round, toolName, toolArgs)

        // 执行工具
        const toolStartTime = Date.now()
        const result = await executeStudyTool(toolName, toolArgs, toolCtx)
        const toolLatency = Date.now() - toolStartTime

        callbacks.onToolResult?.(round, toolName, result)

        // 拼回 messages (role=tool)
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: toolName,
          content: truncateForMessage(result.result),
        })

        // 记录到 trace
        traceTools.push({
          name: toolName,
          args: toolArgs,
          status: result.status,
          result: result.result,
          latency: toolLatency,
          order: traceTools.length + 1,
        })
      }

      // aborted 可能在工具循环里被设置, 退出外层
      if (phase === 'aborted') break

      // ---------- 4.5 继续下一轮 ----------
      // (如果 didWriteDraft 已 true, 通常 LLM 下一轮会直接无 toolCall 收尾;
      //  但不强制, 让 LLM 自己决定是否还要再改第二版 — 自习室设计上允许同一轮对话里多次迭代)
    }

    // 循环结束时仍在循环里 = 达到轮数上限
    if (round >= STUDY_CONFIG.MAX_ROUNDS && phase !== 'aborted') {
      phase = 'max_rounds'
      if (!finalResponse) {
        finalResponse = didWriteDraft
          ? '已达到轮数上限, 本版草稿已保存. 如需继续打磨, 请再给一条指令.'
          : '已达到轮数上限, 还没定稿. 请把想法说得更聚焦一些, 我再来一遍.'
      }
    }
  } catch (err) {
    phase = 'error'
    const message = err instanceof Error ? err.message : String(err)
    finalResponse = `自习室 ReAct 循环异常: ${message}`
    console.error('[StudyReAct] Loop failed:', err)
  }

  // ---------- 5. 构造 finalDraft ----------
  const finalDraft = didWriteDraft ? latestDraftAfterWrite : getCurrentDraft()

  // ---------- 6. 触发完成回调 ----------
  const durationMs = Date.now() - runStartTime
  const toolsCalled = traceTools.map((t) => t.name)
  const errorCount = traceTools.filter((t) => t.status === 'error').length
  const runSuccess = phase === 'draft_finalized' || phase === 'natural'

  const doneSummary = buildDoneSummary(phase, round, toolsCalled, didWriteDraft)
  callbacks.onDone?.(phase, doneSummary, round)

  // ---------- 7. 经验回写 (Q5=a, fire-and-forget) ----------
  // 即使循环失败也记录 — 失败经验同样有价值 (consolidator 会写 failures.md)
  fireAndForgetPostExec({
    traceId,
    dunId: dun.id,
    userMessage,
    finalResponse,
    runSuccess,
    turnCount: round,
    traceTools,
    durationMs,
    errorCount,
    phase,
    storeActions,
  })

  return {
    phase,
    finalDraft,
    finalResponse,
    rounds: round,
    traceId,
    didWriteDraft,
  }
}

// ============================================
// 辅助函数
// ============================================

/** 拼回 messages 的 tool 结果要截断 — 防止上下文膨胀 */
function truncateForMessage(raw: string): string {
  const limit = 3000
  if (raw.length <= limit) return raw
  return raw.slice(0, limit) + `\n... [已截断, 原始长度 ${raw.length}]`
}

function buildDoneSummary(
  phase: StudyReActCompletionPhase,
  rounds: number,
  toolsCalled: string[],
  didWriteDraft: boolean,
): string {
  const toolSummary =
    toolsCalled.length > 0
      ? `调工具 ${toolsCalled.length} 次 (${[...new Set(toolsCalled)].join(' / ')})`
      : '未调工具'
  switch (phase) {
    case 'draft_finalized':
      return `${rounds} 轮收尾, ${toolSummary}, 草稿已更新`
    case 'natural':
      return `${rounds} 轮收尾, ${toolSummary}${didWriteDraft ? ', 草稿已更新' : ''}`
    case 'max_rounds':
      return `达 ${rounds} 轮上限强制收尾, ${toolSummary}`
    case 'aborted':
      return `用户中止 (${rounds} 轮), ${toolSummary}`
    case 'error':
      return `异常退出 (${rounds} 轮), ${toolSummary}`
    default:
      return `完成 (${rounds} 轮), ${toolSummary}`
  }
}

// ============================================
// 经验回写: 构造 ExecTrace + 调 Consolidator
// ============================================

interface FireAndForgetParams {
  traceId: string
  dunId: string
  userMessage: string
  finalResponse: string
  runSuccess: boolean
  turnCount: number
  traceTools: ExecTraceToolCall[]
  durationMs: number
  errorCount: number
  phase: StudyReActCompletionPhase
  storeActions?: ConsolidatorStoreActions
}

/**
 * 异步写回经验 — 不阻塞主流程返回.
 *
 * 四件事:
 * 1. 构造 ExecTrace
 * 2. dunManager.recordExperience — 写入 experience/successes.md 或 failures.md
 * 3. dunScoringService.updateFromTrace — 更新 Dun 评分 (streak, successRate, tool dimensions)
 * 4. consolidatePostExecution — LLM 驱动的记忆/知识/L1 晋升归纳 (可选, 需要 storeActions)
 */
function fireAndForgetPostExec(params: FireAndForgetParams): void {
  const {
    traceId,
    dunId,
    userMessage,
    finalResponse,
    runSuccess,
    turnCount,
    traceTools,
    durationMs,
    errorCount,
    phase,
    storeActions,
  } = params

  // ---------- 构造 ExecTrace ----------
  const completionPath: ExecTrace['completionPath'] =
    phase === 'aborted' ? 'aborted' :
    phase === 'max_rounds' ? 'max_turns' :
    phase === 'error' ? 'unrecoverable_error' :
    'natural'

  const trace: ExecTrace = {
    id: traceId,
    task: userMessage.slice(0, 200),
    tools: traceTools,
    success: runSuccess,
    completionPath,
    duration: durationMs,
    timestamp: Date.now(),
    tags: ['study-room', 'dun-writing'],
    turnCount,
    errorCount,
    retryCount: 0,
    activeDunId: dunId,
    llmModel: getLLMConfig().model || 'unknown',
    llmProvider: 'study-room',
    // 自习室没走 Governor / BaseSequence / Ledger 等主引擎机制, 这些字段留空
  }

  // ---------- 1. Dun 经验记录 ----------
  dunManager
    .recordExperience(
      dunId,
      userMessage,
      traceTools.map((t) => t.name),
      runSuccess,
      finalResponse,
    )
    .catch((err) => console.warn('[StudyReAct] recordExperience failed:', err))

  // ---------- 2. Dun 评分更新 + 3. Consolidator ----------
  // ensureLoaded 是异步的，需要在加载完成后才能安全调用 updateFromTrace
  // fireAndForgetPostExec 是同步函数，用 async IIFE 处理
  ;(async () => {
    let precomputedScoring: ConsolidationPayload['precomputedScoring'] | null = null
    try {
      // 确保评分缓存已从服务器加载，防止 getOrCreate 覆盖历史数据
      await dunScoringService.ensureLoaded(dunId, getServerUrl())
      precomputedScoring = dunScoringService.updateFromTrace(dunId, trace, finalResponse)
    } catch (err) {
      console.warn('[StudyReAct] DunScoring precompute failed:', err)
    }

    // ---------- 3. Consolidator (需要 storeActions 才能跑) ----------
    if (!storeActions) {
      console.log('[StudyReAct] Skip consolidator (no storeActions passed)')
      return
    }
    if (!precomputedScoring) {
      console.log('[StudyReAct] Skip consolidator (scoring precompute failed)')
      return
    }

    const payload: ConsolidationPayload = {
      dunId,
      trace,
      traceTools: traceTools.map((t) => ({
        name: t.name,
        status: t.status,
        result: t.result,
        args: t.args,
        latency: t.latency,
      })),
      userPrompt: userMessage,
      finalResponse: finalResponse || null,
      runSuccess,
      turnCount,
      precomputedScoring,
      promotableCandidates: [], // 自习室不接入 confidenceTracker 的 L1 候选
      sopContent: undefined,
      sopFitnessContext: undefined,
      bgSignal: undefined,
      serverUrl: getServerUrl(),
      entityTitles: [],
    }

    // storeActions 和 ConsolidatorStoreActions 同源同形, 原样透传即可, 不需要任何类型转换
    consolidatePostExecution(payload, storeActions)
      .then((sc) => {
        console.log(
          `[StudyReAct] Consolidator done: scoreChange=${sc > 0 ? '+' : ''}${sc}`,
        )
      })
      .catch((err) => {
        console.warn('[StudyReAct] Consolidator failed:', err)
      })
  })().catch((err) => {
    console.warn('[StudyReAct] Post-exec async block failed:', err)
  })
}
