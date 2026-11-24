// Gender-scoped "Other Dues" helpers shared by every picker/edit surface.
// Item gender is 'any' | 'male' | 'female' (server-normalized); people carry
// 'Female' / 'Male' / 'Other' in any case. 'Other' or blank never constrains.
//
// Returns e.g. 'female-only' when the item's scope doesn't match the person —
// or null when it does (or neither side declares a gender).

export function genderScopeNote(itemGender, personGender) {
  const ig = String(itemGender || '').toLowerCase();
  if (ig !== 'male' && ig !== 'female') return null;
  const pg = String(personGender || '').toLowerCase();
  if (pg !== 'male' && pg !== 'female') return null;
  if (ig === pg) return null;
  return `${ig}-only`;
}
