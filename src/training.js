/**
 * Pure logic of People > Formación: catalog options, the training plan year filter, talent
 * certifications (matching, expiry, matrix, level and recommendation) and the training strategy
 * dashboard. Shared by the UI and by the server import (server/seed.js), so it has no imports.
 */

/** Certification categories of the catalog ("Categoría ISTQB"), in dashboard order. */
export const CERTIFICATION_CATEGORIES = ['Foundation', 'Core Advanced', 'ISTQB Specialist', 'Extras'];
/** Bucket of catalog entries whose category is not one of CERTIFICATION_CATEGORIES. */
export const OTHER_CERTIFICATION_CATEGORY = 'Otras';
export const CERTIFICATION_STATUSES = ['Obtenida', 'Pendiente'];
export const DEFAULT_CERTIFICATION_STATUS = CERTIFICATION_STATUSES[0];
/** Status shown (never stored) for an obtained certification whose validity has ended. */
export const EXPIRED_CERTIFICATION_STATUS = 'Caducada';
/** "Tipos" value of the catalog's training courses (as opposed to certifications). */
export const TRAINING_COURSE_TYPE = 'Formación';
export const NO_DATE_YEAR = 'none';
export const ALL_YEARS = 'all';

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const plain = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** True when the catalog entry is a training course ("Tipos" = Formación/Formaciones). */
export function isTrainingCourse(course) {
  return /^formaci(o|on|ones)$/.test(plain(course?.types).trim());
}

/**
 * Options of the plan's catalog select: training courses first ("Formaciones" group), then every
 * other entry ("Certificaciones y otros"), each group by name. `{ value, label, group }`.
 */
export function courseSelectOptions(courses = []) {
  const byName = (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es', { sensitivity: 'base' });
  const option = (group) => (course) => ({ value: course.id, label: course.name, group });
  return [
    ...courses.filter(isTrainingCourse).sort(byName).map(option('Formaciones')),
    ...courses.filter((course) => !isTrainingCourse(course)).sort(byName).map(option('Certificaciones y otros')),
  ];
}

/**
 * Plan fields a newly selected catalog course sets: its family and estimated hours, always (they
 * stay editable afterwards). Clearing the course ('') or an unknown id changes nothing.
 */
export function coursePlanDefaults(course) {
  if (!course) return {};
  const hours = course.estimatedHours;
  return { family: course.family || '', estimatedHours: hours === null || hours === undefined || hours === '' ? '' : String(hours).replace('.', ',') };
}

/** "Vigencia" text of a catalog entry: "No expira", "N meses" or '' when unknown. */
export function validityLabel(course) {
  if (course?.noExpiry) return 'No expira';
  const months = course?.validityMonths;
  if (months === null || months === undefined || months === '') return '';
  return Number(months) === 1 ? '1 mes' : `${months} meses`;
}

// ---------------------------------------------------------------------------
// Training plan: year of "Fecha inicio"
// ---------------------------------------------------------------------------

/** Year key of a plan row: the year of its start date, or NO_DATE_YEAR without one. */
export function planYearKey(row) {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(String(row?.startDate ?? ''));
  return match ? match[1] : NO_DATE_YEAR;
}

/**
 * Options of the plan year selector: the current year plus every start year present (newest
 * first), "Sin fecha" when some row has no start date, and "Todos". `{ value, label }`.
 */
export function planYearOptions(rows = [], currentYear) {
  const years = new Set([String(currentYear)]);
  let undated = false;
  for (const row of rows) {
    const key = planYearKey(row);
    if (key === NO_DATE_YEAR) undated = true;
    else years.add(key);
  }
  return [
    ...[...years].sort((a, b) => Number(b) - Number(a)).map((year) => ({ value: year, label: year })),
    ...(undated ? [{ value: NO_DATE_YEAR, label: 'Sin fecha' }] : []),
    { value: ALL_YEARS, label: 'Todos' },
  ];
}

/** Plan rows of the selected year key (ALL_YEARS keeps every row). */
export function filterPlanByYear(rows = [], yearKey) {
  if (!yearKey || yearKey === ALL_YEARS) return rows;
  return rows.filter((row) => planYearKey(row) === String(yearKey));
}

// ---------------------------------------------------------------------------
// Name matching (Excel import)
// ---------------------------------------------------------------------------

/** Lowercase words of a person or certification name, without accents or punctuation. */
export function nameTokens(value) {
  return plain(value).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

/**
 * Talent of a person name written in any order ("Nombre Apellidos" or "Apellido, Apellido, Nombre"),
 * accent- and case-insensitive. Same words win; otherwise the only talent whose words contain all of
 * the name's words (or the other way round), sharing at least two. null when none or ambiguous.
 */
export function matchTalentByName(name, talents = []) {
  const wanted = nameTokens(name);
  if (wanted.length === 0) return null;
  const key = [...wanted].sort().join(' ');
  const candidates = talents.map((talent) => ({ talent, tokens: nameTokens(talent.name) }));
  const exact = candidates.filter((item) => [...item.tokens].sort().join(' ') === key);
  if (exact.length === 1) return exact[0].talent;
  if (exact.length > 1) return null;
  const contains = (outer, inner) => inner.every((token) => outer.includes(token));
  const partial = candidates.filter((item) => {
    const shared = item.tokens.filter((token) => wanted.includes(token)).length;
    return shared >= 2 && (contains(item.tokens, wanted) || contains(wanted, item.tokens));
  });
  return partial.length === 1 ? partial[0].talent : null;
}

const certificationBase = (name) => nameTokens(String(name ?? '').replace(/\s*\([^)]*\)\s*$/, '')).join(' ');
const certificationCode = (name) => {
  const match = /\(([^)]+)\)\s*$/.exec(String(name ?? ''));
  return match ? nameTokens(match[1]).join(' ') : '';
};

