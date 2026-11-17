// "People" and "Proyectos" catalogs shared by the API validation and the UI. No imports on
// purpose: the server runtime image copies this file alone (see the Dockerfile).

export const TALENT_CATEGORIES = ['QA Tester', 'QA Engineer', 'QA Otros'];
/** "Perfil" of a talent: multi-select, stored as a JSON array in `talents.profile`. */
export const TALENT_PROFILES = ['Funcional', 'No funcional', 'Automatización'];
/** Retired single-choice value that meant both functional profiles. */
export const LEGACY_BOTH_PROFILE = 'Ambos';

/** Status of a performance review objective. */
export const PERFORMANCE_STATUSES = ['Pendiente', 'Cumplido', 'No cumplido'];
export const DEFAULT_PERFORMANCE_STATUS = PERFORMANCE_STATUSES[0];

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

/** "Tipo de proyecto" of the NAQ portfolio: the project typologies of the Quality Gates model. */
export const PROJECT_TYPES = [
  'Nuevo desarrollo', 'Mantenimiento evolutivo', 'Mantenimiento correctivo', 'Hotfix / Emergencia (QG-Exprés)',
  'Transformación / migración', 'Integraciones / APIs / datos', 'Producto digital / canal usuario', 'Paquetizado (SAP / Salesforce)',
  'Producto de mercado', 'IA / ML / GenAI', 'Data & Analytics / BI', 'Infraestructura / DevOps / Cloud', 'RPA / Automatización',
  'Ciberseguridad', 'Consultoría',
];
/** NAQ level of a portfolio application. */
export const NAQ_LEVELS = ['Bajo', 'Medio', 'Alto'];
/** Delivery target of a portfolio application. */
export const DELIVERY_TARGETS = ['Tradicional', 'Integrado', 'Continuo'];

const LEGACY_NAQ = { low: 'Bajo', medium: 'Medio', high: 'Alto' };
const LEGACY_DELIVERY_TARGETS = { traditional: 'Tradicional', integrated: 'Integrado', continuous: 'Continuo', continuos: 'Continuo' };

/** Matches a value against the canonical list (case-insensitive) or its legacy English synonym; else keeps it trimmed. */
function normalizeChoice(value, canonical, legacy) {
  const raw = String(value ?? '').trim();
  const key = raw.toLowerCase();
  return canonical.find((item) => item.toLowerCase() === key) || legacy[key] || raw;
}

/** NAQ in Spanish: 'Low' → 'Bajo', 'medio' → 'Medio'; unknown values are kept. */
export function normalizeNaq(value) {
  return normalizeChoice(value, NAQ_LEVELS, LEGACY_NAQ);
}

/** Delivery target in Spanish: 'Integrated' → 'Integrado', 'Continuos' → 'Continuo'; unknown values are kept. */
export function normalizeDeliveryTarget(value) {
  return normalizeChoice(value, DELIVERY_TARGETS, LEGACY_DELIVERY_TARGETS);
}

/** Status of a delivery project ("Proyectos" tab); 'Cerrado' hides it from the calendar. */
export const DELIVERY_PROJECT_STATUSES = ['Planificado', 'En curso', 'En pausa', 'Cerrado'];
export const DEFAULT_DELIVERY_PROJECT_STATUS = DELIVERY_PROJECT_STATUSES[0];
export const CLOSED_DELIVERY_PROJECT_STATUS = 'Cerrado';

/**
 * Talent profiles from what may be stored or sent: an array, a JSON array string or a legacy
 * single value ('Ambos' = Funcional + No funcional). Unknown values are dropped and the result
 * follows the TALENT_PROFILES order without duplicates.
 */
export function parseTalentProfiles(value) {
  let items = [];
  if (Array.isArray(value)) items = value;
  else {
    const raw = String(value ?? '').trim();
    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        items = Array.isArray(parsed) ? parsed : [];
      } catch {
        items = [];
      }
    } else if (raw) items = [raw];
  }
  const wanted = new Set();
  for (const item of items) {
    const text = String(item ?? '').trim();
    if (text === LEGACY_BOTH_PROFILE) {
      wanted.add('Funcional');
      wanted.add('No funcional');
    } else wanted.add(text);
  }
  return TALENT_PROFILES.filter((profile) => wanted.has(profile));
}

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

