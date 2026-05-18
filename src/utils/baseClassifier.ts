/**
 * Base Type Classifier (E/P/V/X) for ExecTraceToolCall
 *
 * Classifies each tool call into one of four "base" types:
 *   E (Execute) - Agent knows what to do and has the info needed
 *   P (Plan)    - Agent knows context but needs to figure out how (LLM-assigned only)
 *   V (Verify)  - Agent is checking the result of a previous action
 *   X (Explore) - Agent is exploring unknown territory
 *
 * V10 Instrument 优先：
 *   确定性事件/规则覆盖 80%+ 的碱基判定，ML 只处理尾部模糊 case。
 *   分类流程分为两层：
 *     Layer 1 — 确定性规则层 (fast path)：显式事件 + 确定性模式匹配
 *     Layer 2 — 原有逻辑层 (fallback)：上下文 + 名称推断
 *
 * SYNC: 此分类器逻辑必须与 openclaw-extension/src/gene-pool.ts 保持同步
 */

// ============================================
// V10: 事件接口类型
// ============================================

/** P 碱基显式事件（由 LLM 或系统显式发出） */
export interface PlanEvent {
  eventType: 'planning'
  base: 'P'
  source: 'explicit_meta'
  summary: string
  scope: 'local' | 'global'
  confidence: 1.0
  triggerContext: 'task_start' | 'mid_execution' | 'after_failure' | 'user_request'
}

/** V 碱基显式事件（验证操作的显式声明） */
export interface VerificationEvent {
  eventType: 'verification'
  base: 'V'
  source: 'explicit_meta'
  target: string
  method: string
  referencesArtifact: string  // 验证的具体文件路径
}

// ============================================
// V10: 增强分类结果类型
// ============================================

/** 分类来源标记 — 表明分类依据 */
export type ClassificationSource =
  | 'rule'            // 确定性规则命中
  | 'tool'           // 工具参数推断
  | 'meta'           // 显式元数据事件
  | 'human'          // 人工标注
  | 'model'          // ML 模型推断（未来）
  | 'context'        // 上下文状态推断（原有逻辑）

/** 增强分类结果 — 包含 confidence 和 source */
export interface EnhancedClassification {
  base: 'E' | 'P' | 'V' | 'X'
  confidence: number         // 0.0 - 1.0
  source: ClassificationSource
  /** 匹配的规则名称（用于审计和调试） */
  ruleName?: string
}

/** V10: 增强分类输入 — 支持显式事件和因果链 */
export interface EnhancedClassificationInput {
  /** 显式 PlanEvent（由上游注入） */
  planEvent?: PlanEvent
  /** 显式 VerificationEvent（由上游注入） */
  verificationEvent?: VerificationEvent
  /** 当前步骤引用的 artifact 路径 */
  referencesArtifact?: string
  /** 因果链：引用的上游步骤 ID 列表 */
  causedBy?: string[]
  /** 最近 10 步的历史（用于因果判定） */
  recentSteps?: RecentStep[]
}

/** 最近步骤的简化表示（用于因果判定） */
export interface RecentStep {
  id: string
  base: 'E' | 'P' | 'V' | 'X'
  toolName: string
  /** 该步骤操作的 artifact 路径 */
  referencesArtifact?: string
  order: number
}

// ============================================
// Tool categories (白名单 — 精确分类)
// ============================================

const READ_TOOLS = new Set([
  'readFile', 'listDir', 'searchText', 'searchFiles',
  'readMultipleFiles', 'search_files',
])

const EXPLORE_TOOLS = new Set([
  'webSearch', 'webFetch',
])

const WRITE_TOOLS = new Set([
  'writeFile', 'appendFile', 'deleteFile', 'renameFile',
])

/** V10: 天然探索类工具 — 独立于 shell 命令的判定 */
const INHERENT_EXPLORE_TOOLS = new Set([
  'webSearch', 'webFetch', 'listDir', 'findFile',
  'searchText', 'searchFiles', 'search_files',
])

const VERIFY_CMD_PATTERNS = [
  /tsc\b.*--noEmit/i,
  /npm\s+(test|run\s+test|run\s+lint|run\s+build)/i,
  /pytest|jest|vitest|mocha/i,
  /eslint|prettier.*--check/i,
  /cargo\s+(check|test|clippy)/i,
  /go\s+(test|vet)/i,
  /python\s+-m\s+(unittest|pytest)/i,
]