/**
 * Catalog entry of a certification name: same words; otherwise same name without its trailing
 * "(CODE)" ("AWS Cloud Practitioner (CLF-C02)" = "AWS Cloud Practitioner"); otherwise the only
 * entry with the same code. null when none or ambiguous.
 */
export function matchCourseByName(name, courses = []) {
  const key = nameTokens(name).join(' ');
  if (!key) return null;
  const unique = (list) => (list.length === 1 ? list[0] : null);
  const exact = courses.filter((course) => nameTokens(course.name).join(' ') === key);
  if (exact.length > 0) return exact[0];
  const base = certificationBase(name);
  const byBase = unique(courses.filter((course) => certificationBase(course.name) === base));
  if (byBase) return byBase;
  const code = certificationCode(name);
  return code ? unique(courses.filter((course) => certificationCode(course.name) === code)) : null;
}

// ---------------------------------------------------------------------------
// Talent certifications
// ---------------------------------------------------------------------------

/** ISO date `months` after `isoDate` (clamped to the month's last day); '' for invalid input. */
export function addMonths(isoDate, months) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? ''));
  if (!match || !Number.isFinite(Number(months))) return '';
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1 + Number(months);
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(Number(match[3]), lastDay);
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Expiry of a talent certification from its obtained date and the catalog validity:
 * `{ kind: 'never' }` (catalog "No expira"), `{ kind: 'date', date }`, or `{ kind: 'unknown' }`
 * (no obtained date, no validity, or not obtained yet).
 */
export function certificationExpiry(record, course) {
  if (course?.noExpiry) return { kind: 'never', date: '' };
  if (record?.status !== 'Obtenida') return { kind: 'unknown', date: '' };
  const months = course?.validityMonths;
  if (months === null || months === undefined || months === '' || !record?.obtainedDate) return { kind: 'unknown', date: '' };
  const date = addMonths(record.obtainedDate, Number(months));
  return date ? { kind: 'date', date } : { kind: 'unknown', date: '' };
}

/** Text of an expiry: "No expira", the date, or ''. */
export function expiryLabel(expiry) {
  if (expiry?.kind === 'never') return 'No expira';
  if (expiry?.kind === 'date') return expiry.date;
  return '';
}

/** Stored status, or "Caducada" for an obtained certification whose expiry date is before `today`. */
export function effectiveCertificationStatus(record, course, today) {
  const expiry = certificationExpiry(record, course);
  if (record?.status === 'Obtenida' && expiry.kind === 'date' && today && expiry.date < today) return EXPIRED_CERTIFICATION_STATUS;
  return record?.status || DEFAULT_CERTIFICATION_STATUS;
}

