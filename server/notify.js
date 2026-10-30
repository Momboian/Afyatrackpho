// Sends email through SMTP (nodemailer). Used for the two step sign in codes, password reset links
// and new account invitations.
//
// Settings in .env: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM
//
// When email is not set up, the message is printed in the server terminal instead, so the system
// still works while developing. In production (NODE_ENV=production) it is reported as not delivered.

// Last messages, kept in memory so the automated tests can read the codes.
const outbox = [];
export const getOutbox = () => outbox;

const isProd = () => process.env.NODE_ENV === 'production';
export const emailConfigured = () => !!process.env.SMTP_HOST;

let transporter;
async function mailer() {
  if (transporter) return transporter;
  const nodemailer = (await import('nodemailer')).default;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    // true for port 465, false for 587 (STARTTLS)
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  return transporter;
}

// Turns 0712 345 678, 712345678 or 254712345678 into +254712345678 (Kenyan numbers).
export function normalisePhone(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/[^\d+]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('254')) return '+' + p;
  if (p.startsWith('0')) return '+254' + p.slice(1);
  if (/^[17]\d{8}$/.test(p)) return '+254' + p;
  return p.length >= 9 ? '+' + p : null;
}

// Hides most of an email or phone number for display, for example sp****24@gmail.com or +2547*****678.
export function mask(value, type) {
  if (!value) return '';
  if (type === 'email') {
    const [name, domain] = String(value).split('@');
    const keep = name.length <= 3 ? name.slice(0, 1) : name.slice(0, 2);
    return `${keep}${'*'.repeat(Math.max(2, name.length - keep.length - 2))}${name.length > 4 ? name.slice(-2) : ''}@${domain}`;
  }
  const s = String(value);
  return s.slice(0, 5) + '*'.repeat(Math.max(2, s.length - 8)) + s.slice(-3);
}

// Sends an email. Returns { ok, channel, to, fallback } and never throws.
export async function sendEmail(to, subject, text) {
  outbox.push({ channel: 'email', to, subject, text, at: new Date().toISOString() });
  if (outbox.length > 100) outbox.shift();
  if (!to) return { ok: false, channel: 'email', error: 'No email address on the account.' };
  if (!emailConfigured()) {
    if (isProd()) return { ok: false, channel: 'email', to, error: 'Email is not configured on the server.' };
    console.log(`[email not configured, printed here instead] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return { ok: true, channel: 'email', to, fallback: true };
  }
  try {
    const t = await mailer();
    await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
    return { ok: true, channel: 'email', to };
  } catch (e) {
    console.error('[email] sending failed:', e.message);
    return { ok: false, channel: 'email', to, error: 'The email could not be sent.' };
  }
}
