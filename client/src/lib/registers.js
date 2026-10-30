// Client side register definitions: drive list columns, filters and forms.
// The four condition levels used by many sanitation checks.
const STATUS3 = ['unknown', 'satisfactory', 'needs_improvement', 'unsatisfactory'];
// Common building blocks for forms.
const loc = { key: 'location_id', label: 'Location', type: 'location' };
const officer = { key: 'assigned_officer_id', label: 'Assigned officer', type: 'officer' };
const notes = { key: 'notes', label: 'Notes', type: 'textarea' };

// One entry per register. Each entry controls how the register looks on the website:
//   label, singular  names shown in headings and buttons
//   nameField        the field used as the record name
//   statusField      the field used for the status filter, with its options
//   columns          the table columns on the list page (badge = coloured label, date = formatted date)
//   form             the fields on the add and edit form, in order (section = a heading inside the form)
//   inspectable      false when the register is not inspected (equipment, CPD)
//   inspectLabel     the button text on the record page
export const REGISTERS = {
  // Premises register (sanitary inspections, food premises and licence tracking).
  premises: {
    label: 'Premises', singular: 'Premises', nameField: 'premises_name', statusField: 'licence_status',
    statusOptions: ['unknown', 'applied', 'pending_review', 'approved', 'valid', 'renewal_due', 'expired', 'not_licensed'],
    columns: [
      { key: 'premises_name', label: 'Name' }, { key: 'premises_type', label: 'Type' }, { key: 'sub_location', label: 'Sub location' },
      { key: 'licence_status', label: 'Licence', badge: true }, { key: 'licence_expiry_date', label: 'Licence expiry', date: true, expiry: true },
      { key: 'last_inspection', label: 'Last inspection', date: true }, { key: 'open_follow_ups', label: 'Open follow ups', num: true }
    ],
    form: [
      { key: 'premises_name', label: 'Premises name', required: true },
      { key: 'premises_type', label: 'Premises type', options: ['Restaurant', 'Hotel', 'Cafe', 'Bakery', 'Butchery', 'Fish kiosk', 'Dairy outlet', 'Supermarket', 'Grocery', 'Bar', 'Lodging', 'Salon or barber', 'Workshop', 'Residential', 'Other'] },
      loc, officer,
      { key: 'operating_status', label: 'Operating status', options: ['unknown', 'operating', 'temporarily_closed', 'closed', 'under_construction'] },
      { key: 'plot_number', label: 'Plot number' }, { key: 'acreage', label: 'Acreage', type: 'number' },
      { key: 'construction_type', label: 'Construction type', options: ['Permanent', 'Semi permanent', 'Temporary', 'Other'] },
      { section: 'Owner / contact (restricted)', hint: 'Only record what is needed to contact the operator.' },
      { key: 'owner_name', label: 'Owner name' }, { key: 'manager_name', label: 'Manager name' }, { key: 'contact_phone', label: 'Contact phone' },
      { section: 'Licence workflow', hint: 'A licence is only recorded as approved or valid by an authorised supervisor.' },
      { key: 'licence_status', label: 'Licence status', options: ['unknown', 'applied', 'pending_review', 'approved', 'valid', 'renewal_due', 'expired', 'not_licensed'] },
      { key: 'application_date', label: 'Application date', type: 'date' },
      { key: 'inspection_recommendation', label: 'Inspection recommendation', options: ['unknown', 'pending', 'recommended', 'not_recommended'] },
      { key: 'payment_reference', label: 'Payment or receipt reference' },
      { key: 'licence_number', label: 'Licence number' },
      { key: 'licence_issue_date', label: 'Issue date', type: 'date' }, { key: 'licence_expiry_date', label: 'Expiry date', type: 'date' },
      notes
    ]
  },
  // Food handlers register.
  handler: {
    label: 'Food handlers', singular: 'Food handler', nameField: 'name', statusField: 'status',
    statusOptions: ['unknown', 'current', 'pending', 'expired'],
    columns: [
      { key: 'name', label: 'Name / identifier' }, { key: 'premises_name', label: 'Premises' }, { key: 'role', label: 'Role' },
      { key: 'medical_exam_date', label: 'Medical exam', date: true }, { key: 'certificate_expiry', label: 'Certificate expiry', date: true, expiry: true },
      { key: 'status', label: 'Status', badge: true }
    ],
    form: [
      { key: 'name', label: 'Name or approved identifier', required: true, hint: 'Do not record clinical details.' },
      { key: 'identifier', label: 'Reference / ID' },
      { key: 'premises_id', label: 'Works at premises', type: 'premises' },
      { key: 'role', label: 'Role at work', options: ['Cook', 'Server', 'Butcher', 'Vendor', 'Cleaner', 'Manager', 'Other'] },
      { key: 'medical_exam_date', label: 'Medical examination date', type: 'date' },
      { key: 'certificate_issue_date', label: 'Certificate issue date', type: 'date' },
      { key: 'certificate_expiry', label: 'Certificate expiry', type: 'date', hint: 'If left blank, status is shown as not recorded (never assumed valid).' },
      { key: 'status', label: 'Status', options: ['unknown', 'current', 'pending', 'expired'] },
      notes
    ]
  },
  // Households register (WASH assessment).
  household: {
    label: 'Households', singular: 'Household', nameField: 'household_code', statusField: 'sanitation_status', inspectLabel: 'Record WASH visit',
    statusOptions: ['unknown', 'adequate', 'needs_improvement', 'inadequate', 'none'],
    columns: [
      { key: 'household_code', label: 'Household code' }, { key: 'sub_location', label: 'Sub location' }, { key: 'village', label: 'Village' },
      { key: 'sanitation_status', label: 'Sanitation', badge: true }, { key: 'handwashing', label: 'Hand washing', badge: true },
      { key: 'last_visit_date', label: 'Last visit', date: true }, { key: 'follow_up_due', label: 'Follow up due', date: true, due: true }
    ],
    form: [
      { key: 'household_code', label: 'Household code', required: true, hint: 'Local identifier. Avoid resident names.' },
      loc,
      { key: 'water_source_type', label: 'Main water source', options: ['Piped', 'Borehole', 'Protected well', 'Unprotected well', 'Spring', 'Water vendor', 'Rain water', 'River or dam', 'Other'] },
      { key: 'sanitation_type', label: 'Sanitation type', options: ['Pit latrine', 'VIP latrine', 'Pour flush', 'Flush toilet', 'Shared latrine', 'None', 'Other'] },
      { key: 'sanitation_status', label: 'Sanitation status', options: ['unknown', 'adequate', 'needs_improvement', 'inadequate', 'none'] },
      { key: 'handwashing', label: 'Hand washing facility', options: ['unknown', 'soap_and_water', 'water_only', 'none'] },
      { key: 'hygiene_risks', label: 'Hygiene risks seen' },
      { key: 'last_visit_date', label: 'Last visit date', type: 'date' }, { key: 'follow_up_due', label: 'Follow up due', type: 'date' },
      officer, notes
    ]
  },
  // Water sources register.
  water_source: {
    label: 'Water sources', singular: 'Water source', nameField: 'source_name', statusField: 'status',
    statusOptions: ['unknown', 'functional', 'needs_attention', 'non_functional', 'closed'],
    columns: [
      { key: 'source_name', label: 'Source' }, { key: 'source_type', label: 'Type' }, { key: 'sub_location', label: 'Sub location' },
      { key: 'status', label: 'Status', badge: true }, { key: 'last_inspection_date', label: 'Last inspection', date: true },
      { key: 'next_inspection_due', label: 'Next inspection', date: true, due: true }
    ],
    form: [
      { key: 'source_name', label: 'Source name', required: true }, { key: 'source_code', label: 'Source ID' },
      { key: 'source_type', label: 'Source type', options: ['Borehole', 'Shallow well', 'Protected spring', 'Water kiosk', 'Piped supply', 'Dam / pan', 'Rain water tank', 'River', 'Other'] },
      loc, { key: 'operator', label: 'Owner / operator' },
      { key: 'population_served', label: 'Population served', type: 'number' },
      { key: 'treatment', label: 'Treatment in place', options: ['None', 'Chlorination', 'Filtration', 'Boiling at household', 'Other'] },
      { key: 'status', label: 'Operational status', options: ['unknown', 'functional', 'needs_attention', 'non_functional', 'closed'] },
      { key: 'last_inspection_date', label: 'Last inspection', type: 'date' }, { key: 'next_inspection_due', label: 'Next inspection due', type: 'date' },
      officer, notes
    ]
  },
  // Schools register.
  school: {
    label: 'Schools', singular: 'School', nameField: 'school_name', statusField: 'sanitation_status',
    statusOptions: STATUS3,
    columns: [
      { key: 'school_name', label: 'School' }, { key: 'school_level', label: 'Level' }, { key: 'sub_location', label: 'Sub location' },
      { key: 'boarding', label: 'Boarding', badge: true }, { key: 'sanitation_status', label: 'Sanitation', badge: true },
      { key: 'last_inspection', label: 'Last inspection', date: true }, { key: 'open_follow_ups', label: 'Open actions', num: true }
    ],
    form: [
      { key: 'school_name', label: 'School name', required: true }, { key: 'school_code', label: 'School code' },
      { key: 'ownership', label: 'Ownership', options: ['unknown', 'public', 'private', 'faith_based', 'community'] },
      { key: 'school_level', label: 'Level', options: ['ECDE', 'Primary', 'Junior school', 'Secondary', 'Mixed', 'Tertiary', 'Other'] },
      loc, officer,
      { section: 'Enrolment and facilities', hint: 'Kitchen, laboratory and boarding sections of the checklist only show when ticked here.' },
      { key: 'enrolment_boys', label: 'Enrolment: boys', type: 'number' }, { key: 'enrolment_girls', label: 'Enrolment: girls', type: 'number' },
      { key: 'teaching_staff', label: 'Teaching staff', type: 'number' },
      { key: 'boarding', label: 'Boarding status', options: ['day', 'boarding', 'day_and_boarding'] },
      { key: 'has_kitchen', label: 'Has a kitchen', type: 'checkbox' }, { key: 'has_lab', label: 'Has a laboratory', type: 'checkbox' },
      { key: 'sanitation_status', label: 'Sanitation status', options: STATUS3 },
      notes
    ]
  },
  // Health facilities register.
  facility: {
    label: 'Health facilities', singular: 'Health facility', nameField: 'facility_name', statusField: 'waste_management_status',
    statusOptions: STATUS3,
    columns: [
      { key: 'facility_name', label: 'Facility' }, { key: 'facility_type', label: 'Type' }, { key: 'sub_location', label: 'Sub location' },
      { key: 'waste_management_status', label: 'Waste mgmt', badge: true }, { key: 'incinerator_status', label: 'Incinerator', badge: true },
      { key: 'last_inspection', label: 'Last inspection', date: true }, { key: 'open_follow_ups', label: 'Open actions', num: true }
    ],
    form: [
      { key: 'facility_name', label: 'Facility name', required: true },
      { key: 'facility_type', label: 'Facility type', options: ['Hospital', 'Health centre', 'Dispensary', 'Private clinic', 'Maternity home', 'Laboratory', 'Pharmacy', 'Other'] },
      { key: 'facility_level', label: 'Level', options: ['Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6'] },
      { key: 'ownership', label: 'Ownership', options: ['unknown', 'public', 'private', 'faith_based', 'ngo'] },
      { key: 'facility_code', label: 'Facility code (MFL)' }, loc, officer,
      { key: 'has_mortuary', label: 'Has a mortuary', type: 'checkbox' },
      { section: 'Current sanitation status', hint: 'Updated from the latest inspection. Use unknown if not assessed.' },
      { key: 'water_supply_status', label: 'Water supply', options: STATUS3 }, { key: 'toilet_status', label: 'Toilets', options: STATUS3 },
      { key: 'drainage_status', label: 'Drainage', options: STATUS3 }, { key: 'cleaning_status', label: 'Cleaning', options: STATUS3 },
      { key: 'waste_management_status', label: 'Healthcare waste segregation / disposal', options: STATUS3 },
      { key: 'incinerator_status', label: 'Incinerator / burning chamber', options: ['unknown', 'functional', 'partially_functional', 'non_functional', 'not_available'] },
      { key: 'pest_control_status', label: 'Pest control', options: STATUS3 },
      notes
    ]
  },
  // Markets, public places, workplaces and institutions.
  workplace: {
    label: 'Markets and workplaces', singular: 'Market or workplace', nameField: 'place_name', statusField: 'sanitation_status',
    statusOptions: STATUS3,
    columns: [
      { key: 'place_name', label: 'Name' }, { key: 'place_type', label: 'Type' }, { key: 'sub_location', label: 'Sub location' },
      { key: 'sanitation_status', label: 'Sanitation', badge: true }, { key: 'last_inspection', label: 'Last inspection', date: true },
      { key: 'open_follow_ups', label: 'Open actions', num: true }
    ],
    form: [
      { key: 'place_name', label: 'Name', required: true },
      { key: 'place_type', label: 'Type', options: ['Market', 'Bus park', 'Public institution', 'Office', 'Factory or workshop', 'Construction site', 'Place of worship', 'Recreation place', 'Other'] },
      loc, officer,
      { key: 'workers', label: 'Number of workers or traders', type: 'number' },
      { key: 'sanitation_status', label: 'Sanitation status', options: STATUS3 },
      { section: 'Operator (restricted)' },
      { key: 'operator_name', label: 'Operator or manager' }, { key: 'contact_phone', label: 'Contact phone' },
      notes
    ]
  },
  // Complaints and nuisances.
  complaint: {
    label: 'Complaints', singular: 'Complaint', nameField: 'title', statusField: 'status', inspectLabel: 'Record investigation visit',
    statusOptions: ['received', 'assigned', 'under_investigation', 'action_referral', 'follow_up', 'resolved', 'closed'],
    columns: [
      { key: 'complaint_ref', label: 'Reference' }, { key: 'title', label: 'Complaint' }, { key: 'complaint_type', label: 'Type' },
      { key: 'received_date', label: 'Received', date: true }, { key: 'status', label: 'Status', badge: true },
      { key: 'officer_name', label: 'Officer' }, { key: 'open_follow_ups', label: 'Open actions', num: true }
    ],
    form: [
      { key: 'title', label: 'Short description', required: true },
      { key: 'received_date', label: 'Date received', type: 'date', required: true },
      { key: 'complaint_type', label: 'Type', options: ['Nuisance', 'Food safety', 'Water', 'Solid waste', 'Drainage or sewage', 'Noise, smoke or dust', 'Vector or pests', 'Housing', 'Other'] },
      { key: 'allegation', label: 'Details of the complaint', type: 'textarea' },
      loc, { key: 'responsible_party', label: 'Responsible party' }, officer,
      { key: 'status', label: 'Status', options: ['received', 'assigned', 'under_investigation', 'action_referral', 'follow_up', 'resolved', 'closed'] },
      { section: 'Complainant (restricted)', hint: 'Kept confidential. Hidden from reviewers.' },
      { key: 'complainant_name', label: 'Complainant name' }, { key: 'complainant_contact', label: 'Complainant contact' },
      { section: 'Investigation and outcome' },
      { key: 'investigation_notes', label: 'Investigation notes', type: 'textarea' }, { key: 'evidence', label: 'Evidence', type: 'textarea' },
      { key: 'action_taken', label: 'Action taken', type: 'textarea' }, { key: 'referral_to', label: 'Referred to' },
      { key: 'outcome', label: 'Outcome' }
    ]
  },
  // Public events and temporary activities.
  event: {
    label: 'Public events', singular: 'Public event', nameField: 'event_name', statusField: 'review_status',
    statusOptions: ['registered', 'under_review', 'requirements_issued', 'cleared', 'not_cleared', 'completed'],
    columns: [
      { key: 'event_name', label: 'Event' }, { key: 'event_type', label: 'Type' }, { key: 'venue', label: 'Venue' },
      { key: 'start_date', label: 'Starts', date: true }, { key: 'expected_attendance', label: 'Expected' },
      { key: 'review_status', label: 'Review', badge: true }
    ],
    form: [
      { key: 'event_name', label: 'Event name', required: true },
      { key: 'event_type', label: 'Event type', options: ['Concert or festival', 'Sports event', 'Religious gathering', 'Political rally', 'Funeral', 'Market day', 'Exhibition', 'Other'] },
      { key: 'organiser', label: 'Organiser' }, { key: 'organiser_contact', label: 'Organiser contact (restricted)' },
      { key: 'venue', label: 'Venue' }, loc,
      { key: 'start_date', label: 'Start date', type: 'date' }, { key: 'end_date', label: 'End date', type: 'date' },
      { key: 'expected_attendance', label: 'Expected attendance', type: 'number' },
      { key: 'review_status', label: 'Review status', options: ['registered', 'under_review', 'requirements_issued', 'cleared', 'not_cleared', 'completed'] },
      officer, notes
    ]
  },
  // Port health: points of entry.
  point_of_entry: {
    label: 'Points of entry', singular: 'Point of entry', nameField: 'poe_name', statusField: 'status',
    statusOptions: ['unknown', 'operational', 'closed'],
    columns: [
      { key: 'poe_name', label: 'Point of entry' }, { key: 'poe_type', label: 'Type' }, { key: 'sub_location', label: 'Sub location' },
      { key: 'status', label: 'Status', badge: true }, { key: 'last_inspection', label: 'Last inspection', date: true }
    ],
    form: [
      { key: 'poe_name', label: 'Name', required: true },
      { key: 'poe_type', label: 'Type', options: ['Border crossing', 'Seaport', 'Airport', 'Airstrip', 'Landing site', 'Other'] },
      loc, { key: 'status', label: 'Status', options: ['unknown', 'operational', 'closed'] }, officer, notes
    ]
  },
  // Equipment and supplies.
  equipment: {
    label: 'Equipment', singular: 'Equipment item', nameField: 'item_name', statusField: 'condition', inspectable: false,
    statusOptions: ['good', 'fair', 'needs_service', 'broken', 'lost'],
    columns: [
      { key: 'item_name', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'asset_tag', label: 'Asset tag' },
      { key: 'officer_name', label: 'Assigned to' }, { key: 'condition', label: 'Condition', badge: true }, { key: 'service_due', label: 'Service due', date: true, due: true }
    ],
    form: [
      { key: 'item_name', label: 'Item', required: true },
      { key: 'category', label: 'Category', options: ['Sampling kit', 'Protective equipment', 'Sprayer', 'Vehicle or motorbike', 'Phone or tablet', 'Computer', 'Measuring instrument', 'Consumables', 'Other'] },
      { key: 'asset_tag', label: 'Asset tag or serial' }, { key: 'quantity', label: 'Quantity', type: 'number' },
      { ...officer, label: 'Assigned to' },
      { key: 'condition', label: 'Condition', options: ['good', 'fair', 'needs_service', 'broken', 'lost'] },
      { key: 'service_due', label: 'Service due', type: 'date' },
      { key: 'request', label: 'Request or service need', type: 'textarea' }, notes
    ]
  },
  // Optional CPD register (administrative only; never used to hide work modules).
  cpd: {
    label: 'CPD', singular: 'CPD record', nameField: 'course_topic', statusField: null, inspectable: false,
    statusOptions: [],
    columns: [
      { key: 'course_topic', label: 'Course or topic' }, { key: 'officer_name', label: 'Officer' }, { key: 'provider', label: 'Provider' },
      { key: 'cpd_date', label: 'Date', date: true }, { key: 'points', label: 'Points' }
    ],
    form: [
      { key: 'course_topic', label: 'Course or topic', required: true }, { ...officer, label: 'Officer' },
      { key: 'provider', label: 'Provider' }, { key: 'cpd_date', label: 'Date', type: 'date' }, { key: 'points', label: 'Points', type: 'number' },
      { key: 'evidence_reference', label: 'Certificate or evidence reference' }, notes
    ]
  }
};

// List of the register keys (menu order), the ones that can be inspected, and the facility condition fields.
export const REGISTER_KEYS = Object.keys(REGISTERS);
export const INSPECTABLE = REGISTER_KEYS.filter((k) => REGISTERS[k].inspectable !== false);
export const FACILITY_STATUS_FIELDS = REGISTERS.facility.form.filter((f) => f.key && f.key.endsWith('_status'));
// Register groups for the register page menu.
export const REGISTER_GROUPS = [
  ['Premises and food', ['premises', 'handler', 'workplace']],
  ['Water and WASH', ['water_source', 'household']],
  ['Institutions', ['school', 'facility', 'point_of_entry', 'event']],
  ['Cases', ['complaint']],
  ['Administration', ['equipment', 'cpd']]
];