/** Dashboard category of a catalog entry (its "Categoría ISTQB" or OTHER_CERTIFICATION_CATEGORY). */
export function certificationCategory(course) {
  const value = String(course?.istqbCategory ?? '').trim();
  const known = CERTIFICATION_CATEGORIES.find((category) => category.toLowerCase() === value.toLowerCase());
  return known || OTHER_CERTIFICATION_CATEGORY;
}

/** "Nivel actual" of a talent (sheet "04. Roadmap Certificaciones"). */
export function certificationLevel(counts) {
  if ((counts['Core Advanced'] || 0) >= 2) return 'Advanced+';
  if ((counts['Core Advanced'] || 0) >= 1) return 'Core Advanced';
  if ((counts.Foundation || 0) >= 1) return 'Foundation';
  return 'Sin Foundation';
}

/** "Recomendación" of a talent (sheet "04. Roadmap Certificaciones"). */
export function certificationRecommendation(counts) {
  if (!(counts.Foundation > 0)) return 'Obtener ISTQB Foundation';
  if (!(counts['Core Advanced'] > 0)) return 'Priorizar CTAL-TA / CTAL-TM / CTAL-TAE según rol';
  if (!(counts.Extras > 0)) return 'Complementar con Cloud / IA / DevOps / Security';
  return 'Perfil referente / especialización por proyecto';
}

const emptyCounts = () => ({ ...Object.fromEntries([...CERTIFICATION_CATEGORIES, OTHER_CERTIFICATION_CATEGORY].map((category) => [category, 0])), pending: 0, total: 0 });

/**
 * Talents × certifications matrix. `columns`: the catalog entries used by some record, by
 * category order then name, each with its `category`. `rows`: one per talent with records,
 * `{ talentId, talentName, cells: { [courseId]: { record, status, expiry } }, counts, level,
 * recommendation }`; counts hold obtained (not expired) certifications per category, `pending` and
 * `total`. Rows are ranked by total, then Core Advanced, then name.
 */
export function buildCertificationMatrix(records = [], courses = [], today = '') {
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const order = [...CERTIFICATION_CATEGORIES, OTHER_CERTIFICATION_CATEGORY];
  const usedIds = new Set(records.map((record) => record.courseId));
  const columns = courses.filter((course) => usedIds.has(course.id))
    .map((course) => ({ ...course, category: certificationCategory(course) }))
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || String(a.name).localeCompare(String(b.name), 'es', { sensitivity: 'base' }));
  const rows = new Map();
  for (const record of records) {
    if (!rows.has(record.talentId)) rows.set(record.talentId, { talentId: record.talentId, talentName: record.talentName || '', cells: {}, counts: emptyCounts() });
    const row = rows.get(record.talentId);
    const course = courseById.get(record.courseId);
    const status = effectiveCertificationStatus(record, course, today);
    row.cells[record.courseId] = { record, status, expiry: certificationExpiry(record, course) };
    if (status === 'Pendiente') row.counts.pending += 1;
    else if (status === 'Obtenida') {
      row.counts[certificationCategory(course)] += 1;
      row.counts.total += 1;
    }
  }
  const ranked = [...rows.values()].map((row) => ({ ...row, level: certificationLevel(row.counts), recommendation: certificationRecommendation(row.counts) }))
    .sort((a, b) => b.counts.total - a.counts.total || b.counts['Core Advanced'] - a.counts['Core Advanced'] || a.talentName.localeCompare(b.talentName, 'es', { sensitivity: 'base' }));
  return { columns, rows: ranked };
}

/**
 * Live figures of "09. Datos KPIs": people with certification records, obtained and pending
 * totals, and `byCategory` [{ category, obtained, pending }] for CERTIFICATION_CATEGORIES (other
 * catalog categories count in the totals only). Obtained = stored status "Obtenida".
 */
export function summarizeCertifications(records = [], courses = []) {
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const byCategory = new Map(CERTIFICATION_CATEGORIES.map((category) => [category, { category, obtained: 0, pending: 0 }]));
  let obtained = 0;
  let pending = 0;
  for (const record of records) {
    const bucket = byCategory.get(certificationCategory(courseById.get(record.courseId)));
    if (record.status === 'Pendiente') { pending += 1; if (bucket) bucket.pending += 1; }
    else if (record.status === 'Obtenida') { obtained += 1; if (bucket) bucket.obtained += 1; }
  }
  return { people: new Set(records.map((record) => record.talentId)).size, obtained, pending, byCategory: [...byCategory.values()] };
}

