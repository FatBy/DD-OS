/**
 * StudyRoomWorkspace — 自习室工作区 v2
 *
 * 布局 (三栏):
 *   左侧栏: StudySidebar (记忆/指纹设置)
 *   中栏: WriterChatPanel (完整对话框, 主交互区)
 *   右栏: ArticleView (成稿展示/编辑)
 *
 * 顶部: StatusBar (标题 + 状态 + 导出)
 *
 * 流程: 对话驱动, 一气呵成
 *   用户在对话框输入 → runFullWriting 自动串行 (P2→P3→全文流式)
 *   用户说"第二段太短了" → runConversationalEdit 修改
 */

import { useState, useCallback, useRef, useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from '@/store'
import type {
  StudySessionRuntime, WriterChatMessage, WriterChatAttachment, SkillRef,
  WriterMessageIntent, SuggestedEdit, ProfileSuggestion, Toast,
} from '@/types'
import {
  runIntake,
  runFullWriting,
  runConversationalEdit,
  runWriterChat,
  classifyWriterIntent,
  exportSession,
  type WritingProgress,
} from '@/services/studyRoom/writingService'
import { routeWriterMessage, localRoute, type RouteResult } from '@/services/studyRoom/intentDispatcher'
import { matchSkills, splitSkillsByUsability } from '@/services/studyRoom/skillMatcher'
import { applyProfileSuggestion } from '@/services/studyRoom/writerProfile'
import { runStudyReActWriting, type RunStudyReActWritingResult } from '@/services/studyRoom/writingDun'
import { getFingerprintSync } from '@/services/studyRoom/styleFingerprint'
import { runDeliberationUntilUserChoice } from '@/services/studyRoom/deliberationService'
import { StatusBar } from './StatusBar'
import { ArticleView } from './ArticleView'
import { WriterChatPanel, WriterInstructionBar } from './WriterChatPanel'
import { StudySidebar } from './sidebar/StudySidebar'

interface Props {
  session: StudySessionRuntime
}

/** 本地正则: 特殊命令识别 (不走 LLM) */
const EXPORT_REGEX = /^(导出|export|下载)\s*$/i
const CHAT_WIDTH_STORAGE_KEY = 'studyRoom:workspace:chatWidth'
const DEFAULT_CHAT_WIDTH = 380
const MIN_CHAT_WIDTH = 320
const MAX_CHAT_WIDTH = 560
const MIN_MANUSCRIPT_WIDTH = 540

function clampChatWidth(width: number, availableWidth?: number): number {
  const usableWidth = availableWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1200)
  const responsiveMin = Math.min(MIN_CHAT_WIDTH, Math.max(280, usableWidth * 0.34))
  const responsiveMax = Math.max(
    responsiveMin,
    Math.min(MAX_CHAT_WIDTH, usableWidth - MIN_MANUSCRIPT_WIDTH),
  )
  return Math.round(Math.min(Math.max(width, responsiveMin), responsiveMax))
}

function readChatWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_CHAT_WIDTH
  try {
    const saved = Number(localStorage.getItem(CHAT_WIDTH_STORAGE_KEY))
    if (Number.isFinite(saved) && saved > 0) {
      return clampChatWidth(saved)
    }
  } catch { /* noop */ }
  return DEFAULT_CHAT_WIDTH
}

function buildMessageWithFileAttachments(message: string, attachments?: WriterChatAttachment[]): string {
  const files = (attachments || []).filter((item) => item.type === 'file')
  if (files.length === 0) return message

  const fileBlocks = files.map((file, index) => {
    const meta = [
      `文件名: ${file.name}`,
      file.mimeType ? `类型: ${file.mimeType}` : null,
      file.size ? `大小: ${file.size} bytes` : null,
      file.error ? `读取状态: ${file.error}` : null,
    ].filter(Boolean).join('\n')

    return [
      `### 附件 ${index + 1}`,
      meta,
      file.content ? `\n内容:\n\`\`\`\n${file.content}\n\`\`\`` : '\n内容: [未读取到文本内容]',
    ].join('\n')
  }).join('\n\n')

  return `${message}\n\n---\n以下是用户随消息附加的文件内容，请作为本轮写作上下文使用:\n\n${fileBlocks}`
}

function generateMessageId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// ============================================
// Dun ReAct 分支的 UI 辅助函数 (纯函数, 放在组件外)
// ============================================

/**
 * 构造工具调用的 UI 提示文本 — 用于 dispatchDunReAct 的 thinking 气泡里展示
 * Dun 在干嘛. 只展示参数要点, 不展示原始 JSON (避免对话栏刷屏).
 *
 * 约束: 单次返回 <= 60 字符, 超过就截断, 保证气泡紧凑.
 */
function describeToolArgsForUI(toolName: string, args: Record<string, unknown>): string {
  const trim = (s: string, max = 40) => (s.length > max ? s.slice(0, max) + '…' : s)
  switch (toolName) {
    case 'read_draft':
      return '读当前草稿'
    case 'write_draft': {
      const content = typeof args.content === 'string' ? args.content : ''
      return `交稿 (${content.replace(/\s/g, '').length} 字)`
    }
    case 'read_fingerprint':
      return '读文风指纹'
    case 'ask_user':
      return `提问: ${trim(String(args.question || '?'))}`
    case 'readFile':
      return `读文件: ${trim(String(args.path || '?'))}`
    case 'searchMemory':
      return `搜记忆: ${trim(String(args.query || '?'))}`
    case 'searchWiki':
      return `搜 Wiki: ${trim(String(args.query || '?'))}`
    case 'webSearch':
      return `联网搜: ${trim(String(args.query || '?'))}`
    case 'webFetch':
      return `抓网页: ${trim(String(args.url || '?'), 50)}`
    default: {
      // 未知工具: 把前两个参数拼成概要, 避免直接 JSON.stringify 产生过长字符串
      const entries = Object.entries(args).slice(0, 2)
      if (entries.length === 0) return '(无参数)'
      return entries
        .map(([k, v]) => `${k}=${trim(String(v ?? ''), 20)}`)
        .join(', ')
    }
  }
}

/**
 * 根据 ReAct 循环的结果 (phase / 是否调过 write_draft) 构造给用户看的收尾总结.
 * 不同 phase 的文案差异很大 — 成功交稿 / 纯聊天 / 超轮次 / 中止 / 异常.
 */
