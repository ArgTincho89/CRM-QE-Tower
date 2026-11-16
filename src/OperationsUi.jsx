import { useEffect, useId, useRef, useState } from 'react';
import DataTable from './DataTable.jsx';
import { FieldError, FormField, useFieldErrors } from './FormField.jsx';
import { mapServerFieldError } from './formValidation.js';

/**
 * Building blocks shared by the "People" and "Proyectos" pages: accessible tabs, a table panel
 * with search and a create button, and a record dialog generated from field definitions.
 */

/** WAI-ARIA tabs (arrow keys, Home/End) wrapping one tab panel. */
export function TabStrip({ tabs, active, onSelect, label, children, className = '' }) {
  const tabRefs = useRef({});
  const baseId = useId();
  const focusTab = (index) => {
    const next = tabs[(index + tabs.length) % tabs.length];
    onSelect(next.id);
    tabRefs.current[next.id]?.focus();
  };
  const handleKeyDown = (event) => {
    const index = tabs.findIndex((item) => item.id === active);
    if (event.key === 'ArrowRight') focusTab(index + 1);
    else if (event.key === 'ArrowLeft') focusTab(index - 1);
    else if (event.key === 'Home') focusTab(0);
    else if (event.key === 'End') focusTab(tabs.length - 1);
    else return;
    event.preventDefault();
  };
  return <section className={`master-data-page ${className}`.trim()}>
    <div className="master-data-tabs" role="tablist" aria-label={label} onKeyDown={handleKeyDown}>
      {tabs.map((item) => <button key={item.id} ref={(node) => { tabRefs.current[item.id] = node; }} type="button" role="tab" id={`${baseId}-tab-${item.id}`} aria-selected={item.id === active} aria-controls={`${baseId}-panel`} tabIndex={item.id === active ? 0 : -1} className={`master-data-tab${item.id === active ? ' active' : ''}`} onClick={() => onSelect(item.id)}>{item.label}</button>)}
    </div>
    <div className="master-data-panel" role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${active}`}>{children}</div>
  </section>;
}

/** Search input of a panel toolbar. */
export function SearchBox({ value, onChange, label, placeholder = 'Buscar…' }) {
  return <label className="ops-search"><span className="sr-only">{label}</span><input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

/**
 * Table panel: title, description, record count, search box, optional create button, notices and
 * the sortable/draggable DataTable with "Editar" / "Eliminar" actions.
 */
export function RecordPanel({ title, description, tableId, columns, rows, totalCount, query, onQueryChange, searchLabel, createLabel, onCreate, onEdit, onDelete, emptyMessage, loading = false, error = '', onRetry, children }) {
  const actions = onEdit || onDelete
    ? { label: 'Acciones', className: 'master-actions', render: (row) => <>{onEdit && <button type="button" className="button button-secondary" onClick={() => onEdit(row)}>Editar</button>}{onDelete && <button type="button" className="button button-secondary button-danger" onClick={() => onDelete(row)}>Eliminar</button>}</> }
    : null;
  return <section className="secondary-panel">
    <div className="secondary-panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><span className="record-count">{rows.length === totalCount ? `${totalCount} registros` : `${rows.length} de ${totalCount} registros`}</span></div>
    <div className="ops-toolbar">
      <SearchBox value={query} onChange={onQueryChange} label={searchLabel || `Buscar en ${title}`} />
      {onCreate && <button type="button" className="button button-primary" onClick={onCreate}>+ {createLabel}</button>}
    </div>
    {children}
    <div className="table-wrap ops-table-wrap">
      {loading
        ? <p className="empty-state" role="status">Cargando…</p>
        : error
          ? <div className="board-state"><p>{error}</p>{onRetry && <button type="button" className="button button-secondary" onClick={onRetry}>Reintentar</button>}</div>
          : <>
            <DataTable tableId={tableId} className="data-table secondary-table" columns={columns} rows={rows} actions={actions} />
            {rows.length === 0 && <p className="empty-state">{query.trim() ? 'No hay registros que coincidan con la búsqueda.' : emptyMessage}</p>}
          </>}
    </div>
  </section>;
}

const optionValue = (option) => (typeof option === 'object' ? String(option.value) : option);
const optionLabel = (option) => (typeof option === 'object' ? option.label : option);

/** Checkbox group with an "add another value" input (e.g. Testing Scope). */
function ChecklistField({ legend, options, selected, onChange }) {
  const [extra, setExtra] = useState('');
  const all = [...options, ...selected.filter((value) => !options.some((option) => option.toLowerCase() === value.toLowerCase()))];
  const toggle = (value) => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  const add = () => {
    const value = extra.trim();
    if (value && !selected.some((item) => item.toLowerCase() === value.toLowerCase())) onChange([...selected, value]);
    setExtra('');
  };
  return <fieldset className="form-field wide ops-checklist">
    <legend>{legend}</legend>
    <div className="ops-checklist-options">{all.map((value) => <label key={value} className="ops-check"><input type="checkbox" checked={selected.includes(value)} onChange={() => toggle(value)} /> {value}</label>)}</div>
    <span className="ops-checklist-add"><input value={extra} onChange={(event) => setExtra(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} placeholder="Otro valor" aria-label={`Añadir otro valor a ${legend}`} /><button type="button" className="button button-secondary" onClick={add}>Añadir</button></span>
  </fieldset>;
}

/** Checkbox group over fixed `{ value, label }` options (no free text); the value is an id array. */
function MultiCheckField({ legend, options, selected, onChange, form, field, hint }) {
  const toggle = (value) => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  const invalid = Boolean(form.errors[field]);
  return <fieldset className={`form-field wide ops-checklist${invalid ? ' has-error' : ''}`} aria-describedby={invalid ? form.errorId(field) : undefined}>
    <legend>{legend}</legend>
    {options.length === 0
      ? <p className="field-hint">No hay registros activos.</p>
      : <div className="ops-checklist-options">{options.map((option) => <label key={option.value} className="ops-check"><input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)} aria-invalid={invalid ? 'true' : undefined} /> {option.label}</label>)}</div>}
    {hint && <span className="field-hint">{hint}</span>}
    <FieldError form={form} field={field} />
  </fieldset>;
}

/**
 * Create/edit dialog generated from `fields`: `{ id, label, type, options?, required?, wide?, hint?,
 * visible?(values), compute?(values), onChange?(value, values) → patch }`. `options` may be a
 * function of the current values. Types: text, textarea, number, date, url, select, combo (free
 * text with suggestions), readonly, checklist and multicheck (ids from fixed options).
 * `validate(values)` returns field errors; server errors with a `field` are mapped back too.
 */
export function RecordDialog({ eyebrow, title, fields, initialValues, validate, formFields, toPayload = (values) => values, onSave, onClose, submitLabel = 'Guardar' }) {
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fieldErrors = useFieldErrors();
  const dialogRef = useRef(null);
  const baseId = useId();
  useEffect(() => { dialogRef.current?.showModal(); return () => { if (dialogRef.current?.open) dialogRef.current.close(); }; }, []);
  const setValue = (field, value) => {
    fieldErrors.clear(field.id);
    setValues((current) => ({ ...current, [field.id]: value, ...(field.onChange ? field.onChange(value, current) : {}) }));
  };
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (fieldErrors.show(validate ? validate(values) : {})) return;
    setSaving(true);
    try {
      await onSave(toPayload(values));
      onClose();
    } catch (err) {
      const mapped = mapServerFieldError(err, formFields);
      if (mapped) fieldErrors.show(mapped);
      else setError(err?.message || 'No se pudo guardar el registro.');
    } finally {
      setSaving(false);
    }
  };
  const optionsOf = (field) => (typeof field.options === 'function' ? field.options(values) : field.options) || [];
  const renderControl = (field) => {
    const common = { value: values[field.id] ?? '', onChange: (event) => setValue(field, event.target.value), required: field.required, ...fieldErrors.fieldProps(field.id) };
    if (field.type === 'textarea') return <textarea rows="3" {...common} />;
    if (field.type === 'select') return <select {...common}><option value="">{field.placeholder || 'Sin seleccionar'}</option>{optionsOf(field).map((option) => <option key={optionValue(option)} value={optionValue(option)}>{optionLabel(option)}</option>)}</select>;
    if (field.type === 'combo') {
      const listId = `${baseId}-${field.id}-options`;
      return <><input {...common} list={listId} autoComplete="off" /><datalist id={listId}>{(field.options || []).map((option) => <option key={option} value={option} />)}</datalist></>;
    }
    if (field.type === 'date') return <input type="date" {...common} />;
    if (field.type === 'number') return <input inputMode="decimal" autoComplete="off" {...common} />;
    if (field.type === 'url') return <input type="url" inputMode="url" placeholder="https://" {...common} />;
    return <input {...common} />;
  };
  return <dialog ref={dialogRef} className="opportunity-dialog compact-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form onSubmit={submit} noValidate ref={fieldErrors.formRef}>
      <div className="dialog-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>×</button></div>
      <div className="form-grid">
        {fields.filter((field) => !field.visible || field.visible(values)).map((field) => {
          if (field.type === 'checklist') return <ChecklistField key={field.id} legend={field.label} options={field.options || []} selected={values[field.id] || []} onChange={(next) => setValue(field, next)} />;
          if (field.type === 'multicheck') return <MultiCheckField key={field.id} legend={field.label} options={optionsOf(field)} selected={values[field.id] || []} onChange={(next) => setValue(field, next)} form={fieldErrors} field={field.id} hint={field.hint} />;
          if (field.type === 'readonly') return <label key={field.id} className={`form-field${field.wide ? ' wide' : ''}`}>{field.label}<input value={field.compute(values) || ''} readOnly aria-readonly="true" className="ops-readonly" />{field.hint && <span className="field-hint">{field.hint}</span>}</label>;
          return <FormField key={field.id} form={fieldErrors} field={field.id} label={field.label} required={field.required} className={field.wide ? 'wide' : ''}>{renderControl(field)}{field.hint && <span className="field-hint">{field.hint}</span>}</FormField>;
        })}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{submitLabel}</button></div>
    </form>
  </dialog>;
}

/** Loads one API collection; `reload()` refetches it. 401 is reported through `onUnauthorized`. */
export function useCollection(load, { onUnauthorized } = {}) {
  const [state, setState] = useState({ records: [], loading: true, error: '' });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: current.records.length === 0, error: '' }));
    load()
      .then((payload) => { if (!cancelled) setState({ records: payload?.records || [], loading: false, error: '' }); })
      .catch((err) => {
        if (cancelled) return;
        if (err?.status === 401) onUnauthorized?.();
        setState((current) => ({ ...current, loading: false, error: err?.message || 'No se pudieron cargar los datos.' }));
      });
    return () => { cancelled = true; };
    // `load` is a stable module function per call site; `version` triggers reloads.
  }, [version]);
  return { ...state, reload: () => setVersion((value) => value + 1) };
}

/** Text of a number for the UI (Spanish decimals), '' when empty. */
export function formatNumber(value, { suffix = '' } = {}) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${number.toLocaleString('es-ES', { maximumFractionDigits: 2 })}${suffix}`;
}

/** Form text of a stored number (Spanish decimal comma), '' when empty. */
export function numberToInput(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value).replace('.', ',');
}
