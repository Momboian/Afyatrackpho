// Inspection pages: the list of inspections, the new inspection form (also used for revisits),
// and the inspection detail page with the printable inspection report.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, ArrowLeft, Trash2, FileText, Lock, Check, X, Minus, Printer, FileDown, RotateCcw } from 'lucide-react';
import { api, qs, download } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, fmtDateTime, todayStr, addDays, humanize, ENTITY_LABEL, PURPOSES } from '../lib/format.js';
import { REGISTERS, INSPECTABLE, FACILITY_STATUS_FIELDS } from '../lib/registers.js';
import { Badge, Card, PageHeader, Spinner, Button, Empty, Select, Input, Field, Textarea, ErrorNote, useToast } from '../components/ui.jsx';
import { useLoad, EntityLink, NoticeForm, OfficerMultiSelect, Attachments, defaultOfficer, errorText } from '../components/forms.jsx';

// The next steps a finding can move to, following the workflow
// open, action assigned, in progress, reported complied, verified or not complied, closed or escalated.
const NEXT = {
  open: ['action_assigned', 'in_progress', 'reported_complied'], action_assigned: ['in_progress', 'reported_complied'], in_progress: ['reported_complied'],
  reported_complied: ['verified', 'not_complied'], not_complied: ['in_progress', 'escalated'], verified: ['closed'], escalated: ['closed'],
  resolved: ['closed'], partially_resolved: ['in_progress', 'reported_complied'], unresolved: ['in_progress', 'escalated']
};
const DONE = ['verified', 'closed', 'resolved'];

// Splits checklist lines into sections. "# Kitchen (if has_kitchen)" starts a section that only shows
// when the inspected record has that field set (for example a school with a kitchen).
export function parseChecklist(items = [], entity = null) {
  const sections = [];
  let cur = { title: null, condition: null, items: [] };
  for (const raw of items) {
    const line = String(raw).trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      if (cur.items.length || cur.title) sections.push(cur);
      const m = /^#\s*(.*?)\s*(?:\(if\s+(\w+)\))?$/.exec(line);
      cur = { title: m?.[1] || line.slice(1).trim(), condition: m?.[2] || null, items: [] };
    } else cur.items.push(line);
  }
  if (cur.items.length || cur.title) sections.push(cur);
  const on = (v) => !(v === null || v === undefined || v === '' || v === 0 || v === '0' || v === false || v === 'day' || v === 'unknown');
  return sections.filter((s) => !s.condition || (entity && on(entity[s.condition])));
}

