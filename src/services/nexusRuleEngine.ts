// ============================================
// Nexus 自适应规则引擎 (从 LocalClawService 提取)
// ============================================

// ---- 类型定义 ----

export type RuleType =
  | 'TOOL_ERROR_RATE'
  | 'SUCCESS_RATE_DECLINE'
  | 'EFFICIENCY_DEGRADATION'
  | 'TOOL_SELECTION_HINT'
  | 'TASK_DECOMPOSITION'
  | 'ERROR_PATTERN_MEMORY'

export interface NexusRule {
  id: string
  nexusId: string
  type: RuleType
  active: boolean
  injectedPrompt: string
  createdAt: number
  expiresAt: number
  cooldownUntil: number
  metadata: {
    toolName?: string
    triggerValue: number
    threshold: number
    samples: number
  }
}

export interface NexusRulesStorage {
  version: string
  rules: Record<string, NexusRule[]>
  lastUpdated: number
}

export const RULE_PRIORITY: Record<RuleType, number> = {
  'ERROR_PATTERN_MEMORY': 10,
  'SUCCESS_RATE_DECLINE': 9,
  'TOOL_ERROR_RATE': 8,
  'TASK_DECOMPOSITION': 7,
  'EFFICIENCY_DEGRADATION': 6,
  'TOOL_SELECTION_HINT': 5,
}

export const RULE_LABELS: Record<RuleType, string> = {
  'TOOL_ERROR_RATE': '工具错误率预警',
  'SUCCESS_RATE_DECLINE': '成功率下降警报',
  'EFFICIENCY_DEGRADATION': '效率退化警告',
  'TOOL_SELECTION_HINT': '工具选择优化',
  'TASK_DECOMPOSITION': '任务分解建议',
  'ERROR_PATTERN_MEMORY': '错误模式记忆',
}

export const RULE_CONFIG = {
  MIN_TASKS: 5,
  MAX_ACTIVE_RULES: 3,
  COOLDOWN_MS: 24 * 60 * 60 * 1000,
  EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,
}

// ---- IO 依赖接口 ----

export interface RuleEngineIO {
  readFile(path: string): Promise<{ status: string; result?: string }>
  writeFile(path: string, content: string): Promise<void>
  addToast?(toast: { type: string; title: string; message: string }): void
}

// ---- NexusStats 类型 (规则引擎评估所需) ----

export interface ToolUsageStat {
  calls: number
  errors: number
}

export interface NexusStats {
  nexusId: string
  totalTasks: number
  successCount: number
  failureCount: number
  toolUsage: Record<string, ToolUsageStat>
  totalTurns: number
  totalDuration: number
  topErrors: string[]
  lastUpdated: number
}

// ---- 规则引擎服务 ----

export class NexusRuleEngine {
  private cache: NexusRulesStorage = { version: '1.0', rules: {}, lastUpdated: 0 }
  private io: RuleEngineIO | null = null

  setIO(io: RuleEngineIO): void {
    this.io = io
  }

  async load(): Promise<void> {
    if (!this.io) return
    try {
      const result = await this.io.readFile('memory/nexus_rules.json')
      if (result.status === 'success' && result.result) {
        this.cache = JSON.parse(result.result)
        const now = Date.now()
        for (const nexusId of Object.keys(this.cache.rules)) {
          this.cache.rules[nexusId] = this.cache.rules[nexusId].filter(r => r.expiresAt > now)
        }
        console.log(`[RuleEngine] Loaded rules for ${Object.keys(this.cache.rules).length} nexuses`)
      }
    } catch {
      // 文件不存在，从空开始
    }
  }

  async save(): Promise<void> {
    if (!this.io) return
    this.cache.lastUpdated = Date.now()
    try {
      await this.io.writeFile('memory/nexus_rules.json', JSON.stringify(this.cache, null, 2))
    } catch (err) {
      console.warn('[RuleEngine] Failed to save rules:', err)
    }
  }

  getActiveRulesForNexus(nexusId: string | null): NexusRule[] {
    if (!nexusId) return []
    const rules = this.cache.rules[nexusId] || []
    const now = Date.now()
    return rules.filter(r => r.active && r.expiresAt > now)
  }

