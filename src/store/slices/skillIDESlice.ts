/**
 * Skill IDE Slice - Skills IDE 状态管理
 *
 * 管理 IDE 模式、活跃技能编辑、AI 对话式生产管线、诊断、快照等。
 * 不复用主 Agent 的 ReAct 循环，独立管理生产流程。
 *
 * v2: 对话式 IDE — 多轮聊天 + 内嵌 diff 卡片 + 会话管理
 */
import type { StateCreator } from 'zustand'
import { localServerService } from '@/services/localServerService'
import * as skillProductionService from '@/services/skillProductionService'

// ============================================
// 类型定义
// ============================================

export interface DiagnosticItem {
  field: string
  passed: boolean
  suggestion: string
  weight: number
}

export interface OperationSummary {
  type: 'produce' | 'save' | 'validate' | 'create' | 'snapshot'
  description: string
  timestamp: number
}

export interface SnapshotMeta {
  id: string
  timestamp: number
  promptVersion?: string
  score?: number
}

export interface CreateSkillParams {
  name: string
  description: string
  type: 'instruction' | 'executable'
}

// ---- 对话式 IDE 新类型 ----

export interface DiffBlock {
  id: string
  original: string
  proposed: string
  status: 'pending' | 'accepted' | 'rejected'
}

export interface SkillChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  diffBlocks?: DiffBlock[]
  error?: boolean
  /** DeepSeek 等模型的思考过程 (reasoning_content) */
  reasoningContent?: string
}

export interface SkillConversation {
  id: string
  skillName: string
  title: string
  messages: SkillChatMessage[]
  createdAt: number
  updatedAt: number
}

// ============================================
// Slice 接口
// ============================================

export interface SkillIDESlice {
  // Mode
  ideMode: boolean
  setIDEMode: (mode: boolean) => void

  // Active skill
  activeSkillName: string | null
  activeSkillContent: string | null
  activeSkillOriginal: string | null
  activeSkillDirty: boolean
  /**
   * 后端 /raw 路由对单文件 content 截断至 10000 字符（server/handlers/skills.py:568）。
   * 当 SKILL.md 字符数 ≥ 10000 时，前端拿到的 content 可能不完整。
   * 写路径（saveSkill / sendSkillChat）必须 early-return，否则一次保存会用截断版覆盖完整文件，造成静默数据丢失。
   * 修复方案见 .qoder/Specs/skill_ide_三合一方案.md「已知技术债 #3」（后端补 /content 路由）。
   */
  activeSkillTruncated: boolean
  openSkill: (name: string) => Promise<void>
  closeSkill: () => void
  updateSkillContent: (content: string) => void

  // Workspace tabs (for preview panel)
  activeTab: 'preview' | 'source' | 'timeline'
  setActiveTab: (tab: 'preview' | 'source' | 'timeline') => void

  // Preview panel (右侧, 替代旧 producerOpen)
  previewPanelOpen: boolean
  setPreviewPanelOpen: (open: boolean) => void

  // Legacy producer (保留兼容)
  producerOpen: boolean
  setProducerOpen: (open: boolean) => void
  producerMode: 'quick' | 'guided'
  setProducerMode: (mode: 'quick' | 'guided') => void

  // Production state (legacy single-shot)
  producing: boolean
  productionStream: string
  productionError: string | null

  // Diagnostics
  diagnostics: DiagnosticItem[] | null
  diagnosticScore: number | null

  // Recent operations context (3-5 items)
  recentOps: OperationSummary[]
  addRecentOp: (op: OperationSummary) => void

  // Diff (legacy single-shot)
  pendingDiff: { original: string; proposed: string } | null
  applyDiff: () => Promise<void>
  rejectDiff: () => void

  // Snapshots
  snapshots: SnapshotMeta[]
  loadSnapshots: (skillName: string) => Promise<void>

  // LLM config override
  temperatureMode: 'production' | 'exploration'
  setTemperatureMode: (mode: 'production' | 'exploration') => void

