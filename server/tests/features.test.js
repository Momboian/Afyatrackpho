// Tests for the catalogue release: clean setup (no demo data), two factor sign in, ward and member
// management, new registers, configurable activity forms with drafts, notice and sample workflows,
// quarterly reports, data quality checks, licence approval rules and attachments.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_DRIVER = 'memory';
process.env.AUTH_RATE_LIMIT = '1000';
const { getStore } = await import('../store.js');
const { setupDatabase } = await import('../seed.js');
const { createApp } = await import('../index.js');
const { getOutbox } = await import('../notify.js');
const { setGoogleVerifier } = await import('../routes/auth.js');
const { todayNairobi, addDays } = await import('../util.js');

let server, base, db, accounts;
const testUsers = [];
const tokens = {};
const today = todayNairobi();

// Sends a JSON request with an optional sign in token and returns { status, body }.
const call = (token, p, opts = {}) => fetch(`${base}${p}`, {
  ...opts, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  body: opts.body ? JSON.stringify(opts.body) : undefined
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
// Reads the latest sign in code emailed to an address.
const lastCode = (email) => /code is (\d{6})/.exec([...getOutbox()].reverse().find((m) => m.channel === 'email' && m.to === email)?.text || '')?.[1];
// Full two step sign in.
async function signIn(email, password) {
  const s1 = await call(null, '/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(s1.status, 200, JSON.stringify(s1.body));
  const s2 = await call(null, '/auth/verify', { method: 'POST', body: { challenge_id: s1.body.challenge_id, code: lastCode(email) } });
  assert.equal(s2.status, 200, JSON.stringify(s2.body));
  return s2.body.token;
}

before(async () => {
  db = await getStore();
  accounts = await setupDatabase(db);
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  // The only setup account is the System Administrator (Ian Mombo, spfreak24@gmail.com).
  tokens.ian = await signIn('spfreak24@gmail.com', accounts[0].password);
  tokens.harun = tokens.ian;
  // Test only users, created by the administrator in this temporary in memory database.
  const ward = (await db.all('wards'))[0];
  const add = async (full_name, email, role) => {
    const r = await call(tokens.ian, '/users', { method: 'POST', body: { full_name, email, password: 'TestPass123', memberships: [{ ward_id: ward.id, role }] } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return { id: r.body.id, full_name, email, password: 'TestPass123', role };
  };
  testUsers.push(await add('Officer One', 'officer.one@example.com', 'officer'));
  testUsers.push(await add('Test Reviewer', 'reviewer.test@example.com', 'reviewer'));
  tokens.mombo = await signIn('officer.one@example.com', 'TestPass123');
  tokens.agatha = await signIn('reviewer.test@example.com', 'TestPass123');
});
after(() => { server.close(); });

test('setup creates only the System Administrator, Kinondo Ward and the catalogue (no test or demo data)', async () => {
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].email, 'spfreak24@gmail.com');
  assert.equal(accounts[0].full_name, 'Ian Mombo');
  assert.equal(accounts[0].password, 'Speedfreak1!');
  assert.equal(accounts[0].is_admin, true);
  const wards = await db.all('wards');
  assert.equal(wards.length, 1);
  assert.equal(wards[0].name, 'Kinondo Ward');
  assert.equal((await db.all('food_premises')).length, 0);
  assert.equal((await db.all('tasks')).length, 0);
  assert.ok((await db.all('categories')).length >= 30);
  const me = await call(tokens.ian, '/auth/me');
  assert.equal(me.body.role, 'admin');
  assert.equal(me.body.user.is_admin, 1);
  assert.equal(me.body.user.must_change_password, 0);
  assert.equal((await call(tokens.mombo, '/auth/me')).body.role, 'officer');
  assert.equal((await call(tokens.agatha, '/auth/me')).body.role, 'reviewer');
});

test('two factor: the password alone gives no token, a wrong code is rejected and attempts are limited', async () => {
  const a = testUsers[0];
  const s1 = await call(null, '/auth/login', { method: 'POST', body: { email: a.email, password: a.password } });
  assert.equal(s1.body.two_factor, true);
  assert.equal(s1.body.token, undefined);
  assert.ok(s1.body.sent_to.some((x) => x.channel === 'email' && x.to.includes('*')));
  const wrong = await call(null, '/auth/verify', { method: 'POST', body: { challenge_id: s1.body.challenge_id, code: '000000' === lastCode(a.email) ? '111111' : '000000' } });
  assert.equal(wrong.status, 401);
  for (let i = 0; i < 4; i++) await call(null, '/auth/verify', { method: 'POST', body: { challenge_id: s1.body.challenge_id, code: '999999' === lastCode(a.email) ? '888888' : '999999' } });
  const locked = await call(null, '/auth/verify', { method: 'POST', body: { challenge_id: s1.body.challenge_id, code: lastCode(a.email) } });
  assert.equal(locked.status, 429);
});

test('admin adds a ward, adds and removes members, and edits a user email and phone', async () => {
  const w = await call(tokens.ian, '/wards', { method: 'POST', body: { name: 'Ukunda Ward', code: 'ukd', sub_county: 'Msambweni', county: 'Kwale' } });
  assert.equal(w.status, 201);
  assert.equal((await call(tokens.mombo, '/wards', { method: 'POST', body: { name: 'X Ward' } })).status, 403);
  const harun = testUsers[0];
  const add = await call(tokens.ian, `/wards/${w.body.id}/members`, { method: 'POST', body: { user_id: harun.id, role: 'officer' } });
  assert.equal(add.status, 201);
  let members = (await call(tokens.ian, `/wards/${w.body.id}/members`)).body;
  assert.equal(members.length, 1);
  assert.equal((await call(tokens.ian, `/memberships/${members[0].id}`, { method: 'DELETE' })).status, 200);
  members = (await call(tokens.ian, `/wards/${w.body.id}/members`)).body;
  assert.equal(members.length, 0);
  const upd = await call(tokens.ian, `/users/${harun.id}`, { method: 'PATCH', body: { email: 'harun@example.com', phone: '0712 345 678' } });
  assert.equal(upd.status, 200);
  const u = await db.get('users', harun.id);
  assert.equal(u.email_lower, 'harun@example.com');
  assert.equal(u.phone, '+254712345678');
  // Put the account back so later tests can sign in with the setup email.
  await call(tokens.ian, `/users/${harun.id}`, { method: 'PATCH', body: { email: harun.email } });
  assert.equal((await call(tokens.ian, `/wards/${w.body.id}`, { method: 'PATCH', body: { status: 'inactive' } })).status, 200);
});

test('new registers: school with conditional checklist, complaint with automatic reference, reviewer cannot see complainant', async () => {
  const sc = await call(tokens.harun, '/registers/school', { method: 'POST', body: { school_name: 'Kinondo Primary', has_kitchen: 1, boarding: 'day' } });
  assert.equal(sc.status, 201);
  const list = (await call(tokens.harun, '/checklists/school')).body.items;
  assert.ok(list.includes('# Kitchen (if has_kitchen)'));
  const cmp = await call(tokens.harun, '/registers/complaint', { method: 'POST', body: { title: 'Blocked drain near market', received_date: today, complainant_name: 'Resident A', complainant_contact: '0700000000' } });
  assert.equal(cmp.status, 201);
  const row = (await call(tokens.harun, `/registers/complaint/${cmp.body.id}`)).body.record;
  assert.match(row.complaint_ref, /^CMP\/KND\/\d{4}\/\d{4}$/);
  assert.equal(row.status, 'received');
  const asReviewer = (await call(tokens.agatha, `/registers/complaint/${cmp.body.id}`)).body.record;
  assert.equal(asReviewer.complainant_name, '••• restricted');
  const ins = await call(tokens.harun, '/inspections', { method: 'POST', body: { entity_type: 'complaint', entity_id: cmp.body.id, inspection_date: today, purpose: 'complaint',
    findings_list: [{ finding: 'Drain blocked with refuse', required_action: 'Clear drain', deadline: addDays(today, 3) }] } });
  assert.equal(ins.status, 201);
  assert.equal((await db.get('complaints', cmp.body.id)).status, 'under_investigation');
  const detail = (await call(tokens.harun, `/inspections/${ins.body.id}`)).body;
  assert.match(detail.reference, /^INS\/KND\//);
  assert.equal(detail.findings[0].status, 'action_assigned');
  assert.equal((await call(tokens.harun, `/findings/${detail.findings[0].id}`, { method: 'PATCH', body: { status: 'escalated' } })).status, 400);
  assert.equal((await call(tokens.harun, `/findings/${detail.findings[0].id}`, { method: 'PATCH', body: { status: 'reported_complied' } })).status, 200);
  const word = await fetch(`${base}/inspections/${ins.body.id}/word`, { headers: { authorization: `Bearer ${tokens.harun}` } });
  assert.equal(word.status, 200);
  assert.match(await word.text(), /SANITARY INSPECTION REPORT/);
});

test('activity forms: required fields checked, drafts not counted until submitted, people reached reported', async () => {
  const cats = (await call(tokens.harun, '/lookups')).body.categories;
  const talk = cats.find((c) => c.name === 'Health talk or campaign');
  assert.ok(talk.form.some((f) => f.key === 'people_reached' && f.required));
  const missing = await call(tokens.harun, '/activities', { method: 'POST', body: { category_id: talk.id, activity_date: today, details: { topic: 'Cholera prevention' } } });
  assert.equal(missing.status, 400);
  assert.ok(missing.body.errors['details.people_reached']);
  const draft = await call(tokens.harun, '/activities', { method: 'POST', body: { category_id: talk.id, activity_date: today, status: 'draft', details: { topic: 'Cholera prevention' } } });
  assert.equal(draft.status, 201);
  let rep = (await call(tokens.harun, `/reports?type=monthly&month=${today.slice(0, 7)}`)).body;
  assert.equal(rep.activities.find((a) => a.category_id === talk.id), undefined);
  const sub = await call(tokens.harun, `/activities/${draft.body.id}`, { method: 'PATCH', body: { status: 'submitted', details: { topic: 'Cholera prevention', people_reached: 45 } } });
  assert.equal(sub.status, 200);
  rep = (await call(tokens.harun, `/reports?type=monthly&month=${today.slice(0, 7)}`)).body;
  const row = rep.activities.find((a) => a.category_id === talk.id);
  assert.equal(row.records, 1);
  assert.equal(row.people_reached, 45);
  assert.ok(rep.pillars.some((p) => p.pillar === 'J'));
  const q = `${today.slice(0, 4)}-Q${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}`;
  const qr = (await call(tokens.harun, `/reports?type=quarterly&quarter=${q}`)).body;
  assert.equal(qr.meta.type, 'quarterly');
  assert.ok(qr.totals.people_reached >= 45);
});

test('tasks: assigning to another officer starts as assigned, drafts stay private and are not overdue', async () => {
  const off = await call(tokens.ian, '/users', { method: 'POST', body: { full_name: 'Test Officer', email: 'officer.test@example.com', memberships: [{ ward_id: 1, role: 'officer' }] } });
  assert.equal(off.status, 201);
  const t = await call(tokens.harun, '/tasks', { method: 'POST', body: { title: 'Inspect market', due_at: new Date(Date.now() + 864e5).toISOString(), assigned_to: off.body.id, purpose: 'routine', team_ids: [testUsers[0].id] } });
  assert.equal(t.status, 201);
  assert.equal((await db.get('tasks', t.body.id)).status, 'assigned');
  const d = await call(tokens.harun, '/tasks', { method: 'POST', body: { title: 'Draft idea', due_at: new Date(Date.now() - 864e5).toISOString(), save_as_draft: true } });
  const all = (await call(tokens.harun, '/tasks?status=overdue')).body;
  assert.ok(!all.some((x) => x.id === d.body.id));
  tokens.officer = await signIn('officer.test@example.com', off.body.temporary_password);
  assert.equal((await call(tokens.officer, `/tasks/${d.body.id}`)).status, 404);
  // An officer cannot approve a licence; the ward lead can.
  const p = await call(tokens.officer, '/registers/premises', { method: 'POST', body: { premises_name: 'Mama Upendo Kiosk', licence_status: 'approved' } });
  assert.equal(p.status, 400);
  const p2 = await call(tokens.officer, '/registers/premises', { method: 'POST', body: { premises_name: 'Mama Upendo Kiosk', licence_status: 'applied' } });
  assert.equal(p2.status, 201);
  assert.equal((await call(tokens.harun, `/registers/premises/${p2.body.id}`, { method: 'PATCH', body: { licence_status: 'approved' } })).status, 200);
});

test('notice workflow: submit, approve, issue, serve, compliance and escalation', async () => {
  const prem = (await call(tokens.harun, '/registers/premises', { method: 'POST', body: { premises_name: 'Kinondo Butchery' } })).body.id;
  const tpl = (await call(tokens.harun, '/lookups')).body.templates[0].id;
  const n = await call(tokens.officer, '/notices', { method: 'POST', body: { template_id: tpl, recipient: 'Owner', linked_entity_type: 'premises', linked_entity_id: prem, legal_provision: 'Public Health Act, section to be confirmed', compliance_deadline: addDays(today, 7) } });
  assert.equal(n.status, 201);
  const id = n.body.id, act = (tok, a, body = {}) => call(tok, `/notices/${id}/${a}`, { method: 'POST', body });
  assert.equal((await act(tokens.officer, 'submit')).status, 200);
  assert.equal((await act(tokens.officer, 'approve')).status, 403);
  assert.equal((await act(tokens.harun, 'approve')).status, 200);
  assert.equal((await act(tokens.officer, 'issue', { issue_date: today })).status, 200);
  assert.equal((await act(tokens.officer, 'serve', { service_date: today, service_method: 'Hand delivered', served_to: 'Owner' })).status, 200);
  const comp = await act(tokens.officer, 'compliance', { result: 'not_complied', check_date: today, notes: 'No change', next_check_date: addDays(today, 7) });
  assert.equal(comp.status, 200);
  assert.ok((await db.find('follow_ups', { linked_notice_id: id })).length === 1);
  assert.equal((await act(tokens.harun, 'escalate', { escalated_to: 'Legal office' })).status, 200);
  const done = (await call(tokens.harun, `/notices/${id}`)).body;
  assert.equal(done.status, 'escalated');
  assert.match(done.draft_reference, /^NTC\//);
  assert.ok(done.timeline.length >= 6);
});

test('water samples: planned samples may be in the future; a result is needed before result received', async () => {
  const src = (await call(tokens.harun, '/registers/water_source', { method: 'POST', body: { source_name: 'Mwaroni Borehole' } })).body.id;
  const planned = await call(tokens.harun, `/registers/water_source/${src}/samples`, { method: 'POST', body: { collection_date: addDays(today, 2), stage: 'planned' } });
  assert.equal(planned.status, 201);
  assert.equal((await db.find('activity_records', { linked_entity_type: 'water_source', linked_entity_id: src })).length, 0);
  const bad = await call(tokens.harun, `/samples/${planned.body.id}`, { method: 'PATCH', body: { collection_date: today, stage: 'result_received' } });
  assert.equal(bad.status, 400);
  const ok = await call(tokens.harun, `/samples/${planned.body.id}`, { method: 'PATCH', body: { collection_date: today, stage: 'collected' } });
  assert.equal(ok.status, 200);
  assert.equal((await db.find('activity_records', { linked_entity_type: 'water_source', linked_entity_id: src })).length, 1);
});

test('data quality finds likely duplicates and can dismiss them; attachments upload and download', async () => {
  await call(tokens.harun, '/registers/school', { method: 'POST', body: { school_name: 'Kinondo  Primary.', confirm_duplicate: true } });
  let dq = (await call(tokens.harun, '/data-quality')).body;
  const dup = dq.find((i) => i.kind === 'duplicate' && i.entity_type === 'school');
  assert.ok(dup);
  assert.equal((await call(tokens.agatha, '/data-quality')).status, 200);
  assert.equal((await call(tokens.harun, '/data-quality/dismiss', { method: 'POST', body: { key: dup.key, reason: 'Different schools' } })).status, 200);
  dq = (await call(tokens.harun, '/data-quality')).body;
  assert.ok(!dq.some((i) => i.key === dup.key));

  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const sc = (await call(tokens.harun, '/registers/school')).body[0].id;
  const up = await call(tokens.harun, '/attachments', { method: 'POST', body: { entity_type: 'school', entity_id: sc, name: 'toilets.png', mime: 'image/png', data: png } });
  assert.equal(up.status, 201);
  const list = (await call(tokens.agatha, `/attachments?entity_type=school&entity_id=${sc}`)).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].data, undefined);
  const file = await fetch(`${base}/attachments/${up.body.id}/file`, { headers: { authorization: `Bearer ${tokens.harun}` } });
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal((await call(tokens.harun, '/attachments', { method: 'POST', body: { entity_type: 'school', entity_id: sc, name: 'x.exe', mime: 'application/x-msdownload', data: png } })).status, 400);
});

test('Google sign in: off without a client ID, signs in known emails only and stays linked to one Google account', async () => {
  const google = (credential) => call(null, '/auth/google', { method: 'POST', body: { credential } });
  delete process.env.GOOGLE_CLIENT_ID;
  assert.equal((await call(null, '/auth/config')).body.google_client_id, null);
  assert.equal((await google('x')).status, 503);
  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  assert.equal((await call(null, '/auth/config')).body.google_client_id, 'test-client.apps.googleusercontent.com');
  // A fake Google check: the "credential" is just JSON with the payload.
  setGoogleVerifier(async (c) => { if (c === 'bad') throw new Error('invalid'); return JSON.parse(c); });
  assert.equal((await google('bad')).status, 401);
  assert.equal((await google(JSON.stringify({ email: 'stranger@gmail.com', email_verified: true, sub: 's1' }))).status, 403);
  assert.equal((await google(JSON.stringify({ email: 'SPFREAK24@gmail.com', email_verified: false, sub: 'g1' }))).status, 401);
  const ok = await google(JSON.stringify({ email: 'SPFREAK24@gmail.com', email_verified: true, sub: 'g1' }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await call(ok.body.token, '/auth/me')).body.role, 'admin');
  // The account is now linked to Google account g1; another Google account with the same email is refused.
  assert.equal((await google(JSON.stringify({ email: 'spfreak24@gmail.com', email_verified: true, sub: 'g2' }))).status, 403);
  delete process.env.GOOGLE_CLIENT_ID;
});

test('wards: same name and county allowed; an exact repeat needs confirmation (allow_duplicate)', async () => {
  const add = (body) => call(tokens.ian, '/wards', { method: 'POST', body });
  const a = await add({ name: 'Marungu Ward', code: 'MRG', sub_county: 'Mwatate', county: 'Taita Taveta' });
  assert.equal(a.status, 201);
  // Same name and county, different sub county: saved straight away.
  const b = await add({ name: 'Marungu Ward', code: 'MIA', sub_county: 'Miasenyi sub location', county: 'Taita Taveta' });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  // Exact repeat: the server asks first (409), then saves when the admin confirms.
  const twin = { name: ' marungu ward ', code: 'MIA2', sub_county: 'MIASENYI SUB LOCATION', county: 'taita taveta' };
  const ask = await add(twin);
  assert.equal(ask.status, 409);
  assert.equal(ask.body.duplicate, true);
  assert.equal((await add({ ...twin, allow_duplicate: true })).status, 201);
  // Editing a ward into an exact copy of another also asks first, then works with allow_duplicate.
  assert.equal((await call(tokens.ian, `/wards/${b.body.id}`, { method: 'PATCH', body: { sub_county: 'Mwatate' } })).status, 409);
  assert.equal((await call(tokens.ian, `/wards/${b.body.id}`, { method: 'PATCH', body: { sub_county: 'Mwatate', allow_duplicate: true } })).status, 200);
  // The ward list in /auth/me carries the sub county and code so the website can tell them apart.
  const me = (await call(tokens.ian, '/auth/me')).body;
  assert.ok(me.wards.some((w) => w.name === 'Marungu Ward' && w.code === 'MIA'));
});


test('new users and password resets report what happened to the email', async () => {
  const ward = (await db.all('wards'))[0];
  const r = await call(tokens.ian, '/users', { method: 'POST', body: { full_name: 'Mail Check', email: 'mail.check@example.com', memberships: [{ ward_id: ward.id, role: 'officer' }] } });
  assert.equal(r.status, 201);
  // No SMTP in the tests, so the message is printed in the terminal instead of emailed.
  assert.equal(r.body.email_status, 'printed');
  const reset = await call(tokens.ian, `/users/${r.body.id}/reset-password`, { method: 'POST' });
  assert.equal(reset.body.email_status, 'printed');
  assert.ok([...getOutbox()].some((m) => m.to === 'mail.check@example.com' && /password was reset/.test(m.subject)));
});
