import { createDefaultAdvancedFilters } from './pipelineFilters.js';

// Sidebar navigation. Page ids are stable routes; only order and grouping live here.
export const NAV_GROUPS = [
  {
    id: 'operations',
    label: '',
    items: [
      { id: 'home', label: 'Inicio', icon: 'home' },
      { id: 'initiatives', label: 'Iniciativas', icon: 'share' },
      { id: 'pipeline', label: 'Oportunidades', icon: 'briefcase' },
      { id: 'crossSelling', label: 'Cross-Selling', icon: 'share' },
      { id: 'agreements', label: 'Acuerdos Marco', icon: 'layers' },
      { id: 'calendar', label: 'Calendario', icon: 'calendar' },
      // "People" uses the `talents` id: `people` is the former "Responsables" page (a Datos Maestros tab).
      { id: 'talents', label: 'People', icon: 'users' },
      { id: 'projects', label: 'Proyectos', icon: 'layers' },
      { id: 'analytics', label: 'Informes', icon: 'chart' },
      { id: 'proposals', label: 'Propuestas / Estimaciones', icon: 'file' },
    ],
  },
  {
    id: 'masterData',
    label: '',
    items: [
      { id: 'masterData', label: 'Datos Maestros', icon: 'grid' },
    ],
  },
  {
    id: 'resources',
    label: '',
    items: [
      { id: 'resources', label: 'Recursos', icon: 'book' },
    ],
  },
  // The account page sits at the bottom of the menu, after every work section.
  {
    id: 'account',
    label: '',
    items: [
      { id: 'settings', label: 'Configuración', icon: 'settings' },
    ],
  },
];

/**
 * Links listed inside the "Recursos" page, in display order. External entries (`href`) open in a
 * new tab; internal documents (`resource`) open in-app.
 */
