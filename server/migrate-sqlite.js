// One time migration: copies an existing AfyaTrack SQLite database (data/afyatrack.db) into Firestore.
// Usage: npm run migrate:sqlite -- [path/to/afyatrack.db]
// Needs the optional better-sqlite3 package (npm i better-sqlite3) and Firebase credentials in .env.
// Refuses to run if Firestore already has users, so it cannot overwrite live data by accident.
import path from 'node:path';
import fs from 'node:fs';
import 'dotenv/config';
import { getStore } from './store.js';

// Path to the old SQLite file (from the command, DB_PATH in .env, or the default).
const file = path.resolve(process.argv[2] || process.env.DB_PATH || 'data/afyatrack.db');
if (!fs.existsSync(file)) { console.error(`SQLite file not found: ${file}`); process.exit(1); }
// better-sqlite3 is optional, so load it only here and explain how to install it if missing.
let Database;
try { Database = (await import('better-sqlite3')).default; } catch { console.error('Install the optional dependency first: npm i better-sqlite3'); process.exit(1); }

// Stop if Firestore already has data, so nothing is overwritten.
const store = await getStore();
if (!(await store.db.collection('users').limit(1).get()).empty) { console.error('Firestore already has users. Migration only runs into an empty database.'); process.exit(1); }

// Open the SQLite file read only and list its tables.
const sql = new Database(file, { readonly: true });
const tables = sql.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map((t) => t.name);
// Columns that were saved as JSON text in SQLite and become real lists in Firestore.
const JSON_COLS = { checklists: ['items'], inspections: ['checklist_results'] };
// SQLite saved times as "2026-10-19 09:00:00". Convert them to ISO "2026-10-19T09:00:00.000Z".
const toIso = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? v.replace(' ', 'T') + '.000Z' : v);
let total = 0;
// Copy each table into a collection with the same name, 400 rows per batch.
for (const t of tables) {
  const rows = sql.prepare(`SELECT * FROM ${t}`).all();
  let maxId = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const b = store.db.batch();
    for (const r of rows.slice(i, i + 400)) {
      const doc = {};
      // Convert time columns and JSON columns, and add email_lower for users.
      for (const [k, v] of Object.entries(r)) doc[k] = /_at$|^at$/.test(k) ? toIso(v) : v;
      for (const k of JSON_COLS[t] || []) if (typeof doc[k] === 'string') { try { doc[k] = JSON.parse(doc[k]); } catch { /* keep text */ } }
      if (t === 'users') doc.email_lower = String(doc.email).toLowerCase();
      b.set(store.db.collection(t).doc(String(r.id)), doc);
      maxId = Math.max(maxId, r.id);
      total++;
    }
    await b.commit();
  }
  // Set the id counter so new records continue after the highest old id.
  if (maxId) await store.db.collection('_counters').doc(t).set({ value: maxId });
  // keep the "counted once" guarantees for records that already exist
  if (t === 'activity_records') for (const r of rows) {
    if (r.linked_task_id) await store.claim(`activity_task_${r.linked_task_id}`);
    if (r.linked_inspection_id) await store.claim(`activity_inspection_${r.linked_inspection_id}`);
  }
  // Copy the "only once" claims too, so old reminders are not sent again.
  if (t === 'reminders') for (const r of rows) await store.claim(`reminder_${r.user_id}_${r.linked_record_type}_${r.linked_record_id}_${r.scheduled_at}`);
  console.log(`${t}: ${rows.length}`);
}
console.log(`Done. ${total} rows copied from ${file} to ${store.db.isMemory ? 'memory' : 'Firestore'}.`);
process.exit(0);
