// Builds the weekly, monthly, quarterly and annual activity reports, the list of records behind each number,
// and the CSV export.
import { achievementPct, todayNairobi, nairobiDayBoundsIso, nowIso, weekRange, monthRange } from './util.js';
import { isValidDate } from './registers.js';
import { sortBy, isActive } from './store.js';
import { PILLARS } from './catalogue.js';

// Task statuses that still need work.
const OPEN = ['planned', 'assigned', 'in_progress', 'postponed'];
// Finding statuses that count as finished.
const FINDING_DONE = ['verified', 'closed', 'resolved'];
// True when a YYYY-MM-DD date is between start and end (both included).
const inRange = (d, start, end) => d != null && d >= start && d <= end;
// Activity records count once submitted (drafts and deleted records are left out).
const counted = (a) => !a.deleted_at && (a.status || 'submitted') !== 'draft';
// Counts rows per value of a field, for example { valid: 4, expired: 2 }.
const countBy = (rows, key) => {
  const out = {};
  for (const r of rows) { const k = r[key] ?? 'unknown'; out[k] = (out[k] || 0) + 1; }
  return out;
};

// Start and end dates of a report or target period.
//   weekly    any date in the week (Monday to Sunday)
//   monthly   YYYY-MM
//   quarterly YYYY-Q1 to YYYY-Q4 (January to March is Q1)
//   annual    YYYY (January to December)
export function periodRange(type, { date, month, quarter, year } = {}) {
  if (type === 'weekly') return isValidDate(date || '') ? weekRange(date) : null;
  if (type === 'monthly') return /^\d{4}-\d{2}$/.test(month || '') ? monthRange(month) : null;
  if (type === 'quarterly') {
    const m = /^(\d{4})-Q([1-4])$/.exec(quarter || '');
    if (!m) return null;
    const first = (Number(m[2]) - 1) * 3 + 1;
    return { start: monthRange(`${m[1]}-${String(first).padStart(2, '0')}`).start, end: monthRange(`${m[1]}-${String(first + 2).padStart(2, '0')}`).end };
  }
  if (type === 'annual') return /^\d{4}$/.test(String(year || '')) ? { start: `${year}-01-01`, end: `${year}-12-31` } : null;
  return null;
}

