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
import { ApprovalModal } from '@/components/ApprovalModal'
import { NexusDetailPanel } from '@/components/world/NexusDetailPanel'
import { useStore } from '@/store'
import { getHouseById } from '@/houses/registry'
import { openClawService } from '@/services/OpenClawService'
import { localClawService } from '@/services/LocalClawService'
import { getLocalSoulData, getLocalSkills, getLocalMemories } from '@/utils/localDataProvider'
import { simpleVisualDNA } from '@/store/slices/worldSlice'
import { restoreLLMConfigFromServer } from '@/services/llmService'

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
      
      // P3: 危险操作审批
      requestApproval: useStore.getState().requestApproval,
      
      // P4: Nexus 数据注入
      setNexusesFromServer: useStore.getState().setNexusesFromServer,
      setActiveNexus: useStore.getState().setActiveNexus,
      updateNexusXP: useStore.getState().updateNexusXP,
      get activeNexusId() { return useStore.getState().activeNexusId },
      get nexuses() { return useStore.getState().nexuses },
    }

    // 注入到 OpenClaw 服务 (兼容模式)
    openClawService.injectStore(storeActions)
    
    // 注入到 LocalClaw 服务 (Native 模式)
    localClawService.injectStore(storeActions as any)

    // 自动重连: 恢复上次的连接状态
    const savedMode = localStorage.getItem('ddos_connection_mode')
    
    // LLM 配置自动恢复：先尝试从后端恢复，再检查localStorage
    const tryRestoreLLMConfig = async () => {
      // 先尝试从后端文件系统恢复（解决跨端口问题）
      const serverConfig = await restoreLLMConfigFromServer()
      
      // 再次检查配置（可能已从后端恢复到localStorage）
      const llmConfig = useStore.getState().llmConfig
      const finalConfig = serverConfig || llmConfig
      
      if (finalConfig.apiKey && finalConfig.baseUrl && finalConfig.model) {
        // 更新store状态
        if (serverConfig) {
          useStore.getState().setLlmConfig(serverConfig)
        }
        useStore.getState().setLlmConnected(true)
        console.log('[App] LLM config restored')
      }
    }
    tryRestoreLLMConfig()

    // 种子 Nexus: 仅在后端未加载 Nexus 时作为 fallback
    // Phase 4: 实际 Nexus 数据将从 /nexuses API 加载
    // 延迟 3 秒检查，给后端加载留出时间
    setTimeout(() => {
      const state = useStore.getState()
      // 如果后端已经加载了 nexuses (通过 loadAllDataToStore)，则跳过
      if (state.nexuses.size === 0) {
        const seedNexusId = 'skill-scout'
        useStore.getState().addNexus({
          id: seedNexusId,
          position: { gridX: 3, gridY: -2 },
          level: 2,
          xp: 80,
          visualDNA: simpleVisualDNA(seedNexusId),
          label: 'Skill Scout',
          constructionProgress: 1,
          createdAt: Date.now(),
          boundSkillId: 'skill-scout',
          boundSkillIds: ['skill-scout', 'skill-generator'],
          flavorText: '持续扫描全球 SKILL 社区，发现并安装新能力',
        })
        console.log('[App] Fallback: Seeded Nexus (backend not available)')
      }
    }, 3000)

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

  const initTheme = useStore((s) => s.initTheme)
  const worldTheme = useStore((s) => s.worldTheme)

  // 初始化主题
  useEffect(() => {
    initTheme()
  }, [initTheme])

  // 根据 worldTheme 切换 CSS 主题类
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('theme-cityscape', 'theme-village')
    if (worldTheme === 'cityscape') {
      root.classList.add('theme-cityscape')
    } else if (worldTheme === 'village') {
      root.classList.add('theme-village')
    }
  }, [worldTheme])

  return (
    <div className="flex w-screen h-screen overflow-hidden bg-skin-bg-primary text-skin-text-primary">
      {/* 左侧导航栏 */}
      <Dock />

      {/* 主内容区域 */}
      <div className="relative flex-1 min-w-0 h-full overflow-hidden">
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

        {/* Connection control panel */}
        <ConnectionPanel />
      </div>

      {/* AI Chat panel - 居中弹出覆盖层 */}
      <AIChatPanel />

      {/* Observer: Nexus build proposal modal */}
      <BuildProposalModal />
      <ApprovalModal />

      {/* Nexus detail panel */}
      <NexusDetailPanel />

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  )
}

export default App