function buildDunReActSummaryMessage(
  dunName: string,
  result: RunStudyReActWritingResult,
  wordCount: number,
): string {
  const { phase, rounds, didWriteDraft, finalResponse } = result
  // finalResponse 可能是空字符串, 也可能是 LLM 的一两句收尾总结 — 有就附上, 没就省略
  const respTail = finalResponse && finalResponse.trim()
    ? `\n\n${finalResponse.trim()}`
    : ''

  switch (phase) {
    case 'draft_finalized':
      return (
        `**${dunName}** 已交稿 (${wordCount} 字, ${rounds} 轮). ` +
        `旧稿已存为历史版本, 可在版本面板回滚. ` +
        `想继续调整, 再给它一条指令即可.${respTail}`
      )
    case 'natural':
      if (didWriteDraft) {
        return (
          `**${dunName}** 更新了草稿 (${wordCount} 字, ${rounds} 轮), 并对你的问题做了说明.${respTail}`
        )
      }
      return (
        `**${dunName}** 这轮没有动笔, 只做了讨论/回答 (${rounds} 轮).${respTail}`
      )
    case 'max_rounds':
      return (
        `**${dunName}** 思考到 ${rounds} 轮上限仍未收敛${didWriteDraft ? ', 草稿已保留当前版本' : ''}. ` +
        `建议把诉求说得更聚焦, 或换个 Dun 试试.${respTail}`
      )
    case 'aborted':
      return `**${dunName}** 已被用户中止 (${rounds} 轮). 当前草稿保留.`
    case 'error':
      return (
        `**${dunName}** 在第 ${rounds} 轮遇到异常, 已保留现有草稿. ` +
        `如果是 LLM 配置问题, 去链接站检查一下.${respTail}`
      )
    default:
      return `**${dunName}** 完成 (${rounds} 轮).${respTail}`
  }
}

