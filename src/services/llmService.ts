/**
 * OpenAI-compatible LLM Service Client
 * 支持流式 (SSE) 和非流式请求
 */

import type { LLMConfig, ToolInfo } from '@/types'

// ============================================
// Function Calling 类型定义
// ============================================

/** OpenAI Function Definition schema */
export interface FunctionDefinition {
  name: string
  description?: string
  parameters?: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
}

/** 流式 delta 中的 tool_call 片段 */
interface ToolCallDelta {
  index: number
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

/** 累积后的完整 tool_call */
export interface FCToolCall {
  id: string
  function: {
    name: string
    arguments: string
  }
}

/** streamChat 返回值 (FC 模式) */
export interface LLMStreamResult {
  content: string
  toolCalls: FCToolCall[]
  finishReason: string | null
  // DeepSeek 思维模式的推理内容
  reasoningContent?: string
}

// ============================================
// 消息类型
// ============================================

/** 支持 tool role 和 tool_calls 的消息类型 */
export type SimpleChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool' | string
  content: string | null
  // assistant 消息携带的 tool_calls
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  // tool 消息需要的 tool_call_id
  tool_call_id?: string
  // tool 消息可选的 name
  name?: string
  // DeepSeek 思维模式的推理内容 (reasoning_content)
  reasoning_content?: string
}

// localStorage keys
const STORAGE_KEYS = {
  API_KEY: 'ddos_llm_api_key',
  BASE_URL: 'ddos_llm_base_url',
  MODEL: 'ddos_llm_model',
}

// ============================================
// 配置管理
// ============================================

export function getLLMConfig(): LLMConfig {
  return {
    apiKey: localStorage.getItem(STORAGE_KEYS.API_KEY) || '',
    baseUrl: localStorage.getItem(STORAGE_KEYS.BASE_URL) || '',
    model: localStorage.getItem(STORAGE_KEYS.MODEL) || '',
  }
}

export function saveLLMConfig(config: Partial<LLMConfig>) {
  if (config.apiKey !== undefined) localStorage.setItem(STORAGE_KEYS.API_KEY, config.apiKey)
  if (config.baseUrl !== undefined) localStorage.setItem(STORAGE_KEYS.BASE_URL, config.baseUrl)
  if (config.model !== undefined) localStorage.setItem(STORAGE_KEYS.MODEL, config.model)
}

export function isLLMConfigured(): boolean {
  const config = getLLMConfig()
  return !!(config.apiKey && config.baseUrl && config.model)
}

// ============================================
// API 请求
// ============================================

interface ChatCompletionRequest {
  model: string
  messages: Array<{
    role: string
    content: string | null
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
    tool_call_id?: string
    name?: string
  }>
  stream?: boolean
  temperature?: number
  max_tokens?: number
  // Function Calling 参数
  tools?: Array<{ type: 'function'; function: FunctionDefinition }>
  tool_choice?: 'auto' | 'none' | 'required'
}

function buildUrl(baseUrl: string): string {
  // 确保 baseUrl 以 /chat/completions 结尾
  let url = baseUrl.replace(/\/+$/, '')
  if (!url.endsWith('/chat/completions')) {
    if (!url.endsWith('/v1')) {
      url += '/v1'
    }
    url += '/chat/completions'
  }
  return url
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  }
}

/**
 * 非流式调用 (支持 Function Calling)
 */
export async function chat(
  messages: SimpleChatMessage[],
  config?: Partial<LLMConfig>,
  tools?: Array<{ type: 'function'; function: FunctionDefinition }>,
): Promise<string> {
  const cfg = { ...getLLMConfig(), ...config }
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
    throw new Error('LLM 未配置，请在设置中配置 API')
  }

  const body: ChatCompletionRequest = {
    model: cfg.model,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.name ? { name: m.name } : {}),
    })),
    stream: false,
  }

  if (tools && tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  const res = await fetch(buildUrl(cfg.baseUrl), {
    method: 'POST',
    headers: buildHeaders(cfg.apiKey),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`LLM API 错误 (${res.status}): ${errText}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

/**
 * 流式调用 (SSE) - 支持 Function Calling
 * 
 * 当传入 tools 参数时，返回 LLMStreamResult 包含 toolCalls;
 * 未传 tools 时行为与旧版一致 (toolCalls 为空数组)。
 */
export async function streamChat(
  messages: SimpleChatMessage[],
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
  config?: Partial<LLMConfig>,
  tools?: Array<{ type: 'function'; function: FunctionDefinition }>,
): Promise<LLMStreamResult> {
  const cfg = { ...getLLMConfig(), ...config }
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
    throw new Error('LLM 未配置，请在设置中配置 API')
  }

  const body: ChatCompletionRequest = {
    model: cfg.model,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.name ? { name: m.name } : {}),
      // DeepSeek 思维模式: 必须传递 reasoning_content
      ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
    })),
    stream: true,
  }

  if (tools && tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  const res = await fetch(buildUrl(cfg.baseUrl), {
    method: 'POST',
    headers: buildHeaders(cfg.apiKey),
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`LLM API 错误 (${res.status}): ${errText}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('无法读取响应流')

  const decoder = new TextDecoder()
  let buffer = ''

  // 累积结果
  let fullContent = ''
  let fullReasoningContent = ''  // DeepSeek 思维模式推理内容
  let finishReason: string | null = null
  // tool_calls 累积器: index → { id, name, arguments }
  const toolCallAccumulator: Map<number, { id: string; name: string; arguments: string }> = new Map()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // 保留最后一行（可能不完整）
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue

        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') {
          // 构建最终结果
          const toolCalls: FCToolCall[] = []
          for (const [, acc] of toolCallAccumulator) {
            toolCalls.push({
              id: acc.id,
              function: { name: acc.name, arguments: acc.arguments },
            })
          }
          return { 
            content: fullContent, 
            toolCalls, 
            finishReason,
            reasoningContent: fullReasoningContent || undefined,
          }
        }

        try {
          const parsed = JSON.parse(data)
          const choice = parsed.choices?.[0]

          // 更新 finish_reason
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason
          }

          const delta = choice?.delta
          if (!delta) continue

          // 累积文本内容
          if (delta.content) {
            fullContent += delta.content
            onChunk(delta.content)
          }

          // DeepSeek 思维模式: 累积 reasoning_content
          if (delta.reasoning_content) {
            fullReasoningContent += delta.reasoning_content
          }

          // 累积 tool_calls delta
          if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls as ToolCallDelta[]) {
              const idx = tc.index
              if (!toolCallAccumulator.has(idx)) {
                toolCallAccumulator.set(idx, { id: '', name: '', arguments: '' })
              }
              const acc = toolCallAccumulator.get(idx)!
              if (tc.id) acc.id = tc.id
              if (tc.function?.name) acc.name += tc.function.name
              if (tc.function?.arguments) acc.arguments += tc.function.arguments
            }
          }
        } catch {
          // 忽略解析错误，继续处理
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  // 流结束但没收到 [DONE]，也返回已累积的结果
  const toolCalls: FCToolCall[] = []
  for (const [, acc] of toolCallAccumulator) {
    toolCalls.push({
      id: acc.id,
      function: { name: acc.name, arguments: acc.arguments },
    })
  }
  return { 
    content: fullContent, 
    toolCalls, 
    finishReason,
    reasoningContent: fullReasoningContent || undefined,
  }
}

