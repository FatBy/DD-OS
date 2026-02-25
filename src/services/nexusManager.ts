// ============================================
// Nexus 管理服务 (从 LocalClawService 提取)
// 职责: Nexus 路由匹配、工具装配、性能统计、上下文构建、经验系统
// ============================================

import type { NexusEntity, ToolInfo, ExecTrace } from '@/types'
import { nexusRuleEngine, type NexusStats } from './nexusRuleEngine'

type NexusStatsMap = Record<string, NexusStats>

// ---- IO 依赖接口 ----

export interface NexusManagerIO {
  executeTool(call: { name: string; args: Record<string, unknown> }): Promise<{ status: string; result?: string }>
  readFileWithCache(path: string): Promise<string | null>
  getActiveNexusId(): string | null
  getNexuses(): Map<string, NexusEntity> | undefined
  getAvailableTools(): ToolInfo[]
  getServerUrl(): string
  addToast?(toast: { type: string; title: string; message: string }): void
}

// ---- Nexus 管理服务 ----

export class NexusManagerService {
  private statsCache: NexusStatsMap = {}
  private io: NexusManagerIO | null = null

  setIO(io: NexusManagerIO): void {
    this.io = io
  }

  // ============================================
  // 性能统计系统
  // ============================================

  async loadStats(): Promise<void> {
    if (!this.io) return
    try {
      const result = await this.io.executeTool({
        name: 'readFile',
        args: { path: 'memory/nexus_stats.json' },
      })
      if (result.status === 'success' && result.result) {
        this.statsCache = JSON.parse(result.result)
        console.log(`[NexusManager] Loaded stats for ${Object.keys(this.statsCache).length} nexuses`)
      }
    } catch {
      // 文件不存在，从空开始
    }
  }

  private async saveStats(): Promise<void> {
    if (!this.io) return
    try {
      await this.io.executeTool({
        name: 'writeFile',
        args: {
          path: 'memory/nexus_stats.json',
          content: JSON.stringify(this.statsCache, null, 2),
        },
      })
    } catch (err) {
      console.warn('[NexusManager] Failed to save stats:', err)
    }
  }

  recordPerformance(trace: ExecTrace): void {
    const nexusId = trace.activeNexusId || '_global'

    if (!this.statsCache[nexusId]) {
      this.statsCache[nexusId] = {
        nexusId,
        totalTasks: 0,
        successCount: 0,
        failureCount: 0,
        toolUsage: {},
        totalTurns: 0,
        totalDuration: 0,
        topErrors: [],
        lastUpdated: Date.now(),
      }
    }

    const stats = this.statsCache[nexusId]
    stats.totalTasks++
    stats.totalTurns += trace.turnCount || 0
    stats.totalDuration += trace.duration || 0
    stats.lastUpdated = Date.now()

    if (trace.success) {
      stats.successCount++
    } else {
      stats.failureCount++
    }

    for (const tool of trace.tools) {
      if (!stats.toolUsage[tool.name]) {
        stats.toolUsage[tool.name] = { calls: 0, errors: 0 }
      }
      stats.toolUsage[tool.name].calls++
      if (tool.status === 'error') {
        stats.toolUsage[tool.name].errors++
        const errSnippet = (tool.result || '').slice(0, 60)
        if (errSnippet && !stats.topErrors.includes(errSnippet)) {
          stats.topErrors.push(errSnippet)
          if (stats.topErrors.length > 5) stats.topErrors.shift()
        }
      }
    }

    // 异步持久化
    this.saveStats().catch(() => {})

    // 触发规则引擎评估
    nexusRuleEngine.evaluateAndActivateRules(nexusId, stats)
  }

