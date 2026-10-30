# AfyaTrack PHO: Web App

Ward level work management for Public Health Officers (PHOs): planning and reminders, registers, inspections, findings and follow ups, notices, activity records and weekly, monthly, quarterly and annual reports. Built from the *PHO App Product Development* specification (v1.1) and the *Public Health Work Catalogue and Application Requirements* (draft v1.0, 21 October 2026).

The app is a work aid. It does not replace official registers, legal approvals or mandated reporting platforms.

## 1. What is included

**Sign in and security**
* Two step sign in: password, then a 6 digit code sent to the user's **email**. Codes expire after 10 minutes, 5 wrong tries end the attempt, and a new code can be requested every 30 seconds.
* **Sign in with Google** (optional): the Google button on the sign in form signs in users whose Google email matches an active AfyaTrack account. It never creates accounts.
* Temporary passwords must be changed at first sign in. Forgot password sends a one hour reset link by email.
* Roles (officer, ward lead, reviewer, System Administrator) and ward scoping are enforced on the server. Every important change is in the audit history.

**Administration (System Administrator)**
* **Wards and members:** add, rename and deactivate wards; add existing users to a ward with a role; remove a role (history is kept).
* **Users:** invite users (a temporary password is shown once and emailed), edit name, email, phone and ward roles, reset passwords, deactivate.
* **Activity categories:** the work catalogue grouped into public health pillars A to P, each category with its own form fields (form builder in Settings).
* **Templates and checklists:** notice templates with placeholders, versioned inspection checklists with sections and conditional sections.

**Work catalogue features**
* **Registers:** premises (with licence workflow), food handlers, markets and workplaces, water sources, households (WASH), schools, health facilities, points of entry, public events, complaints, equipment and CPD. Duplicate warnings, restricted personal fields hidden from reviewers, deactivation without deleting history, photos and PDF attachments on every record.
* **Planner:** tasks with draft, planned, assigned, in progress, completed, postponed and cancelled stages; purpose, venue, expected output and team members; week view; reminders.
* **Activity log:** every catalogue activity (health talks, vector control, fumigation, surveillance alerts, CLTS and ODF, school health, referrals, supervision, meetings and more) opens its own form. Save as draft, submit, correct with audit history. People reached are totalled.
* **Inspections:** reference numbers, date and time, purpose, team, checklist sections (for example the school Kitchen section only when the school has a kitchen), observations, findings with responsible officer and party, revisits that recheck earlier findings, printable report with acknowledgement block, Word export, attachments. Unsaved work is kept in the browser.
* **Findings workflow:** open, action assigned, in progress, reported complied, verified or not complied, closed or escalated.
* **Notices:** draft, submitted, approved (ward lead), issued, served (method, receiver, proof), compliance check (complied, partly, not complied with an automatic recheck follow up), closed or escalated. Never treated as issued or served until each step is recorded.
* **Water samples:** planned, collected, dispatched, received by lab, result pending, result received, action recorded; tests, chain of custody, laboratory. No automatic safety conclusions.
* **Complaints:** received, assigned, under investigation, action or referral, follow up, resolved, closed, with automatic CMP references.
* **Follow ups:** outcomes compliant (verified), partial, non compliant or referred.
* **Reminders:** due tasks, overdue follow ups, licences and medical certificates expiring within 14 days, overdue water sample actions, and a weekly prompt when an officer records no activity for 7 days.
* **Reports:** weekly, monthly, quarterly and annual; totals by public health pillar, category, officer and location; target against achievement (N/A when no target); register summaries for premises, handlers, households, water, facilities, schools, complaints, notices and events; source records behind every figure; Excel (CSV), Word and Print or PDF.
* **Dashboard indicators:** distinct premises inspected, inspection visits, handlers, samples, notices served, people reached, open follow ups and complaints, counted separately.
* **Data quality checks:** missing fields, likely duplicates, impossible dates, inconsistent records and open findings without a follow up date; ward leads can dismiss checked items with a reason.
* **Light and dark theme:** one button (moon or sun) in the top bar and on the sign in page; the choice is remembered in the browser.

## 2. Tech stack

* **Backend:** Node.js + Express, **Cloud Firestore** through the Firebase Admin SDK, JWT sessions in an httpOnly cookie, bcrypt, helmet, rate limited sign in, nodemailer for email.
* **Database access:** only the server talks to Firestore. `firestore.rules` denies all direct client access.
* **Frontend:** React 18 + Vite + Tailwind CSS + React Router, responsive, light and dark mode.

