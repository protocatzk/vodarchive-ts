/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/frontend/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        // Papier & Tinte
        paper: '#f4ecd8',
        parchment: '#e8dcc0',
        'paper-deep': '#ddcfae',
        ink: '#2a2318',
        'ink-soft': '#5b4d37',
        'ink-faint': '#8a7a5e',
        rule: '#cbb98f',
        // Siegel & Stempel
        oxblood: '#8a2f2b',
        brass: '#9a7426',
        sage: '#5f6b43',
        // Semantische Aliase (bestehende Klassen)
        bg: '#e8dcc0',
        card: '#f4ecd8',
        'card-border': '#cbb98f',
        'card-hover-border': '#9a7426',
        text: '#2a2318',
        'text-muted': '#5b4d37',
        muted: '#5b4d37',
        primary: '#8a2f2b',
        golden: '#9a7426',
        'primary-glow': 'rgba(138, 47, 43, 0.18)',
        emerald: '#5f6b43',
        amber: '#9a7426',
        rose: '#8a2f2b',
        cyan: '#7c5a1e',
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'ui-serif', 'serif'],
        serif: ['"EB Garamond"', 'Georgia', 'ui-serif', 'serif'],
        mono: ['"Special Elite"', '"Courier Prime"', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '3px',
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.6) inset, 0 12px 24px -16px rgba(42,35,24,0.45), 0 2px 6px -2px rgba(42,35,24,0.18)',
        sheet: '0 1px 0 rgba(255,255,255,0.7) inset, 0 24px 48px -30px rgba(42,35,24,0.55), 0 3px 10px -4px rgba(42,35,24,0.22)',
        stamp: '0 2px 6px -2px rgba(42,35,24,0.25)',
      },
      backgroundImage: {
        'paper-fibers':
          'radial-gradient(circle at 20% 10%, rgba(255,255,255,0.35), transparent 55%), radial-gradient(circle at 85% 90%, rgba(120,95,50,0.10), transparent 55%)',
      },
    },
  },
  plugins: [],
};
