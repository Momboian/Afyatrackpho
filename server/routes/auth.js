// Routes under /api/auth: two step sign in (password, then a code sent by email),
// sign in with Google, resend code, logout, forgot password, reset password, current user and change password.
import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { signToken, hashToken, COOKIE, SESSION_HOURS, authenticate } from '../auth.js';
import { makeAudit, asyncRouter } from '../util.js';
import { isActive, nowIso } from '../store.js';
import { sendEmail, mask } from '../notify.js';
import { OAuth2Client } from 'google-auth-library';

// How long a sign in code stays valid, how many wrong tries are allowed, and the wait before a resend.
const CODE_MINUTES = Number(process.env.TWO_FACTOR_CODE_MINUTES || 10);
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 30;
// TWO_FACTOR=off switches the second step off (not recommended, only for emergencies).
const twoFactorOn = () => process.env.TWO_FACTOR !== 'off';

// Sign in with Google. GOOGLE_CLIENT_ID in .env is the OAuth Web client ID from Google Cloud Console.
// When it is empty the Google button is hidden and /api/auth/google is switched off.
const googleClientId = () => (process.env.GOOGLE_CLIENT_ID || '').trim();
// Checks the ID token that the Google button gives the website: Google's signature, expiry and that it
// was issued for our client ID. Returns the token payload (email, email_verified, sub, name).
let googleClient = null;
let verifyGoogle = async (credential) => {
  googleClient ||= new OAuth2Client(googleClientId());
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: googleClientId() });
  return ticket.getPayload();
};
// Lets the automated tests replace the Google check with a fake one (no internet needed).
export const setGoogleVerifier = (fn) => { verifyGoogle = fn; };

