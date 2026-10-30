// Checks the Firebase connection and explains any problem in plain words (npm run check-firebase).
// It reads one document, then writes and deletes a test document in the "_healthcheck" collection.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const ok = (m) => console.log(`  OK    ${m}`);
const fail = (m) => console.log(`  FAIL  ${m}`);
const fix = (lines) => { console.log('\nHow to fix:'); lines.forEach((l, i) => console.log(`  ${i + 1}. ${l}`)); console.log(''); process.exit(1); };

// Network errors can be raised outside the try block below, so catch them here too.
process.on('uncaughtException', (e) => {
  fail(`Could not reach Google: ${e.code || e.message}`);
  fix(['Check the internet connection, VPN, proxy or firewall, then run this check again.']);
});

console.log('\nAfyaTrack PHO: Firebase check\n');

// 1. The .env file and the key file.
if (!fs.existsSync(path.resolve('.env'))) {
  fail(`No .env file in ${process.cwd()}`);
  fix(['Create a file named exactly .env in the project folder (not .env.txt).', 'Copy the settings from .env.example into it.']);
}
ok('.env file found');
if (process.env.DB_DRIVER === 'memory') {
  fail('DB_DRIVER=memory is set in .env, so the app uses a temporary database, not Firebase.');
  fix(['Delete the DB_DRIVER=memory line (or put # in front of it), then run this check again.']);
}
let account = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try { account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON); ok('Key loaded from FIREBASE_SERVICE_ACCOUNT_JSON'); }
  catch { fail('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.'); fix(['Paste the whole key file content on one line, or use FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json instead.']); }
} else {
  const file = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT || './firebase-service-account.json');
  if (!fs.existsSync(file)) {
    fail(`Key file not found: ${file}`);
    fix(['Firebase console > Project settings > Service accounts > Generate new private key.',
      'Save the downloaded file in the project folder as firebase-service-account.json.',
      'In .env set FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json']);
  }
  try { account = JSON.parse(fs.readFileSync(file, 'utf8')); ok(`Key file found: ${path.basename(file)}`); }
  catch { fail('The key file is not valid JSON (it may be damaged or not the right file).'); fix(['Generate a new private key in Firebase and save it again.']); }
}
if (account.type !== 'service_account' || !account.private_key) {
  fail('This file is not a Firebase service account key.');
  fix(['Use Project settings > Service accounts > Generate new private key (not google-services.json or the web config).']);
}

// 2. The project id in .env must match the key file.
const envId = (process.env.FIREBASE_PROJECT_ID || '').trim();
console.log(`        Key file project:  ${account.project_id}`);
console.log(`        .env project:      ${envId || '(empty, the key file project is used)'}`);
if (envId && envId !== account.project_id) {
  fail('FIREBASE_PROJECT_ID in .env does not match the key file.');
  fix([`Set FIREBASE_PROJECT_ID=${account.project_id} in .env (or leave it empty).`]);
}
ok('Project id matches');

// 3. Talk to Firestore.
const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ credential: cert(account), projectId: account.project_id });
const db = getFirestore();
try {
  const snap = await db.collection('users').limit(1).get();
  ok(`Connected to Cloud Firestore (project ${account.project_id})`);
  const ref = db.collection('_healthcheck').doc('check');
  await ref.set({ at: new Date().toISOString() });
  await ref.delete();
  ok('Write and delete test passed');
  console.log(snap.empty
    ? '\nFirebase is ready. The database is empty, so run:\n\n  npm run reset-db\n\nThis creates Kinondo Ward, the catalogue and the System Administrator account.\n'
    : '\nFirebase is ready and already has users. Start the app with:\n\n  npm run dev\n\n(Run "npm run reset-db" only if you want to delete everything and start clean.)\n');
  process.exit(0);
} catch (e) {
  const text = `${e.code ?? ''} ${e.reason ?? ''} ${e.details ?? ''} ${e.message ?? ''}`;
  fail(`Firestore refused the connection: ${e.details || e.message}`);
  if (/CONSUMER_INVALID/i.test(text)) fix([
    `The Google Cloud project "${account.project_id}" no longer exists or was shut down.`,
    'Restore it: console.cloud.google.com/cloud-resource-manager > Resources pending deletion > Restore.',
    'Or create a new Firebase project, create its Firestore database, generate a new key and save it as firebase-service-account.json.']);
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(text)) fix([
    `Enable the Cloud Firestore API for project ${account.project_id}: console.cloud.google.com/apis/library/firestore.googleapis.com`,
    'Wait 2 minutes and run this check again.']);
  if (/NOT_FOUND|does not exist/i.test(text) || e.code === 5) fix([
    'The project has no Firestore database yet.',
    'Firebase console > Build > Firestore Database > Create database (production mode, pick a location).',
    'Run this check again.']);
  if (/invalid_grant|UNAUTHENTICATED|Invalid JWT|account not found/i.test(text) || e.code === 16) fix([
    'The key was deleted or disabled in Google Cloud (or your computer clock is wrong).',
    'Check the date and time on your computer are correct.',
    'Firebase console > Project settings > Service accounts > Generate new private key, and replace firebase-service-account.json.']);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(text)) fix([
    'Your computer could not reach Google. Check the internet connection, VPN or firewall, then try again.']);
  if (e.code === 7) fix([
    `The key's service account has no access to Firestore in ${account.project_id}.`,
    'Easiest: generate a new key in Firebase > Project settings > Service accounts (it has the right access).',
    'Or in Google Cloud > IAM, give the service account the role "Cloud Datastore User".']);
  fix(['Copy the error above and send it for help.']);
}
