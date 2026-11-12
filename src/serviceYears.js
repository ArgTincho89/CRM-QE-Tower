// Services are organized by fiscal year ("ejercicio"). Only active services of the current
// year can be newly assigned; links to other years or inactive services are kept as they are.

/** Sorted, de-duplicated list of year numbers from `[{ year }]` records or plain numbers. */
export function yearNumbers(years = []) {
  return [...new Set(years.map((item) => (typeof item === 'number' ? item : item?.year)).filter(Number.isInteger))].sort((a, b) => a - b);
}

/** The year shown by default: the current one when it exists, otherwise the latest, otherwise null. */
export function defaultServiceYear(years, currentYear) {
  const list = yearNumbers(years);
  if (list.includes(currentYear)) return currentYear;
  return list.length > 0 ? list[list.length - 1] : null;
}

/** The closest existing year before `year`, or null. */
export function previousServiceYear(years, year) {
  const earlier = yearNumbers(years).filter((item) => item < year);
  return earlier.length > 0 ? earlier[earlier.length - 1] : null;
}

/** Suggested year for "Nuevo ejercicio": the current one if missing, else the year after the latest. */
export function suggestNewServiceYear(years, currentYear) {
  const list = yearNumbers(years);
  if (!list.includes(currentYear)) return currentYear;
  return list[list.length - 1] + 1;
}

export function servicesOfYear(services = [], year) {
  return services.filter((item) => item.year === year);
}

/** Service label that names the year whenever it is not the current one: "QA Automation (2025)". */
export function serviceLabel(service, currentYear) {
  return Number.isInteger(service?.year) && service.year !== currentYear ? `${service.name} (${service.year})` : service?.name ?? '';
}

/**
 * Options for the services MultiSelect: every service of the current year (inactive ones stay
 * disabled), plus the already selected services of other years, labelled with their year and
 * flagged non-assignable so they can be removed but never added again.
 */
export function buildServiceOptions(services = [], selected = [], currentYear) {
  const current = services.filter((item) => item.year === currentYear);
  const otherYears = selected
    .map((id) => services.find((item) => item.id === id))
    .filter((item) => item && item.year !== currentYear)
    .map((item) => ({ ...item, name: serviceLabel(item, currentYear), assignable: false }));
  return [...current, ...otherYears];
}

/** Services that may be newly assigned: active and of the current year. */
export function isAssignableService(service, currentYear) {
  return Boolean(service) && service.active !== false && service.year === currentYear;
}