export function StudyRoomWorkspace({ session }: Props) {
  const updateDocument = useStore((s) => s.updateDocument)
  const addChatMessage = useStore((s) => s.addChatMessage)
  const updateChatMessage = useStore((s) => s.updateChatMessage)
  const setEvidencePool = useStore((s) => s.setEvidencePool)
  const mergeEvidence = useStore((s) => s.mergeEvidence)
  const addSkillsToBrief = useStore((s) => s.addSkillsToBrief)
  const setMemorySnippets = useStore((s) => s.setMemorySnippets)
  const updateAgenda = useStore((s) => s.updateAgenda)
  const saveSessionToBackend = useStore((s) => s.saveSessionToBackend)
  const checkLocalDraft = useStore((s) => s.checkLocalDraft)
  const restoreDraft = useStore((s) => s.restoreDraft)
  const discardDraft = useStore((s) => s.discardDraft)
  const saveVersion = useStore((s) => s.saveVersion)
  // Consolidator 经验回写需要的 store actions — 经由 runStudyReActWriting 的 storeActions 传入,
  // ConsolidatorStoreActions 会原子写回 Dun 评分、Toast 反馈、引用现有 Dun 做关联.
  const updateDun = useStore((s) => s.updateDun)
  const addToast = useStore((s) => s.addToast)
  const duns = useStore((s) => s.duns)

  // --- 深度打磨 store actions ---
  const startDeliberation = useStore((s) => s.startDeliberation)
  const updateDeliberationPhase = useStore((s) => s.updateDeliberationPhase)
  const setDeliberationDiagnosis = useStore((s) => s.setDeliberationDiagnosis)
  const setDeliberationRedTeam = useStore((s) => s.setDeliberationRedTeam)
  const setDeliberationProposal = useStore((s) => s.setDeliberationProposal)
  const setDeliberationError = useStore((s) => s.setDeliberationError)

  // 使用 openClawSkills 作为 skills 数据源 (修复 Qoder 的 skills 数据源 bug)
  const openClawSkills = useStore((s) => s.openClawSkills)
  const storeSkills = openClawSkills
    .filter((s) => s.status === 'active')
    .map((s) => ({
      name: s.name,
      description: s.description,
      keywords: s.keywords,
      whenToUse: s.whenToUse,
      tags: s.tags,
      enabled: true,
      toolType: s.toolType,
      category: s.category,
      instructions: s.instructions,
    }))

  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [statusLabel, setStatusLabel] = useState<string | undefined>()
  const [chatWidth, setChatWidth] = useState(() => readChatWidth())
  const [resizing, setResizing] = useState(false)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedLenRef = useRef(0)
  const savingRef = useRef(false)

  // 自动保存 (debounce 3s) — 用于常规的 document/chat 变更
  const scheduleAutoSave = useCallback(() => {
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current)
    autoSaveRef.current = setTimeout(() => {
      saveSessionToBackend().catch((e) => console.warn('[StudyRoom] autoSave failed:', e))
    }, 3000)
  }, [saveSessionToBackend])

  // 立即保存 — 用于写作结束、异常、关闭前等关键时刻
  const flushSaveNow = useCallback(async () => {
    if (autoSaveRef.current) {
      clearTimeout(autoSaveRef.current)
      autoSaveRef.current = null
    }
    if (savingRef.current) return
    savingRef.current = true
    try {
      await saveSessionToBackend()
    } catch (e) {
      console.warn('[StudyRoom] flushSave failed:', e)
    } finally {
      savingRef.current = false
    }
  }, [saveSessionToBackend])

  // 流式过程中的节流保存:每累计 500 字触发一次
  const maybeStreamSave = useCallback((currentLen: number) => {
    if (currentLen - lastSavedLenRef.current >= 500) {
      lastSavedLenRef.current = currentLen
      scheduleAutoSave()
    }
  }, [scheduleAutoSave])

  // 关闭/刷新前兜底保存 — 使用 keepalive 保证请求能发出
  useEffect(() => {
    const handler = () => {
      // 清掉 debounce, 直接同步触发一次 (使用 keepalive 保证页面关闭后仍能送达)
      if (autoSaveRef.current) {
        clearTimeout(autoSaveRef.current)
        autoSaveRef.current = null
      }
      // 这里不能用 async, 让 slice 自己去发 (saveSessionToBackend 内部已支持 keepalive 语义)
      saveSessionToBackend().catch(() => { /* 页面即将关闭, 忽略错误 */ })
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [saveSessionToBackend])

  // 会话切换时检查本地草稿 (极端情况下的恢复: 断电/崩溃/浏览器被杀)
  // 条件: 后端 document 为空或明显短于本地草稿时才弹提示
  useEffect(() => {
    const draftInfo = checkLocalDraft(session.id)
    if (!draftInfo || !draftInfo.hasDraft) return

    const savedTime = new Date(draftInfo.savedAt).toLocaleString('zh-CN', {
      hour: '2-digit', minute: '2-digit', month: '2-digit', day: '2-digit',
    })
    const wordCount = draftInfo.document.length
    const confirmed = window.confirm(
      `🧾 检测到未保存的本地草稿\n\n` +
      `保存时间: ${savedTime}\n` +
      `字数: ${wordCount} 字\n\n` +
      `是否恢复这份草稿? (取消将丢弃草稿)`,
    )
    if (confirmed) {
      restoreDraft(session.id)
    } else {
      discardDraft(session.id)
    }
    // 仅在 session.id 变化时触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // 添加思考链消息
  const addThinkingMessage = useCallback((progress: WritingProgress): string => {
    const messageId = generateMessageId()
    const thinkingMessage: WriterChatMessage = {
      id: messageId,
      role: 'thinking',
      content: progress.detail || progress.label,
      timestamp: Date.now(),
      thinkingLabel: progress.label,
      streaming: progress.stage === 'writing',
    }
    addChatMessage(thinkingMessage)
    return messageId
  }, [addChatMessage])

  /**
   * 插入一条"风格档案待确认建议"消息 (Phase 5).
   * LLM 在 tool loop 中通过 append_to_memory 想往 writerProfile 里加内容时,
   * 不再直接落库, 而是以 ProfileSuggestion 形式回吐, 由此函数挂到独立的 assistant 消息上,
   * 前端渲染确认卡片, 用户点"接受入档"才真正写入.
   */
  const addProfileSuggestionMessage = useCallback((suggestions: ProfileSuggestion[]) => {
    if (!suggestions || suggestions.length === 0) return
    const normalized: ProfileSuggestion[] = suggestions.map((s) => ({
      ...s,
      status: s.status || 'pending',
    }))
    addChatMessage({
      id: generateMessageId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      profileSuggestions: normalized,
    })
  }, [addChatMessage])

  // 判断是否为首次写作 (document 为空)
  const isFirstWriting = !session.document.trim()

  // ============================================
  // 三路分发器 — 被 handleChatSubmit 按意图选一调用
  // ============================================

  /** 首次写作分支: runFullWriting */
  const dispatchWrite = useCallback(async (
    userMessage: string,
    newStyleSkillRefs: SkillRef[],
  ) => {
    const brief = runIntake(userMessage, {
      skills: storeSkills,
      userPickedSkills: newStyleSkillRefs.length > 0 ? newStyleSkillRefs : undefined,
    })

    let lastThinkingId: string | undefined
    let writingReasoningId: string | undefined

    await runFullWriting(
      brief,
      storeSkills,
      session.id,
      {
        onProgress: (progress: WritingProgress) => {
          setStatusLabel(progress.label)

          if (lastThinkingId) {
            updateChatMessage(lastThinkingId, { streaming: false })
          }

          if (progress.stage === 'writing') {
            writingReasoningId = generateMessageId()
            addChatMessage({
              id: writingReasoningId,
              role: 'thinking',
              content: '准备撰写中...',
              timestamp: Date.now(),
              thinkingLabel: '撰写推理',
              streaming: true,
            })
            lastThinkingId = writingReasoningId
          } else if (progress.stage !== 'done' && progress.stage !== 'error') {
            lastThinkingId = addThinkingMessage(progress)
          } else {
            addChatMessage({
              id: generateMessageId(),
              role: 'assistant',
              content: progress.detail || progress.label,
              timestamp: Date.now(),
            })
            setStatusLabel(undefined)
          }
        },
        onDocumentDelta: (fullText: string) => {
          updateDocument(fullText)
          maybeStreamSave(fullText.length)
        },
        onEvidencePool: (pool) => {
          setEvidencePool(pool)
        },
        onAgenda: (agenda) => {
          updateAgenda(agenda)
        },
        onReasoningDelta: (fullReasoning: string) => {
          if (writingReasoningId) {
            updateChatMessage(writingReasoningId, {
              content: fullReasoning,
              streaming: true,
            })
          }
        },
        onMemoryRecalled: (snippets) => {
          setMemorySnippets(snippets)
        },
        onEvidenceDelta: (items) => {
          mergeEvidence(items)
        },
        onMemoryDelta: (items) => {
          // 首次写作时, tool loop 产出的记忆也存一份
          setMemorySnippets([...(session.memorySnippets || []), ...items])
        },
        onProfileSuggestions: (items) => {
          // Phase 5: 挂到一条独立的 assistant 消息上, 让用户在 UI 卡片里决定是否入档
          addProfileSuggestionMessage(items)
        },
      },
      { enableToolLoop: true },
    )

    // 首次完整写作完成 → 存一个版本快照 (trigger: full_writing)
    // 从 store 拿最新 document (避免闭包里拿到旧值)
    const latestDoc = useStore.getState().studySessions[session.id]?.document || ''
    if (latestDoc.trim()) {
      saveVersion(session.id, {
        document: latestDoc,
        trigger: 'full_writing',
        summary: '首次生成完整文章',
      }).catch((e) => console.warn('[StudyRoom] saveVersion(full_writing) failed:', e))
    }
  }, [
    session, storeSkills,
    addChatMessage, updateChatMessage, addThinkingMessage,
    updateDocument, setEvidencePool, updateAgenda,
    mergeEvidence, setMemorySnippets,
    maybeStreamSave, saveVersion,
  ])

  /** 改文分支: runConversationalEdit */
  const dispatchEdit = useCallback(async (userMessage: string, options?: { enableToolLoop?: boolean }) => {
    setStatusLabel('修改中...')

    const editReasoningId = generateMessageId()
    addChatMessage({
      id: editReasoningId,
      role: 'thinking',
      content: '正在分析你的修改指令...',
      timestamp: Date.now(),
      thinkingLabel: '修改推理',
      streaming: true,
    })

    // 工具调用进度显示用的专用气泡
    let toolProgressId: string | undefined

    // 先做一次快速的本地 skill 匹配, 把相关 auto skill 补进 brief (低成本, 不走 LLM)
    const autoMatched = matchSkills(userMessage, storeSkills)
      .slice(0, 2)
      .filter((m) => !session.brief.skills.some((s) => s.name === m.name))
      .map((m) => ({ name: m.name, source: 'auto' as const, priority: 'secondary' as const }))
    if (autoMatched.length > 0) {
      addSkillsToBrief(autoMatched)
    }

    // 使用最新 brief (已经包含了 newStyleSkillRefs 和 autoMatched)
    const latestBrief = useStore.getState().studySessions[session.id]?.brief || session.brief

    const result = await runConversationalEdit(
      {
        currentDocument: session.document,
        userInstruction: userMessage,
        brief: latestBrief,
        existingPool: session.evidencePool,
        agenda: session.agenda,
        chatHistory: session.chatMessages,
        existingMemory: session.memorySnippets,
        storeSkills,
      },
      session.id,
      {
        onDocumentDelta: (fullText: string) => {
          updateDocument(fullText)
          maybeStreamSave(fullText.length)
        },
        onReasoningDelta: (fullReasoning: string) => {
          updateChatMessage(editReasoningId, {
            content: fullReasoning,
            streaming: true,
          })
        },
        onProgress: (msg: string) => {
          setStatusLabel(msg)
          // 用单独一个 thinking 气泡展示工具/召回进度
          if (!toolProgressId) {
            toolProgressId = generateMessageId()
            addChatMessage({
              id: toolProgressId,
              role: 'thinking',
              content: msg,
              timestamp: Date.now(),
              thinkingLabel: '准备中',
              streaming: true,
            })
          } else {
            updateChatMessage(toolProgressId, { content: msg })
          }
        },
        onEvidenceDelta: (items) => {
          mergeEvidence(items)
        },
        onMemoryDelta: (items) => {
          const merged = [
            ...(useStore.getState().studySessions[session.id]?.memorySnippets || []),
            ...items,
          ]
          setMemorySnippets(merged)
        },
        onProfileSuggestions: (items) => {
          addProfileSuggestionMessage(items)
        },
      },
      { enableToolLoop: options?.enableToolLoop !== false, refreshRecall: true },
    )

    // 工具/召回气泡标记为非流式
    if (toolProgressId) {
      updateChatMessage(toolProgressId, { streaming: false })
    }
    updateChatMessage(editReasoningId, { streaming: false })

    // 对话式修改完成 → 存一个版本快照 (trigger: edit)
    // summary 优先带上 AI 返回的结构化 editSummary, 方便历史列表展示"改了啥"
    const latestEditDoc = useStore.getState().studySessions[session.id]?.document || ''
    if (latestEditDoc.trim()) {
      saveVersion(session.id, {
        document: latestEditDoc,
        trigger: 'edit',
        summary: result.editSummary ?? userMessage.slice(0, 80),
      }).catch((e) => console.warn('[StudyRoom] saveVersion(edit) failed:', e))
    }

    // 构造 assistant 消息 + 变更卡片
    if (result.editSummary) {
      const freshNote = result.freshEvidence.length > 0
        ? `\n\n本轮新引入 ${result.freshEvidence.length} 条证据${result.freshMemory.length > 0 ? ` 和 ${result.freshMemory.length} 条记忆` : ''}。`
        : ''
      addChatMessage({
        id: generateMessageId(),
        role: 'assistant',
        content: freshNote.trim(),
        timestamp: Date.now(),
        editSummary: result.editSummary,
      })
    } else {
      addChatMessage({
        id: generateMessageId(),
        role: 'assistant',
        content: `已修改完成 (约 ${result.wordCount} 字)。你可以继续对话修改，或在左栏直接编辑。\n\n（提示: 本次 AI 未返回结构化变更说明，可能是模型输出格式偏离，再次提问可重试。）`,
        timestamp: Date.now(),
      })
    }
    setStatusLabel(undefined)
  }, [
    session, storeSkills,
    addChatMessage, updateChatMessage,
    updateDocument, mergeEvidence, addSkillsToBrief, setMemorySnippets,
    maybeStreamSave, saveVersion,
  ])

  /** 讨论分支: runWriterChat — 聊文章但不改文章 */
  const dispatchDiscuss = useCallback(async (userMessage: string, options?: { enableToolLoop?: boolean }) => {
    setStatusLabel('思考中...')

    // 流式回答用的 assistant 气泡 (预先占位, 流式写入 content)
    const answerMsgId = generateMessageId()
    addChatMessage({
      id: answerMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    })

    // 可选的推理/工具进度气泡
    const reasoningId = generateMessageId()
    addChatMessage({
      id: reasoningId,
      role: 'thinking',
      content: '正在梳理你的问题...',
      timestamp: Date.now(),
      thinkingLabel: '讨论推理',
      streaming: true,
    })

    let toolProgressId: string | undefined

    // 使用最新 brief, 讨论模式不动 skills
    const latestBrief = useStore.getState().studySessions[session.id]?.brief || session.brief

    try {
      const result = await runWriterChat(
        {
          currentDocument: session.document,
          userMessage,
          brief: latestBrief,
          existingPool: session.evidencePool,
          chatHistory: session.chatMessages,
          existingMemory: session.memorySnippets,
          storeSkills,
        },
        session.id,
        {
          onAnswerDelta: (full) => {
            updateChatMessage(answerMsgId, { content: full, streaming: true })
          },
          onReasoningDelta: (fullReasoning) => {
            updateChatMessage(reasoningId, { content: fullReasoning, streaming: true })
          },
          onProgress: (msg) => {
            setStatusLabel(msg)
            if (!toolProgressId) {
              toolProgressId = generateMessageId()
              addChatMessage({
                id: toolProgressId,
                role: 'thinking',
                content: msg,
                timestamp: Date.now(),
                thinkingLabel: '准备中',
                streaming: true,
              })
            } else {
              updateChatMessage(toolProgressId, { content: msg })
            }
          },
          onEvidenceDelta: (items) => {
            mergeEvidence(items)
          },
          onMemoryDelta: (items) => {
            const merged = [
              ...(useStore.getState().studySessions[session.id]?.memorySnippets || []),
              ...items,
            ]
            setMemorySnippets(merged)
          },
          onProfileSuggestions: (items) => {
            addProfileSuggestionMessage(items)
          },
        },
        { enableToolLoop: options?.enableToolLoop !== false, refreshRecall: false },
      )

      // 收尾
      if (toolProgressId) updateChatMessage(toolProgressId, { streaming: false })
      updateChatMessage(reasoningId, { streaming: false })
      updateChatMessage(answerMsgId, {
        content: result.answer,
        streaming: false,
        suggestedEdit: result.suggestedEdit ?? undefined,
      })
    } finally {
      setStatusLabel(undefined)
    }
  }, [
    session, storeSkills,
    addChatMessage, updateChatMessage,
    mergeEvidence, setMemorySnippets,
  ])

  /**
   * 深度打磨分支 — "深度打磨/压力测试/红队" 等触发词 + 文档非空时走这条.
   *
   * 编排 Phase 1→2→3 (诊断→红队→候选洞察), 然后暂停等用户勾选/补充.
   * 用户在 UI 上确认后由 handleDeliberationUserChoice 继续 Phase 4→5.
   */
  const dispatchDeliberate = useCallback(async (_userMessage: string) => {
    setStatusLabel('深度打磨: 启动诊断管线...')

    // 初始化 store 中的 deliberation 状态
    startDeliberation(session.id)

    // 进度气泡
    const thinkingId = generateMessageId()
    addChatMessage({
      id: thinkingId,
      role: 'thinking',
      content: '深度打磨启动: 正在诊断文章...',
      timestamp: Date.now(),
      thinkingLabel: '深度打磨',
      streaming: true,
    })

    try {
      const { diagnosis, redTeam, proposal } = await runDeliberationUntilUserChoice(
        session.document,
        session.brief,
        session.id,
        {
          onDiagnosisReady: (d) => {
            setDeliberationDiagnosis(session.id, d)
            updateDeliberationPhase(session.id, 'redteaming')
            updateChatMessage(thinkingId, {
              content: `诊断完成 — 核心论点: ${d.thesis}\n置信度: ${d.confidence}`,
              streaming: true,
            })
          },
          onRedTeamReady: (r) => {
            setDeliberationRedTeam(session.id, r)
            updateDeliberationPhase(session.id, 'proposing_insights')
            updateChatMessage(thinkingId, {
              content: `红队测试完成: 发现 ${r.challenges.length} 条质疑`,
              streaming: true,
            })
          },
          onInsightsReady: (p) => {
            setDeliberationProposal(session.id, p)
            updateDeliberationPhase(session.id, 'waiting_user')
          },
          onProgress: (_stage, msg) => {
            setStatusLabel(msg)
            updateChatMessage(thinkingId, { content: msg, streaming: true })
          },
        },
      )

      // 关闭 thinking 气泡
      updateChatMessage(thinkingId, { streaming: false })

      // 插入诊断结果摘要 + 候选洞察
      const candidatesList = proposal.candidates
        .map((c, i) => `${i + 1}. **${c.insight}**\n   _${c.whyItMatters}_`)
        .join('\n')

      addChatMessage({
        id: generateMessageId(),
        role: 'assistant',
        content:
          `## 深度打磨诊断完成\n\n` +
          `**核心论点**: ${diagnosis.thesis}\n` +
          `**论点清晰度**: ${diagnosis.thesisClarity}/10 · **置信度**: ${diagnosis.confidence}\n\n` +
          `**红队发现 ${redTeam.challenges.length} 条质疑**\n\n` +
          `---\n\n### 候选洞察\n\n${candidatesList}\n\n` +
          `> 请回复你认同的洞察编号，或直接告诉我你自己的判断。\n` +
          `> 例如: "选 1 和 3" 或 "我觉得关键问题是..."`,
        timestamp: Date.now(),
      })
    } catch (err) {
      updateChatMessage(thinkingId, { streaming: false })
      const errMsg = err instanceof Error ? err.message : '未知错误'
      setDeliberationError(session.id, errMsg)
      addChatMessage({
        id: generateMessageId(),
        role: 'assistant',
        content: `深度打磨出错: ${errMsg}`,
        timestamp: Date.now(),
      })
    } finally {
      setStatusLabel(undefined)
    }
  }, [
    session, addChatMessage, updateChatMessage,
    startDeliberation, updateDeliberationPhase,
    setDeliberationDiagnosis, setDeliberationRedTeam,
    setDeliberationProposal, setDeliberationError,
  ])

  /**
   * Dun ReAct 分支 — session 已装载 loadedDun 时走这条, 绕过 write/edit/discuss 三路.
   *
   * 和上一版 dispatchDunRewrite 的本质差异:
   * - 上一版是"流式代笔": LLM 一口气把 token 塞进 document, 中间没有任何探查 / 工具调用.
   * - 这一版是"ReAct 循环": Dun 可以 read_draft / read_fingerprint / searchMemory /
   *   readFile / webSearch / webFetch 探查, 最后通过 write_draft 工具交稿.
   *
   * 语义 (和用户确认过):
   * - Q1=a: write_draft 只有 replace 模式, 每次整篇重写 (旧稿自动存为历史版本)
   * - Q3=b: 20 轮上限 (写作不该拖)
   * - Q4=b: 持续对话 — chatMessages 作为历史喂回, Dun 记得之前写过什么
   * - Q5=a: 经验回写完整版 — consolidatePostExecution 正常跑, 写 experience/successes.md
   *
   * write_draft 工具触发时的两步 (由 onDraftWrite 回调实现):
   * 1. saveVersion(当前 document, trigger='full_writing') — 把被替换的版本存成历史
   * 2. updateDocument(新 draft) — 把 session.document 切到新版本
   *
   * 对话栏渲染:
   * - 进循环时插一条 thinking 气泡, 流程中不断累加 content / 切换 thinkingLabel
   * - 循环结束 streaming=false, 根据 phase 插一条 assistant 收尾总结
   */
  const dispatchDunReAct = useCallback(async (userMessage: string) => {
    const dun = session.loadedDun
    if (!dun) {
      // 防御: 理论上 handleChatSubmit 已经前置判断过, 不会走到这
      console.warn('[StudyRoom] dispatchDunReAct called without loadedDun')
      return
    }

    setStatusLabel(`${dun.name} 工作中...`)

    // 1. 插一条 thinking 气泡, 整个循环期间就用这一条做实时渲染
    const thinkingId = generateMessageId()
    addChatMessage({
      id: thinkingId,
      role: 'thinking',
      content: `${dun.name} 接到任务, 正在分析...`,
      timestamp: Date.now(),
      thinkingLabel: '启动 ReAct',
      streaming: true,
    })

    // thinking 气泡的累积文本 (onThinking 增量添加) — 用闭包 + 节流 avoid 过度渲染
    let thinkingBuffer = ''
    const flushThinking = (nextLabel?: string) => {
      updateChatMessage(thinkingId, {
        content: thinkingBuffer || `${dun.name} 工作中...`,
        ...(nextLabel ? { thinkingLabel: nextLabel } : {}),
        streaming: true,
      })
    }

    // 2. 解析文风指纹 (优先级高于 Dun 人设, 工具 read_fingerprint 也是从这里取)
    const fingerprintId = session.brief.fingerprintId
    const fingerprint = fingerprintId ? getFingerprintSync(fingerprintId) : null

    try {
      // 3. 跑 ReAct 循环 — 所有副作用通过 callbacks 注入
      const result = await runStudyReActWriting({
        sessionId: session.id,
        dun,
        fingerprint,
        userMessage,
        chatHistory: session.chatMessages,
        getCurrentDraft: () =>
          useStore.getState().studySessions[session.id]?.document || '',
        callbacks: {
          // 3.1 LLM 文本流 (正文 + reasoning_content 都会回调到这里)
          onThinking: (round, chunk) => {
            thinkingBuffer += chunk
            // 轮次切换时顺手带上 label, 让用户能看到"第 N 轮"
            flushThinking(`思考 · 第 ${round} 轮`)
          },

          // 3.2 工具调用开始 — 切 label, 让用户知道 Dun 在干嘛
          onToolCall: (round, toolName, args) => {
            const argHint = describeToolArgsForUI(toolName, args)
            thinkingBuffer += `\n\n**[${round}.${toolName}]** ${argHint}`
            flushThinking(`调用 ${toolName}`)
          },

          // 3.3 工具结果 — 追加 uiSummary 到 thinking, 给用户一个简短回执
          onToolResult: (round, toolName, toolResult) => {
            const ok = toolResult.status === 'success'
            const tag = ok ? '✓' : '✗'
            const summary = toolResult.uiSummary || (ok ? '完成' : '失败')
            thinkingBuffer += ` ${tag} ${summary}`
            flushThinking(`第 ${round} 轮 · ${toolName} ${tag}`)
          },

          // 3.4 write_draft 触发 — 按序执行两步: saveVersion(旧) → updateDocument(新)
          //     getCurrentDraft 实时取, 避免闭包捕获 dispatchDunReAct 入口时的旧值
          //     (Dun 在同一轮对话里可能调用 write_draft 多次)
          onDraftWrite: async (newDraft) => {
            const prevDoc =
              useStore.getState().studySessions[session.id]?.document || ''

            // 被替换的版本先存为历史 — 只有 prevDoc 非空才存 (从零起草时没必要)
            if (prevDoc.trim()) {
              try {
                await saveVersion(session.id, {
                  document: prevDoc,
                  trigger: 'full_writing',
                  summary: `${dun.name} 代笔前的快照 · ${userMessage.slice(0, 40)}`,
                })
              } catch (e) {
                console.warn('[StudyRoom] saveVersion(pre-write_draft) failed:', e)
              }
            }

            // 切到新版本
            updateDocument(newDraft)
            maybeStreamSave(newDraft.length)

            // 新版本也存一个 snapshot (让版本面板能直接回溯到"Dun 刚交的稿")
            if (newDraft.trim()) {
              try {
                await saveVersion(session.id, {
                  document: newDraft,
                  trigger: 'full_writing',
                  summary: `${dun.name} 代笔交稿 · ${userMessage.slice(0, 40)}`,
                })
              } catch (e) {
                console.warn('[StudyRoom] saveVersion(post-write_draft) failed:', e)
              }
            }
          },

          // 3.5 onAskUser 暂不接入 UI — 工具侧会自动降级为 "LLM 自主决策"
          //     (studyReActTools.ts 的 ask_user 实现里已经有完整的降级分支)

          // 3.6 循环结束 (无论什么 phase 都会触发一次)
          onDone: (_phase, _summary, _rounds) => {
            // thinking 气泡的 streaming 由后面 finally 统一关闭,
            // 这里不做副作用, 让 phase 分支在主体 await 后处理 (保证顺序)
          },
        },
        // 经验回写 (Q5=a) — 传 ConsolidatorStoreActions, 由循环内部异步触发.
        // addToast 这里做适配: ConsolidatorStoreActions 签名要求 (type:string,title,message) 三个 required,
        // 而 store 的 addToast 是 Omit<Toast,'id'> (type 是严格联合, message 可选), 两者参数逆变不兼容,
        // 所以包一层闭包, 把 Consolidator 传过来的 type 窄化为 Toast.type 的合法值, 兜底用 'info'.
        storeActions: {
          updateDun,
          addToast: (toast) => {
            const allowed: Array<Toast['type']> = ['success', 'error', 'warning', 'info']
            const safeType: Toast['type'] = allowed.includes(toast.type as Toast['type'])
              ? (toast.type as Toast['type'])
              : 'info'
            addToast({ type: safeType, title: toast.title, message: toast.message })
          },
          duns,
        },
      })

      // 4. 根据 phase 插收尾 assistant 总结 (thinking 气泡在 finally 里关流)
      const wordCount = result.finalDraft.replace(/\s/g, '').length
      const summaryContent = buildDunReActSummaryMessage(dun.name, result, wordCount)
      addChatMessage({
        id: generateMessageId(),
        role: 'assistant',
        content: summaryContent,
        timestamp: Date.now(),
      })
    } catch (err) {
      // runStudyReActWriting 内部已经捕获 LLM 异常并以 phase='error' 返回,
      // 走到这里说明是回调层或 store 动作抛了异常 — 给用户一个明确反馈
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('[StudyRoom] dispatchDunReAct crashed:', err)
      addChatMessage({
        id: generateMessageId(),
        role: 'assistant',
        content: `${dun.name} 意外中断: ${errMsg}. 当前草稿已保留, 可继续对话.`,
        timestamp: Date.now(),
      })
    } finally {
      // 无论成功失败, thinking 气泡都要关流
      updateChatMessage(thinkingId, { streaming: false })
      setStatusLabel(undefined)
    }
  }, [
    session,
    addChatMessage, updateChatMessage,
    updateDocument, maybeStreamSave, saveVersion,
    updateDun, addToast, duns,
  ])

  // ============================================
  // handleChatSubmit — 主入口: 预处理 → 意图分类 → 三路分发
  // ============================================

  /**
   * 对话提交主入口.
   *
   * @param userMessage     用户消息文本
   * @param attachments     @mention 附件
   * @param forcedIntent    可选: 强制意图 (由澄清按钮或"应用此建议"按钮触发时使用, 跳过分类)
   * @param options.suppressUserBubble
   *   是否跳过"添加 user 消息气泡". 默认 false.
   *   用在"澄清按钮重跑"场景 — 原 user 消息已经在上一轮显示过, 不要重复显示.
   */
  const handleChatSubmit = useCallback(async (
    userMessage: string,
    attachments?: WriterChatAttachment[],
    forcedIntent?: WriterMessageIntent,
    options?: { suppressUserBubble?: boolean },
  ) => {
    if (sending) return

    // 1. 添加用户消息 (除非显式抑制)
    if (!options?.suppressUserBubble) {
      addChatMessage({
        id: generateMessageId(),
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
        attachments,
      })
    }

    // 2. 特殊命令: 导出 (本地短路, 不走 LLM)
    if (EXPORT_REGEX.test(userMessage)) {
      const result = await exportSession(session.id)
      addChatMessage({
        id: generateMessageId(),
        role: 'assistant',
        content: result.success
          ? `文章已导出${result.archivePath ? `: ${result.archivePath}` : ''}`
          : '导出失败，请尝试复制左栏文章内容',
        timestamp: Date.now(),
      })
      return
    }

    const effectiveUserMessage = buildMessageWithFileAttachments(userMessage, attachments)

    // 3. 处理用户 @ 的 skills (风格型合并到 brief, 工具型友好提示)
    let newStyleSkillRefs: SkillRef[] = []
    if (attachments && attachments.length > 0) {
      const mentionedSkills = attachments
        .filter((a) => a.type === 'skill')
        .map((a) => storeSkills.find((s) => s.name === a.name))
        .filter((s): s is NonNullable<typeof s> => !!s)

      const { styleSkills, toolSkills } = splitSkillsByUsability(mentionedSkills)

      if (styleSkills.length > 0) {
        newStyleSkillRefs = styleSkills.map((s) => ({
          name: s.name,
          source: 'mention' as const,
          priority: 'primary' as const,
        }))
        addSkillsToBrief(newStyleSkillRefs)
      }

      if (toolSkills.length > 0) {
        const toolNames = toolSkills.map((s) => `@${s.name}`).join('、')
        const styleNote = styleSkills.length > 0
          ? `（${styleSkills.map((s) => `@${s.name}`).join('、')} 已作为写作风格约束生效）`
          : ''
        addChatMessage({
          id: generateMessageId(),
          role: 'assistant',
          content:
            `⚠️ ${toolNames} 是需要执行引擎的工具型技能（如联网搜索、数据查询、脚本执行等）。\n\n` +
            `自习室内置了轻量工具（search_wiki / search_memory / read_entity / append_to_memory），` +
            `LLM 会按需自动调用，但不会执行你 SKILL.md 里定义的自定义脚本。如果需要跑自定义工具链，请到任务房 (Task House)。${styleNote}`,
          timestamp: Date.now(),
        })
      }
    }

    setSending(true)
    setStreaming(true)

    try {
      // 3.5. 写作 Dun 短路分支
      //      session 装载了 loadedDun 时, 绕过意图分类和三路分发, 直接让 Dun 代笔整篇替换草稿.
      //      这是和用户确认过的核心体验: "加载 Dun 后在自习室写作, 不用反复在本地写文件".
      //      只要不是 forcedIntent='discuss' (用户在讨论气泡里点应用建议) 这种明确要讨论的场景,
      //      就都短路到 Dun 代笔. forcedIntent='edit' 也走 Dun (因为用户选的按钮是"改文", 但代笔模式下
      //      "改文 = Dun 按指令重写整篇", 语义自洽).
      //
      //      优化: 用本地规则 (纯同步, 0ms) 检测 discuss 意图, 避免"为什么这段写得不好？"
      //      这种典型讨论被 Dun 误当改稿. 只用本地规则, 不降级 LLM, 保持 Dun 路径的快感.
      if (session.loadedDun && forcedIntent !== 'discuss') {
        const dunLocalHint = localRoute(effectiveUserMessage, session.document)
        if (dunLocalHint?.intent === 'discuss' && dunLocalHint.confidence >= 0.85) {
          await dispatchDiscuss(effectiveUserMessage, { enableToolLoop: false })
          await flushSaveNow()
          return
        }

        await dispatchDunReAct(effectiveUserMessage)
        await flushSaveNow()
        return
      }

      // 4. 意图路由: 如果外部指定了 forcedIntent, 跳过分类 (澄清按钮 / 应用建议 场景)
      let intent: WriterMessageIntent
      let routeResult: RouteResult | undefined
      if (forcedIntent) {
        intent = forcedIntent
      } else {
        // v3: 本地规则先跑 (~0ms), 命中则不展示 thinking 气泡直接路由;
        //     本地判不准才降级到 LLM 分类, 此时才展示"意图识别中..."气泡.
        //
        // 小技巧: 先同步跑一次本地规则探测 (通过 Promise.resolve 延迟到微任务队列里判定).
        // 由于 routeWriterMessage 内部本地规则是纯同步, 我们用 "同步预演 + 异步实际调用" 的方式:
        // 直接 await routeWriterMessage 并在走 LLM 之前展示气泡. 这里的策略是:
        // - 立刻发起 route 调用, 50ms 内没完成才插 thinking 气泡 (本地命中必 < 50ms)
        let classifyThinkingId: string | undefined
        const thinkingTimer = setTimeout(() => {
          classifyThinkingId = generateMessageId()
          addChatMessage({
            id: classifyThinkingId,
            role: 'thinking',
            content: '判断意图中...',
            timestamp: Date.now(),
            thinkingLabel: '意图识别',
            streaming: true,
          })
        }, 50)

        routeResult = await routeWriterMessage(
          effectiveUserMessage,
          {
            currentDocument: session.document,
            chatHistory: session.chatMessages,
          },
          classifyWriterIntent,
        )
        clearTimeout(thinkingTimer)
        console.debug('[StudyRoom] intent route:', routeResult)

        // 如果之前已经插了 thinking 气泡 (走了 LLM), 把它更新为结论
        if (classifyThinkingId) {
          updateChatMessage(classifyThinkingId, {
            content: `意图: ${routeResult.intent} (${routeResult.source} · 置信度 ${(routeResult.confidence * 100).toFixed(0)}%) — ${routeResult.reason}`,
            streaming: false,
          })
        }

        intent = routeResult.intent

        // 5. unclear 分支: 不动工, 插入一条带快捷按钮的 assistant 气泡
        if (intent === 'unclear') {
          const docEmpty = isFirstWriting
          addChatMessage({
            id: generateMessageId(),
            role: 'assistant',
            content: docEmpty
              ? '不太确定你是想先聊聊这个话题，还是直接让我写一篇？'
              : '不太确定你是想就文章内容聊一聊，还是让我直接改文章？',
            timestamp: Date.now(),
            intentClarification: {
              originalMessage: effectiveUserMessage,
              confidence: routeResult.confidence,
              reason: routeResult.reason,
            },
          })
          return
        }
      }

      // 6. 四路分发 (write / edit / discuss / deliberate)
      // 优化: 本地规则高置信命中 + 短指令 → 跳过 Tool Loop (省 2-5s)
      // write 路径不跳过 (首次写作通常需要资料); forcedIntent 场景无 routeResult, 不跳过
      const skipToolLoop = !!routeResult
        && routeResult.source === 'local'
        && routeResult.confidence >= 0.9
        && effectiveUserMessage.replace(/\s/g, '').length < 40
        && (intent === 'edit' || intent === 'discuss')

      if (intent === 'deliberate') {
        // 深度打磨: 文档非空时走 5-Phase 管线
        await dispatchDeliberate(effectiveUserMessage)
      } else if (intent === 'write' || (intent === 'edit' && isFirstWriting)) {
        // 文章空态下 edit 不成立, 降级为 write
        await dispatchWrite(effectiveUserMessage, newStyleSkillRefs)
      } else if (intent === 'edit') {
        await dispatchEdit(effectiveUserMessage, { enableToolLoop: !skipToolLoop })
      } else {
        // discuss
        await dispatchDiscuss(effectiveUserMessage, { enableToolLoop: !skipToolLoop })
      }

      await flushSaveNow()
    } catch (err) {
      console.warn('[StudyRoom] Writing failed:', err)
      addChatMessage({
        id: generateMessageId(),
        role: 'assistant',
        content: `处理过程出错: ${err instanceof Error ? err.message : '未知错误'}。已保存当前进度，可继续对话。`,
        timestamp: Date.now(),
      })
      setStatusLabel(undefined)
      await flushSaveNow()
    } finally {
      setSending(false)
      setStreaming(false)
    }
  }, [
    sending, session, isFirstWriting, storeSkills,
    addChatMessage, updateChatMessage,
    addSkillsToBrief, flushSaveNow,
    dispatchWrite, dispatchEdit, dispatchDiscuss, dispatchDeliberate, dispatchDunReAct,
  ])

  /**
   * 澄清按钮回调 — 用户在 unclear 气泡上点 "聊聊" / "改文" / "首次写作".
   * 把该气泡标记 resolved, 然后用强制意图重跑, 不再重复显示 user 气泡.
   */
  const handleIntentClarify = useCallback((
    clarificationMessageId: string,
    originalMessage: string,
    chosen: WriterMessageIntent,
  ) => {
    // 标记原澄清气泡已 resolved, 前端按钮会 disable
    updateChatMessage(clarificationMessageId, {
      intentClarification: {
        originalMessage,
        resolved: true,
      },
    })
    // 用强制意图重跑, 抑制 user 气泡重复
    handleChatSubmit(originalMessage, undefined, chosen, { suppressUserBubble: true })
  }, [updateChatMessage, handleChatSubmit])

  /**
   * 应用建议修改 — 用户在 discuss 气泡下方点 "应用此建议".
   * 把该气泡的 suggestedEdit 标记 applied, 然后以 instruction 作为 user 消息走 edit 分支.
   */
  const handleApplySuggestedEdit = useCallback((
    suggestionMessageId: string,
    suggestion: SuggestedEdit,
  ) => {
    // 标记已应用 (按钮 disable)
    updateChatMessage(suggestionMessageId, {
      suggestedEdit: { ...suggestion, applied: true },
    })
    // 以 instruction 作为新的 user 消息, 强制走 edit 分支 (不再分类)
    handleChatSubmit(suggestion.instruction, undefined, 'edit')
  }, [updateChatMessage, handleChatSubmit])

  /**
   * 档案建议 — "接受入档": 真正写入 writerProfile, 并把该建议状态置为 accepted.
   * (Phase 5: 以前 LLM 调 append_to_memory 时默默落库, 现在必须走这个按钮.)
   */
  const handleAcceptProfileSuggestion = useCallback((
    messageId: string,
    suggestionId: string,
  ) => {
    const msg = useStore.getState().studySessions[session.id]?.chatMessages.find((m) => m.id === messageId)
    const list = msg?.profileSuggestions || []
    const target = list.find((s) => s.id === suggestionId)
    if (!target || target.status !== 'pending') return

    // 真正入库 (localStorage 版 writerProfile)
    try {
      applyProfileSuggestion({
        kind: target.kind,
        content: target.content,
        category: target.category,
      })
    } catch (err) {
      console.warn('[StudyRoom] applyProfileSuggestion failed:', err)
      return
    }

    // 更新该消息中对应条目的状态 → accepted
    const next = list.map((s) => s.id === suggestionId ? { ...s, status: 'accepted' as const } : s)
    updateChatMessage(messageId, { profileSuggestions: next })
  }, [session.id, updateChatMessage])

  /**
   * 档案建议 — "忽略": 不落库, 把该建议状态置为 dismissed.
   */
  const handleDismissProfileSuggestion = useCallback((
    messageId: string,
    suggestionId: string,
  ) => {
    const msg = useStore.getState().studySessions[session.id]?.chatMessages.find((m) => m.id === messageId)
    const list = msg?.profileSuggestions || []
    const target = list.find((s) => s.id === suggestionId)
    if (!target || target.status !== 'pending') return

    const next = list.map((s) => s.id === suggestionId ? { ...s, status: 'dismissed' as const } : s)
    updateChatMessage(messageId, { profileSuggestions: next })
  }, [session.id, updateChatMessage])

  // 左栏手动编辑: 仍用 debounce (避免频繁 PUT)
  const handleDocumentChange = useCallback((newDoc: string) => {
    updateDocument(newDoc)
    scheduleAutoSave()
  }, [updateDocument, scheduleAutoSave])

  const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const workspace = workspaceRef.current
    if (!workspace) return

    event.preventDefault()
    const rect = workspace.getBoundingClientRect()
    let nextWidth = chatWidth
    setResizing(true)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      nextWidth = clampChatWidth(rect.right - moveEvent.clientX, rect.width)
      setChatWidth(nextWidth)
    }

    const handlePointerUp = () => {
      setResizing(false)
      try {
        localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(nextWidth))
      } catch { /* noop */ }
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }, [chatWidth])

  return (
    <div className={`flex flex-col h-full bg-[#fafaf8] ${resizing ? 'cursor-col-resize select-none' : ''}`}>
      {/* 顶部状态栏 */}
      <StatusBar
        session={session}
        statusLabel={statusLabel}
        onExport={() => exportSession(session.id)}
      />

      {/* 主区域: 工具轨 + 文稿 + 可拖拽对话侧栏 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 最左侧: 记忆/指纹侧边栏 (40px 窄条 + 展开抽屉) */}
        <StudySidebar sessionId={session.id} />

        <div
          ref={workspaceRef}
          className="flex flex-1 min-w-0 min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(196,57,45,0.06),transparent_34%),linear-gradient(180deg,#fbfaf7_0%,#f5f2eb_100%)]"
        >
          {/* 主文稿区 */}
          <main className="flex-1 min-w-0 min-h-0">
            <ArticleView
              document={session.document}
              streaming={streaming}
              onDocumentChange={handleDocumentChange}
            />
          </main>

          <button
            type="button"
            aria-label="调整文稿和对话宽度"
            onPointerDown={handleResizePointerDown}
            className="group relative z-10 w-3 flex-shrink-0 cursor-col-resize border-x border-stone-200/70 bg-gradient-to-b from-white/60 via-stone-100/60 to-white/50 transition-colors hover:bg-amber-50"
          >
            <span className="absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stone-300/70 transition-colors group-hover:bg-amber-500" />
          </button>

          {/* 右侧协作栏: 对话完整展示，宽度可拖拽 */}
          <aside
            className="h-full min-h-0 flex-shrink-0 bg-white/82 backdrop-blur-xl shadow-[-8px_0_24px_rgba(28,25,23,0.05)]"
            style={{ width: chatWidth }}
          >
            <WriterChatPanel
              chatMessages={session.chatMessages}
              documentEmpty={isFirstWriting}
              onIntentClarify={handleIntentClarify}
              onApplySuggestedEdit={handleApplySuggestedEdit}
              onAcceptProfileSuggestion={handleAcceptProfileSuggestion}
              onDismissProfileSuggestion={handleDismissProfileSuggestion}
            />
          </aside>
        </div>
      </div>

      <WriterInstructionBar
        onSubmit={handleChatSubmit}
        sending={sending}
      />
    </div>
  )
}
