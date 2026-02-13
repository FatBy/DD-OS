import type { Transition, Variants } from 'framer-motion'

export const springTransition: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
}

export const houseVariants: Variants = {
  initial: { opacity: 0, y: 100, scale: 0.9 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -50, scale: 0.95 },
}

export const dockIconVariants: Variants = {
  hover: { scale: 1.3, y: -8 },
  tap: { scale: 0.95 },
}

export const staggerContainer: Variants = {
  animate: {
    transition: {
      staggerChildren: 0.08,
    },
  },
}

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
}
