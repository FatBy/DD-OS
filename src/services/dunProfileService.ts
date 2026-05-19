import type {
  DunArtifactInfo,
  DunEntity,
  DunExperience,
  DunScoring,
  SopEpisode,
  TaskItem,
} from '@/types'

export type EvidenceLevel = 'inferred' | 'validated' | 'statistical'

export type RecentTrend = 'improving' | 'stable' | 'declining' | 'insufficient_data'

export interface SliceCapability {
  slice: string
  evidenceCount: number
  passRate: number
  avgValidatorConfidence: number
  wilsonLowerBound: number
  recentTrend: RecentTrend
  weakObligationIds: string[]
  lastEvidenceAt: string
}

export interface CapabilityClaim {
  id: string
  label: string
  evidenceLevel: EvidenceLevel
  confidence: number
  evidenceCount: number
  passRate: number
  wilsonLowerBound?: number
  sourceObligations: string[]
  sourceMetrics: string[]
  lastEvidenceAt: string
  sliceBreakdown: SliceCapability[]
  narrative: string
}

export interface TrustAdviceItem {
  taskType: string
  slice?: string
  trustLevel: 'safe' | 'assist' | 'needs_review' | 'not_ready'
  reason: string
  sourceCapabilityIds: string[]
  evidenceLevel: EvidenceLevel
}

export interface DunAbilitySummary {
  overallStatus: 'new' | 'learning' | 'stable' | 'strong' | 'risky'
  strongest: CapabilityClaim[]
  learning: CapabilityClaim[]
  trustAdvice: {
    safeToDelegate: TrustAdviceItem[]
    needsReview: TrustAdviceItem[]
  }
  recentTrend: RecentTrend
}

export interface TrustBoundary {
  taskType: string
  trustLevel: 'safe' | 'assist' | 'needs_review' | 'not_ready'
  reason: string
  escalationRule?: string
}

export interface CareerItem {
  id: string
  kind: 'highlight' | 'lesson'
  title: string
  summary: string
  sourceEpisodeId?: string
  sourceArtifactIds?: string[]
  learnedChange?: string
  evidenceLevel: EvidenceLevel
}

export interface GrowthEvent {
  id: string
  date: string
  kind: 'success_pattern' | 'failure_lesson' | 'sop_patch' | 'stage_upgrade'
  title: string
  firstPersonSummary: string
  sourceEpisodeIds: string[]
  evidenceLevel: EvidenceLevel
}

export interface DunGrowthProfile {
  stage: 'newcomer' | 'trainee' | 'operator' | 'specialist' | 'senior' | 'principal'
  title: string
  selfIntro: string
  strengths: CapabilityClaim[]
  learningEdges: CapabilityClaim[]
  trustBoundaries: TrustBoundary[]
  highlights: CareerItem[]
  lessons: CareerItem[]
  timeline: GrowthEvent[]
}

export interface DunExecutionState {
  state: 'idle' | 'running' | 'paused' | 'waiting_user' | 'reviewing' | 'error'
  activeTaskId?: string
  activeEpisodeId?: string
  goalLabel?: string
  activeTool?: string
  progressLabel?: string
  progressPercent?: number
  currentStep?: string
  nextAction?: string
  startedAt?: number
  lastActivityAt?: number
  source: 'episode' | 'activeExecution' | 'none'
}

export interface BuildProfileInput {
  dun: DunEntity
  scoring?: DunScoring | null
  experiences?: DunExperience[]
  artifacts?: DunArtifactInfo[]
  episodes?: SopEpisode[]
}

const ABILITY_CONFIG = {
  minEvidenceForValidated: 5,
  minEvidenceForStatistical: 20,
  minWilsonLowerBoundForStrongest: 0.75,
  minWilsonLowerBoundForSafeDelegate: 0.8,
  minAvgConfidenceForValidated: 0.72,
  maxWilsonLowerBoundForLearning: 0.6,
  recentWindowSize: 7,
  decliningFailureRateThreshold: 0.35,
}

