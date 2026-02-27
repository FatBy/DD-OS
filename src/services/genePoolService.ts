/**
 * Gene Pool Service — DD-OS 自愈基因库
 * 
 * 捕获工具失败→修复的模式为"基因"，在后续遇到相似错误时
 * 自动注入修复策略到 Reflexion 提示中。
 * 
 * Phase 1: 基因存储/加载/匹配/注入
 * Phase 2: 自动收割 (failure→success 模式检测)
 * Phase 3: 跨 Nexus 基因共享与置信度排名
 * Phase 4: Nexus 通讯基因 (capability/artifact/activity)
 */

import type { Gene, GeneMatch, Capsule, ExecTraceToolCall, NexusCapabilityInfo, NexusArtifactInfo, NexusActivityInfo } from '@/types'
import { extractSignals, rankGenes, signalOverlap } from '@/utils/signalMatcher'

const SERVER_URL = 'http://localhost:3001'

// 配置常量
const MAX_GENE_HINTS = 3              // Reflexion 中最多注入的基因数
const MAX_CAPSULE_HISTORY = 100       // 内存中保留的胶囊数
const HARVEST_MIN_CONFIDENCE = 0.3    // 自动收割的初始置信度
const DUPLICATE_OVERLAP_THRESHOLD = 0.7  // 信号重叠超过此阈值视为重复
const CONFIDENCE_DECAY = 0.8          // 失败时置信度衰减系数
const CONFIDENCE_BOOST = 0.1          // 成功时置信度增量
const CONFIDENCE_CAP = 1.0            // 置信度上限
const RETIRED_THRESHOLD = 0.1         // 低于此置信度且使用次数 > 5 视为废弃

class GenePoolService {
  private genes: Gene[] = []
  private capsules: Capsule[] = []
  private loaded = false
  private loading: Promise<void> | null = null

  /**
   * 确保基因库已加载 (幂等，懒加载)
   */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (this.loading) return this.loading

