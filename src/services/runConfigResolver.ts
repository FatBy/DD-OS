/**
 * runConfigResolver - Per-Dun LLM 配置核心解析模块
 *
 * 职责：根据 dunId + purpose 解析出完整的 EffectiveRunConfig 快照，
 * 统一收敛所有 LLM 配置读取路径，消除配置分叉与行为漂移。
 */

import type {
  LLMPurpose,
  EffectiveRunConfig,
  ModelProvider,
  ModelBinding,
  ChannelBindings,
  DunLLMBinding,
  ApiProtocol,
  LLMConfig,
} from '@/types'
import { getLLMConfig } from './llmService'

// ============================================
// 模型能力 fallback 映射表
// ============================================

const MODEL_CAPS_FALLBACK: Record<string, { contextWindow: number; supportsTools: boolean }> = {
  'qwen-max':                     { contextWindow: 128000, supportsTools: true },
  'qwen-plus':                    { contextWindow: 128000, supportsTools: true },
  'gpt-4o':                       { contextWindow: 128000, supportsTools: true },
  'gpt-4o-mini':                  { contextWindow: 128000, supportsTools: true },
  'gpt-4-turbo':                  { contextWindow: 128000, supportsTools: true },
  'claude-sonnet-4-20250514':     { contextWindow: 200000, supportsTools: true },
  'claude-3-5-sonnet':            { contextWindow: 200000, supportsTools: true },
  'deepseek-chat':                { contextWindow: 64000,  supportsTools: true },
  'deepseek-reasoner':            { contextWindow: 64000,  supportsTools: false },
  '_default':                     { contextWindow: 32000,  supportsTools: true },
}

// ============================================
// Error 类
// ============================================

export class LLMNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LLMNotConfiguredError'
  }
}

// ============================================
// 内部工具函数
// ============================================

/** 从 LinkStation Store 读取 providers + channelBindings */
function readLinkStation(): { providers: ModelProvider[]; channelBindings: ChannelBindings } | null {
  try {
    // 动态引用避免循环依赖（与 LocalClawService 同模式）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useStore } = require('@/store') as { useStore: { getState: () => any } }
    const { providers, channelBindings } = useStore.getState().linkStation
    return { providers, channelBindings }
  } catch {
    return null
  }
}

/** 从 Dun 获取 llmBinding（当前版本通过 worldSlice 查找） */
function getDunLLMBinding(dunId: string): DunLLMBinding | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useStore } = require('@/store') as { useStore: { getState: () => any } }
    const duns = useStore.getState().duns as Map<string, { llmBinding?: DunLLMBinding }>
    const dun = duns?.get?.(dunId)
    return dun?.llmBinding
  } catch {
    return undefined
  }
}

/** 查找 Provider */
function findProvider(providers: ModelProvider[], providerId: string): ModelProvider | undefined {
  return providers.find(p => p.id === providerId)
}

/** 解析模型的 contextWindow */
function resolveContextWindow(model: string): number {
  const caps = MODEL_CAPS_FALLBACK[model] ?? MODEL_CAPS_FALLBACK['_default']
  return caps.contextWindow
}

/** 解析 supportsTools：优先 compatFlags → fallback 表 → 协议推断 */
function resolveSupportsTools(
  providers: ModelProvider[],
  providerId: string,
  modelId: string,
  apiFormat: ApiProtocol,
): boolean {
  const provider = findProvider(providers, providerId)
  if (provider) {
    const entry = provider.models.find(m => m.id === modelId)
    if (entry?.compatFlags?.supportsTools !== undefined) {
      return entry.compatFlags.supportsTools
    }
  }
  // fallback 表
  const caps = MODEL_CAPS_FALLBACK[modelId]
  if (caps) return caps.supportsTools
  // 协议推断
  if (apiFormat === 'claude-code') return false
  return true
}

/** 从 ModelBinding + providers 构建 EffectiveRunConfig */
function buildFromBinding(
  providers: ModelProvider[],
  binding: ModelBinding,
  purpose: LLMPurpose,
  source: EffectiveRunConfig['source'],
  channel?: string,
  temperatureOverride?: number,
): EffectiveRunConfig {
  const provider = findProvider(providers, binding.providerId)
  if (!provider) {
    // Provider 已删除 → 回退全局
    console.warn(`[runConfigResolver] Provider ${binding.providerId} 已删除，回退全局配置`)
    return buildFromGlobalFallback(purpose)
  }
  const apiFormat = provider.apiProtocol
  return {
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    model: binding.modelId,
    apiFormat,
    temperature: temperatureOverride,
    contextWindow: resolveContextWindow(binding.modelId),
    supportsTools: resolveSupportsTools(providers, binding.providerId, binding.modelId, apiFormat),
    providerLabel: provider.label,
    purpose,
    source,
    providerId: binding.providerId,
    channel,
  }
}

