import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from './app.js';
import { closeDatabase, openDatabase } from './db.js';

const DEFAULT_INVITE_CODE = 'invite-123';

/**
 * Creates a throwaway SQLite database inside a temp directory.
 * The caller is responsible for `cleanup()`.
 */
export function createTempDatabase(prefix = 'crm-db-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  const dbPath = path.join(dir, 'app.db');
  const db = openDatabase(dbPath);

  return {
    db,
    dbPath,
    dir,
    cleanup() {
      closeDatabase(db);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Boots the real HTTP server on an ephemeral port against a throwaway database and
 * a minimal `dist/` fixture, so requests exercise cookies, JSON and static serving
 * exactly as they would in production.
 */
export async function startTestServer(options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-api-'));
  const dbPath = path.join(dir, 'app.db');
  const distDir = path.join(dir, 'dist');

  mkdirSync(path.join(distDir, 'assets'), { recursive: true });
  writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><html><body>CRM</body></html>');
  writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log("crm");');
  // A file outside dist that a traversal attempt would try to reach.
  writeFileSync(path.join(dir, 'secret.txt'), 'top-secret');

  const db = openDatabase(dbPath);
  const config = {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    dbPath,
    distDir,
    sessionSecret: options.sessionSecret ?? 'test-session-secret',
    inviteCode: options.inviteCode === undefined ? DEFAULT_INVITE_CODE : options.inviteCode,
    trustProxy: false,
    usesDevSessionSecret: false,
  };

  const server = createServer({
    db,
    config,
    logger: { error: () => {} },
    now: options.now,
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function json(method, pathname, { body, cookie, origin, headers = {} } = {}) {
    const requestHeaders = { ...headers };
    if (body !== undefined) requestHeaders['content-type'] = 'application/json';
    if (cookie) requestHeaders.cookie = cookie;
    if (origin) requestHeaders.origin = origin;

    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const setCookies = response.headers.getSetCookie();
    return {
      status: response.status,
      headers: response.headers,
      body: text === '' ? null : JSON.parse(text),
      setCookie: setCookies[0] ?? null,
      // Ready to be sent back as the Cookie header.
      cookie: setCookies.length > 0 ? setCookies[0].split(';')[0] : null,
    };
  }

  return {
    server,
    db,
    config,
    dir,
    port,
    baseUrl,
    json,
    register(body) {
      return json('POST', '/api/auth/register', {
        body: { name: 'Test User', password: 'password123', inviteCode: config.inviteCode, ...body },
      });
    },
    login(body) {
      return json('POST', '/api/auth/login', { body });
    },
    async cleanup() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      closeDatabase(db);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