/** Career levels (L1..L7) an activity has configured: the non-empty cells of its catalog row. */
export function configuredCareerLevels(activity) {
  if (!activity) return [];
  return CAREER_LEVELS.filter((level) => String(activity.levels?.[level] ?? activity[level.toLowerCase()] ?? '').trim() !== '');
}

/** An assignment is active on `today` (ISO date) when start ≤ today ≤ end; a missing date is open. */
export function isAssignmentActive(assignment, today) {
  const start = String(assignment?.startDate ?? '').trim();
  const end = String(assignment?.endDate ?? '').trim();
  if (start && start > today) return false;
  if (end && end < today) return false;
  return true;
}

/**
 * Availability per talent id on `today`: 100 minus the summed percentage of the assignments active
 * that day. Talents without active assignments are not in the map (see talentAvailability).
 */
export function computeAvailability(assignments = [], today) {
  const active = (assignments || []).filter((item) => isAssignmentActive(item, today));
  const totals = computeAssignmentTotals(active);
  return new Map([...totals].map(([talentId, total]) => [talentId, Math.round((ASSIGNMENT_LIMIT - total) * 100) / 100]));
}

/** Availability of one talent from a computeAvailability map (100 when nothing is active). */
export function talentAvailability(availability, talentId) {
  return availability.has(talentId) ? availability.get(talentId) : ASSIGNMENT_LIMIT;
}

/** "Disponible": the talent has between 1 % and 100 % free right now. */
export function isAvailable(value) {
  return Number.isFinite(value) && value >= 1 && value <= ASSIGNMENT_LIMIT;
}

