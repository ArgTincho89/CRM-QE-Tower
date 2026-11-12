// Pure helpers for in-app notifications, shared by the API (message wording) and the UI.

/** Entity types that can be assigned to a user and therefore notified. */
export const NOTIFICATION_ENTITY_TYPES = ['opportunity', 'initiative', 'agreement'];

// Spanish noun with its article: "la Oportunidad", "la Iniciativa", "el Acuerdo Marco".
const ENTITY_NOUNS = {
  opportunity: 'la Oportunidad',
  initiative: 'la Iniciativa',
  agreement: 'el Acuerdo Marco',
};

// Page that lists each entity type, used to open the related record from a notification.
const ENTITY_PAGES = {
  opportunity: 'opportunities',
  initiative: 'initiatives',
  agreement: 'agreements',
};

/** "la Oportunidad" / "la Iniciativa" / "el Acuerdo Marco", or '' for unknown types. */
export function notificationEntityNoun(entityType) {
  return ENTITY_NOUNS[entityType] || '';
}

/** Page id that shows the entity type, or null for unknown types. */
export function notificationTargetPage(entityType) {
  return ENTITY_PAGES[entityType] || null;
}

/** "{actorName} te ha asignado la Iniciativa {ID}: {Título}" and its siblings per entity type. */
export function buildAssignmentMessage({ actorName, entityType, entityId, entityTitle }) {
  const noun = notificationEntityNoun(entityType);
  if (!noun) throw new Error(`Unknown notification entity type: ${entityType}`);
  return `${actorName} te ha asignado ${noun} ${entityId}: ${entityTitle}`;
}

/** Number of unread notifications in a list. */
export function countUnread(notifications) {
  return (notifications || []).filter((item) => !item.readAt).length;
}

/** Badge text for the bell: '' hides it, large counts collapse to "99+". */
export function unreadBadgeLabel(count) {
  const value = Number(count) || 0;
  if (value <= 0) return '';
  return value > 99 ? '99+' : String(value);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

/**
 * Relative time for recent notifications ("Hace un momento", "Hace 5 min", "Hace 3 h") and
 * a dd/mm/yyyy date once they are a week old or more. Invalid input renders as ''.
 */
export function formatNotificationTime(iso, now = new Date()) {
  if (typeof iso !== 'string' || iso === '') return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return 'Hace un momento';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? 'Hace 1 día' : `Hace ${days} días`;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Applies a "marked as read" result locally so the panel updates before the next refresh. */
export function markNotificationsRead(notifications, ids, readAt) {
  const targets = ids === null ? null : new Set(ids);
  return (notifications || []).map((item) => (
    !item.readAt && (targets === null || targets.has(item.id)) ? { ...item, readAt } : item
  ));
}
