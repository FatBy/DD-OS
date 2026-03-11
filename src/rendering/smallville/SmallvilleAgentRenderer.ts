// ============================================
// Smallville Agent 渲染器
// 在房间模式下渲染 Agent 精灵
// 状态：idle → walking → working → walking → ...
// ============================================

import type { ParticleRenderer, RenderContext } from '../types'
import type { SmallvilleViewManager, Workstation } from './SmallvilleViewManager'
import type { SmallvilleSpriteAtlas } from './SmallvilleSpriteAtlas'
import { SV_CHAR_IDLE, SV_CHAR_WALK, SV_CHAR_FRAMES_PER_DIR } from './SmallvilleTiles'

const TILE_SIZE = 16
const ROOM_SCALE = 3.5
const WALK_SPEED = 0.04  // tiles/frame
const WORK_DURATION = 2000  // ms 在工作站工作时间
const IDLE_DURATION = 1000  // ms idle 等待
const ANIM_SPEED = 100  // ms 动画帧间隔 (10 FPS)

type AgentState = 'idle' | 'walking' | 'working'
type Direction = 'up' | 'down' | 'left' | 'right'

export class SmallvilleAgentRenderer implements ParticleRenderer {
  readonly id = 'smallville-agent-renderer'

  private viewManager: SmallvilleViewManager
  private atlas: SmallvilleSpriteAtlas

  // Agent 状态
  private state: AgentState = 'idle'
  private x = 0       // 瓦片坐标 (房间内)
  private y = 0
  private targetX = 0
  private targetY = 0
  private direction: Direction = 'down'
  private frame = 0
  private lastFrameTime = 0
  private stateStartTime = 0
  private currentWorkstation: Workstation | null = null
  private workstationQueue: Workstation[] = []
  private initialized = false
  private isExecuting = false

  constructor(viewManager: SmallvilleViewManager, atlas: SmallvilleSpriteAtlas) {
    this.viewManager = viewManager
    this.atlas = atlas
  }

  resize(_w: number, _h: number): void {}

  /**
   * 设置是否有 SOP 正在执行
   */
  setExecuting(executing: boolean): void {
    if (executing && !this.isExecuting) {
      this.isExecuting = true
      this.startExecution()
    } else if (!executing && this.isExecuting) {
      this.isExecuting = false
      this.state = 'idle'
    }
  }

  private startExecution(): void {
    const layout = this.viewManager.roomLayout
    if (!layout) return

    // 构建工作站访问队列
    this.workstationQueue = [...layout.workstations]
    this.pickNextTarget()
  }

  private pickNextTarget(): void {
    if (this.workstationQueue.length === 0) {
      // 所有工作站访问完毕，循环
      const layout = this.viewManager.roomLayout
      if (layout && this.isExecuting) {
        this.workstationQueue = [...layout.workstations]
      } else {
        this.state = 'idle'
        return
      }
    }

    const next = this.workstationQueue.shift()!
    this.currentWorkstation = next
    // 走到工作站前方 (偏移 1 格)
    this.targetX = next.tileX
    this.targetY = next.tileY + 1  // 工作站前一格
    this.state = 'walking'
  }

  private initPosition(): void {
    const layout = this.viewManager.roomLayout
    if (!layout) return
    // 初始位置：门口
    this.x = layout.doorX
    this.y = layout.doorY - 1
    this.targetX = this.x
    this.targetY = this.y
    this.direction = 'up'
    this.initialized = true
  }