/** What best identifies an assignment's project: client, else tower, else LoB. */
export function assignmentProjectLabel(assignment) {
  return assignment?.clientName || assignment?.towerName || assignment?.lobName || 'sin proyecto';
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

export const TALENT_FORM_FIELDS = ['name', 'location', 'category', 'profiles', 'lobIds', 'towerIds', 'primaryTowerId'];
/** Fields of the create dialog: the name is composed from these, so `name` is not a form field. */
export const TALENT_CREATE_FORM_FIELDS = ['firstName', 'lastName', 'secondLastName', 'location', 'category', 'profiles', 'lobIds', 'towerIds', 'primaryTowerId'];
export const SKILL_FORM_FIELDS = ['talentId', 'activityId', 'currentLevel', 'targetLevel', 'careerLevel', 'certificate', 'comment'];
export const ASSIGNMENT_FORM_FIELDS = ['talentId', 'towerId', 'lobId', 'clientId', 'percentage', 'startDate', 'endDate'];
export const ACTIVITY_FORM_FIELDS = ['name', 'category', ...CAREER_LEVELS.map((level) => level.toLowerCase())];
export const PERFORMANCE_FORM_FIELDS = ['talentId', 'year', 'objective', 'status', 'linkTitle', 'linkUrl', 'notes'];
export const PERFORMANCE_MAX_OBJECTIVES = 50;
export const COURSE_FORM_FIELDS = ['name', 'family', 'istqbCategory', 'types', 'provider', 'level', 'estimatedHours', 'url', 'validityMonths', 'noExpiry', 'approxPrice', 'description'];
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

/** `allowedCareerLevels` (optional) are the "Nivel" values the selected activity accepts. */
export function validateSkillForm(form, { allowedCareerLevels = null } = {}) {
  const errors = {};
  if (isBlank(form.talentId)) errors.talentId = 'Selecciona la persona.';
  if (isBlank(form.activityId)) errors.activityId = 'Selecciona la actividad.';
  if (isBlank(form.currentLevel)) errors.currentLevel = 'Selecciona el nivel actual.';
  if (!isBlank(form.careerLevel) && allowedCareerLevels && !allowedCareerLevels.includes(form.careerLevel)) {
    errors.careerLevel = 'Ese nivel no está configurado para la actividad seleccionada.';
  }
  return errors;
}

export function validateAssignmentForm(form) {
  const errors = {};
  if (isBlank(form.talentId)) errors.talentId = 'Selecciona el talento.';
  const percentage = numberError(form.percentage, { min: 0, max: 100, required: true, label: 'el % de asignación' });
  if (percentage) errors.percentage = percentage;
  if (!isBlank(form.startDate) && !isBlank(form.endDate) && form.endDate < form.startDate) {
    errors.endDate = 'La fecha fin no puede ser anterior a la fecha inicio.';
  }
  return errors;
}

export function validateActivityForm(form) {
  const errors = {};
  if (isBlank(form.name)) errors.name = 'Indica el nombre de la actividad.';
  return errors;
}

function yearError(value) {
  const year = toNumber(value);
  if (year === null) return 'Indica el año.';
  if (Number.isNaN(year) || !Number.isInteger(year) || year < 2000 || year > 2100) return 'El año debe ser un número entero entre 2000 y 2100.';
  return '';
}

/** One performance review objective (edit dialog). */
export function validatePerformanceForm(form) {
  const errors = {};
  if (isBlank(form.talentId)) errors.talentId = 'Selecciona el talento.';
  const year = yearError(form.year);
  if (year) errors.year = year;
  if (isBlank(form.objective)) errors.objective = 'Indica el objetivo.';
  if (!isBlank(form.linkUrl) && !safeExternalUrl(form.linkUrl)) errors.linkUrl = 'El enlace debe empezar por http:// o https://.';
  return errors;
}

/**
 * Create dialog: one talent and year plus a list of objectives. Errors of an objective are keyed
 * `objectives.<index>.<field>`.
 */
export function validatePerformanceCreateForm(form) {
  const errors = {};
  if (isBlank(form.talentId)) errors.talentId = 'Selecciona el talento.';
  const year = yearError(form.year);
  if (year) errors.year = year;
  const objectives = form.objectives || [];
  if (objectives.length === 0) errors.objectives = 'Añade al menos un objetivo.';
  else if (objectives.length > PERFORMANCE_MAX_OBJECTIVES) errors.objectives = `Como máximo ${PERFORMANCE_MAX_OBJECTIVES} objetivos a la vez.`;
  objectives.forEach((item, index) => {
    if (isBlank(item.objective)) errors[`objectives.${index}.objective`] = 'Indica el objetivo.';
    if (!isBlank(item.linkUrl) && !safeExternalUrl(item.linkUrl)) errors[`objectives.${index}.linkUrl`] = 'El enlace debe empezar por http:// o https://.';
  });
  return errors;
}

/** Years offered by the performance review filter: the current one plus every stored year, newest first. */
export function performanceYears(records = [], currentYear) {
  const years = new Set([Number(currentYear)]);
  for (const record of records) {
    const year = Number(record?.year);
    if (record?.year !== null && record?.year !== '' && Number.isInteger(year)) years.add(year);
  }
  return [...years].filter(Number.isFinite).sort((a, b) => b - a);
}

export function validateCourseForm(form) {
  const errors = {};
  if (isBlank(form.name)) errors.name = 'Indica el nombre de la formación.';
  const hours = numberError(form.estimatedHours, { min: 0, max: 100000, label: 'las horas estimadas' });
  if (hours) errors.estimatedHours = hours;
  if (!isBlank(form.url) && !safeExternalUrl(form.url)) errors.url = 'El enlace debe empezar por http:// o https://.';
  // "No expira" disables (and clears) the validity, so it is not validated then.
  if (!form.noExpiry) {
    const validity = numberError(form.validityMonths, { min: 0, max: 600, label: 'la vigencia en meses' });
    if (validity) errors.validityMonths = validity;
    else if (!isBlank(form.validityMonths) && !Number.isInteger(toNumber(form.validityMonths))) errors.validityMonths = 'La vigencia debe ser un número entero de meses.';
  }
  const price = numberError(form.approxPrice, { min: 0, max: 10000000, label: 'el precio aproximado' });
  if (price) errors.approxPrice = price;
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

export const DELIVERY_PROJECT_FORM_FIELDS = ['name', 'clientId', 'towerId', 'talentId', 'status', 'startDate', 'endDate', 'description', 'nextMilestoneDate', 'nextMilestone', 'nextActionDate', 'links'];

export function validateDeliveryProjectForm(form) {
  const errors = {};
  if (isBlank(form.name)) errors.name = 'Indica el nombre del proyecto.';
  if (isBlank(form.clientId)) errors.clientId = 'Selecciona el cliente.';
  if (!isBlank(form.startDate) && !isBlank(form.endDate) && form.endDate < form.startDate) {
    errors.endDate = 'La fecha fin no puede ser anterior a la fecha inicio.';
  }
  return errors;
}

export function validateProjectForm(form) {
  const errors = {};
  if (isBlank(form.applicationName)) errors.applicationName = 'Indica el nombre de la aplicación.';
  if (!isBlank(form.projectUrl) && !safeExternalUrl(form.projectUrl)) errors.projectUrl = 'La URL debe empezar por http:// o https://.';
  return errors;
}
