import { useMemo, useState } from 'react'
import { Loader2, Zap } from 'lucide-react'
import { useStore } from '@/store'
import { skillStatsService } from '@/services/skillStatsService'
import { SkillAnalysisView } from './skill/SkillAnalysisView'
import { SkillDetailPanel } from './skill/SkillDetailPanel'

export function SkillHouse() {
  const storeSkills = useStore((s) => s.skills)
  const openClawSkills = useStore((s) => s.openClawSkills)
  const loading = useStore((s) => s.channelsLoading)
  const connectionStatus = useStore((s) => s.connectionStatus)

  const isConnected = connectionStatus === 'connected'
  const [isDetailExpanded, setIsDetailExpanded] = useState(false)

  // 计算能力快照
  const snapshot = useMemo(() => {
    return skillStatsService.computeSnapshot(openClawSkills)
  }, [openClawSkills])

  if (loading && isConnected) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        {/* 主区域 */}
        <div className="flex-1 p-4 overflow-y-auto">
          {/* AI 分析视图 */}
          <div className="flex items-center justify-center min-h-[200px]">
            <SkillAnalysisView onShowDetail={() => setIsDetailExpanded(true)} />
          </div>

          {/* 可展开的详情面板 */}
          <SkillDetailPanel
            snapshot={snapshot}
            skills={storeSkills}
            openClawSkills={openClawSkills}
            isExpanded={isDetailExpanded}
            onToggle={() => setIsDetailExpanded(!isDetailExpanded)}
          />
        </div>

        {/* 右侧边栏（保持不变） */}
        <div className="w-44 border-l border-white/10 p-4 space-y-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-5 h-5 text-cyan-400" />
            <h4 className="font-mono text-sm text-cyan-400 uppercase font-medium">Stats</h4>
          </div>

          <div className="space-y-3">
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs font-mono text-white/40 uppercase mb-1">Skills</p>
              <p className="text-2xl font-bold text-cyan-400">{storeSkills.length}</p>
            </div>

            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs font-mono text-white/40 uppercase mb-1">Domains</p>
              <p className="text-2xl font-bold text-purple-400">
                {snapshot.domains.filter(d => d.skillCount > 0).length}
              </p>
            </div>

            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs font-mono text-white/40 uppercase mb-1">Active</p>
              <p className="text-2xl font-bold text-emerald-400">
                {storeSkills.filter(s => s.unlocked || s.status === 'active').length}
              </p>
            </div>
          </div>

          <div className="pt-3 border-t border-white/10">
            <p className="text-xs font-mono text-white/20 leading-relaxed">
              Ability scores are based on call frequency, activation count, and success rate.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