export function wilsonLowerBound(passCount: number, totalCount: number, z = 1.96): number {
  if (totalCount <= 0) return 0
  const phat = passCount / totalCount
  const z2 = z * z
  const denominator = 1 + z2 / totalCount
  const centre = phat + z2 / (2 * totalCount)
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * totalCount)) / totalCount)
  return Math.max(0, Math.min(1, (centre - margin) / denominator))
}

export function formatEvidenceLevel(level: EvidenceLevel): string {
  if (level === 'statistical') return '统计显著'
  if (level === 'validated') return '验证证据'
  return '统计推断'
}

export function getEvidenceTone(level: EvidenceLevel): 'stone' | 'blue' | 'emerald' {
  if (level === 'statistical') return 'emerald'
  if (level === 'validated') return 'blue'
  return 'stone'
}

function getRecentTrend(scoring?: DunScoring | null): RecentTrend {
  const runs = scoring?.recentRuns ?? []
  if (runs.length < 3) return 'insufficient_data'

  const windowSize = ABILITY_CONFIG.recentWindowSize
  const recent = runs.slice(-windowSize)
  const previous = runs.slice(-windowSize * 2, -windowSize)
  const recentFailureRate = recent.filter(run => !run.success).length / recent.length
  const hasConsecutiveFailures = recent.slice(-2).length === 2 && recent.slice(-2).every(run => !run.success)

  if (recentFailureRate >= ABILITY_CONFIG.decliningFailureRateThreshold || hasConsecutiveFailures) {
    return 'declining'
  }

  if (previous.length >= 3) {
    const recentPassRate = recent.filter(run => run.success).length / recent.length
    const previousPassRate = previous.filter(run => run.success).length / previous.length
    if (recentPassRate - previousPassRate >= 0.15) return 'improving'
  }

  return 'stable'
}

function getOverallStatus(scoring?: DunScoring | null): DunAbilitySummary['overallStatus'] {
  if (!scoring || scoring.totalRuns === 0) return 'new'
  if (scoring.streak <= -2 || (scoring.totalRuns >= 3 && scoring.successRate < 0.45)) return 'risky'
  if (scoring.totalRuns < 5) return 'learning'
  if (scoring.totalRuns >= 20 && scoring.successRate >= 0.75 && scoring.score >= 70) return 'strong'
  return 'stable'
}

function buildValidatedClaims(episodes: SopEpisode[]): CapabilityClaim[] {
  const groups = new Map<string, SopEpisode[]>()
  for (const episode of episodes) {
    if (!episode.validation?.obligationChecks?.length) continue
    const slice = episode.goalSlice || 'default'
    for (const check of episode.validation.obligationChecks) {
      const key = `${check.obligationId}::${slice}`
      const list = groups.get(key) ?? []
      list.push({
        ...episode,
        validation: {
          ...episode.validation,
          obligationChecks: [check],
        },
      })
      groups.set(key, list)
    }
  }

  const claims: CapabilityClaim[] = []
  for (const [key, groupEpisodes] of groups.entries()) {
    const [obligationId, slice] = key.split('::')
    const firstCheck = groupEpisodes[0]?.validation?.obligationChecks[0]
    const passCount = groupEpisodes.filter(ep => ep.validation?.obligationChecks[0]?.found).length
    const evidenceCount = groupEpisodes.length
    const passRate = evidenceCount > 0 ? passCount / evidenceCount : 0
    const lowerBound = wilsonLowerBound(passCount, evidenceCount)
    const avgConfidence = groupEpisodes.reduce((sum, ep) => sum + (ep.validation?.confidence ?? 0), 0) / evidenceCount
    const lastEpisode = [...groupEpisodes].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]
    const weakObligationIds = passRate < 0.8 ? [obligationId] : []
    const evidenceLevel: EvidenceLevel =
      evidenceCount >= ABILITY_CONFIG.minEvidenceForStatistical &&
      lowerBound >= ABILITY_CONFIG.minWilsonLowerBoundForStrongest
        ? 'statistical'
        : evidenceCount >= ABILITY_CONFIG.minEvidenceForValidated &&
          avgConfidence >= ABILITY_CONFIG.minAvgConfidenceForValidated
          ? 'validated'
          : 'inferred'

    const label = firstCheck?.description || obligationId
    claims.push({
      id: `obligation:${obligationId}:${slice}`,
      label,
      evidenceLevel,
      confidence: Number(Math.min(1, Math.max(0, avgConfidence * lowerBound)).toFixed(2)),
      evidenceCount,
      passRate,
      wilsonLowerBound: lowerBound,
      sourceObligations: [obligationId],
      sourceMetrics: [],
      lastEvidenceAt: lastEpisode?.timestamp || new Date().toISOString(),
      sliceBreakdown: [{
        slice,
        evidenceCount,
        passRate,
        avgValidatorConfidence: avgConfidence,
        wilsonLowerBound: lowerBound,
        recentTrend: 'stable',
        weakObligationIds,
        lastEvidenceAt: lastEpisode?.timestamp || new Date().toISOString(),
      }],
      narrative: evidenceLevel === 'statistical'
        ? `在「${slice}」切片已有 ${evidenceCount} 条验证证据，Wilson 下界 ${(lowerBound * 100).toFixed(0)}%。`
        : `在「${slice}」切片已有 ${evidenceCount} 条验证证据，仍需继续积累样本。`,
    })
  }

  return claims
}

