// Day to day work routes: lookups, dashboard, tasks (planner), activity records, follow ups,
// in app reminders and the team view. All addresses start with /api.
import express from 'express';
import { requireRole, requireWard, isLead } from '../auth.js';
import { ENTITY_TYPES, cleanFields, isValidDate, specFromForm } from '../registers.js';
import { makeAudit, todayNairobi, nowIso, addDays, weekRange, monthRange, bad, achievementPct, asyncRouter } from '../util.js';
import { loader } from '../ctx.js';
import { sortBy, isActive } from '../store.js';

// Task workflow: draft, planned, assigned, in progress, then completed (or postponed / cancelled with a reason).
// "Open" tasks are the ones still waiting to be done. Drafts are not open yet: they never become overdue or send reminders.
export const TASK_STATUSES = ['draft', 'planned', 'assigned', 'in_progress', 'completed', 'postponed', 'cancelled'];
export const OPEN_STATUSES = ['planned', 'assigned', 'in_progress', 'postponed'];
const isOpen = (t) => OPEN_STATUSES.includes(t.status);
export const PURPOSES = ['routine', 'follow_up', 'complaint', 'registration', 'licensing', 'surveillance', 'campaign', 'other'];
// Midnight at the start of a Nairobi date, as a UTC ISO string. Used to compare with due_at times.
const eatStartIso = (d) => new Date(d + 'T00:00:00+03:00').toISOString();
// Activity records count in reports only once submitted (drafts are excluded).
export const counts = (a) => !a.deleted_at && (a.status || 'submitted') !== 'draft';

// True when the value is a full date and time string, for example 2026-10-19T09:00:00.000Z.
export function isIsoDateTime(s) {
  return typeof s === 'string' && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s);
}

