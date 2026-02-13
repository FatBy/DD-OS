import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

const themeGlowMap: Record<string, string> = {
  cyan: 'shadow-cyan-500/10 ring-cyan-500/20',
  emerald: 'shadow-emerald-500/10 ring-emerald-500/20',
  amber: 'shadow-amber-500/10 ring-amber-500/20',
  purple: 'shadow-purple-500/10 ring-purple-500/20',
  slate: 'shadow-slate-500/10 ring-slate-500/20',
}

interface GlassCardProps {
  children: ReactNode
  className?: string
  themeColor?: string
  onClick?: () => void
}

export function GlassCard({ children, className, themeColor, onClick }: GlassCardProps) {
  const glow = themeColor ? themeGlowMap[themeColor] ?? '' : ''

  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-black/40 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl',
        glow && `ring-1 ${glow}`,
        className
      )}
    >
      {children}
    </div>
  )
}
