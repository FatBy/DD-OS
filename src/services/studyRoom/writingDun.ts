/**
 * writingDun.ts — 自习室"写作 Dun ReAct"服务 (入口层)
 *
 * 职责: 把 s6 的 runStudyReAct 包装成调用方友好的入口, 同时提供
 *   - listAvailableDuns / loadDun: DunPickerDialog 用的列表 + 加载 API
 *   - LoadedDun / DunListItem: 被 WritingDunPanel / studyRoomSlice 复用的类型定义
 *
 * 架构 (和用户确认过, 见 note):
 * - 上一版的"流式代笔" (generateDraftWithDun) 已被 runStudyReActWriting 完全替代.
 *   Dun 不再被当作 prompt 的流式打字机, 而是一个会调工具 / 会探查 / 会反思的 ReAct Agent.
 * - system prompt 的构建 (角色 + SOP + 目标 + 文风指纹 + ReAct 协议) 已经下沉到
 *   studyReActLoop.buildStudyReActSystemPrompt, 不再需要 writingDun 层单独维护.
 * - 草稿写入 / 版本保存 / 对话栏渲染等副作用, 全部由调用方通过 callbacks 注入 ——
 *   这一层是**纯入口转接层**, 不持有任何业务状态.
 */

import { getServerUrl } from '@/utils/env'
import { runStudyReAct, type RunStudyReActParams, type RunStudyReActResult } from '@/services/studyRoom/studyReActLoop'

// ============================================
// 类型
// ============================================

/**
 * 列表态的轻量 Dun 信息 (用于 DunPickerDialog 选择)
 *
 * 注: 后端 GET /duns 一次性把 sopContent 全量返回了, 所以 loadedDun 和 list item
 * 其实是同构的, 但前端保留区分以便将来裁剪列表字段 (如大项目下万条 dun 时)
 */
export interface DunListItem {
  id: string
  name: string
  label?: string
  description?: string
  archetype?: string
  tags?: string[]
  xp?: number
  /** 头像/配色等视觉元数据 (非写作用, 仅列表展示) */
  visualDNA?: Record<string, unknown>
}

/**
 * 加载到自习室的完整 Dun (扮演"作者")
 *
 * 关键字段:
 * - sopContent: DUN.md body, 包含人设/方法论/产出风格等, 写作时作为 system prompt 的一部分
 * - objective / strategy: 目标函数 (如果配置了), 让 Dun 知道"为什么写"
 */
export interface LoadedDun {
  id: string
  name: string
  description: string
  archetype: string
  sopContent: string
  tags: string[]
  objective?: string
  strategy?: string
  visualDNA?: Record<string, unknown>
}

/**
 * runStudyReActWriting 的入参 — 就是 RunStudyReActParams 的直接别名.
 *
 * 单独起别名的原因: 调用方 (StudyRoomWorkspace / WritingDunPanel) 在语义上关心的是
 * "启动一次写作 Dun 的 ReAct 会话", 而 "RunStudyReActParams" 是实现侧命名 ——
 * 别名能在 import 时更好自文档化.
 */
export type RunStudyReActWritingParams = RunStudyReActParams

/** runStudyReActWriting 的返回值 — 同上, 直接别名 RunStudyReActResult */
export type RunStudyReActWritingResult = RunStudyReActResult

// ============================================
// 列表 / 加载
// ============================================

/**
 * 拉取所有可用的 Dun (从 DunCrew-Data/duns/ 扫描)
 *
 * 返回的列表按"有描述的在前"粗排 — 空壳 / 自愈 Dun 放后面, 避免用户第一眼看到影子目录.
 */
