import { useEffect, useRef, useState } from 'react';
import {
  createOperationRecord, deleteOperationRecord, getOperationRecordLinks, listActivityCatalog, listOperationRecords, reorderTalents, updateOperationRecord,
} from './api.js';
import { toLocalIsoDate } from './calendar.js';
import { PEOPLE_TABS, TRAINING_TABS } from './navigation.js';
import {
  ACTIVITY_FORM_FIELDS, ASSIGNMENT_FORM_FIELDS, CAREER_LEVELS, COURSE_FORM_FIELDS, DEFAULT_PERFORMANCE_STATUS, PERFORMANCE_FORM_FIELDS, PERFORMANCE_STATUSES,
  PLAN_FORM_FIELDS, PLAN_STATUS_DEFAULTS, SKILL_FORM_FIELDS, SKILL_LEVELS, TALENT_CATEGORIES, TALENT_CREATE_FORM_FIELDS, TALENT_FORM_FIELDS, TALENT_PROFILES,
  buildActivityMatrix, composeTalentName, computeAssignmentTotals, computeAvailability, configuredCareerLevels, filterRecords, isAvailable, mergeOptions,
  overAllocatedTalents, performanceYears, safeExternalUrl, skillLevelLabel, syncPrimaryTower, talentAvailability, validateActivityForm, validateAssignmentForm,
  validateCourseForm, validatePerformanceCreateForm, validatePerformanceForm, validatePlanForm, validateSkillForm, validateTalentCreateForm, validateTalentForm,
} from './people.js';
import { loadPeopleTab, loadTrainingTab, savePeopleTab, saveTrainingTab } from './preferences.js';
import { moveColumnTo, orderByIds } from './tableState.js';
import {
  DeleteRecordDialog, DetailsDialog, RecordDialog, RecordPanel, SearchBox, TabStrip, formatDateTime, formatNumber, numberToInput, useCollection,
} from './OperationsUi.jsx';
import { FieldError, FormField, useFieldErrors } from './FormField.jsx';

const EYEBROW = 'PEOPLE';

/**
 * Shared create/edit/delete wiring of one resource panel. Deleting first asks the server what
 * links block it, so the dialog either lists them (no delete offered) or asks to confirm.
 */
function useRecordActions(resource, { reload, onNotice, describe, noun }) {
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const save = async (payload) => {
    if (editing?.id) await updateOperationRecord(resource, editing.id, payload);
    else await createOperationRecord(resource, payload);
    onNotice(editing?.id ? `Se guardaron los cambios de ${noun}.` : `Se creó ${noun}.`);
    reload();
  };
  const checkLinks = async (record) => {
    setDeleting({ record, status: 'loading', links: [] });
    try {
      const result = await getOperationRecordLinks(resource, record.id);
      setDeleting({ record, status: result?.blocked ? 'blocked' : 'ready', links: result?.links || [] });
    } catch (err) {
      setDeleting({ record, status: 'error', links: [], error: err?.message || 'No se pudieron comprobar los vínculos del registro.' });
    }
  };
  const confirmDelete = async () => {
    const { record } = deleting;
    setDeleting((current) => ({ ...current, status: 'deleting' }));
    try {
      await deleteOperationRecord(resource, record.id);
      setDeleting(null);
      onNotice(`Se eliminó ${noun} «${describe(record)}».`);
      reload();
    } catch (err) {
      // A link created meanwhile: show the up-to-date list instead of a generic error.
      if (err?.status === 409) {
        try {
          const result = await getOperationRecordLinks(resource, record.id);
          if (result?.blocked) {
            setDeleting({ record, status: 'blocked', links: result.links || [] });
            return;
          }
        } catch {
          // Fall back to the server message, which already lists the links.
        }
      }
      setDeleting({ record, status: 'error', links: [], error: err?.message || `No se pudo eliminar ${noun}.` });
    }
  };
  const deleteDialog = deleting && <DeleteRecordDialog eyebrow={EYEBROW} noun={noun} name={describe(deleting.record)} state={deleting}
    onConfirm={confirmDelete} onClose={() => setDeleting(null)} onRetry={() => checkLinks(deleting.record)} />;
  return { editing, setEditing, save, remove: checkLinks, deleteDialog };
}

/**
 * "People": talents, their skills, the activity catalog by level, assignments, training and
 * performance reviews. Each tab loads its own data; talents, catalogs and masters feed the selects.
 */
export default function PeoplePage({ towers = [], lobs = [], clients = [], onNotice, onUnauthorized }) {
  const [tab, setTab] = useState(() => loadPeopleTab());
  const [trainingTab, setTrainingTab] = useState(() => loadTrainingTab());
  const options = { onUnauthorized };
  const talents = useCollection(() => listOperationRecords('talents'), options);
  const activities = useCollection(listActivityCatalog, options);
  const skills = useCollection(() => listOperationRecords('talent-skills'), options);
  const assignments = useCollection(() => listOperationRecords('assignments'), options);
  const courses = useCollection(() => listOperationRecords('training-catalog'), options);
  const plan = useCollection(() => listOperationRecords('training-plan'), options);
  const reviews = useCollection(() => listOperationRecords('performance-reviews'), options);
  const selectTab = (id) => { setTab(id); savePeopleTab(id); };
  const selectTrainingTab = (id) => { setTrainingTab(id); saveTrainingTab(id); };
  // Talent names appear in every other table, so a talent change reloads them too.
  const reloadTalents = () => { talents.reload(); skills.reload(); assignments.reload(); plan.reload(); reviews.reload(); };
  const reloadActivities = () => { activities.reload(); skills.reload(); };
  const shared = { onNotice, talents: talents.records };

  return <TabStrip tabs={PEOPLE_TABS} active={tab} onSelect={selectTab} label="People">
    {tab === 'talentList' && <TalentsPanel collection={talents} reload={reloadTalents} towers={towers} lobs={lobs} skills={skills.records} assignments={assignments.records} plan={plan.records} reviews={reviews.records} {...shared} />}
    {tab === 'talentSkills' && <SkillsPanel collection={skills} activities={activities.records} {...shared} />}
    {tab === 'activityCatalog' && <ActivityMatrixPanel collection={activities} reload={reloadActivities} onNotice={onNotice} />}
    {tab === 'assignments' && <AssignmentsPanel collection={assignments} towers={towers} lobs={lobs} clients={clients} {...shared} />}
    {tab === 'training' && <TabStrip tabs={TRAINING_TABS} active={trainingTab} onSelect={selectTrainingTab} label="Formación" className="ops-subtabs">
      {trainingTab === 'trainingCatalog' && <TrainingCatalogPanel collection={courses} reloadPlan={plan.reload} onNotice={onNotice} />}
      {trainingTab === 'trainingPlan' && <TrainingPlanPanel collection={plan} courses={courses.records} {...shared} />}
    </TabStrip>}
    {tab === 'performanceReview' && <PerformanceReviewPanel collection={reviews} {...shared} />}
  </TabStrip>;
}

