import { useEffect, useState } from 'react';
import { artworkSource } from '../lib/artwork-source';

export default function SongArtwork({ song, api, fallback }) {
  const [loaded, setLoaded] = useState({});
  const thumbnailLink = song?.thumbnailLink;
  const songId = song?.id;
  const hasArtwork = song?.hasArtwork;
  const key = `${songId || ''}:${song?.coverUrl || ''}:${thumbnailLink || ''}:${hasArtwork || ''}`;
  const cover = artworkSource(song, typeof window === 'undefined' ? '' : window.location.origin);
  const externalFailed = Boolean(loaded.key === key && loaded.externalFailed);
  const thumbnailFailed = Boolean(loaded.key === key && loaded.thumbnailFailed);
  const image = loaded.key === key && loaded.url ? loaded.url : !externalFailed ? cover : '';
  useEffect(() => {
    let active = true;
    let objectUrl;
    const controller = new AbortController();
    if (song?.localUri || (cover && !externalFailed) || thumbnailFailed || (!thumbnailLink && !hasArtwork) || !api?.artwork) return undefined;
    api.artwork({ id: songId, thumbnailLink, hasArtwork }, { signal: controller.signal }).then((blob) => {
      if (!active || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setLoaded({ key, url: objectUrl, externalFailed, thumbnailFailed: false });
    }).catch(() => {});
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [key, cover, externalFailed, thumbnailFailed, songId, thumbnailLink, hasArtwork, api, song?.localUri]);
  return image ? <img src={image} alt={`${song?.title || '歌曲'}封面`} loading="lazy" decoding="async" onError={() => setLoaded({ key, externalFailed: true, thumbnailFailed: image.startsWith('blob:') })} /> : fallback; // eslint-disable-line @next/next/no-img-element
}
