import { useState, useEffect, useCallback, Fragment } from 'react'
import { motion } from 'framer-motion'
import {
  Activity, Shield, TrendingUp, Zap, RotateCcw,
  CheckCircle2, XCircle, AlertTriangle, RefreshCw,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { getServerUrl } from '@/utils/env'
import { baseSequenceGovernor } from '@/services/baseSequenceGovernor'

const SERVER_URL = getServerUrl()

const BASES = ['X', 'E', 'P', 'V'] as const
const BASE_LABELS: Record<string, string> = { X: '探索', E: '执行', P: '规划', V: '验证' }
const BASE_COLORS: Record<string, string> = {
  X: '#8b5cf6', E: '#3b82f6', P: '#f59e0b', V: '#10b981',
}

interface TransitionCell {
  from: string
  to: string
  sr: number
  count: number
}

interface RuleLifecycle {
  id: string
  name: string
  lifecycle: string
  responseRate: number
  effectPP: number
  hitCount: number
}

interface InjectionStats {
  rule: string
  respondedCount: number
  ignoredCount: number
  respondedSR: number
  ignoredSR: number
}

interface RecoveryOverview {
  totalFailures: number
  adaptiveCount: number
  blindRetryCount: number
  adaptiveSR: number
  blindRetrySR: number
}

interface DashboardData {
  transitions: TransitionCell[]
  injectionStats: InjectionStats[]
  ruleLifecycles: RuleLifecycle[]
  recovery: RecoveryOverview
  totalTraces: number
  interventionRate: number
  cooldownSuppressions: number
  recoverySuppressions: number
}

function srToColor(sr: number): string {
  if (sr >= 0.9) return '#10b981'
  if (sr >= 0.8) return '#34d399'
  if (sr >= 0.7) return '#fbbf24'
  if (sr >= 0.6) return '#f97316'
  return '#ef4444'
}

function srToBg(sr: number): string {
  if (sr >= 0.9) return 'bg-emerald-50'
  if (sr >= 0.8) return 'bg-emerald-50/50'
  if (sr >= 0.7) return 'bg-amber-50'
  if (sr >= 0.6) return 'bg-orange-50'
  return 'bg-red-50'
}

// ---- Transition Heatmap ----

function TransitionHeatmap({ transitions }: { transitions: TransitionCell[] }) {
  const getCell = (from: string, to: string) =>
    transitions.find(t => t.from === from && t.to === to)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="rounded-2xl bg-white/60 backdrop-blur-sm border border-white/40 p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-indigo-500" />
        <span className="text-sm font-semibold text-stone-700">转移概率热力图</span>
        <span className="text-xs text-stone-400 ml-auto">行=当前 → 列=下一步</span>
      </div>

      <div className="grid grid-cols-5 gap-1">
        {/* Header row */}
        <div className="w-10 h-10" />
        {BASES.map(b => (
          <div key={`h-${b}`} className="flex items-center justify-center h-10">
            <span className="text-xs font-bold font-mono" style={{ color: BASE_COLORS[b] }}>
              {b}
            </span>
          </div>
        ))}

        {/* Data rows */}
        {BASES.map(from => (
          <Fragment key={`row-${from}`}>
            <div className="flex items-center justify-center w-10 h-16">
              <span className="text-xs font-bold font-mono" style={{ color: BASE_COLORS[from] }}>
                {from}
              </span>
            </div>
            {BASES.map(to => {
              const cell = getCell(from, to)
              const sr = cell?.sr ?? 0
              const count = cell?.count ?? 0
              return (
                <motion.div
                  key={`${from}-${to}`}
                  className={cn(
                    'relative flex flex-col items-center justify-center h-16 rounded-xl border transition-all cursor-default group',
                    count > 0 ? srToBg(sr) : 'bg-stone-50/50',
                    count > 0 ? 'border-stone-200/60' : 'border-stone-100',
                  )}
                  whileHover={{ scale: 1.05 }}
                >
                  {count > 0 ? (
                    <>
                      <span
                        className="text-lg font-bold font-mono leading-none"
                        style={{ color: srToColor(sr) }}
                      >
                        {(sr * 100).toFixed(0)}
                      </span>
                      <span className="text-[10px] text-stone-400 mt-0.5">n={count}</span>
                    </>
                  ) : (
                    <span className="text-xs text-stone-300">—</span>
                  )}
                  {/* Tooltip */}
                  <div className="absolute -top-10 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                    <div className="bg-stone-800 text-white text-[10px] rounded-lg px-2 py-1 whitespace-nowrap shadow-lg">
                      {BASE_LABELS[from]}→{BASE_LABELS[to]}: SR {(sr * 100).toFixed(1)}%
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </motion.div>
  )
}

// ---- Injection Response Ring ----

function ResponseRing({ responded, ignored, size = 80 }: { responded: number; ignored: number; size?: number }) {
  const total = responded + ignored
  const rate = total > 0 ? responded / total : 0
  const R = (size / 2) - 6, STROKE = 5, C = 2 * Math.PI * R
  const filled = rate * C

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size/2} cy={size/2} r={R} fill="none" stroke="#e7e5e4" strokeWidth={STROKE} opacity={0.4} />
        <circle
          cx={size/2} cy={size/2} r={R}
          fill="none"
          stroke={rate >= 0.5 ? '#10b981' : rate >= 0.3 ? '#f59e0b' : '#ef4444'}
          strokeWidth={STROKE}
          strokeDasharray={`${filled} ${C - filled}`}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold font-mono leading-none text-stone-700">
          {(rate * 100).toFixed(0)}%
        </span>
        <span className="text-[9px] text-stone-400">响应</span>
      </div>
    </div>
  )
}

function InjectionResponseSection({ stats }: { stats: InjectionStats[] }) {
  if (stats.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl bg-white/60 backdrop-blur-sm border border-white/40 p-5"
      >
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-emerald-500" />
          <span className="text-sm font-semibold text-stone-700">注入响应追踪</span>
        </div>
        <p className="text-xs text-stone-400 text-center py-6">等待注入数据积累…</p>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="rounded-2xl bg-white/60 backdrop-blur-sm border border-white/40 p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-emerald-500" />
        <span className="text-sm font-semibold text-stone-700">注入响应追踪</span>
      </div>

      <div className="space-y-3">
        {stats.map(s => {
          const total = s.respondedCount + s.ignoredCount
          return (
            <div key={s.rule} className="flex items-center gap-3 py-2 px-3 rounded-xl bg-white/50 border border-stone-100">
              <ResponseRing responded={s.respondedCount} ignored={s.ignoredCount} size={48} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-stone-700 truncate">
                  {s.rule.replace(/_/g, ' ')}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-stone-400">
                    响应 {s.respondedCount}/{total}
                  </span>
                  {s.respondedSR > 0 && (
                    <span className="text-[10px] text-emerald-600">
                      响应SR {(s.respondedSR * 100).toFixed(0)}%
                    </span>
                  )}
                  {s.ignoredSR > 0 && (
                    <span className="text-[10px] text-stone-500">
                      忽略SR {(s.ignoredSR * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
              {s.respondedSR > s.ignoredSR ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              ) : total >= 5 ? (
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              ) : null}
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}

// ---- Rule Lifecycle Cards ----

const LIFECYCLE_META: Record<string, { label: string; color: string; bg: string }> = {
  candidate: { label: '候选', color: 'text-stone-500', bg: 'bg-stone-100' },
  distilled: { label: '蒸馏', color: 'text-blue-600', bg: 'bg-blue-50' },
  observing: { label: '观测中', color: 'text-amber-600', bg: 'bg-amber-50' },
  validated: { label: '已验证', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  retired: { label: '已退役', color: 'text-stone-400', bg: 'bg-stone-50' },
}

function RuleLifecycleSection({ rules }: { rules: RuleLifecycle[] }) {
  if (rules.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl bg-white/60 backdrop-blur-sm border border-white/40 p-5"
      >
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-purple-500" />
          <span className="text-sm font-semibold text-stone-700">规则生命周期</span>
        </div>
        <p className="text-xs text-stone-400 text-center py-6">暂无数据发现规则</p>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="rounded-2xl bg-white/60 backdrop-blur-sm border border-white/40 p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-4 h-4 text-purple-500" />
        <span className="text-sm font-semibold text-stone-700">规则生命周期</span>
        <span className="text-xs text-stone-400 font-mono bg-stone-100 px-1.5 py-0.5 rounded-full ml-auto">
          {rules.length} 条
        </span>
      </div>

      <div className="space-y-2">
        {rules.map(rule => {
          const meta = LIFECYCLE_META[rule.lifecycle] || LIFECYCLE_META.candidate
          return (
            <div key={rule.id} className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-white/50 border border-stone-100">
              <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', meta.bg, meta.color)}>
                {meta.label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-stone-700 truncate">{rule.name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-stone-400">命中 {rule.hitCount}</span>
                  {rule.effectPP !== 0 && (
                    <span className={cn('text-[10px] font-mono', rule.effectPP > 0 ? 'text-emerald-600' : 'text-red-500')}>
                      {rule.effectPP > 0 ? '+' : ''}{rule.effectPP.toFixed(1)}pp
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs font-mono text-stone-600">
                  {(rule.responseRate * 100).toFixed(0)}%
                </span>
                <span className="block text-[9px] text-stone-400">响应率</span>
              </div>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}

// ---- Recovery Signal Overview ----

function RecoverySection({ recovery }: { recovery: RecoveryOverview }) {
  const adaptiveRate = recovery.totalFailures > 0
    ? (recovery.adaptiveCount / recovery.totalFailures)
    : 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="rounded-2xl bg-white/60 backdrop-blur-sm border border-white/40 p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <RotateCcw className="w-4 h-4 text-teal-500" />
        <span className="text-sm font-semibold text-stone-700">自修复信号 (C)</span>
      </div>

      {recovery.totalFailures === 0 ? (
        <p className="text-xs text-stone-400 text-center py-6">暂无失败记录</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center py-3 px-2 rounded-xl bg-teal-50/60 border border-teal-100">
            <span className="text-lg font-bold font-mono text-teal-600">
              {(adaptiveRate * 100).toFixed(0)}%
            </span>
            <span className="text-[10px] text-stone-500 mt-1">适应性修复率</span>
          </div>
          <div className="flex flex-col items-center py-3 px-2 rounded-xl bg-emerald-50/60 border border-emerald-100">
            <span className="text-lg font-bold font-mono text-emerald-600">
              {(recovery.adaptiveSR * 100).toFixed(0)}%
            </span>
            <span className="text-[10px] text-stone-500 mt-1">修复后 SR</span>
          </div>
          <div className="flex flex-col items-center py-3 px-2 rounded-xl bg-red-50/60 border border-red-100">
            <span className="text-lg font-bold font-mono text-red-500">
              {(recovery.blindRetrySR * 100).toFixed(0)}%
            </span>
            <span className="text-[10px] text-stone-500 mt-1">盲重试 SR</span>
          </div>
        </div>
      )}

      {recovery.totalFailures > 0 && (
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-stone-100">
          <span className="text-[10px] text-stone-400">
            总失败 {recovery.totalFailures}
          </span>
          <span className="text-[10px] text-teal-600">
            适应 {recovery.adaptiveCount}
          </span>
          <span className="text-[10px] text-red-400">
            盲试 {recovery.blindRetryCount}
          </span>
        </div>
      )}
    </motion.div>
  )
}

// ---- Summary Header ----

function SummaryHeader({ data }: { data: DashboardData }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-gradient-to-r from-indigo-50/60 via-white/40 to-teal-50/60 backdrop-blur-sm border border-white/40 p-5"
    >
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-indigo-500" />
        <span className="text-sm font-semibold text-stone-700">Governor V5 信息顾问</span>
        <span className="text-xs text-stone-400 font-mono bg-white/60 px-2 py-0.5 rounded-full ml-auto">
          {data.totalTraces} traces
        </span>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="flex flex-col items-center py-2">
          <span className="text-xl font-bold font-mono text-indigo-600">
            {(data.interventionRate * 100).toFixed(1)}%
          </span>
          <span className="text-[10px] text-stone-500 mt-0.5">干预率</span>
        </div>
        <div className="flex flex-col items-center py-2">
          <span className="text-xl font-bold font-mono text-teal-600">
            {data.recoverySuppressions}
          </span>
          <span className="text-[10px] text-stone-500 mt-0.5">C 抑制次数</span>
        </div>
        <div className="flex flex-col items-center py-2">
          <span className="text-xl font-bold font-mono text-amber-600">
            {data.cooldownSuppressions}
          </span>
          <span className="text-[10px] text-stone-500 mt-0.5">冷却抑制</span>
        </div>
        <div className="flex flex-col items-center py-2">
          <span className="text-xl font-bold font-mono text-purple-600">
            {data.ruleLifecycles.filter(r => r.lifecycle === 'validated').length}
          </span>
          <span className="text-[10px] text-stone-500 mt-0.5">有效规则</span>
        </div>
      </div>
    </motion.div>
  )
}

// ---- Main Dashboard ----

export function GovernorDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const stats = baseSequenceGovernor.getFullStats()
      const transitionStats = stats.transitionStats || {}
      const injectionResponseStats = stats.injectionResponseStats || {}

      // Build transition cells
      const transitions: TransitionCell[] = []
      for (const from of BASES) {
        for (const to of BASES) {
          const key = `${from}->${to}`
          const s = transitionStats[key]
          if (s && s.totalCount > 0) {
            transitions.push({
              from, to,
              sr: s.successCount / s.totalCount,
              count: s.totalCount,
            })
          } else {
            transitions.push({ from, to, sr: 0, count: 0 })
          }
        }
      }

      // Build injection stats
      const injectionStats: InjectionStats[] = Object.entries(injectionResponseStats).map(([rule, s]) => ({
        rule,
        respondedCount: s.respondedCount,
        ignoredCount: s.ignoredCount,
        respondedSR: s.respondedCount > 0 ? s.respondedSuccessCount / s.respondedCount : 0,
        ignoredSR: s.ignoredCount > 0 ? s.ignoredSuccessCount / s.ignoredCount : 0,
      }))

      // Fetch discovered rules
      let ruleLifecycles: RuleLifecycle[] = []
      try {
        const res = await fetch(`${SERVER_URL}/api/discovered-rules`)
        if (res.ok) {
          const d = await res.json() as { rules: Array<{ id: string; name?: string; lifecycle: string; stats?: { hitCount?: number; effectSizePP?: number } }> }
          ruleLifecycles = (d.rules || []).map(r => ({
            id: r.id,
            name: r.name || r.id,
            lifecycle: r.lifecycle,
            responseRate: 0,
            effectPP: r.stats?.effectSizePP ?? 0,
            hitCount: r.stats?.hitCount ?? 0,
          }))
          // Enrich with injection response rate
          for (const rl of ruleLifecycles) {
            const irs = injectionResponseStats[rl.id]
            if (irs) {
              const total = irs.respondedCount + irs.ignoredCount
              rl.responseRate = total > 0 ? irs.respondedCount / total : 0
            }
          }
        }
      } catch { /* ignore */ }

      // Fetch recovery overview from Python
      let recovery: RecoveryOverview = { totalFailures: 0, adaptiveCount: 0, blindRetryCount: 0, adaptiveSR: 0, blindRetrySR: 0 }
      try {
        const res = await fetch(`${SERVER_URL}/api/base-analysis?field=recovery`)
        if (res.ok) {
          const d = await res.json()
          if (d.recovery) recovery = d.recovery
        }
      } catch { /* ignore */ }

      // Compute summary metrics
      const totalTraces = stats.totalTraceCount
      let totalInterventions = 0
      for (const effect of Object.values(stats.interventionEffects)) {
        totalInterventions += effect.intervened.totalCount
      }
      const interventionRate = totalTraces > 0 ? totalInterventions / totalTraces : 0

      setData({
        transitions,
        injectionStats,
        ruleLifecycles,
        recovery,
        totalTraces,
        interventionRate,
        cooldownSuppressions: 0,
        recoverySuppressions: 0,
      })
    } catch (err) {
      console.warn('[GovernorDashboard] Failed to load data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <RefreshCw className="w-6 h-6 text-stone-300" />
        </motion.div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <XCircle className="w-10 h-10 text-stone-200" />
        <p className="text-sm text-stone-400">无法加载 Governor 数据</p>
        <button
          onClick={fetchData}
          className="text-xs text-indigo-500 hover:text-indigo-700 underline"
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-5 space-y-4">
      <SummaryHeader data={data} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TransitionHeatmap transitions={data.transitions} />
        <InjectionResponseSection stats={data.injectionStats} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RecoverySection recovery={data.recovery} />
        <RuleLifecycleSection rules={data.ruleLifecycles} />
      </div>
    </div>
  )
}
