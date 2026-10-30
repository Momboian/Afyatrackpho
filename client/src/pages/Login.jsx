// Sign in (password, then a code sent by email), forgot password and reset password pages, plus the AfyaTrack logo.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, ArrowRight, ShieldCheck, CheckCircle2, ArrowLeft, RotateCw } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { ThemeToggle, useTheme } from '../lib/theme.jsx';
import { Button, Field, Input, ErrorNote } from '../components/ui.jsx';

// The AfyaTrack PHO logo. Clicking it opens the home page for any user
// (signed in users get the dashboard, signed out users land on the sign in page).
// light = true gives the white version for dark backgrounds.
// compact = true shows only the icon (used in the phone top bar).
// onClick runs extra code after the click, for example closing the phone menu.
export function Logo({ light, compact, onClick }) {
  // Always scroll back to the top, even when the user is already on the home page.
  const goHome = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); onClick?.(); };
  return (
    <Link to="/" onClick={goHome} aria-label="AfyaTrack PHO home" title="Go to home page"
      className="inline-flex items-center gap-2.5 rounded-lg outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand-500">
      <svg viewBox="0 0 64 64" className={compact ? 'h-8 w-8' : 'h-9 w-9'} aria-hidden>
        <rect width="64" height="64" rx="14" fill={light ? '#F5F4EE' : '#0F4C40'} />
        <path d="M14 34h10l5-12 7 22 5-14 3 4h6" fill="none" stroke={light ? '#0F4C40' : '#F5F4EE'} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="50" cy="34" r="4" fill="#D98E04" />
      </svg>
      {!compact && (
        <div className="leading-tight">
          <div className={`text-[17px] font-extrabold tracking-tight ${light ? 'text-white' : 'text-ink'}`}>AfyaTrack <span className="text-ochre-500">PHO</span></div>
          <div className={`text-[11px] font-medium uppercase tracking-[0.14em] ${light ? 'text-white/70' : 'text-ink-faint'}`}>Ward public health work</div>
        </div>
      )}
    </Link>
  );
}

// Shared two column layout for the sign in pages: a green panel on the left (large screens only) and the form on the right.
function AuthShell({ children }) {
  const questions = ['What is due today?', 'What is overdue?', 'Which premises, schools or water sources need follow up?', 'What have I completed this week?', 'What goes into my report?'];
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#0B3A31] p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '22px 22px' }} />
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[#14634F]/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-[#D98E04]/20 blur-3xl" />
        <div className="relative"><Logo light /></div>
        <div className="relative max-w-md">
          <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#FAE6BC]/90">Open AfyaTrack and know</p>
          <ul className="space-y-3">
            {questions.map((q, i) => (
              <li key={q} className="flex items-start gap-3 text-[19px] font-semibold leading-snug" style={{ opacity: 1 - i * 0.1 }}>
                <CheckCircle2 className="mt-1 h-5 w-5 flex-none text-[#D98E04]" />{q}
              </li>
            ))}
          </ul>
          <p className="mt-8 max-w-sm text-sm leading-relaxed text-white/70">Plan work, get reminders, keep field records and registers, follow up corrective actions and generate weekly, monthly, quarterly and annual reports from saved records.</p>
        </div>
        <div className="relative flex items-center gap-2 text-[12px] text-white/70">
          <ShieldCheck className="h-4 w-4" /> Two step sign in. Access is limited to your ward and role. All important changes are logged.
        </div>
      </aside>
      <main className="relative flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden"><Logo /></div>
          {children}
        </div>
      </main>
    </div>
  );
}

// Loads Google's sign in script once (https://accounts.google.com/gsi/client) and reuses it afterwards.
let gsiPromise = null;
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  gsiPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { gsiPromise = null; reject(new Error('Google sign in could not load. Check your internet connection.')); };
    document.head.appendChild(s);
  });
  return gsiPromise;
}

