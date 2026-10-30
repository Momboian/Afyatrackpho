// End to end API tests (AC-01 .. AC-14 core checks) against the in-memory Firestore stand in,
// loaded with the same synthetic demo dataset as npm run seed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_DRIVER = 'memory';
process.env.AUTH_RATE_LIMIT = '1000';
const { getStore } = await import('../store.js');
const { seedDemo } = await import('./demo-data.js');
const { createApp } = await import('../index.js');
const { runReminders } = await import('../routes/work.js');
const { getOutbox } = await import('../notify.js');
let server, base, db;
let lead, officer, other, reviewer;

before(async () => {
  db = await getStore();
  await seedDemo(db);
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;

  // Log in as a lead user and save the returned authentication token.
  lead = (await login('lead@afyatrack.test', 'Lead@2026')).body.token;

  // Log in as an ordinary officer.
  officer = (await login('officer@afyatrack.test', 'Officer@2026')).body.token;

  // Log in as another officer, used to test ward-level access restrictions.
  other = (await login('ukunda@afyatrack.test', 'Officer@2026')).body.token;

  // Log in as a reviewer, whose permissions should be read-only.
  reviewer = (await login('reviewer@afyatrack.test', 'Reviewer@2026')).body.token;
});


// ------------------------------------------------------------
// TEST CLEANUP
// ------------------------------------------------------------

// after() runs after the test suite completes.
//
// Close the HTTP server so it does not keep the Node.js process running.
after(() => {
  server.close();
});


// ------------------------------------------------------------
// AUTHENTICATION HELPER
// ------------------------------------------------------------

// This helper sends a login request to the API.
//
// Parameters:
//   email    - the user's login email address.
//   password - the user's password.
//
// It returns an object containing the HTTP status code and parsed response body.
// Sign in is two steps: password first, then the 6 digit code sent by email.
// In tests no email provider is set up, so the code is read from the in memory outbox.
async function login(email, password) {
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  const step1 = await post('/auth/login', { email, password });
  if (!step1.body?.two_factor) return step1;
  const msg = [...getOutbox()].reverse().find((m) => m.channel === 'email' && m.to === email);
  const code = /code is (\d{6})/.exec(msg?.text || '')?.[1];
  return post('/auth/verify', { challenge_id: step1.body.challenge_id, code });
}


// ------------------------------------------------------------
// GENERAL API REQUEST HELPER
// ------------------------------------------------------------

// This helper simplifies API requests by automatically adding:
//   1. The API base URL.
//   2. A JSON content-type header.
//   3. The user's Bearer authentication token.
//   4. Any additional headers supplied by the test.
//   5. A JSON-encoded request body, when provided.
//
// Parameters:
//   token - authentication token for the user making the request.
//   p     - API endpoint path, such as '/tasks'.
//   opts  - optional fetch settings, such as method, headers, and body.
//
// The response is returned as an object containing the HTTP status and
// parsed JSON response body.
const call = (token, p, opts = {}) => fetch(`${base}${p}`, {
  ...opts,
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    ...(opts.headers || {})
  },
  body: opts.body ? JSON.stringify(opts.body) : undefined
}).then(async (r) => ({
  status: r.status,
  body: await r.json().catch(() => null)
}));


// ------------------------------------------------------------
// AC-01: AUTHENTICATION AND ACCOUNT STATUS
// ------------------------------------------------------------

// Verify that an active user can sign in successfully,
// an inactive user is forbidden from signing in, and an incorrect
// password is rejected.
test('AC-01 active user signs in, inactive user cannot, wrong password rejected', async () => {
  // Confirm that the lead user's login returned an authentication token.
  assert.ok(lead);

  // An inactive account should receive HTTP 403 Forbidden.
  assert.equal(
    (await login('inactive@afyatrack.test', 'Officer@2026')).status,
    403
  );

  // An incorrect password should receive HTTP 401 Unauthorized.
  assert.equal(
    (await login('lead@afyatrack.test', 'wrong')).status,
    401
  );
});


// ------------------------------------------------------------
// AC-01: WARD-LEVEL ACCESS CONTROL
// ------------------------------------------------------------

