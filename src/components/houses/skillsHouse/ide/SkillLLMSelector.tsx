/**
 * SkillLLMSelector - LLM 温度模式选择器
 *
 * 显示当前 LLM 模型信息和温度模式切换。
 * 可嵌入 Explorer 或 Producer 面板。
 */

import { useStore } from '@/store'

export function SkillLLMSelector() {
  const temperatureMode = useStore((s) => s.temperatureMode)
  const setTemperatureMode = useStore((s) => s.setTemperatureMode)

  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
        LLM Mode
      </h4>

      <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
        <button
          onClick={() => setTemperatureMode('production')}
          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
            temperatureMode === 'production'
              ? 'bg-white text-cyan-600 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              temperatureMode === 'production' ? 'bg-cyan-400' : 'bg-slate-300'
            }`}
          />
          Production
        </button>
        <button
          onClick={() => setTemperatureMode('exploration')}
          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
            temperatureMode === 'exploration'
              ? 'bg-white text-amber-600 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              temperatureMode === 'exploration' ? 'bg-amber-400' : 'bg-slate-300'
            }`}
          />
          Explore
        </button>
      </div>

      <div className="text-[9px] text-slate-400">
        {temperatureMode === 'production'
          ? 'Temperature 0 - Deterministic, precise output'
          : 'Temperature 0.3 - More creative variations'}
      </div>
    </div>
  )
}