## 3. Requirements

* Node.js **18.18 or newer** (20 or 22 LTS recommended). Check with `node -v`.
* A Firebase project with Cloud Firestore (free Spark plan is enough for a pilot), or the in memory mode for a quick look.
* For sign in codes in production: an SMTP email account (Gmail with an App Password works).

## 4. Firebase setup (one time)

1. https://console.firebase.google.com → **Add project**.
2. **Build → Firestore Database → Create database** in **Production mode**, location close to Kenya (for example `europe-west1`).
3. **Project settings → Service accounts → Generate new private key.** Save it in the project folder as `firebase-service-account.json` (already in `.gitignore`; never share it).
4. Copy `.env.example` to `.env` and set `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json`.
5. Publish `firestore.rules` (Firestore → Rules) or run `npm run deploy:rules` with the Firebase CLI.

No indexes are needed: the API only uses equality filters.

## 5. Email for sign in codes and Google sign in

Until SMTP is set, codes and reset links are printed in the API terminal (development only). In production sign in needs working email.

Set these in `.env`. Gmail example (use an App Password from Google Account → Security → 2-Step Verification → App passwords):
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=yourname@gmail.com
SMTP_PASS=your-16-character-app-password
MAIL_FROM=AfyaTrack PHO <yourname@gmail.com>
```

Each user needs a valid email address (Settings → Users → Edit).

### Sign in with Google

1. Open [Google Cloud Console](https://console.cloud.google.com/) and pick (or create) a project. The Firebase project works.
2. **APIs & Services → OAuth consent screen:** choose External, enter the app name (AfyaTrack PHO) and a support email, then save. While the app is in Testing mode, add each user's Gmail under Test users, or click Publish app.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
4. Under **Authorised JavaScript origins** add every address the site is opened from, for example `http://localhost`, `http://localhost:5173`, `http://localhost:4000` and your live address (`https://pho.example.go.ke`). No redirect URI is needed.
5. Copy the **Client ID** (ends with `.apps.googleusercontent.com`) into `.env` and restart:
```
GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
```
The "Sign in with Google" button then appears under the password form. A user can use it only when their Google email matches their AfyaTrack account email. The first Google sign in links that Google account to the user. Google sign in skips the emailed code because Google has already confirmed the person owns the email.

## 6. First setup and the System Administrator

`npm run setup` creates a clean database with **no test or demo data**: the Kwale County Department of Health, **Kinondo Ward** (Msambweni, Kwale), the full activity catalogue, checklists, notice templates and one account:

| Role | Name | Email | Password |
| --- | --- | --- | --- |
| System Administrator | Ian Mombo | spfreak24@gmail.com | Speedfreak1! |

The administrator can open every ward and adds the real officers, ward leads and reviewers in **Settings → Users** (and more wards in **Settings → Wards**). The account is set in `SETUP_ACCOUNTS` at the top of `server/seed.js`.

**Database already set up?** `npm run accounts` creates the administrator, or updates it if the email already exists. It keeps all other users and records.

**Remove all test data and old accounts:** run `npm run reset-db`. It deletes everything in the AfyaTrack collections (all users, records and demo data) and runs the setup above. It refuses to run with `NODE_ENV=production` unless you add `-- --force`.

`npm run catalogue` adds any new catalogue categories, checklists and templates to an existing database without touching your data.

## 7. Run it locally (development)

```bash
npm install
copy .env.example .env      # macOS/Linux: cp .env.example .env, then fill in section 4 and 5
npm run setup               # first time only (or npm run reset-db to remove old demo data)
npm run dev                 # API on :4000 and website on :5173
```
Open **http://localhost:5173**. Only run `npm run dev`; do not also run `node server/index.js` (port 4000 would already be in use).

**Without Firebase:** `npm run dev:memory` starts on an in memory database with the setup accounts (new temporary passwords every start, data lost on stop).

### Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API and website together |
| `npm run setup` | First time setup (skips if users exist) |
| `npm run reset-db` | Delete all data, then setup |
| `npm run catalogue` | Add missing catalogue items, keep data |
| `npm run accounts` | Create or update the starting accounts, keep data |
| `npm test` | Automated API tests (29) |
| `npm run build` | Build the website into `dist/` |
| `npm start` | Production server (serves API and built website) |
| `npm run backup` / `npm run restore -- <file>` | JSON backup and restore |

## 8. Production deployment

