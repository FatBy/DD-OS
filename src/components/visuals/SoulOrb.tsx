import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import type { SoulIdentity, SkillNode } from '@/types'

interface SoulOrbProps {
  identity?: SoulIdentity
  skills?: SkillNode[]      // 关键：传入技能数据作为粒子源
  complexity?: number       // 0-100
  activity?: number         // 0-1
}

// 粒子定义：每个粒子代表一个技能
interface Particle {
  id: string
  x: number; y: number; z: number
  angle: number
  speed: number
  radiusX: number; radiusY: number
  tilt: number              // 轨道倾角，制造 3D 混乱感
  color: string
  size: number
  alpha: number
  active: boolean
}

export function SoulOrb({ identity, skills = [], complexity = 50, activity = 0.5 }: SoulOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  
  // 1. 基于名字生成唯一的配色方案 (Cyberpunk风格)
  const getColors = (name: string) => {
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
    const h = Math.abs(hash % 360)
    return {
      core: `hsla(${h}, 85%, 60%, 1)`,
      glow: `hsla(${h}, 90%, 70%, 0.5)`,
      // 激活技能：高亮核心色
      skillActive: `hsla(${h}, 95%, 85%, 1)`,
      // 未激活技能：互补色低饱和，作为背景暗流
      skillInactive: `hsla(${(h + 180) % 360}, 10%, 40%, 0.2)` 
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number
    let time = 0
    const colors = getColors(identity?.name || 'Unknown')

    // 2. 初始化粒子系统 (One Skill = One Particle)
    // 如果没有技能，生成一些假粒子作为占位，避免画面空荡
    const sourceData = skills.length > 0 ? skills : Array.from({ length: 20 }).map((_, i) => ({ 
      id: `dummy-${i}`, unlocked: Math.random() > 0.7, status: 'inactive' 
    })) as any[]

    const particles: Particle[] = sourceData.map((skill, i) => {
      const isActive = skill.unlocked || skill.status === 'active'
      const baseR = 100 // 基础半径，resize时重置
      
      return {
        id: skill.id,
        x: 0, y: 0, z: 0,
        // 均匀分布起始角度，避免重叠
        angle: (Math.PI * 2 * i) / (sourceData.length || 1), 
        // 激活的转得快，模拟高能电子
        speed: (isActive ? 0.008 : 0.003) * (Math.random() * 0.5 + 0.8), 
        radiusX: baseR,
        radiusY: baseR,
        // 随机轨道倾角，构建球形电子云
        tilt: Math.random() * Math.PI * 2, 
        color: isActive ? colors.skillActive : colors.skillInactive,
        size: isActive ? Math.random() * 2 + 1.5 : Math.random() + 0.5,
        alpha: isActive ? 0.9 : 0.3,
        active: isActive
      }
    })

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)

      // 响应式调整半径
      const minDim = Math.min(rect.width, rect.height)
      particles.forEach(p => {
        // 激活的粒子轨道更紧凑(靠近核心)，未激活的更发散(外围潜能)
        const range = p.active ? 0.28 : 0.45
        const randomOffset = Math.random() * 0.1
        const r = minDim * (range + randomOffset)
        
        p.radiusX = r
        // 稍微压扁 Y 轴，增加透视感
        p.radiusY = r * (Math.random() * 0.3 + 0.6) 
      })
    }
    
    // 立即执行一次 resize 以确保初始尺寸正确
    resize()
    window.addEventListener('resize', resize)

    // 3. 渲染循环
    const render = () => {
      // 动态速度：activity 越高，时间流逝越快 (最大 3 倍速)
      const speedMult = 1 + activity * 2
      time += 0.01 * speedMult
      
      const w = canvas.width / (window.devicePixelRatio || 1)
      const h = canvas.height / (window.devicePixelRatio || 1)
      const cx = w / 2
      const cy = h / 2
      const coreR = Math.min(w, h) * 0.16 // 核心大小

      ctx.clearRect(0, 0, w, h)

      // --- Layer 1: 核心光晕 (呼吸效果) ---
      const breath = Math.sin(time * 1.5) * 0.05 + 1
      const grad = ctx.createRadialGradient(cx, cy, coreR * 0.5, cx, cy, coreR * 3 * breath)
      grad.addColorStop(0, colors.glow)
      grad.addColorStop(0.5, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)

      // --- Layer 2: 核心实体 (模拟液体球) ---
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
      ctx.clip()
      
      // 背景深色
      const coreBg = ctx.createRadialGradient(cx - coreR*0.3, cy - coreR*0.3, 0, cx, cy, coreR)
      coreBg.addColorStop(0, `hsla(0, 0%, 15%, 1)`) 
      coreBg.addColorStop(1, `hsla(0, 0%, 5%, 1)`)
      ctx.fillStyle = coreBg
      ctx.fill()
      
      // 绘制核心上的能量纹路 (Lissajous figures / Sine waves)
      const lines = 6 + Math.floor(complexity / 10)
      ctx.strokeStyle = colors.core
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.5
      
      for (let i = 0; i < lines; i++) {
        ctx.beginPath()
        const phase = (i / lines) * Math.PI * 2
        // 让纹路随时间旋转并变形
        for (let x = -coreR; x <= coreR; x += 2) {
          // 球面透视 + 正弦波干扰
          const yBase = Math.sin(x / coreR * Math.PI + time + phase) * (coreR * 0.4)
          const scale = Math.sqrt(1 - (x/coreR)**2) // 圆形遮罩边缘收缩
          
          // 2D 旋转矩阵模拟球体自转
          const rot = time * 0.2
          const rx = x * Math.cos(rot) - yBase * scale * Math.sin(rot)
          const ry = x * Math.sin(rot) + yBase * scale * Math.cos(rot)
          
          if (x === -coreR) ctx.moveTo(cx + rx, cy + ry)
          else ctx.lineTo(cx + rx, cy + ry)
        }
        ctx.stroke()
      }
      ctx.restore()

      // --- Layer 3: 技能粒子 (3D 轨道投影) ---
      particles.forEach(p => {
        p.angle += p.speed * speedMult
        
        // 3D 坐标计算 (核心算法)
        // 1. 在 2D 平面上做圆周运动
        const ux = Math.cos(p.angle) * p.radiusX
        const uy = Math.sin(p.angle) * p.radiusY
        
        // 2. 应用轨道倾角 (Tilt) 旋转，产生 3D 环绕效果
        const cosT = Math.cos(p.tilt)
        const sinT = Math.sin(p.tilt)
        
        // 3. 投影到屏幕坐标 (x, y) 和深度 (z)
        // Z 轴用于缩放和透明度 (近大远小)
        const x = ux * cosT - uy * sinT
        const y = ux * sinT + uy * cosT
        const z = Math.sin(p.angle) 
        
        const pScale = 1 + z * 0.25     // 近大远小幅度
        const alpha = p.alpha * (0.6 + z * 0.4) // 近亮远暗
        
        // 绘制粒子
        ctx.beginPath()
        ctx.arc(cx + x, cy + y, p.size * pScale, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.globalAlpha = Math.max(0.05, alpha)
        ctx.fill()
        
        // 4. 能量连接线 (仅激活粒子，且偶尔出现)
        if (p.active && Math.random() > 0.99) {
            ctx.beginPath()
            ctx.moveTo(cx + x, cy + y)
            ctx.lineTo(cx, cy) // 连向核心
            ctx.strokeStyle = colors.skillActive
            ctx.lineWidth = 0.5
            ctx.globalAlpha = 0.3
            ctx.stroke()
        }
      })
      ctx.globalAlpha = 1

      animationFrameId = requestAnimationFrame(render)
    }
    render()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animationFrameId)
    }
  }, [identity, skills, complexity, activity])

  return (
    <div className="relative w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full block" />
      
      {/* 视觉中心的文字 (HUD) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
        <div className="text-center pt-48 z-10 mix-blend-screen opacity-90">
           <motion.div
             initial={{ opacity: 0, scale: 0.9 }}
             animate={{ opacity: 1, scale: 1 }}
             transition={{ duration: 1.5 }}
           >
              <h2 className="text-4xl font-black text-white tracking-[0.2em] uppercase blur-[0.5px] drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">
                {identity?.name || 'GENESIS'}
              </h2>
              <div className="flex items-center justify-center gap-3 mt-2 opacity-70">
                <span className="h-[1px] w-8 bg-cyan-400"></span>
                <p className="text-[13px] font-mono text-cyan-200 uppercase tracking-widest">
                  Soul Core Active
                </p>
                <span className="h-[1px] w-8 bg-cyan-400"></span>
              </div>
           </motion.div>
        </div>
      </div>
    </div>
  )
}
