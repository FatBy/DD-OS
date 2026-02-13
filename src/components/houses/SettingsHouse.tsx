import { motion } from 'framer-motion'
import { Monitor, Cpu, Info } from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { staggerContainer, staggerItem } from '@/utils/animations'

interface SettingToggle {
  id: string
  label: string
  description: string
  enabled: boolean
}

const settingsData: SettingToggle[] = [
  {
    id: 'particles',
    label: '粒子动画',
    description: '世界背景中的浮动粒子效果',
    enabled: true,
  },
  {
    id: 'matrix',
    label: '字符雨效果',
    description: '记忆屋中的Matrix字符雨',
    enabled: true,
  },
  {
    id: 'glow',
    label: '发光特效',
    description: '节点和连线的发光效果',
    enabled: true,
  },
  {
    id: 'spring',
    label: '弹簧动画',
    description: '视图切换时的弹簧物理动画',
    enabled: true,
  },
]

export function SettingsHouse() {
  return (
    <div className="p-6 h-full overflow-y-auto space-y-6">
      {/* Visual Settings */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <div className="flex items-center gap-2 mb-4">
          <Monitor className="w-4 h-4 text-slate-400" />
          <h3 className="font-mono text-sm text-slate-300 tracking-wider">
            视觉设置
          </h3>
        </div>

        <div className="space-y-3">
          {settingsData.map((setting) => (
            <motion.div key={setting.id} variants={staggerItem}>
              <GlassCard className="p-4 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-mono text-white/80">
                    {setting.label}
                  </h4>
                  <p className="text-xs text-white/40 mt-0.5">
                    {setting.description}
                  </p>
                </div>
                <div className="w-10 h-5 bg-white/10 rounded-full relative cursor-pointer border border-white/10">
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                      setting.enabled
                        ? 'left-5 bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.5)]'
                        : 'left-0.5 bg-white/30'
                    }`}
                  />
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Performance */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Cpu className="w-4 h-4 text-slate-400" />
          <h3 className="font-mono text-sm text-slate-300 tracking-wider">
            性能信息
          </h3>
        </div>
        <GlassCard className="p-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            {[
              { label: 'FPS', value: '60' },
              { label: '内存', value: '128MB' },
              { label: '渲染层', value: '3' },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="text-lg font-mono font-bold text-cyan-400">
                  {stat.value}
                </div>
                <div className="text-[10px] font-mono text-white/40">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* About */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Info className="w-4 h-4 text-slate-400" />
          <h3 className="font-mono text-sm text-slate-300 tracking-wider">
            关于
          </h3>
        </div>
        <GlassCard className="p-4">
          <div className="space-y-2 font-mono text-xs text-white/50">
            <div className="flex justify-between">
              <span>版本</span>
              <span className="text-white/70">OpenClaw OS v1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span>内核</span>
              <span className="text-white/70">React 18 + Vite</span>
            </div>
            <div className="flex justify-between">
              <span>动画引擎</span>
              <span className="text-white/70">Framer Motion</span>
            </div>
            <div className="flex justify-between">
              <span>样式系统</span>
              <span className="text-white/70">Tailwind CSS</span>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