// Builds the full report for one ward and period.
// scopeUserId = null means the whole ward, otherwise only that officer's work.
export async function buildReport(store, { wardId, type, start, end, scopeUserId = null }) {
  const today = todayNairobi();
  const now = nowIso();
  // Start and end of the period as UTC times, for comparing with completed_at and due_at.
  const { s: startIso, e: endIso } = nairobiDayBoundsIso(start, end);
  const w = { ward_id: wardId };
  // Load every collection the report needs, all at the same time.
  const [cats, users, locs, actsAll, targetsAll, tasksAll, fusAll, inspections, premises, handlers, households, sources, samples, facilities, schools, complaints, events, notices] = await Promise.all([
    store.byId('categories'), store.byId('users'), store.byId('locations', w), store.find('activity_records', w),
    store.find('targets', { ward_id: wardId, period_type: type }), store.find('tasks', w), store.find('follow_ups', w),
    store.find('inspections', w), store.find('food_premises', w), store.find('food_handlers', w), store.find('households', w),
    store.find('water_sources', w), store.find('water_samples', w), store.find('healthcare_facilities', w),
    store.find('schools', w), store.find('complaints', w), store.find('events', w), store.find('notice_drafts', w)
  ]);
  // Officer name by id.
  const uname = (id) => users.get(id)?.full_name ?? null;
  const pillarOf = (catId) => cats.get(catId)?.pillar || 'N';

  // 1. Activity records in the period (source of all achievement counts; each record counted once; drafts left out).
  const acts = actsAll.filter((a) => counted(a) && inRange(a.activity_date, start, end) && (!scopeUserId || a.recorded_by === scopeUserId));
  // Add up records, quantity and people reached per category.
  const byCat = new Map();
  const newRow = (id) => ({ category_id: id, category: cats.get(id)?.name ?? 'Unknown', pillar: pillarOf(id), unit: cats.get(id)?.unit || 'activities', records: 0, quantity: 0, people_reached: 0, target: null });
  for (const a of acts) {
    const row = byCat.get(a.category_id) || newRow(a.category_id);
    row.records += 1;
    row.quantity += Number(a.quantity) || 0;
    row.people_reached += Number(a.people_reached) || 0;
    byCat.set(a.category_id, row);
  }
  // 2. Targets overlapping the period, for this scope. Ward reports use ward targets, officer reports use that officer's targets.
  for (const t of targetsAll) {
    if (!(t.period_start <= end && t.period_end >= start)) continue;
    if (scopeUserId ? t.user_id !== scopeUserId : t.user_id != null) continue;
    const row = byCat.get(t.category_id) || newRow(t.category_id);
    row.target = (row.target || 0) + Number(t.target_value);
    byCat.set(t.category_id, row);
  }
  // Work out the achievement percentage and sort categories by pillar and name.
  const activities = [...byCat.values()]
    .map((r) => ({ ...r, achievement_pct: achievementPct(r.quantity, r.target) }))
    .sort((a, b) => a.pillar.localeCompare(b.pillar) || a.category.localeCompare(b.category));

  // Totals per public health pillar (used most in quarterly and annual reports).
  const pillarMap = new Map();
  for (const r of activities) {
    const p = pillarMap.get(r.pillar) || { pillar: r.pillar, name: PILLARS[r.pillar] || 'Other', records: 0, quantity: 0, people_reached: 0, categories: 0 };
    p.records += r.records; p.quantity += r.quantity; p.people_reached += r.people_reached; if (r.records) p.categories += 1;
    pillarMap.set(r.pillar, p);
  }
  const pillars = [...pillarMap.values()].filter((p) => p.records).sort((a, b) => a.pillar.localeCompare(b.pillar));

  // 3. Tasks: completed in period, pending (open, due in period, not overdue), overdue (open and past due). Drafts are left out.
  const tasks = tasksAll.filter((t) => !t.deleted_at && t.status !== 'draft' && (!scopeUserId || t.assigned_to === scopeUserId || (t.team_ids || []).includes(scopeUserId)));
  // The task details shown in the report tables.
  const taskRow = (t) => ({ id: t.id, title: t.title, due_at: t.due_at, status: t.status, status_reason: t.status_reason ?? null,
    assigned_name: uname(t.assigned_to), category: cats.get(t.category_id)?.name ?? null });
  const completedTasks = tasks.filter((t) => t.status === 'completed' && t.completed_at >= startIso && t.completed_at < endIso).length;
  const pendingTasks = sortBy(tasks.filter((t) => OPEN.includes(t.status) && t.due_at >= now && t.due_at < endIso), 'due_at').map(taskRow);
  const overdueTasks = sortBy(tasks.filter((t) => OPEN.includes(t.status) && t.due_at < now && t.due_at < endIso), 'due_at').map(taskRow);

  // 4. Follow ups of the chosen scope, counted by due, completed, overdue and upcoming.
  const fus = fusAll.filter((f) => !scopeUserId || f.responsible_user_id === scopeUserId);
  const fuRow = (f) => ({ id: f.id, action_required: f.action_required, due_date: f.due_date, status: f.status, outcome: f.outcome ?? null,
    linked_entity_type: f.linked_entity_type ?? null, linked_entity_id: f.linked_entity_id ?? null, responsible_name: uname(f.responsible_user_id) });
  const followUps = {
    due_in_period: fus.filter((f) => inRange(f.due_date, start, end)).length,
    completed_in_period: fus.filter((f) => f.status === 'completed' && f.completed_at >= startIso && f.completed_at < endIso).length,
    overdue: sortBy(fus.filter((f) => f.status === 'open' && f.due_date < today && f.due_date <= end), 'due_date').map(fuRow),
    upcoming: sortBy(fus.filter((f) => f.status === 'open' && f.due_date >= today && inRange(f.due_date, start, end)), 'due_date').map(fuRow)
  };

  // 5. Number of activity records per officer (most active first) and per sub location.
  const offMap = new Map();
  for (const a of acts) {
    const o = offMap.get(a.recorded_by) || { id: a.recorded_by, full_name: uname(a.recorded_by), records: 0, quantity: 0 };
    o.records += 1; o.quantity += Number(a.quantity) || 0;
    offMap.set(a.recorded_by, o);
  }
  const officers = [...offMap.values()].sort((a, b) => b.records - a.records || String(a.full_name).localeCompare(String(b.full_name)));
  const locMap = new Map();
  for (const a of acts) {
    const name = locs.get(a.location_id)?.sub_location || 'Not specified';
    locMap.set(name, (locMap.get(name) || 0) + 1);
  }
  const locations = [...locMap].map(([sub_location, records]) => ({ sub_location, records })).sort((a, b) => b.records - a.records || a.sub_location.localeCompare(b.sub_location));

  // 6. Register summaries.
  // Inspection visits and number of different entries inspected in the period, for one register type.
  const insp = (type) => {
    const rows = inspections.filter((i) => i.entity_type === type && inRange(i.inspection_date, start, end) && (!scopeUserId || i.officer_id === scopeUserId || (i.team_ids || []).includes(scopeUserId)));
    return { visits: rows.length, entities: new Set(rows.map((i) => i.entity_id)).size };
  };
  // Open follow ups past their due date, for one register type.
  const overdueFu = (type) => fusAll.filter((f) => f.linked_entity_type === type && f.status === 'open' && f.due_date < today).length;
  // Only active register entries are counted.
  const active = (rows) => rows.filter((x) => isActive(x.active));

  // Food premises: totals, inspections, licence status and expired licences.
  const ap = active(premises);
  const premisesSummary = {
    total_active: ap.length,
    inspected_in_period: insp('premises').entities,
    inspection_visits: insp('premises').visits,
    licence_status: countBy(ap, 'licence_status'),
    licence_expired_by_date: ap.filter((p) => p.licence_expiry_date && p.licence_expiry_date < today).length,
    overdue_follow_ups: overdueFu('premises')
  };
  // Food handlers: medical certificates current, expired or not recorded.
  const ah = active(handlers);
  const handlersSummary = {
    total_registered: ah.length,
    certificate_current: ah.filter((h) => h.certificate_expiry && h.certificate_expiry >= today).length,
    certificate_expired: ah.filter((h) => h.certificate_expiry && h.certificate_expiry < today).length,
    expiry_not_recorded: ah.filter((h) => !h.certificate_expiry).length,
    medical_pending: ah.filter((h) => h.status === 'pending').length
  };
  // Households: sanitation status, count per sub location and those needing follow up.
  const ahh = active(households);
  const byLoc = new Map();
  for (const h of ahh) { const n = locs.get(h.location_id)?.sub_location || 'Not specified'; byLoc.set(n, (byLoc.get(n) || 0) + 1); }
  const householdsSummary = {
    total_recorded: ahh.length,
    by_sanitation_status: countBy(ahh, 'sanitation_status'),
    by_location: [...byLoc].map(([sub_location, n]) => ({ sub_location, n })).sort((a, b) => a.sub_location.localeCompare(b.sub_location)),
    needing_follow_up: ahh.filter((h) => ['needs_improvement', 'inadequate', 'none'].includes(h.sanitation_status) || (h.follow_up_due && h.follow_up_due <= end)).length,
    visits_in_period: insp('household').visits,
    coverage_note: 'Based on registered household records only.'
  };
  // Water: sources, inspections, samples collected and their results (planned samples are not counted as collected).
  const sm = samples.filter((x) => (x.stage || 'collected') !== 'planned' && (!scopeUserId || x.recorded_by === scopeUserId));
  const water = {
    sources_registered: active(sources).length,
    sources_inspected: insp('water_source').entities,
    inspection_visits: insp('water_source').visits,
    samples_collected: sm.filter((x) => inRange(x.collection_date, start, end)).length,
    results_pending: sm.filter((x) => x.compliance_status === 'pending_result' && x.collection_date <= end).length,
    compliant: sm.filter((x) => x.compliance_status === 'compliant' && inRange(x.collection_date, start, end)).length,
    non_compliant: sm.filter((x) => x.compliance_status === 'non_compliant' && inRange(x.collection_date, start, end)).length,
    overdue_actions: samples.filter((x) => x.next_action_due && x.next_action_due < today && ['pending_result', 'non_compliant'].includes(x.compliance_status)).length + overdueFu('water_source')
  };
  // Health facilities: inspections, deficiencies found and outstanding corrective actions.
  const findingsOf = new Map();
  for (const i of inspections) findingsOf.set(i.id, await store.find('inspection_findings', { inspection_id: i.id }));
  const facFindings = inspections.filter((i) => i.entity_type === 'facility').flatMap((i) => (findingsOf.get(i.id) || []).map((f) => ({ ...f, inspection_date: i.inspection_date })));
  const af = active(facilities);
  const facilitiesSummary = {
    total_active: af.length,
    inspected_in_period: insp('facility').entities,
    inspection_visits: insp('facility').visits,
    deficiencies_recorded: facFindings.filter((f) => inRange(f.inspection_date, start, end)).length,
    outstanding_corrective_actions: facFindings.filter((f) => !FINDING_DONE.includes(f.status)).length,
    overdue_follow_ups: overdueFu('facility'),
    incinerator_status: countBy(af, 'incinerator_status')
  };
  // Schools: registered, inspected and sanitation status.
  const as = active(schools);
  const schoolsSummary = {
    total_registered: as.length,
    inspected_in_period: insp('school').entities,
    inspection_visits: insp('school').visits,
    by_sanitation_status: countBy(as, 'sanitation_status'),
    overdue_follow_ups: overdueFu('school')
  };
  // Complaints: received in the period, open and resolved, and by status.
  const ac = active(complaints).filter((c) => !scopeUserId || c.assigned_officer_id === scopeUserId);
  const complaintsSummary = {
    received_in_period: ac.filter((c) => inRange(c.received_date, start, end)).length,
    open: ac.filter((c) => !['resolved', 'closed'].includes(c.status)).length,
    resolved_or_closed: ac.filter((c) => ['resolved', 'closed'].includes(c.status)).length,
    by_status: countBy(ac, 'status')
  };
  // Notices: drafted, served and compliance results in the period.
  const noticesSummary = {
    drafted_in_period: notices.filter((n) => inRange(String(n.created_at || '').slice(0, 10), start, end)).length,
    awaiting_approval: notices.filter((n) => n.status === 'submitted').length,
    served_in_period: notices.filter((n) => inRange(n.service_date, start, end)).length,
    compliance_checked_in_period: notices.filter((n) => inRange(n.compliance_date, start, end)).length,
    by_status: countBy(notices, 'status')
  };
  // Events: reviewed and inspected.
  const eventsSummary = { events_registered: active(events).length, inspected_in_period: insp('event').entities, by_review_status: countBy(active(events), 'review_status') };

  // 7. Notable issues: unresolved findings with a deadline up to the end of the period, earliest deadline first.
  const issues = [];
  for (const i of inspections) {
    if (scopeUserId && i.officer_id !== scopeUserId) continue;
    for (const f of findingsOf.get(i.id) || []) {
      if (!FINDING_DONE.includes(f.status) && (!f.deadline || f.deadline <= end)) {
        issues.push({ id: f.id, finding: f.finding, required_action: f.required_action ?? null, deadline: f.deadline ?? null, status: f.status,
          entity_type: i.entity_type, entity_id: i.entity_id, inspection_id: i.id });
      }
    }
  }
  issues.sort((a, b) => String(a.deadline ?? '').localeCompare(String(b.deadline ?? '')));

  // The final report object sent to the Reports page and used for the CSV export.
  return {
    meta: { type, start, end, generated_at: now, approved: false, counting_rule: 'Achievements count submitted activity records dated within the period. Each record is counted once. Drafts are not counted. Planned tasks, distinct registered entities, inspection visits, samples, notices and people reached are counted separately.' },
    activities,
    pillars,
    totals: { activity_records: activities.reduce((s, r) => s + r.records, 0), quantity: activities.reduce((s, r) => s + r.quantity, 0), people_reached: activities.reduce((s, r) => s + r.people_reached, 0) },
    tasks: { completed: completedTasks, pending: pendingTasks, overdue: overdueTasks },
    follow_ups: followUps,
    officers, locations,
    registers: { premises: premisesSummary, handlers: handlersSummary, households: householdsSummary, water, facilities: facilitiesSummary, schools: schoolsSummary, complaints: complaintsSummary, notices: noticesSummary, events: eventsSummary },
    issues: issues.slice(0, 25)
  };
}