export function workRoutes(store) {
  const r = asyncRouter(express.Router());
  const audit = makeAudit(store);
  // Every route here needs the user to belong to a ward.
  r.use(requireWard);

  // All tasks and activity records of a ward that have not been deleted.
  // Deleting only sets deleted_at, so nothing is lost and the audit stays complete.
  const wardTasks = async (w) => (await store.find('tasks', { ward_id: w })).filter((t) => !t.deleted_at);
  const wardActivities = async (w) => (await store.find('activity_records', { ward_id: w })).filter((a) => !a.deleted_at);
  // A user works on a task when it is assigned to them, they created it or they are in its team.
  const onTask = (t, uid) => t.assigned_to === uid || t.created_by === uid || (t.team_ids || []).includes(uid);

  // GET /api/lookups returns the lists used by drop downs: categories (with their forms), officers, locations, templates, premises.
  r.get('/lookups', async (req, res) => {
    const w = req.ward.id, L = loader(store, req);
    const [categories, officers, locations, templates, premises] = await Promise.all([
      store.all('categories'), L.officers(), store.find('locations', { ward_id: w }), store.all('notice_templates'),
      store.find('food_premises', { ward_id: w })
    ]);
    res.json({
      categories: sortBy(categories.map((c) => ({ ...c, pillar: c.pillar || 'N' })), 'pillar', 'name').map(({ id, name, module_group, pillar, description, active, form, unit, people_field }) =>
        ({ id, name, module_group, pillar, description, active, form: Array.isArray(form) ? form : [], unit: unit || 'activities', people_field: people_field || null })),
      officers,
      locations: sortBy(locations, 'sub_location', 'village'),
      templates: sortBy(templates.filter((t) => isActive(t.active) && isActive(t.approved)), 'name').map(({ id, name }) => ({ id, name })),
      premises: sortBy(premises.filter((p) => isActive(p.active)), 'premises_name').map((p) => ({ id: p.id, name: p.premises_name }))
    });
  });

  // GET /api/dashboard returns everything shown on the home page.
  r.get('/dashboard', async (req, res) => {
    const w = req.ward.id, me = req.user.id, now = nowIso(), today = todayNairobi(), L = loader(store, req);
    // End of today in Nairobi, so we can split "today" from "upcoming".
    const endToday = eatStartIso(addDays(today, 1));
    const wk = weekRange(today), mo = monthRange(today.slice(0, 7));
    // Load all the data the dashboard needs at once.
    const [tasks, users, cats, fus, acts, targets, premises, handlers, samples, inspections, notices, complaints] = await Promise.all([
      wardTasks(w), L.users(), L.categories(), store.find('follow_ups', { ward_id: w }), wardActivities(w),
      store.find('targets', { ward_id: w, period_type: 'weekly' }), store.find('food_premises', { ward_id: w }),
      store.find('food_handlers', { ward_id: w }), store.find('water_samples', { ward_id: w }), store.find('inspections', { ward_id: w }),
      store.find('notice_drafts', { ward_id: w }), store.find('complaints', { ward_id: w })
    ]);
    // Adds the category name and assigned officer name to a task for display.
    const withNames = (t) => ({ ...t, category: cats.get(t.category_id)?.name ?? null, assigned_name: users.get(t.assigned_to)?.full_name ?? null });
    // My open tasks (assigned to me or my team), split into today, overdue and upcoming.
    const mine = sortBy(tasks.filter((t) => (t.assigned_to === me || (t.team_ids || []).includes(me)) && isOpen(t)), 'due_at');
    const todayTasks = mine.filter((t) => t.due_at >= now && t.due_at < endToday).map(withNames);
    const overdue = mine.filter((t) => t.due_at < now).map(withNames);
    const upcoming = mine.filter((t) => t.due_at >= endToday).slice(0, 8).map(withNames);
    const drafts = tasks.filter((t) => t.status === 'draft' && t.created_by === me).length + acts.filter((a) => a.status === 'draft' && a.recorded_by === me).length;
    // Open follow ups due within 7 days. Officers see their own, leads see the whole ward.
    const soon = addDays(today, 7);
    const followUps = [];
    for (const f of sortBy(fus.filter((f) => f.status === 'open' && f.due_date <= soon && (isLead(req) || f.responsible_user_id === me)), 'due_date').slice(0, 10)) {
      followUps.push({ ...f, responsible_name: users.get(f.responsible_user_id)?.full_name ?? null,
        entity_name: await L.entityName(f.linked_entity_type, f.linked_entity_id), overdue: f.due_date < today });
    }

    // Weekly progress per category. Officers see their own numbers, leads see the ward totals.
    const scopeUser = isLead(req) ? null : me;
    const prog = new Map();
    for (const a of acts) {
      if (!counts(a) || a.activity_date < wk.start || a.activity_date > wk.end) continue;
      if (scopeUser && a.recorded_by !== scopeUser) continue;
      const p = prog.get(a.category_id) || { category: cats.get(a.category_id)?.name ?? null, achieved: 0, target: null };
      p.achieved += Number(a.quantity) || 0;
      prog.set(a.category_id, p);
    }
    // Add this week's targets, so we can show achieved against target.
    for (const t of targets) {
      if (!(t.period_start <= wk.end && t.period_end >= wk.start)) continue;
      if (scopeUser ? t.user_id !== scopeUser : t.user_id != null) continue;
      const p = prog.get(t.category_id) || { category: cats.get(t.category_id)?.name ?? null, achieved: 0, target: null };
      p.target = (p.target || 0) + Number(t.target_value);
      prog.set(t.category_id, p);
    }
    // Work out the percentage (N/A when there is no target) and sort by category name.
    const weekly = [...prog.values()].map((p) => ({ ...p, pct: achievementPct(p.achieved, p.target) })).sort((a, b) => String(a.category).localeCompare(String(b.category)));

    // Indicators for this month, each counted separately so distinct entities, visits, people and records are never mixed up.
    const inMonth = (d) => d && d >= mo.start && d <= mo.end;
    const mineOnly = (uid) => !scopeUser || uid === scopeUser;
    const monthInsp = inspections.filter((i) => inMonth(i.inspection_date) && mineOnly(i.officer_id));
    const indicators = {
      month: mo,
      inspection_visits: monthInsp.length,
      distinct_premises_inspected: new Set(monthInsp.filter((i) => i.entity_type === 'premises').map((i) => i.entity_id)).size,
      handlers_registered: handlers.filter((h) => isActive(h.active)).length,
      samples_collected: samples.filter((s) => (s.stage || 'collected') !== 'planned' && inMonth(s.collection_date) && mineOnly(s.recorded_by)).length,
      notices_served: notices.filter((n) => inMonth(n.service_date)).length,
      people_reached: acts.filter((a) => counts(a) && inMonth(a.activity_date) && mineOnly(a.recorded_by)).reduce((s, a) => s + (Number(a.people_reached) || 0), 0),
      open_follow_ups: fus.filter((f) => f.status === 'open' && (isLead(req) || f.responsible_user_id === me)).length,
      open_complaints: complaints.filter((c) => isActive(c.active) && !['resolved', 'closed'].includes(c.status) && (isLead(req) || c.assigned_officer_id === me)).length
    };

    // Ward wide counts, only shown to the ward lead.
    const openFus = fus.filter((f) => f.status === 'open' && f.due_date < today);
    const wardCounts = isLead(req) ? {
      open_tasks: tasks.filter(isOpen).length,
      overdue_tasks: tasks.filter((t) => isOpen(t) && t.due_at < now).length,
      overdue_follow_ups: openFus.length,
      facilities_overdue_actions: new Set(openFus.filter((f) => f.linked_entity_type === 'facility').map((f) => f.linked_entity_id)).size,
      notices_awaiting_approval: notices.filter((n) => n.status === 'submitted').length
    } : null;

    // Warnings: expired licences, expired medical certificates and water samples waiting for results.
    const expiring = {
      licences: premises.filter((p) => isActive(p.active) && p.licence_expiry_date && p.licence_expiry_date < today).length,
      certificates: handlers.filter((h) => isActive(h.active) && h.certificate_expiry && h.certificate_expiry < today).length,
      pending_samples: samples.filter((s) => s.compliance_status === 'pending_result' && (s.stage || 'collected') !== 'planned').length
    };
    res.json({ today, week: wk, todayTasks, overdue, upcoming, drafts, followUps, weekly, indicators, wardCounts, expiring });
  });

  // ---------- Tasks ----------
  // Who may see a task: leads and reviewers see all, officers see tasks they work on.
  const canSeeTask = (req, t) => t && t.ward_id === req.ward.id && !t.deleted_at &&
    (isLead(req) || req.role === 'reviewer' || onTask(t, req.user.id));
  // Adds display names (category, officers, team, location, linked record) to a task.
  const decorate = async (L, t) => {
    const [users, cats, locs] = await Promise.all([L.users(), L.categories(), L.locations()]);
    const loc = t.location_id ? locs.get(t.location_id) : null;
    return {
      ...t,
      category: cats.get(t.category_id)?.name ?? null,
      assigned_name: users.get(t.assigned_to)?.full_name ?? null,
      created_by_name: users.get(t.created_by)?.full_name ?? null,
      team_names: (t.team_ids || []).map((id) => users.get(id)?.full_name).filter(Boolean),
      sub_location: loc?.sub_location ?? null,
      village: loc?.village ?? null,
      is_overdue: isOpen(t) && t.due_at < nowIso(),
      entity_name: await L.entityName(t.linked_entity_type, t.linked_entity_id)
    };
  };

  // GET /api/tasks lists tasks, with optional filters in the address (mine, status, category, dates, search).
  r.get('/tasks', async (req, res) => {
    const q = req.query, now = nowIso(), L = loader(store, req), me = req.user.id;
    let rows = await wardTasks(req.ward.id);
    // Officers only see tasks they work on. Drafts are private to the person who made them.
    if (!isLead(req) && req.role !== 'reviewer') rows = rows.filter((t) => onTask(t, me));
    rows = rows.filter((t) => t.status !== 'draft' || t.created_by === me);
    if (q.mine === '1') rows = rows.filter((t) => t.assigned_to === me || (t.team_ids || []).includes(me));
    if (q.assigned_to) rows = rows.filter((t) => t.assigned_to === Number(q.assigned_to) || (t.team_ids || []).includes(Number(q.assigned_to)));
    if (q.category_id) rows = rows.filter((t) => t.category_id === Number(q.category_id));
    if (q.status === 'overdue') rows = rows.filter((t) => isOpen(t) && t.due_at < now);
    else if (q.status === 'open') rows = rows.filter(isOpen);
    else if (TASK_STATUSES.includes(q.status)) rows = rows.filter((t) => t.status === q.status);
    // from and to are Nairobi dates. Compare against the start of each day.
    if (q.from) { const f = eatStartIso(q.from); rows = rows.filter((t) => t.due_at >= f); }
    if (q.to) { const e = eatStartIso(addDays(q.to, 1)); rows = rows.filter((t) => t.due_at < e); }
    if (q.q) { const s = String(q.q).toLowerCase(); rows = rows.filter((t) => `${t.title} ${t.description || ''}`.toLowerCase().includes(s)); }
    if (q.linked_entity_type && q.linked_entity_id) rows = rows.filter((t) => t.linked_entity_type === q.linked_entity_type && t.linked_entity_id === Number(q.linked_entity_id));
    // Earliest due first, and at most 500 rows.
    rows = sortBy(rows, 'due_at').slice(0, 500);
    res.json(await Promise.all(rows.map((t) => decorate(L, t))));
  });

  // GET /api/tasks/:id returns one task with its change history and the activity record it produced.
  r.get('/tasks/:id', async (req, res) => {
    const L = loader(store, req);
    const t = await store.get('tasks', req.params.id);
    if (!canSeeTask(req, t) || (t.status === 'draft' && t.created_by !== req.user.id)) return res.status(404).json({ error: 'Task not found.' });
    const users = await L.users();
    const history = sortBy(await store.find('task_history', { task_id: t.id }), '-id')
      .map((h) => ({ ...h, full_name: users.get(h.user_id)?.full_name ?? null }));
    const activity = (await store.find('activity_records', { linked_task_id: t.id })).find((a) => !a.deleted_at) || null;
    res.json({ ...(await decorate(L, t)), history, activity });
  });

  // Fields a user can send when creating or editing a task, with their rules.
  const taskSpec = {
    title: { required: true, label: 'Title' }, description: {}, category_id: { type: 'int' }, assigned_to: { type: 'int' },
    due_at: { required: true, label: 'Due date' }, reminder_at: {}, priority: { enum: ['low', 'normal', 'high'] },
    purpose: { enum: PURPOSES }, venue: {}, expected_output: {}, team_ids: { type: 'list' },
    location_id: { type: 'int' }, linked_entity_type: {}, linked_entity_id: { type: 'int' }, notes: {}, next_action: {}
  };
  // Extra checks for tasks, beyond the basic field rules.
  const validateTask = async (req, L, data, errors) => {
    if (data.due_at && !isIsoDateTime(data.due_at)) errors.due_at = 'Enter a valid due date and time.';
    if (data.reminder_at && !isIsoDateTime(data.reminder_at)) errors.reminder_at = 'Enter a valid reminder date and time.';
    if (data.reminder_at && data.due_at && data.reminder_at > data.due_at) errors.reminder_at = 'Reminder should be before the due time.';
    // Only leads may assign a task to someone else. Officers must belong to this ward.
    const members = await L.memberIds();
    if (data.assigned_to !== undefined && data.assigned_to !== null) {
      if (!members.has(data.assigned_to)) errors.assigned_to = 'Choose an active officer in this ward.';
      else if (!isLead(req) && data.assigned_to !== req.user.id) errors.assigned_to = 'Only the ward lead can assign tasks to other officers.';
    }
    if (data.team_ids) {
      data.team_ids = [...new Set(data.team_ids.map(Number))].filter(Boolean);
      if (data.team_ids.some((x) => !members.has(x))) errors.team_ids = 'Team members must be active officers in this ward.';
    }
    // A linked record (premises, household ...) must exist in this ward.
    if (data.linked_entity_type) {
      if (!ENTITY_TYPES.includes(data.linked_entity_type)) errors.linked_entity_type = 'Unknown record type.';
      else if (!data.linked_entity_id || !(await L.entityExists(data.linked_entity_type, data.linked_entity_id))) errors.linked_entity_id = 'Linked record not found in this ward.';
    }
    if (data.location_id && !(await L.locations()).has(data.location_id)) errors.location_id = 'Location not in this ward.';
  };
  // Saves one line of task history, for example "status changed from planned to completed".
  const history = (taskId, userId, field, oldValue, newValue, reason) => store.insert('task_history', {
    task_id: taskId, user_id: userId, at: nowIso(), field, old_value: oldValue ?? null, new_value: newValue ?? null, reason: reason ?? null
  }, { timestamps: false });

  // POST /api/tasks creates a task. Officers and above only. Send save_as_draft = true to keep it as a private draft.
  r.post('/tasks', requireRole('officer'), async (req, res) => {
    const L = loader(store, req);
    const { data, errors } = cleanFields(taskSpec, req.body || {});
    // When no officer is chosen, the task is assigned to the person creating it.
    if (!data.assigned_to) data.assigned_to = req.user.id;
    await validateTask(req, L, data, errors);
    if (Object.keys(errors).length) return bad(res, errors);
    // A task given to someone else starts as "assigned"; your own task starts as "planned".
    const status = req.body?.save_as_draft ? 'draft' : data.assigned_to !== req.user.id ? 'assigned' : 'planned';
    // Default values first, then the user's data, then fields the user is not allowed to set.
    const id = await store.insert('tasks', {
      description: null, category_id: null, reminder_at: null, priority: 'normal', purpose: 'routine', venue: null, expected_output: null, team_ids: [],
      location_id: null, linked_entity_type: null, linked_entity_id: null, notes: null, next_action: null, ...data,
      ward_id: req.ward.id, created_by: req.user.id, status, status_reason: null, completed_at: null, completed_by: null, deleted_at: null
    });
    await history(id, req.user.id, 'created', null, data.due_at);
    await audit(req, 'create', 'task', id, { title: data.title, assigned_to: data.assigned_to, status });
    res.status(201).json({ id });
  });

  // PATCH /api/tasks/:id updates a task or changes its status.
  r.patch('/tasks/:id', requireRole('officer'), async (req, res) => {
    const L = loader(store, req);
    const t = await store.get('tasks', req.params.id);
    if (!canSeeTask(req, t)) return res.status(404).json({ error: 'Task not found.' });
    if (!isLead(req) && !onTask(t, req.user.id)) return res.status(403).json({ error: 'You can only update your own tasks.' });
    const body = req.body || {};
    const { data, errors } = cleanFields(taskSpec, body, { partial: true });
    await validateTask(req, L, data, errors);

    // Status rules: postponing needs a new date and a reason, cancelling needs a reason.
    const status = body.status;
    const reason = body.status_reason ? String(body.status_reason).trim() : null;
    if (status !== undefined) {
      if (!TASK_STATUSES.includes(status)) errors.status = 'Unknown status.';
      if (status === 'draft' && t.status !== 'draft') errors.status = 'A task that has been planned cannot go back to draft.';
      if (status === 'postponed') {
        if (!data.due_at || data.due_at === t.due_at) errors.due_at = 'Postponing needs a new due date.';
        if (!reason) errors.status_reason = 'Explain why the task is postponed.';
      }
      if (status === 'cancelled' && !reason) errors.status_reason = 'Explain why the task is cancelled.';
    }
    // When completing, the user can also record an activity so it counts in the reports.
    const rec = body.record_activity;
    if (status === 'completed' && rec) {
      if (!t.category_id && !data.category_id) errors.category_id = 'Choose a category so the activity can be counted in reports.';
      if (rec.activity_date && !isValidDate(rec.activity_date)) errors.activity_date = 'Enter a valid activity date.';
    }
    if (Object.keys(errors).length) return bad(res, errors);

    // Build the update and write a history line for the status and every changed field.
    const upd = { ...data };
    if (status !== undefined && status !== t.status) {
      upd.status = status;
      upd.status_reason = reason;
      if (status === 'completed') { upd.completed_at = nowIso(); upd.completed_by = req.user.id; }
      else { upd.completed_at = null; upd.completed_by = null; }
      await history(t.id, req.user.id, 'status', t.status, status, reason);
    }
    for (const k of Object.keys(data)) {
      const show = (v) => (Array.isArray(v) ? v.join(',') : v);
      if (JSON.stringify(t[k] ?? '') !== JSON.stringify(data[k] ?? '')) await history(t.id, req.user.id, k, show(t[k]), show(data[k]), k === 'due_at' ? reason : null);
    }
    if (Object.keys(upd).length) await store.update('tasks', t.id, upd);
    // One activity record per task at most: the unique claim stops double counting even on retries.
    if (status === 'completed' && rec && (await store.claim(`activity_task_${t.id}`))) {
      const cat = await store.get('categories', data.category_id || t.category_id);
      await store.insert('activity_records', {
        ward_id: t.ward_id, category_id: data.category_id || t.category_id, activity_date: rec.activity_date || todayNairobi(),
        recorded_by: req.user.id, location_id: data.location_id ?? t.location_id ?? null, linked_task_id: t.id,
        linked_entity_type: t.linked_entity_type ?? null, linked_entity_id: t.linked_entity_id ?? null, linked_inspection_id: null,
        outcome: rec.outcome || null, notes: rec.notes || null, quantity: Number(rec.quantity) > 0 ? Number(rec.quantity) : 1,
        unit: rec.unit || cat?.unit || 'activities', purpose: t.purpose || null, status: 'submitted', details: {},
        people_reached: Number(rec.people_reached) || null, submitted_at: nowIso(), deleted_at: null
      });
    }
    await audit(req, status ? 'status_change' : 'update', 'task', t.id, { status, ...data });
    res.json({ ok: true });
  });

  // DELETE /api/tasks/:id hides a task (soft delete). Ward leads, or the creator of a draft.
  r.delete('/tasks/:id', requireRole('officer'), async (req, res) => {
    const t = await store.get('tasks', req.params.id);
    if (!t || t.ward_id !== req.ward.id || t.deleted_at) return res.status(404).json({ error: 'Task not found.' });
    if (!isLead(req) && !(t.status === 'draft' && t.created_by === req.user.id)) return res.status(403).json({ error: 'Only the ward lead can remove a task.' });
    await store.update('tasks', t.id, { deleted_at: nowIso() });
    await audit(req, 'delete', 'task', t.id, { title: t.title });
    res.json({ ok: true });
  });

  // ---------- Activity records ----------
  // GET /api/activities lists activity records with optional date, category, pillar, status and officer filters.
  r.get('/activities', async (req, res) => {
    const q = req.query, L = loader(store, req), me = req.user.id;
    let rows = await wardActivities(req.ward.id);
    // Officers only see the records they made. Drafts are private to the person who made them.
    if (!isLead(req) && req.role !== 'reviewer') rows = rows.filter((a) => a.recorded_by === me);
    rows = rows.filter((a) => (a.status || 'submitted') !== 'draft' || a.recorded_by === me);
    if (q.from) rows = rows.filter((a) => a.activity_date >= q.from);
    if (q.to) rows = rows.filter((a) => a.activity_date <= q.to);
    if (q.category_id) rows = rows.filter((a) => a.category_id === Number(q.category_id));
    if (q.recorded_by) rows = rows.filter((a) => a.recorded_by === Number(q.recorded_by));
    if (q.status) rows = rows.filter((a) => (a.status || 'submitted') === q.status);
    const [users, cats, locs] = await Promise.all([L.users(), L.categories(), L.locations()]);
    if (q.pillar) rows = rows.filter((a) => (cats.get(a.category_id)?.pillar || 'N') === q.pillar);
    // Newest first, at most 500, then add display names.
    rows = sortBy(rows, '-activity_date', '-id').slice(0, 500);
    const out = [];
    for (const a of rows) {
      out.push({ ...a, status: a.status || 'submitted', category: cats.get(a.category_id)?.name ?? null, pillar: cats.get(a.category_id)?.pillar || 'N',
        recorded_by_name: users.get(a.recorded_by)?.full_name ?? null,
        sub_location: locs.get(a.location_id)?.sub_location ?? null, entity_name: await L.entityName(a.linked_entity_type, a.linked_entity_id) });
    }
    res.json(out);
  });

  // GET /api/activities/:id returns one activity record with its form details.
  r.get('/activities/:id', async (req, res) => {
    const L = loader(store, req);
    const a = await store.get('activity_records', req.params.id);
    if (!a || a.ward_id !== req.ward.id || a.deleted_at) return res.status(404).json({ error: 'Record not found.' });
    if (!isLead(req) && req.role !== 'reviewer' && a.recorded_by !== req.user.id) return res.status(404).json({ error: 'Record not found.' });
    const [users, cats] = await Promise.all([L.users(), L.categories()]);
    const cat = cats.get(a.category_id);
    res.json({ ...a, status: a.status || 'submitted', category: cat?.name ?? null, form: cat?.form || [], recorded_by_name: users.get(a.recorded_by)?.full_name ?? null,
      entity_name: await L.entityName(a.linked_entity_type, a.linked_entity_id) });
  });

  // Fields allowed when recording an activity. The category's own form fields go in "details".
  const actSpec = {
    category_id: { type: 'int', required: true, label: 'Category' }, activity_date: { type: 'date', required: true, label: 'Activity date' },
    start_time: {}, purpose: { enum: PURPOSES }, location_id: { type: 'int' }, outcome: {}, notes: {}, quantity: { type: 'number' }, unit: {},
    next_action: {}, linked_entity_type: {}, linked_entity_id: { type: 'int' }
  };
  // Checks an activity (new or edited) and its category form. Drafts may leave required form fields empty.
  const checkActivity = async (L, data, details, isDraft, errors) => {
    if (data.activity_date && data.activity_date > todayNairobi()) errors.activity_date = 'Activity date cannot be in the future.';
    if (data.quantity !== undefined && data.quantity !== null && data.quantity <= 0) errors.quantity = 'Quantity must be more than zero.';
    if (data.start_time && !/^\d{2}:\d{2}$/.test(data.start_time)) errors.start_time = 'Enter the time as HH:MM.';
    const cat = data.category_id ? (await L.categories()).get(data.category_id) : null;
    if (data.category_id && !cat) errors.category_id = 'Choose a valid category.';
    if (data.linked_entity_type && (!ENTITY_TYPES.includes(data.linked_entity_type) || !(await L.entityExists(data.linked_entity_type, data.linked_entity_id)))) errors.linked_entity_id = 'Linked record not found.';
    let clean = {};
    if (cat) {
      const spec = specFromForm(cat.form || []);
      if (isDraft) for (const k of Object.keys(spec)) spec[k] = { ...spec[k], required: false };
      const out = cleanFields(spec, details || {});
      clean = out.data;
      for (const [k, v] of Object.entries(out.errors)) errors[`details.${k}`] = v;
    }
    return { cat, details: clean };
  };
  // POST /api/activities records a field activity directly (not from a task). Send status = "draft" to save a draft.
  r.post('/activities', requireRole('officer'), async (req, res) => {
    const L = loader(store, req);
    const { data, errors } = cleanFields(actSpec, req.body || {});
    const isDraft = req.body?.status === 'draft';
    const { cat, details } = await checkActivity(L, data, req.body?.details, isDraft, errors);
    if (Object.keys(errors).length) return bad(res, errors);
    // The number of people reached comes from the category's "people" field, for example "Total people reached".
    const people = cat?.people_field ? Number(details[cat.people_field]) || null : null;
    // Save with safe defaults: quantity 1 and the category's unit.
    const id = await store.insert('activity_records', {
      ward_id: req.ward.id, category_id: data.category_id, activity_date: data.activity_date, start_time: data.start_time ?? null, recorded_by: req.user.id,
      purpose: data.purpose ?? null, location_id: data.location_id ?? null, outcome: data.outcome ?? null, notes: data.notes ?? null, next_action: data.next_action ?? null,
      quantity: data.quantity || 1, unit: data.unit || cat?.unit || 'activities', linked_entity_type: data.linked_entity_type ?? null, linked_entity_id: data.linked_entity_id ?? null,
      linked_task_id: null, linked_inspection_id: null, details, people_reached: people, status: isDraft ? 'draft' : 'submitted',
      submitted_at: isDraft ? null : nowIso(), deleted_at: null
    });
    await audit(req, 'create', 'activity_record', id, { ...data, status: isDraft ? 'draft' : 'submitted' });
    res.status(201).json({ id });
  });

  // PATCH /api/activities/:id edits an activity (the recorder, or the ward lead) or submits a draft (status = "submitted").
  // Changes are logged, so corrections never silently erase history.
  r.patch('/activities/:id', requireRole('officer'), async (req, res) => {
    const L = loader(store, req);
    const a = await store.get('activity_records', req.params.id);
    if (!a || a.ward_id !== req.ward.id || a.deleted_at) return res.status(404).json({ error: 'Record not found.' });
    if (!isLead(req) && a.recorded_by !== req.user.id) return res.status(403).json({ error: 'You can only change your own records.' });
    if (a.linked_inspection_id) return res.status(409).json({ error: 'This record comes from an inspection. Record a new inspection instead.' });
    const { data, errors } = cleanFields(actSpec, req.body || {}, { partial: true });
    const before = a.status || 'submitted';
    const status = req.body?.status === 'submitted' ? 'submitted' : before;
    if (req.body?.status === 'draft' && before !== 'draft') errors.status = 'A submitted record cannot go back to draft.';
    const { cat, details } = await checkActivity(L, { ...a, ...data }, req.body?.details ?? a.details, status === 'draft', errors);
    if (Object.keys(errors).length) return bad(res, errors);
    const upd = { ...data, details, status, people_reached: cat?.people_field ? Number(details[cat.people_field]) || null : a.people_reached ?? null };
    if (status === 'submitted' && before === 'draft') upd.submitted_at = nowIso();
    if (data.category_id && cat && !data.unit) upd.unit = cat.unit || a.unit;
    await store.update('activity_records', a.id, upd);
    await audit(req, upd.submitted_at ? 'submit' : 'update', 'activity_record', a.id, { ...data, details });
    res.json({ ok: true });
  });

  // DELETE /api/activities/:id hides an activity record. Officers can remove only their own.
  r.delete('/activities/:id', requireRole('officer'), async (req, res) => {
    const a = await store.get('activity_records', req.params.id);
    if (!a || a.ward_id !== req.ward.id || a.deleted_at) return res.status(404).json({ error: 'Record not found.' });
    if (!isLead(req) && a.recorded_by !== req.user.id) return res.status(403).json({ error: 'You can only remove your own records.' });
    await store.update('activity_records', a.id, { deleted_at: nowIso() });
    await audit(req, 'delete', 'activity_record', a.id, { category_id: a.category_id, activity_date: a.activity_date });
    res.json({ ok: true });
  });

  // ---------- Follow ups ----------
  // GET /api/follow-ups lists follow ups. bucket can be overdue, due_soon, open or completed.
  r.get('/follow-ups', async (req, res) => {
    const q = req.query, today = todayNairobi(), soon = addDays(today, 7), L = loader(store, req);
    let rows = await store.find('follow_ups', { ward_id: req.ward.id });
    if (q.bucket === 'overdue') rows = rows.filter((f) => f.status === 'open' && f.due_date < today);
    else if (q.bucket === 'due_soon') rows = rows.filter((f) => f.status === 'open' && f.due_date >= today && f.due_date <= soon);
    else if (q.bucket === 'open') rows = rows.filter((f) => f.status === 'open');
    else if (q.bucket === 'completed') rows = rows.filter((f) => f.status === 'completed');
    if (q.responsible_user_id) rows = rows.filter((f) => f.responsible_user_id === Number(q.responsible_user_id));
    if (q.mine === '1') rows = rows.filter((f) => f.responsible_user_id === req.user.id);
    if (q.entity_type) rows = rows.filter((f) => f.linked_entity_type === q.entity_type);
    if (q.entity_id) rows = rows.filter((f) => f.linked_entity_id === Number(q.entity_id));
    // Open follow ups first, then by due date.
    rows = [...rows].sort((a, b) => (b.status === 'open') - (a.status === 'open') || String(a.due_date).localeCompare(String(b.due_date))).slice(0, 500);
    const users = await L.users();
    const out = [];
    for (const f of rows) {
      out.push({ ...f, responsible_name: users.get(f.responsible_user_id)?.full_name ?? null,
        entity_name: await L.entityName(f.linked_entity_type, f.linked_entity_id), is_overdue: f.status === 'open' && f.due_date < today });
    }
    res.json(out);
  });

  // Fields allowed when creating a follow up.
  const fuSpec = {
    action_required: { required: true, label: 'Action required' }, responsible_user_id: { type: 'int', required: true, label: 'Responsible officer' },
    due_date: { type: 'date', required: true, label: 'Due date' }, responsible_party: {}, linked_entity_type: {}, linked_entity_id: { type: 'int' },
    linked_inspection_id: { type: 'int' }, linked_finding_id: { type: 'int' }
  };
  // POST /api/follow-ups creates a follow up action with a responsible officer and due date.
  r.post('/follow-ups', requireRole('officer'), async (req, res) => {
    const L = loader(store, req);
    const { data, errors } = cleanFields(fuSpec, req.body || {});
    if (data.responsible_user_id && !(await L.memberIds()).has(data.responsible_user_id)) errors.responsible_user_id = 'Choose an active officer in this ward.';
    if (data.linked_entity_type && (!ENTITY_TYPES.includes(data.linked_entity_type) || !(await L.entityExists(data.linked_entity_type, data.linked_entity_id)))) errors.linked_entity_id = 'Linked record not found.';
    if (Object.keys(errors).length) return bad(res, errors);
    const id = await store.insert('follow_ups', {
      ward_id: req.ward.id, linked_entity_type: data.linked_entity_type ?? null, linked_entity_id: data.linked_entity_id ?? null,
      linked_inspection_id: data.linked_inspection_id ?? null, linked_finding_id: data.linked_finding_id ?? null, action_required: data.action_required,
      responsible_user_id: data.responsible_user_id, responsible_party: data.responsible_party ?? null, due_date: data.due_date, status: 'open', outcome: null, outcome_notes: null,
      next_step: null, referral_to: null, completed_at: null, created_by: req.user.id
    });
    await audit(req, 'create', 'follow_up', id, data);
    res.status(201).json({ id });
  });

  // PATCH /api/follow-ups/:id changes the date, reassigns, completes or cancels a follow up.
  r.patch('/follow-ups/:id', requireRole('officer'), async (req, res) => {
    const L = loader(store, req);
    const f = await store.get('follow_ups', req.params.id);
    if (!f || f.ward_id !== req.ward.id) return res.status(404).json({ error: 'Follow up not found.' });
    if (!isLead(req) && f.responsible_user_id !== req.user.id && f.created_by !== req.user.id) return res.status(403).json({ error: 'Only the responsible officer or ward lead can update this follow up.' });
    const b = req.body || {}, errors = {};
    const upd = {};
    // Change the due date.
    if (b.due_date !== undefined) { if (!isValidDate(b.due_date)) errors.due_date = 'Enter a valid date.'; else upd.due_date = b.due_date; }
    // Reassign to another officer (ward lead only).
    if (b.responsible_user_id !== undefined) {
      if (!isLead(req)) errors.responsible_user_id = 'Only the ward lead can reassign.';
      else if (!(await L.memberIds()).has(Number(b.responsible_user_id))) errors.responsible_user_id = 'Choose an active officer.';
      else upd.responsible_user_id = Number(b.responsible_user_id);
    }
    // Completing needs an outcome: compliant (verified), partial, non compliant or referred.
    if (b.status === 'completed') {
      if (!['compliant', 'partial', 'non_compliant', 'referred'].includes(b.outcome)) errors.outcome = 'Record the revisit outcome: compliant, partial, non compliant or referred.';
      if (b.outcome === 'referred' && !String(b.referral_to || '').trim()) errors.referral_to = 'Record who the matter was referred to.';
      Object.assign(upd, { status: 'completed', outcome: b.outcome, outcome_notes: b.outcome_notes || null, next_step: b.next_step || null, referral_to: b.referral_to || null, completed_at: nowIso() });
    } else if (b.status === 'cancelled') {
      if (!b.outcome_notes) errors.outcome_notes = 'Explain why the follow up is cancelled.';
      Object.assign(upd, { status: 'cancelled', outcome_notes: b.outcome_notes || null });
    }
    // Optionally create the next follow up in the same request.
    if (b.next_follow_up && !isValidDate(b.next_follow_up.due_date || '')) errors.next_due = 'Enter a valid date for the next follow up.';
    if (Object.keys(errors).length) return bad(res, errors);
    if (Object.keys(upd).length) await store.update('follow_ups', f.id, upd);
    // When the follow up came from an inspection finding, update that finding to match the outcome.
    if (f.linked_finding_id && upd.outcome) {
      const map = { compliant: 'verified', partial: 'in_progress', non_compliant: 'not_complied', referred: 'escalated' };
      const st = map[upd.outcome];
      const finding = await store.get('inspection_findings', f.linked_finding_id);
      if (finding) await store.update('inspection_findings', finding.id, { status: st, resolved_at: st === 'verified' ? nowIso() : null,
        history: [...(finding.history || []), { at: nowIso(), by: req.user.id, from: finding.status, to: st, note: upd.outcome_notes || `Follow up outcome: ${upd.outcome}` }] });
    }
    // Create the next follow up when requested.
    if (b.next_follow_up) {
      await store.insert('follow_ups', {
        ward_id: f.ward_id, linked_entity_type: f.linked_entity_type, linked_entity_id: f.linked_entity_id, linked_inspection_id: f.linked_inspection_id,
        linked_finding_id: f.linked_finding_id, action_required: b.next_follow_up.action_required || f.action_required, responsible_party: f.responsible_party ?? null,
        responsible_user_id: upd.responsible_user_id || f.responsible_user_id, due_date: b.next_follow_up.due_date, status: 'open',
        outcome: null, outcome_notes: null, next_step: null, referral_to: null, completed_at: null, created_by: req.user.id
      });
    }
    await audit(req, upd.status ? 'status_change' : 'update', 'follow_up', f.id, upd);
    res.json({ ok: true });
  });

  // ---------- Reminders (in app) ----------
  // GET /api/reminders returns my latest 30 in app reminders (the bell icon).
  r.get('/reminders', async (req, res) => {
    const rows = (await store.find('reminders', { user_id: req.user.id })).filter((x) => x.status === 'sent');
    res.json(sortBy(rows, '-sent_at').slice(0, 30));
  });
  // POST /api/reminders/read-all marks all my reminders as read.
  r.post('/reminders/read-all', async (req, res) => {
    const t = nowIso();
    for (const x of await store.find('reminders', { user_id: req.user.id })) if (!x.read_at) await store.update('reminders', x.id, { read_at: t }, { touch: false });
    res.json({ ok: true });
  });

  // ---------- Team view (ward lead only) ----------
  // GET /api/team gives the ward lead a summary per officer for this week. Ward leads only.
  r.get('/team', requireRole('ward_lead'), async (req, res) => {
    const w = req.ward.id, now = nowIso(), today = todayNairobi(), wk = weekRange(today), L = loader(store, req);
    const s = eatStartIso(wk.start), e = eatStartIso(addDays(wk.end, 1));
    const [mems, users, tasks, acts, fus, facilities] = await Promise.all([
      store.find('memberships', { ward_id: w }), L.users(), wardTasks(w), wardActivities(w), store.find('follow_ups', { ward_id: w }),
      store.find('healthcare_facilities', { ward_id: w })
    ]);
    // Build one row per active person in the ward, with all their current roles.
    const people = new Map();
    for (const m of mems) {
      if (m.active_to && m.active_to < today) continue;
      const u = users.get(m.user_id);
      if (!u || !isActive(u.active)) continue;
      const p = people.get(u.id) || { id: u.id, full_name: u.full_name, email: u.email, roles: new Set() };
      p.roles.add(m.role);
      people.set(u.id, p);
    }
    // Count open, overdue and completed tasks, activities and overdue follow ups for each officer.
    const officers = sortBy([...people.values()], 'full_name').map((o) => ({
      id: o.id, full_name: o.full_name, email: o.email, roles: [...o.roles].join(','),
      open_tasks: tasks.filter((t) => t.assigned_to === o.id && isOpen(t)).length,
      overdue_tasks: tasks.filter((t) => t.assigned_to === o.id && isOpen(t) && t.due_at < now).length,
      completed_this_week: tasks.filter((t) => t.assigned_to === o.id && t.status === 'completed' && t.completed_at >= s && t.completed_at < e).length,
      activities_this_week: acts.filter((a) => counts(a) && a.recorded_by === o.id && a.activity_date >= wk.start && a.activity_date <= wk.end).length,
      overdue_follow_ups: fus.filter((f) => f.responsible_user_id === o.id && f.status === 'open' && f.due_date < today).length
    }));
    // Health facilities with overdue follow up actions.
    const facMap = new Map(facilities.map((f) => [f.id, f]));
    const facilitiesOverdue = sortBy(fus.filter((f) => f.linked_entity_type === 'facility' && f.status === 'open' && f.due_date < today && facMap.has(f.linked_entity_id)), 'due_date')
      .map((f) => ({ id: f.id, action_required: f.action_required, due_date: f.due_date, facility_name: facMap.get(f.linked_entity_id).facility_name,
        facility_id: f.linked_entity_id, responsible_name: users.get(f.responsible_user_id)?.full_name ?? null }));
    res.json({ week: wk, officers, facilitiesOverdue });
  });

  return r;
}

