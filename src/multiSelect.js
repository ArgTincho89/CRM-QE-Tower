function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Options matching the search text (accent- and case-insensitive). Empty query returns all. */
export function filterOptions(options, query) {
  const needle = normalize(query);
  if (!needle) return options;
  return options.filter((option) => normalize(option.name).includes(needle));
}

/** Inactive options, or options flagged `assignable: false`, cannot be newly assigned. */
function canAssignNew(option) {
  return option.active !== false && option.assignable !== false;
}

/**
 * Inactive or non-assignable options keep existing links but cannot be newly assigned.
 * An option is selectable when it can be assigned or is already selected (so it can be removed).
 */
export function isAssignable(option, selected) {
  return canAssignNew(option) || selected.includes(option.id);
}

export function toggleSelection(selected, option) {
  if (selected.includes(option.id)) return selected.filter((id) => id !== option.id);
  if (!canAssignNew(option)) return selected;
  return [...selected, option.id];
}

export function removeSelection(selected, id) {
  return selected.filter((item) => item !== id);
}

/** Selected options in selection order; unknown ids are skipped. */
export function selectedOptions(options, selected) {
  return selected.map((id) => options.find((option) => option.id === id)).filter(Boolean);
}

/**
 * Index of the next option the keyboard can land on, skipping options that cannot be toggled
 * (`isAssignable` false). `direction` is 1 (down) or -1 (up) and wraps around; from -1 it starts
 * at the first (down) or last (up) enabled option. Returns -1 when nothing is enabled.
 */
export function nextEnabledIndex(options, selected, currentIndex, direction) {
  const total = options.length;
  if (total === 0) return -1;
  let index = currentIndex;
  for (let step = 0; step < total; step += 1) {
    if (index < 0 || index >= total) index = direction > 0 ? 0 : total - 1;
    else index = (index + direction + total) % total;
    if (isAssignable(options[index], selected)) return index;
  }
  return -1;
}

/** First (`edge` 'start') or last (`edge` 'end') enabled option index, or -1. */
export function edgeEnabledIndex(options, selected, edge) {
  return nextEnabledIndex(options, selected, -1, edge === 'end' ? -1 : 1);
}

/**
 * Keyboard state machine of the dropdown multi-select. `state` is `{ open, activeIndex }`;
 * `options` are the visible (filtered) options. Returns the next state plus `toggle` (the option
 * whose selection must flip, or null) and `handled` (whether the key belongs to the widget, so
 * the caller prevents the browser default). Enter toggles and keeps the popover open; Escape
 * closes it; Tab is left to the browser (the caller closes the popover when focus leaves the widget).
 */
export function reduceDropdownKey(state, key, { options = [], selected = [] } = {}) {
  const { open, activeIndex } = state;
  const unchanged = { open, activeIndex, toggle: null, handled: false };
  if (!open) {
    if (key === 'ArrowDown' || key === 'Enter' || key === ' ') {
      return { open: true, activeIndex: edgeEnabledIndex(options, selected, 'start'), toggle: null, handled: true };
    }
    if (key === 'ArrowUp') return { open: true, activeIndex: edgeEnabledIndex(options, selected, 'end'), toggle: null, handled: true };
    return unchanged;
  }
  switch (key) {
    case 'ArrowDown':
      return { open, activeIndex: nextEnabledIndex(options, selected, activeIndex, 1), toggle: null, handled: true };
    case 'ArrowUp':
      return { open, activeIndex: nextEnabledIndex(options, selected, activeIndex, -1), toggle: null, handled: true };
    case 'Home':
      return { open, activeIndex: edgeEnabledIndex(options, selected, 'start'), toggle: null, handled: true };
    case 'End':
      return { open, activeIndex: edgeEnabledIndex(options, selected, 'end'), toggle: null, handled: true };
    case 'Enter': {
      const option = options[activeIndex];
      const toggle = option && isAssignable(option, selected) ? option : null;
      return { open, activeIndex, toggle, handled: true };
    }
    case 'Escape':
      return { open: false, activeIndex: -1, toggle: null, handled: true };
    default:
      return unchanged;
  }
}

/** Keeps the active option valid after the visible list changes (search typed, selection toggled). */
export function clampActiveIndex(options, selected, activeIndex) {
  if (activeIndex >= 0 && activeIndex < options.length && isAssignable(options[activeIndex], selected)) return activeIndex;
  return edgeEnabledIndex(options, selected, 'start');
}
