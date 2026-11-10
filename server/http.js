import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** Typed error every handler can throw; the server maps it to `{ error: { code, message } }`. */
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Reads and parses a JSON request body.
 * Rejects oversized payloads (413) and anything that is not a JSON object (400).
 */
export function readJson(req, maxBytes = 16384) {
  return new Promise((resolve, reject) => {
    // A declared length above the cap skips buffering entirely, but the body is
    // still drained so the client receives a clean 413 instead of a socket reset.
    const declaredLength = Number(req.headers['content-length']);
    let overflow = Number.isFinite(declaredLength) && declaredLength > maxBytes;

    const chunks = [];
    let size = 0;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        // Keep draining the stream so the client still receives a clean 413.
        overflow = true;
        chunks.length = 0;
        return;
      }
      if (!overflow) chunks.push(chunk);
    });

    req.on('end', () => {
      if (overflow) {
        finish(reject, new HttpError(413, 'payload_too_large', 'La solicitud es demasiado grande.'));
        return;
      }

      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') {
        finish(
          reject,
          new HttpError(400, 'invalid_json', 'El cuerpo de la solicitud debe ser un objeto JSON.'),
        );
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        finish(reject, new HttpError(400, 'invalid_json', 'El cuerpo de la solicitud no es JSON válido.'));
        return;
      }

      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        finish(
          reject,
          new HttpError(400, 'invalid_json', 'El cuerpo de la solicitud debe ser un objeto JSON.'),
        );
        return;
      }

      finish(resolve, parsed);
    });

    req.on('error', (error) => finish(reject, error));
  });
}

export function sendJson(res, status, body) {
  if (res.writableEnded) return;
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': JSON_CONTENT_TYPE,
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  res.end(payload);
}

export function sendNoContent(res) {
  if (res.writableEnded) return;
  res.writeHead(204, { 'cache-control': 'no-store' });
  res.end();
}

/** Maps any thrown value to the public API error envelope. */
export function sendError(res, error) {
  if (res.headersSent || res.writableEnded) {
    res.end();
    return;
  }
  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: { code: error.code, message: error.message } });
    return;
  }
  sendJson(res, 500, {
    error: { code: 'internal_error', message: 'Ha ocurrido un error inesperado.' },
  });
}

/**
 * CSRF defence for state-changing requests: when an Origin header is present its
 * host must match the request Host. Combined with SameSite=Lax this blocks
 * cross-site form and fetch submissions.
 */
export function assertSameOrigin(req) {
  if (!MUTATING_METHODS.has(req.method)) return;

  const origin = req.headers.origin;
  if (origin === undefined) return;

  const requestHost = req.headers.host;
  if (!requestHost || typeof origin !== 'string' || origin.trim() === '') {
    throw new HttpError(403, 'origin_mismatch', 'El origen de la solicitud no está permitido.');
  }

  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'origin_mismatch', 'El origen de la solicitud no está permitido.');
  }

  if (originHost !== requestHost) {
    throw new HttpError(403, 'origin_mismatch', 'El origen de la solicitud no está permitido.');
  }
}

export function parseCookies(header) {
  const cookies = {};
  if (typeof header !== 'string' || header === '') return cookies;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;

    const name = part.slice(0, separator).trim();
    if (!name || Object.prototype.hasOwnProperty.call(cookies, name)) continue;

    let value = part.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }

  return cookies;
}

export function serializeCookie(
  name,
  value,
  { maxAge, httpOnly = true, secure = false, sameSite = 'Lax', path: cookiePath = '/' } = {},
) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (cookiePath) parts.push(`Path=${cookiePath}`);
  if (typeof maxAge === 'number') parts.push(`Max-Age=${Math.trunc(maxAge)}`);
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
]);

export function contentTypeFor(filePath) {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

/**
 * Resolves a URL pathname inside the static root and rejects anything that escapes it.
 * The raw pathname is used (never `new URL`), because WHATWG URL parsing silently
 * collapses `..` segments before we can inspect them.
 */
export function resolveStaticPath(root, rawPathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPathname);
  } catch {
    throw new HttpError(400, 'invalid_path', 'La ruta solicitada no es válida.');
  }

  if (decoded.includes('\0')) {
    throw new HttpError(400, 'invalid_path', 'La ruta solicitada no es válida.');
  }

  const relative = decoded.replace(/^[\\/]+/, '');
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new HttpError(403, 'forbidden', 'Ruta no permitida.');
  }
  return target;
}

async function statFile(candidate) {
  try {
    return await stat(candidate);
  } catch {
    return null;
  }
}

async function sendFile(req, res, root, filePath) {
  const stats = await statFile(filePath);
  if (!stats || !stats.isFile()) return false;

  const data = await readFile(filePath);
  const relative = path.relative(root, filePath).split(path.sep).join('/');

  let cacheControl = 'public, max-age=3600';
  if (relative.startsWith('assets/')) cacheControl = 'public, max-age=31536000, immutable';
  else if (relative === 'index.html') cacheControl = 'no-store';

  res.writeHead(200, {
    'content-type': contentTypeFor(filePath),
    'content-length': data.length,
    'cache-control': cacheControl,
  });

  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(data);
  }
  return true;
}

/**
 * Serves the SPA bundle with an index.html fallback for client-side routes.
 * Path resolution happens before anything touches the filesystem.
 */
export async function serveStatic(req, res, pathname, { distDir }) {
  const root = path.resolve(distDir);
  const target = resolveStaticPath(root, pathname);

  const targetStats = await statFile(target);
  if (targetStats?.isFile()) return sendFile(req, res, root, target);
  if (targetStats?.isDirectory()) {
    const directoryIndex = path.join(target, 'index.html');
    if (await sendFile(req, res, root, directoryIndex)) return;
  }

  // A missing bundle asset must stay a 404: returning index.html would poison the
  // browser cache for a hashed URL that is supposed to be immutable.
  if (pathname.startsWith('/assets/')) {
    throw new HttpError(404, 'not_found', 'Recurso no encontrado.');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(405, 'method_not_allowed', 'Método no permitido.');
  }

  const indexPath = path.join(root, 'index.html');
  if (await sendFile(req, res, root, indexPath)) return;

  throw new HttpError(
    404,
    'not_found',
    'No se encontró la build del cliente. Ejecuta "npm run build" y vuelve a intentarlo.',
  );
}