  buildInsight(nexusId?: string | null): string {
    const id = nexusId || '_global'
    const stats = this.statsCache[id]
    if (!stats || stats.totalTasks < 2) return ''

    const successRate = Math.round((stats.successCount / stats.totalTasks) * 100)
    const avgTurns = Math.round(stats.totalTurns / stats.totalTasks)
    const avgDuration = Math.round(stats.totalDuration / stats.totalTasks / 1000)

    const lines: string[] = [`## 📊 历史表现 (${stats.totalTasks}次任务)`]

    if (successRate >= 80) {
      lines.push(`成功率: ${successRate}% — 表现稳定`)
    } else if (successRate >= 50) {
      lines.push(`成功率: ${successRate}% — 有改进空间，注意失败模式`)
    } else {
      lines.push(`成功率: ${successRate}% — 失败率偏高，执行前仔细规划`)
    }

    lines.push(`平均轮次: ${avgTurns} | 平均耗时: ${avgDuration}s`)

    const sortedTools = Object.entries(stats.toolUsage)
      .sort((a, b) => b[1].calls - a[1].calls)
      .slice(0, 3)
    if (sortedTools.length > 0) {
      const toolHints = sortedTools.map(([name, u]) => {
        const errRate = u.calls > 0 ? Math.round((u.errors / u.calls) * 100) : 0
        return errRate > 30
          ? `${name}(${u.calls}次, ⚠️错误率${errRate}%)`
          : `${name}(${u.calls}次)`
      })
      lines.push(`常用工具: ${toolHints.join(', ')}`)
    }

    const riskyTools = Object.entries(stats.toolUsage)
      .filter(([, u]) => u.calls >= 3 && (u.errors / u.calls) > 0.4)
      .map(([name]) => name)
    if (riskyTools.length > 0) {
      lines.push(`⚠️ 高风险工具: ${riskyTools.join(', ')} — 使用前确认参数正确`)
    }

    if (successRate < 60 && avgTurns > 15) {
      lines.push(`建议: 失败率高且轮次多，优先拆分为更小的子任务`)
    } else if (avgTurns > 20) {
      lines.push(`建议: 平均轮次偏高，考虑更精确的工具选择`)
    }

    return lines.join('\n') + '\n'
  }

  // ============================================
  // Nexus 路由匹配 (三层)
  // ============================================

  matchForTask(userInput: string): NexusEntity | null {
    if (!this.io) return null
    const nexuses = this.io.getNexuses()
    if (!nexuses || nexuses.size === 0) return null

    const inputLower = userInput.toLowerCase()

    // P0: 显式激活
    const activeNexusId = this.io.getActiveNexusId()
    if (activeNexusId) {
      const active = nexuses.get(activeNexusId)
      if (active) return active
    }

    const nexusList = Array.from(nexuses.values()).filter(n => n.constructionProgress >= 1)

    // P1: 触发词命中
    for (const nexus of nexusList) {
      const triggers = nexus.triggers || []
      if (triggers.length > 0 && triggers.some(t => inputLower.includes(t.toLowerCase()))) {
        console.log(`[NexusRouter] P1 trigger match: "${nexus.label}" via triggers`)
        return nexus
      }
    }

    // P2: 关键词综合评分
    let bestMatch: NexusEntity | null = null
    let bestScore = 0

    for (const nexus of nexusList) {
      let score = 0
      const triggers = nexus.triggers || []
      score += triggers.filter(t => inputLower.includes(t.toLowerCase())).length * 3

      const skills = nexus.boundSkillIds || []
      score += skills.filter(s => {
        const parts = s.toLowerCase().split('-')
        return parts.some(p => p.length > 2 && inputLower.includes(p))
      }).length * 2

      const desc = `${nexus.flavorText || ''} ${nexus.label || ''}`
      const descWords = desc.toLowerCase().split(/\s+/).filter(w => w.length > 2)
      score += descWords.filter(w => inputLower.includes(w)).length

      if (score > bestScore) {
        bestScore = score
        bestMatch = nexus
      }
    }

    if (bestScore >= 3 && bestMatch) {
      console.log(`[NexusRouter] P2 keyword match: "${bestMatch.label}" (score: ${bestScore})`)
      return bestMatch
    }

    console.log('[NexusRouter] No Nexus matched, using full toolset')
    return null
  }

