/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/frontend/**/*.{vue,ts}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#080c14',
        card: 'rgba(15, 23, 42, 0.75)',
        'card-border': 'rgba(255, 255, 255, 0.08)',
        primary: '#6366f1',
        cyan: '#06b6d4',
        emerald: '#10b981',
        amber: '#f59e0b',
        rose: '#f43f5e',
        muted: '#94a3b8',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '16px',
      },
      backgroundImage: {
        'app-glow':
          'radial-gradient(at 0% 0%, rgba(99,102,241,0.12) 0px, transparent 40%), radial-gradient(at 100% 0%, rgba(6,182,212,0.08) 0px, transparent 40%)',
      },
      boxShadow: {
        'brand-glow': '0 4px 15px rgba(99,102,241,0.35)',
      },
    },
  },
  plugins: [],
};
