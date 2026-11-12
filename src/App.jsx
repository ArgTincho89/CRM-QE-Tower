import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { filterOptions, isAssignable, removeSelection, selectedOptions, toggleSelection } from './multiSelect.js';
import { initiativeCategories, initiativePriorities, initiativeStages, initiativeStatuses, opportunityOrigins, opportunityOutcomes, opportunityTypes, proposals, stages } from './data.js';
import { applyOriginChange, describeOpportunityOutcome, describeOpportunityType, filterOpportunityRecords, originInitiativeOptions, requiresOriginInitiative, validateOpportunityResult, validateOpportunityType, validateOriginInitiative } from './opportunities.js';
import { NAV_GROUPS } from './navigation.js';
import { COLLAPSED_CARD_LIMIT, getColumnVisibility, moveOpportunityToStage, toggleColumnExpanded } from './kanban.js';
import { AMOUNT_CURRENCY, formatAmountInput, formatCurrency, parseAmount } from './money.js';
import { INITIATIVE_STATUS_FILTERS, addInitiative, buildOpportunityPrefill, filterInitiativesByStatus, initiativeCountLabel, initiativeStatusLabel, mapInitiativeStage, removeInitiative, scopeInitiativesToPage } from './initiatives.js';
import { MAX_WORKSPACE_LINKS, DEFAULT_WORKSPACE_LINK_TITLE, normalizeWorkspaceLinks, safeWorkspaceUrl, toWorkspaceLinkForm } from './workspaceLinks.js';
import { filterAgreements } from './agreements.js';
import { computePipelineQe, computeWeightedAmount, computeWeightedPipeline } from './pipelineSummary.js';
import { buildServiceOptions, defaultServiceYear, previousServiceYear, serviceLabel, servicesOfYear, suggestNewServiceYear, yearNumbers } from './serviceYears.js';
import { ASSIGNED_TO_ME_FILTER, MISSING_OPPORTUNITY_TYPE_FILTER, UNASSIGNED_FILTER, createDefaultAdvancedFilters, filterPipelineCards } from './pipelineFilters.js';
import { formatNotificationTime, markNotificationsRead, notificationTargetPage, unreadBadgeLabel } from './notifications.js';
import { getVersion, getMe, login, logout, listOpportunities, listArchivedOpportunities, createOpportunity, updateOpportunity, archiveOpportunity, deleteOpportunity, restoreOpportunity, listClients, createClient, updateClient, deactivateClient, deleteClient, listTowers, createTower, updateTower, deleteTower, listServices, createService, updateService, deactivateService, deleteService, listServiceYears, createServiceYear, deleteServiceYear, listLobs, createLob, updateLob, deactivateLob, deleteLob, listPeople, createPerson, updatePerson, deactivatePerson, deletePerson, listInitiatives, listArchivedInitiatives, createInitiative, updateInitiative, archiveInitiative, restoreInitiative, deleteInitiative, convertInitiative, listAgreements, createAgreement, updateAgreement, deleteAgreement, listActions, createAction, updateAction, createActionComment, listInitiativeEvents, listUsers, listNotifications, markNotificationRead, markAllNotificationsRead } from './api.js';
import AuthScreen from './AuthScreen.jsx';
import CardHistory from './CardHistory.jsx';


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
  services: ['Servicios', 'Catálogo de servicios QE asignables a iniciativas y oportunidades.'],
  lobs: ['LoB', 'Líneas de negocio a las que se asocian las towers y las oportunidades.'],
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
  const [services, setServices] = useState([]);
  const [lobs, setLobs] = useState([]);
  const [people, setPeople] = useState([]);
  const [initiatives, setInitiatives] = useState([]);
  const [appVersion, setAppVersion] = useState('');
  const [agreements, setAgreements] = useState([]);
  // User accounts for "Asignado a" ({ id, name } only) and the current user's notifications.
  const [users, setUsers] = useState([]);
  const [notifications, setNotifications] = useState({ items: [], unreadCount: 0 });
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
  const [archivedOpportunities, setArchivedOpportunities] = useState([]);
  const [archivedView, setArchivedView] = useState(false);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedInitiatives, setArchivedInitiatives] = useState([]);
  const [initiativesArchivedView, setInitiativesArchivedView] = useState(false);
  const [initiativesArchivedLoading, setInitiativesArchivedLoading] = useState(false);
  const [editingInitiative, setEditingInitiative] = useState(null);
  const [editingAgreement, setEditingAgreement] = useState(null);
  const [masterEditing, setMasterEditing] = useState(null);
  // Fiscal years of the service catalog; `currentYear` comes from the server clock.
  const [serviceYears, setServiceYears] = useState({ years: [], currentYear: new Date().getFullYear() });
  const [selectedServiceYear, setSelectedServiceYear] = useState(null);
  const [creatingServiceYear, setCreatingServiceYear] = useState(false);
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
    // Errors (e.g. a blocked delete naming its relations) stay longer so they can be read.
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), tone === 'error' ? 6000 : 2600);
  };

  // Single version source: package.json, served by GET /api/version.
  useEffect(() => {
    let cancelled = false;
    getVersion().then(({ version }) => { if (!cancelled) setAppVersion(String(version || '')); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
    Promise.all([listClients(), listTowers(), listServices(), listLobs(), listPeople(), listInitiatives(), listAgreements(), listServiceYears(), listUsers()]).then(([c, t, s, l, p, i, a, y, u]) => {
      setUsers(u.users || []);
      setClients(c.records || []); setTowers(t.records || []); setServices(s.records || []); setLobs(l.records || []); setPeople(p.records || []);
      setInitiatives(i.initiatives || []); setAgreements(a.agreements || []);
      setServiceYears({ years: y.years || [], currentYear: y.currentYear ?? new Date().getFullYear() });
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

  // Notifications ride on the shared-records refresh; a failure keeps the last known list.
  const refreshNotifications = () => {
    listNotifications()
      .then((result) => setNotifications({ items: result.notifications || [], unreadCount: Number(result.unreadCount) || 0 }))
      .catch((err) => {
        if (err?.status === 401) setSession({ status: 'anonymous', user: null });
      });
  };

  // Poll so two users see each other's changes without a manual refresh.
  useEffect(() => {
    if (session.status !== 'authenticated') return;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      refreshNotifications();
      Promise.all([listOpportunities(), listInitiatives(), listClients(), listTowers(), listServices(), listLobs(), listPeople(), listAgreements(), listServiceYears(), listUsers()])
        .then(([{ opportunities: list }, { initiatives: initiativeList }, clientResult, towerResult, serviceResult, lobResult, peopleResult, agreementResult, yearResult, userResult]) => {
          setUsers(userResult.users || []);
          setServiceYears({ years: yearResult.years || [], currentYear: yearResult.currentYear ?? new Date().getFullYear() });
          setOpportunities(Array.isArray(list) ? list : []);
          setInitiatives(Array.isArray(initiativeList) ? initiativeList : []);
          setClients(clientResult.records || []);
          setTowers(towerResult.records || []);
          setServices(serviceResult.records || []);
          setLobs(lobResult.records || []);
          setPeople(peopleResult.records || []);
          setAgreements(agreementResult.agreements || []);
        })
        .catch((err) => {
          if (err?.status === 401) setSession({ status: 'anonymous', user: null });
        });
    };
    refreshNotifications();
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

  const pipelineCards = useMemo(
    () => opportunities.map((item) => ({ ...item, entityType: 'opportunity', cardKey: `opportunity:${item.id}` })),
    [opportunities],
  );
  const owners = useMemo(() => {
    const records = page === 'pipeline' ? pipelineCards : opportunities;
    return [...new Set(records.map((item) => item.owner).filter(Boolean))].sort();
  }, [page, pipelineCards, opportunities]);
  const filtered = useMemo(() => opportunities.filter((item) => {
    const haystack = `${item.title} ${item.account} ${item.owner} ${item.tower} ${item.id} ${item.registryId || ''}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase())
      && (stageFilter === 'all' || item.stage === stageFilter)
      && (towerFilter === 'all' || item.tower === towerFilter)
      && (ownerFilter === 'all' || item.owner === ownerFilter);
  }), [opportunities, query, stageFilter, towerFilter, ownerFilter]);
  const filteredPipelineCards = useMemo(() => pipelineCards.filter((item) => {
    const haystack = `${item.title} ${item.account} ${item.owner} ${item.tower} ${item.id} ${item.number || ''} ${item.registryId || ''} ${item.due || ''} ${(item.tags || []).join?.(' ') || ''} ${item.category || ''} ${item.status || ''} ${item.closureReason || ''}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase())
      && (stageFilter === 'all' || item.stage === stageFilter)
      && (towerFilter === 'all' || item.tower === towerFilter)
      && (ownerFilter === 'all' || item.owner === ownerFilter);
  }), [pipelineCards, query, stageFilter, towerFilter, ownerFilter]);
  const advancedFilteredPipelineCards = useMemo(
    () => filterPipelineCards(filteredPipelineCards, advancedFilters, { currentUserId: session.user?.id || '' }),
    [filteredPipelineCards, advancedFilters, session.user?.id],
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
    const stage = (isInitiative ? initiativeStages : stages).find((item) => item.id === stageId);
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

  const archiveRecord = async (record) => {
    const isInitiative = record.entityType === 'initiative';
    const typeLabel = isInitiative ? 'iniciativa' : 'oportunidad';
    if (!window.confirm(`¿Archivar la ${typeLabel} «${record.title}»? Se ocultará del tablero activo y podrás restaurarla con todo su historial.`)) return false;
    try {
      if (isInitiative) {
        await archiveInitiative(record.id);
        setInitiatives((current) => removeInitiative(current, record.id));
      } else {
        await archiveOpportunity(record.id);
        setOpportunities((current) => current.filter((item) => item.id !== record.id));
      }
      showNotice(`Se archivó la ${typeLabel} «${record.title}».`);
      return true;
    } catch (err) {
      showNotice(err?.message || `No se pudo archivar la ${typeLabel}.`, 'error');
      return false;
    }
  };

  // Physical delete: the server refuses (409) while other records still reference it.
  const deleteRecord = async (record) => {
    const isInitiative = record.entityType === 'initiative';
    const typeLabel = isInitiative ? 'iniciativa' : 'oportunidad';
    if (!window.confirm(`¿Eliminar definitivamente la ${typeLabel} «${record.title}»? Se borrarán también su historial, acciones y enlaces. Esta acción no se puede deshacer.`)) return false;
    try {
      if (isInitiative) {
        await deleteInitiative(record.id);
        setInitiatives((current) => removeInitiative(current, record.id));
        setArchivedInitiatives((current) => removeInitiative(current, record.id));
      } else {
        await deleteOpportunity(record.id);
        setOpportunities((current) => current.filter((item) => item.id !== record.id));
        setArchivedOpportunities((current) => current.filter((item) => item.id !== record.id));
        // Its source initiative lists generated opportunities: refresh it.
        if (record.initiativeId) listInitiatives().then(({ initiatives: list }) => setInitiatives(Array.isArray(list) ? list : [])).catch(() => {});
      }
      showNotice(`Se eliminó la ${typeLabel} «${record.title}».`);
      return true;
    } catch (err) {
      showNotice(err?.message || `No se pudo eliminar la ${typeLabel}.`, 'error');
      return false;
    }
  };

  const loadArchivedOpportunities = async () => {
    setArchivedLoading(true);
    try {
      const { opportunities: list } = await listArchivedOpportunities();
      setArchivedOpportunities(Array.isArray(list) ? list : []);
    } catch (err) {
      showNotice(err?.message || 'No se pudieron cargar las oportunidades archivadas.', 'error');
    } finally {
      setArchivedLoading(false);
    }
  };

  const toggleArchivedView = () => {
    const next = !archivedView;
    setArchivedView(next);
    if (next) loadArchivedOpportunities();
  };

  const restoreArchivedOpportunity = async (record) => {
    try {
      const { opportunity } = await restoreOpportunity(record.id);
      setArchivedOpportunities((current) => current.filter((item) => item.id !== opportunity.id));
      setOpportunities((current) => [opportunity, ...current]);
      showNotice(`Se restauró la oportunidad «${opportunity.title}».`);
    } catch (err) {
      showNotice(err?.message || 'No se pudo restaurar la oportunidad.', 'error');
    }
  };

  const loadArchivedInitiatives = async () => {
    setInitiativesArchivedLoading(true);
    try {
      const { initiatives: list } = await listArchivedInitiatives();
      setArchivedInitiatives(Array.isArray(list) ? list : []);
    } catch (err) {
      showNotice(err?.message || 'No se pudieron cargar las iniciativas archivadas.', 'error');
    } finally {
      setInitiativesArchivedLoading(false);
    }
  };

  const toggleInitiativesArchivedView = () => {
    const next = !initiativesArchivedView;
    setInitiativesArchivedView(next);
    if (next) loadArchivedInitiatives();
  };

  const restoreArchivedInitiative = async (record) => {
    try {
      const { initiative } = await restoreInitiative(record.id);
      setArchivedInitiatives((current) => removeInitiative(current, initiative.id));
      setInitiatives((current) => addInitiative(current, initiative));
      showNotice(`Se restauró la iniciativa «${initiative.title}».`);
    } catch (err) {
      showNotice(err?.message || 'No se pudo restaurar la iniciativa.', 'error');
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
        origin: record.origin || '',
        probability: record.probability === '' || record.probability === null ? null : Number(record.probability),
        expectedCloseDate: record.expectedCloseDate || '',
        nextMilestone: record.nextMilestone || '',
        nextMilestoneDate: record.nextMilestoneDate || '',
        need: record.need || '',
        initiativeId: record.initiativeId || '',
        outcome: record.outcome || '',
        pep: record.pep || '',
        opportunityType: record.opportunityType || '',
        registryId: record.registryId || '',
        assignedUserId: record.assignedUserId || '',
        towerIds: record.towerIds || [],
        lobIds: record.lobIds || [],
        serviceIds: record.serviceIds || [],
        links: record.links || [],
      };
      // Only the explicit "Crear oportunidad" flow from an initiative completes it (server-side).
      const sourceInitiativeId = !isExisting ? editing?.convertFromInitiativeId : '';
      let opportunity;
      if (isExisting && record.id) {
        ({ opportunity } = await updateOpportunity(record.id, payload));
      } else if (sourceInitiativeId) {
        const result = await convertInitiative(sourceInitiativeId, payload);
        opportunity = result.opportunity;
        setInitiatives((current) => current.map((item) => (item.id === result.initiative.id ? result.initiative : item)));
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
      if (opportunity.initiativeId || record.initiativeId) {
        listInitiatives().then(({ initiatives: list }) => setInitiatives(Array.isArray(list) ? list : [])).catch(() => {});
      }
      setEditing(null);
      if (sourceInitiativeId) {
        // Show the new opportunity on the pipeline Kanban, with no filter hiding it.
        clearFilters();
        setView('kanban');
        navigate('pipeline');
        showNotice(`Oportunidad ${opportunity.id} creada. La iniciativa se ha marcado como completada.`);
      } else {
        showNotice('Oportunidad guardada correctamente.');
      }
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
      services: existing ? updateService : createService,
      lobs: existing ? updateLob : createLob,
      people: existing ? updatePerson : createPerson,
    }[kind];
    const result = await fn(...(existing ? [record.id, record] : [record]));
    const saved = result.record;
    const setter = { clients: setClients, towers: setTowers, services: setServices, lobs: setLobs, people: setPeople }[kind];
    setter((current) => existing ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
    setMasterEditing(null);
    showNotice('Registro guardado correctamente.');
    return saved;
  };

  const deactivateMaster = async (kind, record) => {
    const fn = { clients: deactivateClient, services: deactivateService, lobs: deactivateLob, people: deactivatePerson }[kind];
    try {
      const { record: saved } = await fn(record.id);
      const setter = { clients: setClients, services: setServices, lobs: setLobs, people: setPeople }[kind];
      setter((current) => current.map((item) => item.id === saved.id ? saved : item));
      showNotice('Registro desactivado. Sus vínculos se mantienen.');
    } catch (err) {
      showNotice(err?.message || 'No se pudo desactivar el registro.', 'error');
    }
  };

  // Physical delete of a master record; the server answers 409 naming what still references it.
  const deleteMaster = async (kind, record) => {
    const label = { clients: 'el cliente', towers: 'la tower', services: 'el servicio', lobs: 'la LoB', people: 'el responsable' }[kind];
    if (!window.confirm(`¿Eliminar definitivamente ${label} «${record.name}»? Esta acción no se puede deshacer.`)) return;
    try {
      const fn = { clients: deleteClient, towers: deleteTower, services: deleteService, lobs: deleteLob, people: deletePerson }[kind];
      await fn(record.id);
      const setter = { clients: setClients, towers: setTowers, services: setServices, lobs: setLobs, people: setPeople }[kind];
      setter((current) => current.filter((item) => item.id !== record.id));
      showNotice('Registro eliminado correctamente.');
    } catch (err) {
      showNotice(err?.message || 'No se pudo eliminar el registro.', 'error');
    }
  };

  // The selected year falls back to the default when it no longer exists (e.g. just deleted).
  const activeServiceYear = yearNumbers(serviceYears.years).includes(selectedServiceYear)
    ? selectedServiceYear
    : defaultServiceYear(serviceYears.years, serviceYears.currentYear);

  const reloadServiceCatalog = async () => {
    const [yearResult, serviceResult] = await Promise.all([listServiceYears(), listServices()]);
    setServiceYears({ years: yearResult.years || [], currentYear: yearResult.currentYear ?? new Date().getFullYear() });
    setServices(serviceResult.records || []);
  };

  const saveServiceYear = async ({ year, copyFromYear }) => {
    const result = await createServiceYear({ year, ...(copyFromYear ? { copyFromYear } : {}) });
    await reloadServiceCatalog();
    setSelectedServiceYear(year);
    setCreatingServiceYear(false);
    showNotice(copyFromYear
      ? `Ejercicio ${year} creado con ${result.created} ${result.created === 1 ? 'servicio copiado' : 'servicios copiados'} de ${copyFromYear}.`
      : `Ejercicio ${year} creado.`);
  };

  // Only an empty year can be deleted; the server's 409 message explains why otherwise.
  const removeServiceYear = async (year) => {
    if (!window.confirm(`¿Eliminar el ejercicio ${year}? Solo es posible si no tiene servicios.`)) return;
    try {
      await deleteServiceYear(year);
      await reloadServiceCatalog();
      setSelectedServiceYear(null);
      showNotice(`Ejercicio ${year} eliminado.`);
    } catch (err) {
      showNotice(err?.message || 'No se pudo eliminar el ejercicio.', 'error');
    }
  };

  const removeAgreement = async (record) => {
    if (!window.confirm(`¿Eliminar definitivamente el acuerdo marco «${record.title}»? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteAgreement(record.id);
      setAgreements((current) => current.filter((item) => item.id !== record.id));
      showNotice('Acuerdo marco eliminado correctamente.');
    } catch (err) {
      showNotice(err?.message || 'No se pudo eliminar el acuerdo marco.', 'error');
    }
  };

  const saveInitiative = async (record) => {
    const { initiative } = record.id ? await updateInitiative(record.id, record) : await createInitiative(record);
    setInitiatives((current) => record.id ? current.map((item) => item.id === initiative.id ? initiative : item) : [initiative, ...current]);
    setEditingInitiative(null);
    showNotice('Iniciativa guardada correctamente.');
  };

  // "Crear oportunidad": persist the pending initiative edits first (a failure aborts and
  // surfaces in the dialog), then open the prefilled opportunity form in conversion mode.
  // The initiative is completed only when that opportunity is saved; cancelling leaves it as is.
  const startOpportunityFromInitiative = async (record) => {
    const { initiative } = await updateInitiative(record.id, record);
    setInitiatives((current) => current.map((item) => (item.id === initiative.id ? initiative : item)));
    setEditingInitiative(null);
    setEditing({ ...buildOpportunityPrefill(initiative, clients, services, serviceYears.currentYear), convertFromInitiativeId: initiative.id });
  };

  const saveAgreement = async (record) => {
    const { agreement } = record.id ? await updateAgreement(record.id, record) : await createAgreement(record);
    setAgreements((current) => record.id ? current.map((item) => item.id === agreement.id ? agreement : item) : [agreement, ...current]);
    setEditingAgreement(null);
    showNotice('Acuerdo marco guardado correctamente.');
  };

  const markAllRead = async () => {
    const previous = notifications;
    setNotifications((current) => ({ items: markNotificationsRead(current.items, null, new Date().toISOString()), unreadCount: 0 }));
    try {
      await markAllNotificationsRead();
    } catch (err) {
      setNotifications(previous);
      showNotice(err?.message || 'No se pudieron marcar las notificaciones como leídas.', 'error');
    }
  };

  // Marks the notification read, then opens its record on its page with fresh data.
  const openNotification = async (notification) => {
    if (!notification.readAt) {
      setNotifications((current) => ({
        items: markNotificationsRead(current.items, [notification.id], new Date().toISOString()),
        unreadCount: Math.max(0, current.unreadCount - 1),
      }));
      markNotificationRead(notification.id).catch(() => refreshNotifications());
    }
    const targetPage = notificationTargetPage(notification.entityType);
    if (!targetPage) return;
    const missing = () => showNotice('El registro de esta notificación ya no existe o está archivado.', 'error');
    try {
      if (notification.entityType === 'opportunity') {
        const { opportunities: list } = await listOpportunities();
        setOpportunities(Array.isArray(list) ? list : []);
        const record = (list || []).find((item) => item.id === notification.entityId);
        if (!record) { missing(); return; }
        navigate(targetPage);
        setEditing(record);
      } else if (notification.entityType === 'initiative') {
        const { initiatives: list } = await listInitiatives();
        setInitiatives(Array.isArray(list) ? list : []);
        const record = (list || []).find((item) => item.id === notification.entityId);
        if (!record) { missing(); return; }
        navigate(targetPage);
        setEditingInitiative(record);
      } else {
        const { agreements: list } = await listAgreements();
        setAgreements(Array.isArray(list) ? list : []);
        const record = (list || []).find((item) => item.id === notification.entityId);
        if (!record) { missing(); return; }
        navigate(targetPage);
        setEditingAgreement(record);
      }
    } catch (err) {
      if (err?.status === 401) setSession({ status: 'anonymous', user: null });
      else showNotice(err?.message || 'No se pudo abrir el registro.', 'error');
    }
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
    setNotifications({ items: [], unreadCount: 0 });
    setUsers([]);
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
    return <AuthScreen onAuthenticated={handleAuthenticated} version={appVersion} />;
  }

  const user = session.user;
  const activePage = page === 'home' ? 'home' : page;
  const [title, subtitle] = pageTitles[activePage] || pageTitles.pipeline;
  const opportunityMetric = opportunities.length;
  const weightedPipeline = computeWeightedPipeline(opportunities);

  return (
    <div className="app-shell">
      <aside className={`sidebar${mobileNav ? ' sidebar-open' : ''}`} aria-label="Navegación principal">
        <div className="brand"><img className="brand-logo" src="/logo-seidor.jpeg" alt="SEIDOR" /></div>
        <div className="workspace-label">GESTIÓN COMERCIAL</div>
            <nav className="side-nav">
          {NAV_GROUPS.map((group) => <div key={group.id} className={`nav-group${group.label ? ' nav-group-labeled' : ''}`} role="group" aria-labelledby={group.label ? `nav-group-${group.id}` : undefined}>
            {group.label && <div className="nav-group-label" id={`nav-group-${group.id}`}>{group.label}</div>}
            {group.items.map((item) => <button key={item.id} className={`nav-item${page === item.id ? ' selected' : ''}`} onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}>
              <Icon name={item.icon} size={18} /><span>{item.label}</span>{item.id === 'pipeline' && <span className="nav-count">{opportunities.length}</span>}
            </button>)}
          </div>)}
        </nav>
        <div className="sidebar-footer"><span className="footer-dot" /> CRM QE <span className="footer-version">{appVersion ? `v${appVersion}` : ''}</span></div>
      </aside>
      {mobileNav && <button className="nav-backdrop" aria-label="Cerrar navegación" onClick={() => setMobileNav(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Abrir navegación" onClick={() => setMobileNav(true)}><Icon name="list" /></button>
          <div className="breadcrumbs"><span>SEIDOR</span><Icon name="chevron" size={14} /><strong>{title}</strong></div>
          <label className="global-search"><Icon name="search" size={17} /><span className="sr-only">Buscar en CRM QE</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente, oportunidad..." /><kbd>⌘ K</kbd></label>
          <NotificationBell notifications={notifications.items} unreadCount={notifications.unreadCount} onOpen={openNotification} onMarkAllRead={markAllRead} />
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
            <div className="heading-actions">{['clients', 'towers', 'services', 'lobs', 'people'].includes(page) && <button className="button button-primary" onClick={() => setMasterEditing(page === 'services' ? { kind: page, year: activeServiceYear } : { kind: page })} disabled={page === 'services' && activeServiceYear === null}><Icon name="plus" size={17} /> {{ clients: 'Nuevo cliente', towers: 'Nueva tower', services: 'Nuevo servicio', lobs: 'Nueva LoB', people: 'Nuevo responsable' }[page]}</button>}{['initiatives', 'crossSelling'].includes(page) && <button className="button button-primary" onClick={() => setEditingInitiative(page === 'crossSelling' ? { category: 'Cross-selling' } : {})}><Icon name="plus" size={17} /> Nueva iniciativa</button>}{page === 'agreements' && <button className="button button-primary" onClick={() => setEditingAgreement({})}><Icon name="plus" size={17} /> Nuevo acuerdo</button>}{['pipeline', 'opportunities'].includes(page) && <button className="button button-primary" onClick={() => setEditing({})}><Icon name="plus" size={18} /> Nueva oportunidad</button>}</div>
          </div>

          {page === 'pipeline' ? <>
            <section className="kpi-grid" aria-label="Indicadores principales">
              <Kpi icon="users" color="blue" label="Clientes activos" value={String(clients.filter((item) => item.active).length)} detail="Registros activos" />
              <Kpi icon="target" color="violet" label="Oportunidades" value={String(opportunityMetric)} detail="Registros actuales" />
              <Kpi icon="arrow" color="orange" label="Propuestas externas" value={String(proposals.filter((item) => item.type === 'Externa').length)} detail="Datos de referencia" />
              <Kpi icon="file" color="teal" label="Propuestas internas / Estimaciones" value={String(proposals.filter((item) => item.type === 'Interna').length)} detail="Datos de referencia" />
              <Kpi icon="layers" color="blue" label="Acuerdos Marco" value={String(agreements.filter((item) => item.status === 'active').length)} detail="Registros activos" />
              <Kpi icon="chart" color="green" label="Pipeline QE" value={formatCurrency(computePipelineQe(opportunities))} detail="Importe × participación QA" />
              {weightedPipeline !== null && <Kpi icon="target" color="violet" label="Ponderado por probabilidad" value={formatCurrency(weightedPipeline)} detail="Importe QE × probabilidad; no suma al Pipeline QE" />}
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
            {page === 'pipeline' && <AdvancedFilters filters={advancedFilters} people={people} users={users} services={services} currentServiceYear={serviceYears.currentYear} lobs={lobs} towers={towers} hidden={!advancedFiltersOpen} onChange={(name, value) => setAdvancedFilters((current) => ({ ...current, [name]: value }))} />}
            <div className="results-line"><span><strong>{page === 'pipeline' ? (view === 'kanban' ? advancedFilteredPipelineCards.length : filteredPipelineOpportunities.length) : filtered.length}</strong> {page === 'pipeline' && view === 'kanban' ? 'registros encontrados' : 'oportunidades encontradas'}</span><button onClick={clearFilters}>Limpiar filtros <Icon name="close" size={13} /></button></div>
            {oppState === 'loading' && <div className="board-state"><p>Cargando oportunidades…</p></div>}
            {oppState === 'error' && <div className="board-state"><p>No se pudieron cargar las oportunidades.</p><button className="button button-secondary" onClick={reloadOpportunities}>Reintentar</button></div>}
            {view === 'kanban' ? <Kanban cards={page === 'pipeline' ? advancedFilteredPipelineCards : filtered} allCards={page === 'pipeline' ? pipelineCards : opportunities} expandedColumns={expandedColumns} onToggleColumn={(stageId) => setExpandedColumns((current) => toggleColumnExpanded(current, stageId))} onEdit={(record) => record.entityType === 'initiative' ? setEditingInitiative(record.sourceRecord) : setEditing(record)} onMove={moveBoardCard} onArchive={archiveRecord} onDelete={deleteRecord} /> : <OpportunityRows opportunities={page === 'pipeline' ? filteredPipelineOpportunities : filtered} view={view} onEdit={setEditing} />}
          </> : page === 'opportunities'
            ? <OpportunityManagementPanel opportunities={filterOpportunityRecords(opportunities, archivedOpportunities, query, archivedView)} onEdit={setEditing} loading={archivedView ? archivedLoading : oppState === 'loading'} error={archivedView ? false : oppState === 'error'} onRetry={archivedView ? loadArchivedOpportunities : reloadOpportunities} searchQuery={query} onClearSearch={() => setQuery('')} archivedView={archivedView} onToggleArchived={toggleArchivedView} onRestore={restoreArchivedOpportunity} onArchive={archiveRecord} onDelete={deleteRecord} />
            : (page === 'initiatives' || page === 'crossSelling')
              ? <InitiativeBoard page={page} initiatives={initiatives} archivedInitiatives={archivedInitiatives} archivedView={initiativesArchivedView} archivedLoading={initiativesArchivedLoading} onToggleArchived={toggleInitiativesArchivedView} onRestore={restoreArchivedInitiative} query={query} expandedColumns={expandedColumns} onToggleColumn={(stageId) => setExpandedColumns((current) => toggleColumnExpanded(current, stageId))} onEdit={setEditingInitiative} onMove={moveBoardCard} onArchive={archiveRecord} onDelete={deleteRecord} />
            : <SecondaryPage page={page} opportunities={opportunities} clients={clients} towers={towers} services={services} serviceYears={serviceYears} activeServiceYear={activeServiceYear} onSelectServiceYear={setSelectedServiceYear} onNewServiceYear={() => setCreatingServiceYear(true)} onDeleteServiceYear={removeServiceYear} lobs={lobs} people={people} initiatives={initiatives} agreements={agreements} query={query} onNavigate={navigate} user={user} onLogout={handleLogout} onEditInitiative={setEditingInitiative} onEditMaster={(kind, record) => setMasterEditing({ kind, ...record })} onDeactivateMaster={deactivateMaster} onDeleteMaster={deleteMaster} onEditAgreement={setEditingAgreement} onDeleteAgreement={removeAgreement} />}
          <footer className="main-footer"><span>CRM QE <b>·</b> Herramienta complementaria al CRM corporativo</span><span>Los importes reflejan oportunidades estimadas, no ingresos contratados.</span></footer>
        </div>
      </main>
      {editing !== null && <OpportunityDialog record={editing} users={users} clients={clients} towers={towers} services={services} currentServiceYear={serviceYears.currentYear} lobs={lobs} people={people} initiatives={initiatives} onQuickCreate={(kind, onCreated) => setMasterEditing({ kind, onCreated })} onClose={() => { setEditing(null); setSaveError(''); }} onSave={saveOpportunity} saving={saving} saveError={saveError} historyRefresh={historyRefresh} />}
      {editingInitiative !== null && <InitiativeDialog record={editingInitiative} users={users} clients={clients} services={services} currentServiceYear={serviceYears.currentYear} onQuickCreate={(kind, onCreated) => setMasterEditing({ kind, onCreated })} onClose={() => setEditingInitiative(null)} onSave={saveInitiative} onCreateOpportunity={startOpportunityFromInitiative} />}
      {editingAgreement !== null && <AgreementDialog agreement={editingAgreement} users={users} clients={clients} people={people} onQuickCreate={(kind, onCreated) => setMasterEditing({ kind, onCreated })} onClose={() => setEditingAgreement(null)} onSave={saveAgreement} />}
      {creatingServiceYear && <ServiceYearDialog years={serviceYears.years} currentYear={serviceYears.currentYear} onClose={() => setCreatingServiceYear(false)} onSave={saveServiceYear} />}
      {masterEditing !== null && <MasterDialog kind={masterEditing.kind} record={masterEditing} people={people} lobs={lobs} onClose={() => setMasterEditing(null)} onSave={saveMaster} onSaved={(record) => masterEditing.onCreated?.(record.id)} />}
      {notice && <div className={`toast${noticeTone === 'error' ? ' toast-error' : ''}`} role="status"><Icon name="check" size={16} />{notice}</div>}
    </div>
  );
}

/** "Asignado a": a system user account, separate from the people-master "Responsable". */
function AssigneeField({ value, users, onChange, disabled = false }) {
  return <label className="form-field">Asignado a<select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}><option value="">Sin asignar</option>{users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="field-hint">Usuario del sistema. Recibirá una notificación.</span></label>;
}

function AssigneeBadge({ name }) {
  if (!name) return null;
  return <span className="card-assignee" title={`Asignado a ${name}`}><Avatar name={name} compact /><span className="sr-only">Asignado a {name}</span></span>;
}

/** Top-bar bell with an unread badge and a popover listing the latest notifications. */
function NotificationBell({ notifications, unreadCount, onOpen, onMarkAllRead }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();
  const badge = unreadBadgeLabel(unreadCount);
  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus();
    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);
  const now = new Date();
  return <div className="notification-menu" ref={containerRef}>
    <button type="button" ref={triggerRef} className="icon-button notification-button" aria-label={badge ? `Notificaciones: ${unreadCount} sin leer` : 'Notificaciones'} aria-haspopup="true" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((value) => !value)}><Icon name="bell" size={19} />{badge && <span className="notification-badge" aria-hidden="true">{badge}</span>}</button>
    {open && <section className="notification-panel" id={panelId} ref={panelRef} tabIndex={-1} aria-label="Notificaciones">
      <div className="notification-panel-heading"><h2>Notificaciones</h2><button type="button" className="inline-link" onClick={onMarkAllRead} disabled={unreadCount === 0}>Marcar todas como leídas</button></div>
      {notifications.length === 0
        ? <p className="notification-empty">No tienes notificaciones.</p>
        : <ul className="notification-list">{notifications.map((item) => <li key={item.id}><button type="button" className={`notification-item${item.readAt ? '' : ' unread'}`} onClick={() => { setOpen(false); onOpen(item); }}>{!item.readAt && <span className="notification-unread-dot" aria-hidden="true" />}<span className="notification-text"><span>{item.message}</span><small><time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString('es-ES')}>{formatNotificationTime(item.createdAt, now)}</time>{!item.readAt && <span className="sr-only"> · sin leer</span>}</small></span></button></li>)}</ul>}
    </section>}
  </div>;
}

function Kpi({ icon, color, label, value, detail, trend }) {
  return <article className="kpi-card"><div className={`kpi-icon ${color}`}><Icon name={icon} size={18} /></div><div className="kpi-content"><span>{label}</span><div className="kpi-value-row"><strong>{value}</strong>{trend && <span className="trend-badge">↗ 20%</span>}</div><small>{detail}</small></div></article>;
}

function AdvancedFilters({ filters, people, users = [], services = [], currentServiceYear, lobs = [], towers = [], hidden, onChange }) {
  const field = (name, label, type = 'text', options = null) => (
    <label className="advanced-filter-field" key={name}>
      <span>{label}</span>
      {options
        ? <select value={filters[name]} onChange={(event) => onChange(name, event.target.value)}>{options.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}</select>
        : <input type={type} value={filters[name]} onChange={(event) => onChange(name, event.target.value)} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 'any' : undefined} />}
    </label>
  );
  return <section className="advanced-filters-panel" id="advanced-filters-panel" aria-label="Filtros avanzados del pipeline" hidden={hidden}>
    {field('account', 'Cliente / cuenta')}
    {field('opportunityType', 'Tipo', 'text', [['all', 'Todos'], ...opportunityTypes.map((item) => [item.id, item.label]), [MISSING_OPPORTUNITY_TYPE_FILTER, 'Sin tipo']])}
    {field('serviceId', 'Servicio', 'text', [['all', 'Todos'], ...services.map((item) => [item.id, `${serviceLabel(item, currentServiceYear)}${item.active === false ? ' (inactivo)' : ''}`])])}
    {field('lobId', 'LoB', 'text', [['all', 'Todas'], ...lobs.map((item) => [item.id, item.name])])}
    {field('towerId', 'Tower', 'text', [['all', 'Todas'], ...towers.map((item) => [item.id, item.name])])}
    {field('bidManagerId', 'Bid Manager', 'text', [['all', 'Todos'], ...people.map((person) => [person.id, person.name])])}
    {field('assignedUserId', 'Asignado a', 'text', [['all', 'Todos'], [ASSIGNED_TO_ME_FILTER, 'Asignadas a mí'], [UNASSIGNED_FILTER, 'Sin asignar'], ...users.map((item) => [item.id, item.name])])}
    {field('minAmount', 'Importe mínimo', 'number')}
    {field('maxAmount', 'Importe máximo', 'number')}
    {field('minQaPercent', 'QA mínimo (%)', 'number')}
    {field('maxQaPercent', 'QA máximo (%)', 'number')}
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

function Kanban({ cards, allCards, stageList = stages, expandedColumns, onToggleColumn, onEdit, onMove, onArchive, onDelete }) {
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
    {stageList.map((stage) => {
      const stageCards = cards.filter((item) => item.stage === stage.id);
      const totalCount = allCards.filter((item) => item.stage === stage.id).length;
      const isExpanded = Boolean(expandedColumns[stage.id]);
      const { visibleCards, hiddenCount, canToggle } = getColumnVisibility(stageCards, isExpanded);
      return <section className={`kanban-column ${stage.id}${dragOverStage === stage.id ? ' drag-over' : ''}`} key={stage.id} aria-label={`${stage.label}: ${totalCount} registros totales`} onDragEnter={(event) => handleDragOver(event, stage.id)} onDragOver={(event) => handleDragOver(event, stage.id)} onDragLeave={(event) => handleDragLeave(event, stage.id)} onDrop={(event) => handleDrop(event, stage.id)}>
        <div className={`column-heading ${stage.tone}`}><span className="stage-indicator" /><h3>{stage.label}</h3><span className="column-count">{totalCount}</span><button className="column-menu" aria-label={`Opciones de ${stage.label}`}><Icon name="dots" size={17} /></button></div>
        <div className="column-cards">{visibleCards.map((record) => <OpportunityCard key={record.cardKey || record.id} record={record} stageList={stageList} onCardClick={handleCardClick} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onArchive={onArchive} onDelete={onDelete} isDragging={draggingId === (record.cardKey || record.id)} />)}{stageCards.length === 0 && <div className="empty-column">No hay registros para estos filtros.</div>}</div>
        {(canToggle || (isExpanded && totalCount > COLLAPSED_CARD_LIMIT)) && <button className="show-more" aria-expanded={isExpanded} onClick={() => onToggleColumn(stage.id)}>{isExpanded ? '− Ver menos' : `+ Ver más (${hiddenCount})`}</button>}
      </section>;
    })}
  </div>;
}

function OpportunityCard({ record, onCardClick, onDragStart, onDragEnd, onArchive, onDelete, isDragging }) {
  const stage = stages.find((item) => item.id === record.stage);
  const isInitiative = record.entityType === 'initiative';
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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
  const runMenuAction = async (action) => {
    setBusy(true);
    const done = await action(record);
    setBusy(false);
    if (done) setMenuOpen(false);
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
      <div className="card-top"><span className="opportunity-id">{record.id}</span>{isInitiative ? <span className="initiative-type-pill">Iniciativa · {record.categoryLabel}</span> : <><OpportunityTypePill type={record.opportunityType} />{record.number && <span className="external-opportunity-number">N.º {record.number}</span>}</>}<span className={`card-stage-dot ${stage?.tone || ''}`} title={stage?.label || record.stage} /></div>
      <h4>{record.title}</h4><div className="card-client"><span className="client-glyph">{(record.account || '—').charAt(0)}</span><span>{record.account || 'Sin cliente'}</span></div>
      <div className="card-value-row">{isInitiative ? <><strong className={`priority-text ${String(record.priority || 'media').toLowerCase()}`}>{record.priority || 'Media'}</strong><span className="tower-pill">{record.statusLabel}</span></> : <><strong>{record.amount}</strong><span className="tower-pill">{record.tower}</span></>}</div>
      {!isInitiative && record.weightedAmount !== null && record.weightedAmount !== undefined && <small className="weighted-amount">Ponderado: {formatCurrency(Number(record.weightedAmount))}</small>}
      <div className="card-bottom"><span className="card-date"><Icon name={isInitiative ? 'calendar' : (record.due || '').includes('Ganada') ? 'check' : 'calendar'} size={13} />{isInitiative ? (record.nextActionDate || 'Sin próxima acción') : (record.due || 'Por definir')}</span>{!isInitiative && record.outcome && <span className={`status-pill ${opportunityOutcomes.find((item) => item.id === record.outcome)?.tone || 'gray'}`}>{opportunityOutcomes.find((item) => item.id === record.outcome)?.label || record.outcome}</span>}{!isInitiative && record.pep && <span className="pep-pill" title={record.pep}>PEP</span>}<AssigneeBadge name={record.assignedUserName} />{!isInitiative && <span className="card-owner"><Avatar name={record.owner} compact /></span>}</div>
    </button>
    <div className="card-menu-container" ref={menuRef} data-card-menu>
      <button type="button" className="card-menu-button" ref={triggerRef} draggable={false} aria-label={`Opciones de ${isInitiative ? 'iniciativa' : 'oportunidad'} ${record.title}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Icon name="dots" size={16} /></button>
      {menuOpen && <div className="card-menu-popup" role="menu"><button type="button" role="menuitem" ref={actionRef} disabled={busy} onClick={() => runMenuAction(onArchive)}>Archivar</button><button type="button" role="menuitem" className="danger" disabled={busy} onClick={() => runMenuAction(onDelete)}>Eliminar</button></div>}
    </div>
  </article>;
}

function OutcomeCell({ outcome }) {
  const described = describeOpportunityOutcome(outcome);
  return described ? <span className={`status-pill ${described.tone}`}>{described.label}</span> : '—';
}

function OpportunityTypePill({ type }) {
  const { label, tone, missing } = describeOpportunityType(type);
  return <span className={`status-pill opportunity-type-pill ${tone}${missing ? ' missing' : ''}`}>{label}</span>;
}

function OpportunityRows({ opportunities, view, onEdit }) {
  if (view === 'table') return <div className="table-wrap"><table className="data-table"><thead><tr><th>ID / Oportunidad</th><th>ID registro</th><th>Cliente</th><th>Etapa</th><th>Resultado</th><th>Tipo</th><th>Tower</th><th>Importe estimado</th><th>Responsable</th><th>Próximo hito</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{opportunities.map((item) => <tr key={item.id}><td><span className="table-id">ID interno: {item.id}{item.number && ` · N.º externo: ${item.number}`}</span><button className="table-title" onClick={() => onEdit(item)}>{item.title}</button></td><td>{item.registryId || '—'}</td><td>{item.account}</td><td><span className={`status-pill ${stages.find((stage) => stage.id === item.stage).tone}`}>{stages.find((stage) => stage.id === item.stage).label}</span></td><td><OutcomeCell outcome={item.outcome} /></td><td><OpportunityTypePill type={item.opportunityType} /></td><td>{item.tower}</td><td className="table-amount">{item.amount}</td><td><span className="table-owner"><Avatar name={item.owner} compact />{item.owner}</span></td><td>{item.due}</td><td><button className="icon-button row-edit" onClick={() => onEdit(item)} aria-label={`Editar ${item.title}`}><Icon name="dots" size={17} /></button></td></tr>)}</tbody></table>{opportunities.length === 0 && <p className="empty-state">No hay oportunidades que coincidan con los filtros.</p>}</div>;
  return <div className="list-view">{opportunities.map((item) => <button className="list-row" key={item.id} onClick={() => onEdit(item)}><span className="list-accent" /><span className="list-main"><small>{item.id}{item.number && ` · N.º ${item.number}`} <span>·</span> {item.account}</small><strong>{item.title}</strong></span><span className="list-stage"><i className={stages.find((stage) => stage.id === item.stage).tone} />{stages.find((stage) => stage.id === item.stage).label}</span><span className="list-tower">{item.tower}</span><strong className="list-amount">{item.amount}</strong><span className="table-owner"><Avatar name={item.owner} compact />{item.owner}</span><span className="list-date"><Icon name="calendar" size={14} />{item.due}</span><Icon name="chevron" size={16} /></button>)}{opportunities.length === 0 && <p className="empty-state">No hay oportunidades que coincidan con los filtros.</p>}</div>;
}

function SecondaryPage({ page, opportunities, clients, towers, services, serviceYears, activeServiceYear, onSelectServiceYear, onNewServiceYear, onDeleteServiceYear, lobs, people, initiatives, agreements, query = '', onNavigate, user, onLogout, onEditInitiative, onEditMaster, onDeactivateMaster, onDeleteMaster, onEditAgreement, onDeleteAgreement }) {
  const grouped = towers.map((tower) => ({ tower: tower.name, count: opportunities.filter((item) => item.towerId === tower.id || item.tower === tower.name).length, amount: opportunities.filter((item) => item.towerId === tower.id || item.tower === tower.name).reduce((sum, item) => sum + parseAmount(item.amount), 0) }));
  if (page === 'home') return <section className="secondary-home"><div className="welcome-panel"><div><div className="eyebrow">ACTIVIDAD COMERCIAL</div><h2>Buen día, {user?.name?.split(' ')[0] || 'equipo'}</h2><p>Resumen de los registros actuales de CRM QE.</p></div><button className="button button-primary" onClick={() => onNavigate('pipeline')}>Ir al pipeline <Icon name="arrow" size={16} /></button></div><div className="secondary-grid"><SummaryCard title="Oportunidades recientes" action="Ver pipeline" onAction={() => onNavigate('pipeline')}><div className="recent-list">{opportunities.slice(0, 4).map((item) => <div className="recent-item" key={item.id}><span className="recent-dot" /><span><strong>{item.title}</strong><small>{item.account || 'Sin cliente'} · {item.tower || 'Sin tower'}</small></span><b>{item.amount}</b></div>)}{opportunities.length === 0 && <p className="empty-state">Todavía no hay oportunidades.</p>}</div></SummaryCard><SummaryCard title="Siguientes pasos" action="Ver iniciativas" onAction={() => onNavigate('initiatives')}><div className="task-list"><p>Las notas y acciones pendientes se registran en cada iniciativa u oportunidad.</p></div></SummaryCard></div></section>;
  if (page === 'settings') return <div className="settings-note"><div className="kpi-icon blue"><Icon name="settings" /></div><div><h2>Cuenta y sesión</h2><dl className="account-details"><div><dt>Nombre</dt><dd>{user?.name}</dd></div><div><dt>Email</dt><dd>{user?.email}</dd></div><div><dt>Rol</dt><dd>{user?.role === 'admin' ? 'Administrador' : 'Miembro'}</dd></div></dl><p className="settings-help">El tablero es compartido por todos los usuarios autenticados, que tienen los mismos permisos para consultar y modificar sus registros. Cada acción sobre una tarjeta queda registrada en su historial.</p><button className="button button-secondary" onClick={onLogout}>Cerrar sesión</button></div></div>;
  if (page === 'clients') return <MasterPanel title="Clientes" records={clients} kind="clients" headers={['Cliente', 'Sector']} onEdit={onEditMaster} onDeactivate={onDeactivateMaster} onDelete={onDeleteMaster} />;
  if (page === 'towers') return <MasterPanel title="Towers" records={towers} kind="towers" headers={['Tower', 'Responsable', 'LoB']} onEdit={onEditMaster} onDelete={onDeleteMaster} />;
  if (page === 'services') return <ServicesPanel services={services} serviceYears={serviceYears} activeYear={activeServiceYear} onSelectYear={onSelectServiceYear} onNewYear={onNewServiceYear} onDeleteYear={onDeleteServiceYear} onEdit={onEditMaster} onDeactivate={onDeactivateMaster} onDelete={onDeleteMaster} />;
  if (page === 'lobs') return <MasterPanel title="LoB" records={lobs} kind="lobs" headers={['LoB', 'Descripción']} onEdit={onEditMaster} onDeactivate={onDeactivateMaster} onDelete={onDeleteMaster} />;
  if (page === 'people') return <MasterPanel title="Responsables" records={people} kind="people" headers={['Nombre', 'Email']} onEdit={onEditMaster} onDeactivate={onDeactivateMaster} onDelete={onDeleteMaster} />;
  if (page === 'proposals') return <DataPanel title="Preventa y estimaciones" description="Cada propuesta conserva su propio estado y queda vinculada a una oportunidad cuando existe." headers={['ID', 'Propuesta / estimación', 'Cliente', 'Tipo', 'Importe', 'Estado', 'Oportunidad vinculada']} rows={proposals.map((item) => [item.id, item.title, item.client, item.type, item.amount, item.status, item.opportunity])} />;
  if (page === 'agreements') return <AgreementPanel agreements={agreements} query={query} clients={clients} people={people} onEdit={onEditAgreement} onDelete={onDeleteAgreement} />;
  return <Analytics opportunities={opportunities} grouped={grouped} />;
}

function SummaryCard({ title, action, onAction, children }) {
  return <section className="panel-card"><div className="panel-heading"><h3>{title}</h3><button onClick={onAction}>{action} <Icon name="arrow" size={14} /></button></div>{children}</section>;
}

function DataPanel({ title, description, headers, rows }) {
  return <section className="secondary-panel"><div className="secondary-panel-heading"><div><h2>{title}</h2><p>{description}</p></div><span className="record-count">{rows.length} registros</span></div><div className="table-wrap"><table className="data-table secondary-table"><thead><tr>{headers.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cellIndex === row.length - 1 ? <span className={`status-pill ${String(cell).toLowerCase().includes('vigente') || cell === 'Activo' || cell === 'Ganada' ? 'green' : 'violet'}`}>{cell}</span> : cell}</td>)}</tr>)}</tbody></table></div><div className="panel-footnote"><span className="info-mark">i</span> Los datos de propuestas y estimaciones se conservan como referencia mientras se define su gestión persistente.</div></section>;
}

function OpportunityManagementPanel({ opportunities, onEdit, loading, error, onRetry, searchQuery, onClearSearch, archivedView, onToggleArchived, onRestore, onArchive, onDelete }) {
  return <section className="secondary-panel opportunity-management-panel">
    <div className="secondary-panel-heading">
      <div><h2>{archivedView ? 'Oportunidades archivadas' : 'Oportunidades'}</h2><p>{archivedView ? 'Registros ocultos del tablero activo. Permanecen íntegros y se pueden restaurar.' : 'Registros comerciales independientes de las iniciativas.'}</p></div>
      <div className="heading-actions"><span className="record-count">{opportunities.length} registros</span><button className="button button-secondary" onClick={onToggleArchived} aria-pressed={archivedView}>{archivedView ? 'Ver activas' : 'Ver archivadas'}</button></div>
    </div>
    {loading && <div className="board-state"><p>{archivedView ? 'Cargando oportunidades archivadas…' : 'Cargando oportunidades…'}</p></div>}
    {error && <div className="board-state"><p>No se pudieron cargar las oportunidades.</p><button className="button button-secondary" onClick={onRetry}>Reintentar</button></div>}
    {!loading && !error && <div className="table-wrap"><table className="data-table opportunity-management-table"><thead><tr>
      <th>ID interno</th><th>N.º externo</th><th>ID registro</th><th>Oportunidad</th><th>Cliente</th><th>Etapa</th><th>Resultado</th><th>Tipo</th><th>Tower</th><th>Responsable</th><th>Asignado a</th><th>Bid Manager</th><th>Importe</th><th>QA %</th><th>Próximo hito</th><th>Motivo de cierre</th><th>Acciones</th>
    </tr></thead><tbody>{opportunities.map((item) => {
      const stage = stages.find((entry) => entry.id === item.stage);
      return <tr key={item.id}>
        <td>{item.id}</td><td>{item.number || '—'}</td><td>{item.registryId || '—'}</td><td><button className="table-title" onClick={() => onEdit(item)} disabled={archivedView}>{item.title}</button></td>
        <td>{item.account || '—'}</td><td><span className={`status-pill ${stage?.tone || ''}`}>{stage?.label || item.stage}</span></td><td><OutcomeCell outcome={item.outcome} /></td><td><OpportunityTypePill type={item.opportunityType} /></td><td>{item.tower || '—'}</td>
        <td>{item.owner || '—'}</td><td>{item.assignedUserName || '—'}</td><td>{item.bidManager || '—'}</td><td className="table-amount">{item.amount}</td><td>{Number(item.qaPercent || 0)}%</td>
        <td>{item.due || '—'}</td><td>{item.closureReason || '—'}</td>
        <td className="master-actions">{archivedView ? <button className="button button-secondary" onClick={() => onRestore(item)}>Restaurar</button> : <><button className="button button-secondary" onClick={() => onEdit(item)}>Editar</button><button className="button button-secondary" onClick={() => onArchive(item)}>Archivar</button></>}<button className="button button-secondary button-danger" onClick={() => onDelete(item)}>Eliminar</button></td>
      </tr>;
    })}</tbody></table>
    {opportunities.length === 0 && <div className="empty-state opportunity-empty-state"><p>{searchQuery ? `No hay oportunidades archivadas que coincidan con la búsqueda.` : archivedView ? 'Todavía no hay oportunidades archivadas.' : 'Todavía no hay oportunidades.'}</p>{searchQuery && <button className="button button-secondary" onClick={onClearSearch}>Limpiar búsqueda</button>}</div>}
    </div>}
  </section>;
}

function InitiativeBoard({ page, initiatives, archivedInitiatives, archivedView, archivedLoading, onToggleArchived, onRestore, query, expandedColumns, onToggleColumn, onEdit, onMove, onArchive, onDelete }) {
  const [statusFilter, setStatusFilter] = useState('all');
  // The board shows the four stages; completed initiatives live in the Completada column.
  const records = archivedView ? archivedInitiatives : initiatives;
  const scoped = filterInitiativesByStatus(scopeInitiativesToPage(records, page), statusFilter);
  const normalizedQuery = query.trim().toLowerCase();
  const matched = normalizedQuery
    ? scoped.filter((item) => `${item.id} ${item.title} ${item.clientName || ''} ${initiativeCategory(item.category)} ${item.priority || ''}`.toLowerCase().includes(normalizedQuery))
    : scoped;
  const cards = matched.map((item) => ({
    ...item,
    account: item.clientName || 'Sin cliente',
    categoryLabel: initiativeCategory(item.category),
    stage: mapInitiativeStage(item.stage),
    statusLabel: initiativeStatusLabel(item.operationalStatus),
    initiativeDue: item.nextActionDate || '',
    entityType: 'initiative',
    cardKey: `initiative:${item.id}`,
    sourceRecord: item,
  }));
  const heading = page === 'crossSelling' ? 'Iniciativas de Cross-Selling' : 'Iniciativas de desarrollo';
  const title = archivedView ? `${heading} · archivadas` : heading;
  const description = archivedView
    ? 'Registros ocultos del tablero activo. Permanecen íntegros y se pueden restaurar.'
    : 'Registro independiente de las oportunidades, con su propio ciclo de vida. Las completadas no cuentan como activas.';
  const emptyMessage = (label) => (normalizedQuery ? `No hay iniciativas ${label} que coincidan con la búsqueda.` : `Todavía no hay iniciativas ${label}.`);
  // Archived records are never active; the board count separates active from completed.
  const countLabel = archivedView ? `${cards.length} registros` : initiativeCountLabel(cards);
  return <section className="secondary-panel initiative-board-panel">
    <div className="secondary-panel-heading">
      <div><h2>{title}</h2><p>{description}</p></div>
      <div className="heading-actions"><span className="record-count">{countLabel}</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por estado operativo">{INITIATIVE_STATUS_FILTERS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><button className="button button-secondary" onClick={onToggleArchived} aria-pressed={archivedView}>{archivedView ? 'Ver tablero' : 'Ver archivadas'}</button></div>
    </div>
    {archivedLoading && <div className="board-state"><p>Cargando iniciativas archivadas…</p></div>}
    {archivedView
      ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Iniciativa</th><th>Categoría</th><th>Cliente</th><th>Prioridad</th><th>Estado</th><th>Archivada por</th><th>Acciones</th></tr></thead><tbody>{cards.map((item) => <tr key={item.id}><td>{item.title}</td><td>{item.categoryLabel}</td><td>{item.account}</td><td>{item.priority || 'Media'}</td><td>{item.statusLabel}</td><td>{item.archivedByName || '—'}</td><td className="master-actions"><button className="button button-secondary" onClick={() => onRestore(item.sourceRecord)}>Restaurar</button><button className="button button-secondary button-danger" onClick={() => onDelete(item)}>Eliminar</button></td></tr>)}</tbody></table>{cards.length === 0 && <p className="empty-state">{emptyMessage('archivadas')}</p>}</div>
      : <Kanban cards={cards} allCards={cards} stageList={initiativeStages} expandedColumns={expandedColumns} onToggleColumn={onToggleColumn} onEdit={(record) => onEdit(record.sourceRecord)} onMove={onMove} onArchive={onArchive} onDelete={onDelete} />}
  </section>;
}

function Analytics({ opportunities, grouped }) {
  const totalAmount = opportunities.reduce((sum, item) => sum + parseAmount(item.amount), 0);
  const max = Math.max(...grouped.map((item) => item.count), 1);
  return <div className="analytics-layout"><section className="panel-card analytics-card"><div className="panel-heading"><div><h3>Oportunidades por Tower</h3><p>Registros del pipeline actual</p></div><span className="range-pill">Últimos 90 días <Icon name="chevron" size={13} /></span></div><div className="bar-chart">{grouped.map((item) => <div className="bar-row" key={item.tower}><span>{item.tower}</span><div className="bar-track"><i style={{ width: `${Math.max(5, item.count / max * 100)}%` }} /></div><strong>{item.count}</strong></div>)}</div></section><section className="panel-card analytic-summary"><div className="panel-heading"><h3>Resumen del pipeline</h3><span className="period-badge">Este trimestre</span></div><div className="summary-number"><small>Importe estimado en oportunidades</small><strong>{formatCurrency(totalAmount)}</strong><span>No equivale a ingreso contratado ni a valor influido del CRM corporativo.</span></div><div className="summary-divider" /><div className="mini-metric"><span>Oportunidades registradas</span><strong>{opportunities.length}</strong></div><div className="mini-metric"><span>En propuesta</span><strong>{opportunities.filter((item) => item.stage === 'proposal').length}</strong></div><div className="mini-metric"><span>Ganadas</span><strong>{opportunities.filter((item) => item.stage === 'won').length}</strong></div></section></div>;
}

function MultiSelect({ legend, hint, options, selected, onChange, disabled }) {
  const [query, setQuery] = useState('');
  const baseId = useId();
  const listId = `${baseId}-list`;
  const chips = selectedOptions(options, selected);
  const visible = filterOptions(options, query);
  return <fieldset className="relation-field multi-select" disabled={disabled}>
    <legend>{legend}</legend>
    {hint && <span className="field-hint" id={`${baseId}-hint`}>{hint}</span>}
    {chips.length > 0 && <ul className="multi-select-chips" aria-label={`${legend} seleccionados`}>
      {chips.map((option) => <li key={option.id} className={`relation-option selected${option.active === false ? ' inactive' : ''}`}><span>{option.name}{option.active === false ? ' (inactivo)' : ''}</span><button type="button" className="chip-remove" onClick={() => onChange(removeSelection(selected, option.id))} aria-label={`Quitar ${option.name}`}>×</button></li>)}
    </ul>}
    <input type="search" className="multi-select-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setQuery(''); }} placeholder={`Buscar ${legend.toLowerCase()}…`} aria-label={`Buscar en ${legend}`} aria-controls={listId} aria-describedby={hint ? `${baseId}-hint` : undefined} />
    <div className="relation-options multi-select-options" id={listId} role="group" aria-label={`Opciones de ${legend}`}>
      {options.length === 0
        ? <span className="field-hint">No hay opciones disponibles.</span>
        : visible.length === 0
          ? <span className="field-hint" role="status">Sin coincidencias.</span>
          : visible.map((option) => {
            const isSelected = selected.includes(option.id);
            const assignable = isAssignable(option, selected);
            return <label key={option.id} className={`relation-option${isSelected ? ' selected' : ''}${option.active === false ? ' inactive' : ''}`}><input type="checkbox" checked={isSelected} onChange={() => onChange(toggleSelection(selected, option))} disabled={!assignable} /><span>{option.name}{option.active === false ? ' (inactivo)' : ''}</span></label>;
          })}
    </div>
    <span className="sr-only" role="status" aria-live="polite">{selected.length} seleccionados</span>
  </fieldset>;
}

function OpportunityDialog({ record, users = [], clients, towers, services, currentServiceYear, lobs, people, initiatives, onQuickCreate, onClose, onSave, saving, saveError, historyRefresh }) {
  const dialogRef = useRef(null);
  const amountInputRef = useRef(null);
  const isEditing = Boolean(record.id);
  // Opened from an initiative's "Crear oportunidad": origin and source are fixed by the flow.
  const isConversion = !isEditing && Boolean(record.convertFromInitiativeId);
  const [form, setForm] = useState({
    id: record.id || '',
    title: record.title || '', account: record.account || '',
    stage: record.stage || 'prospecting', tower: record.tower || '', owner: record.owner || '',
    due: record.due || '', tags: record.tags || [], number: record.number || '',
    clientId: record.clientId || '', ownerId: record.ownerId || '', bidManagerId: record.bidManagerId || '', qaPercent: record.qaPercent ?? 0, closureReason: record.closureReason || '',
    origin: record.origin || '', probability: record.probability === null || record.probability === undefined ? '' : String(record.probability),
    expectedCloseDate: record.expectedCloseDate || '', nextMilestone: record.nextMilestone || '', nextMilestoneDate: record.nextMilestoneDate || '',
    need: record.need || '', initiativeId: record.initiativeId || '', outcome: record.outcome || '', pep: record.pep || '',
    opportunityType: record.opportunityType || '',
    registryId: record.registryId || '',
    assignedUserId: record.assignedUserId || '',
    towerIds: (record.towers || []).map((item) => item.id),
    lobIds: (record.lobs || []).map((item) => item.id),
    serviceIds: (record.services || []).map((item) => item.id),
    links: toWorkspaceLinkForm(record.links),
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
  const initiativeChoices = originInitiativeOptions(initiatives, form.initiativeId);
  // The list may only hold active initiatives; keep an archived current link selectable.
  if (record.initiativeId && form.initiativeId === record.initiativeId && !initiativeChoices.some((item) => item.id === record.initiativeId)) {
    initiativeChoices.push({ id: record.initiativeId, title: record.initiativeTitle || 'Iniciativa archivada', archivedAt: 'archived' });
  }
  const linkedInitiative = initiativeChoices.find((item) => item.id === form.initiativeId);
  const isResult = form.stage === 'result';
  const probabilityValue = form.probability === '' ? null : Number(form.probability);
  const weightedPreview = probabilityValue === null || Number.isNaN(probabilityValue) ? null : computeWeightedAmount({ amount: amountText, qaPercent: form.qaPercent, probability: probabilityValue });
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!form.title.trim()) { setError('Completa el nombre de la oportunidad.'); return; }
    const typeError = validateOpportunityType(form.opportunityType);
    if (typeError) { setError(typeError); return; }
    const amount = parseAmount(amountText);
    if (!(amount >= 0)) { setError('El importe debe ser igual o superior a cero.'); return; }
    if (Number(form.qaPercent) < 0 || Number(form.qaPercent) > 100) { setError('La participación QA debe estar entre 0 y 100 %.'); return; }
    if (probabilityValue !== null && (Number.isNaN(probabilityValue) || probabilityValue < 0 || probabilityValue > 100)) { setError('La probabilidad debe estar entre 0 y 100 %.'); return; }
    const originError = validateOriginInitiative(form, record);
    if (originError) { setError(originError); return; }
    const resultError = validateOpportunityResult(form);
    if (resultError) { setError(resultError); return; }
    setError('');
    const selectedTowers = towers.filter((item) => form.towerIds.includes(item.id));
    const milestone = form.nextMilestone.trim();
    const milestoneDate = form.nextMilestoneDate.trim();
    try {
      await onSave({
        id: form.id,
        title: form.title.trim(),
        account: clients.find((item) => item.id === form.clientId)?.name || form.account.trim(),
        amount: formatCurrency(amount),
        stage: form.stage,
        tower: selectedTowers[0]?.name || form.tower,
        owner: people.find((item) => item.id === form.ownerId)?.name || form.owner,
        due: milestoneDate || milestone || 'Por definir',
        tags: form.tags,
        number: form.number.trim(), clientId: form.clientId, towerId: '', ownerId: form.ownerId,
        bidManagerId: form.bidManagerId, qaPercent: Number(form.qaPercent), closureReason: form.closureReason.trim(),
        origin: form.origin,
        probability: probabilityValue === null || Number.isNaN(probabilityValue) ? null : probabilityValue,
        expectedCloseDate: form.expectedCloseDate,
        nextMilestone: milestone,
        nextMilestoneDate: milestoneDate,
        need: form.need.trim(),
        initiativeId: form.initiativeId,
        outcome: isResult ? form.outcome : '',
        pep: form.pep.trim(),
        opportunityType: form.opportunityType,
        registryId: form.registryId.trim(),
        assignedUserId: form.assignedUserId,
        towerIds: form.towerIds,
        lobIds: form.lobIds,
        serviceIds: form.serviceIds,
        links: normalizeWorkspaceLinks(form.links),
      });
    } catch {
      // The parent surfaces the API message through saveError.
    }
  };

  return <dialog ref={dialogRef} className="opportunity-dialog" aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={submit}>
      <div className="dialog-heading"><div><span className="eyebrow">CRM QE · OPORTUNIDAD</span><h2 id="dialog-title">{isEditing ? 'Editar oportunidad' : 'Nueva oportunidad'}</h2><p>Registra el seguimiento QE. No reemplaza la oportunidad del CRM corporativo.</p></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose} disabled={saving}><Icon name="close" /></button></div>
      <div className="form-grid">
        <label className="form-field wide">Nombre de la oportunidad *<input autoFocus value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="Ej. Modernización de plataforma de datos" required disabled={saving} /></label>
        <label className="form-field">Tipo de oportunidad *<select value={form.opportunityType} onChange={(event) => update('opportunityType', event.target.value)} aria-required="true" disabled={saving}><option value="">Selecciona un tipo</option>{opportunityTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select>{isEditing && !record.opportunityType && <span className="field-hint">Registro sin tipo: elige uno para guardar los cambios.</span>}</label>
        <label className="form-field">Número de oportunidad<input value={form.number} onChange={(event) => update('number', event.target.value)} placeholder="Identificador externo" disabled={saving} /></label>
        <label className="form-field">ID registro<input value={form.registryId} onChange={(event) => update('registryId', event.target.value)} placeholder="Portal del cliente, pliego o ERP" maxLength="120" disabled={saving} /><span className="field-hint">Opcional. Referencia externa del registro.</span></label>
        <label className="form-field">Cliente / cuenta<select value={form.clientId} onChange={(event) => update('clientId', event.target.value)} disabled={saving}><option value="">Sin cliente asociado</option>{clients.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('clients', (id) => { update('clientId', id); setForm((current) => ({ ...current, clientId: id, account: clients.find((item) => item.id === id)?.name || current.account })); })}>+ Crear cliente</button></label>
        <label className="form-field">Importe estimado *<span className="amount-field"><input ref={amountInputRef} value={amountText} onChange={handleAmountChange} onBlur={handleAmountBlur} inputMode="decimal" autoComplete="off" placeholder="125.000,00" required disabled={saving} /><span className="amount-suffix" aria-hidden="true">{AMOUNT_CURRENCY}</span></span></label>
        <label className="form-field">Etapa<select value={form.stage} onChange={(event) => update('stage', event.target.value)} disabled={saving}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
        <label className="form-field">Origen<select value={form.origin} onChange={(event) => setForm((current) => applyOriginChange(current, event.target.value))} disabled={saving || isConversion}><option value="">Sin definir</option>{opportunityOrigins.map((origin) => <option key={origin} value={origin}>{origin}</option>)}</select>{form.initiativeId && !form.origin && <span className="field-hint">Se guardará como «Iniciativa interna».</span>}</label>
        {requiresOriginInitiative(form.origin) && <label className="form-field">Iniciativa de origen *<select value={form.initiativeId} onChange={(event) => update('initiativeId', event.target.value)} aria-required="true" disabled={saving || isConversion}><option value="">Selecciona una iniciativa</option>{initiativeChoices.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.title}{item.archivedAt ? ' (archivada)' : ''}</option>)}</select><span className="field-hint">{linkedInitiative ? `Vinculada a ${linkedInitiative.id} · ${linkedInitiative.title}. ` : ''}{isConversion ? 'Al guardar esta oportunidad, la iniciativa se marcará como Completada.' : 'Los ciclos de vida de la iniciativa y la oportunidad son independientes.'}</span></label>}
        <label className="form-field">Probabilidad (%)<input type="number" min="0" max="100" step="1" value={form.probability} onChange={(event) => update('probability', event.target.value)} placeholder="Sin probabilidad" disabled={saving} /><span className="field-hint">{weightedPreview === null ? 'Sin probabilidad no se calcula el importe ponderado.' : `Importe ponderado (importe QE × probabilidad): ${formatCurrency(weightedPreview)}.`}</span></label>
        <label className="form-field">Fecha estimada de cierre<input type="date" value={form.expectedCloseDate} onChange={(event) => update('expectedCloseDate', event.target.value)} disabled={saving} /></label>
        <label className="form-field">Próximo hito<input value={form.nextMilestone} onChange={(event) => update('nextMilestone', event.target.value)} placeholder="Ej. Revisión de propuesta" disabled={saving} /></label>
        <label className="form-field">Fecha del próximo hito<input type="date" value={form.nextMilestoneDate} onChange={(event) => update('nextMilestoneDate', event.target.value)} disabled={saving} /></label>
        <label className="form-field">Responsable<select value={form.ownerId} onChange={(event) => update('ownerId', event.target.value)} disabled={saving}><option value="">Sin responsable</option>{people.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('people', (id) => update('ownerId', id))}>+ Crear responsable</button></label>
        <AssigneeField value={form.assignedUserId} users={users} onChange={(value) => update('assignedUserId', value)} disabled={saving} />
        <label className="form-field">Bid Manager<select value={form.bidManagerId} onChange={(event) => update('bidManagerId', event.target.value)} disabled={saving}><option value="">Sin asignar</option>{people.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('people', (id) => update('bidManagerId', id))}>+ Crear responsable</button></label>
        <label className="form-field">Participación del equipo QA (%)<input type="number" min="0" max="100" value={form.qaPercent} onChange={(event) => update('qaPercent', event.target.value)} disabled={saving} /><span className="field-hint">Alimenta el KPI Pipeline QE.</span></label>
        {isResult && <label className="form-field">Resultado *<select value={form.outcome} onChange={(event) => update('outcome', event.target.value)} disabled={saving}><option value="">Selecciona un resultado</option>{opportunityOutcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.label}</option>)}</select></label>}
        {isResult && form.outcome !== 'won' && <label className="form-field wide">Motivo de cierre<input value={form.closureReason} onChange={(event) => update('closureReason', event.target.value)} maxLength="160" disabled={saving} /></label>}
        {form.outcome === 'won' && <label className="form-field wide">PEP<input value={form.pep} onChange={(event) => update('pep', event.target.value)} placeholder="Identificador PEP" maxLength="160" disabled={saving} /><span className="field-hint">Obligatorio para la etapa Resultado con resultado Ganada. Se conserva si cambia el resultado.</span></label>}
        <label className="form-field wide">Descripción / necesidad<textarea rows="3" value={form.need} onChange={(event) => update('need', event.target.value)} placeholder="Contexto, alcance y necesidad del cliente" maxLength="2000" disabled={saving} /></label>
      </div>
      <MultiSelect legend="Towers" hint="Una oportunidad puede cubrir varias towers." options={towers} selected={form.towerIds} onChange={(ids) => update('towerIds', ids)} disabled={saving} />
      <MultiSelect legend="LoB" hint="Las LoB se asignan de forma manual, sin inferencia desde las towers." options={lobs} selected={form.lobIds} onChange={(ids) => update('lobIds', ids)} disabled={saving} />
      <MultiSelect legend="Servicios" hint={`Solo se asignan servicios activos del ejercicio ${currentServiceYear}. Los vínculos de otros ejercicios o inactivos se conservan y se pueden quitar.`} options={buildServiceOptions(services, form.serviceIds, currentServiceYear)} selected={form.serviceIds} onChange={(ids) => update('serviceIds', ids)} disabled={saving} />
      <WorkspaceLinksEditor links={form.links} onChange={(links) => update('links', links)} disabled={saving} />
      {isEditing && <CardHistory opportunityId={form.id} refreshKey={historyRefresh} />}
      {isEditing && <RecordActions type="opportunities" id={form.id} />}
      <div className="dialog-hint"><span className="info-mark">i</span> Las propuestas y estimaciones se gestionan como registros independientes vinculados.</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : (isEditing ? 'Guardar cambios' : 'Crear oportunidad')}</button></div>
    </form>
  </dialog>;
}

function initiativeCategory(value) {
  const legacy = { internal: 'Desarrollo de negocio interno (Seidor/Towers)', cross_selling: 'Cross-selling', external: 'Prospección externa' };
  return legacy[value] || (initiativeCategories.includes(value) ? value : (value || 'Otros'));
}

function MasterPanel({ title, records, kind, headers, onEdit, onDeactivate, onDelete }) {
  const columns = { clients: ['name', 'sector'], people: ['name', 'email'], towers: ['name', 'responsibleName', 'lobName'], services: ['name', 'description'], lobs: ['name', 'description'] }[kind];
  const hasLifecycle = kind !== 'towers';
  const description = kind === 'services'
    ? 'Los servicios inactivos no se pueden asignar a nuevos registros, pero siguen visibles en los vínculos existentes. Solo se pueden eliminar los servicios sin vínculos.'
    : kind === 'lobs'
      ? 'Una LoB no se puede desactivar ni eliminar mientras alguna tower u oportunidad la referencie.'
      : hasLifecycle ? 'Desactivar conserva el registro y sus vínculos. Eliminar solo es posible si no tiene vínculos.' : 'Cada tower tiene un responsable asignado. Las towers vinculadas no se pueden eliminar.';
  return <section className="secondary-panel"><div className="secondary-panel-heading"><div><h2>{title}</h2><p>{description}</p></div><span className="record-count">{records.length} registros</span></div><div className="table-wrap"><table className="data-table"><thead><tr>{headers.map((label) => <th key={label}>{label}</th>)}{hasLifecycle && <th>Estado</th>}<th>Acciones</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}>{columns.map((field) => <td key={field}>{record[field] || '—'}</td>)}{hasLifecycle && <td>{record.active ? 'Activo' : 'Inactivo'}</td>}<td className="master-actions"><button className="button button-secondary" onClick={() => onEdit(kind, record)}>Editar</button>{hasLifecycle && record.active && <button className="button button-secondary" onClick={() => onDeactivate(kind, record)}>Desactivar</button>}<button className="button button-secondary button-danger" onClick={() => onDelete(kind, record)}>Eliminar</button></td></tr>)}</tbody></table>{records.length === 0 && <p className="empty-state">Todavía no hay registros. Crea uno para poder seleccionarlo en iniciativas y oportunidades.</p>}</div></section>;
}