  assembleToolsForNexus(nexus: NexusEntity): ToolInfo[] {
    if (!this.io) return []
    const availableTools = this.io.getAvailableTools()
    const result: ToolInfo[] = []
    const included = new Set<string>()

    // 1. 基础工具
    for (const tool of availableTools) {
      if (tool.type === 'builtin') {
        result.push(tool)
        included.add(tool.name)
      }
    }

    // 2. 绑定工具
    const boundIds = new Set<string>([...(nexus.boundSkillIds || [])])
    for (const tool of availableTools) {
      if (!included.has(tool.name) && boundIds.has(tool.name)) {
        result.push(tool)
        included.add(tool.name)
      }
    }

    // 3. MCP 工具
    for (const tool of availableTools) {
      if (tool.type === 'mcp' && !included.has(tool.name)) {
        const mcpServer = tool.name.split('__')[0] || ''
        if (boundIds.has(mcpServer) || Array.from(boundIds).some(bid => tool.name.includes(bid))) {
          result.push(tool)
          included.add(tool.name)
        }
      }
    }

    // 4. 模糊补充
    const nonBuiltinCount = result.filter(t => t.type !== 'builtin').length
    if (nonBuiltinCount < 3) {
      const nexusKeywords = [
        ...(nexus.triggers || []),
        ...(nexus.label ? nexus.label.toLowerCase().split(/\s+/) : []),
      ].map(k => k.toLowerCase()).filter(k => k.length > 2)

      for (const tool of availableTools) {
        if (included.has(tool.name)) continue
        if (result.length >= 15) break

        const toolLower = tool.name.toLowerCase()
        const descLower = (tool.description || '').toLowerCase()
        if (nexusKeywords.some(k => toolLower.includes(k) || descLower.includes(k))) {
          result.push(tool)
          included.add(tool.name)
        }
      }
    }

    console.log(`[NexusRouter] Assembled ${result.length} tools for "${nexus.label}" (${result.filter(t => t.type !== 'builtin').map(t => t.name).join(', ')})`)
    return result
  }

  expandToolsForReflexion(
    currentTools: ToolInfo[],
    failedToolName: string,
    errorMsg: string,
  ): ToolInfo[] | null {
    if (!this.io) return null
    const isToolMissing = /unknown tool|tool not found|不支持|no such tool|未找到工具|not available/i.test(errorMsg)
    if (!isToolMissing) return null

    const currentNames = new Set(currentTools.map(t => t.name))
    const availableTools = this.io.getAvailableTools()
    const missingTool = availableTools.find(t => t.name === failedToolName && !currentNames.has(t.name))

    if (missingTool) {
      console.log(`[NexusRouter] Runtime expansion: adding "${failedToolName}" to toolset`)
      return [...currentTools, missingTool]
    }

    return null
  }

  prepareToolsForTask(userInput: string): {
    tools: ToolInfo[]
    matchedNexus: NexusEntity | null
    isFiltered: boolean
  } {
    if (!this.io) return { tools: [], matchedNexus: null, isFiltered: false }
    const matchedNexus = this.matchForTask(userInput)
    const availableTools = this.io.getAvailableTools()

    if (matchedNexus) {
      const filteredTools = this.assembleToolsForNexus(matchedNexus)
      const nonBuiltin = filteredTools.filter(t => t.type !== 'builtin').length
      if (nonBuiltin === 0) {
        console.log('[NexusRouter] Safety fallback: no non-builtin tools after filtering, using full toolset')
        return { tools: availableTools, matchedNexus, isFiltered: false }
      }
      return { tools: filteredTools, matchedNexus, isFiltered: true }
    }

    return { tools: availableTools, matchedNexus: null, isFiltered: false }
  }

  // ============================================
  // Nexus 上下文 & 经验
  // ============================================

  async buildContext(nexusId: string, userQuery: string): Promise<string | null> {
    if (!this.io) return null
    const nexuses = this.io.getNexuses()
    const nexus = nexuses?.get(nexusId)

    let sopContent = nexus?.sopContent

    if (!sopContent) {
      try {
        const res = await fetch(`${this.io.getServerUrl()}/nexuses/${nexusId}`)
        if (res.ok) {
          const detail = await res.json()
          sopContent = detail.sopContent
        }
      } catch {
        // 静默失败
      }
    }

    if (!sopContent) return null

    const maxChars = 8000
    const trimmedSOP = sopContent.length > maxChars
      ? sopContent.slice(0, maxChars) + '\n... [truncated]'
      : sopContent

    let ctx = `## 🌌 Active Nexus: ${nexus?.label || nexusId}\n\n`

    const objective = nexus?.objective
    const metrics = nexus?.metrics
    const strategy = nexus?.strategy

    if (objective) {
      ctx += `### 🎯 核心目标 (Objective)\n${objective}\n\n`
      if (metrics && metrics.length > 0) {
        ctx += `### ✓ 验收标准 (Metrics)\n`
        ctx += `执行过程中，请自我检查是否满足以下条件：\n`
        metrics.forEach((m: string, i: number) => {
          ctx += `${i + 1}. ${m}\n`
        })
        ctx += `\n`
      }
      if (strategy) {
        ctx += `### 🔄 动态调整策略\n${strategy}\n\n`
      }
      ctx += `---\n\n`
    }

    ctx += trimmedSOP

    const experiences = await this.searchExperiences(nexusId, userQuery)
    if (experiences.length > 0) {
      ctx += `\n\n### 相关历史经验\n${experiences.join('\n---\n')}`
    }

    return ctx
  }

