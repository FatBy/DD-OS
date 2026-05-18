/**
 * Skill Production Service - 独立 LLM 生产管线
 *
 * 不复用主 Agent 的 ReAct 循环。拥有独立的 system prompt、温度控制、
 * 定界符输出格式 (===SKILL_START=== / ===SKILL_END===)。
 *
 * 管线阶段:
 * - Phase B: 生产 (流式 LLM, 默认入口)
 * - Phase C: 校验 (本地, 无 LLM)
 * - Phase C+: 触发测试 (异步 LLM)
 */

import { streamChat, chat, type SimpleChatMessage, type FunctionDefinition } from '@/services/llmService'
import { localServerService } from '@/services/localServerService'
import type { OperationSummary, DiffBlock } from '@/store/slices/skillIDESlice'

// ============================================
// SKILL_PRODUCER_PROMPT v1.0
// ============================================

const SKILL_PRODUCER_PROMPT = `你是 DunCrew SKILL.md 生产专家。你的唯一职责是生产高质量的 SKILL.md 文件。

## 输出格式
你必须严格按以下格式输出技能文件:
1. 先输出你的思考过程和分析(可选)
2. 然后用定界符包裹完整的 SKILL.md 内容:

===SKILL_START===
(完整的 SKILL.md 内容，包括 YAML frontmatter 和 Markdown 正文)
===SKILL_END===

## SKILL.md 结构规范
一个高质量的 SKILL.md 必须包含:

### YAML Frontmatter (--- 包裹)
- name: 技能名称 (kebab-case)
- description: 清晰的一句话描述 (>20字)
- version: 语义版本号 (如 1.0.0)
- tags: 分类标签数组
- keywords: 语义触发关键词数组 (Agent 用这些词判断何时调用)
- dangerLevel: safe | high | critical
- enabled: true
- requires: (可选) bins/env/config 依赖声明
- inputs: (可选) 参数 schema (JSON Schema 风格)
- whenToUse: 一句话说明何时使用此技能

### Markdown 正文
- # 标题 (与 name 一致)
- 简明的功能概述
- ## Instructions - 详细的使用说明和工作流程
- ## Examples - 至少 1-2 个使用示例
- ## Safety Rules - 安全约束和限制 (如有)

## 质量标准
1. description 必须 >20 字，清楚说明功能和使用场景
2. keywords 必须包含 Agent 会用到的触发词
3. inputs 必须为每个参数声明 type 和 description
4. Instructions 必须具体、可操作，不能泛泛而谈
5. 如果技能需要 API Key 或环境变量，必须在 requires.env 中声明
6. dangerLevel 必须如实声明

## 重要规则
- 只输出一个 SKILL.md 文件
- 定界符 ===SKILL_START=== 和 ===SKILL_END=== 必须各占独立一行
- 不要在定界符内包含 markdown 代码块包裹
- 如果用户提供了现有内容，在其基础上改进而非从零重写(除非用户明确要求重写)`

// ============================================
// 类型定义
// ============================================

export interface ProductionResult {
  /** 提取的 SKILL.md 内容 (定界符之间) */
  skillContent: string | null
  /** LLM 完整原始输出 */
  rawOutput: string
  /** 错误信息 */
  error: string | null
}

export interface ValidationResult {
  diagnostics: Array<{
    field: string
    passed: boolean
    suggestion: string
    weight: number
  }>
  score: number
}

export interface TriggerTestResult {
  triggers: string[]
  matchedKeywords: string[]
  suggestions: string[]
}

export interface ProduceParams {
  currentContent: string | null
  instruction: string
  skillName: string | null
  recentOps: OperationSummary[]
  temperatureMode: 'production' | 'exploration'
  onChunk: (chunk: string) => void
  signal?: AbortSignal
}

// ============================================
// 定界符解析
// ============================================

const DELIMITER_START = '===SKILL_START==='
const DELIMITER_END = '===SKILL_END==='

