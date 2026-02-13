import type { StateCreator } from 'zustand'
import type { Channel, ChannelType, ChannelsSnapshot, SkillNode, OpenClawSkill, SkillsSnapshot } from '@/types'
import { channelsToSkills, openClawSkillsToNodes } from '@/utils/dataMapper'

export interface ChannelsSlice {
  // 原始 OpenClaw 数据 (Channels - 保留兼容)
  channelOrder: ChannelType[]
  channels: Record<string, Channel>
  
  // 原始 OpenClaw 数据 (Skills - 新增)
  openClawSkills: OpenClawSkill[]
  
  // 加载状态
  channelsLoading: boolean
  selectedChannelId: ChannelType | null
  
  // 映射后的 UI 数据
  skills: SkillNode[]
  
  // Actions - Channels (兼容)
  setChannelsSnapshot: (snapshot: ChannelsSnapshot) => void
  updateChannel: (id: ChannelType, updates: Partial<Channel>) => void
  setChannelConnected: (id: ChannelType, accountId: string, connected: boolean) => void
  setSelectedChannel: (id: ChannelType | null) => void
  setChannelsLoading: (loading: boolean) => void
  
  // Actions - Skills (新增)
  setSkillsSnapshot: (snapshot: SkillsSnapshot) => void
  setOpenClawSkills: (skills: OpenClawSkill[]) => void
}

export const createChannelsSlice: StateCreator<ChannelsSlice> = (set) => ({
  channelOrder: [],
  channels: {},
  openClawSkills: [],
  channelsLoading: true,
  selectedChannelId: null,
  skills: [],

  // 设置 Channels 数据 (兼容旧 API)
  setChannelsSnapshot: (snapshot) => {
    const channelOrder = snapshot.channelOrder || Object.keys(snapshot.channels || {}) as ChannelType[]
    const channels = snapshot.channels || {}
    
    set((state) => {
      // 如果已有 OpenClaw Skills，优先使用 Skills
      if (state.openClawSkills.length > 0) {
        return {
          channelOrder,
          channels,
          channelsLoading: false,
        }
      }
      // 否则使用 Channels 映射
      return {
        channelOrder,
        channels,
        skills: channelsToSkills(channels, channelOrder),
        channelsLoading: false,
      }
    })
  },
  
  // 设置 Skills 数据 (新 API: skills.list)
  setSkillsSnapshot: (snapshot) => {
    const skills = snapshot.skills || []
    set({
      openClawSkills: skills,
      skills: openClawSkillsToNodes(skills),
      channelsLoading: false,
    })
  },
  
  // 直接设置 OpenClaw Skills 数组
  setOpenClawSkills: (skills) => set({
    openClawSkills: skills,
    skills: openClawSkillsToNodes(skills),
    channelsLoading: false,
  }),
  
  updateChannel: (id, updates) => set((state) => {
    const newChannels = {
      ...state.channels,
      [id]: { ...state.channels[id], ...updates },
    }
    // 只有在没有 OpenClaw Skills 时才更新 skills
    if (state.openClawSkills.length > 0) {
      return { channels: newChannels }
    }
    return {
      channels: newChannels,
      skills: channelsToSkills(newChannels, state.channelOrder),
    }
  }),
  
  setChannelConnected: (id, accountId, connected) => set((state) => {
    const channel = state.channels[id]
    if (!channel) return state
    
    const newChannels = {
      ...state.channels,
      [id]: {
        ...channel,
        accounts: channel.accounts.map((acc) =>
          acc.accountId === accountId
            ? { ...acc, connected, connectedAt: connected ? Date.now() : acc.connectedAt }
            : acc
        ),
      },
    }
    // 只有在没有 OpenClaw Skills 时才更新 skills
    if (state.openClawSkills.length > 0) {
      return { channels: newChannels }
    }
    return {
      channels: newChannels,
      skills: channelsToSkills(newChannels, state.channelOrder),
    }
  }),
  
  setSelectedChannel: (id) => set({ selectedChannelId: id }),
  
  setChannelsLoading: (loading) => set({ channelsLoading: loading }),
})
