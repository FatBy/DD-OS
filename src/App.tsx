import { useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { WorldView } from '@/components/WorldView'
import { Dock } from '@/components/Dock'
import { HouseContainer } from '@/components/HouseContainer'
import { ConnectionPanel } from '@/components/ConnectionPanel'
import { ToastContainer } from '@/components/Toast'
import { AIChatPanel } from '@/components/ai/AIChatPanel'
import { useStore } from '@/store'
import { getHouseById } from '@/houses/registry'
import { openClawService } from '@/services/OpenClawService'

function App() {
  const currentView = useStore((s) => s.currentView)
  const currentHouse = getHouseById(currentView)

  // Initialize WebSocket service on mount
  useEffect(() => {
    // Inject store actions into the service
    openClawService.injectStore({
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
    })

    // Note: Don't auto-connect, let user click connect button
    // openClawService.connect()

    // Cleanup on unmount
    return () => {
      openClawService.disconnect()
    }
  }, [])

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 text-white select-none">
      {/* Background layer: always present */}
      <WorldView />

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

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  )
}

export default App
