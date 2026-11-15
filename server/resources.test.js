import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resolveResourcePath } from './resources.js';
import { startTestServer } from './testing.js';

/** Sends a request with a raw path so URL normalization cannot hide a traversal attempt. */
function rawGet(port, requestPath, cookie = '') {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(`GET ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${cookie ? `Cookie: ${cookie}\r\n` : ''}Connection: close\r\n\r\n`);
    });
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
    socket.setTimeout(5000, () => socket.destroy(new Error('raw request timed out')));
  });
}

const statusOf = (raw) => Number(raw.split(' ')[1]);

describe('resource path resolution', () => {
  const root = path.resolve('/srv/resources');

  test('plain and nested files resolve inside the folder', () => {
    assert.equal(resolveResourcePath(root, '/resources/doc.html'), path.join(root, 'doc.html'));
    assert.equal(resolveResourcePath(root, '/resources/images/Sub%20folder/a.webp'), path.join(root, 'images', 'Sub folder', 'a.webp'));
  });

  for (const [label, pathname, status] of [
    ['dot-dot segments', '/resources/../secret.html', 400],
    ['encoded dot-dot segments', '/resources/%2e%2e/secret.html', 400],
    ['nested dot-dot segments', '/resources/images/../../secret.png', 400],
    ['encoded slashes hiding dot-dot', '/resources/images%2f..%2f..%2fsecret.png', 400],
    ['backslashes', '/resources/images%5c..%5csecret.png', 400],
    ['null bytes', '/resources/doc.html%00.png', 400],
    ['absolute paths', '/resources//etc/passwd.html', 400],
    ['drive letters', '/resources/C:%2fsecret.html', 400],
    ['malformed escapes', '/resources/%E0%A4%A.html', 400],
    ['the bare folder', '/resources/', 404],
    ['unsupported file types', '/resources/notes.txt', 404],
  ]) {
    test(`rejects ${label}`, () => {
      assert.throws(() => resolveResourcePath(root, pathname), (error) => error.status === status);
    });
  }
});

describe('GET /resources/*', () => {
  /** @type {Awaited<ReturnType<typeof startTestServer>>} */
  let app;
  let session;

  before(async () => {
    app = await startTestServer();
    const registered = await app.register({ email: 'docs@example.com', name: 'Docs Reader', password: 'password123' });
    assert.equal(registered.status, 201);
    session = registered.cookie;
  });

  after(async () => {
    await app.cleanup();
  });

  const get = (pathname, headers = {}) => fetch(`${app.baseUrl}${pathname}`, { headers, redirect: 'manual' });

  test('anonymous requests get a 401 and no content', async () => {
    const response = await get('/resources/doc.html');
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error.code, 'unauthorized');
  });

  test('anonymous image requests get a 401 too', async () => {
    assert.equal((await get('/resources/images/logo.png')).status, 401);
  });

  test('an anonymous top-level navigation is redirected to the app root', async () => {
    const response = await get('/resources/doc.html', { 'sec-fetch-dest': 'document' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/');
  });

  test('a forged session cookie is rejected', async () => {
    assert.equal((await get('/resources/doc.html', { cookie: 'crm_session=forged.value' })).status, 401);
  });

  test('signed-in users get the document with private, nosniff headers', async () => {
    const response = await get('/resources/doc.html', { cookie: session });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(response.headers.get('cache-control'), /^private\b/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(await response.text(), /<title>Doc<\/title>/);
  });

  for (const [pathname, type] of [
    ['/resources/images/logo.png', 'image/png'],
    ['/resources/images/Sub%20folder/photo.webp', 'image/webp'],
    ['/resources/images/photo.jpg', 'image/jpeg'],
    ['/resources/images/icon.svg', 'image/svg+xml'],
    ['/resources/style.css', 'text/css; charset=utf-8'],
    ['/resources/script.js', 'text/javascript; charset=utf-8'],
  ]) {
    test(`serves ${pathname} as ${type}`, async () => {
      const response = await get(pathname, { cookie: session });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), type);
      assert.match(response.headers.get('cache-control'), /^private\b/);
      await response.arrayBuffer();
    });
  }

  test('missing files and unsupported types are 404', async () => {
    assert.equal((await get('/resources/missing.html', { cookie: session })).status, 404);
    assert.equal((await get('/resources/notes.txt', { cookie: session })).status, 404);
  });

  test('traversal attempts never reach files outside the folder', async () => {
    for (const requestPath of [
      '/resources/../secret.txt',
      '/resources/..%2fsecret.txt',
      '/resources/%2e%2e/secret.txt',
      '/resources/images/..%5c..%5csecret.txt',
      '/resources/..%2f..%2fdist%2findex.html',
      '/resources/doc.html%00.png',
    ]) {
      const raw = await rawGet(app.port, requestPath, session);
      assert.ok([400, 404].includes(statusOf(raw)), `${requestPath} answered ${statusOf(raw)}`);
      assert.doesNotMatch(raw, /top-secret/);
    }
  });

  test('only GET and HEAD are allowed', async () => {
    const response = await fetch(`${app.baseUrl}/resources/doc.html`, { method: 'POST', headers: { cookie: session } });
    assert.equal(response.status, 405);
  });

  test('HEAD returns the headers without a body', async () => {
    const response = await fetch(`${app.baseUrl}/resources/images/logo.png`, { method: 'HEAD', headers: { cookie: session } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(await response.text(), '');
  });
});
