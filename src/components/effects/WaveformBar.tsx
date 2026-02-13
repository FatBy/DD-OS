import { useEffect, useRef, useState } from 'react'

interface WaveformBarProps {
  color?: string
  height?: number
}

export function WaveformBar({ color = '#f59e0b', height = 40 }: WaveformBarProps) {
  const [phase, setPhase] = useState(0)
  const animRef = useRef<number>(0)

  useEffect(() => {
    let running = true
    const tick = () => {
      if (!running) return
      setPhase((p) => p + 0.08)
      animRef.current = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      running = false
      cancelAnimationFrame(animRef.current)
    }
  }, [])

  const width = 300
  const waves = [
    { amplitude: 8, frequency: 0.03, phaseOffset: 0, opacity: 0.8 },
    { amplitude: 5, frequency: 0.05, phaseOffset: 1.5, opacity: 0.5 },
    { amplitude: 6, frequency: 0.02, phaseOffset: 3, opacity: 0.3 },
  ]

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ height }}
      preserveAspectRatio="none"
    >
      {waves.map((wave, idx) => {
        const points: string[] = []
        for (let x = 0; x <= width; x += 2) {
          const y =
            height / 2 +
            wave.amplitude *
              Math.sin((x + phase * 40) * wave.frequency + wave.phaseOffset)
          points.push(`${x},${y}`)
        }
        const d = `M ${points.join(' L ')}`
        return (
          <path
            key={idx}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            opacity={wave.opacity}
          />
        )
      })}
    </svg>
  )
}
