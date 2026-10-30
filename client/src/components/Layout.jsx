// The frame around every signed in page: side menu, top bar (reminders and user menu), offline warning and the phone bottom menu.
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, CalendarCheck, ClipboardList, BookOpen, Search, BellRing, FileText, BarChart3, Users, Settings, LogOut, Bell, Menu, X, WifiOff, ChevronDown, KeyRound } from 'lucide-react';
import { useAuth, ROLE_LABEL } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { fmtDateTime, wardLabel } from '../lib/format.js';
import { Logo } from '../pages/Login.jsx';
import { Modal, Field, Input, Button, ErrorNote, useToast } from './ui.jsx';
import { ThemeToggle } from '../lib/theme.jsx';
import { Link } from 'react-router-dom';

// Layout shows the menu and the current page (the Outlet).
export default function Layout() {
  const { me, can, logout, switchWard } = useAuth();
  // drawer is the slide out menu on phones. online tracks the internet connection.
  const [drawer, setDrawer] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const loc = useLocation();
  // Close the phone menu whenever the user moves to another page.
  useEffect(() => setDrawer(false), [loc.pathname]);
  // Watch the browser's online and offline events to show a warning bar.
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Menu items. Team only shows for ward leads, Settings for leads, admins and reviewers.
  const nav = [
    { to: '/', label: 'Home', icon: Home, end: true },
    { to: '/planner', label: 'Planner', icon: CalendarCheck },
    { to: '/activities', label: 'Activity log', icon: ClipboardList },
    { to: '/registers/premises', label: 'Registers', icon: BookOpen, match: '/registers' },
    { to: '/inspections', label: 'Inspections', icon: Search },
    { to: '/follow-ups', label: 'Follow ups', icon: BellRing },
    { to: '/notices', label: 'Notices', icon: FileText },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
    ...(can.lead ? [{ to: '/team', label: 'Team', icon: Users }] : []),
    ...(can.lead || can.admin || can.audit ? [{ to: '/settings', label: 'Settings', icon: Settings }] : [])
  ];

  // Draws the menu links. The current page is highlighted.
  const NavItems = ({ compact }) => nav.map((n) => (
    <NavLink key={n.to} to={n.to} end={n.end}
      className={({ isActive }) => {
        const active = isActive || (n.match && loc.pathname.startsWith(n.match));
        return `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-semibold transition ${active ? 'bg-brand-700 text-white shadow-sm' : 'text-ink-soft hover:bg-ink/5 hover:text-ink'} ${compact ? '' : ''}`;
      }}>
      <n.icon className="h-[18px] w-[18px]" />{n.label}
    </NavLink>
  ));

  // Side menu content: logo, ward picker (when the user has more than one ward), links and a note.
  const sidebar = (
    <div className="flex h-full flex-col">
      {/* Clicking the logo goes to the home page and closes the phone menu. */}
      <div className="px-4 py-5"><Logo onClick={() => setDrawer(false)} /></div>
      {me.wards.length > 1 ? (
        <div className="px-4 pb-3">
          <label className="label">Ward</label>
          <select className="input py-2 text-sm" value={me.ward?.id || ''} onChange={(e) => switchWard(e.target.value)}>
            {me.wards.map((w) => <option key={w.id} value={w.id}>{wardLabel(w)}</option>)}
          </select>
        </div>
      ) : me.ward && (
        <div className="mx-4 mb-3 rounded-lg border border-line bg-paper px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Ward</div>
          <div className="text-sm font-semibold">{me.ward.name}</div>
          {me.ward.sub_county && <div className="text-[12px] text-ink-faint">{me.ward.sub_county}</div>}
        </div>
      )}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3"><NavItems /></nav>
      <div className="border-t border-line p-3 text-[11px] leading-relaxed text-ink-faint">
        Internet connection required. Work aid only; does not replace official registers or mandated reporting platforms.
      </div>
    </div>
  );

  // The four shortcuts in the phone bottom menu: Home, Planner, Registers, Follow ups.
  const mobileTabs = [nav[0], nav[1], nav[3], nav[5]];

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Side menu on large screens. */}
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-surface lg:block">{sidebar}</aside>

      {/* Slide out menu on phones. */}
      {drawer && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button className="absolute right-3 top-5 rounded p-1 text-ink-faint" onClick={() => setDrawer(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}

      {/* Top bar with the menu button, reminders bell and user menu. */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-paper/90 px-4 backdrop-blur lg:px-8">
        <button className="rounded-md p-1.5 text-ink-soft hover:bg-ink/5 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
        {/* Small logo on phones: tap it to go back to the home page. */}
        <div className="lg:hidden"><Logo compact /></div>
        <div className="truncate text-sm font-semibold text-ink-soft lg:hidden">{wardLabel(me.ward)}</div>
        <div className="flex-1" />
        {/* One button switches between the light and dark theme. */}
        <ThemeToggle />
        <Reminders />
        <UserMenu me={me} logout={logout} />
      </header>

      {/* Offline warning and "no ward" warning. */}
      {!online && (
        <div className="no-print flex items-center justify-center gap-2 bg-ochre-500 px-4 py-2 text-sm font-semibold text-white">
          <WifiOff className="h-4 w-4" /> You are offline. AfyaTrack needs an internet connection to save records.
        </div>
      )}
      {!me.ward && (
        <div className="m-4 rounded-lg border border-ochre-100 bg-ochre-50 p-4 text-sm text-ochre-700">
          {can.admin
            ? <>There are no active wards yet. <Link to="/settings?tab=wards" className="font-semibold underline">Add a ward in Settings, Wards</Link> and assign its members.</>
            : 'Your account is not linked to a ward yet. Ask the System Administrator to assign a ward and role.'}
        </div>
      )}

      {/* The current page is shown here. */}
      <main className="mx-auto max-w-7xl px-4 pb-28 pt-5 lg:px-8 lg:pb-12 lg:pt-7"><Outlet /></main>

      {/* Bottom menu on phones. */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {mobileTabs.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${isActive || (n.match && loc.pathname.startsWith(n.match)) ? 'text-brand-700' : 'text-ink-faint'}`}>
            <n.icon className="h-5 w-5" />{n.label}
          </NavLink>
        ))}
        <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold text-ink-faint"><Menu className="h-5 w-5" />More</button>
      </nav>
    </div>
  );
}

// Bell icon with the list of in app reminders. Checks for new reminders every 60 seconds.
function Reminders() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const load = () => api('/reminders').then(setItems).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  // Number shown on the bell.
  const unread = items.filter((i) => !i.read_at).length;
  // Clicking a reminder opens the task or the follow ups page.
  const go = (r) => {
    setOpen(false);
    if (r.linked_record_type?.startsWith('task')) nav(`/planner/${r.linked_record_id}`);
    else if (r.linked_record_type === 'follow_up') nav('/follow-ups');
    else if (r.linked_record_type === 'licence_expiry') nav(`/registers/premises/${r.linked_record_id}`);
    else if (r.linked_record_type === 'certificate_expiry') nav(`/registers/handler/${r.linked_record_id}`);
    else if (r.linked_record_type === 'sample_action') nav(`/registers/water_source/${r.linked_record_id}`);
    else if (r.linked_record_type === 'inactivity') nav('/activities?new=1');
  };
  return (
    <div className="relative">
      {/* Opening the list marks all reminders as read. */}
      <button onClick={() => { setOpen((o) => !o); if (!open && unread) api('/reminders/read-all', { method: 'POST' }).then(load); }}
        className="relative rounded-full p-2 text-ink-soft hover:bg-ink/5" aria-label="Reminders">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ochre-500 px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          <div className="border-b border-line px-4 py-2.5 text-sm font-bold">Reminders</div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <div className="px-4 py-6 text-center text-sm text-ink-faint">No reminders yet.</div>}
            {items.map((r) => (
              <button key={r.id} onClick={() => go(r)} className="block w-full border-b border-line/60 px-4 py-2.5 text-left hover:bg-paper">
                <div className={`text-sm ${r.read_at ? 'text-ink-soft' : 'font-semibold'}`}>{r.title}</div>
                <div className="text-[12px] text-ink-faint">{fmtDateTime(r.sent_at)} · in app</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Round button with the user's initials, opening a menu with change password and sign out.
function UserMenu({ me, logout }) {
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  // Initials from the first two names, for example "Amina Mwakio" gives "AM".
  const initials = me.user.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('');
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-ink/5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-[12px] font-bold text-white">{initials}</span>
        <span className="hidden text-left sm:block">
          <span className="block text-[13px] font-semibold leading-tight">{me.user.full_name}</span>
          <span className="block text-[11px] leading-tight text-ink-faint">{ROLE_LABEL[me.role] || 'No role'}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-ink-faint" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          <div className="border-b border-line px-4 py-2.5">
            <div className="text-sm font-semibold">{me.user.full_name}</div>
            <div className="truncate text-[12px] text-ink-faint">{me.user.email}</div>
          </div>
          <button onClick={() => { setPwOpen(true); setOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-paper"><KeyRound className="h-4 w-4" />Change password</button>
          <button onClick={logout} className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"><LogOut className="h-4 w-4" />Sign out</button>
        </div>
      )}
      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
      {/* Accounts with a temporary password must choose their own before continuing. */}
      <ChangePassword open={!!me.user.must_change_password} required onClose={() => {}} />
    </div>
  );
}

// Pop up to change the signed in user's password.
function ChangePassword({ open, onClose, required }) {
  const { refresh } = useAuth();
  const [f, setF] = useState({ current: '', password: '' });
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api('/auth/change-password', { method: 'POST', body: f }); toast('Password changed'); onClose(); setF({ current: '', password: '' }); if (required) refresh(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={required ? 'Choose your own password' : 'Change password'}
      footer={<>{!required && <Button variant="secondary" onClick={onClose}>Cancel</Button>}<Button onClick={save} loading={busy}>Save</Button></>}>
      {required && <p className="mb-3 text-sm text-ink-soft">You signed in with a temporary password. Choose a new password to continue.</p>}
      <ErrorNote error={err} />
      <div className="space-y-3">
        <Field label="Current password"><Input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="New password" hint="At least 8 characters."><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
