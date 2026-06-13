/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // 主题色通过 CSS 变量动态切换
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        // primary 用通道变量，支持 bg-primary/10 等 opacity modifier
        primary: 'hsl(var(--color-primary-ch) / <alpha-value>)',
        'primary-hover': 'var(--color-primary-hover)',
        secondary: 'var(--color-secondary)',
        border: 'var(--color-border)',
        muted: 'var(--color-muted)',
        'muted-foreground': 'var(--color-muted-foreground)',
        glass: 'var(--color-glass)',
        sidebar: 'var(--color-sidebar)',
      },
    },
  },
  plugins: [],
}
