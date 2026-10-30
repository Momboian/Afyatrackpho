// The AfyaTrack PHO work catalogue: default activity categories (with their own form fields),
// inspection checklists and notice templates. Loaded once by "npm run setup" and then managed
// by the System Administrator in Settings. Wording must be confirmed with county public health
// leadership before live use.

// Public health pillars used to group activities in quarterly and annual reports.
export const PILLARS = {
  A: 'Sanitary inspections and premises',
  B: 'Food hygiene and food premises',
  C: 'Public health law, notices and complaints',
  D: 'Water safety and WASH',
  E: 'Waste management and environmental sanitation',
  F: 'Vector and vermin control',
  G: 'School health and hygiene',
  H: 'Health facility sanitation',
  I: 'Occupational health and workplaces',
  J: 'Health education and promotion',
  K: 'Disease surveillance and alerts',
  L: 'Port health and points of entry',
  M: 'Public events',
  N: 'Routine registers and administration',
  P: 'Supervision, meetings and equipment'
};

// Short helpers to describe form fields: t() text, ta() long text, n() number, d() date, s() drop down, c() tick box.
const t = (key, label, required = false) => ({ key, label, type: 'text', required });
const ta = (key, label, required = false) => ({ key, label, type: 'textarea', required });
const n = (key, label, required = false) => ({ key, label, type: 'number', required });
const d = (key, label, required = false) => ({ key, label, type: 'date', required });
const s = (key, label, options, required = false) => ({ key, label, type: 'select', options, required });
const c = (key, label) => ({ key, label, type: 'checkbox' });

