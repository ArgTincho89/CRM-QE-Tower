import { useState } from 'react';
import { createOperationRecord, deleteOperationRecord, listOperationRecords, updateOperationRecord } from './api.js';
import { PROJECT_FORM_FIELDS, TESTING_SCOPE_DEFAULTS, filterRecords, mergeOptions, safeExternalUrl, validateProjectForm } from './people.js';
import { RecordDialog, RecordPanel, useCollection } from './OperationsUi.jsx';

// Generic suggestions; the values already stored in projects are added to each list.
const SUGGESTIONS = {
  naq: ['Low', 'Medium', 'High'],
  riskLevel: ['Low', 'Medium', 'High', 'Critical'],
  status: ['Not Started', 'In Progress', 'On Hold', 'Done'],
  automation: ['Not Started', 'In Progress', 'Done', 'Not Applicable'],
  phase: [],
  projectType: [],
  deliveryTarget: [],
  qaServiceType: [],
};

const TEXT_COLUMNS = [
  ['code', 'ID'], ['applicationName', 'Application Name'], ['version', 'Version'], ['client', 'Client'], ['naq', 'NAQ'],
  ['projectType', 'Project Type'], ['deliveryTarget', 'Delivery Target'],
];
const TEXT_COLUMNS_AFTER_SCOPE = [['qaServiceType', 'QA Service Type'], ['phase', 'Phase'], ['riskLevel', 'Risk Level'], ['automation', 'Automation'], ['status', 'Status']];

function ProjectLink({ url }) {
  const href = safeExternalUrl(url);
  if (!href) return url ? <span title="Enlace no válido">{url}</span> : '—';
  return <a href={href} target="_blank" rel="noopener noreferrer">Abrir proyecto<span className="sr-only"> (se abre en una pestaña nueva)</span></a>;
}

/** "Proyectos": the NAQ application portfolio. */
export default function ProjectsPage({ onNotice, onUnauthorized }) {
  const collection = useCollection(() => listOperationRecords('projects'), { onUnauthorized });
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const records = collection.records;
  const rows = filterRecords(records, query, ['code', 'applicationName', 'client', 'naq', 'projectType', 'deliveryTarget', 'testingScope', 'qaServiceType', 'phase', 'riskLevel', 'automation', 'status', 'qaOwner', 'comments']);
  const options = (key) => mergeOptions(SUGGESTIONS[key] || [], records.map((record) => record[key]));

  const save = async (payload) => {
    if (editing?.id) await updateOperationRecord('projects', editing.id, payload);
    else await createOperationRecord('projects', payload);
    onNotice(editing?.id ? 'Se guardaron los cambios del proyecto.' : 'Se creó el proyecto.');
    collection.reload();
  };
  const remove = async (record) => {
    if (!window.confirm(`¿Eliminar definitivamente el proyecto «${record.applicationName}»? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteOperationRecord('projects', record.id);
      onNotice(`Se eliminó el proyecto «${record.applicationName}».`);
      collection.reload();
    } catch (err) {
      onNotice(err?.message || 'No se pudo eliminar el proyecto.', 'error');
    }
  };
  const textColumn = ([id, label]) => ({ id, label, value: (row) => row[id] });
  const dateColumn = (id, label) => ({ id, label, type: 'date', value: (row) => row[id] });
  const comboField = ([id, label]) => ({ id, label, type: 'combo', options: options(id) });

  return <>
    <RecordPanel title="QE - NAQ Application Portfolio" description="Portfolio de aplicaciones con servicio QA." tableId="projects-portfolio"
      columns={[
        ...TEXT_COLUMNS.map(textColumn),
        { id: 'testingScope', label: 'Testing Scope', sortable: false, value: (row) => (row.testingScope || []).join(', '), render: (row) => (row.testingScope?.length ? <span className="ops-chips">{row.testingScope.map((item) => <span key={item} className="status-pill ops-chip">{item}</span>)}</span> : '—') },
        ...TEXT_COLUMNS_AFTER_SCOPE.map(textColumn),
        { id: 'projectUrl', label: 'Project URL', value: (row) => row.projectUrl, render: (row) => <ProjectLink url={row.projectUrl} /> },
        { id: 'qaOwner', label: 'QA Owner', value: (row) => row.qaOwner },
        dateColumn('qaEntryDate', 'QA Entry Date'),
        dateColumn('targetReleaseDate', 'Target Release Date'),
        { id: 'comments', label: 'Comments', value: (row) => row.comments, cellClassName: 'ops-wrap' },
        dateColumn('createdDate', 'Created'),
        { id: 'attachments', label: 'Attachments', value: (row) => row.attachments },
      ]}
      rows={rows} totalCount={records.length} query={query} onQueryChange={setQuery} searchLabel="Buscar proyectos"
      createLabel="Nuevo proyecto" onCreate={() => setEditing({})} onEdit={setEditing} onDelete={remove}
      emptyMessage="Todavía no hay proyectos." loading={collection.loading} error={collection.error} onRetry={collection.reload} />
    {editing && <RecordDialog eyebrow="PROYECTOS" title={editing.id ? 'Editar proyecto' : 'Nuevo proyecto'}
      fields={[
        { id: 'applicationName', label: 'Application Name', required: true, wide: true },
        { id: 'code', label: 'ID' },
        { id: 'version', label: 'Version' },
        { id: 'client', label: 'Client', type: 'combo', options: options('client') },
        ...[['naq', 'NAQ'], ['projectType', 'Project Type'], ['deliveryTarget', 'Delivery Target'], ...TEXT_COLUMNS_AFTER_SCOPE].map(comboField),
        { id: 'testingScope', label: 'Testing Scope', type: 'checklist', options: mergeOptions(TESTING_SCOPE_DEFAULTS, records.map((record) => record.testingScope || [])) },
        { id: 'qaOwner', label: 'QA Owner', type: 'combo', options: options('qaOwner') },
        { id: 'projectUrl', label: 'Project URL', type: 'url', wide: true, hint: 'Solo enlaces http:// o https://.' },
        { id: 'qaEntryDate', label: 'QA Entry Date', type: 'date' },
        { id: 'targetReleaseDate', label: 'Target Release Date', type: 'date' },
        { id: 'createdDate', label: 'Created', type: 'date' },
        { id: 'attachments', label: 'Attachments' },
        { id: 'comments', label: 'Comments', type: 'textarea', wide: true },
      ]}
      initialValues={Object.fromEntries(PROJECT_FORM_FIELDS.map((field) => [field, field === 'testingScope' ? [...(editing.testingScope || [])] : (editing[field] ?? '')]))}
      validate={validateProjectForm} formFields={PROJECT_FORM_FIELDS} onSave={save} onClose={() => setEditing(null)} />}
  </>;
}
