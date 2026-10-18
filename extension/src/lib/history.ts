import type { Track } from './types';

const KEY = 'recentlyPlayed';
const MAX = 50;

export async function getRecent(): Promise<Track[]> {
  const r = await chrome.storage.local.get(KEY);
  return (r[KEY] as Track[]) ?? [];
}

// Read-modify-write runs one at a time: two quick taps never drop a change.
let lock: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn);
  lock = run.catch(() => {});
  return run;
}

export function pushRecent(t: Track): Promise<void> {
  return locked(async () => {
    const list = (await getRecent()).filter((x) => x.videoId !== t.videoId);
    list.unshift(t);
    await chrome.storage.local.set({ [KEY]: list.slice(0, MAX) });
  });
}

const LIKED = 'liked';
export async function getLiked(): Promise<Track[]> {
  return ((await chrome.storage.local.get(LIKED))[LIKED] as Track[]) ?? [];
}
export function toggleLiked(t: Track): Promise<boolean> {
  return locked(async () => {
    const list = await getLiked();
    const has = list.some((x) => x.videoId === t.videoId);
    const next = has ? list.filter((x) => x.videoId !== t.videoId) : [t, ...list];
    await chrome.storage.local.set({ [LIKED]: next });
    return !has;
  });
}
