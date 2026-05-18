/**
 * studyRoomSlice — 自习室 (Study Room) 状态管理 v2
 *
 * v2 核心变更:
 * - 新增 document (文章全文) + chatMessages (对话消息)
 * - 修复 409 Conflict (save 成功后同步 revision, 409 时 refetch 重试)
 * - agenda/evidencePool 保留为内部数据, UI 不直接展示
 */

import type { StateCreator } from 'zustand'
import type {
  WritingBrief,
  EvidenceItem,
  AgendaDoc,
  ChatTurn,
  ChatMessage,
  SkillRef,
  StudySessionRuntime,
  MemorySnippet,
  DocumentVersion,
  DocumentVersionMeta,
  DocumentVersionTrigger,
  EditSummary,
  DeliberationPhase,
  DiagnosisReport,
  RedTeamReport,
  InsightProposal,
  DeliberationUserChoice,
  RewriteStrategy,
} from '@/types'

// ============================================
// 后端 API 基址 + localStorage keys
// ============================================
// 注意：必须用 127.0.0.1 而不是 localhost，否则 Windows 上若装有系统代理
// (Clash/V2rayN 等, 如 http://127.0.0.1:13658)，fetch 会把 localhost 当外部域名
// 交给代理转发，导致 ERR_EMPTY_RESPONSE。127.0.0.1 通常在代理白名单里直连。
const API_BASE = 'http://127.0.0.1:3001'
const LS_KEY_TAB = 'studyRoom:libraryTab'
const LS_KEY_SESSION = 'studyRoom:activeSessionId'
const LS_DRAFT_PREFIX = 'studyRoom:draft:'
/**
 * "写作 Dun" 的前端持久化: {sessionId → LoadedDun}
 * 只存前端 (不改后端 schema), 刷新页面后能恢复上次装载的 Dun.
 * 结构是 session 级, 不同 session 可以挂不同的 Dun.
 */
const LS_KEY_LOADED_DUNS = 'studyRoom:loadedDuns'

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* noop */ }
}
function lsRemove(key: string) {
  try { localStorage.removeItem(key) } catch { /* noop */ }
}

// ---- 本地草稿: 极端情况下 (断电/崩溃/返回键误触) 的最后兜底 ----
// v2: 从只存 document 扩展到 document + chatMessages + savedAt, 保证对话也不丢
interface DraftPayload {
  sessionId: string
  document: string
  chatMessages?: ChatMessage[]
  savedAt: number
}

function draftKey(sessionId: string): string {
  return `${LS_DRAFT_PREFIX}${sessionId}`
}

function writeDraft(sessionId: string, document: string, chatMessages?: ChatMessage[]) {
  if (!sessionId) return
  // 只要有文档或对话之一就存
  if (!document && (!chatMessages || chatMessages.length === 0)) return
  const payload: DraftPayload = {
    sessionId,
    document: document || '',
    chatMessages: chatMessages || [],
    savedAt: Date.now(),
  }
  try { localStorage.setItem(draftKey(sessionId), JSON.stringify(payload)) }
  catch { /* 超出配额或被禁用: 静默忽略 */ }
}

function readDraft(sessionId: string): DraftPayload | null {
  const raw = lsGet(draftKey(sessionId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as DraftPayload
    if (parsed.sessionId === sessionId && typeof parsed.document === 'string') return parsed
  } catch { /* ignore */ }
  return null
}

function clearDraft(sessionId: string) {
  lsRemove(draftKey(sessionId))
}

// ---- 写作 Dun: localStorage 持久化 {sessionId → LoadedDun} ----
//
// 存放策略: 全部 session 的 Dun 放在同一 key 的字典里, 读写时整体 JSON 序列化.
// 几十个 session × 几 KB 的 LoadedDun 完全撑得住, 没必要按 session 分 key 增加复杂度.
// 结构类型和 StudySessionRuntime.loadedDun 一致 (避免循环依赖, 这里走结构类型).
type PersistedLoadedDun = NonNullable<StudySessionRuntime['loadedDun']>

function readLoadedDunMap(): Record<string, PersistedLoadedDun> {
  const raw = lsGet(LS_KEY_LOADED_DUNS)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, PersistedLoadedDun>
    }
  } catch { /* ignore */ }
  return {}
}

