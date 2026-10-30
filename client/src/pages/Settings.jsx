// Settings page with tabs: wards and members, users and roles, targets, locations, categories (activity forms),
// templates and checklists, data quality checks and audit history.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, KeyRound, Trash2, Users as UsersIcon, Pencil, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth, ROLE_LABEL } from '../lib/auth.jsx';
import { fmtDate, fmtDateTime, todayStr, humanize, PILLARS, ENTITY_LABEL, wardLabel } from '../lib/format.js';
import { REGISTERS, REGISTER_KEYS, INSPECTABLE } from '../lib/registers.js';
import { Badge, Card, PageHeader, Spinner, Button, Empty, Tabs, Select, Input, Field, Textarea, Modal, ErrorNote, useToast } from '../components/ui.jsx';
import { useLoad, CategorySelect, errorText } from '../components/forms.jsx';

const ROLE_OPTIONS = [{ value: 'officer', label: 'PHO / Officer' }, { value: 'ward_lead', label: 'Ward PHO (lead)' }, { value: 'reviewer', label: 'Read only reviewer' }];

// The Settings page. Each tab only shows for the roles allowed to use it. ?tab=wards opens a tab directly.
export default function SettingsPage() {
  const { can, me } = useAuth();
  const [params, setParams] = useSearchParams();
  const hasWard = !!me.ward;
  const tabs = [
    ...(can.admin ? [{ value: 'wards', label: 'Wards and members' }] : []),
    ...(can.admin || can.lead ? [{ value: 'users', label: 'Users' }] : []),
    ...(can.lead && hasWard ? [{ value: 'targets', label: 'Targets' }, { value: 'locations', label: 'Locations' }] : []),
    ...(can.admin ? [{ value: 'categories', label: 'Activity categories' }, { value: 'templates', label: 'Templates and checklists' }] : []),
    ...((can.lead || me.role === 'reviewer') && hasWard ? [{ value: 'quality', label: 'Data quality' }] : []),
    ...(can.audit ? [{ value: 'audit', label: 'Audit history' }] : [])
  ];
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : tabs[0]?.value;
  const setTab = (v) => setParams({ tab: v }, { replace: true });
  if (!tabs.length) return <ErrorNote error="You do not have access to settings." />;
  return (
    <div>
      <PageHeader title="Settings" subtitle="Role based configuration. Every change is recorded in the audit history." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {/* Show the chosen tab. */}
      {tab === 'wards' && <Wards />}
      {tab === 'users' && <Users />}
      {tab === 'targets' && <Targets />}
      {tab === 'locations' && <Locations />}
      {tab === 'categories' && <Categories />}
      {tab === 'templates' && <Templates />}
      {tab === 'quality' && <DataQuality />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

// Wards tab (System Administrator): add, rename and deactivate wards, and manage each ward's members.
function Wards() {
  const { refresh } = useAuth();
  const { data, loading, reload } = useLoad(() => api('/wards'), []);
  const [edit, setEdit] = useState(null);
  const [members, setMembers] = useState(null);
  const toast = useToast();
  const toggle = async (w) => {
    if (!confirm(w.status === 'active' ? `Deactivate ${w.name}? Its members will no longer see it. Records are kept.` : `Reactivate ${w.name}?`)) return;
    try { await api(`/wards/${w.id}`, { method: 'PATCH', body: { status: w.status === 'active' ? 'inactive' : 'active' } }); toast('Ward updated'); reload(); refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  if (loading && !data) return <Spinner />;
  return (
    <div>
      <div className="mb-3 flex justify-end"><Button onClick={() => setEdit({})}><Plus className="h-4 w-4" />Add ward</Button></div>
      <Card className="overflow-hidden">
        {data.length === 0 ? <Empty title="No wards yet">Add the first ward, then add its members.</Empty> : (
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>Ward</th><th>Code</th><th className="hidden md:table-cell">Sub county / county</th><th className="text-right">Members</th><th>Status</th><th></th></tr></thead>
            <tbody>{data.map((w) => (
              <tr key={w.id}>
                <td className="font-semibold">{w.name}</td><td className="font-mono text-[13px]">{w.code || '—'}</td>
                <td className="hidden md:table-cell">{[w.sub_county, w.county].filter(Boolean).join(', ') || '—'}</td>
                <td className="text-right font-mono">{w.member_count}</td>
                <td><Badge status={w.status === 'active' ? 'completed' : 'cancelled'}>{humanize(w.status)}</Badge></td>
                <td className="whitespace-nowrap text-right">
                  <Button size="sm" variant="secondary" onClick={() => setMembers(w)}><UsersIcon className="h-3.5 w-3.5" />Members</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(w)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle(w)}>{w.status === 'active' ? 'Deactivate' : 'Reactivate'}</Button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <WardModal ward={edit} onClose={() => setEdit(null)} onSaved={() => { reload(); refresh(); }} />
      {members && <MembersModal ward={members} onClose={() => { setMembers(null); reload(); refresh(); }} />}
    </div>
  );
}

// Pop up to add or edit a ward.
function WardModal({ ward, onClose, onSaved }) {
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({}); const [busy, setBusy] = useState(false);
  // dup holds the warning when the same name, sub county and county already exist; the admin can still save.
  const [dup, setDup] = useState(null);
  const toast = useToast();
  useEffect(() => { if (ward) { setF({ name: ward.name || '', code: ward.code || '', sub_county: ward.sub_county || 'Msambweni', county: ward.county || 'Kwale' }); setErrors({}); setDup(null); } }, [ward]);
  if (!ward) return null;
  // allowDuplicate = true is sent after the admin clicks "Save anyway".
  const save = async (allowDuplicate = false) => {
    setBusy(true); setErrors({});
    const body = { ...f, allow_duplicate: allowDuplicate };
    try { if (ward.id) await api(`/wards/${ward.id}`, { method: 'PATCH', body }); else await api('/wards', { method: 'POST', body }); toast('Ward saved'); onSaved(); onClose(); }
    catch (e) { if (e.body?.duplicate) setDup(e.message); else setErrors(e.errors || { name: e.message }); } finally { setBusy(false); }
  };
  // Changing any field hides the duplicate warning, so the next Save checks again.
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setDup(null); };
  return (
    <Modal open onClose={onClose} title={ward.id ? 'Edit ward' : 'Add ward'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>{dup ? <Button onClick={() => save(true)} loading={busy}>Save anyway</Button> : <Button onClick={() => save()} loading={busy}>Save</Button>}</>}>
      {dup && <div className="mb-4 rounded-lg border border-ochre-100 bg-ochre-50 p-3 text-sm text-ochre-700">{dup}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ward name" required error={errors.name} className="sm:col-span-2"><Input value={f.name || ''} onChange={set('name')} placeholder="e.g. Ukunda Ward" /></Field>
        <Field label="Short code" hint="Used in references, for example UKD."><Input value={f.code || ''} onChange={set('code')} maxLength={8} /></Field>
        <Field label="Sub county"><Input value={f.sub_county || ''} onChange={set('sub_county')} /></Field>
        <Field label="County"><Input value={f.county || ''} onChange={set('county')} /></Field>
      </div>
    </Modal>
  );
}

// Pop up listing a ward's members, with buttons to add an existing user or remove a role.
function MembersModal({ ward, onClose }) {
  const { data, loading, reload } = useLoad(() => api(`/wards/${ward.id}/members`), [ward.id]);
  const { data: users } = useLoad(() => api('/users'), []);
  const [f, setF] = useState({ user_id: '', role: 'officer' });
  const [err, setErr] = useState(null);
  const toast = useToast();
  const add = async () => {
    setErr(null);
    try { await api(`/wards/${ward.id}/members`, { method: 'POST', body: { user_id: Number(f.user_id), role: f.role } }); toast('Member added'); setF({ ...f, user_id: '' }); reload(); }
    catch (e) { setErr(Object.values(e.errors || {})[0] || e.message); }
  };
  const remove = async (m) => {
    if (!confirm(`Remove ${m.full_name} as ${ROLE_LABEL[m.role]} from ${ward.name}? Their records are kept.`)) return;
    try { await api(`/memberships/${m.id}`, { method: 'DELETE' }); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} title={`Members of ${wardLabel(ward)}`} wide footer={<Button onClick={onClose}>Done</Button>}>
      <ErrorNote error={err} />
      <div className="mb-4 grid items-end gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_200px_auto]">
        <Field label="Add an existing user"><Select value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })} placeholder="Choose…" options={(users || []).filter((u) => u.active).map((u) => ({ value: u.id, label: `${u.full_name} (${u.email})` }))} /></Field>
        <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} options={ROLE_OPTIONS} /></Field>
        <Button onClick={add} disabled={!f.user_id}><Plus className="h-4 w-4" />Add</Button>
      </div>
      <p className="mb-3 text-[12px] text-ink-faint">New people: create them in the Users tab (Invite user) and choose this ward there.</p>
      {loading && !data ? <Spinner /> : data.length === 0 ? <Empty title="No members yet" /> : (
        <table className="tbl"><thead><tr><th>Name</th><th>Role</th><th className="hidden sm:table-cell">Since</th><th></th></tr></thead>
          <tbody>{data.map((m) => (
            <tr key={m.id}><td><div className="font-semibold">{m.full_name}</div><div className="text-[12px] text-ink-faint">{m.email}{m.phone ? ` · ${m.phone}` : ''}</div></td>
              <td><Badge tone="blue">{ROLE_LABEL[m.role]}</Badge></td><td className="hidden sm:table-cell">{fmtDate(m.active_from)}</td>
              <td className="text-right"><Button size="sm" variant="ghost" onClick={() => remove(m)}><Trash2 className="h-4 w-4" /></Button></td></tr>
          ))}</tbody></table>
      )}
    </Modal>
  );
}

// Targets tab (ward leads): weekly, monthly, quarterly or annual targets for the ward, one officer or one location.
function Targets() {
  const { lookups, me } = useAuth();
  const { data, loading, reload } = useLoad(() => api('/targets'), [me.ward?.id]);
  const thisQ = `${todayStr().slice(0, 4)}-Q${Math.floor((Number(todayStr().slice(5, 7)) - 1) / 3) + 1}`;
  const [f, setF] = useState({ category_id: '', period_type: 'monthly', period_month: todayStr().slice(0, 7), period_date: todayStr(), period_quarter: thisQ, period_year: todayStr().slice(0, 4), target_value: '', user_id: '', location_id: '' });
  const [errors, setErrors] = useState({}); const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Saves a target and clears the value box for the next one.
  const add = async () => {
    setBusy(true); setErrors({});
    try { await api('/targets', { method: 'POST', body: f }); toast('Target saved'); reload(); setF({ ...f, target_value: '' }); }
    catch (e) { setErrors(e.errors || { _: e.message }); } finally { setBusy(false); }
  };
  // Removes a target after confirming.
  const del = async (t) => { if (!confirm('Remove this target?')) return; await api(`/targets/${t.id}`, { method: 'DELETE' }); reload(); };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-5">
      <Card className="p-4">
        <h3 className="mb-3 font-bold">Set a target</h3>
        <ErrorNote error={errors._ || errors.period} />
        <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Category" error={errors.category_id} className="lg:col-span-2"><CategorySelect value={f.category_id} onChange={set('category_id')} categories={lookups.categories} /></Field>
          <Field label="Period"><Select value={f.period_type} onChange={set('period_type')} options={['weekly', 'monthly', 'quarterly', 'annual']} /></Field>
          {f.period_type === 'weekly' && <Field label="Day in week"><Input type="date" value={f.period_date} onChange={set('period_date')} /></Field>}
          {f.period_type === 'monthly' && <Field label="Month"><Input type="month" value={f.period_month} onChange={set('period_month')} /></Field>}
          {f.period_type === 'quarterly' && <Field label="Quarter"><Select value={f.period_quarter} onChange={set('period_quarter')} options={['Q1', 'Q2', 'Q3', 'Q4'].map((q) => ({ value: `${f.period_year}-${q}`, label: `${f.period_year} ${q}` }))} /></Field>}
          {f.period_type === 'annual' && <Field label="Year"><Input type="number" value={f.period_year} onChange={set('period_year')} /></Field>}
          <Field label="Target" error={errors.target_value}><Input type="number" min="0" value={f.target_value} onChange={set('target_value')} /></Field>
          <Field label="For"><Select value={f.user_id} onChange={set('user_id')} placeholder="Whole ward" options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} /></Field>
          <Field label="Location (optional)" error={errors.location_id}><Select value={f.location_id} onChange={set('location_id')} placeholder="All locations" options={lookups.locations.map((l) => ({ value: l.id, label: [l.village, l.sub_location].filter(Boolean).join(', ') }))} /></Field>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={add} loading={busy}><Plus className="h-4 w-4" />Save target</Button></div>
      </Card>
      {loading && !data ? <Spinner /> : (
        <Card className="overflow-hidden">
          {data.length === 0 ? <Empty title="No targets set">Without a target, reports show achievement as N/A.</Empty> : (
            <div className="overflow-x-auto"><table className="tbl">
              <thead><tr><th>Category</th><th>Period</th><th>For</th><th className="text-right">Target</th><th>Approved by</th><th></th></tr></thead>
              <tbody>{data.map((t) => (
                <tr key={t.id}><td className="font-medium">{t.category}</td><td className="whitespace-nowrap">{humanize(t.period_type)} · {fmtDate(t.period_start)} to {fmtDate(t.period_end)}</td>
                  <td>{t.officer_name || 'Whole ward'}{t.sub_location ? <div className="text-[12px] text-ink-faint">{t.sub_location}</div> : null}</td><td className="text-right font-mono font-bold">{t.target_value}</td>
                  <td className="whitespace-nowrap text-[13px]">{t.approved_by_name}<div className="text-[11px] text-ink-faint">{fmtDateTime(t.created_at)}</div></td>
                  <td><button onClick={() => del(t)} className="rounded p-1 text-ink-faint hover:text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}
    </div>
  );
}

// Users tab: list users, invite (admin), edit name, email, phone and roles, reset password and deactivate.
function Users() {
  const { can } = useAuth();
  const { data, loading, reload } = useLoad(() => api('/users'), []);
  const { data: wards } = useLoad(() => api('/wards'), []);
  const [edit, setEdit] = useState(null);
  const [temp, setTemp] = useState(null);
  const toast = useToast();
  // Deactivate or reactivate a user. Their records are kept.
  const toggle = async (u) => {
    if (!confirm(u.active ? `Deactivate ${u.full_name}? They can no longer sign in. Their records are kept.` : `Reactivate ${u.full_name}?`)) return;
    try { await api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); toast('Updated'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  // Creates a temporary password and shows it once.
  const resetPw = async (u) => {
    if (!confirm(`Generate a new temporary password for ${u.full_name}?`)) return;
    const r = await api(`/users/${u.id}/reset-password`, { method: 'POST' }); setTemp({ name: u.full_name, pw: r.temporary_password, email: r.email_status, to: u.email });
  };
  if (loading && !data) return <Spinner />;
  const missing = data.filter((u) => u.active && u.placeholder_email);
  return (
    <div>
      {can.admin && missing.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-ochre-100 bg-ochre-50 px-3 py-2.5 text-[13px] text-ochre-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
          <span>{missing.length} user{missing.length === 1 ? ' needs' : 's need'} a real email address to receive sign in codes: {missing.map((u) => u.full_name).join(', ')}. Use Edit to add them.</span>
        </div>
      )}
      {can.admin && <div className="mb-3 flex justify-end"><Button onClick={() => setEdit({})}><Plus className="h-4 w-4" />Invite user</Button></div>}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Name</th><th>Roles</th><th>Status</th><th className="hidden md:table-cell">Last sign in</th>{can.admin && <th></th>}</tr></thead>
          <tbody>{data.map((u) => (
            <tr key={u.id}>
              <td><div className="font-semibold">{u.full_name}</div><div className={`text-[12px] ${u.placeholder_email ? 'text-red-600' : 'text-ink-faint'}`}>{u.email}{u.placeholder_email ? ' (placeholder)' : ''}</div>{u.phone && <div className="text-[12px] text-ink-faint">{u.phone}</div>}</td>
              <td><div className="flex flex-wrap gap-1">{u.is_admin ? <Badge tone="violet">System Administrator</Badge> : null}{u.memberships.filter((m) => !m.active_to || m.active_to >= todayStr()).map((m) => <Badge key={m.id} tone="blue">{ROLE_LABEL[m.role]} · {m.ward_name}</Badge>)}</div></td>
              <td><Badge status={u.active ? 'completed' : 'cancelled'}>{u.active ? 'Active' : 'Deactivated'}</Badge>{u.must_change_password ? <div className="mt-1 text-[11px] text-ink-faint">Temporary password</div> : null}</td>
              <td className="hidden md:table-cell whitespace-nowrap text-[13px]">{fmtDateTime(u.last_login_at)}</td>
              {can.admin && <td className="whitespace-nowrap text-right">
                <Button size="sm" variant="ghost" onClick={() => setEdit(u)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => resetPw(u)} title="Reset password"><KeyRound className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</Button>
              </td>}
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      <UserModal user={edit} wards={(wards || []).filter((w) => w.status === 'active')} onClose={() => setEdit(null)} onSaved={(pw, name, email, to) => { reload(); if (pw) setTemp({ name, pw, email, to }); }} />
      <Modal open={!!temp} onClose={() => setTemp(null)} title="Temporary password" footer={<Button onClick={() => setTemp(null)}>Done</Button>}>
        <p className="text-sm text-ink-soft">Share this securely with <b>{temp?.name}</b>. They must choose their own password after signing in. It will not be shown again.</p>
        {/* What happened to the email: sent, printed in the API terminal (email not set up), or failed. */}
        {temp?.email === 'sent' && <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-[13px] text-brand-700">Also emailed to {temp.to}. Ask them to check the spam folder if it does not arrive.</div>}
        {temp?.email === 'printed' && <div className="mt-3 rounded-lg border border-ochre-100 bg-ochre-50 px-3 py-2 text-[13px] text-ochre-700">Not emailed: email is not set up yet, so the message was printed in the API terminal. Give them this password yourself.</div>}
        {temp?.email === 'failed' && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">The email could not be sent (check SMTP_USER and SMTP_PASS in .env; the API terminal shows the reason). Give them this password yourself.</div>}
        <div className="mt-3 rounded-lg bg-paper px-4 py-3 text-center font-mono text-lg font-bold tracking-wider">{temp?.pw}</div>
      </Modal>
    </div>
  );
}

// Pop up to invite a new user or edit an existing one, including email, phone and ward roles.
function UserModal({ user, wards, onClose, onSaved }) {
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  // Fill the form with the user being edited. New users start with an officer role in the first ward.
  useEffect(() => {
    if (user) setF({ full_name: user.full_name || '', email: user.email || '', phone: user.phone || '', is_admin: !!user.is_admin,
      memberships: user.memberships ? user.memberships.filter((m) => !m.active_to || m.active_to >= todayStr()).map((m) => ({ ward_id: m.ward_id, role: m.role })) : (wards[0] ? [{ ward_id: wards[0].id, role: 'officer' }] : []) });
    setErrors({}); setErr(null);
  }, [user]); // eslint-disable-line
  if (!user) return null;
  const isNew = !user.id;
  // New users are created with POST, existing users are updated with PATCH.
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (isNew) { const r = await api('/users', { method: 'POST', body: f }); onSaved(r.temporary_password, f.full_name, r.email_status, f.email); }
      else { await api(`/users/${user.id}`, { method: 'PATCH', body: { full_name: f.full_name, email: f.email, phone: f.phone, is_admin: f.is_admin, memberships: f.memberships } }); onSaved(); }
      onClose();
    } catch (e) { setErr(errorText(e)); setErrors(e.errors || {}); } finally { setBusy(false); }
  };
  // Changes one field of one ward role row.
  const setM = (i, k, v) => setF({ ...f, memberships: f.memberships.map((m, j) => (j === i ? { ...m, [k]: k === 'ward_id' ? Number(v) : v } : m)) });
  return (
    <Modal open onClose={onClose} title={isNew ? 'Invite user' : 'Edit user'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>{isNew ? 'Create account' : 'Save'}</Button></>}>
      <ErrorNote error={err} />
      <div className="grid gap-4">
        <Field label="Full name" required error={errors.full_name}><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Email (sign in and sign in codes)" required error={errors.email}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone (optional, for contact)" error={errors.phone} hint="Kenyan numbers like 0712 345 678 are saved as +254712345678."><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        {/* Ward roles: one row per ward and role, with buttons to add or remove rows. */}
        <div>
          <div className="label">Ward roles</div>
          {errors.memberships && <div className="mb-1 text-[13px] text-red-600">{errors.memberships}</div>}
          {!wards.length && <div className="text-[13px] text-ink-faint">No active wards yet. Add one in the Wards tab first.</div>}
          <div className="space-y-2">
            {f.memberships?.map((m, i) => (
              <div key={i} className="flex gap-2">
                <Select value={m.ward_id} onChange={(e) => setM(i, 'ward_id', e.target.value)} options={wards.map((w) => ({ value: w.id, label: wardLabel(w) }))} />
                <Select value={m.role} onChange={(e) => setM(i, 'role', e.target.value)} options={ROLE_OPTIONS} />
                <Button variant="ghost" onClick={() => setF({ ...f, memberships: f.memberships.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          {wards.length > 0 && <Button size="sm" variant="secondary" className="mt-2" onClick={() => setF({ ...f, memberships: [...(f.memberships || []), { ward_id: wards[0]?.id, role: 'officer' }] })}><Plus className="h-4 w-4" />Add role</Button>}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.is_admin} onChange={(e) => setF({ ...f, is_admin: e.target.checked })} />System Administrator (all privileged actions are logged)</label>
        {isNew && <p className="text-[12px] text-ink-faint">A temporary password is generated, shown once and emailed to the user.</p>}
      </div>
    </Modal>
  );
}

// Locations tab (ward leads): add sub locations, villages and landmarks for the ward.
function Locations() {
  const { lookups, reloadLookups } = useAuth();
  const [f, setF] = useState({ location: '', sub_location: '', village: '', landmark: '' });
  const [err, setErr] = useState(null);
  const toast = useToast();
  // Saves a location and keeps the sub location filled in for the next village.
  const add = async () => {
    setErr(null);
    try { await api('/locations', { method: 'POST', body: f }); toast('Location added'); setF({ ...f, village: '', landmark: '' }); reloadLookups(); } catch (e) { setErr(e.message); }
  };
  return (
    <div className="space-y-5">
      <Card className="p-4">
        <ErrorNote error={err} />
        <div className="grid items-end gap-3 sm:grid-cols-5">
          <Field label="Location"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="Sub location" required><Input value={f.sub_location} onChange={(e) => setF({ ...f, sub_location: e.target.value })} /></Field>
          <Field label="Village or estate"><Input value={f.village} onChange={(e) => setF({ ...f, village: e.target.value })} /></Field>
          <Field label="Landmark"><Input value={f.landmark} onChange={(e) => setF({ ...f, landmark: e.target.value })} /></Field>
          <Button onClick={add}><Plus className="h-4 w-4" />Add location</Button>
        </div>
      </Card>
      <Card className="overflow-hidden"><table className="tbl"><thead><tr><th>Location</th><th>Sub location</th><th>Village</th><th>Landmark</th></tr></thead>
        <tbody>{lookups.locations.length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-ink-faint">No locations yet.</td></tr> : lookups.locations.map((l) => <tr key={l.id}><td>{l.location || '—'}</td><td className="font-medium">{l.sub_location}</td><td>{l.village || '—'}</td><td>{l.landmark || '—'}</td></tr>)}</tbody></table></Card>
    </div>
  );
}

// Categories tab (admins): activity categories grouped by pillar, each with its own configurable form.
function Categories() {
  const { lookups, reloadLookups } = useAuth();
  const [edit, setEdit] = useState(null);
  const toast = useToast();
  const toggle = async (c) => { try { await api(`/categories/${c.id}`, { method: 'PATCH', body: { active: !c.active } }); reloadLookups(); } catch (e) { toast(e.message, 'error'); } };
  const groups = Object.keys(PILLARS).map((p) => [p, lookups.categories.filter((c) => c.pillar === p)]).filter(([, cs]) => cs.length);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[13px] text-ink-faint">Each category is an activity type. Its form fields appear when an officer records that activity. Inspection categories use the checklist of their register.</p>
        <Button onClick={() => setEdit({ form: [], pillar: 'N', unit: 'activities', module_group: 'general' })}><Plus className="h-4 w-4" />New category</Button>
      </div>
      {groups.map(([p, cs]) => (
        <Card key={p} className="overflow-hidden">
          <div className="border-b border-line bg-paper/50 px-4 py-2 text-[13px] font-bold">{p}. {PILLARS[p]}</div>
          <table className="tbl"><tbody>{cs.map((c) => (
            <tr key={c.id}>
              <td><div className="font-medium">{c.name}</div><div className="text-[12px] text-ink-faint">{c.form.length ? `${c.form.length} form field(s)` : INSPECTABLE.includes(c.module_group) ? `Inspection of ${ENTITY_LABEL[c.module_group]}` : 'No extra fields'} · counted in {c.unit}</div></td>
              <td><Badge status={c.active ? 'completed' : 'cancelled'}>{c.active ? 'Active' : 'Inactive'}</Badge></td>
              <td className="whitespace-nowrap text-right"><Button size="sm" variant="ghost" onClick={() => setEdit(c)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => toggle(c)}>{c.active ? 'Deactivate' : 'Activate'}</Button></td>
            </tr>
          ))}</tbody></table>
        </Card>
      ))}
      {edit && <CategoryModal cat={edit} onClose={() => setEdit(null)} onSaved={reloadLookups} />}
    </div>
  );
}

// Pop up to create or edit a category and its form fields (label, type, options, required).
function CategoryModal({ cat, onClose, onSaved }) {
  const [f, setF] = useState({ name: cat.name || '', description: cat.description || '', pillar: cat.pillar || 'N', unit: cat.unit || 'activities', people_field: cat.people_field || '',
    form: (cat.form || []).map((x) => ({ ...x, options: (x.options || []).join(', ') })) });
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const toast = useToast();
  const setField = (i, k, v) => setF({ ...f, form: f.form.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const move = (i, d) => { const a = [...f.form]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); setF({ ...f, form: a }); };
  const save = async () => {
    setBusy(true); setErr(null);
    const body = { ...f, form: f.form.map((x) => ({ ...x, options: x.type === 'select' ? x.options.split(',').map((o) => o.trim()).filter(Boolean) : undefined })) };
    try { if (cat.id) await api(`/categories/${cat.id}`, { method: 'PATCH', body }); else await api('/categories', { method: 'POST', body: { ...body, module_group: cat.module_group || 'general' } }); toast('Category saved'); onSaved(); onClose(); }
    catch (e) { setErr(Object.values(e.errors || {})[0] || e.message); } finally { setBusy(false); }
  };
  const numberFields = f.form.filter((x) => x.type === 'number' && x.key);
  return (
    <Modal open onClose={onClose} title={cat.id ? 'Edit category' : 'New category'} wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <ErrorNote error={err} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Pillar"><Select value={f.pillar} onChange={(e) => setF({ ...f, pillar: e.target.value })} options={Object.entries(PILLARS).map(([k, v]) => ({ value: k, label: `${k}. ${v}` }))} /></Field>
        <Field label="Counted in (unit)"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="visits, sessions, samples ..." /></Field>
        <Field label="Description" className="sm:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
      <div className="mt-5 flex items-center justify-between"><div className="font-bold">Form fields</div><Button size="sm" variant="secondary" onClick={() => setF({ ...f, form: [...f.form, { label: '', type: 'text', required: false, options: '' }] })}><Plus className="h-4 w-4" />Add field</Button></div>
      {f.form.length === 0 && <p className="mt-2 text-sm text-ink-faint">No extra fields. Officers record date, location, quantity, outcome and notes only.</p>}
      <div className="mt-2 space-y-2">
        {f.form.map((x, i) => (
          <div key={i} className="grid items-end gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_130px_1fr_auto]">
            <Field label="Label"><Input value={x.label} onChange={(e) => setField(i, 'label', e.target.value)} /></Field>
            <Field label="Type"><Select value={x.type} onChange={(e) => setField(i, 'type', e.target.value)} options={['text', 'textarea', 'number', 'date', 'select', 'checkbox']} /></Field>
            <Field label={x.type === 'select' ? 'Options (comma separated)' : 'Options'}><Input value={x.options || ''} disabled={x.type !== 'select'} onChange={(e) => setField(i, 'options', e.target.value)} /></Field>
            <div className="flex items-center gap-1 pb-1">
              <label className="mr-1 flex items-center gap-1 text-[12px]"><input type="checkbox" className="accent-brand-700" checked={!!x.required} onChange={(e) => setField(i, 'required', e.target.checked)} />Required</label>
              <button disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-ink-faint disabled:opacity-30" aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
              <button disabled={i === f.form.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-ink-faint disabled:opacity-30" aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
              <button onClick={() => setF({ ...f, form: f.form.filter((_, j) => j !== i) })} className="rounded p-1 text-ink-faint hover:text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
      {numberFields.length > 0 && (
        <div className="mt-4 max-w-sm"><Field label="Field that holds the number of people reached" hint="Used for people reached totals in reports."><Select value={f.people_field} onChange={(e) => setF({ ...f, people_field: e.target.value })} placeholder="None" options={numberFields.map((x) => ({ value: x.key, label: x.label }))} /></Field></div>
      )}
    </Modal>
  );
}

// Templates tab (admins): notice templates and versioned inspection checklists with sections.
function Templates() {
  const { reloadLookups } = useAuth();
  const { data, reload } = useLoad(() => api('/templates'), []);
  const [edit, setEdit] = useState(null);
  const [clType, setClType] = useState('premises');
  const [cl, setCl] = useState(null);
  const toast = useToast();
  // Load the checklist of the chosen type and show its lines one per line.
  useEffect(() => { api(`/checklists/${clType}`).then((c) => setCl({ ...c, text: c.items.join('\n') })); }, [clType]);
  // Saves a template: update when it has an id, otherwise create a new one.
  const saveTpl = async () => {
    try { if (edit.id) await api(`/templates/${edit.id}`, { method: 'PATCH', body: edit }); else await api('/templates', { method: 'POST', body: edit }); toast('Template saved'); setEdit(null); reload(); reloadLookups(); }
    catch (e) { toast(e.message, 'error'); }
  };
  // Saves the checklist as a new version. Empty lines are ignored.
  const saveCl = async () => {
    const items = cl.text.split('\n').map((x) => x.trim()).filter(Boolean);
    try { const r = await api('/checklists', { method: 'POST', body: { entity_type: clType, items } }); toast(`Checklist saved as version ${r.version}`); setCl({ ...cl, version: r.version }); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Notice templates list. Click one to edit it. */}
      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-3"><span className="font-bold">Notice templates</span><Button size="sm" onClick={() => setEdit({ name: '', body: '' })}><Plus className="h-4 w-4" />New</Button></div>
        {(data || []).map((t) => (
          <button key={t.id} onClick={() => setEdit(t)} className="flex w-full items-center justify-between border-b border-line/70 px-4 py-3 text-left text-sm last:border-0 hover:bg-paper">
            <span className="font-medium">{t.name}</span><Badge status={t.active ? 'approved' : 'withdrawn'}>{t.active ? 'Approved' : 'Inactive'}</Badge>
          </button>
        ))}
        <p className="px-4 py-3 text-[12px] text-ink-faint">Placeholders: {'{{reference}} {{date}} {{recipient}} {{entity_name}} {{location}} {{ward}} {{findings}} {{corrective_action}} {{compliance_deadline}} {{legal_provision}} {{notice_type}} {{officer_name}}'}</p>
      </Card>
      {/* Checklist editor. */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2"><span className="font-bold">Inspection checklist</span>
          <Select className="max-w-[220px]" value={clType} onChange={(e) => setClType(e.target.value)} options={INSPECTABLE.map((k) => ({ value: k, label: REGISTERS[k].singular }))} /></div>
        {cl && <>
          <Field label={`Items (one per line) · current version ${cl.version}`} hint='Start a line with "# " for a section heading. Add "(if field)" to show a section only when the record has it, for example "# Kitchen (if has_kitchen)". Saving creates a new version; past inspections keep theirs.'>
            <Textarea rows={14} className="font-mono text-[13px]" value={cl.text} onChange={(e) => setCl({ ...cl, text: e.target.value })} />
          </Field>
          <div className="mt-3 flex justify-end"><Button onClick={saveCl}>Save new version</Button></div>
        </>}
      </Card>
      {/* Pop up to edit a template. */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit template' : 'New template'} wide
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={saveTpl}>Save</Button></>}>
        {edit && <div className="grid gap-4">
          <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Body"><Textarea rows={16} className="font-mono text-[13px]" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
          {edit.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-700" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Active (available for drafting)</label>}
        </div>}
      </Modal>
    </div>
  );
}

// Data quality tab: missing fields, likely duplicates, impossible dates, inconsistent records and missing follow up dates.
function DataQuality() {
  const { can, me } = useAuth();
  const { data, loading, reload } = useLoad(() => api('/data-quality'), [me.ward?.id]);
  const toast = useToast();
  const [kind, setKind] = useState('');
  const dismiss = async (i) => {
    const reason = prompt('Why is this not a problem? (for example: different schools with the same name)');
    if (!reason) return;
    try { await api('/data-quality/dismiss', { method: 'POST', body: { key: i.key, reason } }); toast('Issue dismissed'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const link = (i) => (REGISTERS[i.entity_type] ? `/registers/${i.entity_type}/${i.entity_id}` : i.entity_type === 'inspection' ? `/inspections/${i.entity_id}` : i.entity_type === 'notice' ? `/notices/${i.entity_id}` : '/activities');
  if (loading && !data) return <Spinner />;
  const counts = data.reduce((m, i) => ({ ...m, [i.kind]: (m[i.kind] || 0) + 1 }), {});
  const rows = data.filter((i) => !kind || i.kind === kind);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button onClick={() => setKind('')} className={`rounded-full px-3 py-1 text-[13px] font-semibold ${!kind ? 'bg-brand-700 text-white' : 'bg-paper text-ink-soft'}`}>All ({data.length})</button>
        {Object.entries(counts).map(([k, v]) => <button key={k} onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-[13px] font-semibold ${kind === k ? 'bg-brand-700 text-white' : 'bg-paper text-ink-soft'}`}>{humanize(k)} ({v})</button>)}
      </div>
      <Card className="overflow-hidden">
        {rows.length === 0 ? <Empty title="No data quality issues found">Checks run on registers, activities, inspections and notices in this ward.</Empty> : (
          <table className="tbl"><thead><tr><th>Issue</th><th>Record</th><th>Details</th><th></th></tr></thead>
            <tbody>{rows.map((i) => (
              <tr key={i.key}>
                <td><Badge status={i.kind === 'duplicate' ? 'pending' : i.kind === 'impossible_date' || i.kind === 'inconsistent' ? 'overdue' : 'open'}>{humanize(i.kind)}</Badge></td>
                <td><Link to={link(i)} className="font-medium text-brand-700 hover:underline">{i.name || `${humanize(i.entity_type)} #${i.entity_id}`}</Link><div className="text-[12px] text-ink-faint">{ENTITY_LABEL[i.entity_type] || humanize(i.entity_type)}</div></td>
                <td className="max-w-md text-[13px]">{i.message}</td>
                <td className="text-right">{can.lead && <Button size="sm" variant="ghost" onClick={() => dismiss(i)}>Dismiss</Button>}</td>
              </tr>
            ))}</tbody></table>
        )}
      </Card>
    </div>
  );
}

// Audit history tab: read only list of changes, filtered by record type and action.
function Audit() {
  const [f, setF] = useState({ entity_type: '', action: '' });
  const { data, loading } = useLoad(() => api(`/audit${qs(f)}`), [JSON.stringify(f)]);
  return (
    <div>
      <div className="mb-3 grid gap-2 sm:max-w-lg sm:grid-cols-2">
        <Select value={f.entity_type} onChange={(e) => setF({ ...f, entity_type: e.target.value })} placeholder="All record types"
          options={['task', 'activity_record', 'follow_up', 'inspection', 'inspection_finding', 'notice_draft', 'water_sample', 'attachment', 'report', 'user', 'ward', 'target', 'category', ...REGISTER_KEYS]} />
        <Select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} placeholder="All actions"
          options={['create', 'update', 'status_change', 'submit', 'delete', 'export', 'login', 'login_failed', 'login_code_sent', 'login_code_failed', 'role_change', 'deactivate', 'notice_approve', 'notice_serve']} />
      </div>
      {/* Audit table, newest first. */}
      {loading && !data ? <Spinner /> : (
        <Card className="overflow-hidden">
          <div className="border-b border-line bg-paper/50 px-4 py-2 text-[12px] text-ink-faint">Read only. Audit events cannot be edited.</div>
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>When (EAT)</th><th>Who</th><th>Action</th><th>Record</th><th className="hidden md:table-cell">Summary</th></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id}><td className="whitespace-nowrap text-[13px]">{fmtDateTime(a.at)}</td><td className="whitespace-nowrap">{a.actor_name || '—'}</td><td><Badge tone="gray">{humanize(a.action)}</Badge></td>
                <td className="whitespace-nowrap text-[13px]">{humanize(a.entity_type)}{a.entity_id ? ` #${a.entity_id}` : ''}</td>
                <td className="hidden max-w-md truncate font-mono text-[11px] text-ink-faint md:table-cell" title={a.change_summary}>{a.change_summary}</td></tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}
