// ============================================
// Smallville 精灵图集管理器
// 加载 sprites.png 场景瓦片 + 角色精灵表
// ============================================

const SV_TILE_SIZE = 16
const SV_ATLAS_COLS = 176   // sprites.png: 176 列
const CHAR_FRAME_W = 16
const CHAR_FRAME_H = 32     // 角色帧: 16x32 (比瓦片高一倍)
const CHAR_SHEET_COLS = 24   // 角色精灵表: 24 列布局

export class SmallvilleSpriteAtlas {
  private tileset: HTMLImageElement | null = null
  private characters: Map<string, HTMLImageElement> = new Map()
  private tilesetLoaded = false

  constructor() {
    this.loadAll()
  }

  private loadAll(): void {
    // 场景瓦片集
    this.loadImage('/assets/smallville/sprites.png').then(img => {
      this.tileset = img
      this.tilesetLoaded = true
      console.log('[SmallvilleSpriteAtlas] Tileset loaded')
    }).catch(() => {
      console.warn('[SmallvilleSpriteAtlas] Failed to load tileset')
    })

    // 角色精灵表 (各自独立加载，单个失败不影响其他)
    const chars = ['adam', 'bob', 'alex', 'amelia']
    const charFiles: Record<string, string> = {
      adam: '/assets/smallville/Adam_16x16.png',
      bob: '/assets/smallville/Bob_16x16.png',
      alex: '/assets/smallville/Alex_16x16.png',
      amelia: '/assets/smallville/Amelia_16x16.png',
    }

    for (const name of chars) {
      this.loadImage(charFiles[name]).then(img => {
        this.characters.set(name, img)
        console.log(`[SmallvilleSpriteAtlas] Character '${name}' loaded`)
      }).catch(() => {
        console.warn(`[SmallvilleSpriteAtlas] Failed to load character '${name}'`)
      })
    }
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`Failed to load: ${url}`))
      img.src = url
    })
  }

  /** 场景瓦片集是否已加载 */
  isReady(): boolean {
    return this.tilesetLoaded
  }

  /** 指定角色精灵表是否已加载 */
  isCharReady(name: string): boolean {
    return this.characters.has(name)
  }

  /**
   * 绘制场景瓦片 (从 sprites.png)
   * @param col 瓦片列 (0-175)
   * @param row 瓦片行 (0-236)
   * @param destX 目标 X
   * @param destY 目标 Y
   * @param scale 缩放比例 (最终尺寸 = 16 * scale)
   */
  drawTile(
    ctx: CanvasRenderingContext2D,
    col: number,
    row: number,
    destX: number,
    destY: number,
    scale: number,
  ): void {
    if (!this.tileset) return

    const prevSmoothing = ctx.imageSmoothingEnabled
    ctx.imageSmoothingEnabled = false

    ctx.drawImage(
      this.tileset,
      col * SV_TILE_SIZE, row * SV_TILE_SIZE, SV_TILE_SIZE, SV_TILE_SIZE,
      destX, destY, SV_TILE_SIZE * scale, SV_TILE_SIZE * scale,
    )

    ctx.imageSmoothingEnabled = prevSmoothing
  }

  /**
   * 绘制角色精灵帧
   * @param charName 角色名 ('adam'|'bob'|'alex'|'amelia')
   * @param frameIndex 帧索引 (0-71)
   * @param destX 目标 X
   * @param destY 目标 Y
   * @param scale 缩放比例 (最终尺寸 = 16*scale x 32*scale)
   */
  drawCharFrame(
    ctx: CanvasRenderingContext2D,
    charName: string,
    frameIndex: number,
    destX: number,
    destY: number,
    scale: number,
  ): void {
    const charImg = this.characters.get(charName)
    if (!charImg) return

    const srcCol = frameIndex % CHAR_SHEET_COLS
    const srcRow = Math.floor(frameIndex / CHAR_SHEET_COLS)

    const prevSmoothing = ctx.imageSmoothingEnabled
    ctx.imageSmoothingEnabled = false

    ctx.drawImage(
      charImg,
      srcCol * CHAR_FRAME_W, srcRow * CHAR_FRAME_H, CHAR_FRAME_W, CHAR_FRAME_H,
      destX, destY, CHAR_FRAME_W * scale, CHAR_FRAME_H * scale,
    )

    ctx.imageSmoothingEnabled = prevSmoothing
  }

  getTileSize(): number {
    return SV_TILE_SIZE
  }

  getAtlasCols(): number {
    return SV_ATLAS_COLS
  }

  dispose(): void {
    this.tileset = null
    this.characters.clear()
    this.tilesetLoaded = false
  }
}
