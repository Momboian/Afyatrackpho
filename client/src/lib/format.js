// Date and text formatting helpers used across the website. All dates are shown in Nairobi time.
export const TZ = 'Africa/Nairobi';

// Nairobi is UTC+3 all year, so shift and read the UTC date (works the same in every browser).
export function nairobiDateOf(value) {
  return new Date(new Date(value).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}
// Today's date in Nairobi as YYYY-MM-DD.
export function todayStr() {
  return nairobiDateOf(Date.now());
}
// Adds n days to a YYYY-MM-DD date (negative n goes back).
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Shows a date like "19 Oct 2026". Empty values show a dash.
export function fmtDate(s) {
  if (!s) return '—';
  const d = s.length === 10 ? new Date(s + 'T00:00:00Z') : new Date(s);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: s.length === 10 ? 'UTC' : TZ });
}
// SQLite datetime('now') values look like "2026-10-14 07:30:00" (UTC)
const norm = (s) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') + 'Z' : s);
// Shows a date and time like "19 Oct, 14:30".
export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(norm(iso)).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
// Shows only the time, like "14:30".
export function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
// ISO -> value for <input type="datetime-local"> in Nairobi time
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}
// datetime-local (Nairobi) -> ISO
export function fromLocalInput(v) {
  if (!v) return null;
  return new Date(v + ':00+03:00').toISOString();
}
// Turns codes into readable text, for example "needs_improvement" becomes "Needs improvement".
export const humanize = (s) => (s ? String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—');

// Readable names for each register type.
export const ENTITY_LABEL = { premises: 'Premises', handler: 'Food handler', household: 'Household', water_source: 'Water source', facility: 'Health facility', school: 'School', workplace: 'Market or workplace', complaint: 'Complaint', event: 'Public event', point_of_entry: 'Point of entry', equipment: 'Equipment', cpd: 'CPD record' };
// Readable names for the inspection purposes.
export const PURPOSES = ['routine', 'follow_up', 'complaint', 'registration', 'licensing', 'surveillance', 'campaign', 'other'];
// Public health pillars (activity groups), matching server/catalogue.js.
export const PILLARS = { A: 'Sanitary inspections and premises', B: 'Food hygiene and food premises', C: 'Public health law, notices and complaints', D: 'Water safety and WASH', E: 'Waste management and environmental sanitation', F: 'Vector and vermin control', G: 'School health and hygiene', H: 'Health facility sanitation', I: 'Occupational health and workplaces', J: 'Health education and promotion', K: 'Disease surveillance and alerts', L: 'Port health and points of entry', M: 'Public events', N: 'Routine registers and administration', P: 'Supervision, meetings and equipment' };
// Number of whole days between two YYYY-MM-DD dates.
export const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);

// Ward name with its sub county and short code, so wards with the same name can be told apart.
// Example: "Marungu Ward (Miasenyi, MIA)". Wards without a sub county or code show the name only.
export function wardLabel(w) {
  if (!w) return '';
  const extra = [w.sub_county, w.code].filter(Boolean).join(', ');
  return extra ? `${w.name} (${extra})` : w.name;
}
