import { randomUUID } from 'node:crypto';
import { HttpError } from './http.js';

/**
 * Workspace links ("Enlaces") owned by one record: opportunities, initiatives, framework
 * agreements, services and delivery projects. Shared by the commercial API and the operations API.
 */

export const MAX_WORKSPACE_LINKS = 20;

function linkError(message) {
  return new HttpError(400, 'validation_error', message);
}

/** `[{ title, url }]` from a request body value; missing means no links. */
export function parseWorkspaceLinks(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw linkError('Los enlaces de Workspace deben ser una lista.');
  if (value.length > MAX_WORKSPACE_LINKS) throw linkError(`No se permiten más de ${MAX_WORKSPACE_LINKS} enlaces de Workspace.`);
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw linkError('Cada enlace debe tener título y URL.');
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!title) throw linkError('Cada enlace de Workspace necesita un título.');
    if (title.length > 120) throw linkError('El título del enlace no puede superar los 120 caracteres.');
    if (!/^https?:\/\//i.test(url)) throw linkError('La URL del enlace debe empezar por http:// o https://.');
    if (url.length > 500) throw linkError('La URL del enlace no puede superar los 500 caracteres.');
    return { title, url };
  });
}

export function loadWorkspaceLinks(db, entityType, entityId) {
  return db
    .prepare('SELECT id, title, url FROM workspace_links WHERE entity_type = ? AND entity_id = ? ORDER BY created_at, rowid')
    .all(entityType, entityId);
}

/** Map of entity id → links for every record of one entity type (one query for a whole list). */
export function loadWorkspaceLinksByEntity(db, entityType) {
  const rows = db
    .prepare('SELECT id, entity_id, title, url FROM workspace_links WHERE entity_type = ? ORDER BY created_at, rowid')
    .all(entityType);
  const byEntity = new Map();
  for (const row of rows) {
    if (!byEntity.has(row.entity_id)) byEntity.set(row.entity_id, []);
    byEntity.get(row.entity_id).push({ id: row.id, title: row.title, url: row.url });
  }
  return byEntity;
}

export function replaceWorkspaceLinks(db, entityType, entityId, links, user, now) {
  db.prepare('DELETE FROM workspace_links WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);
  const insert = db.prepare(
    `INSERT INTO workspace_links (id, entity_type, entity_id, title, url, created_at, created_by_id, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const link of links) {
    insert.run(randomUUID(), entityType, entityId, link.title, link.url, now, user?.id ?? null, user?.name ?? '');
  }
}

export function deleteWorkspaceLinks(db, entityType, entityId) {
  db.prepare('DELETE FROM workspace_links WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId);
}

/** True when two link lists have the same titles and URLs in the same order. */
export function sameWorkspaceLinks(left, right) {
  return left.length === right.length && left.every((link, index) => link.title === right[index].title && link.url === right[index].url);
}