// Verify that an officer cannot access premises belonging to another ward.
//
// The test checks two cases:
//   1. Accessing a premises record outside the officer's permitted scope.
//   2. Attempting to select another ward using a request header.
test('AC-01 officer cannot read another ward', async () => {
  // The API should return 404 when this officer attempts to read
  // premises record 1, which is outside their permitted scope.
  assert.equal(
    (await call(other, '/registers/premises/1')).status,
    404
  );

  // Attempting to select ward 1 explicitly should be forbidden.
  assert.equal(
    (await call(other, '/registers/premises', {
      headers: { 'x-ward-id': '1' }
    })).status,
    403
  );
});


// ------------------------------------------------------------
// AUTHENTICATION: UNAUTHORIZED REQUESTS
// ------------------------------------------------------------

// Verify that protected API endpoints cannot be accessed without
// providing an authentication token.
test('unauthenticated API requests are rejected', async () => {
  // A request to /tasks without a token must return HTTP 401.
  assert.equal(
    (await fetch(`${base}/tasks`)).status,
    401
  );
});


// ------------------------------------------------------------
// ROLE-BASED ACCESS CONTROL: REVIEWER
// ------------------------------------------------------------

// Verify that a reviewer can read task information but cannot create
// new tasks. This checks the application's read-only permission rules.
test('reviewer is read only', async () => {
  // Reading the task list should be permitted.
  assert.equal(
    (await call(reviewer, '/tasks')).status,
    200
  );

  // Creating a task should be forbidden for the reviewer.
  assert.equal(
    (await call(reviewer, '/tasks', {
      method: 'POST',
      body: {
        title: 'x',
        due_at: new Date().toISOString()
      }
    })).status,
    403
  );
});


// ------------------------------------------------------------
// AC-02 / AC-04: TASK CREATION, OVERDUE STATUS AND COMPLETION
// ------------------------------------------------------------

// Verify that a task can be created, overdue status is calculated correctly,
// and completing the same task repeatedly does not create duplicate
// activity records.
test('AC-02/04 task creation, overdue logic and completion without double counting', async () => {
  // Generate a due date one hour in the past to make the task overdue.
  const past = new Date(Date.now() - 3600e3).toISOString();

  // Create a new task using the officer's authentication token.
  const c = await call(officer, '/tasks', {
    method: 'POST',
    body: {
      title: 'Test task',
      category_id: 1,
      due_at: past
    }
  });

  // The server should confirm successful task creation with HTTP 201.
  assert.equal(c.status, 201);

  // Retrieve the newly created task using its returned ID.
  let t = (await call(officer, `/tasks/${c.body.id}`)).body;

  // A task whose due date has passed should be marked overdue.
  assert.equal(t.is_overdue, true);

  // Define the update used to complete the task.
  // record_activity instructs the application to create an activity record
  // associated with this task.
  const done = {
    status: 'completed',
    record_activity: {
      activity_date: new Date().toISOString().slice(0, 10),
      quantity: 1
    }
  };

  // Complete the task and verify that the update succeeds.
  assert.equal(
    (await call(officer, `/tasks/${c.body.id}`, {
      method: 'PATCH',
      body: done
    })).status,
    200
  );

  // Submit the same completion request a second time.
  // This checks that completing an already completed task does not
  // create another activity record.
  await call(officer, `/tasks/${c.body.id}`, {
    method: 'PATCH',
    body: done
  });

  // Retrieve the task again after completion.
  t = (await call(officer, `/tasks/${c.body.id}`)).body;

  // A completed task should no longer be considered overdue.
  assert.equal(t.is_overdue, false);

  // Count activity records linked to this task directly in the database.
  const n = (
    await db.find('activity_records', {
      linked_task_id: c.body.id
    })
  ).length;

  // Exactly one activity record should exist, despite two completion requests.
  assert.equal(n, 1);
});


// ------------------------------------------------------------
// TASK ASSIGNMENT AND POSTPONEMENT VALIDATION
// ------------------------------------------------------------

