/**
 * SkillExplorer - IDE 左侧技能浏览器
 *
 * DunCrew 风格: 毛玻璃大圆角容器
 * - 搜索框 (带图标)
 * - 最近打开历史
 * - 扁平技能列表
 */

import { useState, useMemo } from 'react'
import { Search, Plus, Trash2, MessageSquare } from 'lucide-react'
import { motion } from 'framer-motion'
import { useStore } from '@/store'
import { mapAllSkills } from '@/utils/skillsHouseMapper'

const ddosEase = [0.23, 1, 0.32, 1]

export function SkillExplorer() {
  const openClawSkills = useStore((s) => s.openClawSkills)
  const skillEnvValues = useStore((s) => s.skillEnvValues)
  const activeSkillName = useStore((s) => s.activeSkillName)
  const openSkill = useStore((s) => s.openSkill)
  const recentOps = useStore((s) => s.recentOps)
  const skillConversations = useStore((s) => s.skillConversations)
  const activeSkillConvId = useStore((s) => s.activeSkillConvId)
  const createSkillConversation = useStore((s) => s.createSkillConversation)
  const switchSkillConversation = useStore((s) => s.switchSkillConversation)
  const deleteSkillConversation = useStore((s) => s.deleteSkillConversation)

  const [search, setSearch] = useState('')
  const [hoveredConvId, setHoveredConvId] = useState<string | null>(null)

  const allModels = useMemo(
    () => mapAllSkills(openClawSkills, skillEnvValues),
    [openClawSkills, skillEnvValues],
  )

  // Flat filtered list
  const filteredSkills = useMemo(() => {
    if (!search.trim()) return allModels
    const q = search.toLowerCase()
    return allModels.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.desc || '').toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }, [allModels, search])

  // Recent history from recentOps
  const recentSkills = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const op of recentOps) {
      const match = op.description.match(/(?:Saved|AI:)\s+(\S+)/)
      const name = match?.[1]
      if (name && !seen.has(name)) {
        seen.add(name)
        result.push(name)
      }
    }
    return result.slice(0, 5)
  }, [recentOps])

  const isSearching = search.trim().length > 0

  // 当前 skill 的会话列表
  const skillSessions = useMemo(() => {
    if (!activeSkillName) return []
    const sessions: Array<{ id: string; title: string; messageCount: number; updatedAt: number }> = []
    for (const [, conv] of skillConversations) {
      if (conv.skillName === activeSkillName) {
        sessions.push({
          id: conv.id,
          title: conv.title,
          messageCount: conv.messages.length,
          updatedAt: conv.updatedAt,
        })
      }
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  }, [skillConversations, activeSkillName])

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: ddosEase }}
      className="flex flex-col h-full bg-white/60 backdrop-blur-2xl border border-stone-200/40 rounded-[24px] shadow-sm overflow-hidden"
    >
      {/* Search */}
      <div className="px-3.5 pt-4 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills..."
            className="w-full pl-8 pr-3 py-2 text-xs bg-stone-50/80 border border-stone-200/60 rounded-xl outline-none focus:border-[#5ebab0] focus:ring-1 focus:ring-[#5ebab0]/20 text-stone-700 placeholder:text-stone-400 transition-colors"
          />
        </div>
      </div>

      {/* Conversation sessions (当技能已打开时) */}
      {!isSearching && activeSkillName && skillSessions.length > 0 && (
        <div className="px-3.5 pb-2">
          <div className="flex items-center justify-between mb-1.5">
            <h4 className="text-[10px] font-black text-stone-400 uppercase tracking-[0.15em]">
              Sessions
            </h4>
            <button
              onClick={() => createSkillConversation(activeSkillName)}
              className="p-0.5 text-stone-400 hover:text-[#5ebab0] transition-colors"
              title="New session"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-0.5">
            {skillSessions.slice(0, 8).map((session) => {
              const isActiveConv = session.id === activeSkillConvId
              return (
                <div
                  key={session.id}
                  onMouseEnter={() => setHoveredConvId(session.id)}
                  onMouseLeave={() => setHoveredConvId(null)}
                  className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-xl transition-all duration-200 cursor-pointer ${
                    isActiveConv
                      ? 'bg-[#5ebab0]/10 text-[#5ebab0] border border-[#5ebab0]/30'
                      : 'text-stone-500 hover:bg-stone-100/80 hover:text-stone-700 border border-transparent'
                  }`}
                  onClick={() => switchSkillConversation(session.id)}
                >
                  <MessageSquare className="w-3 h-3 shrink-0" />
                  <span className="flex-1 text-left truncate font-medium">{session.title}</span>
                  <span className="text-[9px] text-stone-300 font-mono tabular-nums shrink-0">
                    {session.messageCount}
                  </span>
                  {hoveredConvId === session.id && skillSessions.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteSkillConversation(session.id)
                      }}
                      className="p-0.5 text-stone-400 hover:text-[#dc7864] transition-colors shrink-0"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Divider after sessions */}
      {!isSearching && activeSkillName && skillSessions.length > 0 && (
        <div className="mx-3.5 border-t border-stone-200/40" />
      )}

      {/* Recent history */}
      {!isSearching && recentSkills.length > 0 && (
        <div className="px-3.5 pb-2">
          <h4 className="text-[10px] font-black text-stone-400 uppercase tracking-[0.15em] mb-1.5">
            Recent
          </h4>
          <div className="space-y-0.5">
            {recentSkills.map((name) => {
              const skill = allModels.find((s) => s._raw.name === name)
              if (!skill) return null
              const isActive = name === activeSkillName
              return (
                <button
                  key={name}
                  onClick={() => openSkill(name)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-xl transition-all duration-200 ${
                    isActive
                      ? 'bg-[#5ebab0]/10 text-[#5ebab0] border border-[#5ebab0]/30'
                      : 'text-stone-500 hover:bg-stone-100/80 hover:text-stone-700 border border-transparent'
                  }`}
                >
                  <span className="text-sm shrink-0">{skill.emoji || '\u2699\uFE0F'}</span>
                  <span className="flex-1 text-left truncate font-medium">{skill.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Divider */}
      {!isSearching && recentSkills.length > 0 && (
        <div className="mx-3.5 border-t border-stone-200/40" />
      )}

      {/* Skills list header */}
      <div className="px-3.5 pt-2.5 pb-1 flex items-center justify-between">
        <h4 className="text-[10px] font-black text-stone-400 uppercase tracking-[0.15em]">
          {isSearching ? `Results (${filteredSkills.length})` : 'All Skills'}
        </h4>
        <span className="text-[10px] font-mono text-stone-300 tabular-nums">
          {allModels.length}
        </span>
      </div>

      {/* Flat skill list */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin scrollbar-thumb-stone-200">
        {filteredSkills.map((skill) => {
          const isActive = skill._raw.name === activeSkillName
          return (
            <motion.button
              key={skill.id}
              onClick={() => openSkill(skill._raw.name)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-xl transition-all duration-200 ${
                isActive
                  ? 'bg-[#5ebab0]/10 text-[#5ebab0] border border-[#5ebab0]/30 font-bold'
                  : 'text-stone-600 hover:bg-stone-100/80 hover:text-stone-800 border border-transparent'
              }`}
              whileTap={{ scale: 0.98 }}
            >
              <span className="text-sm shrink-0">{skill.emoji || '\u2699\uFE0F'}</span>
              <span className="flex-1 text-left truncate">{skill.name}</span>
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  skill.status === 'error'
                    ? 'bg-[#dc7864]'
                    : skill.status === 'active'
                      ? 'bg-[#6cb478]'
                      : 'bg-stone-300'
                }`}
              />
            </motion.button>
          )
        })}

        {filteredSkills.length === 0 && (
          <div className="text-xs text-stone-400 text-center py-8">
            No skills found
          </div>
        )}
      </div>
    </motion.div>
  )
}
