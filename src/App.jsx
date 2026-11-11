import { useEffect, useMemo, useRef, useState } from 'react';
import { proposals, stages } from './data.js';
import { COLLAPSED_CARD_LIMIT, getColumnVisibility, moveOpportunityToStage, toggleColumnExpanded } from './kanban.js';
import { AMOUNT_CURRENCY, formatAmountInput, formatCurrency, parseAmount } from './money.js';
import { createDefaultAdvancedFilters, filterPipelineCards } from './pipelineFilters.js';
import { getMe, login, logout, listOpportunities, createOpportunity, updateOpportunity, deleteOpportunity, listClients, createClient, updateClient, deactivateClient, listTowers, createTower, updateTower, deleteTower, listPeople, createPerson, updatePerson, deactivatePerson, listInitiatives, createInitiative, updateInitiative, deleteInitiative, listAgreements, createAgreement, listActions, createAction, updateAction, createActionComment, listInitiativeEvents } from './api.js';
import AuthScreen from './AuthScreen.jsx';
import CardHistory from './CardHistory.jsx';

const navItems = [
  { id: 'home', label: 'Inicio', icon: 'home' },
  { id: 'pipeline', label: 'CRM QE', icon: 'briefcase' },
  { id: 'clients', label: 'Clientes', icon: 'users' },
  { id: 'opportunities', label: 'Oportunidades', icon: 'target' },
  { id: 'initiatives', label: 'Iniciativas', icon: 'share' },
  { id: 'proposals', label: 'Propuestas / Estimaciones', icon: 'file' },
  { id: 'agreements', label: 'Acuerdos Marco', icon: 'layers' },
  { id: 'crossSelling', label: 'Cross-Selling', icon: 'share' },
  { id: 'towers', label: 'Towers', icon: 'grid' },
  { id: 'people', label: 'Responsables', icon: 'users' },
  { id: 'analytics', label: 'Informes', icon: 'chart' },
  { id: 'settings', label: 'Configuración', icon: 'settings' },
];

const pageTitles = {
  home: ['Inicio', 'Resumen de actividad comercial y señales de tus cuentas.'],
  pipeline: ['CRM QE', 'Gestiona el pipeline de oportunidades de calidad e ingeniería.'],
  opportunities: ['Oportunidades', 'Seguimiento comercial y próximos hitos por cuenta.'],
  initiatives: ['Iniciativas', 'Desarrollo de negocio previo o independiente de una oportunidad formal.'],
  clients: ['Clientes', 'Cuentas activas, responsables y oportunidades de desarrollo.'],
  proposals: ['Propuestas / Estimaciones', 'Preventa interna y propuestas externas vinculadas a oportunidades.'],
  agreements: ['Acuerdos Marco', 'Vigencia, responsables y renovaciones de acuerdos comerciales.'],
  crossSelling: ['Cross-Selling', 'Las iniciativas de cross-selling se mantienen independientes de las oportunidades.'],
  towers: ['Towers', 'Gestiona las towers y sus responsables.'],
  people: ['Responsables', 'Personas asignables a clientes, iniciativas y oportunidades.'],
  analytics: ['Informes', 'Indicadores de actividad comercial y evolución del pipeline.'],
  settings: ['Configuración', 'Preferencias de tu cuenta.'],
};

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
  const initials = (name || '?').split(' ').map((part) => part[0]).slice(0, 2).join('');
  return <span className={`avatar${compact ? ' avatar-small' : ''}`} aria-label={name}>{initials}</span>;
}

