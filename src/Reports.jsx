import { useEffect, useMemo, useState } from 'react';
import { getLiveMonthlyReport, getMonthlyAggregates, getMonthlySnapshot, listMonthlySnapshots } from './api.js';
import { opportunityOutcomes } from './data.js';
import { formatCurrency } from './money.js';
import { isActiveInitiative } from './initiatives.js';
import { MISSING_TYPE_BREAKDOWN_ID, availableYears, opportunityTypeBreakdown } from './pipelineMetrics.js';
import { MISSING_OPPORTUNITY_TYPE_FILTER, OPEN_OUTCOME_FILTER } from './pipelineFilters.js';
import { computePipelineQe } from './pipelineSummary.js';
import { monthFilterRange, reportOutcomeColumns, summarizeOpportunityOutcomes } from './reportMetrics.js';

const LIVE_PERIOD = 'live';
const TYPE_COLUMNS = [['tender', 'Pliego'], ['offer', 'Oferta'], ['staffing', 'Staffing'], [MISSING_TYPE_BREAKDOWN_ID, 'Sin tipo']];

function typeFilterValue(typeId) {
  return typeId === MISSING_TYPE_BREAKDOWN_ID ? MISSING_OPPORTUNITY_TYPE_FILTER : typeId;
}

/** A metric that navigates to the list behind it. */
function MetricButton({ label, value, detail, onClick, tone = 'blue' }) {
  return <button type="button" className={`report-metric report-metric-${tone}`} onClick={onClick} aria-label={`${label}: ${value}. Ver el detalle`}>
    <span className="report-metric-label">{label}</span>
    <strong>{value}</strong>
    {detail && <small>{detail}</small>}
  </button>;
}

/** A number inside a table cell that navigates to its list. */
function CellLink({ value, label, onClick }) {
  if (!onClick) return <span>{value}</span>;
  return <button type="button" className="report-cell-link" onClick={onClick} aria-label={`${label}: ${value}`}>{value}</button>;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
}

function ReportTable({ caption, headers, rows, empty = 'Sin registros.' }) {
  return <div className="report-table-wrap">
    <table className="report-table">
      <caption>{caption}</caption>
      <thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
      <tbody>
        {rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}
        {rows.length === 0 && <tr><td colSpan={headers.length} className="report-empty">{empty}</td></tr>}
      </tbody>
    </table>
  </div>;
}

