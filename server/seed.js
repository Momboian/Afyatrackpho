// Sets up a new AfyaTrack PHO database with the real starting accounts and configuration.
// No demo or test data is loaded.
//
// Usage: npm run setup          first time setup (skips if users already exist)
//        npm run reset-db       deletes ALL AfyaTrack data, then runs setup (refused in production without --force)
//        npm run catalogue      adds any missing catalogue categories and checklists, keeps all data
//        npm run accounts       creates or updates the SETUP_ACCOUNTS below in an existing database, keeps all data
//
// The starting accounts and their passwords are listed in SETUP_ACCOUNTS below.
// Change these passwords after the first sign in (user menu, Change password) before live use.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore } from './store.js';
import { todayNairobi } from './util.js';
import { CATEGORIES, CHECKLISTS, TEMPLATES } from './catalogue.js';

// Every collection the app uses. reset-db deletes all of them.
export const COLLECTIONS = ['organisations', 'wards', 'locations', 'users', 'memberships', 'password_resets', 'login_challenges', 'categories', 'tasks', 'task_history',
  'activity_records', 'follow_ups', 'food_premises', 'food_handlers', 'households', 'water_sources', 'water_samples', 'healthcare_facilities',
  'schools', 'public_places', 'complaints', 'events', 'points_of_entry', 'equipment', 'cpd_records',
  'checklists', 'inspections', 'inspection_findings', 'notice_templates', 'notice_drafts', 'targets', 'report_runs', 'reminders', 'audit_events',
  'attachments', 'dq_dismissed', '_counters', '_unique'];

// The organisation and first ward.
export const SETUP_ORG = { name: process.env.SETUP_ORG_NAME || 'Kwale County Department of Health', county: 'Kwale', timezone: 'Africa/Nairobi', status: 'active' };
export const SETUP_WARD = { name: 'Kinondo Ward', code: 'KND', sub_county: 'Msambweni', county: 'Kwale', status: 'active' };

// The only starting account: the System Administrator. No test users or demo records are created.
// The administrator can open every ward and adds the real officers, leads and reviewers in Settings, Users.
// roles is empty because administrators get access to every active ward automatically.
export const SETUP_ACCOUNTS = [
  { full_name: 'Ian Mombo', email: 'spfreak24@gmail.com', password: 'Speedfreak1!', is_admin: true, roles: [], label: 'System Administrator' }
];

// Deletes every document in every AfyaTrack collection, 400 at a time (Firestore batch limit is 500).
export async function wipe(store) {
  for (const c of COLLECTIONS) {
    for (;;) {
      const snap = await store.db.collection(c).limit(400).get();
      if (snap.empty) break;
      const b = store.db.batch();
      snap.docs.forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  }
}

// Adds catalogue categories, checklists and notice templates that are not in the database yet.
// Safe to run again: existing items (and any changes the administrator made) are kept.
export async function loadCatalogue(store, adminId = null) {
  let added = 0;
  const cats = await store.all('categories');
  for (const cat of CATEGORIES) {
    if (cats.some((x) => x.name.toLowerCase() === cat.name.toLowerCase())) continue;
    await store.insert('categories', { description: null, form: [], people_field: null, ...cat, active: 1, updated_by: adminId });
    added++;
  }
  const lists = await store.all('checklists');
  for (const [type, items] of Object.entries(CHECKLISTS)) {
    if (lists.some((x) => x.entity_type === type)) continue;
    await store.insert('checklists', { entity_type: type, version: 1, items, active: 1, created_by: adminId });
    added++;
  }
  const tpls = await store.all('notice_templates');
  for (const tpl of TEMPLATES) {
    if (tpls.some((x) => x.name.toLowerCase() === tpl.name.toLowerCase())) continue;
    await store.insert('notice_templates', { ...tpl, approved: 1, active: 1, updated_by: adminId });
    added++;
  }
  return added;
}

// A random temporary password such as "Kp7m-Qx2a-Hw9d" (letters and digits, easy to read out).
const tempPassword = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const part = () => Array.from({ length: 4 }, () => abc[crypto.randomInt(abc.length)]).join('');
  return `${part()}-${part()}-${part()}`;
};

