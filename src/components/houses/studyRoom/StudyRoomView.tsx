/**
 * StudyRoomView — 自习室主容器
 *
 * 路由: 空态 (无 session) → StudyRoomEmpty
 *       活跃 session     → StudyRoomWorkspace
 */

import { useEffect } from 'react'
import { useStore } from '@/store'
import { StudyRoomEmpty } from './StudyRoomEmpty'
import { StudyRoomWorkspace } from './StudyRoomWorkspace'

export function StudyRoomView() {
  const activeSessionId = useStore((s) => s.activeSessionId)
  // 注: StudyRoomSlice 的 session 字典已重命名为 studySessions, 避免和 SessionsSlice.sessions 撞名导致 AppStore 合并失败
  const studySessions = useStore((s) => s.studySessions)
  const loadSessionsList = useStore((s) => s.loadSessionsList)

  // 进入自习室时加载会话列表
  useEffect(() => {
    loadSessionsList()
  }, [loadSessionsList])

  const activeSession = activeSessionId ? studySessions[activeSessionId] : null

  if (!activeSession) {
    return (
      <div className="h-full bg-gradient-to-b from-amber-50/40 via-stone-50/30 to-white">
        <StudyRoomEmpty />
      </div>
    )
  }

  return (
    <div className="h-full bg-gradient-to-b from-amber-50/30 via-white to-stone-50/40">
      <StudyRoomWorkspace session={activeSession} />
    </div>
  )
}
