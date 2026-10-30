// Activity log page: lists recorded field work (the source of report totals) and the form to record work.
// Each activity category has its own form fields (for example people reached for a health talk).
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, todayStr, addDays, PILLARS, PURPOSES, humanize } from '../lib/format.js';
import { Badge, Card, PageHeader, Spinner, Button, Empty, Select, Input, Field, Textarea, Modal, ErrorNote, useToast, Tabs } from '../components/ui.jsx';
import { useLoad, EntityLink, EntityPicker, locationLabel, CategorySelect, DynamicFields, errorText } from '../components/forms.jsx';

// The Activity log page.
export default function Activities() {
  const { can, lookups, me } = useAuth();
  const [params, setParams] = useSearchParams();
  // Default filter: the last 30 days, submitted records.
  const [filters, setFilters] = useState({ from: addDays(todayStr(), -30), to: todayStr(), category_id: '', recorded_by: '', pillar: '', status: 'submitted' });
  // Load the records again whenever a filter or the ward changes.
  const { data, loading, reload } = useLoad(() => api(`/activities${qs(filters)}`), [JSON.stringify(filters), me.ward?.id]);
  // Opening /activities?new=1 (from the dashboard) opens the form straight away.
  const [open, setOpen] = useState(params.get('new') === '1');
  const [edit, setEdit] = useState(null);
  const toast = useToast();
  // Removes a record after confirming. It then stops counting in reports, and the change is logged.
  const remove = async (a) => {
    if (!confirm('Remove this activity record? It will no longer count in reports. The change is logged.')) return;
    try { await api(`/activities/${a.id}`, { method: 'DELETE' }); toast('Record removed'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const openEdit = async (a) => { try { setEdit(await api(`/activities/${a.id}`)); } catch (e) { toast(e.message, 'error'); } };
  // Totals of the listed records.
  const total = (data || []).reduce((s, a) => s + (Number(a.quantity) || 0), 0);
  const people = (data || []).reduce((s, a) => s + (Number(a.people_reached) || 0), 0);
  const setF = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  return (
    <div>
      <PageHeader title="Activity log" subtitle="Completed work recorded here is the source for report totals. Inspections and samples add records automatically. Drafts are not counted until submitted."
        actions={can.write && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Record activity</Button>} />
      <Tabs value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })} tabs={[{ value: 'submitted', label: 'Submitted' }, { value: 'draft', label: 'My drafts' }]} />
      {/* Date, pillar, category and (for leads and reviewers) officer filters. */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="From"><Input type="date" value={filters.from} onChange={setF('from')} /></Field>
        <Field label="To"><Input type="date" value={filters.to} onChange={setF('to')} /></Field>
        <Field label="Pillar"><Select value={filters.pillar} onChange={setF('pillar')} placeholder="All" options={Object.entries(PILLARS).map(([k, v]) => ({ value: k, label: `${k}. ${v}` }))} /></Field>
        <Field label="Category"><CategorySelect value={filters.category_id} onChange={setF('category_id')} categories={lookups.categories.filter((c) => !filters.pillar || c.pillar === filters.pillar)} placeholder="All" onlyActive={false} /></Field>
        {(can.lead || me.role === 'reviewer') && <Field label="Officer"><Select value={filters.recorded_by} onChange={setF('recorded_by')} placeholder="All" options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} /></Field>}
      </div>
      {/* The table of records, or a message when there are none. */}
      {loading && !data ? <Spinner /> : (
        <Card className="overflow-hidden">
          {data.length === 0 ? <Empty title={filters.status === 'draft' ? 'No drafts' : 'No activity in this period'}>Record completed field work, or complete a task with “record this as an activity”.</Empty> : (
            <>
              <div className="border-b border-line bg-paper/50 px-4 py-2 text-[13px] text-ink-soft">{data.length} records · total quantity {total}{people ? ` · ${people} people reached` : ''}</div>
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Category</th><th>Outcome</th><th className="hidden md:table-cell">Linked</th><th className="hidden sm:table-cell">Qty</th><th className="hidden lg:table-cell">Officer</th><th></th></tr></thead>
                  <tbody>
                    {data.map((a) => (
                      <tr key={a.id}>
                        <td className="whitespace-nowrap font-semibold">{fmtDate(a.activity_date)}{a.status === 'draft' && <div><Badge status="draft" /></div>}</td>
                        <td>{a.category}<div className="text-[12px] text-ink-faint">{a.pillar}. {a.sub_location || ''}{a.linked_inspection_id ? ' · from inspection' : a.linked_task_id ? ' · from task' : ''}</div></td>
                        <td className="max-w-xs">{a.outcome || <span className="text-ink-faint">—</span>}{a.people_reached ? <div className="text-[12px] text-ink-faint">{a.people_reached} people reached</div> : null}</td>
                        <td className="hidden md:table-cell"><EntityLink type={a.linked_entity_type} id={a.linked_entity_id} name={a.entity_name} /></td>
                        <td className="hidden sm:table-cell">{a.quantity} <span className="text-[12px] text-ink-faint">{a.unit}</span></td>
                        <td className="hidden lg:table-cell whitespace-nowrap">{a.recorded_by_name}</td>
                        <td className="whitespace-nowrap text-right">
                          {can.write && (can.lead || a.recorded_by === me.user.id) && !a.linked_inspection_id && <button onClick={() => openEdit(a)} className="rounded p-1 text-ink-faint hover:bg-paper hover:text-ink" aria-label="Edit"><Pencil className="h-4 w-4" /></button>}
                          {can.write && (can.lead || a.recorded_by === me.user.id) && <button onClick={() => remove(a)} className="rounded p-1 text-ink-faint hover:bg-red-50 hover:text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}
      {/* Pop up form. Closing it also removes ?new=1 from the address. */}
      <ActivityForm open={open || !!edit} record={edit} onClose={() => { setOpen(false); setEdit(null); if (params.get('new')) setParams({}, { replace: true }); }} onSaved={reload} />
    </div>
  );
}

// Pop up form to record (or edit) a field activity. The fields below "Details" change with the chosen category.
export function ActivityForm({ open, onClose, onSaved, record, preset = {} }) {
  const { lookups } = useAuth();
  const [f, setF] = useState({});
  const [details, setDetails] = useState({});
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Reset the form each time it opens. The default date is today.
  useEffect(() => {
    if (!open) return;
    setErrors({}); setErr(null);
    if (record) {
      setF({ category_id: record.category_id, activity_date: record.activity_date, start_time: record.start_time || '', purpose: record.purpose || '', quantity: record.quantity, unit: record.unit,
        outcome: record.outcome || '', notes: record.notes || '', next_action: record.next_action || '', location_id: record.location_id || '', linked_entity_type: record.linked_entity_type, linked_entity_id: record.linked_entity_id });
      setDetails(record.details || {});
    } else {
      setF({ category_id: '', activity_date: todayStr(), start_time: '', purpose: 'routine', quantity: 1, unit: '', outcome: '', notes: '', next_action: '', location_id: '', linked_entity_type: null, linked_entity_id: null, ...preset });
      setDetails({});
    }
  }, [open, record]); // eslint-disable-line react-hooks/exhaustive-deps
  const cat = lookups.categories.find((c) => c.id === Number(f.category_id));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  // Send the record to the API. asDraft saves it without counting it in reports.
  const save = async (asDraft) => {
    setBusy(true); setErr(null);
    const body = { ...f, category_id: Number(f.category_id) || null, quantity: Number(f.quantity) || 1, unit: f.unit || undefined, location_id: f.location_id || null, purpose: f.purpose || null, details };
    try {
      if (record) await api(`/activities/${record.id}`, { method: 'PATCH', body: { ...body, ...(asDraft ? {} : { status: 'submitted' }) } });
      else await api('/activities', { method: 'POST', body: { ...body, status: asDraft ? 'draft' : 'submitted' } });
      toast(asDraft ? 'Draft saved' : 'Activity recorded'); onSaved?.(); onClose();
    } catch (e) { setErr(errorText(e)); setErrors(e.errors || {}); } finally { setBusy(false); }
  };
  const isDraft = !record || record.status === 'draft';
  return (
    <Modal open={open} onClose={onClose} title={record ? (record.status === 'draft' ? 'Edit draft activity' : 'Correct activity record') : 'Record activity'} wide
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        {isDraft && <Button variant="secondary" onClick={() => save(true)} loading={busy}>Save draft</Button>}
        <Button onClick={() => save(false)} loading={busy}>{isDraft ? 'Submit record' : 'Save correction'}</Button>
      </>}>
      <ErrorNote error={err} />
      {record && record.status !== 'draft' && <p className="mb-3 text-[13px] text-ink-soft">Corrections are recorded in the audit history.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Activity category" required error={errors.category_id} className="sm:col-span-2">
          <CategorySelect value={f.category_id} onChange={(e) => { setF({ ...f, category_id: e.target.value, unit: '' }); setDetails({}); }} categories={lookups.categories} />
        </Field>
        {cat?.description && <p className="-mt-2 text-[12px] text-ink-faint sm:col-span-2">{cat.description}</p>}
        <Field label="Activity date" required error={errors.activity_date}><Input type="date" max={todayStr()} value={f.activity_date || ''} onChange={set('activity_date')} /></Field>
        <Field label="Start time" error={errors.start_time}><Input type="time" value={f.start_time || ''} onChange={set('start_time')} /></Field>
        <Field label="Purpose"><Select value={f.purpose || ''} onChange={set('purpose')} options={PURPOSES} /></Field>
        <Field label={`Quantity (${f.unit || cat?.unit || 'activities'})`} error={errors.quantity} hint="One record is counted once in reports."><Input type="number" min="1" value={f.quantity ?? ''} onChange={set('quantity')} /></Field>
        {cat?.form?.length > 0 && (
          <div className="sm:col-span-2">
            <div className="mb-1.5 text-[13px] font-bold">Details for {cat.name}</div>
            <DynamicFields form={cat.form} values={details} onChange={setDetails} errors={errors} />
          </div>
        )}
        <Field label="Location" className="sm:col-span-2"><Select value={f.location_id || ''} onChange={set('location_id')} placeholder="Not specified" options={lookups.locations.map((l) => ({ value: l.id, label: locationLabel(l) }))} /></Field>
        <div className="sm:col-span-2"><EntityPicker type={f.linked_entity_type} id={f.linked_entity_id} error={errors.linked_entity_id} onChange={(t, i) => setF({ ...f, linked_entity_type: t, linked_entity_id: i })} /></div>
        <Field label="Result / outcome" className="sm:col-span-2"><Textarea rows={2} value={f.outcome || ''} onChange={set('outcome')} /></Field>
        <Field label="Next action or referral" className="sm:col-span-2"><Input value={f.next_action || ''} onChange={set('next_action')} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
      </div>
      {record && <p className="mt-2 text-[11px] text-ink-faint">Status: {humanize(record.status)}</p>}
    </Modal>
  );
}
