import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { SoulIdentity } from '@/types'

interface SoulOrbProps {
  identity?: SoulIdentity
  complexity?: number // 0-100, 映射维度丰富度
  activity?: number // 0-1, 映射当前活跃度
}

export function SoulOrb({ identity, complexity = 50, activity = 0.5 }: SoulOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 })
  
  // 根据身份名称生成唯一的颜色种子
  const getColors = (name: string) => {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    const h = Math.abs(hash % 360)
    return {
      core: `hsla(${h}, 80%, 60%, 1)`,
      glow: `hsla(${h}, 90%, 70%, 0.5)`,
      ring: `hsla(${(h + 180) % 360}, 70%, 60%, 0.3)`,
      particle: `hsla(${(h + 60) % 360}, 85%, 75%, 0.8)`,
      hue: h,
    }
  }

  // 鼠标移动交互
  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.width / 2
    const cy = rect.height / 2
    const x = (e.clientX - rect.left - cx) / cx
    const y = (e.clientY - rect.top - cy) / cy
    setMouseOffset({ x: x * 0.1, y: y * 0.1 })
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number
    let time = 0

    const colors = getColors(identity?.name || 'Genesis')
    
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)
    }
    
    window.addEventListener('resize', resize)
    resize()

    const render = () => {
      time += 0.01 + (activity * 0.02)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const cx = w / 2 + mouseOffset.x * 20
      const cy = h / 2 + mouseOffset.y * 20
      const radius = Math.min(w, h) * 0.22

      ctx.clearRect(0, 0, w, h)
      
      // 1. 绘制深空背景渐变
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h))
      bgGrad.addColorStop(0, `hsla(${colors.hue}, 30%, 8%, 1)`)
      bgGrad.addColorStop(0.5, `hsla(${colors.hue}, 20%, 4%, 1)`)
      bgGrad.addColorStop(1, 'hsla(220, 30%, 2%, 1)')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, w, h)
      
      // 2. 绘制光晕背景 (呼吸效果)
      const breathing = Math.sin(time) * 0.15 + 1
      const glowGrad = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius * 2.5 * breathing)
      glowGrad.addColorStop(0, colors.glow)
      glowGrad.addColorStop(0.3, `hsla(${colors.hue}, 70%, 50%, 0.15)`)
      glowGrad.addColorStop(0.6, `hsla(${colors.hue}, 60%, 40%, 0.05)`)
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glowGrad
      ctx.fillRect(0, 0, w, h)

      // 3. 绘制核心球体
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.clip()
      
      // 核心底色渐变
      const coreGrad = ctx.createRadialGradient(
        cx - radius * 0.3, cy - radius * 0.3, 0,
        cx, cy, radius
      )
      coreGrad.addColorStop(0, `hsla(${colors.hue}, 40%, 25%, 1)`)
      coreGrad.addColorStop(0.7, `hsla(${colors.hue}, 50%, 12%, 1)`)
      coreGrad.addColorStop(1, `hsla(${colors.hue}, 60%, 5%, 1)`)
      ctx.fillStyle = coreGrad
      ctx.fill()
      
      // 绘制流动的能量线 (涌现纹理)
      const lines = 8 + Math.floor(complexity / 8)
      for (let i = 0; i < lines; i++) {
        ctx.beginPath()
        const offset = (i / lines) * Math.PI * 2
        const waveAmp = radius * (0.3 + (complexity / 200))
        
        for (let x = -radius; x < radius; x += 2) {
          // 球面透视修正
          const normalizedX = x / radius
          const sphereScale = Math.sqrt(Math.max(0, 1 - normalizedX * normalizedX))
          const yOffset = Math.sin(normalizedX * Math.PI * 2 + time * 1.5 + offset) * waveAmp
          const y = cy + yOffset * sphereScale
          const drawX = cx + x
          
          if (x === -radius) ctx.moveTo(drawX, y)
          else ctx.lineTo(drawX, y)
        }
        
        ctx.strokeStyle = colors.core
        ctx.lineWidth = 1.2
        ctx.globalAlpha = 0.25 + (i % 3) * 0.1
        ctx.stroke()
      }
      
      // 核心高光
      ctx.globalAlpha = 1
      const highlightGrad = ctx.createRadialGradient(
        cx - radius * 0.4, cy - radius * 0.4, 0,
        cx - radius * 0.2, cy - radius * 0.2, radius * 0.8
      )
      highlightGrad.addColorStop(0, 'rgba(255,255,255,0.15)')
      highlightGrad.addColorStop(0.5, 'rgba(255,255,255,0.03)')
      highlightGrad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = highlightGrad
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fill()
      
      ctx.restore()

      // 4. 绘制星环 (根据复杂度增加环)
      const rings = 2 + Math.floor(complexity / 35)
      for (let i = 0; i < rings; i++) {
        ctx.save()
        ctx.translate(cx, cy)
        
        const rotationSpeed = (i % 2 === 0 ? 1 : -1) * (0.15 + i * 0.08)
        ctx.rotate(time * rotationSpeed + i * 0.5)
        
        // 椭圆环
        const ringRadiusX = radius * (1.4 + i * 0.35)
        const ringRadiusY = radius * (0.25 + i * 0.08)
        const tiltAngle = Math.PI / 5 + i * 0.15
        
        ctx.rotate(tiltAngle)
        
        ctx.beginPath()
        ctx.ellipse(0, 0, ringRadiusX, ringRadiusY, 0, 0, Math.PI * 2)
        ctx.strokeStyle = colors.ring
        ctx.lineWidth = 1.5 - i * 0.2
        ctx.globalAlpha = 0.4 - i * 0.08
        ctx.stroke()
        
        // 环上的粒子
        const particleCount = 2 + i
        for (let p = 0; p < particleCount; p++) {
          const particleAngle = time * (1.5 + i * 0.3) + (p / particleCount) * Math.PI * 2
          const px = Math.cos(particleAngle) * ringRadiusX
          const py = Math.sin(particleAngle) * ringRadiusY
          
          ctx.beginPath()
          ctx.arc(px, py, 2.5 - i * 0.3, 0, Math.PI * 2)
          ctx.fillStyle = colors.particle
          ctx.globalAlpha = 0.8 - i * 0.15
          ctx.fill()
          
          // 粒子拖尾
          ctx.beginPath()
          ctx.moveTo(px, py)
          const tailAngle = particleAngle - 0.3
          const tailX = Math.cos(tailAngle) * ringRadiusX
          const tailY = Math.sin(tailAngle) * ringRadiusY
          ctx.lineTo(tailX, tailY)
          ctx.strokeStyle = colors.particle
          ctx.lineWidth = 1
          ctx.globalAlpha = 0.3
          ctx.stroke()
        }
        
        ctx.restore()
      }

      // 5. 外围散射粒子
      ctx.globalAlpha = 1
      const particleNum = 15 + Math.floor(activity * 20)
      for (let i = 0; i < particleNum; i++) {
        const angle = (i / particleNum) * Math.PI * 2 + time * 0.2
        const dist = radius * (2 + Math.sin(time * 0.5 + i) * 0.5)
        const px = cx + Math.cos(angle) * dist
        const py = cy + Math.sin(angle) * dist * 0.6
        const size = 1 + Math.sin(time + i * 0.5) * 0.5
        
        ctx.beginPath()
        ctx.arc(px, py, size, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${colors.hue}, 70%, 70%, ${0.2 + Math.sin(time + i) * 0.15})`
        ctx.fill()
      }

      animationFrameId = requestAnimationFrame(render)
    }

    render()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animationFrameId)
    }
  }, [identity, complexity, activity, mouseOffset])

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1.2, ease: 'easeOut' }}
      className="relative w-full h-full"
      onMouseMove={handleMouseMove}
    >
      <canvas ref={canvasRef} className="w-full h-full" />
      
      {/* 悬浮的文字层 */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <motion.div 
          className="text-center"
          style={{ marginTop: '30%' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.6 }}
        >
          <h2 className="text-2xl font-bold text-white/90 drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] tracking-[0.2em] uppercase font-mono">
            {identity?.name || 'Genesis'}
          </h2>
          <p className="text-xs font-mono text-purple-200/60 mt-2 bg-black/40 px-3 py-1 rounded-full inline-block backdrop-blur-sm border border-white/10">
            {identity?.essence || 'System Core'}
          </p>
        </motion.div>
      </div>
    </motion.div>
  )
}