// Verify that ordinary officers cannot assign tasks to other users
// and that postponing a task requires both a reason and a new due date.
test('officer cannot assign tasks to others; postpone needs reason and new date', async () => {
  // Attempt to create a task assigned to another user.
  const r = await call(officer, '/tasks', {
    method: 'POST',
    body: {
      title: 'x',
      due_at: new Date().toISOString(),
      assigned_to: 4
    }
  });

  // The invalid assignment should be rejected with HTTP 400.
  assert.equal(r.status, 400);

  // Create a task with a due date in the future.
  const c = await call(officer, '/tasks', {
    method: 'POST',
    body: {
      title: 'p',
      due_at: new Date(Date.now() + 864e5).toISOString()
    }
  });

  // Attempt to postpone the task without providing a reason or new due date.
  const p = await call(officer, `/tasks/${c.body.id}`, {
    method: 'PATCH',
    body: {
      status: 'postponed'
    }
  });

  // The API should reject the incomplete postponement request.
  assert.equal(p.status, 400);

  // Confirm that the validation response identifies both missing fields.
  assert.ok(p.body.errors.status_reason && p.body.errors.due_at);
});


// ------------------------------------------------------------
// AC-03: AUTOMATIC REMINDER GENERATION
// ------------------------------------------------------------

// Verify that a task reminder is generated when its scheduled reminder
// time has passed.
test('AC-03 reminders are generated at the scheduled time', async () => {
  // Set the task due date to one day in the future.
  const due = new Date(Date.now() + 864e5).toISOString();

  // Set the reminder time to one minute in the past so it is due for processing.
  const rem = new Date(Date.now() - 60e3).toISOString();

  // Create a task with the specified due date and reminder time.
  const c = await call(officer, '/tasks', {
    method: 'POST',
    body: {
      title: 'Remind me',
      due_at: due,
      reminder_at: rem
    }
  });

  // Run the reminder-processing function directly against the test database.
  await runReminders(db);

  // Retrieve reminders through the API.
  const list = (await call(officer, '/reminders')).body;

  // Confirm that a reminder linked to the newly created task exists.
  assert.ok(
    list.some(
      (r) =>
        r.linked_record_type === 'task' &&
        r.linked_record_id === c.body.id
    )
  );
});


// ------------------------------------------------------------
// AC-06 / AC-07 / AC-19: REGISTERS, DUPLICATES AND INSPECTIONS
// ------------------------------------------------------------

// Verify that duplicate premises are rejected, facility records can be
// created, inspections can contain multiple findings, and the facility
// profile displays inspection history and follow-up actions.
test('AC-06/07/19 register CRUD, duplicate warning, facility inspection with findings and history', async () => {
  // Attempt to create premises using a name that already exists in the
  // seeded dataset.
  const dup = await call(officer, '/registers/premises', {
    method: 'POST',
    body: {
      premises_name: 'Kinondo Bakery'
    }
  });

  // The API should return HTTP 409 Conflict for the duplicate record.
  assert.equal(dup.status, 409);

  // Create a new facility record.
  const f = await call(officer, '/registers/facility', {
    method: 'POST',
    body: {
      facility_name: 'Test Hospital Z',
      facility_type: 'Hospital'
    }
  });

  // Confirm that the facility was created successfully.
  assert.equal(f.status, 201);

  // Obtain today's date in YYYY-MM-DD format.
  const today = new Date().toISOString().slice(0, 10);

  // Create an inspection for the newly created facility.
  // The inspection contains two findings, each with a required action
  // and deadline, plus the facility's incinerator status.
  const ins = await call(officer, '/inspections', {
    method: 'POST',
    body: {
      entity_type: 'facility',
      entity_id: f.body.id,
      inspection_date: today,
      risk_level: 'high',

      // Each finding should result in a corresponding follow-up action.
      findings_list: [
        {
          finding: 'Incinerator broken',
          required_action: 'Repair',
          deadline: today
        },
        {
          finding: 'No bins',
          required_action: 'Provide bins',
          deadline: today
        }
      ],

      // Record the current operational status of the facility.
      facility_status: {
        incinerator_status: 'non_functional'
      }
    }
  });

  // Confirm successful creation of the inspection.
  assert.equal(ins.status, 201);

  // Retrieve the facility profile, including its inspection history
  // and follow-up actions.
  const prof = (
    await call(officer, `/registers/facility/${f.body.id}`)
  ).body;

  // The facility profile should contain one inspection.
  assert.equal(prof.inspections.length, 1);

  // Both inspection findings should be represented as follow-up actions.
  assert.equal(prof.followUps.length, 2);

  // Confirm that the facility's incinerator status was recorded correctly.
  assert.equal(
    prof.record.incinerator_status,
    'non_functional'
  );
});