  update(timestamp: number): void {
    const vm = this.viewManager
    if (!vm.isInRoomView()) {
      this.initialized = false
      return
    }

    if (!this.initialized) {
      this.initPosition()
      this.stateStartTime = timestamp
    }

    switch (this.state) {
      case 'idle':
        if (this.isExecuting && timestamp - this.stateStartTime > IDLE_DURATION) {
          this.startExecution()
        }
        break

      case 'walking': {
        const dx = this.targetX - this.x
        const dy = this.targetY - this.y
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist < 0.15) {
          this.x = this.targetX
          this.y = this.targetY
          this.state = 'working'
          this.stateStartTime = timestamp
        } else {
          const moveX = (dx / dist) * WALK_SPEED
          const moveY = (dy / dist) * WALK_SPEED
          this.x += moveX
          this.y += moveY

          if (Math.abs(dx) > Math.abs(dy)) {
            this.direction = dx > 0 ? 'right' : 'left'
          } else {
            this.direction = dy > 0 ? 'down' : 'up'
          }
        }

        // 行走动画
        if (timestamp - this.lastFrameTime > ANIM_SPEED) {
          this.frame = (this.frame + 1) % SV_CHAR_FRAMES_PER_DIR
          this.lastFrameTime = timestamp
        }
        break
      }

      case 'working':
        // 面向工作站
        if (this.currentWorkstation) {
          const wdy = this.currentWorkstation.tileY - this.y
          if (wdy < 0) this.direction = 'up'
        }

        if (timestamp - this.stateStartTime > WORK_DURATION) {
          this.pickNextTarget()
        }
        break
    }
  }

  render(ctx: RenderContext): void {
    const vm = this.viewManager
    if (!vm.isInRoomView() && !vm.isTransitioning()) return

    const layout = vm.roomLayout
    if (!layout) return

    const { ctx: c, width, height } = ctx
    const tileScreen = TILE_SIZE * ROOM_SCALE
    const roomPixelW = layout.width * tileScreen
    const roomPixelH = layout.height * tileScreen
    const startX = (width - roomPixelW) / 2
    const startY = (height - roomPixelH) / 2

    c.save()

    // 过渡时渐入
    if (vm.isTransitioning()) {
      c.globalAlpha = vm.zoomProgress
    }

    // 屏幕坐标
    const screenX = startX + this.x * tileScreen
    const screenY = startY + this.y * tileScreen

    if (this.atlas.isCharReady('adam')) {
      // 精灵动画渲染
      const baseFrame = this.state === 'walking'
        ? SV_CHAR_WALK[this.direction]
        : SV_CHAR_IDLE[this.direction]
      const frameIdx = baseFrame + (this.frame % SV_CHAR_FRAMES_PER_DIR)

      this.atlas.drawCharFrame(
        c, 'adam', frameIdx,
        screenX + tileScreen * 0.1,
        screenY - tileScreen * 0.2,
        ROOM_SCALE,
      )
    } else {
      // 纯色 fallback
      const radius = tileScreen * 0.35

      c.fillStyle = '#3498db'
      c.beginPath()
      c.arc(screenX + tileScreen / 2, screenY + tileScreen / 2, radius, 0, Math.PI * 2)
      c.fill()
      c.strokeStyle = '#2980b9'
      c.lineWidth = 1.5
      c.stroke()

      c.fillStyle = '#fad0a0'
      c.beginPath()
      c.arc(screenX + tileScreen / 2, screenY + tileScreen / 2 - radius * 0.6, radius * 0.5, 0, Math.PI * 2)
      c.fill()

      const dirOff = this.direction === 'up' ? { dx: 0, dy: -1 } :
                     this.direction === 'down' ? { dx: 0, dy: 1 } :
                     this.direction === 'left' ? { dx: -1, dy: 0 } : { dx: 1, dy: 0 }
      c.fillStyle = '#333'
      c.beginPath()
      c.arc(
        screenX + tileScreen / 2 + dirOff.dx * radius * 0.25,
        screenY + tileScreen / 2 - radius * 0.6 + dirOff.dy * radius * 0.25,
        radius * 0.12,
        0, Math.PI * 2
      )
      c.fill()
    }

    // 工作中：头顶显示齿轮指示
    if (this.state === 'working') {
      const pulse = 0.6 + Math.sin(Date.now() / 300) * 0.4
      c.fillStyle = `rgba(0, 255, 136, ${pulse})`
      c.font = `${Math.round(12 * ROOM_SCALE / 3.5)}px monospace`
      c.textAlign = 'center'
      c.fillText('*', screenX + tileScreen / 2, screenY - 2)
    }

    c.restore()
  }

  dispose(): void {
    this.initialized = false
    this.workstationQueue = []
  }
}