/** Services of one fiscal year, with year tabs and the year create/delete actions. */
function ServicesPanel({ services, serviceYears, activeYear, onSelectYear, onNewYear, onDeleteYear, onEdit, onDeactivate, onDelete }) {
  const years = yearNumbers(serviceYears.years);
  return <div className="service-years">
    <div className="service-year-bar">
      <div className="service-year-tabs" role="tablist" aria-label="Ejercicios">
        {years.map((year) => <button key={year} type="button" role="tab" aria-selected={year === activeYear} className={`button ${year === activeYear ? 'button-primary' : 'button-secondary'}`} onClick={() => onSelectYear(year)}>{year}{year === serviceYears.currentYear ? ' (actual)' : ''}</button>)}
        {years.length === 0 && <span className="field-hint">Todavía no hay ejercicios.</span>}
      </div>
      <div className="service-year-actions">
        <button type="button" className="button button-secondary" onClick={onNewYear}><Icon name="plus" size={16} /> Nuevo ejercicio</button>
        {activeYear !== null && <button type="button" className="button button-secondary button-danger" onClick={() => onDeleteYear(activeYear)}>Eliminar ejercicio</button>}
      </div>
    </div>
    {activeYear !== null && !years.includes(serviceYears.currentYear) && <p className="form-error" role="status">No existe el ejercicio {serviceYears.currentYear}: crea el ejercicio (o cópialo del anterior) para poder asignar servicios a iniciativas y oportunidades.</p>}
    <MasterPanel title={activeYear === null ? 'Servicios' : `Servicios ${activeYear}`} records={activeYear === null ? [] : servicesOfYear(services, activeYear)} kind="services" headers={['Servicio', 'Descripción']} onEdit={onEdit} onDeactivate={onDeactivate} onDelete={onDelete} />
  </div>;
}

