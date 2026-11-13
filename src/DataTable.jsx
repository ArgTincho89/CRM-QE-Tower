import { useEffect, useId, useRef, useState } from 'react';
import { ariaSortFor, describeColumnMove, describeSortChange, isEmptyValue, loadTableState, mergeColumnOrder, moveColumn, moveColumnTo, nextSort, sanitizeSort, saveTableState, sortRows } from './tableState.js';

/**
 * Column order and sort of one table, persisted in localStorage under `crm.table.<tableId>`.
 * Saved state is reconciled with the current columns on every render.
 */
export function useTableState(tableId, columns) {
  const [state, setState] = useState(() => ({ tableId, ...loadTableState(tableId, columns) }));
  const current = state.tableId === tableId ? state : { tableId, ...loadTableState(tableId, columns) };
  if (current !== state) setState(current);
  const columnIds = columns.map((column) => column.id);
  const sortableIds = columns.filter((column) => column.sortable !== false).map((column) => column.id);
  const order = mergeColumnOrder(current.order, columnIds);
  const sort = sanitizeSort(current.sort, sortableIds);
  const commit = (next) => {
    const value = { tableId, order: next.order, sort: next.sort };
    setState(value);
    saveTableState(tableId, value);
  };
  return {
    order,
    sort,
    toggleSort(columnId) {
      const next = nextSort(sort, columnId);
      commit({ order, sort: next });
      return next;
    },
    move(columnId, delta) {
      const next = moveColumn(order, columnId, delta);
      commit({ order: next, sort });
      return next;
    },
    moveTo(sourceId, targetId) {
      const next = moveColumnTo(order, sourceId, targetId);
      commit({ order: next, sort });
      return next;
    },
  };
}

function SortIndicator({ direction }) {
  return <span className={`sort-indicator${direction === 'none' ? ' idle' : ''}`} aria-hidden="true">{direction === 'ascending' ? '▲' : direction === 'descending' ? '▼' : '↕'}</span>;
}

/**
 * Data table with sortable headers and reorderable columns (drag and drop, or Alt+Left/Right
 * on a focused header). Columns: `{ id, label, value(row), render?(row), type?, sortable?, cellClassName? }`.
 * `actions` (`{ label, srOnly?, className?, render(row) }`) always renders last and is fixed.
 */
export default function DataTable({ tableId, columns, rows, rowKey = (row) => row.id, actions = null, className = 'data-table' }) {
  const { order, sort, toggleSort, move, moveTo } = useTableState(tableId, columns);
  const [announcement, setAnnouncement] = useState('');
  const [dragId, setDragId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const headerRefs = useRef(new Map());
  const pendingFocusRef = useRef(null);
  const instructionsId = useId();
  const byId = new Map(columns.map((column) => [column.id, column]));
  const orderedColumns = order.map((id) => byId.get(id)).filter(Boolean);
  const sortedRows = sortRows(rows, columns, sort);

  // Keyboard reordering moves the focused header; keep focus on it after React reorders the DOM.
  useEffect(() => {
    if (!pendingFocusRef.current) return;
    headerRefs.current.get(pendingFocusRef.current)?.focus();
    pendingFocusRef.current = null;
  });

  const handleSort = (column) => {
    if (column.sortable === false) return;
    setAnnouncement(describeSortChange(toggleSort(column.id), column.label));
  };
  const handleKeyDown = (event, column) => {
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const next = move(column.id, event.key === 'ArrowLeft' ? -1 : 1);
    pendingFocusRef.current = column.id;
    setAnnouncement(describeColumnMove(next, column.id, column.label));
  };
  const resetDrag = () => { setDragId(null); setDropTargetId(null); };
  const handleDragStart = (event, column) => {
    setDragId(column.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', column.id);
  };
  const handleDragOver = (event, column) => {
    if (!dragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropTargetId !== column.id) setDropTargetId(column.id);
  };
  const handleDrop = (event, column) => {
    if (!dragId) return;
    event.preventDefault();
    if (dragId !== column.id) {
      const next = moveTo(dragId, column.id);
      setAnnouncement(describeColumnMove(next, dragId, byId.get(dragId)?.label || dragId));
    }
    resetDrag();
  };

  return <>
    <table className={className}>
      <caption className="sr-only" id={instructionsId}>Pulsa un encabezado para ordenar. Alt + flecha izquierda o derecha mueve la columna; también puedes arrastrar los encabezados.</caption>
      <thead><tr>
        {orderedColumns.map((column) => {
          const ariaSort = ariaSortFor(sort, column.id);
          const sortable = column.sortable !== false;
          const headerClass = ['sortable-header', dragId === column.id ? 'dragging' : '', dropTargetId === column.id && dragId !== column.id ? 'drop-target' : ''].filter(Boolean).join(' ');
          const setRef = (node) => { if (node) headerRefs.current.set(column.id, node); else headerRefs.current.delete(column.id); };
          return <th key={column.id} className={headerClass} aria-sort={sortable ? ariaSort : undefined} draggable onDragStart={(event) => handleDragStart(event, column)} onDragOver={(event) => handleDragOver(event, column)} onDragEnter={(event) => handleDragOver(event, column)} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTargetId((currentId) => (currentId === column.id ? null : currentId)); }} onDrop={(event) => handleDrop(event, column)} onDragEnd={resetDrag}>
            {sortable
              ? <button type="button" ref={setRef} className="th-sort" onClick={() => handleSort(column)} onKeyDown={(event) => handleKeyDown(event, column)} aria-describedby={instructionsId} title="Ordenar; arrastra para mover la columna">{column.label}<SortIndicator direction={ariaSort} /></button>
              : <span ref={setRef} className="th-label" tabIndex={0} onKeyDown={(event) => handleKeyDown(event, column)} aria-describedby={instructionsId} title="Arrastra para mover la columna">{column.label}</span>}
          </th>;
        })}
        {actions && <th className="actions-header">{actions.srOnly ? <span className="sr-only">{actions.label}</span> : actions.label}</th>}
      </tr></thead>
      <tbody>{sortedRows.map((row, index) => <tr key={rowKey(row, index)}>
        {orderedColumns.map((column) => {
          const cellClass = typeof column.cellClassName === 'function' ? column.cellClassName(row) : column.cellClassName;
          let content;
          if (column.render) content = column.render(row);
          else {
            const value = column.value(row);
            content = isEmptyValue(value) ? '—' : value;
          }
          return <td key={column.id} className={cellClass || undefined}>{content}</td>;
        })}
        {actions && <td className={actions.className || undefined}>{actions.render(row)}</td>}
      </tr>)}</tbody>
    </table>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
  </>;
}
