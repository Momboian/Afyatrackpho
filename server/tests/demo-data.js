// TEST ONLY: synthetic demo dataset used by the automated tests (npm test).
// It is never loaded into a real database. Real installations use "npm run setup" (server/seed.js).
import bcrypt from 'bcryptjs';
import { REGISTERS } from '../registers.js';
import { registerDefaults } from '../routes/records.js';
import { todayNairobi, addDays, weekRange, monthRange, nowIso } from '../util.js';

// Fills the database with a complete set of made up demo data for testing and training.
export async function seedDemo(store) {
  const today = todayNairobi();
  // Helpers: iso() makes a Nairobi date and time, pick() cycles through a list, ins() saves a document,
  // reg() saves a register entry with its default values.
  const iso = (date, time = '09:00') => new Date(`${date}T${time}:00+03:00`).toISOString();
  const pick = (arr, i) => arr[i % arr.length];
  const ins = (c, data) => store.insert(c, data);
  const reg = (key, data) => store.insert(REGISTERS[key].table, { ...registerDefaults(REGISTERS[key]), ...data });

  // One county department with two demo wards.
  const org = await ins('organisations', { name: 'Demo County Department of Health', county: 'Demo County', timezone: 'Africa/Nairobi', status: 'active' });
  const w1 = await ins('wards', { organisation_id: org, name: 'Kinondo Ward (Demo)', code: 'KND', status: 'active' });
  const w2 = await ins('wards', { organisation_id: org, name: 'Ukunda Ward (Demo)', code: 'UKD', status: 'active' });

  // Demo users and their ward roles. Passwords are stored as bcrypt hashes.
  const hash = (p) => bcrypt.hashSync(p, 10);
  const user = (name, email, pw, extra = {}) => ins('users', { full_name: name, email, email_lower: email.toLowerCase(), phone: extra.phone || null,
    password_hash: hash(pw), is_admin: extra.admin ? 1 : 0, active: extra.inactive ? 0 : 1, last_login_at: null });
  const mem = (u, w, role) => ins('memberships', { user_id: u, ward_id: w, role, active_from: today, active_to: null });

  const admin = await user('System Administrator', 'admin@afyatrack.test', 'Admin@2026', { admin: true });
  const lead = await user('Amina Mwakio', 'lead@afyatrack.test', 'Lead@2026'); await mem(lead, w1, 'ward_lead'); await mem(lead, w1, 'officer');
  const off1 = await user('Brian Otieno', 'officer@afyatrack.test', 'Officer@2026'); await mem(off1, w1, 'officer');
  const off2 = await user('Grace Wanjiru', 'officer2@afyatrack.test', 'Officer@2026'); await mem(off2, w1, 'officer');
  const off3 = await user('Hassan Juma', 'ukunda@afyatrack.test', 'Officer@2026'); await mem(off3, w2, 'officer'); await mem(off3, w2, 'ward_lead');
  const rev = await user('County Reviewer', 'reviewer@afyatrack.test', 'Reviewer@2026'); await mem(rev, w1, 'reviewer');
  const gone = await user('Former Officer', 'inactive@afyatrack.test', 'Officer@2026', { inactive: true }); await mem(gone, w1, 'officer');
  const officers = [lead, off1, off2];

  // Sub locations and villages in each ward.
  const loc = (w, sub, village, landmark) => ins('locations', { ward_id: w, sub_location: sub, village, landmark, latitude: null, longitude: null });
  const L = [await loc(w1, 'Kinondo', 'Mwaroni', 'Near primary school'), await loc(w1, 'Kinondo', 'Kwale Mpya', 'Market area'),
    await loc(w1, 'Gazi', 'Gazi Centre', 'Fish landing site'), await loc(w1, 'Gazi', 'Mkwakwani', 'Mosque junction'), await loc(w1, 'Chale', 'Chale Mkoroni', 'Bus stage')];
  const L2 = [await loc(w2, 'Ukunda', 'Ukunda Town', 'Main stage'), await loc(w2, 'Diani', 'Diani Centre', 'Shopping centre')];

  // Activity categories used by tasks, activity records, targets and reports.
  const cat = (name, group, description) => ins('categories', { name, module_group: group, description, active: 1, updated_by: admin });
  const C = {
    premises: await cat('Food premises inspection', 'premises', 'Task category and linked premises inspection record.'),
    handler: await cat('Food handler medical follow up', 'handler', 'Register status plus reminder or follow up.'),
    household: await cat('Household sanitation visit', 'household', 'Task and household visit record.'),
    water_source: await cat('Water source inspection', 'water_source', 'Task and source inspection record.'),
    water_sample: await cat('Water sample collection / result follow up', 'water_sample', 'Water sample record and reminder for pending result.'),
    enforcement: await cat('Public health nuisance / enforcement follow up', 'enforcement', 'Inspection finding, draft notice and follow up.'),
    general: await cat('General PHO activity', 'general', 'Configurable activity record for legitimate tasks not yet in a dedicated module.'),
    facility: await cat('Hospital / healthcare facility sanitation inspection', 'facility', 'Facility register, sanitation checklist, findings and corrective actions.')
  };

  // Configurable checklists (version 1). Wording to be validated with the county before live use.
  const checklists = {
    premises: ['Premises clean and in good repair', 'Safe water supply available', 'Hand washing facility with soap', 'Food stored off the floor and covered',
      'Food handlers have valid medical certificates', 'Adequate refuse bins with lids', 'Toilet facilities clean and functional', 'No evidence of pests', 'Valid licence displayed'],
    household: ['Has a latrine / toilet', 'Latrine clean and in use', 'Hand washing facility near latrine', 'Safe refuse disposal', 'Safe drinking water storage', 'No stagnant water around compound'],
    water_source: ['Source protected / fenced', 'No latrine within 30 m', 'Drainage around source adequate', 'No visible contamination', 'Containers and taps clean'],
    handler: ['Medical certificate seen', 'Certificate within validity', 'Personal hygiene satisfactory', 'Protective clothing worn'],
    facility: ['Water supply adequate and reliable', 'Toilets clean, functional and sufficient', 'Hand hygiene stations available', 'Drainage free flowing, no stagnant water',
      'Wards and floors clean', 'Waste segregated at source (colour coded bins)', 'Sharps containers used correctly', 'Incinerator / burning chamber functional',
      'Waste storage area secure', 'Pest control in place', 'Laundry and kitchen areas hygienic']
  };
  // Save one checklist per inspection type.
  for (const [type, items] of Object.entries(checklists)) await ins('checklists', { entity_type: type, version: 1, items, active: 1, created_by: admin });

  // Two approved notice templates. The {{words}} are replaced with real details when a notice is drafted.
  await ins('notice_templates', { name: 'Sanitation improvement notice', approved: 1, active: 1, updated_by: admin, body: `PUBLIC HEALTH NOTICE (TEMPLATE: wording to be confirmed by the county)
Reference: {{reference}}
Date: {{date}}

To: {{recipient}}
Premises / place: {{entity_name}}
Location: {{location}}, {{ward}}

Following an inspection by a Public Health Officer, the following conditions were found:
{{findings}}

You are required to carry out the following corrective action:
{{corrective_action}}

Compliance deadline: {{compliance_deadline}}

Failure to comply may lead to further action under the applicable public health law [section to be confirmed by the county].

Public Health Officer: {{officer_name}}
Signature: ____________________` });
  await ins('notice_templates', { name: 'Food premises improvement notice', approved: 1, active: 1, updated_by: admin, body: `FOOD PREMISES IMPROVEMENT NOTICE (TEMPLATE: wording to be confirmed by the county)
Reference: {{reference}}
Date: {{date}}

To the owner / operator: {{recipient}}
Food premises: {{entity_name}}, {{location}}, {{ward}}

An inspection of the above premises found the following defects:
{{findings}}

Required improvements:
{{corrective_action}}

These improvements must be completed by {{compliance_deadline}}. A follow up inspection will be carried out after this date.

Public Health Officer: {{officer_name}}
Signature: ____________________` });

  // Registers
  // Food premises. Every third one has an expired licence so the warnings can be tested.
  const P = [];
  const premisesData = [['Mama Zawadi Hotel', 'Restaurant'], ['Gazi Fresh Fish Kiosk', 'Fish kiosk'], ['Kinondo Bakery', 'Bakery'], ['Chale Butchery', 'Butchery'],
    ['Mwaroni Milk Bar', 'Dairy outlet'], ['Baraka Supermarket', 'Supermarket'], ['Upendo Cafe', 'Cafe'], ['Kwale Mpya Grocers', 'Grocery']];
  for (const [i, [n, t]] of premisesData.entries()) {
    const exp = i % 3 === 0 ? addDays(today, -20) : addDays(today, 120 + i * 10);
    P.push(await reg('premises', { ward_id: w1, location_id: pick(L, i), premises_name: n, premises_type: t, owner_name: `Owner ${i + 1} (synthetic)`,
      contact_phone: `07000000${10 + i}`, licence_status: i % 3 === 0 ? 'expired' : i === 7 ? 'pending' : 'valid',
      licence_number: i === 7 ? null : `FPL-2026-${100 + i}`, licence_issue_date: i === 7 ? null : addDays(exp, -365),
      licence_expiry_date: i === 7 ? null : exp, assigned_officer_id: pick(officers, i) }));
  }
  // One premises in the second ward, to test that wards cannot see each other's data.
  await reg('premises', { ward_id: w2, location_id: L2[0], premises_name: 'Diani Beach Grill', premises_type: 'Restaurant', licence_status: 'valid' });

  // Food handlers with a mix of current, expired and missing medical certificates.
  const handlerNames = ['Fatuma A.', 'John K.', 'Mercy W.', 'Salim M.', 'Esther N.', 'Kassim O.', 'Lilian C.', 'Peter M.', 'Rehema S.', 'David T.', 'Zainabu H.', 'Musa B.'];
  for (const [i, n] of handlerNames.entries()) {
    const expiry = i % 4 === 0 ? addDays(today, -15) : i % 5 === 0 ? null : addDays(today, 60 + i * 7);
    await reg('handler', { ward_id: w1, name: `${n} (synthetic)`, identifier: `FH-${300 + i}`, premises_id: pick(P, i),
      medical_exam_date: expiry ? addDays(expiry, -180) : null, certificate_expiry: expiry,
      status: expiry === null ? 'pending' : expiry < today ? 'expired' : 'current' });
  }

  // Households with different sanitation types and status.
  const H = [];
  const sanTypes = ['Pit latrine', 'VIP latrine', 'Pour flush', 'None', 'Flush toilet'];
  const sanStatus = ['adequate', 'needs_improvement', 'adequate', 'none', 'inadequate'];
  for (let i = 0; i < 15; i++) {
    H.push(await reg('household', { ward_id: w1, location_id: pick(L, i), household_code: `HH-KND-${String(i + 1).padStart(3, '0')}`,
      sanitation_type: pick(sanTypes, i), sanitation_status: pick(sanStatus, i), last_visit_date: addDays(today, -(i * 3 + 2)),
      follow_up_due: pick(sanStatus, i) === 'adequate' ? null : addDays(today, (i % 4) * 5 - 6), assigned_officer_id: pick(officers, i) }));
  }

  // Water sources.
  const WS = [];
  const sources = [['Mwaroni Borehole', 'Borehole'], ['Gazi Community Well', 'Shallow well'], ['Kinondo Water Kiosk', 'Water kiosk'], ['Chale Spring', 'Protected spring'],
    ['Mkwakwani Dam', 'Dam / pan'], ['Kwale Mpya Tank', 'Rain water tank']];
  for (const [i, [n, t]] of sources.entries()) {
    WS.push(await reg('water_source', { ward_id: w1, location_id: pick(L, i), source_name: n, source_code: `WS-${i + 1}`, source_type: t,
      operator: i % 2 ? 'Community committee' : 'County water company', status: i === 4 ? 'needs_attention' : 'functional',
      last_inspection_date: addDays(today, -30 - i), next_inspection_due: addDays(today, i * 7 - 10), assigned_officer_id: pick(officers, i) }));
  }
  // Water samples: one compliant, one non compliant and two waiting for lab results.
  const sample = (src, d, status, result, resDate, nextDue, by) => ins('water_samples', { ward_id: w1, water_source_id: src, collection_date: d,
    sample_reference: `SMP-${src}-${d}`, laboratory: 'County Public Health Laboratory', result, compliance_status: status, result_date: resDate,
    next_action_due: nextDue, recorded_by: by });
  await sample(WS[0], addDays(today, -12), 'compliant', 'E. coli 0 cfu/100ml', addDays(today, -8), null, off1);
  await sample(WS[1], addDays(today, -6), 'non_compliant', 'E. coli 14 cfu/100ml', addDays(today, -2), addDays(today, 3), off2);
  await sample(WS[2], addDays(today, -3), 'pending_result', null, null, addDays(today, 4), off1);
  await sample(WS[4], addDays(today, -20), 'pending_result', null, null, addDays(today, -5), lead);

  // Healthcare facilities.
  const F = [];
  const facs = [['Kinondo Health Centre', 'Health centre'], ['Gazi Dispensary', 'Dispensary'], ['Chale Medical Clinic (private)', 'Private clinic']];
  for (const [i, [n, t]] of facs.entries()) {
    F.push(await reg('facility', { ward_id: w1, location_id: pick(L, i * 2), facility_name: n, facility_type: t, facility_code: `MFL-DEMO-${i + 1}`,
      water_supply_status: 'satisfactory', toilet_status: i === 1 ? 'needs_improvement' : 'satisfactory', drainage_status: i === 2 ? 'unsatisfactory' : 'satisfactory',
      cleaning_status: 'satisfactory', waste_management_status: i === 1 ? 'needs_improvement' : 'satisfactory', incinerator_status: i === 1 ? 'non_functional' : 'functional',
      pest_control_status: 'unknown', assigned_officer_id: pick(officers, i) }));
  }
  // Remember the location of each register entry, so inspection activity records get the right location.
  const locOf = { premises: new Map(), household: new Map(), water_source: new Map(), facility: new Map() };
  for (const [key, ids] of [['premises', P], ['household', H], ['water_source', WS], ['facility', F]]) {
    for (const id of ids) locOf[key].set(id, (await store.get(REGISTERS[key].table, id)).location_id);
  }

  // Inspections with findings + follow ups + activity records (one per inspection)
  // Saves an inspection with its findings, a follow up for each finding, and one activity record.
  const inspect = async (type, id, date, officer, risk, outcome, findings = [], next = null) => {
    const results = checklists[type].map((item, k) => ({ item, result: k < findings.length ? 'no' : 'yes', note: '' }));
    const iid = await ins('inspections', { ward_id: w1, entity_type: type, entity_id: id, inspection_date: date, officer_id: officer, checklist_version: 1,
      checklist_results: results, findings: findings.map((f) => f[0]).join('; ') || 'No major defects.', risk_level: risk, outcome, next_visit_due: next,
      notice_required: findings.length > 1 ? 1 : 0 });
    for (const [finding, action, deadline, status] of findings) {
      const fid = await ins('inspection_findings', { inspection_id: iid, finding, required_action: action, deadline, responsible_user_id: officer,
        status: status || 'open', resolved_at: status === 'resolved' ? nowIso() : null });
      await ins('follow_ups', { ward_id: w1, linked_entity_type: type, linked_entity_id: id, linked_inspection_id: iid, linked_finding_id: fid, action_required: action,
        responsible_user_id: officer, due_date: deadline, status: status === 'resolved' ? 'completed' : 'open', outcome: status === 'resolved' ? 'compliant' : null,
        outcome_notes: null, next_step: null, completed_at: status === 'resolved' ? nowIso() : null, created_by: officer });
    }
    await store.claim(`activity_inspection_${iid}`);
    await ins('activity_records', { ward_id: w1, category_id: C[type], activity_date: date, recorded_by: officer, location_id: locOf[type].get(id) ?? null,
      linked_entity_type: type, linked_entity_id: id, linked_inspection_id: iid, linked_task_id: null, outcome, notes: null, quantity: 1, unit: 'visits', deleted_at: null });
    return iid;
  };
  // The demo inspections.
  const wk = weekRange(today);
  await inspect('premises', P[0], addDays(today, -1), off1, 'high', 'Non compliant', [['No hand washing facility at kitchen entrance', 'Install hand washing station with soap and running water', addDays(today, 5)],
    ['Food stored on the floor in store room', 'Provide pallets / shelves at least 15 cm off the floor', addDays(today, -2)]], addDays(today, 7));
  await inspect('premises', P[1], addDays(today, -3), off2, 'medium', 'Partially compliant', [['Refuse bin without lid', 'Provide covered refuse bin', addDays(today, -1)]], addDays(today, 10));
  await inspect('premises', P[2], wk.start, lead, 'low', 'Compliant');
  await inspect('premises', P[3], addDays(today, -9), off1, 'medium', 'Partially compliant', [['Butcher not wearing protective clothing', 'Provide and wear clean protective clothing', addDays(today, -4), 'resolved']]);
  await inspect('premises', P[4], addDays(today, -15), off2, 'low', 'Compliant');
  await inspect('household', H[1], addDays(today, -2), off1, 'medium', 'Needs improvement', [['Latrine superstructure damaged', 'Repair latrine walls and door', addDays(today, 12)]]);
  await inspect('household', H[3], addDays(today, -4), off2, 'high', 'No latrine', [['Household has no latrine', 'Construct a latrine (community led total sanitation follow up)', addDays(today, 21)]]);
  await inspect('household', H[0], addDays(today, -1), lead, 'low', 'Adequate');
  await inspect('water_source', WS[1], addDays(today, -6), off2, 'high', 'Contamination risk', [['Latrine within 20 m of well', 'Advise relocation; increase sampling frequency', addDays(today, 14)]]);
  await inspect('water_source', WS[4], addDays(today, -20), lead, 'medium', 'Needs attention', [['Livestock access to dam', 'Fence dam and provide cattle trough', addDays(today, -6)]]);
  await inspect('facility', F[1], addDays(today, -5), lead, 'high', 'Non compliant', [['Incinerator not functional; waste burned in open pit', 'Repair incinerator or arrange licensed waste transfer', addDays(today, -1)],
    ['Waste not segregated at source in OPD', 'Provide colour coded bins and train staff', addDays(today, 7)], ['Toilets in maternity wing not functional', 'Repair plumbing and restore water supply', addDays(today, 10)]], addDays(today, 14));
  await inspect('facility', F[0], addDays(today, -12), off1, 'low', 'Compliant');
  await inspect('facility', F[2], addDays(today, -2), off2, 'medium', 'Partially compliant', [['Blocked drainage behind laboratory', 'Unblock and repair drainage channel', addDays(today, 4)]]);

  // Tasks
  // Saves a task and its first history line.
  const task = async (title, catKey, to, dueDate, time, status, extra = {}) => {
    const id = await ins('tasks', { ward_id: w1, title, description: extra.desc || null, category_id: C[catKey], assigned_to: to, created_by: extra.by || lead,
      due_at: iso(dueDate, time), reminder_at: extra.reminder ? iso(dueDate, extra.reminder) : null, status, priority: extra.priority || 'normal',
      location_id: extra.loc || null, linked_entity_type: extra.et || null, linked_entity_id: extra.eid || null,
      completed_at: status === 'completed' ? iso(dueDate, time) : null, completed_by: status === 'completed' ? to : null,
      status_reason: extra.reason || null, next_action: null, notes: null, deleted_at: null });
    await store.insert('task_history', { task_id: id, user_id: extra.by || lead, at: nowIso(), field: 'created', old_value: null, new_value: iso(dueDate, time), reason: null }, { timestamps: false });
    return id;
  };
  // Demo tasks: some today, some overdue, some upcoming, and examples of each status.
  await task('Inspect Upendo Cafe (routine)', 'premises', off1, today, '10:00', 'planned', { et: 'premises', eid: P[6], loc: L[1], reminder: '08:00' });
  await task('Collect sample at Kinondo Water Kiosk', 'water_sample', off1, today, '14:00', 'planned', { et: 'water_source', eid: WS[2], priority: 'high' });
  await task('Household visits: Mwaroni cluster', 'household', off1, today, '15:30', 'in_progress', { loc: L[0] });
  await task('Follow up hand washing station at Mama Zawadi', 'enforcement', off1, addDays(today, -2), '11:00', 'planned', { et: 'premises', eid: P[0], priority: 'high' });
  await task('Verify medical certificates at Kinondo Bakery', 'handler', off1, addDays(today, 2), '09:30', 'planned', { et: 'premises', eid: P[2] });
  await task('Monthly meeting with community health promoters', 'general', off1, addDays(today, 4), '10:00', 'planned');
  await task('Inspect Chale Spring protection works', 'water_source', off2, addDays(today, -1), '10:00', 'planned', { et: 'water_source', eid: WS[3] });
  await task('Gazi Dispensary waste management revisit', 'facility', lead, addDays(today, 1), '09:00', 'planned', { et: 'facility', eid: F[1], priority: 'high', reminder: '07:30' });
  await task('Household sanitation follow up HH-KND-004', 'household', off2, addDays(today, 3), '11:00', 'planned', { et: 'household', eid: H[3] });
  await task('Baraka Supermarket licence check', 'premises', off2, addDays(today, -4), '12:00', 'postponed', { et: 'premises', eid: P[5], reason: 'Owner travelling; rescheduled' });
  await task('Inspect Mwaroni Borehole', 'water_source', off1, addDays(today, -3), '09:00', 'completed', { et: 'water_source', eid: WS[0] });
  await task('Community clean up sensitisation', 'general', lead, addDays(today, -5), '08:00', 'cancelled', { reason: 'Rain; to be rescheduled with chief' });

  // Extra activity records this week and earlier this month
  // Saves an activity record that is not linked to a task or inspection.
  const act = (catKey, date, by, qty, outcome) => ins('activity_records', { ward_id: w1, category_id: C[catKey], activity_date: date, recorded_by: by,
    location_id: pick(L, qty), quantity: qty, unit: 'activities', outcome, notes: null, linked_entity_type: null, linked_entity_id: null,
    linked_task_id: null, linked_inspection_id: null, deleted_at: null });
  await act('general', addDays(today, -1), off1, 1, 'Health talk at Mwaroni market');
  await act('household', addDays(today, -2), off2, 6, 'Six households visited in Gazi');
  await act('handler', addDays(today, -3), lead, 4, 'Medical certificates verified');
  await act('water_sample', addDays(today, -6), off2, 1, 'Sample collected: Gazi well');
  await act('water_sample', addDays(today, -3), off1, 1, 'Sample collected: Kinondo kiosk');

  // Targets for current week and month (ward level) + one officer target
  const wkR = weekRange(today), mR = monthRange(today.slice(0, 7));
  // Saves a target for a category and period.
  const tgt = (catKey, type, r, v, uid = null) => ins('targets', { ward_id: w1, category_id: C[catKey], user_id: uid, period_type: type,
    period_start: r.start, period_end: r.end, target_value: v, unit: 'activities', approved_by: lead, created_by: lead });
  await tgt('premises', 'weekly', wkR, 6); await tgt('household', 'weekly', wkR, 15); await tgt('water_source', 'weekly', wkR, 2); await tgt('facility', 'weekly', wkR, 1);
  await tgt('premises', 'monthly', mR, 20); await tgt('household', 'monthly', mR, 60); await tgt('water_source', 'monthly', mR, 6); await tgt('water_sample', 'monthly', mR, 6);
  await tgt('facility', 'monthly', mR, 3); await tgt('handler', 'monthly', mR, 0);
  await tgt('premises', 'monthly', mR, 8, off1);

  // A draft notice
  // A draft notice, ready to test the approve, issue and serve steps.
  const nid = await store.nextId('notice_drafts');
  const ref = `DRAFT/KND/${today.slice(0, 4)}/${String(nid).padStart(4, '0')}`;
  const t = nowIso();
  await store.db.collection('notice_drafts').doc(String(nid)).set({ id: nid, ward_id: w1, linked_entity_type: 'premises', linked_entity_id: P[0], inspection_id: null,
    template_id: 2, draft_reference: ref, recipient: 'Owner 1 (synthetic)', findings: 'No hand washing facility at kitchen entrance; food stored on floor.',
    corrective_action: 'Install hand washing station; provide shelving 15 cm off floor.', compliance_deadline: addDays(today, 7),
    content: `FOOD PREMISES IMPROVEMENT NOTICE (TEMPLATE: wording to be confirmed by the county)\nReference: ${ref}\n\nTo the owner / operator: Owner 1 (synthetic)\nFood premises: Mama Zawadi Hotel, Mwaroni, Kinondo, Kinondo Ward (Demo)\n\nAn inspection of the above premises found the following defects:\nNo hand washing facility at kitchen entrance; food stored on floor.\n\nRequired improvements:\nInstall hand washing station; provide shelving 15 cm off floor.\n\nThese improvements must be completed by ${addDays(today, 7)}. A follow up inspection will be carried out after this date.\n\nPublic Health Officer: Brian Otieno\nSignature: ____________________`,
    version: 1, prepared_by: off1, reviewed_by: null, status: 'draft', issue_date: null, service_date: null, service_method: null, service_notes: null, created_at: t, updated_at: t });

  // Record in the audit log that demo data was loaded.
  await store.insert('audit_events', { actor_user_id: admin, ward_id: null, action: 'seed', entity_type: 'system', entity_id: null, at: nowIso(),
    change_summary: 'Synthetic demo dataset loaded', ip: null, user_agent: null }, { timestamps: false });
}

