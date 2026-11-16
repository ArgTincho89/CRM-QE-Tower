// "People" and "Proyectos" catalogs shared by the API validation and the UI. No imports on
// purpose: the server runtime image copies this file alone (see the Dockerfile).

export const TALENT_CATEGORIES = ['QA Tester', 'QA Engineer', 'QA Otros'];
export const TALENT_PROFILES = ['Funcional', 'No funcional', 'Ambos'];

/** Skill proficiency ("Nivel actual" / "Nivel objetivo"), stored as 1..4. */
export const SKILL_LEVELS = [
  { value: 1, label: '1. Lo conoce' },
  { value: 2, label: '2. Trabaja con apoyo' },
  { value: 3, label: '3. Autónomo' },
  { value: 4, label: '4. Es la referencia' },
];

/** Career levels of the activity catalog columns (L1..L7); "Nivel" of a talent skill row. */
export const CAREER_LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'];

export const PLAN_STATUS_DEFAULTS = ['No iniciada', 'En curso', 'Completada'];

/** Generic testing scopes offered in the project dialog, merged with the values already stored. */
export const TESTING_SCOPE_DEFAULTS = ['Functional', 'API', 'E2E', 'Regression', 'Performance', 'Security', 'Accessibility', 'Mobile'];

export const ASSIGNMENT_LIMIT = 100;

export function skillLevelLabel(value) {
  return SKILL_LEVELS.find((level) => level.value === Number(value))?.label || '';
}

const REQUIRED_SYMBOL = '✅';
const OPTIONAL_SYMBOL = '⚪';

/**
 * Classifies one activity catalog cell: ✅ → required, ⚪ → optional, empty → not applicable,
 * any other text (e.g. "Lidera") → text, shown as is.
 */
export function describeMatrixCell(raw) {
  const value = String(raw ?? '').trim();
  if (value === '') return { kind: 'none', symbol: '', label: 'No aplica' };
  if (value.includes(REQUIRED_SYMBOL)) return { kind: 'required', symbol: REQUIRED_SYMBOL, label: 'Requerido' };
  if (value.includes(OPTIONAL_SYMBOL)) return { kind: 'optional', symbol: OPTIONAL_SYMBOL, label: 'Opcional' };
  return { kind: 'text', symbol: value, label: value };
}

/** Rows of the activities × L1..L7 matrix, each cell already classified. */
export function buildActivityMatrix(activities = []) {
  return activities.map((activity) => ({
    id: activity.id,
    name: activity.name || '',
    category: activity.category || '',
    cells: CAREER_LEVELS.map((level) => ({ level, ...describeMatrixCell(activity.levels?.[level]) })),
  }));
}

/** Sum of the assignment percentages per talent id. */
export function computeAssignmentTotals(assignments = []) {
  const totals = new Map();
  for (const item of assignments) {
    const value = Number(item.percentage);
    if (!item.talentId || !Number.isFinite(value)) continue;
    totals.set(item.talentId, Math.round(((totals.get(item.talentId) || 0) + value) * 100) / 100);
  }
  return totals;
}

/** Talents whose total assignment is above 100 %: `[{ talentId, talentName, total }]`. */
export function overAllocatedTalents(assignments = []) {
  const totals = computeAssignmentTotals(assignments);
  const names = new Map(assignments.map((item) => [item.talentId, item.talentName || '']));
  return [...totals].filter(([, total]) => total > ASSIGNMENT_LIMIT).map(([talentId, total]) => ({ talentId, talentName: names.get(talentId) || '', total }));
}

/** Defaults first, then every other distinct non-empty value (string or array items) in record order. */
export function mergeOptions(defaults = [], values = []) {
  const seen = new Set();
  const result = [];
  for (const raw of [...defaults, ...values.flat()]) {
    const value = String(raw ?? '').trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    result.push(value);
  }
  return result;
}