// 探索性 shell 命令 (runCmd 专用)
const EXPLORE_CMD_PATTERNS = [
  /^(ls|dir|tree|find)\b/i,
  /^(cat|head|tail|less|more)\b/i,
  /^(grep|rg|ag|ack)\b/i,
  /^git\s+(log|status|diff|show|branch)/i,
  /^(which|where|type|command\s+-v)\b/i,
  /^(echo\s+\$|env|printenv|set)\b/i,
]

// 未知工具的名称模式兜底 (优先级低于白名单和参数推断)
const EXPLORE_NAME_PATTERNS = [
  /search/i, /fetch/i, /get/i, /list/i, /read/i,
  /find/i, /query/i, /browse/i, /scan/i, /lookup/i,
  /navigate/i, /screenshot/i, /inspect/i,
]

// ============================================
// Context for stateful classification
// ============================================

export interface BaseClassifierCtx {
  /** Resources successfully accessed in this session */
  successfulResources: Set<string>
  /** Recent write operations (sliding window of 10) */
  recentWrites: Array<{ resource: string; order: number }>
  /** Previous tool call entry */
  lastEntry: { name: string; status: 'success' | 'error'; order: number } | null
  /** V10: 所有已出现过的工具名称（用于 first-occurrence X 判定） */
  seenTools: Set<string>
  /** V10: 所有已出现过的路径（用于 first-occurrence X 判定） */
  seenPaths: Set<string>
}

export function createBaseClassifierCtx(): BaseClassifierCtx {
  return {
    successfulResources: new Set(),
    recentWrites: [],
    lastEntry: null,
    seenTools: new Set(),
    seenPaths: new Set(),
  }
}

// ============================================
// Path normalization
// ============================================

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

// ============================================
// Resource extraction
// ============================================

function extractResource(
  toolName: string,
  args: Record<string, unknown>,
): string | null {
  // 文件系统路径
  const p = args.path || args.filePath || args.file || args.directory
  if (typeof p === 'string') return normalizePath(p)

  // 网络资源: URL 或搜索查询
  const url = args.url || args.href
  if (typeof url === 'string') return url
  const query = args.query || args.q || args.search_query
  if (typeof query === 'string') return `query:${query}`

  if (toolName === 'runCmd') {
    const cmd = String(args.command || args.cmd || '')
    const m = cmd.match(/(?:^|\s)((?:\.\/|\/|[a-zA-Z]:\\)[\w\-./\\]+)/)
    return m ? normalizePath(m[1]) : `cmd:${cmd.slice(0, 50)}`
  }

  return null
}

// ============================================
// Parameter shape inference (未知工具专用)
// ============================================

function inferIntentFromArgs(args: Record<string, unknown>): 'read' | 'write' | 'unknown' {
  const hasContent = !!(args.content || args.body || args.data || args.text || args.payload)
  const hasReadTarget = !!(args.url || args.href || args.query || args.q || args.search_query ||
    args.path || args.filePath || args.file || args.directory)

  if (hasContent) return 'write'
  if (hasReadTarget && !hasContent) return 'read'
  return 'unknown'
}

// ============================================
// V10: 确定性判定 — V 碱基因果判定函数
// ============================================

/**
 * 基于因果链判定当前步骤是否为 V (Verify)。
 *
 * 规则：
 * - 当前步骤引用了某个 artifact (referencesArtifact)
 * - 最近步骤中存在对同一 artifact 的写入 (base='E')
 * - 如果 causedBy 明确指向该 write → 高置信 (0.90)
 * - 仅同 path 但无显式因果 → 中置信 (0.70)
 */
export function classifyVerification(
  referencesArtifact: string | undefined,
  causedBy: string[] | undefined,
  recentSteps: RecentStep[],
): { isV: boolean; confidence: number } {
  if (!referencesArtifact) return { isV: false, confidence: 0 }

  const normalizedTarget = normalizePath(referencesArtifact)

  const samePathWrite = recentSteps.find(s =>
    s.base === 'E' &&
    s.referencesArtifact &&
    normalizePath(s.referencesArtifact) === normalizedTarget
  )
  if (!samePathWrite) return { isV: false, confidence: 0 }

  // 有 causedBy 指向该 write → 高置信
  if (causedBy?.includes(samePathWrite.id)) {
    return { isV: true, confidence: 0.90 }
  }
  // 仅同 path 但无显式因果 → 中置信（可能只是继续使用文件）
  return { isV: true, confidence: 0.70 }
}