// Lists the individual activity records behind a report number, so a lead can check where it came from.
export async function sourceRecords(store, { wardId, categoryId, pillar = null, start, end, scopeUserId = null }) {
  const [rows, users, cats, locs] = await Promise.all([
    store.find('activity_records', { ward_id: wardId }), store.byId('users'), store.byId('categories'), store.byId('locations', { ward_id: wardId })
  ]);
  return sortBy(rows.filter((a) => counted(a) && inRange(a.activity_date, start, end) && (!categoryId || a.category_id === categoryId)
    && (!pillar || (cats.get(a.category_id)?.pillar || 'N') === pillar) && (!scopeUserId || a.recorded_by === scopeUserId)), 'activity_date', 'id')
    .map((a) => ({ id: a.id, activity_date: a.activity_date, outcome: a.outcome ?? null, notes: a.notes ?? null, quantity: a.quantity, unit: a.unit,
      people_reached: a.people_reached ?? null, linked_task_id: a.linked_task_id ?? null, linked_entity_type: a.linked_entity_type ?? null, linked_entity_id: a.linked_entity_id ?? null,
      linked_inspection_id: a.linked_inspection_id ?? null, recorded_by_name: users.get(a.recorded_by)?.full_name ?? null,
      category: cats.get(a.category_id)?.name ?? null, sub_location: locs.get(a.location_id)?.sub_location ?? null }));
}

