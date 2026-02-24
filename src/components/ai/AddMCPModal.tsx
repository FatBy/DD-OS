import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Server, Loader2, CheckCircle2, AlertCircle, Search } from 'lucide-react'
import { cn } from '@/utils/cn'
import { searchMCPServers, type MatchResult, type MCPServerCandidate } from '@/services/smartMatchService'
import { MatchResultCard } from './MatchResultCard'

interface MCPServer {
  name: string
  connected: boolean
  tools: number
}

interface AddMCPModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (serverName: string) => void
}

export function AddMCPModal({ isOpen, onClose, onConfirm }: AddMCPModalProps) {
  const [input, setInput] = useState('')
  const [servers, setServers] = useState<MCPServer[]>([])
  const [loading, setLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<MatchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  // 完整的服务器+工具信息（用于智能搜索）
  const serversWithToolsRef = useRef<MCPServerCandidate[]>([])

  // 加载已配置的 MCP 服务器列表
  useEffect(() => {
    if (!isOpen) return
    setInput('')
    setSearchResults([])
    setHasSearched(false)
    setLoading(true)
    const serverUrl = localStorage.getItem('ddos_server_url') || 'http://localhost:3001'
    fetch(`${serverUrl}/mcp/servers`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.servers) {
          const list: MCPServer[] = Object.entries(data.servers).map(([name, info]: [string, any]) => ({
            name,
            connected: info.connected ?? false,
            tools: info.tools ?? 0,
          }))
          setServers(list)

          // 构建带工具信息的候选列表
          const toolsList = Array.isArray(data.tools) ? data.tools : []
          serversWithToolsRef.current = Object.entries(data.servers).map(([name]) => ({
            name,
            tools: toolsList
              .filter((t: any) => t.server === name)
              .map((t: any) => ({ name: t.name, description: t.description || '' })),
          }))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [isOpen])

  const handleSearch = async () => {
    const q = input.trim()
    if (!q) return
    setIsSearching(true)
    setHasSearched(true)
    try {
      const results = await searchMCPServers(q, serversWithToolsRef.current)
      setSearchResults(results)
    } catch {
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleSelectResult = (name: string) => {
    onConfirm(name)
    resetAndClose()
  }

  const handleSelectServer = (name: string) => {
    onConfirm(name)
    resetAndClose()
  }

  const resetAndClose = () => {
    setInput('')
    setSearchResults([])
    setHasSearched(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4"
        onClick={resetAndClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-white/10 
                     rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden max-h-[85vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Server className="w-4 h-4 text-purple-400" />
              </div>
              <h2 className="text-sm font-mono font-semibold text-white/90">
                添加 MCP 服务
              </h2>
            </div>
            <button onClick={resetAndClose} className="p-1 text-white/30 hover:text-white/60 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content - scrollable */}
          <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
            {/* 概念说明 */}
            <div className="p-3 rounded-lg bg-purple-500/5 border border-purple-500/10">
              <p className="text-xs text-white/60 leading-relaxed">
                <span className="text-purple-400 font-semibold">MCP</span> (Model Context Protocol) 
                是一种让 AI 连接外部工具和数据源的标准协议。添加 MCP 服务后，AI 可以使用该服务提供的工具来完成任务。
              </p>
            </div>

            {/* 搜索输入框 */}
            <div>
              <label className="block text-xs font-mono text-white/40 mb-2">
                描述你需要的工具
              </label>
              <div className="flex gap-2">
                <input
                  autoFocus
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="如：文件管理、搜索网页、数据库查询"
                  className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-lg
                           text-sm font-mono text-white/80 placeholder-white/25
                           focus:border-purple-500/40 focus:outline-none transition-colors"
                />
                <button
                  onClick={handleSearch}
                  disabled={!input.trim() || isSearching}
                  className="px-3 py-2.5 bg-purple-500/20 border border-purple-500/30 rounded-lg
                           text-purple-300 hover:bg-purple-500/30 transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                >
                  {isSearching
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Search className="w-4 h-4" />
                  }
                </button>
              </div>
            </div>

            {/* 搜索结果 */}
            {isSearching && (
              <div className="flex items-center justify-center gap-2 py-4 text-white/30">
                <Loader2 className="w-4 h-4 animate-spin text-purple-400/60" />
                <span className="text-xs font-mono">AI 正在匹配...</span>
              </div>
            )}

            {!isSearching && hasSearched && searchResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-mono text-white/30">
                  推荐结果 (点击选择)
                </p>
                {searchResults.map((result, i) => (
                  <MatchResultCard
                    key={result.name}
                    result={result}
                    accentColor="purple"
                    onClick={() => handleSelectResult(result.name)}
                    index={i}
                  />
                ))}
              </div>
            )}

            {!isSearching && hasSearched && searchResults.length === 0 && (
              <div className="text-center py-3">
                <p className="text-xs font-mono text-white/30">
                  未找到匹配服务，可从下方列表选择
                </p>
              </div>
            )}

            {/* 已配置的服务器 */}
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-3 text-white/30">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-xs font-mono">加载已配置服务器...</span>
              </div>
            ) : servers.length > 0 && (
              <div>
                <p className="text-[11px] font-mono text-white/30 mb-2">
                  {hasSearched ? '全部已配置服务器' : '已配置的服务器 (点击选择)'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {servers.map((s) => (
                    <button
                      key={s.name}
                      onClick={() => handleSelectServer(s.name)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border transition-all',
                        s.connected
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20'
                          : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/70'
                      )}
                    >
                      {s.connected
                        ? <CheckCircle2 className="w-3 h-3" />
                        : <AlertCircle className="w-3 h-3 text-white/30" />
                      }
                      {s.name}
                      {s.tools > 0 && (
                        <span className="text-[10px] text-white/30">{s.tools} tools</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 帮助提示 */}
            <p className="text-[10px] text-white/25 leading-relaxed">
              服务器需要在 <code className="text-purple-300/60">mcp-servers.json</code> 中预先配置。
              配置格式包含 command、args 和可选的 env 字段。
            </p>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 bg-black/20 flex-shrink-0">
            <button
              onClick={resetAndClose}
              className="px-4 py-2 text-xs font-mono text-white/50 hover:text-white/70 transition-colors"
            >
              取消
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