// ---------------------------------------------------------------------------
// Training strategy
// ---------------------------------------------------------------------------

const amount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

/** Investment lines with their `amount` (unit price × vouchers) and the `total`. */
export function investmentSummary(lines = []) {
  const rows = lines.map((line) => ({ ...line, amount: Math.round(amount(line.unitPrice) * amount(line.vouchers) * 100) / 100 }));
  return { rows, total: rows.reduce((sum, row) => sum + row.amount, 0) };
}

/**
 * "Actual vs objetivo" rows: one per CERTIFICATION_CATEGORIES category plus any other stored
 * target, `{ category, actual, target, gap }` (target null when not set; gap = max(target - actual, 0)).
 */
export function strategyTargets(strategy, summary) {
  const targets = new Map((strategy?.categoryTargets || []).map((item) => [String(item.category), item.target]));
  const actual = new Map((summary?.byCategory || []).map((item) => [item.category, item.obtained]));
  const categories = [...CERTIFICATION_CATEGORIES, ...[...targets.keys()].filter((category) => !CERTIFICATION_CATEGORIES.includes(category))];
  return categories.map((category) => {
    const raw = targets.get(category);
    const target = raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
    const current = actual.get(category) || 0;
    return { category, actual: current, target, gap: target === null ? null : Math.max(target - current, 0) };
  });
}

/** Training plan figures of a year (by "Fecha inicio"): rows, people and estimated hours. */
export function planYearSummary(planRows = [], year) {
  const rows = filterPlanByYear(planRows, String(year));
  return {
    rows: rows.length,
    people: new Set(rows.map((row) => row.talentId)).size,
    estimatedHours: rows.reduce((sum, row) => sum + amount(row.estimatedHours), 0),
  };
}

// ---------------------------------------------------------------------------
// Form validation
// ---------------------------------------------------------------------------

const blank = (value) => String(value ?? '').trim() === '';
const toNumber = (value) => {
  if (blank(value)) return null;
  const normalized = String(value).trim().replace(/\./g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
};

export const CERTIFICATION_FORM_FIELDS = ['talentId', 'courseId', 'status', 'obtainedDate', 'obtainedYear', 'notes'];

export function validateCertificationForm(form) {
  const errors = {};
  if (blank(form.talentId)) errors.talentId = 'Selecciona el talento.';
  if (blank(form.courseId)) errors.courseId = 'Selecciona la certificación del catálogo.';
  const year = toNumber(form.obtainedYear);
  if (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) errors.obtainedYear = 'El año debe ser un número entero entre 2000 y 2100.';
  return errors;
}

export const STRATEGY_FORM_FIELDS = ['year', 'title', 'businessCase', 'investmentLines', 'investmentNote', 'categoryTargets', 'strategicAxes', 'conclusions'];

/**
 * Strategy dialog: year (2000-2100, not used by another strategy) and numeric line values. Errors
 * of a line are keyed `<list>.<index>.<field>`.
 */
export function validateStrategyForm(form, { usedYears = [] } = {}) {
  const errors = {};
  const year = toNumber(form.year);
  if (year === null) errors.year = 'Indica el año.';
  else if (!Number.isInteger(year) || year < 2000 || year > 2100) errors.year = 'El año debe ser un número entero entre 2000 y 2100.';
  else if (usedYears.map(Number).includes(year)) errors.year = 'Ya existe una estrategia para ese año.';
  const numeric = (list, field, label) => (form[list] || []).forEach((item, index) => {
    const value = toNumber(item?.[field]);
    if (value !== null && (Number.isNaN(value) || value < 0)) errors[`${list}.${index}.${field}`] = `${label} debe ser un número positivo.`;
  });
  numeric('investmentLines', 'unitPrice', 'El precio');
  numeric('investmentLines', 'vouchers', 'Los vouchers');
  numeric('categoryTargets', 'target', 'El objetivo');
  const required = (list, field, label) => (form[list] || []).forEach((item, index) => {
    const hasValues = Object.values(item || {}).some((value) => !blank(value));
    if (hasValues && blank(item?.[field])) errors[`${list}.${index}.${field}`] = `Indica ${label}.`;
  });
  required('businessCase', 'concept', 'el concepto');
  required('investmentLines', 'line', 'la línea');
  required('categoryTargets', 'category', 'la categoría');
  required('strategicAxes', 'axis', 'el eje');
  return errors;
}
