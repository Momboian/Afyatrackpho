// Main entry point of the API server. Run with: node server/index.js (or npm run dev).
// Loads the settings from the .env file into process.env before anything else runs.
import 'dotenv/config';
// Libraries: express (web server), helmet (security headers), cookie-parser (reads the login cookie).
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
// Our own modules: database store, login check, and the groups of API routes.
import { getStore } from './store.js';
import { authenticate } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { workRoutes, runReminders } from './routes/work.js';
import { recordRoutes } from './routes/records.js';
import { adminRoutes } from './routes/admin.js';

// Folder of this file, used to find the built website in the dist folder.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Builds the Express app. Kept as a function so the tests can create an app with a test database.
export function createApp(store) {
  const app = express();
  // Trust the first proxy (Render, Nginx) so the real visitor IP is used for rate limits and the audit log.
  app.set('trust proxy', 1);
  // Security headers. The content security policy only allows scripts, styles and fonts from safe places.
  // Google sign in needs its script, its button frame and its popup window, so those Google addresses are allowed too.
  const GSI = 'https://accounts.google.com/gsi/';
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', `${GSI}style`],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
        scriptSrc: ["'self'", `${GSI}client`],
        frameSrc: [GSI],
        connectSrc: ["'self'", GSI]
      }
    },
    // The Google sign in popup must be able to report back to this page.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    // Google checks which site the button is on, so the site address (not the full page path) is sent.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  }));
  // Read JSON request bodies (up to 3 MB, room for attachments) and cookies.
  app.use(express.json({ limit: '3mb' }));
  app.use(cookieParser());

  // Health check. Open http://localhost:4000/api/health to confirm the API is running and which database it uses.
  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString(), database: store.db.isMemory ? 'memory' : 'firestore' }));
  // Sign in, sign out, forgot password and reset password. These do not need a logged in user.
  app.use('/api/auth', authRoutes(store));
  // Every route below this line needs a valid login (cookie for the website, or a Bearer token).
  const auth = authenticate(store);
  // Planner, dashboard, activities, follow ups and reminders.
  app.use('/api', auth, workRoutes(store));
  // Registers, samples, inspections and notices.
  app.use('/api', auth, recordRoutes(store));
  // Users, wards, settings, targets, audit log and reports.
  app.use('/api', auth, adminRoutes(store));
  // Any other /api address that does not exist returns 404.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // In production, after npm run build, the same server also serves the website files.
  // Serve the built web app in production
  const dist = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    // Any non API address returns index.html so React Router can show the right page.
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // Last safety net: any error in a route is logged in the terminal as [error] and the user gets a 500 message.
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'Something went wrong on the server. The error has been logged.' });
  });
  return app;
}

// The code below only runs when this file is started directly, not when the tests import it.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // Connect to the database (Firestore, or memory when DB_DRIVER=memory).
  const store = await getStore();
  // Quick check that the database can be reached and has users.
  try {
    const anyUser = await store.db.collection('users').limit(1).get();
    // In memory mode the database starts empty, so run the setup (starting accounts and catalogue) automatically.
    if (anyUser.empty && store.db.isMemory) {
      const { setupDatabase, accountsText } = await import('./seed.js');
      const created = await setupDatabase(store);
      console.log(`In-memory database set up (lost on restart).\n${accountsText(created)}`);
    } else if (anyUser.empty) console.warn('No users found. Run "npm run setup" to create the starting accounts.');
  // Stop with a clear message when Firestore cannot be reached (wrong key, no internet, wrong project id).
  } catch (e) {
    console.error('Could not reach Firestore. Check the Firebase credentials in .env (see README, Firebase setup).');
    console.error(e.message);
    process.exit(1);
  }
  // Start listening for requests on PORT (default 4000).
  const app = createApp(store);
  const port = Number(process.env.PORT || 4000);
  const server = app.listen(port, () => console.log(`AfyaTrack PHO API running on http://localhost:${port} (database: ${store.db.isMemory ? 'in memory' : 'Cloud Firestore'})`));
  // Port already taken: usually the API is already running in another terminal.
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. The API is probably already running in another terminal (npm run dev starts it).\nClose that terminal, or stop it with: taskkill /F /IM node.exe`);
      process.exit(1);
    }
    throw e;
  });
  // Reminder job: checks for due tasks and follow ups and creates in app reminders.
  // It runs once at start and then every REMINDER_INTERVAL_SECONDS (default 60 seconds).
  const tick = async () => { try { const n = await runReminders(store); if (n) console.log(`[reminders] ${n} new in app reminder(s)`); } catch (e) { console.error('[reminders]', e.message); } };
  tick();
  setInterval(tick, Number(process.env.REMINDER_INTERVAL_SECONDS || 60) * 1000);
}