function App() {
  const [session, setSession] = useState({ status: 'loading', user: null });
  const [opportunities, setOpportunities] = useState([]);
  const [clients, setClients] = useState([]);
  const [towers, setTowers] = useState([]);
  const [people, setPeople] = useState([]);
  const [initiatives, setInitiatives] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [oppState, setOppState] = useState('loading');
  const [page, setPage] = useState('pipeline');
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [towerFilter, setTowerFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [advancedFilters, setAdvancedFilters] = useState(createDefaultAdvancedFilters);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [view, setView] = useState('kanban');
  const [expandedColumns, setExpandedColumns] = useState({});
  const [editing, setEditing] = useState(null);
  const [editingInitiative, setEditingInitiative] = useState(null);
  const [editingAgreement, setEditingAgreement] = useState(null);
  const [masterEditing, setMasterEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState('success');
  const noticeTimerRef = useRef(null);

  const showNotice = (message, tone = 'success') => {
    setNotice(message);
    setNoticeTone(tone);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 2600);
  };

  // Resolve the session on first load.
  useEffect(() => {
    let cancelled = false;
    getMe()
      .then(({ user }) => {
        if (!cancelled) setSession({ status: 'authenticated', user });
      })
      .catch(() => {
        if (!cancelled) setSession({ status: 'anonymous', user: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the shared board whenever the session becomes authenticated.
  useEffect(() => {
    if (session.status !== 'authenticated') return;
    Promise.all([listClients(), listTowers(), listPeople(), listInitiatives(), listAgreements()]).then(([c, t, p, i, a]) => {
      setClients(c.records || []); setTowers(t.records || []); setPeople(p.records || []);
      setInitiatives(i.initiatives || []); setAgreements(a.agreements || []);
    }).catch((err) => {
      if (err?.status === 401) setSession({ status: 'anonymous', user: null });
      else showNotice(err?.message || 'No se pudieron cargar los datos maestros.', 'error');
    });
  }, [session.status]);

  useEffect(() => {
    if (session.status !== 'authenticated') return;
    let cancelled = false;
    setOppState('loading');
    listOpportunities()
      .then(({ opportunities: list }) => {
        if (cancelled) return;
        setOpportunities(Array.isArray(list) ? list : []);
        setOppState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.status === 401) {
          setSession({ status: 'anonymous', user: null });
          return;
        }
        setOppState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [session.status]);

  // Poll so two users see each other's changes without a manual refresh.
  useEffect(() => {
    if (session.status !== 'authenticated') return;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      Promise.all([listOpportunities(), listInitiatives(), listClients(), listTowers(), listPeople(), listAgreements()])
        .then(([{ opportunities: list }, { initiatives: initiativeList }, clientResult, towerResult, peopleResult, agreementResult]) => {
          setOpportunities(Array.isArray(list) ? list : []);
          setInitiatives(Array.isArray(initiativeList) ? initiativeList : []);
          setClients(clientResult.records || []);
          setTowers(towerResult.records || []);
          setPeople(peopleResult.records || []);
          setAgreements(agreementResult.agreements || []);
        })
        .catch((err) => {
          if (err?.status === 401) setSession({ status: 'anonymous', user: null });
        });
    };
    const interval = window.setInterval(refresh, 20000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const onFocus = () => refresh();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [session.status]);

  const pipelineCards = useMemo(() => [
    ...opportunities.map((item) => ({ ...item, entityType: 'opportunity', cardKey: `opportunity:${item.id}` })),
    ...initiatives.map((item) => ({
      ...item,
      account: clients.find((client) => client.id === item.clientId)?.name || 'Sin cliente',
      tower: towers.find((tower) => tower.id === item.towerId)?.name || 'Sin tower',
      owner: people.find((person) => person.id === item.ownerId)?.name || 'Sin responsable',
      amount: formatCurrency(parseAmount(item.amount)),
      due: item.status,
      statusLabel: item.status === 'open' ? 'Abierta' : item.status,
      categoryLabel: initiativeCategory(item.category),
      entityType: 'initiative',
      cardKey: `initiative:${item.id}`,
      sourceRecord: item,
    })),
  ], [opportunities, initiatives, clients, towers, people]);
  const owners = useMemo(() => {
    const records = page === 'pipeline' ? pipelineCards : opportunities;
    return [...new Set(records.map((item) => item.owner).filter(Boolean))].sort();
  }, [page, pipelineCards, opportunities]);
  const filtered = useMemo(() => opportunities.filter((item) => {
    const haystack = `${item.title} ${item.account} ${item.owner} ${item.tower} ${item.id}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase())
      && (stageFilter === 'all' || item.stage === stageFilter)
      && (towerFilter === 'all' || item.tower === towerFilter)
      && (ownerFilter === 'all' || item.owner === ownerFilter);
  }), [opportunities, query, stageFilter, towerFilter, ownerFilter]);
  const filteredPipelineCards = useMemo(() => pipelineCards.filter((item) => {
    const haystack = `${item.title} ${item.account} ${item.owner} ${item.tower} ${item.id} ${item.number || ''} ${item.due || ''} ${(item.tags || []).join?.(' ') || ''} ${item.category || ''} ${item.status || ''} ${item.closureReason || ''}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase())
      && (stageFilter === 'all' || item.stage === stageFilter)
      && (towerFilter === 'all' || item.tower === towerFilter)
      && (ownerFilter === 'all' || item.owner === ownerFilter);
  }), [pipelineCards, query, stageFilter, towerFilter, ownerFilter]);
  const advancedFilteredPipelineCards = useMemo(
    () => filterPipelineCards(filteredPipelineCards, advancedFilters),
    [filteredPipelineCards, advancedFilters],
  );
  const filteredPipelineOpportunities = advancedFilteredPipelineCards.filter((item) => item.entityType === 'opportunity');

  const clearFilters = () => {
    setQuery('');
    setStageFilter('all');
    setTowerFilter('all');
    setOwnerFilter('all');
    setAdvancedFilters(createDefaultAdvancedFilters());
  };

  const navigate = (nextPage) => {
    setPage(nextPage);
    setMobileNav(false);
  };

  const reloadOpportunities = () => {
    listOpportunities()
      .then(({ opportunities: list }) => {
        setOpportunities(Array.isArray(list) ? list : []);
        setOppState('ready');
      })
      .catch((err) => {
        if (err?.status === 401) setSession({ status: 'anonymous', user: null });
      });
    listInitiatives().then(({ initiatives: list }) => setInitiatives(Array.isArray(list) ? list : [])).catch((err) => {
      if (err?.status === 401) setSession({ status: 'anonymous', user: null });
    });
  };

  const moveBoardCard = async (record, stageId) => {
    if (!record || record.stage === stageId) return;
    const isInitiative = record.entityType === 'initiative';
    const currentRecords = isInitiative ? initiatives : opportunities;
    const setRecords = isInitiative ? setInitiatives : setOpportunities;
    const previous = currentRecords;
    setRecords((current) => moveOpportunityToStage(current, record.id, stageId));
    const stage = stages.find((item) => item.id === stageId);
    try {
      const result = isInitiative
        ? await updateInitiative(record.id, { stage: stageId })
        : await updateOpportunity(record.id, { stage: stageId });
      const saved = isInitiative ? result.initiative : result.opportunity;
      setRecords((current) => current.map((item) => (item.id === record.id ? saved : item)));
      showNotice(`«${record.title}» movida a ${stage?.label ?? stageId}.`);
    } catch (err) {
      setRecords(previous);
      showNotice(err?.message || 'No se pudo mover la tarjeta.', 'error');
    }
  };

  const deleteBoardCard = async (record) => {
    const typeLabel = record.entityType === 'initiative' ? 'iniciativa' : 'oportunidad';
    if (!window.confirm(`¿Eliminar la ${typeLabel} «${record.title}»? Esta acción es irreversible y eliminará la tarjeta seleccionada junto con sus acciones e historial.`)) return false;
    try {
      if (record.entityType === 'initiative') {
        await deleteInitiative(record.id);
        setInitiatives((current) => current.filter((item) => item.id !== record.id));
      } else {
        await deleteOpportunity(record.id);
        setOpportunities((current) => current.filter((item) => item.id !== record.id));
      }
      showNotice(`Se eliminó la ${typeLabel} «${record.title}».`);
      return true;
    } catch (err) {
      showNotice(err?.message || `No se pudo eliminar la ${typeLabel}.`, 'error');
      return false;
    }
  };

  const saveOpportunity = async (record) => {
    setSaving(true);
    setSaveError('');
    try {
      const isExisting = opportunities.some((item) => item.id === record.id);
      const payload = {
        title: record.title,
        account: record.account,
        amount: record.amount,
        stage: record.stage,
        tower: record.tower,
        owner: record.owner,
        due: record.due,
        tags: record.tags || [],
        number: record.number || '',
        clientId: record.clientId || '',
        towerId: record.towerId || '',
        ownerId: record.ownerId || '',
        bidManagerId: record.bidManagerId || '',
        qaPercent: Number(record.qaPercent || 0),
        closureReason: record.closureReason || '',
      };
      let opportunity;
      if (isExisting && record.id) {
        ({ opportunity } = await updateOpportunity(record.id, payload));
      } else {
        ({ opportunity } = await createOpportunity(payload));
      }
      setOpportunities((current) => {
        const idx = current.findIndex((item) => item.id === opportunity.id);
        if (idx === -1) return [opportunity, ...current];
        const next = current.slice();
        next[idx] = opportunity;
        return next;
      });
      setHistoryRefresh((value) => value + 1);
      setEditing(null);
      showNotice('Oportunidad guardada correctamente.');
    } catch (err) {
      setSaveError(err?.message || 'No se pudo guardar la oportunidad.');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const saveMaster = async (kind, record) => {
    const existing = Boolean(record.id);
    const fn = {
      clients: existing ? updateClient : createClient,
      towers: existing ? updateTower : createTower,
      people: existing ? updatePerson : createPerson,
    }[kind];
    const result = await fn(...(existing ? [record.id, record] : [record]));
    const saved = result.record;
    const setter = { clients: setClients, towers: setTowers, people: setPeople }[kind];
    setter((current) => existing ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
    setMasterEditing(null);
    showNotice('Registro guardado correctamente.');
    return saved;
  };

  const deactivateMaster = async (kind, record) => {
    const fn = { clients: deactivateClient, people: deactivatePerson }[kind];
    const { record: saved } = await fn(record.id);
    const setter = { clients: setClients, people: setPeople }[kind];
    setter((current) => current.map((item) => item.id === saved.id ? saved : item));
    showNotice('Registro desactivado. Sus vínculos se mantienen.');
  };

  const removeTower = async (record) => {
    if (!window.confirm(`¿Eliminar la tower «${record.name}»? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteTower(record.id);
      setTowers((current) => current.filter((item) => item.id !== record.id));
      showNotice('Tower eliminada correctamente.');
    } catch (err) {
      showNotice(err?.message || 'No se pudo eliminar la tower.', 'error');
    }
  };

  const saveInitiative = async (record) => {
    const { initiative } = record.id ? await updateInitiative(record.id, record) : await createInitiative(record);
    setInitiatives((current) => record.id ? current.map((item) => item.id === initiative.id ? initiative : item) : [initiative, ...current]);
    setEditingInitiative(null);
    showNotice('Iniciativa guardada correctamente.');
  };

  const saveAgreement = async (record) => {
    const { agreement } = await createAgreement(record);
    setAgreements((current) => [agreement, ...current]);
    setEditingAgreement(null);
    showNotice('Acuerdo marco guardado correctamente.');
  };

  const handleAuthenticated = (user) => {
    setSession({ status: 'authenticated', user });
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Ignore network errors on logout; local state is cleared anyway.
    }
    setSession({ status: 'anonymous', user: null });
    setOpportunities([]);
    setOppState('loading');
    setPage('pipeline');
  };

  if (session.status === 'loading') {
    return (
      <div className="boot-screen">
        <img className="brand-logo" src="/logo-seidor.jpeg" alt="SEIDOR" />
        <p>Cargando…</p>
      </div>
    );
  }

  if (session.status === 'anonymous') {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  const user = session.user;
  const activePage = page === 'home' ? 'home' : page;
  const [title, subtitle] = pageTitles[activePage] || pageTitles.pipeline;
  const opportunityMetric = opportunities.length;

  return (
    <div className="app-shell">
      <aside className={`sidebar${mobileNav ? ' sidebar-open' : ''}`} aria-label="Navegación principal">
        <div className="brand"><img className="brand-logo" src="/logo-seidor.jpeg" alt="SEIDOR" /></div>
        <div className="workspace-label">GESTIÓN COMERCIAL</div>
            <nav className="side-nav">
          {navItems.map((item) => <button key={item.id} className={`nav-item${page === item.id ? ' selected' : ''}`} onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}>
            <Icon name={item.icon} size={18} /><span>{item.label}</span>{item.id === 'pipeline' && <span className="nav-count">{opportunities.length}</span>}
          </button>)}
        </nav>
        <div className="sidebar-footer"><span className="footer-dot" /> CRM QE <span className="footer-version">v1.0</span></div>
      </aside>
      {mobileNav && <button className="nav-backdrop" aria-label="Cerrar navegación" onClick={() => setMobileNav(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Abrir navegación" onClick={() => setMobileNav(true)}><Icon name="list" /></button>
          <div className="breadcrumbs"><span>SEIDOR</span><Icon name="chevron" size={14} /><strong>{title}</strong></div>
          <label className="global-search"><Icon name="search" size={17} /><span className="sr-only">Buscar en CRM QE</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente, oportunidad..." /><kbd>⌘ K</kbd></label>
          <button className="icon-button notification-button" aria-label="Notificaciones"><Icon name="bell" size={19} /><span className="notification-dot" /></button>
          <div className="user-menu">
            <Avatar name={user.name} />
            <span><strong>{user.name}</strong><small>{user.email}</small></span>
          </div>
          <button className="button button-secondary topbar-logout" onClick={handleLogout} aria-label="Cerrar sesión">
            <Icon name="close" size={16} /> <span>Cerrar sesión</span>
          </button>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div><div className="eyebrow"><span className="eyebrow-dot" /> ESPAÑA <span className="eyebrow-divider">/</span> QUALITY ENGINEERING</div><h1>{title}</h1><p>{subtitle}</p></div>
            <div className="heading-actions">{['clients', 'towers', 'people'].includes(page) && <button className="button button-primary" onClick={() => setMasterEditing({ kind: page })}><Icon name="plus" size={17} /> {page === 'clients' ? 'Nuevo cliente' : page === 'towers' ? 'Nueva tower' : 'Nuevo responsable'}</button>}{(['initiatives', 'crossSelling'].includes(page) || page === 'pipeline') && <button className="button button-primary" onClick={() => setEditingInitiative(page === 'crossSelling' ? { category: 'cross_selling' } : {})}><Icon name="plus" size={17} /> Nueva iniciativa</button>}{page === 'agreements' && <button className="button button-primary" onClick={() => setEditingAgreement({})}><Icon name="plus" size={17} /> Nuevo acuerdo</button>}{['pipeline', 'opportunities'].includes(page) && <button className="button button-primary" onClick={() => setEditing({})}><Icon name="plus" size={18} /> Nueva oportunidad</button>}</div>
          </div>

          {page === 'pipeline' ? <>
            <section className="kpi-grid" aria-label="Indicadores principales">
              <Kpi icon="users" color="blue" label="Clientes activos" value={String(clients.filter((item) => item.active).length)} detail="Registros activos" />
              <Kpi icon="target" color="violet" label="Oportunidades" value={String(opportunityMetric)} detail="Registros actuales" />
              <Kpi icon="arrow" color="orange" label="Propuestas externas" value={String(proposals.filter((item) => item.type === 'Externa').length)} detail="Datos de referencia" />
              <Kpi icon="file" color="teal" label="Propuestas internas / Estimaciones" value={String(proposals.filter((item) => item.type === 'Interna').length)} detail="Datos de referencia" />
              <Kpi icon="layers" color="blue" label="Acuerdos Marco" value={String(agreements.filter((item) => item.status === 'active').length)} detail="Registros activos" />
              <Kpi icon="chart" color="green" label="Pipeline QE" value={formatCurrency([...opportunities, ...initiatives].reduce((sum, item) => sum + parseAmount(item.amount), 0))} detail="Valor estimado" />
            </section>
            <div className="pipeline-toolbar">
              <div className="toolbar-title"><h2>Pipeline comercial</h2><span className="live-pill"><span /> Actualizado ahora</span></div>
            <div className="toolbar-controls">
                <label className="filter-select"><span className="sr-only">Filtrar por etapa</span><Icon name="filter" size={15} /><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="all">Todas las etapas</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
                <label className="filter-select"><span className="sr-only">Filtrar por torre</span><select value={towerFilter} onChange={(event) => setTowerFilter(event.target.value)}><option value="all">Todas las Towers</option>{towers.map((tower) => <option key={tower.id} value={tower.name}>{tower.name}</option>)}</select></label>
                <label className="filter-select owner-filter"><span className="sr-only">Filtrar por responsable</span><select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="all">Todos los responsables</option>{owners.map((owner) => <option key={owner}>{owner}</option>)}</select></label>
                {page === 'pipeline' && <button type="button" className="advanced-filter-toggle" aria-expanded={advancedFiltersOpen} aria-controls="advanced-filters-panel" onClick={() => setAdvancedFiltersOpen((open) => !open)}><Icon name="filter" size={15} /> Filtros avanzados</button>}
                <div className="view-switch" aria-label="Tipo de vista">{[['kanban', 'grid', 'Kanban'], ['list', 'list', 'Lista'], ['table', 'table', 'Tabla']].map(([id, icon, label]) => <button key={id} title={label} aria-label={`Vista ${label}`} aria-pressed={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon name={icon} size={16} /></button>)}</div>
              </div>
            </div>
            {page === 'pipeline' && <AdvancedFilters filters={advancedFilters} people={people} hidden={!advancedFiltersOpen} onChange={(name, value) => setAdvancedFilters((current) => ({ ...current, [name]: value }))} />}
            <div className="results-line"><span><strong>{page === 'pipeline' ? (view === 'kanban' ? advancedFilteredPipelineCards.length : filteredPipelineOpportunities.length) : filtered.length}</strong> {page === 'pipeline' && view === 'kanban' ? 'registros encontrados' : 'oportunidades encontradas'}</span><button onClick={clearFilters}>Limpiar filtros <Icon name="close" size={13} /></button></div>
            {oppState === 'loading' && <div className="board-state"><p>Cargando oportunidades…</p></div>}
            {oppState === 'error' && <div className="board-state"><p>No se pudieron cargar las oportunidades.</p><button className="button button-secondary" onClick={reloadOpportunities}>Reintentar</button></div>}
            {view === 'kanban' ? <Kanban cards={page === 'pipeline' ? advancedFilteredPipelineCards : filtered} allCards={page === 'pipeline' ? pipelineCards : opportunities} expandedColumns={expandedColumns} onToggleColumn={(stageId) => setExpandedColumns((current) => toggleColumnExpanded(current, stageId))} onEdit={(record) => record.entityType === 'initiative' ? setEditingInitiative(record.sourceRecord) : setEditing(record)} onMove={moveBoardCard} onDelete={deleteBoardCard} /> : <OpportunityRows opportunities={page === 'pipeline' ? filteredPipelineOpportunities : filtered} view={view} onEdit={setEditing} />}
          </> : page === 'opportunities'
            ? <OpportunityManagementPanel opportunities={opportunities.filter((item) => `${item.id} ${item.number} ${item.title} ${item.account} ${item.tower} ${item.owner} ${item.bidManager} ${item.due} ${item.closureReason}`.toLowerCase().includes(query.trim().toLowerCase()))} onEdit={setEditing} loading={oppState === 'loading'} error={oppState === 'error'} onRetry={reloadOpportunities} searchQuery={query} onClearSearch={() => setQuery('')} />
            : <SecondaryPage page={page} opportunities={opportunities} clients={clients} towers={towers} people={people} initiatives={initiatives} agreements={agreements} onNavigate={navigate} user={user} onLogout={handleLogout} onEditInitiative={setEditingInitiative} onEditMaster={(kind, record) => setMasterEditing({ kind, ...record })} onDeactivateMaster={deactivateMaster} onDeleteTower={removeTower} onEditAgreement={setEditingAgreement} />}
          <footer className="main-footer"><span>CRM QE <b>·</b> Herramienta complementaria al CRM corporativo</span><span>Los importes reflejan oportunidades estimadas, no ingresos contratados.</span></footer>
        </div>
      </main>
      {editing !== null && <OpportunityDialog record={editing} clients={clients} towers={towers} people={people} onQuickCreate={(kind, onCreated) => setMasterEditing({ kind, onCreated })} onClose={() => { setEditing(null); setSaveError(''); }} onSave={saveOpportunity} saving={saving} saveError={saveError} historyRefresh={historyRefresh} />}
      {editingInitiative !== null && <InitiativeDialog record={editingInitiative} clients={clients} towers={towers} people={people} onQuickCreate={(kind, onCreated) => setMasterEditing({ kind, onCreated })} onClose={() => setEditingInitiative(null)} onSave={saveInitiative} />}
      {editingAgreement !== null && <AgreementDialog clients={clients} people={people} onQuickCreate={(kind, onCreated) => setMasterEditing({ kind, onCreated })} onClose={() => setEditingAgreement(null)} onSave={saveAgreement} />}
      {masterEditing !== null && <MasterDialog kind={masterEditing.kind} record={masterEditing} people={people} onClose={() => setMasterEditing(null)} onSave={saveMaster} onSaved={(record) => masterEditing.onCreated?.(record.id)} />}
      {notice && <div className={`toast${noticeTone === 'error' ? ' toast-error' : ''}`} role="status"><Icon name="check" size={16} />{notice}</div>}
    </div>
  );
}

function Kpi({ icon, color, label, value, detail, trend }) {
  return <article className="kpi-card"><div className={`kpi-icon ${color}`}><Icon name={icon} size={18} /></div><div className="kpi-content"><span>{label}</span><div className="kpi-value-row"><strong>{value}</strong>{trend && <span className="trend-badge">↗ 20%</span>}</div><small>{detail}</small></div></article>;
}

function AdvancedFilters({ filters, people, hidden, onChange }) {
  const field = (name, label, type = 'text', options = null) => (
    <label className="advanced-filter-field" key={name}>
      <span>{label}</span>
      {options
        ? <select value={filters[name]} onChange={(event) => onChange(name, event.target.value)}>{options.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}</select>
        : <input type={type} value={filters[name]} onChange={(event) => onChange(name, event.target.value)} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 'any' : undefined} />}
    </label>
  );
  return <section className="advanced-filters-panel" id="advanced-filters-panel" aria-label="Filtros avanzados del pipeline" hidden={hidden}>
    {field('entityType', 'Tipo de registro', 'text', [['all', 'Todos'], ['opportunity', 'Oportunidad'], ['initiative', 'Iniciativa']])}
    {field('account', 'Cliente / cuenta')}
    {field('category', 'Categoría de iniciativa', 'text', [['all', 'Todas'], ['internal', 'Interna'], ['cross_selling', 'Cross-Selling'], ['external', 'Prospección externa']])}
    {field('bidManagerId', 'Bid Manager', 'text', [['all', 'Todos'], ...people.map((person) => [person.id, person.name])])}
    {field('minAmount', 'Importe mínimo', 'number')}
    {field('maxAmount', 'Importe máximo', 'number')}
    {field('minQaPercent', 'QA mínimo (%)', 'number')}
    {field('maxQaPercent', 'QA máximo (%)', 'number')}
    {field('status', 'Estado de iniciativa')}
    {field('externalNumber', 'N.º externo')}
    {field('due', 'Próximo hito')}
    {field('tags', 'Etiquetas')}
    {field('closureReason', 'Motivo de cierre')}
    {field('createdFrom', 'Creado desde', 'date')}
    {field('createdTo', 'Creado hasta', 'date')}
    {field('updatedFrom', 'Actualizado desde', 'date')}
    {field('updatedTo', 'Actualizado hasta', 'date')}
  </section>;
}

function Kanban({ cards, allCards, expandedColumns, onToggleColumn, onEdit, onMove, onDelete }) {
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);
  const suppressClickRef = useRef(false);
  const handleCardClick = (record) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    onEdit(record);
  };
  const handleDragStart = (event, record) => {
    suppressClickRef.current = true;
    setDraggingId(record.cardKey || record.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', record.cardKey || record.id);
  };
  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverStage(null);
    window.requestAnimationFrame(() => { suppressClickRef.current = false; });
  };
  const handleDragOver = (event, stageId) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverStage(stageId);
  };
  const handleDragLeave = (event, stageId) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setDragOverStage((current) => current === stageId ? null : current);
  };
  const handleDrop = (event, stageId) => {
    event.preventDefault();
    const key = event.dataTransfer.getData('text/plain') || draggingId;
    setDraggingId(null);
    setDragOverStage(null);
    const record = allCards.find((item) => (item.cardKey || item.id) === key);
    if (record) onMove(record, stageId);
  };
  return <div className="kanban-board" aria-label="Pipeline comercial por etapa">
    <p className="sr-only">Arrastra las tarjetas entre columnas o abre una tarjeta y cambia la etapa.</p>
    {stages.map((stage) => {
      const stageCards = cards.filter((item) => item.stage === stage.id);
      const totalCount = allCards.filter((item) => item.stage === stage.id).length;
      const isExpanded = Boolean(expandedColumns[stage.id]);
      const { visibleCards, hiddenCount, canToggle } = getColumnVisibility(stageCards, isExpanded);
      return <section className={`kanban-column ${stage.id}${dragOverStage === stage.id ? ' drag-over' : ''}`} key={stage.id} aria-label={`${stage.label}: ${totalCount} registros totales`} onDragEnter={(event) => handleDragOver(event, stage.id)} onDragOver={(event) => handleDragOver(event, stage.id)} onDragLeave={(event) => handleDragLeave(event, stage.id)} onDrop={(event) => handleDrop(event, stage.id)}>
        <div className={`column-heading ${stage.tone}`}><span className="stage-indicator" /><h3>{stage.label}</h3><span className="column-count">{totalCount}</span><button className="column-menu" aria-label={`Opciones de ${stage.label}`}><Icon name="dots" size={17} /></button></div>
        <div className="column-cards">{visibleCards.map((record) => <OpportunityCard key={record.cardKey || record.id} record={record} onCardClick={handleCardClick} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDelete={onDelete} isDragging={draggingId === (record.cardKey || record.id)} />)}{stageCards.length === 0 && <div className="empty-column">No hay registros para estos filtros.</div>}</div>
        {(canToggle || (isExpanded && totalCount > COLLAPSED_CARD_LIMIT)) && <button className="show-more" aria-expanded={isExpanded} onClick={() => onToggleColumn(stage.id)}>{isExpanded ? '− Ver menos' : `+ Ver más (${hiddenCount})`}</button>}
      </section>;
    })}
  </div>;
}

function OpportunityCard({ record, onCardClick, onDragStart, onDragEnd, onDelete, isDragging }) {
  const stage = stages.find((item) => item.id === record.stage);
  const isInitiative = record.entityType === 'initiative';
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const actionRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    actionRef.current?.focus();
    const handlePointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const handleFocusIn = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);
  const handleDelete = async () => {
    setDeleting(true);
    const deleted = await onDelete(record);
    setDeleting(false);
    if (deleted) setMenuOpen(false);
  };
  const handleDragStart = (event) => {
    if (event.target.closest?.('[data-card-menu]')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onDragStart(event, record);
  };
  return <article className={`opportunity-card${isInitiative ? ' initiative-card' : ''}${isDragging ? ' dragging' : ''}`} draggable onDragStart={handleDragStart} onDragEnd={onDragEnd}>
    <button type="button" className="card-body-button" onClick={() => onCardClick(record)} title="Arrastra para cambiar de etapa" aria-label={`Editar ${isInitiative ? 'iniciativa' : 'oportunidad'} ${record.title}, ${record.account}`}>
      <div className="card-top"><span className="opportunity-id">{record.id}</span>{isInitiative ? <span className="initiative-type-pill">Iniciativa · {record.categoryLabel}</span> : record.number && <span className="external-opportunity-number">N.º {record.number}</span>}<span className={`card-stage-dot ${stage.tone}`} title={stage.label} /></div>
      <h4>{record.title}</h4><div className="card-client"><span className="client-glyph">{(record.account || '—').charAt(0)}</span><span>{record.account || 'Sin cliente'}</span></div>
      <div className="card-value-row"><strong>{record.amount}</strong><span className="tower-pill">{record.tower}</span></div>
      <div className="card-bottom"><span className="card-date"><Icon name={isInitiative ? 'clock' : record.due.includes('Ganada') ? 'check' : 'calendar'} size={13} />{isInitiative ? record.statusLabel : record.due}</span><span className="card-owner"><Avatar name={record.owner} compact /></span></div>
    </button>
    <div className="card-menu-container" ref={menuRef} data-card-menu>
      <button type="button" className="card-menu-button" ref={triggerRef} draggable={false} aria-label={`Opciones de ${isInitiative ? 'iniciativa' : 'oportunidad'} ${record.title}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Icon name="dots" size={16} /></button>
      {menuOpen && <div className="card-menu-popup" role="menu"><button type="button" role="menuitem" ref={actionRef} disabled={deleting} onClick={handleDelete}>Eliminar</button></div>}
    </div>
  </article>;
}

function OpportunityRows({ opportunities, view, onEdit }) {
  if (view === 'table') return <div className="table-wrap"><table className="data-table"><thead><tr><th>ID / Oportunidad</th><th>Cliente</th><th>Etapa</th><th>Tower</th><th>Importe estimado</th><th>Responsable</th><th>Próximo hito</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{opportunities.map((item) => <tr key={item.id}><td><span className="table-id">ID interno: {item.id}{item.number && ` · N.º externo: ${item.number}`}</span><button className="table-title" onClick={() => onEdit(item)}>{item.title}</button></td><td>{item.account}</td><td><span className={`status-pill ${stages.find((stage) => stage.id === item.stage).tone}`}>{stages.find((stage) => stage.id === item.stage).label}</span></td><td>{item.tower}</td><td className="table-amount">{item.amount}</td><td><span className="table-owner"><Avatar name={item.owner} compact />{item.owner}</span></td><td>{item.due}</td><td><button className="icon-button row-edit" onClick={() => onEdit(item)} aria-label={`Editar ${item.title}`}><Icon name="dots" size={17} /></button></td></tr>)}</tbody></table>{opportunities.length === 0 && <p className="empty-state">No hay oportunidades que coincidan con los filtros.</p>}</div>;
  return <div className="list-view">{opportunities.map((item) => <button className="list-row" key={item.id} onClick={() => onEdit(item)}><span className="list-accent" /><span className="list-main"><small>{item.id}{item.number && ` · N.º ${item.number}`} <span>·</span> {item.account}</small><strong>{item.title}</strong></span><span className="list-stage"><i className={stages.find((stage) => stage.id === item.stage).tone} />{stages.find((stage) => stage.id === item.stage).label}</span><span className="list-tower">{item.tower}</span><strong className="list-amount">{item.amount}</strong><span className="table-owner"><Avatar name={item.owner} compact />{item.owner}</span><span className="list-date"><Icon name="calendar" size={14} />{item.due}</span><Icon name="chevron" size={16} /></button>)}{opportunities.length === 0 && <p className="empty-state">No hay oportunidades que coincidan con los filtros.</p>}</div>;
}

function SecondaryPage({ page, opportunities, clients, towers, people, initiatives, agreements, onNavigate, user, onLogout, onEditInitiative, onEditMaster, onDeactivateMaster, onDeleteTower, onEditAgreement }) {
  const grouped = towers.map((tower) => ({ tower: tower.name, count: opportunities.filter((item) => item.towerId === tower.id || item.tower === tower.name).length, amount: opportunities.filter((item) => item.towerId === tower.id || item.tower === tower.name).reduce((sum, item) => sum + parseAmount(item.amount), 0) }));
  const displayedInitiatives = page === 'crossSelling' ? initiatives.filter((item) => item.category === 'cross_selling') : initiatives;
  if (page === 'home') return <section className="secondary-home"><div className="welcome-panel"><div><div className="eyebrow">ACTIVIDAD COMERCIAL</div><h2>Buen día, {user?.name?.split(' ')[0] || 'equipo'}</h2><p>Resumen de los registros actuales de CRM QE.</p></div><button className="button button-primary" onClick={() => onNavigate('pipeline')}>Ir al pipeline <Icon name="arrow" size={16} /></button></div><div className="secondary-grid"><SummaryCard title="Oportunidades recientes" action="Ver pipeline" onAction={() => onNavigate('pipeline')}><div className="recent-list">{opportunities.slice(0, 4).map((item) => <div className="recent-item" key={item.id}><span className="recent-dot" /><span><strong>{item.title}</strong><small>{item.account || 'Sin cliente'} · {item.tower || 'Sin tower'}</small></span><b>{item.amount}</b></div>)}{opportunities.length === 0 && <p className="empty-state">Todavía no hay oportunidades.</p>}</div></SummaryCard><SummaryCard title="Siguientes pasos" action="Ver iniciativas" onAction={() => onNavigate('initiatives')}><div className="task-list"><p>Las notas y acciones pendientes se registran en cada iniciativa u oportunidad.</p></div></SummaryCard></div></section>;
  if (page === 'settings') return <div className="settings-note"><div className="kpi-icon blue"><Icon name="settings" /></div><div><h2>Cuenta y sesión</h2><dl className="account-details"><div><dt>Nombre</dt><dd>{user?.name}</dd></div><div><dt>Email</dt><dd>{user?.email}</dd></div><div><dt>Rol</dt><dd>{user?.role === 'admin' ? 'Administrador' : 'Miembro'}</dd></div></dl><p className="settings-help">El tablero es compartido por todos los usuarios autenticados, que tienen los mismos permisos para consultar y modificar sus registros. Cada acción sobre una tarjeta queda registrada en su historial.</p><button className="button button-secondary" onClick={onLogout}>Cerrar sesión</button></div></div>;
  if (page === 'clients') return <MasterPanel title="Clientes" records={clients} kind="clients" headers={['Cliente', 'Sector']} onEdit={onEditMaster} onDeactivate={onDeactivateMaster} />;
  if (page === 'towers') return <MasterPanel title="Towers" records={towers} kind="towers" headers={['Tower', 'Responsable']} onEdit={onEditMaster} onDelete={onDeleteTower} />;
  if (page === 'people') return <MasterPanel title="Responsables" records={people} kind="people" headers={['Nombre', 'Email']} onEdit={onEditMaster} onDeactivate={onDeactivateMaster} />;
  if (page === 'initiatives' || page === 'crossSelling') return <section className="secondary-panel"><div className="secondary-panel-heading"><div><h2>{page === 'crossSelling' ? 'Iniciativas de Cross-Selling' : 'Iniciativas de desarrollo'}</h2><p>{page === 'crossSelling' ? 'Registros de iniciativas de cross-selling, independientes de las oportunidades.' : 'Las iniciativas son registros independientes de las oportunidades.'}</p></div><span className="record-count">{displayedInitiatives.length} registros</span></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Iniciativa</th><th>Tipo</th><th>Cliente</th><th>Tower</th><th>Responsable</th><th>Importe</th><th>Estado</th><th></th></tr></thead><tbody>{displayedInitiatives.map((item) => <tr key={item.id}><td><button className="table-title" onClick={() => onEditInitiative(item)}>{item.title}</button></td><td>{initiativeCategory(item.category)}</td><td>{clients.find((x) => x.id === item.clientId)?.name || '—'}</td><td>{towers.find((x) => x.id === item.towerId)?.name || '—'}</td><td>{people.find((x) => x.id === item.ownerId)?.name || '—'}</td><td>{formatCurrency(parseAmount(item.amount))}</td><td>{item.status}</td><td><button className="button button-secondary" onClick={() => onEditInitiative(item)}>Editar</button></td></tr>)}</tbody></table>{displayedInitiatives.length === 0 && <p className="empty-state">{page === 'crossSelling' ? 'Todavía no hay iniciativas de cross-selling.' : 'Todavía no hay iniciativas.'}</p>}</div></section>;
  if (page === 'proposals') return <DataPanel title="Preventa y estimaciones" description="Cada propuesta conserva su propio estado y queda vinculada a una oportunidad cuando existe." headers={['ID', 'Propuesta / estimación', 'Cliente', 'Tipo', 'Importe', 'Estado', 'Oportunidad vinculada']} rows={proposals.map((item) => [item.id, item.title, item.client, item.type, item.amount, item.status, item.opportunity])} />;
  if (page === 'agreements') return <DataPanel title="Acuerdos vigentes y renovaciones" description="Acuerdos marco persistidos. Los contratos y aprobaciones se gestionan en los sistemas corporativos." headers={['ID', 'Acuerdo', 'Cliente', 'Fin de vigencia', 'Responsable', 'Estado']} rows={agreements.map((item) => [item.id.slice(0, 8), item.title, clients.find((x) => x.id === item.clientId)?.name || '—', item.endDate || '—', people.find((x) => x.id === item.ownerId)?.name || '—', item.status === 'active' ? 'Vigente' : 'Inactivo'])} />;
  return <Analytics opportunities={opportunities} grouped={grouped} />;
}

function SummaryCard({ title, action, onAction, children }) {
  return <section className="panel-card"><div className="panel-heading"><h3>{title}</h3><button onClick={onAction}>{action} <Icon name="arrow" size={14} /></button></div>{children}</section>;
}

function DataPanel({ title, description, headers, rows }) {
  return <section className="secondary-panel"><div className="secondary-panel-heading"><div><h2>{title}</h2><p>{description}</p></div><span className="record-count">{rows.length} registros</span></div><div className="table-wrap"><table className="data-table secondary-table"><thead><tr>{headers.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cellIndex === row.length - 1 ? <span className={`status-pill ${String(cell).toLowerCase().includes('vigente') || cell === 'Activo' || cell === 'Ganada' ? 'green' : 'violet'}`}>{cell}</span> : cell}</td>)}</tr>)}</tbody></table></div><div className="panel-footnote"><span className="info-mark">i</span> Los datos de propuestas y estimaciones se conservan como referencia mientras se define su gestión persistente.</div></section>;
}

function OpportunityManagementPanel({ opportunities, onEdit, loading, error, onRetry, searchQuery, onClearSearch }) {
  return <section className="secondary-panel opportunity-management-panel">
    <div className="secondary-panel-heading">
      <div><h2>Oportunidades</h2><p>Registros comerciales independientes de las iniciativas.</p></div>
      <span className="record-count">{opportunities.length} registros</span>
    </div>
    {loading && <div className="board-state"><p>Cargando oportunidades…</p></div>}
    {error && <div className="board-state"><p>No se pudieron cargar las oportunidades.</p><button className="button button-secondary" onClick={onRetry}>Reintentar</button></div>}
    {!loading && !error && <div className="table-wrap"><table className="data-table opportunity-management-table"><thead><tr>
      <th>ID interno</th><th>N.º externo</th><th>Oportunidad</th><th>Cliente</th><th>Etapa</th><th>Tower</th><th>Responsable</th><th>Bid Manager</th><th>Importe</th><th>QA %</th><th>Próximo hito</th><th>Motivo de cierre</th><th>Acciones</th>
    </tr></thead><tbody>{opportunities.map((item) => {
      const stage = stages.find((entry) => entry.id === item.stage);
      return <tr key={item.id}>
        <td>{item.id}</td><td>{item.number || '—'}</td><td><button className="table-title" onClick={() => onEdit(item)}>{item.title}</button></td>
        <td>{item.account || '—'}</td><td><span className={`status-pill ${stage?.tone || ''}`}>{stage?.label || item.stage}</span></td><td>{item.tower || '—'}</td>
        <td>{item.owner || '—'}</td><td>{item.bidManager || '—'}</td><td className="table-amount">{item.amount}</td><td>{Number(item.qaPercent || 0)}%</td>
        <td>{item.due || '—'}</td><td>{item.closureReason || '—'}</td><td><button className="button button-secondary" onClick={() => onEdit(item)}>Editar</button></td>
      </tr>;
    })}</tbody></table>
    {opportunities.length === 0 && <div className="empty-state opportunity-empty-state"><p>{searchQuery ? 'No hay oportunidades que coincidan con la búsqueda.' : 'Todavía no hay oportunidades.'}</p>{searchQuery && <button className="button button-secondary" onClick={onClearSearch}>Limpiar búsqueda</button>}</div>}
    </div>}
  </section>;
}

function Analytics({ opportunities, grouped }) {
  const totalAmount = opportunities.reduce((sum, item) => sum + parseAmount(item.amount), 0);
  const max = Math.max(...grouped.map((item) => item.count), 1);
  return <div className="analytics-layout"><section className="panel-card analytics-card"><div className="panel-heading"><div><h3>Oportunidades por Tower</h3><p>Registros del pipeline actual</p></div><span className="range-pill">Últimos 90 días <Icon name="chevron" size={13} /></span></div><div className="bar-chart">{grouped.map((item) => <div className="bar-row" key={item.tower}><span>{item.tower}</span><div className="bar-track"><i style={{ width: `${Math.max(5, item.count / max * 100)}%` }} /></div><strong>{item.count}</strong></div>)}</div></section><section className="panel-card analytic-summary"><div className="panel-heading"><h3>Resumen del pipeline</h3><span className="period-badge">Este trimestre</span></div><div className="summary-number"><small>Importe estimado en oportunidades</small><strong>{formatCurrency(totalAmount)}</strong><span>No equivale a ingreso contratado ni a valor influido del CRM corporativo.</span></div><div className="summary-divider" /><div className="mini-metric"><span>Oportunidades registradas</span><strong>{opportunities.length}</strong></div><div className="mini-metric"><span>En propuesta</span><strong>{opportunities.filter((item) => item.stage === 'proposal').length}</strong></div><div className="mini-metric"><span>Ganadas</span><strong>{opportunities.filter((item) => item.stage === 'won').length}</strong></div></section></div>;
}

function OpportunityDialog({ record, clients, towers, people, onQuickCreate, onClose, onSave, saving, saveError, historyRefresh }) {
  const dialogRef = useRef(null);
  const amountInputRef = useRef(null);
  const isEditing = Boolean(record.id);
  const [form, setForm] = useState({
    id: record.id || '',
    title: record.title || '', account: record.account || '',
    stage: record.stage || 'prospecting', tower: record.tower || '', owner: record.owner || '',
    due: record.due || '', tags: record.tags || [], number: record.number || '',
    clientId: record.clientId || '', towerId: record.towerId || '', ownerId: record.ownerId || '', bidManagerId: record.bidManagerId || '', qaPercent: record.qaPercent ?? 0, closureReason: record.closureReason || '',
  });
  const [amountText, setAmountText] = useState(() => formatAmountInput(record.amount || ''));
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  useEffect(() => {
    if (saveError) setError(saveError);
  }, [saveError]);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const handleAmountChange = (event) => {
    const input = event.target;
    const caret = input.selectionStart ?? input.value.length;
    const digitsBefore = input.value.slice(0, caret).replace(/[^0-9,]/g, '').length;
    const formatted = formatAmountInput(input.value);
    setAmountText(formatted);
    window.requestAnimationFrame(() => {
      const field = amountInputRef.current;
      if (!field) return;
      let position = 0;
      let seen = 0;
      while (position < formatted.length && seen < digitsBefore) {
        if (/[0-9,]/.test(formatted[position])) seen += 1;
        position += 1;
      }
      field.setSelectionRange(position, position);
    });
  };
  const handleAmountBlur = () => setAmountText(formatAmountInput(amountText.replace(/,+$/, '')));
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!form.title.trim()) { setError('Completa el nombre de la oportunidad.'); return; }
    const amount = parseAmount(amountText);
    if (!(amount >= 0)) { setError('El importe debe ser igual o superior a cero.'); return; }
    if (Number(form.qaPercent) < 0 || Number(form.qaPercent) > 100) { setError('La participación QA debe estar entre 0 y 100 %.'); return; }
    setError('');
    try {
      await onSave({
        id: form.id,
        title: form.title.trim(),
        account: clients.find((item) => item.id === form.clientId)?.name || form.account.trim(),
        amount: formatCurrency(amount),
        stage: form.stage,
        tower: towers.find((item) => item.id === form.towerId)?.name || form.tower,
        owner: people.find((item) => item.id === form.ownerId)?.name || form.owner,
        due: form.due.trim() || 'Por definir',
        tags: form.tags,
        number: form.number.trim(), clientId: form.clientId, towerId: form.towerId, ownerId: form.ownerId,
        bidManagerId: form.bidManagerId, qaPercent: Number(form.qaPercent), closureReason: form.closureReason.trim(),
      });
    } catch {
      // The parent surfaces the API message through saveError.
    }
  };

  return <dialog ref={dialogRef} className="opportunity-dialog" aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form onSubmit={submit}>
      <div className="dialog-heading"><div><span className="eyebrow">CRM QE · OPORTUNIDAD</span><h2 id="dialog-title">{isEditing ? 'Editar oportunidad' : 'Nueva oportunidad'}</h2><p>Registra el seguimiento QE. No reemplaza la oportunidad del CRM corporativo.</p></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose} disabled={saving}><Icon name="close" /></button></div>
      <div className="form-grid">
        <label className="form-field wide">Nombre de la oportunidad *<input autoFocus value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="Ej. Modernización de plataforma de datos" required disabled={saving} /></label>
        <label className="form-field">Número de oportunidad<input value={form.number} onChange={(event) => update('number', event.target.value)} placeholder="Identificador externo" disabled={saving} /></label>
        <label className="form-field">Cliente / cuenta<select value={form.clientId} onChange={(event) => update('clientId', event.target.value)} disabled={saving}><option value="">Sin cliente asociado</option>{clients.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('clients', (id) => { update('clientId', id); setForm((current) => ({ ...current, clientId: id, account: clients.find((item) => item.id === id)?.name || current.account })); })}>+ Crear cliente</button></label>
        <label className="form-field">Importe estimado *<span className="amount-field"><input ref={amountInputRef} value={amountText} onChange={handleAmountChange} onBlur={handleAmountBlur} inputMode="decimal" autoComplete="off" placeholder="125.000,00" required disabled={saving} /><span className="amount-suffix" aria-hidden="true">{AMOUNT_CURRENCY}</span></span></label>
        <label className="form-field">Etapa<select value={form.stage} onChange={(event) => update('stage', event.target.value)} disabled={saving}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
        <label className="form-field">Tower<select value={form.towerId} onChange={(event) => update('towerId', event.target.value)} disabled={saving}><option value="">Sin tower asociada</option>{towers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('towers', (id) => update('towerId', id))}>+ Crear tower</button></label>
        <label className="form-field">Responsable<select value={form.ownerId} onChange={(event) => update('ownerId', event.target.value)} disabled={saving}><option value="">Sin responsable</option>{people.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('people', (id) => update('ownerId', id))}>+ Crear responsable</button></label>
        <label className="form-field">Bid Manager<select value={form.bidManagerId} onChange={(event) => update('bidManagerId', event.target.value)} disabled={saving}><option value="">Sin asignar</option>{people.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('people', (id) => update('bidManagerId', id))}>+ Crear responsable</button></label>
        <label className="form-field">Participación del equipo QA (%)<input type="number" min="0" max="100" value={form.qaPercent} onChange={(event) => update('qaPercent', event.target.value)} disabled={saving} /></label>
        {(form.stage === 'won' || form.stage === 'lost') && <label className="form-field wide">Motivo de cierre<input value={form.closureReason} onChange={(event) => update('closureReason', event.target.value)} maxLength="160" disabled={saving} /></label>}
        <label className="form-field">Próximo hito<input value={form.due} onChange={(event) => update('due', event.target.value)} placeholder="Ej. 20 jun" disabled={saving} /></label>
      </div>
      {isEditing && <CardHistory opportunityId={form.id} refreshKey={historyRefresh} />}
      {isEditing && <RecordActions type="opportunities" id={form.id} />}
      <div className="dialog-hint"><span className="info-mark">i</span> Las propuestas y estimaciones se gestionan como registros independientes vinculados.</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : 'Crear oportunidad')}</button></div>
    </form>
  </dialog>;
}

function initiativeCategory(value) {
  return ({ internal: 'Interna', cross_selling: 'Cross-Selling', external: 'Prospección externa' })[value] || 'Prospección externa';
}

function MasterPanel({ title, records, kind, headers, onEdit, onDeactivate, onDelete }) {
  const columns = kind === 'clients' ? ['name', 'sector'] : kind === 'people' ? ['name', 'email'] : ['name', 'responsibleName'];
  const hasLifecycle = kind !== 'towers';
  return <section className="secondary-panel"><div className="secondary-panel-heading"><div><h2>{title}</h2><p>{hasLifecycle ? 'Los registros vinculados se desactivan en lugar de eliminarse.' : 'Cada tower tiene un responsable asignado. Las towers vinculadas no se pueden eliminar.'}</p></div><span className="record-count">{records.length} registros</span></div><div className="table-wrap"><table className="data-table"><thead><tr>{headers.map((label) => <th key={label}>{label}</th>)}{hasLifecycle && <th>Estado</th>}<th>Acciones</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}>{columns.map((field) => <td key={field}>{record[field] || '—'}</td>)}{hasLifecycle && <td>{record.active ? 'Activo' : 'Inactivo'}</td>}<td className="master-actions"><button className="button button-secondary" onClick={() => onEdit(kind, record)}>Editar</button>{kind === 'towers' ? <button className="button button-secondary" onClick={() => onDelete(record)}>Eliminar</button> : record.active && <button className="button button-secondary" onClick={() => onDeactivate(kind, record)}>Desactivar</button>}</td></tr>)}</tbody></table>{records.length === 0 && <p className="empty-state">Todavía no hay registros. Crea uno para poder seleccionarlo en iniciativas y oportunidades.</p>}</div></section>;
}

function MasterDialog({ kind, record, people, onClose, onSave, onSaved }) {
  const labels = { clients: ['Nuevo cliente', 'Cliente', ['name', 'Nombre', 'sector', 'Sector']], towers: ['Nueva tower', 'Tower', ['name', 'Nombre']], people: ['Nuevo responsable', 'Responsable', ['name', 'Nombre', 'email', 'Email']] }[kind];
  const [values, setValues] = useState({ name: record.name || '', sector: record.sector || '', email: record.email || '', responsibleId: record.responsibleId || '', active: record.active ?? true });
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  useEffect(() => { dialogRef.current?.showModal(); return () => { if (dialogRef.current?.open) dialogRef.current.close(); }; }, []);
  const submit = async (event) => {
    event.preventDefault(); setError('');
    try { const payload = { ...values, id: record.id }; if (kind === 'towers') delete payload.active; const saved = await onSave(kind, payload); onSaved?.(saved); onClose(); }
    catch (err) { setError(err?.message || 'No se pudo guardar el registro.'); }
  };
  const fields = [];
  for (let index = 0; index < labels[2].length; index += 2) fields.push([labels[2][index], labels[2][index + 1]]);
  return <dialog ref={dialogRef} className="opportunity-dialog compact-dialog"><form onSubmit={submit}><div className="dialog-heading"><div><span className="eyebrow">DATOS MAESTROS</span><h2>{record.id ? `Editar ${labels[1].toLowerCase()}` : labels[0]}</h2></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><Icon name="close" /></button></div><div className="form-grid">{fields.map(([field, label]) => <label className="form-field wide" key={field}>{label}<input required={field === 'name'} value={values[field]} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} />{field === 'email' && <span className="field-hint">Opcional</span>}</label>)}{kind === 'towers' && <label className="form-field wide">Responsable *<select required value={values.responsibleId} onChange={(event) => setValues((current) => ({ ...current, responsibleId: event.target.value }))}><option value="">Selecciona un responsable</option>{people.filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}{record.id && kind !== 'towers' && <label className="form-field wide">Estado<select value={values.active ? 'active' : 'inactive'} onChange={(event) => setValues((current) => ({ ...current, active: event.target.value === 'active' }))}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>}</div>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit">Guardar</button></div></form></dialog>;
}

function InitiativeDialog({ record, clients, towers, people, onQuickCreate, onClose, onSave }) {
  const [form, setForm] = useState({ title: record.title || '', category: record.category || 'external', clientId: record.clientId || '', towerId: record.towerId || '', ownerId: record.ownerId || '', bidManagerId: record.bidManagerId || '', stage: record.stage || 'prospecting', qaPercent: record.qaPercent ?? 0, status: record.status || 'open', closureReason: record.closureReason || '' });
  const amountInputRef = useRef(null);
  const [amountText, setAmountText] = useState(() => formatAmountInput(record.amount || '0'));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef(null);
  useEffect(() => { dialogRef.current?.showModal(); return () => { if (dialogRef.current?.open) dialogRef.current.close(); }; }, []);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const handleAmountChange = (event) => {
    const input = event.target;
    const caret = input.selectionStart ?? input.value.length;
    const digitsBefore = input.value.slice(0, caret).replace(/[^0-9,]/g, '').length;
    const formatted = formatAmountInput(input.value);
    setAmountText(formatted);
    window.requestAnimationFrame(() => {
      const field = amountInputRef.current;
      if (!field) return;
      let position = 0;
      let seen = 0;
      while (position < formatted.length && seen < digitsBefore) {
        if (/[0-9,]/.test(formatted[position])) seen += 1;
        position += 1;
      }
      field.setSelectionRange(position, position);
    });
  };
  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!form.title.trim()) { setError('Indica el nombre de la iniciativa.'); return; }
    const amount = parseAmount(amountText);
    const qaPercent = Number(form.qaPercent);
    if (!amountText.trim() || !Number.isFinite(amount) || amount < 0) { setError('El importe debe ser igual o superior a cero.'); return; }
    if (!Number.isFinite(qaPercent) || qaPercent < 0 || qaPercent > 100) { setError('La participación QA debe estar entre 0 y 100 %.'); return; }
    setError('');
    setSaving(true);
    try {
      await onSave({ ...form, id: record.id || '', amount: formatCurrency(amount), qaPercent });
    } catch (err) {
      setError(err?.message || 'No se pudo guardar la iniciativa.');
    } finally {
      setSaving(false);
    }
  };
  return <dialog ref={dialogRef} className="opportunity-dialog" aria-labelledby="initiative-dialog-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form onSubmit={save}>
      <div className="dialog-heading"><div><span className="eyebrow">CRM QE · INICIATIVA</span><h2 id="initiative-dialog-title">{record.id ? 'Editar iniciativa' : 'Nueva iniciativa'}</h2><p>Registro independiente de las oportunidades.</p></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose} disabled={saving}><Icon name="close" /></button></div>
      <div className="form-grid">
        <label className="form-field wide">Nombre de la iniciativa *<input required value={form.title} onChange={(event) => update('title', event.target.value)} disabled={saving} /></label>
        <label className="form-field">Categoría<select value={form.category} onChange={(event) => update('category', event.target.value)} disabled={saving}><option value="internal">Interna</option><option value="cross_selling">Cross-Selling</option><option value="external">Prospección externa</option></select></label>
        <label className="form-field">Cliente<select value={form.clientId} onChange={(event) => update('clientId', event.target.value)} disabled={saving}><option value="">Sin cliente</option>{clients.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('clients', (id) => update('clientId', id))} disabled={saving}>+ Crear cliente</button></label>
        <label className="form-field">Tower<select value={form.towerId} onChange={(event) => update('towerId', event.target.value)} disabled={saving}><option value="">Sin tower</option>{towers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('towers', (id) => update('towerId', id))} disabled={saving}>+ Crear tower</button></label>
        <label className="form-field">Responsable<select value={form.ownerId} onChange={(event) => update('ownerId', event.target.value)} disabled={saving}><option value="">Sin responsable</option>{people.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('people', (id) => update('ownerId', id))} disabled={saving}>+ Crear responsable</button></label>
        <label className="form-field">Bid Manager<select value={form.bidManagerId} onChange={(event) => update('bidManagerId', event.target.value)} disabled={saving}><option value="">Sin asignar</option>{people.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('people', (id) => update('bidManagerId', id))} disabled={saving}>+ Crear responsable</button></label>
        <label className="form-field">Importe estimado *<span className="amount-field"><input ref={amountInputRef} value={amountText} onChange={handleAmountChange} onBlur={() => setAmountText(formatAmountInput(amountText.replace(/,+$/, '')))} inputMode="decimal" autoComplete="off" placeholder="10.000,00" required disabled={saving} /><span className="amount-suffix" aria-hidden="true">{AMOUNT_CURRENCY}</span></span></label>
        <label className="form-field">Etapa<select value={form.stage} onChange={(event) => update('stage', event.target.value)} disabled={saving}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
        <label className="form-field">Participación del equipo QA (%)<input type="number" min="0" max="100" step="any" required value={form.qaPercent} onChange={(event) => update('qaPercent', event.target.value)} disabled={saving} /></label>
        <label className="form-field">Estado<select value={form.status} onChange={(event) => update('status', event.target.value)} disabled={saving}><option value="open">Abierta</option><option value="completed">Completada</option><option value="closed">Cerrada</option></select></label>
        {['closed', 'completed'].includes(form.status) && <label className="form-field">Motivo de cierre<input value={form.closureReason} onChange={(event) => update('closureReason', event.target.value)} disabled={saving} /></label>}
      </div>
      {record.id && <><RecordActions type="initiatives" id={record.id} /><InitiativeHistory id={record.id} /></>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar iniciativa'}</button></div>
    </form>
  </dialog>;
}

function AgreementDialog({ clients, people, onQuickCreate, onClose, onSave }) {
  const [form, setForm] = useState({ title: '', clientId: '', ownerId: '', endDate: '' });
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  useEffect(() => { dialogRef.current?.showModal(); return () => { if (dialogRef.current?.open) dialogRef.current.close(); }; }, []);
  const submit = async (event) => { event.preventDefault(); try { await onSave(form); } catch (err) { setError(err?.message || 'No se pudo guardar el acuerdo.'); } };
  return <dialog ref={dialogRef} className="opportunity-dialog compact-dialog"><form onSubmit={submit}><div className="dialog-heading"><div><span className="eyebrow">DATOS COMERCIALES</span><h2>Nuevo acuerdo marco</h2></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><Icon name="close" /></button></div><div className="form-grid"><label className="form-field wide">Nombre del acuerdo *<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label className="form-field">Cliente<select value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}><option value="">Sin cliente</option>{clients.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('clients', (id) => setForm((current) => ({ ...current, clientId: id })))}>+ Crear cliente</button></label><label className="form-field">Responsable<select value={form.ownerId} onChange={(event) => setForm({ ...form, ownerId: event.target.value })}><option value="">Sin responsable</option>{people.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('people', (id) => setForm((current) => ({ ...current, ownerId: id })))}>+ Crear responsable</button></label><label className="form-field wide">Fin de vigencia<input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label></div>{error && <p className="form-error">{error}</p>}<div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary">Crear acuerdo</button></div></form></dialog>;
}

