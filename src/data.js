export const stages = [
  { id: 'prospecting', label: 'Prospección', tone: 'blue' },
  { id: 'contacted', label: 'Contacto iniciado', tone: 'violet' },
  { id: 'identified', label: 'Oportunidad identificada', tone: 'violet' },
  { id: 'proposal', label: 'Propuesta / Pliego', tone: 'amber' },
  { id: 'negotiation', label: 'Seguimiento / Negociación', tone: 'amber' },
  { id: 'result', label: 'Resultado', tone: 'green' },
];

export const opportunityStages = stages;

export const opportunityOutcomes = [
  { id: 'won', label: 'Ganada', tone: 'green' },
  { id: 'lost', label: 'Perdida', tone: 'gray' },
  { id: 'discarded', label: 'Descartada', tone: 'gray' },
];

export const opportunityTypes = [
  { id: 'tender', label: 'Pliego', tone: 'amber' },
  { id: 'offer', label: 'Oferta', tone: 'blue' },
  { id: 'staffing', label: 'Staffing', tone: 'violet' },
];

/** "Ámbito" of an opportunity (optional). */
export const opportunityMarketScopes = [
  { id: 'large', label: 'Large' },
  { id: 'midmarket', label: 'MidMarket' },
];

/** "Tipo de contrato" of an opportunity (optional). */
export const opportunityContractTypes = [
  { id: 'tender', label: 'Licitación' },
  { id: 'rfp', label: 'RFP' },
  { id: 'sda', label: 'SDA' },
  { id: 'am_sda_based', label: 'Contrato Basado de AM/SDA' },
  { id: 'direct_offer', label: 'Oferta Directa' },
];

/** "Tipo de servicio" of an opportunity (optional). */
export const opportunityServiceTypes = [
  { id: 'closed_project', label: 'Closed project' },
  { id: 'am_service', label: 'AM Service' },
  { id: 'licenses', label: 'Licenses' },
  { id: 'infrastructure', label: 'Infrastructure' },
  { id: 'guards', label: 'Guards' },
  { id: 'subco', label: 'Subco' },
  { id: 'hardware_reselling', label: 'Hardware reselling' },
];

export const opportunityOrigins = [
  'Iniciativa interna',
  'Cliente existente',
  'Cross-selling',
  'Prospección directa',
  'Pliego/Licitación',
  'Referencia interna',
  'Solicitud directa del cliente',
  'Otros',
];

export const initiativeStages = [
  { id: 'pending', label: 'Pendiente', tone: 'blue' },
  { id: 'in_progress', label: 'En curso', tone: 'violet' },
  { id: 'following', label: 'En seguimiento', tone: 'amber' },
  { id: 'completed', label: 'Completada', tone: 'green' },
];

// The board shows all four stages; completed initiatives sit in Completada but never count as active.
export const COMPLETED_INITIATIVE_STAGE = 'completed';

export const initiativeCategories = [
  'Prospección externa',
  'Desarrollo de negocio en cliente existente',
  'Desarrollo de negocio interno (Seidor/Towers)',
  'Cross-selling',
  'Desarrollo de nuevos servicios QE',
  'Alianzas/colaboraciones',
  'Otros',
];

export const initiativePriorities = ['Alta', 'Media', 'Baja'];

export const initiativeStatuses = [
  { id: 'active', label: 'Activa', tone: 'green' },
  { id: 'paused', label: 'Pausada', tone: 'amber' },
  { id: 'discarded', label: 'Descartada', tone: 'gray' },
];

// Keep the proposals/estimations section available while starting with no demo records.
export const proposals = [];
