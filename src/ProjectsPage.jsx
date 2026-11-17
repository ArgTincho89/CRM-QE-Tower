import { useState } from 'react';
import { listOperationRecords } from './api.js';
import { PROJECT_TABS } from './navigation.js';
import {
  DEFAULT_DELIVERY_PROJECT_STATUS, DELIVERY_PROJECT_FORM_FIELDS, DELIVERY_PROJECT_STATUSES, DELIVERY_TARGETS, NAQ_LEVELS, PROJECT_FORM_FIELDS, PROJECT_TYPES,
  TESTING_SCOPE_DEFAULTS, filterRecords, mergeOptions, safeExternalUrl, validateDeliveryProjectForm, validateProjectForm,
} from './people.js';
import { loadProjectTab, saveProjectTab } from './preferences.js';
import { normalizeWorkspaceLinks, toWorkspaceLinkForm } from './workspaceLinks.js';
import { WorkspaceLinkList } from './WorkspaceLinks.jsx';
import { DetailsDialog, RecordDialog, RecordPanel, TabStrip, formatDateTime, useCollection, useRecordActions } from './OperationsUi.jsx';

const EYEBROW = 'PROYECTOS';

// Generic suggestions of the free-text fields; the values already stored are added to each list.
const SUGGESTIONS = {
  riskLevel: ['Low', 'Medium', 'High', 'Critical'],
  status: ['Not Started', 'In Progress', 'On Hold', 'Done'],
  automation: ['Not Started', 'In Progress', 'Done', 'Not Applicable'],
  phase: [],
  qaServiceType: [],
};

/** Free-text fields of the NAQ portfolio with suggestions, in table/dialog order. */
const COMBO_FIELDS = [['qaServiceType', 'Tipo de servicio QA'], ['phase', 'Fase'], ['riskLevel', 'Nivel de riesgo'], ['automation', 'Automatización'], ['status', 'Estado']];

function ProjectLink({ url }) {
  const href = safeExternalUrl(url);
  if (!href) return url ? <span title="Enlace no válido">{url}</span> : '—';
  return <a href={href} target="_blank" rel="noopener noreferrer">Abrir proyecto<span className="sr-only"> (se abre en una pestaña nueva)</span></a>;
}

const scopeText = (row) => (row.testingScope || []).join(', ');

/** "Proyectos": the NAQ application portfolio and the delivery projects, in two tabs. */
export default function ProjectsPage({ clients = [], towers = [], onNotice, onUnauthorized }) {
  const [tab, setTab] = useState(() => loadProjectTab());
  const selectTab = (id) => { setTab(id); saveProjectTab(id); };
  return <TabStrip tabs={PROJECT_TABS} active={tab} onSelect={selectTab} label="Proyectos">
    {tab === 'naqPortfolio' && <NaqPortfolioPanel clients={clients} onNotice={onNotice} onUnauthorized={onUnauthorized} />}
    {tab === 'deliveryProjects' && <DeliveryProjectsPanel clients={clients} towers={towers} onNotice={onNotice} onUnauthorized={onUnauthorized} />}
  </TabStrip>;
}

/** Client names offered by the NAQ dialog: active clients plus the stored value (even if it is not a client). */
function clientNameOptions(clients, current) {
  return mergeOptions(clients.filter((client) => client.active !== false).map((client) => client.name), [current]);
}

