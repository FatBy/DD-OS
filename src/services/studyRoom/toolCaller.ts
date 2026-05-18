/**
 * toolCaller — 自习室工具调用层
 *
 * 设计原则:
 * - 自习室是"纯文本写作", 但仍然需要少量工具增强能力
 * - 只暴露 4 个轻量工具, 全部基于本地后端已有端点, 不引入新风险
 * - 工具执行全部是"只读 + 追加写记忆", 不涉及文件系统破坏性操作
 *
 * 工具清单:
 * 1. search_wiki       — 根据关键词查知识库实体 (已有 /api/wiki/search)
 * 2. search_memory     — 查长期记忆 (已有 /api/memory/search)
 * 3. read_entity       — 读取单个知识库实体全文 (已有 /api/wiki/entities/:id)
 * 4. append_to_memory  — 追加一条笔记到长期记忆 (需后端支持, 失败降级为本地 console)
 */

import type { EvidenceItem, MemorySnippet, ProfileSuggestion } from '@/types'
import { recallMemory } from './memoryService'
import { lensLibrary } from './lenses/library'
import { classifyMemoryContent } from './writerProfile'

const API_BASE = 'http://localhost:3001'

// ============================================
// OpenAI Function Calling 工具定义
// ============================================

export interface StudyRoomTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description: string; enum?: string[] }>
      required?: string[]
    }
  }
}

export const STUDY_ROOM_TOOLS: StudyRoomTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_wiki',
      description:
        '在本地知识库中搜索相关实体 (人物/组织/概念/事件). ' +
        '当你发现现有证据池中缺少某个关键主题的资料, 或用户提到的新话题未覆盖时使用. ' +
        '返回最多 8 条实体摘要.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词或短语 (2-15 字), 不要是长句',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description:
        '在长期记忆中检索相关笔记、过往对话摘要、执行经验. ' +
        '当用户说"我之前说过..."或你需要了解用户偏好、以往观点时使用.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '检索关键词, 描述你想回忆的主题',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_entity',
      description:
        '根据 entityId 读取单个知识库实体的完整内容 (TL;DR + claims + 引用). ' +
        '仅当 search_wiki 找到感兴趣实体后使用, 不要瞎猜 ID.',
      parameters: {
        type: 'object',
        properties: {
          entityId: {
            type: 'string',
            description: '实体 ID, 形如 "ent-xxx" 或 L 类 evidence 的 ref.entityId',
          },
        },
        required: ['entityId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append_to_memory',
      description:
        '把一条值得长期保留的结论、用户风格偏好或重要事实追加到记忆库. ' +
        '系统会自动判断: 若内容涉及 "风格/口吻/结构/词汇/引用/话题偏好", 会存入自习室独立的"写作风格档案"(下次写作自动注入); ' +
        '若是事实类 (如 "用户在做 X 课题"), 会存入全局长期记忆. ' +
        '仅在写作中产生了新的、明确的结论时使用, 不要重复写入.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: '要写入的记忆内容 (1-2 句话, 中文)',
          },
          tags: {
            type: 'string',
            description: '逗号分隔的标签 (可选), 如 "写作,偏好"',
          },
        },
        required: ['content'],
      },
    },
  },
]

// ============================================
// 工具执行器
// ============================================

