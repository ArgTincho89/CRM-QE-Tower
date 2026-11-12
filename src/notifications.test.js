import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildAssignmentMessage, countUnread, formatNotificationTime, markNotificationsRead, notificationEntityNoun, notificationTargetPage, unreadBadgeLabel,
} from './notifications.js';

describe('notifications', () => {
  test('assignment messages use the right article per entity type', () => {
    const base = { actorName: 'Ada Lovelace', entityTitle: 'Plataforma QA' };
    assert.equal(buildAssignmentMessage({ ...base, entityType: 'initiative', entityId: 'IN-000001' }), 'Ada Lovelace te ha asignado la Iniciativa IN-000001: Plataforma QA');
    assert.equal(buildAssignmentMessage({ ...base, entityType: 'opportunity', entityId: 'OP-000002' }), 'Ada Lovelace te ha asignado la Oportunidad OP-000002: Plataforma QA');
    assert.equal(buildAssignmentMessage({ ...base, entityType: 'agreement', entityId: 'AM-000003' }), 'Ada Lovelace te ha asignado el Acuerdo Marco AM-000003: Plataforma QA');
    assert.throws(() => buildAssignmentMessage({ ...base, entityType: 'clients', entityId: 'c-1' }), /Unknown notification entity type/);
  });

  test('entity nouns and target pages', () => {
    assert.equal(notificationEntityNoun('agreement'), 'el Acuerdo Marco');
    assert.equal(notificationEntityNoun('x'), '');
    assert.equal(notificationTargetPage('opportunity'), 'opportunities');
    assert.equal(notificationTargetPage('initiative'), 'initiatives');
    assert.equal(notificationTargetPage('agreement'), 'agreements');
    assert.equal(notificationTargetPage('x'), null);
  });

  test('unread count and badge label', () => {
    const list = [{ id: 'a', readAt: null }, { id: 'b', readAt: '2026-01-01' }, { id: 'c' }];
    assert.equal(countUnread(list), 2);
    assert.equal(countUnread(undefined), 0);
    assert.equal(unreadBadgeLabel(0), '');
    assert.equal(unreadBadgeLabel(7), '7');
    assert.equal(unreadBadgeLabel(120), '99+');
  });

  test('relative notification time', () => {
    const now = new Date('2026-11-12T12:00:00');
    assert.equal(formatNotificationTime(new Date('2026-11-12T11:59:40').toISOString(), now), 'Hace un momento');
    assert.equal(formatNotificationTime(new Date('2026-11-12T11:55:00').toISOString(), now), 'Hace 5 min');
    assert.equal(formatNotificationTime(new Date('2026-11-12T09:00:00').toISOString(), now), 'Hace 3 h');
    assert.equal(formatNotificationTime(new Date('2026-11-11T09:00:00').toISOString(), now), 'Hace 1 día');
    assert.equal(formatNotificationTime(new Date('2026-11-09T09:00:00').toISOString(), now), 'Hace 3 días');
    assert.equal(formatNotificationTime(new Date('2026-10-01T09:00:00').toISOString(), now), '01/10/2026');
    assert.equal(formatNotificationTime('', now), '');
    assert.equal(formatNotificationTime('nope', now), '');
  });

  test('marking read updates only unread targets, or all with null', () => {
    const list = [{ id: 'a', readAt: null }, { id: 'b', readAt: 'old' }, { id: 'c', readAt: null }];
    assert.deepEqual(markNotificationsRead(list, ['a', 'b'], 'now').map((item) => item.readAt), ['now', 'old', null]);
    assert.deepEqual(markNotificationsRead(list, null, 'now').map((item) => item.readAt), ['now', 'old', 'now']);
  });
});
