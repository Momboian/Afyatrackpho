// Register definitions shared by the generic register API.
// Each register maps to a Firestore collection; `fields` lists the fields a user can save and their rules.

// The four condition levels used by many sanitation checks.
const STATUS3 = ['unknown', 'satisfactory', 'needs_improvement', 'unsatisfactory'];

// One entry per register. Each entry says:
//   table          the Firestore collection that stores it
//   label          the name shown on screen
//   nameField      the field used as the display name
//   statusField    the field used by the status filter
//   search         fields the search box looks in
//   duplicateCheck warn when a record with a similar name already exists
//   restricted     personal fields hidden from reviewers
//   inspectable    false for registers that are not inspected (equipment, CPD)
//   refPrefix      when set, a reference like CMP/KND/2026/0001 is created automatically
//   leadOnly       { field: [values] } values only a ward lead or admin may set (authorised approvals)
//   fields         every field a user can save, with its type and rules
export const REGISTERS = {
  // A. Premises register (sanitary inspections and food premises).
  premises: {
    table: 'food_premises', label: 'Premises', nameField: 'premises_name', statusField: 'licence_status',
    search: ['premises_name', 'premises_type', 'licence_number', 'owner_name', 'plot_number'],
    duplicateCheck: true,
    restricted: ['owner_name', 'manager_name', 'contact_phone'],
    // Only an authorised supervisor can record that a licence was approved or is valid.
    leadOnly: { licence_status: ['approved', 'valid'] },
    fields: {
      premises_name: { required: true, label: 'Premises name' },
      premises_type: {},
      location_id: { type: 'int' },
      owner_name: {},
      manager_name: {},
      contact_phone: {},
      plot_number: {},
      acreage: { type: 'number' },
      construction_type: {},
      operating_status: { enum: ['unknown', 'operating', 'temporarily_closed', 'closed', 'under_construction'] },
      licence_status: { enum: ['unknown', 'applied', 'pending_review', 'approved', 'valid', 'renewal_due', 'expired', 'not_licensed', 'pending'] },
      licence_number: {},
      application_date: { type: 'date' },
      inspection_recommendation: { enum: ['unknown', 'pending', 'recommended', 'not_recommended'] },
      payment_reference: {},
      licence_issue_date: { type: 'date' },
      licence_expiry_date: { type: 'date' },
      assigned_officer_id: { type: 'int' },
      notes: {},
      active: { type: 'bool' }
    }
  },
  // B. Food handlers register.
  handler: {
    table: 'food_handlers', label: 'Food handlers', nameField: 'name', statusField: 'status',
    search: ['name', 'identifier', 'role'],
    duplicateCheck: true,
    restricted: ['identifier'],
    fields: {
      name: { required: true, label: 'Name' },
      identifier: {},
      premises_id: { type: 'int' },
      role: {},
      medical_exam_date: { type: 'date' },
      certificate_issue_date: { type: 'date' },
      certificate_expiry: { type: 'date' },
      status: { enum: ['unknown', 'current', 'pending', 'expired'] },
      notes: {},
      active: { type: 'bool' }
    }
  },
  // D. Household WASH register.
  household: {
    table: 'households', label: 'Households', nameField: 'household_code', statusField: 'sanitation_status',
    search: ['household_code', 'sanitation_type', 'water_source_type'],
    fields: {
      household_code: { required: true, label: 'Household code' },
      location_id: { type: 'int' },
      water_source_type: {},
      sanitation_type: {},
      sanitation_status: { enum: ['unknown', 'adequate', 'needs_improvement', 'inadequate', 'none'] },
      handwashing: { enum: ['unknown', 'soap_and_water', 'water_only', 'none'] },
      hygiene_risks: {},
      last_visit_date: { type: 'date' },
      follow_up_due: { type: 'date' },
      assigned_officer_id: { type: 'int' },
      notes: {},
      active: { type: 'bool' }
    }
  },
  // D. Water sources register.
  water_source: {
    table: 'water_sources', label: 'Water sources', nameField: 'source_name', statusField: 'status',
    search: ['source_name', 'source_code', 'source_type', 'operator'],
    duplicateCheck: true,
    fields: {
      source_name: { required: true, label: 'Source name' },
      source_code: {},
      source_type: {},
      location_id: { type: 'int' },
      operator: {},
      population_served: { type: 'int' },
      treatment: {},
      status: { enum: ['unknown', 'functional', 'needs_attention', 'non_functional', 'closed'] },
      last_inspection_date: { type: 'date' },
      next_inspection_due: { type: 'date' },
      assigned_officer_id: { type: 'int' },
      notes: {},
      active: { type: 'bool' }
    }
  },
  // G. Schools register.
  school: {
    table: 'schools', label: 'Schools', nameField: 'school_name', statusField: 'sanitation_status',
    search: ['school_name', 'school_code', 'school_level'],
    duplicateCheck: true,
    fields: {
      school_name: { required: true, label: 'School name' },
      school_code: {},
      ownership: { enum: ['unknown', 'public', 'private', 'faith_based', 'community'] },
      school_level: {},
      location_id: { type: 'int' },
      enrolment_boys: { type: 'int' },
      enrolment_girls: { type: 'int' },
      teaching_staff: { type: 'int' },
      boarding: { enum: ['day', 'boarding', 'day_and_boarding'] },
      has_kitchen: { type: 'bool', default: 0 },
      has_lab: { type: 'bool', default: 0 },
      sanitation_status: { enum: STATUS3 },
      assigned_officer_id: { type: 'int' },
      notes: {},
      active: { type: 'bool' }
    }
  },
  // H. Health facilities register.
  facility: {
    table: 'healthcare_facilities', label: 'Health facilities', nameField: 'facility_name', statusField: 'waste_management_status',
    search: ['facility_name', 'facility_type', 'facility_code'],
    duplicateCheck: true,
    fields: {
      facility_name: { required: true, label: 'Facility name' },
      facility_type: {},
      facility_level: {},
      ownership: { enum: ['unknown', 'public', 'private', 'faith_based', 'ngo'] },
      facility_code: {},
      location_id: { type: 'int' },
      has_mortuary: { type: 'bool', default: 0 },
      water_supply_status: { enum: STATUS3 },
      toilet_status: { enum: STATUS3 },
      drainage_status: { enum: STATUS3 },
      cleaning_status: { enum: STATUS3 },
      waste_management_status: { enum: STATUS3 },
      incinerator_status: { enum: ['unknown', 'functional', 'partially_functional', 'non_functional', 'not_available'] },
      pest_control_status: { enum: STATUS3 },
      assigned_officer_id: { type: 'int' },
      notes: {},
      active: { type: 'bool' }
    }
  },
  // E and I. Markets, public places, workplaces and public institutions.
  workplace: {
    table: 'public_places', label: 'Markets and workplaces', nameField: 'place_name', statusField: 'sanitation_status',
    search: ['place_name', 'place_type', 'operator_name'],
    duplicateCheck: true,
    restricted: ['operator_name', 'contact_phone'],
    fields: {
      place_name: { required: true, label: 'Name' },
      place_type: {},
      operator_name: {},
      contact_phone: {},
      workers: { type: 'int' },
      location_id: { type: 'int' },
      sanitation_status: { enum: STATUS3 },
      assigned_officer_id: { type: 'int' },
      notes: {},
      active: { type: 'bool' }
    }
  },
  // C and E. Complaints and nuisance register.
  complaint: {
    table: 'complaints', label: 'Complaints', nameField: 'title', statusField: 'status', refPrefix: 'CMP', refField: 'complaint_ref',
    search: ['title', 'complaint_ref', 'complaint_type', 'responsible_party'],
    restricted: ['complainant_name', 'complainant_contact'],
    fields: {
      title: { required: true, label: 'Short description' },
      complaint_ref: {},
      received_date: { type: 'date', required: true, label: 'Date received' },
      complaint_type: {},
      complainant_name: {},
      complainant_contact: {},
      allegation: {},
      location_id: { type: 'int' },
      responsible_party: {},
      assigned_officer_id: { type: 'int' },
      status: { enum: ['received', 'assigned', 'under_investigation', 'action_referral', 'follow_up', 'resolved', 'closed'] },
      investigation_notes: {},
      evidence: {},
      action_taken: {},
      referral_to: {},
      outcome: {},
      notes: {},
      active: { type: 'bool' }
    }
  },
  // M. Public events and temporary activities.
  event: {
    table: 'events', label: 'Public events', nameField: 'event_name', statusField: 'review_status',
    search: ['event_name', 'event_type', 'organiser', 'venue'],
    duplicateCheck: true,
    restricted: ['organiser_contact'],
    fields: {
      event_name: { required: true, label: 'Event name' },
      event_type: {},
      organiser: {},
      organiser_contact: {},
      venue: {},
      location_id: { type: 'int' },
      start_date: { type: 'date' },
      end_date: { type: 'date' },
      expected_attendance: { type: 'int' },
      review_status: { enum: ['registered', 'under_review', 'requirements_issued', 'cleared', 'not_cleared', 'completed'] },
      assigned_officer_id: { type: 'int' },
      notes: {},
      active: { type: 'bool' }
    }
  },
  // L. Port health: points of entry.
  point_of_entry: {
    table: 'points_of_entry', label: 'Points of entry', nameField: 'poe_name', statusField: 'status',
    search: ['poe_name', 'poe_type'],
    duplicateCheck: true,
    fields: {
      poe_name: { required: true, label: 'Point of entry' },
      poe_type: {},
      location_id: { type: 'int' },
      status: { enum: ['unknown', 'operational', 'closed'] },
      assigned_officer_id: { type: 'int' },
      notes: {},
      active: { type: 'bool' }
    }
  },
  // P. Equipment and supplies.
  equipment: {
    table: 'equipment', label: 'Equipment', nameField: 'item_name', statusField: 'condition', inspectable: false,
    search: ['item_name', 'asset_tag', 'category'],
    fields: {
      item_name: { required: true, label: 'Item' },
      asset_tag: {},
      category: {},
      quantity: { type: 'int' },
      assigned_officer_id: { type: 'int' },
      condition: { enum: ['good', 'fair', 'needs_service', 'broken', 'lost'] },
      service_due: { type: 'date' },
      request: {},
      notes: {},
      active: { type: 'bool' }
    }
  },
  // P. Optional CPD register (administrative only; never used to hide work modules).
  cpd: {
    table: 'cpd_records', label: 'CPD', nameField: 'course_topic', statusField: null, inspectable: false,
    search: ['course_topic', 'provider'],
    fields: {
      course_topic: { required: true, label: 'Course or topic' },
      assigned_officer_id: { type: 'int' },
      provider: {},
      cpd_date: { type: 'date' },
      points: { type: 'number' },
      evidence_reference: {},
      notes: {},
      active: { type: 'bool' }
    }
  }
};

