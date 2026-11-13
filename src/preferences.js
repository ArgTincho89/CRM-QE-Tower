import { ALL_YEARS, normalizeYearSelection } from './pipelineMetrics.js';

// Per-browser UI preferences. Storage can be missing or throw (private mode, blocked site
// data), so every read falls back to a default and every write reports success as a boolean.

export const VIEW_MODES = ['kanban', 'list', 'table'];
export const DEFAULT_VIEW_MODE = 'kanban';
const VIEW_STORAGE_PREFIX = 'crm.view.';
export const PIPELINE_YEAR_STORAGE_KEY = 'crm.pipeline.year';

/** Browser storage, or null when it is unavailable. */
export function defaultPreferenceStorage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readItem(key, storage) {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key, value, storage) {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function viewStorageKey(pageId) {
  return `${VIEW_STORAGE_PREFIX}${pageId}`;
}

/** Saved view mode (Kanban / Lista / Tabla) of a page; unknown values fall back to Kanban. */
export function loadViewMode(pageId, storage = defaultPreferenceStorage()) {
  const saved = readItem(viewStorageKey(pageId), storage);
  return VIEW_MODES.includes(saved) ? saved : DEFAULT_VIEW_MODE;
}

export function saveViewMode(pageId, view, storage = defaultPreferenceStorage()) {
  if (!VIEW_MODES.includes(view)) return false;
  return writeItem(viewStorageKey(pageId), view, storage);
}

/** Saved CRM QE year (a number or ALL_YEARS); defaults to the current year. */
export function loadPipelineYear(currentYear, storage = defaultPreferenceStorage()) {
  const saved = normalizeYearSelection(readItem(PIPELINE_YEAR_STORAGE_KEY, storage));
  return saved === null ? currentYear : saved;
}

export function savePipelineYear(year, storage = defaultPreferenceStorage()) {
  const value = normalizeYearSelection(year);
  if (value === null) return false;
  return writeItem(PIPELINE_YEAR_STORAGE_KEY, value === ALL_YEARS ? ALL_YEARS : String(value), storage);
}
