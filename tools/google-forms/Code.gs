/**
 * School of Sciences: course-representative dues collection.
 * Paste this file into a standalone project at https://script.google.com/.
 * Run createDuesCollectionForm(), authorise, then read the three logged links.
 * Collects records only. Does not issue receipts, send email or write to Dues.
 * Configuration snapshot checked against production on 4 November 2026.
 */
const DUES_FORM_CONFIG = {
  title: 'School of Sciences — Course Rep Dues Collection',
  academicYear: '2026/2027',
  timezone: 'Africa/Accra',
  schoolDues: 60,
  maxMainDues: 60, // Matches server/src/utils/duesLimits.js; this is per line.
  departments: [
    { code: 'ACTUA-2B5B', name: 'Actuarial Science', dues: 60 },
    { code: 'BIO', name: 'Biological Sciences', dues: 60 },
    { code: 'CHEM', name: 'Chemical Sciences', dues: 50 },
    { code: 'CS', name: 'Computer Science and Informatics', dues: 60 },
    { code: 'ITDS', name: 'Information Technology and Decision Sciences', dues: 50 },
    { code: 'MATHE-021B', name: 'Mathematics', dues: 0 },
    { code: 'MLS', name: 'Medical Laboratory Science', dues: 60 },
    { code: 'NURS', name: 'Nursing', dues: 60 },
    { code: 'STATI-BF04', name: 'Statistics', dues: 0 }
  ]
};
const DUES_LEVELS = ['100', '200', '300', '400'];
const DUES_TYPES = ['School dues only', 'Department dues only', 'School and department dues'];
const DUES_ACK = 'I received the money and checked the student number, email, amounts and level being paid for.';
const DUES_QUEUE_HEADERS = [
  'source_submission_id', 'idempotency_key', 'submitted_at', 'paid_at',
  'academic_year', 'department_code', 'department_name', 'rep_name', 'rep_email',
  'rep_class', 'student_name', 'student_no', 'email', 'level', 'payment_level',
  'method', 'payment_reference', 'school_dues', 'department_dues', 'total_amount',
  'items_json', 'validation_status', 'validation_notes', 'review_flags',
  'possible_duplicate_of', 'review_status', 'reviewed_by', 'reviewed_at',
  'receipt_status', 'receipt_number', 'receipt_issued_at', 'email_status',
  'email_sent_at', 'office_notes', 'duplicate_fingerprint'
];

