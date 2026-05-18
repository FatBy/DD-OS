/**
 * SkillIDE - Skills IDE 三栏主容器
 *
 * DunCrew 暖色治愈风格:
 * - 暖白背景 + 柔和点阵
 * - 左侧: SkillExplorer (毛玻璃导航, w-56)
 * - 中间: SkillConversationWorkspace (对话工作区, flex-1)
 * - 右侧: SkillPreviewPanel (预览面板, w-[360px], 可收起)
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '@/store'
import { SkillExplorer } from './SkillExplorer'
import { SkillConversationWorkspace } from './SkillConversationWorkspace'
import { SkillPreviewPanel } from './SkillPreviewPanel'

const DD_OS_EASING = [0.23, 1, 0.32, 1] as const

export function SkillIDE() {
  const previewPanelOpen = useStore((s) => s.previewPanelOpen)

  return (
    <div
      className="relative flex w-full h-full overflow-hidden"
      style={{
        backgroundColor: 'var(--color-bg-primary, #fdfbf5)',
      }}
    >
      {/* Left: Skill Explorer */}
      <div className="w-56 shrink-0 h-full py-3 pl-3 pr-1">
        <SkillExplorer />
      </div>

      {/* Center: Conversation Workspace */}
      <div className="flex-1 min-w-0 h-full py-3">
        <SkillConversationWorkspace />
      </div>

      {/* Right: Preview Panel */}
      <AnimatePresence>
        {previewPanelOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 360, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: DD_OS_EASING }}
            className="shrink-0 h-full py-3 pr-3 pl-1 overflow-hidden"
          >
            <SkillPreviewPanel />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