// ============================================
// V10: 确定性规则层 (Layer 1 — Fast Path)
// ============================================

/**
 * 增强分类：确定性规则层 + 原有逻辑层。
 *
 * Priority chain (确定性规则，从高到低):
 *   1. 显式 VerificationEvent → V (confidence: 1.00)
 *   2. 显式 PlanEvent → P (confidence: 1.00)
 *   3. runCmd 包含 test/lint/tsc/eslint → V (confidence: 0.95)
 *   4. write 后同 path readFile + causedBy → V (confidence: 0.90)
 *   5. write 后同 path readFile（无 causedBy） → V (confidence: 0.70)
 *   6. webSearch/listDir/findFile 天然探索类 → X (confidence: 0.92)
 *   7. 本任务首次出现的 tool 或 path → X (confidence: 0.88)
 *   8. 写入/副作用类工具且非紧跟 V → E (confidence: 0.90)
 *   9. 原有逻辑 fallback → confidence: 0.60
 */
export function classifyBaseTypeEnhanced(
  toolName: string,
  args: Record<string, unknown>,
  _status: 'success' | 'error',
  ctx: BaseClassifierCtx,
  enhanced?: EnhancedClassificationInput,
): EnhancedClassification {
  const resource = extractResource(toolName, args)

  // ================================================
  // Layer 1: 确定性规则层 (Instrument 优先)
  // ================================================

  // Rule 1: 显式 VerificationEvent → V (最高优先)
  if (enhanced?.verificationEvent) {
    return {
      base: 'V',
      confidence: 1.0,
      source: 'meta',
      ruleName: 'explicit_verification_event',
    }
  }

  // Rule 2: 显式 PlanEvent → P (最高优先)
  if (enhanced?.planEvent) {
    return {
      base: 'P',
      confidence: 1.0,
      source: 'meta',
      ruleName: 'explicit_plan_event',
    }
  }

  // Rule 3: runCmd 包含 test/lint/tsc/eslint → V (confidence: 0.95)
  if (toolName === 'runCmd') {
    const cmd = String(args.command || args.cmd || '')
    if (VERIFY_CMD_PATTERNS.some(p => p.test(cmd))) {
      return {
        base: 'V',
        confidence: 0.95,
        source: 'rule',
        ruleName: 'verify_cmd_pattern',
      }
    }
  }

  // Rule 4 & 5: write 后同 path readFile (因果链判定)
  if (enhanced?.recentSteps && enhanced.referencesArtifact) {
    const vResult = classifyVerification(
      enhanced.referencesArtifact,
      enhanced.causedBy,
      enhanced.recentSteps,
    )
    if (vResult.isV) {
      return {
        base: 'V',
        confidence: vResult.confidence,
        source: 'rule',
        ruleName: vResult.confidence >= 0.90
          ? 'write_then_read_with_causedBy'
          : 'write_then_read_same_path',
      }
    }
  }

  // Rule 6: webSearch/listDir/findFile 天然探索类 → X (confidence: 0.92)
  if (INHERENT_EXPLORE_TOOLS.has(toolName)) {
    return {
      base: 'X',
      confidence: 0.92,
      source: 'rule',
      ruleName: 'inherent_explore_tool',
    }
  }

  // Rule 7: 本任务首次出现的 tool 或 path → X (confidence: 0.88)
  const isFirstToolOccurrence = !ctx.seenTools.has(toolName)
  const isFirstPathOccurrence = resource ? !ctx.seenPaths.has(resource) : false
  if (isFirstToolOccurrence || isFirstPathOccurrence) {
    // 排除写入工具（首次写入是 E 不是 X）
    if (!WRITE_TOOLS.has(toolName) && toolName !== 'runCmd') {
      return {
        base: 'X',
        confidence: 0.88,
        source: 'rule',
        ruleName: 'first_occurrence_tool_or_path',
      }
    }
    // runCmd 首次出现但不是 verify 命令 — 检查是否是探索命令
    if (toolName === 'runCmd') {
      const cmd = String(args.command || args.cmd || '').trim()
      if (EXPLORE_CMD_PATTERNS.some(p => p.test(cmd))) {
        return {
          base: 'X',
          confidence: 0.88,
          source: 'rule',
          ruleName: 'first_occurrence_explore_cmd',
        }
      }
    }
  }

  // Rule 8: 写入/副作用类工具且非紧跟 V 验证 → E (confidence: 0.90)
  if (WRITE_TOOLS.has(toolName)) {
    return {
      base: 'E',
      confidence: 0.90,
      source: 'rule',
      ruleName: 'write_tool_execute',
    }
  }

  // ================================================
  // Layer 2: 原有逻辑层 (Fallback)
  // ================================================

  const fallbackBase = classifyBaseTypeFallback(toolName, args, _status, ctx)
  return {
    base: fallbackBase,
    confidence: 0.60,
    source: 'context',
    ruleName: 'legacy_fallback',
  }
}