function createDuesCollectionForm() {
  validateConfig_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const yearKey = 'DUES_YEAR_' + DUES_FORM_CONFIG.academicYear.replace('/', '_');
    let meta = JSON.parse(props.getProperty(yearKey) || 'null');
    if (meta && meta.state === 'ready') {
      ensureSubmitTrigger_(meta.formId);
      if (!meta.published) {
        const existing = FormApp.openById(meta.formId);
        if (existing.supportsAdvancedResponderPermissions()) existing.setPublished(true);
        existing.setAcceptingResponses(true);
        meta.published = true;saveMeta_(meta);props.setProperty(yearKey, JSON.stringify(meta));
      }
      return logLinks_(meta);
    }
    if (!meta) {
      const form = FormApp.create(DUES_FORM_CONFIG.title + ' | ' + DUES_FORM_CONFIG.academicYear, false);
      form.setAcceptingResponses(false);
      meta = { formId: form.getId(), state: 'building', createdAt: new Date().toISOString() };
      props.setProperty(yearKey, JSON.stringify(meta));
    }
    const form = FormApp.openById(meta.formId);
    if (form.getResponses().length) throw new Error('This unfinished form already has responses. Do not rebuild it; inspect it first.');
    form.setAcceptingResponses(false);
    if (form.supportsAdvancedResponderPermissions()) form.setPublished(false);
    // Resuming an interrupted first setup is safe: it has never accepted data.
    while (form.getItems().length) form.deleteItem(form.getItems().length - 1);
    const sheet = meta.spreadsheetId
      ? SpreadsheetApp.openById(meta.spreadsheetId)
      : SpreadsheetApp.create('Dues collection records | ' + DUES_FORM_CONFIG.academicYear);
    meta.spreadsheetId = sheet.getId();
    props.setProperty(yearKey, JSON.stringify(meta));
    sheet.setSpreadsheetTimeZone(DUES_FORM_CONFIG.timezone);
    sheet.setSpreadsheetLocale('en_GB');
    meta.config = JSON.parse(JSON.stringify(DUES_FORM_CONFIG));
    meta.fields = {};
    const fields = meta.fields;
    form.setDescription(
      'For authorised course representatives recording money already received. ' +
      'One submission per student collection. Academic year: ' + meta.config.academicYear + '. ' +
      'Partial payments and arrears are allowed. This form does not process payments or issue receipts. ' +
      'The school office will verify the records and issue receipts later. Do not enter a department PIN or password.'
    ).setCollectEmail(false).setLimitOneResponsePerUser(false).setAllowResponseEdits(false)
      .setPublishingSummary(false).setProgressBar(true).setShuffleQuestions(false)
      .setShowLinkToRespondAgain(true)
      .setConfirmationMessage('Collection recorded for office review. No receipt has been issued yet. Do not enter this same collection again. Use the response-again link only for another collection.');

    form.addSectionHeaderItem().setTitle('1. Course representative');
    addText_(form, fields, 'rep_name', 'Course rep full name', true, 'Use your own name, not the payer’s.', nameRule_());
    addText_(form, fields, 'rep_email', 'Course rep email', true, 'The office uses this to follow up. It is not the receipt recipient.', emailRule_());
    fields.department = String(form.addListItem().setTitle('Collecting department').setRequired(true)
      .setChoiceValues(meta.config.departments.map(departmentLabel_)).getId());
    addText_(form, fields, 'rep_class', 'Programme / class represented', true, 'For example: BSc Computer Science, Level 200.', nameRule_());

    form.addSectionHeaderItem().setTitle('2. Student / payer');
    addText_(form, fields, 'student_name', 'Student full name', true, 'Check the spelling with the student.', nameRule_());
    addText_(form, fields, 'student_no', 'Student / index number', true,
      'Copy the actual student number. Continuing-student numbers do not have to start with UA.',
      FormApp.createTextValidation().requireTextMatchesPattern('^[^\\r\\n]{1,50}$').setHelpText('Enter the actual student/index number, up to 50 characters.').build());
    addText_(form, fields, 'email', 'Student email for receipt', true, 'The later receipt will be sent to THIS address. Ask the student to confirm it.', emailRule_());
    addText_(form, fields, 'email_confirm', 'Confirm student email', true, 'Type the student’s email again, not the rep’s email.', emailRule_());
    fields.level = String(form.addListItem().setTitle('Student current level').setRequired(true).setChoiceValues(DUES_LEVELS).getId());
    fields.payment_level = String(form.addListItem().setTitle('Level being paid for').setRequired(true).setChoiceValues(DUES_LEVELS)
      .setHelpText('Choose the level the money covers. For arrears this can differ from the current level.').getId());

    form.addSectionHeaderItem().setTitle('3. Collection details');
    fields.method = String(form.addMultipleChoiceItem().setTitle('Payment method').setRequired(true).setChoiceValues(['Cash', 'Mobile money']).getId());
    addText_(form, fields, 'payment_reference', 'Payment / collection reference (optional)', false,
      'Mobile-money transaction reference or cash-book reference, if available. This is not an official receipt number.');
    addText_(form, fields, 'collection_date', 'Collection date, if different from today (optional)', false,
      'Use YYYY-MM-DD, for example 2026-11-04. Leave blank for the submission date.',
      FormApp.createTextValidation().requireTextMatchesPattern('^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$').setHelpText('Use YYYY-MM-DD.').build());
    const type = form.addMultipleChoiceItem().setTitle('Which dues does this collection cover?').setRequired(true);
    fields.dues_type = String(type.getId());
    const schoolPage = form.addPageBreakItem().setTitle('School dues');
    addAmount_(form, fields, 'school_only_amount', 'School dues amount received (GHS)', meta.config);
    const deptPage = form.addPageBreakItem().setTitle('Department dues');
    addAmount_(form, fields, 'department_only_amount', 'Department dues amount received (GHS)', meta.config);
    const bothPage = form.addPageBreakItem().setTitle('School and department dues');
    addAmount_(form, fields, 'both_school_amount', 'School dues amount received (GHS)', meta.config);
    addAmount_(form, fields, 'both_department_amount', 'Department dues amount received (GHS)', meta.config);
    const confirmPage = form.addPageBreakItem().setTitle('4. Check and submit');
    confirmPage.setHelpText('Use Back to correct any detail. Check the student email carefully. Record only money actually received. A submission is not an official receipt.');
    fields.confirmation = String(form.addCheckboxItem().setTitle('Collection confirmation').setChoiceValues([DUES_ACK]).setRequired(true).getId());
    // PageBreak navigation applies to the page BEFORE the break, not after it.
    deptPage.setGoToPage(confirmPage); // school-only page -> confirmation
    bothPage.setGoToPage(confirmPage); // department-only page -> confirmation
    type.setChoices([
      type.createChoice(DUES_TYPES[0], schoolPage),
      type.createChoice(DUES_TYPES[1], deptPage),
      type.createChoice(DUES_TYPES[2], bothPage)
    ]);
    prepareQueue_(sheet);
    writeSetup_(sheet, meta);
    // Google throws if getDestinationId() is called before a destination exists.
    if (form.getDestinationType() !== FormApp.DestinationType.SPREADSHEET || form.getDestinationId() !== sheet.getId()) {
      form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());
    }
    meta.state = 'ready';
    meta.reconciledAt = meta.createdAt;
    saveMeta_(meta);
    props.setProperty(yearKey, JSON.stringify(meta));
    ensureSubmitTrigger_(meta.formId);
    if (form.supportsAdvancedResponderPermissions()) form.setPublished(true);
    form.setAcceptingResponses(true);
    meta.published = true;saveMeta_(meta);props.setProperty(yearKey, JSON.stringify(meta));
    return logLinks_(meta);
  } finally { lock.releaseLock(); }
}