  private async searchExperiences(nexusId: string, query: string): Promise<string[]> {
    if (!this.io) return []
    const results: string[] = []

    for (const fileName of ['successes.md', 'failures.md']) {
      const content = await this.io.readFileWithCache(`nexuses/${nexusId}/experience/${fileName}`)
      if (!content) continue

      const entries = content.split('\n### ').filter(e => e.trim())
      const queryWords = query.split(/\s+/).filter(w => w.length > 2)

      for (const entry of entries) {
        const entryLower = entry.toLowerCase()
        const matchCount = queryWords.filter(w => entryLower.includes(w.toLowerCase())).length
        if (matchCount > 0) {
          const prefix = fileName.includes('success') ? '[SUCCESS]' : '[FAILURE]'
          results.push(`${prefix} ### ${entry.slice(0, 500)}`)
        }
      }
    }

    return results.slice(0, 5)
  }

  buildSkillContext(): string {
    if (!this.io) return ''
    const activeNexusId = this.io.getActiveNexusId()
    if (!activeNexusId) return ''

    const nexuses = this.io.getNexuses()
    const nexus = nexuses?.get(activeNexusId)
    if (!nexus) return ''

    const boundSkills = nexus.boundSkillIds || []
    const availableSkillNames = this.io.getAvailableTools()
      .filter((t: ToolInfo) => t.type === 'instruction' || t.type === 'plugin')
      .map((t: ToolInfo) => t.name)

    return `\n当前 Nexus: ${nexus.label || activeNexusId}
已绑定技能: ${boundSkills.join(', ') || '无'}
可用技能库: ${availableSkillNames.slice(0, 15).join(', ')}${availableSkillNames.length > 15 ? '...' : ''}`
  }

  async recordExperience(
    nexusId: string,
    task: string,
    toolsUsed: string[],
    success: boolean,
    finalResponse: string
  ): Promise<void> {
    if (!this.io) return
    try {
      const insight = this.extractKeyInsight(toolsUsed, finalResponse)
      await fetch(`${this.io.getServerUrl()}/nexuses/${nexusId}/experience`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: task.slice(0, 200),
          tools_used: toolsUsed,
          outcome: success ? 'success' : 'failure',
          key_insight: insight,
        }),
      })
      console.log(`[NexusManager] Recorded ${success ? 'success' : 'failure'} experience for Nexus: ${nexusId}`)
    } catch (e) {
      console.warn('[NexusManager] Failed to record experience:', e)
    }
  }

  private extractKeyInsight(toolsUsed: string[], finalResponse: string): string {
    if (toolsUsed.length === 0) return 'Direct response without tool usage'
    const toolSeq = toolsUsed.join(' → ')
    const summary = finalResponse.slice(0, 100).replace(/\n/g, ' ')
    return `Tool sequence: ${toolSeq}. Result: ${summary}...`
  }

  matchByTriggers(userQuery: string): string | null {
    if (!this.io) return null
    const query = userQuery.toLowerCase()
    const nexuses = this.io.getNexuses()
    if (!nexuses) return null

    for (const [, nexus] of nexuses) {
      if (nexus.triggers && nexus.triggers.length > 0) {
        for (const trigger of nexus.triggers) {
          if (query.includes(trigger.toLowerCase())) {
            return nexus.id
          }
        }
      }
    }
    return null
  }
}

export const nexusManager = new NexusManagerService()