function buildInferredClaims(scoring?: DunScoring | null, metrics: string[] = []): CapabilityClaim[] {
  if (!scoring) return []
  const now = new Date(scoring.lastUpdated || Date.now()).toISOString()
  const toolClaims = Object.values(scoring.dimensions ?? {})
    .filter(dim => dim.calls > 0)
    .sort((a, b) => (b.score - a.score) || (b.calls - a.calls))
    .slice(0, 3)
    .map((dim): CapabilityClaim => {
      const passRate = dim.calls > 0 ? dim.successes / dim.calls : 0
      return {
        id: `tool:${dim.toolName}`,
        label: dim.toolName,
        evidenceLevel: 'inferred',
        confidence: Number(Math.min(0.7, Math.max(0.25, dim.score / 100)).toFixed(2)),
        evidenceCount: dim.calls,
        passRate,
        wilsonLowerBound: wilsonLowerBound(dim.successes, dim.calls),
        sourceObligations: [],
        sourceMetrics: metrics.slice(0, 2),
        lastEvidenceAt: new Date(dim.lastUsedAt || scoring.lastUpdated || Date.now()).toISOString(),
        sliceBreakdown: [{
          slice: 'tool-usage',
          evidenceCount: dim.calls,
          passRate,
          avgValidatorConfidence: 0,
          wilsonLowerBound: wilsonLowerBound(dim.successes, dim.calls),
          recentTrend: 'insufficient_data',
          weakObligationIds: [],
          lastEvidenceAt: new Date(dim.lastUsedAt || scoring.lastUpdated || Date.now()).toISOString(),
        }],
        narrative: `基于工具调用统计推断，${dim.toolName} 已调用 ${dim.calls} 次，成功率 ${(passRate * 100).toFixed(0)}%。`,
      }
    })

  if (toolClaims.length > 0) return toolClaims

  if (scoring.totalRuns > 0) {
    return [{
      id: 'overall:execution-statistics',
      label: '任务执行稳定性',
      evidenceLevel: 'inferred',
      confidence: Number(Math.min(0.68, Math.max(0.2, scoring.successRate)).toFixed(2)),
      evidenceCount: scoring.totalRuns,
      passRate: scoring.successRate,
      wilsonLowerBound: wilsonLowerBound(scoring.successCount, scoring.totalRuns),
      sourceObligations: [],
      sourceMetrics: metrics.slice(0, 2),
      lastEvidenceAt: now,
      sliceBreakdown: [{
        slice: 'overall',
        evidenceCount: scoring.totalRuns,
        passRate: scoring.successRate,
        avgValidatorConfidence: 0,
        wilsonLowerBound: wilsonLowerBound(scoring.successCount, scoring.totalRuns),
        recentTrend: getRecentTrend(scoring),
        weakObligationIds: [],
        lastEvidenceAt: now,
      }],
      narrative: `基于 ${scoring.totalRuns} 次执行统计推断，整体成功率 ${(scoring.successRate * 100).toFixed(0)}%。`,
    }]
  }

  return []
}