function getDuesFormLinks() {
  const key = 'DUES_YEAR_' + DUES_FORM_CONFIG.academicYear.replace('/', '_');
  const meta = JSON.parse(PropertiesService.getScriptProperties().getProperty(key) || 'null');
  if (!meta || meta.state !== 'ready') throw new Error('Run createDuesCollectionForm first.');
  return logLinks_(meta);
}

/** Installable FORM submit trigger: never run this manually. */
function recordDuesSubmission(event) {
  if (!event || !event.response || !event.source) throw new Error('Use the installed form-submit trigger. To repair missing rows, run reconcileDuesResponses.');
  const lock = LockService.getScriptLock();lock.waitLock(30000);
  try {
    const meta = loadMeta_(event.source.getId());
    const queue = SpreadsheetApp.openById(meta.spreadsheetId).getSheetByName('Receipt Queue');
    appendResponses_(queue, meta, [event.response]);
  } finally { lock.releaseLock(); }
}

/** Manual recovery after a trigger failure. Repeat safely for large backlogs. */
function reconcileDuesResponses() {
  const lock = LockService.getScriptLock();lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties().getProperties();
    Object.keys(props).filter(key => key.indexOf('DUES_META_') === 0).forEach(key => {
      const meta = JSON.parse(props[key]);if (meta.state !== 'ready') return;
      const queue = SpreadsheetApp.openById(meta.spreadsheetId).getSheetByName('Receipt Queue');
      assertQueueHeaders_(queue);
      const seen = new Set(queue.getLastRow() > 1 ? queue.getRange(2,1,queue.getLastRow()-1,1).getValues().map(row => String(row[0])) : []);
      // Full scan also repairs older missed triggers. Filter before limiting the
      // batch, otherwise a backlog can repeatedly select already processed rows.
      const missing = FormApp.openById(meta.formId).getResponses()
        .sort((a,b) => a.getTimestamp() - b.getTimestamp())
        .filter(response => !seen.has(meta.formId + ':' + response.getId()));
      const batch = missing.slice(0, 250);
      appendResponses_(queue, meta, batch);
      if (batch.length) { meta.reconciledAt = batch[batch.length - 1].getTimestamp().toISOString();saveMeta_(meta); }
      console.log('Recovered ' + batch.length + ' responses for ' + meta.config.academicYear + '; remaining: ' + (missing.length - batch.length) + '.');
    });
  } finally { lock.releaseLock(); }
}

