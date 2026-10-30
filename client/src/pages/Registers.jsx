// Register pages: the register list with filters, the add and edit form, the record profile page, and water samples.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, ArrowLeft, Pencil, Search, CalendarPlus, BellPlus, FileText, FlaskConical, AlertTriangle, Power } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, fmtDateTime, todayStr, humanize } from '../lib/format.js';
import { REGISTERS, REGISTER_KEYS, REGISTER_GROUPS } from '../lib/registers.js';
import { Badge, Card, PageHeader, Spinner, Button, Empty, Tabs, Select, Input, Field, Textarea, Modal, ErrorNote, useToast } from '../components/ui.jsx';
import { useLoad, TaskForm, FollowUpForm, NoticeForm, locationLabel, Attachments, errorText } from '../components/forms.jsx';

// Draws one table cell based on the column settings: a coloured badge, a date (red when expired or overdue), a count, or plain text.
function Cell({ col, row }) {
  const v = row[col.key];
  if (col.badge) return <Badge status={v || 'unknown'} />;
  if (col.date) {
    const today = todayStr();
    const flag = v && ((col.expiry && v < today) || (col.due && v < today));
    return <span className={flag ? 'font-semibold text-red-600' : ''}>{fmtDate(v)}{flag && col.expiry ? ' (expired)' : flag ? ' (overdue)' : ''}</span>;
  }
  if (col.num) return v ? <Badge tone="amber">{v}</Badge> : <span className="text-ink-faint">0</span>;
  return v ?? <span className="text-ink-faint">—</span>;
}

