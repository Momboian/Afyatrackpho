// A small in-memory stand in for the subset of the Firestore Admin API that AfyaTrack uses.
// Used by the automated tests (DB_DRIVER=memory) so they run without a Firebase project.
// Supported: collection().doc(), add(), where(field, op, value) with == != < <= > >= in, limit(),
// get(), doc get/set(merge)/update/create/delete, runTransaction (get/set/update/create/delete), batch().

// Makes a deep copy so callers can never change the stored data by accident.
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
// Removes fields whose value is undefined (Firestore is set to ignore them too).
const stripUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// Errors that look like the real Firestore errors (same code numbers) so the app handles them the same way.
class AlreadyExists extends Error {
  constructor(path) { super(`6 ALREADY_EXISTS: Document already exists: ${path}`); this.code = 6; }
}
class NotFound extends Error {
  constructor(path) { super(`5 NOT_FOUND: No document to update: ${path}`); this.code = 5; }
}

// Builds a document snapshot like Firestore returns: exists, id and data().
function snapshot(store, name, id, ref) {
  const data = store.get(name)?.get(id);
  return { id, ref, exists: data !== undefined, data: () => clone(data) };
}

// Checks one where() filter, for example status == "open".
function compare(a, op, b) {
  switch (op) {
    case '==': return a === b || (a == null && b == null);
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    case 'in': return Array.isArray(b) && b.includes(a);
    default: throw new Error(`Unsupported operator ${op}`);
  }
}

// Creates the fake database. Data lives in normal JavaScript Maps and is lost when the server stops.
export function createMemoryFirestore() {
  const store = new Map(); // collection -> Map(id -> data)
  let autoId = 0;
  // Returns the Map for a collection, creating it the first time it is used.
  const table = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };

  // A reference to one document with get, set, update, create and delete, like Firestore.
  const docRef = (name, id) => {
    const ref = {
      id,
      path: `${name}/${id}`,
      async get() { return snapshot(store, name, id, ref); },
      // set() replaces the document, or merges into it when { merge: true } is passed.
      async set(data, opts = {}) {
        const t = table(name);
        const prev = opts.merge ? t.get(id) || {} : {};
        t.set(id, clone({ ...prev, ...stripUndefined(data) }));
      },
      // update() only works when the document already exists.
      async update(patch) {
        const t = table(name);
        if (!t.has(id)) throw new NotFound(ref.path);
        t.set(id, clone({ ...t.get(id), ...stripUndefined(patch) }));
      },
      // create() only works when the document does NOT exist yet.
      async create(data) {
        const t = table(name);
        if (t.has(id)) throw new AlreadyExists(ref.path);
        t.set(id, clone(stripUndefined(data)));
      },
      async delete() { table(name).delete(id); },
    };
    return ref;
  };

  // A query keeps a list of filters and an optional limit, then get() applies them.
  const query = (name, filters = [], max = null) => ({
    where(field, op, value) { return query(name, [...filters, { field, op, value }], max); },
    limit(n) { return query(name, filters, n); },
    async get() {
      let docs = [...table(name).entries()]
        .filter(([, d]) => filters.every((f) => compare(d[f.field] ?? null, f.op, f.value)))
        .map(([id]) => snapshot(store, name, id, docRef(name, id)));
      if (max != null) docs = docs.slice(0, max);
      return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
    },
  });

  // A collection is a query with no filters plus doc() and add().
  const collection = (name) => ({
    ...query(name),
    doc: (id) => docRef(name, id ?? `auto${++autoId}`),
    async add(data) { const ref = docRef(name, `auto${++autoId}`); await ref.set(data); return ref; },
  });

  // Transactions run one at a time (Node is single threaded), so they are trivially serialisable here.
  // Transactions: reads happen first, then all writes are applied at the end.
  let chain = Promise.resolve();
  const runTransaction = (fn) => {
    const run = async () => {
      const writes = [];
      const tx = {
        get: (refOrQuery) => refOrQuery.get(),
        set: (ref, data, opts) => { writes.push(() => ref.set(data, opts)); return tx; },
        update: (ref, data) => { writes.push(() => ref.update(data)); return tx; },
        create: (ref, data) => { writes.push(() => ref.create(data)); return tx; },
        delete: (ref) => { writes.push(() => ref.delete()); return tx; },
      };
      const result = await fn(tx);
      for (const w of writes) await w();
      return result;
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  };

  // Batch: collects several writes and applies them all on commit().
  const batch = () => {
    const writes = [];
    const b = {
      set: (ref, data, opts) => { writes.push(() => ref.set(data, opts)); return b; },
      update: (ref, data) => { writes.push(() => ref.update(data)); return b; },
      create: (ref, data) => { writes.push(() => ref.create(data)); return b; },
      delete: (ref) => { writes.push(() => ref.delete()); return b; },
      async commit() { for (const w of writes) await w(); },
    };
    return b;
  };

  // The object returned here behaves like the real Firestore db for everything AfyaTrack uses.
  return {
    isMemory: true,
    collection,
    runTransaction,
    batch,
    async listCollections() { return [...store.keys()].map((id) => ({ id })); },
    settings() {},
    // _dump and _load are only used by tests and backups to copy all data in and out.
    _dump: () => Object.fromEntries([...store].map(([k, m]) => [k, Object.fromEntries(m)])),
    _load: (dump) => { store.clear(); for (const [k, docs] of Object.entries(dump)) store.set(k, new Map(Object.entries(docs))); },
  };
}