function appendResponses_(queue, meta, responses) {
  assertQueueHeaders_(queue);
  const data = queue.getLastRow() > 1 ? queue.getRange(2, 1, queue.getLastRow() - 1, DUES_QUEUE_HEADERS.length).getValues() : [];
  const sourceColumn = DUES_QUEUE_HEADERS.indexOf('source_submission_id');
  const fingerprintColumn = DUES_QUEUE_HEADERS.indexOf('duplicate_fingerprint');
  const seen = new Set(data.map(row => String(row[sourceColumn]))),fingerprints = {};
  data.forEach(row => { if (row[fingerprintColumn]) fingerprints[String(row[fingerprintColumn])] = String(row[sourceColumn]); });
  const rows = [];
  responses.forEach(response => {
    const sourceId = meta.formId + ':' + response.getId();
    if (seen.has(sourceId)) return; // Trigger retries never append another copy.
    const answers = {};
    response.getItemResponses().forEach(item => { answers[String(item.getItem().getId())] = item.getResponse(); });
    const record = normalizeSubmission_(meta, answers, response.getId(), response.getTimestamp());
    record.idempotency_key = 'gform:' + hash_(sourceId); // 70 chars; Dues accepts <=128.
    record.duplicate_fingerprint = hash_(JSON.stringify([
      record.student_no, record.academic_year, record.payment_level, record.department_code,
      record.school_dues, record.department_dues, record.method, record.paid_at.slice(0,10), record.payment_reference
    ]));
    record.possible_duplicate_of = fingerprints[record.duplicate_fingerprint] || '';
    if (record.possible_duplicate_of) record.review_flags = [record.review_flags, 'POSSIBLE_DUPLICATE: check whether this is a separate instalment.'].filter(Boolean).join(' | ');
    fingerprints[record.duplicate_fingerprint] = sourceId;
    rows.push(DUES_QUEUE_HEADERS.map(header => literalCell_(record[header] === undefined ? '' : record[header])));
    seen.add(sourceId);
  });
  if (!rows.length) return;
  const start = queue.getLastRow() + 1;
  if (start + rows.length - 1 > queue.getMaxRows()) queue.insertRowsAfter(queue.getMaxRows(), Math.max(500, rows.length));
  const range = queue.getRange(start, 1, rows.length, DUES_QUEUE_HEADERS.length);
  range.setNumberFormat('@'); // Preserve leading-zero student/index numbers.
  range.setValues(rows);
  queue.getRange(start, DUES_QUEUE_HEADERS.indexOf('school_dues') + 1, rows.length, 3).setNumberFormat('0.00');
  queue.getRange(start, DUES_QUEUE_HEADERS.indexOf('review_status') + 1, rows.length, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['PENDING','APPROVED','REJECTED'], true).setAllowInvalid(false).build());
  SpreadsheetApp.flush();
}

/** Pure validation: also exercised by the local Node test suite. */
function normalizeSubmission_(meta, answers, responseId, submittedAt) {
  const config = meta.config,fields = meta.fields,errors = [],flags = [];
  const read = key => String(answers[fields[key]] || '').trim();
  const department = config.departments.find(d => departmentLabel_(d) === read('department'));
  const email = read('email').toLowerCase(),repEmail = read('rep_email').toLowerCase();
  const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (!read('rep_name') || !read('rep_class')) errors.push('Missing rep name or class.');
  if (!validEmail(repEmail)) errors.push('Invalid rep email.');
  if (!read('student_name') || read('student_name').length > 180) errors.push('Invalid student name.');
  const studentNo = read('student_no').toUpperCase();
  if (!studentNo || studentNo.length > 50 || /[\x00-\x1f]/.test(studentNo)) errors.push('Invalid student/index number.');
  if (!validEmail(email)) errors.push('Invalid student receipt email.');
  if (email !== read('email_confirm').toLowerCase()) errors.push('The two student email entries do not match.');
  if (!department) errors.push('Unknown collecting department.');
  if (DUES_LEVELS.indexOf(read('level')) < 0 || DUES_LEVELS.indexOf(read('payment_level')) < 0) errors.push('Invalid student level or level being paid for.');
  const method = ({'Cash':'cash','Mobile money':'momo'})[read('method')];
  if (!method) errors.push('Invalid payment method.');
  const type = read('dues_type');if (DUES_TYPES.indexOf(type) < 0) errors.push('Invalid dues selection.');
  let school = 0,dept = 0;
  function amount(key) {
    const raw = read(key);
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(raw)) { errors.push('Invalid amount or more than two decimal places.');return 0; }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > config.maxMainDues) { errors.push('A dues amount is outside the permitted range.');return 0; }
    return Math.round(value * 100) / 100;
  }
  // Read only the selected branch: Google can retain values entered before Back.
  if (type === DUES_TYPES[0]) school = amount('school_only_amount');
  if (type === DUES_TYPES[1]) dept = amount('department_only_amount');
  if (type === DUES_TYPES[2]) { school = amount('both_school_amount');dept = amount('both_department_amount'); }
  if (school + dept <= 0) errors.push('No positive collection amount.');
  const dateText = read('collection_date');
  if (dateText && !validIsoDate_(dateText)) errors.push('Invalid collection date.');
  const submitted = submittedAt.toISOString();
  if (dateText && validIsoDate_(dateText) && dateText > submitted.slice(0,10)) errors.push('Collection date is in the future.');
  const confirmation = answers[fields.confirmation];
  if (!Array.isArray(confirmation) || confirmation.indexOf(DUES_ACK) < 0) errors.push('Collection confirmation missing.');
  if (dept > 0 && department && department.dues === 0) flags.push('RATE_CHECK: department rate was unconfigured at form creation.');
  const items = [];
  if (school > 0) items.push({type:'school_dues',amount:school});
  if (dept > 0) items.push({type:'department_dues',amount:dept});
  return {
    source_submission_id: meta.formId + ':' + responseId,
    submitted_at: submitted,paid_at: dateText && validIsoDate_(dateText) ? dateText : submitted,
    academic_year: config.academicYear,department_code: department ? department.code : '',department_name: department ? department.name : '',
    rep_name: read('rep_name'),rep_email: repEmail,rep_class: read('rep_class'),student_name: read('student_name'),student_no: studentNo,email,
    level: read('level'),payment_level: read('payment_level'),method: method || '',payment_reference: read('payment_reference'),
    school_dues: school,department_dues: dept,total_amount: Math.round((school + dept) * 100) / 100,items_json: JSON.stringify(items),
    validation_status: errors.length ? 'INVALID' : 'VALID',validation_notes: errors.join(' | '),review_flags: flags.join(' | '),
    review_status: 'PENDING',receipt_status: 'NOT_ISSUED',email_status: 'NOT_SENT'
  };
}

