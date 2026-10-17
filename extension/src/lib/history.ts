import type { Track } from './types';

const KEY = 'recentlyPlayed';
const MAX = 50;

export async function getRecent(): Promise<Track[]> {
  const r = await chrome.storage.local.get(KEY);
  return (r[KEY] as Track[]) ?? [];
}

export async function pushRecent(t: Track): Promise<void> {
  const list = (await getRecent()).filter((x) => x.videoId !== t.videoId);
  list.unshift(t);
  await chrome.storage.local.set({ [KEY]: list.slice(0, MAX) });
}

const LIKED = 'liked';
export async function getLiked(): Promise<Track[]> {
  return ((await chrome.storage.local.get(LIKED))[LIKED] as Track[]) ?? [];
}
export async function toggleLiked(t: Track): Promise<boolean> {
  const list = await getLiked();
  const has = list.some((x) => x.videoId === t.videoId);
  const next = has ? list.filter((x) => x.videoId !== t.videoId) : [t, ...list];
  await chrome.storage.local.set({ [LIKED]: next });
  return !has;
}
