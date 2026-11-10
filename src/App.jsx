import { useEffect, useMemo, useRef, useState } from 'react';
import { agreements, clients, crossSelling, proposals, seedOpportunities, stages, towerNames } from './data.js';
import { COLLAPSED_CARD_LIMIT, getColumnVisibility, toggleColumnExpanded } from './kanban.js';

const STORAGE_KEY = 'crm-qe-demo-v1';

const navItems = [
  { id: 'home', label: 'Inicio', icon: 'home' },
  { id: 'pipeline', label: 'CRM QE', icon: 'briefcase' },
  { id: 'clients', label: 'Clientes', icon: 'users' },
  { id: 'opportunities', label: 'Oportunidades', icon: 'target' },
  { id: 'proposals', label: 'Propuestas / Estimaciones', icon: 'file' },
  { id: 'agreements', label: 'Acuerdos Marco', icon: 'layers' },
  { id: 'crossSelling', label: 'Cross-Selling', icon: 'share' },
  { id: 'towers', label: 'Por Towers', icon: 'grid' },
  { id: 'analytics', label: 'Informes', icon: 'chart' },
  { id: 'settings', label: 'Configuración', icon: 'settings' },
];

const moduleTabs = [
  { id: 'pipeline', label: 'Pipeline Comercial' },
  { id: 'proposals', label: 'Propuestas internas / Estimaciones' },
  { id: 'agreements', label: 'Acuerdos Marco' },
  { id: 'clients', label: 'Clientes' },
  { id: 'crossSelling', label: 'Cross-Selling' },
  { id: 'towers', label: 'Por Towers' },
  { id: 'analytics', label: 'Analítica' },
];

const pageTitles = {
  home: ['Inicio', 'Resumen de actividad comercial y señales de tus cuentas.'],
  pipeline: ['CRM QE', 'Gestiona el pipeline de oportunidades de calidad e ingeniería.'],
  opportunities: ['Oportunidades', 'Seguimiento comercial y próximos hitos por cuenta.'],
  clients: ['Clientes', 'Cuentas activas, responsables y oportunidades de desarrollo.'],
  proposals: ['Propuestas / Estimaciones', 'Preventa interna y propuestas externas vinculadas a oportunidades.'],
  agreements: ['Acuerdos Marco', 'Vigencia, responsables y renovaciones de acuerdos comerciales.'],
  crossSelling: ['Cross-Selling', 'Iniciativas de expansión desde cuentas existentes, con o sin oportunidad formal.'],
  towers: ['Por Towers', 'Vista de actividad y pipeline por torre de servicio.'],
  analytics: ['Informes', 'Indicadores de actividad comercial y evolución del pipeline.'],
  settings: ['Configuración', 'Preferencias locales de esta demostración.'],
};

function loadOpportunities() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return seedOpportunities;
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : seedOpportunities;
  } catch {
    return seedOpportunities;
  }
}