function writeLoadedDunMap(map: Record<string, PersistedLoadedDun>) {
  try { localStorage.setItem(LS_KEY_LOADED_DUNS, JSON.stringify(map)) }
  catch { /* 超出配额: 静默忽略 */ }
}

function persistSessionDun(sessionId: string, dun: PersistedLoadedDun | null) {
  const map = readLoadedDunMap()
  if (dun) {
    map[sessionId] = dun
  } else {
    delete map[sessionId]
  }
  writeLoadedDunMap(map)
}

function loadSessionDun(sessionId: string): PersistedLoadedDun | null {
  const map = readLoadedDunMap()
  return map[sessionId] ?? null
}

// ============================================
// Slice 接口
// ============================================

export interface StudyRoomSlice {
  // Tab 切换
  libraryTab: 'library' | 'studyroom'
  setLibraryTab: (tab: 'library' | 'studyroom') => void

  // 会话状态
  activeSessionId: string | null
  studySessions: Record<string, StudySessionRuntime>

  // v2 对话式 Actions
  createSession: (brief: WritingBrief) => Promise<string>
  loadSession: (id: string) => Promise<void>
  setActiveSession: (id: string | null) => void
  updateDocument: (document: string) => void
  appendToDocument: (delta: string) => void
  addChatMessage: (message: ChatMessage) => void
  updateChatMessage: (messageId: string, patch: Partial<ChatMessage>) => void
  setEvidencePool: (pool: EvidenceItem[]) => void
  /** 合并新证据到现有池 (按 id 去重), 返回实际新增条数 */
  mergeEvidence: (items: EvidenceItem[]) => number
  /** 增量向 brief.skills 追加新 @ 的 skills (按 name 去重) */
  addSkillsToBrief: (skills: SkillRef[]) => void
  /** 更新当前 session brief 的风格指纹 id (null 表示取消应用) */
  updateBriefFingerprint: (fingerprintId: string | null) => void
  /**
   * 装载/卸下"写作 Dun" (代笔)
   * - dun 为 null: 卸下当前 Dun, 回到普通写作
   * - dun 有值: 装载并持久化到 localStorage (下次进 session 能恢复)
   */
  setSessionDun: (
    sessionId: string,
    dun: NonNullable<StudySessionRuntime['loadedDun']> | null,
  ) => void
  /** 刷新长期记忆快照 */
  setMemorySnippets: (snippets: MemorySnippet[]) => void
  updateAgenda: (agenda: AgendaDoc) => void
  setTrustMode: (on: boolean) => void
  saveSessionToBackend: () => Promise<void>
  deleteSession: (id: string) => Promise<void>
  loadSessionsList: () => Promise<void>

  // --- 版本历史 ---
  /** 从后端拉取当前 session 的版本列表 (轻量, 不含 document 全文) */
  loadVersions: (sessionId: string) => Promise<void>
  /**
   * 为当前 session 追加一个版本快照.
   * - 本地立即追加 meta 到 session.versions (乐观更新, UI 立刻可见)
   * - 并发 POST 到后端 /versions, 失败仅 warn 不回滚 (避免丢数据, 最差下次载入时从后端对齐)
   */
  saveVersion: (
    sessionId: string,
    params: {
      document: string
      trigger: DocumentVersionTrigger
      summary?: EditSummary | string | null
    },
  ) => Promise<DocumentVersionMeta | null>
  /**
   * 从某个历史版本回退:
   * 1. 先把"当前文档"快照为一个 'revert' 版本 (保证永不丢数据)
   * 2. 从后端拉取目标版本的完整 document
   * 3. 把 document 切换到目标版本内容, 并立即 PUT 落库
   */
  revertToVersion: (sessionId: string, versionId: string) => Promise<void>
  /** 按 id 获取单个版本的完整详情 (含 document 全文) */
  fetchVersionDetail: (sessionId: string, versionId: string) => Promise<DocumentVersion | null>

