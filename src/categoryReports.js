// Pure aggregations of the "Informes" category tabs (Iniciativas, Acuerdos Marco, People,
// Formación, Proyectos). Every function takes plain records and returns plain rows, so the page
// only renders them. Dates are ISO calendar dates ('YYYY-MM-DD').
import { COMPLETED_INITIATIVE_STAGE, initiativeCategories, initiativePriorities, initiativeStages, initiativeStatuses } from './data.js';
import {
  CLOSED_DELIVERY_PROJECT_STATUS, DELIVERY_PROJECT_STATUSES, DELIVERY_TARGETS, NAQ_LEVELS, PLAN_STATUS_DEFAULTS, PROJECT_TYPES, TALENT_PROFILES,
  computeAvailability, isAssignmentActive, talentAvailability,
} from './people.js';

export const EMPTY_LABEL = 'Sin informar';
const DAY_MS = 86400000;

/**
 * Counts per label: `[{ label, count }]`. Labels in `order` come first in that order (zero counts
 * included when `keepEmpty`), then any other label by count (desc) and name; blank values count
 * under EMPTY_LABEL, last. `keyOf` may return an array to count an item under several labels.
 */
export function countBy(items, keyOf, { order = [], keepEmpty = true } = {}) {
  const counts = new Map();
  for (const item of items || []) {
    const raw = keyOf(item);
    const keys = Array.isArray(raw) ? raw : [raw];
    const labels = keys.map((key) => String(key ?? '').trim()).filter(Boolean);
    for (const label of labels.length ? [...new Set(labels)] : [EMPTY_LABEL]) counts.set(label, (counts.get(label) || 0) + 1);
  }
  const ordered = order.filter((label) => keepEmpty || counts.has(label)).map((label) => ({ label, count: counts.get(label) || 0 }));
  const known = new Set(order);
  const rest = [...counts].filter(([label]) => !known.has(label) && label !== EMPTY_LABEL)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es'));
  const empty = counts.has(EMPTY_LABEL) && !known.has(EMPTY_LABEL) ? [{ label: EMPTY_LABEL, count: counts.get(EMPTY_LABEL) }] : [];
  return [...ordered, ...rest, ...empty];
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (value) => ISO_DATE.test(String(value ?? '').trim());
const toNumber = (value) => (value === null || value === undefined || value === '' ? 0 : Number(value) || 0);
const round2 = (value) => Math.round(value * 100) / 100;

/**
 * "Iniciativas": non-archived initiatives by stage (Completada included), and the active ones
 * (not completed) by category, priority and operational status.
 */
export function summarizeInitiativeReport(initiatives = []) {
  const current = (initiatives || []).filter((item) => item && !item.archivedAt);
  const active = current.filter((item) => item.stage !== COMPLETED_INITIATIVE_STAGE);
  const stageLabel = Object.fromEntries(initiativeStages.map((stage) => [stage.id, stage.label]));
  const statusLabel = Object.fromEntries(initiativeStatuses.map((status) => [status.id, status.label]));
  return {
    total: current.length,
    active: active.length,
    completed: current.length - active.length,
    byStage: countBy(current, (item) => stageLabel[item.stage] || item.stage, { order: initiativeStages.map((stage) => stage.label) }),
    byCategory: countBy(active, (item) => item.category, { order: initiativeCategories }),
    byPriority: countBy(active, (item) => item.priority || 'Media', { order: initiativePriorities }),
    byStatus: countBy(active, (item) => statusLabel[item.operationalStatus || 'active'] || item.operationalStatus, { order: initiativeStatuses.map((status) => status.label) }),
  };
}

/**
 * "Acuerdos Marco": active agreements, their amount, the split by client and the ones whose end
 * date falls between today and `horizonDays` later (soonest first).
 */
export function summarizeAgreementReport(agreements = [], clients = [], today, { horizonDays = 90 } = {}) {
  const clientName = new Map((clients || []).map((client) => [client.id, client.name]));
  const active = (agreements || []).filter((item) => item && !item.archivedAt && (!item.status || item.status === 'active'));
  const byClientMap = new Map();
  for (const item of active) {
    const name = clientName.get(item.clientId) || item.clientName || 'Sin cliente';
    const entry = byClientMap.get(name) || { client: name, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount = round2(entry.amount + toNumber(item.amount));
    byClientMap.set(name, entry);
  }
  const upcoming = active
    .filter((item) => isIsoDate(item.endDate) && item.endDate >= today && daysBetween(today, item.endDate) <= horizonDays)
    .map((item) => ({ id: item.id, title: item.title || '', client: clientName.get(item.clientId) || item.clientName || 'Sin cliente', endDate: item.endDate, daysLeft: daysBetween(today, item.endDate), amount: toNumber(item.amount) }))
    .sort((a, b) => a.endDate.localeCompare(b.endDate) || a.id.localeCompare(b.id));
  return {
    active: active.length,
    amount: round2(active.reduce((sum, item) => sum + toNumber(item.amount), 0)),
    expired: active.filter((item) => isIsoDate(item.endDate) && item.endDate < today).length,
    horizonDays,
    byClient: [...byClientMap.values()].sort((a, b) => b.count - a.count || b.amount - a.amount || a.client.localeCompare(b.client, 'es')),
    upcoming,
  };
}

/** Availability buckets of the People report, by the share of the talent that is free today. */
export const AVAILABILITY_BUCKETS = [
  { id: 'none', label: 'Sin disponibilidad (0 % o menos)', test: (value) => value < 1 },
  { id: 'low', label: 'Disponibilidad baja (1–49 %)', test: (value) => value >= 1 && value < 50 },
  { id: 'medium', label: 'Disponibilidad media (50–99 %)', test: (value) => value >= 50 && value < 100 },
  { id: 'full', label: 'Totalmente disponible (100 %)', test: (value) => value >= 100 },
];

/**
 * "People": talents by main tower and by profile, availability buckets on `today` and the
 * assignments that end between today and `horizonDays` later.
 */
export function summarizePeopleReport(talents = [], assignments = [], today, { horizonDays = 30 } = {}) {
  const list = (talents || []).filter(Boolean);
  const availability = computeAvailability(assignments || [], today);
  const values = list.map((talent) => talentAvailability(availability, talent.id));
  const endingSoon = (assignments || [])
    .filter((item) => item && isIsoDate(item.endDate) && isAssignmentActive(item, today) && daysBetween(today, item.endDate) <= horizonDays)
    .map((item) => ({ id: item.id, talentName: item.talentName || '', project: item.clientName || item.towerName || item.lobName || '—', percentage: toNumber(item.percentage), endDate: item.endDate, daysLeft: daysBetween(today, item.endDate) }))
    .sort((a, b) => a.endDate.localeCompare(b.endDate) || a.talentName.localeCompare(b.talentName, 'es'));
  return {
    total: list.length,
    available: values.filter((value) => value >= 1).length,
    byTower: countBy(list, (talent) => talent.primaryTowerName || (talent.towerNames || [])[0]),
    byProfile: countBy(list, (talent) => talent.profiles || [], { order: TALENT_PROFILES }),
    availability: AVAILABILITY_BUCKETS.map((bucket) => ({ id: bucket.id, label: bucket.label, count: values.filter(bucket.test).length })),
    horizonDays,
    endingSoon,
  };
}

/** Year of a training plan row: its start date, else the planned end, else the actual end. */
export function planRowYear(row) {
  const date = [row?.startDate, row?.plannedEndDate, row?.actualEndDate].find(isIsoDate);
  return date ? Number(date.slice(0, 4)) : null;
}

/**
 * "Formación": plan rows by status, and per year (newest first, "Sin fecha" last) the rows,
 * the completed ones and the estimated and dedicated hours.
 */
export function summarizeTrainingReport(plan = []) {
  const rows = (plan || []).filter(Boolean);
  const years = new Map();
  for (const row of rows) {
    const year = planRowYear(row);
    const key = year === null ? 'none' : year;
    const entry = years.get(key) || { year, label: year === null ? 'Sin fecha' : String(year), rows: 0, completed: 0, estimatedHours: 0, dedicatedHours: 0 };
    entry.rows += 1;
    if (String(row.status || '').trim().toLowerCase() === 'completada') entry.completed += 1;
    entry.estimatedHours = round2(entry.estimatedHours + toNumber(row.estimatedHours));
    entry.dedicatedHours = round2(entry.dedicatedHours + toNumber(row.dedicatedHours));
    years.set(key, entry);
  }
  return {
    total: rows.length,
    estimatedHours: round2(rows.reduce((sum, row) => sum + toNumber(row.estimatedHours), 0)),
    dedicatedHours: round2(rows.reduce((sum, row) => sum + toNumber(row.dedicatedHours), 0)),
    byStatus: countBy(rows, (row) => row.status, { order: PLAN_STATUS_DEFAULTS }),
    byYear: [...years.values()].sort((a, b) => (a.year === null) - (b.year === null) || (b.year ?? 0) - (a.year ?? 0)),
  };
}

/**
 * "Proyectos": the NAQ portfolio by project type, NAQ and delivery target, and the delivery
 * projects by status (with how many are open).
 */
export function summarizeProjectReport(portfolio = [], deliveryProjects = []) {
  const apps = (portfolio || []).filter(Boolean);
  const projects = (deliveryProjects || []).filter(Boolean);
  return {
    applications: apps.length,
    byType: countBy(apps, (item) => item.projectType, { order: PROJECT_TYPES, keepEmpty: false }),
    byNaq: countBy(apps, (item) => item.naq, { order: NAQ_LEVELS }),
    byDeliveryTarget: countBy(apps, (item) => item.deliveryTarget, { order: DELIVERY_TARGETS }),
    projects: projects.length,
    openProjects: projects.filter((item) => item.status !== CLOSED_DELIVERY_PROJECT_STATUS).length,
    byProjectStatus: countBy(projects, (item) => item.status, { order: DELIVERY_PROJECT_STATUSES }),
  };
}