// List of register keys, and the ones that can be inspected.
export const ENTITY_TYPES = Object.keys(REGISTERS);
export const INSPECTABLE_TYPES = ENTITY_TYPES.filter((k) => REGISTERS[k].inspectable !== false);

// A date must look like 2026-10-19.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// True only for a real calendar date, so 2026-02-30 is rejected.
export function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Checks the form data against the field rules. Returns the cleaned data and any errors.
// partial = true is used for edits, where missing fields are simply left unchanged.
export function cleanFields(spec, body, { partial = false } = {}) {
  const data = {};
  const errors = {};
  for (const [key, rule] of Object.entries(spec)) {
    // Field not sent. Only a problem when creating and the field is required.
    if (!(key in body)) {
      if (!partial && rule.required) errors[key] = `${rule.label || key} is required so the record can be identified.`;
      continue;
    }
    let v = body[key];
    // Empty text counts as "no value".
    if (v === '' || v === undefined) v = null;
    if (v === null) {
      if (rule.required) errors[key] = `${rule.label || key} is required so the record can be identified.`;
      data[key] = null;
      continue;
    }
    // Convert each value to its correct type and reject bad input.
    if (rule.type === 'int') {
      const n = Number(v);
      if (!Number.isInteger(n)) { errors[key] = 'Must be a whole number.'; continue; }
      v = n;
    } else if (rule.type === 'bool') {
      v = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
    } else if (rule.type === 'date') {
      if (!isValidDate(String(v))) { errors[key] = 'Enter a valid date (YYYY-MM-DD).'; continue; }
    } else if (rule.type === 'number') {
      const n = Number(v);
      if (Number.isNaN(n)) { errors[key] = 'Must be a number.'; continue; }
      v = n;
    } else if (rule.type === 'list') {
      // A list of values, for example officers in a team.
      if (!Array.isArray(v)) { errors[key] = 'Must be a list.'; continue; }
      v = v.slice(0, 50);
    } else {
      // Plain text: trim spaces and cap the length at 4000 characters.
      v = String(v).trim().slice(0, 4000);
    }
    // For drop down fields, the value must be one of the allowed options.
    if (rule.enum && !rule.enum.includes(v)) { errors[key] = `Choose one of: ${rule.enum.join(', ')}.`; continue; }
    data[key] = v;
  }
  return { data, errors };
}

// Builds a field rule list from a configurable activity form (see catalogue.js) so the same
// cleanFields() check can validate the extra details of each activity type.
export function specFromForm(form = []) {
  const spec = {};
  for (const f of form) {
    if (!f || !f.key) continue;
    const t = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'checkbox' ? 'bool' : null;
    spec[f.key] = { label: f.label, required: !!f.required, ...(t ? { type: t } : {}), ...(f.type === 'select' && f.options?.length ? { enum: f.options } : {}) };
  }
  return spec;
}
