import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(serverDir, '..');

// The runtime image only ships server/ plus the src/ files copied explicitly in the
// Dockerfile, so every src/ module the server imports must be copied there.
test('Dockerfile copies every src module imported by the server runtime', () => {
  const dockerfile = readFileSync(path.join(rootDir, 'Dockerfile'), 'utf8');
  const copied = new Set([...dockerfile.matchAll(/COPY --from=build \/app\/src\/(\S+)\s+\.\/src\//g)].map((match) => match[1]));

  const pending = [];
  for (const file of readdirSync(serverDir).filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))) {
    const source = readFileSync(path.join(serverDir, file), 'utf8');
    for (const match of source.matchAll(/from\s+['"]\.\.\/src\/([^'"]+)['"]/g)) pending.push(match[1]);
  }

  const seen = new Set();
  while (pending.length > 0) {
    const name = pending.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    assert.ok(copied.has(name), `server imports src/${name} but the Dockerfile does not copy it`);
    const source = readFileSync(path.join(rootDir, 'src', name), 'utf8');
    for (const match of source.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) pending.push(match[1]);
  }

  assert.ok(seen.size > 0, 'expected the server to import at least one src module');
});