  // Legacy actions
  saveSkill: () => Promise<void>
  validateSkill: () => Promise<void>
  produceSkill: (instruction: string) => Promise<void>
  cancelProduction: () => void
  createSkill: (params: CreateSkillParams) => Promise<void>

  // ---- 对话式 IDE ----
  skillConversations: Map<string, SkillConversation>
  activeSkillConvId: string | null
  skillChatStreaming: boolean
  skillChatStreamContent: string
  skillChatReasoningContent: string

  createSkillConversation: (skillName: string) => string
  switchSkillConversation: (convId: string) => void
  deleteSkillConversation: (convId: string) => void
  sendSkillChat: (message: string) => Promise<void>
  cancelSkillChat: () => void
  acceptDiffBlock: (messageId: string, diffBlockId: string) => Promise<void>
  rejectDiffBlock: (messageId: string, diffBlockId: string) => void
  acceptAllDiffs: (messageId: string) => Promise<void>
}

// ============================================
// 常量 & 模块级变量
// ============================================
const MAX_RECENT_OPS = 5
const CONV_STORAGE_PREFIX = 'skill_conv_'
const CONV_META_KEY = 'skill_conversations_meta'

let _productionAbortController: AbortController | null = null
let _chatAbortController: AbortController | null = null
let _flushTimer: ReturnType<typeof setTimeout> | null = null

// ============================================
// 持久化辅助
// ============================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function persistConversation(conv: SkillConversation) {
  try {
    localStorage.setItem(CONV_STORAGE_PREFIX + conv.id, JSON.stringify(conv))
  } catch { /* quota exceeded — best-effort */ }
}

function persistConversationsMeta(convs: Map<string, SkillConversation>) {
  try {
    const metas = Array.from(convs.values()).map((c) => ({
      id: c.id,
      skillName: c.skillName,
      title: c.title,
      messageCount: c.messages.length,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }))
    localStorage.setItem(CONV_META_KEY, JSON.stringify(metas))
  } catch { /* best-effort */ }
}

function loadConversationsForSkill(skillName: string): Map<string, SkillConversation> {
  const result = new Map<string, SkillConversation>()
  try {
    const raw = localStorage.getItem(CONV_META_KEY)
    if (!raw) return result
    const metas = JSON.parse(raw) as Array<{ id: string; skillName: string }>
    for (const meta of metas) {
      if (meta.skillName !== skillName) continue
      const convRaw = localStorage.getItem(CONV_STORAGE_PREFIX + meta.id)
      if (convRaw) {
        const conv = JSON.parse(convRaw) as SkillConversation
        result.set(conv.id, conv)
      }
    }
  } catch { /* corrupted data — start fresh */ }
  return result
}

function schedulePersist(get: () => SkillIDESlice) {
  if (_flushTimer) clearTimeout(_flushTimer)
  _flushTimer = setTimeout(() => {
    const { skillConversations, activeSkillConvId } = get()
    if (activeSkillConvId) {
      const conv = skillConversations.get(activeSkillConvId)
      if (conv) persistConversation(conv)
    }
    persistConversationsMeta(skillConversations)
    _flushTimer = null
  }, 1000)
}

// ============================================
// 对话消息辅助
// ============================================

function addMessageToConv(
  convs: Map<string, SkillConversation>,
  convId: string,
  msg: SkillChatMessage,
): Map<string, SkillConversation> {
  const conv = convs.get(convId)
  if (!conv) return convs
  const updated = new Map(convs)
  updated.set(convId, {
    ...conv,
    messages: [...conv.messages, msg],
    updatedAt: Date.now(),
  })
  return updated
}

// ============================================
// Slice 工厂
// ============================================

