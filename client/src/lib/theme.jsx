// Light and dark theme. One button switches between them and the choice is saved in this browser.
// The default is light. (An old "system" choice saved by an earlier version is treated as light.)
import { createContext, useContext, useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

const KEY = 'afyatrack.theme';
const ThemeCtx = createContext({ mode: 'light', toggle: () => {} });
export const useTheme = () => useContext(ThemeCtx);

// Reads the saved choice. try/catch protects against browsers that block storage.
const readMode = () => { try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } };
// Adds or removes the "dark" class on <html>, which switches every colour token in index.css.
const apply = (mode) => {
  const dark = mode === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0E1513' : '#0F4C40');
};

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(readMode);
  // Apply the theme on start and every time it changes.
  useEffect(() => { apply(mode); }, [mode]);
  // Switch light to dark or dark to light, and remember the choice.
  const toggle = () => setMode((m) => {
    const next = m === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* storage blocked: the choice lasts until the page is closed */ }
    return next;
  });
  return <ThemeCtx.Provider value={{ mode, toggle }}>{children}</ThemeCtx.Provider>;
}

// One round button. In light mode it shows a moon (click for dark), in dark mode a sun (click for light).
export function ThemeToggle({ className = '' }) {
  const { mode, toggle } = useTheme();
  const dark = mode === 'dark';
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button type="button" onClick={toggle} aria-label={label} title={label} aria-pressed={dark}
      className={`relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-line bg-surface text-ink-soft shadow-sm transition hover:text-ink hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${className}`}>
      {/* The two icons swap with a small turn and fade. */}
      <Sun className={`absolute h-[18px] w-[18px] text-ochre-500 transition-all duration-300 ${dark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'}`} />
      <Moon className={`absolute h-[18px] w-[18px] transition-all duration-300 ${dark ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'}`} />
    </button>
  );
}

// Old name kept so any page still importing ThemeSwitch keeps working.
export const ThemeSwitch = ThemeToggle;
