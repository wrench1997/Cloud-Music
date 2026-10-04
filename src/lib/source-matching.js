const normalize = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function recommendSource(track, candidates) {
  const title = normalize(track.title);
  const artist = normalize(track.artist);
  if (!title || !artist) return null;
  return candidates.map((candidate) => {
    const text = normalize(`${candidate.title} ${candidate.artist}`);
    const duration = Math.abs(Number(candidate.duration || 0) - Number(track.duration || 0));
    const containsTitle = text.includes(title);
    const containsArtist = text.includes(artist);
    const validDuration = track.duration > 0 && candidate.duration > 0 && duration <= Math.max(8, track.duration * 0.05);
    return { candidate, score: (containsTitle ? 4 : 0) + (containsArtist ? 3 : 0) + (validDuration ? 2 : 0), duration, eligible: containsTitle && containsArtist && validDuration };
  }).filter((item) => item.eligible).sort((left, right) => right.score - left.score || left.duration - right.duration)[0]?.candidate || null;
}
