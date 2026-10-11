// Keep recent playlist reads in memory, including edits to source choices.
export function createPlaylistReader({ lifetime = 5 * 60 * 1000, limit = 8, now = Date.now } = {}) {
  const records = new Map();
  return {
    read(key, load) {
      const saved = records.get(key);
      if (saved && (saved.pending || saved.expires > now())) {
        records.delete(key); records.set(key, saved);
        return saved.pending || Promise.resolve(saved.value);
      }
      const record = {};
      record.pending = Promise.resolve().then(load).then((value) => {
        record.value = value; record.expires = now() + lifetime; record.pending = null;
        return value;
      }, (error) => {
        if (records.get(key) === record) records.delete(key);
        throw error;
      });
      records.delete(key); records.set(key, record);
      while (records.size > limit) records.delete(records.keys().next().value);
      return record.pending;
    },
    update(key, changes) {
      const saved = records.get(key);
      if (saved?.value && !saved.pending) saved.value = { ...saved.value, ...changes };
    },
    invalidate(key) { records.delete(key); },
  };
}
