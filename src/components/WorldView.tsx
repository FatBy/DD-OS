import { useEffect, useRef, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '@/store'

interface Particle {
  x: number
  y: number
  size: number
  speedX: number
  speedY: number
  opacity: number
}

export function WorldView() {
  const currentView = useStore((s) => s.currentView)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const isHouseOpen = currentView !== 'world'

  const particles = useMemo(() => {
    const arr: Particle[] = []
    for (let i = 0; i < 60; i++) {
      arr.push({
        x: Math.random() * 2000,
        y: Math.random() * 1200,
        size: Math.random() * 2 + 0.5,
        speedX: (Math.random() - 0.5) * 0.3,
        speedY: (Math.random() - 0.5) * 0.3,
        opacity: Math.random() * 0.5 + 0.1,
      })
    }
    return arr
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = window.innerWidth + 'px'
      canvas.style.height = window.innerHeight + 'px'
      ctx.scale(dpr, dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    const w = () => window.innerWidth
    const h = () => window.innerHeight

    const draw = () => {
      ctx.clearRect(0, 0, w(), h())

      // Draw grid
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.04)'
      ctx.lineWidth = 1
      const gridSize = 50
      for (let x = 0; x <= w(); x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h())
        ctx.stroke()
      }
      for (let y = 0; y <= h(); y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w(), y)
        ctx.stroke()
      }

      // Draw perspective overlay lines (2.5D feel)
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.02)'
      const cx = w() / 2
      const cy = h() * 0.35
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2
        const ex = cx + Math.cos(angle) * w()
        const ey = cy + Math.sin(angle) * h()
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(ex, ey)
        ctx.stroke()
      }

      // Draw particles
      for (const p of particles) {
        p.x += p.speedX
        p.y += p.speedY
        if (p.x < 0) p.x = w()
        if (p.x > w()) p.x = 0
        if (p.y < 0) p.y = h()
        if (p.y > h()) p.y = 0

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(100, 200, 255, ${p.opacity})`
        ctx.fill()
      }

      // Draw connection lines between close particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 120) {
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `rgba(100, 200, 255, ${0.08 * (1 - dist / 120)})`
            ctx.stroke()
          }
        }
      }

      animRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(animRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [particles])

  return (
    <motion.div
      className="fixed inset-0 z-0 bg-slate-950"
      animate={{
        filter: isHouseOpen ? 'blur(4px)' : 'blur(0px)',
        opacity: isHouseOpen ? 0.3 : 1,
      }}
      transition={{ duration: 0.5 }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      {/* Subtle radial gradient overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_rgba(2,6,23,0.8)_100%)]" />
    </motion.div>
  )
}
