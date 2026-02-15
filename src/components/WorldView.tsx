import { useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '@/store'
import { GameCanvas } from '@/rendering/GameCanvas'

export function WorldView() {
  const currentView = useStore((s) => s.currentView)
  const nexuses = useStore((s) => s.nexuses)
  const camera = useStore((s) => s.camera)
  const selectedNexusId = useStore((s) => s.selectedNexusId)
  const renderSettings = useStore((s) => s.renderSettings)
  const panCamera = useStore((s) => s.panCamera)
  const setZoom = useStore((s) => s.setZoom)
  const selectNexus = useStore((s) => s.selectNexus)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<GameCanvas | null>(null)
  const isDragging = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })

  const isHouseOpen = currentView !== 'world'

  // 初始化/销毁渲染引擎
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      const engine = new GameCanvas(canvas)
      engineRef.current = engine

      const handleResize = () => engine.resize()
      window.addEventListener('resize', handleResize)

      return () => {
        engine.destroy()
        engineRef.current = null
        window.removeEventListener('resize', handleResize)
      }
    } catch (err) {
      console.error('[WorldView] GameCanvas init failed:', err)
    }
  }, [])

  // 同步 store 状态到渲染引擎
  useEffect(() => {
    engineRef.current?.updateState({ nexuses, camera, selectedNexusId, renderSettings })
  }, [nexuses, camera, selectedNexusId, renderSettings])

  // ---- 鼠标交互 ----

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1
    setZoom(camera.zoom * factor)
  }, [camera.zoom, setZoom])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      isDragging.current = true
      lastMouse.current = { x: e.clientX, y: e.clientY }
    }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    const dx = (e.clientX - lastMouse.current.x) / camera.zoom
    const dy = (e.clientY - lastMouse.current.y) / camera.zoom
    panCamera(dx, dy)
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }, [camera.zoom, panCamera])

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    // 如果刚拖拽过，不触发点击
    const engine = engineRef.current
    if (!engine) return

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const world = engine.screenToWorld(screenX, screenY, camera)

    // 找距离最近的 nexus
    let nearest: string | null = null
    let minDist = 1.5 // grid 距离阈值

    for (const [id, nexus] of nexuses) {
      const dx = nexus.position.gridX - world.gridX
      const dy = nexus.position.gridY - world.gridY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < minDist) {
        minDist = dist
        nearest = id
      }
    }

    selectNexus(nearest)
  }, [camera, nexuses, selectNexus])

  return (
    <motion.div
      className="fixed inset-0 z-0 bg-slate-950"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 }}
      animate={{
        filter: isHouseOpen ? 'blur(4px)' : 'blur(0px)',
        opacity: isHouseOpen ? 0.3 : 1,
      }}
      transition={{ duration: 0.5 }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
      />
      {/* Subtle radial gradient overlay */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,_transparent_0%,_rgba(2,6,23,0.8)_100%)]" />
    </motion.div>
  )
}
