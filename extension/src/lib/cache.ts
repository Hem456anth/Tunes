// Stale-while-revalidate cache for InnerTube data. Memory first, then
// chrome.storage.local, so Home / Moods paint instantly on every open and
// only refresh in the background.
//
// v0.8.1: the prefix carries a schema version (data saved by an older build is
// never painted by a newer one), and a small index replaces the full-storage
// read that every write used to do to find old entries.
interface Entry<T> { at: number; data: T }
const mem = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
export const CACHE_PREFIX = 'c2:';
const INDEX = 'c2-index';
const LEGACY = /^c:/;
const MAX_KEYS = 40;

export async function readCache<T>(key: string): Promise<Entry<T> | null> {
  const m = mem.get(key) as Entry<T> | undefined;
  if (m) return m;
  try {
    const r = await chrome.storage.local.get(CACHE_PREFIX + key);
    const e = r[CACHE_PREFIX + key] as Entry<T> | undefined;
    if (e && typeof e.at === 'number') { mem.set(key, e); return e; }
    return null;
  } catch {
    return null;
  }
}

let writes = Promise.resolve();
function writeCache<T>(key: string, data: T): Promise<void> {
  const e = { at: Date.now(), data };
  mem.set(key, e);
  // serialised, so two writes never race on the index
  writes = writes.then(async () => {
    try {
      const { [INDEX]: idx0 } = await chrome.storage.local.get(INDEX);
      const idx: Record<string, number> = { ...(idx0 as Record<string, number> | undefined) };
      idx[key] = e.at;
      const keys = Object.keys(idx);
      const drop = keys.length > MAX_KEYS ? keys.sort((a, b) => idx[a] - idx[b]).slice(0, keys.length - MAX_KEYS) : [];
      drop.forEach((k) => delete idx[k]);
      await chrome.storage.local.set({ [CACHE_PREFIX + key]: e, [INDEX]: idx });
      if (drop.length) await chrome.storage.local.remove(drop.map((k) => CACHE_PREFIX + k));
    } catch { /* quota: memory cache still works */ }
  });
  return writes;
}

/** Fetch once per key at a time; store the result. */
export function refresh<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fetcher()
    .then(async (d) => { await writeCache(key, d); return d; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const isFresh = (e: { at: number } | null, ttlMs: number) => !!e && Date.now() - e.at < ttlMs;
export function clearMemory() { mem.clear(); }

/** Remove every cached page (memory and storage), including older builds' copies. */
export async function clearAllCache() {
  mem.clear();
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX) || k === INDEX || LEGACY.test(k)));
}

/** One-time cleanup of the unversioned cache left by builds before 0.8.1. */
export async function dropLegacyCache() {
  const all = await chrome.storage.local.get(null);
  const old = Object.keys(all).filter((k) => LEGACY.test(k));
  if (old.length) await chrome.storage.local.remove(old);
}
