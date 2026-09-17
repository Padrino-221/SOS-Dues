// Souvenir helpers.

// Names of the souvenirs handed out under a given receipt, in a stable order.
// Used to include the souvenirs in the receipt email. Returns [] when the
// receipt had no souvenirs, so callers can omit the section entirely.
async function getSouvenirNames(db, receiptId) {
  if (!receiptId) return [];
  const { rows } = await db.query(
    `SELECT so.name
     FROM student_souvenirs ss
     JOIN souvenirs so ON so.id = ss.souvenir_id
     WHERE ss.receipt_id = $1
     ORDER BY so.name`,
    [receiptId]
  );
  return rows.map((r) => r.name);
}

module.exports = { getSouvenirNames };
