import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AGENDA_TITLE, addDays, agendaDays, agendaMonths, agendaStartDay, buildCalendarEvents, dayHeading, daysInMonth, eventsInRange, filterEventsByType, groupEventsByDay,
  monthGrid, monthTitle, parseIsoDate, periodTitle, shiftAnchor, splitCellEvents, startOfWeek, toLocalIsoDate,
  visibleRange, weekDates, weekdayIndex,
} from './calendar.js';

describe('calendar dates', () => {
  test('parses valid ISO dates and rejects impossible ones', () => {
    assert.deepEqual(parseIsoDate('2026-03-01'), { year: 2026, month: 2, day: 1 });
    assert.deepEqual(parseIsoDate('2024-02-29'), { year: 2024, month: 1, day: 29 });
    assert.equal(parseIsoDate('2025-02-29'), null);
    assert.equal(parseIsoDate('2026-04-31'), null);
    assert.equal(parseIsoDate('2026-3-1'), null);
    assert.equal(parseIsoDate(''), null);
    assert.equal(parseIsoDate(undefined), null);
  });

  test('leap years give February 29 days, other years 28', () => {
    assert.equal(daysInMonth(2024, 1), 29);
    assert.equal(daysInMonth(2026, 1), 28);
    assert.equal(daysInMonth(2000, 1), 29);
    assert.equal(daysInMonth(1900, 1), 28);
    assert.equal(addDays('2024-02-28', 1), '2024-02-29');
    assert.equal(addDays('2025-02-28', 1), '2025-03-01');
  });

  test('adding days crosses month and year boundaries', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2027-01-01', -1), '2026-12-31');
    assert.equal(addDays('2026-01-31', 30), '2026-03-02');
  });

  test('day arithmetic is DST-safe around the European clock changes', () => {
    // 2026-03-29 and 2026-10-25 are the spring-forward and fall-back Sundays in Europe.
    assert.equal(addDays('2026-03-28', 1), '2026-03-29');
    assert.equal(addDays('2026-03-29', 1), '2026-03-30');
    assert.equal(addDays('2026-10-25', 1), '2026-10-26');
    assert.deepEqual(weekDates('2026-03-29'), ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29']);
    assert.deepEqual(weekDates('2026-10-26').slice(0, 2), ['2026-10-26', '2026-10-27']);
  });

  test('the local ISO date reads the wall clock, not UTC', () => {
    assert.equal(toLocalIsoDate(new Date(2026, 0, 1, 0, 30)), '2026-01-01');
    assert.equal(toLocalIsoDate(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
  });

  test('weeks start on Monday', () => {
    assert.equal(weekdayIndex('2026-11-16'), 0);
    assert.equal(weekdayIndex('2026-11-15'), 6);
    assert.equal(startOfWeek('2026-11-15'), '2026-11-09');
    assert.equal(startOfWeek('2026-11-16'), '2026-11-16');
    assert.equal(startOfWeek('2027-01-01'), '2026-12-28');
  });
});

describe('month grid', () => {
  test('covers whole Monday-to-Sunday weeks around the month', () => {
    const weeks = monthGrid(2026, 10); // November 2026 starts on a Sunday.
    assert.equal(weeks[0][0].date, '2026-10-26');
    assert.equal(weeks[0][6].date, '2026-11-01');
    assert.equal(weeks[0][6].inMonth, true);
    assert.equal(weeks[0][5].inMonth, false);
    assert.equal(weeks.at(-1)[6].date, '2026-12-06');
    assert.equal(weeks.length, 6);
    assert.ok(weeks.every((week) => week.length === 7));
  });

  test('a February that starts on Monday and has 28 days fills exactly four weeks', () => {
    const weeks = monthGrid(2027, 1);
    assert.equal(weeks.length, 4);
    assert.equal(weeks[0][0].date, '2027-02-01');
    assert.equal(weeks[3][6].date, '2027-02-28');
    assert.ok(weeks.flat().every((cell) => cell.inMonth));
  });

  test('leap February includes the 29th', () => {
    const dates = monthGrid(2024, 1).flat().filter((cell) => cell.inMonth).map((cell) => cell.date);
    assert.equal(dates.length, 29);
    assert.equal(dates.at(-1), '2024-02-29');
  });

  test('every in-month day appears exactly once and in order', () => {
    for (let month = 0; month < 12; month += 1) {
      const dates = monthGrid(2026, month).flat().map((cell) => cell.date);
      assert.equal(new Set(dates).size, dates.length);
      assert.deepEqual([...dates].sort(), dates);
      assert.equal(dates.filter((date) => parseIsoDate(date).month === month).length, daysInMonth(2026, month));
    }
  });
});

describe('calendar navigation', () => {
  test('visible ranges per view', () => {
    assert.deepEqual(visibleRange('month', '2026-11-15'), { from: '2026-10-26', to: '2026-12-06' });
    assert.deepEqual(visibleRange('week', '2026-11-15'), { from: '2026-11-09', to: '2026-11-15' });
    assert.deepEqual(visibleRange('agenda', '2026-02-10'), { from: '0000-01-01', to: '9999-12-31' });
  });

  test('moving by month clamps the day and crosses years', () => {
    assert.equal(shiftAnchor('month', '2026-01-31', 1), '2026-02-28');
    assert.equal(shiftAnchor('month', '2024-01-31', 1), '2024-02-29');
    assert.equal(shiftAnchor('month', '2026-12-15', 1), '2027-01-15');
    assert.equal(shiftAnchor('agenda', '2026-01-10', -1), '2025-12-10');
    assert.equal(shiftAnchor('week', '2026-12-29', 1), '2027-01-05');
  });

  test('titles are in Spanish', () => {
    assert.equal(monthTitle(2026, 10), 'Noviembre 2026');
    assert.equal(periodTitle('month', '2026-03-05'), 'Marzo 2026');
    assert.equal(periodTitle('agenda', '2026-03-05'), AGENDA_TITLE);
    assert.equal(periodTitle('week', '2026-11-11'), '9 – 15 noviembre 2026');
    assert.equal(periodTitle('week', '2026-12-01'), '30 noviembre – 6 diciembre 2026');
    assert.equal(periodTitle('week', '2026-12-30'), '28 diciembre 2026 – 3 enero 2027');
    assert.equal(dayHeading('2026-03-02'), 'lunes, 2 de marzo');
  });
});

describe('calendar events', () => {
  const today = new Date(2026, 10, 15, 12);
  const data = {
    initiatives: [
      { id: 'IN-000001', title: 'Vencida', stage: 'pending', nextActionDate: '2026-11-10' },
      { id: 'IN-000002', title: 'Completada', stage: 'completed', nextActionDate: '2026-11-20' },
      { id: 'IN-000003', title: 'Archivada', stage: 'pending', nextActionDate: '2026-11-20', archivedAt: '2026-11-01' },
      { id: 'IN-000004', title: 'Sin fecha', stage: 'pending', nextActionDate: '' },
      { id: 'IN-000005', title: 'Futura', stage: 'in_progress', nextActionDate: '2026-12-31' },
    ],
    opportunities: [
      { id: 'OP-000001', title: 'Abierta', stage: 'proposal', nextActionDate: '2026-11-01' },
      { id: 'OP-000002', title: 'Ganada', stage: 'result', outcome: 'won', nextActionDate: '2026-11-02' },
      { id: 'OP-000003', title: 'Archivada', stage: 'proposal', nextActionDate: '2026-11-03', archivedAt: '2026-11-01' },
      { id: 'OP-000004', title: 'Fecha rota', stage: 'proposal', nextActionDate: '2026-02-30' },
    ],
    agreements: [
      { id: 'AM-000001', title: 'Marco', status: 'active', endDate: '2026-11-30' },
      { id: 'AM-000002', title: 'Inactivo', status: 'inactive', endDate: '2026-11-30' },
      { id: 'AM-000003', title: 'Sin fin', status: 'active', endDate: '' },
    ],
  };

  test('builds one event per open record with a valid date, labelled "ID · Título"', () => {
    const events = buildCalendarEvents(data, today);
    assert.deepEqual(events.map((event) => event.key), ['opportunity:OP-000001', 'initiative:IN-000001', 'agreementEnd:AM-000001', 'initiative:IN-000005']);
    assert.equal(events[0].label, 'OP-000001 · Abierta');
    assert.equal(events[0].recordId, 'OP-000001');
  });

  test('framework agreements show on their next action date, plus a separate "Fin de acuerdo"', () => {
    const events = buildCalendarEvents({ agreements: [
      { id: 'AM-1', title: 'Marco', status: 'active', nextActionDate: '2026-11-20', endDate: '2026-12-31' },
      { id: 'AM-2', title: 'Inactivo', status: 'inactive', nextActionDate: '2026-11-20', endDate: '2026-12-31' },
    ] }, today);
    assert.deepEqual(events.map((event) => [event.key, event.date]), [['agreement:AM-1', '2026-11-20'], ['agreementEnd:AM-1', '2026-12-31']]);
    assert.equal(events[1].label, 'Fin de acuerdo: AM-1 · Marco');
    // The end event opens the agreement it belongs to.
    assert.equal(events[1].entityType, 'agreement');
    assert.equal(events[1].recordId, 'AM-1');
  });

  test('pending dated actions show as "Acción: <texto> — <registro>" and replace the record event of that day', () => {
    const events = buildCalendarEvents({
      opportunities: [
        { id: 'OP-1', title: 'Renovación', stage: 'proposal', nextActionDate: '2026-11-18' },
        { id: 'OP-2', title: 'Ganada', stage: 'result', outcome: 'won', nextActionDate: '' },
      ],
      initiatives: [{ id: 'IN-1', title: 'Explorar', stage: 'pending', nextActionDate: '2026-11-25' }],
      agreements: [{ id: 'AM-1', title: 'Marco', status: 'active', nextActionDate: '', endDate: '' }],
      actions: [
        { id: 'a1', text: 'Llamar al cliente para revisar la propuesta final', dueDate: '2026-11-18', entityType: 'opportunity', entityId: 'OP-1' },
        { id: 'a2', text: 'Revisar anexo', dueDate: '2026-11-30', entityType: 'opportunity', entityId: 'OP-1' },
        { id: 'a3', text: 'Preparar demo', dueDate: '2026-11-19', entityType: 'initiative', entityId: 'IN-1' },
        { id: 'a4', text: 'Renovar', dueDate: '2026-11-21', entityType: 'agreement', entityId: 'AM-1' },
        { id: 'a5', text: 'Cerrada', dueDate: '2026-11-21', entityType: 'opportunity', entityId: 'OP-2' },
        { id: 'a6', text: 'Sin registro', dueDate: '2026-11-21', entityType: 'opportunity', entityId: 'OP-9' },
        { id: 'a7', text: 'Fecha rota', dueDate: '2026-02-30', entityType: 'opportunity', entityId: 'OP-1' },
        { id: 'a8', text: 'Completada', dueDate: '2026-11-22', status: 'completed', entityType: 'opportunity', entityId: 'OP-1' },
      ],
    }, today);
    // OP-1's own event on 2026-11-18 is replaced by the action of that day; IN-1 keeps its event.
    assert.deepEqual(events.map((event) => [event.key, event.date]), [
      ['action:a1', '2026-11-18'],
      ['action:a3', '2026-11-19'],
      ['action:a4', '2026-11-21'],
      ['initiative:IN-1', '2026-11-25'],
      ['action:a2', '2026-11-30'],
    ]);
    assert.equal(events[0].type, 'action');
    assert.equal(events[0].entityType, 'opportunity');
    assert.equal(events[0].recordId, 'OP-1');
    assert.equal(events[0].label, 'Acción: Llamar al cliente para revisar la propu… — Renovación');
    assert.equal(events[0].description, 'Acción: Llamar al cliente para revisar la propuesta final — Oportunidad OP-1 · Renovación');
    assert.equal(events[2].label, 'Acción: Renovar — Marco');
    assert.deepEqual(filterEventsByType(events, ['action']).map((event) => event.key), ['action:a1', 'action:a3', 'action:a4', 'action:a2']);
  });

  test('assignments with an end date show as "Fin de asignación" on that day', () => {
    const events = buildCalendarEvents({ assignments: [
      { id: 'AS-1', talentName: 'Pérez, Ana', clientName: 'Cliente Uno', towerName: 'Tower X', endDate: '2026-03-10' },
      { id: 'AS-2', talentName: 'Ruiz, Leo', towerName: 'Tower X', lobName: 'LoB Y', endDate: '2026-03-10' },
      { id: 'AS-3', talentName: 'Gil, Eva', lobName: 'LoB Y', endDate: '2026-03-12' },
      { id: 'AS-4', talentName: 'Sin fin', clientName: 'Cliente Uno', endDate: '' },
      { id: 'AS-5', talentName: 'Fecha mala', endDate: '2026-02-30' },
    ], agreements: [{ id: 'AM-1', title: 'Marco', status: 'active', endDate: '2026-03-10' }] }, today);
    assert.deepEqual(events.map((event) => event.key), ['agreementEnd:AM-1', 'assignment:AS-1', 'assignment:AS-2', 'assignment:AS-3']);
    const first = events[1];
    assert.equal(first.type, 'assignment');
    assert.equal(first.date, '2026-03-10');
    assert.equal(first.label, 'Fin de asignación: Pérez, Ana en Cliente Uno');
    assert.equal(first.description, first.label);
    assert.equal(events[2].label, 'Fin de asignación: Ruiz, Leo en Tower X');
    assert.equal(events[3].label, 'Fin de asignación: Gil, Eva en LoB Y');
    assert.deepEqual(filterEventsByType(events, ['assignment']).map((event) => event.recordId), ['AS-1', 'AS-2', 'AS-3']);
  });

  test('overdue initiatives carry the due urgency', () => {
    const events = buildCalendarEvents(data, today);
    assert.equal(events.find((event) => event.recordId === 'IN-000001').urgency, 'due');
    assert.equal(events.find((event) => event.recordId === 'IN-000005').urgency, 'none');
    assert.equal(events.find((event) => event.recordId === 'OP-000001').urgency, 'none');
  });

  test('events on the first and last day of a month land in that month', () => {
    const events = buildCalendarEvents({ opportunities: [
      { id: 'OP-1', title: 'Primero', stage: 'proposal', nextActionDate: '2026-03-01' },
      { id: 'OP-2', title: 'Último', stage: 'proposal', nextActionDate: '2026-03-31' },
      { id: 'OP-3', title: 'Fuera', stage: 'proposal', nextActionDate: '2026-04-01' },
    ] }, today);
    assert.deepEqual(eventsInRange(events, '2026-03-01', '2026-03-31').map((event) => event.recordId), ['OP-1', 'OP-2']);
    assert.deepEqual(agendaDays(events, '2026-03-01', '2026-03-31').map((day) => day.date), ['2026-03-01', '2026-03-31']);
  });

  test('the agenda lists every event, past and far future, whatever the anchor month', () => {
    const events = buildCalendarEvents({
      opportunities: [{ id: 'OP-1', title: 'Pasada', stage: 'proposal', nextActionDate: '2025-01-15' }],
      agreements: [
        { id: 'AM-1', title: 'Marco largo', status: 'active', endDate: '2031-06-30' },
        { id: 'AM-2', title: 'Marco', status: 'active', endDate: '2026-11-30' },
      ],
    }, today);
    const { from, to } = visibleRange('agenda', '2026-11-15');
    assert.deepEqual(agendaDays(events, from, to).map((day) => day.date), ['2025-01-15', '2026-11-30', '2031-06-30']);
    assert.deepEqual(agendaDays(events).map((day) => day.date), ['2025-01-15', '2026-11-30', '2031-06-30']);
  });

  test('agenda days are grouped under month headings in date order', () => {
    const events = buildCalendarEvents({ opportunities: [
      { id: 'OP-1', title: 'A', stage: 'proposal', nextActionDate: '2026-03-31' },
      { id: 'OP-2', title: 'B', stage: 'proposal', nextActionDate: '2026-03-01' },
      { id: 'OP-3', title: 'C', stage: 'proposal', nextActionDate: '2027-01-02' },
    ] }, today);
    const months = agendaMonths(events);
    assert.deepEqual(months.map((month) => [month.key, month.title, month.days.map((day) => day.date)]), [
      ['2026-03', 'Marzo 2026', ['2026-03-01', '2026-03-31']],
      ['2027-01', 'Enero 2027', ['2027-01-02']],
    ]);
    assert.deepEqual(agendaMonths([]), []);
  });

  test('the agenda starts on the first day from today, else on the last one', () => {
    const days = [{ date: '2025-01-15' }, { date: '2026-11-30' }, { date: '2031-06-30' }];
    assert.equal(agendaStartDay(days, '2026-11-17'), '2026-11-30');
    assert.equal(agendaStartDay(days, '2026-11-30'), '2026-11-30');
    assert.equal(agendaStartDay(days, '2032-01-01'), '2031-06-30');
    assert.equal(agendaStartDay([], '2026-11-17'), '');
  });

  test('type filters and day grouping', () => {
    const events = buildCalendarEvents(data, today);
    assert.deepEqual(filterEventsByType(events, ['agreementEnd']).map((event) => event.recordId), ['AM-000001']);
    assert.deepEqual(filterEventsByType(events, ['agreement']).map((event) => event.recordId), []);
    assert.deepEqual(filterEventsByType(events, new Set()), []);
    const grouped = groupEventsByDay([...events, { ...events[0], key: 'x', recordId: 'OP-9' }]);
    assert.equal(grouped.get('2026-11-01').length, 2);
  });

  test('crowded month cells collapse the overflow into "+N más"', () => {
    const many = Array.from({ length: 5 }, (_, index) => ({ key: String(index) }));
    assert.deepEqual(splitCellEvents(many.slice(0, 3), 3), { visible: many.slice(0, 3), hidden: 0 });
    const split = splitCellEvents(many, 3);
    assert.equal(split.visible.length, 2);
    assert.equal(split.hidden, 3);
  });
});