function extractSkillContent(raw: string): string | null {
  const startIdx = raw.indexOf(DELIMITER_START)
  const endIdx = raw.indexOf(DELIMITER_END)

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return null
  }

  const content = raw
    .slice(startIdx + DELIMITER_START.length, endIdx)
    .trim()

  return content || null
}

// ============================================
// Phase B: 生产 (流式 LLM)
// ============================================

export async function produce(params: ProduceParams): Promise<ProductionResult> {
  const {
    currentContent,
    instruction,
    skillName,
    recentOps,
    temperatureMode,
    onChunk,
    signal,
  } = params

  // 构建用户消息
  const userParts: string[] = []

  // 最近操作上下文 (3-5 条)
  if (recentOps.length > 0) {
    userParts.push('## 最近操作上下文')
    for (const op of recentOps.slice(0, 5)) {
      userParts.push(`- [${op.type}] ${op.description}`)
    }
    userParts.push('')
  }

  // 当前技能内容
  if (currentContent) {
    userParts.push(`## 当前 SKILL.md 内容 (${skillName || 'unknown'})`)
    userParts.push('```')
    userParts.push(currentContent)
    userParts.push('```')
    userParts.push('')
  }

  // 用户指令
  userParts.push('## 任务指令')
  userParts.push(instruction)

  const messages: SimpleChatMessage[] = [
    { role: 'system', content: SKILL_PRODUCER_PROMPT },
    { role: 'user', content: userParts.join('\n') },
  ]

  const temperature = temperatureMode === 'production' ? 0 : 0.3

  let rawOutput = ''

  try {
    const result = await streamChat(
      messages,
      (chunk) => {
        rawOutput += chunk
        onChunk(chunk)
      },
      signal,
      { temperature },
    )

    // 使用累积的流式内容
    rawOutput = result.content || rawOutput

    // 提取定界符之间的内容
    const skillContent = extractSkillContent(rawOutput)

    if (skillContent) {
      return { skillContent, rawOutput, error: null }
    }

    // 回退: 如果没有定界符，检查是否整个输出就是 SKILL.md
    if (rawOutput.includes('---\n') && rawOutput.includes('# ')) {
      return {
        skillContent: rawOutput.trim(),
        rawOutput,
        error: 'Warning: No delimiters found, using raw output as SKILL.md',
      }
    }

    return {
      skillContent: null,
      rawOutput,
      error: 'LLM output did not contain ===SKILL_START=== / ===SKILL_END=== delimiters',
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    return {
      skillContent: null,
      rawOutput,
      error: (err as Error).message || 'LLM streaming failed',
    }
  }
}

// ============================================
// Phase C: 本地校验 (无 LLM)
// ============================================

export function validateLocally(content: string): ValidationResult {
  const diagnostics: ValidationResult['diagnostics'] = []

  // 解析 frontmatter
  const fmMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/)
  const fmText = fmMatch ? fmMatch[1] : ''
  const body = fmMatch ? content.slice(fmMatch[0].length) : content

  // 简单 key-value 解析 (不依赖 YAML 库)
  const fm: Record<string, string | string[]> = {}
  for (const line of fmText.split('\n')) {
    const m = line.match(/^(\w+)\s*:\s*(.+)$/)
    if (m) {
      const val = m[2].trim()
      if (val.startsWith('[') && val.endsWith(']')) {
        fm[m[1]] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
      } else {
        fm[m[1]] = val
      }
    }
  }

  const desc = typeof fm.description === 'string' ? fm.description : ''
  diagnostics.push({
    field: 'description',
    passed: desc.length > 20,
    suggestion: desc.length > 20 ? 'OK' : 'description should be >20 characters',
    weight: 0.25,
  })

  diagnostics.push({
    field: 'tags',
    passed: Array.isArray(fm.tags) ? fm.tags.length > 0 : !!fm.tags,
    suggestion: fm.tags ? 'OK' : 'Missing tags',
    weight: 0.10,
  })

  diagnostics.push({
    field: 'keywords',
    passed: !!(fm.keywords || fm.tags),
    suggestion: (fm.keywords || fm.tags) ? 'OK' : 'Missing keywords',
    weight: 0.10,
  })

  diagnostics.push({
    field: 'version',
    passed: !!fm.version,
    suggestion: fm.version ? 'OK' : 'Missing version',
    weight: 0.05,
  })

  diagnostics.push({
    field: 'dangerLevel',
    passed: !!fm.dangerLevel,
    suggestion: fm.dangerLevel ? 'OK' : 'Missing dangerLevel',
    weight: 0.05,
  })

  // API/token 检测
  const fullText = (desc + ' ' + body).toLowerCase()
  const mentionsApi = /\bapi[_\s-]?key\b|\btoken\b|\bsecret\b/.test(fullText)
  const hasEnv = fmText.includes('requires:') && fmText.includes('env:')
  diagnostics.push({
    field: 'requires.env',
    passed: !mentionsApi || hasEnv,
    suggestion: mentionsApi && !hasEnv ? 'Content mentions API/token but requires.env is not declared' : 'OK',
    weight: 0.10,
  })

  diagnostics.push({
    field: 'inputs',
    passed: fmText.includes('inputs:'),
    suggestion: fmText.includes('inputs:') ? 'OK' : 'Missing inputs definition',
    weight: 0.15,
  })

  // Instructions section
  const hasInstructions = /^##\s+Instructions/mi.test(body)
  diagnostics.push({
    field: 'instructions_section',
    passed: hasInstructions,
    suggestion: hasInstructions ? 'OK' : 'Missing ## Instructions section',
    weight: 0.20,
  })

  // Score
  let base = 0
  for (const d of diagnostics) {
    if (d.passed) base += d.weight
  }
  const score = Math.min(Math.round(base * 100), 100)

  return { diagnostics, score }
}