// Background job: create in app reminders when a task reminder time arrives, a follow up falls due,
// a licence or medical certificate is about to expire, a water sample action is overdue, or an officer
// has recorded no activity for 7 days. Each reminder has a fixed key so it is created only once,
// even if the job runs on several servers.
export async function runReminders(store) {
  const now = nowIso(), today = todayNairobi(), soon = addDays(today, 14);
  let n = 0;
  // Creates one reminder. The claim key makes sure the same reminder is never created twice.
  const add = async (userId, type, recordId, title, scheduledAt) => {
    if (!userId || !(await store.claim(`reminder_${userId}_${type}_${recordId}_${scheduledAt}`))) return;
    await store.insert('reminders', { user_id: userId, linked_record_type: type, linked_record_id: recordId, title, scheduled_at: scheduledAt,
      sent_at: now, read_at: null, channel: 'in_app', status: 'sent' }, { timestamps: false });
    n++;
  };
  // Task reminders: when the reminder time is reached, and again when the task becomes overdue.
  for (const t of await store.all('tasks')) {
    if (t.deleted_at || !isOpen(t)) continue;
    if (t.reminder_at && t.reminder_at <= now) await add(t.assigned_to, 'task', t.id, `Reminder: ${t.title}`, t.reminder_at);
    if (t.due_at <= now) await add(t.assigned_to, 'task_overdue', t.id, `Overdue: ${t.title}`, t.due_at);
  }
  // Follow up reminders: when the due date is today or has passed.
  for (const f of await store.find('follow_ups', { status: 'open' })) {
    if (f.due_date <= today) await add(f.responsible_user_id, 'follow_up', f.id, `Follow up due: ${f.action_required}`, f.due_date);
  }
  // Licences expiring within 14 days, to the officer assigned to the premises.
  const premises = await store.all('food_premises');
  const premisesById = new Map(premises.map((p) => [p.id, p]));
  for (const p of premises) {
    if (!isActive(p.active) || !p.licence_expiry_date || p.licence_expiry_date > soon) continue;
    await add(p.assigned_officer_id, 'licence_expiry', p.id, `Licence ${p.licence_expiry_date < today ? 'expired' : 'expiring'}: ${p.premises_name} (${p.licence_expiry_date})`, p.licence_expiry_date);
  }
  // Food handler certificates expiring within 14 days, to the officer of the handler's premises.
  for (const h of await store.all('food_handlers')) {
    if (!isActive(h.active) || !h.certificate_expiry || h.certificate_expiry > soon) continue;
    const officer = premisesById.get(h.premises_id)?.assigned_officer_id;
    await add(officer, 'certificate_expiry', h.id, `Medical certificate ${h.certificate_expiry < today ? 'expired' : 'expiring'}: ${h.name} (${h.certificate_expiry})`, h.certificate_expiry);
  }
  // Water samples whose next action date has passed while the result is pending or unsatisfactory.
  for (const s of await store.all('water_samples')) {
    if (!s.next_action_due || s.next_action_due > today || !['pending_result', 'non_compliant'].includes(s.compliance_status)) continue;
    await add(s.recorded_by, 'sample_action', s.water_source_id, `Water sample action due (${s.sample_reference || 'sample ' + s.id})`, s.next_action_due);
  }
  // Inactivity prompt: officers with no activity record in the last 7 days get one prompt per week.
  const since = addDays(today, -7), weekKey = weekRange(today).start;
  const lastBy = new Map();
  for (const a of await store.all('activity_records')) if (counts(a) && (!lastBy.has(a.recorded_by) || a.activity_date > lastBy.get(a.recorded_by))) lastBy.set(a.recorded_by, a.activity_date);
  const users = new Map((await store.all('users')).map((u) => [u.id, u]));
  for (const m of await store.all('memberships')) {
    if (m.role !== 'officer' || (m.active_to && m.active_to < today) || !isActive(users.get(m.user_id)?.active)) continue;
    if ((lastBy.get(m.user_id) || '') >= since) continue;
    await add(m.user_id, 'inactivity', m.user_id, 'No activity recorded in the last 7 days. Record completed work in the Activity log.', weekKey);
  }
  return n;
}
