// Sidebar navigation. Page ids are stable routes; only order and grouping live here.
export const NAV_GROUPS = [
  {
    id: 'operations',
    label: '',
    items: [
      { id: 'home', label: 'Inicio', icon: 'home' },
      { id: 'pipeline', label: 'CRM QE', icon: 'briefcase' },
      { id: 'initiatives', label: 'Iniciativas', icon: 'share' },
      { id: 'opportunities', label: 'Oportunidades', icon: 'target' },
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