// ============================================
// Phase C+: 触发测试 (异步 LLM)
// ============================================

export async function testTriggers(content: string): Promise<TriggerTestResult> {
  // 提取 keywords
  const fmMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/)
  const fmText = fmMatch ? fmMatch[1] : ''

  const kwMatch = fmText.match(/keywords:\s*\[([^\]]*)\]/)
  const keywords = kwMatch
    ? kwMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    : []

  if (keywords.length === 0) {
    return {
      triggers: [],
      matchedKeywords: [],
      suggestions: ['No keywords defined, trigger testing skipped'],
    }
  }

  try {
    const messages: SimpleChatMessage[] = [
      {
        role: 'system',
        content: 'You are a SKILL.md quality tester. Given a list of trigger keywords, generate 3-5 test user prompts that should trigger this skill. Return JSON: {"triggers": ["prompt1", "prompt2", ...], "analysis": "brief analysis"}',
      },
      {
        role: 'user',
        content: `Keywords: ${keywords.join(', ')}\n\nSkill content:\n${content.slice(0, 2000)}`,
      },
    ]

    const raw = await chat(messages, { temperature: 0.3 })
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        triggers: parsed.triggers || [],
        matchedKeywords: keywords,
        suggestions: parsed.analysis ? [parsed.analysis] : [],
      }
    }
  } catch {
    // Trigger testing is best-effort
  }

  return {
    triggers: [],
    matchedKeywords: keywords,
    suggestions: ['Trigger test failed, please verify keywords manually'],
  }
}

// ============================================
// 多轮对话系统提示词 v2.0
// ============================================