/** Options of a master list: active records plus the ones already selected (even if inactive). */
const masterOptions = (records, selected, label = (item) => item.name) => {
  const keep = new Set([selected].flat().filter(Boolean));
  return records.filter((item) => item.active !== false || keep.has(item.id)).map((item) => ({ value: item.id, label: label(item), active: item.active }));
};

/** "Tower - Responsable" label of a tower option. */
const towerLabel = (tower) => `${tower.name} - ${tower.responsibleName || 'Sin responsable'}`;

const talentOptions = (talents) => talents.map((talent) => ({ value: talent.id, label: talent.name }));

function AvailabilityPill({ value }) {
  const tone = value >= 1 ? 'green' : 'orange';
  return <span className={`status-pill ${tone}`}>{formatNumber(value, { suffix: ' %' })}</span>;
}

function TalentsPanel({ collection, reload, towers, lobs, skills = [], assignments = [], plan = [], reviews = [], onNotice }) {
  const [query, setQuery] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [profileFilter, setProfileFilter] = useState('');
  const [detail, setDetail] = useState(null);
  // Optimistic manual order while the reorder request runs; dropped once the list reloads.
  const [manualOrder, setManualOrder] = useState(null);
  useEffect(() => { setManualOrder(null); }, [collection.records]);
  const actions = useRecordActions('talents', { reload, onNotice, describe: (row) => row.name, noun: 'el talento' });
  const availability = computeAvailability(assignments, toLocalIsoDate(new Date()));
  const availabilityOf = (row) => talentAvailability(availability, row.id);
  const ordered = manualOrder ? orderByIds(collection.records, manualOrder) : collection.records;
  const rows = filterRecords(ordered, query, ['name', 'location', 'category', 'profiles', 'lobNames', 'towerNames', 'primaryTowerName'])
    .filter((row) => !onlyAvailable || isAvailable(availabilityOf(row)))
    .filter((row) => !profileFilter || (row.profiles || []).includes(profileFilter));
  const towerById = new Map(towers.map((tower) => [tower.id, tower]));
  const editing = actions.editing;

  const moveRow = async (sourceId, targetId) => {
    const ids = moveColumnTo(ordered.map((row) => row.id), sourceId, targetId);
    setManualOrder(ids);
    try {
      await reorderTalents(ids);
      collection.reload();
    } catch (err) {
      setManualOrder(null);
      onNotice(err?.message || 'No se pudo guardar el nuevo orden.', 'error');
    }
  };

  // Selecting towers keeps the main tower consistent and adds the LoB each new tower belongs to.
  const onTowersChange = (towerIds, values) => {
    const added = towerIds.filter((id) => !(values.towerIds || []).includes(id));
    const towerLobs = added.map((id) => towerById.get(id)?.lobId).filter(Boolean);
    return { primaryTowerId: syncPrimaryTower(towerIds, values.primaryTowerId), lobIds: [...new Set([...(values.lobIds || []), ...towerLobs])] };
  };
  const listCell = (names) => (names?.length ? names.join(', ') : '—');
  const masterFields = [
    { id: 'profileHeading', label: 'Perfil y ubicación', type: 'heading' },
    { id: 'location', label: 'Ubicación' },
    { id: 'category', label: 'Categoría', type: 'select', options: TALENT_CATEGORIES, placeholder: 'Sin categoría' },
    { id: 'profiles', label: 'Perfil', type: 'multiselect', options: TALENT_PROFILES.map((profile) => ({ value: profile, label: profile })), hint: 'Puedes marcar varios perfiles.' },
    { id: 'organizationHeading', label: 'Organización', type: 'heading' },
    { id: 'towerIds', label: 'Towers', type: 'multiselect', options: masterOptions(towers, editing?.towerIds, towerLabel), onChange: onTowersChange,
      hint: 'Tower - Responsable. Al añadir una tower se añade también su LoB.' },
    { id: 'lobIds', label: 'LoBs', type: 'multiselect', options: masterOptions(lobs, editing?.lobIds) },
    { id: 'primaryTowerId', label: 'Tower principal', type: 'select', required: true, wide: true, placeholder: 'Selecciona la Tower principal',
      visible: (values) => (values.towerIds || []).length > 0,
      options: (values) => (values.towerIds || []).map((id) => ({ value: id, label: towerById.get(id) ? towerLabel(towerById.get(id)) : id })),
      hint: 'Tower responsable de la cargabilidad del talento; debe ser una de sus towers.' },
  ];
  // Create asks for first name, first surname and second surname; the stored name is composed from them.
  const nameFields = editing?.id
    ? [{ id: 'name', label: 'Nombre', required: true, wide: true }]
    : [
      { id: 'firstName', label: 'Nombre', required: true, wide: true },
      { id: 'lastName', label: 'Primer apellido', required: true },
      { id: 'secondLastName', label: 'Segundo apellido', required: true },
      { id: 'name', label: 'Nombre completo', type: 'readonly', wide: true, compute: (values) => composeTalentName(values),
        hint: 'Se guarda como «primer apellido, segundo apellido, nombre».' },
    ];
  const initialValues = editing?.id
    ? { name: editing.name || '', location: editing.location || '', category: editing.category || '', profiles: editing.profiles || [],
        lobIds: editing.lobIds || [], towerIds: editing.towerIds || [], primaryTowerId: editing.primaryTowerId || '' }
    : { firstName: '', lastName: '', secondLastName: '', name: '', location: '', category: '', profiles: [],
        lobIds: [], towerIds: [], primaryTowerId: '' };
  return <>
    <RecordPanel title="Listado de personas" description="Talentos del equipo QE. Arrastra el asa ⠿ (o Alt + flecha arriba/abajo) para cambiar el orden. Un talento con skills, asignaciones, plan de formación o performance review no se puede eliminar." tableId="people-talents"
      columns={[
        { id: 'index', label: 'Nº', sortable: false, pinnedFirst: true, value: () => '', render: (_row, index) => index + 1, cellClassName: 'ops-index' },
        { id: 'name', label: 'Nombre', value: (row) => row.name },
        { id: 'location', label: 'Ubicación', value: (row) => row.location },
        { id: 'category', label: 'Categoría', value: (row) => row.category },
        { id: 'profiles', label: 'Perfil', value: (row) => (row.profiles || []).join(', '), render: (row) => listCell(row.profiles), cellClassName: 'ops-wrap' },
        { id: 'availability', label: 'Disponibilidad', type: 'number', value: (row) => availabilityOf(row), render: (row) => <AvailabilityPill value={availabilityOf(row)} /> },
        { id: 'lobNames', label: 'LoBs', value: (row) => (row.lobNames || []).join(', '), render: (row) => listCell(row.lobNames), cellClassName: 'ops-wrap' },
        { id: 'towerNames', label: 'Towers', value: (row) => (row.towerNames || []).join(', '), render: (row) => listCell(row.towerNames), cellClassName: 'ops-wrap' },
        { id: 'primaryTowerName', label: 'Tower principal', value: (row) => row.primaryTowerName },
      ]}
      rows={rows} totalCount={collection.records.length} query={query} onQueryChange={setQuery} searchLabel="Buscar talentos"
      createLabel="Crear talento" onCreate={() => actions.setEditing({})} onEdit={actions.setEditing} onDelete={actions.remove}
      onRowClick={setDetail} rowAriaLabel={(row) => `Ver detalle de ${row.name}`}
      rowReorder={{ onMove: moveRow, label: (row) => row.name }}
      emptyMessage="Todavía no hay talentos." loading={collection.loading} error={collection.error} onRetry={collection.reload}>
      <div className="ops-filters" role="group" aria-label="Filtros del listado">
        <label className="ops-check ops-filter-check"><input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} /> Disponible</label>
        <span className="field-hint">Disponibilidad hoy entre 1 % y 100 % (100 % menos las asignaciones vigentes).</span>
        <label className="filter-select ops-filter-select"><span>Perfil</span><select value={profileFilter} onChange={(event) => setProfileFilter(event.target.value)}><option value="">Todos</option>{TALENT_PROFILES.map((profile) => <option key={profile} value={profile}>{profile}</option>)}</select></label>
      </div>
    </RecordPanel>
    {editing && <RecordDialog eyebrow={EYEBROW} title={editing.id ? 'Editar talento' : 'Crear talento'} className="talent-dialog"
      fields={[...nameFields, ...masterFields]}
      initialValues={initialValues}
      validate={editing.id ? validateTalentForm : validateTalentCreateForm}
      formFields={editing.id ? TALENT_FORM_FIELDS : TALENT_CREATE_FORM_FIELDS}
      toPayload={(values) => ({
        name: editing.id ? values.name || '' : composeTalentName(values),
        location: values.location || '', category: values.category || '', profiles: values.profiles || [],
        lobIds: values.lobIds || [], towerIds: values.towerIds || [], primaryTowerId: values.primaryTowerId || '',
      })}
      onSave={actions.save} onClose={() => actions.setEditing(null)} />}
    {actions.deleteDialog}
    {detail && <TalentDetailsDialog talent={detail} skills={skills} assignments={assignments} plan={plan} reviews={reviews} availability={availabilityOf(detail)} onClose={() => setDetail(null)} />}
  </>;
}

