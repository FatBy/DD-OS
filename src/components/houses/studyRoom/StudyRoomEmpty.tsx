/**
 * StudyRoomEmpty — 自习室空态 (无活跃会话)
 *
 * 显示:
 * - 欢迎标语 + 新建会话入口
 * - 已有会话列表 (快速恢复)
 */

import { useState } from 'react'
import { motion } from 'framer-motion'
import { PenTool, Plus, Loader2, Clock, Trash2 } from 'lucide-react'
import { useStore } from '@/store'
import { runIntake } from '@/services/studyRoom/writingService'
import { HouseTabSwitcher } from '../HouseTabSwitcher'

export function StudyRoomEmpty() {
  const [intent, setIntent] = useState('')
  const [creating, setCreating] = useState(false)

  const sessionsList = useStore((s) => s.sessionsList)
  const sessionsListLoading = useStore((s) => s.sessionsListLoading)
  const createSession = useStore((s) => s.createSession)
  const loadSession = useStore((s) => s.loadSession)
  const deleteSession = useStore((s) => s.deleteSession)
  const openClawSkills = useStore((s) => s.openClawSkills)
  const storeSkills = openClawSkills
    .filter((s) => s.status === 'active')
    .map((s) => ({
      name: s.name,
      description: s.description,
      keywords: s.keywords,
      whenToUse: s.whenToUse,
      tags: s.tags,
      enabled: true,
      toolType: s.toolType,
      category: s.category,
      instructions: s.instructions,
    }))

  const handleCreate = async () => {
    const trimmed = intent.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      const brief = runIntake(trimmed, { skills: storeSkills })
      await createSession(brief)
    } finally {
      setCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleCreate()
    }
  }

  return (
    <div className="relative flex flex-col items-center justify-center h-full px-6">
      {/* Tab 切换器 (固定左上角, 但属于本视图布局内部) */}
      <div className="absolute top-4 left-4">
        <HouseTabSwitcher size="compact" />
      </div>

      {/* 标题 */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className="flex items-center gap-3 mb-6"
      >
        <PenTool className="w-8 h-8 text-amber-600" />
        <h1 className="text-2xl font-bold text-stone-800" style={{ fontFamily: "'Georgia', 'Noto Serif SC', 'SimSun', serif" }}>自习室</h1>
      </motion.div>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="text-sm text-stone-500 mb-8 text-center max-w-md"
      >
        对话驱动的长文档写作空间。描述你想写的内容，AI 会帮你构建议程、采集素材、逐段撰写。
      </motion.p>

      {/* 新建输入 */}
      <div className="w-full max-w-lg mb-8">
        <div className="flex items-center gap-2 p-3 bg-white border border-stone-200 rounded-xl shadow-sm focus-within:border-amber-300 focus-within:ring-2 focus-within:ring-amber-100 transition-all">
          <input
            type="text"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你想写的内容... (如: 写一篇关于 AI 教育的分析报告)"
            className="flex-1 text-sm bg-transparent outline-none text-stone-800 placeholder:text-stone-400"
            disabled={creating}
          />
          <button
            onClick={handleCreate}
            disabled={!intent.trim() || creating}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            开始写作
          </button>
        </div>
      </div>

      {/* 已有会话列表 */}
      {sessionsListLoading ? (
        <Loader2 className="w-5 h-5 text-stone-400 animate-spin" />
      ) : sessionsList.length > 0 ? (
        <div className="w-full max-w-lg">
          <p className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em] mb-3">
            最近的写作会话
          </p>
          <div className="space-y-2">
            {sessionsList.slice(0, 8).map((s, idx) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: idx * 0.04, ease: [0.23, 1, 0.32, 1] }}
                whileHover={{ y: -1 }}
                className="flex items-center gap-3 px-3 py-2.5 bg-white/80 border border-stone-100 rounded-xl hover:border-amber-200 hover:bg-amber-50/30 hover:shadow-sm transition-colors cursor-pointer group"
                onClick={() => loadSession(s.id)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-700 truncate">
                    {s.title || '(无标题)'}
                  </p>
                  <p className="text-xs text-stone-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(s.updatedAt).toLocaleDateString('zh-CN')}
                    <span className="ml-2 px-1.5 py-0.5 bg-stone-100 rounded text-[10px]">{s.genre}</span>
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(`确认删除会话「${s.title || '(无标题)'}」?\n删除后无法恢复。`)) {
                      deleteSession(s.id)
                    }
                  }}
                  className="p-1 text-stone-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                  title="删除会话"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
