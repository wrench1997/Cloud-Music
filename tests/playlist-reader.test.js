const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePromise = import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, '../src/lib/playlist-reader.js')).toString('base64')}`);

test('revisiting a pending playlist shares its read and retains source choices', async () => {
  const { createPlaylistReader } = await modulePromise;
  const reader = createPlaylistReader();
  let finish, calls = 0;
  const load = () => { calls++; return new Promise((resolve) => { finish = resolve; }); };
  const first = reader.read('a', load), second = reader.read('a', load);
  assert.equal(first, second);
  await Promise.resolve();
  finish({ entries: [{ title: 'Song' }] });
  await first;
  reader.update('a', { selected: { 0: false }, candidates: { 0: [{ url: 'chosen' }] } });
  const restored = await reader.read('a', load);
  assert.equal(calls, 1);
  assert.deepEqual(restored.selected, { 0: false });
  assert.equal(restored.candidates[0][0].url, 'chosen');
});

test('refresh isolates an old response and a failed read can be retried', async () => {
  const { createPlaylistReader } = await modulePromise;
  const reader = createPlaylistReader();
  let finish;
  const stale = reader.read('a', () => new Promise((resolve) => { finish = resolve; }));
  await Promise.resolve();
  reader.invalidate('a');
  await reader.read('a', () => ({ title: 'New' }));
  finish({ title: 'Old' }); await stale;
  assert.equal((await reader.read('a', () => assert.fail())).title, 'New');
  await assert.rejects(reader.read('bad', () => { throw new Error('offline'); }), /offline/);
  assert.equal((await reader.read('bad', () => ({ title: 'Recovered' }))).title, 'Recovered');
});

test('playlist memory is bounded and expires even after changing selections', async () => {
  const { createPlaylistReader } = await modulePromise;
  let time = 0, calls = 0;
  const reader = createPlaylistReader({ now: () => time, lifetime: 100, limit: 2 });
  const load = () => ({ count: ++calls });
  await reader.read('a', load); await reader.read('b', load);
  await reader.read('a', load); await reader.read('c', load);
  assert.equal((await reader.read('b', load)).count, 4);
  time = 99; reader.update('b', { selected: {} });
  assert.equal((await reader.read('b', load)).count, 4);
  time = 100;
  assert.equal((await reader.read('b', load)).count, 5);
});