export const RESOURCE_LINKS = [
  { id: 'sharepointQaSolTech', label: 'SharePoint QA Sol&Tech', icon: 'external', href: 'https://seidor.sharepoint.com/teams/QASolTech/SitePages/Home.aspx' },
  { id: 'qaAcceleratorsDemos', label: 'QA-Aceleradores-Demos', icon: 'external', href: 'https://seidor-my.sharepoint.com/:f:/r/personal/jgonzalez24_seidor_es/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fjgonzalez24%5Fseidor%5Fes%2FDocuments%2F01%2E%20QA%20%2D%20Quality%20Assurance%20Drive%2F99%2E%20SEIDOR%2F00%2E%20QE%20Tower%20Core%2F03%2E%20Aceleradores%20%2D%20Demos%2F01%2E%20QA%2DAceleradores%2DDemos&share=cgpB9Mi1maZqRZbK6VUMHsPkEgUDWZYwmdcEWVCpSUcYiuKjDg' },
  { id: 'resource-normativa-calidad', label: 'Normativa de calidad', icon: 'book', resource: '/resources/normativa-calidad.html' },
  { id: 'resource-quality-gates', label: 'Modelo de gobernanza de Quality Gates', icon: 'book', resource: '/resources/quality-gates.html' },
  { id: 'resource-agentic-quality-engineering', label: 'Agentic Quality Engineering', icon: 'book', resource: '/resources/agentic-quality-engineering.html' },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

/**
 * Menu entries that open an in-app page: sidebar pages plus the internal documents reachable from
 * the "Recursos" list. External links (`href`) are not pages.
 */
export const PAGE_ITEMS = [...NAV_ITEMS.filter((item) => !item.href), ...RESOURCE_LINKS.filter((item) => item.resource)];

/** Internal documents shown inside the app, by page id. */
export const RESOURCE_PAGES = Object.fromEntries(RESOURCE_LINKS.filter((item) => item.resource).map((item) => [item.id, item]));

/** Tabs of the "Datos Maestros" page, in display order. Tab ids are the former page ids. */
export const MASTER_DATA_TABS = [
  { id: 'clients', label: 'Clientes' },
  { id: 'lobs', label: 'LoB' },
  { id: 'towers', label: 'Towers' },
  { id: 'people', label: 'Responsables' },
  { id: 'services', label: 'Servicios' },
];
export const DEFAULT_MASTER_DATA_TAB = MASTER_DATA_TABS[0].id;

export function isMasterDataTab(tabId) {
  return MASTER_DATA_TABS.some((tab) => tab.id === tabId);
}

/** Tabs of the "People" page, in display order. */
export const PEOPLE_TABS = [
  { id: 'talentList', label: 'Listado de personas' },
  { id: 'talentSkills', label: 'Skills x talento' },
  { id: 'activityCatalog', label: 'Catálogo de actividades por niveles' },
  { id: 'assignments', label: 'Asignaciones' },
  { id: 'training', label: 'Formación' },
  { id: 'performanceReview', label: 'Performance review' },
];
export const DEFAULT_PEOPLE_TAB = PEOPLE_TABS[0].id;

/** Sub-tabs of People > Formación. */
export const TRAINING_TABS = [
  { id: 'trainingCatalog', label: 'Catálogo de formación' },
  { id: 'trainingPlan', label: 'Plan de formación' },
  { id: 'talentCertifications', label: 'Certificaciones x talento' },
  { id: 'trainingStrategy', label: 'Estrategia de formación' },
];
export const DEFAULT_TRAINING_TAB = TRAINING_TABS[0].id;

export function isPeopleTab(tabId) {
  return PEOPLE_TABS.some((tab) => tab.id === tabId);
}

export function isTrainingTab(tabId) {
  return TRAINING_TABS.some((tab) => tab.id === tabId);
}

/** Tabs of the "Proyectos" page, in display order. */
export const PROJECT_TABS = [
  { id: 'naqPortfolio', label: 'QE - NAQ Application Portfolio' },
  { id: 'deliveryProjects', label: 'Proyectos' },
];
export const DEFAULT_PROJECT_TAB = PROJECT_TABS[0].id;

export function isProjectTab(tabId) {
  return PROJECT_TABS.some((tab) => tab.id === tabId);
}

/** Tabs of the "Informes" page, in display order. */
export const REPORT_TABS = [
  { id: 'summary', label: 'Resumen actual' },
  { id: 'monthly', label: 'Evolución mensual' },
  { id: 'monthlyReport', label: 'Informe mensual' },
  { id: 'initiatives', label: 'Iniciativas' },
  { id: 'agreements', label: 'Acuerdos Marco' },
  { id: 'people', label: 'People' },
  { id: 'training', label: 'Formación' },
  { id: 'projects', label: 'Proyectos' },
];
export const DEFAULT_REPORT_TAB = REPORT_TABS[0].id;

export function isReportTab(tabId) {
  return REPORT_TABS.some((tab) => tab.id === tabId);
}

// Retired page ids and where they live now. The Oportunidades page became the "Tabla" view of
// CRM QE, so links, notifications and saved state that still name it land there. The master data
// pages became tabs of "Datos Maestros", so their ids open that page on the matching tab.
export const PAGE_REDIRECTS = {
  opportunities: { page: 'pipeline', view: 'table' },
  ...Object.fromEntries(MASTER_DATA_TABS.map((tab) => [tab.id, { page: 'masterData', view: null, tab: tab.id }])),
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
 * the view mode to select (`view` is null otherwise). Unknown ids, and external links, fall back
 * to the pipeline. Former master data page ids also carry the `tab` of "Datos Maestros" to open.
 *
 * With a `filters` payload the result also carries `filters`: the CRM QE filter state to apply
 * (see buildPipelineNavigationFilters), and a filtered pipeline opens in the "Tabla" view unless
 * a redirect names another one. Other pages have no filterable list, so their `filters` is null.
 */
export function resolveNavigationTarget(pageId, filters = null) {
  let target;
  if (PAGE_REDIRECTS[pageId]) target = { ...PAGE_REDIRECTS[pageId] };
  else if (PAGE_ITEMS.some((item) => item.id === pageId)) target = { page: pageId, view: null };
  else target = { page: 'pipeline', view: null };
  if (filters === null || filters === undefined) return target;
  if (target.page !== 'pipeline') return { ...target, filters: null };
  return { page: target.page, view: target.view || 'table', filters: buildPipelineNavigationFilters(filters) };
}
