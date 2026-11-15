import { useState } from 'react';
import { createOperationRecord, deleteOperationRecord, listActivityCatalog, listOperationRecords, updateOperationRecord } from './api.js';
import { PEOPLE_TABS, TRAINING_TABS } from './navigation.js';
import {
  ASSIGNMENT_FORM_FIELDS, CAREER_LEVELS, COURSE_FORM_FIELDS, PLAN_FORM_FIELDS, PLAN_STATUS_DEFAULTS, SKILL_FORM_FIELDS, SKILL_LEVELS, TALENT_CATEGORIES,
  TALENT_FORM_FIELDS, TALENT_PROFILES, buildActivityMatrix, computeAssignmentTotals, filterRecords, mergeOptions, overAllocatedTalents, safeExternalUrl,
  skillLevelLabel, validateAssignmentForm, validateCourseForm, validatePlanForm, validateSkillForm, validateTalentForm,
} from './people.js';
import { loadPeopleTab, loadTrainingTab, savePeopleTab, saveTrainingTab } from './preferences.js';
import { RecordDialog, RecordPanel, SearchBox, TabStrip, formatNumber, numberToInput, useCollection } from './OperationsUi.jsx';

const EYEBROW = 'PEOPLE';

/** Shared create/edit/delete wiring of one resource panel. */
function useRecordActions(resource, { reload, onNotice, describe, noun }) {
  const [editing, setEditing] = useState(null);
  const save = async (payload) => {
    if (editing?.id) await updateOperationRecord(resource, editing.id, payload);
    else await createOperationRecord(resource, payload);
    onNotice(editing?.id ? `Se guardaron los cambios de ${noun}.` : `Se creó ${noun}.`);
    reload();
  };
  const remove = async (record) => {
    if (!window.confirm(`¿Eliminar definitivamente ${noun} «${describe(record)}»? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteOperationRecord(resource, record.id);
      onNotice(`Se eliminó ${noun} «${describe(record)}».`);
      reload();
    } catch (err) {
      onNotice(err?.message || `No se pudo eliminar ${noun}.`, 'error');
    }
  };
  return { editing, setEditing, save, remove };
}

/**
 * "People": talents, their skills, the activity catalog by level, assignments and training.
 * Each tab loads its own data; talents, catalogs and masters feed the dialog selects.
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
  const selectTab = (id) => { setTab(id); savePeopleTab(id); };
  const selectTrainingTab = (id) => { setTrainingTab(id); saveTrainingTab(id); };
  // Talent names appear in every other table, so a talent change reloads them too.
  const reloadTalents = () => { talents.reload(); skills.reload(); assignments.reload(); plan.reload(); };
  const shared = { onNotice, talents: talents.records };

  return <TabStrip tabs={PEOPLE_TABS} active={tab} onSelect={selectTab} label="People">
    {tab === 'talentList' && <TalentsPanel collection={talents} reload={reloadTalents} {...shared} />}
    {tab === 'talentSkills' && <SkillsPanel collection={skills} activities={activities.records} {...shared} />}
    {tab === 'activityCatalog' && <ActivityMatrixPanel collection={activities} />}
    {tab === 'assignments' && <AssignmentsPanel collection={assignments} towers={towers} lobs={lobs} clients={clients} {...shared} />}
    {tab === 'training' && <TabStrip tabs={TRAINING_TABS} active={trainingTab} onSelect={selectTrainingTab} label="Formación" className="ops-subtabs">
      {trainingTab === 'trainingCatalog' && <TrainingCatalogPanel collection={courses} reloadPlan={plan.reload} onNotice={onNotice} />}
      {trainingTab === 'trainingPlan' && <TrainingPlanPanel collection={plan} courses={courses.records} {...shared} />}
    </TabStrip>}
  </TabStrip>;
}

function TalentsPanel({ collection, reload, onNotice }) {
  const [query, setQuery] = useState('');
  const actions = useRecordActions('talents', { reload, onNotice, describe: (row) => row.name, noun: 'el talento' });
  const rows = filterRecords(collection.records, query, ['name', 'location', 'category', 'profile']);
  return <>
    <RecordPanel title="Listado de personas" description="Talentos del equipo QE. Un talento con skills, asignaciones o plan de formación no se puede eliminar." tableId="people-talents"
      columns={[
        { id: 'name', label: 'Nombre', value: (row) => row.name },
        { id: 'location', label: 'Ubicación', value: (row) => row.location },
        { id: 'category', label: 'Categoría', value: (row) => row.category },
        { id: 'profile', label: 'Perfil', value: (row) => row.profile },
      ]}
      rows={rows} totalCount={collection.records.length} query={query} onQueryChange={setQuery} searchLabel="Buscar talentos"
      createLabel="Crear talento" onCreate={() => actions.setEditing({})} onEdit={actions.setEditing} onDelete={actions.remove}
      emptyMessage="Todavía no hay talentos." loading={collection.loading} error={collection.error} onRetry={collection.reload} />
    {actions.editing && <RecordDialog eyebrow={EYEBROW} title={actions.editing.id ? 'Editar talento' : 'Crear talento'}
      fields={[
        { id: 'name', label: 'Nombre', required: true, wide: true },
        { id: 'location', label: 'Ubicación', wide: true },
        { id: 'category', label: 'Categoría', type: 'select', options: TALENT_CATEGORIES },
        { id: 'profile', label: 'Perfil', type: 'select', options: TALENT_PROFILES },
      ]}
      initialValues={{ name: actions.editing.name || '', location: actions.editing.location || '', category: actions.editing.category || '', profile: actions.editing.profile || '' }}
      validate={validateTalentForm} formFields={TALENT_FORM_FIELDS} onSave={actions.save} onClose={() => actions.setEditing(null)} />}
  </>;
}

const SKILL_LEVEL_OPTIONS = SKILL_LEVELS.map((level) => ({ value: String(level.value), label: level.label }));
const levelSortValue = (value) => (value === null || value === undefined ? null : Number(value));

function SkillsPanel({ collection, activities, talents, onNotice }) {
  const [query, setQuery] = useState('');
  const actions = useRecordActions('talent-skills', { reload: collection.reload, onNotice, describe: (row) => `${row.talentName} · ${row.activityName}`, noun: 'la skill' });
  const rows = filterRecords(collection.records, query, ['talentName', 'activityName', 'activityCategory', 'certificate', 'comment', 'careerLevel']);
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const editing = actions.editing;
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
        { id: 'talentId', label: 'Persona', type: 'select', required: true, wide: true, placeholder: 'Selecciona una persona', options: talents.map((talent) => ({ value: talent.id, label: talent.name })) },
        { id: 'activityId', label: 'Actividad (Skill)', type: 'select', required: true, wide: true, placeholder: 'Selecciona una actividad', options: activities.map((activity) => ({ value: activity.id, label: activity.name })) },
        { id: 'activityCategory', label: 'Skill - Categoría', type: 'readonly', wide: true, compute: (values) => activityById.get(values.activityId)?.category, hint: 'Se completa desde el catálogo de actividades.' },
        { id: 'currentLevel', label: 'Nivel actual', type: 'select', required: true, options: SKILL_LEVEL_OPTIONS },
        { id: 'targetLevel', label: 'Nivel objetivo', type: 'select', options: SKILL_LEVEL_OPTIONS },
        { id: 'careerLevel', label: 'Nivel', type: 'select', options: CAREER_LEVELS, hint: 'Nivel de carrera de la persona (L1–L7).' },
        { id: 'certificate', label: 'Certificado', hint: 'Opcional. Nombre del certificado.' },
        { id: 'comment', label: 'Comentario', type: 'textarea', wide: true },
      ]}
      initialValues={{
        talentId: editing.talentId || '', activityId: editing.activityId || '', currentLevel: editing.currentLevel ? String(editing.currentLevel) : '',
        targetLevel: editing.targetLevel ? String(editing.targetLevel) : '', careerLevel: editing.careerLevel || '', certificate: editing.certificate || '', comment: editing.comment || '',
      }}
      validate={validateSkillForm} formFields={SKILL_FORM_FIELDS} onSave={actions.save} onClose={() => actions.setEditing(null)} />}
  </>;
}

function MatrixCell({ cell }) {
  if (cell.kind === 'none') return <span className="ops-matrix-cell none" role="img" aria-label="No aplica">·</span>;
  if (cell.kind === 'text') return <span className="ops-matrix-cell text">{cell.label}</span>;
  return <span className={`ops-matrix-cell ${cell.kind}`} role="img" aria-label={cell.label} title={cell.label}>{cell.symbol}</span>;
}

function ActivityMatrixPanel({ collection }) {
  const [query, setQuery] = useState('');
  const matrix = buildActivityMatrix(collection.records);
  const rows = filterRecords(matrix, query, ['name', 'category', (row) => row.cells.map((cell) => cell.label).join(' ')]);
  return <section className="secondary-panel">
    <div className="secondary-panel-heading"><div><h2>QE - Catálogo de actividades por niveles</h2><p>Actividades esperadas en cada nivel de carrera. Solo lectura.</p></div><span className="record-count">{rows.length} actividades</span></div>
    <div className="ops-toolbar">
      <SearchBox value={query} onChange={setQuery} label="Buscar actividades" />
      <ul className="ops-legend" aria-label="Leyenda">
        <li><span className="ops-matrix-cell required" aria-hidden="true">✅</span> Requerido</li>
        <li><span className="ops-matrix-cell optional" aria-hidden="true">⚪</span> Opcional</li>
        <li><span className="ops-matrix-cell none" aria-hidden="true">·</span> No aplica</li>
        <li><span className="ops-matrix-cell text" aria-hidden="true">Texto</span> Rol específico en ese nivel</li>
      </ul>
    </div>
    <div className="table-wrap ops-table-wrap">
      {collection.loading
        ? <p className="empty-state" role="status">Cargando…</p>
        : collection.error
          ? <div className="board-state"><p>{collection.error}</p><button type="button" className="button button-secondary" onClick={collection.reload}>Reintentar</button></div>
          : <table className="data-table secondary-table ops-matrix">
            <caption className="sr-only">Catálogo de actividades por nivel de carrera L1 a L7</caption>
            <thead><tr><th scope="col">ID</th><th scope="col">Actividad (Skill)</th><th scope="col">Skill - Categoría</th>{['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'].map((level) => <th key={level} scope="col" className="ops-matrix-level">{level}</th>)}</tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id}><td>{row.id}</td><th scope="row">{row.name}</th><td>{row.category || '—'}</td>{row.cells.map((cell) => <td key={cell.level} className="ops-matrix-level"><MatrixCell cell={cell} /></td>)}</tr>)}</tbody>
          </table>}
      {!collection.loading && !collection.error && rows.length === 0 && <p className="empty-state">{query.trim() ? 'No hay actividades que coincidan con la búsqueda.' : 'El catálogo de actividades está vacío.'}</p>}
    </div>
  </section>;
}

function AssignmentsPanel({ collection, talents, towers, lobs, clients, onNotice }) {
  const [query, setQuery] = useState('');
  const actions = useRecordActions('assignments', { reload: collection.reload, onNotice, describe: (row) => `${row.talentName} · ${formatNumber(row.percentage, { suffix: ' %' })}`, noun: 'la asignación' });
  const totals = computeAssignmentTotals(collection.records);
  const overAllocated = overAllocatedTalents(collection.records);
  const rows = filterRecords(collection.records, query, ['talentName', 'towerName', 'lobName', 'clientName']);
  const editing = actions.editing;
  const masterOptions = (records, selectedId) => records.filter((item) => item.active !== false || item.id === selectedId).map((item) => ({ value: item.id, label: item.name }));
  return <>
    <RecordPanel title="Asignaciones" description="Dedicación de cada talento por tower, LoB y cliente. Se avisa cuando el total de un talento supera el 100 %." tableId="people-assignments"
      columns={[
        { id: 'talentName', label: 'Talento', value: (row) => row.talentName },
        { id: 'towerName', label: 'Tower', value: (row) => row.towerName },
        { id: 'lobName', label: 'LoB', value: (row) => row.lobName },
        { id: 'clientName', label: 'Cliente', value: (row) => row.clientName },
        { id: 'percentage', label: '% asignación', type: 'number', value: (row) => row.percentage, render: (row) => formatNumber(row.percentage, { suffix: ' %' }) },
        { id: 'total', label: 'Total del talento', type: 'number', value: (row) => totals.get(row.talentId), render: (row) => { const total = totals.get(row.talentId) || 0; return <span className={total > 100 ? 'status-pill orange' : 'status-pill green'}>{formatNumber(total, { suffix: ' %' })}{total > 100 ? ' · supera el 100 %' : ''}</span>; } },
      ]}
      rows={rows} totalCount={collection.records.length} query={query} onQueryChange={setQuery} searchLabel="Buscar asignaciones"
      createLabel="Nueva asignación" onCreate={() => actions.setEditing({})} onEdit={actions.setEditing} onDelete={actions.remove}
      emptyMessage="Todavía no hay asignaciones." loading={collection.loading} error={collection.error} onRetry={collection.reload}>
      {overAllocated.length > 0 && <p className="ops-warning" role="status">Aviso: {overAllocated.map((item) => `${item.talentName} (${formatNumber(item.total, { suffix: ' %' })})`).join(', ')} {overAllocated.length === 1 ? 'supera' : 'superan'} el 100 % de asignación.</p>}
    </RecordPanel>
    {editing && <RecordDialog eyebrow={EYEBROW} title={editing.id ? 'Editar asignación' : 'Nueva asignación'}
      fields={[
        { id: 'talentId', label: 'Talento', type: 'select', required: true, wide: true, placeholder: 'Selecciona un talento', options: talents.map((talent) => ({ value: talent.id, label: talent.name })) },
        { id: 'towerId', label: 'Tower', type: 'select', placeholder: 'Sin tower', options: masterOptions(towers, editing.towerId) },
        { id: 'lobId', label: 'LoB', type: 'select', placeholder: 'Sin LoB', options: masterOptions(lobs, editing.lobId) },
        { id: 'clientId', label: 'Cliente', type: 'select', placeholder: 'Sin cliente', options: masterOptions(clients, editing.clientId) },
        { id: 'percentage', label: '% asignación', type: 'number', required: true, hint: 'Entre 0 y 100; se admiten decimales (p. ej. 62,5).' },
      ]}
      initialValues={{ talentId: editing.talentId || '', towerId: editing.towerId || '', lobId: editing.lobId || '', clientId: editing.clientId || '', percentage: numberToInput(editing.percentage) }}
      validate={validateAssignmentForm} formFields={ASSIGNMENT_FORM_FIELDS} onSave={actions.save} onClose={() => actions.setEditing(null)} />}
  </>;
}

const COURSE_TEXT_FIELDS = [['family', 'Familia'], ['istqbCategory', 'Categoría ISTQB'], ['types', 'Tipos'], ['provider', 'Proveedor'], ['level', 'Nivel']];

function TrainingCatalogPanel({ collection, reloadPlan, onNotice }) {
  const [query, setQuery] = useState('');
  const reload = () => { collection.reload(); reloadPlan(); };
  const actions = useRecordActions('training-catalog', { reload, onNotice, describe: (row) => row.name, noun: 'la formación' });
  const rows = filterRecords(collection.records, query, ['name', 'family', 'istqbCategory', 'types', 'provider', 'level']);
  const editing = actions.editing;
  const suggestions = (key) => mergeOptions([], collection.records.map((row) => row[key]));
  return <>
    <RecordPanel title="QE - Catálogo de formación" description="Formaciones y certificaciones disponibles. No se puede eliminar una formación usada en el plan de formación." tableId="people-training-catalog"
      columns={[
        { id: 'name', label: 'Formación', value: (row) => row.name, cellClassName: 'ops-wrap' },
        ...COURSE_TEXT_FIELDS.map(([key, label]) => ({ id: key, label, value: (row) => row[key] })),
        { id: 'estimatedHours', label: 'Horas Estimadas', type: 'number', value: (row) => row.estimatedHours, render: (row) => formatNumber(row.estimatedHours) || '—' },
        { id: 'url', label: 'Enlace', value: (row) => row.url, render: (row) => { const href = safeExternalUrl(row.url); return href ? <a href={href} target="_blank" rel="noopener noreferrer">Abrir<span className="sr-only"> (se abre en una pestaña nueva)</span></a> : '—'; } },
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
    <RecordPanel title="QE - Plan de formación" description="Formación planificada por persona. El curso puede venir del catálogo o escribirse libremente." tableId="people-training-plan"
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
        { id: 'talentId', label: 'QA (persona)', type: 'select', required: true, wide: true, placeholder: 'Selecciona una persona', options: talents.map((talent) => ({ value: talent.id, label: talent.name })) },
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
  </>;
}