export function buildAbilitySummary(input: BuildProfileInput): DunAbilitySummary {
  const { dun, scoring, episodes = [] } = input
  const validatedClaims = buildValidatedClaims(episodes)
  const inferredClaims = buildInferredClaims(scoring, dun.metrics ?? [])
  const allClaims = [...validatedClaims, ...inferredClaims]
    .sort((a, b) => {
      const rank = { statistical: 3, validated: 2, inferred: 1 }
      return (rank[b.evidenceLevel] - rank[a.evidenceLevel]) || (b.confidence - a.confidence)
    })

  const strongest = allClaims
    .filter(claim => claim.evidenceLevel !== 'inferred' || claim.evidenceCount > 0)
    .slice(0, 3)

  const learningFromClaims = allClaims.filter(claim =>
    claim.evidenceLevel !== 'statistical' &&
    (claim.evidenceCount < ABILITY_CONFIG.minEvidenceForValidated ||
      (claim.wilsonLowerBound ?? 0) < ABILITY_CONFIG.maxWilsonLowerBoundForLearning)
  )

  const failureRuns = scoring?.recentRuns?.filter(run => !run.success).slice(-3) ?? []
  const learning = [
    ...learningFromClaims,
    ...failureRuns.map((run): CapabilityClaim => ({
      id: `run:${run.runId}`,
      label: run.task || '失败样本',
      evidenceLevel: 'inferred',
      confidence: 0.35,
      evidenceCount: 1,
      passRate: 0,
      wilsonLowerBound: 0,
      sourceObligations: [],
      sourceMetrics: [],
      lastEvidenceAt: new Date(run.timestamp).toISOString(),
      sliceBreakdown: [],
      narrative: `最近一次执行未通过，需要复核：${run.task}`,
    })),
  ].slice(0, 3)

  const safeToDelegate = strongest
    .filter(claim =>
      claim.evidenceLevel === 'statistical' &&
      (claim.wilsonLowerBound ?? 0) >= ABILITY_CONFIG.minWilsonLowerBoundForSafeDelegate
    )
    .map((claim): TrustAdviceItem => ({
      taskType: claim.label,
      slice: claim.sliceBreakdown[0]?.slice,
      trustLevel: 'safe',
      reason: claim.narrative,
      sourceCapabilityIds: [claim.id],
      evidenceLevel: claim.evidenceLevel,
    }))

  const needsReview: TrustAdviceItem[] = []
  if (safeToDelegate.length === 0) {
    needsReview.push({
      taskType: dun.objective || dun.label || dun.id,
      trustLevel: scoring && scoring.totalRuns > 0 ? 'assist' : 'not_ready',
      reason: scoring && scoring.totalRuns > 0
        ? '当前能力摘要主要来自执行统计推断，关键结论仍建议人工复核。'
        : '还没有足够执行样本，暂不应作为独立委托对象。',
      sourceCapabilityIds: strongest.map(claim => claim.id),
      evidenceLevel: 'inferred',
    })
  }

  for (const claim of learning) {
    needsReview.push({
      taskType: claim.label,
      slice: claim.sliceBreakdown[0]?.slice,
      trustLevel: 'needs_review',
      reason: claim.narrative,
      sourceCapabilityIds: [claim.id],
      evidenceLevel: claim.evidenceLevel,
    })
  }

  return {
    overallStatus: getOverallStatus(scoring),
    strongest,
    learning,
    trustAdvice: {
      safeToDelegate,
      needsReview: needsReview.slice(0, 4),
    },
    recentTrend: getRecentTrend(scoring),
  }
}

