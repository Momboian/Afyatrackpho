// Field record routes: registers, water samples, inspection checklists, inspections, findings,
// notices and attachments. All addresses start with /api.
import express from 'express';
import { requireRole, requireWard, isLead } from '../auth.js';
import { REGISTERS, ENTITY_TYPES, INSPECTABLE_TYPES, cleanFields, isValidDate } from '../registers.js';
import { makeAudit, todayNairobi, diff, bad, asyncRouter, nowIso } from '../util.js';
import { loader } from '../ctx.js';
import { sortBy, isActive } from '../store.js';

// Health facility condition fields that an inspection can update.
const FACILITY_STATUS_KEYS = ['water_supply_status', 'toilet_status', 'drainage_status', 'cleaning_status', 'waste_management_status', 'incinerator_status', 'pest_control_status'];

// Inspection finding workflow: open, action assigned, in progress, reported complied, verified or not complied, closed or escalated.
// Older records may still use resolved, partially_resolved and unresolved, which are still accepted.
export const FINDING_STATUSES = ['open', 'action_assigned', 'in_progress', 'reported_complied', 'verified', 'not_complied', 'escalated', 'closed', 'resolved', 'partially_resolved', 'unresolved'];
export const FINDING_DONE = ['verified', 'closed', 'resolved'];

// Water sample workflow stages.
export const SAMPLE_STAGES = ['planned', 'collected', 'dispatched', 'received_by_lab', 'result_pending', 'result_received', 'action_recorded'];

// Notice workflow: draft, submitted, approved, issued, served, then compliance result, then closed or escalated.
export const NOTICE_STATUSES = ['draft', 'submitted', 'approved', 'issued', 'served', 'complied', 'partly_complied', 'not_complied', 'closed', 'escalated', 'withdrawn'];

// Other record types that can have attachments, with their collections.
const ATTACH_TABLES = { inspection: 'inspections', activity: 'activity_records', notice: 'notice_drafts', task: 'tasks', follow_up: 'follow_ups', sample: 'water_samples' };
// Largest attachment accepted (after the browser has shrunk photos). Firestore documents are limited to 1 MB.
const MAX_ATTACHMENT_BYTES = 700 * 1024;
const ATTACH_TYPES = /^(image\/(jpeg|png|webp)|application\/pdf)$/;

// Starting values for a new register entry: "unknown" (or the first option) for status fields, active = 1,
// the field's own default when it has one, everything else empty.
export function registerDefaults(reg) {
  const d = {};
  for (const [k, rule] of Object.entries(reg.fields)) {
    d[k] = rule.default !== undefined ? rule.default : rule.enum ? (rule.enum.includes('unknown') ? 'unknown' : rule.enum[0]) : rule.type === 'bool' ? 1 : null;
  }
  return d;
}

// Builds a reference like INS/KND/2026/0007 from a prefix, the ward code and a number.
export const makeRef = (prefix, ward, n) => `${prefix}/${ward.code || 'W' + ward.id}/${todayNairobi().slice(0, 4)}/${String(n).padStart(4, '0')}`;

