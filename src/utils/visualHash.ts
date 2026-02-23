import type { VisualDNA, BuildingConfig } from '@/types'

/**
 * 将字符串通过 SHA-256 哈希为字节数组
 */
export async function hashStringToBytes(input: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hashBuffer)
}

// 建筑主体类型列表
const BODY_TYPES = ['office', 'lab', 'factory', 'library', 'tower', 'warehouse']
// 屋顶类型列表
const ROOF_TYPES = ['flat', 'dome', 'antenna', 'satellite', 'chimney', 'garden']
// 地基类型列表
const BASE_TYPES = ['concrete', 'steel', 'glass', 'stone']
// 装饰物列表
const PROP_TYPES = ['signs', 'lights', 'wires', 'plants', 'machines']
// 星球纹理类型
const PLANET_TEXTURES = ['bands', 'storm', 'core', 'crystal'] as const

/**
 * 从哈希字节生成建筑配置
 */
function generateBuildingConfigFromBytes(bytes: Uint8Array, primaryHue: number): BuildingConfig {
  const body = BODY_TYPES[bytes[11] % BODY_TYPES.length]
  const roof = ROOF_TYPES[bytes[12] % ROOF_TYPES.length]
  const base = BASE_TYPES[bytes[13] % BASE_TYPES.length]
  
  // 从字节生成装饰物（0-3个）
  const propCount = bytes[14] % 4
  const props: string[] = []
  for (let i = 0; i < propCount; i++) {
    const propIndex = bytes[15 + i] % PROP_TYPES.length
    const prop = PROP_TYPES[propIndex]
    if (!props.includes(prop)) {
      props.push(prop)
    }
  }
  
  return {
    base,
    body,
    roof,
    props: props.length > 0 ? props : undefined,
    themeColor: `hsl(${primaryHue}, 70%, 50%)`,
  }
}

/**
 * 确定性生成视觉 DNA：基于 entityId 的 SHA-256 哈希映射到视觉参数
 * 每个 Nexus 都会生成独特的颜色、建筑样式和星球纹理
 * 不消耗 LLM token，纯本地计算
 */
export async function generateVisualDNA(entityId: string): Promise<VisualDNA> {
  const bytes = await hashStringToBytes(entityId)

  // 颜色参数
  const primaryHue = ((bytes[0] << 8) | bytes[1]) % 360
  const primarySaturation = 40 + (((bytes[2] << 8) | bytes[3]) % 61)   // 40-100
  const primaryLightness = 30 + (((bytes[4] << 8) | bytes[5]) % 41)    // 30-70
  const accentHue = (primaryHue + 30 + (bytes[6] % 120)) % 360

  // 纹理模式
  const textureByte = bytes[8]
  const textureMode: VisualDNA['textureMode'] =
    textureByte < 85 ? 'solid' :
    textureByte < 170 ? 'wireframe' : 'gradient'

  // 发光强度和几何变体
  const glowIntensity = bytes[9] / 255
  const geometryVariant = bytes[10] % 4

  // 星球纹理配置
  const planetTexture = PLANET_TEXTURES[bytes[19] % PLANET_TEXTURES.length]
  const ringCount = 1 + (bytes[20] % 3)  // 1-3
  const ringTilts = [
    (bytes[21] / 255) * 0.6 - 0.3,  // -0.3 到 0.3
    (bytes[22] / 255) * 0.6 - 0.3,
    (bytes[23] / 255) * 0.6 - 0.3,
  ].slice(0, ringCount)

  // 建筑配置
  const buildingConfig = generateBuildingConfigFromBytes(bytes, primaryHue)

  return {
    primaryHue,
    primarySaturation,
    primaryLightness,
    accentHue,
    textureMode,
    glowIntensity,
    geometryVariant,
    planetTexture,
    ringCount,
    ringTilts,
    buildingConfig,
  }
}
