import { ALL_YEARS, normalizeYearSelection } from './pipelineMetrics.js';
import { DEFAULT_MASTER_DATA_TAB, DEFAULT_PEOPLE_TAB, DEFAULT_PROJECT_TAB, DEFAULT_REPORT_TAB, DEFAULT_TRAINING_TAB, isMasterDataTab, isPeopleTab, isProjectTab, isReportTab, isTrainingTab } from './navigation.js';

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

export const MASTER_DATA_TAB_STORAGE_KEY = 'crm.masterData.tab';

/** Last tab opened in "Datos Maestros"; unknown or missing values fall back to the first tab. */
export function loadMasterDataTab(storage = defaultPreferenceStorage()) {
  const saved = readItem(MASTER_DATA_TAB_STORAGE_KEY, storage);
  return isMasterDataTab(saved) ? saved : DEFAULT_MASTER_DATA_TAB;
}

export function saveMasterDataTab(tabId, storage = defaultPreferenceStorage()) {
  if (!isMasterDataTab(tabId)) return false;
  return writeItem(MASTER_DATA_TAB_STORAGE_KEY, tabId, storage);
}

export const PEOPLE_TAB_STORAGE_KEY = 'crm.people.tab';
export const TRAINING_TAB_STORAGE_KEY = 'crm.people.trainingTab';

/** Last tab opened in "People"; unknown or missing values fall back to the first tab. */
export function loadPeopleTab(storage = defaultPreferenceStorage()) {
  const saved = readItem(PEOPLE_TAB_STORAGE_KEY, storage);
  return isPeopleTab(saved) ? saved : DEFAULT_PEOPLE_TAB;
}

export function savePeopleTab(tabId, storage = defaultPreferenceStorage()) {
  if (!isPeopleTab(tabId)) return false;
  return writeItem(PEOPLE_TAB_STORAGE_KEY, tabId, storage);
}

/** Last sub-tab opened in People > Formación. */
export function loadTrainingTab(storage = defaultPreferenceStorage()) {
  const saved = readItem(TRAINING_TAB_STORAGE_KEY, storage);
  return isTrainingTab(saved) ? saved : DEFAULT_TRAINING_TAB;
}

export function saveTrainingTab(tabId, storage = defaultPreferenceStorage()) {
  if (!isTrainingTab(tabId)) return false;
  return writeItem(TRAINING_TAB_STORAGE_KEY, tabId, storage);
}

export const PROJECT_TAB_STORAGE_KEY = 'crm.projects.tab';
export const REPORT_TAB_STORAGE_KEY = 'crm.reports.tab';

/** Last tab opened in "Proyectos"; unknown or missing values fall back to the first tab. */
export function loadProjectTab(storage = defaultPreferenceStorage()) {
  const saved = readItem(PROJECT_TAB_STORAGE_KEY, storage);
  return isProjectTab(saved) ? saved : DEFAULT_PROJECT_TAB;
}

export function saveProjectTab(tabId, storage = defaultPreferenceStorage()) {
  if (!isProjectTab(tabId)) return false;
  return writeItem(PROJECT_TAB_STORAGE_KEY, tabId, storage);
}

/** Last tab opened in "Informes"; unknown or missing values fall back to the first tab. */
export function loadReportTab(storage = defaultPreferenceStorage()) {
  const saved = readItem(REPORT_TAB_STORAGE_KEY, storage);
  return isReportTab(saved) ? saved : DEFAULT_REPORT_TAB;
}

export function saveReportTab(tabId, storage = defaultPreferenceStorage()) {
  if (!isReportTab(tabId)) return false;
  return writeItem(REPORT_TAB_STORAGE_KEY, tabId, storage);
}