// Each category: name, pillar letter, module_group (links inspections and samples to the right category),
// unit counted in reports, people_field (form field that holds the number of people reached) and form fields.
// module_group equal to a register key means "inspection of that register".
export const CATEGORIES = [
  // A. Sanitary inspections and premises
  { name: 'Premises sanitary inspection', pillar: 'A', module_group: 'premises', unit: 'visits', description: 'Inspection of a registered premises using the premises checklist.' },
  { name: 'Premises registration and licence processing', pillar: 'A', module_group: 'licence', unit: 'activities',
    form: [s('stage', 'Stage', ['application recorded', 'inspection done', 'recommendation sent', 'approved by authorised officer', 'renewal'], true), t('reference', 'Application or payment reference'), ta('remarks', 'Remarks')] },

  // B. Food hygiene and food premises
  { name: 'Food handler medical follow up', pillar: 'B', module_group: 'handler', unit: 'handlers', description: 'Medical certificate status checks for food handlers.' },
  { name: 'Food safety education session', pillar: 'B', module_group: 'food_education', unit: 'sessions', people_field: 'handlers_reached',
    form: [t('topic', 'Topic', true), t('venue', 'Venue'), t('facilitator', 'Facilitator'), n('handlers_reached', 'Food handlers reached', true), ta('issues', 'Issues discussed')] },
  { name: 'Food quality surveillance', pillar: 'B', module_group: 'food_quality', unit: 'activities',
    form: [t('product', 'Product', true), t('batch', 'Batch or lot number'), t('source', 'Source or supplier'), t('quantity', 'Quantity (with unit)'),
      s('problem', 'Problem found', ['suspected unsafe', 'adulterated', 'expired', 'poorly stored', 'none found'], true),
      s('action', 'Action taken', ['advice given', 'seized (legally authorised)', 'destroyed (legally authorised)', 'referred', 'no action needed'], true),
      t('referral_to', 'Referred to'), ta('notes_on_authority', 'Authority or record of seizure or destruction')] },

  // C. Public health law, notices and complaints
  { name: 'Complaint investigation', pillar: 'C', module_group: 'complaint', unit: 'investigations', description: 'Site investigation of a registered complaint or nuisance.' },
  { name: 'Enforcement referral', pillar: 'C', module_group: 'enforcement', unit: 'referrals',
    form: [s('referred_to', 'Referred to', ['supervisor', 'legal office', 'police', 'court', 'other competent authority'], true), t('reference', 'Reference number'),
      ta('reason', 'Reason for referral', true), s('status', 'Status', ['sent', 'acknowledged', 'in progress', 'concluded'])] },

  // D. Water safety and WASH
  { name: 'Water source inspection', pillar: 'D', module_group: 'water_source', unit: 'visits' },
  { name: 'Water sample collection and result follow up', pillar: 'D', module_group: 'water_sample', unit: 'samples' },
  { name: 'Household WASH assessment', pillar: 'D', module_group: 'household', unit: 'households' },
  { name: 'Community sanitation (CLTS and ODF)', pillar: 'D', module_group: 'odf', unit: 'activities',
    form: [t('village', 'Village or community', true), s('stage', 'Stage', ['pre triggering', 'triggering', 'follow up', 'ODF claimed', 'ODF verified'], true),
      s('result_type', 'Result type', ['reported', 'verified'], true), n('households', 'Households in community'), n('latrines_built', 'New latrines built'), t('verified_by', 'Verified by')] },
  { name: 'Water treatment commodity distribution', pillar: 'D', module_group: 'commodity', unit: 'distributions',
    form: [t('commodity', 'Commodity', true), n('quantity', 'Quantity distributed', true), t('batch', 'Batch number'), t('recipient', 'Recipient or location'), n('stock_balance', 'Stock balance after distribution')] },

  // E. Waste management and environmental sanitation
  { name: 'Solid waste inspection', pillar: 'E', module_group: 'solid_waste', unit: 'visits',
    form: [t('site', 'Site', true), s('segregation', 'Segregation', ['good', 'partial', 'none']), t('bins', 'Bins and storage'), t('collection_frequency', 'Collection frequency'),
      t('disposal', 'Transport and disposal'), s('risk', 'Risk', ['low', 'medium', 'high']), ta('action', 'Corrective action')] },
  { name: 'Liquid waste and drainage inspection', pillar: 'E', module_group: 'liquid_waste', unit: 'visits',
    form: [t('site', 'Site', true), s('problem', 'Problem', ['blocked drain', 'stagnant water', 'effluent discharge', 'sewage leak', 'none found', 'other'], true),
      t('discharge_point', 'Discharge point'), t('responsible_party', 'Responsible party'), ta('action', 'Corrective action')] },
  { name: 'Market, public place and workplace inspection', pillar: 'E', module_group: 'workplace', unit: 'visits' },

  // F. Vector and vermin control
  { name: 'Vector and pest surveillance', pillar: 'F', module_group: 'vector_surveillance', unit: 'visits',
    form: [s('vector_type', 'Vector or pest', ['mosquitoes', 'rodents', 'flies', 'cockroaches', 'bedbugs', 'jiggers', 'other'], true), t('site', 'Site', true),
      t('evidence', 'Evidence seen'), t('breeding_sites', 'Breeding or resting places'), s('risk', 'Risk', ['low', 'medium', 'high']), ta('recommendations', 'Recommendations')] },
  { name: 'Vector control operation', pillar: 'F', module_group: 'vector_control', unit: 'operations',
    form: [t('target_area', 'Target area', true), s('method', 'Method', ['larviciding', 'indoor residual spraying', 'space spraying', 'rodent baiting', 'environmental management', 'other'], true),
      t('team', 'Team'), t('materials', 'Materials or chemicals'), t('quantity_used', 'Quantity used (with unit)'), ta('precautions', 'Safety precautions'),
      s('completion', 'Completion', ['planned', 'in progress', 'completed'])] },
  { name: 'Fumigation or disinfection', pillar: 'F', module_group: 'fumigation', unit: 'operations',
    form: [t('site', 'Site', true), t('reason', 'Reason', true), t('operator', 'Authorised operator'), t('product', 'Product used'), t('product_batch', 'Product batch'),
      ta('safety_measures', 'Safety measures'), c('notification_given', 'Occupants or neighbours notified'), ta('post_treatment_advice', 'Post treatment advice')] },
  { name: 'Vector control education and follow up', pillar: 'F', module_group: 'vector_education', unit: 'sessions', people_field: 'people_reached',
    form: [t('audience', 'Audience'), t('venue', 'Venue'), n('people_reached', 'People reached', true), ta('messages', 'Prevention messages'), t('repeat_visit_outcome', 'Repeat visit outcome')] },

  // G. School health and hygiene
  { name: 'School sanitation inspection', pillar: 'G', module_group: 'school', unit: 'visits' },
  { name: 'School health talk', pillar: 'G', module_group: 'school_talk', unit: 'sessions', people_field: 'total_reached',
    form: [t('topic', 'Topic', true), t('class_group', 'Class or group'), t('facilitator', 'Facilitator'), n('boys', 'Boys reached'), n('girls', 'Girls reached'), n('staff', 'Staff reached'),
      n('total_reached', 'Total reached', true), ta('referrals', 'Referrals made')] },
  { name: 'School health programme activity', pillar: 'G', module_group: 'school_programme', unit: 'activities', people_field: 'reached',
    description: 'Coordination only. Does not replace clinical records.',
    form: [s('programme', 'Programme', ['deworming coordination', 'vitamin A coordination', 'menstrual hygiene', 'health club', 'growth monitoring support', 'other'], true),
      t('class_group', 'Class or group'), n('reached', 'Learners reached'), ta('referrals', 'Referrals')] },

  // H. Health facility sanitation
  { name: 'Health facility sanitation inspection', pillar: 'H', module_group: 'facility', unit: 'visits' },
  { name: 'Facility maintenance action follow up', pillar: 'H', module_group: 'maintenance', unit: 'actions',
    form: [t('defect', 'Defect', true), s('risk', 'Risk', ['low', 'medium', 'high']), t('responsible_person', 'Responsible person'), t('work_order', 'Work order or referral'),
      s('status', 'Status', ['open', 'in progress', 'closed']), t('closure_evidence', 'Closure evidence')] },

  // I. Occupational health and workplaces
  { name: 'Workplace incident referral', pillar: 'I', module_group: 'osh_referral', unit: 'referrals', description: 'Non clinical details only.',
    form: [t('workplace', 'Workplace', true), t('incident_type', 'Incident type', true), n('persons_affected', 'Persons affected'), t('referred_to', 'Referred to (OSH, DOSH or other authority)'), t('reference', 'Reference')] },

  // J. Health education and promotion
  { name: 'Health talk or campaign', pillar: 'J', module_group: 'health_education', unit: 'sessions', people_field: 'people_reached',
    form: [t('topic', 'Topic', true), t('objective', 'Objective'), t('audience', 'Audience'), t('venue', 'Venue'), t('facilitator', 'Facilitator'), t('materials', 'Materials used'),
      n('male', 'Male reached'), n('female', 'Female reached'), n('people_reached', 'Total people reached', true), ta('follow_up', 'Follow up or referral')] },
  { name: 'Community outreach visit', pillar: 'J', module_group: 'outreach', unit: 'visits', people_field: 'people_reached',
    form: [t('community', 'Community or household area', true), ta('issues', 'Issues identified'), ta('education_given', 'Education provided'), n('people_reached', 'People reached'), t('referral', 'Referral')] },
  { name: 'Stakeholder engagement meeting', pillar: 'J', module_group: 'stakeholder', unit: 'meetings', people_field: 'attendance',
    form: [t('meeting_type', 'Meeting type', true), t('organisations', 'Organisations present'), n('attendance', 'Attendance'), ta('decisions', 'Decisions'), t('responsible', 'Responsible persons'), d('deadline', 'Deadline')] },
  { name: 'IEC materials distribution', pillar: 'J', module_group: 'materials', unit: 'distributions',
    form: [t('material', 'Approved material', true), n('quantity', 'Quantity distributed', true), t('recipients', 'Recipients')] },

  // K. Disease surveillance and alerts
  { name: 'Public health alert', pillar: 'K', module_group: 'alert', unit: 'alerts', description: 'Does not replace the official surveillance system.',
    form: [t('alert_type', 'Alert type', true), t('received_at', 'Date and time received', true), t('source', 'Source'), s('urgency', 'Urgency', ['low', 'medium', 'high', 'critical'], true),
      s('verification', 'Verification', ['pending', 'verified', 'discarded']), t('referred_to', 'Referred to'), t('notified_who', 'Who was notified'), t('notified_when', 'When notified'),
      ta('outstanding_action', 'Outstanding action')] },
  { name: 'Assigned case search', pillar: 'K', module_group: 'case_search', unit: 'searches',
    form: [s('search_type', 'Search type', ['AFP', 'measles', 'neonatal tetanus', 'cholera', 'other'], true), n('sites_visited', 'Sites visited'), t('outcome', 'Outcome'), t('referral', 'Referral')] },
  { name: 'Outbreak response activity', pillar: 'K', module_group: 'response', unit: 'activities',
    form: [s('activity', 'Activity', ['community communication', 'environmental assessment', 'coordination meeting', 'follow up'], true), t('outcome', 'Outcome'), ta('outstanding_action', 'Outstanding action')] },

  // L. Port health and points of entry
  { name: 'Point of entry inspection', pillar: 'L', module_group: 'point_of_entry', unit: 'visits' },
  { name: 'Port health activity', pillar: 'L', module_group: 'port_activity', unit: 'activities', description: 'No official certificate is issued without the required approval.',
    form: [t('activity_type', 'Activity type', true), t('conveyance', 'Conveyance'), n('persons_screened', 'Persons screened'), t('outcome', 'Outcome'), t('referral', 'Referral')] },

  // M. Public events
  { name: 'Event sanitation inspection', pillar: 'M', module_group: 'event', unit: 'visits' },

  // N. Routine registers and administration
  { name: 'General PHO activity', pillar: 'N', module_group: 'general', unit: 'activities', description: 'Activities not yet in a dedicated category.' },
  { name: 'Referral and handover', pillar: 'N', module_group: 'referral', unit: 'referrals',
    form: [t('recipient_office', 'Recipient office', true), t('recipient_person', 'Recipient person'), d('date_sent', 'Date sent'), t('reference', 'Reference'),
      s('status', 'Status', ['sent', 'received', 'in progress', 'feedback received', 'closed']), ta('feedback', 'Feedback')] },

  // P. Supervision, meetings and equipment
  { name: 'Support supervision visit', pillar: 'P', module_group: 'supervision', unit: 'visits',
    form: [t('supervised', 'Officer or facility supervised', true), t('checklist_used', 'Checklist used'), ta('observations', 'Observations'), ta('mentorship', 'Mentorship given'),
      ta('agreed_actions', 'Agreed actions'), t('responsible', 'Responsible person'), d('follow_up_date', 'Follow up date')] },
  { name: 'Team meeting', pillar: 'P', module_group: 'meeting', unit: 'meetings', people_field: 'attendance',
    form: [t('agenda', 'Agenda', true), n('attendance', 'Attendance'), ta('decisions', 'Minutes and decisions'), t('action_owners', 'Action owners'), d('deadline', 'Deadline')] }
];

