// Monthly reporting for "Informes": per-month aggregates of a year and the monthly report, both
// built from one in-memory dataset so the live report and the stored snapshots share one builder.
//
// Period rules (documented here because every number depends on them):
// - A period is a calendar month 'YYYY-MM'. Timestamps (`created_at`, event times) are stored as
//   ISO UTC strings and are attributed to the month of their literal 'YYYY-MM' prefix.
// - Archived opportunities and initiatives are left out of every metric, as in the CRM QE KPIs.
// - Won / lost / discarded are dated by the opportunity's `expected_close_date`: the Resultado
//   stage cannot be saved without it, so every closed opportunity has one and the user keeps it
//   aligned with the real close. History events only record which fields changed, never the
//   outcome value, so they cannot date a result reliably. Legacy closed rows without the date fall
//   back to `updated_at`.
// - An initiative is "worked" in a month when it was created, or has any history event, comment,
//   record action (created or completed) or action comment in that month.
import { initiativeStages, opportunityOutcomes, opportunityTypes } from '../src/data.js';
import { parseAmount } from '../src/money.js';
import { withTransaction } from './db.js';

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const SPANISH_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const OUTCOME_IDS = opportunityOutcomes.map((outcome) => outcome.id);
const COMPLETED_STAGES = new Set(['completed', 'won']);
const MISSING_TYPE_ID = 'none';
const MISSING_TYPE_LABEL = 'Sin tipo';
const NO_CLIENT_LABEL = 'Sin cliente';
/** Horizon (days after the month end) of the "agreements ending soon" list. */
export const AGREEMENT_ENDING_HORIZON_DAYS = 90;
export const TOP_CLIENTS_LIMIT = 5;

export function isValidPeriod(value) {
  return typeof value === 'string' && PERIOD_PATTERN.test(value);
}

/** 'YYYY-MM' of an ISO date or timestamp, or '' when it has none. */
export function periodOf(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const period = text.slice(0, 7);
  return isValidPeriod(period) ? period : '';
}

/** Period of the month that contains the Date (UTC, matching how timestamps are stored). */
export function currentPeriod(now) {
  return now.toISOString().slice(0, 7);
}

