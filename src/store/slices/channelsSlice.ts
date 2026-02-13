import type { StateCreator } from 'zustand'
import type { Channel, ChannelType, ChannelsSnapshot, SkillNode } from '@/types'
import { channelsToSkills } from '@/utils/dataMapper'

export interface ChannelsSlice {
  // 原始 OpenClaw 数据
  channelOrder: ChannelType[]
  channels: Record<string, Channel>
  channelsLoading: boolean
  selectedChannelId: ChannelType | null
  
  // 映射后的 UI 数据
  skills: SkillNode[]
  
  // Actions
  setChannelsSnapshot: (snapshot: ChannelsSnapshot) => void
  updateChannel: (id: ChannelType, updates: Partial<Channel>) => void
  setChannelConnected: (id: ChannelType, accountId: string, connected: boolean) => void
  setSelectedChannel: (id: ChannelType | null) => void
  setChannelsLoading: (loading: boolean) => void
}

export const createChannelsSlice: StateCreator<ChannelsSlice> = (set) => ({
  channelOrder: [],
  channels: {},
  channelsLoading: true,
  selectedChannelId: null,
  skills: [],

  setChannelsSnapshot: (snapshot) => {
    // 规范化响应: 确保 channelOrder 存在
    const channelOrder = snapshot.channelOrder || Object.keys(snapshot.channels || {}) as ChannelType[]
    const channels = snapshot.channels || {}
    
    set({
      channelOrder,
      channels,
      skills: channelsToSkills(channels, channelOrder),
      channelsLoading: false,
    })
  },
  
  updateChannel: (id, updates) => set((state) => {
    const newChannels = {
      ...state.channels,
      [id]: { ...state.channels[id], ...updates },
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
    return {
      channels: newChannels,
      skills: channelsToSkills(newChannels, state.channelOrder),
    }
  }),
  
  setSelectedChannel: (id) => set({ selectedChannelId: id }),
  
  setChannelsLoading: (loading) => set({ channelsLoading: loading }),
})
