/**
 * SOP Authoring Validator (v2)
 *
 * 校验 SOP 文档(Markdown + YAML frontmatter)是否符合 v2 设计规范:
 *  - frontmatter 必须含 name / version / archetype 等基础字段
 *  - metrics 必须 ≥ 1 项 type=semantic(legacy 字符串形式视为 semantic)
 *  - obligations 字段建议存在;若存在,每项必须含 id / description / evidenceType / evidenceMatcher
 *  - evidenceType 必须在 6 种合法值之内
 *
 * 不依赖外部 YAML 库,内置最小化解析(只支持 SOP frontmatter 实际使用的子集)。
 */

import type {
  SopAuthoringIssue,
  SopAuthoringResult,
  SopEvidenceType,
  SopMetricDef,
  SopMetricType,
  SopObligationDef,
} from '../types'

const VALID_EVIDENCE_TYPES: SopEvidenceType[] = [
  'tool_call',
  'artifact',
  'semantic',
  'data_provenance',
  'reasoning_trace',
  'evidence_completeness',
]

const VALID_METRIC_TYPES: SopMetricType[] = ['structural', 'semantic', 'quantitative']

// ---------- 内置 mini-YAML 工具 ----------

/**
 * 提取 frontmatter(--- 包裹的 YAML 块)。
 */
function extractFrontmatter(raw: string): string | null {
  const m = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/)
  return m ? m[1] : null
}

/**
 * 提取顶层字段 `<name>:` 之后的缩进块(直到下一个顶层字段或文件结尾)。
 */
function findFieldBlock(yaml: string, fieldName: string): string | null {
  const lines = yaml.split(/\r?\n/)
  const headRe = new RegExp(`^${fieldName}\\s*:\\s*$`)
  const startIdx = lines.findIndex((l) => headRe.test(l))
  if (startIdx === -1) return null
  const out: string[] = []
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    // 顶层字段一定从行首开始(无前导空格)
    if (/^[A-Za-z_]/.test(line)) break
    out.push(line)
  }
  return out.join('\n')
}

/**
 * 解析 YAML 列表块,返回字符串项或对象项(每项是 dash 起始)。
 * 支持两种形式:
 *   - 简单字符串:  - "xxx"
 *   - 对象:        - id: foo
 *                    description: bar
 */
