// Per request loader: fetches ward scoped collections once and joins in memory
// (Firestore has no joins). Keeps route code close to the old SQL version.
import { REGISTERS } from './registers.js';
import { isActive, sortBy } from './store.js';
import { todayNairobi } from './util.js';

// Creates a loader for one request. Each list is read from Firestore at most once
// per request and then reused (the cache), which saves reads and money.
export function loader(store, req) {
  const cache = new Map();
  // Runs fn only the first time a key is asked for, then returns the saved result.
  const once = (k, fn) => {
    if (!cache.has(k)) cache.set(k, fn());
    return cache.get(k);
  };
  const ward = req.ward?.id;
  // Each function returns a Map of id to document for quick lookups.
  const L = {
    users: () => once('users', () => store.byId('users')),
    categories: () => once('categories', () => store.byId('categories')),
    locations: () => once('locations', () => store.byId('locations', { ward_id: ward })),
    // Registers (premises, schools, water points ...) are stored in their own collections.
    entities: (type) => once(`entities:${type}`, () => store.byId(REGISTERS[type].table, { ward_id: ward })),
    // Returns the display name of a register entry, for example the premises name.
    async entityName(type, id) {
      if (!REGISTERS[type] || id === null || id === undefined) return null;
      const m = await L.entities(type);
      return m.get(Number(id))?.[REGISTERS[type].nameField] ?? null;
    },
    // True when a register entry with that id exists in this ward.
    async entityExists(type, id) {
      if (!REGISTERS[type] || id === null || id === undefined) return false;
      return (await L.entities(type)).has(Number(id));
    },
    // Full name of a user by id.
    async userName(id) {
      return (await L.users()).get(Number(id))?.full_name ?? null;
    },
    // Name of an activity category by id.
    async categoryName(id) {
      return (await L.categories()).get(Number(id))?.name ?? null;
    },
    /** Active officers / ward leads of this ward, one row per user (roles joined). */
    // Builds the list of officers for drop downs. A user with two roles appears once.
    officers: () => once('officers', async () => {
      const today = todayNairobi();
      const [mems, users] = await Promise.all([store.find('memberships', { ward_id: ward }), L.users()]);
      const out = new Map();
      for (const m of mems) {
        // Skip reviewers and admins, and memberships that have already ended.
        if (!['officer', 'ward_lead'].includes(m.role) || (m.active_to && m.active_to < today)) continue;
        const u = users.get(m.user_id);
        if (!u || !isActive(u.active)) continue;
        const row = out.get(u.id) || { id: u.id, full_name: u.full_name, roles: new Set() };
        row.roles.add(m.role);
        out.set(u.id, row);
      }
      // Sorted by name, with the roles joined as text, for example "officer,ward_lead".
      return sortBy([...out.values()].map((o) => ({ id: o.id, full_name: o.full_name, role: [...o.roles].join(',') })), 'full_name');
    }),
    // Set of user ids in this ward, used to check that a task is assigned to a real team member.
    async memberIds() {
      return new Set((await L.officers()).map((o) => o.id));
    },
  };
  return L;
}