function NaqPortfolioPanel({ clients, onNotice, onUnauthorized }) {
  const collection = useCollection(() => listOperationRecords('projects'), { onUnauthorized });
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState(null);
  const actions = useRecordActions('projects', { reload: collection.reload, onNotice, describe: (row) => row.applicationName, noun: 'la aplicación', eyebrow: EYEBROW });
  const records = collection.records;
  const editing = actions.editing;
  const rows = filterRecords(records, query, ['code', 'applicationName', 'client', 'naq', 'projectType', 'deliveryTarget', 'testingScope', 'qaServiceType', 'phase', 'riskLevel', 'automation', 'status', 'qaOwner', 'comments']);
  const suggestions = (key) => mergeOptions(SUGGESTIONS[key] || [], records.map((record) => record[key]));
  const textColumn = (id, label) => ({ id, label, value: (row) => row[id] });
  const dateColumn = (id, label) => ({ id, label, type: 'date', value: (row) => row[id] });

  return <>
    <RecordPanel title="QE - NAQ Application Portfolio" description="Portfolio de aplicaciones con servicio QA. Pulsa una fila para ver su detalle." tableId="projects-portfolio"
      columns={[
        textColumn('code', 'ID'), textColumn('applicationName', 'Aplicación'), textColumn('version', 'Versión'), textColumn('client', 'Cliente'), textColumn('naq', 'NAQ'),
        textColumn('projectType', 'Tipo de proyecto'), textColumn('deliveryTarget', 'Delivery target'),
        { id: 'testingScope', label: 'Alcance de pruebas', sortable: false, value: scopeText, render: (row) => (row.testingScope?.length ? <span className="ops-chips">{row.testingScope.map((item) => <span key={item} className="status-pill ops-chip">{item}</span>)}</span> : '—') },
        ...COMBO_FIELDS.map(([id, label]) => textColumn(id, label)),
        { id: 'projectUrl', label: 'URL del proyecto', value: (row) => row.projectUrl, render: (row) => <ProjectLink url={row.projectUrl} /> },
        textColumn('qaOwner', 'Responsable QA'),
        dateColumn('qaEntryDate', 'Fecha de entrada QA'),
        dateColumn('targetReleaseDate', 'Fecha objetivo de release'),
        { id: 'comments', label: 'Comentarios', value: (row) => row.comments, cellClassName: 'ops-wrap' },
        dateColumn('createdDate', 'Fecha de creación'),
        textColumn('attachments', 'Adjuntos'),
      ]}
      rows={rows} totalCount={records.length} query={query} onQueryChange={setQuery} searchLabel="Buscar en el portfolio NAQ"
      createLabel="Nuevo NAQ" onCreate={() => actions.setEditing({})} onEdit={actions.setEditing} onDelete={actions.remove}
      onRowClick={setDetail} rowAriaLabel={(row) => `Ver detalle de ${row.applicationName}`}
      emptyMessage="Todavía no hay aplicaciones en el portfolio." loading={collection.loading} error={collection.error} onRetry={collection.reload} />
    {editing && <RecordDialog eyebrow={EYEBROW} title={editing.id ? 'Editar NAQ' : 'Nuevo NAQ'}
      fields={[
        { id: 'applicationName', label: 'Aplicación', required: true, wide: true },
        { id: 'code', label: 'ID' },
        { id: 'version', label: 'Versión' },
        { id: 'client', label: 'Cliente', type: 'select', placeholder: 'Sin cliente', options: clientNameOptions(clients, editing.client), hint: 'Clientes de Datos Maestros.' },
        { id: 'naq', label: 'NAQ', type: 'select', placeholder: 'Sin NAQ', options: mergeOptions(NAQ_LEVELS, [editing.naq]) },
        { id: 'projectType', label: 'Tipo de proyecto', type: 'select', placeholder: 'Sin tipo', options: mergeOptions(PROJECT_TYPES, [editing.projectType]), hint: 'Tipologías del modelo de Quality Gates.' },
        { id: 'deliveryTarget', label: 'Delivery target', type: 'select', placeholder: 'Sin delivery target', options: mergeOptions(DELIVERY_TARGETS, [editing.deliveryTarget]) },
        ...COMBO_FIELDS.map(([id, label]) => ({ id, label, type: 'combo', options: suggestions(id) })),
        { id: 'testingScope', label: 'Alcance de pruebas', type: 'checklist', options: mergeOptions(TESTING_SCOPE_DEFAULTS, records.map((record) => record.testingScope || [])) },
        { id: 'qaOwner', label: 'Responsable QA', type: 'combo', options: suggestions('qaOwner') },
        { id: 'projectUrl', label: 'URL del proyecto', type: 'url', wide: true, hint: 'Solo enlaces http:// o https://.' },
        { id: 'qaEntryDate', label: 'Fecha de entrada QA', type: 'date' },
        { id: 'targetReleaseDate', label: 'Fecha objetivo de release', type: 'date' },
        { id: 'createdDate', label: 'Fecha de creación', type: 'date' },
        { id: 'attachments', label: 'Adjuntos' },
        { id: 'comments', label: 'Comentarios', type: 'textarea', wide: true },
      ]}
      initialValues={Object.fromEntries(PROJECT_FORM_FIELDS.map((field) => [field, field === 'testingScope' ? [...(editing.testingScope || [])] : (editing[field] ?? '')]))}
      validate={validateProjectForm} formFields={PROJECT_FORM_FIELDS} onSave={actions.save} onClose={() => actions.setEditing(null)} />}
    {detail && <DetailsDialog eyebrow={EYEBROW} title={detail.applicationName} onClose={() => setDetail(null)} rows={[
      { label: 'ID', value: detail.code },
      { label: 'Aplicación', value: detail.applicationName },
      { label: 'Versión', value: detail.version },
      { label: 'Cliente', value: detail.client },
      { label: 'NAQ', value: detail.naq },
      { label: 'Tipo de proyecto', value: detail.projectType },
      { label: 'Delivery target', value: detail.deliveryTarget },
      { label: 'Alcance de pruebas', value: scopeText(detail) },
      ...COMBO_FIELDS.map(([id, label]) => ({ label, value: detail[id] })),
      { label: 'URL del proyecto', value: detail.projectUrl ? <ProjectLink url={detail.projectUrl} /> : '' },
      { label: 'Responsable QA', value: detail.qaOwner },
      { label: 'Fecha de entrada QA', value: detail.qaEntryDate },
      { label: 'Fecha objetivo de release', value: detail.targetReleaseDate },
      { label: 'Fecha de creación', value: detail.createdDate },
      { label: 'Adjuntos', value: detail.attachments },
      { label: 'Comentarios', value: detail.comments },
      { label: 'Creado', value: formatDateTime(detail.createdAt) },
      { label: 'Actualizado', value: formatDateTime(detail.updatedAt) },
    ]} />}
    {actions.deleteDialog}
  </>;
}