export async function listAvailableDuns(): Promise<DunListItem[]> {
  const serverUrl = getServerUrl()
  const res = await fetch(`${serverUrl}/duns`)
  if (!res.ok) {
    throw new Error(`加载 Dun 列表失败: HTTP ${res.status}`)
  }
  const raw = (await res.json()) as Array<Record<string, unknown>>

  const items: DunListItem[] = raw.map((d) => ({
    id: String(d.id || ''),
    name: String(d.name || d.label || d.id || ''),
    label: typeof d.label === 'string' ? d.label : undefined,
    description: typeof d.description === 'string' ? d.description : '',
    archetype: typeof d.archetype === 'string' ? d.archetype : 'REACTOR',
    tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
    xp: typeof d.xp === 'number' ? d.xp : 0,
    visualDNA: (d.visualDNA as Record<string, unknown>) || undefined,
  }))

  // 有 description 的排前面 (空壳 / 自愈 Dun 放后面)
  items.sort((a, b) => {
    const aHas = (a.description || '').trim().length > 0 ? 1 : 0
    const bHas = (b.description || '').trim().length > 0 ? 1 : 0
    return bHas - aHas
  })

  return items
}

/**
 * 把列表态 DunListItem 提升为可用于写作的 LoadedDun
 *
 * 实现: GET /duns 已经返回了 sopContent 全量, 所以直接从列表里按 id 找到并补齐字段即可,
 * 不需要再请求 /duns/{id} 详情 (省一次 roundtrip, 也避开了详情接口对 id 和 frontmatter name
 * 两种 key 的语义差异).
 */
export async function loadDun(dunId: string): Promise<LoadedDun> {
  const serverUrl = getServerUrl()
  const res = await fetch(`${serverUrl}/duns`)
  if (!res.ok) {
    throw new Error(`加载 Dun 详情失败: HTTP ${res.status}`)
  }
  const raw = (await res.json()) as Array<Record<string, unknown>>
  const found = raw.find((d) => String(d.id) === dunId)
  if (!found) {
    throw new Error(`未找到 Dun: ${dunId}`)
  }

  return {
    id: String(found.id || ''),
    name: String(found.name || found.label || found.id || ''),
    description: typeof found.description === 'string' ? found.description : '',
    archetype: typeof found.archetype === 'string' ? found.archetype : 'REACTOR',
    sopContent: typeof found.sopContent === 'string' ? found.sopContent : '',
    tags: Array.isArray(found.tags) ? (found.tags as string[]) : [],
    objective: typeof found.objective === 'string' ? found.objective : undefined,
    strategy: typeof found.strategy === 'string' ? found.strategy : undefined,
    visualDNA: (found.visualDNA as Record<string, unknown>) || undefined,
  }
}

// ============================================
// ReAct 主入口
// ============================================

/**
 * 启动一次"写作 Dun"的 ReAct 会话.
 *
 * 和上一版 generateDraftWithDun 的差异:
 * - 上一版是"流式代笔": LLM 一边说一边把 token 推进草稿框, 中间不做任何探查 / 验证.
 * - 这一版是"ReAct 循环": Dun 可以调工具 (read_draft / read_fingerprint / searchMemory /
 *   readFile / webSearch / webFetch), 思考后再通过 write_draft 工具交稿.
 *
 * 职责边界:
 * - 此函数本身**不**直接写 session.document, **不**直接 saveVersion, **不**渲染对话栏 ——
 *   所有副作用都通过 params.callbacks 回调暴露, 由调用方 (StudyRoomWorkspace /
 *   WritingDunPanel) 桥接到 store / UI.
 * - 具体循环逻辑 (20 轮上限 / 工具分发 / Critic / 经验回写) 全部在
 *   studyReActLoop.runStudyReAct 实现, 本函数只是**语义更贴近自习室业务**的对外别名.
 *
 * 调用方约定 (callbacks.onDraftWrite 的实现):
 *   当 Dun 调用 write_draft 工具时, 调用方必须:
 *     1. saveVersion(旧 document, trigger='full_writing')  // 把被替换的版本存成历史
 *     2. updateDocument(新 draft)                          // 把 session.document 切到新版本
 *   这两步由调用方完成而不是本函数 —— 因为版本系统和 store 是业务层关注点, 服务层不感知.
 */
export async function runStudyReActWriting(
  params: RunStudyReActWritingParams,
): Promise<RunStudyReActWritingResult> {
  return runStudyReAct(params)
}
