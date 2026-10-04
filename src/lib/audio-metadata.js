// ID3v2.3/2.4 frame layouts: https://id3.org/id3v2.3.0 and https://id3.org/id3v2.4.0-structure
const MAX_TAG_BYTES = 32 * 1024 * 1024;
const MAX_PICTURE_BYTES = 5 * 1024 * 1024;
const textEncoder = new TextEncoder();

function uint32(bytes, offset = 0) {
  return bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3];
}

function synchsafe(bytes, offset = 0) {
  if (bytes.slice(offset, offset + 4).some((byte) => byte & 128)) return NaN;
  return bytes[offset] * 2097152 + bytes[offset + 1] * 16384 + bytes[offset + 2] * 128 + bytes[offset + 3];
}

function latin1(bytes) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return value;
}

function deunsynchronise(bytes) {
  const result = new Uint8Array(bytes.length);
  let length = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    result[length++] = bytes[index];
    if (bytes[index] === 255 && bytes[index + 1] === 0) index += 1;
  }
  return result.subarray(0, length);
}

function decodeText(bytes) {
  if (!bytes.length) return '';
  const encoding = bytes[0];
  const data = bytes.subarray(1);
  let value;
  if (encoding === 0) value = latin1(data);
  else if (encoding === 1) value = new TextDecoder(data[0] === 254 && data[1] === 255 ? 'utf-16be' : 'utf-16le').decode(data);
  else if (encoding === 2) value = new TextDecoder('utf-16be').decode(data);
  else if (encoding === 3) value = new TextDecoder('utf-8').decode(data);
  else return '';
  return value.split('\0').map((part) => part.replace(/[\u0001-\u001f\u007f]/g, '').trim()).filter(Boolean).join(' / ');
}

function pictureMime(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  return '';
}

function parsePicture(bytes) {
  const encoding = bytes[0];
  if (encoding > 3) return null;
  const mimeEnd = bytes.indexOf(0, 1);
  if (mimeEnd < 0 || mimeEnd + 2 >= bytes.length) return null;
  const mime = latin1(bytes.subarray(1, mimeEnd)).toLowerCase();
  const declaredMime = mime && !mime.includes('/') ? `image/${mime}` : mime;
  const type = bytes[mimeEnd + 1];
  const start = mimeEnd + 2;
  const width = encoding === 1 || encoding === 2 ? 2 : 1;
  let descriptionEnd = -1;
  for (let index = start; index + width <= bytes.length; index += width) {
    if (bytes[index] === 0 && (width === 1 || bytes[index + 1] === 0)) { descriptionEnd = index + width; break; }
  }
  if (descriptionEnd < 0) return null;
  const data = bytes.slice(descriptionEnd);
  const mimeType = pictureMime(data);
  // Linked pictures and SVG are not followed or embedded as Drive thumbnails.
  if (!mimeType || !data.length || data.length > MAX_PICTURE_BYTES || (declaredMime && declaredMime !== mimeType && !(declaredMime === 'image/jpg' && mimeType === 'image/jpeg'))) return null;
  return { mimeType, data, type };
}