function Icon({ name, size = 18 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const shapes = {
    home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-7h6v7"/></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    share: <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.7 6.8-4.4M8.6 13.3l6.8 4.4"/></>,
    grid: <><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></>,
    chart: <><path d="M3 3v18h18"/><path d="m8 14 4-4 4 3 5-7"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4L7.3 15a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1-.1 2Z"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    filter: <><path d="M4 6h16M7 12h10M10 18h4"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    dots: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16M15 4v16"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg {...common}>{shapes[name] || shapes.grid}</svg>;
}

function Avatar({ name, compact = false }) {
  const initials = name.split(' ').map((part) => part[0]).slice(0, 2).join('');
  return <span className={`avatar${compact ? ' avatar-small' : ''}`} aria-label={name}>{initials}</span>;
}

function App() {
  const [opportunities, setOpportunities] = useState(loadOpportunities);
  const [page, setPage] = useState('pipeline');
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [towerFilter, setTowerFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [view, setView] = useState('kanban');
  const [expandedColumns, setExpandedColumns] = useState({});
  const [editing, setEditing] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(opportunities)); } catch { setNotice('No se pudo guardar en este navegador.'); }
  }, [opportunities]);

  const owners = useMemo(() => [...new Set(opportunities.map((item) => item.owner))].sort(), [opportunities]);
  const filtered = useMemo(() => opportunities.filter((item) => {
    const haystack = `${item.title} ${item.account} ${item.owner} ${item.tower} ${item.id}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase())
      && (stageFilter === 'all' || item.stage === stageFilter)
      && (towerFilter === 'all' || item.tower === towerFilter)
      && (ownerFilter === 'all' || item.owner === ownerFilter);
  }), [opportunities, query, stageFilter, towerFilter, ownerFilter]);

  const navigate = (nextPage) => {
    setPage(nextPage);
    setMobileNav(false);
  };

  const saveOpportunity = (record) => {
    setOpportunities((current) => {
      const exists = current.some((item) => item.id === record.id);
      return exists ? current.map((item) => item.id === record.id ? record : item) : [record, ...current];
    });
    setEditing(null);
    setNotice('Oportunidad guardada correctamente.');
    window.setTimeout(() => setNotice(''), 2600);
  };

  const activePage = page === 'home' ? 'home' : page;
  const [title, subtitle] = pageTitles[activePage] || pageTitles.pipeline;
  const opportunityMetric = 18 + opportunities.length - seedOpportunities.length;

  return (
    <div className="app-shell">
      <aside className={`sidebar${mobileNav ? ' sidebar-open' : ''}`} aria-label="Navegación principal">
        <div className="brand" aria-label="SEIDOR CRM QE"><span className="brand-word">SEIDOR</span><span className="brand-mark">◆</span></div>
        <div className="workspace-label">GESTIÓN COMERCIAL</div>
        <nav className="side-nav">
          {navItems.map((item) => <button key={item.id} className={`nav-item${page === item.id ? ' selected' : ''}`} onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}>
            <Icon name={item.icon} size={18} /><span>{item.label}</span>{item.id === 'pipeline' && <span className="nav-count">18</span>}
          </button>)}
        </nav>
        <div className="sidebar-tip"><div className="tip-icon">✦</div><div><strong>Una oportunidad empieza con una conversación</strong><p>Registra señales de tus cuentas para encontrar nuevas formas de colaborar.</p><button onClick={() => navigate('crossSelling')}>Ver cross-selling <Icon name="arrow" size={14} /></button></div></div>
        <div className="sidebar-footer"><span className="footer-dot" /> CRM QE <span className="footer-version">v1.0</span></div>
      </aside>
      {mobileNav && <button className="nav-backdrop" aria-label="Cerrar navegación" onClick={() => setMobileNav(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Abrir navegación" onClick={() => setMobileNav(true)}><Icon name="list" /></button>
          <div className="breadcrumbs"><span>SEIDOR</span><Icon name="chevron" size={14} /><strong>{title}</strong></div>
          <label className="global-search"><Icon name="search" size={17} /><span className="sr-only">Buscar en CRM QE</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente, oportunidad..." /><kbd>⌘ K</kbd></label>
          <button className="icon-button notification-button" aria-label="Notificaciones"><Icon name="bell" size={19} /><span className="notification-dot" /></button>
          <button className="user-menu" aria-label="Usuario: Martín Pérez"><Avatar name="Martín Pérez" /><span><strong>Martín Pérez</strong><small>Equipo QE</small></span><span className="user-chevron">⌄</span></button>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div><div className="eyebrow"><span className="eyebrow-dot" /> ESPAÑA <span className="eyebrow-divider">/</span> QUALITY ENGINEERING</div><h1>{title}</h1><p>{subtitle}</p></div>
            <div className="heading-actions"><button className="button button-secondary" onClick={() => navigate('crossSelling')}><Icon name="plus" size={17} /> Nueva iniciativa</button><button className="button button-primary" onClick={() => setEditing({})}><Icon name="plus" size={18} /> Nueva oportunidad</button></div>
          </div>

          {page === 'pipeline' || page === 'opportunities' ? <>
            <section className="kpi-grid" aria-label="Indicadores principales">
              <Kpi icon="users" color="blue" label="Clientes activos" value="24" detail="+2 este mes" />
              <Kpi icon="target" color="violet" label="Oportunidades" value={String(opportunityMetric)} detail="+3 este mes" trend />
              <Kpi icon="arrow" color="orange" label="Propuestas externas" value="7" detail="2 por enviar" />
              <Kpi icon="file" color="teal" label="Propuestas internas / Estimaciones" value="6" detail="1 pendiente" />
              <Kpi icon="layers" color="blue" label="Acuerdos Marco" value="3" detail="1 renueva pronto" />
              <Kpi icon="chart" color="green" label="Pipeline QE" value="2,34 M€" detail="Valor estimado" />
            </section>
            <div className="module-tabs" role="tablist" aria-label="Módulos de CRM QE">
              {moduleTabs.map((tab) => <button role="tab" aria-selected={page === tab.id} key={tab.id} className={`module-tab${page === tab.id ? ' active' : ''}`} onClick={() => navigate(tab.id)}>{tab.label}</button>)}
            </div>
            <div className="pipeline-toolbar">
              <div className="toolbar-title"><h2>Pipeline comercial</h2><span className="live-pill"><span /> Actualizado ahora</span></div>
              <div className="toolbar-controls">
                <label className="filter-select"><span className="sr-only">Filtrar por etapa</span><Icon name="filter" size={15} /><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="all">Todas las etapas</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
                <label className="filter-select"><span className="sr-only">Filtrar por torre</span><select value={towerFilter} onChange={(event) => setTowerFilter(event.target.value)}><option value="all">Todas las Towers</option>{towerNames.map((tower) => <option key={tower}>{tower}</option>)}</select></label>
                <label className="filter-select owner-filter"><span className="sr-only">Filtrar por responsable</span><select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="all">Todos los responsables</option>{owners.map((owner) => <option key={owner}>{owner}</option>)}</select></label>
                <div className="view-switch" aria-label="Tipo de vista">{[['kanban', 'grid', 'Kanban'], ['list', 'list', 'Lista'], ['table', 'table', 'Tabla']].map(([id, icon, label]) => <button key={id} title={label} aria-label={`Vista ${label}`} aria-pressed={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon name={icon} size={16} /></button>)}</div>
              </div>
            </div>
            <div className="results-line"><span><strong>{filtered.length}</strong> oportunidades encontradas</span><button onClick={() => { setQuery(''); setStageFilter('all'); setTowerFilter('all'); setOwnerFilter('all'); }}>Limpiar filtros <Icon name="close" size={13} /></button></div>
            {view === 'kanban' ? <Kanban opportunities={filtered} allOpportunities={opportunities} expandedColumns={expandedColumns} onToggleColumn={(stageId) => setExpandedColumns((current) => toggleColumnExpanded(current, stageId))} onEdit={setEditing} /> : <OpportunityRows opportunities={filtered} view={view} onEdit={setEditing} />}
          </> : <SecondaryPage page={page} opportunities={opportunities} onNavigate={navigate} />}
          <footer className="main-footer"><span>CRM QE <b>·</b> Herramienta complementaria al CRM corporativo</span><span>Los importes reflejan oportunidades estimadas, no ingresos contratados.</span></footer>
        </div>
      </main>
      {editing !== null && <OpportunityDialog record={editing} onClose={() => setEditing(null)} onSave={saveOpportunity} />}
      {notice && <div className="toast" role="status"><Icon name="check" size={16} />{notice}</div>}
    </div>
  );
}

function Kpi({ icon, color, label, value, detail, trend }) {
  return <article className="kpi-card"><div className={`kpi-icon ${color}`}><Icon name={icon} size={18} /></div><div className="kpi-content"><span>{label}</span><div className="kpi-value-row"><strong>{value}</strong>{trend && <span className="trend-badge">↗ 20%</span>}</div><small>{detail}</small></div></article>;
}

function Kanban({ opportunities, allOpportunities, expandedColumns, onToggleColumn, onEdit }) {
  return <div className="kanban-board" aria-label="Pipeline comercial por etapa">
    {stages.map((stage) => {
      const cards = opportunities.filter((item) => item.stage === stage.id);
      const totalCount = allOpportunities.filter((item) => item.stage === stage.id).length;
      const isExpanded = Boolean(expandedColumns[stage.id]);
      const { visibleCards, hiddenCount, canToggle } = getColumnVisibility(cards, isExpanded);
      return <section className={`kanban-column ${stage.id}`} key={stage.id} aria-label={`${stage.label}: ${totalCount} oportunidades totales`}>
        <div className={`column-heading ${stage.tone}`}><span className="stage-indicator" /><h3>{stage.label}</h3><span className="column-count">{totalCount}</span><button className="column-menu" aria-label={`Opciones de ${stage.label}`}><Icon name="dots" size={17} /></button></div>
        <div className="column-cards">{visibleCards.map((record) => <OpportunityCard key={record.id} record={record} onEdit={onEdit} />)}{cards.length === 0 && <div className="empty-column">No hay oportunidades para estos filtros.</div>}</div>
        {(canToggle || (isExpanded && totalCount > COLLAPSED_CARD_LIMIT)) && <button className="show-more" aria-expanded={isExpanded} onClick={() => onToggleColumn(stage.id)}>{isExpanded ? '− Ver menos' : `+ Ver más (${hiddenCount})`}</button>}
        <button className="add-card" onClick={() => onEdit({ stage: stage.id })}><Icon name="plus" size={15} /> Añadir oportunidad</button>
      </section>;
    })}
  </div>;
}

function OpportunityCard({ record, onEdit }) {
  const stage = stages.find((item) => item.id === record.stage);
  return <button className="opportunity-card" onClick={() => onEdit(record)} aria-label={`Editar ${record.title}, ${record.account}`}>
    <div className="card-top"><span className="opportunity-id">{record.id}</span><span className={`card-stage-dot ${stage.tone}`} title={stage.label} /><span className="card-menu"><Icon name="dots" size={16} /></span></div>
    <h4>{record.title}</h4><div className="card-client"><span className="client-glyph">{record.account.charAt(0)}</span><span>{record.account}</span></div>
    <div className="card-value-row"><strong>{record.amount}</strong><span className="tower-pill">{record.tower}</span></div>
    <div className="card-bottom"><span className="card-date"><Icon name={record.due.includes('Ganada') ? 'check' : 'calendar'} size={13} />{record.due}</span><span className="card-owner"><Avatar name={record.owner} compact /></span></div>
  </button>;
}

function OpportunityRows({ opportunities, view, onEdit }) {
  if (view === 'table') return <div className="table-wrap"><table className="data-table"><thead><tr><th>ID / Oportunidad</th><th>Cliente</th><th>Etapa</th><th>Tower</th><th>Importe estimado</th><th>Responsable</th><th>Próximo hito</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{opportunities.map((item) => <tr key={item.id}><td><span className="table-id">{item.id}</span><button className="table-title" onClick={() => onEdit(item)}>{item.title}</button></td><td>{item.account}</td><td><span className={`status-pill ${stages.find((stage) => stage.id === item.stage).tone}`}>{stages.find((stage) => stage.id === item.stage).label}</span></td><td>{item.tower}</td><td className="table-amount">{item.amount}</td><td><span className="table-owner"><Avatar name={item.owner} compact />{item.owner}</span></td><td>{item.due}</td><td><button className="icon-button row-edit" onClick={() => onEdit(item)} aria-label={`Editar ${item.title}`}><Icon name="dots" size={17} /></button></td></tr>)}</tbody></table>{opportunities.length === 0 && <p className="empty-state">No hay oportunidades que coincidan con los filtros.</p>}</div>;
  return <div className="list-view">{opportunities.map((item) => <button className="list-row" key={item.id} onClick={() => onEdit(item)}><span className="list-accent" /><span className="list-main"><small>{item.id} <span>·</span> {item.account}</small><strong>{item.title}</strong></span><span className="list-stage"><i className={stages.find((stage) => stage.id === item.stage).tone} />{stages.find((stage) => stage.id === item.stage).label}</span><span className="list-tower">{item.tower}</span><strong className="list-amount">{item.amount}</strong><span className="table-owner"><Avatar name={item.owner} compact />{item.owner}</span><span className="list-date"><Icon name="calendar" size={14} />{item.due}</span><Icon name="chevron" size={16} /></button>)}{opportunities.length === 0 && <p className="empty-state">No hay oportunidades que coincidan con los filtros.</p>}</div>;
}

function SecondaryPage({ page, opportunities, onNavigate }) {
  const grouped = towerNames.map((tower) => ({ tower, count: opportunities.filter((item) => item.tower === tower).length, amount: opportunities.filter((item) => item.tower === tower).reduce((sum, item) => sum + Number(item.amount.replace(/[^0-9]/g, '')), 0) }));
  if (page === 'home') return <section className="secondary-home"><div className="welcome-panel"><div><div className="eyebrow">MARTES, 10 DE JUNIO</div><h2>Buen día, Martín</h2><p>Este es el pulso de tu actividad comercial QE.</p></div><button className="button button-primary" onClick={() => onNavigate('pipeline')}>Ir al pipeline <Icon name="arrow" size={16} /></button></div><div className="secondary-grid"><SummaryCard title="Oportunidades recientes" action="Ver pipeline" onAction={() => onNavigate('pipeline')}><div className="recent-list">{opportunities.slice(0, 4).map((item) => <div className="recent-item" key={item.id}><span className="recent-dot" /><span><strong>{item.title}</strong><small>{item.account} · {item.tower}</small></span><b>{item.amount}</b></div>)}</div></SummaryCard><SummaryCard title="Siguientes pasos" action="Ver oportunidades" onAction={() => onNavigate('opportunities')}><div className="task-list"><p><span className="task-date">12 JUN</span> Revisar alcance con Grupo Albor <small>Data · Lucía Martín</small></p><p><span className="task-date">14 JUN</span> Enviar propuesta a Aceros del Norte <small>SAP · Diego Ramos</small></p><p><span className="task-date">16 JUN</span> Reunión de calificación con Nova Energía <small>Cloud · Carlos Vega</small></p></div></SummaryCard></div></section>;
  if (page === 'settings') return <div className="settings-note"><div className="kpi-icon blue"><Icon name="settings" /></div><div><h2>Preferencias de demostración</h2><p>Los cambios de oportunidades se guardan únicamente en el almacenamiento local de este navegador. No hay una cuenta o sincronización multiusuario conectada.</p><button className="button button-secondary" onClick={() => { localStorage.removeItem(STORAGE_KEY); window.location.reload(); }}>Restaurar datos de ejemplo</button></div></div>;
  if (page === 'clients') return <DataPanel title="Cartera de clientes" description="Las oportunidades influyen en el desarrollo de la cuenta; el valor de negocio corporativo no se suma como ingreso QE." headers={['Cliente', 'Sector', 'Responsable', 'Oportunidades QE', 'Señal de desarrollo', 'Estado']} rows={clients.map((item) => [item.name, item.sector, item.owner, item.opportunities, item.signal, item.status])} />;
  if (page === 'proposals') return <DataPanel title="Preventa y estimaciones" description="Cada propuesta conserva su propio estado y queda vinculada a una oportunidad cuando existe." headers={['ID', 'Propuesta / estimación', 'Cliente', 'Tipo', 'Importe', 'Estado', 'Oportunidad vinculada']} rows={proposals.map((item) => [item.id, item.title, item.client, item.type, item.amount, item.status, item.opportunity])} />;
  if (page === 'agreements') return <DataPanel title="Acuerdos vigentes y renovaciones" description="Control de acuerdos marco comerciales. Los contratos y aprobaciones se gestionan en los sistemas corporativos." headers={['ID', 'Acuerdo', 'Cliente', 'Fin de vigencia', 'Responsable', 'Estado']} rows={agreements.map((item) => [item.id, item.title, item.client, item.end, item.owner, item.status])} />;
  if (page === 'crossSelling') return <DataPanel title="Iniciativas de cross-selling" description="Una señal puede registrarse desde una cuenta antes de formalizar una oportunidad comercial." headers={['Cuenta', 'Iniciativa', 'Tower sugerida', 'Oportunidad QE', 'Responsable', 'Estado']} rows={crossSelling.map((item) => [item.account, item.idea, item.tower, item.linked, item.owner, item.status])} />;
  if (page === 'towers') return <div className="tower-grid">{grouped.map((item) => <article className="tower-card" key={item.tower}><div className="tower-card-heading"><span className="tower-symbol">{item.tower.slice(0, 2).toUpperCase()}</span><span className="tower-card-arrow"><Icon name="arrow" size={16} /></span></div><h3>{item.tower}</h3><p>Torre de servicio</p><div className="tower-stats"><span><strong>{item.count}</strong> oportunidades</span><strong>{formatEuro(item.amount)}</strong></div><button onClick={() => onNavigate('pipeline')}>Ver en pipeline <Icon name="arrow" size={14} /></button></article>)}</div>;
  return <Analytics opportunities={opportunities} grouped={grouped} />;
}

function SummaryCard({ title, action, onAction, children }) {
  return <section className="panel-card"><div className="panel-heading"><h3>{title}</h3><button onClick={onAction}>{action} <Icon name="arrow" size={14} /></button></div>{children}</section>;
}

function DataPanel({ title, description, headers, rows }) {
  return <section className="secondary-panel"><div className="secondary-panel-heading"><div><h2>{title}</h2><p>{description}</p></div><span className="record-count">{rows.length} registros</span></div><div className="table-wrap"><table className="data-table secondary-table"><thead><tr>{headers.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cellIndex === row.length - 1 ? <span className={`status-pill ${String(cell).toLowerCase().includes('vigente') || cell === 'Activo' || cell === 'Ganada' ? 'green' : 'violet'}`}>{cell}</span> : cell}</td>)}</tr>)}</tbody></table></div><div className="panel-footnote"><span className="info-mark">i</span> Vista de referencia con datos de demostración. Conecta un backend para operar con información corporativa.</div></section>;
}

function Analytics({ opportunities, grouped }) {
  const totalAmount = opportunities.reduce((sum, item) => sum + Number(item.amount.replace(/[^0-9]/g, '')), 0);
  const max = Math.max(...grouped.map((item) => item.count), 1);
  return <div className="analytics-layout"><section className="panel-card analytics-card"><div className="panel-heading"><div><h3>Oportunidades por Tower</h3><p>Registros de la vista local de demostración</p></div><span className="range-pill">Últimos 90 días <Icon name="chevron" size={13} /></span></div><div className="bar-chart">{grouped.map((item) => <div className="bar-row" key={item.tower}><span>{item.tower}</span><div className="bar-track"><i style={{ width: `${Math.max(5, item.count / max * 100)}%` }} /></div><strong>{item.count}</strong></div>)}</div></section><section className="panel-card analytic-summary"><div className="panel-heading"><h3>Resumen del pipeline</h3><span className="period-badge">Este trimestre</span></div><div className="summary-number"><small>Importe estimado en oportunidades</small><strong>{formatEuro(totalAmount)}</strong><span>No equivale a ingreso contratado ni a valor influido del CRM corporativo.</span></div><div className="summary-divider" /><div className="mini-metric"><span>Oportunidades registradas</span><strong>{opportunities.length}</strong></div><div className="mini-metric"><span>En negociación</span><strong>{opportunities.filter((item) => item.stage === 'negotiation').length}</strong></div><div className="mini-metric"><span>Ganadas</span><strong>{opportunities.filter((item) => item.stage === 'won').length}</strong></div></section></div>;
}

function formatEuro(amount) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
}

function OpportunityDialog({ record, onClose, onSave }) {
  const dialogRef = useRef(null);
  const isEditing = Boolean(record.id);
  const [form, setForm] = useState({
    id: record.id || `O-${String(Date.now()).slice(-4)}`,
    title: record.title || '', account: record.account || '', amount: record.amount || '',
    stage: record.stage || 'prospecting', tower: record.tower || 'Data', owner: record.owner || 'Lucía Martín',
    due: record.due || '', tags: record.tags || [],
  });
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.account.trim() || !form.amount.trim()) { setError('Completa el nombre, cliente e importe estimado.'); return; }
    onSave({ ...form, id: form.id.trim(), title: form.title.trim(), account: form.account.trim(), amount: form.amount.trim(), due: form.due.trim() || 'Por definir' });
  };

  return <dialog ref={dialogRef} className="opportunity-dialog" aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form onSubmit={submit}>
      <div className="dialog-heading"><div><span className="eyebrow">CRM QE · OPORTUNIDAD</span><h2 id="dialog-title">{isEditing ? 'Editar oportunidad' : 'Nueva oportunidad'}</h2><p>Registra el seguimiento QE. No reemplaza la oportunidad del CRM corporativo.</p></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><Icon name="close" /></button></div>
      <div className="form-grid">
        <label className="form-field wide">Nombre de la oportunidad *<input autoFocus value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="Ej. Modernización de plataforma de datos" required /></label>
        <label className="form-field">Cliente / cuenta *<input value={form.account} onChange={(event) => update('account', event.target.value)} placeholder="Nombre de la cuenta" required /></label>
        <label className="form-field">Importe estimado *<input value={form.amount} onChange={(event) => update('amount', event.target.value)} placeholder="Ej. 125.000 €" required /></label>
        <label className="form-field">Etapa<select value={form.stage} onChange={(event) => update('stage', event.target.value)}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
        <label className="form-field">Tower<select value={form.tower} onChange={(event) => update('tower', event.target.value)}>{towerNames.map((tower) => <option key={tower}>{tower}</option>)}</select></label>
        <label className="form-field">Responsable<input value={form.owner} onChange={(event) => update('owner', event.target.value)} placeholder="Nombre y apellido" /></label>
        <label className="form-field">Próximo hito<input value={form.due} onChange={(event) => update('due', event.target.value)} placeholder="Ej. 20 jun" /></label>
      </div>
      <div className="dialog-hint"><span className="info-mark">i</span> Las propuestas y estimaciones se gestionan como registros independientes vinculados.</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit">{isEditing ? 'Guardar cambios' : 'Crear oportunidad'}</button></div>
    </form>
  </dialog>;
}

export default App;