1. Copy the project to the server and run `npm ci`.
2. Create `.env`: `JWT_SECRET` (long random value), `COOKIE_SECURE=true`, `APP_URL=https://your-domain`, Firebase settings, and SMTP settings.
3. `npm run build`, then `npm run setup` on a new database.
4. Run with pm2: `pm2 start "npm start" --name afyatrack && pm2 save && pm2 startup`.
5. Put Nginx or Caddy in front for HTTPS (`proxy_pass http://127.0.0.1:4000`, forward `X-Forwarded-For` and `X-Forwarded-Proto`), then `certbot --nginx`.

## 9. Backups and restore

* `npm run backup` exports every collection to `data/backups/afyatrack-YYYYMMDD-HHMMSS.json` (newest 30 kept). Schedule it daily and copy the folder off the server.
* `npm run restore -- <file>` (stop the app first) saves the current data, then replaces it with the backup.
* For live data also enable Firestore point in time recovery and managed exports (Blaze plan).

## 10. Roles and permissions (enforced on the server)

| Action | Officer | Ward lead | Reviewer | System Administrator |
| --- | --- | --- | --- | --- |
| Record activities, inspections, samples, register entries | Yes | Yes | No (read only) | Yes |
| Assign tasks to others, deactivate register entries, set targets | No | Yes | No | Yes |
| Approve, return or escalate notices; verify or close findings | No | Yes | No | Yes |
| Record a licence as approved or valid | No | Yes | No | Yes |
| See personal fields (owners, complainants) | Yes | Yes | Hidden | Yes |
| Data quality checks | No | Yes (dismiss) | View | Yes |
| Wards, members, users, categories, templates | No | View users | No | Yes |

Access never depends on academic qualification; it follows role, ward and assigned duties.

## 11. How counting works

* Report achievements come from **submitted activity records** dated in the period. Each record is counted once (inspections and samples create one record each; completing a task can create one). Drafts are never counted.
* Planned tasks, distinct registered entities, inspection visits, samples, notices and people reached are counted separately.
* Achievement % = achieved ÷ target × 100, shown only when a target above zero exists, otherwise **N/A**.
* Weeks run Monday to Sunday; quarters are January to March (Q1) and so on; all dates are Nairobi time.

## 12. Project structure

```
server/
  index.js            API entry point
  auth.js             sign in checks, roles, ward scoping
  notify.js           email (SMTP)
  catalogue.js        default categories, checklists and notice templates
  registers.js        register definitions and validation
  reports.js          weekly, monthly, quarterly and annual reports
  seed.js             setup, reset-db and catalogue commands
  routes/auth.js      two step sign in, password reset
  routes/work.js      dashboard, tasks, activities, follow ups, reminders, team
  routes/records.js   registers, samples, inspections, findings, notices, attachments
  routes/admin.js     wards, members, users, categories, targets, data quality, reports
  tests/              api.test.js, features.test.js, calc.test.js, demo-data.js (test only)
client/src/
  lib/                api, auth, theme, format, register definitions
  components/         layout, shared UI and forms
  pages/              one file per screen
```

## 13. API overview

Sign in: `POST /api/auth/login` → `{ two_factor, challenge_id, sent_to }`, then `POST /api/auth/verify { challenge_id, code }` → `{ token }`; `POST /api/auth/resend`. The website uses the sign in cookie; other clients can send `Authorization: Bearer <token>`. Send `X-Ward-Id` to choose the ward.

Main resources: `/api/dashboard`, `/api/lookups`, `/api/tasks`, `/api/activities`, `/api/follow-ups`, `/api/registers/:type`, `/api/registers/water_source/:id/samples`, `/api/samples/:id`, `/api/inspections`, `/api/inspections/:id/word`, `/api/findings/:id`, `/api/notices`, `/api/notices/:id/:action`, `/api/attachments`, `/api/reports`, `/api/reports/export.csv`, `/api/data-quality`, `/api/wards`, `/api/wards/:id/members`, `/api/users`, `/api/categories`, `/api/targets`, `/api/audit`.

## 14. Known limits and next steps

* Internet connection required; the data model is ready for offline capture later. Unsaved inspections are kept in the browser.
* Attachments are limited to 700 KB each (photos are shrunk automatically). For heavy use move them to Firebase Storage.
* Checklist wording, notice templates and legal provisions must be confirmed with county public health leadership before live use.
* Later phase: offline sync, GIS mapping, advanced dashboards and integrations.