  evaluateAndActivateRules(nexusId: string, stats: NexusStats): void {
    if (!stats || stats.totalTasks < RULE_CONFIG.MIN_TASKS) return

    const existing = this.cache.rules[nexusId] || []
    const now = Date.now()

    // 清理过期规则
    this.cache.rules[nexusId] = existing.filter(r => r.expiresAt > now)
    const activeCount = this.getActiveRulesForNexus(nexusId).length

    const candidates: NexusRule[] = []

    // --- 规则 1: 工具错误率预警 ---
    for (const [toolName, usage] of Object.entries(stats.toolUsage)) {
      if (usage.calls >= 5) {
        const errorRate = Math.round((usage.errors / usage.calls) * 100)
        if (errorRate > 40 && !this.hasActiveRule(nexusId, 'TOOL_ERROR_RATE', toolName)) {
          candidates.push(this.createRule(nexusId, 'TOOL_ERROR_RATE',
            `工具 ${toolName} 历史错误率 ${errorRate}%。调用前务必验证参数格式和路径，如有疑问先用 readFile 确认。`,
            { toolName, triggerValue: errorRate, threshold: 40, samples: usage.calls }
          ))
        }
      }
    }

    // --- 规则 2: 成功率下降 ---
    if (stats.totalTasks >= 10) {
      const successRate = Math.round((stats.successCount / stats.totalTasks) * 100)
      if (successRate < 50 && !this.hasActiveRule(nexusId, 'SUCCESS_RATE_DECLINE')) {
        candidates.push(this.createRule(nexusId, 'SUCCESS_RATE_DECLINE',
          `当前成功率 ${successRate}%，低于健康水平。执行前制定详细计划，拆分为 3-5 个子步骤，每步验证后再继续。`,
          { triggerValue: successRate, threshold: 50, samples: stats.totalTasks }
        ))
      }
    }

    // --- 规则 3: 效率退化 ---
    const avgTurns = Math.round(stats.totalTurns / stats.totalTasks)
    if (avgTurns > 20 && !this.hasActiveRule(nexusId, 'EFFICIENCY_DEGRADATION')) {
      candidates.push(this.createRule(nexusId, 'EFFICIENCY_DEGRADATION',
        `平均执行轮次 ${avgTurns}，效率偏低。优先使用直接相关的工具，避免试错式调用，参考历史成功案例的工具序列。`,
        { triggerValue: avgTurns, threshold: 20, samples: stats.totalTasks }
      ))
    }

    // --- 规则 4: 正向工具推荐 ---
    for (const [toolName, usage] of Object.entries(stats.toolUsage)) {
      if (usage.calls >= 5) {
        const successRate = Math.round(((usage.calls - usage.errors) / usage.calls) * 100)
        if (successRate > 80 && !this.hasActiveRule(nexusId, 'TOOL_SELECTION_HINT', toolName)) {
          candidates.push(this.createRule(nexusId, 'TOOL_SELECTION_HINT',
            `工具 ${toolName} 历史表现优秀（成功率 ${successRate}%），遇到相关任务时优先考虑。`,
            { toolName, triggerValue: successRate, threshold: 80, samples: usage.calls }
          ))
        }
      }
    }

    // --- 规则 5: 任务分解 ---
    if (stats.failureCount >= 5) {
      const failRate = Math.round((stats.failureCount / stats.totalTasks) * 100)
      if (failRate > 60 && avgTurns > 15 && !this.hasActiveRule(nexusId, 'TASK_DECOMPOSITION')) {
        candidates.push(this.createRule(nexusId, 'TASK_DECOMPOSITION',
          `复杂任务失败率 ${failRate}%。接到任务时先输出 3-5 步执行计划，每步完成后检查结果再继续。`,
          { triggerValue: failRate, threshold: 60, samples: stats.totalTasks }
        ))
      }
    }

    // --- 规则 6: 错误模式记忆 ---
    const errorCounts = new Map<string, number>()
    for (const err of stats.topErrors) {
      const key = err.slice(0, 40)
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1)
    }
    for (const [pattern, count] of errorCounts) {
      if (count >= 3 && !this.hasActiveRule(nexusId, 'ERROR_PATTERN_MEMORY', pattern)) {
        candidates.push(this.createRule(nexusId, 'ERROR_PATTERN_MEMORY',
          `历史错误模式: "${pattern}"（出现${count}次）。遇到类似错误时停止重试，寻求用户确认或换用备选方案。`,
          { toolName: pattern, triggerValue: count, threshold: 3, samples: stats.totalTasks }
        ))
      }
    }

    // 按优先级排序，取可激活的
    const sorted = candidates
      .filter(r => !this.isInCooldown(nexusId, r.type, r.metadata.toolName))
      .sort((a, b) => RULE_PRIORITY[b.type] - RULE_PRIORITY[a.type])

    const maxNew = Math.max(0, RULE_CONFIG.MAX_ACTIVE_RULES - activeCount)
    const toActivate = sorted.slice(0, maxNew)

    if (toActivate.length === 0) return

    // 激活规则
    if (!this.cache.rules[nexusId]) {
      this.cache.rules[nexusId] = []
    }

    for (const rule of toActivate) {
      this.cache.rules[nexusId].push(rule)
      console.log(`[RuleEngine] Activated: ${RULE_LABELS[rule.type]} for ${nexusId}`)

      this.io?.addToast?.({
        type: 'info',
        title: `规则引擎: ${RULE_LABELS[rule.type]}`,
        message: rule.injectedPrompt.slice(0, 80),
      })
    }

    // 异步保存
    this.save().catch(() => {})
  }

  private createRule(
    nexusId: string,
    type: RuleType,
    prompt: string,
    metadata: NexusRule['metadata']
  ): NexusRule {
    const now = Date.now()
    return {
      id: `rule-${now}-${Math.random().toString(36).slice(2, 6)}`,
      nexusId,
      type,
      active: true,
      injectedPrompt: prompt,
      createdAt: now,
      expiresAt: now + RULE_CONFIG.EXPIRY_MS,
      cooldownUntil: now + RULE_CONFIG.COOLDOWN_MS,
      metadata,
    }
  }

  private hasActiveRule(nexusId: string, type: RuleType, toolName?: string): boolean {
    const rules = this.getActiveRulesForNexus(nexusId)
    return rules.some(r =>
      r.type === type && (!toolName || r.metadata.toolName === toolName)
    )
  }

  private isInCooldown(nexusId: string, type: RuleType, toolName?: string): boolean {
    const all = this.cache.rules[nexusId] || []
    const now = Date.now()
    return all.some(r =>
      r.type === type &&
      (!toolName || r.metadata.toolName === toolName) &&
      r.cooldownUntil > now
    )
  }
}

export const nexusRuleEngine = new NexusRuleEngine()
