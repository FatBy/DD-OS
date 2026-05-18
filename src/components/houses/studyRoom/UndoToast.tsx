/**
 * UndoToast — 信任模式自动执行后的 3s 撤销提示
 */

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Undo2 } from 'lucide-react'

interface Props {
  label: string
  onUndo: () => void
  onDismiss: () => void
  durationMs?: number
}

export function UndoToast({ label, onUndo, onDismiss, durationMs = 3000 }: Props) {
  const [remaining, setRemaining] = useState(durationMs)
  const dismissedRef = useRef(false)

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 100))
    }, 100)
    return () => clearInterval(interval)
  }, [durationMs])

  // 副作用: remaining 归零时触发 onDismiss (不在 setState 内调用)
  useEffect(() => {
    if (remaining <= 0 && !dismissedRef.current) {
      dismissedRef.current = true
      onDismiss()
    }
  }, [remaining, onDismiss])

  const progress = remaining / durationMs

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
        className="flex items-center gap-3 px-4 py-2.5 bg-stone-800 text-white rounded-2xl shadow-lg backdrop-blur-xl"
      >
        <span className="text-xs">
          正在执行: {label}
        </span>
        <button
          onClick={onUndo}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-white/20 hover:bg-white/30 rounded-md transition-colors"
        >
          <Undo2 className="w-3 h-3" />
          撤销
        </button>
        {/* 进度条 */}
        <div className="w-12 h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-400 rounded-full transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </motion.div>
    </div>
  )
}
