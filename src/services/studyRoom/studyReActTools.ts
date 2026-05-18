/**
 * studyReActTools.ts — 自习室 Dun 专属 ReAct 工具集
 *
 * 设计原则 (与用户确认过):
 * - Q1=a (write_draft 只有 replace 模式, 每次整篇重写)
 * - Q2=a+b+c (内部小工具 + 联网 + 只读本地, 但不能 writeFile/appendFile/runCmd)
 * - 草稿状态留在前端 session 内存, 不污染本地磁盘
 * - 文风指纹作为系统硬约束, Dun 能读不能改
 *
 * 工具分两层:
 * 1. 前端专属工具 (内部执行, 不走后端):
 *    - read_draft / write_draft / read_fingerprint / ask_user
 * 2. 后端复用工具 (委托给 localClawService.executeTool):
 *    - readFile / searchMemory / searchWiki / webSearch / webFetch
 *
 * 和主 ReAct 引擎 (LocalClawService.runReActLoopFC) 的差异:
 * - 写作场景 20 轮上限 (vs 全局 100)
 * - 工具集是"写作专用小集"而非全量
 * - 不触发 writeFile/runCmd/appendFile 等修改类工具 (Critic 用不上)
 * - 但保留经验回写 (consolidatePostExecution), Dun 会越写越懂用户
 */

import type { ToolInfo, WriterFingerprint } from '@/types'
// localClawService 按需动态加载，避免启动时拉入整个依赖图
import { formatFingerprint } from '@/services/studyRoom/prompts'

// ============================================
// 类型: 工具执行上下文 & 结果
// ============================================

/**
 * 工具执行时的上下文 — 前端工具需要读取/写入 session 状态时通过此桥接,
 * 不直接 import store 避免循环依赖 (和 ConsolidatorStoreActions 同样的设计)
 */
export interface StudyReActToolContext {
  /** 当前 session id (经验回写 & 日志用) */
  sessionId: string
  /** 读当前草稿正文 — read_draft 工具调用 */
  getDraft: () => string
  /**
   * 写草稿 — write_draft 工具调用.
   * 调用方必须先 saveVersion(旧草稿), 再 updateDocument(新草稿) — 这两步由调用方在 onDraftWrite
   * 回调里完成, 而不是工具执行器自己做 (让工具执行纯一点, 副作用集中在循环外)
   */
  onDraftWrite: (newDraft: string) => void | Promise<void>
  /** 读当前文风指纹 — read_fingerprint 工具调用 */
  getFingerprint: () => WriterFingerprint | null
  /**
   * 向用户提问 — ask_user 工具调用.
   * 实现方式由循环层决定: 可以是"插入一条带输入框的 assistant 气泡, 挂起循环等用户回答",
   * 也可以是"降级为 LLM 自主判断" (当前版本选后者, 不阻塞循环)
   */
  onAskUser?: (question: string) => Promise<string>
  /** 中止信号 — 传递给后端工具执行 */
  signal?: AbortSignal
}

/** 工具执行结果 — 统一格式, 方便循环层拼装 tool role 消息 */
export interface StudyToolResult {
  status: 'success' | 'error'
  /** 对 LLM 可见的文本 (会拼到 messages 的 role='tool' 里) */
  result: string
  /** 对 UI 可见的简短摘要 (用于 thinking 气泡里展示) */
  uiSummary?: string
}

// ============================================
// Tool Info 定义 — 给 LLM 看的 schema
// ============================================

/**
 * 自习室 Dun 可用的工具清单.
 * 通过 convertToolInfoToFunctions() 转成 OpenAI tools 参数喂给 streamChat.
 *
 * 命名约定:
 * - 前端专属工具用 snake_case (read_draft / write_draft / read_fingerprint / ask_user) —
 *   和后端 camelCase 工具区分开, 方便 LLM 按命名推断这是"自习室本地操作"
 * - 后端工具保持原有 camelCase (readFile / searchMemory / ...) — 名字要和后端 registry 对上
 */
