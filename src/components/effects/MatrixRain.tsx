import { useEffect, useRef } from 'react'

interface MatrixRainProps {
  color?: string
  opacity?: number
}

export function MatrixRain({ color = '#10b981', opacity = 0.15 }: MatrixRainProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF'
    const fontSize = 14
    let columns = 0
    let drops: number[] = []

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.parentElement?.clientWidth ?? window.innerWidth
      const h = canvas.parentElement?.clientHeight ?? window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      ctx.scale(dpr, dpr)
      columns = Math.floor(w / fontSize)
      drops = Array.from({ length: columns }, () => Math.random() * -100)
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      const w = canvas.parentElement?.clientWidth ?? window.innerWidth
      const h = canvas.parentElement?.clientHeight ?? window.innerHeight

      ctx.fillStyle = `rgba(0, 0, 0, 0.05)`
      ctx.fillRect(0, 0, w, h)

      ctx.font = `${fontSize}px monospace`

      for (let i = 0; i < columns; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)]
        const x = i * fontSize
        const y = drops[i] * fontSize

        // Head character is brighter
        const isHead = true
        ctx.fillStyle = isHead ? color : color
        ctx.globalAlpha = y > 0 ? 0.8 : 0.3
        ctx.fillText(char, x, y)

        // Trail characters are dimmer
        if (y > 0) {
          ctx.globalAlpha = 0.3
          const trailChar = chars[Math.floor(Math.random() * chars.length)]
          ctx.fillText(trailChar, x, y - fontSize)
        }
        ctx.globalAlpha = 1

        if (y > h && Math.random() > 0.975) {
          drops[i] = 0
        }
        drops[i] += 0.5 + Math.random() * 0.5
      }

      animRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(animRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [color])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ opacity }}
    />
  )
}