  // 本地草稿兜底 (应对断电/崩溃/网络中断)
  checkLocalDraft: (sessionId: string) => { hasDraft: boolean; document: string; savedAt: number } | null
  restoreDraft: (sessionId: string) => void
  discardDraft: (sessionId: string) => void

  // legacy (兼容现有代码, 逐步移除)
  addChatTurn: (turn: ChatTurn) => void
  focusedSectionId: string | null
  setFocusedSection: (id: string | null) => void

  // 会话列表 (侧边栏用)
  sessionsList: Array<{ id: string; title: string; genre: string; status: string; updatedAt: number }>
  sessionsListLoading: boolean

  // --- 深度打磨 (Deliberation) ---
  /** 启动深度打磨: 创建 DeliberationState 并设置 phase */
  startDeliberation: (sessionId: string) => void
  /** 更新深度打磨阶段 */
  updateDeliberationPhase: (sessionId: string, phase: DeliberationPhase) => void
  /** 更新诊断报告 */
  setDeliberationDiagnosis: (sessionId: string, diagnosis: DiagnosisReport) => void
  /** 更新红队报告 */
  setDeliberationRedTeam: (sessionId: string, redTeam: RedTeamReport) => void
  /** 更新洞察候选 */
  setDeliberationProposal: (sessionId: string, proposal: InsightProposal) => void
  /** 记录用户选择 */
  setDeliberationUserChoice: (sessionId: string, choice: DeliberationUserChoice) => void
  /** 更新重写策略 */
  setDeliberationStrategy: (sessionId: string, strategy: RewriteStrategy) => void
  /** 记录错误 */
  setDeliberationError: (sessionId: string, error: string) => void
  /** 清除深度打磨状态 */
  clearDeliberation: (sessionId: string) => void
}

// ============================================
// 辅助: 更新当前 session 的嵌套状态
// ============================================
type SetFn = (partial: Partial<StudyRoomSlice> | ((state: StudyRoomSlice) => Partial<StudyRoomSlice>)) => void
type GetFn = () => StudyRoomSlice

function updateCurrentSession(
  get: GetFn,
  set: SetFn,
  updater: (session: StudySessionRuntime) => Partial<StudySessionRuntime>,
) {
  const { activeSessionId, studySessions } = get()
  if (!activeSessionId || !studySessions[activeSessionId]) return
  const current = studySessions[activeSessionId]
  const patched = { ...current, ...updater(current), updatedAt: Date.now() }
  set({ studySessions: { ...studySessions, [activeSessionId]: patched } })
}

/** 按 sessionId 更新指定 session 的嵌套状态 (深度打磨等非当前 session 也能用) */
function updateSessionById(
  get: GetFn,
  set: SetFn,
  sessionId: string,
  patch: Partial<StudySessionRuntime>,
) {
  const { studySessions } = get()
  const session = studySessions[sessionId]
  if (!session) return
  set({
    studySessions: {
      ...studySessions,
      [sessionId]: { ...session, ...patch, updatedAt: Date.now() },
    },
  })
}

// ============================================
// 创建 Slice
// ============================================