// ============================================
// Layer 2: 原有分类逻辑 (Fallback)
// ============================================

/**
 * 原有分类逻辑，作为确定性规则未命中时的兜底。
 * 保持原有行为不变。
 */
function classifyBaseTypeFallback(
  toolName: string,
  args: Record<string, unknown>,
  _status: 'success' | 'error',
  ctx: BaseClassifierCtx,
): 'E' | 'V' | 'X' {
  const resource = extractResource(toolName, args)
  const isKnownTool = READ_TOOLS.has(toolName) || WRITE_TOOLS.has(toolName) ||
    EXPLORE_TOOLS.has(toolName) || toolName === 'runCmd'

  // --- V (Verify) ---
  // Write-then-read same resource (path normalized)
  if (READ_TOOLS.has(toolName) && resource &&
    ctx.recentWrites.some(w => w.resource === resource)) {
    return 'V'
  }
  // Retry after failure (same tool called again immediately after error)
  if (ctx.lastEntry && ctx.lastEntry.name === toolName && ctx.lastEntry.status === 'error') {
    return 'V'
  }
  // Compile/test/lint after write
  if (toolName === 'runCmd') {
    const cmd = String(args.command || args.cmd || '')
    if (VERIFY_CMD_PATTERNS.some(p => p.test(cmd)) && ctx.recentWrites.length > 0) {
      return 'V'
    }
  }

  // --- X (Explore) ---
  // Read operation on a resource never successfully accessed
  if (READ_TOOLS.has(toolName) && resource && !ctx.successfulResources.has(resource)) {
    return 'X'
  }
  // Web search/fetch — always exploring new information
  if (EXPLORE_TOOLS.has(toolName)) {
    return 'X'
  }
  // listDir on never-accessed directory
  if (toolName === 'listDir' && resource && !ctx.successfulResources.has(resource)) {
    return 'X'
  }
  // listDir early in session (fallback for no-path listDir)
  if (toolName === 'listDir' && !resource && (ctx.lastEntry === null || ctx.lastEntry.order <= 3)) {
    return 'X'
  }
  // Exploratory shell commands (ls, grep, git status, etc.)
  if (toolName === 'runCmd') {
    const cmd = String(args.command || args.cmd || '').trim()
    if (EXPLORE_CMD_PATTERNS.some(p => p.test(cmd))) {
      return 'X'
    }
  }

  // --- Unknown tool fallback (方向 1+2) ---
  if (!isKnownTool) {
    // 优先看参数形态
    const argIntent = inferIntentFromArgs(args)
    if (argIntent === 'read') return 'X'
    // 再看工具名模式
    if (argIntent === 'unknown' && EXPLORE_NAME_PATTERNS.some(p => p.test(toolName))) {
      return 'X'
    }
  }

  // --- E (Execute) ---
  return 'E'
}

// ============================================
// 向后兼容：原有接口
// ============================================

/**
 * Classify a tool call into E/V/X based on context.
 * P must be assigned externally (by LLM metadata).
 *
 * 向后兼容接口 — 内部委托给 classifyBaseTypeEnhanced。
 * 新代码建议使用 classifyBaseTypeEnhanced 获取 confidence/source。
 *
 * Priority chain:
 *   1. V checks (highest priority — verification patterns)
 *   2. X checks (known read tools + explore tools + shell explore commands)
 *   3. Unknown tool fallback (param shape → name pattern)
 *   4. E (default)
 */
export function classifyBaseType(
  toolName: string,
  args: Record<string, unknown>,
  _status: 'success' | 'error',
  ctx: BaseClassifierCtx,
  enhanced?: EnhancedClassificationInput,
): 'E' | 'V' | 'X' {
  const result = classifyBaseTypeEnhanced(toolName, args, _status, ctx, enhanced)
  // P 碱基由 detectPBase 系统单独处理，此处如果命中 P 事件则降级为 E
  if (result.base === 'P') return 'E'
  return result.base
}