export const STUDY_REACT_TOOLS: ToolInfo[] = [
  // ============================================
  // 第一类: 前端专属工具 (self-hosted)
  // ============================================
  {
    name: 'read_draft',
    type: 'builtin',
    description: '读取当前草稿全文. 动手改之前, 先读一下看看现在是什么状态. 无参数.',
    inputs: {},
  },
  {
    name: 'write_draft',
    type: 'builtin',
    description:
      '把整篇文章完全替换为新版本 (replace 模式). 旧草稿会自动存入历史版本, 不会丢. ' +
      '只有这一个工具能改动草稿, 调用它就代表"定稿本轮产出". 调用后循环通常应该结束 (除非用户要求多次迭代).',
    inputs: {
      content: {
        type: 'string',
        description: '完整的新草稿 (Markdown 正文, 不要包在代码块里, 不要前置客套话, 不要末尾问还要不要改)',
        required: true,
      },
    },
  },
  {
    name: 'read_fingerprint',
    type: 'builtin',
    description:
      '读取当前 session 的文风指纹详情. 指纹是从用户范文里提炼的"怎么写"约束 (句长/修辞/人称/情感温度...), ' +
      '它比你人设里的风格描述优先级更高. 动笔前和检查时都可以读一次. 无参数.',
    inputs: {},
  },
  {
    name: 'ask_user',
    type: 'builtin',
    description:
      '当你对核心写作方向有重大分歧 (而不是小决策) 时, 可以尝试向用户提问. ' +
      '**重要**: 当前自习室未必能阻塞等待用户回答 — ' +
      '如果可以, 工具会返回用户的真实回答; ' +
      '如果不行, 工具会返回一段"请自主决策"的提示, 你需要按自己对用户意图的最佳理解继续, 不要再次调用 ask_user. ' +
      '**慎用** — 用户在自习室是想让你动笔, 不是想被反复问. ' +
      '适用场景: 主题完全不明确 / 风格方向矛盾 / 用户给的素材自相冲突.',
    inputs: {
      question: {
        type: 'string',
        description: '要问用户的问题 (一句话, 不要堆多个问题)',
        required: true,
      },
    },
  },

  // ============================================
  // 第二类: 后端复用工具 (只读/联网, 不碰文件系统写入)
  // ============================================
  {
    name: 'readFile',
    type: 'builtin',
    description:
      '只读本地文件. 用于读取用户在图书馆里的文档 / 素材做参考. ' +
      '**严禁用于写文件** — 自习室里你没有 writeFile 权限, 所有写入都通过 write_draft 进草稿.',
    inputs: {
      path: {
        type: 'string',
        description: '文件路径 (相对 DunCrew-Data 或绝对路径)',
        required: true,
      },
    },
  },
  {
    name: 'searchMemory',
    type: 'builtin',
    description:
      '搜索记忆库. 可以找到用户之前的偏好 / 写作习惯 / 你自己在之前任务里沉淀的经验. ' +
      '写一篇类似题材的新稿前, 强烈建议先搜一下 "之前关于 XX 题材写过什么" 或 "用户关于 XX 的偏好".',
    inputs: {
      query: {
        type: 'string',
        description: '搜索关键词 (中英文均可)',
        required: true,
      },
    },
  },
  {
    name: 'searchWiki',
    type: 'builtin',
    description:
      '搜索 Dun 自己的知识库 (DunCrew-Data 下的 wiki 实体索引). ' +
      '用于调取你作为 Dun 之前积累的领域知识、断言、关系图. 不同于 searchMemory (那个是对话/任务流水).',
    inputs: {
      query: {
        type: 'string',
        description: '搜索关键词',
        required: true,
      },
    },
  },
  {
    name: 'webSearch',
    type: 'builtin',
    description:
      '联网搜索. 当你需要核实时效信息 (时事 / 新数据 / 新政策 / 新产品) 时使用. ' +
      '**不要滥用** — 如果用户给的素材已经够写, 不需要联网.',
    inputs: {
      query: {
        type: 'string',
        description: '搜索关键词',
        required: true,
      },
    },
  },
  {
    name: 'webFetch',
    type: 'builtin',
    description:
      '抓取某个 URL 的正文. 通常在 webSearch 之后, 选中某个结果链接深读. ' +
      '单次抓取会被截断到 ~2000 字符, 只适合提取主要观点, 不适合整篇原文复刻.',
    inputs: {
      url: {
        type: 'string',
        description: '目标网址 (http/https)',
        required: true,
      },
    },
  },
]

