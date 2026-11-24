/** Paste into a NEW Apps Script project. Run createBasicDuesForm. */
function createBasicDuesForm() {
  var properties = PropertiesService.getScriptProperties();
  var existingId = properties.getProperty('BASIC_DUES_FORM_ID');
  var form;
  if (existingId) {
    form = FormApp.openById(existingId);
  } else {
    form = FormApp.create('School of Sciences — Dues Collection');
    form.setDescription('For course representatives recording dues already received. Submit once for each student collection. Academic year: 2026/2027. Receipts will be issued later to the student email provided.');
    form.setConfirmationMessage('Collection recorded. Please submit another response only for a different collection.');
    form.setCollectEmail(false);
    form.setLimitOneResponsePerUser(false);
    form.setPublishingSummary(false);
    form.setShowLinkToRespondAgain(true);

    var emailRule = FormApp.createTextValidation().requireTextIsEmail()
      .setHelpText('Enter a valid email address.').build();
    var amountRule = FormApp.createTextValidation()
      .requireTextMatchesPattern('^(?:0\\.(?:0[1-9]|[1-9][0-9]?)|[1-9][0-9]*(?:\\.[0-9]{1,2})?)$')
      .setHelpText('Enter a positive amount, for example 50 or 20.50.').build();

    form.addTextItem().setTitle('Course rep full name').setRequired(true);
    form.addTextItem().setTitle('Course rep email').setValidation(emailRule).setRequired(true);
    form.addListItem().setTitle('Department').setChoiceValues([
      'Actuarial Science', 'Biological Sciences', 'Chemical Sciences',
      'Computer Science and Informatics',
      'Information Technology and Decision Sciences', 'Mathematics',
      'Medical Laboratory Science', 'Nursing', 'Statistics'
    ]).setRequired(true);
    form.addTextItem().setTitle('Programme / class').setHelpText('For example: BSc Computer Science, Level 200.').setRequired(true);
    form.addTextItem().setTitle('Student full name').setRequired(true);
    form.addTextItem().setTitle('Student / index number').setRequired(true);
    form.addTextItem().setTitle('Student email for receipt')
      .setHelpText('Check this address with the student. The receipt will be sent here, not to the course rep.')
      .setValidation(emailRule).setRequired(true);
    form.addListItem().setTitle('Student current level')
      .setChoiceValues(['100','200','300','400']).setRequired(true);
    form.addListItem().setTitle('Level being paid for')
      .setHelpText('For arrears, this may differ from the current level.')
      .setChoiceValues(['100','200','300','400']).setRequired(true);
    form.addTextItem().setTitle('School dues received (GHS)')
      .setHelpText('Leave blank if no school dues were collected. Enter only the amount received; partial payments are allowed.')
      .setValidation(amountRule).setRequired(false);
    form.addTextItem().setTitle('Department dues received (GHS)')
      .setHelpText('Leave blank if no department dues were collected. Enter only the amount received; partial payments are allowed.')
      .setValidation(amountRule).setRequired(false);
    form.addMultipleChoiceItem().setTitle('Payment method')
      .setChoiceValues(['Cash','Mobile money']).setRequired(true);
    form.addTextItem().setTitle('Payment reference (optional)').setRequired(false);
    form.addCheckboxItem().setTitle('Confirm collection')
      .setChoiceValues(['I received the money, entered an amount in at least one dues field, and checked the student details and email.'])
      .setRequired(true);

    var spreadsheet = SpreadsheetApp.create('School of Sciences — Dues Collections 2026-2027');
    spreadsheet.setSpreadsheetTimeZone('Africa/Accra');
    // Assign directly: do not query a destination that does not yet exist.
    form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheet.getId());
    properties.setProperty('BASIC_DUES_FORM_ID', form.getId());
    properties.setProperty('BASIC_DUES_SHEET_ID', spreadsheet.getId());
  }
  if (form.supportsAdvancedResponderPermissions()) form.setPublished(true);
  form.setAcceptingResponses(true);
  console.log('FORM LINK FOR COURSE REPS: ' + form.getPublishedUrl());
  console.log('PRIVATE EDIT LINK: ' + form.getEditUrl());
  console.log('PRIVATE RESPONSE SHEET: https://docs.google.com/spreadsheets/d/' + properties.getProperty('BASIC_DUES_SHEET_ID') + '/edit');
}
