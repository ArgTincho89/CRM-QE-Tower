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

/**
 * Resolves a requested page id to the page to show and, when the destination dictates one,
 * the view mode to select (`view` is null otherwise). Unknown ids fall back to the pipeline.
 */
export function resolveNavigationTarget(pageId) {
  if (PAGE_REDIRECTS[pageId]) return { ...PAGE_REDIRECTS[pageId] };
  if (NAV_ITEMS.some((item) => item.id === pageId)) return { page: pageId, view: null };
  return { page: 'pipeline', view: null };
}