/** 后端工具名白名单 — 执行器用来判断是否委托给 localClawService */
const BACKEND_TOOL_NAMES = new Set<string>([
  'readFile',
  'searchMemory',
  'searchWiki',
  'webSearch',
  'webFetch',
])

/** 前端专属工具名白名单 */
const FRONTEND_TOOL_NAMES = new Set<string>([
  'read_draft',
  'write_draft',
  'read_fingerprint',
  'ask_user',
])

// ============================================
// 工具执行器
// ============================================

/**
 * 执行一个工具调用.
 *
 * 分发逻辑:
 * - 前端专属工具 (read_draft / write_draft / ...) -> 内部直接执行, 操作 ctx
 * - 后端工具 (readFile / searchMemory / ...) -> 委托 localClawService.executeTool (走后端 /api/tools/execute)
 * - 未知工具 -> 返回 error (LLM 会在下一轮反思并换一个)
 *
 * 返回的 StudyToolResult.result 字段会原样拼进 messages 的 role='tool' 消息里,
 * 所以要尽量人类可读 (给 LLM 看) + 关键信息清晰 (让 Dun 能做下一步决策).
 */
export async function executeStudyTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: StudyReActToolContext,
): Promise<StudyToolResult> {
  // ========== 前端专属工具 ==========
  if (FRONTEND_TOOL_NAMES.has(toolName)) {
    try {
      return await executeFrontendTool(toolName, args, ctx)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        status: 'error',
        result: `工具 ${toolName} 执行失败: ${message}`,
        uiSummary: `${toolName} 失败`,
      }
    }
  }

  // ========== 后端复用工具 ==========
  if (BACKEND_TOOL_NAMES.has(toolName)) {
    try {
      const { localClawService } = await import('@/services/LocalClawService')
      const backendResult = await localClawService.executeTool(
        { name: toolName, args },
        0,
        ctx.signal,
      )
      return {
        status: backendResult.status === 'error' ? 'error' : 'success',
        result: backendResult.result,
        uiSummary: describeBackendToolCall(toolName, args, backendResult.status === 'success'),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        status: 'error',
        result: `后端工具 ${toolName} 调用失败: ${message}`,
        uiSummary: `${toolName} 失败`,
      }
    }
  }

  // ========== 未注册工具 ==========
  return {
    status: 'error',
    result:
      `工具 ${toolName} 不在自习室可用工具清单里. 可用工具: ${Array.from(
        new Set([...FRONTEND_TOOL_NAMES, ...BACKEND_TOOL_NAMES]),
      ).join(', ')}. 请改用允许的工具.`,
    uiSummary: `未知工具 ${toolName}`,
  }
}

// ============================================
// 前端专属工具的具体实现
// ============================================