// The Inspections list page.
export default function Inspections() {
  const { can, lookups, me } = useAuth();
  // Default filter: the last 60 days.
  const [f, setF] = useState({ entity_type: '', from: addDays(todayStr(), -60), to: todayStr(), risk_level: '', officer_id: '', purpose: '' });
  const { data, loading } = useLoad(() => api(`/inspections${qs(f)}`), [JSON.stringify(f), me.ward?.id]);
  const nav = useNavigate();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div>
      <PageHeader title="Inspections" subtitle="Each inspection is a separate, dated record that stays in the record's history. Revisits link back to the original inspection."
        actions={can.write && <Button onClick={() => nav('/inspections/new')}><Plus className="h-4 w-4" />New inspection</Button>} />
      {/* Type, date, purpose, risk and officer filters. */}
      <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Type"><Select value={f.entity_type} onChange={set('entity_type')} placeholder="All" options={INSPECTABLE.map((k) => ({ value: k, label: REGISTERS[k].singular }))} /></Field>
        <Field label="From"><Input type="date" value={f.from} onChange={set('from')} /></Field>
        <Field label="To"><Input type="date" value={f.to} onChange={set('to')} /></Field>
        <Field label="Purpose"><Select value={f.purpose} onChange={set('purpose')} placeholder="Any" options={PURPOSES} /></Field>
        <Field label="Risk"><Select value={f.risk_level} onChange={set('risk_level')} placeholder="Any" options={['low', 'medium', 'high', 'unknown']} /></Field>
        <Field label="Officer"><Select value={f.officer_id} onChange={set('officer_id')} placeholder="Any" options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} /></Field>
      </div>
      {/* The inspection table. Clicking a row opens the inspection. */}
      {loading && !data ? <Spinner /> : (
        <Card className="overflow-hidden">
          {data.length === 0 ? <Empty title="No inspections in this period" /> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Date</th><th>Record</th><th className="hidden md:table-cell">Purpose</th><th className="hidden md:table-cell">Outcome</th><th>Risk</th><th className="hidden sm:table-cell">Open findings</th><th className="hidden lg:table-cell">Officer</th></tr></thead>
                <tbody>
                  {data.map((i) => (
                    <tr key={i.id} className="clickable" onClick={() => nav(`/inspections/${i.id}`)}>
                      <td className="whitespace-nowrap font-semibold">{fmtDate(i.inspection_date)}<div className="font-mono text-[11px] font-normal text-ink-faint">{i.reference}</div></td>
                      <td><div className="font-medium">{i.entity_name}</div><div className="text-[12px] text-ink-faint">{ENTITY_LABEL[i.entity_type]}</div></td>
                      <td className="hidden md:table-cell">{humanize(i.purpose)}{i.follow_up_of ? <div className="text-[12px] text-ink-faint">Revisit</div> : null}</td>
                      <td className="hidden md:table-cell">{i.outcome || '—'}</td>
                      <td><Badge status={i.risk_level} /></td>
                      <td className="hidden sm:table-cell">{i.open_findings ? <Badge tone="amber">{i.open_findings} of {i.finding_count}</Badge> : <span className="text-ink-faint">{i.finding_count ? 'All closed' : 'None'}</span>}</td>
                      <td className="hidden lg:table-cell whitespace-nowrap">{i.officer_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// The new inspection form. It can be opened with ?entity_type=...&entity_id=... to preselect a record,
// and with &follow_up_of=ID to record a revisit of an earlier inspection.
export function InspectionForm() {
  const [params] = useSearchParams();
  const { me, lookups } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const followUpOf = params.get('follow_up_of') ? Number(params.get('follow_up_of')) : null;
  const [type, setType] = useState(params.get('entity_type') || 'premises');
  const [entityId, setEntityId] = useState(params.get('entity_id') || '');
  const [entities, setEntities] = useState([]);
  // The checklist for the chosen type and the answer for each item (yes, no or not applicable) with a note.
  const [checklist, setChecklist] = useState({ version: 0, items: [] });
  const [results, setResults] = useState({});
  // Main form values. Follow ups are created for findings by default.
  const [f, setF] = useState({ inspection_date: todayStr(), inspection_time: '', purpose: followUpOf ? 'follow_up' : 'routine', team_ids: [], departments: '', risk_level: 'low', outcome: '', findings: '', recommendations: '', next_visit_due: '', notice_required: false, create_follow_ups: true, status_update: '' });
  // Facility condition fields (only for health facilities).
  const [facility, setFacility] = useState({});
  const [findings, setFindings] = useState([]);
  // For a revisit: the original inspection and the new status of each of its open findings.
  const [original, setOriginal] = useState(null);
  const [recheck, setRecheck] = useState({});
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const draftKey = `afyatrack.inspection.${type}.${entityId || 'none'}.${followUpOf || ''}`;

  // When the type changes, load the records of that type and its checklist.
  useEffect(() => {
    api(`/registers/${type}`).then(setEntities).catch(() => setEntities([]));
    api(`/checklists/${type}`).then((c) => { setChecklist(c); setResults({}); });
  }, [type]);
  // For a revisit, load the original inspection.
  useEffect(() => { if (followUpOf) api(`/inspections/${followUpOf}`).then(setOriginal).catch(() => setOriginal(null)); }, [followUpOf]);
  // Restore an unsaved inspection kept in this browser (useful when the network drops in the field).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (saved) { setF(saved.f); setResults(saved.results || {}); setFindings(saved.findings || []); setFacility(saved.facility || {}); setRecheck(saved.recheck || {}); setRestored(true); }
    } catch { /* ignore */ }
  }, [draftKey]);
  // Keep a copy of the form in this browser while typing.
  useEffect(() => {
    if (!entityId) return;
    const t = setTimeout(() => { try { localStorage.setItem(draftKey, JSON.stringify({ f, results, findings, facility, recheck })); } catch { /* ignore */ } }, 600);
    return () => clearTimeout(t);
  }, [f, results, findings, facility, recheck, draftKey, entityId]);

  const entity = entities.find((x) => String(x.id) === String(entityId)) || null;
  const sections = useMemo(() => parseChecklist(checklist.items, entity), [checklist, entity]);
  const reg = REGISTERS[type];

  // Adds an empty finding with a default deadline in 14 days, assigned to me.
  const addFinding = (text = '') => setFindings((x) => [...x, { finding: text, required_action: '', deadline: addDays(todayStr(), 14), responsible_user_id: defaultOfficer(me, lookups), responsible_party: '' }]);
  // Saves a checklist answer. Answering "No" adds a matching finding automatically.
  const setResult = (item, result) => {
    setResults((r) => ({ ...r, [item]: { ...(r[item] || {}), result } }));
    if (result === 'no' && !findings.some((x) => x.finding === `Not met: ${item}`)) addFinding(`Not met: ${item}`);
  };
  const setNote = (item, note) => setResults((r) => ({ ...r, [item]: { ...(r[item] || {}), note } }));
  const setFinding = (idx, k, v) => setFindings(findings.map((y, j) => (j === idx ? { ...y, [k]: v } : y)));

  // Sends the whole inspection to the API, then opens the saved inspection.
  const save = async () => {
    setBusy(true); setErr(null);
    const checklist_results = sections.flatMap((s) => [
      ...(s.title ? [{ item: s.title, section_heading: true }] : []),
      ...s.items.map((item) => ({ section: s.title, item, result: results[item]?.result || 'not_checked', note: results[item]?.note || '' }))
    ]);
    const body = {
      entity_type: type, entity_id: Number(entityId), ...f, team_ids: f.team_ids, follow_up_of: followUpOf || undefined,
      checklist_results, findings_list: findings, facility_status: type === 'facility' ? facility : undefined,
      status_update: f.status_update || undefined, recheck: Object.entries(recheck).filter(([, v]) => v).map(([finding_id, status]) => ({ finding_id: Number(finding_id), status }))
    };
    try {
      const r = await api('/inspections', { method: 'POST', body });
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      toast('Inspection saved'); nav(`/inspections/${r.id}`);
    } catch (e) { setErr(errorText(e)); setErrors(e.errors || {}); window.scrollTo({ top: 0, behavior: 'smooth' }); } finally { setBusy(false); }
  };
  const discardDraft = () => { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } window.location.reload(); };
  const isVisit = type === 'household';
  let n = 1;

  return (
    <div className="max-w-4xl">
      <Link to="/inspections" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4" />Inspections</Link>
      <PageHeader title={followUpOf ? 'Revisit (re inspection)' : isVisit ? 'Household WASH visit' : 'New inspection'}
        subtitle="Saved inspections cannot be edited later; findings and follow ups track progress. Your work is kept in this browser until you save." />
      {restored && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-800">An unsaved inspection was restored from this browser.<button onClick={discardDraft} className="font-semibold underline">Discard it</button></div>}
      <ErrorNote error={err} />
      <div className="space-y-5">
        {/* Step 1: what is inspected, when, why and by whom. */}
        <Card className="p-5">
          <h2 className="mb-4 font-bold">{n++}. What, when and who</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Type" required><Select value={type} disabled={!!followUpOf} onChange={(e) => { setType(e.target.value); setEntityId(''); }} options={INSPECTABLE.map((k) => ({ value: k, label: REGISTERS[k].singular }))} /></Field>
            <Field label={reg.singular} required error={errors.entity_id} className="sm:col-span-2">
              <Select value={entityId} disabled={!!followUpOf} onChange={(e) => setEntityId(e.target.value)} placeholder="Choose…" error={errors.entity_id}
                options={entities.map((x) => ({ value: x.id, label: `${x[reg.nameField]}${x.sub_location ? ` · ${x.sub_location}` : ''}` }))} />
            </Field>
            <Field label="Date" required error={errors.inspection_date}><Input type="date" max={todayStr()} value={f.inspection_date} onChange={(e) => setF({ ...f, inspection_date: e.target.value })} /></Field>
            <Field label="Time" error={errors.inspection_time}><Input type="time" value={f.inspection_time} onChange={(e) => setF({ ...f, inspection_time: e.target.value })} /></Field>
            <Field label="Purpose" error={errors.purpose}><Select value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} options={PURPOSES} /></Field>
            {type === 'facility' && <Field label="Departments inspected" className="sm:col-span-3"><Input value={f.departments} onChange={(e) => setF({ ...f, departments: e.target.value })} placeholder="e.g. OPD, maternity, laboratory, kitchen" /></Field>}
            <Field label="Team (other officers present)" error={errors.team_ids} className="sm:col-span-3">
              <OfficerMultiSelect value={f.team_ids} onChange={(v) => setF({ ...f, team_ids: v })} officers={lookups.officers} exclude={[me.user.id]} />
            </Field>
          </div>
          {!entities.length && <p className="mt-2 text-[13px] text-ink-faint">No {reg.label.toLowerCase()} yet. <Link className="font-semibold text-brand-700" to={`/registers/${type}`}>Add one in the register</Link> first.</p>}
        </Card>

        {/* Revisits: recheck each open finding from the original inspection. */}
        {original && (
          <Card className="p-5">
            <h2 className="mb-1 font-bold">{n++}. Recheck findings from {fmtDate(original.inspection_date)} ({original.reference})</h2>
            <p className="mb-4 text-[13px] text-ink-faint">Record what you found for each earlier finding. Leave blank to keep its current status.</p>
            {original.findings.filter((x) => !DONE.includes(x.status)).length === 0 ? <p className="text-sm text-ink-faint">All earlier findings are already closed.</p> : (
              <div className="space-y-2">
                {original.findings.filter((x) => !DONE.includes(x.status)).map((x) => (
                  <div key={x.id} className="flex flex-col gap-2 rounded-lg border border-line p-3 sm:flex-row sm:items-center">
                    <div className="flex-1 text-sm"><div className="font-semibold">{x.finding}</div><div className="text-[12px] text-ink-faint">Now: {humanize(x.status)}{x.deadline ? ` · deadline ${fmtDate(x.deadline)}` : ''}</div></div>
                    <Select className="sm:max-w-[220px]" value={recheck[x.id] || ''} onChange={(e) => setRecheck({ ...recheck, [x.id]: e.target.value })} placeholder="No change"
                      options={['in_progress', 'reported_complied', 'verified', 'not_complied']} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* The checklist with Yes, No and N/A buttons, in sections. */}
        <Card className="p-5">
          <div className="mb-3 flex items-baseline justify-between"><h2 className="font-bold">{n++}. Checklist</h2><span className="text-[12px] text-ink-faint">Version {checklist.version || 'none'} · configured by admin</span></div>
          {sections.length === 0 ? <p className="text-sm text-ink-faint">No checklist configured for this type. Record findings below.</p> : (
            <div className="space-y-4">
              {sections.map((s, si) => (
                <div key={si}>
                  {s.title && <div className="mb-1 border-b border-line pb-1 text-[13px] font-bold uppercase tracking-wide text-brand-700">{s.title}</div>}
                  <div className="divide-y divide-line">
                    {s.items.map((item) => {
                      const r = results[item]?.result;
                      // Draws one answer button. The chosen answer is filled with colour.
                      const btn = (val, Icon, tone, label) => (
                        <button type="button" onClick={() => setResult(item, val)} aria-label={label}
                          className={`flex h-10 w-12 items-center justify-center rounded-lg border text-sm font-semibold transition ${r === val ? tone : 'border-line bg-surface text-ink-faint hover:bg-paper'}`}><Icon className="h-4 w-4" /></button>
                      );
                      return (
                        <div key={item} className="py-2.5">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <div className="flex-1 text-sm">{item}</div>
                            <div className="flex gap-1.5">
                              {btn('yes', Check, 'border-brand-500 bg-brand-500 text-white', 'Yes')}
                              {btn('no', X, 'border-red-500 bg-red-500 text-white', 'No')}
                              {btn('na', Minus, 'border-stone-400 bg-stone-400 text-white', 'Not applicable')}
                            </div>
                          </div>
                          {r === 'no' && <Input className="mt-2 py-1.5 text-sm" placeholder="Observation (optional)" value={results[item]?.note || ''} onChange={(e) => setNote(item, e.target.value)} />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[12px] text-ink-faint">Marking an item “No” adds a finding below for you to complete.</p>
        </Card>

        {/* Health facilities only: current sanitation condition fields. Other registers: their status field. */}
        {type === 'facility' ? (
          <Card className="p-5">
            <h2 className="mb-1 font-bold">{n++}. Facility sanitation status</h2>
            <p className="mb-4 text-[13px] text-ink-faint">Updates the facility's current status. Leave blank to keep the existing value.</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FACILITY_STATUS_FIELDS.map((fld) => (
                <Field key={fld.key} label={fld.label}><Select value={facility[fld.key] || ''} onChange={(e) => setFacility({ ...facility, [fld.key]: e.target.value })} placeholder="No change" options={fld.options} /></Field>
              ))}
            </div>
          </Card>
        ) : reg.statusField && reg.statusOptions?.length && !['premises', 'handler'].includes(type) ? (
          <Card className="p-5">
            <h2 className="mb-1 font-bold">{n++}. Update {reg.singular.toLowerCase()} status</h2>
            <div className="max-w-xs"><Field label={humanize(reg.statusField)}><Select value={f.status_update} onChange={(e) => setF({ ...f, status_update: e.target.value })} placeholder="No change" options={reg.statusOptions} /></Field></div>
          </Card>
        ) : null}

        {/* Findings and corrective actions, each with a deadline, a responsible officer and the responsible party. */}
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">{n++}. Findings and corrective actions</h2>
            <Button size="sm" variant="secondary" onClick={() => addFinding()}><Plus className="h-4 w-4" />Add finding</Button>
          </div>
          {findings.length === 0 && <p className="text-sm text-ink-faint">No defects recorded.</p>}
          <div className="space-y-3">
            {findings.map((x, idx) => (
              <div key={idx} className="rounded-lg border border-line bg-paper/40 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Finding ${idx + 1}`} error={errors[`finding_${idx}`]} className="sm:col-span-2"><Input value={x.finding} onChange={(e) => setFinding(idx, 'finding', e.target.value)} /></Field>
                  <Field label="Required action" className="sm:col-span-2"><Input value={x.required_action} onChange={(e) => setFinding(idx, 'required_action', e.target.value)} /></Field>
                  <Field label="Deadline"><Input type="date" value={x.deadline} onChange={(e) => setFinding(idx, 'deadline', e.target.value)} /></Field>
                  <Field label="Responsible officer"><Select value={x.responsible_user_id} onChange={(e) => setFinding(idx, 'responsible_user_id', Number(e.target.value))} options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} /></Field>
                  <Field label="Responsible party (owner, manager ...)" className="sm:col-span-2"><Input value={x.responsible_party || ''} onChange={(e) => setFinding(idx, 'responsible_party', e.target.value)} /></Field>
                </div>
                <button onClick={() => setFindings(findings.filter((_, j) => j !== idx))} className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-red-600"><Trash2 className="h-3.5 w-3.5" />Remove</button>
              </div>
            ))}
          </div>
          {findings.length > 0 && (
            <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.create_follow_ups} onChange={(e) => setF({ ...f, create_follow_ups: e.target.checked })} />Create a follow up for each finding with a deadline</label>
          )}
        </Card>

        {/* Outcome: risk, result, next visit date (creates a revisit task), observations and recommendations. */}
        <Card className="p-5">
          <h2 className="mb-4 font-bold">{n++}. Outcome</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Risk or priority" error={errors.risk_level}><Select value={f.risk_level} onChange={(e) => setF({ ...f, risk_level: e.target.value })} options={['low', 'medium', 'high', 'unknown']} /></Field>
            <Field label="Outcome"><Select value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} placeholder="Choose…" options={['Compliant', 'Partially compliant', 'Non compliant', 'Needs improvement', 'Closed / not operating']} /></Field>
            <Field label="Next visit due" error={errors.next_visit_due} hint="Creates a revisit task in your planner."><Input type="date" value={f.next_visit_due} onChange={(e) => setF({ ...f, next_visit_due: e.target.value })} /></Field>
            <Field label="Observations" className="sm:col-span-3"><Textarea rows={3} value={f.findings} onChange={(e) => setF({ ...f, findings: e.target.value })} /></Field>
            <Field label="Recommendations" className="sm:col-span-3"><Textarea rows={2} value={f.recommendations} onChange={(e) => setF({ ...f, recommendations: e.target.value })} /></Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.notice_required} onChange={(e) => setF({ ...f, notice_required: e.target.checked })} />A notice draft is required</label>
        </Card>
        {/* Save and Cancel bar that stays visible at the bottom while scrolling. */}
        <div className="sticky bottom-20 z-10 flex justify-end gap-2 rounded-xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur lg:bottom-4">
          <Button variant="secondary" onClick={() => nav(-1)}>Cancel</Button>
          <Button onClick={save} loading={busy} disabled={!entityId}>Save {isVisit ? 'visit' : 'inspection'}</Button>
        </div>
      </div>
    </div>
  );
}

// Inspection detail page and printable inspection report. Saved inspections cannot be edited; a revisit is a new inspection.
export function InspectionDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: i, loading, error, reload } = useLoad(() => api(`/inspections/${id}`), [id]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const nav = useNavigate();
  const toast = useToast();
  if (loading && !i) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  // Moves one finding to its next status. Escalating or "not complied" asks for a note.
  const setStatus = async (f, status) => {
    let note = '';
    if (['escalated', 'not_complied'].includes(status)) { note = prompt(status === 'escalated' ? 'Escalated to whom, and why?' : 'What was not complied with?') || ''; if (!note) return; }
    try { await api(`/findings/${f.id}`, { method: 'PATCH', body: { status, note } }); toast('Finding updated'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  // Icons for the checklist answers.
  const icon = { yes: <Check className="h-4 w-4 text-brand-600" />, no: <X className="h-4 w-4 text-red-600" />, na: <Minus className="h-4 w-4 text-stone-400" /> };
  const openFindings = i.findings.filter((f) => !DONE.includes(f.status)).length;
  return (
    <div className="max-w-5xl">
      <Link to="/inspections" className="no-print mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4" />Inspections</Link>
      <div className="no-print">
        <PageHeader eyebrow={`${ENTITY_LABEL[i.entity_type]} inspection · ${fmtDate(i.inspection_date)} · ${i.reference || ''}`} title={<EntityLink type={i.entity_type} id={i.entity_id} name={i.entity_name} />}
          actions={<>
            {can.write && <Button variant="secondary" onClick={() => nav(`/inspections/new?entity_type=${i.entity_type}&entity_id=${i.entity_id}&follow_up_of=${i.id}`)}><RotateCcw className="h-4 w-4" />Record revisit</Button>}
            {can.write && i.entity_type !== 'handler' && <Button variant="secondary" onClick={() => setNoticeOpen(true)}><FileText className="h-4 w-4" />Draft notice</Button>}
            <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print / PDF</Button>
            <Button variant="secondary" onClick={() => download(`/inspections/${i.id}/word`, 'inspection.doc')}><FileDown className="h-4 w-4" />Word</Button>
          </>} />
        <div className="mb-4 flex items-center gap-2 text-[13px] text-ink-faint"><Lock className="h-3.5 w-3.5" />Historical record. It cannot be edited; record a revisit to follow up.</div>
      </div>

      {/* Print only heading of the inspection report. */}
      <div className="hidden print:block">
        <h1 className="text-[20px] font-extrabold">Sanitary inspection report</h1>
        <p className="mb-3 text-sm">{i.ward_name} · Reference {i.reference} · {ENTITY_LABEL[i.entity_type]}: {i.entity_name}{i.entity_location ? ` · ${i.entity_location}` : ''}</p>
      </div>

      {/* Left: details and checklist. Right: findings, follow ups, notices, revisits and attachments. */}
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr] print:block">
        <div className="space-y-5">
          <Card className="print-area p-5">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div><dt className="label">Date and time</dt><dd>{fmtDate(i.inspection_date)} {i.inspection_time || ''}</dd></div>
              <div><dt className="label">Purpose</dt><dd>{humanize(i.purpose)}</dd></div>
              <div><dt className="label">Officer</dt><dd>{i.officer_name}</dd></div>
              <div><dt className="label">Team</dt><dd>{i.team_names?.length ? i.team_names.join(', ') : '—'}</dd></div>
              <div><dt className="label">Risk</dt><dd><Badge status={i.risk_level} /></dd></div>
              <div><dt className="label">Outcome</dt><dd>{i.outcome || '—'}</dd></div>
              <div><dt className="label">Next visit</dt><dd>{fmtDate(i.next_visit_due)}</dd></div>
              <div><dt className="label">Checklist version</dt><dd>{i.checklist_version ?? '—'}</dd></div>
              {i.departments && <div className="col-span-2"><dt className="label">Departments inspected</dt><dd>{i.departments}</dd></div>}
              {i.original && <div className="col-span-2"><dt className="label">Revisit of</dt><dd><Link className="text-brand-700 hover:underline" to={`/inspections/${i.original.id}`}>{i.original.reference} ({fmtDate(i.original.inspection_date)})</Link></dd></div>}
            </dl>
            {i.observations && <div className="mt-4 border-t border-line pt-3 text-sm"><div className="label">Observations</div><p className="whitespace-pre-wrap">{i.observations}</p></div>}
          </Card>
          <Card className="print-area">
            <div className="border-b border-line px-4 py-3 font-bold">Checklist</div>
            {i.checklist_results.length === 0 ? <div className="px-4 py-4 text-sm text-ink-faint">No checklist recorded.</div> : i.checklist_results.map((c, k) => c.section_heading
              ? <div key={k} className="bg-paper/60 px-4 py-1.5 text-[12px] font-bold uppercase tracking-wide text-brand-700">{c.item}</div>
              : (
                <div key={k} className="flex items-start gap-3 border-b border-line/60 px-4 py-2 text-sm last:border-0">
                  <span className="mt-0.5">{icon[c.result] || <span className="inline-block w-4 text-center text-ink-faint">·</span>}</span>
                  <span className={c.result === 'no' ? 'font-semibold' : ''}>{c.item}{c.note && <span className="block text-[12px] font-normal text-ink-soft">{c.note}</span>}</span>
                </div>
              ))}
          </Card>
        </div>
        <div className="space-y-5">
          <Card className="print-area">
            <div className="border-b border-line px-4 py-3 font-bold">Findings and corrective actions ({i.findings.length}{openFindings ? `, ${openFindings} open` : ''})</div>
            {i.findings.length === 0 ? <div className="px-4 py-5 text-sm text-ink-faint">No defects recorded.</div> : i.findings.map((f) => (
              <div key={f.id} className="border-b border-line/70 px-4 py-3 last:border-0">
                <div className="flex items-start justify-between gap-2"><div className="font-semibold">{f.finding}</div><Badge status={f.status} /></div>
                {f.required_action && <div className="mt-1 text-sm text-ink-soft">Action: {f.required_action}</div>}
                <div className="mt-1 text-[12px] text-ink-faint">Deadline {fmtDate(f.deadline)} · {f.responsible_name || '—'}{f.responsible_party ? ` · party: ${f.responsible_party}` : ''}</div>
                {f.history?.length > 0 && <div className="mt-1 text-[11px] text-ink-faint">Last change {fmtDateTime(f.history[f.history.length - 1].at)}{f.history[f.history.length - 1].note ? `: ${f.history[f.history.length - 1].note}` : ''}</div>}
                {/* Buttons to move the finding to its next status. */}
                {can.write && (NEXT[f.status] || []).length > 0 && (
                  <div className="no-print mt-2 flex flex-wrap gap-1.5">
                    {NEXT[f.status].map((s) => (
                      <button key={s} onClick={() => setStatus(f, s)} className="rounded-md border border-line px-2 py-1 text-[12px] font-semibold text-ink-soft hover:bg-paper">Mark {humanize(s).toLowerCase()}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Card>
          {i.recommendations && <Card className="print-area p-4"><div className="label">Recommendations</div><p className="whitespace-pre-wrap text-sm">{i.recommendations}</p></Card>}
          <Card className="no-print">
            <div className="border-b border-line px-4 py-3 font-bold">Follow ups</div>
            {i.followUps.length === 0 ? <div className="px-4 py-5 text-sm text-ink-faint">None.</div> : i.followUps.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2 border-b border-line/70 px-4 py-2.5 text-sm last:border-0">
                <div><div>{f.action_required}</div><div className="text-[12px] text-ink-faint">{f.responsible_name} · due {fmtDate(f.due_date)}</div></div>
                <Badge status={f.status === 'open' && f.due_date < todayStr() ? 'overdue' : f.outcome || f.status} />
              </div>
            ))}
          </Card>
          {(i.notices.length > 0 || i.reinspections.length > 0) && (
            <Card className="no-print">
              {i.reinspections.length > 0 && <>
                <div className="border-b border-line px-4 py-3 font-bold">Revisits</div>
                {i.reinspections.map((r) => <Link key={r.id} to={`/inspections/${r.id}`} className="flex justify-between px-4 py-2.5 text-sm hover:bg-paper"><span>{fmtDate(r.inspection_date)} · {r.reference}</span><span className="text-ink-faint">{r.outcome || ''}</span></Link>)}
              </>}
              {i.notices.length > 0 && <>
                <div className="border-y border-line px-4 py-3 font-bold">Notices</div>
                {i.notices.map((nn) => <Link key={nn.id} to={`/notices/${nn.id}`} className="flex justify-between px-4 py-2.5 text-sm hover:bg-paper"><span className="font-mono text-[12px]">{nn.draft_reference}</span><Badge status={nn.status} /></Link>)}
              </>}
            </Card>
          )}
          <Attachments type="inspection" id={i.id} canWrite={can.write} />
        </div>
      </div>
      {/* Print only acknowledgement block. */}
      <div className="mt-8 hidden text-sm print:block">
        <p className="mb-6">Inspecting officer: {i.officer_name} &nbsp; Signature: ____________________ &nbsp; Date: ____________</p>
        <p>Received by (owner / manager): ______________________ &nbsp; Signature: ____________________ &nbsp; Date: ____________</p>
      </div>
      {/* Pop up to draft a notice, filled in with this inspection's findings and actions. */}
      <NoticeForm open={noticeOpen} onClose={() => setNoticeOpen(false)} onCreated={(nid) => nav(`/notices/${nid}`)}
        preset={{ linked_entity_type: i.entity_type, linked_entity_id: i.entity_id, inspection_id: i.id, findings: i.findings.map((f) => f.finding).join('\n'), corrective_action: i.findings.map((f) => f.required_action).filter(Boolean).join('\n') }} />
    </div>
  );
}
