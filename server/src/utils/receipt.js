const crypto = require('crypto');

function generateReceiptNumber(type = 'DUES') {
  const base = type.toUpperCase();
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  const ts = Date.now().toString(36).toUpperCase();
  return `UENR-${base}-${ts}-${rand}`;
}

module.exports = { generateReceiptNumber };
