// Follow up queue page: corrective actions and revisits, with the pop up to record the outcome.
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, todayStr, addDays, humanize, ENTITY_LABEL } from '../lib/format.js';
import { REGISTERS, REGISTER_KEYS } from '../lib/registers.js';
import { Badge, Card, PageHeader, Spinner, Button, Empty, Tabs, Select, Input, Field, Textarea, Modal, ErrorNote, useToast } from '../components/ui.jsx';
import { useLoad, EntityLink, FollowUpForm, errorText } from '../components/forms.jsx';

// The Follow up queue page.
export default function FollowUps() {
  const { can, lookups, me } = useAuth();
  // Officers see their own follow ups by default, leads see everybody's.
  const [bucket, setBucket] = useState('overdue');
  const [officer, setOfficer] = useState(can.lead ? '' : String(me.user.id));
  const [etype, setEtype] = useState('');
  // Load the list again whenever the tab or a filter changes.
  const { data, loading, reload } = useLoad(() => api(`/follow-ups${qs({ bucket, responsible_user_id: officer, entity_type: etype })}`), [bucket, officer, etype, me.ward?.id]);
  const [newOpen, setNewOpen] = useState(false);
  const [act, setAct] = useState(null);

  return (
    <div>
      <PageHeader title="Follow up queue" subtitle="Corrective actions and revisits. Each one has a responsible officer, a due date and its latest outcome."
        actions={can.write && <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" />New follow up</Button>} />
      {/* Tabs: overdue, due in 7 days, all open, completed. */}
      <Tabs value={bucket} onChange={setBucket} tabs={[{ value: 'overdue', label: 'Overdue' }, { value: 'due_soon', label: 'Due in 7 days' }, { value: 'open', label: 'All open' }, { value: 'completed', label: 'Completed' }]} />
      {/* Officer and record type filters. */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:max-w-xl">
        <Select value={officer} onChange={(e) => setOfficer(e.target.value)} placeholder="All officers" options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} />
        <Select value={etype} onChange={(e) => setEtype(e.target.value)} placeholder="All record types" options={REGISTER_KEYS.map((k) => ({ value: k, label: REGISTERS[k].singular }))} />
      </div>
      {/* The follow up table. */}
      {loading && !data ? <Spinner /> : (
        <Card className="overflow-hidden">
          {data.length === 0 ? <Empty title={bucket === 'overdue' ? 'No overdue follow ups' : 'Nothing in this list'}>{bucket === 'overdue' ? 'Good work. Check items due in the next 7 days.' : ''}</Empty> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Due</th><th>Action required</th><th className="hidden md:table-cell">Record</th><th className="hidden sm:table-cell">Responsible</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {data.map((f) => (
                    <tr key={f.id}>
                      <td className={`whitespace-nowrap font-semibold ${f.is_overdue ? 'text-red-600' : ''}`}>{fmtDate(f.due_date)}</td>
                      <td className="max-w-sm">{f.action_required}{f.outcome_notes && <div className="text-[12px] text-ink-faint">“{f.outcome_notes}”</div>}{f.next_step && <div className="text-[12px] text-ink-soft">Next step: {f.next_step}</div>}</td>
                      <td className="hidden md:table-cell"><EntityLink type={f.linked_entity_type} id={f.linked_entity_id} name={f.entity_name} />{f.linked_entity_type && <div className="text-[12px] text-ink-faint">{ENTITY_LABEL[f.linked_entity_type]}</div>}</td>
                      <td className="hidden sm:table-cell whitespace-nowrap">{f.responsible_name}</td>
                      <td><Badge status={f.is_overdue ? 'overdue' : f.status === 'completed' ? f.outcome : f.status} /></td>
                      <td className="whitespace-nowrap text-right">
                        {/* Only open follow ups, and only for the responsible officer or a lead, get the "Record outcome" button. */}
                        {f.status === 'open' && can.write && (can.lead || f.responsible_user_id === me.user.id) && (
                          <Button size="sm" variant="secondary" onClick={() => setAct(f)}>Record outcome</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {/* Pop ups: new follow up and record outcome. */}
      <FollowUpForm open={newOpen} onClose={() => setNewOpen(false)} onSaved={reload} />
      <OutcomeModal fu={act} onClose={() => setAct(null)} onDone={reload} />
    </div>
  );
}

// Pop up to complete, reschedule or cancel a follow up.
function OutcomeModal({ fu, onClose, onDone }) {
  const { can, lookups } = useAuth();
  const [f, setF] = useState({});
  const [err, setErr] = useState(null); const [errors, setErrors] = useState({}); const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Fill the form each time a follow up is opened.
  useEffect(() => { if (fu) { setF({ mode: 'complete', outcome: 'compliant', outcome_notes: '', next_step: '', schedule_next: false, next_due: addDays(todayStr(), 14), responsible_user_id: fu.responsible_user_id, due_date: fu.due_date }); setErr(null); setErrors({}); } }, [fu]);
  if (!fu) return null;
  // Builds the request for the chosen tab and sends it.
  const save = async () => {
    setBusy(true); setErr(null);
    let body;
    // Complete: the outcome, notes and an optional next follow up.
    if (f.mode === 'complete') body = { status: 'completed', outcome: f.outcome, outcome_notes: f.outcome_notes, next_step: f.next_step, referral_to: f.referral_to, ...(f.schedule_next ? { next_follow_up: { due_date: f.next_due } } : {}) };
    // Cancel: a reason is needed.
    else if (f.mode === 'cancel') body = { status: 'cancelled', outcome_notes: f.outcome_notes };
    // Reschedule: a new date, and a new officer when the user is a lead.
    else body = { due_date: f.due_date, ...(can.lead ? { responsible_user_id: Number(f.responsible_user_id) } : {}) };
    try { await api(`/follow-ups/${fu.id}`, { method: 'PATCH', body }); toast('Follow up updated'); onDone(); onClose(); }
    catch (e) { setErr(errorText(e)); setErrors(e.errors || {}); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Update follow up"
      footer={<><Button variant="secondary" onClick={onClose}>Back</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      {/* The follow up being updated. */}
      <div className="mb-4 rounded-lg bg-paper px-3 py-2.5 text-sm"><b>{fu.action_required}</b><div className="text-[12px] text-ink-faint">{fu.entity_name} · due {fmtDate(fu.due_date)}</div></div>
      {/* Three modes: revisit outcome, reschedule, cancel. */}
      <Tabs value={f.mode} onChange={(mode) => setF({ ...f, mode })} tabs={[{ value: 'complete', label: 'Revisit outcome' }, { value: 'reschedule', label: can.lead ? 'Reschedule / reassign' : 'Reschedule' }, { value: 'cancel', label: 'Cancel' }]} />
      <ErrorNote error={err} />
      {/* Outcome buttons. Choosing partial or non compliant ticks "schedule another follow up". */}
      {f.mode === 'complete' && (
        <div className="space-y-4">
          <Field label="Outcome at revisit" required error={errors.outcome}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['compliant', 'Compliant (verified)'], ['partial', 'Partial'], ['non_compliant', 'Non compliant'], ['referred', 'Referred']].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setF({ ...f, outcome: v, schedule_next: v !== 'compliant' })}
                  className={`rounded-lg border px-2 py-2.5 text-sm font-semibold ${f.outcome === v ? (v === 'compliant' ? 'border-brand-500 bg-brand-50 text-brand-800' : v === 'partial' ? 'border-ochre-500 bg-ochre-50 text-ochre-700' : 'border-red-400 bg-red-50 text-red-700') : 'border-line text-ink-soft'}`}>{l}</button>
              ))}
            </div>
          </Field>
          <Field label="Notes"><Textarea rows={2} value={f.outcome_notes} onChange={(e) => setF({ ...f, outcome_notes: e.target.value })} /></Field>
          {f.outcome === 'referred' && <Field label="Referred to" required error={errors.referral_to}><Input value={f.referral_to || ''} onChange={(e) => setF({ ...f, referral_to: e.target.value })} placeholder="e.g. Sub county PHO, legal office" /></Field>}
          {f.outcome !== 'compliant' && (
            <>
              <Field label="Next lawful step (as directed by office procedures)" hint="Recorded for reference only. Actual legal actions are recorded when performed."><Input value={f.next_step} onChange={(e) => setF({ ...f, next_step: e.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.schedule_next} onChange={(e) => setF({ ...f, schedule_next: e.target.checked })} />Schedule another follow up</label>
              {f.schedule_next && <Field label="Next follow up due" error={errors.next_due}><Input type="date" value={f.next_due} onChange={(e) => setF({ ...f, next_due: e.target.value })} /></Field>}
            </>
          )}
        </div>
      )}
      {f.mode === 'reschedule' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New due date" error={errors.due_date}><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          {can.lead && <Field label="Responsible officer" error={errors.responsible_user_id}><Select value={f.responsible_user_id} onChange={(e) => setF({ ...f, responsible_user_id: e.target.value })} options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} /></Field>}
        </div>
      )}
      {f.mode === 'cancel' && <Field label="Reason" required error={errors.outcome_notes}><Textarea rows={3} value={f.outcome_notes} onChange={(e) => setF({ ...f, outcome_notes: e.target.value })} /></Field>}
      <p className="mt-3 text-[11px] text-ink-faint">{humanize('status')}: changes are logged in the audit history.</p>
    </Modal>
  );
}
