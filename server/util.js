// Shared helper functions used by every part of the server (dates, audit log, errors).
// The time zone used for all dates in the app.
export const TZ = 'Africa/Nairobi';

// Nairobi is UTC+3 all year (no daylight saving), so shift and read the UTC date.
// This avoids Intl locale formats, which differ between Windows and Linux builds of Node.
export function todayNairobi(d = new Date()) {
  return new Date(new Date(d).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

// Current date and time as a UTC ISO string, for example 2026-10-19T17:30:00.000Z.
export const nowIso = () => new Date().toISOString();

// Adds n days to a date written as YYYY-MM-DD and returns the new date in the same format.
// Use a negative n to go back in time.
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Monday to Sunday week containing dateStr
export function weekRange(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const start = addDays(dateStr, -dow);
  return { start, end: addDays(start, 6) };
}

// Returns the first and last day of a month given as YYYY-MM.
export function monthRange(ym) {
  // Split "2026-10" into year 2026 and month 10.
  const [y, m] = ym.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  // Day 0 of the next month is the last day of this month.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}

// Start/end of a Nairobi calendar date expressed as UTC ISO strings (for timestamp columns)
export function nairobiDayBoundsIso(startDate, endDate) {
  const s = new Date(startDate + 'T00:00:00+03:00').toISOString();
  const e = new Date(addDays(endDate, 1) + 'T00:00:00+03:00').toISOString();
  return { s, e };
}

// Creates the audit function. Every important change (create, update, delete, login) is saved
// to the audit_events collection so admins can see who did what and when.
export function makeAudit(store) {
  return async (req, action, entityType, entityId, summary) => {
    await store.insert('audit_events', {
      actor_user_id: req?.user?.id ?? null,
      ward_id: req?.ward?.id ?? null,
      action,
      entity_type: entityType ?? null,
      entity_id: entityId ?? null,
      at: new Date().toISOString(),
      change_summary: typeof summary === 'string' ? summary : summary ? JSON.stringify(summary) : null,
      ip: req?.ip ?? null,
      user_agent: req?.get?.('user-agent')?.slice(0, 200) ?? null
    }, { timestamps: false });
  };
}

/** Wraps a router so async handlers pass their errors to Express. */
// Express does not catch errors thrown inside async functions on its own.
// This wraps every route so any error is passed to the error handler in index.js
// and the user gets a clean 500 message instead of the server hanging.
export function asyncRouter(router) {
  for (const m of ['get', 'post', 'patch', 'delete', 'put', 'use']) {
    const orig = router[m].bind(router);
    router[m] = (...args) => orig(...args.map((h) => (typeof h === 'function' && h.length < 4
      ? (req, res, next) => Promise.resolve(h(req, res, next)).catch(next) : h)));
  }
  return router;
}

// Compares two versions of a record and returns only the fields that changed,
// in the form { field: { from, to } }. Used for the audit log.
export function diff(before, after) {
  const out = {};
  for (const k of Object.keys(after)) {
    if (String(before?.[k] ?? '') !== String(after[k] ?? '')) out[k] = { from: before?.[k] ?? null, to: after[k] ?? null };
  }
  return out;
}

// Calculates achievement against a target as a percentage with one decimal.
// Returns "N/A" when there is no target or the target is zero.
export function achievementPct(achieved, target) {
  if (target === null || target === undefined || !(Number(target) > 0)) return 'N/A';
  return Math.round((Number(achieved) / Number(target)) * 1000) / 10; // one decimal
}

// Sends a 400 (bad request) reply with a list of field errors so the form can highlight them.
export function bad(res, errors, message = 'Please correct the highlighted fields.') {
  return res.status(400).json({ error: message, errors });
}