function prepareQueue_(spreadsheet) {
  const queue = spreadsheet.getSheetByName('Receipt Queue') || spreadsheet.insertSheet('Receipt Queue');
  if (queue.getLastRow() > 0) { assertQueueHeaders_(queue);return; }
  if (queue.getMaxColumns() < DUES_QUEUE_HEADERS.length) queue.insertColumnsAfter(queue.getMaxColumns(), DUES_QUEUE_HEADERS.length - queue.getMaxColumns());
  queue.getRange(1, 1, 1, DUES_QUEUE_HEADERS.length).setValues([DUES_QUEUE_HEADERS]).setFontWeight('bold').setBackground('#0d2063').setFontColor('#ffffff');
  queue.setFrozenRows(1);queue.setColumnWidths(1, DUES_QUEUE_HEADERS.length, 150);
  queue.getRange(1, 1, queue.getMaxRows(), DUES_QUEUE_HEADERS.length).createFilter();
  queue.hideColumns(DUES_QUEUE_HEADERS.indexOf('duplicate_fingerprint') + 1);
}
function assertQueueHeaders_(sheet) {
  if (!sheet || JSON.stringify(sheet.getRange(1,1,1,DUES_QUEUE_HEADERS.length).getValues()[0]) !== JSON.stringify(DUES_QUEUE_HEADERS)) throw new Error('Receipt Queue headers changed. Restore them before processing responses.');
}
function writeSetup_(spreadsheet, meta) {
  const setup = spreadsheet.getSheetByName('Setup & links') || spreadsheet.insertSheet('Setup & links');
  const form = FormApp.openById(meta.formId);
  const rows = [
    ['Course rep form — academic year',meta.config.academicYear],['Form link to share with reps',form.getPublishedUrl()],
    ['Owner edit link — do not share with reps',form.getEditUrl()],['Response spreadsheet',spreadsheet.getUrl()],
    ['Workflow','Raw form responses -> Receipt Queue -> office verification -> later receipt issue/email'],
    ['Review status','Every record starts PENDING. Only an authorised office reviewer should approve it.'],
    ['Receipt/email status','NOT_ISSUED / NOT_SENT. This script never issues receipts or sends email.'],
    ['Google access','Restrict responder access to authorised reps in Google Forms publishing settings. Typed rep emails are not identity verification.'],
    ['PINs','Do not collect or share Dues department PINs in this form. Google Forms does not use the Dues PIN session.'],
    ['Corrections','Reject the wrong queue row and submit a corrected collection. Keep the original for audit.'],
    ['Recovery','If a submission is missing from Receipt Queue, run reconcileDuesResponses. Raw responses remain linked to the form.'],
    ['Partial payments','Allowed. A duplicate warning is for review; it does not delete a possible separate instalment.'],
    ['Department code','Department / configured amount at creation (GHS)']
  ].concat(meta.config.departments.map(d => [d.code,d.name + ' / ' + d.dues.toFixed(2)]));
  setup.getRange(1,1,rows.length,2).setNumberFormat('@').setValues(rows);
  setup.getRange(1,1,1,2).setBackground('#0d2063').setFontColor('#ffffff').setFontWeight('bold');
  setup.setColumnWidth(1,300);setup.setColumnWidth(2,700);setup.getDataRange().setWrap(true);setup.setFrozenRows(1);
}
function ensureSubmitTrigger_(formId) {
  const matches = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'recordDuesSubmission' && t.getTriggerSourceId() === formId);
  matches.slice(1).forEach(t => ScriptApp.deleteTrigger(t));
  if (!matches.length) ScriptApp.newTrigger('recordDuesSubmission').forForm(FormApp.openById(formId)).onFormSubmit().create();
}
function saveMeta_(meta) { PropertiesService.getScriptProperties().setProperty('DUES_META_' + meta.formId, JSON.stringify(meta)); }
function loadMeta_(id) { const value=PropertiesService.getScriptProperties().getProperty('DUES_META_'+id);if(!value)throw new Error('Unknown collection form.');return JSON.parse(value); }
function logLinks_(meta) { const form=FormApp.openById(meta.formId),links={form_url:form.getPublishedUrl(),edit_url:form.getEditUrl(),spreadsheet_url:SpreadsheetApp.openById(meta.spreadsheetId).getUrl()};console.log(JSON.stringify(links,null,2));return links; }
function departmentLabel_(d) { return d.name + ' [' + d.code + ']'; }
function nameRule_() { return FormApp.createTextValidation().requireTextMatchesPattern('^.{2,180}$').setHelpText('Enter 2–180 characters on one line.').build(); }
function emailRule_() { return FormApp.createTextValidation().requireTextIsEmail().setHelpText('Enter a complete email address.').build(); }
function addText_(form, fields, key, title, required, help, rule) { const item=form.addTextItem().setTitle(title).setRequired(required);if(help)item.setHelpText(help);if(rule)item.setValidation(rule);fields[key]=String(item.getId());return item; }
function addAmount_(form, fields, key, title, config) {
  const rule=FormApp.createTextValidation().requireTextMatchesPattern(amountPattern_(config.maxMainDues)).setHelpText('Enter the positive amount received in GHS, using at most two decimal places, within the permitted dues amount.').build();
  return addText_(form,fields,key,title,true,'Partial payment is allowed. Enter only money actually received; do not include the other dues amount.',rule);
}
function amountPattern_(max) {
  const whole=[];for(let n=1;n<max;n++)whole.push(String(n));
  return '^(?:0\\.(?:0[1-9]|[1-9][0-9]?)|(?:'+whole.join('|')+')(?:\\.[0-9]{1,2})?|'+max+'(?:\\.0{1,2})?)$';
}
function validIsoDate_(value) { if(!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00.000Z');return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===value; }
function literalCell_(value) { return typeof value==='string'&&/^[\s]*[=+\-@]/.test(value)?"'"+value:value; }
function hash_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8).map(b=>((b+256)%256).toString(16).padStart(2,'0')).join(''); }
function validateConfig_() {
  if(!/^20\d{2}\/20\d{2}$/.test(DUES_FORM_CONFIG.academicYear)||Number(DUES_FORM_CONFIG.academicYear.slice(5))!==Number(DUES_FORM_CONFIG.academicYear.slice(0,4))+1)throw new Error('Set a consecutive academic year such as 2026/2027.');
  if(!Number.isInteger(DUES_FORM_CONFIG.maxMainDues)||DUES_FORM_CONFIG.maxMainDues<2||DUES_FORM_CONFIG.maxMainDues>1000)throw new Error('Invalid main-dues limit.');
  const departments=DUES_FORM_CONFIG.departments;if(!departments.length||new Set(departments.map(d=>d.code)).size!==departments.length)throw new Error('Department codes must be present and unique.');
  departments.forEach(d=>{if(!d.code||!d.name||!Number.isFinite(d.dues)||d.dues<0)throw new Error('Check department configuration.');});
}
