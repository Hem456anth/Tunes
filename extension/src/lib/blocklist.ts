// Songs and artists you never want to hear. Autoplay, radio and the queue skip
// them when they come up on their own; a song you pick yourself still plays.
import type { Track } from './types';

export interface BlockedSong { videoId: string; title: string; artists: string; thumbnail?: string; at: number }
export interface BlockedArtist { name: string; id?: string; at: number }
export interface Blocked { songs: BlockedSong[]; artists: BlockedArtist[] }
export const BLOCKED = 'blocked';

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
/** Artist names in a credit line ("A, B & C feat. D"). */
export const creditNames = (artists: string) => artists.split(/,|&| x | feat\.? | ft\.? |\band\b/i).map(norm).filter(Boolean);
export const leadArtist = (t: Pick<Track, 'artists'>) => t.artists.split(/,|&| x | feat\.? | ft\.? /i)[0].trim();

export function isBlocked(t: Pick<Track, 'videoId' | 'artists' | 'artistId' | 'podcast'>, b: Blocked): boolean {
  if (t.podcast) return false;
  if (b.songs.some((s) => s.videoId === t.videoId)) return true;
  if (!b.artists.length) return false;
  const names = creditNames(t.artists);
  return b.artists.some((a) => (a.id && a.id === t.artistId) || names.includes(norm(a.name)));
}

export async function getBlocked(): Promise<Blocked> {
  const v = (await chrome.storage.local.get(BLOCKED))[BLOCKED] as Partial<Blocked> | undefined;
  return { songs: v?.songs ?? [], artists: v?.artists ?? [] };
}
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> { const r = chain.then(fn); chain = r.catch(() => {}); return r; }
const save = (b: Blocked) => chrome.storage.local.set({ [BLOCKED]: { songs: b.songs.slice(0, 2000), artists: b.artists.slice(0, 500) } });

export function blockSong(t: Track, on = true): Promise<void> {
  return locked(async () => {
    const b = await getBlocked();
    b.songs = b.songs.filter((s) => s.videoId !== t.videoId);
    if (on) b.songs.unshift({ videoId: t.videoId, title: t.title, artists: t.artists, thumbnail: t.thumbnail, at: Date.now() });
    await save(b);
  });
}
export function blockArtist(name: string, id?: string, on = true): Promise<void> {
  return locked(async () => {
    const b = await getBlocked();
    b.artists = b.artists.filter((a) => norm(a.name) !== norm(name) && (!id || a.id !== id));
    if (on) b.artists.unshift({ name, id, at: Date.now() });
    await save(b);
  });
}