// Turns the report into CSV text that opens in Excel.
export function reportToCsv(report, wardName, scopeLabel) {
  // Wrap a value in quotes when it contains a comma, quote or new line.
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [];
  // Adds one row to the CSV.
  const push = (...cols) => rows.push(cols.map(esc).join(','));
  const m = report.meta;
  const title = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' }[m.type] || 'Activity';
  // Report header details.
  push(`AfyaTrack PHO ${title} Activity Report`);
  push('Ward', wardName); push('Scope', scopeLabel); push('Period', `${m.start} to ${m.end}`);
  push('Generated (UTC)', m.generated_at); push('Status', 'DRAFT: generated automatically, not officially approved');
  push('Counting rule', m.counting_rule);
  push('');
  // Each section of the report, one after another, with a blank row between them.
  push('Activity by public health pillar'); push('Pillar', 'Records', 'Quantity', 'People reached');
  for (const p of report.pillars) push(`${p.pillar}. ${p.name}`, p.records, p.quantity, p.people_reached);
  push('');
  push('Activity by category'); push('Pillar', 'Category', 'Records', 'Quantity', 'Unit', 'People reached', 'Target', 'Achievement %');
  for (const a of report.activities) push(a.pillar, a.category, a.records, a.quantity, a.unit, a.people_reached, a.target ?? 'N/A', a.achievement_pct);
  push('TOTAL', '', report.totals.activity_records, report.totals.quantity, '', report.totals.people_reached);
  push('');
  push('Tasks'); push('Completed in period', report.tasks.completed);
  push('Pending tasks', report.tasks.pending.length); push('Overdue tasks', report.tasks.overdue.length);
  for (const t of report.tasks.overdue) push('Overdue', t.title, t.assigned_name, t.due_at);
  push('');
  push('Follow ups'); push('Due in period', report.follow_ups.due_in_period); push('Completed in period', report.follow_ups.completed_in_period);
  push('Overdue', report.follow_ups.overdue.length);
  for (const f of report.follow_ups.overdue) push('Overdue follow up', f.action_required, f.responsible_name, f.due_date);
  push('');
  push('Officer breakdown'); push('Officer', 'Records');
  for (const o of report.officers) push(o.full_name, o.records);
  push('');
  push('Location breakdown'); push('Sub location', 'Records');
  for (const l of report.locations) push(l.sub_location, l.records);
  push('');
  // Writes a register summary section. Nested values become "field: value" rows.
  const flat = (title2, obj) => {
    push(title2);
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) push(`${k}: ${k2}`, v2);
      else if (Array.isArray(v)) for (const r of v) push(`${k}: ${r.sub_location}`, r.n);
      else push(k.replace(/_/g, ' '), v);
    }
    push('');
  };
  flat('Premises register summary', report.registers.premises);
  flat('Food handlers summary', report.registers.handlers);
  flat('Household sanitation summary', report.registers.households);
  flat('Water source and sampling summary', report.registers.water);
  flat('Health facility sanitation summary', report.registers.facilities);
  flat('School health summary', report.registers.schools);
  flat('Complaints summary', report.registers.complaints);
  flat('Notices summary', report.registers.notices);
  flat('Public events summary', report.registers.events);
  push('Notable issues and next actions'); push('Finding', 'Required action', 'Deadline', 'Status');
  for (const i of report.issues) push(i.finding, i.required_action, i.deadline, i.status);
  // The invisible character at the start (BOM) makes Excel read special characters correctly.
  return '﻿' + rows.join('\r\n');
}
