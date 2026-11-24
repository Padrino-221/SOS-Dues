/**
 * Coerce unknown API payloads to an array.
 * Guards every `.map/.filter/.slice/.reduce` call site against the server
 * returning an object (e.g. a paginated `{ receipts, total }` wrapper),
 * null, or anything else that is not a list. Shows an empty list instead of
 * crashing the page with "n.map is not a function".
 */
export const asArray = (v) => (Array.isArray(v) ? v : []);
