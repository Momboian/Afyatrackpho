// Connects to Cloud Firestore through the Firebase Admin SDK (server side, full access).
// Credentials, in order of preference:
//   FIREBASE_SERVICE_ACCOUNT       path to the service account JSON file
//   FIREBASE_SERVICE_ACCOUNT_JSON  the JSON itself (useful on Render / Railway style hosts)
//   GOOGLE_APPLICATION_CREDENTIALS standard Google variable (or the host's default credentials)
// FIRESTORE_EMULATOR_HOST=localhost:8080 points the SDK at the local Firestore emulator.
// DB_DRIVER=memory uses an in-memory database (tests and quick demos only; data is lost on restart).
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createMemoryFirestore } from './memory-firestore.js';

// Holds the single database connection so it is only created once.
let instance;

// A special error type for setup problems, so we can print a friendly message.
class SetupError extends Error {}

// Builds the friendly help message shown when Firebase credentials are missing or wrong.
function help(problem) {
  return new SetupError(`\nFirebase is not set up: ${problem}

Fix (see README, section 4 "Firebase setup"):
  1. Firebase console > Project settings > Service accounts > Generate new private key
  2. Save the file in the project folder as firebase-service-account.json
  3. In .env (copy .env.example to .env if it does not exist) set:
       FIREBASE_PROJECT_ID=your-project-id
       FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json
  Or run without Firebase:  npm run dev:memory
`);
}

// Reads the Firebase service account key, either from a file path or from the JSON text in .env.
function loadServiceAccount() {
  // Option 1: a path to the key file, for example ./firebase-service-account.json
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const file = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!fs.existsSync(file)) throw help(`the key file was not found at ${file}`);
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw help(`${file} is not valid JSON. Download the key again from the Firebase console.`);
    }
  }
  // Option 2: the whole key pasted as one line of JSON (useful on hosting platforms).
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw help('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON (it must be the whole key on one line).');
    }
  }
  // No key found in .env.
  return null;
}

// Returns the database connection, creating it the first time it is called.
export async function getFirestore() {
  // Already connected, reuse the same connection.
  if (instance) return instance;
  // Test and demo mode: use the fake in memory database instead of Firebase.
  if (process.env.DB_DRIVER === 'memory') {
    instance = createMemoryFirestore();
    return instance;
  }
  // Load the Firebase Admin SDK only when it is really needed.
  const { initializeApp, cert, applicationDefault, getApps } = await import('firebase-admin/app');
  const { getFirestore: adminFirestore } = await import('firebase-admin/firestore');
  // Only set up Firebase once per process.
  if (!getApps().length) {
    const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
    const account = loadServiceAccount();
    // Choose how to log in to Firebase: key file, Google default credentials, or the local emulator.
    let credential;
    if (account) credential = cert(account);
    else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) credential = applicationDefault();
    // No credentials at all and no emulator, so stop with a clear explanation.
    else if (!emulator) {
      const hasEnv = fs.existsSync(path.resolve('.env'));
      throw help(hasEnv
        ? 'no service account is set in .env (FIREBASE_SERVICE_ACCOUNT is empty or missing).'
        : `there is no .env file in ${process.cwd()}.`);
    }
    // Work out the Firebase project id from .env, the key file, or a demo name for the emulator.
    const projectId = process.env.FIREBASE_PROJECT_ID || account?.project_id || (emulator ? 'demo-afyatrack' : undefined);
    initializeApp({ ...(credential ? { credential } : {}), projectId });
  }
  // Get the Firestore database and tell it to skip undefined fields instead of failing.
  const db = adminFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  instance = db;
  return instance;
}

// If a setup error was thrown, show the friendly message and stop the server.
// Any other error is thrown again so it still shows the full details.
// Print setup problems as a clear message instead of a stack trace.
process.on('uncaughtException', (e) => {
  if (e instanceof SetupError) { console.error(e.message); process.exit(1); }
  throw e;
});
process.on('unhandledRejection', (e) => {
  if (e instanceof SetupError) { console.error(e.message); process.exit(1); }
  throw e;
});
