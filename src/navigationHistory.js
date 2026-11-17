import { PAGE_ITEMS, isMasterDataTab, resolveNavigationTarget } from './navigation.js';
import { VIEW_MODES } from './preferences.js';

// Browser history integration. Every in-app navigation becomes one entry of `window.history`
// carrying the page, the pipeline view and the active filters, so Back and Forward restore the
// previous screen exactly. The URL hash mirrors the page (`#/talents`) to keep the location
// shareable and reloadable.

/** Key of the navigation payload inside `window.history.state`. */
export const NAVIGATION_STATE_KEY = 'crmNavigation';
export const DEFAULT_NAVIGATION_PAGE = 'pipeline';
const PAGE_IDS = new Set(PAGE_ITEMS.map((item) => item.id));

/** True when the id opens an in-app page (sidebar page, master data or an internal document). */
export function isKnownPage(pageId) {
  return typeof pageId === 'string' && PAGE_IDS.has(pageId);
}

/** Usable page id, falling back to the pipeline for unknown or external ids. */
export function normalizePageId(pageId) {
  return isKnownPage(pageId) ? pageId : DEFAULT_NAVIGATION_PAGE;
}

/** Hash of a page: `#/pipeline`. */
export function navigationHash(pageId) {
  return `#/${normalizePageId(pageId)}`;
}

/** Page id of a location hash, or null when the hash does not name an in-app page. */
export function parseNavigationHash(hash) {
  if (typeof hash !== 'string') return null;
  const match = /^#\/([A-Za-z0-9-]+)$/.exec(hash.trim());
  if (!match) return null;
  return isKnownPage(match[1]) ? match[1] : null;
}

/**
 * Normalizes one history entry: `{ page, view, tab, filters, query, depth }`.
 * `view`, `filters` and `query` only make sense on the pipeline, `tab` only on Datos Maestros;
 * retired page ids resolve to their new home (and the tab it opens).
 */
export function createNavigationEntry({ page, view = null, tab = null, filters = null, query = '', depth = 0 } = {}) {
  const target = resolveNavigationTarget(page);
  const entryPage = target.page;
  const resolvedTab = entryPage === 'masterData' ? (isMasterDataTab(tab) ? tab : target.tab) : null;
  return {
    page: entryPage,
    view: entryPage === 'pipeline' && VIEW_MODES.includes(view) ? view : (entryPage === 'pipeline' ? target.view : null),
    tab: resolvedTab || null,
    filters: entryPage === 'pipeline' && filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : null,
    query: entryPage === 'pipeline' && typeof query === 'string' ? query : '',
    depth: Number.isInteger(depth) && depth > 0 ? depth : 0,
  };
}

/** `window.history.state` payload of one navigation entry. */
export function navigationState(entry) {
  return { [NAVIGATION_STATE_KEY]: createNavigationEntry(entry) };
}

/** Navigation entry stored in a `window.history.state`, or null for foreign entries. */
export function parseNavigationState(state) {
  if (!state || typeof state !== 'object') return null;
  const raw = state[NAVIGATION_STATE_KEY];
  if (!raw || typeof raw !== 'object' || !isKnownPage(raw.page)) return null;
  return createNavigationEntry({ page: raw.page, view: raw.view, tab: raw.tab, filters: raw.filters, query: raw.query, depth: raw.depth });
}

/**
 * Entry to show on load: the one already saved in `history.state` (a reload), else the page named
 * by the URL hash (a shared link), else the fallback page as the first entry of the session.
 */
export function readNavigationEntry({ state = null, hash = '', fallbackPage = DEFAULT_NAVIGATION_PAGE } = {}) {
  const saved = parseNavigationState(state);
  if (saved) return saved;
  return createNavigationEntry({ page: parseNavigationHash(hash) || fallbackPage, depth: 0 });
}

/** True when at least one in-app page was pushed before the current one. */
export function canNavigateBack(entry) {
  return Boolean(entry) && Number.isInteger(entry.depth) && entry.depth > 0;
}