const SKILL_PRODUCER_PROMPT_MULTITURN = `你是 DunCrew SKILL.md 协作编辑助手。你和用户在一个对话式 IDE 中协作编辑技能文件。

## 你的角色
- 你是一个专业的技能编辑伙伴，帮助用户理解、改进和创建 SKILL.md 文件
- 你应该先解释你的思路和分析，让用户了解你的考虑
- 只在需要修改文件时才提出具体方案

## 可用工具
你可以使用以下工具来获取信息:
- **readFile(path)**: 读取指定路径的文件内容，支持绝对路径和相对路径
- **listDir(path)**: 列出目录下的文件和子目录

当用户要求你参考某个文件、文档或目录时，请主动使用这些工具读取内容，而不是告诉用户你无法读取。

## 对话规则
1. **先解释后修改**: 先说明你的分析和思路，再提出修改方案
2. **回答问题时**: 如果用户只是提问（比如"这个 keyword 够不够"），直接回答，不需要产出文件
3. **提出修改时**: 使用定界符包裹完整的新 SKILL.md:

===SKILL_START===
(完整的 SKILL.md 内容，包括 YAML frontmatter 和 Markdown 正文)
===SKILL_END===

4. **增量改进**: 在现有内容基础上改进，不要重写不需要改的部分
5. **语言**: 用中文与用户交流

## SKILL.md 结构规范
### YAML Frontmatter (--- 包裹)
- name: 技能名称 (kebab-case)
- description: 清晰的一句话描述 (>20字)
- version: 语义版本号
- tags: 分类标签数组
- keywords: 语义触发关键词数组
- dangerLevel: safe | high | critical
- enabled: true
- requires: (可选) 依赖声明
- inputs: (可选) 参数 schema
- whenToUse: 何时使用

### Markdown 正文
- # 标题
- 功能概述
- ## Instructions - 详细说明
- ## Examples - 使用示例
- ## Safety Rules - 安全约束

## 质量标准
1. description >20 字
2. keywords 包含触发词
3. inputs 声明参数类型
4. Instructions 具体可操作
5. dangerLevel 如实声明

## 重要
- 定界符 ===SKILL_START=== 和 ===SKILL_END=== 必须各占独立一行
- 不在定界符内包含 markdown 代码块包裹
- 只在确实要修改文件时使用定界符`

// ============================================
// 多轮生产类型
// ============================================

export interface MultiTurnParams {
  conversationMessages: SimpleChatMessage[]
  currentContent: string | null
  skillName: string | null
  temperatureMode: 'production' | 'exploration'
  onChunk: (chunk: string) => void
  onReasoningChunk?: (chunk: string) => void
  signal?: AbortSignal
}

export interface MultiTurnResult {
  content: string
  reasoningContent?: string
}

// ============================================
// 工具定义 (readFile + listDir)
// ============================================

const SKILL_IDE_TOOLS: Array<{ type: 'function'; function: FunctionDefinition }> = [
  {
    type: 'function',
    function: {
      name: 'readFile',
      description: '读取指定路径的文件内容。支持绝对路径和相对路径。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件路径（绝对或相对路径）',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listDir',
      description: '列出目录下的文件和子目录。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '目录路径',
          },
        },
        required: ['path'],
      },
    },
  },
]