/** "Nuevo ejercicio": year input plus the option to copy the active services of the previous year. */
function ServiceYearDialog({ years, currentYear, onClose, onSave }) {
  const [year, setYear] = useState(String(suggestNewServiceYear(years, currentYear)));
  const [copyPrevious, setCopyPrevious] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef(null);
  useEffect(() => { dialogRef.current?.showModal(); return () => { if (dialogRef.current?.open) dialogRef.current.close(); }; }, []);
  const parsedYear = Number(year);
  const previous = Number.isInteger(parsedYear) ? previousServiceYear(years, parsedYear) : null;
  const submit = async (event) => {
    event.preventDefault(); setError('');
    if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2100) { setError('El ejercicio debe ser un año entre 2000 y 2100.'); return; }
    setSaving(true);
    try { await onSave({ year: parsedYear, copyFromYear: copyPrevious && previous !== null ? previous : null }); }
    catch (err) { setError(err?.message || 'No se pudo crear el ejercicio.'); }
    finally { setSaving(false); }
  };
  return <dialog ref={dialogRef} className="opportunity-dialog compact-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }}><form onSubmit={submit}>
    <div className="dialog-heading"><div><span className="eyebrow">DATOS MAESTROS</span><h2>Nuevo ejercicio</h2></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><Icon name="close" /></button></div>
    <div className="form-grid">
      <label className="form-field wide">Año<input type="number" required min="2000" max="2100" step="1" value={year} onChange={(event) => setYear(event.target.value)} /></label>
      {previous !== null
        ? <label className="form-field wide checkbox-field"><span><input type="checkbox" checked={copyPrevious} onChange={(event) => setCopyPrevious(event.target.checked)} /> Copiar servicios del ejercicio anterior ({previous})</span><span className="field-hint">Se copian los servicios activos como registros nuevos del ejercicio.</span></label>
        : <span className="field-hint wide">No hay un ejercicio anterior del que copiar servicios.</span>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>Crear ejercicio</button></div>
  </form></dialog>;
}

