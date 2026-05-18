import { lazy } from 'react'
import type { HouseConfig } from '@/types'
import { Home, Brain, ScrollText, Ghost, Settings, Radio, Library } from 'lucide-react'

// 懒加载所有 House 组件，首屏不再拉入完整依赖图
const SkillHouse = lazy(() => import('@/components/houses/SkillHouse').then(m => ({ default: m.SkillHouse })))
const MemoryHouse = lazy(() => import('@/components/houses/MemoryHouse').then(m => ({ default: m.MemoryHouse })))
const SoulHouse = lazy(() => import('@/components/houses/SoulHouse').then(m => ({ default: m.SoulHouse })))
const LinkStationHouse = lazy(() => import('@/components/houses/LinkStationHouse').then(m => ({ default: m.LinkStationHouse })))
const LibraryHouse = lazy(() => import('@/components/houses/LibraryHouse').then(m => ({ default: m.LibraryHouse })))
const SettingsHouse = lazy(() => import('@/components/houses/SettingsHouse').then(m => ({ default: m.SettingsHouse })))

// World view is handled separately as the background layer.
// This placeholder is registered so the Dock can render a "Home" icon.
function WorldPlaceholder() {
  return null
}

export const houseRegistry: HouseConfig[] = [
  {
    id: 'world',
    name: '世界',
    icon: Home,
    component: WorldPlaceholder,
    themeColor: 'slate',
    description: '2.5D 游戏地图背景',
  },

  {
    id: 'skill',
    name: '技能树',
    icon: Brain,
    component: SkillHouse,
    themeColor: 'cyan',
    description: '频道技能网络 (映射自 Channels)',
  },
  {
    id: 'memory',
    name: '记忆宫殿',
    icon: ScrollText,
    component: MemoryHouse,
    themeColor: 'emerald',
    description: '对话记忆存储 (映射自 Session History)',
  },
  {
    id: 'soul',
    name: '灵魂塔',
    icon: Ghost,
    component: SoulHouse,
    themeColor: 'purple',
    description: 'Agent 灵魂状态 (映射自 Health/Presence)',
  },
  {
    id: 'link-station',
    name: '联络站',
    icon: Radio,
    component: LinkStationHouse,
    themeColor: 'emerald',
    description: '模型通道与 MCP 连接节点管理',
  },
  {
    id: 'library',
    name: '知识库',
    icon: Library,
    component: LibraryHouse,
    themeColor: 'sky',
    description: '文件知识图谱摄入管线',
  },
  {
    id: 'settings',
    name: '系统设置',
    icon: Settings,
    component: SettingsHouse,
    themeColor: 'slate',
    description: '系统偏好设置',
  },
]

export function getHouseById(id: string): HouseConfig | undefined {
  return houseRegistry.find((h) => h.id === id)
}