/** 通过后端 /api/tools/execute 执行工具 */
async function executeToolViaBackend(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const serverUrl = localServerService.getServerUrl()
  try {
    const res = await fetch(`${serverUrl}/api/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: toolName, args }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      return `[Error] Tool execution failed (${res.status}): ${errText}`
    }
    const data = await res.json()
    if (data.status === 'error') {
      return `[Error] ${data.result || 'Tool execution failed'}`
    }
    // 截断过长的工具结果，避免 token 爆炸
    const result = String(data.result || '')
    if (result.length > 15000) {
      return result.slice(0, 15000) + '\n...[内容截断，文件过长]'
    }
    return result
  } catch (err) {
    return `[Error] ${(err as Error).message || 'Network error'}`
  }
}

const MAX_TOOL_ROUNDS = 5

// ============================================
// 多轮生产 (流式 LLM + 工具调用)
// ============================================

export async function produceMultiTurn(params: MultiTurnParams): Promise<MultiTurnResult> {
  const {
    conversationMessages,
    currentContent,
    skillName,
    temperatureMode,
    onChunk,
    onReasoningChunk,
    signal,
  } = params

  // 构建消息数组: system + context + conversation history
  const messages: SimpleChatMessage[] = [
    { role: 'system', content: SKILL_PRODUCER_PROMPT_MULTITURN },
  ]

  // 注入当前技能内容作为上下文
  if (currentContent) {
    messages.push({
      role: 'system',
      content: `## 当前技能文件内容 (${skillName || 'unknown'})\n\`\`\`\n${currentContent}\n\`\`\``,
    })
  }

  // 添加对话历史
  for (const msg of conversationMessages) {
    if (msg.role === 'system') continue
    messages.push({ role: msg.role, content: msg.content })
  }

  const temperature = temperatureMode === 'production' ? 0 : 0.3

  let rawOutput = ''
  let fullReasoningContent = ''

  try {
    // 工具调用循环: LLM 可能多轮调用工具后再给出最终回复
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const result = await streamChat(
        messages,
        (chunk) => {
          rawOutput += chunk
          onChunk(chunk)
        },
        signal,
        { temperature },
        SKILL_IDE_TOOLS,
        (chunk) => {
          fullReasoningContent += chunk
          onReasoningChunk?.(chunk)
        },
      )

      // 如果有 reasoning，更新完整内容
      if (result.reasoningContent) {
        fullReasoningContent = result.reasoningContent
      }

      // 检查是否有工具调用
      if (result.toolCalls && result.toolCalls.length > 0 && round < MAX_TOOL_ROUNDS) {
        // 追加 assistant 消息（含 tool_calls）
        messages.push({
          role: 'assistant',
          content: result.content || null,
          tool_calls: result.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        })

        // 并行执行所有工具调用
        const toolResults = await Promise.all(
          result.toolCalls.map(async (tc) => {
            let args: Record<string, unknown> = {}
            try {
              args = JSON.parse(tc.function.arguments)
            } catch {
              args = { path: tc.function.arguments }
            }

            // 通知用户正在读取文件
            const toolLabel = `\n\n> [${tc.function.name}: ${args.path || '...'}]\n\n`
            rawOutput += toolLabel
            onChunk(toolLabel)

            const toolResult = await executeToolViaBackend(tc.function.name, args)
            return { id: tc.id, name: tc.function.name, result: toolResult }
          }),
        )

        // 追加 tool 结果消息
        for (const tr of toolResults) {
          messages.push({
            role: 'tool',
            content: tr.result,
            tool_call_id: tr.id,
            name: tr.name,
          })
        }

        // 继续下一轮 (LLM 处理工具结果)
        continue
      }

      // 没有工具调用，返回最终结果
      return {
        content: result.content || rawOutput,
        reasoningContent: fullReasoningContent || undefined,
      }
    }

    // 超过最大轮次，返回当前累积内容
    return {
      content: rawOutput,
      reasoningContent: fullReasoningContent || undefined,
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw err
  }
}

// ============================================
// 推理 + Diff 提取
// ============================================

export function extractReasoningAndDiffs(
  rawOutput: string,
  currentContent: string,
): { reasoning: string; diffBlocks: DiffBlock[] } {
  const diffBlocks: DiffBlock[] = []

  const startIdx = rawOutput.indexOf(DELIMITER_START)
  const endIdx = rawOutput.indexOf(DELIMITER_END)

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { reasoning: rawOutput.trim(), diffBlocks: [] }
  }

  const reasoning = rawOutput.slice(0, startIdx).trim()

  const proposed = rawOutput
    .slice(startIdx + DELIMITER_START.length, endIdx)
    .trim()

  if (proposed) {
    diffBlocks.push({
      id: `diff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      original: currentContent,
      proposed,
      status: 'pending',
    })
  }

  return { reasoning: reasoning || '(proposed changes below)', diffBlocks }
}