/** Case- and accent-insensitive text search over the given record fields (functions or keys). */
export function filterRecords(records = [], query = '', fields = []) {
  const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const needle = normalize(query).trim();
  if (!needle) return records;
  return records.filter((record) => fields.some((field) => {
    const value = typeof field === 'function' ? field(record) : record[field];
    return normalize(Array.isArray(value) ? value.join(' ') : value).includes(needle);
  }));
}

/** Returns the URL when it is safe to open in a new tab (http or https only), otherwise ''. */
export function safeExternalUrl(url) {
  const value = String(url || '').trim();
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

/** Testing scope from a JSON array string, an array or a comma/semicolon separated string. */
export function parseTestingScope(value) {
  if (Array.isArray(value)) return mergeOptions([], value);
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return mergeOptions([], parsed.map((item) => String(item ?? '')));
    } catch {
      // Fall through to the separated-list reading.
    }
  }
  return mergeOptions([], raw.replace(/^\[|\]$/g, '').split(/[,;]/).map((item) => item.replace(/^\s*"|"\s*$/g, '')));
}

const isBlank = (value) => String(value ?? '').trim() === '';
const toNumber = (value) => {
  const raw = String(value ?? '').trim().replace(/\s|%/g, '');
  if (raw === '') return null;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
};
function numberError(value, { min = 0, max = Infinity, required = false, label }) {
  const number = toNumber(value);
  if (number === null) return required ? `Indica ${label}.` : '';
  if (Number.isNaN(number)) return `${label[0].toUpperCase()}${label.slice(1)} debe ser un número.`;
  if (number < min || number > max) return `${label[0].toUpperCase()}${label.slice(1)} debe estar entre ${min} y ${max}.`;
  return '';
}

export const TALENT_FORM_FIELDS = ['name', 'location', 'category', 'profile', 'lobIds', 'towerIds', 'primaryTowerId'];
/** Fields of the create dialog: the name is composed from these, so `name` is not a form field. */
export const TALENT_CREATE_FORM_FIELDS = ['firstName', 'lastName', 'secondLastName', 'location', 'category', 'profile', 'lobIds', 'towerIds', 'primaryTowerId'];
export const SKILL_FORM_FIELDS = ['talentId', 'activityId', 'currentLevel', 'targetLevel', 'careerLevel', 'certificate', 'comment'];
export const ASSIGNMENT_FORM_FIELDS = ['talentId', 'towerId', 'lobId', 'clientId', 'percentage'];
export const COURSE_FORM_FIELDS = ['name', 'family', 'istqbCategory', 'types', 'provider', 'level', 'estimatedHours', 'url', 'validityMonths'];
export const PLAN_FORM_FIELDS = ['talentId', 'task', 'courseId', 'courseName', 'family', 'estimatedHours', 'dedicatedHours', 'progress', 'status', 'startDate', 'plannedEndDate', 'actualEndDate', 'evidence', 'nextStep', 'expiryDate'];
export const PROJECT_FORM_FIELDS = ['code', 'applicationName', 'version', 'client', 'naq', 'projectType', 'deliveryTarget', 'testingScope', 'qaServiceType', 'phase', 'riskLevel', 'automation', 'status', 'projectUrl', 'qaOwner', 'qaEntryDate', 'targetReleaseDate', 'createdDate', 'attachments', 'comments'];

/**
 * Main tower after the talent's tower list changes: kept while still selected, otherwise the
 * only tower when there is exactly one, otherwise '' (the user must pick it).
 */
export function syncPrimaryTower(towerIds = [], primaryTowerId = '') {
  if (primaryTowerId && towerIds.includes(primaryTowerId)) return primaryTowerId;
  return towerIds.length === 1 ? towerIds[0] : '';
}

export function validateTalentForm(form) {
  const errors = {};
  if (isBlank(form.name)) errors.name = 'Indica el nombre del talento.';
  const towerIds = form.towerIds || [];
  if (towerIds.length > 0 && isBlank(form.primaryTowerId)) errors.primaryTowerId = 'Selecciona la Tower principal entre las towers del talento.';
  else if (!isBlank(form.primaryTowerId) && !towerIds.includes(form.primaryTowerId)) errors.primaryTowerId = 'La Tower principal debe ser una de las towers del talento.';
  return errors;
}

