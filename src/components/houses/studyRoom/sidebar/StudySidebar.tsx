/**
 * StudySidebar — 自习室左侧栏 (方案 C)
 *
 * 默认状态: 40px 窄条轨道, 只显示两个图标 (记忆 / 指纹)
 * 展开状态: 320px 完整抽屉, 承载 MemoryPanel / FingerprintPanel
 *
 * 交互:
 *   - 点击轨道图标 → 展开对应面板
 *   - 再次点击同一图标 / 点击面板"收起" → 折回窄条
 *   - 切换图标 → 面板内容切换, 不折叠
 *
 * 布局策略:
 *   - 窄条轨道 position: relative, 始终渲染
 *   - 展开抽屉 position: relative, 横向挤占 workspace 宽度
 *     (不用 absolute 浮层, 避免遮挡文章, 也避免用户找不到内容)
 *   - 状态记住最后展开的面板 (localStorage), 下次打开还是同一个
 */

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, Palette } from 'lucide-react'
import { MemoryPanel } from './MemoryPanel'
import { FingerprintPanel } from './FingerprintPanel'
import { WritingDunPanel } from './WritingDunPanel'

type PanelId = 'memory' | 'fingerprint'

const LS_KEY_LAST_PANEL = 'studyRoom:sidebar:lastPanel'
const LS_KEY_EXPANDED = 'studyRoom:sidebar:expanded'

function readLastPanel(): PanelId {
  try {
    const v = localStorage.getItem(LS_KEY_LAST_PANEL)
    if (v === 'memory' || v === 'fingerprint') return v
  } catch { /* noop */ }
  return 'memory'
}

function readExpanded(): boolean {
  try {
    return localStorage.getItem(LS_KEY_EXPANDED) === '1'
  } catch { return false }
}

interface Props {
  /** 当前 session id (传给子面板) */
  sessionId: string | null
}

export function StudySidebar({ sessionId }: Props) {
  const [expanded, setExpanded] = useState<boolean>(() => readExpanded())
  const [activePanel, setActivePanel] = useState<PanelId>(() => readLastPanel())

  const persistExpanded = useCallback((v: boolean) => {
    try { localStorage.setItem(LS_KEY_EXPANDED, v ? '1' : '0') } catch { /* noop */ }
  }, [])

  const persistPanel = useCallback((p: PanelId) => {
    try { localStorage.setItem(LS_KEY_LAST_PANEL, p) } catch { /* noop */ }
  }, [])

  const handleIconClick = useCallback((panel: PanelId) => {
    if (expanded && activePanel === panel) {
      // 点已展开的当前面板 → 折叠
      setExpanded(false)
      persistExpanded(false)
    } else {
      // 切换到目标面板并展开
      setActivePanel(panel)
      persistPanel(panel)
      setExpanded(true)
      persistExpanded(true)
    }
  }, [expanded, activePanel, persistExpanded, persistPanel])

  const handleClose = useCallback(() => {
    setExpanded(false)
    persistExpanded(false)
  }, [persistExpanded])

  return (
    <div className="flex h-full flex-shrink-0 border-r border-stone-200/70">
      {/* 窄条轨道 */}
      <nav className="w-10 flex flex-col items-center py-3 gap-1.5 bg-gradient-to-b from-amber-50/30 via-stone-50/40 to-stone-50/20 border-r border-stone-100 flex-shrink-0">
        <RailButton
          icon={<Brain className="w-4 h-4 stroke-[2.2]" />}
          label="记忆"
          active={expanded && activePanel === 'memory'}
          onClick={() => handleIconClick('memory')}
          accent="amber"
        />
        <RailButton
          icon={<Palette className="w-4 h-4 stroke-[2.2]" />}
          label="文风"
          active={expanded && activePanel === 'fingerprint'}
          onClick={() => handleIconClick('fingerprint')}
          accent="amber"
        />
      </nav>

      {/* 展开抽屉 */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="drawer"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="h-full overflow-hidden"
            style={{ minWidth: 0 }}
          >
            <div className="w-[320px] h-full border-r border-stone-200/60 flex flex-col">
              {activePanel === 'memory' && (
                <MemoryPanel sessionId={sessionId} onClose={handleClose} />
              )}
              {activePanel === 'fingerprint' && (
                // 文风指纹 + 写作 Dun 堆叠: 指纹在上占主区域, Dun 在下作为附属 section
                // (跟用户确认过的布局方案 a: 同一栏两个 section 堆叠)
                <>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <FingerprintPanel sessionId={sessionId} onClose={handleClose} />
                  </div>
                  <div className="flex-shrink-0">
                    <WritingDunPanel sessionId={sessionId} />
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---- 轨道按钮 ----

interface RailButtonProps {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
  accent: 'amber'
}

function RailButton({ icon, label, active, onClick }: RailButtonProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`relative w-8 h-8 flex items-center justify-center rounded-md transition-all group ${
        active
          ? 'bg-gradient-to-b from-amber-50 to-amber-100 border border-amber-300 text-amber-800 shadow-sm'
          : 'text-stone-500 hover:text-amber-700 hover:bg-amber-50/60 border border-transparent'
      }`}
    >
      {icon}
      {/* active 指示条 */}
      {active && (
        <motion.div
          layoutId="rail-active-indicator"
          className="absolute -left-0.5 top-1.5 bottom-1.5 w-0.5 bg-amber-500 rounded-r"
        />
      )}
      {/* hover 浮标签 */}
      <span className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap px-2 py-0.5 rounded text-[10px] bg-stone-800 text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-50">
        {label}
      </span>
    </button>
  )
}