/** Read-only "Listado de personas" detail: the talent plus what hangs from it in the other tabs. */
function TalentDetailsDialog({ talent, skills = [], assignments = [], plan = [], reviews = [], availability, onClose }) {
  const talentSkills = skills.filter((item) => item.talentId === talent.id);
  const talentAssignments = assignments.filter((item) => item.talentId === talent.id);
  const talentPlan = plan.filter((item) => item.talentId === talent.id);
  const talentReviews = reviews.filter((item) => item.talentId === talent.id);
  const assignedPercentage = computeAssignmentTotals(talentAssignments).get(talent.id) || 0;
  return <DetailsDialog eyebrow={EYEBROW} title={talent.name} onClose={onClose} rows={[
    { label: 'ID', value: talent.id },
    { label: 'Nombre', value: talent.name },
    { label: 'Ubicación', value: talent.location },
    { label: 'Categoría', value: talent.category },
    { label: 'Perfil', value: (talent.profiles || []).join(', ') },
    { label: 'LoBs', value: (talent.lobNames || []).join(', ') },
    { label: 'Towers', value: (talent.towerNames || []).join(', ') },
    { label: 'Tower principal', value: talent.primaryTowerName },
    { label: 'Disponibilidad hoy', value: formatNumber(availability, { suffix: ' %' }) },
    { label: 'Skills registradas', value: talentSkills.length },
    { label: 'Asignaciones', value: talentAssignments.length ? `${talentAssignments.length} · ${formatNumber(assignedPercentage, { suffix: ' %' })}` : 0 },
    { label: 'Plan de formación', value: talentPlan.length },
    { label: 'Objetivos de performance review', value: talentReviews.length },
    { label: 'Creado', value: formatDateTime(talent.createdAt) },
    { label: 'Actualizado', value: formatDateTime(talent.updatedAt) },
  ]} />;
}

const SKILL_LEVEL_OPTIONS = SKILL_LEVELS.map((level) => ({ value: String(level.value), label: level.label }));
const levelSortValue = (value) => (value === null || value === undefined ? null : Number(value));

