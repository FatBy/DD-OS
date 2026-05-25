/**
 * MemoryDepositCard - 记忆沉淀卡片（区块3）
 * 
 * 展示本次执行产生的记忆沉淀：
 * - exec_trace: 执行追踪
 * - experience: 经验总结
 * - skill_update: 技能更新
 */

import { Sparkles } from 'lucide-react'
import type { MemoryDeposit } from '@/types'

// ============================================
// Props
// ============================================

export interface MemoryDepositCardProps {
  deposits: MemoryDeposit[]
}

// ============================================
// 类型标签配色
// ============================================

const TYPE_STYLES: Record<MemoryDeposit['type'], { label: string; cls: string }> = {
  exec_trace: { label: '执行追踪', cls: 'bg-blue-50 text-blue-600' },
  experience: { label: '经验总结', cls: 'bg-amber-50 text-amber-600' },
  skill_update: { label: '技能更新', cls: 'bg-purple-50 text-purple-600' },
}

// ============================================
// 主组件
// ============================================

export function MemoryDepositCard({ deposits }: MemoryDepositCardProps) {
  return (
    <div className="mx-3 my-2 rounded-xl bg-white border border-gray-100 p-4">
      {/* 标题 */}
      <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-1.5">
        <Sparkles size={14} className="text-amber-500" />
        执行记忆
      </h4>

      {/* 无内容 */}
      {deposits.length === 0 && (
        <p className="text-xs text-gray-400">本次执行无新沉淀</p>
      )}

      {/* 沉淀列表 */}
      {deposits.length > 0 && (
        <div className="space-y-2">
          {deposits.map((deposit, i) => (
            <DepositItem key={i} deposit={deposit} />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================
// 单条沉淀
// ============================================

function DepositItem({ deposit }: { deposit: MemoryDeposit }) {
  const style = TYPE_STYLES[deposit.type] ?? TYPE_STYLES.exec_trace

  return (
    <div className="rounded-lg bg-gray-50/80 px-3 py-2">
      {/* 类型标签 */}
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.cls}`}>
          {style.label}
        </span>
      </div>

      {/* 内容摘要 */}
      <p className="text-xs text-gray-600 line-clamp-2">
        {deposit.content}
      </p>

      {/* Tags */}
      {deposit.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {deposit.tags.map((tag, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-500"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
