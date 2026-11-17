import { useEffect, useId, useRef, useState } from 'react';
import { ariaSortFor, describeColumnMove, describeRowMove, describeSortChange, isEmptyValue, loadTableState, mergeColumnOrder, moveColumn, moveColumnTo, nextSort, sanitizeSort, saveTableState, sortRows } from './tableState.js';

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
    clearSort() {
      commit({ order, sort: null });
    },
  };
}

function SortIndicator({ direction }) {
  return <span className={`sort-indicator${direction === 'none' ? ' idle' : ''}`} aria-hidden="true">{direction === 'ascending' ? '▲' : direction === 'descending' ? '▼' : '↕'}</span>;
}

/**
 * Data table with sortable headers and reorderable columns (drag and drop, or Alt+Left/Right
 * on a focused header). Columns: `{ id, label, value(row), render?(row, index), type?, sortable?, cellClassName?, pinnedFirst? }`.
 * `pinnedFirst` columns always render first, whatever the saved order.
 * `actions` (`{ label, srOnly?, className?, render(row) }`) always renders last and is fixed.
 * With `onRowClick(row)` the whole row opens that record; clicks on its own controls are ignored.
 *
 * Opt-in manual row order: `rowReorder` (`{ onMove(sourceKey, targetKey), label(row) }`) adds a
 * drag handle per row; dropping a row on another one (or Alt+Up/Down on the focused handle) asks
 * the owner to move it to that row's position. A column sort wins over the manual order: while one
 * is active the handles are disabled and a "Volver al orden manual" button clears the sort.
 */
