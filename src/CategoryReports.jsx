import { useMemo } from 'react';
import { listOperationRecords } from './api.js';
import { toLocalIsoDate } from './calendar.js';
import { summarizeAgreementReport, summarizeInitiativeReport, summarizePeopleReport, summarizeProjectReport, summarizeTrainingReport } from './categoryReports.js';
import { formatCurrency } from './money.js';
import { formatNumber, useCollection } from './OperationsUi.jsx';

/** Category tabs of "Informes": read-only summaries computed in the browser from existing data. */

function Figures({ items }) {
  return <div className="report-figures">{items.map(([label, value, detail]) => <div key={label}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>)}</div>;
}

/** Horizontal bars of `[{ label, count }]`. */
function CountBars({ title, rows, empty = 'Sin datos.' }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <div className="panel-card">
    <h3>{title}</h3>
    {rows.length === 0
      ? <p className="report-empty">{empty}</p>
      : <div className="bar-chart bar-chart-wide">{rows.map((row) => <div className="bar-row" key={row.label}>
        <span>{row.label}</span>
        <div className="bar-track" aria-hidden="true"><i style={{ width: `${row.count === 0 ? 0 : Math.max(5, (row.count / max) * 100)}%` }} /></div>
        <strong>{row.count}</strong>
      </div>)}</div>}
  </div>;
}

