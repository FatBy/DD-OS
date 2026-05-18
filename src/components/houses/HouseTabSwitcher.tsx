/**
 * HouseTabSwitcher — 图书馆/自习室切换器 (品牌统一版)
 *
 * 设计原则:
 * - 作为"布局元素"嵌入各视图的顶部栏, 不再浮动
 * - 两档尺寸: compact (嵌入 StatusBar, 更大更显眼) / normal (空态等宽松位置)
 * - 视觉语言: 胶囊分段 + serif 字 + 琥珀激活块 + 图标描边强化
 * - 和"知识图书馆"主页的 SMALL CAPS 品牌标题保持同宗
 */

import { BookOpen, PenTool } from 'lucide-react'
import { useStore } from '@/store'
import type { ReactNode } from 'react'

interface Props {
  /** compact: 36px 高, 嵌入顶栏; normal: 40px, 用于空态等更宽松的位置 */
  size?: 'compact' | 'normal'
}

const SERIF = "'Georgia', 'Noto Serif SC', 'SimSun', serif"

export function HouseTabSwitcher({ size = 'compact' }: Props) {
  const libraryTab = useStore((s) => s.libraryTab)
  const setLibraryTab = useStore((s) => s.setLibraryTab)

  const h = size === 'compact' ? 'h-9' : 'h-10'
  const px = size === 'compact' ? 'px-3.5' : 'px-4'
  const textSize = size === 'compact' ? 'text-[13px]' : 'text-sm'
  const iconSize = size === 'compact' ? 'w-3.5 h-3.5' : 'w-4 h-4'

  return (
    <div
      className={`inline-flex items-center bg-white border border-stone-200 rounded-full overflow-hidden ${h} shadow-[0_1px_2px_rgba(120,53,15,0.04)]`}
    >
      <TabButton
        active={libraryTab === 'library'}
        onClick={() => setLibraryTab('library')}
        icon={<BookOpen className={`${iconSize} stroke-[2.2]`} />}
        label="图书馆"
        px={px}
        textSize={textSize}
      />
      <div className="w-px h-4 bg-stone-200" aria-hidden />
      <TabButton
        active={libraryTab === 'studyroom'}
        onClick={() => setLibraryTab('studyroom')}
        icon={<PenTool className={`${iconSize} stroke-[2.2]`} />}
        label="自习室"
        px={px}
        textSize={textSize}
      />
    </div>
  )
}

interface TabButtonProps {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  px: string
  textSize: string
}

function TabButton({ active, onClick, icon, label, px, textSize }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 h-full ${px} ${textSize} transition-all duration-200 ${
        active
          ? 'text-amber-900 bg-gradient-to-b from-amber-50 to-amber-100/60 font-semibold'
          : 'text-stone-500 hover:text-amber-800 hover:bg-amber-50/40'
      }`}
      style={{ fontFamily: SERIF, letterSpacing: '0.02em' }}
    >
      <span className={active ? 'text-amber-600' : 'text-stone-400'}>{icon}</span>
      {label}
    </button>
  )
}
