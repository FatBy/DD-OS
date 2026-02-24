import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { crashMonitor } from './services/crashMonitor'

// 初始化崩溃监控 (必须在 React 渲染前)
crashMonitor.init()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
