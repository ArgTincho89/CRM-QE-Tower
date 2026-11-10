export const stages = [
  { id: 'prospecting', label: 'Prospección', tone: 'blue' },
  { id: 'analysis', label: 'Análisis / Calificación', tone: 'violet' },
  { id: 'proposal', label: 'Propuesta / Oferta', tone: 'amber' },
  { id: 'negotiation', label: 'Negociación', tone: 'orange' },
  { id: 'won', label: 'Ganada', tone: 'green' },
  { id: 'waiting', label: 'No prospera / En espera', tone: 'gray' },
];

const makeOpportunity = (id, title, account, amount, stage, tower, owner, due, tags = []) => ({
  id, title, account, amount, stage, tower, owner, due, tags,
});

export const seedOpportunities = [
  makeOpportunity('O-1024', 'Modernización plataforma de datos', 'Grupo Albor', '185.000 €', 'prospecting', 'Data', 'Lucía Martín', '12 jun', ['Cross-selling', 'Alta prioridad']),
  makeOpportunity('O-1021', 'Evolución SAP S/4HANA', 'Aceros del Norte', '320.000 €', 'prospecting', 'SAP', 'Diego Ramos', '18 jun', ['Cuenta estratégica']),
  makeOpportunity('O-1018', 'Servicio gestionado de ciberseguridad', 'Clínica Central', '96.000 €', 'prospecting', 'Cybersecurity', 'Marina Soto', '20 jun', ['Nueva cuenta']),
  makeOpportunity('O-1012', 'Plataforma de experiencia digital', 'Iberia Retail', '142.000 €', 'prospecting', 'Digital', 'Javier Ruiz', '24 jun', ['Cross-selling']),
  makeOpportunity('O-1009', 'Migración a cloud híbrida', 'TransLogística', '210.000 €', 'prospecting', 'Cloud', 'Lucía Martín', '28 jun', ['Prioridad media']),
  makeOpportunity('O-1005', 'Implantación CRM corporativo', 'Nova Energía', '275.000 €', 'prospecting', 'Digital', 'Carlos Vega', '03 jul', ['Cuenta estratégica']),
  makeOpportunity('O-1002', 'Analítica avanzada de ventas', 'Grupo Albor', '78.000 €', 'prospecting', 'Data', 'Marina Soto', '05 jul', ['Cross-selling']),
  makeOpportunity('O-0998', 'Automatización de procesos', 'Financiera Uno', '65.000 €', 'prospecting', 'Digital', 'Diego Ramos', '09 jul', ['Nueva cuenta']),
  makeOpportunity('O-1023', 'Data lake corporativo', 'Nova Energía', '245.000 €', 'analysis', 'Data', 'Marina Soto', '14 jun', ['Cross-selling', 'Alta prioridad']),
  makeOpportunity('O-1020', 'Arquitectura cloud y FinOps', 'Aceros del Norte', '130.000 €', 'analysis', 'Cloud', 'Lucía Martín', '16 jun', ['Cuenta estratégica']),
  makeOpportunity('O-1016', 'Revisión de seguridad OT', 'TransLogística', '88.000 €', 'analysis', 'Cybersecurity', 'Carlos Vega', '19 jun', ['Prioridad alta']),
  makeOpportunity('O-1011', 'Portal de proveedores', 'Iberia Retail', '115.000 €', 'analysis', 'Digital', 'Javier Ruiz', '25 jun', ['Cross-selling']),
  makeOpportunity('O-1007', 'Plan de gobierno de datos', 'Clínica Central', '72.000 €', 'analysis', 'Data', 'Marina Soto', '01 jul', ['Nueva cuenta']),
  makeOpportunity('O-0997', 'Estrategia de workplace', 'Financiera Uno', '54.000 €', 'analysis', 'Modern Workplace', 'Diego Ramos', '08 jul', ['Prioridad media']),
  makeOpportunity('O-1022', 'Renovación infraestructura cloud', 'Grupo Albor', '198.000 €', 'proposal', 'Cloud', 'Lucía Martín', '13 jun', ['Cross-selling', 'Propuesta externa']),
  makeOpportunity('O-1019', 'Servicios de soporte SAP', 'Aceros del Norte', '160.000 €', 'proposal', 'SAP', 'Diego Ramos', '17 jun', ['Propuesta externa']),
  makeOpportunity('O-1015', 'Modernización de aplicaciones', 'Nova Energía', '220.000 €', 'proposal', 'Digital', 'Javier Ruiz', '21 jun', ['Propuesta externa']),
  makeOpportunity('O-1008', 'SOC y respuesta ante incidentes', 'Financiera Uno', '145.000 €', 'proposal', 'Cybersecurity', 'Carlos Vega', '29 jun', ['Alta prioridad']),
  makeOpportunity('O-1004', 'Cuadro de mando ejecutivo', 'Iberia Retail', '68.000 €', 'proposal', 'Data', 'Marina Soto', '02 jul', ['Cross-selling']),
  makeOpportunity('O-1017', 'Programa de transformación digital', 'TransLogística', '410.000 €', 'negotiation', 'Digital', 'Javier Ruiz', '15 jun', ['Cuenta estratégica', 'Alta prioridad']),
  makeOpportunity('O-1013', 'Migración SAP a RISE', 'Aceros del Norte', '295.000 €', 'negotiation', 'SAP', 'Diego Ramos', '22 jun', ['Propuesta externa']),
  makeOpportunity('O-1006', 'Operación cloud gestionada', 'Nova Energía', '180.000 €', 'negotiation', 'Cloud', 'Lucía Martín', '30 jun', ['Cross-selling']),
  makeOpportunity('O-0999', 'Modelo de datos de cliente', 'Grupo Albor', '92.000 €', 'negotiation', 'Data', 'Marina Soto', '07 jul', ['Propuesta externa']),
  makeOpportunity('O-1014', 'Assessment de ciberseguridad', 'Clínica Central', '64.000 €', 'won', 'Cybersecurity', 'Carlos Vega', 'Ganada · 10 jun', ['Ganada']),
  makeOpportunity('O-1003', 'Evolución plataforma analítica', 'Financiera Uno', '125.000 €', 'won', 'Data', 'Marina Soto', 'Ganada · 06 jun', ['Ganada']),
  makeOpportunity('O-0995', 'Servicios de workplace', 'Iberia Retail', '84.000 €', 'won', 'Modern Workplace', 'Lucía Martín', 'Ganada · 29 may', ['Ganada']),
  makeOpportunity('O-1010', 'Plataforma de atención omnicanal', 'Financiera Uno', '230.000 €', 'waiting', 'Digital', 'Javier Ruiz', 'En espera', ['En espera']),
  makeOpportunity('O-1001', 'Automatización de compras', 'TransLogística', '76.000 €', 'waiting', 'Digital', 'Diego Ramos', 'No prospera', ['No prospera']),
  makeOpportunity('O-0996', 'Gobierno de infraestructura', 'Aceros del Norte', '105.000 €', 'waiting', 'Cloud', 'Carlos Vega', 'En espera', ['En espera']),
];

