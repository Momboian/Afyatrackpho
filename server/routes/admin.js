// Administration routes: users, wards and members, locations, categories (with their activity forms),
// targets, notice templates, checklists, audit history, data quality checks and reports. All addresses start with /api.
import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { requireRole, requireWard, isLead } from '../auth.js';
import { makeAudit, bad, todayNairobi, weekRange, monthRange, asyncRouter, addDays } from '../util.js';
import { isValidDate, REGISTERS } from '../registers.js';
import { buildReport, sourceRecords, reportToCsv, periodRange } from '../reports.js';
import { sortBy, nowIso, isActive } from '../store.js';
import { normalisePhone, sendEmail } from '../notify.js';
import { keyOf, PILLARS } from '../catalogue.js';

const ROLES = ['officer', 'ward_lead', 'reviewer'];

export function adminRoutes(store) {
  const r = asyncRouter(express.Router());
  const audit = makeAudit(store);
  // Blocks anyone who is not a System Administrator.
  const adminOnly = (req, res, next) => (req.user.is_admin ? next() : res.status(403).json({ error: 'Administrator access required.' }));
  // Yesterday's date in Nairobi, used to end old memberships.
  const yesterday = () => addDays(todayNairobi(), -1);
  // Current (not ended) memberships.
  const current = (m) => !m.active_to || m.active_to >= todayNairobi();
  // Checks an email address and that no other user has it.
  const emailProblem = async (email, exceptId = null) => {
    if (!/^\S+@\S+\.\S+$/.test(email || '')) return 'Enter a valid email address.';
    const other = await store.findOne('users', { email_lower: String(email).trim().toLowerCase() });
    return other && other.id !== exceptId ? 'A user with this email already exists.' : null;
  };

  // ---------- Users ----------
  // GET /api/users lists users. Admins see everyone, ward leads see only people in their ward.
  r.get('/users', (req, res, next) => (req.user.is_admin || isLead(req) ? next() : res.status(403).json({ error: 'Not permitted.' })), async (req, res) => {
    const [users, mems, wards] = await Promise.all([store.all('users'), store.all('memberships'), store.byId('wards')]);
    const withWard = mems.map((m) => ({ ...m, ward_name: wards.get(m.ward_id)?.name ?? null }));
    // Ward leads only see users who have a membership in their current ward.
    const visible = req.user.is_admin ? users : users.filter((u) => mems.some((m) => m.user_id === u.id && m.ward_id === req.ward?.id));
    // Never send password hashes, only the safe fields plus their ward memberships.
    res.json(sortBy(visible, 'full_name').map((u) => ({
      id: u.id, full_name: u.full_name, email: u.email, phone: u.phone ?? null, active: u.active, is_admin: u.is_admin ? 1 : 0,
      placeholder_email: /@afyatrack\.local$/i.test(u.email || ''), must_change_password: u.must_change_password ? 1 : 0,
      last_login_at: u.last_login_at ?? null, created_at: u.created_at, memberships: withWard.filter((m) => m.user_id === u.id)
    })));
  });

  // Creates a random temporary password, for example "kD8sP2xQ9a".
  const tempPassword = () => crypto.randomBytes(6).toString('base64url') + '9a';

  // POST /api/users creates a user (admin only). If no password is given, a temporary one is returned once
  // and also emailed to the new user.
  r.post('/users', adminOnly, async (req, res) => {
    const b = req.body || {}, errors = {};
    if (!String(b.full_name || '').trim()) errors.full_name = 'Full name is required.';
    const ep = await emailProblem(b.email);
    if (ep) errors.email = ep;
    if (b.phone && !normalisePhone(b.phone)) errors.phone = 'Enter a valid phone number, for example 0712 345 678.';
    // Each membership needs a real active ward and one of the allowed roles.
    const roles = Array.isArray(b.memberships) ? b.memberships : [];
    const wards = await store.byId('wards');
    for (const m of roles) if (!ROLES.includes(m.role) || !wards.has(Number(m.ward_id))) errors.memberships = 'Each role needs a valid ward and role.';
    if (Object.keys(errors).length) return bad(res, errors);
    // Use the given password when it has at least 8 characters, otherwise make a temporary one.
    const pw = b.password && String(b.password).length >= 8 ? String(b.password) : tempPassword();
    const email = String(b.email).trim();
    const id = await store.insert('users', {
      full_name: String(b.full_name).trim(), email, email_lower: email.toLowerCase(), phone: normalisePhone(b.phone),
      password_hash: bcrypt.hashSync(pw, 11), is_admin: b.is_admin ? 1 : 0, active: 1, last_login_at: null, must_change_password: 1
    });
    // Give the user their ward roles, starting today.
    for (const m of roles) await store.insert('memberships', { user_id: id, ward_id: Number(m.ward_id), role: m.role, active_from: todayNairobi(), active_to: null });
    await audit(req, 'create', 'user', id, { email, roles, is_admin: !!b.is_admin });
    // Email the sign in details. The reply says what happened so the website shows the truth:
    // sent (delivered to the mail server), printed (no email set up, shown in the API terminal), failed, or not_sent.
    let email_status = 'not_sent';
    if (!b.password && b.send_invite !== false) {
      const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const r = await sendEmail(email, 'Your AfyaTrack PHO account', `Hello ${String(b.full_name).trim()},\n\nAn AfyaTrack PHO account has been created for you.\n\nSign in at: ${base}\nEmail: ${email}\nTemporary password: ${pw}\n\nYou will receive a sign in code by email. Change your password after signing in.`);
      email_status = !r.ok ? 'failed' : r.fallback ? 'printed' : 'sent';
    }
    res.status(201).json({ id, temporary_password: b.password ? undefined : pw, email_status });
  });

  // PATCH /api/users/:id edits a user (name, email, phone), activates or deactivates them, or changes their roles (admin only).
  r.patch('/users/:id', adminOnly, async (req, res) => {
    const u = await store.get('users', req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    const b = req.body || {}, errors = {};
    // Admins cannot lock themselves out.
    if (u.id === req.user.id && b.active === false) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    if (u.id === req.user.id && b.is_admin === false) return res.status(400).json({ error: 'You cannot remove your own administrator access.' });
    const upd = {};
    if (b.full_name !== undefined) { if (!String(b.full_name).trim()) errors.full_name = 'Full name is required.'; else upd.full_name = String(b.full_name).trim(); }
    if (b.email !== undefined && String(b.email).trim().toLowerCase() !== u.email_lower) {
      const ep = await emailProblem(b.email, u.id);
      if (ep) errors.email = ep; else { upd.email = String(b.email).trim(); upd.email_lower = upd.email.toLowerCase(); }
    }
    if (b.phone !== undefined) {
      if (b.phone && !normalisePhone(b.phone)) errors.phone = 'Enter a valid phone number, for example 0712 345 678.';
      else upd.phone = normalisePhone(b.phone);
    }
    if (Array.isArray(b.memberships)) {
      const wards = await store.byId('wards');
      for (const m of b.memberships) if (!ROLES.includes(m.role) || !wards.has(Number(m.ward_id))) errors.memberships = 'Each role needs a valid ward and role.';
    }
    if (Object.keys(errors).length) return bad(res, errors);
    if (b.active !== undefined) upd.active = b.active ? 1 : 0;
    if (b.is_admin !== undefined && u.id !== req.user.id) upd.is_admin = b.is_admin ? 1 : 0;
    if (Object.keys(upd).length) await store.update('users', u.id, upd);
    // Changing roles: end the current memberships that are no longer wanted (kept for history) and add the new ones.
    if (Array.isArray(b.memberships)) {
      const want = new Set(b.memberships.map((m) => `${Number(m.ward_id)}:${m.role}`));
      const existing = (await store.find('memberships', { user_id: u.id })).filter(current);
      for (const m of existing) if (!want.has(`${m.ward_id}:${m.role}`)) await store.update('memberships', m.id, { active_to: yesterday() });
      const have = new Set(existing.map((m) => `${m.ward_id}:${m.role}`));
      for (const m of b.memberships) if (!have.has(`${Number(m.ward_id)}:${m.role}`)) await store.insert('memberships', { user_id: u.id, ward_id: Number(m.ward_id), role: m.role, active_from: todayNairobi(), active_to: null });
    }
    const changes = { ...upd };
    delete changes.email_lower;
    await audit(req, b.active === false ? 'deactivate' : b.active === true ? 'reactivate' : b.memberships ? 'role_change' : 'update', 'user', u.id, { ...changes, memberships: b.memberships });
    res.json({ ok: true });
  });

  // POST /api/users/:id/reset-password gives the user a new temporary password (admin only).
  r.post('/users/:id/reset-password', adminOnly, async (req, res) => {
    const u = await store.get('users', req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    const pw = tempPassword();
    await store.update('users', u.id, { password_hash: bcrypt.hashSync(pw, 11), must_change_password: 1 });
    await audit(req, 'password_reset_by_admin', 'user', u.id);
    // Email the new temporary password to the user as well, and report whether that worked.
    const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const r = await sendEmail(u.email, 'Your AfyaTrack PHO password was reset', `Hello ${u.full_name},\n\nYour AfyaTrack PHO password was reset by the System Administrator.\n\nSign in at: ${base}\nEmail: ${u.email}\nTemporary password: ${pw}\n\nYou will receive a sign in code by email. Choose your own password after signing in.`);
    res.json({ temporary_password: pw, email_status: !r.ok ? 'failed' : r.fallback ? 'printed' : 'sent' });
  });

  // ---------- Wards and members ----------
  // GET /api/wards lists all wards with the number of current members.
  r.get('/wards', async (req, res) => {
    const [wards, mems] = await Promise.all([store.all('wards'), store.all('memberships')]);
    res.json(sortBy(wards, 'name').map((w) => ({ ...w, member_count: new Set(mems.filter((m) => m.ward_id === w.id && current(m)).map((m) => m.user_id)).size })));
  });
  // Ward fields an administrator can set.
  const wardFields = (b) => ({
    name: String(b.name || '').trim(), code: b.code ? String(b.code).trim().toUpperCase().slice(0, 8) : null,
    sub_county: b.sub_county ? String(b.sub_county).trim() : null, county: b.county ? String(b.county).trim() : null
  });
  // Wards may share a name, sub county and county. Different names in the same county are always fine.
  // An exact repeat of name + sub county + county is also allowed, but only after the administrator
  // confirms it (the website sends allow_duplicate: true), so a ward is not added twice by mistake.
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const duplicateWard = async (f, exceptId = null) => (await store.all('wards'))
    .some((w) => w.id !== exceptId && same(w.name, f.name) && same(w.sub_county, f.sub_county) && same(w.county, f.county));
  const DUPLICATE_WARD = 'A ward with the same name, sub county and county already exists. Save anyway to add another one (give it a different short code so they are easy to tell apart).';
  const askDuplicate = (res) => res.status(409).json({ error: DUPLICATE_WARD, duplicate: true });
  // POST /api/wards creates a ward (admin only).
  r.post('/wards', adminOnly, async (req, res) => {
    const f = wardFields(req.body || {});
    if (!f.name) return bad(res, { name: 'Ward name is required.' });
    if (!req.body?.allow_duplicate && await duplicateWard(f)) return askDuplicate(res);
    const org = (await store.all('organisations'))[0];
    const id = await store.insert('wards', { organisation_id: org?.id ?? null, ...f, status: 'active' });
    await audit(req, 'create', 'ward', id, f);
    res.status(201).json({ id });
  });
  // PATCH /api/wards/:id renames a ward, changes its code or area, or sets it active or inactive (admin only).
  r.patch('/wards/:id', adminOnly, async (req, res) => {
    const w = await store.get('wards', req.params.id);
    if (!w) return res.status(404).json({ error: 'Ward not found.' });
    const b = req.body || {};
    const upd = {};
    if (b.name !== undefined) { const f = wardFields(b); if (!f.name) return bad(res, { name: 'Ward name is required.' }); upd.name = f.name; }
    for (const k of ['code', 'sub_county', 'county']) if (b[k] !== undefined) upd[k] = wardFields({ name: 'x', ...b })[k];
    if (b.status !== undefined) { if (!['active', 'inactive'].includes(b.status)) return bad(res, { status: 'Choose active or inactive.' }); upd.status = b.status; }
    // After the change, the name + sub county + county must still be unique.
    if (!b.allow_duplicate && await duplicateWard({ ...w, ...upd }, w.id)) return askDuplicate(res);
    await store.update('wards', w.id, upd);
    await audit(req, b.status === 'inactive' ? 'deactivate' : 'update', 'ward', w.id, upd);
    res.json({ ok: true });
  });
  // GET /api/wards/:id/members lists the current members of a ward and their roles (admin, or the ward's lead).
  r.get('/wards/:id/members', async (req, res) => {
    const wid = Number(req.params.id);
    if (!req.user.is_admin && !(req.ward?.id === wid && isLead(req))) return res.status(403).json({ error: 'Not permitted.' });
    const [mems, users] = await Promise.all([store.find('memberships', { ward_id: wid }), store.byId('users')]);
    res.json(sortBy(mems.filter(current).map((m) => {
      const u = users.get(m.user_id);
      return { id: m.id, user_id: m.user_id, role: m.role, active_from: m.active_from, full_name: u?.full_name ?? 'Unknown', email: u?.email ?? null, phone: u?.phone ?? null, active: u?.active ?? 0 };
    }), 'full_name', 'role'));
  });
  // POST /api/wards/:id/members with { user_id, role } adds an existing user to a ward (admin only).
  r.post('/wards/:id/members', adminOnly, async (req, res) => {
    const w = await store.get('wards', req.params.id);
    if (!w) return res.status(404).json({ error: 'Ward not found.' });
    const { user_id: uid, role } = req.body || {};
    const u = await store.get('users', Number(uid) || 0);
    if (!u) return bad(res, { user_id: 'Choose a user.' });
    if (!ROLES.includes(role)) return bad(res, { role: 'Choose officer, ward lead or reviewer.' });
    const existing = (await store.find('memberships', { user_id: u.id, ward_id: w.id })).filter(current);
    if (existing.some((m) => m.role === role)) return bad(res, { role: 'This user already has that role in this ward.' });
    const id = await store.insert('memberships', { user_id: u.id, ward_id: w.id, role, active_from: todayNairobi(), active_to: null });
    await audit(req, 'role_change', 'user', u.id, { added: { ward: w.name, role } });
    res.status(201).json({ id });
  });
  // DELETE /api/memberships/:id removes a member's role from a ward. The membership is ended, not erased (admin only).
  r.delete('/memberships/:id', adminOnly, async (req, res) => {
    const m = await store.get('memberships', req.params.id);
    if (!m || !current(m)) return res.status(404).json({ error: 'Membership not found.' });
    await store.update('memberships', m.id, { active_to: yesterday() });
    await audit(req, 'role_change', 'user', m.user_id, { removed: { ward_id: m.ward_id, role: m.role } });
    res.json({ ok: true });
  });

  // POST /api/locations adds a sub location or village to the current ward (ward lead and above).
  r.post('/locations', requireWard, requireRole('ward_lead'), async (req, res) => {
    const b = req.body || {};
    if (!String(b.sub_location || '').trim()) return bad(res, { sub_location: 'Sub location is required.' });
    const id = await store.insert('locations', { ward_id: req.ward.id, location: b.location || null, sub_location: b.sub_location.trim(), village: b.village || null, landmark: b.landmark || null, latitude: null, longitude: null });
    await audit(req, 'create', 'location', id, b);
    res.status(201).json({ id });
  });

  // ---------- Categories (activity types and their forms) ----------
  // Checks a category form: each field needs a label and a known type; drop downs need options.
  const cleanForm = (form) => {
    if (!Array.isArray(form)) return { form: [] };
    const out = [], seen = new Set();
    for (const f of form.slice(0, 40)) {
      if (!f || !String(f.label || '').trim()) continue;
      const type = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'].includes(f.type) ? f.type : 'text';
      let key = keyOf(f.key || f.label);
      while (seen.has(key)) key += '_2';
      seen.add(key);
      const options = type === 'select' ? (Array.isArray(f.options) ? f.options : String(f.options || '').split(',')).map((o) => String(o).trim()).filter(Boolean) : undefined;
      if (type === 'select' && !options.length) return { error: `"${f.label}" is a drop down and needs at least one option.` };
      out.push({ key, label: String(f.label).trim(), type, required: !!f.required, ...(options ? { options } : {}) });
    }
    return { form: out };
  };
  // POST /api/categories creates an activity category with its own form fields (admin only).
  r.post('/categories', adminOnly, async (req, res) => {
    const b = req.body || {};
    if (!String(b.name || '').trim()) return bad(res, { name: 'Category name is required.' });
    const { form, error } = cleanForm(b.form);
    if (error) return bad(res, { form: error });
    const pillar = PILLARS[b.pillar] ? b.pillar : 'N';
    const people = b.people_field && form.some((f) => f.key === b.people_field && f.type === 'number') ? b.people_field : null;
    const id = await store.insert('categories', { name: b.name.trim(), description: b.description || null, module_group: b.module_group || 'general', pillar,
      unit: b.unit || 'activities', form, people_field: people, active: 1, updated_by: req.user.id });
    await audit(req, 'create', 'category', id, { name: b.name, pillar });
    res.status(201).json({ id });
  });
  // PATCH /api/categories/:id renames a category, edits its form, or switches it on or off (admin only).
  r.patch('/categories/:id', adminOnly, async (req, res) => {
    const c = await store.get('categories', req.params.id);
    if (!c) return res.status(404).json({ error: 'Category not found.' });
    const b = req.body || {};
    const upd = { updated_by: req.user.id };
    if (b.name !== undefined) { if (!String(b.name).trim()) return bad(res, { name: 'Category name is required.' }); upd.name = String(b.name).trim(); }
    if (b.description !== undefined) upd.description = b.description || null;
    if (b.unit !== undefined) upd.unit = b.unit || 'activities';
    if (b.pillar !== undefined && PILLARS[b.pillar]) upd.pillar = b.pillar;
    if (b.active !== undefined) upd.active = b.active ? 1 : 0;
    if (b.form !== undefined) {
      const { form, error } = cleanForm(b.form);
      if (error) return bad(res, { form: error });
      upd.form = form;
    }
    if (b.people_field !== undefined) {
      const form = upd.form || c.form || [];
      upd.people_field = b.people_field && form.some((f) => f.key === b.people_field && f.type === 'number') ? b.people_field : null;
    }
    await store.update('categories', c.id, upd);
    await audit(req, 'update', 'category', c.id, { ...b, form: b.form ? `${upd.form.length} field(s)` : undefined });
    res.json({ ok: true });
  });
  // GET /api/pillars lists the public health pillars used to group categories.
  r.get('/pillars', (req, res) => res.json(Object.entries(PILLARS).map(([key, name]) => ({ key, name }))));

  // ---------- Targets ----------
  // GET /api/targets lists the ward's targets with display names.
  r.get('/targets', requireWard, async (req, res) => {
    const [targets, cats, users, locs] = await Promise.all([store.find('targets', { ward_id: req.ward.id }), store.byId('categories'), store.byId('users'), store.byId('locations', { ward_id: req.ward.id })]);
    const rows = targets.map((t) => ({ ...t, category: cats.get(t.category_id)?.name ?? null, officer_name: users.get(t.user_id)?.full_name ?? null,
      approved_by_name: users.get(t.approved_by)?.full_name ?? null, sub_location: locs.get(t.location_id)?.sub_location ?? null }));
    res.json(sortBy(rows, '-period_start', 'category'));
  });
  // POST /api/targets sets a weekly, monthly, quarterly or annual target for the ward, an officer or a location (ward lead and above).
  r.post('/targets', requireWard, requireRole('ward_lead'), async (req, res) => {
    const b = req.body || {}, errors = {};
    if (!(await store.get('categories', Number(b.category_id) || 0))) errors.category_id = 'Choose a category.';
    if (!['weekly', 'monthly', 'quarterly', 'annual'].includes(b.period_type)) errors.period_type = 'Choose weekly, monthly, quarterly or annual.';
    if (!(Number(b.target_value) >= 0) || b.target_value === '' || b.target_value === null) errors.target_value = 'Target must be zero or more.';
    if (b.location_id && !(await store.get('locations', Number(b.location_id)))) errors.location_id = 'Choose a location in this ward.';
    // The period comes from a date in the week, a month (YYYY-MM), a quarter (YYYY-Q1) or a year (YYYY).
    const range = periodRange(b.period_type, { date: b.period_date, month: b.period_month, quarter: b.period_quarter, year: b.period_year });
    if (!range && !errors.period_type) errors.period = 'Pick the target period.';
    if (Object.keys(errors).length) return bad(res, errors);
    const id = await store.insert('targets', {
      ward_id: req.ward.id, category_id: Number(b.category_id), user_id: b.user_id ? Number(b.user_id) : null, location_id: b.location_id ? Number(b.location_id) : null,
      period_type: b.period_type, period_start: range.start, period_end: range.end, target_value: Number(b.target_value), unit: b.unit || 'activities',
      approved_by: req.user.id, created_by: req.user.id
    });
    await audit(req, 'create', 'target', id, { ...b, ...range });
    res.status(201).json({ id });
  });
  // DELETE /api/targets/:id removes a target (ward lead and above).
  r.delete('/targets/:id', requireWard, requireRole('ward_lead'), async (req, res) => {
    const t = await store.get('targets', req.params.id);
    if (!t || t.ward_id !== req.ward.id) return res.status(404).json({ error: 'Target not found.' });
    await store.remove('targets', t.id);
    await audit(req, 'delete', 'target', t.id, t);
    res.json({ ok: true });
  });

  // ---------- Notice templates and checklists ----------
  // GET /api/templates lists notice templates.
  r.get('/templates', async (req, res) => res.json(sortBy(await store.all('notice_templates'), 'name')));
  // POST /api/templates adds a notice template (admin only). Use {{placeholders}} in the body.
  r.post('/templates', adminOnly, async (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.body) return bad(res, { name: 'Name and body are required.' });
    const id = await store.insert('notice_templates', { name: b.name, body: b.body, approved: 1, active: 1, updated_by: req.user.id });
    await audit(req, 'create', 'notice_template', id, { name: b.name });
    res.status(201).json({ id });
  });
  // PATCH /api/templates/:id edits a template (admin only).
  r.patch('/templates/:id', adminOnly, async (req, res) => {
    const t = await store.get('notice_templates', req.params.id);
    if (!t) return res.status(404).json({ error: 'Template not found.' });
    const b = req.body || {};
    await store.update('notice_templates', t.id, { name: b.name ?? t.name, body: b.body ?? t.body, active: b.active === undefined ? t.active : b.active ? 1 : 0, updated_by: req.user.id });
    await audit(req, 'update', 'notice_template', t.id, { name: b.name });
    res.json({ ok: true });
  });
  // POST /api/checklists saves a new checklist version for a type of inspection (admin only).
  // Old versions are switched off but kept, so past inspections still show the checklist they used.
  r.post('/checklists', adminOnly, async (req, res) => {
    const { entity_type, items } = req.body || {};
    if (!REGISTERS[entity_type] || !Array.isArray(items) || !items.some((x) => !String(x).startsWith('#'))) return bad(res, { items: 'Provide at least one checklist item.' });
    const existing = await store.find('checklists', { entity_type });
    const v = Math.max(0, ...existing.map((c) => c.version || 0)) + 1;
    for (const c of existing) if (c.active) await store.update('checklists', c.id, { active: 0 });
    const id = await store.insert('checklists', { entity_type, version: v, items: items.map((x) => String(x).trim()).filter(Boolean), active: 1, created_by: req.user.id });
    await audit(req, 'create', 'checklist', id, { entity_type, version: v });
    res.status(201).json({ id, version: v });
  });

  // ---------- Audit history (read only) ----------
  // GET /api/audit shows the audit history (admins see all wards, leads and reviewers see their ward).
  r.get('/audit', async (req, res) => {
    if (!req.user.is_admin && req.role !== 'reviewer' && req.role !== 'ward_lead') return res.status(403).json({ error: 'Not permitted.' });
    const q = req.query;
    let rows = req.user.is_admin ? await store.all('audit_events') : await store.find('audit_events', { ward_id: req.ward?.id ?? -1 });
    if (q.entity_type) rows = rows.filter((a) => a.entity_type === q.entity_type);
    if (q.action) rows = rows.filter((a) => a.action === q.action);
    if (q.user_id) rows = rows.filter((a) => a.actor_user_id === Number(q.user_id));
    const users = await store.byId('users');
    // Newest first, at most 300 rows, with the name of the person who made each change.
    res.json(sortBy(rows, '-id').slice(0, 300).map((a) => ({ ...a, actor_name: users.get(a.actor_user_id)?.full_name ?? null })));
  });

  // ---------- Data quality checks ----------
  // GET /api/data-quality finds missing fields, likely duplicates, impossible dates, inconsistent records
  // and open actions without follow up dates in the current ward (ward lead, reviewer and admin).
  r.get('/data-quality', requireWard, async (req, res) => {
    if (!isLead(req) && req.role !== 'reviewer') return res.status(403).json({ error: 'Not permitted.' });
    const w = req.ward.id, today = todayNairobi(), issues = [];
    const dismissed = new Set((await store.find('dq_dismissed', { ward_id: w })).map((d) => d.key));
    const add = (kind, type, id, name, message, key = `${kind}:${type}:${id}`) => { if (!dismissed.has(key)) issues.push({ key, kind, entity_type: type, entity_id: id, name, message }); };
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [type, reg] of Object.entries(REGISTERS)) {
      const rows = (await store.find(reg.table, { ward_id: w })).filter((x) => isActive(x.active));
      // Missing important fields.
      for (const x of rows) {
        const nm = x[reg.nameField];
        if (reg.fields.location_id && !x.location_id && !['equipment', 'cpd'].includes(type)) add('missing', type, x.id, nm, 'No location recorded.');
        if (type === 'premises' && ['valid', 'approved'].includes(x.licence_status) && !x.licence_expiry_date) add('missing', type, x.id, nm, 'Licence marked valid but no expiry date.');
        if (type === 'handler' && !x.certificate_expiry) add('missing', type, x.id, nm, 'Medical certificate expiry date not recorded.');
        // Impossible or inconsistent dates.
        if (type === 'premises' && x.licence_issue_date && x.licence_expiry_date && x.licence_expiry_date < x.licence_issue_date) add('impossible_date', type, x.id, nm, 'Licence expiry date is before the issue date.');
        if (type === 'premises' && x.licence_status === 'valid' && x.licence_expiry_date && x.licence_expiry_date < today) add('inconsistent', type, x.id, nm, 'Licence status is valid but the expiry date has passed.');
        if (type === 'handler' && x.status === 'current' && x.certificate_expiry && x.certificate_expiry < today) add('inconsistent', type, x.id, nm, 'Status is current but the certificate has expired.');
        if (type === 'handler' && x.medical_exam_date && x.medical_exam_date > today) add('impossible_date', type, x.id, nm, 'Medical examination date is in the future.');
        if (type === 'event' && x.start_date && x.end_date && x.end_date < x.start_date) add('impossible_date', type, x.id, nm, 'Event end date is before the start date.');
        if (type === 'complaint' && x.received_date > today) add('impossible_date', type, x.id, nm, 'Date received is in the future.');
      }
      // Likely duplicates: same name (ignoring spaces and punctuation) in the same ward.
      if (reg.duplicateCheck) {
        const groups = new Map();
        for (const x of rows) { const k = norm(x[reg.nameField]); if (k) groups.set(k, [...(groups.get(k) || []), x]); }
        for (const g of groups.values()) if (g.length > 1) {
          const ids = g.map((x) => x.id).sort((a, b) => a - b);
          add('duplicate', type, ids[0], g[0][reg.nameField], `${g.length} records share this name (ids ${ids.join(', ')}). Deactivate the extra records or dismiss if they are different.`, `duplicate:${type}:${ids.join('-')}`);
        }
      }
    }
    // Activity records with impossible dates or quantities.
    for (const a of (await store.find('activity_records', { ward_id: w })).filter((x) => !x.deleted_at)) {
      if (a.activity_date > today) add('impossible_date', 'activity', a.id, `Activity ${a.id}`, 'Activity date is in the future.');
      if (!(Number(a.quantity) > 0)) add('inconsistent', 'activity', a.id, `Activity ${a.id}`, 'Quantity is zero or missing.');
    }
    // Findings that need action but have no deadline or follow up.
    const insp = await store.find('inspections', { ward_id: w });
    const fus = await store.find('follow_ups', { ward_id: w });
    const fuFindings = new Set(fus.map((f) => f.linked_finding_id).filter(Boolean));
    for (const i of insp) {
      if (i.next_visit_due && i.next_visit_due < i.inspection_date) add('impossible_date', 'inspection', i.id, i.reference || `Inspection ${i.id}`, 'Next visit date is before the inspection date.');
      for (const f of await store.find('inspection_findings', { inspection_id: i.id })) {
        if (['verified', 'closed', 'resolved'].includes(f.status)) continue;
        if (!f.deadline && !fuFindings.has(f.id)) add('missing_follow_up', 'inspection', i.id, i.reference || `Inspection ${i.id}`, `Open finding without a deadline or follow up: "${f.finding}".`, `missing_follow_up:finding:${f.id}`);
      }
    }
    // Served notices without a compliance deadline.
    for (const n of await store.find('notice_drafts', { ward_id: w })) {
      if (['served', 'issued'].includes(n.status) && !n.compliance_deadline) add('missing_follow_up', 'notice', n.id, n.draft_reference, 'Notice has no compliance deadline.');
    }
    const order = { duplicate: 0, impossible_date: 1, inconsistent: 2, missing_follow_up: 3, missing: 4 };
    res.json(issues.sort((a, b) => order[a.kind] - order[b.kind]));
  });
  // POST /api/data-quality/dismiss with { key, reason } hides an issue that was checked and is correct (ward lead).
  r.post('/data-quality/dismiss', requireWard, requireRole('ward_lead'), async (req, res) => {
    const { key, reason } = req.body || {};
    if (!key) return bad(res, { key: 'Missing issue key.' });
    await store.insert('dq_dismissed', { ward_id: req.ward.id, key: String(key).slice(0, 200), reason: reason || null, by: req.user.id });
    await audit(req, 'dismiss', 'data_quality', null, { key, reason });
    res.json({ ok: true });
  });

  // ---------- Reports ----------
  // Works out the report period: a week (date), a month (month=YYYY-MM), a quarter (quarter=YYYY-Q1) or a year (year=YYYY).
  const resolvePeriod = (q) => {
    const type = ['weekly', 'monthly', 'quarterly', 'annual'].includes(q.type) ? q.type : 'monthly';
    const today = todayNairobi();
    const range = periodRange(type, { date: q.date, month: q.month, quarter: q.quarter, year: q.year }) ||
      periodRange(type, { date: today, month: today.slice(0, 7), quarter: `${today.slice(0, 4)}-Q${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}`, year: today.slice(0, 4) });
    return { type, ...range };
  };
  // Works out whose work the report covers. Officers always get their own report.
  // Leads and reviewers can choose the whole ward, themselves (scope=me) or one officer (scope=user:ID).
  const resolveScope = async (req) => {
    if (!isLead(req) && req.role !== 'reviewer') return { scopeUserId: req.user.id, label: `Officer: ${req.user.full_name}` };
    if (req.query.scope && req.query.scope.startsWith('user:')) {
      const u = await store.get('users', Number(req.query.scope.slice(5)) || 0);
      if (u) return { scopeUserId: u.id, label: `Officer: ${u.full_name}` };
    }
    if (req.query.scope === 'me') return { scopeUserId: req.user.id, label: `Officer: ${req.user.full_name}` };
    return { scopeUserId: null, label: 'Whole ward team' };
  };
  // Saves a record that a report was generated, for the audit trail.
  const logRun = (req, per, scope, format = null) => store.insert('report_runs', {
    ward_id: req.ward.id, report_type: per.type, period_start: per.start, period_end: per.end, generated_by: req.user.id,
    generated_at: nowIso(), filters: JSON.stringify({ scope: scope.label }), export_format: format
  }, { timestamps: false });

  // GET /api/reports returns the weekly, monthly, quarterly or annual report as JSON for the Reports page.
  r.get('/reports', requireWard, async (req, res) => {
    const per = resolvePeriod(req.query), scope = await resolveScope(req);
    const report = await buildReport(store, { wardId: req.ward.id, type: per.type, start: per.start, end: per.end, scopeUserId: scope.scopeUserId });
    await logRun(req, per, scope);
    res.json({ ...report, meta: { ...report.meta, ward: req.ward.name, scope: scope.label } });
  });

  // GET /api/reports/source lists the activity records behind a report row, so numbers can be checked.
  r.get('/reports/source', requireWard, async (req, res) => {
    const per = resolvePeriod(req.query), scope = await resolveScope(req);
    res.json(await sourceRecords(store, { wardId: req.ward.id, categoryId: req.query.category_id ? Number(req.query.category_id) : null, pillar: req.query.pillar || null, start: per.start, end: per.end, scopeUserId: scope.scopeUserId }));
  });

  // GET /api/reports/export.csv downloads the report as a CSV file that opens in Excel.
  r.get('/reports/export.csv', requireWard, async (req, res) => {
    const per = resolvePeriod(req.query), scope = await resolveScope(req);
    const report = await buildReport(store, { wardId: req.ward.id, type: per.type, start: per.start, end: per.end, scopeUserId: scope.scopeUserId });
    await logRun(req, per, scope, 'csv');
    await audit(req, 'export', 'report', null, { type: per.type, start: per.start, end: per.end, format: 'csv', scope: scope.label });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="afyatrack-${per.type}-${per.start}.csv"`);
    res.send(reportToCsv(report, req.ward.name, scope.label));
  });

  // POST /api/reports/printed records in the audit log that a report was printed, saved as PDF or downloaded as Word.
  r.post('/reports/printed', requireWard, async (req, res) => {
    await audit(req, 'export', 'report', null, { ...req.body, format: req.body?.format || 'pdf/print' });
    res.json({ ok: true });
  });

  return r;
}
