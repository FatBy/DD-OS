import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// OpenClaw Gateway 地址
// 本地开发: ws://localhost:18789
// 远程连接: ws://192.168.x.x:18789
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY || 'ws://localhost:18789'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // WebSocket 代理 - 转发到 OpenClaw Gateway
      '/ws': {
        target: GATEWAY_URL,
        ws: true,
        changeOrigin: true,
      },
      // HTTP API 代理
      '/api': {
        target: GATEWAY_URL.replace('ws://', 'http://').replace('wss://', 'https://'),
        changeOrigin: true,
      },
    },
  },
})
