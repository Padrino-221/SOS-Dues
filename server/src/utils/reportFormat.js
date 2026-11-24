// Shared formatting for filtered reports — the on-page payments table, the
// CSV export and the PDF export all show the same title and the same five
// columns (Name, Reference, Programme, Amount, Date). The title is the
// "name of the filtered report": it heads the excel cells (first row) and
// drives the download filename.

const METHOD_LABELS = { cash: 'Cash', momo: 'Mobile Money' };

// e.g. "Computer Science — Level 200 — Cash — 2026/2027 — 2026-10-01 to 2026-10-31".
// Unfiltered axes fall back to their "All …" label so the row always reads as
// a report name even before anything is picked.
function reportTitle({ departmentName, level, method, academicYear, from, to } = {}) {
  const parts = [
    departmentName ? String(departmentName) : 'All Departments',
    level ? `Level ${level}` : 'All Levels',
    method ? METHOD_LABELS[method] || String(method) : 'All Methods',
  ];
  if (academicYear) parts.push(String(academicYear));
  if (from && to) parts.push(`${from} to ${to}`);
  else if (from) parts.push(`from ${from}`);
  else if (to) parts.push(`to ${to}`);
  return parts.join(' — ');
}

// Filename-safe slug of a title: "dues-report-computer-science-level-200".
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const str = String(v);
  return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

function buildCsvReport(title, rows) {
  return '\uFEFF' + [
    csvEscape(title),
    'Name,Reference,Programme,Amount,Date',
    ...rows.map((row) =>
      [row.name, row.reference, row.programme, row.amount, row.date].map(csvEscape).join(',')
    ),
  ].join('\n');
}

module.exports = { METHOD_LABELS, reportTitle, slugify, csvEscape, buildCsvReport };