function RecordActions({ type, id }) {
  const [items, setItems] = useState([]);
  const [text, setText] = useState('');
  const [kind, setKind] = useState('action');
  const [commentTexts, setCommentTexts] = useState({});
  const [error, setError] = useState('');
  const refresh = () => listActions(type, id).then(({ actions }) => setItems(actions || [])).catch((err) => setError(err?.message || 'No se pudieron cargar las notas y acciones.'));
  useEffect(() => { refresh(); }, [type, id]);
  const add = async () => { if (!text.trim()) return; try { const { action } = await createAction(type, id, { text: text.trim(), kind }); setItems((current) => [action, ...current]); setText(''); setError(''); } catch (err) { setError(err?.message || 'No se pudo guardar.'); } };
  const toggle = async (item) => { try { const { action } = await updateAction(item.id, { status: item.status === 'completed' ? 'pending' : 'completed' }); setItems((current) => current.map((entry) => entry.id === item.id ? action : entry)); } catch (err) { setError(err?.message || 'No se pudo actualizar la acción.'); } };
  const addComment = async (item) => { const commentText = (commentTexts[item.id] || '').trim(); if (!commentText) return; try { const { comment } = await createActionComment(item.id, { text: commentText }); setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, comments: [...(entry.comments || []), comment] } : entry)); setCommentTexts((current) => ({ ...current, [item.id]: '' })); setError(''); } catch (err) { setError(err?.message || 'No se pudo guardar el comentario.'); } };
  const handleEnter = (event, submit) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); submit(); } };
  const notes = items.filter((item) => item.kind === 'note');
  const pending = items.filter((item) => item.kind === 'action' && item.status === 'pending');
  const done = items.filter((item) => item.kind === 'action' && item.status === 'completed');
  const renderAction = (item) => <li key={item.id}><div className="action-content"><strong className={item.status === 'completed' ? 'completed-action' : ''}>{item.text}</strong><small>{item.userName} · {new Date(item.createdAt).toLocaleString('es-ES')}</small>{(item.comments || []).length > 0 && <ul className="action-comments">{item.comments.map((comment) => <li key={comment.id}><span>{comment.text}</span><small>{comment.userName} · {new Date(comment.createdAt).toLocaleString('es-ES')}</small></li>)}</ul>}<div className="comment-entry"><input aria-label={`Comentario para ${item.text}`} value={commentTexts[item.id] || ''} onChange={(event) => setCommentTexts((current) => ({ ...current, [item.id]: event.target.value }))} onKeyDown={(event) => handleEnter(event, () => addComment(item))} placeholder="Añade un comentario" maxLength="500" /><button type="button" className="button button-secondary" onClick={() => addComment(item)}>Comentar</button></div></div><button type="button" className="button button-secondary action-toggle" onClick={() => toggle(item)}>{item.status === 'completed' ? 'Reabrir' : 'Completar'}</button></li>;
  return <section className="record-actions"><h3>Notas y acciones</h3><div className="action-entry"><select aria-label="Tipo de registro" value={kind} onChange={(event) => setKind(event.target.value)}><option value="action">Acción pendiente</option><option value="note">Nota</option></select><input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => handleEnter(event, add)} placeholder={kind === 'note' ? 'Escribe una nota' : 'Añade una acción pendiente'} maxLength="500" /><button className="button button-secondary" type="button" onClick={add}>Añadir</button></div>{error && <p className="form-error" role="alert">{error}</p>}<section className="action-group"><h4>Pendientes</h4>{pending.length ? <ul className="action-list">{pending.map(renderAction)}</ul> : <p className="empty-actions">No hay acciones pendientes.</p>}</section><section className="action-group"><h4>Done</h4>{done.length ? <ul className="action-list">{done.map(renderAction)}</ul> : <p className="empty-actions">No hay acciones completadas.</p>}</section><section className="action-group"><h4>Notas</h4>{notes.length ? <ul className="action-list">{notes.map((item) => <li key={item.id}><div className="action-content"><strong>{item.text}</strong><small>{item.userName} · {new Date(item.createdAt).toLocaleString('es-ES')}</small></div></li>)}</ul> : <p className="empty-actions">No hay notas registradas.</p>}</section></section>;
}

function InitiativeHistory({ id }) {
  const [events, setEvents] = useState([]);
  useEffect(() => { listInitiativeEvents(id).then(({ events: rows }) => setEvents(rows || [])).catch(() => setEvents([])); }, [id]);
  const labels = { created: 'Creó la iniciativa', updated: 'Actualizó la iniciativa', action_added: 'Añadió una acción o nota', action_completed: 'Completó una acción', action_reopened: 'Reabrió una acción' };
  return <section className="record-actions"><h3>Historial</h3>{events.length === 0 ? <p className="empty-actions">Todavía no hay cambios registrados.</p> : <ul className="action-list">{events.map((event) => <li key={event.id}><span><strong>{labels[event.action] || event.action}</strong><small>{event.userName} · {new Date(event.createdAt).toLocaleString('es-ES')}</small></span></li>)}</ul>}</section>;
}

export default App;
