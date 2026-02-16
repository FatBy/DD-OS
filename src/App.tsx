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
      
      // AI 执行状态
      updateExecutionStatus: useStore.getState().updateExecutionStatus,
    }

    // 注入到 OpenClaw 服务 (兼容模式)
    openClawService.injectStore(storeActions)
    
    // 注入到 LocalClaw 服务 (Native 模式)
    localClawService.injectStore(storeActions as any)

    // 自动重连: 恢复上次的连接状态
    const savedMode = localStorage.getItem('ddos_connection_mode')
    if (savedMode) {
      useStore.getState().setConnectionMode(savedMode as 'native' | 'openclaw')

      if (savedMode === 'native') {
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
