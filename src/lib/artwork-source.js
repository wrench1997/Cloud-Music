function artworkSource(song, origin = '') {
  try {
    const url = new URL(song?.coverUrl);
    if (url.protocol === 'https:') return url.href;
    // Capacitor serves app-owned files at the WebView origin. Do not accept
    // arbitrary cleartext cover URLs or change the normal cloud artwork rules.
    if (song.localUri && url.protocol === 'http:' && url.origin === origin && url.pathname.startsWith('/_capacitor_file_/')) return url.href;
  } catch {}
  return '';
}

module.exports = { artworkSource };
