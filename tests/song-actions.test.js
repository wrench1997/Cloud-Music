const test = require('node:test');
const assert = require('node:assert/strict');
const { songActionScopeMatches, withoutSong, removeSongFromMusicState, removeSongFromShuffle } = require('../src/lib/song-actions');

test('a song action belongs to its account, directory request, folder and library source', () => {
  const scope = { generation: 3, accountId: 'account-a', directoryRequest: 8, folderId: 'music', source: 'cloud' };
  assert.equal(songActionScopeMatches(scope, { ...scope }), true);
  for (const change of [{ generation: 4 }, { accountId: 'account-b' }, { directoryRequest: 9 }, { folderId: 'other' }, { source: 'local' }]) {
    assert.equal(songActionScopeMatches(scope, { ...scope, ...change }), false);
  }
  assert.equal(songActionScopeMatches(null, scope), false);
});

test('removing a cloud song leaves other tracks and device music preferences intact', () => {
  const one = { id: 'one' }; const two = { id: 'two' }; const local = { id: 'native:job:song.mp3' };
  assert.deepEqual(withoutSong([one, two, local], 'one'), [two, local]);
  const state = { favorites: ['one', 'two', local.id], recent: ['two', 'one', local.id] };
  assert.deepEqual(removeSongFromMusicState(state, 'one'), { favorites: ['two', local.id], recent: ['two', local.id] });
  assert.deepEqual(state.favorites, ['one', 'two', local.id]);
});

test('queue deletion remaps pending shuffle indices and removes deleted history without adding repeats', () => {
  const queue = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const shuffle = { key: 'a|b|c|d', remaining: [3, 1, 2], history: ['a', 'b'] };
  assert.deepEqual(removeSongFromShuffle(shuffle, queue, 'b'), { key: 'a|c|d', remaining: [2, 1], history: ['a'] });
  assert.deepEqual(shuffle.remaining, [3, 1, 2]);
});
