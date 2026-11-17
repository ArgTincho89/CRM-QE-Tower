import { useEffect, useRef, useState } from 'react';
import { createOperationRecord, updateOperationRecord } from './api.js';
import { toLocalIsoDate } from './calendar.js';
import { FormField, useFieldErrors } from './FormField.jsx';
import { mapServerFieldError } from './formValidation.js';
import { formatCurrency } from './money.js';
import { filterRecords } from './people.js';
import { ColumnChart, PieChart } from './StrategyCharts.jsx';
import {
  CERTIFICATION_CATEGORIES, CERTIFICATION_FORM_FIELDS, CERTIFICATION_STATUSES, DEFAULT_CERTIFICATION_STATUS, EXPIRED_CERTIFICATION_STATUS, STRATEGY_FORM_FIELDS,
  buildCertificationMatrix, certificationCategory, certificationExpiry, effectiveCertificationStatus, expiryLabel, investmentSummary, planYearSummary,
  strategyTargets, summarizeCertifications, validateCertificationForm, validateStrategyForm,
} from './training.js';
import { RecordDialog, RecordPanel, SearchBox, formatNumber, numberToInput, useRecordActions } from './OperationsUi.jsx';

/**
 * People > Formación: "Certificaciones x talento" (matrix and list of talent_certifications) and
 * "Estrategia de formación" (yearly business case and investment plan with the executive dashboard).
 */

const STATUS_CELLS = {
  Obtenida: { symbol: '✅', tone: 'obtained' },
  Pendiente: { symbol: '⏳', tone: 'pending' },
  [EXPIRED_CERTIFICATION_STATUS]: { symbol: '⚠', tone: 'expired' },
};
const STATUS_PILLS = { Obtenida: 'green', Pendiente: 'gray', [EXPIRED_CERTIFICATION_STATUS]: 'orange' };

const courseById = (courses) => new Map(courses.map((course) => [course.id, course]));

/** Catalog options of the certification select, grouped by dashboard category. */
const certificationOptions = (courses) => [...courses]
  .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { sensitivity: 'base' }))
  .map((course) => ({ value: course.id, label: course.name, group: certificationCategory(course) }))
  .sort((a, b) => [...CERTIFICATION_CATEGORIES, 'Otras'].indexOf(a.group) - [...CERTIFICATION_CATEGORIES, 'Otras'].indexOf(b.group));

function certificationTitle(cell, columnName) {
  const { record, status, expiry } = cell;
  const parts = [`${columnName}: ${status}`];
  if (record.obtainedDate) parts.push(`obtenida el ${record.obtainedDate}`);
  else if (record.obtainedYear) parts.push(`año ${record.obtainedYear}`);
  if (expiryLabel(expiry)) parts.push(expiry.kind === 'never' ? 'no expira' : `caduca el ${expiry.date}`);
  return parts.join(' · ');
}