function getGrowthStage(input: BuildProfileInput, summary: DunAbilitySummary): DunGrowthProfile['stage'] {
  const runs = input.scoring?.totalRuns ?? 0
  const score = input.scoring?.score ?? 0
  if (summary.trustAdvice.safeToDelegate.length > 0 && runs >= 40 && score >= 85) return 'principal'
  if (runs >= 30 && score >= 75) return 'senior'
  if (runs >= 20 && score >= 65) return 'specialist'
  if (runs >= 8 && score >= 45) return 'operator'
  if (runs >= 2) return 'trainee'
  return 'newcomer'
}

function getStageTitle(stage: DunGrowthProfile['stage']): string {
  const labels: Record<DunGrowthProfile['stage'], string> = {
    newcomer: '新入职专家',
    trainee: '见习执行员',
    operator: '稳定执行员',
    specialist: '专项专家',
    senior: '资深专家',
    principal: '主理专家',
  }
  return labels[stage]
}

function buildHighlights(input: BuildProfileInput): CareerItem[] {
  const successExperiences = (input.experiences ?? [])
    .filter(exp => exp.outcome === 'success')
    .slice(0, 3)
    .map((exp, index): CareerItem => ({
      id: `experience-success-${index}`,
      kind: 'highlight',
      title: exp.title,
      summary: exp.content || '一次被记录为成功的执行经验。',
      evidenceLevel: 'inferred',
    }))

  const artifactHighlights = (input.artifacts ?? [])
    .slice(0, Math.max(0, 3 - successExperiences.length))
    .map((artifact): CareerItem => ({
      id: `artifact-${artifact.path}`,
      kind: 'highlight',
      title: artifact.name,
      summary: artifact.description || `产出文件：${artifact.type || 'artifact'}`,
      sourceArtifactIds: [artifact.path],
      evidenceLevel: 'inferred',
    }))

  return [...successExperiences, ...artifactHighlights]
}

function buildLessons(input: BuildProfileInput): CareerItem[] {
  const failedExperiences = (input.experiences ?? [])
    .filter(exp => exp.outcome === 'failure')
    .slice(0, 2)
    .map((exp, index): CareerItem => ({
      id: `experience-failure-${index}`,
      kind: 'lesson',
      title: exp.title,
      summary: exp.content || '一次需要复盘的执行经验。',
      learnedChange: '需要更多 validator / 用户反馈后才能沉淀为正式成长事件。',
      evidenceLevel: 'inferred',
    }))

  const failedRuns = (input.scoring?.recentRuns ?? [])
    .filter(run => !run.success)
    .slice(-2)
    .map((run): CareerItem => ({
      id: `run-failure-${run.runId}`,
      kind: 'lesson',
      title: run.task || '失败执行',
      summary: `执行扣分 ${run.scoreChange}，耗时 ${Math.round(run.durationMs / 1000)}s。`,
      learnedChange: '当前只是执行统计推断，仍需 obligation 证据确认具体教训。',
      evidenceLevel: 'inferred',
    }))

  return [...failedExperiences, ...failedRuns].slice(0, 3)
}

function buildGrowthTimeline(input: BuildProfileInput, summary: DunAbilitySummary): GrowthEvent[] {
  const events: GrowthEvent[] = []
  const { dun, scoring } = input

  if (dun.sopRewriteInfo) {
    events.push({
      id: `sop-rewrite-${dun.sopRewriteInfo.rewrittenAt}`,
      date: new Date(dun.sopRewriteInfo.rewrittenAt).toISOString(),
      kind: 'sop_patch',
      title: 'SOP 调整',
      firstPersonSummary: `我根据 ${dun.sopRewriteInfo.basedOnExecutions || '?'} 次执行信号调整了 SOP。当前只展示契约变更，不把它包装成已验证能力。`,
      sourceEpisodeIds: [],
      evidenceLevel: 'validated',
    })
  }

  if (summary.strongest.length > 0) {
    const claim = summary.strongest[0]
    events.push({
      id: `capability-${claim.id}`,
      date: claim.lastEvidenceAt,
      kind: 'success_pattern',
      title: claim.label,
      firstPersonSummary: claim.evidenceLevel === 'inferred'
        ? `我在执行统计里呈现出「${claim.label}」相关倾向，但还需要验证证据确认。`
        : `我在「${claim.label}」上已经积累了可追溯证据。`,
      sourceEpisodeIds: [],
      evidenceLevel: claim.evidenceLevel,
    })
  }

  const latestFailure = [...(scoring?.recentRuns ?? [])].reverse().find(run => !run.success)
  if (latestFailure) {
    events.push({
      id: `lesson-${latestFailure.runId}`,
      date: new Date(latestFailure.timestamp).toISOString(),
      kind: 'failure_lesson',
      title: '待复盘样本',
      firstPersonSummary: `我在「${latestFailure.task}」里出现了失败信号，这还只是统计记录，不能直接写成我已经学会了什么。`,
      sourceEpisodeIds: [],
      evidenceLevel: 'inferred',
    })
  }

  return events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)
}

