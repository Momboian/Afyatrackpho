/** @type {import('tailwindcss').Config} */
// Tailwind CSS settings: which files to scan for class names, plus the AfyaTrack fonts and colours.
// Colours come from CSS variables in client/src/index.css, so the same classes work in light and dark mode.
// darkMode 'class' means dark colours apply when <html> has the "dark" class (set by lib/theme.jsx).
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
export default {
  darkMode: 'class',
  content: ['./client/index.html', './client/src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Fonts loaded from Google Fonts in client/index.html.
      fontFamily: {
        sans: ['"Public Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace']
      },
      // AfyaTrack colours. brand is the green, ochre is the amber accent, ink is the text colour, surface is the card colour.
      colors: {
        paper: v('paper'),
        surface: v('surface'),
        ink: { DEFAULT: v('ink'), soft: v('ink-soft'), faint: v('ink-faint') },
        line: v('line'),
        brand: { 50: v('brand-50'), 100: v('brand-100'), 200: v('brand-200'), 500: v('brand-500'), 600: v('brand-600'), 700: v('brand-700'), 800: v('brand-800'), 900: v('brand-900') },
        ochre: { 50: v('ochre-50'), 100: v('ochre-100'), 500: v('ochre-500'), 600: v('ochre-600'), 700: v('ochre-700') }
      },
      boxShadow: { card: '0 1px 0 rgba(20,33,31,0.04), 0 1px 3px rgba(20,33,31,0.06)' }
    }
  },
  plugins: []
};