    this.loading = this.loadGenes()
    try {
      await this.loading
      this.loaded = true
    } catch (err) {
      console.warn('[GenePool] Failed to load genes, starting with empty pool:', err)
      this.genes = []
      this.loaded = true
    } finally {
      this.loading = null
    }
  }

  /**
   * 从后端加载全部基因
   */
  private async loadGenes(): Promise<void> {
    try {
      const res = await fetch(`${SERVER_URL}/api/genes/load`)
      if (res.ok) {
        const data = await res.json()
        this.genes = Array.isArray(data) ? data : []
        console.log(`[GenePool] Loaded ${this.genes.length} genes`)
      }
    } catch {
      this.genes = []
    }
  }

  /**
   * 保存单个基因到后端
   */
  private async saveGene(gene: Gene): Promise<void> {
    try {
      const res = await fetch(`${SERVER_URL}/api/genes/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gene),
      })
      if (res.ok) {
        console.log(`[GenePool] Gene saved: ${gene.id} (${gene.signals_match.length} signals)`)
      }
    } catch (err) {
      console.warn('[GenePool] Failed to save gene:', err)
    }
  }

  // ============================================
  // Phase 1: 基因匹配与 Reflexion 注入
  // ============================================

  /**
   * 查找与当前错误匹配的基因 (Phase 1 核心)
   */
  findMatchingGenes(toolName: string, errorMsg: string): GeneMatch[] {
    if (this.genes.length === 0) return []

    const signals = extractSignals(toolName, errorMsg)
    const matches = rankGenes(signals, this.genes)

    return matches.slice(0, MAX_GENE_HINTS)
  }

  /**
   * Phase 3: 跨 Nexus 基因共享 — 带加权的匹配
   */
  findCrossNexusGenes(toolName: string, errorMsg: string, currentNexusId?: string): GeneMatch[] {
    if (this.genes.length === 0) return []

    const signals = extractSignals(toolName, errorMsg)
    const matches = rankGenes(signals, this.genes)

    // Phase 3 加权
    for (const match of matches) {
      let weight = 1.0

      // 同 Nexus 产生的基因: 更可信
      if (currentNexusId && match.gene.source.nexusId === currentNexusId) {
        weight *= 1.5
      } else if (match.gene.signals_match.some(s => s.toLowerCase() === toolName.toLowerCase())) {
        // 不同 Nexus 但匹配同工具名: 中等可信
        weight *= 1.2
      }

      // 高置信度基因加权
      if (match.gene.metadata.confidence > 0.7) {
        weight *= 1.3
      }

      // 经过验证的基因 (使用次数 > 3) 微加权
      if (match.gene.metadata.useCount > 3) {
        weight *= 1.1
      }

      match.score *= weight
    }

    // 重新排序
    matches.sort((a, b) => b.score - a.score)

    return matches.slice(0, MAX_GENE_HINTS)
  }

  /**
   * 将匹配基因格式化为 Reflexion 注入的提示文本
   */
  buildGeneHint(matches: GeneMatch[]): string {
    if (matches.length === 0) return ''

    const hints = matches.map((m, i) => {
      const confidence = Math.round(m.gene.metadata.confidence * 100)
      const stepsText = m.gene.strategy.map((s, j) => `   ${j + 1}. ${s}`).join('\n')
      return `修复方案 ${i + 1} (置信度 ${confidence}%, 匹配信号: ${m.matchedSignals.join(', ')}):\n${stepsText}`
    })

    return `\n\n[Gene Pool - 历史修复经验]
系统在基因库中找到 ${matches.length} 条相关修复经验:
${hints.join('\n')}
请参考以上历史经验，但也要根据当前具体情况判断是否适用。`
  }

  /**
   * 记录基因使用结果 (Capsule)，并更新基因元数据
   */
  recordCapsule(geneId: string, trigger: string[], outcome: 'success' | 'failure', nexusId?: string): void {
    // 记录胶囊
    const capsule: Capsule = {
      id: `capsule-${Date.now()}`,
      geneId,
      trigger,
      outcome,
      nexusId,
      timestamp: Date.now(),
    }
    this.capsules.push(capsule)
    if (this.capsules.length > MAX_CAPSULE_HISTORY) {
      this.capsules.shift()
    }

    // 更新基因元数据
    const gene = this.genes.find(g => g.id === geneId)
    if (gene) {
      gene.metadata.useCount++
      gene.metadata.lastUsedAt = Date.now()

      if (outcome === 'success') {
        gene.metadata.successCount++
        gene.metadata.confidence = Math.min(CONFIDENCE_CAP, gene.metadata.confidence + CONFIDENCE_BOOST)
      } else {
        gene.metadata.confidence *= CONFIDENCE_DECAY
      }

      // 持久化更新后的基因
      this.saveGene(gene).catch(() => {})
    }
  }

  // ============================================
  // Phase 2: 自动基因收割
  // ============================================

  /**
   * 从执行追踪中自动收割基因
   * 检测 error → ... → success 模式 (同一工具名)
   */
  harvestGene(traceTools: ExecTraceToolCall[], _userPrompt: string, nexusId?: string): void {
    if (traceTools.length < 2) return

    // 按 order 排序
    const sorted = [...traceTools].sort((a, b) => a.order - b.order)

    // 查找 error → success 配对 (同一工具名)
    const harvested: Gene[] = []

    for (let i = 0; i < sorted.length; i++) {
      const failedTool = sorted[i]
      if (failedTool.status !== 'error') continue

      // 在后续调用中找同名成功调用
      for (let j = i + 1; j < sorted.length; j++) {
        const recoveryTool = sorted[j]
        if (recoveryTool.name !== failedTool.name) continue
        if (recoveryTool.status !== 'success') continue

        // 找到 error→success 配对
        const errorMsg = failedTool.result || ''
        const signals = extractSignals(failedTool.name, errorMsg)

        // 检查重复: 与已有基因的信号重叠度
        const isDuplicate = this.genes.some(existing => {
          const overlap = signalOverlap(signals, existing.signals_match)
          if (overlap >= DUPLICATE_OVERLAP_THRESHOLD) {
            // 已有类似基因 → 增加其置信度
            existing.metadata.confidence = Math.min(
              CONFIDENCE_CAP,
              existing.metadata.confidence + 0.05
            )
            this.saveGene(existing).catch(() => {})
            return true
          }
          return false
        })

        if (isDuplicate) break

        // 构建修复策略: 对比失败和成功的参数差异
        const strategy = this.buildStrategyFromDiff(failedTool, recoveryTool, sorted.slice(i + 1, j))

        if (strategy.length === 0) break

        const gene: Gene = {
          id: `gene-${Date.now()}-${harvested.length}`,
          category: 'repair',
          signals_match: signals,
          strategy,
          source: {
            traceId: `trace-${sorted[0].order}`,
            nexusId,
            createdAt: Date.now(),
          },
          metadata: {
            confidence: HARVEST_MIN_CONFIDENCE,
            useCount: 0,
            successCount: 0,
          },
        }

        harvested.push(gene)
        break // 每个失败工具只配对第一个成功恢复
      }
    }

    // 保存收割的基因
    for (const gene of harvested) {
      this.genes.push(gene)
      this.saveGene(gene).catch(() => {})
      console.log(`[GenePool] Harvested gene: ${gene.id} from ${gene.signals_match[0]} error`)
    }
  }

  /**
   * 从失败/成功工具调用对比中生成修复策略
   */
  private buildStrategyFromDiff(
    failed: ExecTraceToolCall,
    success: ExecTraceToolCall,
    intermediate: ExecTraceToolCall[]
  ): string[] {
    const strategy: string[] = []

    // 比较参数差异
    const failedArgs = failed.args || {}
    const successArgs = success.args || {}

    for (const key of Object.keys(successArgs)) {
      const fVal = JSON.stringify(failedArgs[key] ?? '')
      const sVal = JSON.stringify(successArgs[key])
      if (fVal !== sVal) {
        strategy.push(`将 ${failed.name} 的参数 "${key}" 从 ${fVal} 改为 ${sVal}`)
      }
    }

    // 记录中间使用的工具 (修复路径)
    if (intermediate.length > 0) {
      const intermediateTools = intermediate
        .filter(t => t.status === 'success')
        .map(t => t.name)
      const uniqueTools = [...new Set(intermediateTools)]
      if (uniqueTools.length > 0) {
        strategy.push(`修复过程中使用了以下工具: ${uniqueTools.join(' → ')}`)
      }
    }

    // 如果没有发现参数差异，记录通用策略
    if (strategy.length === 0 && failed.result) {
      strategy.push(`${failed.name} 失败后重新尝试成功，可能是临时性错误或环境问题`)
    }

    return strategy
  }

  // ============================================
  // 诊断接口
  // ============================================

  /** 当前基因数量 */
  get geneCount(): number {
    return this.genes.length
  }

  /** 获取所有活跃基因 (排除废弃的) */
  getActiveGenes(): Gene[] {
    return this.genes.filter(g =>
      !(g.metadata.confidence < RETIRED_THRESHOLD && g.metadata.useCount > 5)
    )
  }

  // ============================================
  // Phase 4: Nexus 通讯基因
  // ============================================

  /**
   * 注册 Nexus 能力基因 (Capability Gene)
   * 当 Nexus 被加载时调用，让其他 Nexus 能发现它的能力
   */
  registerNexusCapability(capability: NexusCapabilityInfo): void {
    // 检查是否已存在该 Nexus 的能力基因
    const existingIndex = this.genes.findIndex(
      g => g.category === 'capability' && g.nexusCapability?.nexusId === capability.nexusId
    )

    // 提取能力信号
    const signals = [
      capability.nexusName,
      ...capability.capabilities,
      ...capability.description.split(/[,，、\s]+/).filter(s => s.length > 1)
    ].map(s => s.toLowerCase())

    const gene: Gene = {
      id: existingIndex >= 0 ? this.genes[existingIndex].id : `gene-cap-${capability.nexusId}`,
      category: 'capability',
      signals_match: [...new Set(signals)],  // 去重
      strategy: [`此 Nexus 专精: ${capability.capabilities.join(', ')}`],
      source: {
        nexusId: capability.nexusId,
        createdAt: existingIndex >= 0 ? this.genes[existingIndex].source.createdAt : Date.now(),
      },
      metadata: {
        confidence: existingIndex >= 0 ? this.genes[existingIndex].metadata.confidence : 0.8,
        useCount: existingIndex >= 0 ? this.genes[existingIndex].metadata.useCount : 0,
        successCount: existingIndex >= 0 ? this.genes[existingIndex].metadata.successCount : 0,
      },
      nexusCapability: capability,
    }

    if (existingIndex >= 0) {
      this.genes[existingIndex] = gene
    } else {
      this.genes.push(gene)
    }

    this.saveGene(gene).catch(() => {})
    console.log(`[GenePool] Registered capability gene for: ${capability.nexusName}`)
  }

  /**
   * 注册 Nexus 产出物基因 (Artifact Gene)
   * 当文件写入成功时调用，让其他 Nexus 能发现这个产出物
   */
  registerArtifact(artifact: NexusArtifactInfo, keywords?: string[]): void {
    // 提取产出物信号
    const signals = [
      artifact.name,
      artifact.type,
      ...(keywords || []),
      ...(artifact.description?.split(/[,，、\s]+/).filter(s => s.length > 1) || [])
    ].map(s => s.toLowerCase())

    const gene: Gene = {
      id: `gene-art-${Date.now()}`,
      category: 'artifact',
      signals_match: [...new Set(signals)],
      strategy: [`产出物路径: ${artifact.path}`, `类型: ${artifact.type}`],
      source: {
        nexusId: artifact.nexusId,
        createdAt: Date.now(),
      },
      metadata: {
        confidence: 0.9,  // 产出物基因初始置信度较高
        useCount: 0,
        successCount: 0,
      },
      artifactInfo: artifact,
    }

    this.genes.push(gene)
    this.saveGene(gene).catch(() => {})
    console.log(`[GenePool] Registered artifact gene: ${artifact.name} from ${artifact.nexusId}`)
  }

  /**
   * 记录 Nexus 活动基因 (Activity Gene)
   * 当 ReAct 循环完成时调用，记录 Nexus 做了什么
   */
  recordActivity(activity: NexusActivityInfo): void {
    // 提取活动信号
    const signals = [
      activity.nexusName,
      ...activity.summary.split(/[,，、\s]+/).filter(s => s.length > 1),
      ...activity.toolsUsed,
    ].map(s => s.toLowerCase())

    const gene: Gene = {
      id: `gene-act-${Date.now()}`,
      category: 'activity',
      signals_match: [...new Set(signals)],
      strategy: [activity.summary],
      source: {
        nexusId: activity.nexusId,
        createdAt: Date.now(),
      },
      metadata: {
        confidence: activity.status === 'success' ? 0.85 : 0.4,
        useCount: 0,
        successCount: activity.status === 'success' ? 1 : 0,
      },
      activityInfo: activity,
    }

    this.genes.push(gene)
    this.saveGene(gene).catch(() => {})
    console.log(`[GenePool] Recorded activity gene: ${activity.summary.slice(0, 50)}...`)

    // 限制活动基因数量 (只保留最近 50 条)
    const activityGenes = this.genes.filter(g => g.category === 'activity')
    if (activityGenes.length > 50) {
      const toRemove = activityGenes.slice(0, activityGenes.length - 50)
      this.genes = this.genes.filter(g => !toRemove.includes(g))
    }
  }

  /**
   * 查找相关的 Nexus 基因 (跨 Nexus 通讯核心)
   * 根据用户查询的信号，找到相关的 Nexus 能力、产出物、活动
   */
  findNexusGenes(query: string, currentNexusId?: string): {
    capabilities: GeneMatch[]
    artifacts: GeneMatch[]
    activities: GeneMatch[]
  } {
    const signals = query.toLowerCase().split(/[,，、\s]+/).filter(s => s.length > 1)
    
    const capabilities: GeneMatch[] = []
    const artifacts: GeneMatch[] = []
    const activities: GeneMatch[] = []

    for (const gene of this.genes) {
      // 计算信号匹配分数
      const matchedSignals = signals.filter(s => 
        gene.signals_match.some(gs => gs.includes(s) || s.includes(gs))
      )
      
      if (matchedSignals.length === 0) continue

      let score = matchedSignals.length / Math.max(signals.length, 1)
      
      // 跨 Nexus 加权
      if (currentNexusId && gene.source.nexusId !== currentNexusId) {
        // 其他 Nexus 的基因轻微降权 (但仍然可见)
        score *= 0.9
      }

      // 高置信度加权
      score *= (0.5 + gene.metadata.confidence * 0.5)

      const match: GeneMatch = { gene, score, matchedSignals }

      switch (gene.category) {
        case 'capability':
          capabilities.push(match)
          break
        case 'artifact':
          artifacts.push(match)
          break
        case 'activity':
          activities.push(match)
          break
      }
    }

    // 按分数排序
    capabilities.sort((a, b) => b.score - a.score)
    artifacts.sort((a, b) => b.score - a.score)
    activities.sort((a, b) => b.score - a.score)

    return {
      capabilities: capabilities.slice(0, 5),
      artifacts: artifacts.slice(0, 5),
      activities: activities.slice(0, 5),
    }
  }

  /**
   * 构建 Nexus 通讯提示 (注入到动态上下文)
   */
  buildNexusCommunicationHint(query: string, currentNexusId?: string): string {
    const { capabilities, artifacts, activities } = this.findNexusGenes(query, currentNexusId)

    if (capabilities.length === 0 && artifacts.length === 0 && activities.length === 0) {
      return ''
    }

    const hints: string[] = ['## 🌐 Nexus 协作资源']

    // 能力发现
    if (capabilities.length > 0) {
      hints.push('\n### 可协作的 Nexus 节点')
      for (const m of capabilities) {
        const cap = m.gene.nexusCapability!
        hints.push(`- **${cap.nexusName}** (${cap.nexusId})`)
        hints.push(`  能力: ${cap.capabilities.join(', ')}`)
        hints.push(`  路径: ${cap.dirPath}`)
      }
    }

    // 产出物发现
    if (artifacts.length > 0) {
      hints.push('\n### 相关产出物')
      for (const m of artifacts) {
        const art = m.gene.artifactInfo!
        hints.push(`- **${art.name}** (来自 ${art.nexusId})`)
        hints.push(`  路径: ${art.path}`)
        hints.push(`  类型: ${art.type}`)
        if (art.description) {
          hints.push(`  描述: ${art.description}`)
        }
      }
    }

    // 活动历史
    if (activities.length > 0) {
      hints.push('\n### 最近相关活动')
      for (const m of activities.slice(0, 3)) {
        const act = m.gene.activityInfo!
        const timeAgo = this.formatTimeAgo(m.gene.source.createdAt)
        hints.push(`- [${act.nexusName}] ${act.summary} (${timeAgo})`)
      }
    }

    hints.push('\n如需访问其他 Nexus 的产出物，直接使用 readFile(路径) 读取。')

    return hints.join('\n')
  }

  /**
   * 格式化时间差
   */
  private formatTimeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (days > 0) return `${days}天前`
    if (hours > 0) return `${hours}小时前`
    if (minutes > 0) return `${minutes}分钟前`
    return '刚刚'
  }

  /**
   * 获取所有已注册的 Nexus 能力列表
   */
  getAllNexusCapabilities(): NexusCapabilityInfo[] {
    return this.genes
      .filter(g => g.category === 'capability' && g.nexusCapability)
      .map(g => g.nexusCapability!)
  }

  /**
   * 获取指定 Nexus 的所有产出物
   */
  getNexusArtifacts(nexusId: string): NexusArtifactInfo[] {
    return this.genes
      .filter(g => g.category === 'artifact' && g.artifactInfo?.nexusId === nexusId)
      .map(g => g.artifactInfo!)
  }

  /**
   * 获取指定 Nexus 的最近活动
   */
  getNexusActivities(nexusId: string, limit: number = 10): NexusActivityInfo[] {
    return this.genes
      .filter(g => g.category === 'activity' && g.activityInfo?.nexusId === nexusId)
      .sort((a, b) => b.source.createdAt - a.source.createdAt)
      .slice(0, limit)
      .map(g => g.activityInfo!)
  }
}

// 单例导出
export const genePoolService = new GenePoolService()
