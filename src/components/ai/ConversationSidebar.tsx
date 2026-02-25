import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Plus, MessageSquare, Globe2, Trash2, Edit2, Check, X,
  ChevronDown, Search, ChevronRight
} from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/utils/cn'
import type { Conversation, ConversationType } from '@/types'

interface ConversationSidebarProps {
  className?: string
}

export function ConversationSidebar({ className }: ConversationSidebarProps) {
  const conversations = useStore((s) => s.conversations)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const createConversation = useStore((s) => s.createConversation)
  const switchConversation = useStore((s) => s.switchConversation)
  const deleteConversation = useStore((s) => s.deleteConversation)
  const renameConversation = useStore((s) => s.renameConversation)
  const getOrCreateNexusConversation = useStore((s) => s.getOrCreateNexusConversation)
  const nexuses = useStore((s) => s.nexuses)
  
  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showNexusPicker, setShowNexusPicker] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  
  // 可用的 Nexus 列表（仅建造完成的）
  const nexusList = useMemo(() => 
    [...nexuses.values()].filter(n => n.constructionProgress >= 1),
    [nexuses]
  )
  
  // 转换 Map 为数组并排序
  const conversationList = [...conversations.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter(conv => 
      !searchQuery || 
      conv.title.toLowerCase().includes(searchQuery.toLowerCase())
    )
  
  const handleCreate = (type: ConversationType) => {
    if (type === 'nexus') {
      // 展开 Nexus 选择器
      setShowNexusPicker(true)
      return
    }
    createConversation(type)
    setShowNewMenu(false)
  }
  
  const handleSelectNexus = (nexusId: string) => {
    getOrCreateNexusConversation(nexusId)
    setShowNewMenu(false)
    setShowNexusPicker(false)
  }
  
  const handleStartRename = (conv: Conversation) => {
    setEditingId(conv.id)
    setEditTitle(conv.title)
  }
  
  const handleSaveRename = () => {
    if (editingId && editTitle.trim()) {
      renameConversation(editingId, editTitle.trim())
    }
    setEditingId(null)
    setEditTitle('')
  }
  
  const handleCancelRename = () => {
    setEditingId(null)
    setEditTitle('')
  }
  
  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('确定要删除这个会话吗？')) {
      deleteConversation(id)
    }
  }
  
  // 获取 Nexus 信息
  const getNexusInfo = (nexusId?: string) => {
    if (!nexusId) return null
    return nexuses.get(nexusId)
  }
  
  return (
    <div className={cn(
      'w-60 h-full flex flex-col bg-black/20 border-r border-white/10',
      className
    )}>
      {/* Header */}
      <div className="p-3 border-b border-white/10">
        <div className="relative">
          <button
            onClick={() => { setShowNewMenu(!showNewMenu); if (showNewMenu) setShowNexusPicker(false) }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 
                       bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 
                       rounded-lg text-cyan-300 text-sm font-mono transition-colors"
          >
            <Plus className="w-4 h-4" />
            新建会话
            <ChevronDown className={cn(
              'w-3 h-3 ml-auto transition-transform',
              showNewMenu && 'rotate-180'
            )} />
          </button>
          
          {/* New conversation menu */}
          <AnimatePresence>
            {showNewMenu && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="absolute top-full left-0 right-0 mt-1 z-10
                           bg-slate-900 border border-white/10 rounded-lg 
                           shadow-lg overflow-hidden"
              >
                <button
                  onClick={() => handleCreate('general')}
                  className="w-full flex items-center gap-2 px-3 py-2.5 
                             hover:bg-white/5 text-sm font-mono text-white/70 
                             hover:text-white/90 transition-colors"
                >
                  <MessageSquare className="w-4 h-4 text-cyan-400" />
                  通用对话
                </button>
                
                {/* Nexus 会话 - 带子菜单 */}
                <button
                  onClick={() => handleCreate('nexus')}
                  className="w-full flex items-center gap-2 px-3 py-2.5 
                             hover:bg-white/5 text-sm font-mono text-white/70 
                             hover:text-white/90 transition-colors border-t border-white/5"
                >
                  <Globe2 className="w-4 h-4 text-purple-400" />
                  Nexus 会话
                  <ChevronRight className={cn(
                    'w-3 h-3 ml-auto transition-transform',
                    showNexusPicker && 'rotate-90'
                  )} />
                </button>
                
                {/* Nexus 选择列表 */}
                <AnimatePresence>
                  {showNexusPicker && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden border-t border-white/5"
                    >
                      {nexusList.length === 0 ? (
                        <div className="px-3 py-3 text-[11px] font-mono text-white/30 text-center">
                          还没有可用的 Nexus
                        </div>
                      ) : (
                        <div className="max-h-[200px] overflow-y-auto py-1">
                          {nexusList.map(n => (
                            <button
                              key={n.id}
                              onClick={() => handleSelectNexus(n.id)}
                              className="w-full flex items-center gap-2 px-4 py-2 
                                         hover:bg-white/5 text-xs font-mono text-white/60 
                                         hover:text-white/90 transition-colors"
                            >
                              <div 
                                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: `hsl(${n.visualDNA?.primaryHue ?? 270}, 60%, 55%)` }}
                              />
                              <span className="truncate">{n.label || `Nexus-${n.id.slice(-6)}`}</span>
                              <span className="ml-auto text-[10px] text-white/25 flex-shrink-0">LV.{n.level}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        {/* Search */}
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索会话..."
            className="w-full pl-8 pr-3 py-1.5 bg-white/5 border border-white/10 
                       rounded text-xs font-mono text-white/70 placeholder-white/25
                       focus:outline-none focus:border-white/20"
          />
        </div>
      </div>
      
      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto py-2">
        {conversationList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <MessageSquare className="w-8 h-8 text-white/10 mb-2" />
            <p className="text-xs font-mono text-white/30">
              {searchQuery ? '没有匹配的会话' : '还没有会话'}
            </p>
            <p className="text-xs font-mono text-white/20 mt-1">
              点击上方按钮创建新会话
            </p>
          </div>
        ) : (
          conversationList.map((conv) => {
            const isActive = conv.id === activeConversationId
            const isEditing = editingId === conv.id
            const nexus = getNexusInfo(conv.nexusId)
            const lastMsg = conv.messages[conv.messages.length - 1]
            const preview = lastMsg?.content.slice(0, 40) || '(空会话)'
            
            return (
              <div
                key={conv.id}
                onClick={() => !isEditing && switchConversation(conv.id)}
                className={cn(
                  'group mx-2 mb-1 px-3 py-2.5 rounded-lg cursor-pointer transition-all',
                  isActive 
                    ? 'bg-white/10 border border-white/15' 
                    : 'hover:bg-white/5 border border-transparent'
                )}
              >
                <div className="flex items-start gap-2">
                  {/* Icon */}
                  <div className={cn(
                    'w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5',
                    conv.type === 'nexus' ? 'bg-purple-500/20' : 'bg-cyan-500/20'
                  )}>
                    {conv.type === 'nexus' 
                      ? <Globe2 className="w-3.5 h-3.5 text-purple-400" />
                      : <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
                    }
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename()
                            if (e.key === 'Escape') handleCancelRename()
                          }}
                          className="flex-1 px-1.5 py-0.5 bg-black/40 border border-white/20 
                                     rounded text-xs font-mono text-white/90 outline-none"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSaveRename() }}
                          className="p-1 text-emerald-400 hover:text-emerald-300"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCancelRename() }}
                          className="p-1 text-white/40 hover:text-white/60"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-mono text-white/80 truncate">
                            {conv.title}
                          </span>
                          {nexus && (
                            <span 
                              className="px-1 py-0.5 text-[10px] font-mono rounded"
                              style={{ 
                                backgroundColor: `hsla(${nexus.visualDNA?.primaryHue || 270}, 50%, 50%, 0.2)`,
                                color: `hsl(${nexus.visualDNA?.primaryHue || 270}, 70%, 70%)`
                              }}
                            >
                              {nexus.label?.slice(0, 8)}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] font-mono text-white/30 truncate mt-0.5">
                          {preview}
                        </p>
                      </>
                    )}
                  </div>
                  
                  {/* Actions */}
                  {!isEditing && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleStartRename(conv) }}
                        className="p-1 text-white/30 hover:text-white/60 rounded"
                        title="重命名"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(conv.id, e)}
                        className="p-1 text-white/30 hover:text-red-400 rounded"
                        title="删除"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
                
                {/* Timestamp */}
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] font-mono text-white/20">
                    {conv.messages.length} 条消息
                  </span>
                  <span className="text-[10px] font-mono text-white/20">
                    {formatTime(conv.updatedAt)}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// 格式化时间
function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - timestamp
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins}分钟前`
  if (diffHours < 24) return `${diffHours}小时前`
  if (diffDays < 7) return `${diffDays}天前`
  
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