/** Options of a master list: active records plus the one already selected (even if inactive). */
const masterOptions = (records, selected) => records
  .filter((item) => item.active !== false || item.id === selected)
  .map((item) => ({ value: item.id, label: item.name }));

function DeliveryProjectsPanel({ clients, towers, onNotice, onUnauthorized }) {
  const collection = useCollection(() => listOperationRecords('delivery-projects'), { onUnauthorized });
  const talents = useCollection(() => listOperationRecords('talents'), { onUnauthorized });
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState(null);
  const actions = useRecordActions('delivery-projects', { reload: collection.reload, onNotice, describe: (row) => row.name, noun: 'el proyecto', eyebrow: EYEBROW });
  const records = collection.records;
  const editing = actions.editing;
  const rows = filterRecords(records, query, ['name', 'clientName', 'towerName', 'talentName', 'status', 'description', 'nextMilestone', (row) => (row.links || []).map((link) => link.title)]);
  const textColumn = (id, label) => ({ id, label, value: (row) => row[id] });
  const dateColumn = (id, label) => ({ id, label, type: 'date', value: (row) => row[id] });

  return <>
    <RecordPanel title="Proyectos" description="Proyectos en curso por cliente. La fecha próxima acción y la del próximo hito aparecen en el Calendario mientras el proyecto no está cerrado." tableId="delivery-projects"
      columns={[
        textColumn('name', 'Nombre'), textColumn('clientName', 'Cliente'), textColumn('towerName', 'Tower'), textColumn('talentName', 'Responsable'),
        { id: 'status', label: 'Estado', value: (row) => row.status, render: (row) => <span className={`status-pill ${row.status === 'Cerrado' ? 'gray' : row.status === 'En pausa' ? 'orange' : 'green'}`}>{row.status}</span> },
        dateColumn('startDate', 'Fecha inicio'), dateColumn('endDate', 'Fecha fin'),
        dateColumn('nextMilestoneDate', 'Fecha próximo hito'),
        { id: 'nextMilestone', label: 'Próximo hito', value: (row) => row.nextMilestone, cellClassName: 'ops-wrap' },
        dateColumn('nextActionDate', 'Fecha próxima acción'),
        { id: 'links', label: 'Enlaces', value: (row) => (row.links || []).map((link) => link.title).join(', '), render: (row) => <WorkspaceLinkList links={row.links} /> },
        { id: 'description', label: 'Descripción', value: (row) => row.description, cellClassName: 'cell-truncate-wrap', render: (row) => (row.description ? <span className="cell-truncate" title={row.description}>{row.description}</span> : '—') },
      ]}
      rows={rows} totalCount={records.length} query={query} onQueryChange={setQuery} searchLabel="Buscar proyectos"
      createLabel="Nuevo proyecto" onCreate={() => actions.setEditing({})} onEdit={actions.setEditing} onDelete={actions.remove}
      onRowClick={setDetail} rowAriaLabel={(row) => `Ver detalle de ${row.name}`}
      emptyMessage="Todavía no hay proyectos." loading={collection.loading} error={collection.error} onRetry={collection.reload} />
    {editing && <RecordDialog eyebrow={EYEBROW} title={editing.id ? 'Editar proyecto' : 'Nuevo proyecto'}
      fields={[
        { id: 'name', label: 'Nombre', required: true, wide: true },
        { id: 'clientId', label: 'Cliente', type: 'select', required: true, placeholder: 'Selecciona un cliente', options: masterOptions(clients, editing.clientId) },
        { id: 'status', label: 'Estado', type: 'select', required: true, placeholder: 'Selecciona un estado', options: DELIVERY_PROJECT_STATUSES },
        { id: 'towerId', label: 'Tower', type: 'select', placeholder: 'Sin tower', options: masterOptions(towers, editing.towerId), hint: 'Opcional.' },
        { id: 'talentId', label: 'Responsable', type: 'select', placeholder: 'Sin responsable', options: masterOptions(talents.records, editing.talentId), hint: 'Opcional. Talento de People.' },
        { id: 'startDate', label: 'Fecha inicio', type: 'date' },
        { id: 'endDate', label: 'Fecha fin', type: 'date' },
        { id: 'nextMilestoneDate', label: 'Fecha próximo hito', type: 'date', hint: 'Aparece en el Calendario con el texto del hito.' },
        { id: 'nextActionDate', label: 'Fecha próxima acción', type: 'date', hint: 'Aparece en el Calendario.' },
        { id: 'nextMilestone', label: 'Próximo hito', wide: true },
        { id: 'description', label: 'Descripción', type: 'textarea', wide: true },
        { id: 'links', label: 'Enlaces', type: 'links' },
      ]}
      initialValues={{
        name: editing.name || '', clientId: editing.clientId || '', towerId: editing.towerId || '', talentId: editing.talentId || '',
        status: editing.status || DEFAULT_DELIVERY_PROJECT_STATUS, startDate: editing.startDate || '', endDate: editing.endDate || '',
        description: editing.description || '', nextMilestoneDate: editing.nextMilestoneDate || '', nextMilestone: editing.nextMilestone || '',
        nextActionDate: editing.nextActionDate || '', links: toWorkspaceLinkForm(editing.links),
      }}
      toPayload={(values) => ({ ...values, links: normalizeWorkspaceLinks(values.links) })}
      validate={validateDeliveryProjectForm} formFields={DELIVERY_PROJECT_FORM_FIELDS} onSave={actions.save} onClose={() => actions.setEditing(null)} />}
    {detail && <DetailsDialog eyebrow={EYEBROW} title={detail.name} onClose={() => setDetail(null)} rows={[
      { label: 'Nombre', value: detail.name },
      { label: 'Cliente', value: detail.clientName },
      { label: 'Tower', value: detail.towerName },
      { label: 'Responsable', value: detail.talentName },
      { label: 'Estado', value: detail.status },
      { label: 'Fecha inicio', value: detail.startDate },
      { label: 'Fecha fin', value: detail.endDate },
      { label: 'Fecha próximo hito', value: detail.nextMilestoneDate },
      { label: 'Próximo hito', value: detail.nextMilestone },
      { label: 'Fecha próxima acción', value: detail.nextActionDate },
      { label: 'Descripción', value: detail.description },
      { label: 'Enlaces', value: <WorkspaceLinkList links={detail.links} /> },
      { label: 'Creado', value: formatDateTime(detail.createdAt) },
      { label: 'Actualizado', value: formatDateTime(detail.updatedAt) },
    ]} />}
    {actions.deleteDialog}
  </>;
}
