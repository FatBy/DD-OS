import type { TaskItem, ExecutionStep } from '../types'

// ============================================
// 执行摘要结构化输出
// ============================================

export interface ExecutionSummary {
  title: string
  status: 'success' | 'partial' | 'failed'
  duration: number
  findings: string[]
  toolStats: { total: number; success: number; failed: number }
  toolBreakdown: { name: string; count: number; avgLatency: number }[]
  createdFiles: { filePath: string; fileName: string }[]
  rawOutput: string
}

// ============================================
// 主解析函数
// ============================================

export function parseExecutionSummary(task: TaskItem): ExecutionSummary {
  const steps = task.executionSteps ?? []
  const output = task.executionOutput ?? ''

  const title = parseTitleFromOutput(output) || task.title
  const status = deriveStatus(task)
  const duration = task.executionDuration ?? computeDuration(steps)
  const findings = parseFindingsFromOutput(output)
  const toolStats = computeToolStats(steps)
  const toolBreakdown = computeToolBreakdown(steps)
  const createdFiles = extractCreatedFiles(steps)

  return {
    title,
    status,
    duration,
    findings,
    toolStats,
    toolBreakdown,
    createdFiles,
    rawOutput: output,
  }
}

// ============================================
// 内部解析工具
// ============================================

/** 从 Markdown 输出提取标题（第一个 # 标题） */
function parseTitleFromOutput(output: string): string {
  const match = output.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : ''
}

/** 从 Markdown 输出提取 findings（- 列表项） */
function parseFindingsFromOutput(output: string): string[] {
  const findings: string[] = []
  const lines = output.split('\n')
  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+(.+)$/)
    if (match) {
      findings.push(match[1].trim())
    }
  }
  // 清理 Markdown 加粗/斜体标记
  return findings.map(f => f.replace(/\*\*/g, '').replace(/\*/g, '').trim())
}

/** 根据任务状态和工具结果推导摘要状态 */
function deriveStatus(task: TaskItem): ExecutionSummary['status'] {
  if (task.status === 'done') {
    const steps = task.executionSteps ?? []
    const hasError = steps.some(s => s.type === 'error')
    return hasError ? 'partial' : 'success'
  }
  if (task.status === 'error' || task.status === 'terminated') {
    return 'failed'
  }
  // executing / retrying / paused 等中间态视为 partial
  return 'partial'
}

/** 从步骤时间戳计算总耗时 (ms) */
function computeDuration(steps: ExecutionStep[]): number {
  if (steps.length === 0) return 0
  const first = steps[0].timestamp
  const last = steps[steps.length - 1].timestamp
  return last - first
}

/** 统计工具调用成功/失败数 */
function computeToolStats(steps: ExecutionStep[]): ExecutionSummary['toolStats'] {
  const toolCalls = steps.filter(s => s.type === 'tool_call')
  const total = toolCalls.length

  // 对每个 tool_call，查找紧随其后的 tool_result 或 error
  let failed = 0
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].type === 'tool_call') {
      // 向后查找对应结果
      const next = steps[i + 1]
      if (next && next.type === 'error') {
        failed++
      }
    }
  }

  return { total, success: total - failed, failed }
}

/** 按工具名分组统计调用次数和平均耗时 */
function computeToolBreakdown(steps: ExecutionStep[]): ExecutionSummary['toolBreakdown'] {
  const map = new Map<string, { count: number; totalLatency: number }>()

  for (const step of steps) {
    if (step.type === 'tool_call' && step.toolName) {
      const entry = map.get(step.toolName) ?? { count: 0, totalLatency: 0 }
      entry.count++
      entry.totalLatency += step.duration ?? 0
      map.set(step.toolName, entry)
    }
  }

  return Array.from(map.entries()).map(([name, { count, totalLatency }]) => ({
    name,
    count,
    avgLatency: count > 0 ? Math.round(totalLatency / count) : 0,
  }))
}

/** 从工具调用步骤中提取创建的文件 */
function extractCreatedFiles(steps: ExecutionStep[]): ExecutionSummary['createdFiles'] {
  const FILE_TOOLS = ['writeFile', 'createFile', 'appendFile']
  const seen = new Set<string>()
  const files: ExecutionSummary['createdFiles'] = []

  for (const step of steps) {
    if (step.type === 'tool_call' && step.toolName && FILE_TOOLS.includes(step.toolName)) {
      const filePath = extractFilePath(step.toolArgs)
      if (filePath && !seen.has(filePath)) {
        seen.add(filePath)
        files.push({ filePath, fileName: getFileName(filePath) })
      }
    }
  }

  return files
}

/** 从工具参数中提取文件路径 */
function extractFilePath(args?: Record<string, unknown>): string {
  if (!args) return ''
  // 常见参数名: path, filePath, file
  const candidates = ['path', 'filePath', 'file', 'filename']
  for (const key of candidates) {
    if (typeof args[key] === 'string') return args[key] as string
  }
  return ''
}

/** 从完整路径提取文件名 */
function getFileName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}