export function authRoutes(store) {
  const r = asyncRouter(express.Router());
  const audit = makeAudit(store);
  // Rate limit: at most AUTH_RATE_LIMIT attempts (default 30) per 15 minutes per IP, to slow down password guessing.
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE_LIMIT || 30), standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });

  // Cookie settings. httpOnly means page scripts cannot read the token. Set COOKIE_SECURE=true when using https.
  const cookieOpts = {
    httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true',
    maxAge: SESSION_HOURS * 3600 * 1000, path: '/'
  };
  // The audit log needs a request like object. This builds one for a user who is not signed in yet.
  const ctx = (req, user) => ({ user, ip: req.ip, get: req.get.bind(req) });
  // Emails are stored in lower case in email_lower, so sign in is not case sensitive.
  const findUserByEmail = async (email) => {
    const e = String(email || '').trim().toLowerCase();
    return e ? store.findOne('users', { email_lower: e }) : null;
  };

  // Finishes the sign in: sets the cookie and also returns the token (for API clients).
  const completeLogin = async (req, res, user) => {
    await store.update('users', user.id, { last_login_at: nowIso() }, { touch: false });
    const token = signToken(user);
    res.cookie(COOKIE, token, cookieOpts);
    await audit(ctx(req, user), 'login', 'user', user.id);
    res.json({ ok: true, token });
  };

  // Creates a 6 digit code, saves only its hash, and emails it to the user.
  const sendCode = async (user, challengeId = null) => {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const expires = new Date(Date.now() + CODE_MINUTES * 60000).toISOString();
    const text = `Your AfyaTrack PHO sign in code is ${code}. It expires in ${CODE_MINUTES} minutes. Do not share this code with anyone.`;
    const results = [await sendEmail(user.email, 'AfyaTrack PHO sign in code', text)];
    const sent = results.filter((x) => x.ok).map((x) => ({ channel: x.channel, to: mask(x.to, x.channel) }));
    const fields = { code_hash: hashToken(code), expires_at: expires, attempts: 0, last_sent_at: nowIso(), used_at: null };
    let id = challengeId;
    if (id) await store.update('login_challenges', id, fields);
    else id = await store.insert('login_challenges', { user_id: user.id, ...fields });
    return { id, sent, failed: results.filter((x) => !x.ok).map((x) => x.channel) };
  };

  // POST /api/auth/login with { email, password }. Step 1 of 2.
  r.post('/login', limiter, async (req, res) => {
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    // Both fields are required.
    if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });
    const user = await findUserByEmail(email);
    // Same message for "no such email" and "wrong password", so attackers cannot tell which emails exist.
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      await audit(ctx(req, null), 'login_failed', 'user', user?.id, { email });
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    // Deactivated users cannot sign in.
    if (!isActive(user.active)) {
      await audit(ctx(req, user), 'login_blocked_inactive', 'user', user.id);
      return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
    }
    if (!twoFactorOn()) return completeLogin(req, res, user);

    // Step 2: email the code.
    const ch = await sendCode(user);
    if (!ch.sent.length) {
      return res.status(503).json({ error: 'We could not send your sign in code. Ask the administrator to check the email settings and that your account has a valid email address.' });
    }
    await audit(ctx(req, user), 'login_code_sent', 'user', user.id, { channels: ch.sent.map((s) => s.channel) });
    res.json({ ok: true, two_factor: true, challenge_id: ch.id, sent_to: ch.sent, expires_in_minutes: CODE_MINUTES });
  });

  // GET /api/auth/config tells the sign in page which options are switched on.
  r.get('/config', (req, res) => {
    res.json({ google_client_id: googleClientId() || null, two_factor: twoFactorOn() });
  });

  // POST /api/auth/google with { credential } (the ID token from the Google button).
  // Only people who already have an active AfyaTrack account with the same email can sign in;
  // Google sign in never creates accounts. Google has already confirmed the person owns the email
  // (and applies its own 2 Step Verification), so no extra emailed code is needed here.
  r.post('/google', limiter, async (req, res) => {
    if (!googleClientId()) return res.status(503).json({ error: 'Google sign in is not set up. Sign in with your email and password.' });
    const credential = String(req.body?.credential || '');
    if (!credential) return res.status(400).json({ error: 'Google did not return a sign in token. Please try again.' });
    let p;
    try { p = await verifyGoogle(credential); } catch {
      return res.status(401).json({ error: 'Google sign in could not be verified. Please try again.' });
    }
    if (!p?.email || p.email_verified === false) return res.status(401).json({ error: 'Your Google account email is not verified.' });
    const user = await findUserByEmail(p.email);
    if (!user) {
      await audit(ctx(req, null), 'login_google_unknown', 'user', null, { email: p.email });
      return res.status(403).json({ error: `No AfyaTrack account uses ${p.email}. Ask the System Administrator to add you, or sign in with your email and password.` });
    }
    if (!isActive(user.active)) {
      await audit(ctx(req, user), 'login_blocked_inactive', 'user', user.id);
      return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
    }
    // The first Google sign in links the Google account (its permanent id) to the user. After that only that
    // same Google account is accepted, even if the email address is later given to someone else.
    if (user.google_sub && user.google_sub !== p.sub) {
      await audit(ctx(req, user), 'login_google_mismatch', 'user', user.id);
      return res.status(403).json({ error: 'This AfyaTrack account is linked to a different Google account. Sign in with your email and password.' });
    }
    if (!user.google_sub && p.sub) await store.update('users', user.id, { google_sub: p.sub }, { touch: false });
    await audit(ctx(req, user), 'login_google', 'user', user.id);
    await completeLogin(req, res, user);
  });

  // POST /api/auth/verify with { challenge_id, code }. Step 2 of 2.
  r.post('/verify', limiter, async (req, res) => {
    const { challenge_id: id, code } = req.body || {};
    const ch = id ? await store.get('login_challenges', Number(id)) : null;
    if (!ch || ch.used_at) return res.status(400).json({ error: 'This sign in has expired. Please sign in again.' });
    if (ch.expires_at <= nowIso()) return res.status(400).json({ error: 'The code has expired. Request a new code or sign in again.' });
    if (ch.attempts >= MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many wrong codes. Please sign in again.' });
    const user = await store.get('users', ch.user_id);
    if (!user || !isActive(user.active)) return res.status(403).json({ error: 'This account is not active.' });
    const clean = String(code || '').replace(/\D/g, '');
    if (clean.length !== 6 || hashToken(clean) !== ch.code_hash) {
      await store.update('login_challenges', ch.id, { attempts: (ch.attempts || 0) + 1 }, { touch: false });
      await audit(ctx(req, user), 'login_code_failed', 'user', user.id);
      const left = MAX_ATTEMPTS - (ch.attempts || 0) - 1;
      return res.status(401).json({ error: left > 0 ? `The code is not correct. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong codes. Please sign in again.' });
    }
    await store.update('login_challenges', ch.id, { used_at: nowIso() }, { touch: false });
    await completeLogin(req, res, user);
  });

  // POST /api/auth/resend with { challenge_id } sends a fresh code (at most once every 30 seconds).
  r.post('/resend', limiter, async (req, res) => {
    const ch = req.body?.challenge_id ? await store.get('login_challenges', Number(req.body.challenge_id)) : null;
    if (!ch || ch.used_at || (ch.attempts || 0) >= MAX_ATTEMPTS) return res.status(400).json({ error: 'This sign in has expired. Please sign in again.' });
    if (ch.last_sent_at && Date.now() - Date.parse(ch.last_sent_at) < RESEND_SECONDS * 1000) {
      return res.status(429).json({ error: `Please wait ${RESEND_SECONDS} seconds before asking for a new code.` });
    }
    const user = await store.get('users', ch.user_id);
    if (!user || !isActive(user.active)) return res.status(403).json({ error: 'This account is not active.' });
    const out = await sendCode(user, ch.id);
    if (!out.sent.length) return res.status(503).json({ error: 'We could not send your sign in code.' });
    res.json({ ok: true, sent_to: out.sent });
  });

  // POST /api/auth/logout removes the cookie.
  r.post('/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // Forgot password: always responds the same way so emails cannot be discovered.
  r.post('/forgot', limiter, async (req, res) => {
    const user = await findUserByEmail(req.body?.email);
    if (user && isActive(user.active)) {
      // Create a random one hour reset token. Only its hash is saved.
      const token = crypto.randomBytes(24).toString('hex');
      await store.insert('password_resets', {
        user_id: user.id, token_hash: hashToken(token), used_at: null,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString()
      });
      const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const link = `${base}/reset-password?token=${token}`;
      await sendEmail(user.email, 'Reset your AfyaTrack PHO password',
        `A password reset was requested for your AfyaTrack PHO account.\n\nOpen this link within one hour to choose a new password:\n${link}\n\nIf you did not ask for this, ignore this email. Your password will not change.`);
      await audit(ctx(req, user), 'password_reset_requested', 'user', user.id);
    }
    res.json({ ok: true, message: 'If that email belongs to an active account, a reset link has been sent to it.' });
  });

  // POST /api/auth/reset with { token, password } sets a new password.
  r.post('/reset', limiter, async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password || String(password).length < 8)
      return res.status(400).json({ error: 'Use a password with at least 8 characters.' });
    // The link must exist, not be used before, and not be expired.
    const row = await store.findOne('password_resets', { token_hash: hashToken(token), used_at: null });
    if (!row || row.expires_at <= nowIso()) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    // Save the new password as a bcrypt hash (never plain text) and mark the link as used.
    await store.update('users', row.user_id, { password_hash: bcrypt.hashSync(password, 11), must_change_password: 0 });
    await store.update('password_resets', row.id, { used_at: nowIso() });
    await audit(ctx(req, { id: row.user_id }), 'password_reset_completed', 'user', row.user_id);
    res.json({ ok: true });
  });

  // The routes below need a signed in user.
  const auth = authenticate(store);

  // GET /api/auth/me returns the signed in user, their wards and their role. The website calls it on every page load.
  r.get('/me', auth, (req, res) => {
    res.json({ user: req.user, wards: req.wards, ward: req.ward, role: req.role, roles: req.roles });
  });

  // POST /api/auth/change-password with { current, password }.
  r.post('/change-password', auth, async (req, res) => {
    const { current, password } = req.body || {};
    const u = await store.get('users', req.user.id);
    if (!bcrypt.compareSync(String(current || ''), u.password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
    if (!password || String(password).length < 8) return res.status(400).json({ error: 'Use a password with at least 8 characters.' });
    if (String(password) === String(current)) return res.status(400).json({ error: 'Choose a password different from the current one.' });
    await store.update('users', req.user.id, { password_hash: bcrypt.hashSync(password, 11), must_change_password: 0 });
    await audit(req, 'password_changed', 'user', req.user.id);
    res.json({ ok: true });
  });

  return r;
}
