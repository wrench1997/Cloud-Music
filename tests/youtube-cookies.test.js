const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeYoutubeCookies, youtubeSessionCookies, MAX_COOKIE_BYTES } = require('../src/lib/youtube-cookies');

const now = 2000000000000;
const header = '# Netscape HTTP Cookie File\n';
const row = (domain = '.youtube.com', name = 'SID', value = 'fixture-login', expiry = '0') => [domain, 'TRUE', '/', 'TRUE', expiry, name, value].join('\t') + '\n';

test('cookie import limits credentials to YouTube, retains HttpOnly, and normalizes browser line endings', () => {
  const input = '\uFEFF' + header + '# comment\n#HttpOnly_' + row() + row('.google.com', 'SID', 'other-site') + row('youtube.com.evil.test', 'SID', 'other-site')
    + row('.youtube.com', 'VISITOR_INFO1_LIVE', 'expired', '1999999999') + row('music.youtube.com', 'PREF', 'fixture-preference');
  const result = normalizeYoutubeCookies(input.replace(/\n/g, '\r\n'), now);
  assert.ok(result.includes('#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfixture-login'));
  assert.ok(result.includes('music.youtube.com'));
  assert.doesNotMatch(result, /other-site|google\.com|evil\.test|expired|\r/);
  assert.equal(normalizeYoutubeCookies(result, now), result);
  assert.equal(normalizeYoutubeCookies(header + row() + row(), now), normalizeYoutubeCookies(header + row(), now));
});

test('cookie import rejects unauthenticated, expired, malformed, oversized and injected files without echoing values', () => {
  for (const input of [row(), header + row('.google.com'), header + row('.youtube.com', 'PREF'), header + row('.youtube.com', 'SID', 'fixture-secret', '1'),
    header + row('.youtube.com', 'SID', 'fixture-secret with-space'), header + row('.youtube.com', 'SID', 'fixture-secret\u0000'),
    header + row().replace('\tTRUE\t/', '\tinvalid\t/'), header + row().replace('\t0\tSID', '\t-1\tSID'), header + 'x'.repeat(MAX_COOKIE_BYTES)]) {
    assert.throws(() => normalizeYoutubeCookies(input, now), (error) => !error.message.includes('fixture-secret'));
  }
  assert.throws(() => normalizeYoutubeCookies(header + row() + Array.from({ length: 301 }, (_, i) => row('.youtube.com', `cookie-${i}`)).join(''), now), /过多/);
});

test('application preview cookies preserve host scope and expiry and ignore unrelated browser sessions', () => {
  const result = youtubeSessionCookies([
    { domain: '.youtube.com', path: '/', name: 'SID', value: 'fixture-login', secure: true, httpOnly: true },
    { domain: 'music.youtube.com', path: '/', name: 'PREF', value: 'fixture-pref', secure: true, hostOnly: true, expirationDate: 2000000020 },
    { domain: '.google.com', name: 'SID', value: 'other-site' },
  ], now);
  assert.ok(result.includes('music.youtube.com\tFALSE\t/\tTRUE\t2000000020'));
  assert.ok(result.includes('#HttpOnly_.youtube.com'));
  assert.doesNotMatch(result, /other-site/);
  assert.throws(() => youtubeSessionCookies([], now), /没有有效/);
});