/**
 * Display name stored in `talents.name`: "Primer apellido, Segundo apellido, Nombre".
 * Missing parts are skipped, so a talent with only surnames still gets a readable name.
 */
export function composeTalentName({ firstName = '', lastName = '', secondLastName = '' } = {}) {
  const first = String(firstName ?? '').trim();
  const surnames = [lastName, secondLastName].map((value) => String(value ?? '').trim()).filter(Boolean).join(', ');
  if (surnames && first) return `${surnames}, ${first}`;
  return surnames || first;
}

/** Create-only validation: first name, first surname and second surname, plus the shared talent rules. */
export function validateTalentCreateForm(form) {
  const errors = {};
  if (isBlank(form.firstName)) errors.firstName = 'Indica el nombre.';
  if (isBlank(form.lastName)) errors.lastName = 'Indica el primer apellido.';
  if (isBlank(form.secondLastName)) errors.secondLastName = 'Indica el segundo apellido.';
  // The composed name error is redundant with the three fields above.
  const talentErrors = validateTalentForm({ ...form, name: composeTalentName(form) });
  delete talentErrors.name;
  return { ...errors, ...talentErrors };
}

export function validateSkillForm(form) {
  const errors = {};
  if (isBlank(form.talentId)) errors.talentId = 'Selecciona la persona.';
  if (isBlank(form.activityId)) errors.activityId = 'Selecciona la actividad.';
  if (isBlank(form.currentLevel)) errors.currentLevel = 'Selecciona el nivel actual.';
  return errors;
}

export function validateAssignmentForm(form) {
  const errors = {};
  if (isBlank(form.talentId)) errors.talentId = 'Selecciona el talento.';
  const percentage = numberError(form.percentage, { min: 0, max: 100, required: true, label: 'el % de asignación' });
  if (percentage) errors.percentage = percentage;
  return errors;
}

export function validateCourseForm(form) {
  const errors = {};
  if (isBlank(form.name)) errors.name = 'Indica el nombre de la formación.';
  const hours = numberError(form.estimatedHours, { min: 0, max: 100000, label: 'las horas estimadas' });
  if (hours) errors.estimatedHours = hours;
  if (!isBlank(form.url) && !safeExternalUrl(form.url)) errors.url = 'El enlace debe empezar por http:// o https://.';
  const validity = numberError(form.validityMonths, { min: 0, max: 600, label: 'la vigencia en meses' });
  if (validity) errors.validityMonths = validity;
  else if (!isBlank(form.validityMonths) && !Number.isInteger(toNumber(form.validityMonths))) errors.validityMonths = 'La vigencia debe ser un número entero de meses.';
  return errors;
}

export function validatePlanForm(form) {
  const errors = {};
  if (isBlank(form.talentId)) errors.talentId = 'Selecciona la persona.';
  if (isBlank(form.courseId) && isBlank(form.courseName)) errors.courseName = 'Selecciona un curso del catálogo o escribe su nombre.';
  for (const [field, label] of [['estimatedHours', 'las horas estimadas'], ['dedicatedHours', 'las horas dedicadas']]) {
    const error = numberError(form[field], { min: 0, max: 100000, label });
    if (error) errors[field] = error;
  }
  const progress = numberError(form.progress, { min: 0, max: 1000, label: 'el avance' });
  if (progress) errors.progress = progress;
  return errors;
}

export function validateProjectForm(form) {
  const errors = {};
  if (isBlank(form.applicationName)) errors.applicationName = 'Indica el nombre de la aplicación.';
  if (!isBlank(form.projectUrl) && !safeExternalUrl(form.projectUrl)) errors.projectUrl = 'La URL debe empezar por http:// o https://.';
  return errors;
}
