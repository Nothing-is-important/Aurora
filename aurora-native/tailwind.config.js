/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'apple-blue': '#0a84ff',
        'apple-green': '#30d158',
        'apple-red': '#ff453a',
        'apple-orange': '#ff9f0a',
        'apple-purple': '#bf5af2',
        'apple-pink': '#ff375f',
        'apple-teal': '#64d2ff',
        'apple-yellow': '#ffd60a',
        'apple-indigo': '#5e5ce6',
      },
      boxShadow: {
        soft: '0 8px 30px rgba(0,0,0,0.12)',
        glass: '0 8px 32px rgba(0,0,0,0.18)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
}