function MasterDialog({ kind, record, people, lobs, onClose, onSave, onSaved }) {
  const labels = {
    clients: ['Nuevo cliente', 'Cliente', ['name', 'Nombre', 'sector', 'Sector']],
    towers: ['Nueva tower', 'Tower', ['name', 'Nombre']],
    services: ['Nuevo servicio', 'Servicio', ['name', 'Nombre', 'description', 'Descripción']],
    lobs: ['Nueva LoB', 'LoB', ['name', 'Nombre', 'description', 'Descripción']],
    people: ['Nuevo responsable', 'Responsable', ['name', 'Nombre', 'email', 'Email']],
  }[kind];
  const [values, setValues] = useState({ name: record.name || '', sector: record.sector || '', email: record.email || '', description: record.description || '', responsibleId: record.responsibleId || '', lobId: record.lobId || '', active: record.active ?? true, ...(kind === 'services' && record.year ? { year: record.year } : {}) });
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
  return <dialog ref={dialogRef} className="opportunity-dialog compact-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }}><form onSubmit={submit}><div className="dialog-heading"><div><span className="eyebrow">DATOS MAESTROS</span><h2>{record.id ? `Editar ${labels[1].toLowerCase()}` : labels[0]}</h2></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><Icon name="close" /></button></div><div className="form-grid">{fields.map(([field, label]) => <label className="form-field wide" key={field}>{label}<input required={field === 'name'} value={values[field]} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))} />{field === 'description' && <span className="field-hint">Opcional</span>}{field === 'name' && kind === 'services' && values.year && <span className="field-hint">Ejercicio {values.year}</span>}{field === 'email' && <span className="field-hint">Opcional</span>}</label>)}{kind === 'towers' && <label className="form-field wide">Responsable *<select required value={values.responsibleId} onChange={(event) => setValues((current) => ({ ...current, responsibleId: event.target.value }))}><option value="">Selecciona un responsable</option>{people.filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}{kind === 'towers' && <label className="form-field wide">LoB<select value={values.lobId} onChange={(event) => setValues((current) => ({ ...current, lobId: event.target.value }))}><option value="">Sin LoB</option>{lobs.filter((lob) => lob.active || lob.id === values.lobId).map((lob) => <option key={lob.id} value={lob.id}>{lob.name}</option>)}</select><span className="field-hint">Una tower pertenece a una sola LoB como máximo.</span></label>}{record.id && kind !== 'towers' && <label className="form-field wide">Estado<select value={values.active ? 'active' : 'inactive'} onChange={(event) => setValues((current) => ({ ...current, active: event.target.value === 'active' }))}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>}</div>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit">Guardar</button></div></form></dialog>;
}

