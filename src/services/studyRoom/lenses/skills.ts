/**
 * Skills Lens — 技能镜头
 * 从 store.skills 中过滤 + skillMatcher 打分, 取 top-5
 */

import type { EvidenceItem } from '@/types'
import { matchSkills } from '../skillMatcher'

interface StoredSkill {
  name: string
  description?: string
  keywords?: string[]
  whenToUse?: string
  tags?: string[]
  enabled?: boolean
  toolType?: string
  category?: string
  instructions?: string
}

/**
 * 从本地 skills 列表中匹配并转为证据项
 * @param intent 用户意图
 * @param skills store 中的 skills 列表
 * @param pinnedSkillNames 用户钉住的 skill 名称 (直接入选)
 */
export function lensSkills(
  intent: string,
  skills: StoredSkill[],
  pinnedSkillNames: string[] = [],
): EvidenceItem[] {
  const scored = matchSkills(intent, skills)

  // 钉住的 skills 直接加入 (score +100 保证排在前面)
  const pinnedSet = new Set(pinnedSkillNames.map((n) => n.toLowerCase()))
  const merged = scored.map((s) => ({
    ...s,
    score: pinnedSet.has(s.name.toLowerCase()) ? s.score + 100 : s.score,
  }))

  // 补充在 scored 中没有命中但被 pinned 的 skills
  for (const name of pinnedSkillNames) {
    if (!merged.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      const skill = skills.find((s) => s.name.toLowerCase() === name.toLowerCase())
      if (skill) {
        merged.push({
          name: skill.name,
          description: skill.description || '',
          score: 100,
          keywords: skill.keywords || [],
          instructions: (skill.instructions || '').slice(0, 800),
        })
      }
    }
  }

  // 取 top-5
  const top = merged.sort((a, b) => b.score - a.score).slice(0, 5)

  return top.map((s): EvidenceItem => {
    const snippet = [
      s.description ? `描述: ${s.description}` : '',
      s.instructions ? `指引: ${s.instructions}` : '',
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 400)

    return {
      id: `evidence-S-${s.name}`,
      lens: 'S',
      title: s.name,
      snippet,
      ref: {
        kind: 'skill',
        skillName: s.name,
        snapshotTldr: snippet.slice(0, 200),
      },
    }
  })
}