// Creates the organisation, Kinondo Ward, the System Administrator account and the catalogue.
// Returns the accounts with their temporary passwords so they can be printed once.
export async function setupDatabase(store) {
  const today = todayNairobi();
  const org = await store.insert('organisations', SETUP_ORG);
  const ward = await store.insert('wards', { ...SETUP_WARD, organisation_id: org });
  const created = [];
  for (const a of SETUP_ACCOUNTS) {
    // Use the password from SETUP_ACCOUNTS, or a random temporary one (which must be changed at first sign in).
    const password = a.password || tempPassword();
    const id = await store.insert('users', {
      full_name: a.full_name, email: a.email, email_lower: a.email.toLowerCase(), phone: a.phone || null,
      password_hash: bcrypt.hashSync(password, 11), is_admin: a.is_admin ? 1 : 0, active: 1, last_login_at: null, must_change_password: a.password ? 0 : 1
    });
    for (const role of a.roles) await store.insert('memberships', { user_id: id, ward_id: ward, role, active_from: today, active_to: null });
    created.push({ ...a, id, password });
  }
  const admin = created.find((a) => a.is_admin)?.id ?? null;
  await loadCatalogue(store, admin);
  await store.insert('audit_events', { actor_user_id: admin, ward_id: null, action: 'setup', entity_type: 'system', entity_id: null, at: new Date().toISOString(),
    change_summary: 'Initial setup: organisation, Kinondo Ward, System Administrator and catalogue', ip: null, user_agent: null }, { timestamps: false });
  return created;
}

// Creates the SETUP_ACCOUNTS in an existing database, or updates them if the email already exists
// (password, name, admin flag and Kinondo Ward roles). Other users and all records are left alone.
export async function upsertAccounts(store) {
  const today = todayNairobi();
  const wards = await store.all('wards');
  const ward = wards.find((w) => w.name === SETUP_WARD.name) || wards[0];
  if (!ward) throw new Error('No ward found. Run "npm run setup" (empty database) or "npm run reset-db" first.');
  const done = [];
  for (const a of SETUP_ACCOUNTS) {
    const password = a.password || tempPassword();
    const fields = { full_name: a.full_name, email: a.email, email_lower: a.email.toLowerCase(), password_hash: bcrypt.hashSync(password, 11),
      is_admin: a.is_admin ? 1 : 0, active: 1, must_change_password: a.password ? 0 : 1 };
    const existing = await store.findOne('users', { email_lower: a.email.toLowerCase() });
    let id;
    if (existing) { id = existing.id; await store.update('users', id, fields); }
    else id = await store.insert('users', { ...fields, phone: a.phone || null, last_login_at: null });
    // Make sure the user has exactly the listed roles in the ward (old roles in that ward are ended, not erased).
    const mems = (await store.find('memberships', { user_id: id, ward_id: ward.id })).filter((m) => !m.active_to || m.active_to >= today);
    for (const m of mems) if (!a.roles.includes(m.role)) await store.update('memberships', m.id, { active_to: today });
    for (const role of a.roles) if (!mems.some((m) => m.role === role)) await store.insert('memberships', { user_id: id, ward_id: ward.id, role, active_from: today, active_to: null });
    done.push({ ...a, id, password, updated: !!existing });
  }
  return done;
}

// The sign in details printed after setup.
export function accountsText(created) {
  const rows = created.map((a) => `  ${(a.label || (a.is_admin ? 'System Administrator' : a.roles.join(', '))).padEnd(26)}${a.full_name.padEnd(15)}${a.email.padEnd(26)}${a.password}`);
  return `Accounts:\n${rows.join('\n')}\n
Next steps:
  1. Sign in at http://localhost:5173. A sign in code is emailed (printed in this terminal until email is set up in .env).
  2. Add the ward officers, leads and reviewers in Settings, Users.`;
}

// The code below runs only when started with npm run setup, npm run reset-db or npm run catalogue.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const store = await getStore();
  if (process.argv.includes('--catalogue')) {
    const n = await loadCatalogue(store);
    console.log(`Catalogue updated: ${n} new item(s) added. Existing data was not changed.`);
    process.exit(0);
  }
  if (process.argv.includes('--accounts')) {
    const done = await upsertAccounts(store);
    console.log(`Accounts created or updated. Existing records were not changed.\n${accountsText(done)}`);
    process.exit(0);
  }
  if (process.argv.includes('--reset')) {
    // reset-db: wipe everything first. Blocked in production unless --force is added.
    if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
      console.error('Refusing to wipe the database with NODE_ENV=production. Add --force if you really mean it.');
      process.exit(1);
    }
    console.log('Deleting all AfyaTrack data (including any old demo data)...');
    await wipe(store);
  } else if (!(await store.db.collection('users').limit(1).get()).empty) {
    // Normal setup: do nothing if users already exist, so real data is never overwritten.
    console.log('The database already has users. To remove old demo data and start clean, run "npm run reset-db".');
    process.exit(0);
  }
  console.log('Setting up ' + (store.db.isMemory ? 'the in-memory database (lost when this process ends)' : 'Cloud Firestore') + '...');
  const created = await setupDatabase(store);
  console.log(`\nSetup complete.\n${accountsText(created)}\n`);
  process.exit(0);
}