function MonthlyReportView({ entry }) {
  const { report } = entry;
  const results = report.opportunities.results;
  const outcomeLabel = Object.fromEntries(opportunityOutcomes.map((outcome) => [outcome.id, outcome.label]));
  const initiativeRows = (list) => list.map((item) => [item.id, item.title, item.stageLabel]);
  const opportunityRows = (list) => list.map((item) => [item.id, item.title, item.client, item.typeLabel, formatCurrency(item.amount), formatCurrency(item.qeAmount)]);
  const opportunityHeaders = ['ID', 'Título', 'Cliente', 'Tipo', 'Importe', 'Importe QE'];

  return <article className="monthly-report print-area" aria-label={`Informe mensual de ${report.label}`}>
    <header className="monthly-report-heading">
      <div>
        <div className="eyebrow">INFORME MENSUAL · QUALITY ENGINEERING</div>
        <h2>{report.label}</h2>
        <p>{entry.live ? `Mes en curso, calculado en vivo el ${formatDateTime(entry.generatedAt)}. Puede cambiar hasta el cierre del mes.` : `Instantánea guardada el ${formatDateTime(entry.generatedAt)}. No cambia aunque cambien los datos.`}</p>
      </div>
      <button type="button" className="button button-secondary no-print" onClick={() => window.print()}>Imprimir / PDF</button>
    </header>

    <section className="report-section">
      <h3>Iniciativas</h3>
      <div className="report-figures">
        <div><span>Trabajadas</span><strong>{report.initiatives.worked.length}</strong></div>
        <div><span>Creadas</span><strong>{report.initiatives.created.length}</strong></div>
        <div><span>Completadas</span><strong>{report.initiatives.completed.length}</strong></div>
      </div>
      <ReportTable caption="Iniciativas trabajadas en el mes" headers={['ID', 'Título', 'Etapa']} rows={initiativeRows(report.initiatives.worked)} />
      <ReportTable caption="Iniciativas creadas" headers={['ID', 'Título', 'Etapa']} rows={initiativeRows(report.initiatives.created)} />
      <ReportTable caption="Iniciativas completadas" headers={['ID', 'Título', 'Etapa']} rows={initiativeRows(report.initiatives.completed)} />
    </section>

    <section className="report-section">
      <h3>Oportunidades generadas</h3>
      <div className="report-figures">
        <div><span>Total</span><strong>{report.opportunities.created.count}</strong></div>
        <div><span>Importe</span><strong>{formatCurrency(report.opportunities.created.amount)}</strong></div>
        <div><span>Importe QE</span><strong>{formatCurrency(report.opportunities.created.qeAmount)}</strong></div>
      </div>
      <ReportTable caption="Por tipo" headers={['Tipo', 'Oportunidades', 'Importe', 'Importe QE']} rows={report.opportunities.created.byType.map((item) => [item.label, item.count, formatCurrency(item.amount), formatCurrency(item.qeAmount)])} />
      <ReportTable caption="Detalle" headers={opportunityHeaders} rows={opportunityRows(report.opportunities.created.items)} />
    </section>

    <section className="report-section">
      <h3>Resultados del mes</h3>
      <p className="report-note">Fechados por la fecha estimada de cierre registrada en la etapa Resultado.</p>
      <div className="report-figures">
        {opportunityOutcomes.map((outcome) => <div key={outcome.id}><span>{outcome.label}s</span><strong>{results[outcome.id].count}</strong><small>{formatCurrency(results[outcome.id].amount)} · QE {formatCurrency(results[outcome.id].qeAmount)}</small></div>)}
      </div>
      {opportunityOutcomes.map((outcome) => <ReportTable key={outcome.id} caption={`Oportunidades ${outcomeLabel[outcome.id].toLowerCase()}s`} headers={[...opportunityHeaders, 'Fecha resolución']} rows={results[outcome.id].items.map((item) => [...opportunityRows([item])[0], item.closeDate])} />)}
    </section>

    <section className="report-section">
      <h3>Pipeline QE a fin de mes</h3>
      <div className="report-figures">
        <div><span>Oportunidades abiertas</span><strong>{report.pipeline.count}</strong></div>
        <div><span>Pipeline QE</span><strong>{formatCurrency(report.pipeline.qeAmount)}</strong></div>
        <div><span>Ponderado por probabilidad</span><strong>{report.pipeline.weightedAmount === null ? '—' : formatCurrency(report.pipeline.weightedAmount)}</strong></div>
      </div>
    </section>

    <section className="report-section">
      <h3>Acuerdos Marco</h3>
      <ReportTable caption="Creados en el mes" headers={['ID', 'Título', 'Cliente', 'Fin de vigencia', 'Importe']} rows={report.agreements.created.map((item) => [item.id, item.title, item.client || '—', item.endDate || '—', formatCurrency(item.amount)])} />
      <ReportTable caption={`Vencen en los ${report.agreements.horizonDays} días siguientes al cierre del mes`} headers={['ID', 'Título', 'Cliente', 'Fin de vigencia', 'Importe']} rows={report.agreements.endingSoon.map((item) => [item.id, item.title, item.client || '—', item.endDate, formatCurrency(item.amount)])} />
    </section>

    <section className="report-section report-columns">
      <ReportTable caption="Actividad por usuario" headers={['Usuario', 'Comentarios', 'Acciones', 'Eventos de historial', 'Total']} rows={report.activity.map((item) => [item.userName, item.comments, item.actions, item.events, item.total])} />
      <ReportTable caption="Principales clientes por importe" headers={['Cliente', 'Oportunidades', 'Importe', 'Importe QE']} rows={report.topClients.map((item) => [item.client, item.count, formatCurrency(item.amount), formatCurrency(item.qeAmount)])} />
      <ReportTable caption="Asignaciones recibidas por usuario" headers={['Usuario', 'Asignaciones']} rows={report.assignments.map((item) => [item.userName, item.count])} />
    </section>
  </article>;
}