export interface ToolCallRequest {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolCallResult {
  toolCallId: string
  name: string
  ok: boolean
  /** 给 LLM 看的结果 (字符串化) */
  content: string
  /** 如果产出了新证据, 给前端合并到 evidencePool */
  evidenceDelta?: EvidenceItem[]
  /** 如果产出了记忆片段, 给前端合并展示 */
  memoryDelta?: MemorySnippet[]
  /**
   * 如果 LLM 通过 append_to_memory 想往"写作风格档案"里加条目,
   * 不再直接落库, 而是产出一条待确认建议, 交给 UI 渲染确认卡片.
   * 只有用户在卡片上点"接受"时才真正写入 writerProfile.
   */
  profileSuggestions?: ProfileSuggestion[]
  error?: string
}

/**
 * 执行单个工具调用
 */
export async function executeStudyTool(
  call: ToolCallRequest,
  ctx: { dunId?: string | null; signal?: AbortSignal },
): Promise<ToolCallResult> {
  const base = { toolCallId: call.id, name: call.name }

  try {
    switch (call.name) {
      case 'search_wiki': {
        const query = String(call.arguments.query || '').trim()
        if (!query) return { ...base, ok: false, content: 'query is empty', error: 'empty_query' }

        const items = await lensLibrary(query, 8, ctx.dunId)
        const summary = items.length === 0
          ? '(未找到相关实体)'
          : items.map((it, i) => `${i + 1}. ${it.title}: ${it.snippet.slice(0, 120)}`).join('\n')

        return {
          ...base,
          ok: true,
          content: `search_wiki("${query}") -> ${items.length} hits:\n${summary}`,
          evidenceDelta: items,
        }
      }

      case 'search_memory': {
        const query = String(call.arguments.query || '').trim()
        if (!query) return { ...base, ok: false, content: 'query is empty', error: 'empty_query' }

        const snippets = await recallMemory(query, 8, ctx.signal)
        const summary = snippets.length === 0
          ? '(没有匹配的记忆)'
          : snippets.map((s, i) => `${i + 1}. [${s.source}] ${s.content.slice(0, 120)}`).join('\n')

        return {
          ...base,
          ok: true,
          content: `search_memory("${query}") -> ${snippets.length} hits:\n${summary}`,
          memoryDelta: snippets,
        }
      }

      case 'read_entity': {
        const entityId = String(call.arguments.entityId || '').trim()
        if (!entityId) return { ...base, ok: false, content: 'entityId is empty', error: 'empty_id' }

        try {
          const res = await fetch(`${API_BASE}/api/wiki/entities/${encodeURIComponent(entityId)}`, {
            signal: ctx.signal,
          })
          if (!res.ok) {
            return { ...base, ok: false, content: `read_entity: HTTP ${res.status}`, error: 'fetch_failed' }
          }
          const data = await res.json()
          const title: string = data.title || entityId
          const tldr: string = (data.tldr || '').slice(0, 400)
          const claims: string[] = Array.isArray(data.claims)
            ? data.claims.slice(0, 5).map((c: { content?: string }) => `- ${c.content || ''}`)
            : []
          const text = [`# ${title}`, tldr, ...claims].filter(Boolean).join('\n')
          return { ...base, ok: true, content: text.slice(0, 1200) }
        } catch (err) {
          return {
            ...base,
            ok: false,
            content: `read_entity failed: ${(err as Error).message}`,
            error: 'network',
          }
        }
      }

      case 'append_to_memory': {
        const content = String(call.arguments.content || '').trim()
        const tags = String(call.arguments.tags || '').trim()
        if (!content) return { ...base, ok: false, content: 'content is empty', error: 'empty_content' }

        // ---- 分流: 风格偏好 → 产出"待确认建议"(不直接落库); 事实类 → 全局记忆 ----
        // 设计变更 (Phase 5): 此前 profile 类会直接写 localStorage, 用户无感知.
        // 现在改为把要写的内容变成 ProfileSuggestion 回吐给 UI, 由用户点"接受"按钮后再入库.
        const verdict = classifyMemoryContent(content)

        if (verdict.kind === 'profile') {
          const suggestion: ProfileSuggestion = {
            id: `ps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            kind: verdict.isAvoid ? 'avoid' : 'preference',
            content,
            category: verdict.isAvoid ? undefined : (verdict.category || 'style'),
            reason: tags ? `来自标签: ${tags}` : undefined,
            status: 'pending',
          }
          const label = suggestion.kind === 'avoid' ? '避免清单' : '偏好清单'
          return {
            ...base,
            ok: true,
            // 给 LLM 的反馈: 不要误以为已经落库, 以免 LLM 再次尝试写相同内容
            content: `append_to_memory: 已生成一条"${label}"建议 (${content.slice(0, 40)}), 待用户确认后才会入库; 不要重复提交相同建议.`,
            profileSuggestions: [suggestion],
          }
        }

        // 事实类: 写入全局记忆 (复用 DunCrew L0/L1)
        try {
          const res = await fetch(`${API_BASE}/api/memory/append`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content,
              tags: tags ? tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [],
              source: 'study_room',
            }),
            signal: ctx.signal,
          })
          if (!res.ok) {
            console.info('[toolCaller] append_to_memory (fallback, local only):', content)
            return {
              ...base,
              ok: true,
              content: `append_to_memory: (后端未支持, 已仅在会话内保留)`,
            }
          }
          return { ...base, ok: true, content: `append_to_memory: 已写入全局记忆` }
        } catch {
          console.info('[toolCaller] append_to_memory (fallback, local only):', content)
          return {
            ...base,
            ok: true,
            content: `append_to_memory: (后端不可达, 已仅在会话内保留)`,
          }
        }
      }

      default:
        return {
          ...base,
          ok: false,
          content: `unknown tool: ${call.name}`,
          error: 'unknown_tool',
        }
    }
  } catch (err) {
    return {
      ...base,
      ok: false,
      content: `tool error: ${(err as Error).message}`,
      error: 'exception',
    }
  }
}

/**
 * 生成"工具使用指南"段落, 注入到 system prompt
 */
export function buildToolGuidelines(): string {
  return [
    '## 可用工具',
    '在开始写作前, 你可以(但非必须)调用下列工具来补全上下文:',
    '- **search_wiki(query)**: 知识库实体搜索, 当现有证据不足以支撑某个论点时用',
    '- **search_memory(query)**: 长期记忆检索, 当用户提到"之前""上次"时用',
    '- **read_entity(entityId)**: 读取单个实体全文, 仅在 search_wiki 有命中后使用',
    '- **append_to_memory(content, tags?)**: 把新结论持久化, 谨慎使用, 每次最多 1 次',
    '',
    '工具调用原则:',
    '1. 能不调就不调. 如果现有证据池已经足够回答用户问题, 直接写作, 不要调用.',
    '2. 一次最多调用 3 个工具, 避免陷入搜索循环.',
    '3. 调完工具后基于新信息直接输出最终文章 (不要再追问).',
    '4. 如果用户只是让你修改措辞、调整语气等不涉及新事实的任务, 禁止调用任何工具.',
  ].join('\n')
}