export function TalentCertificationsPanel({ collection, courses = [], talents = [], eyebrow, onNotice }) {
  const [view, setView] = useState('matrix');
  const [query, setQuery] = useState('');
  const today = toLocalIsoDate(new Date());
  const actions = useRecordActions('talent-certifications', { reload: collection.reload, onNotice, eyebrow, describe: (row) => `${row.talentName} · ${row.courseName}`, noun: 'la certificación' });
  const byId = courseById(courses);
  const records = filterRecords(collection.records, query, ['talentName', 'courseName', 'courseCategory', 'status', 'notes']);
  const matrix = buildCertificationMatrix(records, courses, today);
  const editing = actions.editing;
  const statusOf = (row) => effectiveCertificationStatus(row, byId.get(row.courseId), today);
  const expiryOf = (row) => certificationExpiry(row, byId.get(row.courseId));
  const viewSwitch = <div className="ops-view-switch" role="group" aria-label="Vista">
    {[['matrix', 'Matriz'], ['list', 'Listado']].map(([id, label]) => <button key={id} type="button" className={`button button-secondary${view === id ? ' active' : ''}`} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
  </div>;
  const description = 'Certificaciones del catálogo que tiene (o persigue) cada talento. La caducidad se calcula con la fecha de obtención y la vigencia del catálogo.';
  return <>
    {view === 'list'
      ? <RecordPanel title="Certificaciones x talento" description={description} tableId="people-talent-certifications"
        columns={[
          { id: 'talentName', label: 'Talento', value: (row) => row.talentName },
          { id: 'courseName', label: 'Certificación', value: (row) => row.courseName, cellClassName: 'ops-wrap' },
          { id: 'category', label: 'Categoría', value: (row) => certificationCategory(byId.get(row.courseId) || { istqbCategory: row.courseCategory }) },
          { id: 'status', label: 'Estado', value: statusOf, render: (row) => <span className={`status-pill ${STATUS_PILLS[statusOf(row)] || 'gray'}`}>{statusOf(row)}</span> },
          { id: 'obtainedDate', label: 'Fecha de obtención', type: 'date', value: (row) => row.obtainedDate },
          { id: 'obtainedYear', label: 'Año', type: 'number', value: (row) => row.obtainedYear },
          { id: 'expiry', label: 'Caducidad', value: (row) => expiryLabel(expiryOf(row)), render: (row) => expiryLabel(expiryOf(row)) || '—' },
          { id: 'notes', label: 'Notas', value: (row) => row.notes, cellClassName: 'ops-wrap' },
        ]}
        rows={records} totalCount={collection.records.length} query={query} onQueryChange={setQuery} searchLabel="Buscar certificaciones"
        createLabel="Nueva certificación" onCreate={() => actions.setEditing({})} onEdit={actions.setEditing} onDelete={actions.remove}
        emptyMessage="Todavía no hay certificaciones registradas." loading={collection.loading} error={collection.error} onRetry={collection.reload}>
        <div className="ops-filters">{viewSwitch}</div>
      </RecordPanel>
      : <section className="secondary-panel">
        <div className="secondary-panel-heading"><div><h2>Certificaciones x talento</h2><p>{description} Pulsa una celda para editarla o una celda vacía para registrarla.</p></div><span className="record-count">{matrix.rows.length} talentos · {records.length} certificaciones</span></div>
        <div className="ops-toolbar">
          <SearchBox value={query} onChange={setQuery} label="Buscar certificaciones" />
          <button type="button" className="button button-primary" onClick={() => actions.setEditing({})}>+ Nueva certificación</button>
        </div>
        <div className="ops-filters">{viewSwitch}</div>
        <ul className="ops-legend ops-legend-row" aria-label="Leyenda">
          <li><span className="ops-matrix-cell" aria-hidden="true">✅</span> Obtenida</li>
          <li><span className="ops-matrix-cell" aria-hidden="true">⏳</span> Pendiente</li>
          <li><span className="ops-matrix-cell" aria-hidden="true">⚠</span> Caducada</li>
          <li><span className="ops-matrix-cell none" aria-hidden="true">·</span> Sin registrar</li>
        </ul>
        <div className="table-wrap ops-table-wrap">
          {collection.loading
            ? <p className="empty-state" role="status">Cargando…</p>
            : collection.error
              ? <div className="board-state"><p>{collection.error}</p><button type="button" className="button button-secondary" onClick={collection.reload}>Reintentar</button></div>
              : matrix.rows.length === 0
                ? <p className="empty-state">{query.trim() ? 'No hay certificaciones que coincidan con la búsqueda.' : 'Todavía no hay certificaciones registradas.'}</p>
                : <table className="data-table secondary-table ops-matrix cert-matrix">
                  <caption className="sr-only">Certificaciones por talento: una columna por certificación, agrupadas por categoría, y totales por categoría</caption>
                  <thead>
                    <tr>
                      <th scope="col" rowSpan={2}>Nº</th><th scope="col" rowSpan={2}>QA</th>
                      {CATEGORY_GROUPS(matrix.columns).map((group) => <th key={group.category} scope="colgroup" colSpan={group.count} className="cert-group">{group.category}</th>)}
                      <th scope="colgroup" colSpan={7} className="cert-group">Resumen</th>
                    </tr>
                    <tr>
                      {matrix.columns.map((column) => <th key={column.id} scope="col" className="cert-column"><span>{column.name}</span></th>)}
                      {['Foundation', 'Core Advanced', 'ISTQB Specialist', 'Extras', 'Pendientes', 'Total', 'Nivel actual'].map((label) => <th key={label} scope="col" className="ops-matrix-level">{label}</th>)}
                    </tr>
                  </thead>
                  <tbody>{matrix.rows.map((row, index) => <tr key={row.talentId}>
                    <td className="ops-index">{index + 1}</td>
                    <th scope="row">{row.talentName}<small className="cert-recommendation">{row.recommendation}</small></th>
                    {matrix.columns.map((column) => {
                      const cell = row.cells[column.id];
                      if (!cell) {
                        return <td key={column.id} className="ops-matrix-level"><button type="button" className="cert-cell empty" aria-label={`Registrar ${column.name} para ${row.talentName}`}
                          onClick={() => actions.setEditing({ talentId: row.talentId, courseId: column.id })}><span aria-hidden="true">·</span></button></td>;
                      }
                      const look = STATUS_CELLS[cell.status] || STATUS_CELLS.Obtenida;
                      const title = certificationTitle(cell, column.name);
                      return <td key={column.id} className="ops-matrix-level"><button type="button" className={`cert-cell ${look.tone}`} title={title} aria-label={`${row.talentName}. ${title}. Editar`}
                        onClick={() => actions.setEditing(cell.record)}><span aria-hidden="true">{look.symbol}</span>{cell.record.obtainedYear ? <small aria-hidden="true">{cell.record.obtainedYear}</small> : null}</button></td>;
                    })}
                    {['Foundation', 'Core Advanced', 'ISTQB Specialist', 'Extras'].map((category) => <td key={category} className="ops-matrix-level">{row.counts[category]}</td>)}
                    <td className="ops-matrix-level">{row.counts.pending}</td>
                    <td className="ops-matrix-level"><strong>{row.counts.total}</strong></td>
                    <td className="ops-matrix-level"><span className="status-pill">{row.level}</span></td>
                  </tr>)}</tbody>
                </table>}
        </div>
      </section>}
    {editing && <RecordDialog eyebrow={eyebrow} title={editing.id ? 'Editar certificación' : 'Nueva certificación'}
      fields={[
        { id: 'talentId', label: 'Talento', type: 'select', required: true, wide: true, placeholder: 'Selecciona un talento', options: talents.map((talent) => ({ value: talent.id, label: talent.name })) },
        { id: 'courseId', label: 'Certificación del catálogo', type: 'select', required: true, wide: true, placeholder: 'Selecciona una certificación', options: certificationOptions(courses) },
        { id: 'status', label: 'Estado', type: 'select', options: CERTIFICATION_STATUSES, placeholder: DEFAULT_CERTIFICATION_STATUS },
        { id: 'obtainedDate', label: 'Fecha de obtención', type: 'date', hint: 'Opcional. Con ella se calcula la caducidad.' },
        { id: 'obtainedYear', label: 'Año', type: 'number', hint: 'Opcional, si solo se conoce el año. La fecha manda.' },
        { id: 'expiry', label: 'Caducidad', type: 'readonly',
          compute: (values) => expiryLabel(certificationExpiry({ status: values.status || DEFAULT_CERTIFICATION_STATUS, obtainedDate: values.obtainedDate }, byId.get(values.courseId))),
          hint: 'Fecha de obtención + vigencia del catálogo («No expira» si el catálogo lo indica).' },
        { id: 'notes', label: 'Notas', type: 'textarea', wide: true },
      ]}
      initialValues={{ talentId: editing.talentId || '', courseId: editing.courseId || '', status: editing.status || '', obtainedDate: editing.obtainedDate || '', obtainedYear: editing.obtainedYear ? String(editing.obtainedYear) : '', notes: editing.notes || '' }}
      validate={validateCertificationForm} formFields={CERTIFICATION_FORM_FIELDS}
      toPayload={({ expiry: _expiry, ...values }) => values}
      onSave={actions.save} onClose={() => actions.setEditing(null)} />}
    {actions.deleteDialog}
  </>;
}

function CATEGORY_GROUPS(columns) {
  const groups = [];
  for (const column of columns) {
    const last = groups[groups.length - 1];
    if (last && last.category === column.category) last.count += 1;
    else groups.push({ category: column.category, count: 1 });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Estrategia de formación
// ---------------------------------------------------------------------------

const euros = (value) => formatCurrency(value);
const LIVE_NOTE = 'Las cifras de certificaciones salen en vivo de «Certificaciones x talento» y las del plan, de «Plan de formación» (por año de la fecha de inicio). Objetivos, business case e inversión son los guardados en la estrategia.';

function Metric({ label, value, hint, tone = '' }) {
  return <div className={`report-metric strategy-metric${tone ? ` report-metric-${tone}` : ''}`}><span className="report-metric-label">{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>;
}

export function TrainingStrategyPanel({ collection, certifications = [], courses = [], plan = [], eyebrow, onNotice }) {
  const currentYear = new Date().getFullYear();
  const years = collection.records.map((record) => record.year).sort((a, b) => b - a);
  const [selectedYear, setSelectedYear] = useState(null);
  const [editing, setEditing] = useState(null);
  const actions = useRecordActions('training-strategies', { reload: collection.reload, onNotice, eyebrow, describe: (row) => `Estrategia ${row.year}`, noun: 'la estrategia' });
  const year = selectedYear ?? (years.includes(currentYear) ? currentYear : years[0] ?? null);
  const strategy = collection.records.find((record) => record.year === year) || null;
  const save = async (payload) => {
    if (editing?.id) await updateOperationRecord('training-strategies', editing.id, payload);
    else await createOperationRecord('training-strategies', payload);
    onNotice(editing?.id ? 'Se guardaron los cambios de la estrategia.' : `Se creó la estrategia ${payload.year}.`);
    setSelectedYear(Number(payload.year));
    collection.reload();
  };
  return <section className="secondary-panel strategy-panel">
    <div className="secondary-panel-heading"><div><h2>Estrategia de formación</h2><p>Business case, plan de inversión y cuadro de mando de certificaciones por año.</p></div><span className="record-count">{years.length} {years.length === 1 ? 'estrategia' : 'estrategias'}</span></div>
    <div className="ops-toolbar">
      <label className="filter-select ops-filter-select"><span>Año</span><select value={year ?? ''} onChange={(event) => setSelectedYear(Number(event.target.value))} disabled={years.length === 0}>
        {years.length === 0 && <option value="">Sin estrategias</option>}
        {years.map((item) => <option key={item} value={item}>{item}</option>)}
      </select></label>
      <span className="strategy-toolbar-actions">
        {strategy && <button type="button" className="button button-secondary" onClick={() => setEditing(strategy)}>Editar estrategia</button>}
        {strategy && <button type="button" className="button button-secondary button-danger" onClick={() => actions.remove(strategy)}>Eliminar</button>}
        <button type="button" className="button button-primary" onClick={() => setEditing({})}>+ Nueva estrategia</button>
      </span>
    </div>
    {collection.loading
      ? <p className="empty-state" role="status">Cargando…</p>
      : collection.error
        ? <div className="board-state"><p>{collection.error}</p><button type="button" className="button button-secondary" onClick={collection.reload}>Reintentar</button></div>
        : strategy
          ? <StrategyDashboard strategy={strategy} certifications={certifications} courses={courses} plan={plan} />
          : <p className="empty-state">Todavía no hay estrategias de formación. Crea la primera con «Nueva estrategia».</p>}
    {editing && <StrategyDialog eyebrow={eyebrow} strategy={editing} usedYears={years.filter((item) => item !== editing.year)} defaultYear={years.length ? Math.max(...years) + 1 : currentYear}
      onSave={save} onClose={() => setEditing(null)} />}
    {actions.deleteDialog}
  </section>;
}

function StrategyDashboard({ strategy, certifications, courses, plan }) {
  const summary = summarizeCertifications(certifications, courses);
  const targets = strategyTargets(strategy, summary);
  const investment = investmentSummary(strategy.investmentLines || []);
  const planSummary = planYearSummary(plan, strategy.year);
  const obtainedOf = (category) => summary.byCategory.find((item) => item.category === category)?.obtained || 0;
  return <div className="strategy-dashboard">
    <h3 className="strategy-title">{strategy.title || `Estrategia de formación ${strategy.year}`}</h3>
    <p className="field-hint strategy-note">{LIVE_NOTE}</p>
    <div className="report-metrics strategy-metrics">
      <Metric label="Personas analizadas" value={formatNumber(summary.people)} hint="Con alguna certificación registrada" />
      <Metric label="Certificaciones obtenidas" value={formatNumber(summary.obtained)} tone="green" />
      <Metric label="Foundation obtenidas" value={formatNumber(obtainedOf('Foundation'))} />
      <Metric label="Core Advanced obtenidas" value={formatNumber(obtainedOf('Core Advanced'))} />
      <Metric label="ISTQB Specialist obtenidas" value={formatNumber(obtainedOf('ISTQB Specialist'))} tone="violet" />
      <Metric label="Certificaciones extras obtenidas" value={formatNumber(obtainedOf('Extras'))} tone="teal" />
      <Metric label="Certificaciones pendientes" value={formatNumber(summary.pending)} tone="amber" />
      <Metric label={`Inversión estimada ${strategy.year}`} value={euros(investment.total)} hint="Plan de inversión guardado" />
      <Metric label={`Plan de formación ${strategy.year}`} value={`${formatNumber(planSummary.rows)} filas`} hint={`${formatNumber(planSummary.people)} personas · ${formatNumber(planSummary.estimatedHours)} h estimadas`} tone="gray" />
    </div>
    <div className="strategy-charts">
      <ColumnChart title="Certificaciones obtenidas por categoría" subtitle="En vivo" categories={CERTIFICATION_CATEGORIES}
        series={[{ name: 'Obtenidas', values: CERTIFICATION_CATEGORIES.map(obtainedOf) }]} emptyMessage="Todavía no hay certificaciones obtenidas." />
      <PieChart title="Distribución por categoría" subtitle="Mix actual de certificaciones obtenidas" items={CERTIFICATION_CATEGORIES.map((category) => ({ label: category, value: obtainedOf(category) }))}
        emptyMessage="Todavía no hay certificaciones obtenidas." />
      <ColumnChart title={`Situación actual vs objetivo ${strategy.year}`} subtitle="Actual en vivo; objetivo guardado" categories={targets.map((row) => row.category)}
        series={[{ name: 'Actual', values: targets.map((row) => row.actual) }, { name: `Objetivo ${strategy.year}`, values: targets.map((row) => row.target) }]} />
      <ColumnChart title={`Inversión propuesta ${strategy.year}`} subtitle="Precio unitario × vouchers" categories={investment.rows.map((row) => row.line)}
        series={[{ name: 'Inversión', values: investment.rows.map((row) => row.amount) }]} format={euros} emptyMessage="Sin inversión prevista." />
    </div>
    <div className="strategy-columns">
      <section className="report-block">
        <h4>Estado objetivos {strategy.year}</h4>
        <table className="report-table"><thead><tr><th scope="col">Categoría</th><th scope="col">Actual / Objetivo</th><th scope="col">Gap</th></tr></thead>
          <tbody>{targets.map((row) => <tr key={row.category}><th scope="row">{row.category}</th><td>{row.actual}/{row.target ?? '—'}</td><td>{row.gap === null ? '—' : row.gap === 0 ? <span className="status-pill green">Cumplido</span> : `+${row.gap}`}</td></tr>)}</tbody></table>
      </section>
      <section className="report-block">
        <h4>Ejes estratégicos</h4>
        {(strategy.strategicAxes || []).length === 0 ? <p className="field-hint">Sin ejes definidos.</p>
          : <table className="report-table"><thead><tr><th scope="col">Eje estratégico</th><th scope="col">Decisión</th></tr></thead>
            <tbody>{strategy.strategicAxes.map((item, index) => <tr key={index}><th scope="row">{item.axis}</th><td>{item.decision}</td></tr>)}</tbody></table>}
      </section>
    </div>
    {(strategy.conclusions || []).length > 0 && <section className="report-block strategy-block">
      <h4>Conclusiones ejecutivas</h4>
      <ul className="strategy-conclusions">{strategy.conclusions.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </section>}
    <div className="strategy-columns">
      <section className="report-block">
        <h4>Business case {strategy.year}</h4>
        {(strategy.businessCase || []).length === 0 ? <p className="field-hint">Sin business case.</p>
          : <dl className="strategy-business-case">{strategy.businessCase.map((item, index) => <div key={index}><dt>{item.concept}</dt><dd>{item.detail || '—'}</dd></div>)}</dl>}
      </section>
      <section className="report-block">
        <h4>Plan de inversión {strategy.year}</h4>
        {investment.rows.length === 0 ? <p className="field-hint">Sin líneas de inversión.</p>
          : <div className="report-table-wrap"><table className="report-table">
            <thead><tr><th scope="col">Línea</th><th scope="col">Prioridad</th><th scope="col">Precio unitario estimado</th><th scope="col">Vouchers sugeridos</th><th scope="col">Inversión estimada</th></tr></thead>
            <tbody>{investment.rows.map((row, index) => <tr key={index}><th scope="row">{row.line}</th><td>{row.priority || '—'}</td><td>{row.unitPrice === null || row.unitPrice === undefined ? '—' : euros(row.unitPrice)}</td><td>{formatNumber(row.vouchers) || '—'}</td><td>{euros(row.amount)}</td></tr>)}</tbody>
            <tfoot><tr><th scope="row">Total</th><td /><td /><td /><td><strong>{euros(investment.total)}</strong></td></tr></tfoot>
          </table></div>}
        {strategy.investmentNote && <p className="strategy-investment-note"><strong>Nota:</strong> {strategy.investmentNote}</p>}
      </section>
    </div>
  </div>;
}

/** Editable line lists of the strategy dialog: id, title, columns and the empty row. */
const STRATEGY_LISTS = [
  { id: 'businessCase', title: 'Business case', add: 'Añadir concepto', columns: [['concept', 'Concepto', 'text'], ['detail', 'Detalle', 'textarea']] },
  { id: 'investmentLines', title: 'Plan de inversión', add: 'Añadir línea', columns: [['line', 'Línea', 'text'], ['priority', 'Prioridad', 'text'], ['unitPrice', 'Precio unitario (€)', 'number'], ['vouchers', 'Vouchers', 'number']] },
  { id: 'categoryTargets', title: 'Objetivos por categoría', add: 'Añadir objetivo', columns: [['category', 'Categoría', 'text'], ['target', 'Objetivo', 'number']] },
  { id: 'strategicAxes', title: 'Ejes estratégicos', add: 'Añadir eje', columns: [['axis', 'Eje estratégico', 'text'], ['decision', 'Decisión', 'text']] },
];

const lineKey = () => Math.random().toString(36).slice(2);
const toFormLine = (columns, item = {}) => ({ key: lineKey(), ...Object.fromEntries(columns.map(([id, , type]) => [id, type === 'number' ? numberToInput(item[id]) : item[id] ?? ''])) });

function StrategyDialog({ eyebrow, strategy, usedYears, defaultYear, onSave, onClose }) {
  const isEdit = Boolean(strategy.id);
  const [values, setValues] = useState(() => ({
    year: String(strategy.year ?? defaultYear), title: strategy.title ?? '', investmentNote: strategy.investmentNote ?? '',
    conclusions: (strategy.conclusions || []).join('\n'),
    ...Object.fromEntries(STRATEGY_LISTS.map((list) => {
      const stored = strategy[list.id] || [];
      // A new strategy starts with the four certification categories as targets.
      const items = stored.length || isEdit || list.id !== 'categoryTargets' ? stored : CERTIFICATION_CATEGORIES.map((category) => ({ category, target: '' }));
      return [list.id, items.map((item) => toFormLine(list.columns, item))];
    })),
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fieldErrors = useFieldErrors();
  const dialogRef = useRef(null);
  useEffect(() => { dialogRef.current?.showModal(); return () => { if (dialogRef.current?.open) dialogRef.current.close(); }; }, []);
  const setField = (field, value) => { fieldErrors.clear(field); setValues((current) => ({ ...current, [field]: value })); };
  const setLine = (list, index, field, value) => {
    fieldErrors.clear(`${list}.${index}.${field}`);
    setValues((current) => ({ ...current, [list]: current[list].map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)) }));
  };
  const addLine = (list) => setValues((current) => ({ ...current, [list.id]: [...current[list.id], toFormLine(list.columns)] }));
  const removeLine = (list, index) => { fieldErrors.show({}); setValues((current) => ({ ...current, [list]: current[list].filter((_, itemIndex) => itemIndex !== index) })); };
  const total = investmentSummary(values.investmentLines.map((item) => ({ unitPrice: Number(String(item.unitPrice).replace(/\./g, '').replace(',', '.')) || 0, vouchers: Number(String(item.vouchers).replace(/\./g, '').replace(',', '.')) || 0 }))).total;
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (fieldErrors.show(validateStrategyForm(values, { usedYears }))) return;
    setSaving(true);
    try {
      await onSave({
        year: values.year, title: values.title, investmentNote: values.investmentNote,
        conclusions: values.conclusions.split('\n').map((line) => line.trim()).filter(Boolean),
        ...Object.fromEntries(STRATEGY_LISTS.map((list) => [list.id, values[list.id].map(({ key: _key, ...item }) => item)])),
      });
      onClose();
    } catch (err) {
      const mapped = mapServerFieldError(err, STRATEGY_FORM_FIELDS);
      if (mapped && mapped.year) fieldErrors.show(mapped);
      else setError(err?.message || 'No se pudo guardar la estrategia.');
    } finally {
      setSaving(false);
    }
  };
  return <dialog ref={dialogRef} className="opportunity-dialog compact-dialog strategy-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={submit} noValidate ref={fieldErrors.formRef}>
      <div className="dialog-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{isEdit ? `Editar estrategia ${strategy.year}` : 'Nueva estrategia'}</h2></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>×</button></div>
      <div className="form-grid">
        <FormField form={fieldErrors} field="year" label="Año" required>
          <input inputMode="numeric" value={values.year} onChange={(event) => setField('year', event.target.value)} required {...fieldErrors.fieldProps('year')} />
        </FormField>
        <FormField form={fieldErrors} field="title" label="Título">
          <input value={values.title} onChange={(event) => setField('title', event.target.value)} placeholder={`QE Certification Strategy ${values.year}`} />
        </FormField>
      </div>
      {STRATEGY_LISTS.map((list) => <fieldset key={list.id} className="strategy-lines">
        <legend>{list.title}{list.id === 'investmentLines' && <span className="field-hint"> Total: {euros(total)}</span>}</legend>
        {values[list.id].length === 0 && <p className="field-hint">Sin filas.</p>}
        <ol>
          {values[list.id].map((item, index) => <li key={item.key} className="strategy-line">
            {list.columns.map(([field, label, type]) => <FormField key={field} form={fieldErrors} field={`${list.id}.${index}.${field}`} label={`${label}${values[list.id].length > 1 ? ` ${index + 1}` : ''}`} className={type === 'textarea' ? 'wide' : ''}>
              {type === 'textarea'
                ? <textarea rows="2" value={item[field]} onChange={(event) => setLine(list.id, index, field, event.target.value)} />
                : <input inputMode={type === 'number' ? 'decimal' : undefined} value={item[field]} onChange={(event) => setLine(list.id, index, field, event.target.value)} {...fieldErrors.fieldProps(`${list.id}.${index}.${field}`)} />}
            </FormField>)}
            <button type="button" className="inline-link strategy-line-remove" onClick={() => removeLine(list.id, index)} aria-label={`Quitar la fila ${index + 1} de ${list.title}`}>Quitar</button>
          </li>)}
        </ol>
        <button type="button" className="button button-secondary" onClick={() => addLine(list)}>+ {list.add}</button>
      </fieldset>)}
      <div className="form-grid">
        <FormField form={fieldErrors} field="investmentNote" label="Nota del plan de inversión" className="wide">
          <textarea rows="2" value={values.investmentNote} onChange={(event) => setField('investmentNote', event.target.value)} />
        </FormField>
        <FormField form={fieldErrors} field="conclusions" label="Conclusiones ejecutivas" className="wide">
          <textarea rows="4" value={values.conclusions} onChange={(event) => setField('conclusions', event.target.value)} />
        </FormField>
        <span className="field-hint wide">Una conclusión por línea.</span>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>Guardar</button></div>
    </form>
  </dialog>;
}
