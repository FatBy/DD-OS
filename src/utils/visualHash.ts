import type { NexusArchetype, VisualDNA } from '@/types'

/**
 * 将字符串通过 SHA-256 哈希为字节数组
 */
export async function hashStringToBytes(input: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hashBuffer)
}

/**
 * 从哈希字节推导 Archetype
 */
export function archetypeFromByte(byte: number): NexusArchetype {
  if (byte < 64) return 'MONOLITH'
  if (byte < 128) return 'SPIRE'
  if (byte < 192) return 'REACTOR'
  return 'VAULT'
}

/**
 * 确定性生成视觉 DNA：基于 entityId 的 SHA-256 哈希映射到视觉参数
 * 不消耗 LLM token，纯本地计算
 */
export async function generateVisualDNA(
  entityId: string,
  archetype?: NexusArchetype
): Promise<VisualDNA> {
  const bytes = await hashStringToBytes(entityId)

  const primaryHue = ((bytes[0] << 8) | bytes[1]) % 360
  const primarySaturation = 40 + (((bytes[2] << 8) | bytes[3]) % 61)   // 40-100
  const primaryLightness = 30 + (((bytes[4] << 8) | bytes[5]) % 41)    // 30-70
  const accentHue = (primaryHue + 30 + (bytes[6] % 120)) % 360

  const resolvedArchetype = archetype ?? archetypeFromByte(bytes[7])

  const textureByte = bytes[8]
  const textureMode: VisualDNA['textureMode'] =
    textureByte < 85 ? 'solid' :
    textureByte < 170 ? 'wireframe' : 'gradient'

  const glowIntensity = bytes[9] / 255
  const geometryVariant = bytes[10] % 4

  return {
    primaryHue,
    primarySaturation,
    primaryLightness,
    accentHue,
    archetype: resolvedArchetype,
    textureMode,
    glowIntensity,
    geometryVariant,
  }
}
