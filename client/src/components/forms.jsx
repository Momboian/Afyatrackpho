// Shared forms and helpers used on several pages: data loading, record links, category forms, team pickers,
// attachments, and the task, follow up and notice forms.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Paperclip, Trash2, FileText, Upload } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { toLocalInput, fromLocalInput, todayStr, addDays, ENTITY_LABEL, PURPOSES, PILLARS, humanize, fmtDateTime } from '../lib/format.js';
import { Modal, Button, Field, Input, Select, Textarea, ErrorNote, useToast, Card } from './ui.jsx';
import { REGISTER_KEYS, REGISTERS } from '../lib/registers.js';

// Loads data when a page opens (and again when deps change).
// Returns { loading, data, error, reload }. Example: const { data } = useLoad(() => api('/tasks'), []);
export function useLoad(fn, deps = []) {
  const [state, set] = useState({ loading: true, data: null, error: null });
  const reload = () => {
    set((s) => ({ ...s, loading: true }));
    return fn().then((data) => set({ loading: false, data, error: null })).catch((error) => set({ loading: false, data: null, error }));
  };
  useEffect(() => { reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload };
}

// The officer to preselect in forms: the signed in user when they are an officer in this ward,
// otherwise (for example a System Administrator) the first officer of the ward.
export const defaultOfficer = (me, lookups) => (lookups.officers.some((o) => o.id === me.user.id) ? me.user.id : lookups.officers[0]?.id ?? '');
// Joins the main error message with the individual field errors, so problems below the screen are not missed.
export const errorText = (e) => [e.message, ...Object.values(e.errors || {}).filter((m) => m !== e.message)].join(' ');

// Shows a location as "Village, Sub location".
export const locationLabel = (l) => (l ? [l.village, l.sub_location].filter(Boolean).join(', ') : '');

// Link to a register entry's profile page, for example a premises or a school.
export function EntityLink({ type, id, name }) {
  if (!type || !id) return <span className="text-ink-faint">—</span>;
  return (
    <Link to={`/registers/${type}/${id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
      {name || `${ENTITY_LABEL[type] || humanize(type)} #${id}`}
    </Link>
  );
}

// Two drop downs: first the record type (premises, school, household ...), then the record itself.
export function EntityPicker({ type, id, onChange, error, allowNone = true, types = REGISTER_KEYS }) {
  const [rows, setRows] = useState([]);
  // Load the records of the chosen type whenever the type changes.
  useEffect(() => {
    if (!type) { setRows([]); return; }
    api(`/registers/${type}`).then(setRows).catch(() => setRows([]));
  }, [type]);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Linked record type">
        <Select value={type || ''} onChange={(e) => onChange(e.target.value || null, null)} placeholder={allowNone ? 'None' : 'Choose…'}
          options={types.map((k) => ({ value: k, label: REGISTERS[k].singular }))} />
      </Field>
      <Field label="Record" error={error}>
        <Select value={id || ''} onChange={(e) => onChange(type, e.target.value ? Number(e.target.value) : null)} disabled={!type} placeholder="Choose…"
          options={rows.map((r) => ({ value: r.id, label: r[REGISTERS[type].nameField] }))} error={error} />
      </Field>
    </div>
  );
}

// Category drop down grouped by public health pillar (A Sanitary inspections, B Food hygiene ...).
export function CategorySelect({ value, onChange, categories, placeholder = 'Choose…', error, onlyActive = true }) {
  const list = categories.filter((c) => !onlyActive || c.active || c.id === Number(value));
  const groups = Object.keys(PILLARS).map((p) => [p, list.filter((c) => c.pillar === p)]).filter(([, cs]) => cs.length);
  return (
    <select className={`input pr-8 ${error ? 'input-error' : ''}`} value={value || ''} onChange={onChange}>
      <option value="">{placeholder}</option>
      {groups.map(([p, cs]) => (
        <optgroup key={p} label={`${p}. ${PILLARS[p]}`}>
          {cs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

// Draws the extra fields of an activity category (its configurable form).
// values holds the answers, errors holds server errors named like "details.topic".
export function DynamicFields({ form = [], values = {}, onChange, errors = {} }) {
  if (!form.length) return null;
  const set = (k, v) => onChange({ ...values, [k]: v });
  return (
    <div className="grid gap-4 rounded-lg border border-line bg-paper/50 p-3 sm:grid-cols-2">
      {form.map((f) => {
        const err = errors[`details.${f.key}`];
        const v = values[f.key] ?? '';
        const wide = f.type === 'textarea' ? 'sm:col-span-2' : '';
        if (f.type === 'checkbox') return (
          <label key={f.key} className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={!!v} onChange={(e) => set(f.key, e.target.checked ? 1 : 0)} />{f.label}</label>
        );
        return (
          <Field key={f.key} label={f.label} required={f.required} error={err} className={wide}>
            {f.type === 'select' ? <Select value={v} onChange={(e) => set(f.key, e.target.value)} placeholder="Choose…" options={(f.options || []).map((o) => ({ value: o, label: o }))} error={err} />
              : f.type === 'textarea' ? <Textarea rows={2} value={v} onChange={(e) => set(f.key, e.target.value)} />
              : <Input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} min={f.type === 'number' ? 0 : undefined} value={v} error={err}
                  onChange={(e) => set(f.key, f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />}
          </Field>
        );
      })}
    </div>
  );
}

// Tick boxes for choosing several officers (for example the team on a task or inspection).
export function OfficerMultiSelect({ value = [], onChange, officers, exclude = [] }) {
  const list = officers.filter((o) => !exclude.includes(o.id));
  if (!list.length) return <div className="text-[13px] text-ink-faint">No other officers in this ward.</div>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((o) => {
        const on = value.includes(o.id);
        return (
          <button key={o.id} type="button" onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}
            className={`rounded-full border px-2.5 py-1 text-[13px] font-semibold transition ${on ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-line text-ink-soft hover:bg-paper'}`}>
            {on ? '✓ ' : ''}{o.full_name}
          </button>
        );
      })}
    </div>
  );
}

// Pop up form to create a new task or edit an existing one.
export function TaskForm({ open, onClose, onSaved, task, preset = {} }) {
  const { me, can, lookups } = useAuth();
  // Empty form values. By default the task is due tomorrow at 09:00 and assigned to the current user.
  const blank = () => ({
    title: '', description: '', category_id: '', assigned_to: defaultOfficer(me, lookups), due_at: toLocalInput(new Date(Date.now() + 86400000).toISOString()).slice(0, 11) + '09:00',
    reminder_at: '', priority: 'normal', purpose: 'routine', venue: '', expected_output: '', team_ids: [], location_id: '',
    linked_entity_type: null, linked_entity_id: null, notes: '', ...preset
  });
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Each time the form opens, fill it with the task being edited, or with the empty values.
  useEffect(() => {
    if (!open) return;
    setErrors({}); setErr(null);
    setF(task ? { ...task, due_at: toLocalInput(task.due_at), reminder_at: toLocalInput(task.reminder_at), category_id: task.category_id || '', location_id: task.location_id || '', team_ids: task.team_ids || [] } : blank());
  }, [open, task]); // eslint-disable-line react-hooks/exhaustive-deps
  // Returns a change handler for one field, for example onChange={set('title')}.
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Checks the form, sends it to the API and shows the server's field errors if any.
  // asDraft keeps a new task as a private draft that is not yet planned.
  const save = async (asDraft = false) => {
    const localErr = {};
    if (!f.title.trim()) localErr.title = 'Give the task a short title.';
    if (!f.due_at) localErr.due_at = 'Choose when the task is due.';
    if (Object.keys(localErr).length) return setErrors(localErr);
    setBusy(true); setErr(null);
    // Convert the form values to what the API expects (numbers, ISO times, null for empty).
    const body = {
      title: f.title, description: f.description, category_id: f.category_id || null, assigned_to: Number(f.assigned_to),
      due_at: fromLocalInput(f.due_at), reminder_at: fromLocalInput(f.reminder_at), priority: f.priority, purpose: f.purpose || null,
      venue: f.venue, expected_output: f.expected_output, team_ids: f.team_ids || [], location_id: f.location_id || null,
      linked_entity_type: f.linked_entity_type || null, linked_entity_id: f.linked_entity_id || null, notes: f.notes,
      ...(asDraft ? { save_as_draft: true } : {})
    };
    try {
      if (task) await api(`/tasks/${task.id}`, { method: 'PATCH', body: task.status === 'draft' && !asDraft ? { ...body, status: Number(f.assigned_to) === me.user.id ? 'planned' : 'assigned' } : body });
      else await api('/tasks', { method: 'POST', body });
      toast(asDraft ? 'Saved as draft' : task ? 'Task updated' : 'Task created');
      onSaved?.(); onClose();
    } catch (e) { setErr(errorText(e)); setErrors(e.errors || {}); } finally { setBusy(false); }
  };

  const isDraft = !task || task.status === 'draft';
  return (
    <Modal open={open} onClose={onClose} title={task ? (task.status === 'draft' ? 'Edit draft task' : 'Edit task') : 'New task'} wide
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        {isDraft && <Button variant="secondary" onClick={() => save(true)} loading={busy}>Save draft</Button>}
        <Button onClick={() => save(false)} loading={busy}>{task ? (task.status === 'draft' ? 'Plan task' : 'Save changes') : 'Create task'}</Button>
      </>}>
      {/* Error message from the server, if any. */}
      <ErrorNote error={err} />
      {/* The form fields. */}
      <div className="grid gap-4">
        <Field label="Title" required error={errors.title}><Input value={f.title} onChange={set('title')} placeholder="e.g. Inspect Kinondo market" autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Activity category" error={errors.category_id} hint="Needed for the work to count in reports.">
            <CategorySelect value={f.category_id} onChange={set('category_id')} categories={lookups.categories} />
          </Field>
          <Field label="Purpose"><Select value={f.purpose || ''} onChange={set('purpose')} options={PURPOSES} /></Field>
          <Field label="Assigned officer" error={errors.assigned_to} hint={can.lead ? '' : 'Only the ward lead can assign to others.'}>
            <Select value={f.assigned_to} onChange={set('assigned_to')} disabled={!can.lead} options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} />
          </Field>
          <Field label="Priority"><Select value={f.priority} onChange={set('priority')} options={['low', 'normal', 'high']} /></Field>
          <Field label="Due date and time" required error={errors.due_at}><Input type="datetime-local" value={f.due_at} onChange={set('due_at')} /></Field>
          <Field label="Reminder" error={errors.reminder_at} hint="In app reminder at this time (Nairobi time)."><Input type="datetime-local" value={f.reminder_at || ''} onChange={set('reminder_at')} /></Field>
          <Field label="Location" error={errors.location_id}>
            <Select value={f.location_id} onChange={set('location_id')} placeholder="Not specified" options={lookups.locations.map((l) => ({ value: l.id, label: locationLabel(l) }))} />
          </Field>
          <Field label="Venue"><Input value={f.venue || ''} onChange={set('venue')} placeholder="e.g. Chief's camp" /></Field>
        </div>
        {can.lead && (
          <Field label="Team (other officers working on this task)" error={errors.team_ids}>
            <OfficerMultiSelect value={f.team_ids || []} onChange={(v) => setF({ ...f, team_ids: v })} officers={lookups.officers} exclude={[Number(f.assigned_to)]} />
          </Field>
        )}
        <EntityPicker type={f.linked_entity_type} id={f.linked_entity_id} error={errors.linked_entity_id}
          onChange={(t, i) => setF({ ...f, linked_entity_type: t, linked_entity_id: i })} />
        <Field label="Expected output"><Input value={f.expected_output || ''} onChange={set('expected_output')} placeholder="e.g. 10 households visited" /></Field>
        <Field label="Description"><Textarea value={f.description || ''} onChange={set('description')} rows={3} /></Field>
      </div>
    </Modal>
  );
}

// Pop up form to create a follow up action. Defaults: assigned to me and due in 7 days.
export function FollowUpForm({ open, onClose, onSaved, preset = {} }) {
  const { me, lookups } = useAuth();
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Reset the form each time it opens.
  useEffect(() => {
    if (open) { setF({ action_required: '', responsible_user_id: defaultOfficer(me, lookups), responsible_party: '', due_date: addDays(todayStr(), 7), linked_entity_type: null, linked_entity_id: null, ...preset }); setErrors({}); setErr(null); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Send the follow up to the API.
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api('/follow-ups', { method: 'POST', body: f }); toast('Follow up created'); onSaved?.(); onClose(); }
    catch (e) { setErr(errorText(e)); setErrors(e.errors || {}); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New follow up"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Create follow up</Button></>}>
      <ErrorNote error={err} />
      <div className="grid gap-4">
        <Field label="Action required" required error={errors.action_required}><Textarea rows={2} value={f.action_required || ''} onChange={(e) => setF({ ...f, action_required: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Responsible officer" required error={errors.responsible_user_id}>
            <Select value={f.responsible_user_id || ''} onChange={(e) => setF({ ...f, responsible_user_id: Number(e.target.value) })} options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} />
          </Field>
          <Field label="Due date" required error={errors.due_date}><Input type="date" value={f.due_date || ''} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label="Responsible party (owner, manager ...)" className="sm:col-span-2"><Input value={f.responsible_party || ''} onChange={(e) => setF({ ...f, responsible_party: e.target.value })} /></Field>
        </div>
        {/* Show the record picker only when the follow up is not already linked to a record. */}
        {!preset.linked_entity_type && <EntityPicker type={f.linked_entity_type} id={f.linked_entity_id} error={errors.linked_entity_id} onChange={(t, i) => setF({ ...f, linked_entity_type: t, linked_entity_id: i })} />}
      </div>
    </Modal>
  );
}

// Pop up form to draft a notice from an approved template. Default compliance deadline is 14 days.
export function NoticeForm({ open, onClose, preset = {}, onCreated }) {
  const { lookups } = useAuth();
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setF({ template_id: lookups.templates[0]?.id || '', notice_type: 'intimation', legal_provision: '', recipient: '', findings: '', corrective_action: '', compliance_deadline: addDays(todayStr(), 14), linked_entity_type: null, linked_entity_id: null, ...preset }); setErrors({}); setErr(null); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  // Create the draft and open it.
  const save = async () => {
    setBusy(true); setErr(null);
    try { const r = await api('/notices', { method: 'POST', body: f }); onCreated?.(r.id); onClose(); }
    catch (e) { setErr(errorText(e)); setErrors(e.errors || {}); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Draft a notice" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Generate draft</Button></>}>
      {/* Reminder that this only creates a draft. */}
      <div className="mb-4 rounded-lg border border-ochre-100 bg-ochre-50 px-3 py-2.5 text-[13px] text-ochre-700">
        This creates a <b>draft</b> from an approved template. It must be submitted and approved by the ward lead before it is issued. Saving or printing does not mean the notice was served.
      </div>
      <ErrorNote error={err} />
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Approved template" required error={errors.template_id}><Select value={f.template_id || ''} onChange={set('template_id')} options={lookups.templates.map((t) => ({ value: t.id, label: t.name }))} /></Field>
          <Field label="Notice type"><Select value={f.notice_type || ''} onChange={set('notice_type')} options={['intimation', 'improvement', 'closure', 'statutory', 'other']} /></Field>
          <Field label="Recipient" required error={errors.recipient}><Input value={f.recipient || ''} onChange={set('recipient')} placeholder="Owner / occupier" /></Field>
          <Field label="Legal provision" hint="Section of the law, as confirmed by the county."><Input value={f.legal_provision || ''} onChange={set('legal_provision')} placeholder="e.g. Public Health Act, section ..." /></Field>
        </div>
        {!preset.linked_entity_type && <EntityPicker type={f.linked_entity_type} id={f.linked_entity_id} error={errors.linked_entity_id} onChange={(t, i) => setF({ ...f, linked_entity_type: t, linked_entity_id: i })} />}
        <Field label="Findings"><Textarea rows={3} value={f.findings || ''} onChange={set('findings')} /></Field>
        <Field label="Corrective action required"><Textarea rows={3} value={f.corrective_action || ''} onChange={set('corrective_action')} /></Field>
        <Field label="Compliance deadline" error={errors.compliance_deadline}><Input type="date" value={f.compliance_deadline || ''} onChange={set('compliance_deadline')} /></Field>
      </div>
    </Modal>
  );
}

// Shrinks a photo in the browser (longest side 1600 px, JPEG) so it fits the 700 KB attachment limit.
async function shrinkImage(file) {
  const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = URL.createObjectURL(file); });
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return c.toDataURL('image/jpeg', 0.78);
}
const readAsDataUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });

// Photos and PDF documents attached to a record (evidence, proof of service, signed reports).
export function Attachments({ type, id, canWrite }) {
  const { can, me } = useAuth();
  const { data, reload } = useLoad(() => api(`/attachments?entity_type=${type}&entity_id=${id}`), [type, id]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const isImage = /^image\//.test(file.type);
      if (!isImage && file.type !== 'application/pdf') throw new Error('Only photos and PDF files can be attached.');
      const dataUrl = isImage ? await shrinkImage(file) : await readAsDataUrl(file);
      await api('/attachments', { method: 'POST', body: { entity_type: type, entity_id: Number(id), name: file.name, mime: isImage ? 'image/jpeg' : file.type, data: dataUrl } });
      toast('Attachment added'); reload();
    } catch (ex) { toast(ex.message, 'error'); } finally { setBusy(false); }
  };
  const remove = async (a) => {
    if (!confirm(`Remove ${a.name}? The removal is recorded in the audit history.`)) return;
    try { await api(`/attachments/${a.id}`, { method: 'DELETE' }); reload(); } catch (ex) { toast(ex.message, 'error'); }
  };
  return (
    <Card className="no-print">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="flex items-center gap-2 font-bold"><Paperclip className="h-4 w-4" />Attachments ({data?.length || 0})</span>
        {canWrite && (
          <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[13px] font-semibold hover:bg-paper ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload className="h-3.5 w-3.5" />{busy ? 'Uploading…' : 'Add photo or PDF'}
            <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={upload} />
          </label>
        )}
      </div>
      {!data?.length ? <div className="px-4 py-4 text-sm text-ink-faint">No attachments. Avoid identifiable photos of people unless necessary and authorised.</div> : (
        <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
          {data.map((a) => (
            <div key={a.id} className="group relative overflow-hidden rounded-lg border border-line">
              <a href={`/api/attachments/${a.id}/file`} target="_blank" rel="noreferrer" className="block">
                {/^image\//.test(a.mime) ? <img src={`/api/attachments/${a.id}/file`} alt={a.name} className="h-28 w-full object-cover" loading="lazy" />
                  : <div className="flex h-28 items-center justify-center bg-paper"><FileText className="h-8 w-8 text-ink-faint" /></div>}
              </a>
              <div className="px-2 py-1.5 text-[11px]"><div className="truncate font-semibold">{a.name}</div><div className="text-ink-faint">{a.uploaded_by_name} · {fmtDateTime(a.created_at)}</div></div>
              {canWrite && (can.lead || a.uploaded_by === me.user.id) && (
                <button onClick={() => remove(a)} className="absolute right-1 top-1 rounded bg-surface/90 p-1 text-ink-faint opacity-0 transition hover:text-red-600 group-hover:opacity-100" aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
