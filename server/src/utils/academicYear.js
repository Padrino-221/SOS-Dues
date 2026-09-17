function normalizeAcademicYear(value) {
  if (!value && value !== 0) return null;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    if (/^\d{4}\/\d{4}$/.test(raw)) return raw;
    if (/^\d{4}-\d{4}$/.test(raw)) return raw.replace('-', '/');
    if (/^\d{4}$/.test(raw)) {
      const year = Number(raw);
      return `${year}/${year + 1}`;
    }
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}/${value + 1}`;
  }
  return null;
}

function resolveAcademicYear(value) {
  const normalized = normalizeAcademicYear(value);
  if (normalized) return normalized;

  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime()))
    return `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`;

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return month >= 9 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

async function getActiveAcademicYear(db) {
  const { rows } = await db.query("SELECT value FROM settings WHERE key = 'active_academic_year'");
  return normalizeAcademicYear(rows[0]?.value) || resolveAcademicYear();
}

module.exports = { normalizeAcademicYear, resolveAcademicYear, getActiveAcademicYear };
