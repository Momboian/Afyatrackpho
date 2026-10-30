// Reusable screen parts (buttons, form fields, badges, cards, pop ups, tabs, toasts) used by every page.
import { useEffect, useState, createContext, useContext, useCallback, forwardRef } from 'react';
import { X, Loader2, Inbox } from 'lucide-react';
import { humanize } from '../lib/format.js';

// Button with colour styles (variant) and sizes. loading shows a spinner and disables the button.
export function Button({ variant = 'primary', size = 'md', className = '', loading, children, ...props }) {
  // Tailwind classes for each button style.
  const v = {
    primary: 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm',
    secondary: 'bg-surface text-ink border border-line hover:bg-paper',
    ghost: 'text-ink-soft hover:bg-ink/5',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    accent: 'bg-ochre-500 text-white hover:bg-ochre-600'
  }[variant];
  const s = { sm: 'px-2.5 py-1.5 text-[13px]', md: 'px-4 py-2.5 text-sm', lg: 'px-5 py-3 text-[15px]' }[size];
  return (
    <button className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${v} ${s} ${className}`}
      disabled={loading || props.disabled} {...props}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}{children}
    </button>
  );
}

// A labelled form field. Shows a red star when required, and the error or a hint under the input.
export function Field({ label, error, hint, required, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="label">{label}{required && <span className="text-red-600"> *</span>}</span>}
      {children}
      {error ? <span className="mt-1 block text-[13px] text-red-600">{error}</span> : hint ? <span className="mt-1 block text-[12px] text-ink-faint">{hint}</span> : null}
    </label>
  );
}

// Text input, multi line text box and drop down, with a red border when there is an error.
export const Input = forwardRef(({ error, className = '', ...p }, ref) => <input ref={ref} className={`input ${error ? 'input-error' : ''} ${className}`} {...p} />);
export const Textarea = ({ error, className = '', ...p }) => <textarea className={`input min-h-[90px] ${error ? 'input-error' : ''} ${className}`} {...p} />;
// options can be plain values (shown in readable form) or { value, label } objects.
export function Select({ options = [], placeholder, error, className = '', ...p }) {
  return (
    <select className={`input pr-8 ${error ? 'input-error' : ''} ${className}`} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => typeof o === 'object'
        ? <option key={o.value} value={o.value}>{o.label}</option>
        : <option key={o} value={o}>{humanize(o)}</option>)}
    </select>
  );
}

// Colours for status badges.
const TONE = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-ochre-50 text-ochre-700 ring-ochre-100',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  gray: 'bg-stone-100 text-stone-600 ring-stone-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200'
};
// Which colour each status uses: green is good, red needs action, amber is waiting, blue is in progress.
const STATUS_TONE = {
  completed: 'green', compliant: 'green', valid: 'green', current: 'green', adequate: 'green', satisfactory: 'green', functional: 'green', resolved: 'green', served: 'green', low: 'green',
  overdue: 'red', expired: 'red', non_compliant: 'red', inadequate: 'red', none: 'red', unsatisfactory: 'red', non_functional: 'red', unresolved: 'red', high: 'red', not_licensed: 'red',
  postponed: 'amber', pending: 'amber', pending_result: 'amber', needs_improvement: 'amber', needs_attention: 'amber', partial: 'amber', partially_resolved: 'amber', partially_functional: 'amber', medium: 'amber', draft: 'amber',
  planned: 'blue', in_progress: 'blue', open: 'blue', approved: 'blue', issued: 'violet',
  cancelled: 'gray', unknown: 'gray', withdrawn: 'gray', closed: 'gray', not_available: 'gray'
};
// Small coloured label showing a status, for example "Overdue" in red.
export function Badge({ status, tone, children, className = '' }) {
  const t = TONE[tone || STATUS_TONE[status] || 'gray'];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold ring-1 ring-inset ${t} ${className}`}>{children ?? humanize(status)}</span>;
}

// White box with a border, used to group content.
export function Card({ className = '', children, ...p }) { return <div className={`card ${className}`} {...p}>{children}</div>; }

// Page title area with an optional small heading above, a subtitle and action buttons on the right.
export function PageHeader({ title, subtitle, actions, eyebrow }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-600">{eyebrow}</div>}
        <h1 className="text-[22px] font-extrabold tracking-tight text-ink sm:text-[26px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// Pop up window. Closes with the X button, the Escape key, or a click outside it.
export function Modal({ open, onClose, title, children, footer, wide }) {
  // Listen for the Escape key only while the pop up is open.
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    // Dark background behind the pop up. On phones the pop up slides up from the bottom.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={onClose}>
      <div className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* Title bar with the close button. */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[17px] font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-faint hover:bg-paper" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {/* Main content, scrolls when it is long. */}
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {/* Buttons at the bottom. */}
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// Message shown when a list has no items.
export function Empty({ title = 'Nothing here yet', children, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-brand-50 p-3 text-brand-600"><Icon className="h-6 w-6" /></div>
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

// Loading indicator.
export const Spinner = ({ label = 'Loading…' }) => (
  <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-faint"><Loader2 className="h-5 w-5 animate-spin" />{label}</div>
);

// Row of tabs. The selected tab is underlined, and a count can be shown next to each label.
export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition ${value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-faint hover:text-ink'}`}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-paper px-1.5 py-0.5 text-[11px] text-ink-soft">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Number tile on the dashboard. Clicking it can open a filtered list.
export function Stat({ label, value, tone = 'default', sub, onClick }) {
  const c = { default: 'text-ink', red: 'text-red-600', amber: 'text-ochre-600', green: 'text-brand-600' }[tone];
  return (
    <button onClick={onClick} disabled={!onClick} className="card p-4 text-left transition enabled:hover:border-brand-200 enabled:hover:shadow-md">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`mt-1 text-[28px] font-extrabold leading-none tracking-tight ${c}`}>{value}</div>
      {sub && <div className="mt-1.5 text-[12px] text-ink-soft">{sub}</div>}
    </button>
  );
}

// Red box showing an error message.
export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{typeof error === 'string' ? error : error.message}</div>;
}

// Toasts are short pop up messages at the bottom of the screen, for example "Task saved".
// ---- Toasts ----
const ToastCtx = createContext(() => {});
// Call const toast = useToast(); then toast('Saved') or toast('Failed', 'error').
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  // Show a message and remove it again after 3.5 seconds.
  const push = useCallback((msg, tone = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg ${t.tone === 'error' ? 'bg-red-600' : 'bg-[#14211F] dark:bg-[#2E3B38]'}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
