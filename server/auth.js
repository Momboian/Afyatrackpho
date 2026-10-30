// Login and permission checks used by every protected API route.
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { isActive } from './store.js';
import { todayNairobi } from './util.js';

// Secret used to sign login tokens. Always set your own JWT_SECRET in .env for real use.
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me-' + 'afyatrack';
// How long a login lasts before the user must sign in again (default 10 hours).
export const SESSION_HOURS = Number(process.env.SESSION_HOURS || 10);
// Name of the cookie that holds the login token in the browser.
export const COOKIE = 'afyatrack_session';

// Refuse to start in production without a real secret, so tokens cannot be forged.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET must be set in production. See README.');
  process.exit(1);
}

// Creates a signed login token (JWT) holding the user id.
export function signToken(user) {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: `${SESSION_HOURS}h` });
}

// Hashes a password reset token so the real token is never stored in the database.
export function hashToken(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

/** Active memberships of a user (ward + role), with ward names. */
// A membership links a user to a ward with a role. Ended memberships and inactive wards are skipped.
export async function membershipsOf(store, userId) {
  const today = todayNairobi();
  const [mems, wards] = await Promise.all([store.find('memberships', { user_id: userId }), store.find('wards', { status: 'active' })]);
  const wardMap = new Map(wards.map((w) => [w.id, w]));
  return mems
    .filter((m) => wardMap.has(m.ward_id) && (!m.active_to || m.active_to >= today))
    .map((m) => ({ ...m, ward: wardMap.get(m.ward_id) }));
}

// Loads the user and resolves the active ward + role. Access is enforced here, server side.
// Middleware that runs before protected routes. It reads the token, loads the user,
// works out which wards they can use, and sets req.user, req.ward and req.role.
export function authenticate(store) {
  return async (req, res, next) => {
    try {
      // The website sends the cookie; API clients can send "Authorization: Bearer <token>".
      const header = req.get('authorization');
      const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.[COOKIE];
      if (!token) return res.status(401).json({ error: 'Please sign in.' });
      let payload;
      // Token is fake, changed or expired.
      try { payload = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Your session has expired. Please sign in again.' }); }
      // The user must still exist and be active.
      const u = await store.get('users', payload.sub);
      if (!u || !isActive(u.active)) return res.status(401).json({ error: 'This account is not active.' });
      // Only the safe fields of the user are kept (never the password hash).
      const user = { id: u.id, full_name: u.full_name, email: u.email, phone: u.phone ?? null, active: u.active, is_admin: u.is_admin ? 1 : 0, must_change_password: u.must_change_password ? 1 : 0 };

      // Group the memberships by ward, collecting all roles the user has in each ward.
      const wards = new Map();
      for (const m of await membershipsOf(store, user.id)) {
        if (!wards.has(m.ward_id)) wards.set(m.ward_id, { id: m.ward_id, name: m.ward.name, code: m.ward.code, sub_county: m.ward.sub_county ?? null, county: m.ward.county ?? null, roles: [] });
        wards.get(m.ward_id).roles.push(m.role);
      }
      // Admins can open every active ward, with the admin role added.
      if (user.is_admin) {
        const all = (await store.find('wards', { status: 'active' })).sort((a, b) => a.id - b.id);
        for (const w of all) {
          if (!wards.has(w.id)) wards.set(w.id, { id: w.id, name: w.name, code: w.code, sub_county: w.sub_county ?? null, county: w.county ?? null, roles: [] });
          wards.get(w.id).roles.push('admin');
        }
      }
      // The website and app send the chosen ward in the x-ward-id header. Default is the first ward.
      const requested = Number(req.get('x-ward-id') || req.query.ward_id || 0);
      const ward = requested ? wards.get(requested) : wards.values().next().value;
      if (requested && !ward) return res.status(403).json({ error: 'You are not authorised for that ward.' });

      // Save the results on the request so the route handlers can use them.
      req.user = user;
      req.wards = [...wards.values()];
      req.ward = ward || null;
      const roles = ward?.roles || [];
      req.roles = roles;
      // The highest role wins: admin, then ward lead, then officer, then reviewer.
      req.role = roles.includes('admin') ? 'admin' : roles.includes('ward_lead') ? 'ward_lead' : roles.includes('officer') ? 'officer' : roles.includes('reviewer') ? 'reviewer' : null;
      next();
    } catch (e) {
      next(e);
    }
  };
}

// Role levels. A higher number can do everything a lower one can.
export const RANK = { reviewer: 1, officer: 2, ward_lead: 3, admin: 4 };

// requireRole('officer') => officer, ward_lead or admin. Reviewer is read only.
// Use in a route to block users below a role, for example requireRole('ward_lead').
export function requireRole(min) {
  return (req, res, next) => {
    if (!req.ward && min !== 'admin') return res.status(403).json({ error: 'No ward assigned to your account. Ask an administrator.' });
    if (!req.role || RANK[req.role] < RANK[min]) return res.status(403).json({ error: 'You do not have permission for this action.' });
    next();
  };
}

// Blocks users who are not assigned to any ward.
export function requireWard(req, res, next) {
  if (!req.ward) return res.status(403).json({ error: 'No ward assigned to your account. Ask an administrator.' });
  next();
}

// True for ward leads and admins, who can see and manage the whole team's work.
export const isLead = (req) => req.role === 'ward_lead' || req.role === 'admin';
