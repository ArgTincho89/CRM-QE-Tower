// Pure helpers for @mentions in record comments, shared by the API (mention parsing) and the UI
// (autocomplete and safe rendering). A mention is stored in the comment body as the token
// `@[Display name](userId)`; the server decides which ids are real users.

/** Longest display name kept inside a mention token. */
export const MENTION_NAME_MAX_LENGTH = 120;

// `@[name](id)`: the name cannot contain brackets or line breaks, the id is a plain identifier.
const MENTION_TOKEN_SOURCE = String.raw`@\[([^\[\]\r\n]{1,120})\]\(([A-Za-z0-9_-]{1,64})\)`;

function mentionTokenPattern() {
  return new RegExp(MENTION_TOKEN_SOURCE, 'g');
}

/** Display name safe to embed in a token: no brackets or line breaks, trimmed and bounded. */
export function sanitizeMentionName(name) {
  return String(name ?? '')
    .replace(/[\[\]\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MENTION_NAME_MAX_LENGTH) || 'usuario';
}

/** `@[Ada Lovelace](u-1)` for a `{ id, name }` user. */
export function serializeMention(user) {
  return `@[${sanitizeMentionName(user?.name)}](${String(user?.id ?? '')})`;
}

/** Unique user ids mentioned in a body, in order of first appearance. */
export function extractMentionIds(text) {
  if (typeof text !== 'string' || text === '') return [];
  const ids = [];
  for (const match of text.matchAll(mentionTokenPattern())) {
    if (!ids.includes(match[2])) ids.push(match[2]);
  }
  return ids;
}

/** Ids present in `nextIds` but not in `previousIds` (newly added mentions after an edit). */
export function newMentionIds(previousIds, nextIds) {
  const previous = new Set(previousIds || []);
  return (nextIds || []).filter((id) => !previous.has(id));
}

/**
 * Splits a body into text and mention segments so the UI renders it as React nodes (never HTML).
 * With `knownIds`, tokens whose id is not a confirmed mention degrade to plain "@Name" text.
 */
export function parseMentionSegments(text, knownIds = null) {
  if (typeof text !== 'string' || text === '') return [];
  const known = knownIds ? new Set(knownIds) : null;
  const segments = [];
  let cursor = 0;
  const pushText = (value) => {
    if (value === '') return;
    const last = segments[segments.length - 1];
    if (last && last.type === 'text') last.text += value;
    else segments.push({ type: 'text', text: value });
  };
  for (const match of text.matchAll(mentionTokenPattern())) {
    pushText(text.slice(cursor, match.index));
    const [, name, userId] = match;
    if (known && !known.has(userId)) pushText(`@${name}`);
    else segments.push({ type: 'mention', userId, name });
    cursor = match.index + match[0].length;
  }
  pushText(text.slice(cursor));
  return segments;
}

// Characters allowed while typing a mention query: letters (accented too), digits, '.', '_' and '-'.
const QUERY_CHAR = /^[\p{L}\p{N}._-]*$/u;
const MENTION_QUERY_MAX_LENGTH = 40;

/**
 * Detects an "@query" being typed right before the caret. The "@" must start the text or follow
 * whitespace/an opening punctuation mark (so e-mail addresses do not trigger it).
 * Returns `{ start, query }` (start = index of "@") or null.
 */
export function detectMentionQuery(text, caret) {
  if (typeof text !== 'string') return null;
  const end = Number.isInteger(caret) ? Math.min(Math.max(caret, 0), text.length) : text.length;
  const start = text.lastIndexOf('@', end - 1);
  if (start === -1) return null;
  const query = text.slice(start + 1, end);
  if (query.length > MENTION_QUERY_MAX_LENGTH || !QUERY_CHAR.test(query)) return null;
  const before = start === 0 ? '' : text[start - 1];
  if (before !== '' && !/[\s([{"'¿¡]/u.test(before)) return null;
  return { start, query };
}

/** Lowercase, accent-free form used to match names. */
export function normalizeMentionText(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Users whose name matches the query (accent and case insensitive). Names that start with the
 * query, or have a word that does, come first; then other substring matches. Keeps input order
 * within each group, skips `excludeId` and returns at most `limit` users.
 */
export function filterMentionCandidates(users, query, { limit = 8, excludeId = '' } = {}) {
  const needle = normalizeMentionText(query).trim();
  const prefix = [];
  const contains = [];
  for (const user of users || []) {
    if (!user || !user.id || user.id === excludeId) continue;
    const name = normalizeMentionText(user.name);
    if (needle === '' || name.startsWith(needle) || name.split(/\s+/).some((word) => word.startsWith(needle))) prefix.push(user);
    else if (name.includes(needle)) contains.push(user);
  }
  return [...prefix, ...contains].slice(0, Math.max(0, limit));
}

/**
 * Replaces the "@query" typed between `start` and `caret` with the user's token plus a space.
 * Returns the new text and the caret position right after the inserted token.
 */
export function insertMention(text, { start, caret }, user) {
  const source = typeof text === 'string' ? text : '';
  const end = Number.isInteger(caret) ? caret : source.length;
  const token = `${serializeMention(user)} `;
  const after = source.slice(end);
  const insertion = after.startsWith(' ') ? token.slice(0, -1) : token;
  const next = `${source.slice(0, start)}${insertion}${after}`;
  return { text: next, caret: start + token.length };
}
