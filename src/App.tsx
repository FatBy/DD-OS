import { useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { WorldView } from '@/components/WorldView'
import { Dock } from '@/components/Dock'
import { HouseContainer } from '@/components/HouseContainer'
import { ConnectionPanel } from '@/components/ConnectionPanel'
import { ToastContainer } from '@/components/Toast'
import { AIChatPanel } from '@/components/ai/AIChatPanel'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { BuildProposalModal } from '@/components/world/BuildProposalModal'
import { NexusDetailPanel } from '@/components/world/NexusDetailPanel'
import { useStore } from '@/store'
import { getHouseById } from '@/houses/registry'
import { openClawService } from '@/services/OpenClawService'
import { localClawService } from '@/services/LocalClawService'
import { getLocalSoulData, getLocalSkills, getLocalMemories } from '@/utils/localDataProvider'

/**
 * 从 localStorage 缓存立即恢复数据到 store
 * 在服务器连接之前先显示上次的数据，避免空白等待
 */
function restoreLocalCacheToStore(storeActions: any) {
  let restored = false

  // Soul
  const soulData = getLocalSoulData()
  if (soulData) {
    storeActions.setSoulFromParsed({
      title: '',
      subtitle: soulData.identity.essence,
      coreTruths: soulData.coreTruths,
      boundaries: soulData.boundaries,
      vibeStatement: soulData.vibeStatement,
      continuityNote: soulData.continuityNote,
      rawContent: soulData.rawContent,
    }, null)
    restored = true
  }

  // Skills
  const skills = getLocalSkills()
  if (skills.length > 0) {
    storeActions.setOpenClawSkills(skills)
    restored = true
  }

  // Memories
  const memories = getLocalMemories()
  if (memories.length > 0) {
    storeActions.setMemories(memories)
    restored = true
  }

  if (restored) {
    console.log('[App] Restored cached data from localStorage (Soul/Skills/Memories)')
  }
}

function App() {
  const currentView = useStore((s) => s.currentView)
  const currentHouse = getHouseById(currentView)

  // Initialize services on mount
  useEffect(() => {
    const storeActions = {
      // Connection
      setConnectionStatus: useStore.getState().setConnectionStatus,
      setConnectionError: useStore.getState().setConnectionError,
      setReconnectAttempt: useStore.getState().setReconnectAttempt,
      setReconnectCountdown: useStore.getState().setReconnectCountdown,
      addToast: useStore.getState().addToast,
      
      // Sessions → Tasks
      setSessions: useStore.getState().setSessions,
      addSession: useStore.getState().addSession,
      updateSession: useStore.getState().updateSession,
      removeSession: useStore.getState().removeSession,
      setSessionsLoading: useStore.getState().setSessionsLoading,
      
      // Channels → Skills (兼容)
      setChannelsSnapshot: useStore.getState().setChannelsSnapshot,
      setChannelConnected: useStore.getState().setChannelConnected,
      setChannelsLoading: useStore.getState().setChannelsLoading,
      
      // OpenClaw Skills → Skills (新)
      setOpenClawSkills: useStore.getState().setOpenClawSkills,
      
      // Agent → Memories
      setAgentIdentity: useStore.getState().setAgentIdentity,
      setAgentStatus: useStore.getState().setAgentStatus,
      addRunEvent: useStore.getState().addRunEvent,
      addLog: useStore.getState().addLog,
      setAgentLoading: useStore.getState().setAgentLoading,
      setMemoriesFromSessions: useStore.getState().setMemoriesFromSessions,
      
      // Devices → Soul
      setPresenceSnapshot: useStore.getState().setPresenceSnapshot,
      updateDevice: useStore.getState().updateDevice,
      removeDevice: useStore.getState().removeDevice,
      setHealth: useStore.getState().setHealth,
      setDevicesLoading: useStore.getState().setDevicesLoading,
      updateSoulFromState: useStore.getState().updateSoulFromState,
      
      // Soul from SOUL.md
      setSoulFromParsed: useStore.getState().setSoulFromParsed,
      
      // Memories 直接设置
      setMemories: useStore.getState().setMemories,
      
      // AI 执行状态
      updateExecutionStatus: useStore.getState().updateExecutionStatus,
      
      // Native 模式: Agent 任务上下文
      setCurrentTask: useStore.getState().setCurrentTask,
      
      // Native 模式: 实时执行任务管理
      addActiveExecution: useStore.getState().addActiveExecution,
      updateActiveExecution: useStore.getState().updateActiveExecution,
      removeActiveExecution: useStore.getState().removeActiveExecution,
    }

    // 注入到 OpenClaw 服务 (兼容模式)
    openClawService.injectStore(storeActions)
    
    // 注入到 LocalClaw 服务 (Native 模式)
    localClawService.injectStore(storeActions as any)

    // 自动重连: 恢复上次的连接状态
    const savedMode = localStorage.getItem('ddos_connection_mode')
    
    // LLM 配置自动恢复 + 自动验证
    const llmConfig = useStore.getState().llmConfig
    if (llmConfig.apiKey && llmConfig.baseUrl && llmConfig.model) {
      console.log('[App] LLM config restored from localStorage')
      useStore.getState().setLlmConnected(true) // 标记为已配置
    }

    if (savedMode) {
      useStore.getState().setConnectionMode(savedMode as 'native' | 'openclaw')

      if (savedMode === 'native') {
        // 立即从 localStorage 恢复缓存数据 (无需等待服务器)
        restoreLocalCacheToStore(storeActions)

        // Native 模式: 静默尝试连接本地服务器
        console.log('[App] Auto-reconnecting to Native server...')
        localClawService.connect().then(success => {
          if (success) {
            console.log('[App] Auto-reconnect successful')
          } else {
            console.log('[App] Auto-reconnect failed, server may not be running')
            // 静默失败 - 不显示错误状态，保持断开
            useStore.getState().setConnectionStatus('disconnected')
            useStore.getState().setSessionsLoading(false)
            useStore.getState().setChannelsLoading(false)
            useStore.getState().setDevicesLoading(false)
          }
        })
      } else if (savedMode === 'openclaw') {
        // OpenClaw 模式: 使用保存的凭据重连
        const savedToken = localStorage.getItem('openclaw_auth_token')
        const savedGateway = localStorage.getItem('openclaw_gateway_url')
        if (savedToken && savedGateway) {
          console.log('[App] Auto-reconnecting to OpenClaw...')
          openClawService.setGatewayUrl(savedGateway)
          openClawService.setAuthToken(savedToken)
          openClawService.connect()
        }
      }
    } else {
      // 首次使用: 所有 loading 设为 false 以显示默认内容
      useStore.getState().setSessionsLoading(false)
      useStore.getState().setChannelsLoading(false)
      useStore.getState().setDevicesLoading(false)
    }

    // Cleanup on unmount
    return () => {
      openClawService.disconnect()
      localClawService.disconnect()
    }
  }, [])

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 text-white select-none">
      {/* Background layer: always present */}
      <ErrorBoundary>
        <WorldView />
      </ErrorBoundary>

      {/* Content layer: active house */}
      <AnimatePresence mode="wait">
        {currentView !== 'world' && currentHouse && (
          <HouseContainer key={currentView} house={currentHouse}>
            <currentHouse.component />
          </HouseContainer>
        )}
      </AnimatePresence>

      {/* Navigation layer: Dock */}
      <Dock />

      {/* Connection control panel */}
      <ConnectionPanel />

      {/* AI Chat panel */}
      <AIChatPanel />

      {/* Observer: Nexus build proposal modal */}
      <BuildProposalModal />

      {/* Nexus detail panel */}
      <NexusDetailPanel />

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  )
}

export default App