function SkillsPanel({ collection, activities, talents, onNotice }) {
  const [query, setQuery] = useState('');
  const actions = useRecordActions('talent-skills', { reload: collection.reload, onNotice, describe: (row) => `${row.talentName} · ${row.activityName}`, noun: 'la skill' });
  const rows = filterRecords(collection.records, query, ['talentName', 'activityName', 'activityCategory', 'certificate', 'comment', 'careerLevel']);
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const editing = actions.editing;
  // "Nivel" offers the levels the activity configures; a stored level of the same activity stays
  // selectable so legacy rows can still be edited without changing it.
  const careerLevelOptions = (values) => {
    const levels = configuredCareerLevels(activityById.get(values.activityId));
    const keep = editing?.id && values.activityId === editing.activityId && editing.careerLevel && !levels.includes(editing.careerLevel) ? [editing.careerLevel] : [];
    return CAREER_LEVELS.filter((level) => levels.includes(level) || keep.includes(level));
  };
  return <>
    <RecordPanel title="Skills x talento" description="Nivel actual y objetivo de cada persona en las actividades del catálogo. «Nivel» es el nivel de carrera (L1–L7) de la persona en el catálogo de actividades." tableId="people-skills"
      columns={[
        { id: 'talentName', label: 'Persona', value: (row) => row.talentName },
        { id: 'activityName', label: 'Actividad (Skill)', value: (row) => row.activityName },
        { id: 'activityCategory', label: 'Skill - Categoría', value: (row) => row.activityCategory },
        { id: 'currentLevel', label: 'Nivel actual', type: 'number', value: (row) => levelSortValue(row.currentLevel), render: (row) => skillLevelLabel(row.currentLevel) || '—' },
        { id: 'targetLevel', label: 'Nivel objetivo', type: 'number', value: (row) => levelSortValue(row.targetLevel), render: (row) => skillLevelLabel(row.targetLevel) || '—' },
        { id: 'certificate', label: 'Certificado', value: (row) => row.certificate },
        { id: 'comment', label: 'Comentario', value: (row) => row.comment, cellClassName: 'ops-wrap' },
        { id: 'careerLevel', label: 'Nivel', value: (row) => row.careerLevel },
      ]}
      rows={rows} totalCount={collection.records.length} query={query} onQueryChange={setQuery} searchLabel="Buscar skills"
      createLabel="Nueva skill" onCreate={() => actions.setEditing({})} onEdit={actions.setEditing} onDelete={actions.remove}
      emptyMessage="Todavía no hay skills registradas." loading={collection.loading} error={collection.error} onRetry={collection.reload} />
    {editing && <RecordDialog eyebrow={EYEBROW} title={editing.id ? 'Editar skill' : 'Nueva skill'}
      fields={[
        { id: 'talentId', label: 'Persona', type: 'select', required: true, wide: true, placeholder: 'Selecciona una persona', options: talentOptions(talents) },
        { id: 'activityId', label: 'Actividad (Skill)', type: 'select', required: true, wide: true, placeholder: 'Selecciona una actividad', options: activities.map((activity) => ({ value: activity.id, label: activity.name })),
          // A level the new activity does not configure is cleared.
          onChange: (value, values) => (values.careerLevel && !careerLevelOptions({ ...values, activityId: value }).includes(values.careerLevel) ? { careerLevel: '' } : {}) },
        { id: 'activityCategory', label: 'Skill - Categoría', type: 'readonly', wide: true, compute: (values) => activityById.get(values.activityId)?.category, hint: 'Se completa desde el catálogo de actividades.' },
        { id: 'currentLevel', label: 'Nivel actual', type: 'select', required: true, options: SKILL_LEVEL_OPTIONS },
        { id: 'targetLevel', label: 'Nivel objetivo', type: 'select', options: SKILL_LEVEL_OPTIONS },
        { id: 'careerLevel', label: 'Nivel', type: 'select', options: careerLevelOptions, placeholder: 'Sin nivel',
          hint: 'Nivel de carrera (L1–L7). Solo los niveles configurados para la actividad en el catálogo.' },
        { id: 'certificate', label: 'Certificado', hint: 'Opcional. Nombre del certificado.' },
        { id: 'comment', label: 'Comentario', type: 'textarea', wide: true },
      ]}
      initialValues={{
        talentId: editing.talentId || '', activityId: editing.activityId || '', currentLevel: editing.currentLevel ? String(editing.currentLevel) : '',
        targetLevel: editing.targetLevel ? String(editing.targetLevel) : '', careerLevel: editing.careerLevel || '', certificate: editing.certificate || '', comment: editing.comment || '',
      }}
      validate={(values) => validateSkillForm(values, { allowedCareerLevels: careerLevelOptions(values) })} formFields={SKILL_FORM_FIELDS} onSave={actions.save} onClose={() => actions.setEditing(null)} />}
    {actions.deleteDialog}
  </>;
}

function MatrixCell({ cell }) {
  if (cell.kind === 'none') return <span className="ops-matrix-cell none" role="img" aria-label="No aplica">·</span>;
  if (cell.kind === 'text') return <span className="ops-matrix-cell text">{cell.label}</span>;
  return <span className={`ops-matrix-cell ${cell.kind}`} role="img" aria-label={cell.label} title={cell.label}>{cell.symbol}</span>;
}

const MATRIX_SUGGESTIONS = ['✅', '⚪'];

function ActivityMatrixPanel({ collection, reload, onNotice }) {
  const [query, setQuery] = useState('');
  const actions = useRecordActions('activity-catalog', { reload, onNotice, describe: (row) => row.name, noun: 'la actividad' });
  const byId = new Map(collection.records.map((activity) => [activity.id, activity]));
  const matrix = buildActivityMatrix(collection.records);
  const rows = filterRecords(matrix, query, ['id', 'name', 'category', (row) => row.cells.map((cell) => cell.label).join(' ')]);
  const editing = actions.editing;
  const categories = mergeOptions([], collection.records.map((activity) => activity.category));
  return <section className="secondary-panel">
    <div className="secondary-panel-heading"><div><h2>Catálogo de actividades por niveles</h2><p>Actividades esperadas en cada nivel de carrera. Una actividad usada en «Skills x talento» no se puede eliminar.</p></div><span className="record-count">{rows.length} actividades</span></div>
    <div className="ops-toolbar">
      <SearchBox value={query} onChange={setQuery} label="Buscar actividades" />
      <button type="button" className="button button-primary" onClick={() => actions.setEditing({})}>+ Nueva actividad</button>
    </div>
    <ul className="ops-legend ops-legend-row" aria-label="Leyenda">
      <li><span className="ops-matrix-cell required" aria-hidden="true">✅</span> Requerido</li>
      <li><span className="ops-matrix-cell optional" aria-hidden="true">⚪</span> Opcional</li>
      <li><span className="ops-matrix-cell none" aria-hidden="true">·</span> No aplica</li>
      <li><span className="ops-matrix-cell text" aria-hidden="true">Texto</span> Rol específico en ese nivel</li>
    </ul>
    <div className="table-wrap ops-table-wrap">
      {collection.loading
        ? <p className="empty-state" role="status">Cargando…</p>
        : collection.error
          ? <div className="board-state"><p>{collection.error}</p><button type="button" className="button button-secondary" onClick={collection.reload}>Reintentar</button></div>
          : <table className="data-table secondary-table ops-matrix">
            <caption className="sr-only">Catálogo de actividades por nivel de carrera L1 a L7</caption>
            <thead><tr><th scope="col">ID</th><th scope="col">Actividad (Skill)</th><th scope="col">Skill - Categoría</th>{CAREER_LEVELS.map((level) => <th key={level} scope="col" className="ops-matrix-level">{level}</th>)}<th scope="col" className="actions-header">Acciones</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id}><td>{row.id}</td><th scope="row">{row.name}</th><td>{row.category || '—'}</td>{row.cells.map((cell) => <td key={cell.level} className="ops-matrix-level"><MatrixCell cell={cell} /></td>)}
              <td className="master-actions"><button type="button" className="button button-secondary" onClick={() => actions.setEditing(byId.get(row.id))} aria-label={`Editar ${row.name}`}>Editar</button><button type="button" className="button button-secondary button-danger" onClick={() => actions.remove(byId.get(row.id))} aria-label={`Eliminar ${row.name}`}>Eliminar</button></td></tr>)}</tbody>
          </table>}
      {!collection.loading && !collection.error && rows.length === 0 && <p className="empty-state">{query.trim() ? 'No hay actividades que coincidan con la búsqueda.' : 'El catálogo de actividades está vacío.'}</p>}
    </div>
    {editing && <RecordDialog eyebrow={EYEBROW} title={editing.id ? 'Editar actividad' : 'Nueva actividad'}
      fields={[
        { id: 'name', label: 'Actividad (Skill)', required: true, wide: true },
        { id: 'category', label: 'Skill - Categoría', type: 'combo', wide: true, options: categories },
        { id: 'levelsHeading', label: 'Niveles de carrera: ✅ requerido · ⚪ opcional · texto = rol específico · vacío = no aplica', type: 'heading' },
        ...CAREER_LEVELS.map((level) => ({ id: level.toLowerCase(), label: level, type: 'combo', options: MATRIX_SUGGESTIONS })),
      ]}
      initialValues={{
        name: editing.name || '', category: editing.category || '',
        ...Object.fromEntries(CAREER_LEVELS.map((level) => [level.toLowerCase(), editing.levels?.[level] || ''])),
      }}
      validate={validateActivityForm} formFields={ACTIVITY_FORM_FIELDS} onSave={actions.save} onClose={() => actions.setEditing(null)} />}
    {actions.deleteDialog}
  </section>;
}

