/**
 * OpenAI-compatible LLM Service Client
 * 支持流式 (SSE) 和非流式请求
 */

import type { LLMConfig } from '@/types'

// 简化的消息类型，仅需 role + content
type SimpleChatMessage = {
  role: 'system' | 'user' | 'assistant' | string
  content: string
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
  messages: Array<{ role: string; content: string }>
  stream?: boolean
  temperature?: number
  max_tokens?: number
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
 * 非流式调用
 */
export async function chat(
  messages: SimpleChatMessage[],
  config?: Partial<LLMConfig>,
): Promise<string> {
  const cfg = { ...getLLMConfig(), ...config }
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
    throw new Error('LLM 未配置，请在设置中配置 API')
  }

  const body: ChatCompletionRequest = {
    model: cfg.model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: false,
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
 * 流式调用 (SSE)
 */
export async function streamChat(
  messages: SimpleChatMessage[],
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
  config?: Partial<LLMConfig>,
): Promise<void> {
  const cfg = { ...getLLMConfig(), ...config }
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
    throw new Error('LLM 未配置，请在设置中配置 API')
  }

  const body: ChatCompletionRequest = {
    model: cfg.model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: true,
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
        if (data === '[DONE]') return

        try {
          const parsed = JSON.parse(data)
          const content = parsed.choices?.[0]?.delta?.content
          if (content) onChunk(content)
        } catch {
          // 忽略解析错误，继续处理
        }
      }
    }
  } finally {
    reader.releaseLock()
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