function Table({ caption, headers, rows, empty = 'Sin registros.' }) {
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

function ReportBlock({ id, title, description, children }) {
  return <section className="report-block" aria-labelledby={id}>
    <div className="report-block-heading"><div><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div></div>
    {children}
  </section>;
}

/** Loading / error state of the collections a report needs; null when every one is ready. */
function loadState(collections) {
  const failed = collections.find((item) => item.error);
  if (failed) return <p className="empty-state">{failed.error}</p>;
  if (collections.some((item) => item.loading)) return <p className="empty-state" role="status">Cargando…</p>;
  return null;
}

const hours = (value) => formatNumber(value, { suffix: ' h' }) || '0 h';

export function InitiativesReport({ initiatives }) {
  const summary = useMemo(() => summarizeInitiativeReport(initiatives), [initiatives]);
  return <ReportBlock id="report-initiatives-title" title="Iniciativas" description="Iniciativas no archivadas. Categoría, prioridad y estado operativo cuentan solo las activas (sin completadas).">
    <Figures items={[['Iniciativas', summary.total], ['Activas', summary.active], ['Completadas', summary.completed]]} />
    <div className="report-columns-2">
      <CountBars title="Por etapa" rows={summary.byStage} />
      <CountBars title="Por prioridad" rows={summary.byPriority} />
      <CountBars title="Por categoría" rows={summary.byCategory} />
      <CountBars title="Por estado operativo" rows={summary.byStatus} />
    </div>
  </ReportBlock>;
}

export function AgreementsReport({ agreements, clients }) {
  const today = toLocalIsoDate(new Date());
  const summary = useMemo(() => summarizeAgreementReport(agreements, clients, today), [agreements, clients, today]);
  return <ReportBlock id="report-agreements-title" title="Acuerdos Marco" description="Acuerdos marco activos, su reparto por cliente y los que vencen pronto.">
    <Figures items={[['Activos', summary.active], ['Importe activo', formatCurrency(summary.amount)], [`Vencen en ${summary.horizonDays} días`, summary.upcoming.length], ['Activos ya vencidos', summary.expired, 'Fin de vigencia pasada']]} />
    <Table caption="Por cliente" headers={['Cliente', 'Acuerdos', 'Importe']} rows={summary.byClient.map((item) => [item.client, item.count, formatCurrency(item.amount)])} />
    <Table caption={`Próximos fines de vigencia (${summary.horizonDays} días)`} headers={['ID', 'Acuerdo', 'Cliente', 'Fin de vigencia', 'Días', 'Importe']}
      rows={summary.upcoming.map((item) => [item.id, item.title, item.client, item.endDate, item.daysLeft, formatCurrency(item.amount)])} empty="Ningún acuerdo activo vence en ese plazo." />
  </ReportBlock>;
}

export function PeopleReport({ onUnauthorized }) {
  const talents = useCollection(() => listOperationRecords('talents'), { onUnauthorized });
  const assignments = useCollection(() => listOperationRecords('assignments'), { onUnauthorized });
  const today = toLocalIsoDate(new Date());
  const summary = useMemo(() => summarizePeopleReport(talents.records, assignments.records, today), [talents.records, assignments.records, today]);
  const state = loadState([talents, assignments]);
  return <ReportBlock id="report-people-title" title="People" description="Talentos por tower principal y perfil, disponibilidad de hoy y asignaciones que terminan pronto.">
    {state || <>
      <Figures items={[['Talentos', summary.total], ['Con disponibilidad', summary.available, 'Al menos 1 % libre hoy'], [`Asignaciones que terminan en ${summary.horizonDays} días`, summary.endingSoon.length]]} />
      <div className="report-columns-2">
        <CountBars title="Por tower principal" rows={summary.byTower} />
        <CountBars title="Por perfil" rows={summary.byProfile} />
        <CountBars title="Disponibilidad hoy" rows={summary.availability} />
      </div>
      <Table caption={`Asignaciones que terminan en los próximos ${summary.horizonDays} días`} headers={['Talento', 'Proyecto', '% asignación', 'Fecha fin', 'Días']}
        rows={summary.endingSoon.map((item) => [item.talentName, item.project, formatNumber(item.percentage, { suffix: ' %' }), item.endDate, item.daysLeft])} empty="Ninguna asignación termina en ese plazo." />
    </>}
  </ReportBlock>;
}

export function TrainingReport({ onUnauthorized }) {
  const plan = useCollection(() => listOperationRecords('training-plan'), { onUnauthorized });
  const summary = useMemo(() => summarizeTrainingReport(plan.records), [plan.records]);
  const state = loadState([plan]);
  return <ReportBlock id="report-training-title" title="Formación" description="Plan de formación por estado y por año (fecha de inicio, o la de fin prevista o real si falta).">
    {state || <>
      <Figures items={[['Filas del plan', summary.total], ['Horas estimadas', hours(summary.estimatedHours)], ['Horas dedicadas', hours(summary.dedicatedHours)]]} />
      <div className="report-columns-2">
        <CountBars title="Por estado" rows={summary.byStatus} />
      </div>
      <Table caption="Por año" headers={['Año', 'Filas', 'Completadas', 'Horas estimadas', 'Horas dedicadas']}
        rows={summary.byYear.map((item) => [item.label, item.rows, item.completed, hours(item.estimatedHours), hours(item.dedicatedHours)])} />
    </>}
  </ReportBlock>;
}

export function ProjectsReport({ onUnauthorized }) {
  const portfolio = useCollection(() => listOperationRecords('projects'), { onUnauthorized });
  const delivery = useCollection(() => listOperationRecords('delivery-projects'), { onUnauthorized });
  const summary = useMemo(() => summarizeProjectReport(portfolio.records, delivery.records), [portfolio.records, delivery.records]);
  const state = loadState([portfolio, delivery]);
  return <ReportBlock id="report-projects-title" title="Proyectos" description="Portfolio NAQ por tipo de proyecto, NAQ y delivery target; proyectos por estado.">
    {state || <>
      <Figures items={[['Aplicaciones NAQ', summary.applications], ['Proyectos', summary.projects], ['Proyectos abiertos', summary.openProjects, 'Sin cerrar']]} />
      <div className="report-columns-2">
        <CountBars title="NAQ por tipo de proyecto" rows={summary.byType} />
        <CountBars title="NAQ por nivel" rows={summary.byNaq} />
        <CountBars title="NAQ por delivery target" rows={summary.byDeliveryTarget} />
        <CountBars title="Proyectos por estado" rows={summary.byProjectStatus} />
      </div>
    </>}
  </ReportBlock>;
}
