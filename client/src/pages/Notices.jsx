// Notice pages: the list of notice drafts, the notice detail page (submit, approve, issue, serve, compliance,
// close, escalate, print, Word), and the pop up used to record each step.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, ArrowLeft, Printer, FileDown, CheckCircle2, Send, PackageCheck, Ban, Pencil, Undo2, ClipboardCheck, AlertOctagon, Archive } from 'lucide-react';
import { api, qs, download } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, fmtDateTime, todayStr, addDays, humanize } from '../lib/format.js';
import { Badge, Card, PageHeader, Spinner, Button, Empty, Tabs, Input, Field, Textarea, Modal, ErrorNote, useToast, Select } from '../components/ui.jsx';
import { useLoad, EntityLink, NoticeForm, Attachments, errorText } from '../components/forms.jsx';

// The Notice drafts list page.
export default function Notices() {
  const { can, me } = useAuth();
  const [status, setStatus] = useState('');
  // Load the notices again when the status tab or ward changes.
  const { data, loading } = useLoad(() => api(`/notices${qs({ status })}`), [status, me.ward?.id]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  return (
    <div>
      <PageHeader title="Notices" subtitle="Drafts from approved templates. Draft, submitted, approved, issued, served and compliance are separate steps recorded only when they actually happen."
        actions={can.write && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Draft notice</Button>} />
      {/* Status tabs. */}
      <Tabs value={status} onChange={setStatus} tabs={[{ value: '', label: 'All' }, ...['draft', 'submitted', 'approved', 'issued', 'served', 'not_complied', 'complied', 'escalated', 'closed', 'withdrawn'].map((s) => ({ value: s, label: humanize(s) }))]} />
      {/* The notice table. Clicking a row opens the notice. */}
      {loading && !data ? <Spinner /> : (
        <Card className="overflow-hidden">
          {data.length === 0 ? <Empty title="No notices here" /> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Reference</th><th>Record</th><th className="hidden md:table-cell">Template</th><th className="hidden sm:table-cell">Compliance due</th><th>Status</th></tr></thead>
                <tbody>
                  {data.map((n) => (
                    <tr key={n.id} className="clickable" onClick={() => nav(`/notices/${n.id}`)}>
                      <td className="font-mono text-[12px] font-semibold">{n.draft_reference}</td>
                      <td><div className="font-medium">{n.entity_name || n.recipient}</div><div className="text-[12px] text-ink-faint">{n.prepared_by_name} · {fmtDateTime(n.created_at)}</div></td>
                      <td className="hidden md:table-cell">{n.template_name}{n.notice_type ? <div className="text-[12px] text-ink-faint">{humanize(n.notice_type)}</div> : null}</td>
                      <td className={`hidden sm:table-cell ${n.overdue ? 'font-semibold text-red-600' : ''}`}>{fmtDate(n.compliance_deadline)}{n.overdue ? ' (due)' : ''}</td>
                      <td><Badge status={n.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {/* Pop up to draft a notice. After saving, the new notice opens. */}
      <NoticeForm open={open} onClose={() => setOpen(false)} onCreated={(id) => nav(`/notices/${id}`)} />
    </div>
  );
}

// The main steps a notice goes through, in order (shown as a progress bar).
const STEPS = ['draft', 'submitted', 'approved', 'issued', 'served', 'compliance', 'closed'];
const stepOf = (s) => (['complied', 'partly_complied', 'not_complied', 'escalated'].includes(s) ? 'compliance' : s);

// The notice detail page.
export function NoticeDetail() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const { data: n, loading, error, reload } = useLoad(() => api(`/notices/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const [modal, setModal] = useState(null);
  const toast = useToast();
  // Copy the notice text into the editor whenever the notice loads.
  useEffect(() => { if (n) setContent(n.content || ''); }, [n]);
  if (loading && !n) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  // Saves edited draft text. Each save adds one to the version number.
  const saveContent = async () => {
    try { await api(`/notices/${id}`, { method: 'PATCH', body: { content } }); toast('Draft saved'); setEditing(false); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  // Runs a step that needs no extra details (submit, approve, close, withdraw).
  const quick = async (action, question) => {
    if (question && !confirm(question)) return;
    try { await api(`/notices/${id}/${action}`, { method: 'POST', body: {} }); toast(`Notice ${humanize(action).toLowerCase()} recorded`); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const s = n.status;
  const stepIdx = STEPS.indexOf(stepOf(s));
  const mine = n.prepared_by === me.user.id;

  return (
    <div className="max-w-5xl">
      <Link to="/notices" className="no-print mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4" />Notices</Link>
      {/* The "no-print" parts are hidden when printing, so only the notice itself is printed. */}
      <div className="no-print">
        {/* Title with the buttons that apply to the current status. */}
        <PageHeader eyebrow={`${n.template_name || 'Notice'}${n.notice_type ? ` · ${humanize(n.notice_type)}` : ''}`} title={<span className="font-mono text-[20px] sm:text-[24px]">{n.draft_reference}</span>}
          actions={<>
            {s === 'draft' && can.write && !editing && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit text</Button>}
            {s === 'draft' && can.write && <Button onClick={() => quick('submit', 'Submit this notice to the ward lead for approval? The text will be locked.')}><Send className="h-4 w-4" />Submit for approval</Button>}
            {['draft', 'submitted'].includes(s) && can.lead && <Button onClick={() => quick('approve', 'Approve this notice? The text will be locked and the reference changes from DRAFT to NTC.')}><CheckCircle2 className="h-4 w-4" />Approve</Button>}
            {s === 'submitted' && can.lead && <Button variant="secondary" onClick={() => setModal('return')}><Undo2 className="h-4 w-4" />Return</Button>}
            {s === 'approved' && can.write && <Button onClick={() => setModal('issue')}><Send className="h-4 w-4" />Record issue</Button>}
            {s === 'issued' && can.write && <Button onClick={() => setModal('serve')}><PackageCheck className="h-4 w-4" />Record service</Button>}
            {['served', 'partly_complied', 'not_complied'].includes(s) && can.write && <Button onClick={() => setModal('compliance')}><ClipboardCheck className="h-4 w-4" />Record compliance</Button>}
            {['served', 'partly_complied', 'not_complied'].includes(s) && can.lead && <Button variant="secondary" onClick={() => setModal('escalate')}><AlertOctagon className="h-4 w-4" />Escalate</Button>}
            {['complied', 'partly_complied', 'not_complied', 'served', 'escalated'].includes(s) && can.lead && <Button variant="secondary" onClick={() => quick('close', 'Close this notice?')}><Archive className="h-4 w-4" />Close</Button>}
            <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print / PDF</Button>
            <Button variant="secondary" onClick={() => download(`/notices/${id}/word`, 'notice.doc')}><FileDown className="h-4 w-4" />Word</Button>
            {['draft', 'submitted', 'approved', 'issued'].includes(s) && (can.lead || mine) && <Button variant="ghost" onClick={() => quick('withdraw', 'Withdraw this notice?')}><Ban className="h-4 w-4" />Withdraw</Button>}
          </>} />

        {/* Progress bar of the notice steps. */}
        <Card className="mb-5 p-4">
          {s === 'withdrawn' ? <div className="text-sm font-semibold text-ink-soft">This notice was withdrawn.</div> : (
            <ol className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {STEPS.map((st, i) => (
                <li key={st} className="text-center">
                  <div className={`mx-auto mb-1.5 h-1.5 rounded-full ${i <= stepIdx ? 'bg-brand-500' : 'bg-line'}`} />
                  <div className={`text-[12px] font-bold ${i <= stepIdx ? 'text-brand-700' : 'text-ink-faint'}`}>{humanize(st)}</div>
                  <div className="text-[11px] text-ink-faint">
                    {st === 'draft' && n.prepared_by_name}
                    {st === 'approved' && (n.reviewed_by_name || 'Ward lead')}
                    {st === 'issued' && (n.issue_date ? fmtDate(n.issue_date) : '')}
                    {st === 'served' && (n.service_date ? fmtDate(n.service_date) : 'Only when served')}
                    {st === 'compliance' && (n.compliance_result ? humanize(n.compliance_result) : n.compliance_deadline ? `Due ${fmtDate(n.compliance_deadline)}` : '')}
                    {st === 'closed' && (s === 'escalated' ? `Escalated: ${n.escalated_to}` : '')}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
        {['draft', 'submitted'].includes(s) && <div className="mb-4 rounded-lg border border-ochre-100 bg-ochre-50 px-3 py-2.5 text-[13px] text-ochre-700">Not yet approved: review every field before approval. Printing a draft does not issue or serve it.</div>}
        {n.served_to && <div className="mb-4 text-sm text-ink-soft">Served to <b>{n.served_to}</b> by {n.service_method}{n.proof_of_service ? ` · proof: ${n.proof_of_service}` : ''}</div>}
      </div>

      {/* Text editor while editing, otherwise the printable notice page with a DRAFT watermark when not approved. */}
      {editing ? (
        <Card className="p-4">
          <Textarea className="min-h-[420px] font-mono text-[13px]" value={content} onChange={(e) => setContent(e.target.value)} />
          <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={() => { setEditing(false); setContent(n.content); }}>Cancel</Button><Button onClick={saveContent}>Save draft (v{n.version + 1})</Button></div>
        </Card>
      ) : (
        <div className="print-area relative mx-auto max-w-[780px] rounded-sm border border-line bg-white px-8 py-10 text-[#14211F] shadow-card sm:px-14">
          {['draft', 'submitted'].includes(s) && <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"><span className="rotate-[-24deg] text-[90px] font-black tracking-widest text-[#D98E04]/10">DRAFT</span></div>}
          <pre className="relative whitespace-pre-wrap font-sans text-[14.5px] leading-relaxed">{n.content}</pre>
          <div className="relative mt-8 border-t border-[#E2E0D6] pt-3 text-[11px] text-[#7C8886]">Status: {humanize(s)} · version {n.version} · linked: {n.entity_name || '—'}</div>
        </div>
      )}
      <div className="no-print mt-4 text-sm text-ink-soft">Linked record: <EntityLink type={n.linked_entity_type} id={n.linked_entity_id} name={n.entity_name} />{n.inspection_id && <> · <Link className="text-brand-700 hover:underline" to={`/inspections/${n.inspection_id}`}>Inspection</Link></>}</div>

      {/* Timeline of every step, and proof of service attachments. */}
      <div className="no-print mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="border-b border-line px-4 py-3 font-bold">Timeline</div>
          <ol className="px-4 py-3">
            {(n.timeline || []).map((t, k) => (
              <li key={k} className="relative border-l-2 border-line pb-3 pl-4 last:pb-0">
                <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-brand-500" />
                <div className="text-[13px]"><Badge status={t.status} /> <b>{t.by_name || 'System'}</b></div>
                {t.note && <div className="text-[12px] italic text-ink-soft">“{t.note}”</div>}
                <div className="text-[11px] text-ink-faint">{fmtDateTime(t.at)}</div>
              </li>
            ))}
          </ol>
        </Card>
        <Attachments type="notice" id={n.id} canWrite={can.write} />
      </div>
      <StepModal mode={modal} notice={n} onClose={() => setModal(null)} onDone={reload} />
    </div>
  );
}

// Pop up to record a step that needs details: return, issue, serve, compliance or escalate.
function StepModal({ mode, notice, onClose, onDone }) {
  const [f, setF] = useState({});
  const [err, setErr] = useState(null); const [errors, setErrors] = useState({}); const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Default dates are today; a recheck is suggested 7 days later.
  useEffect(() => { if (mode) { setF({ issue_date: todayStr(), service_date: todayStr(), service_method: '', served_to: '', proof_of_service: '', service_notes: '', result: 'complied', check_date: todayStr(), notes: '', next_check_date: addDays(todayStr(), 7), escalated_to: '', note: '' }); setErr(null); setErrors({}); } }, [mode]);
  if (!mode) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  // Send the step to the API.
  const save = async () => {
    setBusy(true); setErr(null);
    const body = mode === 'compliance' ? { result: f.result, check_date: f.check_date, notes: f.notes, next_check_date: f.result !== 'complied' ? f.next_check_date : undefined } : f;
    try { await api(`/notices/${notice.id}/${mode}`, { method: 'POST', body }); toast('Recorded'); onDone(); onClose(); }
    catch (e) { setErr(errorText(e)); setErrors(e.errors || {}); } finally { setBusy(false); }
  };
  const titles = { return: 'Return to officer', issue: 'Record issue', serve: 'Record service', compliance: 'Record compliance check', escalate: 'Escalate the case' };
  return (
    <Modal open onClose={onClose} title={titles[mode]}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Confirm</Button></>}>
      {mode !== 'return' && <p className="mb-4 rounded-lg bg-paper px-3 py-2.5 text-[13px] text-ink-soft">Record this only after the real world action has happened. The system does not decide whether an enforcement step is legally valid.</p>}
      <ErrorNote error={err} />
      {mode === 'return' && <Field label="What must be changed?" required error={errors.note}><Textarea rows={3} value={f.note} onChange={set('note')} /></Field>}
      {mode === 'issue' && <Field label="Actual issue date" required error={errors.issue_date}><Input type="date" max={todayStr()} value={f.issue_date} onChange={set('issue_date')} /></Field>}
      {mode === 'serve' && (
        <div className="space-y-4">
          <Field label="Actual service date" required error={errors.service_date}><Input type="date" max={todayStr()} value={f.service_date} onChange={set('service_date')} /></Field>
          <Field label="Service method" required error={errors.service_method}><Select value={f.service_method} onChange={set('service_method')} placeholder="Choose…" options={['Hand delivered to recipient', 'Left at premises', 'Registered post', 'Email', 'Other']} /></Field>
          <Field label="Received by"><Input value={f.served_to} onChange={set('served_to')} placeholder="Name of the person who received it" /></Field>
          <Field label="Proof of service" hint="For example a signed copy. Add a photo under Attachments."><Input value={f.proof_of_service} onChange={set('proof_of_service')} /></Field>
          <Field label="Notes"><Textarea rows={2} value={f.service_notes} onChange={set('service_notes')} /></Field>
        </div>
      )}
      {mode === 'compliance' && (
        <div className="space-y-4">
          <Field label="Result" required error={errors.result}><Select value={f.result} onChange={set('result')} options={['complied', 'partly_complied', 'not_complied']} /></Field>
          <Field label="Date checked" required error={errors.check_date}><Input type="date" max={todayStr()} value={f.check_date} onChange={set('check_date')} /></Field>
          <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
          {f.result !== 'complied' && <Field label="Recheck on" hint="Creates a follow up for the recheck."><Input type="date" value={f.next_check_date} onChange={set('next_check_date')} /></Field>}
        </div>
      )}
      {mode === 'escalate' && (
        <div className="space-y-4">
          <Field label="Escalated to" required error={errors.escalated_to}><Select value={f.escalated_to} onChange={set('escalated_to')} placeholder="Choose…" options={['Supervisor', 'Legal office', 'Police', 'Court', 'Other competent authority']} /></Field>
          <Field label="Note"><Textarea rows={2} value={f.note} onChange={set('note')} /></Field>
        </div>
      )}
    </Modal>
  );
}
