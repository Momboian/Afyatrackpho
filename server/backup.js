// Backup and restore for the Firestore database.
//   npm run backup                 -> writes data/backups/afyatrack-YYYYMMDD-HHMMSS.json (all AfyaTrack collections)
//   npm run restore -- <file.json> -> replaces ALL AfyaTrack collections with the backup (stop the server first)
// For large production databases also enable Firestore's managed exports / point in time recovery (see README).
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { getStore } from './store.js';
import { COLLECTIONS, wipe } from './seed.js';

// Read the command: "restore" with a file name, or nothing for a normal backup.
const [, , cmd, file] = process.argv;
// Backups go to data/backups unless BACKUP_DIR is set in .env.
const dir = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.resolve('data', 'backups');
const store = await getStore();

// RESTORE: replace the whole database with the contents of a backup file.
if (cmd === 'restore') {
  if (!file || !fs.existsSync(file)) { console.error('Give the backup file: npm run restore -- data/backups/<file>.json'); process.exit(1); }
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Make sure the file really is an AfyaTrack backup before deleting anything.
  if (!dump.collections?.users?.length) { console.error('This file does not look like an AfyaTrack backup (no users).'); process.exit(1); }
  // Safety copy of the current data, in case the restore was a mistake.
  const before = path.join(dir, `before-restore-${Date.now()}.json`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(before, JSON.stringify(await exportAll()));
  // Delete the current data, then write the backup back in groups of 400 documents.
  await wipe(store);
  let n = 0;
  for (const [c, docs] of Object.entries(dump.collections)) {
    for (let i = 0; i < docs.length; i += 400) {
      const b = store.db.batch();
      for (const d of docs.slice(i, i + 400)) { const { _docId, ...data } = d; b.set(store.db.collection(c).doc(_docId), data); n++; }
      await b.commit();
    }
  }
  console.log(`Restored ${n} documents from ${file}. The previous data was saved to ${before}`);
// BACKUP: save every collection into one JSON file named with the date and time.
} else {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const out = path.join(dir, `afyatrack-${stamp}.json`);
  const dump = await exportAll();
  fs.writeFileSync(out, JSON.stringify(dump));
  // Keep only the newest BACKUP_KEEP backups (default 30) and delete older ones.
  const keep = Number(process.env.BACKUP_KEEP || 30);
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('afyatrack-') && f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(dir, f));
  const count = Object.values(dump.collections).reduce((s, d) => s + d.length, 0);
  console.log(`Backup written: ${out} (${count} documents)`);
}
process.exit(0);

// Reads every AfyaTrack collection into one object, keeping each document id.
async function exportAll() {
  const collections = {};
  for (const c of COLLECTIONS) {
    const snap = await store.db.collection(c).get();
    collections[c] = snap.docs.map((d) => ({ _docId: d.id, ...d.data() }));
  }
  return { app: 'afyatrack-pho', exported_at: new Date().toISOString(), collections };
}
