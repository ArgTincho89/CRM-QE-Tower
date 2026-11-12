/**
 * Prefixed six-digit identifiers for the commercial entities (`OP-000001`, `IN-000001`,
 * `AM-000001`). Numbers never wrap: past ID_NUMBER_MAX generation fails loudly.
 */
export const ID_DIGITS = 6;
export const ID_NUMBER_MAX = 999999;

export const OPPORTUNITY_ID_PREFIX = 'OP';
export const INITIATIVE_ID_PREFIX = 'IN';
export const AGREEMENT_ID_PREFIX = 'AM';

export class IdSpaceExhaustedError extends Error {
  constructor(prefix) {
    super(`No free ${prefix} identifier is left (maximum ${ID_NUMBER_MAX}).`);
    this.name = 'IdSpaceExhaustedError';
    this.code = 'id_generation_failed';
  }
}

/** `formatPrefixedId('OP', 7)` → `OP-000007`. Throws outside 1..ID_NUMBER_MAX. */
export function formatPrefixedId(prefix, number) {
  if (!Number.isInteger(number) || number < 1) throw new RangeError(`Invalid ${prefix} id number: ${number}`);
  if (number > ID_NUMBER_MAX) throw new IdSpaceExhaustedError(prefix);
  return `${prefix}-${String(number).padStart(ID_DIGITS, '0')}`;
}

/** True when `id` already has the final `PREFIX-NNNNNN` shape. */
export function isPrefixedId(prefix, id) {
  return new RegExp(`^${prefix}-\\d{${ID_DIGITS}}$`).test(String(id ?? ''));
}

/**
 * Next free id for `table`: one past the highest stored number. Every candidate is re-checked,
 * and callers retry the whole insert on a unique violation (two processes on the same file).
 */
export function nextPrefixedId(db, table, prefix) {
  const row = db
    .prepare(`SELECT MAX(CAST(substr(id, ${prefix.length + 2}) AS INTEGER)) AS max_id FROM ${table} WHERE id GLOB '${prefix}-[0-9]*'`)
    .get();
  const highest = Number(row?.max_id ?? 0);
  const start = Number.isFinite(highest) && highest > 0 ? highest : 0;
  const exists = db.prepare(`SELECT 1 AS found FROM ${table} WHERE id = ?`);
  for (let number = start + 1; number <= ID_NUMBER_MAX; number += 1) {
    const candidate = formatPrefixedId(prefix, number);
    if (!exists.get(candidate)) return candidate;
  }
  throw new IdSpaceExhaustedError(prefix);
}

/**
 * Plans the rename of existing ids to the six-digit format. Returns a Map old → new holding
 * only ids that change.
 *
 * - `PREFIX-NNNNNN` ids keep their number (reserved first, unchanged).
 * - Legacy `PREFIX-NNNN` ids keep their number (`OP-0001` → `OP-000001`) when it is still free.
 * - Every other id (other prefixes, UUIDs, number 0, a number already taken) gets the next free
 *   number after the highest reserved one, in `created_at`, then id, order.
 */
export function planIdRename(rows, prefix) {
  const ordered = [...rows].sort((a, b) => compareText(a.created_at, b.created_at) || compareText(a.id, b.id));
  const legacyPattern = new RegExp(`^${prefix}-(\\d{4})$`);
  const finalIds = ordered.filter((row) => isPrefixedId(prefix, row.id));
  const taken = new Set(finalIds.map((row) => Number(row.id.slice(prefix.length + 1))));
  const rename = new Map();
  const leftovers = [];
  for (const row of ordered) {
    if (isPrefixedId(prefix, row.id)) continue;
    const match = legacyPattern.exec(row.id);
    const number = match ? Number(match[1]) : 0;
    if (number > 0 && !taken.has(number)) {
      taken.add(number);
      rename.set(row.id, formatPrefixedId(prefix, number));
    } else {
      leftovers.push(row);
    }
  }
  let next = 1;
  for (const number of taken) if (number >= next) next = number + 1;
  for (const row of leftovers) {
    rename.set(row.id, formatPrefixedId(prefix, next));
    next += 1;
  }
  return rename;
}

function compareText(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  return left < right ? -1 : left > right ? 1 : 0;
}