function parseId3(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (bytes.length < 10 || latin1(bytes.subarray(0, 3)) !== 'ID3' || ![3, 4].includes(bytes[3])) return {};
  const version = bytes[3];
  const flags = bytes[5];
  const tagSize = synchsafe(bytes, 6);
  if (!Number.isFinite(tagSize) || tagSize > MAX_TAG_BYTES || tagSize + 10 > bytes.length) return {};
  let body = bytes.subarray(10, tagSize + 10);
  if (version === 3 && (flags & 128)) body = deunsynchronise(body);
  let offset = 0;
  if (flags & 64) {
    if (body.length < 4) return {};
    const size = version === 4 ? synchsafe(body) : uint32(body) + 4;
    if (!Number.isFinite(size) || size < (version === 4 ? 6 : 10) || size > body.length) return {};
    offset = size;
  }
  const metadata = {};
  const fields = { TIT2: 'title', TPE1: 'artist', TALB: 'album' };
  while (offset + 10 <= body.length) {
    const frameId = latin1(body.subarray(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
    const size = version === 4 ? synchsafe(body, offset + 4) : uint32(body, offset + 4);
    const formatFlags = body[offset + 9];
    if (!Number.isFinite(size) || size <= 0 || offset + 10 + size > body.length) break;
    let data = body.subarray(offset + 10, offset + 10 + size);
    offset += 10 + size;
    if (version === 3) {
      if (formatFlags & 192) continue; // Compressed or encrypted frames require a separate decoder.
      if (formatFlags & 32) data = data.subarray(1);
    } else {
      if (formatFlags & 12) continue;
      if ((flags & 128) || (formatFlags & 2)) data = deunsynchronise(data);
      if (formatFlags & 64) data = data.subarray(1);
      if (formatFlags & 1) data = data.subarray(4);
    }
    if (fields[frameId]) {
      const text = decodeText(data);
      if (text && !metadata[fields[frameId]]) metadata[fields[frameId]] = text;
    } else if (frameId === 'TLEN') {
      const milliseconds = Number(decodeText(data));
      if (Number.isFinite(milliseconds) && milliseconds > 0) metadata.duration = milliseconds / 1000;
    } else if (frameId === 'APIC') {
      const picture = parsePicture(data);
      if (picture && (!metadata.picture || picture.type === 3)) metadata.picture = picture;
    }
  }
  return metadata;
}

async function readAudioMetadata(file, { signal } = {}) {
  signal?.throwIfAborted();
  if (!/\.mp3$/i.test(file.name || '') && file.type !== 'audio/mpeg') return {};
  const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  signal?.throwIfAborted();
  const size = id3TagLength(header, file.size);
  if (!size) return {};
  const bytes = new Uint8Array(await file.slice(0, size).arrayBuffer());
  signal?.throwIfAborted();
  return parseId3(bytes);
}

function id3TagLength(header, fileSize = Infinity) {
  if (header.length < 10 || latin1(header.subarray(0, 3)) !== 'ID3' || ![3, 4].includes(header[3])) return 0;
  const size = synchsafe(header, 6);
  return Number.isFinite(size) && size <= MAX_TAG_BYTES && size + 10 <= fileSize ? size + 10 : 0;
}

function truncateUtf8(value, maxBytes) {
  let result = '';
  let length = 0;
  for (const character of String(value)) {
    const size = textEncoder.encode(character).length;
    if (length + size > maxBytes) break;
    result += character;
    length += size;
  }
  return result;
}

function httpsUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function metadataProperties(metadata = {}) {
  const properties = {};
  for (const key of ['title', 'artist', 'album']) {
    if (typeof metadata[key] === 'string' && metadata[key].trim()) properties[key] = truncateUtf8(metadata[key].trim(), 124 - textEncoder.encode(key).length);
  }
  if (metadata.duration !== undefined && metadata.duration !== null && Number.isFinite(Number(metadata.duration)) && Number(metadata.duration) >= 0) properties.duration = String(Number(metadata.duration));
  for (const key of ['coverUrl', 'sourceUrl']) {
    const url = httpsUrl(metadata[key]);
    // A truncated URL would silently point at the wrong resource.
    if (url && textEncoder.encode(key + url).length <= 124) properties[key] = url;
  }
  return properties;
}

function thumbnailFromMetadata(metadata = {}) {
  const picture = metadata.picture;
  if (!picture?.data) return null;
  const bytes = picture.data instanceof Uint8Array ? picture.data : new Uint8Array(picture.data);
  const mimeType = pictureMime(bytes);
  if (!mimeType || bytes.length > MAX_PICTURE_BYTES) return null;
  let binary = '';
  for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return { mimeType, image: btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
}

function mergeAudioMetadata(embedded, explicit) {
  const merged = { ...embedded };
  for (const key of ['title', 'artist', 'album', 'coverUrl', 'sourceUrl']) {
    if (typeof explicit?.[key] === 'string' && explicit[key].trim()) merged[key] = explicit[key].trim();
  }
  if (explicit?.duration !== undefined && explicit?.duration !== null && Number.isFinite(Number(explicit.duration)) && Number(explicit.duration) >= 0) merged.duration = Number(explicit.duration);
  if (explicit?.picture) merged.picture = explicit.picture;
  return merged;
}

function musicFileName(metadata, extension = '.mp3') {
  const title = metadata?.title?.trim();
  if (!title) return '';
  const artist = metadata?.artist?.trim();
  const name = `${artist ? `${artist} - ` : ''}${title}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').replace(/[. ]+$/, '');
  return `${truncateUtf8(name, 220)}${extension}`;
}

module.exports = { MAX_TAG_BYTES, id3TagLength, parseId3, readAudioMetadata, truncateUtf8, httpsUrl, metadataProperties, thumbnailFromMetadata, mergeAudioMetadata, musicFileName };