/**
 * Update classifier context after a tool call completes.
 * Must be called AFTER classifyBaseType for the same entry.
 */
export function updateBaseClassifierCtx(
  ctx: BaseClassifierCtx,
  toolName: string,
  args: Record<string, unknown>,
  status: 'success' | 'error',
  order: number,
): void {
  const resource = extractResource(toolName, args)

  if (status === 'success' && resource) {
    ctx.successfulResources.add(resource)
  }
  if (WRITE_TOOLS.has(toolName) && status === 'success' && resource) {
    ctx.recentWrites.push({ resource, order })
    if (ctx.recentWrites.length > 10) ctx.recentWrites.shift()
  }

  ctx.lastEntry = { name: toolName, status, order }

  // V10: 记录已出现的工具和路径
  ctx.seenTools.add(toolName)
  if (resource) {
    ctx.seenPaths.add(resource)
  }
}

// ============================================
// V10: P 碱基增强检测（优先级链 + confidence）
// ============================================

/** P 碱基增强检测结果 */
export interface PDetectionResult {
  detected: boolean
  source: PBaseDetectionSourceV10
  confidence: number
}

/** V10: P 碱基检测来源（扩展版） */
export type PBaseDetectionSourceV10 =
  | 'explicit_event'       // 显式 PlanEvent (confidence: 1.0)
  | 'llm_meta'            // _meta.planStep (confidence: 0.9)
  | 'reasoning_content'   // reasoning 关键词 (confidence: 0.6-0.8)
  | 'tool_inference'      // 工具参数推断 (confidence: 0.4-0.6)

/**
 * 推理链中的计划关键词模式（中英文混合）
 *
 * 检测 LLM 输出的 reasoning_content 中是否包含结构化计划信号。
 * 设计为保守匹配（精确率优先于召回率），避免将普通推理误标为 P。
 *
 * 匹配逻辑：需要关键词 + 结构化标记（如编号列表）同时出现。
 */
const PLAN_KEYWORD_PATTERNS = [
  // 中文计划关键词 + 步骤编号
  /(?:计划|方案|策略|思路|步骤)[：:]\s*\n\s*[1１一①]/,
  /(?:分步|分阶段|按顺序)[执进]行/,
  /第[一二三四1-4]步[，,：:]/,
  // 英文计划关键词 + 编号
  /(?:plan|strategy|approach)[：:]\s*\n\s*(?:1[\.\):]|step\s*1)/i,
  /(?:step-by-step|multi-step)\s+(?:plan|approach|strategy)/i,
  // 明确的目标分解
  /(?:子目标|子任务|sub[- ]?(?:objective|task|goal)s?)[：:]/i,
  /(?:拆分|拆解|分解)为?\s*(?:以下|如下|多个)/,
]

/**
 * 检测 LLM Function Calling 返回中的 _meta.planStep 标记。
 *
 * 部分 LLM 可在 Function Calling 中附带元数据，
 * 格式: { _meta: { planStep: true } } 或在 tool_call.function.arguments 中。
 *
 * @param toolCallArgs 工具调用参数（parsed JSON）
 * @returns 'llm_meta' 如果检测到标记，否则 null
 */
export function detectPlanFromMeta(
  toolCallArgs: Record<string, unknown> | undefined,
): 'llm_meta' | null {
  if (!toolCallArgs) return null

  // 直接检查 _meta.planStep
  const meta = toolCallArgs._meta
  if (meta && typeof meta === 'object' && (meta as Record<string, unknown>).planStep) {
    return 'llm_meta'
  }

  return null
}

/**
 * 检测 LLM 推理内容 (reasoning_content) 中是否包含结构化计划。
 *
 * 适用于 DeepSeek 等提供 reasoning_content 字段的模型。
 * 使用保守匹配策略：需要关键词 + 结构化格式同时出现。
 *
 * @param reasoningContent LLM 输出的 reasoning_content 字符串
 * @returns 'reasoning_content' 如果检测到计划模式，否则 null
 */
export function detectPlanFromReasoning(
  reasoningContent: string | undefined | null,
): 'reasoning_content' | null {
  if (!reasoningContent || reasoningContent.length < 30) return null

  for (const pattern of PLAN_KEYWORD_PATTERNS) {
    if (pattern.test(reasoningContent)) {
      return 'reasoning_content'
    }
  }

  return null
}

