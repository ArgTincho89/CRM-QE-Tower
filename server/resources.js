import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, contentTypeFor } from './http.js';

/** URL prefix of the private documents (internal HTML docs and their images). */
export const RESOURCES_PREFIX = '/resources/';

/** Only these file types are served from the resources folder; anything else is a 404. */
export const RESOURCE_EXTENSIONS = new Set(['.html', '.png', '.webp', '.jpg', '.jpeg', '.svg', '.css', '.js']);

function invalidPath() {
  return new HttpError(400, 'invalid_path', 'La ruta solicitada no es válida.');
}

function notFound() {
  return new HttpError(404, 'not_found', 'Recurso no encontrado.');
}

/**
 * Maps a `/resources/...` URL pathname to a file inside `root`, or throws.
 * The raw pathname is decoded once, then rejected when it holds null bytes, backslashes,
 * an absolute or drive-letter path, or any empty, `.` or `..` segment. The resolved path must
 * still sit inside `root`, so nothing outside the folder is reachable even if a check is missed.
 */
export function resolveResourcePath(root, rawPathname) {
  if (typeof rawPathname !== 'string' || !rawPathname.startsWith(RESOURCES_PREFIX)) throw notFound();

  let relative;
  try {
    relative = decodeURIComponent(rawPathname.slice(RESOURCES_PREFIX.length));
  } catch {
    throw invalidPath();
  }

  if (relative === '') throw notFound();
  if (relative.includes('\0') || relative.includes('\\')) throw invalidPath();
  if (relative.startsWith('/') || path.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative)) throw invalidPath();
  if (relative.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) throw invalidPath();
  if (!RESOURCE_EXTENSIONS.has(path.extname(relative).toLowerCase())) throw notFound();

  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relative);
  if (!target.startsWith(resolvedRoot + path.sep)) throw invalidPath();
  return target;
}

/**
 * Serves one private resource to an authenticated user. `isAuthenticated` is checked before
 * the path is even resolved, so anonymous callers learn nothing about which files exist.
 * A top-level browser navigation without a session is sent to the app root (the login screen);
 * every other anonymous request (iframe, image, fetch) gets a 401.
 */
export async function serveResource(req, res, pathname, { resourcesDir, isAuthenticated }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD');
    throw new HttpError(405, 'method_not_allowed', 'Método no permitido.');
  }

  if (!isAuthenticated()) {
    if (req.headers['sec-fetch-dest'] === 'document') {
      res.writeHead(302, { location: '/', 'cache-control': 'no-store' });
      res.end();
      return;
    }
    throw new HttpError(401, 'unauthorized', 'La sesión no es válida o ha expirado.');
  }

  const target = resolveResourcePath(resourcesDir, pathname);

  // Follow symlinks before reading so a link inside the folder cannot expose outside files.
  let realTarget;
  let realRoot;
  try {
    [realTarget, realRoot] = await Promise.all([realpath(target), realpath(path.resolve(resourcesDir))]);
  } catch {
    throw notFound();
  }
  if (!realTarget.startsWith(realRoot + path.sep)) throw notFound();

  const stats = await stat(realTarget).catch(() => null);
  if (!stats?.isFile()) throw notFound();

  const data = await readFile(realTarget);
  const isHtml = path.extname(realTarget).toLowerCase() === '.html';
  res.writeHead(200, {
    'content-type': contentTypeFor(realTarget),
    'content-length': data.length,
    // Private: shared caches must never keep authenticated content. Documents revalidate so a
    // replaced doc shows up at once; images may be reused for an hour by the same browser.
    'cache-control': isHtml ? 'private, no-cache' : 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
    // The documents are embedded by the app itself and nowhere else.
    'x-frame-options': 'SAMEORIGIN',
    'content-security-policy': "frame-ancestors 'self'",
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}