// "Sign in with Google" button. It only shows when the server has a GOOGLE_CLIENT_ID set.
// Google returns a signed ID token (credential), which the server checks before signing the user in.
function GoogleSignIn({ onError }) {
  const { loginWithGoogle } = useAuth();
  const { mode } = useTheme();
  const nav = useNavigate();
  const box = useRef(null);
  const [clientId, setClientId] = useState(null);
  const [busy, setBusy] = useState(false);
  // loadError is shown as a small note under the button area (for example when google.com cannot be reached).
  const [loadError, setLoadError] = useState(null);

  // Ask the server whether Google sign in is switched on, and for the client ID.
  useEffect(() => {
    api('/auth/config').then((c) => setClientId(c.google_client_id || null)).catch(() => setClientId(null));
  }, []);

  // Draw Google's button (again when the theme changes, so it matches light or dark).
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadGoogleScript().then(() => {
      if (cancelled || !box.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        ux_mode: 'popup',
        callback: async ({ credential }) => {
          onError(null);
          setBusy(true);
          try { await loginWithGoogle(credential); nav('/', { replace: true }); }
          catch (ex) { onError(ex.message); }
          finally { setBusy(false); }
        }
      });
      box.current.innerHTML = '';
      window.google.accounts.id.renderButton(box.current, {
        type: 'standard', theme: mode === 'dark' ? 'filled_black' : 'outline', size: 'large', text: 'signin_with',
        shape: 'rectangular', logo_alignment: 'center', width: Math.min(400, Math.max(200, box.current.offsetWidth || 400))
      });
    }).catch((ex) => setLoadError(ex.message));
    return () => { cancelled = true; };
  }, [clientId, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!clientId) return null;
  return (
    <div className="mt-5">
      <div className="mb-5 flex items-center gap-3 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
      </div>
      <div className={`relative flex ${loadError ? '' : 'min-h-[44px]'} justify-center ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        <div ref={box} className="w-full [&>div]:mx-auto" />
      </div>
      {busy && <p className="mt-2 text-center text-[13px] text-ink-faint">Signing you in…</p>}
      {loadError && <p className="text-center text-[13px] text-ink-faint">{loadError}</p>}
    </div>
  );
}

// The sign in page: step 1 asks for email and password, step 2 asks for the code sent by email.
// Users can also sign in with Google when it is set up.
export default function Login() {
  const { login, verify } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // challenge holds { challenge_id, sent_to } once the password is accepted.
  const [challenge, setChallenge] = useState(null);

  // Runs when the password form is submitted: checks the fields and asks the server to send a code.
  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (!email || !password) return setErr('Enter your email and password.');
    setBusy(true);
    try {
      const r = await login(email.trim(), password);
      if (r?.two_factor) { setChallenge(r); setPassword(''); }
      else nav('/', { replace: true });
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  if (challenge) return <CodeStep challenge={challenge} setChallenge={setChallenge} verify={verify} onBack={() => { setChallenge(null); setErr(null); }} />;

  return (
    <AuthShell>
      <h1 className="text-[28px] font-extrabold tracking-tight">Sign in</h1>
      <p className="mb-7 mt-1.5 text-sm text-ink-soft">Use the account your administrator created for you.</p>
      <ErrorNote error={err} />
      {/* Email and password fields. The eye button shows or hides the password. */}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email">
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input type="email" autoComplete="username" placeholder="name@county.go.ke" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" autoFocus />
          </div>
        </Field>
        <Field label={<span className="flex items-center justify-between"><span>Password</span><Link to="/forgot-password" className="text-[13px] font-semibold text-brand-600 hover:underline">Forgot password?</Link></span>}>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className="px-9" />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Continue <ArrowRight className="h-4 w-4" /></Button>
      </form>
      {/* Sign in with Google (shown only when GOOGLE_CLIENT_ID is set on the server). */}
      <GoogleSignIn onError={setErr} />
      <p className="mt-6 text-center text-[13px] text-ink-faint">No public sign up. New accounts are created by the System Administrator.</p>
    </AuthShell>
  );
}

// Step 2: enter the 6 digit code. The code can be resent after 30 seconds.
function CodeStep({ challenge, setChallenge, verify, onBack }) {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);
  const [wait, setWait] = useState(30);
  const inputRef = useRef(null);
  // Count down the seconds before "Resend code" is allowed.
  useEffect(() => { const t = setInterval(() => setWait((w) => (w > 0 ? w - 1 : 0)), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async (e) => {
    e?.preventDefault();
    setErr(null);
    if (!/^\d{6}$/.test(code)) return setErr('Enter the 6 digit code.');
    setBusy(true);
    try { await verify(challenge.challenge_id, code); nav('/', { replace: true }); }
    catch (ex) { setErr(ex.message); setCode(''); if (/sign in again/i.test(ex.message)) setTimeout(onBack, 2500); }
    finally { setBusy(false); }
  };
  // Submit automatically once 6 digits are typed or pasted.
  useEffect(() => { if (code.length === 6 && !busy) submit(); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const resend = async () => {
    setErr(null); setInfo(null);
    try {
      const r = await api('/auth/resend', { method: 'POST', body: { challenge_id: challenge.challenge_id } });
      setChallenge({ ...challenge, sent_to: r.sent_to });
      setInfo('A new code has been sent.'); setWait(30);
    } catch (ex) { setErr(ex.message); }
  };

  return (
    <AuthShell>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4" />Back</button>
      <h1 className="text-[28px] font-extrabold tracking-tight">Enter your code</h1>
      <p className="mt-1.5 text-sm text-ink-soft">We sent a 6 digit sign in code to:</p>
      <ul className="mb-6 mt-2 space-y-1">
        {challenge.sent_to.map((s) => (
          <li key={s.channel} className="flex items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4 text-brand-600" />{s.to}
          </li>
        ))}
      </ul>
      <ErrorNote error={err} />
      {info && <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm text-brand-800">{info}</div>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Sign in code" hint={`The code expires in ${challenge.expires_in_minutes || 10} minutes.`}>
          <Input ref={inputRef} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="text-center font-mono text-[26px] tracking-[0.5em]" />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Verify and sign in <ArrowRight className="h-4 w-4" /></Button>
      </form>
      <div className="mt-5 text-center text-sm">
        <button onClick={resend} disabled={wait > 0} className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline disabled:cursor-not-allowed disabled:text-ink-faint disabled:no-underline">
          <RotateCw className="h-4 w-4" />{wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
        </button>
      </div>
      <p className="mt-6 text-center text-[12px] text-ink-faint">Never share this code. AfyaTrack staff will never ask you for it.</p>
    </AuthShell>
  );
}

// Forgot password page: asks for the email and requests a reset link.
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    // Simple email format check before sending.
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.');
    setBusy(true);
    try { const r = await api('/auth/forgot', { method: 'POST', body: { email } }); setDone(r.message); }
    catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <h1 className="text-[26px] font-extrabold tracking-tight">Reset your password</h1>
      <p className="mb-6 mt-1.5 text-sm text-ink-soft">Enter your account email. A reset link valid for one hour will be emailed to you.</p>
      <ErrorNote error={err} />
      {done ? (
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800">{done}</div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>Send reset link</Button>
        </form>
      )}
      <Link to="/login" className="mt-6 block text-center text-sm font-semibold text-brand-600 hover:underline">Back to sign in</Link>
    </AuthShell>
  );
}

// Reset password page, opened from the reset link (it carries ?token=... in the address).
export function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const [ok, setOk] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    // The new password must have 8 characters and both boxes must match.
    if (pw.length < 8) return setErr('Use at least 8 characters.');
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setBusy(true);
    // Send the token and new password, then go back to sign in after a short pause.
    try { await api('/auth/reset', { method: 'POST', body: { token: params.get('token'), password: pw } }); setOk(true); setTimeout(() => nav('/login'), 1800); }
    catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <h1 className="text-[26px] font-extrabold tracking-tight">Choose a new password</h1>
      <p className="mb-6 mt-1.5 text-sm text-ink-soft">At least 8 characters. Avoid reusing old passwords.</p>
      <ErrorNote error={err} />
      {ok ? <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800">Password updated. Taking you to sign in…</div> : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="New password"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Confirm new password"><Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>Update password</Button>
        </form>
      )}
    </AuthShell>
  );
}