export function buildGrowthProfile(input: BuildProfileInput): DunGrowthProfile {
  const ability = buildAbilitySummary(input)
  const stage = getGrowthStage(input, ability)
  const title = getStageTitle(stage)
  const strongest = ability.strongest[0]

  const selfIntro = strongest
    ? strongest.evidenceLevel === 'inferred'
      ? `我正在围绕「${strongest.label}」积累执行样本，目前这些结论仍是统计推断。`
      : `我已经在「${strongest.label}」上留下可追溯证据，会继续按 SOP 保持这条能力边界。`
    : '我还需要更多任务样本，才能形成可靠的能力画像。'

  return {
    stage,
    title,
    selfIntro,
    strengths: ability.strongest,
    learningEdges: ability.learning,
    trustBoundaries: [
      ...ability.trustAdvice.safeToDelegate,
      ...ability.trustAdvice.needsReview,
    ].map(item => ({
      taskType: item.taskType,
      trustLevel: item.trustLevel,
      reason: item.reason,
      escalationRule: item.trustLevel === 'safe' ? undefined : '关键产出交付前请人工复核。',
    })),
    highlights: buildHighlights(input),
    lessons: buildLessons(input),
    timeline: buildGrowthTimeline(input, ability),
  }
}

export function selectDunExecutionState(
  dunId: string,
  activeExecutions: TaskItem[],
  tasks: TaskItem[] = [],
): DunExecutionState {
  const allTasks = [...activeExecutions, ...tasks]
  const task = allTasks.find(item => {
    const matchesDun =
      item.taskPlan?.dunId === dunId ||
      item.checkpoint?.dunId === dunId
    return matchesDun && ['executing', 'retrying', 'paused', 'error'].includes(item.status)
  })

  if (!task) {
    return { state: 'idle', source: 'none' }
  }

  const subTasks = task.taskPlan?.subTasks ?? []
  const doneCount = subTasks.filter(sub => sub.status === 'done' || sub.status === 'skipped').length
  const activeSubTask = subTasks.find(sub => sub.status === 'executing' || sub.status === 'paused_for_approval')
  const progressPercent = task.taskPlan
    ? task.taskPlan.progress
    : subTasks.length > 0
      ? Math.round((doneCount / subTasks.length) * 100)
      : undefined

  const state: DunExecutionState['state'] =
    task.status === 'paused'
      ? 'paused'
      : task.status === 'error'
        ? 'error'
        : activeSubTask?.status === 'paused_for_approval'
          ? 'waiting_user'
          : 'running'

  return {
    state,
    activeTaskId: task.id,
    goalLabel: task.taskPlan?.title || task.title || task.description,
    progressLabel: subTasks.length > 0 ? `${doneCount}/${subTasks.length}` : undefined,
    progressPercent,
    currentStep: activeSubTask?.description,
    nextAction: state === 'waiting_user' ? activeSubTask?.approvalReason : undefined,
    startedAt: task.startedAt,
    lastActivityAt: task.completedAt || task.startedAt,
    source: 'activeExecution',
  }
}