// ------------------------------------------------------------
// AC-12: WATER SAMPLE VALIDATION AND INSPECTION DATES
// ------------------------------------------------------------

// Verify that water samples cannot be marked compliant without the
// required results, samples without results remain pending, and future
// inspection dates are rejected.
test('AC-12 missing water results are not compliant; future dates rejected', async () => {
  // Attempt to submit a water sample as compliant without supplying
  // the required laboratory results.
  const bad = await call(
    officer,
    '/registers/water_source/1/samples',
    {
      method: 'POST',
      body: {
        collection_date: '2026-01-05',
        compliance_status: 'compliant'
      }
    }
  );

  // The incomplete compliance submission should return HTTP 400.
  assert.equal(bad.status, 400);

  // Submit a sample without a compliance status or laboratory results.
  const ok = await call(
    officer,
    '/registers/water_source/1/samples',
    {
      method: 'POST',
      body: {
        collection_date: '2026-01-05'
      }
    }
  );

  // The sample itself should be accepted.
  assert.equal(ok.status, 201);

  // Read the saved sample directly from the database.
  // Without results, its compliance status should remain pending_result.
  assert.equal(
    (await db.get('water_samples', ok.body.id)).compliance_status,
    'pending_result'
  );

  // Attempt to create an inspection with a date far in the future.
  const fut = await call(officer, '/inspections', {
    method: 'POST',
    body: {
      entity_type: 'premises',
      entity_id: 1,
      inspection_date: '2999-01-01'
    }
  });

  // The API should reject the future inspection date.
  assert.equal(fut.status, 400);
});


// ------------------------------------------------------------
// AC-08: NOTICE APPROVAL AND SERVICE WORKFLOW
// ------------------------------------------------------------

// Verify that notices are created as drafts, ordinary officers cannot
// approve notices, serving an unapproved notice is rejected, and a lead
// user can approve the notice.
test('AC-08 notice draft is never auto served; only lead approves', async () => {
  // Create a notice linked to an existing premises record.
  const n = await call(officer, '/notices', {
    method: 'POST',
    body: {
      template_id: 1,
      recipient: 'Owner',
      linked_entity_type: 'premises',
      linked_entity_id: 1
    }
  });

  // The notice should be created successfully.
  assert.equal(n.status, 201);

  // Retrieve the notice and confirm that it remains a draft.
  // Creating a notice must not automatically serve it.
  assert.equal(
    (await call(officer, `/notices/${n.body.id}`)).body.status,
    'draft'
  );

  // An ordinary officer should not be permitted to approve the notice.
  assert.equal(
    (await call(officer, `/notices/${n.body.id}/approve`, {
      method: 'POST',
      body: {}
    })).status,
    403
  );

  // Attempt to serve the notice before approval.
  // The API should reject the operation with HTTP 409 Conflict.
  assert.equal(
    (await call(lead, `/notices/${n.body.id}/serve`, {
      method: 'POST',
      body: {
        service_date: '2026-01-01',
        service_method: 'x'
      }
    })).status,
    409
  );

  // The lead user should be allowed to approve the notice.
  assert.equal(
    (await call(lead, `/notices/${n.body.id}/approve`, {
      method: 'POST',
      body: {}
    })).status,
    200
  );
});


// ------------------------------------------------------------
// AC-09 / AC-10 / AC-11: REPORTING AND SOURCE TRACEABILITY
// ------------------------------------------------------------

