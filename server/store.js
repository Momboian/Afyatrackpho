// Thin data layer over Cloud Firestore.
// Each former SQL table is a top level collection. Documents keep a numeric `id` (doc id = String(id))
// so the API keeps stable numeric ids. Ids come from counters in `_counters`.
// Queries use equality filters only (served by Firestore's automatic single field indexes, so no
// composite indexes are needed); ranges, joins and sorting are done in memory. Data is ward scoped,
// which keeps result sets small for a ward pilot.
import { getFirestore } from './firestore.js';

// Current time as a UTC ISO string, saved in created_at and updated_at.
export const nowIso = () => new Date().toISOString();

// Builds the "store" object. All routes use these few functions instead of talking to Firestore directly,
// which keeps the database code in one place.
export function makeStore(db) {
  // Short helpers: col() opens a collection, ref() points at one document by its id.
  const col = (c) => db.collection(c);
  const ref = (c, id) => col(c).doc(String(id));

  const store = {
    db,

    // Gives the next number id for a collection (1, 2, 3 ...).
    // A transaction makes sure two users saving at the same moment never get the same id.
    async nextId(c) {
      const counter = col('_counters').doc(c);
      return db.runTransaction(async (tx) => {
        const s = await tx.get(counter);
        const n = (s.exists ? Number(s.data().value) || 0 : 0) + 1;
        tx.set(counter, { value: n });
        return n;
      });
    },

    // Example: await store.insert('tasks', { title: 'Visit market' }) returns 15.
    /** Inserts a document and returns its new numeric id. */
    async insert(c, data, { timestamps = true } = {}) {
      const id = await store.nextId(c);
      const t = nowIso();
      const doc = { ...(timestamps ? { created_at: t, updated_at: t } : {}), ...data, id };
      await ref(c, id).set(doc);
      return id;
    },

    // Reads one document by id. Returns null when it does not exist.
    async get(c, id) {
      if (id === null || id === undefined || id === '') return null;
      const s = await ref(c, id).get();
      return s.exists ? s.data() : null;
    },

    // Returns every document in a collection that matches all the given fields.
    /** Equality filters only, e.g. find('tasks', { ward_id: 1, deleted_at: null }). */
    async find(c, where = {}) {
      let q = col(c);
      // Add one "field == value" filter for each entry, skipping undefined values.
      for (const [k, v] of Object.entries(where)) if (v !== undefined) q = q.where(k, '==', v);
      const snap = await q.get();
      return snap.docs.map((d) => d.data());
    },

    // Same as find() but returns only the first match (or null).
    async findOne(c, where) {
      return (await store.find(c, where))[0] || null;
    },

    // Returns every document in a collection, with no filter.
    async all(c) {
      const snap = await col(c).get();
      return snap.docs.map((d) => d.data());
    },

    // Changes some fields of a document and, by default, refreshes updated_at.
    async update(c, id, patch, { touch = true } = {}) {
      await ref(c, id).update({ ...patch, ...(touch ? { updated_at: nowIso() } : {}) });
    },

    // Deletes a document permanently.
    async remove(c, id) {
      await ref(c, id).delete();
    },

    // Used to stop duplicates, for example only one activity record per completed task.
    // Firestore create() fails when the key already exists, which we treat as "already claimed".
    /** Claims a unique key once (e.g. "activity_task_12"). Returns false if already claimed. */
    async claim(key) {
      try {
        await col('_unique').doc(key).create({ at: nowIso() });
        return true;
      } catch (e) {
        if (e.code === 6 || /ALREADY_EXISTS/.test(e.message)) return false;
        throw e;
      }
    },

    // Frees a claimed key again, for example when the record it protected is deleted.
    async release(key) {
      await col('_unique').doc(key).delete();
    },

    /** Map of id -> document for a collection filtered by equality. */
    // Example: (await store.byId('users')).get(3) gives the user with id 3.
    async byId(c, where = {}) {
      return new Map((await store.find(c, where)).map((d) => [d.id, d]));
    },
  };
  return store;
}

// The store is created once and shared by the whole server.
let storePromise;
export function getStore() {
  if (!storePromise) storePromise = getFirestore().then(makeStore);
  return storePromise;
}

// Turns a list into a Map keyed by a field, for fast lookups by id.
// ---- small in memory helpers used by the routes ----
export const byKey = (rows, key = 'id') => new Map(rows.map((r) => [r[key], r]));
// Sorts rows by one or more fields. Put a minus sign before a field name to sort newest or largest first,
// for example sortBy(rows, '-created_at').
export const sortBy = (rows, ...keys) =>
  [...rows].sort((a, b) => {
    for (const k of keys) {
      const desc = k.startsWith('-');
      const f = desc ? k.slice(1) : k;
      const av = a[f] ?? '', bv = b[f] ?? '';
      if (av < bv) return desc ? 1 : -1;
      if (av > bv) return desc ? -1 : 1;
    }
    return 0;
  });
// True when a flag is switched on. Old SQL data stored 1 or "1", new data stores true.
export const isActive = (v) => v === 1 || v === true || v === '1';
