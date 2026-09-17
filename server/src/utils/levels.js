// Program levels a student advances through each academic year.
const LEVELS = ['100', '200', '300', '400'];

const LEVEL_LABELS = {
  100: 'Level 100',
  200: 'Level 200',
  300: 'Level 300',
  400: 'Level 400',
};

// Normalize an arbitrary level input to a canonical value, or null if invalid.
// Handles '100', 'Level 100', 100, etc.
function normalizeLevel(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const digits = text.match(/\d+/)?.[0] || '';
  return LEVELS.includes(digits) ? digits : null;
}

// The level a student moves to at the start of a new academic year, or null if
// the student remains at their current level (e.g. already at the final level).
function nextLevel(current) {
  const idx = LEVELS.indexOf(normalizeLevel(current));
  if (idx < 0 || idx === LEVELS.length - 1) return null;
  return LEVELS[idx + 1];
}

module.exports = { LEVELS, LEVEL_LABELS, normalizeLevel, nextLevel };
