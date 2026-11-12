import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_WORKSPACE_LINKS, normalizeWorkspaceLinks, safeWorkspaceUrl, toWorkspaceLinkForm } from './workspaceLinks.js';

test('workspace link form rows default the title and keep the url', () => {
  assert.deepEqual(toWorkspaceLinkForm([{ id: 'l1', title: '', url: 'https://a.example' }]), [{ title: 'Enlace Workspace', url: 'https://a.example' }]);
  assert.deepEqual(toWorkspaceLinkForm(undefined), []);
  assert.equal(MAX_WORKSPACE_LINKS, 20);
});

test('workspace link payload is trimmed and drops incomplete rows', () => {
  assert.deepEqual(
    normalizeWorkspaceLinks([{ title: ' Carpeta ', url: ' https://a.example ' }, { title: 'Sin url', url: '  ' }, { title: '', url: 'https://b.example' }]),
    [{ title: 'Carpeta', url: 'https://a.example' }],
  );
});

test('only http and https workspace urls are safe to open', () => {
  assert.equal(safeWorkspaceUrl('https://workspaces.example/doc'), 'https://workspaces.example/doc');
  assert.equal(safeWorkspaceUrl('http://intranet.example'), 'http://intranet.example');
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.example', 'not a url', '', undefined]) {
    assert.equal(safeWorkspaceUrl(unsafe), '', String(unsafe));
  }
});