export default function DataTable({ tableId, columns, rows, rowKey = (row) => row.id, actions = null, className = 'data-table', onRowClick = null, rowAriaLabel = null, rowReorder = null }) {
  const { order, sort, toggleSort, move, moveTo, clearSort } = useTableState(tableId, columns);
  const [announcement, setAnnouncement] = useState('');
  const [dragId, setDragId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [rowDragKey, setRowDragKey] = useState(null);
  const [rowDropKey, setRowDropKey] = useState(null);
  const headerRefs = useRef(new Map());
  const handleRefs = useRef(new Map());
  const pendingFocusRef = useRef(null);
  const pendingHandleFocusRef = useRef(null);
  const instructionsId = useId();
  const rowInstructionsId = useId();
  const byId = new Map(columns.map((column) => [column.id, column]));
  const pinnedIds = columns.filter((column) => column.pinnedFirst).map((column) => column.id);
  const orderedColumns = [...pinnedIds, ...order.filter((id) => !pinnedIds.includes(id))].map((id) => byId.get(id)).filter(Boolean);
  const sortedRows = sortRows(rows, columns, sort);
  const manualOrder = Boolean(rowReorder) && !sort;

  // Keyboard reordering moves the focused header (or row handle); keep focus on it after React
  // reorders the DOM.
  useEffect(() => {
    if (pendingFocusRef.current) {
      headerRefs.current.get(pendingFocusRef.current)?.focus();
      pendingFocusRef.current = null;
    }
    if (pendingHandleFocusRef.current) {
      const handle = handleRefs.current.get(pendingHandleFocusRef.current);
      if (handle && document.activeElement !== handle) handle.focus();
      pendingHandleFocusRef.current = null;
    }
  });

  const moveRow = (sourceRow, targetRow) => {
    const sourceKey = rowKey(sourceRow);
    const targetKey = rowKey(targetRow);
    if (!manualOrder || sourceKey === targetKey) return;
    rowReorder.onMove(sourceKey, targetKey);
    const position = sortedRows.indexOf(targetRow) + 1;
    setAnnouncement(describeRowMove(rowReorder.label(sourceRow), position, sortedRows.length));
  };
  const handleRowKeyDown = (event, row, index) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    event.stopPropagation();
    const target = sortedRows[index + (event.key === 'ArrowUp' ? -1 : 1)];
    if (!target) return;
    pendingHandleFocusRef.current = rowKey(row);
    moveRow(row, target);
  };
  const resetRowDrag = () => { setRowDragKey(null); setRowDropKey(null); };
  const restoreManualOrder = () => {
    clearSort();
    setAnnouncement('Orden manual restaurado.');
  };

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

  const sortedLabel = sort ? byId.get(sort.columnId)?.label || '' : '';
  return <>
    {rowReorder && sort && <p className="row-order-note" role="status">
      Ordenado por «{sortedLabel}»: el orden manual está en pausa.
      <button type="button" className="inline-link" onClick={restoreManualOrder}>Volver al orden manual</button>
    </p>}
    <table className={className}>
      <caption className="sr-only" id={instructionsId}>Pulsa un encabezado para ordenar. Alt + flecha izquierda o derecha mueve la columna; también puedes arrastrar los encabezados.</caption>
      <thead><tr>
        {rowReorder && <th className="row-drag-header" scope="col"><span className="sr-only">Orden manual</span></th>}
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
      <tbody>{sortedRows.map((row, index) => {
        const key = rowKey(row, index);
        // Only Enter/Space pressed on the row itself opens it; on its buttons they must activate them.
        const rowClass = [onRowClick ? 'row-clickable' : '', rowDragKey === key ? 'row-dragging' : '', rowDropKey === key && rowDragKey !== key ? 'row-drop-target' : ''].filter(Boolean).join(' ');
        const dragOver = (event) => {
          if (rowDragKey === null) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          if (rowDropKey !== key) setRowDropKey(key);
        };
        return <tr key={key}
        className={rowClass || undefined}
        tabIndex={onRowClick ? 0 : undefined}
        aria-label={onRowClick && rowAriaLabel ? rowAriaLabel(row) : undefined}
        onClick={onRowClick ? (event) => { if (!event.target.closest('button, a, input, select, textarea, label')) onRowClick(row); } : undefined}
        onKeyDown={onRowClick ? (event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onRowClick(row); } } : undefined}
        onDragOver={rowReorder ? dragOver : undefined}
        onDragEnter={rowReorder ? dragOver : undefined}
        onDrop={rowReorder ? (event) => {
          if (rowDragKey === null) return;
          event.preventDefault();
          const source = sortedRows.find((item, itemIndex) => rowKey(item, itemIndex) === rowDragKey);
          if (source) moveRow(source, row);
          resetRowDrag();
        } : undefined}>
        {rowReorder && <td className="row-drag-cell">
          <button type="button" className="row-drag-handle" ref={(node) => { if (node) handleRefs.current.set(key, node); else handleRefs.current.delete(key); }}
            draggable={manualOrder} disabled={!manualOrder}
            aria-label={`Mover ${rowReorder.label(row)}`} aria-describedby={rowInstructionsId}
            title={manualOrder ? 'Arrastra para cambiar el orden (Alt + flecha arriba/abajo con el teclado)' : 'Quita la ordenación por columna para reordenar manualmente'}
            onDragStart={(event) => { setRowDragKey(key); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(key)); }}
            onDragEnd={resetRowDrag}
            onKeyDown={(event) => handleRowKeyDown(event, row, index)}>
            <span aria-hidden="true">⠿</span>
          </button>
        </td>}
        {orderedColumns.map((column) => {
          const cellClass = typeof column.cellClassName === 'function' ? column.cellClassName(row) : column.cellClassName;
          let content;
          if (column.render) content = column.render(row, index);
          else {
            const value = column.value(row);
            content = isEmptyValue(value) ? '—' : value;
          }
          return <td key={column.id} className={cellClass || undefined}>{content}</td>;
        })}
        {actions && <td className={actions.className || undefined}>{actions.render(row)}</td>}
      </tr>;
      })}</tbody>
    </table>
    {rowReorder && <p className="sr-only" id={rowInstructionsId}>Alt + flecha arriba o abajo mueve la fila en el orden manual; también puedes arrastrarla por el asa.</p>}
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
  </>;
}
