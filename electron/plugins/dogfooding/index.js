/**
 * DogFooding Plugin
 *
 * 功能：
 * 1. 自动注册 Qwen3.6-Plus-DogFooding Provider 到 DunCrew
 * 2. 钉钉机器人通知集成（任务完成/失败时推送）
 * 3. 支持通过插件设置 UI 配置所有参数
 */

'use strict'

const path = require('path')
const fs = require('fs')
const os = require('os')

// ============================================
// 从 OpenClaw 迁移配置（一次性）
// ============================================

function migrateFromOpenClaw(currentConfig, logger) {
  // 已有 apiKey 说明已迁移过或用户手动配置了，跳过
  if (currentConfig.apiKey) return null

  const openclawPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
  if (!fs.existsSync(openclawPath)) return null

  try {
    const raw = JSON.parse(fs.readFileSync(openclawPath, 'utf-8'))
    const migrated = {}
    let changed = false

    // 迁移 apiKey
    const provider = raw.models?.providers?.['custom-dogfooding']
    if (provider?.apiKey) {
      migrated.apiKey = provider.apiKey
      changed = true
      logger.info('Migrated apiKey from OpenClaw config')
    }

    // 迁移 baseUrl（如果和默认不同）
    if (provider?.baseUrl) {
      migrated.baseUrl = provider.baseUrl
    }

    // 迁移钉钉配置
    const dtChannel = raw.channels?.['openclaw-tmcp-dingtalk']
    if (dtChannel) {
      migrated.dingtalk = {
        enabled: true,
        serverAddress: dtChannel.serverAddress || '',
        channelId: dtChannel.channelId || '',
        accessToken: dtChannel.accessToken || '',
      }
      if (dtChannel.accessToken) {
        changed = true
        logger.info('Migrated DingTalk config from OpenClaw')
      }
    }

    return changed ? migrated : null
  } catch (err) {
    logger.warn('Failed to read OpenClaw config for migration:', err.message)
    return null
  }
}

// ============================================
// 默认配置
// ============================================

const DEFAULT_BASE_URL = 'https://idealab.alibaba-inc.com/api/openai/v1'

const DOGFOODING_MODELS = [
  {
    id: 'qwen3.6-plus-preview',
    name: 'qwen3.6-plus-preview',
    contextWindow: 990000,
    maxTokens: 65535,
    reasoning: false,
    input: ['text', 'image'],
  },
  {
    id: 'Qwen3.6-Plus-DogFooding',
    name: 'Qwen3.6-Plus-DogFooding',
    contextWindow: 990000,
    maxTokens: 65535,
    reasoning: false,
    input: ['text', 'image'],
  },
]

// ============================================
// 钉钉通知
// ============================================

async function sendDingTalkNotification(config, message, logger) {
  const dingtalk = config.dingtalk
  if (!dingtalk || !dingtalk.enabled) return

  const serverAddress = dingtalk.serverAddress || 'wss://open-claw-ali.alibaba-inc.com'
  const accessToken = dingtalk.accessToken
  if (!accessToken) {
    logger.warn('DingTalk accessToken not configured, skipping notification')
    return
  }

  try {
    const https = require('https')
    const url = new URL(serverAddress.replace('wss://', 'https://').replace('ws://', 'http://'))
    url.pathname = '/api/notify'

    const body = JSON.stringify({
      channelId: dingtalk.channelId || 'ai-work-kit',
      message,
      token: accessToken,
    })

    await new Promise((resolve, reject) => {
      const req = https.request(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        timeout: 5000,
      }, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve()
        } else {
          reject(new Error(`DingTalk notify failed: HTTP ${res.statusCode}`))
        }
      })
      req.on('error', (err) => reject(err))
      req.on('timeout', () => { req.destroy(); reject(new Error('DingTalk notify timeout')) })
      req.write(body)
      req.end()
    })

    logger.info('DingTalk notification sent')
  } catch (err) {
    logger.error('DingTalk notification failed:', err)
  }
}

// ============================================
// 插件入口
// ============================================

function activate(api) {
  let config = api.pluginConfig
  api.logger.info('Activating DogFooding plugin')

  // 首次启动: 从 ~/.openclaw/openclaw.json 迁移配置
  const migrated = migrateFromOpenClaw(config, api.logger)
  if (migrated) {
    config = { ...config, ...migrated }
    api.saveConfig(config)
    api.logger.info('OpenClaw config migration complete, saved to dogfooding.json')
  }

  // 1. 注册 Provider（apiKey 从插件配置中读取，不硬编码）
  const shouldRegister = config.autoRegisterProvider !== false
  if (shouldRegister) {
    const baseUrl = config.baseUrl || DEFAULT_BASE_URL
    const apiKey = config.apiKey || ''

    const provider = {
      id: 'dogfooding',
      label: 'Qwen3.6-Plus DogFooding',
      baseUrl,
      apiKey,
      apiProtocol: 'openai',
      models: DOGFOODING_MODELS,
    }

    api.registerProvider(provider)
    api.logger.info(`Provider registered: ${provider.label} (${baseUrl})`)
  }

  // 2. Hook: session_start
  api.on('session_start', async (event) => {
    api.logger.info('Session started:', event.taskId || 'unknown')
  })

  // 3. Hook: agent_end — 任务结束时推送钉钉通知
  api.on('agent_end', async (event) => {
    const taskId = event.taskId || 'unknown'
    const status = event.status || 'completed'
    const message = `[DunCrew] 任务 ${taskId} 已${status === 'completed' ? '完成' : '结束'} (${status})`

    await sendDingTalkNotification(config, message, api.logger)
  })

  // 4. Hook: before_prompt_build — 可注入额外上下文
  api.on('before_prompt_build', async (_event) => {
    return {}
  })

  api.logger.info('DogFooding plugin activated')

  return {
    deactivate: () => {
      api.removeProvider('dogfooding')
      api.logger.info('DogFooding plugin deactivated')
    },
  }
}

module.exports = { activate }