/**
 * "Informes": clickable summary metrics, the per-month evolution of a year and the monthly
 * report (stored snapshots plus the live current month), printable on its own.
 */
export default function ReportsPage({ opportunities, initiatives, agreements, towers, currentYear, onNavigate, onUnauthorized }) {
  const [year, setYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [aggregates, setAggregates] = useState({ status: 'loading', data: null });
  const [snapshots, setSnapshots] = useState([]);
  const [period, setPeriod] = useState(LIVE_PERIOD);
  const [report, setReport] = useState({ status: 'loading', entry: null });

  const handleError = (err, setter) => {
    if (err?.status === 401) onUnauthorized?.();
    else setter(err?.message || 'No se pudo cargar el informe.');
  };

  useEffect(() => {
    let cancelled = false;
    setAggregates((current) => ({ ...current, status: 'loading' }));
    getMonthlyAggregates(year)
      .then((data) => { if (!cancelled) setAggregates({ status: 'ready', data }); })
      .catch((err) => { if (!cancelled) handleError(err, (message) => setAggregates({ status: 'error', data: null, message })); });
    return () => { cancelled = true; };
  }, [year]);

  useEffect(() => {
    let cancelled = false;
    listMonthlySnapshots()
      .then((result) => { if (!cancelled) setSnapshots(result.snapshots || []); })
      .catch((err) => { if (!cancelled && err?.status === 401) onUnauthorized?.(); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReport({ status: 'loading', entry: null });
    const load = period === LIVE_PERIOD ? getLiveMonthlyReport() : getMonthlySnapshot(period);
    load
      .then((entry) => { if (!cancelled) setReport({ status: 'ready', entry: { ...entry, live: period === LIVE_PERIOD } }); })
      .catch((err) => { if (!cancelled) handleError(err, (message) => setReport({ status: 'error', entry: null, message })); });
    return () => { cancelled = true; };
  }, [period]);

  const activeOpportunities = useMemo(() => opportunities.filter((item) => !item.archivedAt), [opportunities]);
  const outcomes = useMemo(() => summarizeOpportunityOutcomes(activeOpportunities), [activeOpportunities]);
  const types = useMemo(() => opportunityTypeBreakdown(activeOpportunities), [activeOpportunities]);
  const towerRows = useMemo(() => towers.map((tower) => ({
    id: tower.id,
    name: tower.name,
    count: activeOpportunities.filter((item) => (item.towers || []).some((relation) => relation.id === tower.id)).length,
  })), [towers, activeOpportunities]);
  const maxTowerCount = Math.max(1, ...towerRows.map((item) => item.count));
  const years = availableYears([opportunities, initiatives], currentYear, year);
  const pipeline = (filters = {}) => () => onNavigate('pipeline', { filters });

  const months = aggregates.data?.months || [];
  const maxMonthTotal = Math.max(1, ...months.map((month) => month.opportunities.total));
  const shownMonths = selectedMonth === 'all' ? months : months.filter((month) => month.period === selectedMonth);
  const totals = aggregates.data?.totals;

  return <div className="reports-page">
    <section className="report-block no-print" aria-labelledby="report-summary-title">
      <div className="report-block-heading"><h2 id="report-summary-title">Resumen actual</h2><p>Registros activos del CRM QE. Pulsa una cifra para ver el listado.</p></div>
      <div className="report-metrics">
        <MetricButton label="Oportunidades abiertas" value={outcomes.open} detail="Sin resultado registrado" onClick={pipeline({ outcome: OPEN_OUTCOME_FILTER })} />
        <MetricButton label="Oportunidades ganadas" value={outcomes.won} tone="green" onClick={pipeline({ outcome: 'won' })} />
        <MetricButton label="Oportunidades perdidas" value={outcomes.lost} tone="gray" onClick={pipeline({ outcome: 'lost' })} />
        <MetricButton label="Oportunidades descartadas" value={outcomes.discarded} tone="gray" onClick={pipeline({ outcome: 'discarded' })} />
        <MetricButton label="En propuesta" value={activeOpportunities.filter((item) => item.stage === 'proposal').length} tone="amber" detail="Etapa Propuesta / Pliego" onClick={pipeline({ stage: 'proposal' })} />
        <MetricButton label="Pipeline QE" value={formatCurrency(computePipelineQe(activeOpportunities.filter((item) => !item.outcome)))} tone="green" detail="Oportunidades abiertas" onClick={pipeline({ outcome: OPEN_OUTCOME_FILTER })} />
        <MetricButton label="Iniciativas activas" value={initiatives.filter(isActiveInitiative).length} tone="teal" detail="Sin completadas ni archivadas" onClick={() => onNavigate('initiatives')} />
        <MetricButton label="Acuerdos Marco activos" value={agreements.filter((item) => item.status === 'active').length} tone="violet" onClick={() => onNavigate('agreements')} />
      </div>
      <div className="report-split">
        <div className="panel-card">
          <h3>Oportunidades por tipo</h3>
          <ul className="report-type-list">{types.map((item) => <li key={item.id}><span className={`status-pill opportunity-type-pill ${item.tone}${item.id === MISSING_TYPE_BREAKDOWN_ID ? ' missing' : ''}`}>{item.label}</span><CellLink value={item.count} label={`Oportunidades de tipo ${item.label}`} onClick={pipeline({ opportunityType: typeFilterValue(item.id) })} /></li>)}</ul>
        </div>
        <div className="panel-card">
          <h3>Oportunidades por Tower</h3>
          <div className="bar-chart">{towerRows.map((item) => <button type="button" className="bar-row report-bar-row" key={item.id} onClick={pipeline({ towerId: item.id })} aria-label={`${item.name}: ${item.count} oportunidades. Ver listado`}><span>{item.name}</span><div className="bar-track"><i style={{ width: `${Math.max(5, (item.count / maxTowerCount) * 100)}%` }} /></div><strong>{item.count}</strong></button>)}{towerRows.length === 0 && <p className="empty-state">No hay towers registradas.</p>}</div>
        </div>
      </div>
    </section>

    <section className="report-block no-print" aria-labelledby="report-monthly-title">
      <div className="report-block-heading">
        <div><h2 id="report-monthly-title">Evolución mensual</h2><p>Oportunidades por fecha de creación; resultados por fecha estimada de cierre. Pulsa una cifra para ver el listado.</p></div>
        <div className="report-controls">
          <label className="filter-select"><span>Año</span><select value={String(year)} onChange={(event) => { setYear(Number(event.target.value)); setSelectedMonth('all'); }} aria-label="Año de la evolución mensual">{years.map((item) => <option key={item} value={String(item)}>{item}</option>)}</select></label>
          <label className="filter-select"><span>Mes</span><select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} aria-label="Mes de la evolución mensual"><option value="all">Todos los meses</option>{months.map((month) => <option key={month.period} value={month.period}>{month.label}</option>)}</select></label>
        </div>
      </div>
      {aggregates.status === 'loading' && !aggregates.data && <p className="empty-state">Cargando…</p>}
      {aggregates.status === 'error' && <p className="empty-state">{aggregates.message}</p>}
      {aggregates.data && <div className="report-table-wrap">
        <table className="report-table report-monthly-table">
          <caption className="sr-only">Indicadores por mes de {year}</caption>
          <thead><tr><th scope="col">Mes</th><th scope="col">Iniciativas trabajadas</th><th scope="col">Oportunidades generadas</th>{TYPE_COLUMNS.map(([, label]) => <th scope="col" key={label}>{label}</th>)}{reportOutcomeColumns.map(([, label]) => <th scope="col" key={label}>{label}</th>)}<th scope="col">Pipeline QE generado</th></tr></thead>
          <tbody>
            {shownMonths.map((month) => {
              const range = monthFilterRange(month.period);
              return <tr key={month.period}>
                <th scope="row">{month.label}</th>
                <td><CellLink value={month.initiativesWorked} label={`Iniciativas trabajadas en ${month.label}`} onClick={month.initiativesWorked ? () => onNavigate('initiatives') : null} /></td>
                <td><div className="report-bar-cell"><CellLink value={month.opportunities.total} label={`Oportunidades generadas en ${month.label}`} onClick={pipeline({ createdFrom: range.from, createdTo: range.to })} /><span className="report-inline-bar" aria-hidden="true"><i style={{ width: `${(month.opportunities.total / maxMonthTotal) * 100}%` }} /></span></div></td>
                {TYPE_COLUMNS.map(([id, label]) => <td key={id}><CellLink value={month.opportunities.byType[id]} label={`Oportunidades ${label} generadas en ${month.label}`} onClick={pipeline({ createdFrom: range.from, createdTo: range.to, opportunityType: typeFilterValue(id) })} /></td>)}
                {reportOutcomeColumns.map(([outcome, label]) => <td key={outcome}><CellLink value={month[outcome].count} label={`${label} en ${month.label}`} onClick={pipeline({ outcome, resolutionFrom: range.from, resolutionTo: range.to })} />{month[outcome].count > 0 && <small className="report-cell-amount">{formatCurrency(month[outcome].amount)}</small>}</td>)}
                <td><CellLink value={formatCurrency(month.pipelineQeGenerated)} label={`Pipeline QE generado en ${month.label}`} onClick={pipeline({ createdFrom: range.from, createdTo: range.to })} /></td>
              </tr>;
            })}
          </tbody>
          {selectedMonth === 'all' && totals && <tfoot><tr>
            <th scope="row">Total {year}</th>
            <td><CellLink value={totals.initiativesWorked} label={`Iniciativas trabajadas en ${year}`} onClick={() => onNavigate('initiatives')} /></td>
            <td><CellLink value={totals.opportunities.total} label={`Oportunidades generadas en ${year}`} onClick={pipeline({ createdFrom: `${year}-01-01`, createdTo: `${year}-12-31` })} /></td>
            {TYPE_COLUMNS.map(([id, label]) => <td key={id}><CellLink value={totals.opportunities.byType[id]} label={`Oportunidades ${label} generadas en ${year}`} onClick={pipeline({ createdFrom: `${year}-01-01`, createdTo: `${year}-12-31`, opportunityType: typeFilterValue(id) })} /></td>)}
            {reportOutcomeColumns.map(([outcome, label]) => <td key={outcome}><CellLink value={totals[outcome].count} label={`${label} en ${year}`} onClick={pipeline({ outcome, resolutionFrom: `${year}-01-01`, resolutionTo: `${year}-12-31` })} /></td>)}
            <td><CellLink value={formatCurrency(totals.pipelineQeGenerated)} label={`Pipeline QE generado en ${year}`} onClick={pipeline({ createdFrom: `${year}-01-01`, createdTo: `${year}-12-31` })} /></td>
          </tr></tfoot>}
        </table>
      </div>}
    </section>

    <section className="report-block" aria-labelledby="report-snapshot-title">
      <div className="report-block-heading no-print">
        <div><h2 id="report-snapshot-title">Informe mensual</h2><p>El día 1 de cada mes se guarda el informe completo del mes anterior y ya no cambia.</p></div>
        <div className="report-controls">
          <label className="filter-select"><span>Periodo</span><select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Periodo del informe mensual"><option value={LIVE_PERIOD}>Mes en curso (en vivo)</option>{snapshots.map((item) => <option key={item.period} value={item.period}>{item.label}</option>)}</select></label>
        </div>
      </div>
      {report.status === 'loading' && <p className="empty-state no-print">Cargando informe…</p>}
      {report.status === 'error' && <p className="empty-state no-print">{report.message}</p>}
      {report.status === 'ready' && <MonthlyReportView entry={report.entry} />}
    </section>
  </div>;
}
