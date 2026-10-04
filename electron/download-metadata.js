const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

const text = (value, limit = 300) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
const artistName = (value) => Array.isArray(value) ? value.map((artist) => text(typeof artist === 'string' ? artist : artist?.name)).filter(Boolean).join(', ') : text(value);
function safeCoverUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port
        && ['i.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com', 'image-cdn.spotifycdn.com', 'i.ytimg.com', 'img.youtube.com'].includes(url.hostname)) return url.href;
  } catch {}
  return '';
}
function spotifyId(value) {
  const match = text(value).match(/^(?:spotify:track:|https:\/\/open\.spotify\.com\/(?:embed\/)?track\/)?([A-Za-z0-9]{22})(?:\?.*)?$/);
  return match?.[1] || '';
}
function videoId(value) {
  try { const id = new URL(value).searchParams.get('v'); return /^[\w-]{11}$/.test(id) ? id : ''; } catch { return ''; }
}
function normalizeTrack(entry, url = entry.url) {
  const id = spotifyId(entry.spotifyId || entry.spotifyUrl || entry.uri);
  return {
    url, title: text(entry.title) || '歌曲', artist: artistName(entry.artist || entry.artists),
    album: text(typeof entry.album === 'object' ? entry.album?.name : entry.album),
    duration: Math.max(0, Math.min(86400, Number(entry.duration) || 0)),
    coverUrl: safeCoverUrl(entry.coverUrl || entry.cover || entry.thumbnail),
    metadataProvider: id || entry.metadataProvider === 'spotify' ? 'spotify' : 'youtube', ...(id ? { spotifyId: id } : {}),
  };
}
function spotifyEntity(html) {
  const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  return JSON.parse(match[1]).props?.pageProps?.state?.data?.entity;
}
function parseSpotifyTrack(html, expectedId) {
  const entity = spotifyEntity(html);
  if (!entity || spotifyId(entity.uri || entity.id) !== expectedId) throw new Error('Spotify 返回的曲目信息不匹配。');
  const images = [...(Array.isArray(entity.coverArt?.sources) ? entity.coverArt.sources : []), ...(Array.isArray(entity.visualIdentity?.image) ? entity.visualIdentity.image : [])];
  const coverUrl = images.filter((image) => safeCoverUrl(image.url)).sort((a, b) => (b.width || b.maxWidth || 0) - (a.width || a.maxWidth || 0))[0]?.url;
  return normalizeTrack({ title: entity.title || entity.name, artists: entity.artists || entity.authors, artist: entity.subtitle,
    album: entity.album, duration: Number(entity.duration || 0) / 1000, coverUrl, spotifyId: expectedId });
}
async function enrichSpotifyTrack(track, fetchImpl = fetch) {
  if (!track.spotifyId) return track;
  const response = await fetchImpl(`https://open.spotify.com/embed/track/${track.spotifyId}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Spotify 曲目信息返回 ${response.status}`);
  const html = await response.text();
  if (html.length > 8 * 1024 * 1024) throw new Error('Spotify 曲目信息过大。');
  const details = parseSpotifyTrack(html, track.spotifyId);
  // Preserve the original playlist's title/version; enrichment fills only missing fields.
  return { ...details, ...track, artist: track.artist || details.artist, album: track.album || details.album,
    coverUrl: track.coverUrl || details.coverUrl, duration: track.duration || details.duration };
}
function metadataFor(track, info = {}) {
  const original = track.metadataProvider === 'spotify';
  const versions = (value) => text(value).toLowerCase().match(/\b(?:slowed|slow|sped|remix|live|acoustic|instrumental|nightcore|super|ultra)\b/g)?.sort().join() || '';
  const musicTitle = text(info.track);
  const title = original || versions(track.title) && versions(track.title) !== versions(musicTitle) ? track.title : musicTitle || track.title;
  const artist = original ? track.artist || artistName(info.artist || info.artists) : artistName(info.artist || info.artists) || track.artist || text(info.uploader);
  return { title, artist, album: track.album || text(info.album), duration: Number(info.duration) || track.duration || 0,
    coverUrl: track.coverUrl || safeCoverUrl(info.thumbnail) || `https://i.ytimg.com/vi/${videoId(track.url)}/hqdefault.jpg`,
    sourceUrl: track.url, metadataProvider: track.metadataProvider, ...(track.spotifyId ? { spotifyId: track.spotifyId } : {}) };
}
const safeName = (value) => text(value, 180).replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 110);
function namesFor(metadata) {
  const display = safeName(`${metadata.artist ? `${metadata.artist} - ` : ''}${metadata.title}`) || '歌曲';
  return { name: `${display}-${videoId(metadata.sourceUrl)}.mp3`, displayName: `${display}.mp3` };
}
function matchPlaylistTrack(sourceTitle, entries) {
  const normalize = (value) => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(?:feat|ft|featuring)\.?\s+/g, 'feat ').replace(/\b(?:official|audio|video|lyrics?|visualizer|fan)\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  const source = normalize(sourceTitle);
  const versions = (value) => normalize(value).match(/\b(?:slowed|slow|sped|remix|live|acoustic|instrumental|nightcore|super|ultra)\b/g) || [];
  const candidates = entries.filter((entry) => {
    const title = normalize(entry.title);
    const withoutGuest = normalize(entry.title.replace(/\((?:feat\.?|ft\.?|with)\s+[^)]+\)/gi, ''));
    const primaryArtist = normalize(artistName(entry.artist).split(/,|&/)[0]);
    return title && ((` ${source} `).includes(` ${title} `) || withoutGuest !== title && primaryArtist && source.includes(primaryArtist) && (` ${source} `).includes(` ${withoutGuest} `))
      && versions(sourceTitle).sort().join() === versions(entry.title).sort().join();
  });
  if (candidates.length === 1) return candidates[0];
  const exact = candidates.filter((entry) => normalize(entry.title) === source);
  return exact.length === 1 ? exact[0] : null;
}
async function fetchCover(url, directory, fetchImpl) {
  const safe = safeCoverUrl(url);
  if (!safe) return null;
  const response = await fetchImpl(safe, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`封面返回 ${response.status}`);
  const limit = 8 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) throw new Error('封面过大。');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('封面过大。');
    chunks.push(Buffer.from(chunk));
  }
  const data = Buffer.concat(chunks);
  const jpeg = data[0] === 0xff && data[1] === 0xd8;
  const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  if (!jpeg && !png && !webp) throw new Error('封面不是可识别的图片。');
  const file = path.join(directory, `.cover-${crypto.randomUUID()}.${jpeg ? 'jpg' : png ? 'png' : 'webp'}`);
  fs.writeFileSync(file, data);
  return file;
}
function ffmpegMetadataArgs(input, output, metadata, cover) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input];
  if (cover) args.push('-i', cover);
  args.push('-map', '0:a:0');
  if (cover) args.push('-map', '1:v:0', '-c:v', 'mjpeg', '-frames:v', '1', '-disposition:v', 'attached_pic', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
  else args.push('-map', '0:v?', '-c:v', 'copy');
  args.push('-c:a', 'copy', '-map_metadata', '0', '-id3v2_version', '3');
  for (const field of ['title', 'artist', 'album']) if (metadata[field]) args.push('-metadata', `${field}=${text(metadata[field])}`);
  args.push('-metadata', `comment=Audio source: ${metadata.sourceUrl}`, '-metadata', `purl=${metadata.sourceUrl}`, '-f', 'mp3', output);
  return args;
}
function runMetadata(executable, args, { spawnProcess = spawn, onChild = () => {}, isCancelled = () => false } = {}) {
  if (isCancelled()) return Promise.reject(new Error('任务已取消。'));
  return new Promise((resolve, reject) => {
    const child = spawnProcess(executable, args, { windowsHide: true, shell: false });
    onChild(child, true);
    let errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('写入音乐标签超时。')); }, 60000);
    child.stderr?.on('data', (chunk) => { errors = (errors + chunk.toString()).slice(-2000); });
    child.once('error', (error) => { clearTimeout(timer); onChild(child, false); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); onChild(child, false); if (code === 0 && !isCancelled()) resolve(); else reject(new Error(errors || '无法写入音乐标签。')); });
  });
}
function id3End(file) {
  const size = fs.statSync(file).size;
  const header = Buffer.alloc(10);
  const descriptor = fs.openSync(file, 'r');
  try { fs.readSync(descriptor, header, 0, 10, 0); } finally { fs.closeSync(descriptor); }
  if (header.toString('ascii', 0, 3) !== 'ID3') return 0;
  if (![2, 3, 4].includes(header[3]) || header.subarray(6, 10).some((byte) => byte > 127)) throw new Error('MP3 标签头无效。');
  const end = 10 + ((header[6] << 21) | (header[7] << 14) | (header[8] << 7) | header[9]) + (header[3] === 4 && (header[5] & 16) ? 10 : 0);
  if (end > size) throw new Error('MP3 标签长度无效。');
  return end;
}
async function preserveAudioBytes(input, tagged, isCancelled) {
  // FFmpeg remuxing rewrites the Xing/LAME header and can change gapless trimming.
  // Keep its new ID3/APIC block, but retain the source's audio bytes and timing header exactly.
  const tagEnd = id3End(tagged);
  if (!tagEnd || tagEnd > 16 * 1024 * 1024) throw new Error('MP3 没有有效的新标签。');
  const prefix = Buffer.alloc(tagEnd);
  const descriptor = fs.openSync(tagged, 'r');
  try { fs.readSync(descriptor, prefix, 0, tagEnd, 0); } finally { fs.closeSync(descriptor); }
  const payloadStart = id3End(input);
  let payloadEnd = fs.statSync(input).size;
  if (payloadEnd - payloadStart >= 128) {
    const tail = Buffer.alloc(3); const original = fs.openSync(input, 'r');
    try { fs.readSync(original, tail, 0, 3, payloadEnd - 128); } finally { fs.closeSync(original); }
    if (tail.toString('ascii') === 'TAG') payloadEnd -= 128;
  }
  if (payloadEnd <= payloadStart) throw new Error('MP3 音频内容缺失。');
  const combined = `${tagged}.body`;
  try {
    fs.writeFileSync(combined, prefix);
    await pipeline(fs.createReadStream(input, { start: payloadStart, end: payloadEnd - 1 }), fs.createWriteStream(combined, { flags: 'a' }));
    if (isCancelled?.()) throw new Error('任务已取消。');
    fs.renameSync(combined, tagged);
  } finally { fs.rmSync(combined, { force: true }); }
}
async function writeMp3Metadata({ input, metadata, ffmpeg, fetchImpl = fetch, spawnProcess = spawn, onChild, isCancelled, backup = false }) {
  const directory = path.dirname(input);
  const temporary = path.join(directory, `.metadata-${crypto.randomUUID()}.mp3.tmp`);
  const names = namesFor(metadata);
  const output = path.join(directory, names.name);
  let cover; let downloadedCover; const warnings = [];
  try {
    try { downloadedCover = cover = await fetchCover(metadata.coverUrl, directory, fetchImpl); } catch (error) { warnings.push(`封面未写入：${error.message}`); }
    const options = { spawnProcess, onChild, isCancelled };
    try { await runMetadata(ffmpeg, ffmpegMetadataArgs(input, temporary, metadata, cover), options); }
    catch (error) {
      if (!cover || isCancelled?.()) throw error;
      warnings.push(`封面未写入：${error.message}`);
      fs.rmSync(temporary, { force: true });
      await runMetadata(ffmpeg, ffmpegMetadataArgs(input, temporary, metadata, null), options);
      cover = null;
    }
    if (!fs.existsSync(temporary) || fs.statSync(temporary).size === 0) throw new Error('标签写入未生成有效文件。');
    await preserveAudioBytes(input, temporary, isCancelled);
    if (output !== input && fs.existsSync(output)) throw new Error('同一音源的输出文件已存在。');
    if (backup) {
      const backupDir = path.join(directory, '.metadata-backup');
      fs.mkdirSync(backupDir, { recursive: true });
      const backupFile = path.join(backupDir, path.basename(input));
      if (!fs.existsSync(backupFile)) fs.copyFileSync(input, backupFile, fs.constants.COPYFILE_EXCL);
    }
    fs.renameSync(temporary, output);
    if (output !== input) fs.unlinkSync(input);
    return { ...names, size: fs.statSync(output).size, metadata: { ...metadata, coverEmbedded: Boolean(cover) }, ...(warnings.length ? { metadataWarnings: warnings } : {}) };
  } finally {
    if (downloadedCover) fs.rmSync(downloadedCover, { force: true });
    fs.rmSync(temporary, { force: true });
  }
}

module.exports = { normalizeTrack, spotifyEntity, parseSpotifyTrack, enrichSpotifyTrack, metadataFor, namesFor, matchPlaylistTrack, safeCoverUrl, videoId, ffmpegMetadataArgs, writeMp3Metadata };
