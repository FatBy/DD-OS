declare module 'react-virtuoso' {
  import { ComponentType, CSSProperties, Ref } from 'react'

  export interface VirtuosoHandle {
    scrollToIndex(options: { index: number; behavior?: 'auto' | 'smooth' }): void
    scrollTo(options: { top: number; behavior?: 'auto' | 'smooth' }): void
  }

  export interface VirtuosoProps<T = any> {
    data?: T[]
    style?: CSSProperties
    itemContent?: (index: number, item: T) => React.ReactNode
    followOutput?: boolean | 'auto' | 'smooth'
    atBottomStateChange?: (atBottom: boolean) => void
    ref?: Ref<VirtuosoHandle>
  }

  export const Virtuoso: ComponentType<VirtuosoProps>
}