export function recordRoutes(store) {
  const r = asyncRouter(express.Router());
  const audit = makeAudit(store);
  // Every route here needs the user to belong to a ward.
  r.use(requireWard);

  // Finds the register named in the address (for example /registers/premises). Replies 404 when unknown.
  const getReg = (req, res) => {
    const reg = REGISTERS[req.params.type];
    if (!reg) { res.status(404).json({ error: 'Unknown register.' }); return null; }
    return reg;
  };
  // Reviewers are read only and must not see personal details, so those fields are masked.
  const hideRestricted = (req, reg, row) => {
    if (req.role !== 'reviewer' || !reg.restricted) return row;
    const out = { ...row };
    for (const k of reg.restricted) if (k in out) out[k] = out[k] ? '••• restricted' : null;
    return out;
  };
  // Reads a document and returns it only if it belongs to the user's ward. This stops access to other wards.
  const getInWard = async (table, id, wardId) => {
    const row = await store.get(table, id);
    return row && row.ward_id === wardId ? row : null;
  };
  // Values such as "licence approved" that only an authorised supervisor (ward lead or admin) may record.
  const checkLeadOnly = (req, reg, data, errors) => {
    if (isLead(req) || !reg.leadOnly) return;
    for (const [field, values] of Object.entries(reg.leadOnly)) {
      if (values.includes(data[field])) errors[field] = 'Only an authorised supervisor (ward lead) can record this status.';
    }
  };

  // ---------- Registers (generic) ----------
  // GET /api/registers/:type lists entries of one register with optional filters (search, status, location, officer).
  r.get('/registers/:type', async (req, res) => {
    const reg = getReg(req, res); if (!reg) return;
    const type = req.params.type, q = req.query, w = req.ward.id, L = loader(store, req);
    // Load the register, plus the data needed to show last inspection and open follow up counts.
    const [rowsAll, locs, users, inspections, fus, premises] = await Promise.all([
      store.find(reg.table, { ward_id: w }), L.locations(), L.users(), store.find('inspections', { ward_id: w, entity_type: type }),
      store.find('follow_ups', { ward_id: w, linked_entity_type: type, status: 'open' }),
      type === 'handler' ? L.entities('premises') : Promise.resolve(new Map())
    ]);
    let rows = rowsAll;
    // By default only active entries are shown. active=0 shows inactive, active=all shows both.
    if (q.active !== 'all') rows = rows.filter((x) => (q.active === '0' ? !isActive(x.active) : isActive(x.active)));
    if (q.q) { const s = String(q.q).toLowerCase(); rows = rows.filter((x) => reg.search.some((f) => String(x[f] ?? '').toLowerCase().includes(s))); }
    if (q.status && reg.statusField) rows = rows.filter((x) => x[reg.statusField] === q.status);
    if (q.location_id && reg.fields.location_id) rows = rows.filter((x) => x.location_id === Number(q.location_id));
    if (q.sub_location && reg.fields.location_id) rows = rows.filter((x) => locs.get(x.location_id)?.sub_location === q.sub_location);
    if (q.officer_id && reg.fields.assigned_officer_id) rows = rows.filter((x) => x.assigned_officer_id === Number(q.officer_id));
    if (q.premises_id && type === 'handler') rows = rows.filter((x) => x.premises_id === Number(q.premises_id));
    // Latest inspection date and number of open follow ups for each entry.
    const lastInsp = new Map();
    for (const i of inspections) if (!lastInsp.has(i.entity_id) || i.inspection_date > lastInsp.get(i.entity_id)) lastInsp.set(i.entity_id, i.inspection_date);
    const openFu = new Map();
    for (const f of fus) openFu.set(f.linked_entity_id, (openFu.get(f.linked_entity_id) || 0) + 1);
    // Sort by name (complaints newest first), limit to 1000 and add display fields.
    rows = (type === 'complaint' ? sortBy(rows, '-received_date', '-id') : sortBy(rows, reg.nameField)).slice(0, 1000).map((x) => {
      const out = { ...x, last_inspection: lastInsp.get(x.id) ?? null, open_follow_ups: openFu.get(x.id) || 0 };
      if (reg.fields.location_id) { const l = locs.get(x.location_id); out.sub_location = l?.sub_location ?? null; out.village = l?.village ?? null; }
      if (reg.fields.assigned_officer_id) out.officer_name = users.get(x.assigned_officer_id)?.full_name ?? null;
      if (type === 'handler') out.premises_name = premises.get(x.premises_id)?.premises_name ?? null;
      return hideRestricted(req, reg, out);
    });
    res.json(rows);
  });

  // GET /api/registers/:type/:id returns one entry with its full history:
  // inspections, follow ups, tasks, notices, activities and audit log.
  r.get('/registers/:type/:id', async (req, res) => {
    const reg = getReg(req, res); if (!reg) return;
    const type = req.params.type, w = req.ward.id, L = loader(store, req);
    const row = await getInWard(reg.table, req.params.id, w);
    if (!row) return res.status(404).json({ error: 'Record not found in your ward.' });
    const users = await L.users();
    const name = (id) => users.get(id)?.full_name ?? null;
    const [location, inspections, followUps, tasks, notices, auditRows, activities] = await Promise.all([
      row.location_id ? store.get('locations', row.location_id) : null,
      store.find('inspections', { entity_type: type, entity_id: row.id }),
      store.find('follow_ups', { linked_entity_type: type, linked_entity_id: row.id }),
      store.find('tasks', { linked_entity_type: type, linked_entity_id: row.id }),
      store.find('notice_drafts', { linked_entity_type: type, linked_entity_id: row.id }),
      store.find('audit_events', { entity_type: type, entity_id: row.id }),
      store.find('activity_records', { linked_entity_type: type, linked_entity_id: row.id })
    ]);
    // Count the findings of each inspection.
    const findingCounts = new Map();
    for (const i of inspections) findingCounts.set(i.id, (await store.find('inspection_findings', { inspection_id: i.id })).length);
    // Extra details for some registers: water samples, food handlers of a premises, or the premises of a handler.
    const extra = {};
    if (type === 'water_source') extra.samples = sortBy(await store.find('water_samples', { water_source_id: row.id }), '-collection_date').map((s) => ({ ...s, recorded_by_name: name(s.recorded_by) }));
    if (type === 'premises') extra.handlers = sortBy((await store.find('food_handlers', { premises_id: row.id })).filter((h) => isActive(h.active)), 'name')
      .map(({ id, name: n, certificate_expiry, status }) => ({ id, name: n, certificate_expiry, status }));
    if (type === 'handler' && row.premises_id) { const p = await store.get('food_premises', row.premises_id); extra.premises = p ? { id: p.id, premises_name: p.premises_name } : null; }
    const cats = await L.categories();
    res.json({
      record: hideRestricted(req, reg, row),
      location,
      inspections: sortBy(inspections, '-inspection_date', '-id').map((i) => ({ ...i, officer_name: name(i.officer_id), finding_count: findingCounts.get(i.id) || 0 })),
      followUps: sortBy(followUps, '-due_date').map((f) => ({ ...f, responsible_name: name(f.responsible_user_id) })),
      tasks: sortBy(tasks.filter((t) => !t.deleted_at), '-due_at').map((t) => ({ id: t.id, title: t.title, status: t.status, due_at: t.due_at, assigned_name: name(t.assigned_to) })),
      notices: sortBy(notices, '-id').map(({ id, draft_reference, status, created_at, compliance_deadline }) => ({ id, draft_reference, status, created_at, compliance_deadline })),
      activities: sortBy(activities.filter((a) => !a.deleted_at), '-activity_date').slice(0, 30)
        .map((a) => ({ id: a.id, activity_date: a.activity_date, category: cats.get(a.category_id)?.name ?? null, outcome: a.outcome, status: a.status || 'submitted', recorded_by_name: name(a.recorded_by) })),
      history: sortBy(auditRows, '-id').slice(0, 30).map((a) => ({ at: a.at, action: a.action, change_summary: a.change_summary, full_name: name(a.actor_user_id) })),
      ...extra
    });
  });

  // POST /api/registers/:type creates a new register entry.
  r.post('/registers/:type', requireRole('officer'), async (req, res) => {
    const reg = getReg(req, res); if (!reg) return;
    const L = loader(store, req);
    const { data, errors } = cleanFields(reg.fields, req.body || {});
    if (data.location_id && !(await L.locations()).has(data.location_id)) errors.location_id = 'Location not in this ward.';
    if (data.premises_id && !(await L.entityExists('premises', data.premises_id))) errors.premises_id = 'Premises not in this ward.';
    checkLeadOnly(req, reg, data, errors);
    if (Object.keys(errors).length) return bad(res, errors);
    // Duplicate warning: when a similar name exists, reply 409 with the matches.
    // The form then asks the user to confirm and sends confirm_duplicate = true.
    if (reg.duplicateCheck && !req.body.confirm_duplicate) {
      const name = String(data[reg.nameField]).toLowerCase();
      const dups = [...(await L.entities(req.params.type)).values()]
        .filter((x) => { const n = String(x[reg.nameField] || '').toLowerCase(); return n && (n.includes(name) || name.includes(n)); })
        .map((x) => ({ id: x.id, name: x[reg.nameField], location_id: x.location_id ?? null }));
      if (dups.length) return res.status(409).json({ error: 'Possible duplicate: a record with a similar name already exists.', duplicates: dups });
    }
    // Registers with a reference (complaints) get one automatically, for example CMP/KND/2026/0003.
    const id = await store.nextId(reg.table);
    const doc = { ...registerDefaults(reg), ...data, ward_id: req.ward.id, id };
    if (reg.refPrefix && !doc[reg.refField]) doc[reg.refField] = makeRef(reg.refPrefix, req.ward, id);
    // Complaints assigned to an officer start as "assigned".
    if (req.params.type === 'complaint' && doc.status === 'received' && doc.assigned_officer_id) doc.status = 'assigned';
    const t = nowIso();
    await store.db.collection(reg.table).doc(String(id)).set({ created_at: t, updated_at: t, ...doc });
    await audit(req, 'create', req.params.type, id, data);
    res.status(201).json({ id });
  });

  // PATCH /api/registers/:type/:id edits an entry. Only the ward lead can deactivate one.
  r.patch('/registers/:type/:id', requireRole('officer'), async (req, res) => {
    const reg = getReg(req, res); if (!reg) return;
    const L = loader(store, req);
    const row = await getInWard(reg.table, req.params.id, req.ward.id);
    if (!row) return res.status(404).json({ error: 'Record not found in your ward.' });
    const { data, errors } = cleanFields(reg.fields, req.body || {}, { partial: true });
    if ('active' in data && data.active === 0 && !isLead(req)) errors.active = 'Only the ward lead can deactivate a register entry.';
    if (data.location_id && !(await L.locations()).has(data.location_id)) errors.location_id = 'Location not in this ward.';
    checkLeadOnly(req, reg, data, errors);
    if (Object.keys(errors).length) return bad(res, errors);
    if (!Object.keys(data).length) return res.json({ ok: true });
    // Record exactly which fields changed in the audit log (corrections never erase history).
    const changes = diff(row, data);
    await store.update(reg.table, row.id, data);
    await audit(req, data[reg.statusField] && data[reg.statusField] !== row[reg.statusField] ? 'status_change' : 'update', req.params.type, row.id, changes);
    res.json({ ok: true });
  });

  // ---------- Water samples ----------
  // Fields allowed for a water sample, following the sample workflow from planned to action recorded.
  const sampleSpec = {
    collection_date: { type: 'date', required: true, label: 'Collection date' }, sample_time: {}, sample_reference: {}, tests_requested: {}, laboratory: {},
    stage: { enum: SAMPLE_STAGES }, dispatch_date: { type: 'date' }, lab_received_date: { type: 'date' }, chain_of_custody: {},
    result: {}, compliance_status: { enum: ['pending_result', 'compliant', 'non_compliant', 'unknown'] }, result_date: { type: 'date' },
    action_taken: {}, next_action_due: { type: 'date' }
  };
  // Sample rules: a result must be recorded before a compliance status or a "result received" stage,
  // dates must be in order, and only planned samples can have a future collection date.
  const checkSample = (d, errors, existing = {}) => {
    const m = { ...existing, ...d };
    if (['compliant', 'non_compliant'].includes(m.compliance_status) && (!m.result || !m.result_date))
      errors.compliance_status = 'A compliance status needs a recorded result and result date. Keep it as pending result until the lab result is in.';
    if (['result_received', 'action_recorded'].includes(m.stage) && !m.result) errors.stage = 'Record the laboratory result before marking the result as received.';
    if (m.stage === 'action_recorded' && !m.action_taken) errors.action_taken = 'Describe the action taken.';
    if (m.result_date && m.collection_date && m.result_date < m.collection_date) errors.result_date = 'Result date cannot be before the collection date.';
    if (m.dispatch_date && m.collection_date && m.dispatch_date < m.collection_date) errors.dispatch_date = 'Dispatch date cannot be before the collection date.';
    if (m.stage !== 'planned' && m.collection_date && m.collection_date > todayNairobi()) errors.collection_date = 'Collection date cannot be in the future unless the sample is only planned.';
  };
  // Collecting a sample counts once as an activity in the reports (the claim stops double counting).
  const sampleActivity = async (req, src, sampleId, date) => {
    const cat = (await store.find('categories', { module_group: 'water_sample' })).find((c) => isActive(c.active));
    if (!cat || !(await store.claim(`activity_sample_${sampleId}`))) return;
    await store.insert('activity_records', {
      ward_id: req.ward.id, category_id: cat.id, activity_date: date, recorded_by: req.user.id, location_id: src.location_id ?? null,
      linked_entity_type: 'water_source', linked_entity_id: src.id, linked_task_id: null, linked_inspection_id: null,
      outcome: 'Sample collected', notes: null, quantity: 1, unit: 'samples', status: 'submitted', details: {}, deleted_at: null
    });
  };
  // POST /api/registers/water_source/:id/samples records a new water sample for a source.
  r.post('/registers/water_source/:id/samples', requireRole('officer'), async (req, res) => {
    const src = await getInWard('water_sources', req.params.id, req.ward.id);
    if (!src) return res.status(404).json({ error: 'Water source not found.' });
    const { data, errors } = cleanFields(sampleSpec, req.body || {});
    // New samples start as collected and "pending result" until the lab result arrives.
    if (!data.compliance_status) data.compliance_status = 'pending_result';
    if (!data.stage) data.stage = 'collected';
    checkSample(data, errors);
    if (Object.keys(errors).length) return bad(res, errors);
    const id = await store.insert('water_samples', {
      sample_time: null, sample_reference: null, tests_requested: null, laboratory: null, dispatch_date: null, lab_received_date: null, chain_of_custody: null,
      result: null, result_date: null, action_taken: null, next_action_due: null,
      ...data, ward_id: req.ward.id, water_source_id: src.id, recorded_by: req.user.id
    });
    if (data.stage !== 'planned') await sampleActivity(req, src, id, data.collection_date);
    await audit(req, 'create', 'water_sample', id, data);
    res.status(201).json({ id });
  });
  // PATCH /api/samples/:id moves a sample through its stages, usually to add the lab result.
  r.patch('/samples/:id', requireRole('officer'), async (req, res) => {
    const s = await getInWard('water_samples', req.params.id, req.ward.id);
    if (!s) return res.status(404).json({ error: 'Sample not found.' });
    const { data, errors } = cleanFields(sampleSpec, req.body || {}, { partial: true });
    checkSample(data, errors, s);
    if (Object.keys(errors).length) return bad(res, errors);
    await store.update('water_samples', s.id, data);
    // A planned sample that has now been collected starts counting.
    if ((s.stage || 'collected') === 'planned' && data.stage && data.stage !== 'planned') {
      const src = await store.get('water_sources', s.water_source_id);
      if (src) await sampleActivity(req, src, s.id, data.collection_date || s.collection_date);
    }
    await audit(req, data.stage && data.stage !== s.stage ? 'status_change' : 'update', 'water_sample', s.id, diff(s, data));
    res.json({ ok: true });
  });

  // ---------- Checklists ----------
  // Returns the newest active checklist version for a type of inspection.
  const activeChecklist = async (type) => sortBy((await store.find('checklists', { entity_type: type })).filter((c) => isActive(c.active)), '-version')[0] || null;
  // GET /api/checklists/:entityType returns the checklist lines used on the inspection form.
  // Lines starting with "# " are section headings; "(if field)" shows a section only when that field is set.
  r.get('/checklists/:entityType', async (req, res) => {
    const c = await activeChecklist(req.params.entityType);
    res.json(c ? { ...c, items: Array.isArray(c.items) ? c.items : JSON.parse(c.items || '[]') } : { entity_type: req.params.entityType, version: 0, items: [] });
  });

  // ---------- Inspections ----------
  // GET /api/inspections lists inspections with optional filters (type, dates, officer, risk level, purpose).
  r.get('/inspections', async (req, res) => {
    const q = req.query, L = loader(store, req);
    let rows = await store.find('inspections', { ward_id: req.ward.id });
    if (q.entity_type) rows = rows.filter((i) => i.entity_type === q.entity_type);
    if (q.from) rows = rows.filter((i) => i.inspection_date >= q.from);
    if (q.to) rows = rows.filter((i) => i.inspection_date <= q.to);
    if (q.officer_id) rows = rows.filter((i) => i.officer_id === Number(q.officer_id) || (i.team_ids || []).includes(Number(q.officer_id)));
    if (q.risk_level) rows = rows.filter((i) => i.risk_level === q.risk_level);
    if (q.purpose) rows = rows.filter((i) => i.purpose === q.purpose);
    rows = sortBy(rows, '-inspection_date', '-id').slice(0, 500);
    const users = await L.users();
    const out = [];
    // Add the officer name, number of findings, open findings and the inspected entry's name.
    for (const i of rows) {
      const f = await store.find('inspection_findings', { inspection_id: i.id });
      out.push({ ...i, officer_name: users.get(i.officer_id)?.full_name ?? null, finding_count: f.length,
        open_findings: f.filter((x) => !FINDING_DONE.includes(x.status)).length, entity_name: await L.entityName(i.entity_type, i.entity_id) });
    }
    res.json(out);
  });

  // Loads one inspection with everything needed to show or print it.
  const inspectionDetail = async (req, i) => {
    const L = loader(store, req);
    const users = await L.users();
    const name = (id) => users.get(id)?.full_name ?? null;
    const [findings, followUps, notices, reinspections, original] = await Promise.all([
      store.find('inspection_findings', { inspection_id: i.id }), store.find('follow_ups', { linked_inspection_id: i.id }),
      store.find('notice_drafts', { inspection_id: i.id }), store.find('inspections', { follow_up_of: i.id }),
      i.follow_up_of ? store.get('inspections', i.follow_up_of) : null
    ]);
    const reg = REGISTERS[i.entity_type];
    const entity = reg ? await store.get(reg.table, i.entity_id) : null;
    const loc = entity?.location_id ? await store.get('locations', entity.location_id) : null;
    return {
      ...i, observations: i.findings ?? null, officer_name: name(i.officer_id), team_names: (i.team_ids || []).map(name).filter(Boolean),
      checklist_results: Array.isArray(i.checklist_results) ? i.checklist_results : JSON.parse(i.checklist_results || '[]'),
      findings: sortBy(findings, 'id').map((f) => ({ ...f, responsible_name: name(f.responsible_user_id) })),
      followUps: sortBy(followUps, 'id').map((f) => ({ ...f, responsible_name: name(f.responsible_user_id) })),
      notices: notices.map(({ id, draft_reference, status }) => ({ id, draft_reference, status })),
      reinspections: sortBy(reinspections, 'inspection_date').map(({ id, inspection_date, reference, outcome }) => ({ id, inspection_date, reference, outcome })),
      original: original ? { id: original.id, inspection_date: original.inspection_date, reference: original.reference } : null,
      entity_name: await L.entityName(i.entity_type, i.entity_id),
      entity_location: loc ? [loc.village, loc.sub_location].filter(Boolean).join(', ') : null,
      ward_name: req.ward.name
    };
  };

  // GET /api/inspections/:id returns one inspection with its findings, follow ups, notices and revisits.
  r.get('/inspections/:id', async (req, res) => {
    const i = await getInWard('inspections', req.params.id, req.ward.id);
    if (!i) return res.status(404).json({ error: 'Inspection not found.' });
    res.json(await inspectionDetail(req, i));
  });

  // POST /api/inspections records an inspection. Several things happen in one request:
  // findings are saved, follow ups are created for findings with deadlines, a revisit task is planned,
  // one activity record is counted, and the register summary fields are updated.
  r.post('/inspections', requireRole('officer'), async (req, res) => {
    const b = req.body || {}, errors = {}, L = loader(store, req);
    // Validate the inspection before saving anything.
    if (!INSPECTABLE_TYPES.includes(b.entity_type)) errors.entity_type = 'Choose what is being inspected.';
    const reg = REGISTERS[b.entity_type];
    const entity = reg ? await getInWard(reg.table, Number(b.entity_id) || 0, req.ward.id) : null;
    if (reg && !entity) errors.entity_id = 'Select a register entry in your ward.';
    if (!isValidDate(b.inspection_date || '')) errors.inspection_date = 'Enter a valid inspection date.';
    else if (b.inspection_date > todayNairobi()) errors.inspection_date = 'Inspection date cannot be in the future.';
    if (b.next_visit_due && !isValidDate(b.next_visit_due)) errors.next_visit_due = 'Enter a valid date.';
    else if (b.next_visit_due && b.inspection_date && b.next_visit_due < b.inspection_date) errors.next_visit_due = 'The next visit cannot be before this inspection.';
    if (b.risk_level && !['unknown', 'low', 'medium', 'high'].includes(b.risk_level)) errors.risk_level = 'Choose low, medium or high.';
    if (b.purpose && !['routine', 'follow_up', 'complaint', 'registration', 'licensing', 'surveillance', 'campaign', 'other'].includes(b.purpose)) errors.purpose = 'Choose a valid purpose.';
    if (b.inspection_time && !/^\d{2}:\d{2}$/.test(b.inspection_time)) errors.inspection_time = 'Enter the time as HH:MM.';
    // A revisit must point to an earlier inspection of the same entry.
    let original = null;
    if (b.follow_up_of) {
      original = await getInWard('inspections', Number(b.follow_up_of), req.ward.id);
      if (!original || original.entity_type !== b.entity_type || original.entity_id !== Number(b.entity_id)) errors.follow_up_of = 'The original inspection must be for the same record.';
    }
    // Keep only findings that have text. Responsible officers and team members must be members of this ward.
    const findings = Array.isArray(b.findings_list) ? b.findings_list.filter((f) => f && String(f.finding || '').trim()) : [];
    const members = new Set((await store.find('memberships', { ward_id: req.ward.id })).map((m) => m.user_id));
    const team = Array.isArray(b.team_ids) ? [...new Set(b.team_ids.map(Number))].filter((x) => x && x !== req.user.id) : [];
    if (team.some((x) => !members.has(x))) errors.team_ids = 'Team members must belong to this ward.';
    findings.forEach((f, idx) => {
      if (f.deadline && !isValidDate(f.deadline)) errors[`finding_${idx}`] = `Finding ${idx + 1}: enter a valid deadline.`;
      if (f.responsible_user_id && !members.has(Number(f.responsible_user_id))) errors[`finding_${idx}`] = `Finding ${idx + 1}: responsible officer must be in this ward.`;
    });
    if (Object.keys(errors).length) return bad(res, errors);

    // Save the inspection with its reference and the checklist version that was used.
    const checklist = await activeChecklist(b.entity_type);
    const inspectionId = await store.nextId('inspections');
    const t = nowIso();
    await store.db.collection('inspections').doc(String(inspectionId)).set({
      id: inspectionId, created_at: t, updated_at: t,
      ward_id: req.ward.id, entity_type: b.entity_type, entity_id: entity.id, inspection_date: b.inspection_date, inspection_time: b.inspection_time || null,
      reference: makeRef('INS', req.ward, inspectionId), purpose: b.purpose || (original ? 'follow_up' : 'routine'), follow_up_of: original?.id ?? null,
      officer_id: req.user.id, team_ids: team, departments: b.departments ? String(b.departments).slice(0, 500) : null,
      checklist_version: checklist?.version ?? null, checklist_results: Array.isArray(b.checklist_results) ? b.checklist_results : [],
      findings: b.findings || null, recommendations: b.recommendations || null, risk_level: b.risk_level || 'unknown', outcome: b.outcome || null,
      next_visit_due: b.next_visit_due || null, notice_required: b.notice_required ? 1 : 0
    });
    // Save each finding. With a deadline, a follow up is also created for the responsible officer.
    for (const f of findings) {
      const responsible = f.responsible_user_id ? Number(f.responsible_user_id) : req.user.id;
      const fid = await store.insert('inspection_findings', {
        inspection_id: inspectionId, ward_id: req.ward.id, finding: String(f.finding).trim(), required_action: f.required_action || null,
        deadline: f.deadline || null, responsible_user_id: responsible, responsible_party: f.responsible_party || null,
        status: f.deadline ? 'action_assigned' : 'open', resolved_at: null, history: []
      });
      if (f.deadline && b.create_follow_ups !== false) {
        await store.insert('follow_ups', {
          ward_id: req.ward.id, linked_entity_type: b.entity_type, linked_entity_id: entity.id, linked_inspection_id: inspectionId,
          linked_finding_id: fid, action_required: f.required_action || `Recheck: ${f.finding}`, responsible_user_id: responsible,
          due_date: f.deadline, status: 'open', outcome: null, outcome_notes: null, next_step: null, completed_at: null, created_by: req.user.id
        });
      }
    }
    // A revisit updates the findings of the original inspection that were rechecked.
    if (original && Array.isArray(b.recheck)) {
      for (const rc of b.recheck) {
        const f = await store.get('inspection_findings', Number(rc.finding_id));
        if (!f || f.inspection_id !== original.id || !FINDING_STATUSES.includes(rc.status)) continue;
        await store.update('inspection_findings', f.id, { status: rc.status, resolved_at: FINDING_DONE.includes(rc.status) ? nowIso() : null,
          history: [...(f.history || []), { at: nowIso(), by: req.user.id, from: f.status, to: rc.status, note: `Rechecked at revisit ${inspectionId}` }] });
      }
    }
    // The activity category that matches this type of inspection.
    const cat = (await store.find('categories', { module_group: b.entity_type })).find((c) => isActive(c.active));
    // Plan a revisit task at 9:00 on the next visit date.
    if (b.next_visit_due && b.create_next_visit_task !== false) {
      const tid = await store.insert('tasks', {
        ward_id: req.ward.id, title: `Revisit: ${entity[reg.nameField]}`, description: null, category_id: cat?.id ?? null,
        assigned_to: req.user.id, created_by: req.user.id, due_at: new Date(b.next_visit_due + 'T09:00:00+03:00').toISOString(),
        reminder_at: null, status: 'planned', priority: 'normal', purpose: 'follow_up', location_id: entity.location_id ?? null, linked_entity_type: b.entity_type,
        linked_entity_id: entity.id, linked_inspection_id: inspectionId, team_ids: [], status_reason: null, next_action: null, notes: null,
        completed_at: null, completed_by: null, deleted_at: null
      });
      await store.insert('task_history', { task_id: tid, user_id: req.user.id, at: nowIso(), field: 'created', old_value: null, new_value: b.next_visit_due, reason: null }, { timestamps: false });
    }
    // One activity record per inspection (unique claim): prevents double counting in reports.
    if (cat && (await store.claim(`activity_inspection_${inspectionId}`))) {
      await store.insert('activity_records', {
        ward_id: req.ward.id, category_id: cat.id, activity_date: b.inspection_date, recorded_by: req.user.id, location_id: entity.location_id ?? null,
        linked_entity_type: b.entity_type, linked_entity_id: entity.id, linked_inspection_id: inspectionId, linked_task_id: null,
        outcome: b.outcome || null, notes: null, quantity: 1, unit: 'visits', status: 'submitted', purpose: b.purpose || null, details: {}, deleted_at: null
      });
    }
    // Update the register's summary fields.
    if (b.entity_type === 'water_source') await store.update('water_sources', entity.id, { last_inspection_date: b.inspection_date, next_inspection_due: b.next_visit_due || entity.next_inspection_due || null });
    if (b.entity_type === 'household') await store.update('households', entity.id, { last_visit_date: b.inspection_date, follow_up_due: b.next_visit_due || entity.follow_up_due || null });
    if (b.entity_type === 'facility' && b.facility_status) {
      const upd = {};
      for (const k of FACILITY_STATUS_KEYS) if (b.facility_status[k] && REGISTERS.facility.fields[k].enum.includes(b.facility_status[k])) upd[k] = b.facility_status[k];
      if (Object.keys(upd).length) await store.update('healthcare_facilities', entity.id, upd);
    }
    // Other registers: the inspection can update the register's status field (for example school sanitation status).
    if (b.status_update && reg.statusField && b.entity_type !== 'facility' && reg.fields[reg.statusField]?.enum?.includes(b.status_update) && !(reg.leadOnly?.[reg.statusField] || []).includes(b.status_update)) {
      await store.update(reg.table, entity.id, { [reg.statusField]: b.status_update });
    }
    // A complaint that is being investigated moves to "under investigation".
    if (b.entity_type === 'complaint' && ['received', 'assigned'].includes(entity.status)) await store.update('complaints', entity.id, { status: 'under_investigation' });
    await audit(req, 'create', 'inspection', inspectionId, { entity_type: b.entity_type, entity_id: entity.id, findings: findings.length, follow_up_of: original?.id ?? null });
    res.status(201).json({ id: inspectionId });
  });

  // GET /api/inspections/:id/word downloads the inspection report as a .doc file that opens in Microsoft Word.
  r.get('/inspections/:id/word', async (req, res) => {
    const raw = await getInWard('inspections', req.params.id, req.ward.id);
    if (!raw) return res.status(404).json({ error: 'Inspection not found.' });
    const i = await inspectionDetail(req, raw);
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const row = (k, v) => `<tr><td style="width:35%;border:1px solid #999;padding:4px"><b>${esc(k)}</b></td><td style="border:1px solid #999;padding:4px">${esc(v || '')}</td></tr>`;
    const label = (s) => String(s || '').replace(/_/g, ' ');
    const checklist = i.checklist_results.map((c) => c.section_heading
      ? `<tr><td colspan="2" style="border:1px solid #999;padding:4px;background:#eee"><b>${esc(c.item)}</b></td></tr>`
      : `<tr><td style="border:1px solid #999;padding:4px">${esc(c.item)}</td><td style="border:1px solid #999;padding:4px">${esc(label(c.result))}${c.note ? ' (' + esc(c.note) + ')' : ''}</td></tr>`).join('');
    const findings = i.findings.map((f, k) => `<tr><td style="border:1px solid #999;padding:4px">${k + 1}. ${esc(f.finding)}</td><td style="border:1px solid #999;padding:4px">${esc(f.required_action)}</td><td style="border:1px solid #999;padding:4px">${esc(f.deadline)}</td><td style="border:1px solid #999;padding:4px">${esc(label(f.status))}</td></tr>`).join('');
    const html = `<html><head><meta charset="utf-8"><title>${esc(i.reference)}</title></head><body style="font-family:Calibri,Arial;font-size:11pt">
<h2 style="margin:0">SANITARY INSPECTION REPORT</h2><p style="margin:2px 0 12px">${esc(i.ward_name)} · Reference ${esc(i.reference || '')}</p>
<table style="border-collapse:collapse;width:100%">${row('Record inspected', `${i.entity_name} (${label(i.entity_type)})`)}${row('Location', i.entity_location)}${row('Date and time', `${i.inspection_date} ${i.inspection_time || ''}`)}
${row('Purpose', label(i.purpose))}${row('Officer', i.officer_name)}${row('Team', i.team_names.join(', '))}${row('Risk', label(i.risk_level))}${row('Outcome', i.outcome)}${row('Next visit', i.next_visit_due)}</table>
<h3>Checklist (version ${esc(i.checklist_version ?? '')})</h3><table style="border-collapse:collapse;width:100%">${checklist || row('No checklist recorded', '')}</table>
<h3>Observations</h3><p>${esc(i.observations).replace(/\n/g, '<br>')}</p>
<h3>Findings and corrective actions</h3><table style="border-collapse:collapse;width:100%"><tr><th style="border:1px solid #999">Finding</th><th style="border:1px solid #999">Required action</th><th style="border:1px solid #999">Deadline</th><th style="border:1px solid #999">Status</th></tr>${findings}</table>
<h3>Recommendations</h3><p>${esc(i.recommendations).replace(/\n/g, '<br>')}</p>
<h3>Acknowledgement</h3><p>Inspecting officer: ${esc(i.officer_name)} &nbsp; Signature: ______________ &nbsp; Date: __________</p>
<p>Received by (owner / manager): ______________________ &nbsp; Signature: ______________ &nbsp; Date: __________</p>
</body></html>`;
    await audit(req, 'export', 'inspection', i.id, { format: 'word' });
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="${String(i.reference || 'inspection-' + i.id).replace(/\//g, '-')}.doc"`);
    res.send(html);
  });

  // PATCH /api/findings/:id moves a finding through its workflow and keeps a history of each change.
  r.patch('/findings/:id', requireRole('officer'), async (req, res) => {
    const f = await store.get('inspection_findings', req.params.id);
    const insp = f ? await store.get('inspections', f.inspection_id) : null;
    if (!f || !insp || insp.ward_id !== req.ward.id) return res.status(404).json({ error: 'Finding not found.' });
    const st = req.body?.status, note = String(req.body?.note || '').trim();
    if (!FINDING_STATUSES.includes(st)) return bad(res, { status: 'Choose a valid status.' });
    // Verifying, closing and escalating are supervisory steps; escalations and "not complied" need a note.
    if (['verified', 'closed', 'escalated'].includes(st) && !isLead(req) && f.responsible_user_id !== req.user.id) return res.status(403).json({ error: 'Only the responsible officer or the ward lead can verify, close or escalate a finding.' });
    if (['escalated', 'not_complied'].includes(st) && !note) return bad(res, { note: 'Add a note explaining the decision.' });
    await store.update('inspection_findings', f.id, { status: st, resolved_at: FINDING_DONE.includes(st) ? nowIso() : null,
      history: [...(f.history || []), { at: nowIso(), by: req.user.id, from: f.status, to: st, note: note || null }] });
    await audit(req, 'status_change', 'inspection_finding', f.id, { from: f.status, to: st, note });
    res.json({ ok: true });
  });

  // ---------- Notice drafts ----------
  // Replaces {{name}} placeholders in a template with real values. Missing values show as [name].
  const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `[${k}]`);
  // Formats a date like 19 October 2026.
  const fmtDate = (d) => d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '[date]';

  // GET /api/notices lists notice drafts in the ward, newest first, with optional status filter.
  r.get('/notices', async (req, res) => {
    const L = loader(store, req);
    let rows = await store.find('notice_drafts', { ward_id: req.ward.id });
    if (req.query.status) rows = rows.filter((n) => n.status === req.query.status);
    const [users, templates] = await Promise.all([L.users(), store.byId('notice_templates')]);
    const out = [];
    for (const n of sortBy(rows, '-id')) {
      out.push({ id: n.id, draft_reference: n.draft_reference, status: n.status, notice_type: n.notice_type ?? null, recipient: n.recipient, linked_entity_type: n.linked_entity_type,
        linked_entity_id: n.linked_entity_id, compliance_deadline: n.compliance_deadline, created_at: n.created_at,
        overdue: ['served', 'issued'].includes(n.status) && n.compliance_deadline && n.compliance_deadline < todayNairobi(),
        template_name: templates.get(n.template_id)?.name ?? null, prepared_by_name: users.get(n.prepared_by)?.full_name ?? null,
        entity_name: await L.entityName(n.linked_entity_type, n.linked_entity_id) });
    }
    res.json(out);
  });

  // GET /api/notices/:id returns one notice with names for display.
  r.get('/notices/:id', async (req, res) => {
    const L = loader(store, req);
    const n = await getInWard('notice_drafts', req.params.id, req.ward.id);
    if (!n) return res.status(404).json({ error: 'Notice not found.' });
    const [users, tpl] = await Promise.all([L.users(), store.get('notice_templates', n.template_id)]);
    res.json({ ...n, template_name: tpl?.name ?? null, prepared_by_name: users.get(n.prepared_by)?.full_name ?? null,
      reviewed_by_name: users.get(n.reviewed_by)?.full_name ?? null, entity_name: await L.entityName(n.linked_entity_type, n.linked_entity_id),
      timeline: (n.timeline || []).map((x) => ({ ...x, by_name: users.get(x.by)?.full_name ?? null })) });
  });

  // POST /api/notices creates a notice draft from an approved template.
  r.post('/notices', requireRole('officer'), async (req, res) => {
    const b = req.body || {}, errors = {};
    const tpl = await store.get('notice_templates', Number(b.template_id) || 0);
    if (!tpl || !isActive(tpl.active) || !isActive(tpl.approved)) errors.template_id = 'Choose an approved template.';
    if (b.linked_entity_type && !ENTITY_TYPES.includes(b.linked_entity_type)) errors.linked_entity_type = 'Unknown record type.';
    const reg = REGISTERS[b.linked_entity_type];
    const entity = reg ? await getInWard(reg.table, Number(b.linked_entity_id) || 0, req.ward.id) : null;
    if (reg && !entity) errors.linked_entity_id = 'Linked record not found.';
    if (b.compliance_deadline && !isValidDate(b.compliance_deadline)) errors.compliance_deadline = 'Enter a valid compliance deadline.';
    if (!String(b.recipient || '').trim()) errors.recipient = 'Recipient is required so the notice is addressed correctly.';
    if (Object.keys(errors).length) return bad(res, errors);
    // Location text for the notice, for example "Mwamambi, Ukunda".
    const loc = entity?.location_id ? await store.get('locations', entity.location_id) : null;
    // Reference number like DRAFT/KND/2026/0007. It changes to NTC/... when approved.
    const id = await store.nextId('notice_drafts');
    const ref = makeRef('DRAFT', req.ward, id);
    // Fill the template with the real details.
    const content = fill(tpl.body, {
      reference: ref, recipient: b.recipient, entity_name: entity ? entity[reg.nameField] : '[premises]',
      location: loc ? [loc.village, loc.sub_location].filter(Boolean).join(', ') : '[location]', findings: b.findings || '[findings]',
      corrective_action: b.corrective_action || '[corrective action]', compliance_deadline: fmtDate(b.compliance_deadline),
      legal_provision: b.legal_provision || '[legal provision to be confirmed]', notice_type: b.notice_type || '',
      officer_name: req.user.full_name, ward: req.ward.name, date: fmtDate(todayNairobi())
    });
    const t = nowIso();
    // Saved with set() because the id was reserved above to build the reference.
    await store.db.collection('notice_drafts').doc(String(id)).set({
      id, ward_id: req.ward.id, linked_entity_type: b.linked_entity_type || null, linked_entity_id: entity?.id ?? null,
      inspection_id: b.inspection_id ? Number(b.inspection_id) : null, template_id: tpl.id, draft_reference: ref, recipient: b.recipient,
      notice_type: b.notice_type || null, legal_provision: b.legal_provision || null,
      findings: b.findings || null, corrective_action: b.corrective_action || null, compliance_deadline: b.compliance_deadline || null,
      content, version: 1, prepared_by: req.user.id, reviewed_by: null, status: 'draft', issue_date: null, service_date: null,
      service_method: null, service_notes: null, served_to: null, proof_of_service: null, compliance_result: null, compliance_date: null,
      compliance_notes: null, escalated_to: null, timeline: [{ at: t, by: req.user.id, status: 'draft', note: 'Draft created' }], created_at: t, updated_at: t
    });
    await audit(req, 'create', 'notice_draft', id, { template: tpl.name, ref });
    res.status(201).json({ id });
  });

  // PATCH /api/notices/:id edits the text of a draft. Submitted and approved notices are locked.
  r.patch('/notices/:id', requireRole('officer'), async (req, res) => {
    const n = await getInWard('notice_drafts', req.params.id, req.ward.id);
    if (!n) return res.status(404).json({ error: 'Notice not found.' });
    if (n.status !== 'draft') return res.status(409).json({ error: 'Only drafts can be edited. Submitted and approved notices are locked.' });
    const content = String(req.body?.content ?? '').trim();
    if (!content) return bad(res, { content: 'Notice content cannot be empty.' });
    await store.update('notice_drafts', n.id, { content, version: (n.version || 1) + 1 });
    await audit(req, 'update', 'notice_draft', n.id, { version: (n.version || 1) + 1 });
    res.json({ ok: true });
  });

  // Status transitions, each recorded only when the real action happened:
  // draft -> submitted (officer) -> approved (ward lead) -> issued -> served -> complied / partly / not complied -> closed or escalated.
  r.post('/notices/:id/:action(submit|return|approve|issue|serve|compliance|close|escalate|withdraw)', requireRole('officer'), async (req, res) => {
    const n = await getInWard('notice_drafts', req.params.id, req.ward.id);
    if (!n) return res.status(404).json({ error: 'Notice not found.' });
    const a = req.params.action, b = req.body || {}, today = todayNairobi();
    const upd = {};
    let note = b.note ? String(b.note).trim() : null;
    if (a === 'submit') {
      // Submit for approval: the text is locked until the ward lead approves or returns it.
      if (n.status !== 'draft') return res.status(409).json({ error: 'Only drafts can be submitted for approval.' });
      upd.status = 'submitted';
    } else if (a === 'return') {
      // Return to the officer with comments (ward lead only).
      if (!isLead(req)) return res.status(403).json({ error: 'Only the ward lead can return a notice.' });
      if (n.status !== 'submitted') return res.status(409).json({ error: 'Only submitted notices can be returned.' });
      if (!note) return bad(res, { note: 'Explain what must be changed.' });
      upd.status = 'draft';
    } else if (a === 'approve') {
      // Approve (ward lead only). The DRAFT reference becomes NTC.
      if (!isLead(req)) return res.status(403).json({ error: 'Only the ward lead can approve a notice.' });
      if (!['draft', 'submitted'].includes(n.status)) return res.status(409).json({ error: 'Only drafts or submitted notices can be approved.' });
      const ref = n.draft_reference.replace(/^DRAFT\//, 'NTC/');
      Object.assign(upd, { status: 'approved', reviewed_by: req.user.id, draft_reference: ref, content: String(n.content || '').split(n.draft_reference).join(ref) });
    } else if (a === 'issue') {
      // Issue: only after approval, with the real issue date.
      if (n.status !== 'approved') return res.status(409).json({ error: 'A notice must be approved before it can be recorded as issued.' });
      if (!isValidDate(b.issue_date || '') || b.issue_date > today) return bad(res, { issue_date: 'Enter the actual issue date (not in the future).' });
      Object.assign(upd, { status: 'issued', issue_date: b.issue_date });
    } else if (a === 'serve') {
      // Serve: only after issue, with the real service date, method, who received it and proof of service.
      if (n.status !== 'issued') return res.status(409).json({ error: 'Record the issue first. Service is recorded only after the notice was actually served.' });
      const errs = {};
      if (!isValidDate(b.service_date || '') || b.service_date > today) errs.service_date = 'Enter the actual service date (not in the future).';
      else if (b.service_date < n.issue_date) errs.service_date = 'Service date cannot be before the issue date.';
      if (!String(b.service_method || '').trim()) errs.service_method = 'Record how the notice was served.';
      if (Object.keys(errs).length) return bad(res, errs);
      Object.assign(upd, { status: 'served', service_date: b.service_date, service_method: b.service_method, served_to: b.served_to || null,
        proof_of_service: b.proof_of_service || null, service_notes: b.service_notes || null });
    } else if (a === 'compliance') {
      // Compliance check after the deadline: complied, partly complied or not complied.
      if (!['served', 'partly_complied', 'not_complied'].includes(n.status)) return res.status(409).json({ error: 'Compliance is recorded after the notice has been served.' });
      if (!['complied', 'partly_complied', 'not_complied'].includes(b.result)) return bad(res, { result: 'Choose complied, partly complied or not complied.' });
      if (!isValidDate(b.check_date || '') || b.check_date > today) return bad(res, { check_date: 'Enter the date compliance was checked.' });
      Object.assign(upd, { status: b.result, compliance_result: b.result, compliance_date: b.check_date, compliance_notes: b.notes || null });
      note = b.notes || null;
      // Not fully complied: optionally create a follow up for a recheck.
      if (b.result !== 'complied' && isValidDate(b.next_check_date || '')) {
        await store.insert('follow_ups', {
          ward_id: n.ward_id, linked_entity_type: n.linked_entity_type, linked_entity_id: n.linked_entity_id, linked_inspection_id: n.inspection_id ?? null,
          linked_finding_id: null, linked_notice_id: n.id, action_required: `Recheck compliance with notice ${n.draft_reference}`, responsible_user_id: req.user.id,
          due_date: b.next_check_date, status: 'open', outcome: null, outcome_notes: null, next_step: null, completed_at: null, created_by: req.user.id
        });
      }
    } else if (a === 'close') {
      if (!['complied', 'partly_complied', 'not_complied', 'served', 'escalated'].includes(n.status)) return res.status(409).json({ error: 'Only served notices can be closed.' });
      upd.status = 'closed';
    } else if (a === 'escalate') {
      // Escalate to a supervisor, legal office, police, court or other authority (ward lead).
      if (!isLead(req)) return res.status(403).json({ error: 'Only the ward lead can escalate a notice.' });
      if (!['served', 'partly_complied', 'not_complied'].includes(n.status)) return res.status(409).json({ error: 'Only served notices that were not fully complied with can be escalated.' });
      if (!String(b.escalated_to || '').trim()) return bad(res, { escalated_to: 'Record who the case was referred to.' });
      Object.assign(upd, { status: 'escalated', escalated_to: b.escalated_to });
    } else if (a === 'withdraw') {
      // Withdraw: by the ward lead or the officer who prepared it, unless already served.
      if (!isLead(req) && n.prepared_by !== req.user.id) return res.status(403).json({ error: 'Not permitted.' });
      if (!['draft', 'submitted', 'approved', 'issued'].includes(n.status)) return res.status(409).json({ error: 'A served notice cannot be withdrawn here.' });
      upd.status = 'withdrawn';
    }
    upd.timeline = [...(n.timeline || []), { at: nowIso(), by: req.user.id, status: upd.status, note }];
    await store.update('notice_drafts', n.id, upd);
    await audit(req, `notice_${a}`, 'notice_draft', n.id, { ...b, from: n.status, to: upd.status });
    res.json({ ok: true });
  });

  // Word export (HTML based .doc that opens in Microsoft Word / LibreOffice)
  r.get('/notices/:id/word', async (req, res) => {
    const n = await getInWard('notice_drafts', req.params.id, req.ward.id);
    if (!n) return res.status(404).json({ error: 'Notice not found.' });
    // Escape special characters so the notice text cannot break the HTML.
    const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    // Notices that are not approved carry a clear warning at the top.
    const banner = ['draft', 'submitted'].includes(n.status) ? '<p style="color:#b45309;font-weight:bold">DRAFT: NOT APPROVED. NOT FOR SERVICE.</p>' : '';
    const html = `<html><head><meta charset="utf-8"><title>${esc(n.draft_reference)}</title></head><body style="font-family:Calibri,Arial;font-size:12pt">${banner}${esc(n.content).replace(/\n/g, '<br>')}</body></html>`;
    await audit(req, 'export', 'notice_draft', n.id, { format: 'word' });
    // Tell the browser this is a Word file to download.
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="${n.draft_reference.replace(/\//g, '-')}.doc"`);
    res.send(html);
  });

  // ---------- Attachments (photos and documents) ----------
  // Finds the record an attachment belongs to and checks it is in the user's ward.
  const attachTarget = async (req, type, id) => {
    const table = REGISTERS[type]?.table || ATTACH_TABLES[type];
    if (!table) return null;
    return getInWard(table, Number(id) || 0, req.ward.id);
  };

  // GET /api/attachments?entity_type=...&entity_id=... lists attachments (without the file data).
  r.get('/attachments', async (req, res) => {
    const { entity_type: type, entity_id: id } = req.query;
    if (!(await attachTarget(req, type, id))) return res.status(404).json({ error: 'Record not found.' });
    const users = await store.byId('users');
    const rows = await store.find('attachments', { entity_type: type, entity_id: Number(id) });
    res.json(sortBy(rows, '-id').map(({ data, ...a }) => ({ ...a, uploaded_by_name: users.get(a.uploaded_by)?.full_name ?? null })));
  });

  // GET /api/attachments/:id/file returns the file itself (shown in the browser or downloaded).
  r.get('/attachments/:id/file', async (req, res) => {
    const a = await store.get('attachments', req.params.id);
    if (!a || a.ward_id !== req.ward.id) return res.status(404).json({ error: 'Attachment not found.' });
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${String(a.name).replace(/[^\w.\- ]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(a.data, 'base64'));
  });

  // POST /api/attachments with { entity_type, entity_id, name, mime, data (base64), caption } saves a photo or PDF.
  r.post('/attachments', requireRole('officer'), async (req, res) => {
    const b = req.body || {};
    if (!(await attachTarget(req, b.entity_type, b.entity_id))) return res.status(404).json({ error: 'Record not found.' });
    if (!ATTACH_TYPES.test(String(b.mime || ''))) return bad(res, { file: 'Only photos (JPEG, PNG, WebP) and PDF files can be attached.' });
    const data = String(b.data || '').replace(/^data:[^,]+,/, '');
    const size = Math.floor((data.length * 3) / 4);
    if (!data || size > MAX_ATTACHMENT_BYTES) return bad(res, { file: `The file is too large. The limit is ${Math.round(MAX_ATTACHMENT_BYTES / 1024)} KB.` });
    const id = await store.insert('attachments', {
      ward_id: req.ward.id, entity_type: b.entity_type, entity_id: Number(b.entity_id), name: String(b.name || 'attachment').slice(0, 120),
      mime: b.mime, size, caption: b.caption ? String(b.caption).slice(0, 300) : null, uploaded_by: req.user.id, data
    });
    await audit(req, 'create', 'attachment', id, { entity_type: b.entity_type, entity_id: Number(b.entity_id), name: b.name, size });
    res.status(201).json({ id });
  });

  // DELETE /api/attachments/:id removes an attachment (the uploader or the ward lead). The removal is logged.
  r.delete('/attachments/:id', requireRole('officer'), async (req, res) => {
    const a = await store.get('attachments', req.params.id);
    if (!a || a.ward_id !== req.ward.id) return res.status(404).json({ error: 'Attachment not found.' });
    if (!isLead(req) && a.uploaded_by !== req.user.id) return res.status(403).json({ error: 'Only the person who added it or the ward lead can remove it.' });
    await store.remove('attachments', a.id);
    await audit(req, 'delete', 'attachment', a.id, { entity_type: a.entity_type, entity_id: a.entity_id, name: a.name });
    res.json({ ok: true });
  });

  return r;
}
