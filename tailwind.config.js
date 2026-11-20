/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/frontend/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        // Archive-Palette
        bg: '#0c0f16',
        card: 'rgba(12, 15, 22, 0.8)',
        'card-border': 'rgba(212, 163, 94, 0.14)',
        'card-hover-border': 'rgba(212, 163, 94, 0.32)',
        text: '#e7e1d0',
        'text-muted': '#7a715f',
        muted: '#7a715f',
        primary: '#d4a35e',
        golden: '#c99b4e',
        'primary-glow': 'rgba(212, 163, 94, 0.35)',
        emerald: '#8f9e5e',
        amber: '#b8923a',
        rose: '#9f3d44',
      },
      fontFamily: {
        display: [
          'Playfair Display',
          'Georgia',
          'ui-serif',
          'serif',
        ],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '16px',
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(135deg, #d4a35e, #c99b4e)',
      },
      boxShadow: {
        card: '0 10px 30px rgba(0,0,0,0.35), 0 0 0 1px rgba(212,163,94,0.08)',
        'card-hover': '0 16px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(212,163,94,0.16)',
      },
    },
  },
  plugins: [],
};