function InitiativeDialog({ record, users = [], clients, services, currentServiceYear, onQuickCreate, onClose, onSave, onCreateOpportunity }) {
  const dialogRef = useRef(null);
  const [form, setForm] = useState({
    id: record.id || '',
    title: record.title || '',
    category: record.category || 'Prospección externa',
    clientId: record.clientId || '',
    priority: record.priority || 'Media',
    stage: mapInitiativeStage(record.stage),
    operationalStatus: record.operationalStatus || 'active',
    nextActionDate: record.nextActionDate || '',
    description: record.description || '',
    assignedUserId: record.assignedUserId || '',
    serviceIds: (record.services || []).map((item) => item.id),
    links: toWorkspaceLinkForm(record.links),
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { dialogRef.current?.showModal(); return () => { if (dialogRef.current?.open) dialogRef.current.close(); }; }, []);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const generatedOpportunities = record.opportunities || [];
  // Same validation and payload for "Guardar" and for "Crear oportunidad" (which saves first).
  const persist = async (handler, fallbackMessage) => {
    if (saving) return;
    if (!form.title.trim()) { setError('Indica el nombre de la iniciativa.'); return; }
    setError('');
    setSaving(true);
    try {
      await handler({
        ...form,
        id: record.id || '',
        title: form.title.trim(),
        links: normalizeWorkspaceLinks(form.links),
      });
    } catch (err) {
      setError(err?.message || fallbackMessage);
    } finally {
      setSaving(false);
    }
  };
  const save = (event) => {
    event.preventDefault();
    return persist(onSave, 'No se pudo guardar la iniciativa.');
  };
  const createOpportunity = () => {
    if (!onCreateOpportunity) return undefined;
    return persist(onCreateOpportunity, 'No se pudo guardar la iniciativa antes de crear la oportunidad.');
  };
  return <dialog ref={dialogRef} className="opportunity-dialog" aria-labelledby="initiative-dialog-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={save}>
      <div className="dialog-heading"><div><span className="eyebrow">CRM QE · INICIATIVA</span><h2 id="initiative-dialog-title">{record.id ? 'Editar iniciativa' : 'Nueva iniciativa'}</h2><p>Registro independiente de las oportunidades, con su propio ciclo de vida.</p></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose} disabled={saving}><Icon name="close" /></button></div>
      <div className="form-grid">
        <label className="form-field wide">Nombre de la iniciativa *<input autoFocus required value={form.title} onChange={(event) => update('title', event.target.value)} disabled={saving} /></label>
        <label className="form-field">Categoría<select value={form.category} onChange={(event) => update('category', event.target.value)} disabled={saving}>{initiativeCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <label className="form-field">Cliente<select value={form.clientId} onChange={(event) => update('clientId', event.target.value)} disabled={saving}><option value="">Sin cliente</option>{clients.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('clients', (id) => update('clientId', id))} disabled={saving}>+ Crear cliente</button></label>
        <label className="form-field">Prioridad<select value={form.priority} onChange={(event) => update('priority', event.target.value)} disabled={saving}>{initiativePriorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
        <label className="form-field">Etapa<select value={form.stage} onChange={(event) => update('stage', event.target.value)} disabled={saving}>{initiativeStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
        <label className="form-field">Estado operativo<select value={form.operationalStatus} onChange={(event) => update('operationalStatus', event.target.value)} disabled={saving}>{initiativeStatuses.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select><span className="field-hint">Pausada y Descartada son estados alternativos, no columnas del tablero.</span></label>
        <label className="form-field">Fecha de la próxima acción<input type="date" value={form.nextActionDate} onChange={(event) => update('nextActionDate', event.target.value)} disabled={saving} /></label>
        <AssigneeField value={form.assignedUserId} users={users} onChange={(value) => update('assignedUserId', value)} disabled={saving} />
        <label className="form-field wide">Descripción<textarea rows="3" value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="Contexto y objetivo de la iniciativa" maxLength="2000" disabled={saving} /></label>
      </div>
      <MultiSelect legend="Servicios" hint={`Solo se asignan servicios activos del ejercicio ${currentServiceYear}. Los vínculos de otros ejercicios o inactivos se conservan y se pueden quitar.`} options={buildServiceOptions(services, form.serviceIds, currentServiceYear)} selected={form.serviceIds} onChange={(ids) => update('serviceIds', ids)} disabled={saving} />
      <WorkspaceLinksEditor links={form.links} onChange={(links) => update('links', links)} disabled={saving} />
      {record.id && <section className="generated-opportunities">
        <div className="generated-opportunities-heading"><h3>Oportunidades generadas ({generatedOpportunities.length})</h3>{onCreateOpportunity && <button type="button" className="button button-secondary" onClick={createOpportunity} disabled={saving}>Crear oportunidad</button>}</div>
        {onCreateOpportunity && <p className="field-hint">«Crear oportunidad» guarda antes los cambios de la iniciativa. La iniciativa pasará a Completada cuando se guarde la oportunidad; si cancelas, seguirá en su etapa actual.</p>}
        {generatedOpportunities.length === 0
          ? <p className="field-hint">Todavía no hay oportunidades vinculadas a esta iniciativa.</p>
          : <ul className="generated-opportunity-list">{generatedOpportunities.map((item) => <li key={item.id} className={item.archived ? 'archived' : undefined}><span><strong>{item.id} · {item.title}</strong><small>{[stages.find((stage) => stage.id === item.stage)?.label || item.stage, item.owner || 'Sin responsable', item.expectedCloseDate ? `Cierre ${item.expectedCloseDate}` : 'Sin fecha de cierre', item.outcome, item.archived ? 'Archivada' : ''].filter(Boolean).join(' · ')}</small></span><b>{item.amount}</b></li>)}</ul>}
      </section>}
      {record.id && <><RecordActions type="initiatives" id={record.id} /><InitiativeHistory id={record.id} /></>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar iniciativa'}</button></div>
    </form>
  </dialog>;
}

/** Shared Workspace links editor for opportunities, initiatives and framework agreements. */
function WorkspaceLinksEditor({ links, onChange, disabled }) {
  // Saved links with a safe URL render as clickable links; new or edited rows render as inputs.
  const [editingRows, setEditingRows] = useState(() => new Set());
  const updateLink = (index, field, value) => onChange(links.map((link, position) => (position === index ? { ...link, [field]: value } : link)));
  const addLink = () => {
    if (links.length >= MAX_WORKSPACE_LINKS) return;
    setEditingRows((current) => new Set(current).add(links.length));
    onChange([...links, { title: DEFAULT_WORKSPACE_LINK_TITLE, url: '' }]);
  };
  const editLink = (index) => setEditingRows((current) => new Set(current).add(index));
  const removeLink = (index) => {
    setEditingRows((current) => new Set([...current].filter((row) => row !== index).map((row) => (row > index ? row - 1 : row))));
    onChange(links.filter((_, position) => position !== index));
  };
  return <fieldset className="relation-field">
    <legend>Enlaces Workspace</legend>
    <span className="field-hint">Cada enlace necesita título y URL. Hasta {MAX_WORKSPACE_LINKS} enlaces.</span>
    <div className="link-editor">
      {links.length === 0 && <span className="field-hint">Todavía no hay enlaces.</span>}
      {links.map((link, index) => {
        const href = safeWorkspaceUrl(link.url);
        const linkTitle = link.title || DEFAULT_WORKSPACE_LINK_TITLE;
        if (href && !editingRows.has(index)) {
          return <div className="link-view" key={index}>
            <span className="link-view-text"><strong>{linkTitle}</strong><a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${linkTitle}: ${link.url} (se abre en una pestaña nueva)`}>{link.url}</a></span>
            <button type="button" className="inline-link" onClick={() => editLink(index)} disabled={disabled} aria-label={`Editar enlace ${linkTitle}`}>Editar</button>
            <button type="button" className="icon-button" aria-label={`Quitar enlace ${index + 1}`} onClick={() => removeLink(index)} disabled={disabled}><Icon name="close" size={16} /></button>
          </div>;
        }
        return <div className="link-row" key={index}><input aria-label={`Título del enlace ${index + 1}`} value={link.title} onChange={(event) => updateLink(index, 'title', event.target.value)} placeholder={DEFAULT_WORKSPACE_LINK_TITLE} maxLength="120" disabled={disabled} /><input aria-label={`URL del enlace ${index + 1}`} value={link.url} onChange={(event) => updateLink(index, 'url', event.target.value)} placeholder="https://workspaces.example/..." maxLength="500" disabled={disabled} />{href ? <a className="link-open" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${link.title || DEFAULT_WORKSPACE_LINK_TITLE} en una pestaña nueva`}>Abrir</a> : <span className="link-open" aria-hidden="true" />}<button type="button" className="icon-button" aria-label={`Quitar enlace ${index + 1}`} onClick={() => removeLink(index)} disabled={disabled}><Icon name="close" size={16} /></button></div>;
      })}
    </div>
    <button type="button" className="inline-link" onClick={addLink} disabled={disabled || links.length >= MAX_WORKSPACE_LINKS}>+ Añadir enlace</button>
  </fieldset>;
}

/** Read-only link list for tables: only safe URLs become anchors, opened in a new tab. */
function WorkspaceLinkList({ links }) {
  const safe = (links || []).map((link) => ({ ...link, href: safeWorkspaceUrl(link.url) })).filter((link) => link.href);
  if (safe.length === 0) return '—';
  return <span className="workspace-link-list">{safe.map((link) => <a key={link.id || link.href} href={link.href} target="_blank" rel="noopener noreferrer" title={link.url}>{link.title}</a>)}</span>;
}

function AgreementPanel({ agreements, query = '', clients, people, onEdit, onDelete }) {
  const records = filterAgreements(agreements, query, clients, people);
  const emptyMessage = query.trim() ? 'No hay acuerdos marco que coincidan con la búsqueda.' : 'Todavía no hay acuerdos marco.';
  return <section className="secondary-panel"><div className="secondary-panel-heading"><div><h2>Acuerdos vigentes y renovaciones</h2><p>Acuerdos marco persistidos. Los contratos y aprobaciones se gestionan en los sistemas corporativos.</p></div><span className="record-count">{records.length} registros</span></div><div className="table-wrap"><table className="data-table secondary-table"><thead><tr>{['ID', 'Acuerdo', 'ID registro', 'Cliente', 'Importe', 'Fin de vigencia', 'Responsable', 'Asignado a', 'Enlaces', 'Estado', 'Acciones'].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{records.map((item) => <tr key={item.id}><td>{item.id.slice(0, 8)}</td><td>{item.title}</td><td>{item.registryId || '—'}</td><td>{clients.find((x) => x.id === item.clientId)?.name || '—'}</td><td>{formatCurrency(item.amount)}</td><td>{item.endDate || '—'}</td><td>{people.find((x) => x.id === item.ownerId)?.name || '—'}</td><td>{item.assignedUserName || '—'}</td><td><WorkspaceLinkList links={item.links} /></td><td><span className={`status-pill ${item.status === 'active' ? 'green' : 'violet'}`}>{item.status === 'active' ? 'Vigente' : 'Inactivo'}</span></td><td className="master-actions"><button className="button button-secondary" onClick={() => onEdit(item)}>Editar</button><button className="button button-secondary button-danger" onClick={() => onDelete(item)}>Eliminar</button></td></tr>)}</tbody></table>{records.length === 0 && <p className="empty-state">{emptyMessage}</p>}</div></section>;
}

function AgreementDialog({ agreement = {}, users = [], clients, people, onQuickCreate, onClose, onSave }) {
  const isEditing = Boolean(agreement.id);
  const [form, setForm] = useState({ title: agreement.title || '', registryId: agreement.registryId || '', clientId: agreement.clientId || '', ownerId: agreement.ownerId || '', endDate: agreement.endDate || '', notes: agreement.notes || '', assignedUserId: agreement.assignedUserId || '', links: toWorkspaceLinkForm(agreement.links) });
  const [amountText, setAmountText] = useState(() => (agreement.amount ? formatAmountInput(String(agreement.amount).replace('.', ',')) : ''));
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  useEffect(() => { dialogRef.current?.showModal(); return () => { if (dialogRef.current?.open) dialogRef.current.close(); }; }, []);
  const submit = async (event) => { event.preventDefault(); try { await onSave({ ...form, ...(isEditing ? { id: agreement.id } : {}), registryId: form.registryId.trim(), links: normalizeWorkspaceLinks(form.links), amount: parseAmount(amountText) }); } catch (err) { setError(err?.message || 'No se pudo guardar el acuerdo.'); } };
  return <dialog ref={dialogRef} className="opportunity-dialog compact-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }}><form onSubmit={submit}><div className="dialog-heading"><div><span className="eyebrow">DATOS COMERCIALES</span><h2>{isEditing ? 'Editar acuerdo marco' : 'Nuevo acuerdo marco'}</h2></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><Icon name="close" /></button></div><div className="form-grid"><label className="form-field wide">Nombre del acuerdo *<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label className="form-field wide">ID registro<input value={form.registryId} onChange={(event) => setForm({ ...form, registryId: event.target.value })} placeholder="Portal del cliente, pliego o ERP" maxLength="120" /><span className="field-hint">Opcional. Referencia externa del registro.</span></label><label className="form-field">Cliente<select value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}><option value="">Sin cliente</option>{clients.filter((x) => x.active || x.id === form.clientId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('clients', (id) => setForm((current) => ({ ...current, clientId: id })))}>+ Crear cliente</button></label><label className="form-field">Responsable<select value={form.ownerId} onChange={(event) => setForm({ ...form, ownerId: event.target.value })}><option value="">Sin responsable</option>{people.filter((x) => x.active || x.id === form.ownerId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><button type="button" className="inline-link" onClick={() => onQuickCreate('people', (id) => setForm((current) => ({ ...current, ownerId: id })))}>+ Crear responsable</button></label><AssigneeField value={form.assignedUserId} users={users} onChange={(value) => setForm((current) => ({ ...current, assignedUserId: value }))} /><label className="form-field">Importe<span className="amount-field"><input value={amountText} onChange={(event) => setAmountText(formatAmountInput(event.target.value))} onBlur={() => setAmountText(formatAmountInput(amountText.replace(/,+$/, '')))} inputMode="decimal" autoComplete="off" placeholder="0,00" /><span className="amount-suffix" aria-hidden="true">{AMOUNT_CURRENCY}</span></span><span className="field-hint">Déjalo vacío o en 0 si no aplica.</span></label><label className="form-field">Fin de vigencia<input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label><label className="form-field wide">Notas<textarea rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength="2000" /></label></div><WorkspaceLinksEditor links={form.links} onChange={(links) => setForm((current) => ({ ...current, links }))} disabled={false} />{error && <p className="form-error">{error}</p>}<div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary">{isEditing ? 'Guardar cambios' : 'Crear acuerdo'}</button></div></form></dialog>;
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
  const labels = { created: 'Creó la iniciativa', updated: 'Actualizó la iniciativa', action_added: 'Añadió una acción o nota', action_completed: 'Completó una acción', action_reopened: 'Reabrió una acción', converted: 'Creó una oportunidad y completó la iniciativa' };
  return <section className="record-actions" aria-labelledby="initiative-history-title"><h3 id="initiative-history-title">Historial</h3>{events.length === 0 ? <p className="empty-actions">Todavía no hay cambios registrados.</p> : <div className="history-scroll" tabIndex={0} role="region" aria-label="Historial de la iniciativa"><ul className="action-list">{events.map((event) => <li key={event.id}><span><strong>{labels[event.action] || event.action}</strong><small>{event.userName} · {new Date(event.createdAt).toLocaleString('es-ES')}</small></span></li>)}</ul></div>}</section>;
}

export default App;
