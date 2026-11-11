function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Options matching the search text (accent- and case-insensitive). Empty query returns all. */
export function filterOptions(options, query) {
  const needle = normalize(query);
  if (!needle) return options;
  return options.filter((option) => normalize(option.name).includes(needle));
}

/**
 * Inactive options keep existing links but cannot be newly assigned.
 * An option is selectable when it is active or already selected (so it can be removed).
 */
export function isAssignable(option, selected) {
  return option.active !== false || selected.includes(option.id);
}

export function toggleSelection(selected, option) {
  if (selected.includes(option.id)) return selected.filter((id) => id !== option.id);
  if (option.active === false) return selected;
  return [...selected, option.id];
}

export function removeSelection(selected, id) {
  return selected.filter((item) => item !== id);
}

/** Selected options in selection order; unknown ids are skipped. */
export function selectedOptions(options, selected) {
  return selected.map((id) => options.find((option) => option.id === id)).filter(Boolean);
}
