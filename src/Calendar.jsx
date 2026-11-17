import { useEffect, useMemo, useState } from 'react';
import {
  CALENDAR_EVENT_TYPES, CALENDAR_VIEWS, SPANISH_WEEKDAYS, agendaMonths, agendaStartDay, buildCalendarEvents, dayHeading, filterEventsByType,
  groupEventsByDay, monthGrid, parseIsoDate, periodTitle, shiftAnchor, splitCellEvents, toLocalIsoDate, weekDates,
} from './calendar.js';
import { listOperationRecords, listScheduledActions } from './api.js';

// Below this width the month grid is too cramped, so the calendar opens in the agenda.
const NARROW_SCREEN_QUERY = '(max-width: 720px)';

function initialView() {
  try {
    return window.matchMedia?.(NARROW_SCREEN_QUERY).matches ? 'agenda' : 'month';
  } catch {
    return 'month';
  }
}

const TYPE_LABELS = Object.fromEntries(CALENDAR_EVENT_TYPES.map((type) => [type.id, type.label]));

function CalendarEvent({ event, onOpen }) {
  const overdue = event.type === 'initiative' && event.urgency === 'due';
  const description = event.description || `${TYPE_LABELS[event.type]}: ${event.label}${overdue ? '. Próxima acción vencida' : ''}`;
  return <button type="button" className={`calendar-event calendar-event-${event.type}${overdue ? ' calendar-event-overdue' : ''}`} onClick={() => onOpen(event)} title={description} aria-label={description}>
    <span className="calendar-event-dot" aria-hidden="true" />
    <span className="calendar-event-label">{event.label}</span>
  </button>;
}

/**
 * "Calendario": read-only, all-day view of next action dates (initiatives, opportunities and
 * framework agreements), pending actions with a due date, framework agreement end dates and the end
 * of People assignments, in month, week or agenda views. Clicking an event opens its record (actions
 * open their record; assignments open People > Asignaciones). `actionsVersion` changes whenever an
 * action is edited elsewhere, so the scheduled actions are reloaded.
 */