function AssignmentsPanel({ collection, talents, towers, lobs, clients, onNotice }) {
  const [query, setQuery] = useState('');
  const actions = useRecordActions('assignments', { reload: collection.reload, onNotice, describe: (row) => `${row.talentName} · ${formatNumber(row.percentage, { suffix: ' %' })}`, noun: 'la asignación' });
  const totals = computeAssignmentTotals(collection.records);
  const overAllocated = overAllocatedTalents(collection.records);
  const rows = filterRecords(collection.records, query, ['talentName', 'towerName', 'lobName', 'clientName', 'startDate', 'endDate']);
  const editing = actions.editing;
  return <>
    <RecordPanel title="Asignaciones" description="Dedicación de cada talento por tower, LoB y cliente, con fechas opcionales de inicio y fin. Se avisa cuando el total de un talento supera el 100 %." tableId="people-assignments"
      columns={[
        { id: 'talentName', label: 'Talento', value: (row) => row.talentName },
        { id: 'towerName', label: 'Tower', value: (row) => row.towerName },
        { id: 'lobName', label: 'LoB', value: (row) => row.lobName },
        { id: 'clientName', label: 'Cliente', value: (row) => row.clientName },
        { id: 'percentage', label: '% asignación', type: 'number', value: (row) => row.percentage, render: (row) => formatNumber(row.percentage, { suffix: ' %' }) },
        { id: 'startDate', label: 'Fecha inicio', type: 'date', value: (row) => row.startDate },
        { id: 'endDate', label: 'Fecha fin', type: 'date', value: (row) => row.endDate },
        { id: 'total', label: 'Total del talento', type: 'number', value: (row) => totals.get(row.talentId), render: (row) => { const total = totals.get(row.talentId) || 0; return <span className={total > 100 ? 'status-pill orange' : 'status-pill green'}>{formatNumber(total, { suffix: ' %' })}{total > 100 ? ' · supera el 100 %' : ''}</span>; } },
      ]}
      rows={rows} totalCount={collection.records.length} query={query} onQueryChange={setQuery} searchLabel="Buscar asignaciones"
      createLabel="Nueva asignación" onCreate={() => actions.setEditing({})} onEdit={actions.setEditing} onDelete={actions.remove}
      emptyMessage="Todavía no hay asignaciones." loading={collection.loading} error={collection.error} onRetry={collection.reload}>
      {overAllocated.length > 0 && <p className="ops-warning" role="status">Aviso: {overAllocated.map((item) => `${item.talentName} (${formatNumber(item.total, { suffix: ' %' })})`).join(', ')} {overAllocated.length === 1 ? 'supera' : 'superan'} el 100 % de asignación.</p>}
    </RecordPanel>
    {editing && <RecordDialog eyebrow={EYEBROW} title={editing.id ? 'Editar asignación' : 'Nueva asignación'}
      fields={[
        { id: 'talentId', label: 'Talento', type: 'select', required: true, wide: true, placeholder: 'Selecciona un talento', options: talentOptions(talents) },
        { id: 'towerId', label: 'Tower', type: 'select', placeholder: 'Sin tower', options: masterOptions(towers, editing.towerId) },
        { id: 'lobId', label: 'LoB', type: 'select', placeholder: 'Sin LoB', options: masterOptions(lobs, editing.lobId) },
        { id: 'clientId', label: 'Cliente', type: 'select', placeholder: 'Sin cliente', options: masterOptions(clients, editing.clientId) },
        { id: 'percentage', label: '% asignación', type: 'number', required: true, hint: 'Entre 0 y 100; se admiten decimales (p. ej. 62,5).' },
        { id: 'startDate', label: 'Fecha inicio', type: 'date', hint: 'Opcional. Vacía = desde siempre.' },
        { id: 'endDate', label: 'Fecha fin', type: 'date', hint: 'Opcional. Aparece en el Calendario.' },
      ]}
      initialValues={{ talentId: editing.talentId || '', towerId: editing.towerId || '', lobId: editing.lobId || '', clientId: editing.clientId || '', percentage: numberToInput(editing.percentage), startDate: editing.startDate || '', endDate: editing.endDate || '' }}
      validate={validateAssignmentForm} formFields={ASSIGNMENT_FORM_FIELDS} onSave={actions.save} onClose={() => actions.setEditing(null)} />}
    {actions.deleteDialog}
  </>;
}

const COURSE_TEXT_FIELDS = [['family', 'Familia'], ['istqbCategory', 'Categoría ISTQB'], ['types', 'Tipos'], ['provider', 'Proveedor'], ['level', 'Nivel']];