export const clients = [
  { name: 'Grupo Albor', sector: 'Energía', owner: 'Lucía Martín', opportunities: 4, status: 'Activo', signal: 'Oportunidad de datos' },
  { name: 'Aceros del Norte', sector: 'Industria', owner: 'Diego Ramos', opportunities: 4, status: 'Activo', signal: 'Renovación SAP' },
  { name: 'Nova Energía', sector: 'Energía', owner: 'Carlos Vega', opportunities: 3, status: 'Activo', signal: 'Cuenta estratégica' },
  { name: 'Iberia Retail', sector: 'Retail', owner: 'Javier Ruiz', opportunities: 3, status: 'Activo', signal: 'Cross-selling digital' },
  { name: 'TransLogística', sector: 'Transporte', owner: 'Javier Ruiz', opportunities: 3, status: 'Activo', signal: 'Programa de transformación' },
  { name: 'Clínica Central', sector: 'Salud', owner: 'Marina Soto', opportunities: 3, status: 'Activo', signal: 'Ciberseguridad' },
  { name: 'Financiera Uno', sector: 'Servicios financieros', owner: 'Carlos Vega', opportunities: 3, status: 'Activo', signal: 'Servicio gestionado' },
];

export const proposals = [
  { id: 'PE-2408', title: 'Renovación infraestructura cloud', client: 'Grupo Albor', type: 'Externa', amount: '198.000 €', status: 'En revisión', opportunity: 'O-1022' },
  { id: 'PE-2407', title: 'Modelo de gobierno de datos', client: 'Clínica Central', type: 'Interna', amount: '12.500 €', status: 'Borrador', opportunity: 'O-1007' },
  { id: 'PE-2406', title: 'Servicios de soporte SAP', client: 'Aceros del Norte', type: 'Externa', amount: '160.000 €', status: 'Enviada', opportunity: 'O-1019' },
  { id: 'PE-2405', title: 'Operación cloud gestionada', client: 'Nova Energía', type: 'Interna', amount: '8.900 €', status: 'Aprobada', opportunity: 'O-1006' },
  { id: 'PE-2404', title: 'SOC y respuesta ante incidentes', client: 'Financiera Uno', type: 'Externa', amount: '145.000 €', status: 'En preparación', opportunity: 'O-1008' },
  { id: 'PE-2403', title: 'Evolución plataforma analítica', client: 'Financiera Uno', type: 'Externa', amount: '125.000 €', status: 'Ganada', opportunity: 'O-1003' },
];

export const agreements = [
  { id: 'AM-2025-014', title: 'Acuerdo marco de servicios de datos', client: 'Grupo Albor', end: '31 dic 2026', owner: 'Lucía Martín', status: 'Vigente' },
  { id: 'AM-2025-011', title: 'Servicios profesionales SAP', client: 'Aceros del Norte', end: '30 sep 2026', owner: 'Diego Ramos', status: 'Vigente' },
  { id: 'AM-2024-038', title: 'Servicios de transformación digital', client: 'Iberia Retail', end: '15 ene 2027', owner: 'Javier Ruiz', status: 'Renovación próxima' },
];

export const crossSelling = [
  { account: 'Grupo Albor', idea: 'Analítica avanzada de ventas', tower: 'Data', linked: 'O-1002', owner: 'Marina Soto', status: 'En exploración' },
  { account: 'Aceros del Norte', idea: 'Evaluación de seguridad OT', tower: 'Cybersecurity', linked: 'O-1016', owner: 'Carlos Vega', status: 'Oportunidad creada' },
  { account: 'Iberia Retail', idea: 'Modernización de experiencia digital', tower: 'Digital', linked: 'O-1012', owner: 'Javier Ruiz', status: 'Oportunidad creada' },
  { account: 'Nova Energía', idea: 'Servicios gestionados de cloud', tower: 'Cloud', linked: '—', owner: 'Lucía Martín', status: 'En exploración' },
];

export const towerNames = ['Data', 'SAP', 'Digital', 'Cloud', 'Cybersecurity', 'Modern Workplace'];
