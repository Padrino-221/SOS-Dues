const { test } = require('node:test');
const assert = require('node:assert/strict');
const { courseRepInvitation } = require('../src/utils/courseRepInvitation');

test('course rep invitation includes the department code, one-time setup and separate sign-in link', () => {
  const mail = courseRepInvitation({ name: 'Ama Mensah', email: 'ama@example.test', department: 'Statistics', code: 'STATI-BF04', token: 'a'.repeat(64), baseUrl: 'https://dues.sosuenr.com' });
  for (const body of [mail.text, mail.html]) {
    assert.match(body, /STATI-BF04/);
    assert.match(body, /Statistics/);
    assert.match(body, /ama@example.test/);
    assert.match(body, /48 hours/);
    assert.match(body, /12 characters/);
    assert.match(body, /https:\/\/dues.sosuenr.com\/rep\/STATI-BF04#invite=a{64}/);
  }
  assert.match(mail.html, /href="https:\/\/dues.sosuenr.com\/rep\/STATI-BF04"/);
});

test('invitation safely escapes imported names and department text', () => {
  const mail = courseRepInvitation({ name: '<script>x</script>', department: 'Science & IT', email: 'a@example.test', code: 'ITDS', token: 'abc' });
  assert.doesNotMatch(mail.html, /<script>/);
  assert.match(mail.html, /&lt;script&gt;/);
  assert.match(mail.html, /Science &amp; IT/);
});