/** Link opened in a new tab, only for http(s) URLs. */
function ExternalLink({ url, label = 'Abrir' }) {
  const href = safeExternalUrl(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{label}<span className="sr-only"> (se abre en una pestaña nueva)</span></a> : '—';
}

function TrainingCatalogPanel({ collection, reloadPlan, onNotice }) {
  const [query, setQuery] = useState('');
  const reload = () => { collection.reload(); reloadPlan(); };
  const actions = useRecordActions('training-catalog', { reload, onNotice, describe: (row) => row.name, noun: 'la formación' });
  const rows = filterRecords(collection.records, query, ['name', 'family', 'istqbCategory', 'types', 'provider', 'level']);
  const editing = actions.editing;
  const suggestions = (key) => mergeOptions([], collection.records.map((row) => row[key]));
  return <>
    <RecordPanel title="Catálogo de formación" description="Formaciones y certificaciones disponibles. No se puede eliminar una formación usada en el plan de formación." tableId="people-training-catalog"
      columns={[
        { id: 'name', label: 'Formación', value: (row) => row.name, cellClassName: 'ops-wrap' },
        ...COURSE_TEXT_FIELDS.map(([key, label]) => ({ id: key, label, value: (row) => row[key] })),
        { id: 'estimatedHours', label: 'Horas Estimadas', type: 'number', value: (row) => row.estimatedHours, render: (row) => formatNumber(row.estimatedHours) || '—' },
        { id: 'url', label: 'Enlace', value: (row) => row.url, render: (row) => <ExternalLink url={row.url} /> },
        { id: 'validityMonths', label: 'Vigencia/Meses', type: 'number', value: (row) => row.validityMonths },
      ]}
      rows={rows} totalCount={collection.records.length} query={query} onQueryChange={setQuery} searchLabel="Buscar formaciones"
      createLabel="Crear certificación" onCreate={() => actions.setEditing({})} onEdit={actions.setEditing} onDelete={actions.remove}
      emptyMessage="Todavía no hay formaciones en el catálogo." loading={collection.loading} error={collection.error} onRetry={collection.reload} />
    {editing && <RecordDialog eyebrow={EYEBROW} title={editing.id ? 'Editar formación' : 'Crear certificación'}
      fields={[
        { id: 'name', label: 'Formación', required: true, wide: true },
        ...COURSE_TEXT_FIELDS.map(([key, label]) => ({ id: key, label, type: 'combo', options: suggestions(key) })),
        { id: 'estimatedHours', label: 'Horas Estimadas', type: 'number' },
        { id: 'validityMonths', label: 'Vigencia/Meses', type: 'number', hint: 'Opcional. Meses de validez del certificado.' },
        { id: 'url', label: 'Enlace', type: 'url', wide: true },
      ]}
      initialValues={{
        name: editing.name || '', ...Object.fromEntries(COURSE_TEXT_FIELDS.map(([key]) => [key, editing[key] || ''])),
        estimatedHours: numberToInput(editing.estimatedHours), validityMonths: numberToInput(editing.validityMonths), url: editing.url || '',
      }}
      validate={validateCourseForm} formFields={COURSE_FORM_FIELDS} onSave={actions.save} onClose={() => actions.setEditing(null)} />}
    {actions.deleteDialog}
  </>;
}

function TrainingPlanPanel({ collection, courses, talents, onNotice }) {
  const [query, setQuery] = useState('');
  const actions = useRecordActions('training-plan', { reload: collection.reload, onNotice, describe: (row) => `${row.talentName} · ${row.courseLabel}`, noun: 'la fila del plan' });
  const rows = filterRecords(collection.records, query, ['talentName', 'task', 'courseLabel', 'family', 'status', 'evidence', 'nextStep']);
  const editing = actions.editing;
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const statusOptions = mergeOptions(PLAN_STATUS_DEFAULTS, collection.records.map((row) => row.status));
  const dateColumn = (id, label) => ({ id, label, type: 'date', value: (row) => row[id] });
  return <>
    <RecordPanel title="Plan de formación" description="Formación planificada por persona. El curso puede venir del catálogo o escribirse libremente." tableId="people-training-plan"
      columns={[
        { id: 'talentName', label: 'QA', value: (row) => row.talentName },
        { id: 'task', label: 'Tarea', value: (row) => row.task },
        { id: 'courseLabel', label: 'Curso/Certificado', value: (row) => row.courseLabel, render: (row) => <>{row.courseLabel}{!row.courseId && <span className="status-pill gray ops-inline-pill">Fuera de catálogo</span>}</>, cellClassName: 'ops-wrap' },
        { id: 'family', label: 'Familia', value: (row) => row.family },
        { id: 'estimatedHours', label: 'Horas Estimadas', type: 'number', value: (row) => row.estimatedHours, render: (row) => formatNumber(row.estimatedHours) || '—' },
        { id: 'dedicatedHours', label: 'Horas dedicadas totales', type: 'number', value: (row) => row.dedicatedHours, render: (row) => formatNumber(row.dedicatedHours) || '—' },
        { id: 'progress', label: 'Avance', type: 'number', value: (row) => row.progress, render: (row) => formatNumber(row.progress, { suffix: ' %' }) || '—' },
        { id: 'status', label: 'Estado', value: (row) => row.status },
        dateColumn('startDate', 'Fecha Inicio'),
        dateColumn('plannedEndDate', 'Fecha Fin Prevista'),
        dateColumn('actualEndDate', 'Fecha Fin Real'),
        { id: 'evidence', label: 'Evidencia', value: (row) => row.evidence, cellClassName: 'ops-wrap' },
        { id: 'nextStep', label: 'Próximo Paso', value: (row) => row.nextStep, cellClassName: 'ops-wrap' },
        dateColumn('expiryDate', 'Fecha de caducidad'),
      ]}
      rows={rows} totalCount={collection.records.length} query={query} onQueryChange={setQuery} searchLabel="Buscar en el plan de formación"
      createLabel="Nueva fila del plan" onCreate={() => actions.setEditing({})} onEdit={actions.setEditing} onDelete={actions.remove}
      emptyMessage="Todavía no hay formación planificada." loading={collection.loading} error={collection.error} onRetry={collection.reload} />
    {editing && <RecordDialog eyebrow={EYEBROW} title={editing.id ? 'Editar fila del plan' : 'Nueva fila del plan'}
      fields={[
        { id: 'talentId', label: 'QA (persona)', type: 'select', required: true, wide: true, placeholder: 'Selecciona una persona', options: talentOptions(talents) },
        { id: 'courseId', label: 'Curso/Certificado del catálogo', type: 'select', wide: true, placeholder: 'Otro (fuera del catálogo)', options: courses.map((course) => ({ value: course.id, label: course.name })),
          onChange: (value, values) => (value && courseById.get(value) ? { family: values.family || courseById.get(value).family || '', estimatedHours: values.estimatedHours || numberToInput(courseById.get(value).estimatedHours) } : {}) },
        { id: 'courseName', label: 'Curso/Certificado (texto libre)', wide: true, required: true, visible: (values) => !values.courseId, hint: 'Si el curso no está en el catálogo, escribe su nombre.' },
        { id: 'task', label: 'Tarea' },
        { id: 'family', label: 'Familia', type: 'combo', options: mergeOptions([], [...courses.map((course) => course.family), ...collection.records.map((row) => row.family)]) },
        { id: 'estimatedHours', label: 'Horas Estimadas', type: 'number' },
        { id: 'dedicatedHours', label: 'Horas dedicadas totales', type: 'number' },
        { id: 'progress', label: 'Avance (%)', type: 'number', hint: 'Puede superar el 100 % si se dedicaron más horas de las estimadas.' },
        { id: 'status', label: 'Estado', type: 'select', options: statusOptions },
        { id: 'startDate', label: 'Fecha Inicio', type: 'date' },
        { id: 'plannedEndDate', label: 'Fecha Fin Prevista', type: 'date' },
        { id: 'actualEndDate', label: 'Fecha Fin Real', type: 'date' },
        { id: 'expiryDate', label: 'Fecha de caducidad', type: 'date' },
        { id: 'evidence', label: 'Evidencia', type: 'textarea', wide: true },
        { id: 'nextStep', label: 'Próximo Paso', type: 'textarea', wide: true },
      ]}
      initialValues={{
        talentId: editing.talentId || '', courseId: editing.courseId || '', courseName: editing.courseId ? '' : (editing.courseName || ''), task: editing.task || '',
        family: editing.family || '', estimatedHours: numberToInput(editing.estimatedHours), dedicatedHours: numberToInput(editing.dedicatedHours), progress: numberToInput(editing.progress),
        status: editing.status || '', startDate: editing.startDate || '', plannedEndDate: editing.plannedEndDate || '', actualEndDate: editing.actualEndDate || '',
        expiryDate: editing.expiryDate || '', evidence: editing.evidence || '', nextStep: editing.nextStep || '',
      }}
      validate={validatePlanForm} formFields={PLAN_FORM_FIELDS} onSave={actions.save} onClose={() => actions.setEditing(null)} />}
    {actions.deleteDialog}
  </>;
}

const ALL_YEARS_FILTER = 'all';
const STATUS_TONES = { Pendiente: 'gray', Cumplido: 'green', 'No cumplido': 'orange' };

/** "Performance review": objectives per talent and year, with a quick status change per row. */
function PerformanceReviewPanel({ collection, talents, onNotice }) {
  const currentYear = new Date().getFullYear();
  const [query, setQuery] = useState('');
  const [yearFilter, setYearFilter] = useState(String(currentYear));
  const [talentFilter, setTalentFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState('');
  const actions = useRecordActions('performance-reviews', { reload: collection.reload, onNotice, describe: (row) => row.objective, noun: 'el objetivo' });
  const rows = filterRecords(collection.records, query, ['talentName', 'objective', 'status', 'linkTitle', 'notes'])
    .filter((row) => yearFilter === ALL_YEARS_FILTER || String(row.year) === yearFilter)
    .filter((row) => !talentFilter || row.talentId === talentFilter);
  const editing = actions.editing;
  const setStatus = async (row, status) => {
    if (status === row.status) return;
    setUpdatingId(row.id);
    try {
      await updateOperationRecord('performance-reviews', row.id, { status });
      onNotice(`Objetivo marcado como «${status}».`);
      collection.reload();
    } catch (err) {
      onNotice(err?.message || 'No se pudo cambiar el estado.', 'error');
    } finally {
      setUpdatingId('');
    }
  };
  const createMany = async (payload) => {
    const result = await createOperationRecord('performance-reviews', payload);
    const count = result?.records?.length || 0;
    onNotice(count === 1 ? 'Se creó 1 objetivo.' : `Se crearon ${count} objetivos.`);
    collection.reload();
  };
  return <>
    <RecordPanel title="Performance review" description="Objetivos anuales de cada talento y su estado. Cambia el estado directamente desde la tabla." tableId="people-performance-review"
      columns={[
        { id: 'talentName', label: 'Talento', value: (row) => row.talentName },
        { id: 'year', label: 'Año', type: 'number', value: (row) => row.year },
        { id: 'objective', label: 'Objetivo', value: (row) => row.objective, cellClassName: 'ops-wrap' },
        { id: 'status', label: 'Estado', value: (row) => row.status, render: (row) => <span className="ops-status-cell">
          <span className={`status-pill ${STATUS_TONES[row.status] || 'gray'}`} aria-hidden="true">{row.status}</span>
          <select className="ops-status-select" value={row.status} disabled={updatingId === row.id} onChange={(event) => setStatus(row, event.target.value)} aria-label={`Estado de «${row.objective}» (${row.talentName})`}>
            {PERFORMANCE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </span> },
        { id: 'link', label: 'Enlace', value: (row) => row.linkTitle || row.linkUrl, render: (row) => (row.linkUrl ? <ExternalLink url={row.linkUrl} label={row.linkTitle || 'Abrir'} /> : '—') },
        { id: 'notes', label: 'Notas', value: (row) => row.notes, cellClassName: 'ops-wrap' },
      ]}
      rows={rows} totalCount={collection.records.length} query={query} onQueryChange={setQuery} searchLabel="Buscar objetivos"
      createLabel="Nuevos objetivos" onCreate={() => setCreating(true)} onEdit={actions.setEditing} onDelete={actions.remove}
      emptyMessage="Todavía no hay objetivos de performance review." loading={collection.loading} error={collection.error} onRetry={collection.reload}>
      <div className="ops-filters" role="group" aria-label="Filtros de performance review">
        <label className="filter-select ops-filter-select"><span>Año</span><select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
          {performanceYears(collection.records, currentYear).map((year) => <option key={year} value={String(year)}>{year}</option>)}
          <option value={ALL_YEARS_FILTER}>Todos</option>
        </select></label>
        <label className="filter-select ops-filter-select"><span>Talento</span><select value={talentFilter} onChange={(event) => setTalentFilter(event.target.value)}>
          <option value="">Todos</option>{talents.map((talent) => <option key={talent.id} value={talent.id}>{talent.name}</option>)}
        </select></label>
      </div>
    </RecordPanel>
    {creating && <PerformanceCreateDialog talents={talents} defaultTalentId={talentFilter} defaultYear={yearFilter === ALL_YEARS_FILTER ? currentYear : Number(yearFilter)} onSave={createMany} onClose={() => setCreating(false)} />}
    {editing && <RecordDialog eyebrow={EYEBROW} title="Editar objetivo"
      fields={[
        { id: 'talentId', label: 'Talento', type: 'select', required: true, wide: true, placeholder: 'Selecciona un talento', options: talentOptions(talents) },
        { id: 'year', label: 'Año', type: 'number', required: true },
        { id: 'status', label: 'Estado', type: 'select', options: PERFORMANCE_STATUSES, placeholder: DEFAULT_PERFORMANCE_STATUS },
        { id: 'objective', label: 'Objetivo', type: 'textarea', required: true, wide: true },
        { id: 'linkTitle', label: 'Título del enlace' },
        { id: 'linkUrl', label: 'Enlace', type: 'url' },
        { id: 'notes', label: 'Notas', type: 'textarea', wide: true },
      ]}
      initialValues={{ talentId: editing.talentId || '', year: editing.year ? String(editing.year) : '', status: editing.status || '', objective: editing.objective || '', linkTitle: editing.linkTitle || '', linkUrl: editing.linkUrl || '', notes: editing.notes || '' }}
      validate={validatePerformanceForm} formFields={PERFORMANCE_FORM_FIELDS} onSave={actions.save} onClose={() => actions.setEditing(null)} />}
    {actions.deleteDialog}
  </>;
}

const emptyObjective = () => ({ key: Math.random().toString(36).slice(2), objective: '', linkTitle: '', linkUrl: '', notes: '' });

/** Create dialog: one talent and year, and as many objectives as needed (each becomes a row). */
function PerformanceCreateDialog({ talents, defaultTalentId = '', defaultYear, onSave, onClose }) {
  const [values, setValues] = useState({ talentId: defaultTalentId, year: String(defaultYear), objectives: [emptyObjective()] });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fieldErrors = useFieldErrors();
  const dialogRef = useRef(null);
  const lastObjectiveRef = useRef(null);
  const [focusLast, setFocusLast] = useState(false);
  useEffect(() => { dialogRef.current?.showModal(); return () => { if (dialogRef.current?.open) dialogRef.current.close(); }; }, []);
  useEffect(() => { if (focusLast) { lastObjectiveRef.current?.focus(); setFocusLast(false); } }, [focusLast]);
  const setField = (field, value) => { fieldErrors.clear(field); setValues((current) => ({ ...current, [field]: value })); };
  const setObjective = (index, field, value) => {
    fieldErrors.clear(`objectives.${index}.${field}`);
    setValues((current) => ({ ...current, objectives: current.objectives.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)) }));
  };
  const addObjective = () => { setValues((current) => ({ ...current, objectives: [...current.objectives, emptyObjective()] })); setFocusLast(true); };
  const removeObjective = (index) => { fieldErrors.show({}); setValues((current) => ({ ...current, objectives: current.objectives.filter((_, itemIndex) => itemIndex !== index) })); };
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (fieldErrors.show(validatePerformanceCreateForm(values))) return;
    setSaving(true);
    try {
      await onSave({
        talentId: values.talentId, year: values.year,
        objectives: values.objectives.map(({ objective, linkTitle, linkUrl, notes }) => ({ objective, linkTitle, linkUrl, notes, status: DEFAULT_PERFORMANCE_STATUS })),
      });
      onClose();
    } catch (err) {
      setError(err?.message || 'No se pudieron crear los objetivos.');
    } finally {
      setSaving(false);
    }
  };
  const objectiveField = (index, field, label, control) => <FormField form={fieldErrors} field={`objectives.${index}.${field}`} label={label} required={field === 'objective'} className={field === 'objective' || field === 'notes' ? 'wide' : ''}>{control}</FormField>;
  return <dialog ref={dialogRef} className="opportunity-dialog compact-dialog performance-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={submit} noValidate ref={fieldErrors.formRef}>
      <div className="dialog-heading"><div><span className="eyebrow">{EYEBROW}</span><h2>Nuevos objetivos</h2></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>×</button></div>
      <div className="form-grid">
        <FormField form={fieldErrors} field="talentId" label="Talento" required className="wide">
          <select value={values.talentId} onChange={(event) => setField('talentId', event.target.value)} required {...fieldErrors.fieldProps('talentId')}><option value="">Selecciona un talento</option>{talents.map((talent) => <option key={talent.id} value={talent.id}>{talent.name}</option>)}</select>
        </FormField>
        <FormField form={fieldErrors} field="year" label="Año" required>
          <input inputMode="numeric" value={values.year} onChange={(event) => setField('year', event.target.value)} required {...fieldErrors.fieldProps('year')} />
        </FormField>
      </div>
      <h3 className="form-section-title performance-objectives-title">Objetivos <span className="field-hint">Cada objetivo se crea como una fila en estado «{DEFAULT_PERFORMANCE_STATUS}».</span></h3>
      <ol className="performance-objectives">
        {values.objectives.map((item, index) => <li key={item.key} className="performance-objective">
          <div className="performance-objective-heading"><strong>Objetivo {index + 1}</strong>{values.objectives.length > 1 && <button type="button" className="inline-link" onClick={() => removeObjective(index)} aria-label={`Quitar el objetivo ${index + 1}`}>Quitar</button>}</div>
          <div className="form-grid">
            {objectiveField(index, 'objective', 'Objetivo', <textarea rows="2" ref={index === values.objectives.length - 1 ? lastObjectiveRef : undefined} value={item.objective} onChange={(event) => setObjective(index, 'objective', event.target.value)} required {...fieldErrors.fieldProps(`objectives.${index}.objective`)} />)}
            {objectiveField(index, 'linkTitle', 'Título del enlace', <input value={item.linkTitle} onChange={(event) => setObjective(index, 'linkTitle', event.target.value)} />)}
            {objectiveField(index, 'linkUrl', 'Enlace', <input type="url" inputMode="url" placeholder="https://" value={item.linkUrl} onChange={(event) => setObjective(index, 'linkUrl', event.target.value)} {...fieldErrors.fieldProps(`objectives.${index}.linkUrl`)} />)}
            {objectiveField(index, 'notes', 'Notas', <textarea rows="2" value={item.notes} onChange={(event) => setObjective(index, 'notes', event.target.value)} />)}
          </div>
        </li>)}
      </ol>
      <FieldError form={fieldErrors} field="objectives" />
      <button type="button" className="button button-secondary" onClick={addObjective}>+ Añadir otro objetivo</button>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{values.objectives.length === 1 ? 'Crear objetivo' : `Crear ${values.objectives.length} objetivos`}</button></div>
    </form>
  </dialog>;
}