/**
 * 测试连接
 */
export async function testConnection(config?: Partial<LLMConfig>): Promise<boolean> {
  const cfg = { ...getLLMConfig(), ...config }
  const testMessages: SimpleChatMessage[] = [
    { role: 'user', content: '请回复 OK' },
  ]
  
  try {
    const reply = await chat(testMessages, cfg)
    return reply.length > 0
  } catch {
    return false
  }
}

// ============================================
// P4: Embedding API
// ============================================

/**
 * 构建 embedding 端点 URL
 * OpenAI 兼容格式: /v1/embeddings
 */
function buildEmbeddingUrl(baseUrl: string): string {
  let url = baseUrl.replace(/\/+$/, '')
  // 移除可能存在的 /chat/completions 后缀
  url = url.replace(/\/chat\/completions$/, '').replace(/\/v1$/, '')
  return url + '/v1/embeddings'
}

/**
 * 生成文本嵌入向量
 * 调用 OpenAI 兼容的 /v1/embeddings 端点
 * 
 * @param text 要嵌入的文本
 * @param config 可选的配置覆盖
 * @returns 嵌入向量 (float[])，失败返回空数组
 */
export async function embed(
  text: string,
  config?: Partial<LLMConfig>
): Promise<number[]> {
  const cfg = { ...getLLMConfig(), ...config }
  if (!cfg.apiKey || !cfg.baseUrl) {
    console.warn('[Embed] LLM not configured, skipping embedding')
    return []
  }

  try {
    const res = await fetch(buildEmbeddingUrl(cfg.baseUrl), {
      method: 'POST',
      headers: buildHeaders(cfg.apiKey),
      body: JSON.stringify({
        model: cfg.model, // 部分服务需要指定模型，部分会忽略
        input: text,
      }),
    })

    if (!res.ok) {
      console.warn(`[Embed] API error (${res.status}), falling back to empty vector`)
      return []
    }

    const data = await res.json()
    // OpenAI 格式: { data: [{ embedding: [...] }] }
    return data.data?.[0]?.embedding || []
  } catch (err) {
    console.warn('[Embed] Request failed:', err)
    return []
  }
}

/**
 * 计算两个向量的余弦相似度
 * @returns -1 到 1 之间的值，1 表示完全相似
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

// ============================================
// ToolInfo → OpenAI Function Schema 转换
// ============================================

/**
 * 将 DD-OS ToolInfo 转换为 OpenAI Function Calling 的 tools 参数格式
 */
export function convertToolInfoToFunctions(
  tools: ToolInfo[]
): Array<{ type: 'function'; function: FunctionDefinition }> {
  return tools
    .filter(t => t.type !== 'instruction') // 指令型技能无需注册为 function
    .map(t => ({
      type: 'function' as const,
      function: toolInfoToFunctionDef(t),
    }))
}

/**
 * 单个 ToolInfo → FunctionDefinition
 */
function toolInfoToFunctionDef(tool: ToolInfo): FunctionDefinition {
  const def: FunctionDefinition = {
    name: tool.name,
    description: tool.description || tool.name,
  }

  // 将 ToolInfo.inputs 转换为 JSON Schema parameters
  if (tool.inputs && Object.keys(tool.inputs).length > 0) {
    const properties: Record<string, any> = {}
    const required: string[] = []

    for (const [key, schema] of Object.entries(tool.inputs)) {
      if (typeof schema === 'object' && schema !== null) {
        // 已经是 JSON Schema 格式 (如 { type: 'string', description: '...', required: true })
        const { required: isRequired, ...rest } = schema
        properties[key] = rest
        // 确保有 type 字段
        if (!properties[key].type) {
          properties[key].type = 'string'
        }
        if (isRequired) {
          required.push(key)
        }
      } else {
        // 简单值，推断为 string
        properties[key] = { type: 'string', description: String(schema) }
      }
    }

    def.parameters = {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    }
  } else {
    // 无参数的工具
    def.parameters = { type: 'object', properties: {} }
  }

  return def
}