export default function CalendarPage({ initiatives, opportunities, agreements, onOpenEvent, actionsVersion = 0 }) {
  const today = toLocalIsoDate(new Date());
  const [view, setView] = useState(initialView);
  const [anchor, setAnchor] = useState(today);
  const [enabledTypes, setEnabledTypes] = useState(() => new Set(CALENDAR_EVENT_TYPES.map((type) => type.id)));
  // Day opened from a "+N más" link: the agenda scrolls to it and highlights it.
  const [focusDay, setFocusDay] = useState('');
  // Bumped by "Hoy" so the agenda scrolls back to today even when nothing else changed.
  const [scrollRequest, setScrollRequest] = useState(0);

  // Assignments live in People; the calendar loads them itself and simply omits them on failure.
  const [assignments, setAssignments] = useState([]);
  useEffect(() => {
    let cancelled = false;
    listOperationRecords('assignments').then((payload) => { if (!cancelled) setAssignments(payload?.records || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Pending actions with a due date; like assignments, simply omitted on failure.
  const [actions, setActions] = useState([]);
  useEffect(() => {
    let cancelled = false;
    listScheduledActions().then((payload) => { if (!cancelled) setActions(payload?.actions || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [actionsVersion]);

  const allEvents = useMemo(
    () => buildCalendarEvents({ initiatives, opportunities, agreements, assignments, actions }),
    [initiatives, opportunities, agreements, assignments, actions],
  );
  const events = useMemo(() => filterEventsByType(allEvents, enabledTypes), [allEvents, enabledTypes]);
  const eventsByDay = useMemo(() => groupEventsByDay(events), [events]);

  // The agenda lists every event (past and future) under month headings.
  const agenda = useMemo(() => agendaMonths(events), [events]);

  // The agenda opens on the day picked from "+N más", or on the first day from today onwards.
  useEffect(() => {
    if (view !== 'agenda') return;
    const target = focusDay || agendaStartDay(agenda.flatMap((group) => group.days), today);
    if (target) document.getElementById(`calendar-agenda-${target}`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [view, focusDay, scrollRequest]);

  const changeView = (next) => {
    setView(next);
    setFocusDay('');
  };
  const move = (direction) => {
    setAnchor((current) => shiftAnchor(view, current, direction));
    setFocusDay('');
  };
  const goToday = () => {
    setAnchor(today);
    setFocusDay('');
    setScrollRequest((count) => count + 1);
  };
  const openDay = (date) => {
    setAnchor(date);
    setView('agenda');
    setFocusDay(date);
  };
  const toggleType = (id) => setEnabledTypes((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const { month } = parseIsoDate(anchor);
  const dayNumber = (date) => parseIsoDate(date).day;

  return <section className="calendar-page" aria-label="Calendario">
    <div className="calendar-toolbar">
      <div className="calendar-nav">
        <button type="button" className="button button-secondary" onClick={goToday}>Hoy</button>
        {view !== 'agenda' && <>
          <button type="button" className="icon-button calendar-arrow" onClick={() => move(-1)} aria-label="Periodo anterior">‹</button>
          <button type="button" className="icon-button calendar-arrow" onClick={() => move(1)} aria-label="Periodo siguiente">›</button>
        </>}
        <h2 className="calendar-title" aria-live="polite">{periodTitle(view, anchor)}</h2>
      </div>
      <div className="calendar-views" role="group" aria-label="Vista del calendario">
        {CALENDAR_VIEWS.map((item) => <button type="button" key={item.id} className={view === item.id ? 'active' : ''} aria-pressed={view === item.id} onClick={() => changeView(item.id)}>{item.label}</button>)}
      </div>
    </div>
    <fieldset className="calendar-legend">
      <legend className="sr-only">Tipos de evento</legend>
      {CALENDAR_EVENT_TYPES.map((type) => <label key={type.id} className={`calendar-legend-item calendar-event-${type.id}`}>
        <input type="checkbox" checked={enabledTypes.has(type.id)} onChange={() => toggleType(type.id)} />
        <span className="calendar-event-dot" aria-hidden="true" />{type.label}
      </label>)}
      <span className="calendar-legend-note"><span className="calendar-overdue-sample" aria-hidden="true" /> Iniciativa con próxima acción vencida</span>
    </fieldset>

    {view === 'month' && <div className="calendar-month" role="grid" aria-label={periodTitle(view, anchor)}>
      <div className="calendar-weekdays" role="row">{SPANISH_WEEKDAYS.map((day) => <div key={day} role="columnheader">{day}</div>)}</div>
      {monthGrid(parseIsoDate(anchor).year, month).map((week) => <div className="calendar-week" role="row" key={week[0].date}>
        {week.map((cell) => {
          const { visible, hidden } = splitCellEvents(eventsByDay.get(cell.date));
          return <div role="gridcell" key={cell.date} className={`calendar-cell${cell.inMonth ? '' : ' calendar-cell-outside'}${cell.date === today ? ' calendar-cell-today' : ''}`} aria-label={dayHeading(cell.date)}>
            <span className="calendar-day-number" aria-current={cell.date === today ? 'date' : undefined}>{dayNumber(cell.date)}</span>
            {visible.map((event) => <CalendarEvent key={event.key} event={event} onOpen={onOpenEvent} />)}
            {hidden > 0 && <button type="button" className="calendar-more" onClick={() => openDay(cell.date)} aria-label={`Ver ${hidden} eventos más del ${dayHeading(cell.date)} en la agenda`}>+{hidden} más</button>}
          </div>;
        })}
      </div>)}
    </div>}

    {view === 'week' && <div className="calendar-week-view">
      {weekDates(anchor).map((date, index) => <section key={date} className={`calendar-week-day${date === today ? ' calendar-cell-today' : ''}`} aria-label={dayHeading(date)}>
        <header><span>{SPANISH_WEEKDAYS[index]}</span><strong aria-current={date === today ? 'date' : undefined}>{dayNumber(date)}</strong></header>
        {(eventsByDay.get(date) || []).map((event) => <CalendarEvent key={event.key} event={event} onOpen={onOpenEvent} />)}
      </section>)}
    </div>}

    {view === 'agenda' && <div className="calendar-agenda">
      {agenda.map((group) => <section key={group.key} className="calendar-agenda-month" aria-label={group.title}>
        <h3 className="calendar-agenda-month-title">{group.title}</h3>
        {group.days.map((day) => <section key={day.date} id={`calendar-agenda-${day.date}`} className={`calendar-agenda-day${day.date === focusDay ? ' calendar-agenda-focus' : ''}${day.date === today ? ' calendar-cell-today' : ''}`}>
          <h4>{dayHeading(day.date)}{day.date === today && <span className="calendar-today-pill">Hoy</span>}</h4>
          <div className="calendar-agenda-events">{day.events.map((event) => <CalendarEvent key={event.key} event={event} onOpen={onOpenEvent} />)}</div>
        </section>)}
      </section>)}
      {agenda.length === 0 && <p className="empty-state">No hay eventos.</p>}
    </div>}
  </section>;
}