export const createSkillIDESlice: StateCreator<SkillIDESlice> = (set, get) => ({
  // Mode
  ideMode: false,
  setIDEMode: (mode) => set({ ideMode: mode }),

  // Active skill
  activeSkillName: null,
  activeSkillContent: null,
  activeSkillOriginal: null,
  activeSkillDirty: false,
  activeSkillTruncated: false,

  openSkill: async (name) => {
    const serverUrl = localServerService.getServerUrl()
    try {
      // 后端没有 /skills/:name/content 路由，改走 /skills/:name/raw 取整个目录的文件清单，
      // 再从中挑出 SKILL.md（详见 .qoder/Specs/skill_ide_三合一方案.md「前置技术问题 #1」）
      const res = await fetch(`${serverUrl}/skills/${encodeURIComponent(name)}/raw`, {
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        console.error('[SkillIDE] Failed to open skill:', res.status)
        return
      }
      const data = await res.json()

      const files: Array<{ path: string; content: string }> = data.files ?? []
      const skillFile = files.find(
        (f) => f.path === 'SKILL.md' || f.path.toLowerCase() === 'skill.md',
      )
      if (!skillFile) {
        console.error('[SkillIDE] SKILL.md not found in skill directory:', name)
        return
      }
      // 注意: /raw 对单文件 content 截断至 10000 字符。超长 skill 会丢失尾部内容；
      // 这是 Phase 0 的已知妥协，后续 Edit 模式需要后端补 /content 路由（见技术债 #3）
      const content = skillFile.content || ''
      const truncated = content.length >= 10000
      if (truncated) {
        console.warn(
          `[SkillIDE] Skill "${name}" content >= 10000 chars; assuming truncated by /raw. Save and chat are disabled to prevent data loss.`,
        )
      }

      // 加载该 skill 的会话历史
      const existingConvs = loadConversationsForSkill(name)
      // 合并到现有会话中 (保留其他 skill 的会话)
      const merged = new Map(get().skillConversations)
      for (const [k, v] of existingConvs) merged.set(k, v)

      // 查找或创建默认会话
      let defaultConvId: string | null = null
      for (const [id, conv] of existingConvs) {
        if (!defaultConvId || conv.updatedAt > (existingConvs.get(defaultConvId)?.updatedAt ?? 0)) {
          defaultConvId = id
        }
      }

      set({
        activeSkillName: name,
        activeSkillContent: content,
        activeSkillOriginal: content,
        activeSkillDirty: false,
        activeSkillTruncated: truncated,
        activeTab: 'preview',
        pendingDiff: null,
        productionStream: '',
        productionError: null,
        diagnostics: null,
        diagnosticScore: null,
        skillConversations: merged,
        activeSkillConvId: defaultConvId,
        skillChatStreaming: false,
        skillChatStreamContent: '',
        skillChatReasoningContent: '',
      })
      if (!defaultConvId) {
        get().createSkillConversation(name)
      }

      // Auto-validate on open
      get().validateSkill()
      // Load snapshots
      get().loadSnapshots(name)
    } catch (err) {
      console.error('[SkillIDE] Error opening skill:', err)
    }
  },

  closeSkill: () => set({
    activeSkillName: null,
    activeSkillContent: null,
    activeSkillOriginal: null,
    activeSkillDirty: false,
    activeSkillTruncated: false,
    pendingDiff: null,
    productionStream: '',
    productionError: null,
    diagnostics: null,
    diagnosticScore: null,
    snapshots: [],
    activeSkillConvId: null,
    skillChatStreaming: false,
    skillChatStreamContent: '',
    skillChatReasoningContent: '',
  }),

  updateSkillContent: (content) => {
    const { activeSkillOriginal } = get()
    set({
      activeSkillContent: content,
      activeSkillDirty: content !== activeSkillOriginal,
    })
  },

  // Workspace tabs
  activeTab: 'preview',
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Preview panel
  previewPanelOpen: true,
  setPreviewPanelOpen: (open) => set({ previewPanelOpen: open }),

  // Legacy producer panel (保留接口兼容)
  producerOpen: true,
  setProducerOpen: (open) => set({ producerOpen: open }),
  producerMode: 'quick',
  setProducerMode: (mode) => set({ producerMode: mode }),

  // Production state
  producing: false,
  productionStream: '',
  productionError: null,

  // Diagnostics
  diagnostics: null,
  diagnosticScore: null,

  // Recent ops
  recentOps: [],
  addRecentOp: (op) => set((state) => ({
    recentOps: [op, ...state.recentOps].slice(0, MAX_RECENT_OPS),
  })),

  // Diff
  pendingDiff: null,

  applyDiff: async () => {
    const { pendingDiff, activeSkillName } = get()
    if (!pendingDiff || !activeSkillName) return

    set({
      activeSkillContent: pendingDiff.proposed,
      activeSkillDirty: true,
      pendingDiff: null,
    })
    await get().saveSkill()
  },

  rejectDiff: () => set({ pendingDiff: null }),

  // Snapshots
  // 后端 snapshot 系统从未实现 — 整个 server/ 目录搜索 'snapshot' 关键词无任何匹配。
  // 该函数桩化为返回空数组，UI 侧 SkillVersionTimeline tab 已隐藏。
  // 后续选项详见 .qoder/Specs/skill_ide_三合一方案.md「已知技术债 #1」
  snapshots: [],
  loadSnapshots: async (_skillName) => {
    set({ snapshots: [] })
  },

  // LLM config
  temperatureMode: 'production',
  setTemperatureMode: (mode) => set({ temperatureMode: mode }),

  // ============================================
  // Legacy Actions (保留)
  // ============================================

  saveSkill: async () => {
    const { activeSkillName, activeSkillContent, activeSkillTruncated } = get()
    if (!activeSkillName || activeSkillContent === null) return
    // 防数据丢失：当前内容来自被截断的 /raw 响应，整文件覆盖会破坏 SKILL.md 尾部
    if (activeSkillTruncated) {
      console.error(
        '[SkillIDE] Save blocked: skill content was truncated by /raw endpoint. Refusing to overwrite remote file with partial content.',
      )
      return
    }

    const serverUrl = localServerService.getServerUrl()
    try {
      const res = await fetch(`${serverUrl}/skills/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: activeSkillName, content: activeSkillContent }),
        signal: AbortSignal.timeout(10000),
      })

      if (!res.ok) {
        console.error('[SkillIDE] Save failed:', res.status)
        return
      }

      const result = await res.json()
      set({
        activeSkillOriginal: activeSkillContent,
        activeSkillDirty: false,
        diagnosticScore: result.scoreAfter ?? null,
        diagnostics: result.diagnostics ?? null,
      })

      get().addRecentOp({
        type: 'save',
        description: `Saved ${activeSkillName} (score: ${result.scoreAfter ?? '?'})`,
        timestamp: Date.now(),
      })
    } catch (err) {
      console.error('[SkillIDE] Save error:', err)
    }
  },

  validateSkill: async () => {
    const { activeSkillName } = get()
    if (!activeSkillName) return

    const serverUrl = localServerService.getServerUrl()
    try {
      const res = await fetch(`${serverUrl}/skills/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: activeSkillName }),
        signal: AbortSignal.timeout(10000),
      })

      if (!res.ok) return
      const result = await res.json()
      set({
        diagnostics: result.diagnostics || null,
        diagnosticScore: result.score ?? null,
      })
    } catch {
      // Validation is best-effort
    }
  },

  produceSkill: async (instruction) => {
    const {
      activeSkillName,
      activeSkillContent,
      recentOps,
      temperatureMode,
    } = get()

    if (_productionAbortController) {
      _productionAbortController.abort()
    }
    _productionAbortController = new AbortController()

    set({
      producing: true,
      productionStream: '',
      productionError: null,
      pendingDiff: null,
    })

    try {
      const result = await skillProductionService.produce({
        currentContent: activeSkillContent,
        instruction,
        skillName: activeSkillName,
        recentOps,
        temperatureMode,
        onChunk: (chunk) => {
          set((state) => ({
            productionStream: state.productionStream + chunk,
          }))
        },
        signal: _productionAbortController.signal,
      })

      if (result.skillContent) {
        set({
          producing: false,
          pendingDiff: {
            original: activeSkillContent || '',
            proposed: result.skillContent,
          },
        })
      } else {
        set({
          producing: false,
          productionError: result.error || 'Failed to extract SKILL.md content from LLM output',
        })
      }

      get().addRecentOp({
        type: 'produce',
        description: `AI: ${instruction.slice(0, 60)}${instruction.length > 60 ? '...' : ''}`,
        timestamp: Date.now(),
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        set({ producing: false, productionError: null })
        return
      }
      set({
        producing: false,
        productionError: (err as Error).message || 'Production failed',
      })
    } finally {
      _productionAbortController = null
    }
  },

  cancelProduction: () => {
    if (_productionAbortController) {
      _productionAbortController.abort()
      _productionAbortController = null
    }
    set({ producing: false, productionError: null })
  },

  createSkill: async (params) => {
    const serverUrl = localServerService.getServerUrl()
    try {
      const res = await fetch(`${serverUrl}/skills/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: params.name,
          description: params.description,
          type: params.type,
        }),
        signal: AbortSignal.timeout(10000),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Create failed' }))
        console.error('[SkillIDE] Create failed:', err)
        return
      }

      const result = await res.json()
      get().addRecentOp({
        type: 'create',
        description: `Created skill: ${result.name}`,
        timestamp: Date.now(),
      })

      await get().openSkill(result.name)
    } catch (err) {
      console.error('[SkillIDE] Create error:', err)
    }
  },

  // ============================================
  // 对话式 IDE
  // ============================================

  skillConversations: new Map(),
  activeSkillConvId: null,
  skillChatStreaming: false,
  skillChatStreamContent: '',
  skillChatReasoningContent: '',

  createSkillConversation: (skillName) => {
    const id = generateId()
    const conv: SkillConversation = {
      id,
      skillName,
      title: '新会话',
      messages: [{
        id: generateId(),
        role: 'system',
        content: `开始编辑技能 **${skillName}**。你可以描述想要的修改，我会解释思路并提出具体方案。`,
        timestamp: Date.now(),
      }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    set((state) => {
      const updated = new Map(state.skillConversations)
      updated.set(id, conv)
      return {
        skillConversations: updated,
        activeSkillConvId: id,
      }
    })
    schedulePersist(get)
    return id
  },

  switchSkillConversation: (convId) => {
    const conv = get().skillConversations.get(convId)
    if (!conv) return
    set({ activeSkillConvId: convId })
  },

  deleteSkillConversation: (convId) => {
    set((state) => {
      const updated = new Map(state.skillConversations)
      updated.delete(convId)
      try { localStorage.removeItem(CONV_STORAGE_PREFIX + convId) } catch { /* ok */ }

      let nextConvId = state.activeSkillConvId
      if (nextConvId === convId) {
        // 切到同 skill 的最近一个，或 null
        nextConvId = null
        for (const [id, c] of updated) {
          if (c.skillName === state.activeSkillName) {
            if (!nextConvId || c.updatedAt > (updated.get(nextConvId)?.updatedAt ?? 0)) {
              nextConvId = id
            }
          }
        }
      }

      return {
        skillConversations: updated,
        activeSkillConvId: nextConvId,
      }
    })
    schedulePersist(get)
  },

  sendSkillChat: async (message) => {
    const {
      activeSkillConvId,
      activeSkillName,
      activeSkillContent,
      activeSkillTruncated,
      temperatureMode,
      skillConversations,
    } = get()

    if (!activeSkillConvId || !activeSkillName) return
    // 截断内容下不允许 AI 编辑：模型基于不完整的 skill 生成的 diff 一旦被接受，
    // saveSkill 虽然会拦截，但用户已浪费 token 等待 streaming。提前拦截。
    if (activeSkillTruncated) {
      console.error('[SkillIDE] Chat blocked: skill content was truncated by /raw endpoint.')
      return
    }

    const conv = skillConversations.get(activeSkillConvId)
    if (!conv) return

    // 1. 追加用户消息
    const userMsg: SkillChatMessage = {
      id: generateId(),
      role: 'user',
      content: message,
      timestamp: Date.now(),
    }
    set({
      skillConversations: addMessageToConv(get().skillConversations, activeSkillConvId, userMsg),
      skillChatStreaming: true,
      skillChatStreamContent: '',
      skillChatReasoningContent: '',
    })

    // 2. 取消之前的流
    if (_chatAbortController) _chatAbortController.abort()
    _chatAbortController = new AbortController()

    try {
      // 3. 构建完整的会话历史 (SimpleChatMessage 格式)
      const updatedConv = get().skillConversations.get(activeSkillConvId)!
      const chatMessages = updatedConv.messages
        .filter((m) => m.role !== 'system' || m === updatedConv.messages[0])
        .map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        }))

      // 4. 调用多轮生产
      let rawOutput = ''
      let reasoningOutput = ''
      const result = await skillProductionService.produceMultiTurn({
        conversationMessages: chatMessages,
        currentContent: activeSkillContent,
        skillName: activeSkillName,
        temperatureMode,
        onChunk: (chunk) => {
          rawOutput += chunk
          set({ skillChatStreamContent: rawOutput })
        },
        onReasoningChunk: (chunk) => {
          reasoningOutput += chunk
          set({ skillChatReasoningContent: reasoningOutput })
        },
        signal: _chatAbortController.signal,
      })

      // 5. 解析结果，提取推理和 diff
      const { reasoning, diffBlocks } = skillProductionService.extractReasoningAndDiffs(
        result.content,
        activeSkillContent || '',
      )

      // 6. 创建助手消息
      const assistantMsg: SkillChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: reasoning,
        timestamp: Date.now(),
        diffBlocks: diffBlocks.length > 0 ? diffBlocks : undefined,
        reasoningContent: result.reasoningContent || reasoningOutput || undefined,
      }

      set((state) => ({
        skillConversations: addMessageToConv(state.skillConversations, activeSkillConvId, assistantMsg),
        skillChatStreaming: false,
        skillChatStreamContent: '',
        skillChatReasoningContent: '',
      }))

      get().addRecentOp({
        type: 'produce',
        description: `Chat: ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`,
        timestamp: Date.now(),
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        set({ skillChatStreaming: false, skillChatStreamContent: '', skillChatReasoningContent: '' })
        return
      }

      // 追加错误消息
      const errorMsg: SkillChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: (err as Error).message || '请求失败',
        timestamp: Date.now(),
        error: true,
      }
      set((state) => ({
        skillConversations: addMessageToConv(
          state.skillConversations,
          activeSkillConvId,
          errorMsg,
        ),
        skillChatStreaming: false,
        skillChatStreamContent: '',
        skillChatReasoningContent: '',
      }))
    } finally {
      _chatAbortController = null
      schedulePersist(get)
    }
  },

  cancelSkillChat: () => {
    if (_chatAbortController) {
      _chatAbortController.abort()
      _chatAbortController = null
    }
    set({ skillChatStreaming: false, skillChatStreamContent: '', skillChatReasoningContent: '' })
  },

  acceptDiffBlock: async (messageId, diffBlockId) => {
    const { activeSkillConvId, skillConversations } = get()
    if (!activeSkillConvId) return

    const conv = skillConversations.get(activeSkillConvId)
    if (!conv) return

    // 找到消息和 diff block
    const msgIdx = conv.messages.findIndex((m) => m.id === messageId)
    if (msgIdx === -1) return
    const msg = conv.messages[msgIdx]
    if (!msg.diffBlocks) return

    const blockIdx = msg.diffBlocks.findIndex((b) => b.id === diffBlockId)
    if (blockIdx === -1) return
    const block = msg.diffBlocks[blockIdx]
    if (block.status !== 'pending') return

    // 更新 block 状态
    const updatedBlocks = [...msg.diffBlocks]
    updatedBlocks[blockIdx] = { ...block, status: 'accepted' }
    const updatedMessages = [...conv.messages]
    updatedMessages[msgIdx] = { ...msg, diffBlocks: updatedBlocks }
    const updatedConv = { ...conv, messages: updatedMessages, updatedAt: Date.now() }

    const updatedConvs = new Map(skillConversations)
    updatedConvs.set(activeSkillConvId, updatedConv)

    // 应用更改到技能内容
    set({
      activeSkillContent: block.proposed,
      activeSkillDirty: true,
      skillConversations: updatedConvs,
    })

    // 自动保存
    await get().saveSkill()

    // 追加系统消息
    const score = get().diagnosticScore
    const sysMsg: SkillChatMessage = {
      id: generateId(),
      role: 'system',
      content: `Changes applied and saved.${score !== null ? ` Score: ${score}/100` : ''}`,
      timestamp: Date.now(),
    }
    set({
      skillConversations: addMessageToConv(get().skillConversations, activeSkillConvId, sysMsg),
    })
    schedulePersist(get)
  },

  rejectDiffBlock: (messageId, diffBlockId) => {
    const { activeSkillConvId, skillConversations } = get()
    if (!activeSkillConvId) return

    const conv = skillConversations.get(activeSkillConvId)
    if (!conv) return

    const msgIdx = conv.messages.findIndex((m) => m.id === messageId)
    if (msgIdx === -1) return
    const msg = conv.messages[msgIdx]
    if (!msg.diffBlocks) return

    const blockIdx = msg.diffBlocks.findIndex((b) => b.id === diffBlockId)
    if (blockIdx === -1) return

    const updatedBlocks = [...msg.diffBlocks]
    updatedBlocks[blockIdx] = { ...updatedBlocks[blockIdx], status: 'rejected' }
    const updatedMessages = [...conv.messages]
    updatedMessages[msgIdx] = { ...msg, diffBlocks: updatedBlocks }
    const updatedConv = { ...conv, messages: updatedMessages, updatedAt: Date.now() }

    const updatedConvs = new Map(skillConversations)
    updatedConvs.set(activeSkillConvId, updatedConv)
    set({ skillConversations: updatedConvs })

    // 追加系统消息
    const sysMsg: SkillChatMessage = {
      id: generateId(),
      role: 'system',
      content: 'Changes rejected. You can ask me to try a different approach.',
      timestamp: Date.now(),
    }
    set({
      skillConversations: addMessageToConv(get().skillConversations, activeSkillConvId, sysMsg),
    })
    schedulePersist(get)
  },

  acceptAllDiffs: async (messageId) => {
    const { activeSkillConvId, skillConversations } = get()
    if (!activeSkillConvId) return

    const conv = skillConversations.get(activeSkillConvId)
    if (!conv) return

    const msg = conv.messages.find((m) => m.id === messageId)
    if (!msg?.diffBlocks) return

    // 应用最后一个 pending block (它包含完整的 proposed 内容)
    const pendingBlocks = msg.diffBlocks.filter((b) => b.status === 'pending')
    if (pendingBlocks.length === 0) return

    const lastBlock = pendingBlocks[pendingBlocks.length - 1]

    // 标记所有 pending 为 accepted
    const msgIdx = conv.messages.findIndex((m) => m.id === messageId)
    const updatedBlocks = msg.diffBlocks.map((b) =>
      b.status === 'pending' ? { ...b, status: 'accepted' as const } : b,
    )
    const updatedMessages = [...conv.messages]
    updatedMessages[msgIdx] = { ...msg, diffBlocks: updatedBlocks }
    const updatedConv = { ...conv, messages: updatedMessages, updatedAt: Date.now() }

    const updatedConvs = new Map(skillConversations)
    updatedConvs.set(activeSkillConvId, updatedConv)

    set({
      activeSkillContent: lastBlock.proposed,
      activeSkillDirty: true,
      skillConversations: updatedConvs,
    })

    await get().saveSkill()

    const score = get().diagnosticScore
    const sysMsg: SkillChatMessage = {
      id: generateId(),
      role: 'system',
      content: `All changes applied and saved.${score !== null ? ` Score: ${score}/100` : ''}`,
      timestamp: Date.now(),
    }
    set({
      skillConversations: addMessageToConv(get().skillConversations, activeSkillConvId, sysMsg),
    })
    schedulePersist(get)
  },
})
