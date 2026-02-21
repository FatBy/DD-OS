/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // ============================================
      // 主题化颜色 (映射到 CSS 变量)
      // ============================================
      colors: {
        skin: {
          // 背景系
          'bg-primary': 'rgb(var(--color-bg-primary) / <alpha-value>)',
          'bg-secondary': 'rgb(var(--color-bg-secondary) / <alpha-value>)',
          'bg-panel': 'rgb(var(--color-bg-panel) / <alpha-value>)',
          'bg-elevated': 'rgb(var(--color-bg-elevated) / <alpha-value>)',
          
          // 文本系
          'text-primary': 'rgb(var(--color-text-primary) / <alpha-value>)',
          'text-secondary': 'rgb(var(--color-text-secondary) / <alpha-value>)',
          'text-muted': 'rgb(var(--color-text-muted) / <alpha-value>)',
          
          // 边框
          'border': 'rgb(var(--color-border-subtle) / <alpha-value>)',
          'border-medium': 'rgb(var(--color-border-medium) / <alpha-value>)',
          
          // 强调色
          'accent-cyan': 'rgb(var(--color-accent-cyan) / <alpha-value>)',
          'accent-amber': 'rgb(var(--color-accent-amber) / <alpha-value>)',
          'accent-emerald': 'rgb(var(--color-accent-emerald) / <alpha-value>)',
          'accent-purple': 'rgb(var(--color-accent-purple) / <alpha-value>)',
          'accent-red': 'rgb(var(--color-accent-red) / <alpha-value>)',
        },
      },
      
      // ============================================
      // 动画
      // ============================================
      animation: {
        'breathe': 'breathe 3s ease-in-out infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.05)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
    },
  },
  plugins: [],
}