export const createStudyRoomSlice: StateCreator<StudyRoomSlice> = (set, get) => ({
  // --- Tab (localStorage 持久化) ---
  libraryTab: (lsGet(LS_KEY_TAB) === 'studyroom' ? 'studyroom' : 'library') as 'library' | 'studyroom',
  setLibraryTab: (tab) => {
    lsSet(LS_KEY_TAB, tab)
    set({ libraryTab: tab })
  },

  // --- Session state (localStorage 持久化 activeSessionId) ---
  activeSessionId: lsGet(LS_KEY_SESSION),
  studySessions: {},
  focusedSectionId: null,
  sessionsList: [],
  sessionsListLoading: false,

  // --- Actions ---

  createSession: async (brief) => {
    const res = await fetch(`${API_BASE}/api/study/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: brief.intent.slice(0, 100),
        genre: brief.genre,
        length_hint: brief.length,
        dun_id: brief.dunId ?? null,
        brief,
      }),
    })
    const json = await res.json()
    const sid: string = json.id
    const now = Date.now()

    const runtime: StudySessionRuntime = {
      id: sid,
      brief,
      document: '',
      chatMessages: [],
      evidencePool: [],
      agenda: null,
      chatHistory: [],
      status: 'active',
      revision: json.revision || 1,
      createdAt: now,
      updatedAt: now,
      trustMode: true,
      versions: [],
      // 新 session 默认不挂 Dun; 如果同 id 有 LS 残留也恢复 (极少见, 但兜底)
      loadedDun: loadSessionDun(sid),
    }

    set((state) => ({
      studySessions: { ...state.studySessions, [sid]: runtime },
      activeSessionId: sid,
    }))
    lsSet(LS_KEY_SESSION, sid)

    return sid
  },

  loadSession: async (id) => {
    const res = await fetch(`${API_BASE}/api/study/sessions/${id}`)
    if (!res.ok) return
    const data = await res.json()

    const runtime: StudySessionRuntime = {
      id,
      brief: data.brief || { id, intent: data.title || '', genre: data.genre || 'custom', length: data.length_hint || 'medium', lengthExplicit: false, tone: [], audience: '通用读者', constraints: [], skills: [], pinnedEntityIds: [], createdAt: data.created_at },
      document: data.document || '',
      chatMessages: data.chat_messages || [],
      evidencePool: data.evidence || [],
      agenda: data.agenda || null,
      chatHistory: [],
      status: data.status || 'active',
      revision: data.revision || 1,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      trustMode: true,
      memorySnippets: data.memory_snippets || [],
      versions: [],  // 先占位, 下面异步拉取 (不阻塞主加载)
      // Dun 不从后端拉, 只从 localStorage 恢复 (每个 session 独立)
      loadedDun: loadSessionDun(id),
    }

    set((state) => ({
      studySessions: { ...state.studySessions, [id]: runtime },
      activeSessionId: id,
    }))
    lsSet(LS_KEY_SESSION, id)

    // 异步拉取版本历史, 失败静默 (不影响主流程)
    get().loadVersions(id).catch(() => { /* noop */ })

    // v2 关键兜底: 加载完后端数据后, 立即检查本地草稿是否更完整
    // 场景: 用户写完文章后还没等节流保存就按了返回键, 后端 document 是空的但草稿在 localStorage
    const draft = readDraft(id)
    if (draft) {
      const backendLen = (data.document || '').length
      const draftLen = (draft.document || '').length
      const backendChatCount = (data.chat_messages || []).length
      const draftChatCount = (draft.chatMessages || []).length
      const draftIsNewer =
        draftLen > backendLen + 10 ||
        draftChatCount > backendChatCount

      if (draftIsNewer) {
        // 静默自动恢复: 不弹窗打扰, 直接把草稿合并进 runtime
        console.info(
          `[studyRoom] auto-restore from local draft: doc ${backendLen}→${draftLen}, chat ${backendChatCount}→${draftChatCount}`,
        )
        const restored: StudySessionRuntime = {
          ...runtime,
          document: draftLen > backendLen ? draft.document : runtime.document,
          chatMessages: draftChatCount > backendChatCount ? (draft.chatMessages || []) : runtime.chatMessages,
          updatedAt: Date.now(),
        }
        set((state) => ({
          studySessions: { ...state.studySessions, [id]: restored },
        }))
        // 立即 flush 到后端, 下次就不需要再恢复了
        get().saveSessionToBackend().catch(() => { /* 静默处理 */ })
      }
    }
  },

  setActiveSession: (id) => {
    if (id) lsSet(LS_KEY_SESSION, id)
    else lsRemove(LS_KEY_SESSION)
    set({ activeSessionId: id })
  },

  // --- v2 对话式 actions ---

  updateDocument: (document) => {
    updateCurrentSession(get, set, () => ({ document }))
    // 同步写本地草稿 (document + chatMessages 都带上, 覆盖式)
    const { activeSessionId, studySessions } = get()
    if (activeSessionId && studySessions[activeSessionId]) {
      writeDraft(activeSessionId, document, studySessions[activeSessionId].chatMessages)
    }
  },

  appendToDocument: (delta) => {
    updateCurrentSession(get, set, (s) => ({ document: s.document + delta }))
    const { activeSessionId, studySessions } = get()
    if (activeSessionId && studySessions[activeSessionId]) {
      const s = studySessions[activeSessionId]
      writeDraft(activeSessionId, s.document, s.chatMessages)
    }
  },

  addChatMessage: (message) => {
    updateCurrentSession(get, set, (s) => ({
      chatMessages: [...s.chatMessages, message],
    }))
    // v2: 对话消息也写本地草稿, 避免返回时丢失
    const { activeSessionId, studySessions } = get()
    if (activeSessionId && studySessions[activeSessionId]) {
      const s = studySessions[activeSessionId]
      writeDraft(activeSessionId, s.document, s.chatMessages)
    }
  },

  updateChatMessage: (messageId, patch) => {
    updateCurrentSession(get, set, (s) => ({
      chatMessages: s.chatMessages.map((m) =>
        m.id === messageId ? { ...m, ...patch } : m,
      ),
    }))
    // v2: 同步到本地草稿 (但跳过 streaming 中间态, 减少 localStorage 写入频率)
    if (patch.streaming === true) return
    const { activeSessionId, studySessions } = get()
    if (activeSessionId && studySessions[activeSessionId]) {
      const s = studySessions[activeSessionId]
      writeDraft(activeSessionId, s.document, s.chatMessages)
    }
  },

  updateAgenda: (agenda) => updateCurrentSession(get, set, () => ({ agenda })),

  setEvidencePool: (pool) => updateCurrentSession(get, set, () => ({ evidencePool: pool })),

  mergeEvidence: (items) => {
    const { activeSessionId, studySessions } = get()
    if (!activeSessionId || !studySessions[activeSessionId]) return 0
    const current = studySessions[activeSessionId]
    const existingIds = new Set(current.evidencePool.map((e) => e.id))
    const fresh = items.filter((e) => !existingIds.has(e.id))
    if (fresh.length === 0) return 0
    updateCurrentSession(get, set, (s) => ({
      evidencePool: [...s.evidencePool, ...fresh],
    }))
    return fresh.length
  },

  addSkillsToBrief: (skills) => {
    if (!skills || skills.length === 0) return
    updateCurrentSession(get, set, (s) => {
      const existing = new Set(s.brief.skills.map((sk) => sk.name.toLowerCase()))
      const fresh = skills.filter((sk) => !existing.has(sk.name.toLowerCase()))
      if (fresh.length === 0) return {}
      return {
        brief: {
          ...s.brief,
          skills: [...s.brief.skills, ...fresh],
        },
      }
    })
  },

  updateBriefFingerprint: (fingerprintId) => {
    updateCurrentSession(get, set, (s) => ({
      brief: {
        ...s.brief,
        fingerprintId,
      },
    }))
    // 立即落盘 (fingerprint 切换是重要操作, 不等节流)
    get().saveSessionToBackend().catch(() => { /* 静默 */ })
  },

  setSessionDun: (sessionId, dun) => {
    const { studySessions } = get()
    if (!studySessions[sessionId]) return
    // 1. 更新内存 session
    set((state) => {
      const s = state.studySessions[sessionId]
      if (!s) return {}
      return {
        studySessions: {
          ...state.studySessions,
          [sessionId]: { ...s, loadedDun: dun, updatedAt: Date.now() },
        },
      }
    })
    // 2. 持久化 (localStorage 级, 不走后端)
    persistSessionDun(sessionId, dun)
  },

  setMemorySnippets: (snippets) =>
    updateCurrentSession(get, set, () => ({ memorySnippets: snippets })),

  setTrustMode: (on) => updateCurrentSession(get, set, () => ({ trustMode: on })),

  // legacy (兼容)
  addChatTurn: (turn) =>
    updateCurrentSession(get, set, (s) => ({ chatHistory: [...s.chatHistory, turn] })),

  setFocusedSection: (id) => set({ focusedSectionId: id }),

  // --- 409-safe save: 成功后同步 revision, 409 时 refetch 重试一次 ---
  saveSessionToBackend: async () => {
    const { activeSessionId, studySessions } = get()
    if (!activeSessionId || !studySessions[activeSessionId]) return
    const session = studySessions[activeSessionId]

    const buildBody = (s: StudySessionRuntime) => ({
      revision: s.revision,
      title: s.brief.intent.slice(0, 100),
      genre: s.brief.genre,
      length_hint: s.brief.length,
      status: s.status,
      brief: s.brief,
      document: s.document,
      // v2 修复: 必须传 chat_messages, 否则对话记录永远不会落库
      chat_messages: s.chatMessages,
      evidence: s.evidencePool,
      agenda: s.agenda,
      memory_snippets: s.memorySnippets || [],
    })

    const doSave = async (s: StudySessionRuntime) => {
      const res = await fetch(`${API_BASE}/api/study/sessions/${activeSessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(s)),
      })
      return res
    }

    let res = await doSave(session)

    if (res.status === 409) {
      // 409 Conflict: refetch latest revision then retry once
      const freshRes = await fetch(`${API_BASE}/api/study/sessions/${activeSessionId}`)
      if (freshRes.ok) {
        const freshData = await freshRes.json()
        const freshRevision = freshData.revision ?? session.revision + 1
        // 更新本地 revision 后重试
        const patched = { ...session, revision: freshRevision, updatedAt: Date.now() }
        set((state) => ({
          studySessions: { ...state.studySessions, [activeSessionId]: patched },
        }))
        res = await doSave(patched)
        // 第二次仍 409 时，强制同步 revision 避免后续请求持续冲突
        if (res.status === 409) {
          console.warn('[StudyRoom] Second 409 conflict, force-syncing revision')
          updateCurrentSession(get, set, () => ({ revision: freshRevision + 1 }))
        }
      }
    }

    if (res.ok) {
      // 成功后同步后端返回的新 revision
      try {
        const resData = await res.json()
        if (resData.revision) {
          updateCurrentSession(get, set, () => ({ revision: resData.revision }))
        }
      } catch {
        // 如果响应不是 JSON, 至少本地 revision +1
        updateCurrentSession(get, set, (s) => ({ revision: s.revision + 1 }))
      }
      // 成功保存到后端 → 清理本地草稿 (已经安全落库)
      clearDraft(activeSessionId)
    }
  },

  deleteSession: async (id) => {
    await fetch(`${API_BASE}/api/study/sessions/${id}`, { method: 'DELETE' })
    // 连草稿和 Dun 一起清掉
    clearDraft(id)
    persistSessionDun(id, null)
    set((state) => {
      const { [id]: _, ...rest } = state.studySessions
      const newActive = state.activeSessionId === id ? null : state.activeSessionId
      if (state.activeSessionId === id) lsRemove(LS_KEY_SESSION)
      return {
        studySessions: rest,
        activeSessionId: newActive,
        sessionsList: state.sessionsList.filter((s) => s.id !== id),
      }
    })
  },

  // --- 本地草稿兜底 ---

  /**
   * 检查本地是否有比后端更完整的草稿
   * v2: 放宽判定条件 + 不再主动清理草稿 (避免误删)
   * 实际的自动恢复逻辑已挪到 loadSession 内部, 这里主要给调用方看数据
   */
  checkLocalDraft: (sessionId) => {
    const draft = readDraft(sessionId)
    if (!draft) return null
    const { studySessions } = get()
    const backendDoc = studySessions[sessionId]?.document || ''
    // 放宽到 +10 字: 流式写作中的细微延迟也能触发恢复
    if (draft.document.length > backendDoc.length + 10) {
      return { hasDraft: true, document: draft.document, savedAt: draft.savedAt }
    }
    // v2 关键改动: 不主动清理! 只有 saveSessionToBackend 成功后才清
    // 避免 "后端偶尔返回空数据 → 误判草稿无用 → 清掉 → 用户真的丢数据" 的灾难
    return null
  },

  restoreDraft: (sessionId) => {
    const draft = readDraft(sessionId)
    if (!draft) return
    const { studySessions, activeSessionId } = get()
    if (!studySessions[sessionId]) return

    // 恢复到当前 session (包括 document + chatMessages)
    set((state) => ({
      studySessions: {
        ...state.studySessions,
        [sessionId]: {
          ...state.studySessions[sessionId],
          document: draft.document,
          chatMessages: draft.chatMessages && draft.chatMessages.length > 0
            ? draft.chatMessages
            : state.studySessions[sessionId].chatMessages,
          updatedAt: Date.now(),
        },
      },
    }))
    // 如果是当前激活的 session, 立即 PUT 到后端 (避免再次丢失)
    if (activeSessionId === sessionId) {
      get().saveSessionToBackend().catch(() => { /* 静默处理 */ })
    }
  },

  discardDraft: (sessionId) => {
    clearDraft(sessionId)
  },

  // ============================================
  // 版本历史 (document versions)
  // ============================================

  loadVersions: async (sessionId) => {
    try {
      const res = await fetch(`${API_BASE}/api/study/sessions/${sessionId}/versions`)
      if (!res.ok) return
      const data = await res.json()
      const versions: DocumentVersionMeta[] = Array.isArray(data.versions) ? data.versions : []
      const { studySessions } = get()
      if (!studySessions[sessionId]) return
      set((state) => ({
        studySessions: {
          ...state.studySessions,
          [sessionId]: {
            ...state.studySessions[sessionId],
            versions,
          },
        },
      }))
    } catch (err) {
      console.warn('[studyRoom] loadVersions failed:', err)
    }
  },

  saveVersion: async (sessionId, params) => {
    const { studySessions } = get()
    const session = studySessions[sessionId]
    if (!session) return null

    const wordCount = params.document.replace(/\s/g, '').length
    const now = Date.now()
    const id = `v-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    // parent 指向当前列表里最新的一版 (studySessions.versions 已按 createdAt 倒序)
    const latest = (session.versions && session.versions.length > 0) ? session.versions[0] : null

    const fullVersion: DocumentVersion = {
      id,
      document: params.document,
      wordCount,
      createdAt: now,
      trigger: params.trigger,
      summary: params.summary ?? null,
      parentVersionId: latest ? latest.id : null,
    }

    // 乐观更新: 本地立即追加轻量元信息到列表头部, UI 立刻可见
    const meta: DocumentVersionMeta = {
      id: fullVersion.id,
      wordCount: fullVersion.wordCount,
      createdAt: fullVersion.createdAt,
      trigger: fullVersion.trigger,
      summary: fullVersion.summary,
      parentVersionId: fullVersion.parentVersionId,
    }
    set((state) => {
      const s = state.studySessions[sessionId]
      if (!s) return {}
      return {
        studySessions: {
          ...state.studySessions,
          [sessionId]: {
            ...s,
            versions: [meta, ...(s.versions || [])],
          },
        },
      }
    })

    // 异步 POST 到后端; 失败仅 warn — 本地已有, 下次 loadVersions 会从后端对齐
    try {
      const res = await fetch(`${API_BASE}/api/study/sessions/${sessionId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullVersion),
      })
      if (!res.ok) {
        console.warn('[studyRoom] saveVersion non-ok status:', res.status)
      }
    } catch (err) {
      console.warn('[studyRoom] saveVersion network failed:', err)
    }
    return meta
  },

  fetchVersionDetail: async (sessionId, versionId) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/study/sessions/${sessionId}/versions/${versionId}`,
      )
      if (!res.ok) return null
      const data = await res.json()
      return data as DocumentVersion
    } catch (err) {
      console.warn('[studyRoom] fetchVersionDetail failed:', err)
      return null
    }
  },

  revertToVersion: async (sessionId, versionId) => {
    const { studySessions } = get()
    const session = studySessions[sessionId]
    if (!session) return

    // 1. 先把当前文档保存为一个 'revert' 版本 (避免回退后丢掉当前状态)
    if (session.document && session.document.trim()) {
      await get().saveVersion(sessionId, {
        document: session.document,
        trigger: 'revert',
        summary: `回退前快照 (切换到历史版本 ${versionId.slice(0, 10)} 之前)`,
      })
    }

    // 2. 拉取目标版本详情 (含 document 全文)
    const target = await get().fetchVersionDetail(sessionId, versionId)
    if (!target || typeof target.document !== 'string') {
      console.warn('[studyRoom] revertToVersion: target not found', versionId)
      return
    }

    // 3. 切换 document 到目标版本
    set((state) => {
      const s = state.studySessions[sessionId]
      if (!s) return {}
      return {
        studySessions: {
          ...state.studySessions,
          [sessionId]: {
            ...s,
            document: target.document || '',
            updatedAt: Date.now(),
          },
        },
      }
    })

    // 4. 本地草稿同步 + 立即落库
    writeDraft(sessionId, target.document || '', session.chatMessages)
    if (get().activeSessionId === sessionId) {
      await get().saveSessionToBackend().catch(() => { /* noop */ })
    }
  },

  loadSessionsList: async () => {
    set({ sessionsListLoading: true })
    try {
      const res = await fetch(`${API_BASE}/api/study/sessions?status=active&limit=50`)
      const data = await res.json()
      // 后端响应 JSON 字段是 sessions (契约, 不随前端 state 字段重命名)
      const list = (data.sessions || []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        title: (s.title as string) || '',
        genre: (s.genre as string) || 'custom',
        status: (s.status as string) || 'active',
        updatedAt: (s.updated_at as number) || 0,
      }))
      set({ sessionsList: list })
    } finally {
      set({ sessionsListLoading: false })
    }
  },

  // --- 深度打磨 (Deliberation) Actions ---

  startDeliberation: (sessionId) => {
    updateSessionById(get, set, sessionId, {
      deliberation: {
        phase: 'diagnosing',
        startedAt: Date.now(),
      },
    })
  },

  updateDeliberationPhase: (sessionId, phase) => {
    const session = get().studySessions[sessionId]
    if (!session?.deliberation) return
    updateSessionById(get, set, sessionId, {
      deliberation: { ...session.deliberation, phase },
    })
  },

  setDeliberationDiagnosis: (sessionId, diagnosis) => {
    const session = get().studySessions[sessionId]
    if (!session?.deliberation) return
    updateSessionById(get, set, sessionId, {
      deliberation: { ...session.deliberation, diagnosis },
    })
  },

  setDeliberationRedTeam: (sessionId, redTeam) => {
    const session = get().studySessions[sessionId]
    if (!session?.deliberation) return
    updateSessionById(get, set, sessionId, {
      deliberation: { ...session.deliberation, redTeam },
    })
  },

  setDeliberationProposal: (sessionId, proposal) => {
    const session = get().studySessions[sessionId]
    if (!session?.deliberation) return
    updateSessionById(get, set, sessionId, {
      deliberation: { ...session.deliberation, proposal },
    })
  },

  setDeliberationUserChoice: (sessionId, choice) => {
    const session = get().studySessions[sessionId]
    if (!session?.deliberation) return
    updateSessionById(get, set, sessionId, {
      deliberation: { ...session.deliberation, userChoice: choice },
    })
  },

  setDeliberationStrategy: (sessionId, strategy) => {
    const session = get().studySessions[sessionId]
    if (!session?.deliberation) return
    updateSessionById(get, set, sessionId, {
      deliberation: { ...session.deliberation, strategy },
    })
  },

  setDeliberationError: (sessionId, error) => {
    const session = get().studySessions[sessionId]
    if (!session?.deliberation) return
    updateSessionById(get, set, sessionId, {
      deliberation: { ...session.deliberation, phase: 'idle' as const, error },
    })
  },

  clearDeliberation: (sessionId) => {
    updateSessionById(get, set, sessionId, {
      deliberation: null,
    })
  },
})