/** 从全局 getLLMConfig() 构建 fallback EffectiveRunConfig */
function buildFromGlobalFallback(purpose: LLMPurpose): EffectiveRunConfig {
  const cfg = getLLMConfig()
  const apiFormat = cfg.apiFormat ?? 'auto'
  return {
    apiKey: cfg.apiKey || '',
    baseUrl: cfg.baseUrl || '',
    model: cfg.model || '',
    apiFormat,
    temperature: undefined,
    contextWindow: resolveContextWindow(cfg.model || ''),
    supportsTools: apiFormat === 'claude-code' ? false : true,
    providerLabel: 'global-fallback',
    purpose,
    source: 'fallback',
  }
}

// ============================================
// 导出 API
// ============================================

/**
 * 解析 Per-Dun LLM 运行配置
 *
 * @param dunId - Dun ID（undefined 表示无 Dun 上下文）
 * @param purpose - 调用目的
 * @returns 完整的 EffectiveRunConfig 快照
 */
export function resolveRunLLMConfig(
  dunId: string | undefined,
  purpose: LLMPurpose,
): EffectiveRunConfig {
  const ls = readLinkStation()

  // ── 1. 全局 channel 类 purpose ──
  if (purpose === 'search' || purpose === 'vision' || purpose === 'childAgent' || purpose === 'background') {
    if (ls) {
      const { providers, channelBindings } = ls
      let binding: ModelBinding | null = null
      let channel = 'chat'

      if (purpose === 'search') {
        binding = channelBindings.search ?? channelBindings.chat
        channel = channelBindings.search ? 'search' : 'chat'
      } else if (purpose === 'vision') {
        binding = channelBindings.chat
        channel = 'chat'
      } else if (purpose === 'childAgent') {
        binding = channelBindings.chatSecondary ?? channelBindings.chat
        channel = channelBindings.chatSecondary ? 'chatSecondary' : 'chat'
      } else {
        // background
        binding = channelBindings.chat
        channel = 'chat'
      }

      if (binding) {
        return buildFromBinding(providers, binding, purpose, 'global-channel', channel)
      }
    }
    // Store 未就绪或 channel 未绑定 → global fallback
    return buildFromGlobalFallback(purpose)
  }

  // ── 2. chat / critic → 看 Dun 绑定 ──
  if (dunId) {
    const llmBinding = getDunLLMBinding(dunId)
    if (llmBinding) {
      if (ls) {
        const provider = findProvider(ls.providers, llmBinding.providerId)
        if (provider) {
          return buildFromBinding(
            ls.providers,
            { providerId: llmBinding.providerId, modelId: llmBinding.modelId },
            purpose,
            'dun-binding',
            undefined,
            llmBinding.temperature,
          )
        }
        // Provider 已删除
        console.warn(`[runConfigResolver] Dun ${dunId} 绑定的 Provider ${llmBinding.providerId} 不存在，回退全局`)
      }
    }
  }

  // 无 Dun 绑定 → 回退全局 chat channel
  if (ls) {
    const { providers, channelBindings } = ls
    if (channelBindings.chat) {
      return buildFromBinding(providers, channelBindings.chat, purpose, 'global-chat', 'chat')
    }
  }
  return buildFromGlobalFallback(purpose)
}

/**
 * 断言运行配置有效（不满足时抛出 LLMNotConfiguredError）
 */
export function assertRunConfigValid(config: EffectiveRunConfig): void {
  if (config.apiFormat === 'claude-code') {
    if (!config.model) {
      throw new LLMNotConfiguredError('Claude Code 模式需要配置模型名称，请在联络站中设置')
    }
    return
  }
  const missing: string[] = []
  if (!config.apiKey) missing.push('API Key')
  if (!config.baseUrl) missing.push('API 地址')
  if (!config.model) missing.push('模型名称')
  if (missing.length > 0) {
    throw new LLMNotConfiguredError(
      `LLM 配置不完整，缺少：${missing.join('、')}。请在联络站中完成配置`,
    )
  }
}

/**
 * 将 EffectiveRunConfig 转换为 llmService 函数可消费的 Partial<LLMConfig>
 */
export function toPartialLLMConfig(config: EffectiveRunConfig): Partial<LLMConfig> {
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    apiFormat: config.apiFormat,
    temperature: config.temperature,
  }
}