export function shiftPeriod(period, months) {
  const [, year, month] = PERIOD_PATTERN.exec(period);
  const date = new Date(Date.UTC(Number(year), Number(month) - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Inclusive list of periods from `from` to `to` (empty when `from` is later). */
export function periodRange(from, to) {
  const periods = [];
  for (let period = from; period <= to; period = shiftPeriod(period, 1)) periods.push(period);
  return periods;
}

/** First and last ISO date of a period. */
export function periodBounds(period) {
  const [, year, month] = PERIOD_PATTERN.exec(period);
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(last).padStart(2, '0')}` };
}

/** "Noviembre 2026". */
export function periodLabel(period) {
  const [, year, month] = PERIOD_PATTERN.exec(period);
  const name = SPANISH_MONTHS[Number(month) - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

function addDaysIso(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function parseDetail(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Reads everything the report builders need in a handful of queries. */
export function loadReportDataset(db) {
  return {
    opportunities: db.prepare(
      `SELECT o.id, o.title, o.amount, o.qa_percent, o.probability, o.stage, o.outcome, o.expected_close_date,
              o.opportunity_type, o.created_at, o.updated_at, o.archived_at,
              COALESCE(c.name, NULLIF(o.account, '')) AS client_name
         FROM opportunities o LEFT JOIN clients c ON c.id = o.client_id`,
    ).all(),
    initiatives: db.prepare('SELECT id, title, stage, created_at, archived_at FROM initiatives').all(),
    agreements: db.prepare(
      `SELECT a.id, a.title, a.end_date, a.status, a.amount, a.created_at, c.name AS client_name
         FROM framework_agreements a LEFT JOIN clients c ON c.id = a.client_id`,
    ).all(),
    events: db.prepare('SELECT entity_type, entity_id, user_name, action, detail, created_at FROM entity_events').all(),
    comments: db.prepare('SELECT entity_type, entity_id, user_name, created_at FROM entity_comments').all(),
    actions: db.prepare('SELECT entity_type, entity_id, user_name, created_at, completed_at FROM record_actions').all(),
    actionComments: db.prepare(
      `SELECT a.entity_type, a.entity_id, c.user_name, c.created_at
         FROM record_action_comments c JOIN record_actions a ON a.id = c.action_id`,
    ).all(),
    assignments: db.prepare(
      `SELECT COALESCE(u.name, '') AS user_name, n.created_at
         FROM notifications n LEFT JOIN users u ON u.id = n.user_id
        WHERE n.kind = 'assignment'`,
    ).all(),
  };
}

function typeId(opportunity) {
  return opportunityTypes.some((type) => type.id === opportunity.opportunity_type) ? opportunity.opportunity_type : MISSING_TYPE_ID;
}

function typeLabel(id) {
  return opportunityTypes.find((type) => type.id === id)?.label ?? MISSING_TYPE_LABEL;
}

function amountOf(opportunity) {
  return parseAmount(opportunity.amount);
}

function qeAmountOf(opportunity) {
  return (amountOf(opportunity) * (Number(opportunity.qa_percent) || 0)) / 100;
}

function weightedAmountOf(opportunity) {
  if (opportunity.probability === null || opportunity.probability === undefined) return null;
  return (qeAmountOf(opportunity) * Number(opportunity.probability)) / 100;
}

/** Close date of a closed opportunity (see the period rules above), or '' when still open. */
export function opportunityCloseDate(opportunity) {
  if (!opportunity.outcome) return '';
  return (opportunity.expected_close_date || '').slice(0, 10) || (opportunity.updated_at || '').slice(0, 10);
}

function activeOpportunities(dataset) {
  return (dataset.opportunities || []).filter((item) => !item.archived_at);
}

function activeInitiatives(dataset) {
  return (dataset.initiatives || []).filter((item) => !item.archived_at);
}

/** Map of period to the Set of initiative ids worked in it (see the period rules above). */
export function initiativeActivityByPeriod(dataset) {
  const ids = new Set(activeInitiatives(dataset).map((item) => item.id));
  const byPeriod = new Map();
  const mark = (id, timestamp) => {
    const period = periodOf(timestamp);
    if (!period || !ids.has(id)) return;
    if (!byPeriod.has(period)) byPeriod.set(period, new Set());
    byPeriod.get(period).add(id);
  };
  for (const item of activeInitiatives(dataset)) mark(item.id, item.created_at);
  for (const list of [dataset.events, dataset.comments, dataset.actions, dataset.actionComments]) {
    for (const row of list || []) {
      if (row.entity_type !== 'initiative') continue;
      mark(row.entity_id, row.created_at);
      if (row.completed_at) mark(row.entity_id, row.completed_at);
    }
  }
  return byPeriod;
}

/**
 * When a completed initiative was completed: its latest history event that changed the stage
 * (a conversion or an edit of `stage`), or its creation when it never moved.
 */
function initiativeCompletedAt(dataset, initiative) {
  let latest = '';
  for (const event of dataset.events || []) {
    if (event.entity_type !== 'initiative' || event.entity_id !== initiative.id) continue;
    const detail = parseDetail(event.detail);
    const changesStage = event.action === 'converted' || (event.action === 'updated' && Array.isArray(detail.fields) && detail.fields.includes('stage'));
    if (changesStage && event.created_at > latest) latest = event.created_at;
  }
  return latest || initiative.created_at;
}

function initiativeItem(initiative) {
  return {
    id: initiative.id,
    title: initiative.title,
    stage: initiative.stage,
    stageLabel: initiativeStages.find((stage) => stage.id === initiative.stage)?.label ?? (initiative.stage === 'won' ? 'Completada' : initiative.stage),
  };
}

function opportunityItem(opportunity) {
  const type = typeId(opportunity);
  return {
    id: opportunity.id,
    title: opportunity.title,
    client: opportunity.client_name || NO_CLIENT_LABEL,
    type,
    typeLabel: typeLabel(type),
    amount: round2(amountOf(opportunity)),
    qeAmount: round2(qeAmountOf(opportunity)),
    closeDate: opportunityCloseDate(opportunity),
  };
}

function sumBy(items, key) {
  return round2(items.reduce((total, item) => total + item[key], 0));
}

function typeBreakdown(items) {
  const ids = [...opportunityTypes.map((type) => type.id), MISSING_TYPE_ID];
  return ids.map((id) => {
    const ofType = items.filter((item) => item.type === id);
    return { id, label: typeLabel(id), count: ofType.length, amount: sumBy(ofType, 'amount'), qeAmount: sumBy(ofType, 'qeAmount') };
  });
}

function opportunitiesCreatedIn(dataset, period) {
  return activeOpportunities(dataset).filter((item) => periodOf(item.created_at) === period);
}

function resultsIn(dataset, period) {
  const results = {};
  for (const outcome of OUTCOME_IDS) {
    const items = activeOpportunities(dataset)
      .filter((item) => item.outcome === outcome && periodOf(opportunityCloseDate(item)) === period)
      .map(opportunityItem);
    results[outcome] = { count: items.length, amount: sumBy(items, 'amount'), qeAmount: sumBy(items, 'qeAmount'), items };
  }
  return results;
}

/** Open pipeline at the end of the period: created by then and not closed by then. */
function pipelineAtPeriodEnd(dataset, period) {
  const { end } = periodBounds(period);
  const open = activeOpportunities(dataset).filter((item) => {
    const created = periodOf(item.created_at);
    if (!created || created > period) return false;
    const closed = opportunityCloseDate(item);
    return !closed || closed > end;
  });
  let weighted = null;
  for (const item of open) {
    const value = weightedAmountOf(item);
    if (value !== null) weighted = (weighted ?? 0) + value;
  }
  return { count: open.length, qeAmount: round2(open.reduce((total, item) => total + qeAmountOf(item), 0)), weightedAmount: weighted === null ? null : round2(weighted) };
}

function countByUser(rows, period) {
  const counts = new Map();
  for (const row of rows || []) {
    if (periodOf(row.created_at) !== period) continue;
    const name = row.user_name || 'Sistema';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function activityByUser(dataset, period) {
  const comments = countByUser(dataset.comments, period);
  const actionRows = [...(dataset.actions || []), ...(dataset.actionComments || [])];
  const actions = countByUser(actionRows, period);
  const events = countByUser(dataset.events, period);
  const names = new Set([...comments.keys(), ...actions.keys(), ...events.keys()]);
  return [...names].map((userName) => {
    const row = { userName, comments: comments.get(userName) ?? 0, actions: actions.get(userName) ?? 0, events: events.get(userName) ?? 0 };
    return { ...row, total: row.comments + row.actions + row.events };
  }).sort((a, b) => b.total - a.total || a.userName.localeCompare(b.userName, 'es'));
}

function topClients(items) {
  const byClient = new Map();
  for (const item of items) {
    const entry = byClient.get(item.client) ?? { client: item.client, count: 0, amount: 0, qeAmount: 0 };
    entry.count += 1;
    entry.amount += item.amount;
    entry.qeAmount += item.qeAmount;
    byClient.set(item.client, entry);
  }
  return [...byClient.values()]
    .map((entry) => ({ ...entry, amount: round2(entry.amount), qeAmount: round2(entry.qeAmount) }))
    .sort((a, b) => b.amount - a.amount || a.client.localeCompare(b.client, 'es'))
    .slice(0, TOP_CLIENTS_LIMIT);
}

function agreementItem(agreement) {
  return { id: agreement.id, title: agreement.title, client: agreement.client_name || '', endDate: agreement.end_date || '', amount: round2(Number(agreement.amount) || 0) };
}

/**
 * The monthly report of `period`. `generatedAt` is the ISO time it was built; `live` marks the
 * computed report of the month in progress (never stored).
 */
export function buildMonthlyReport(dataset, period, { generatedAt, live = false } = {}) {
  if (!isValidPeriod(period)) throw new RangeError(`Invalid report period: ${period}`);
  const { end } = periodBounds(period);
  const worked = initiativeActivityByPeriod(dataset).get(period) ?? new Set();
  const initiatives = activeInitiatives(dataset).sort((a, b) => a.id.localeCompare(b.id));
  const createdOpportunities = opportunitiesCreatedIn(dataset, period).map(opportunityItem).sort((a, b) => a.id.localeCompare(b.id));
  const endingLimit = addDaysIso(end, AGREEMENT_ENDING_HORIZON_DAYS);

  return {
    period,
    label: periodLabel(period),
    generatedAt,
    live,
    initiatives: {
      worked: initiatives.filter((item) => worked.has(item.id)).map(initiativeItem),
      created: initiatives.filter((item) => periodOf(item.created_at) === period).map(initiativeItem),
      completed: initiatives
        .filter((item) => COMPLETED_STAGES.has(item.stage) && periodOf(initiativeCompletedAt(dataset, item)) === period)
        .map(initiativeItem),
    },
    opportunities: {
      created: {
        count: createdOpportunities.length,
        amount: sumBy(createdOpportunities, 'amount'),
        qeAmount: sumBy(createdOpportunities, 'qeAmount'),
        byType: typeBreakdown(createdOpportunities),
        items: createdOpportunities,
      },
      results: resultsIn(dataset, period),
    },
    pipeline: pipelineAtPeriodEnd(dataset, period),
    agreements: {
      created: (dataset.agreements || []).filter((item) => periodOf(item.created_at) === period).map(agreementItem),
      endingSoon: (dataset.agreements || [])
        .filter((item) => item.status === 'active' && item.end_date && item.end_date > end && item.end_date <= endingLimit)
        .map(agreementItem)
        .sort((a, b) => a.endDate.localeCompare(b.endDate) || a.id.localeCompare(b.id)),
      horizonDays: AGREEMENT_ENDING_HORIZON_DAYS,
    },
    activity: activityByUser(dataset, period),
    topClients: topClients(createdOpportunities),
    assignments: [...countByUser(dataset.assignments, period)]
      .map(([userName, count]) => ({ userName, count }))
      .sort((a, b) => b.count - a.count || a.userName.localeCompare(b.userName, 'es')),
  };
}

function emptyResult() {
  return { count: 0, amount: 0, qeAmount: 0 };
}

/** Per-month aggregates of a calendar year (12 rows) plus the year totals. */
export function buildYearAggregates(dataset, year) {
  const activity = initiativeActivityByPeriod(dataset);
  const typeIds = [...opportunityTypes.map((type) => type.id), MISSING_TYPE_ID];
  const months = Array.from({ length: 12 }, (_, index) => {
    const period = `${year}-${String(index + 1).padStart(2, '0')}`;
    const created = opportunitiesCreatedIn(dataset, period).map(opportunityItem);
    const results = resultsIn(dataset, period);
    const byType = Object.fromEntries(typeIds.map((id) => [id, created.filter((item) => item.type === id).length]));
    const row = {
      period,
      label: periodLabel(period),
      initiativesWorked: activity.get(period)?.size ?? 0,
      opportunities: { total: created.length, byType },
      pipelineQeGenerated: sumBy(created, 'qeAmount'),
    };
    for (const outcome of OUTCOME_IDS) {
      const { count, amount, qeAmount } = results[outcome];
      row[outcome] = { count, amount, qeAmount };
    }
    return row;
  });

  const totals = {
    // Distinct initiatives worked at any time of the year, not the sum of the months.
    initiativesWorked: new Set(months.flatMap((month) => [...(activity.get(month.period) ?? [])])).size,
    opportunities: { total: 0, byType: Object.fromEntries(typeIds.map((id) => [id, 0])) },
    pipelineQeGenerated: 0,
    ...Object.fromEntries(OUTCOME_IDS.map((outcome) => [outcome, emptyResult()])),
  };
  for (const month of months) {
    totals.opportunities.total += month.opportunities.total;
    for (const id of typeIds) totals.opportunities.byType[id] += month.opportunities.byType[id];
    totals.pipelineQeGenerated = round2(totals.pipelineQeGenerated + month.pipelineQeGenerated);
    for (const outcome of OUTCOME_IDS) {
      totals[outcome].count += month[outcome].count;
      totals[outcome].amount = round2(totals[outcome].amount + month[outcome].amount);
      totals[outcome].qeAmount = round2(totals[outcome].qeAmount + month[outcome].qeAmount);
    }
  }
  return { year, months, totals };
}

/** Period of the oldest commercial record or history event, or '' on an empty database. */
function earliestPeriod(db) {
  const row = db.prepare(
    `SELECT MIN(created_at) AS earliest FROM (
       SELECT created_at FROM opportunities
       UNION ALL SELECT created_at FROM initiatives
       UNION ALL SELECT created_at FROM framework_agreements
       UNION ALL SELECT created_at FROM entity_events
     )`,
  ).get();
  return periodOf(row?.earliest ?? '');
}

/**
 * Stores the snapshot of every fully elapsed month (from the month of the earliest record up to
 * the month before `now`) that has none yet, and returns the periods it created. Idempotent and
 * lazy: the app machine auto-stops, so there is no cron; it runs at startup and before the report
 * endpoints answer. A snapshot is written once and never regenerated, so later edits never change
 * it. It reflects the data as it was when generated, normally on the first request of the month.
 */
export function ensureMonthlyReports(db, now = new Date()) {
  const earliest = earliestPeriod(db);
  if (!earliest) return [];
  const last = shiftPeriod(currentPeriod(now), -1);
  const existing = new Set(db.prepare('SELECT period FROM monthly_reports').all().map((row) => row.period));
  const missing = periodRange(earliest, last).filter((period) => !existing.has(period));
  if (missing.length === 0) return [];
  const generatedAt = now.toISOString();
  const dataset = loadReportDataset(db);
  const insert = db.prepare('INSERT OR IGNORE INTO monthly_reports (period, generated_at, data) VALUES (?, ?, ?)');
  withTransaction(db, () => {
    for (const period of missing) insert.run(period, generatedAt, JSON.stringify(buildMonthlyReport(dataset, period, { generatedAt })));
  });
  return missing;
}

/** Stored snapshots, newest first. */
export function listMonthlyReports(db) {
  return db.prepare('SELECT period, generated_at FROM monthly_reports ORDER BY period DESC').all()
    .map((row) => ({ period: row.period, label: periodLabel(row.period), generatedAt: row.generated_at }));
}

/** The stored report of a period, or null when there is none. */
export function getMonthlyReport(db, period) {
  const row = db.prepare('SELECT period, generated_at, data FROM monthly_reports WHERE period = ?').get(period);
  if (!row) return null;
  return { period: row.period, generatedAt: row.generated_at, report: JSON.parse(row.data) };
}
