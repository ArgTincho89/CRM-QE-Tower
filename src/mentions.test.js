import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  detectMentionQuery,
  extractMentionIds,
  filterMentionCandidates,
  insertMention,
  newMentionIds,
  parseMentionSegments,
  sanitizeMentionName,
  serializeMention,
} from './mentions.js';

const ADA = { id: 'u-ada', name: 'Ada Lovelace' };
const BOB = { id: 'u-bob', name: 'Bob Builder' };

describe('mentions', () => {
  test('serializes a user into a token and extracts its id back', () => {
    assert.equal(serializeMention(ADA), '@[Ada Lovelace](u-ada)');
    const body = `Hola ${serializeMention(ADA)} y ${serializeMention(BOB)}, otra vez ${serializeMention(ADA)}`;
    assert.deepEqual(extractMentionIds(body), ['u-ada', 'u-bob']);
    assert.deepEqual(extractMentionIds('sin menciones @Ada'), []);
    assert.deepEqual(extractMentionIds(undefined), []);
  });

  test('names are sanitized so they cannot break the token', () => {
    assert.equal(sanitizeMentionName('  Ada [x]\nLovelace '), 'Ada x Lovelace');
    assert.equal(sanitizeMentionName(''), 'usuario');
    assert.equal(serializeMention({ id: 'u-1', name: 'A]B(c)' }), '@[A B(c)](u-1)');
    assert.deepEqual(extractMentionIds(serializeMention({ id: 'u-1', name: 'A]B(c)' })), ['u-1']);
    // Malformed ids never match.
    assert.deepEqual(extractMentionIds('@[Ada](u 1) @[Ada](<script>)'), []);
  });

  test('newly added mention ids after an edit', () => {
    assert.deepEqual(newMentionIds(['a', 'b'], ['b', 'c', 'a', 'd']), ['c', 'd']);
    assert.deepEqual(newMentionIds([], ['a']), ['a']);
    assert.deepEqual(newMentionIds(undefined, undefined), []);
  });

  test('splits a body into safe text and mention segments', () => {
    const body = 'Hola @[Ada Lovelace](u-ada), revisa <b>esto</b> con @[Fantasma](u-ghost)';
    assert.deepEqual(parseMentionSegments(body), [
      { type: 'text', text: 'Hola ' },
      { type: 'mention', userId: 'u-ada', name: 'Ada Lovelace' },
      { type: 'text', text: ', revisa <b>esto</b> con ' },
      { type: 'mention', userId: 'u-ghost', name: 'Fantasma' },
    ]);
    // Unconfirmed ids render as plain text and merge with the surrounding text.
    assert.deepEqual(parseMentionSegments(body, ['u-ada']), [
      { type: 'text', text: 'Hola ' },
      { type: 'mention', userId: 'u-ada', name: 'Ada Lovelace' },
      { type: 'text', text: ', revisa <b>esto</b> con @Fantasma' },
    ]);
    assert.deepEqual(parseMentionSegments('solo texto'), [{ type: 'text', text: 'solo texto' }]);
    assert.deepEqual(parseMentionSegments(''), []);
  });

  test('detects the mention query being typed at the caret', () => {
    assert.deepEqual(detectMentionQuery('@', 1), { start: 0, query: '' });
    assert.deepEqual(detectMentionQuery('Hola @ad', 8), { start: 5, query: 'ad' });
    assert.deepEqual(detectMentionQuery('Hola @Ádr más', 9), { start: 5, query: 'Ádr' });
    assert.deepEqual(detectMentionQuery('(@bo', 4), { start: 1, query: 'bo' });
    // Caret before the end only looks at the text up to the caret.
    assert.deepEqual(detectMentionQuery('Hola @ad y más', 7), { start: 5, query: 'a' });
    assert.equal(detectMentionQuery('Hola @ad y', 10), null);
    assert.equal(detectMentionQuery('mail@example.com', 16), null);
    assert.equal(detectMentionQuery('sin arroba', 5), null);
    assert.equal(detectMentionQuery(`@${'a'.repeat(41)}`, 42), null);
    assert.equal(detectMentionQuery(null, 0), null);
  });

  test('filters candidates by name, accent and case insensitive, prefixes first', () => {
    const users = [
      { id: 'u-1', name: 'Martín Gómez' },
      { id: 'u-2', name: 'Ana Martínez' },
      { id: 'u-3', name: 'Ramón Tin' },
      { id: 'u-4', name: 'Beatriz' },
    ];
    assert.deepEqual(filterMentionCandidates(users, 'mart').map((user) => user.id), ['u-1', 'u-2']);
    assert.deepEqual(filterMentionCandidates(users, 'TIN').map((user) => user.id), ['u-3', 'u-1', 'u-2']);
    assert.deepEqual(filterMentionCandidates(users, 'gomez').map((user) => user.id), ['u-1']);
    assert.deepEqual(filterMentionCandidates(users, '').map((user) => user.id), ['u-1', 'u-2', 'u-3', 'u-4']);
    assert.deepEqual(filterMentionCandidates(users, '', { limit: 2, excludeId: 'u-1' }).map((user) => user.id), ['u-2', 'u-3']);
    assert.deepEqual(filterMentionCandidates(users, 'zzz'), []);
    assert.deepEqual(filterMentionCandidates(undefined, 'a'), []);
  });

  test('inserts the token in place of the typed query', () => {
    assert.deepEqual(insertMention('Hola @ad', { start: 5, caret: 8 }, ADA), { text: 'Hola @[Ada Lovelace](u-ada) ', caret: 28 });
    // Existing text after the caret is kept, without doubling the space.
    const result = insertMention('Hola @bo qué tal', { start: 5, caret: 8 }, BOB);
    assert.equal(result.text, 'Hola @[Bob Builder](u-bob) qué tal');
    assert.equal(result.text.slice(result.caret), 'qué tal');
  });
});
