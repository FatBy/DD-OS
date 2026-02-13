import { motion } from 'framer-motion'
import type { SoulDimension } from '@/types'

interface RadarChartProps {
  dimensions: SoulDimension[]
  size?: number
  color?: string
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  }
}

function polygonPoints(
  cx: number,
  cy: number,
  r: number,
  count: number
): string {
  return Array.from({ length: count }, (_, i) => {
    const p = polarToCartesian(cx, cy, r, (360 / count) * i)
    return `${p.x},${p.y}`
  }).join(' ')
}

export function RadarChart({
  dimensions,
  size = 280,
  color = '#a855f7',
}: RadarChartProps) {
  const cx = size / 2
  const cy = size / 2
  const maxR = size * 0.38
  const count = dimensions.length

  // Data polygon points
  const dataPoints = dimensions.map((d, i) => {
    const r = maxR * (d.value / 100)
    return polarToCartesian(cx, cy, r, (360 / count) * i)
  })
  const dataPolygon = dataPoints.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="drop-shadow-lg"
    >
      <defs>
        <filter id="radar-glow">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background grid layers */}
      {[0.33, 0.66, 1].map((scale, idx) => (
        <polygon
          key={idx}
          points={polygonPoints(cx, cy, maxR * scale, count)}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={1}
        />
      ))}

      {/* Axis lines */}
      {dimensions.map((_, i) => {
        const end = polarToCartesian(cx, cy, maxR, (360 / count) * i)
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={end.x}
            y2={end.y}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        )
      })}

      {/* Data polygon */}
      <motion.polygon
        points={dataPolygon}
        fill={`${color}20`}
        stroke={color}
        strokeWidth={2}
        filter="url(#radar-glow)"
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, type: 'spring' }}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />

      {/* Data points */}
      {dataPoints.map((p, i) => (
        <motion.circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={4}
          fill={color}
          stroke="white"
          strokeWidth={1.5}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.1 * i, type: 'spring' }}
        />
      ))}

      {/* Labels */}
      {dimensions.map((d, i) => {
        const labelR = maxR + 24
        const angle = (360 / count) * i
        const p = polarToCartesian(cx, cy, labelR, angle)
        const textAnchor =
          angle > 45 && angle < 135
            ? 'start'
            : angle > 225 && angle < 315
              ? 'end'
              : 'middle'
        const dy = angle > 135 && angle < 225 ? '0.9em' : angle < 45 || angle > 315 ? '-0.3em' : '0.35em'

        return (
          <text
            key={i}
            x={p.x}
            y={p.y}
            textAnchor={textAnchor}
            dy={dy}
            className="fill-white/60 text-[11px] font-mono"
          >
            {d.name}
          </text>
        )
      })}

      {/* Value labels */}
      {dataPoints.map((p, i) => (
        <text
          key={`val-${i}`}
          x={p.x}
          y={p.y - 10}
          textAnchor="middle"
          className="fill-white/40 text-[9px] font-mono"
        >
          {dimensions[i].value}
        </text>
      ))}
    </svg>
  )
}