async function executeFrontendTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: StudyReActToolContext,
): Promise<StudyToolResult> {
  switch (toolName) {
    case 'read_draft': {
      const draft = ctx.getDraft()
      if (!draft.trim()) {
        return {
          status: 'success',
          result: '(当前草稿为空, 还没写过. 这是一次从零起草.)',
          uiSummary: '读草稿: 空白',
        }
      }
      return {
        status: 'success',
        result: `当前草稿 (${countWords(draft)} 字):\n\n${draft}`,
        uiSummary: `读草稿: ${countWords(draft)} 字`,
      }
    }

    case 'write_draft': {
      const content = typeof args.content === 'string' ? args.content : ''
      if (!content.trim()) {
        return {
          status: 'error',
          result: 'write_draft 的 content 不能为空. 要定稿请提供完整正文.',
          uiSummary: 'write_draft: 内容为空',
        }
      }
      // 触发外部回调 — 调用方会在里头做 saveVersion(旧) + updateDocument(新) 两步
      await ctx.onDraftWrite(content)
      return {
        status: 'success',
        result: `草稿已更新 (${countWords(content)} 字, 旧版自动存为历史). 如果本轮任务已完成, 就在接下来的回复里告知用户即可, 不需要再调其他工具.`,
        uiSummary: `定稿: ${countWords(content)} 字`,
      }
    }

    case 'read_fingerprint': {
      const fp = ctx.getFingerprint()
      if (!fp) {
        return {
          status: 'success',
          result:
            '当前 session 没有启用文风指纹. 你可以按自己人设的风格写, 但用户可能之后会从文档提炼指纹来校准.',
          uiSummary: '读指纹: 无',
        }
      }
      const formatted = formatFingerprint(fp) || '(指纹存在但内容为空)'
      return {
        status: 'success',
        result: formatted,
        uiSummary: `读指纹: ${Array.isArray(fp.samples) ? fp.samples.length : 0} 段范文`,
      }
    }

    case 'ask_user': {
      const question = typeof args.question === 'string' ? args.question.trim() : ''
      if (!question) {
        return {
          status: 'error',
          result: 'ask_user 的 question 不能为空.',
          uiSummary: 'ask_user: 问题为空',
        }
      }
      if (!ctx.onAskUser) {
        // 当前版本不阻塞循环, 降级为"告诉 LLM 自主决策"
        return {
          status: 'success',
          result:
            `(自习室当前不支持同步向用户提问, 请你自行做判断. ` +
            `你想问的是: "${question}". 请按你对用户最可能期望的理解自主决策, 或在最终回复里把这个分歧点向用户说明并给出默认方案.)`,
          uiSummary: `ask_user (降级): ${question.slice(0, 20)}`,
        }
      }
      try {
        const answer = await ctx.onAskUser(question)
        return {
          status: 'success',
          result: `用户回答: ${answer}`,
          uiSummary: `ask_user 已得到答复`,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          status: 'error',
          result: `ask_user 失败: ${message}. 请自主决策, 不要再次调用 ask_user.`,
          uiSummary: 'ask_user: 失败',
        }
      }
    }

    default:
      return {
        status: 'error',
        result: `未实现的前端工具: ${toolName}`,
        uiSummary: `未知前端工具 ${toolName}`,
      }
  }
}

// ============================================
// 工具函数
// ============================================

function countWords(text: string): number {
  // 中文按字数计, 英文按词数粗估 (空格分隔), 两者相加作为可读 "字数"
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const en = text
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  return cjk + en
}

/** 构造后端工具调用的 UI 摘要 — 让 thinking 气泡能显示关键参数 */
function describeBackendToolCall(
  toolName: string,
  args: Record<string, unknown>,
  success: boolean,
): string {
  const tag = success ? '' : ' (失败)'
  switch (toolName) {
    case 'readFile':
      return `读文件: ${String(args.path || '?')}${tag}`
    case 'searchMemory':
      return `搜记忆: ${String(args.query || '?').slice(0, 30)}${tag}`
    case 'searchWiki':
      return `搜 Wiki: ${String(args.query || '?').slice(0, 30)}${tag}`
    case 'webSearch':
      return `联网搜: ${String(args.query || '?').slice(0, 30)}${tag}`
    case 'webFetch':
      return `抓网页: ${String(args.url || '?').slice(0, 40)}${tag}`
    default:
      return `${toolName}${tag}`
  }
}
