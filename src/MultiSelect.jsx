import { useEffect, useId, useRef, useState } from 'react';
import { clampActiveIndex, edgeEnabledIndex, filterOptions, isAssignable, reduceDropdownKey, removeSelection, selectedOptions, toggleSelection } from './multiSelect.js';

/** Chevron of the toggle (same shape as the app icon set). */
function ChevronIcon() {
  return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>;
}
/**
 * Dropdown multi-select: a closed control with the selected chips (removable) and a toggle that
 * opens a popover listbox with a search box. Keyboard: ArrowDown/ArrowUp/Home/End move, Enter
 * toggles, Escape closes; focus stays in the search box (aria-activedescendant). Clicking outside
 * closes the popover only, never the surrounding dialog. Non-assignable options (inactive or of
 * another fiscal year) render disabled unless already selected, so they can still be removed.
 * Options are `{ id, name, active?, assignable? }`; `children` render under the control (e.g. a
 * field error, linked through `errorId` when `invalid`).
 */
export default function MultiSelect({ legend, hint, options, selected, onChange, disabled, className = '', invalid = false, errorId, children = null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const toggleRef = useRef(null);
  const searchRef = useRef(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const hintId = `${baseId}-hint`;
  const optionId = (index) => `${baseId}-option-${index}`;
  const chips = selectedOptions(options, selected);
  const visible = filterOptions(options, query);
  const optionLabel = (option) => `${option.name}${option.active === false ? ' (inactivo)' : ''}`;

  const close = (restoreFocus) => {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
    if (restoreFocus) toggleRef.current?.focus();
  };
  const openList = (index) => {
    setOpen(true);
    setActiveIndex(index);
  };

  useEffect(() => {
    if (!open) return undefined;
    searchRef.current?.focus();
    // Pointer down outside closes the popover; the dialog itself stays open.
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) close(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  useEffect(() => {
    if (disabled && open) close(false);
  }, [disabled, open]);

  const handleKeyDown = (event) => {
    const next = reduceDropdownKey({ open, activeIndex }, event.key, { options: visible, selected });
    if (!next.handled) return;
    event.preventDefault();
    // Escape must close only the popover, not the dialog around it.
    event.stopPropagation();
    if (next.toggle) onChange(toggleSelection(selected, next.toggle));
    if (!next.open) close(true);
    else openList(next.activeIndex);
  };
  const handleSearch = (value) => {
    setQuery(value);
    setActiveIndex(clampActiveIndex(filterOptions(options, value), selected, -1));
  };
  const pick = (option, index) => {
    if (!isAssignable(option, selected)) return;
    onChange(toggleSelection(selected, option));
    setActiveIndex(index);
    searchRef.current?.focus();
  };

  return <fieldset className={`relation-field multi-select${className ? ` ${className}` : ''}${invalid ? ' has-error' : ''}`} aria-describedby={invalid && errorId ? errorId : undefined} disabled={disabled} ref={rootRef} onBlur={(event) => { if (open && !rootRef.current?.contains(event.relatedTarget)) close(false); }}>
    <legend>{legend}</legend>
    {hint && <span className="field-hint" id={hintId}>{hint}</span>}
    <div className={`multi-select-control${open ? ' open' : ''}`}>
      {chips.length > 0
        ? <ul className="multi-select-chips" aria-label={`${legend} seleccionados`}>
          {chips.map((option) => <li key={option.id} className={`relation-option selected${option.active === false ? ' inactive' : ''}`}><span>{optionLabel(option)}</span><button type="button" className="chip-remove" onClick={() => onChange(removeSelection(selected, option.id))} aria-label={`Quitar ${option.name}`}>×</button></li>)}
        </ul>
        : <span className="multi-select-placeholder">Sin selección</span>}
      <button type="button" ref={toggleRef} className="multi-select-toggle" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-describedby={hint ? hintId : undefined} onClick={() => (open ? close(true) : openList(edgeEnabledIndex(visible, selected, 'start')))} onKeyDown={handleKeyDown}>
        <span className="sr-only">{open ? 'Cerrar' : 'Abrir'} opciones de {legend}</span><ChevronIcon />
      </button>
    </div>
    {open && <div className="multi-select-popover">
      <input type="search" ref={searchRef} className="multi-select-search" value={query} onChange={(event) => handleSearch(event.target.value)} onKeyDown={handleKeyDown} placeholder={`Buscar ${legend.toLowerCase()}…`} role="combobox" aria-label={`Buscar en ${legend}`} aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={activeIndex >= 0 && activeIndex < visible.length ? optionId(activeIndex) : undefined} autoComplete="off" />
      <ul className="multi-select-listbox" id={listId} role="listbox" aria-multiselectable="true" aria-label={`Opciones de ${legend}`}>
        {visible.map((option, index) => {
          const isSelected = selected.includes(option.id);
          const assignable = isAssignable(option, selected);
          return <li key={option.id} id={optionId(index)} role="option" aria-selected={isSelected} aria-disabled={assignable ? undefined : 'true'} className={`multi-select-option${isSelected ? ' selected' : ''}${index === activeIndex ? ' active' : ''}${assignable ? '' : ' disabled'}`} onPointerDown={(event) => event.preventDefault()} onClick={() => pick(option, index)} onPointerEnter={() => { if (assignable) setActiveIndex(index); }}>
            <span className="multi-select-check" aria-hidden="true">{isSelected ? '✓' : ''}</span><span>{optionLabel(option)}</span>
          </li>;
        })}
      </ul>
      {options.length === 0
        ? <span className="field-hint">No hay opciones disponibles.</span>
        : visible.length === 0 && <span className="field-hint" role="status">Sin coincidencias.</span>}
    </div>}
    {children}
    <span className="sr-only" role="status" aria-live="polite">{selected.length} seleccionados</span>
  </fieldset>;
}