// Verify that reports handle missing targets correctly and that reported
// activity totals can be traced back to their underlying source records.
test('AC-09/10/11 reports: N/A without target, totals traceable to source records', async () => {
  // Retrieve the monthly report as a lead user.
  const r = (await call(lead, '/reports?type=monthly')).body;

  // Look for the food handler medical follow-up category.
  const handler = r.activities.find(
    (a) => a.category === 'Food handler medical follow up'
  );

  // When the category has a zero target, its achievement percentage should
  // be reported as N/A rather than dividing by zero.
  // The conditional allows the category to be absent from the report.
  if (handler) {
    assert.equal(handler.achievement_pct, 'N/A');
  }

  // For each reported activity that includes a source-record count,
  // retrieve the underlying records for that category.
  for (const a of r.activities.filter((x) => x.records)) {
    const src = (
      await call(
        lead,
        `/reports/source?type=monthly&category_id=${a.category_id}`
      )
    ).body;

    // The number of returned source records must match the report's
    // recorded count for the activity category.
    assert.equal(src.length, a.records);

    // Sum the quantities in the source records.
    // This total must equal the quantity displayed in the report.
    assert.equal(
      src.reduce((s, x) => s + x.quantity, 0),
      a.quantity
    );
  }

  // Confirm that the report contains an array of overdue tasks
  // and a numeric count of completed tasks.
  assert.ok(
    Array.isArray(r.tasks.overdue) &&
    typeof r.tasks.completed === 'number'
  );
});


// ------------------------------------------------------------
// AC-13 / AC-14: CSV EXPORT AND AUDIT LOGGING
// ------------------------------------------------------------

// Verify that the weekly report can be exported as CSV, that the CSV
// totals match the report preview, and that the export is recorded in
// the audit log.
test('AC-13/14 export creates an audit entry and CSV matches preview totals', async () => {
  // Request the weekly report as a CSV file using the lead user's token.
  const res = await fetch(`${base}/reports/export.csv?type=weekly`, {
    headers: {
      authorization: `Bearer ${lead}`
    }
  });

  // Confirm that the export endpoint returns HTTP 200.
  assert.equal(res.status, 200);

  // Read the exported CSV content as plain text.
  const csv = await res.text();

  // Retrieve the same weekly report through the JSON preview endpoint.
  const preview = (await call(lead, '/reports?type=weekly')).body;

  // Confirm that the CSV contains a TOTAL row whose activity-record count
  // and quantity match the values in the report preview.
  assert.ok(
    csv.includes(
      `TOTAL,,${preview.totals.activity_records},${preview.totals.quantity}`
    )
  );

  // Search the audit log for report export events.
  // At least one matching entry should exist after the export request.
  assert.ok(
    (
      await db.find('audit_events', {
        action: 'export',
        entity_type: 'report'
      })
    ).length >= 1
  );
});


// ------------------------------------------------------------
// US-15: USER DEACTIVATION AND DATA PRESERVATION
// ------------------------------------------------------------

// Verify that an administrator can deactivate a user, that the deactivated
// user can no longer log in, and that the user's existing task records
// remain in the database.
test('US-15 admin can deactivate a user without erasing records', async () => {
  // Log in as the administrator and obtain an authentication token.
  const admin = (
    await login('admin@afyatrack.test', 'Admin@2026')
  ).body.token;

  // Count the tasks assigned to user ID 4 before deactivation.
  const before = (
    await db.find('tasks', { assigned_to: 4 })
  ).length;

  // Deactivate user ID 4 using the administrator's permissions.
  assert.equal(
    (await call(admin, '/users/4', {
      method: 'PATCH',
      body: {
        active: false
      }
    })).status,
    200
  );

  // Attempt to log in as the deactivated user.
  // Login should be rejected with HTTP 403.
  assert.equal(
    (await login('officer2@afyatrack.test', 'Officer@2026')).status,
    403
  );

  // Count the user's tasks again.
  // The count should remain unchanged because deactivation must not
  // delete the user's existing records.
  assert.equal(
    (await db.find('tasks', { assigned_to: 4 })).length,
    before
  );
});


// ------------------------------------------------------------
// LOOKUP DATA: UNIQUE OFFICER ENTRIES
// ------------------------------------------------------------

// Verify that the lookup endpoint returns each officer only once.
// This prevents duplicate officer options from appearing in dropdown
// lists used by the application's user interface.
test('lookups list each officer once (no duplicate dropdown values)', async () => {
  // Retrieve lookup data using the lead user's token.
  const lk = (await call(lead, '/lookups')).body;

  // Extract the IDs of all officers returned by the lookup endpoint.
  const ids = lk.officers.map((o) => o.id);

  // Convert the IDs into a Set, which removes duplicate values.
  // The size of the Set should equal the original array length.
  assert.equal(new Set(ids).size, ids.length);
});