// The register list page, for example /registers/premises.
export default function Registers() {
  const { type } = useParams();
  // The settings for this register (columns, filters, form) from lib/registers.js.
  const reg = REGISTERS[type];
  const { can, lookups, me } = useAuth();
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(params.get('status') || '');
  const [sub, setSub] = useState('');
  const [officer, setOfficer] = useState('');
  const [inactive, setInactive] = useState(false);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  // When switching to another register, reset the search and read the status from the address.
  useEffect(() => { setStatus(params.get('status') || ''); setQ(''); }, [type]); // eslint-disable-line
  // Filters sent to the API. Ticking "Deactivated" shows only deactivated entries.
  const query = { q, status, sub_location: sub, officer_id: officer, active: inactive ? '0' : '' };
  const { data, loading, reload } = useLoad(() => api(`/registers/${type}${qs(query)}`), [type, JSON.stringify(query), me.ward?.id]);
  // List of sub locations for the filter.
  const subs = [...new Set(lookups.locations.map((l) => l.sub_location))];
  if (!reg) return <ErrorNote error="Unknown register." />;

  return (
    <div>
      <PageHeader title={reg.label} subtitle="Searchable registers of premises, food handlers, schools, health facilities, water sources, households, complaints, events and more in your ward."
        actions={can.write && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add {reg.singular.toLowerCase()}</Button>} />
      {/* One tab per register. */}
      {/* Register menu, grouped. On phones a drop down is shown instead. */}
      <div className="mb-4 sm:hidden"><select className="input" value={type} onChange={(e) => nav(`/registers/${e.target.value}`)}>
        {REGISTER_GROUPS.map(([g, keys]) => <optgroup key={g} label={g}>{keys.map((k) => <option key={k} value={k}>{REGISTERS[k].label}</option>)}</optgroup>)}
      </select></div>
      <div className="mb-4 hidden flex-wrap gap-x-5 gap-y-2 border-b border-line pb-3 sm:flex">
        {REGISTER_GROUPS.map(([g, keys]) => (
          <div key={g}>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{g}</div>
            <div className="flex flex-wrap gap-1">
              {keys.map((k) => <button key={k} onClick={() => nav(`/registers/${k}`)} className={`rounded-lg px-2.5 py-1 text-[13px] font-semibold transition ${k === type ? 'bg-brand-700 text-white' : 'text-ink-soft hover:bg-paper'}`}>{REGISTERS[k].label}</button>)}
            </div>
          </div>
        ))}
      </div>
      {/* Search box and filters. */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_180px_180px_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input className="pl-9" placeholder={`Search ${reg.label.toLowerCase()} by name or code…`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {reg.statusOptions?.length ? <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Any status" options={reg.statusOptions} /> : <div className="hidden lg:block" />}
        {reg.columns.some((c) => c.key === 'sub_location') ? <Select value={sub} onChange={(e) => setSub(e.target.value)} placeholder="All sub locations" options={subs} /> : <div className="hidden lg:block" />}
        {type !== 'handler' ? <Select value={officer} onChange={(e) => setOfficer(e.target.value)} placeholder="Any officer" options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} /> : <div className="hidden lg:block" />}
        <label className="flex items-center gap-2 whitespace-nowrap px-1 text-sm text-ink-soft"><input type="checkbox" className="accent-brand-700" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />Deactivated</label>
      </div>
      {/* The register table. Clicking a row opens the record's profile. */}
      {loading && !data ? <Spinner /> : (
        <Card className="overflow-hidden">
          {data.length === 0 ? <Empty title={`No ${reg.label.toLowerCase()} found`}>{q || status ? 'Try a different search or filter.' : `Add the first ${reg.singular.toLowerCase()} for this ward.`}</Empty> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr>{reg.columns.map((c, i) => <th key={c.key} className={i > 2 ? 'hidden md:table-cell' : ''}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {data.map((row) => (
                    <tr key={row.id} className="clickable" onClick={() => nav(`/registers/${type}/${row.id}`)}>
                      {reg.columns.map((c, i) => <td key={c.key} className={`${i === 0 ? 'font-semibold' : ''} ${i > 2 ? 'hidden md:table-cell' : ''}`}><Cell col={c} row={row} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {/* Pop up to add a new entry. After saving, its profile opens. */}
      <RegisterForm type={type} open={open} onClose={() => setOpen(false)} onSaved={(id) => id ? nav(`/registers/${type}/${id}`) : reload()} />
    </div>
  );
}

// Pop up form to add or edit a register entry. The fields come from the register settings.
export function RegisterForm({ type, open, onClose, onSaved, record }) {
  const reg = REGISTERS[type];
  const { lookups } = useAuth();
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState(null);
  const toast = useToast();
  // Each time the form opens, fill it with the record being edited, or with empty values.
  useEffect(() => {
    if (!open) return;
    const init = {};
    for (const fld of reg.form) if (fld.key) init[fld.key] = record ? record[fld.key] ?? '' : fld.options && fld.options[0] === 'unknown' ? 'unknown' : '';
    setF(init); setErrors({}); setErr(null); setDups(null);
  }, [open, type, record]); // eslint-disable-line
  // Saves the form. confirmDup = true is sent after the user confirms a possible duplicate.
  const save = async (confirmDup = false) => {
    const missing = {};
    // Required fields are checked here first so the user gets instant feedback.
    for (const fld of reg.form) if (fld.required && !String(f[fld.key] || '').trim()) missing[fld.key] = `${fld.label} is required so the record can be identified.`;
    if (Object.keys(missing).length) return setErrors(missing);
    setBusy(true); setErr(null);
    const body = { ...f };
    // When editing, send only the fields that changed.
    if (record) for (const k of Object.keys(body)) if (String(body[k] ?? '') === String(record[k] ?? '')) delete body[k];
    try {
      if (record) { await api(`/registers/${type}/${record.id}`, { method: 'PATCH', body }); toast('Saved'); onSaved?.(); }
      else { const r = await api(`/registers/${type}`, { method: 'POST', body: { ...body, confirm_duplicate: confirmDup } }); toast(`${reg.singular} added`); onSaved?.(r.id); }
      onClose();
    } catch (e) {
      // 409 means a similar record exists: show the duplicate warning instead of an error.
      if (e.status === 409 && e.body?.duplicates) setDups(e.body.duplicates);
      else { setErr(errorText(e)); setErrors(e.errors || {}); }
    } finally { setBusy(false); }
  };
  // Draws the right input for a field: drop down, location, officer, premises, text box, date or text.
  const input = (fld) => {
    const v = f[fld.key] ?? '';
    const on = (e) => setF({ ...f, [fld.key]: e.target.value });
    if (fld.options) return <Select value={v} onChange={on} placeholder={fld.options[0] === 'unknown' ? undefined : 'Choose…'} options={fld.options} error={errors[fld.key]} />;
    if (fld.type === 'location') return <Select value={v} onChange={on} placeholder="Not specified" options={lookups.locations.map((l) => ({ value: l.id, label: locationLabel(l) }))} />;
    if (fld.type === 'officer') return <Select value={v} onChange={on} placeholder="Not assigned" options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} />;
    if (fld.type === 'premises') return <Select value={v} onChange={on} placeholder="Not linked" options={lookups.premises.map((p) => ({ value: p.id, label: p.name }))} />;
    if (fld.type === 'textarea') return <Textarea rows={2} value={v} onChange={on} />;
    if (fld.type === 'checkbox') return <label className="flex h-[42px] items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={!!Number(v)} onChange={(e) => setF({ ...f, [fld.key]: e.target.checked ? 1 : 0 })} />Yes</label>;
    if (fld.type === 'number') return <Input type="number" min="0" value={v} onChange={on} error={errors[fld.key]} />;
    return <Input type={fld.type === 'date' ? 'date' : 'text'} value={v} onChange={on} error={errors[fld.key]} />;
  };
  return (
    <Modal open={open} onClose={onClose} title={record ? `Edit ${reg.singular.toLowerCase()}` : `Add ${reg.singular.toLowerCase()}`} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save(false)} loading={busy}>Save</Button></>}>
      <ErrorNote error={err} />
      {/* Duplicate warning with links to the similar records and a "save anyway" button. */}
      {dups && (
        <div className="mb-4 rounded-lg border border-ochre-100 bg-ochre-50 p-3 text-sm text-ochre-700">
          <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Possible duplicate</div>
          <p className="mb-2">A record with a similar name already exists in this ward:</p>
          <ul className="mb-3 list-disc pl-5">{dups.map((d) => <li key={d.id}><Link className="underline" to={`/registers/${type}/${d.id}`} onClick={onClose}>{d.name}</Link></li>)}</ul>
          <Button size="sm" variant="accent" onClick={() => save(true)} loading={busy}>It is different, save anyway</Button>
        </div>
      )}
      {/* The form fields. Section entries draw a small heading instead of a field. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {reg.form.map((fld, i) => fld.section ? (
          <div key={i} className="border-t border-line pt-3 sm:col-span-2">
            <div className="text-sm font-bold">{fld.section}</div>{fld.hint && <div className="text-[12px] text-ink-faint">{fld.hint}</div>}
          </div>
        ) : (
          <Field key={fld.key} label={fld.label} required={fld.required} error={errors[fld.key]} hint={fld.hint} className={fld.type === 'textarea' ? 'sm:col-span-2' : ''}>{input(fld)}</Field>
        ))}
      </div>
    </Modal>
  );
}

// Profile page of one register entry, with its details and full history.
export function RegisterProfile() {
  const { type, id } = useParams();
  const reg = REGISTERS[type];
  const { can, lookups } = useAuth();
  const { data, loading, error, reload } = useLoad(() => api(`/registers/${type}/${id}`), [type, id]);
  const [modal, setModal] = useState(null);
  const nav = useNavigate();
  const toast = useToast();
  // The fields shown in the details box (everything except long text).
  const facts = useMemo(() => reg?.form.filter((f) => f.key && f.type !== 'textarea') || [], [reg]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const r = data.record;
  const name = r[reg.nameField];

  // Shows a field value in readable form (location name, officer name, formatted date, badge).
  const display = (fld) => {
    const v = r[fld.key];
    if (fld.type === 'location') return data.location ? locationLabel(data.location) : '—';
    if (fld.type === 'premises') return data.premises ? <Link className="text-brand-700 hover:underline" to={`/registers/premises/${data.premises.id}`}>{data.premises.premises_name}</Link> : '—';
    if (fld.type === 'officer') return v ? (lookups.officers.find((o) => o.id === v)?.full_name || `Officer #${v}`) : '—';
    if (fld.type === 'date') {
      const exp = /expiry/.test(fld.key) && v && v < todayStr();
      return <span className={exp ? 'font-semibold text-red-600' : ''}>{fmtDate(v)}{exp ? ' (expired)' : ''}{/expiry/.test(fld.key) && !v ? ' (not recorded)' : ''}</span>;
    }
    if (fld.type === 'checkbox') return Number(v) ? 'Yes' : 'No';
    if (fld.options) return <Badge status={v || 'unknown'} />;
    return v || '—';
  };
  // Deactivate or reactivate the record (ward lead only). The history is kept.
  const toggleActive = async () => {
    if (!confirm(r.active ? 'Deactivate this record? History is kept and it can be reactivated.' : 'Reactivate this record?')) return;
    try { await api(`/registers/${type}/${id}`, { method: 'PATCH', body: { active: !r.active } }); toast('Updated'); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <Link to={`/registers/${type}`} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4" />{reg.label}</Link>
      {/* Title with the actions available for this register type. */}
      <PageHeader eyebrow={reg.singular} title={<span className="flex flex-wrap items-center gap-2">{name}{!r.active && <Badge tone="gray">Deactivated</Badge>}</span>}
        actions={can.write && <>
          {reg.inspectable !== false && <Button onClick={() => nav(`/inspections/new?entity_type=${type}&entity_id=${id}`)}><Search className="h-4 w-4" />{reg.inspectLabel || 'Start inspection'}</Button>}
          {type === 'water_source' && <Button variant="secondary" onClick={() => setModal('sample')}><FlaskConical className="h-4 w-4" />Log sample</Button>}
          <Button variant="secondary" onClick={() => setModal('task')}><CalendarPlus className="h-4 w-4" />Task</Button>
          <Button variant="secondary" onClick={() => setModal('followup')}><BellPlus className="h-4 w-4" />Follow up</Button>
          {!['handler', 'equipment', 'cpd'].includes(type) && <Button variant="secondary" onClick={() => setModal('notice')}><FileText className="h-4 w-4" />Draft notice</Button>}
          <Button variant="ghost" onClick={() => setModal('edit')}><Pencil className="h-4 w-4" />Edit</Button>
          {can.lead && <Button variant="ghost" onClick={toggleActive}><Power className="h-4 w-4" />{r.active ? 'Deactivate' : 'Reactivate'}</Button>}
        </>} />

      {/* Left column: details, food handlers (for premises) and change history. */}
      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-5">
          <Card className="p-5">
            <dl className="grid grid-cols-2 gap-x-5 gap-y-3.5 text-sm">
              {facts.map((fld) => <div key={fld.key}><dt className="label">{fld.label}</dt><dd>{display(fld)}</dd></div>)}
            </dl>
            {r.notes && <div className="mt-4 border-t border-line pt-3 text-sm"><div className="label">Notes</div><p className="whitespace-pre-wrap">{r.notes}</p></div>}
          </Card>
          {data.handlers && (
            <Card>
              <div className="border-b border-line px-4 py-3 font-bold">Food handlers ({data.handlers.length})</div>
              {data.handlers.length === 0 ? <div className="px-4 py-5 text-sm text-ink-faint">No handlers linked.</div> : data.handlers.map((h) => (
                <Link key={h.id} to={`/registers/handler/${h.id}`} className="flex items-center justify-between border-b border-line/70 px-4 py-2.5 text-sm last:border-0 hover:bg-paper">
                  <span className="font-medium">{h.name}</span>
                  <span className={h.certificate_expiry && h.certificate_expiry < todayStr() ? 'text-red-600' : 'text-ink-soft'}>{h.certificate_expiry ? `Cert. ${fmtDate(h.certificate_expiry)}` : 'Expiry not recorded'}</span>
                </Link>
              ))}
            </Card>
          )}
          <Card>
            <div className="border-b border-line px-4 py-3 font-bold">Change history</div>
            <div className="max-h-72 overflow-y-auto">
              {data.history.length === 0 ? <div className="px-4 py-5 text-sm text-ink-faint">No changes logged.</div> : data.history.map((h, i) => (
                <div key={i} className="border-b border-line/60 px-4 py-2 text-[13px] last:border-0">
                  <b>{h.full_name || 'System'}</b> {humanize(h.action).toLowerCase()} <span className="text-ink-faint">· {fmtDateTime(h.at)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right column: water samples, inspections, follow ups, tasks and notices. */}
        <div className="space-y-5">
          {data.samples && <SamplesCard samples={data.samples} sourceId={id} reload={reload} canWrite={can.write} openNew={modal === 'sample'} closeNew={() => setModal(null)} />}
          <Card>
            <div className="border-b border-line px-4 py-3 font-bold">{type === 'household' ? 'Visit history' : 'Inspection history'} ({data.inspections.length})</div>
            {data.inspections.length === 0 ? <div className="px-4 py-5 text-sm text-ink-faint">No inspections recorded yet. Each inspection is kept as a separate dated record.</div> : data.inspections.map((i) => (
              <Link key={i.id} to={`/inspections/${i.id}`} className="flex items-center gap-3 border-b border-line/70 px-4 py-3 last:border-0 hover:bg-paper">
                <div className="w-24 flex-none text-sm font-semibold">{fmtDate(i.inspection_date)}</div>
                <div className="min-w-0 flex-1"><div className="truncate text-sm">{i.outcome || 'No outcome recorded'}</div><div className="text-[12px] text-ink-faint">{i.officer_name} · {i.finding_count} finding(s)</div></div>
                <Badge status={i.risk_level} />
              </Link>
            ))}
          </Card>
          <Card>
            <div className="border-b border-line px-4 py-3 font-bold">Follow ups ({data.followUps.length})</div>
            {data.followUps.length === 0 ? <div className="px-4 py-5 text-sm text-ink-faint">No follow ups.</div> : data.followUps.map((f) => (
              <div key={f.id} className="flex items-start gap-3 border-b border-line/70 px-4 py-3 last:border-0">
                <div className="min-w-0 flex-1"><div className="text-sm font-medium">{f.action_required}</div><div className="text-[12px] text-ink-faint">{f.responsible_name} · due {fmtDate(f.due_date)}{f.outcome ? ` · ${humanize(f.outcome)}` : ''}</div></div>
                <Badge status={f.status === 'open' && f.due_date < todayStr() ? 'overdue' : f.status} />
              </div>
            ))}
          </Card>
          {data.activities?.length > 0 && (
            <Card>
              <div className="border-b border-line px-4 py-3 font-bold">Activities ({data.activities.length})</div>
              {data.activities.map((a) => (
                <div key={a.id} className="flex items-center gap-3 border-b border-line/70 px-4 py-2.5 text-sm last:border-0">
                  <div className="w-24 flex-none font-semibold">{fmtDate(a.activity_date)}</div>
                  <div className="min-w-0 flex-1"><div className="truncate">{a.category}</div><div className="text-[12px] text-ink-faint">{a.recorded_by_name}{a.outcome ? ` · ${a.outcome}` : ''}</div></div>
                </div>
              ))}
            </Card>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <Card>
              <div className="border-b border-line px-4 py-3 font-bold">Tasks</div>
              {data.tasks.length === 0 ? <div className="px-4 py-5 text-sm text-ink-faint">None.</div> : data.tasks.map((t) => (
                <Link key={t.id} to={`/planner/${t.id}`} className="block border-b border-line/70 px-4 py-2.5 text-sm last:border-0 hover:bg-paper">
                  <div className="font-medium">{t.title}</div><div className="flex justify-between text-[12px] text-ink-faint"><span>{fmtDate(t.due_at)}</span><span>{humanize(t.status)}</span></div>
                </Link>
              ))}
            </Card>
            <Card>
              <div className="border-b border-line px-4 py-3 font-bold">Notices</div>
              {data.notices.length === 0 ? <div className="px-4 py-5 text-sm text-ink-faint">None.</div> : data.notices.map((n) => (
                <Link key={n.id} to={`/notices/${n.id}`} className="flex items-center justify-between border-b border-line/70 px-4 py-2.5 text-sm last:border-0 hover:bg-paper">
                  <span className="font-mono text-[12px]">{n.draft_reference}</span><Badge status={n.status} />
                </Link>
              ))}
            </Card>
          </div>
        </div>
      </div>

      {/* Photos and documents for this record (evidence, licences, certificates). */}
      <div className="mt-5"><Attachments type={type} id={Number(id)} canWrite={can.write} /></div>
      {/* Pop ups opened by the action buttons, prefilled for this record. */}
      <RegisterForm type={type} open={modal === 'edit'} onClose={() => setModal(null)} onSaved={reload} record={r} />
      <TaskForm open={modal === 'task'} onClose={() => setModal(null)} onSaved={reload} preset={{ title: `Visit: ${name}`, linked_entity_type: type, linked_entity_id: Number(id), location_id: r.location_id || '' }} />
      <FollowUpForm open={modal === 'followup'} onClose={() => setModal(null)} onSaved={reload} preset={{ linked_entity_type: type, linked_entity_id: Number(id) }} />
      <NoticeForm open={modal === 'notice'} onClose={() => setModal(null)} preset={{ linked_entity_type: type, linked_entity_id: Number(id), recipient: r.owner_name || r.manager_name || r.operator_name || r.responsible_party || '' }} onCreated={(nid) => nav(`/notices/${nid}`)} />
    </div>
  );
}

// Water samples table on a water source profile.
function SamplesCard({ samples, sourceId, reload, canWrite, openNew, closeNew }) {
  const [edit, setEdit] = useState(null);
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-3"><span className="font-bold">Water samples ({samples.length})</span><span className="text-[12px] text-ink-faint">Pending results are never treated as compliant</span></div>
      {samples.length === 0 ? <div className="px-4 py-5 text-sm text-ink-faint">No samples logged.</div> : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Collected</th><th>Reference</th><th>Stage</th><th>Result</th><th>Status</th><th>Next action</th><th></th></tr></thead>
            <tbody>
              {samples.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap">{fmtDate(s.collection_date)}</td>
                  <td className="font-mono text-[12px]">{s.sample_reference || '—'}{s.tests_requested && <div className="font-sans text-[11px] text-ink-faint">{s.tests_requested}</div>}</td>
                  <td><Badge tone="blue">{humanize(s.stage || 'collected')}</Badge></td>
                  <td>{s.result || <span className="text-ink-faint">Awaiting</span>}{s.result_date && <div className="text-[11px] text-ink-faint">{fmtDate(s.result_date)}</div>}</td>
                  <td><Badge status={s.compliance_status} /></td>
                  <td className={s.next_action_due && s.next_action_due < todayStr() ? 'font-semibold text-red-600' : ''}>{fmtDate(s.next_action_due)}</td>
                  <td>{canWrite && <button className="text-[13px] font-semibold text-brand-700 hover:underline" onClick={() => setEdit(s)}>Update</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SampleForm open={openNew || !!edit} sample={edit} sourceId={sourceId} onClose={() => { setEdit(null); closeNew(); }} onSaved={reload} />
    </Card>
  );
}

// Pop up to log a new water sample or add the lab result to an existing one.
function SampleForm({ open, sample, sourceId, onClose, onSaved }) {
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const toast = useToast();
  // New samples start as "pending result" until the lab result arrives.
  useEffect(() => {
    if (open) setF(sample ? { ...sample, stage: sample.stage || 'collected' } : { collection_date: todayStr(), sample_time: '', stage: 'collected', sample_reference: '', tests_requested: 'E. coli, total coliforms', laboratory: 'County Public Health Laboratory', dispatch_date: '', lab_received_date: '', chain_of_custody: '', result: '', compliance_status: 'pending_result', result_date: '', action_taken: '', next_action_due: '' });
    setErrors({}); setErr(null);
  }, [open, sample]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  // Send the sample to the API: update an existing one or create a new one.
  const save = async () => {
    setBusy(true); setErr(null);
    const keys = ['collection_date', 'sample_time', 'stage', 'sample_reference', 'tests_requested', 'laboratory', 'dispatch_date', 'lab_received_date', 'chain_of_custody', 'result', 'compliance_status', 'result_date', 'action_taken', 'next_action_due'];
    const body = Object.fromEntries(keys.map((k) => [k, f[k] ?? '']));
    try {
      if (sample) await api(`/samples/${sample.id}`, { method: 'PATCH', body });
      else await api(`/registers/water_source/${sourceId}/samples`, { method: 'POST', body });
      toast('Sample saved'); onSaved(); onClose();
    } catch (e) { setErr(errorText(e)); setErrors(e.errors || {}); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={sample ? 'Update sample / result' : 'Log water sample'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <ErrorNote error={err} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Stage" error={errors.stage} className="sm:col-span-2"><Select value={f.stage || 'collected'} onChange={set('stage')} options={['planned', 'collected', 'dispatched', 'received_by_lab', 'result_pending', 'result_received', 'action_recorded']} /></Field>
        <Field label={f.stage === 'planned' ? 'Planned collection date' : 'Collection date'} required error={errors.collection_date}><Input type="date" max={f.stage === 'planned' ? undefined : todayStr()} value={f.collection_date || ''} onChange={set('collection_date')} /></Field>
        <Field label="Collection time"><Input type="time" value={f.sample_time || ''} onChange={set('sample_time')} /></Field>
        <Field label="Sample ID / reference"><Input value={f.sample_reference || ''} onChange={set('sample_reference')} /></Field>
        <Field label="Tests requested"><Input value={f.tests_requested || ''} onChange={set('tests_requested')} /></Field>
        <Field label="Laboratory" className="sm:col-span-2"><Input value={f.laboratory || ''} onChange={set('laboratory')} /></Field>
        <Field label="Dispatched to lab" error={errors.dispatch_date}><Input type="date" value={f.dispatch_date || ''} onChange={set('dispatch_date')} /></Field>
        <Field label="Received by lab"><Input type="date" value={f.lab_received_date || ''} onChange={set('lab_received_date')} /></Field>
        <Field label="Transport and chain of custody" className="sm:col-span-2"><Input value={f.chain_of_custody || ''} onChange={set('chain_of_custody')} placeholder="e.g. Cool box, handed to lab clerk J. Mwangi" /></Field>
        <Field label="Result" className="sm:col-span-2" hint="Leave blank until the lab result is received."><Input value={f.result || ''} onChange={set('result')} placeholder="e.g. E. coli 0 cfu/100ml" /></Field>
        <Field label="Result date" error={errors.result_date}><Input type="date" value={f.result_date || ''} onChange={set('result_date')} /></Field>
        <Field label="Compliance status" error={errors.compliance_status}><Select value={f.compliance_status || 'pending_result'} onChange={set('compliance_status')} options={['pending_result', 'compliant', 'non_compliant', 'unknown']} /></Field>
        <Field label="Action taken" error={errors.action_taken} className="sm:col-span-2" hint="Notification, repeat sampling or corrective action. No automatic safety conclusion is made."><Textarea rows={2} value={f.action_taken || ''} onChange={set('action_taken')} /></Field>
        <Field label="Next action due" className="sm:col-span-2"><Input type="date" value={f.next_action_due || ''} onChange={set('next_action_due')} /></Field>
      </div>
    </Modal>
  );
}