function parseYamlList(block: string): Array<string | Record<string, string>> {
  const lines = block.split(/\r?\n/)
  const items: Array<string | Record<string, string>> = []
  let current: Record<string, string> | null = null

  const flush = () => {
    if (current) {
      items.push(current)
      current = null
    }
  }

  for (const raw of lines) {
    const dashMatch = raw.match(/^(\s*)-\s+(.*)$/)
    if (dashMatch) {
      flush()
      const rest = dashMatch[2]
      const kvMatch = rest.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
      if (kvMatch) {
        current = { [kvMatch[1]]: stripQuotes(kvMatch[2].trim()) }
      } else {
        items.push(stripQuotes(rest.trim()))
      }
      continue
    }
    // 对象续行(必须比 dash 缩进更深)
    const contMatch = raw.match(/^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (contMatch && current) {
      current[contMatch[1]] = stripQuotes(contMatch[2].trim())
    }
  }
  flush()
  return items
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

// ---------- 字段解析 ----------

function parseMetrics(fm: string): SopMetricDef[] {
  const block = findFieldBlock(fm, 'metrics')
  if (!block) return []
  const raw = parseYamlList(block)
  return raw.map((item, i): SopMetricDef => {
    if (typeof item === 'string') {
      // legacy 字符串形式:视为 semantic 类型,description 即原文
      return {
        name: `metric_${i + 1}`,
        description: item,
        type: 'semantic',
      }
    }
    const declared = item.type as SopMetricType | undefined
    return {
      name: item.name || `metric_${i + 1}`,
      description: item.description || '',
      type: declared && VALID_METRIC_TYPES.includes(declared) ? declared : 'semantic',
      threshold: item.threshold,
    }
  })
}

function parseObligations(fm: string): SopObligationDef[] {
  const block = findFieldBlock(fm, 'obligations')
  if (!block) return []
  const raw = parseYamlList(block)
  return raw
    .filter((item): item is Record<string, string> => typeof item === 'object')
    .map((item, i): SopObligationDef => ({
      id: item.id || `obligation_${i + 1}`,
      description: item.description || '',
      evidenceType: (item.evidenceType as SopEvidenceType) || 'semantic',
      evidenceMatcher: item.evidenceMatcher || '',
    }))
}

// ---------- 公开 API ----------

export interface ValidateSopOptions {
  /** 文件路径或 sopId,出错时附带在 issue.location 中辅助定位 */
  sourceHint?: string
  /** 是否对缺失 obligations 段以 error 而非 warning 报告(默认 false:warning) */
  strictRequireObligations?: boolean
}

export function validateSopMarkdown(
  raw: string,
  options: ValidateSopOptions = {},
): SopAuthoringResult {
  const errors: SopAuthoringIssue[] = []
  const warnings: SopAuthoringIssue[] = []
  const where = options.sourceHint

  const fm = extractFrontmatter(raw)
  if (!fm) {
    errors.push({
      level: 'error',
      code: 'no_frontmatter',
      message: 'SOP 必须以 YAML frontmatter 开头(--- 包裹)',
      location: where,
    })
    return { ok: false, errors, warnings }
  }

  const sopId = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const version = fm.match(/^version:\s*(.+)$/m)?.[1]?.trim()
  const sopType = fm.match(/^archetype:\s*(.+)$/m)?.[1]?.trim()

  if (!sopId) {
    errors.push({
      level: 'error',
      code: 'missing_name',
      message: 'frontmatter 缺 name 字段',
      location: where,
    })
  }
  if (!version) {
    warnings.push({
      level: 'warning',
      code: 'missing_version',
      message: 'frontmatter 建议加 version 字段(semver,例如 1.0.0)',
      location: where,
    })
  }

  const metrics = parseMetrics(fm)
  const obligations = parseObligations(fm)

  // metrics 校验
  if (metrics.length === 0) {
    warnings.push({
      level: 'warning',
      code: 'no_metrics',
      message: 'metrics 字段为空,evidence-aware validator 的 quality pillar 将无判据',
      location: where,
    })
  } else {
    const hasSemantic = metrics.some((m) => m.type === 'semantic')
    if (!hasSemantic) {
      errors.push({
        level: 'error',
        code: 'no_semantic_metric',
        message: 'v2 要求 metrics 至少含 1 项 type=semantic(legacy 字符串形式自动视为 semantic)',
        location: where,
      })
    }
  }

  // obligations 校验
  if (obligations.length === 0) {
    const issue: SopAuthoringIssue = {
      level: options.strictRequireObligations ? 'error' : 'warning',
      code: 'no_obligations',
      message:
        'obligations 段缺失或为空 — validator 会跳过 evidence pillar 判定,episode confidence 将被强制降至 0.3',
      location: where,
    }
    if (options.strictRequireObligations) errors.push(issue)
    else warnings.push(issue)
  } else {
    obligations.forEach((o, i) => {
      const loc = `${where ? `${where} ` : ''}obligations[${i}]${o.id ? ` (${o.id})` : ''}`
      if (!o.id || /^obligation_\d+$/.test(o.id)) {
        warnings.push({
          level: 'warning',
          code: 'obligation_id_missing',
          message: 'obligation 缺 id 字段(已使用占位 id)',
          location: loc,
        })
      }
      if (!o.description) {
        errors.push({
          level: 'error',
          code: 'obligation_no_description',
          message: 'obligation 缺 description 字段',
          location: loc,
        })
      }
      if (!o.evidenceType) {
        errors.push({
          level: 'error',
          code: 'obligation_no_evidence_type',
          message: 'obligation 缺 evidenceType 字段',
          location: loc,
        })
      } else if (!VALID_EVIDENCE_TYPES.includes(o.evidenceType)) {
        errors.push({
          level: 'error',
          code: 'invalid_evidence_type',
          message: `obligation evidenceType="${o.evidenceType}" 不在合法集 [${VALID_EVIDENCE_TYPES.join(', ')}]`,
          location: loc,
        })
      }
      if (!o.evidenceMatcher) {
        errors.push({
          level: 'error',
          code: 'obligation_no_matcher',
          message: 'obligation 缺 evidenceMatcher 字段',
          location: loc,
        })
      }
    })
  }

  // sections 提取(用于 patch section anchor 校验)
  const sectionsFound: string[] = []
  const sectionRe = /^##+\s+(.+)$/gm
  let secMatch: RegExpExecArray | null
  while ((secMatch = sectionRe.exec(raw)) !== null) {
    sectionsFound.push(secMatch[1].trim())
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    parsed: {
      sopId,
      version,
      sopType,
      metrics,
      obligations,
      sectionsFound,
    },
  }
}

/**
 * 便捷判定:校验通过(无 error)即视为 ok。
 */
export function isSopValid(raw: string, options?: ValidateSopOptions): boolean {
  return validateSopMarkdown(raw, options).ok
}
