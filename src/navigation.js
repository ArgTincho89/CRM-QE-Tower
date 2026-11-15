import { createDefaultAdvancedFilters } from './pipelineFilters.js';

// Sidebar navigation. Page ids are stable routes; only order and grouping live here.
export const NAV_GROUPS = [
  {
    id: 'operations',
    label: '',
    items: [
      { id: 'home', label: 'Inicio', icon: 'home' },
      { id: 'pipeline', label: 'CRM QE', icon: 'briefcase' },
      { id: 'initiatives', label: 'Iniciativas', icon: 'share' },
      { id: 'crossSelling', label: 'Cross-Selling', icon: 'share' },
      { id: 'agreements', label: 'Acuerdos Marco', icon: 'layers' },
      { id: 'calendar', label: 'Calendario', icon: 'calendar' },
      { id: 'analytics', label: 'Informes', icon: 'chart' },
      { id: 'settings', label: 'Configuración', icon: 'settings' },
      { id: 'proposals', label: 'Propuestas / Estimaciones', icon: 'file' },
    ],
  },
  {
    id: 'masterData',
    label: 'Datos maestros',
    items: [
      { id: 'clients', label: 'Clientes', icon: 'users' },
      { id: 'lobs', label: 'LoB', icon: 'grid' },
      { id: 'towers', label: 'Towers', icon: 'grid' },
      { id: 'people', label: 'Responsables', icon: 'users' },
      { id: 'services', label: 'Servicios', icon: 'layers' },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

// Retired page ids and where they live now. The Oportunidades page became the "Tabla" view of
// CRM QE, so links, notifications and saved state that still name it land there.
export const PAGE_REDIRECTS = {
  opportunities: { page: 'pipeline', view: 'table' },
};

/** Toolbar filters of the CRM QE page that a navigation filter payload may set. */
export const PIPELINE_TOOLBAR_FILTER_KEYS = ['stage', 'tower', 'owner'];

/**
 * Turns a filter payload (e.g. `{ outcome: 'won' }` from a clickable report metric) into the
 * complete CRM QE filter state: `toolbar` (stage, tower and owner selects) and `advanced` (every
 * advanced filter). Keys outside both sets, empty strings and non-string values are ignored;
 * everything not named keeps its default, so the destination never inherits stale filters.
 */
export function buildPipelineNavigationFilters(payload = {}) {
  const toolbar = { stage: 'all', tower: 'all', owner: 'all' };
  const advanced = createDefaultAdvancedFilters();
  for (const [key, value] of Object.entries(payload || {})) {
    if (typeof value !== 'string' || value === '') continue;
    if (PIPELINE_TOOLBAR_FILTER_KEYS.includes(key)) toolbar[key] = value;
    else if (Object.hasOwn(advanced, key)) advanced[key] = value;
  }
  return { toolbar, advanced };
}

/**
 * Resolves a requested page id to the page to show and, when the destination dictates one,
 * the view mode to select (`view` is null otherwise). Unknown ids fall back to the pipeline.
 *
 * With a `filters` payload the result also carries `filters`: the CRM QE filter state to apply
 * (see buildPipelineNavigationFilters), and a filtered pipeline opens in the "Tabla" view unless
 * a redirect names another one. Other pages have no filterable list, so their `filters` is null.
 */
export function resolveNavigationTarget(pageId, filters = null) {
  let target;
  if (PAGE_REDIRECTS[pageId]) target = { ...PAGE_REDIRECTS[pageId] };
  else if (NAV_ITEMS.some((item) => item.id === pageId)) target = { page: pageId, view: null };
  else target = { page: 'pipeline', view: null };
  if (filters === null || filters === undefined) return target;
  if (target.page !== 'pipeline') return { ...target, filters: null };
  return { page: target.page, view: target.view || 'table', filters: buildPipelineNavigationFilters(filters) };
}