// Inspection checklists. A line starting with "# " is a section heading.
// "(if field)" at the end of a heading shows that section only when the register entry has that field set,
// for example "# Kitchen (if has_kitchen)".
export const CHECKLISTS = {
  premises: [
    '# General', 'Premises registered and licence displayed', 'Premises clean and in good repair',
    '# Buildings and environment', 'Compound clean and well drained', 'Fencing in good condition', 'Floors smooth, clean and washable', 'Walls and ceilings clean and in good repair',
    'Doors and windows in good repair and screened where needed', 'Roof sound with no leaks', 'Lighting adequate', 'Ventilation adequate', 'No evidence of pests or vermin',
    '# Water and sanitation', 'Safe water supply available', 'Toilets clean, functional and adequate', 'Hand washing facility with soap and water', 'Refuse bins with lids and regular collection',
    '# Food handling (where food is handled)', 'Food stored off the floor and covered', 'Raw and cooked food kept separate', 'Food handlers have valid medical certificates', 'Food handlers in clean protective clothing'
  ],
  handler: ['Medical certificate seen', 'Certificate within validity', 'Personal hygiene satisfactory', 'Protective clothing worn'],
  household: ['Has a latrine or toilet', 'Latrine clean and in use', 'Hand washing facility near latrine', 'Safe drinking water source', 'Safe drinking water storage', 'Safe refuse disposal', 'No stagnant water around compound'],
  water_source: ['Source protected or fenced', 'Surroundings clean, no latrine within 30 m', 'Drainage around source adequate', 'Collection points clean', 'Storage covered and clean',
    'Distribution system without leaks', 'Treatment in place where required', 'No visible contamination'],
  school: [
    '# Sanitation', 'Enough toilets or latrines for learners', 'Separate cubicles for boys and girls', 'Toilets private and accessible for learners with disabilities', 'Toilets clean',
    'Pit or tank not full', 'Hand washing facility with soap and water', 'Safe drinking water available', 'Menstrual hygiene facilities available',
    '# Classrooms and buildings', 'Classrooms not overcrowded', 'Ventilation adequate', 'Lighting adequate', 'Floors, walls and roofs in good repair', 'Doors and windows in good repair',
    'No pests or hazards', 'Compound clean and well drained',
    '# Kitchen (if has_kitchen)', 'Kitchen clean and in good repair', 'Food stored safely', 'Kitchen staff have medical certificates',
    '# Laboratory (if has_lab)', 'Chemicals stored safely', 'Laboratory ventilated with safety equipment',
    '# Boarding (if boarding)', 'Dormitories not overcrowded', 'Bathrooms adequate and clean', 'Beds and bedding clean'
  ],
  facility: [
    '# Water and sanitation', 'Water supply adequate and reliable', 'Water storage covered and clean', 'Toilets clean, functional and sufficient', 'Hand hygiene stations available',
    'Drainage free flowing, no stagnant water', 'Wards and floors clean',
    '# Healthcare waste', 'Waste segregated at source (colour coded bins)', 'Sharps containers used correctly', 'Temporary storage area secure', 'Internal transport safe',
    'Incinerator or treatment equipment functional', 'Final disposal safe', 'Waste records kept',
    '# Environmental hygiene (refer clinical IPC matters to the IPC team)', 'Pest control in place', 'Laundry area hygienic', 'Kitchen area hygienic',
    '# Mortuary (if has_mortuary)', 'Mortuary clean and in good repair', 'Cold storage functional', 'Mortuary waste handled safely'
  ],
  workplace: [
    '# General sanitation', 'Premises clean', 'Waste facilities adequate', 'Drainage free flowing', 'Toilets clean and adequate', 'Water points available', 'Food hygiene acceptable where food is sold',
    '# Workplace hazards', 'Physical hazards controlled (noise, heat, machinery)', 'Chemicals labelled and stored safely', 'Biological hazards controlled', 'Ergonomic risks addressed',
    'Fire and safety equipment available', 'First aid available', 'Protective equipment provided and used'
  ],
  event: ['Enough toilets for expected attendance', 'Safe water available', 'Food handling acceptable', 'Waste bins and collection arranged', 'Drainage adequate', 'No environmental hazards'],
  point_of_entry: ['Environment clean', 'Safe water available', 'Toilets clean and adequate', 'Waste managed safely', 'Food outlets hygienic', 'Vector control in place', 'Conveyances inspected where authorised'],
  complaint: ['Nuisance confirmed on site', 'Source identified', 'Risk to public health', 'Responsible party identified', 'Immediate action needed']
};

