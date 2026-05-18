/**
 * SkillPreviewPanel - 右侧预览面板
 *
 * 整合 Preview / Source 标签页 + 底部诊断条。
 * History tab 暂时隐藏（后端 snapshot 系统未实现）。
 *
 * DunCrew 暖色治愈风格毛玻璃容器
 */

import { motion } from 'framer-motion'
import { useStore } from '@/store'
import { SkillPreviewTab } from './SkillPreviewTab'
import { SkillSourceTab } from './SkillSourceTab'
import { SkillDiagnosticsBar } from './SkillDiagnosticsBar'

const ddosEase = [0.23, 1, 0.32, 1]

export function SkillPreviewPanel() {
  const activeSkillName = useStore((s) => s.activeSkillName)
  const activeTab = useStore((s) => s.activeTab)
  const setActiveTab = useStore((s) => s.setActiveTab)

  // Empty state
  if (!activeSkillName) {
    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: ddosEase }}
        className="flex flex-col h-full bg-white/60 backdrop-blur-2xl border border-stone-200/40 rounded-[24px] shadow-sm"
      >
        <div className="flex items-center justify-center h-full text-stone-400">
          <div className="text-center">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-stone-100/80 flex items-center justify-center">
              <span className="text-2xl">{'\u{1F4CB}'}</span>
            </div>
            <div className="text-xs font-medium">Open a skill to preview</div>
          </div>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: ddosEase }}
      className="flex flex-col h-full bg-white/60 backdrop-blur-2xl border border-stone-200/40 rounded-[24px] shadow-sm overflow-hidden"
    >
      {/* Tab bar */}
      <div className="flex items-center gap-0 px-4 pt-2.5 pb-0 border-b border-stone-100/60">
        <h3 className="text-[10px] font-black text-stone-400 uppercase tracking-[0.15em] mr-3">
          Preview
        </h3>
        <button
          onClick={() => setActiveTab('preview')}
          className={`px-2.5 py-2 text-[11px] font-bold border-b-2 transition-colors ${
            activeTab === 'preview'
              ? 'border-[#5ebab0] text-[#5ebab0]'
              : 'border-transparent text-stone-400 hover:text-stone-600'
          }`}
        >
          Rendered
        </button>
        <button
          onClick={() => setActiveTab('source')}
          className={`px-2.5 py-2 text-[11px] font-bold border-b-2 transition-colors ${
            activeTab === 'source'
              ? 'border-[#5ebab0] text-[#5ebab0]'
              : 'border-transparent text-stone-400 hover:text-stone-600'
          }`}
        >
          Source
        </button>
        {/* History tab 暂时隐藏：后端 snapshot 系统未实现，强行展示会一直空。
            详见 .qoder/Specs/skill_ide_三合一方案.md「已知技术债 #1」 */}
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === 'preview' && <SkillPreviewTab />}
        {activeTab === 'source' && <SkillSourceTab />}
        {activeTab === 'timeline' && <SkillPreviewTab />}
      </div>

      {/* Bottom diagnostics bar */}
      <SkillDiagnosticsBar />
    </motion.div>
  )
}
