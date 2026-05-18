/**
 * SkillVersionTimeline - 快照时间线
 *
 * DunCrew 暖色风格:
 * - stone 色系时间线
 * - 项目调色板 score badges
 */

import { useState } from 'react'
import { useStore } from '@/store'
import { localServerService } from '@/services/localServerService'

export function SkillVersionTimeline() {
  const activeSkillName = useStore((s) => s.activeSkillName)
  const snapshots = useStore((s) => s.snapshots)
  const updateSkillContent = useStore((s) => s.updateSkillContent)
  const loadSnapshots = useStore((s) => s.loadSnapshots)

  const [restoring, setRestoring] = useState<string | null>(null)

  if (!activeSkillName || snapshots.length === 0) return null

  const handleRestore = async (snapshotId: string) => {
    if (restoring) return
    setRestoring(snapshotId)
    try {
      const serverUrl = localServerService.getServerUrl()
      const res = await fetch(
        `${serverUrl}/skills/${encodeURIComponent(activeSkillName)}/snapshot/${snapshotId}`,
        { signal: AbortSignal.timeout(5000) },
      )
      if (!res.ok) return
      const data = await res.json()
      if (data.content) {
        updateSkillContent(data.content)
      }
      loadSnapshots(activeSkillName)
    } catch (err) {
      console.error('[SkillIDE] Restore snapshot failed:', err)
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div>
      <h4 className="text-[10px] font-black text-stone-400 uppercase tracking-[0.15em] mb-2">
        Snapshots
      </h4>
      <div className="space-y-0.5">
        {snapshots.slice(0, 10).map((snap) => (
          <div
            key={snap.id}
            className="flex items-center gap-1.5 group"
          >
            {/* Timeline dot */}
            <div className="flex flex-col items-center w-3 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-stone-300 group-hover:bg-[#5ebab0] transition-colors" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 flex items-center gap-1">
              <span className="text-[10px] text-stone-500 truncate font-mono">
                {formatSnapshotTime(snap.timestamp)}
              </span>
              {snap.score !== undefined && (
                <span
                  className={`text-[9px] px-1 rounded-md font-bold ${
                    snap.score >= 80
                      ? 'bg-[#6cb478]/10 text-[#6cb478]'
                      : snap.score >= 50
                        ? 'bg-[#e8a838]/10 text-[#e8a838]'
                        : 'bg-[#dc7864]/10 text-[#dc7864]'
                  }`}
                >
                  {snap.score}
                </span>
              )}
            </div>

            {/* Restore button */}
            <button
              onClick={() => handleRestore(snap.id)}
              disabled={restoring === snap.id}
              className="opacity-0 group-hover:opacity-100 shrink-0 px-1.5 py-0.5 text-[9px] font-bold text-stone-400 hover:text-[#5ebab0] hover:bg-[#5ebab0]/10 rounded-lg transition-all disabled:opacity-50"
            >
              {restoring === snap.id ? '...' : 'Restore'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatSnapshotTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (isToday) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