/**
 * 综合 P 碱基检测：合并 _meta 和推理链两个来源。
 *
 * 在 ReAct 循环每轮工具调用后调用。如果返回非 null，
 * 则应在该工具碱基之前插入一个 P 碱基。
 *
 * 优先级: llm_meta > reasoning_content
 */
export function detectPBase(
  toolCallArgs?: Record<string, unknown>,
  reasoningContent?: string | null,
): 'llm_meta' | 'reasoning_content' | null {
  const fromMeta = detectPlanFromMeta(toolCallArgs)
  if (fromMeta) return fromMeta

  return detectPlanFromReasoning(reasoningContent)
}

/**
 * V10 增强版 P 碱基检测 — 带优先级链和 confidence。
 *
 * 优先级链：
 *   1. 显式 PlanEvent (confidence: 1.0, source: explicit_event) — 最高优先
 *   2. _meta.planStep (confidence: 0.9, source: llm_meta)
 *   3. reasoning_content 关键词 (confidence: 0.6-0.8, source: reasoning_content) — 降权保留
 *   4. 工具参数推断 (confidence: 0.4-0.6, source: tool_inference) — 最低
 */
export function detectPBaseEnhanced(
  toolCallArgs?: Record<string, unknown>,
  reasoningContent?: string | null,
  planEvent?: PlanEvent,
): PDetectionResult {
  // Priority 1: 显式 PlanEvent
  if (planEvent) {
    return {
      detected: true,
      source: 'explicit_event',
      confidence: 1.0,
    }
  }

  // Priority 2: _meta.planStep
  if (toolCallArgs) {
    const meta = toolCallArgs._meta
    if (meta && typeof meta === 'object' && (meta as Record<string, unknown>).planStep) {
      return {
        detected: true,
        source: 'llm_meta',
        confidence: 0.9,
      }
    }
  }

  // Priority 3: reasoning_content 关键词匹配
  if (reasoningContent && reasoningContent.length >= 30) {
    // 强信号：多个关键词匹配
    let matchCount = 0
    for (const pattern of PLAN_KEYWORD_PATTERNS) {
      if (pattern.test(reasoningContent)) {
        matchCount++
      }
    }
    if (matchCount >= 2) {
      return {
        detected: true,
        source: 'reasoning_content',
        confidence: 0.80,
      }
    }
    if (matchCount === 1) {
      return {
        detected: true,
        source: 'reasoning_content',
        confidence: 0.65,
      }
    }
  }

  // Priority 4: 工具参数推断（计划相关的工具调用模式）
  if (toolCallArgs) {
    const hasTaskDecomposition = !!(toolCallArgs.subtasks || toolCallArgs.steps || toolCallArgs.plan)
    if (hasTaskDecomposition) {
      return {
        detected: true,
        source: 'tool_inference',
        confidence: 0.50,
      }
    }
  }

  return {
    detected: false,
    source: 'tool_inference',
    confidence: 0,
  }
}

// ============================================
// Aggregation helpers
// ============================================

export type BaseType = 'E' | 'P' | 'V' | 'X'

/**
 * Build a base sequence string like "X-E-V-E-E" from an array of tool calls.
 */
export function buildBaseSequence(
  tools: Array<{ baseType?: BaseType }>,
): string {
  return tools
    .filter(t => t.baseType)
    .map(t => t.baseType)
    .join('-')
}

/**
 * Compute base distribution from an array of tool calls.
 */
export function buildBaseDistribution(
  tools: Array<{ baseType?: BaseType }>,
): { E: number; P: number; V: number; X: number } {
  const dist = { E: 0, P: 0, V: 0, X: 0 }
  for (const t of tools) {
    if (t.baseType && t.baseType in dist) {
      dist[t.baseType]++
    }
  }
  return dist
}

/**
 * Build a base sequence string from BaseSequenceEntry array.
 * Includes P bases from the independent entries array.
 */
export function buildBaseSequenceFromEntries(
  entries: Array<{ base: BaseType }>,
): string {
  return entries.map(e => e.base).join('-')
}

/**
 * Compute base distribution from BaseSequenceEntry array.
 * Includes P bases from the independent entries array.
 */
export function buildBaseDistributionFromEntries(
  entries: Array<{ base: BaseType }>,
): { E: number; P: number; V: number; X: number } {
  const dist = { E: 0, P: 0, V: 0, X: 0 }
  for (const entry of entries) {
    if (entry.base in dist) {
      dist[entry.base]++
    }
  }
  return dist
}