// Approved notice templates. The {{words}} are replaced with real details when a notice is drafted.
export const TEMPLATES = [
  { name: 'Intimation notice', body: `INTIMATION NOTICE (TEMPLATE: wording to be confirmed by the county)
Reference: {{reference}}
Date: {{date}}

To: {{recipient}}
Premises / place: {{entity_name}}
Location: {{location}}, {{ward}}

Following an inspection by a Public Health Officer, the following conditions were found:
{{findings}}

You are hereby required, under {{legal_provision}}, to carry out the following corrective action:
{{corrective_action}}

Compliance deadline: {{compliance_deadline}}

Public Health Officer: {{officer_name}}
Signature: ____________________` },
  { name: 'Sanitation improvement notice', body: `PUBLIC HEALTH NOTICE (TEMPLATE: wording to be confirmed by the county)
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

Legal provision: {{legal_provision}}
Failure to comply may lead to further action under the applicable public health law.

Public Health Officer: {{officer_name}}
Signature: ____________________` },
  { name: 'Food premises improvement notice', body: `FOOD PREMISES IMPROVEMENT NOTICE (TEMPLATE: wording to be confirmed by the county)
Reference: {{reference}}
Date: {{date}}

To the owner / operator: {{recipient}}
Food premises: {{entity_name}}, {{location}}, {{ward}}

An inspection of the above premises found the following defects:
{{findings}}

Required improvements:
{{corrective_action}}

These improvements must be completed by {{compliance_deadline}}. A follow up inspection will be carried out after this date.
Legal provision: {{legal_provision}}

Public Health Officer: {{officer_name}}
Signature: ____________________` }
];

// Turns a field label into a key, for example "People reached" becomes "people_reached".
export const keyOf = (label) => String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'field';
