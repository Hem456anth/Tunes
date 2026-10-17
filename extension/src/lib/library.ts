// Tunes's own library, kept in chrome.storage.local (works signed out, like
// Apple Music's library): songs, albums and playlists you added, your
// playlists, and the songs you asked to hear less of.
import type { Card, Track } from './types';

export interface LibSong extends Track { addedAt: number }
export interface LibCollection extends Card { addedAt: number }
export interface LocalPlaylist { id: string; title: string; tracks: Track[]; created: number; updated: number }

const SONGS = 'libSongs', COLLS = 'libCollections', LISTS = 'localPlaylists', LESS = 'suggestLess';
export const LIBRARY_KEYS = [SONGS, COLLS, LISTS, LESS, 'liked'];

async function read<T>(k: string): Promise<T[]> { return ((await chrome.storage.local.get(k))[k] as T[]) ?? []; }
const write = (k: string, v: unknown) => chrome.storage.local.set({ [k]: v });
// Read-modify-write is chained so two quick taps never drop one.
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}
/** A song without the queue/UI-only fields, so stored rows stay small. */
function clean(t: Track): Track {
  const { videoId, title, artists, album, thumbnail, duration, artistId, saavn, language, releaseDate } = t;
  return Object.fromEntries(Object.entries({ videoId, title, artists, album, thumbnail, duration, artistId, saavn, language, releaseDate }).filter(([, v]) => v !== undefined)) as unknown as Track;
}

// ---------- songs ----------
export const getLibSongs = () => read<LibSong>(SONGS);
export async function inLibrary(id: string) { return (await getLibSongs()).some((x) => x.videoId === id); }
export function setInLibrary(t: Track, on: boolean): Promise<boolean> {
  return locked(async () => {
    const list = (await getLibSongs()).filter((x) => x.videoId !== t.videoId);
    if (on) list.unshift({ ...clean(t), addedAt: Date.now() });
    await write(SONGS, list);
    return on;
  });
}
/** Adds songs that are not in the library yet; returns how many were new. */
export function addSongsToLibrary(ts: Track[]): Promise<number> {
  return locked(async () => {
    const list = await getLibSongs();
    const have = new Set(list.map((x) => x.videoId));
    const fresh = ts.filter((t) => !have.has(t.videoId) && have.add(t.videoId)).map((t) => ({ ...clean(t), addedAt: Date.now() }));
    await write(SONGS, [...fresh, ...list]);
    return fresh.length;
  });
}

// ---------- albums and playlists from the catalogue ----------
export const collKey = (c: Card) => c.browseId || c.playlistId || `${c.kind}:${c.title}`;
export const getLibCollections = () => read<LibCollection>(COLLS);
export async function collInLibrary(c: Card) { const k = collKey(c); return (await getLibCollections()).some((x) => collKey(x) === k); }
export function setCollInLibrary(c: Card, on: boolean): Promise<boolean> {
  return locked(async () => {
    const k = collKey(c);
    const list = (await getLibCollections()).filter((x) => collKey(x) !== k);
    if (on) list.unshift({ kind: c.kind, title: c.title, subtitle: c.subtitle, thumbnail: c.thumbnail, browseId: c.browseId, playlistId: c.playlistId, videoId: c.videoId, addedAt: Date.now() });
    await write(COLLS, list);
    return on;
  });
}

// ---------- your playlists ----------
export const getPlaylists = () => read<LocalPlaylist>(LISTS);
export function createPlaylist(title: string, tracks: Track[] = []): Promise<LocalPlaylist> {
  return locked(async () => {
    const name = title.trim() || 'New Playlist';
    const seen = new Set<string>();
    const p: LocalPlaylist = { id: `pl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: name.slice(0, 100), tracks: tracks.filter((t) => !seen.has(t.videoId) && seen.add(t.videoId)).map(clean), created: Date.now(), updated: Date.now() };
    await write(LISTS, [p, ...(await getPlaylists())]);
    return p;
  });
}
/** Adds songs to one of your playlists; songs already in it are skipped. Returns how many were added. */
export function addToPlaylist(id: string, tracks: Track[]): Promise<number> {
  return locked(async () => {
    const lists = await getPlaylists();
    const p = lists.find((x) => x.id === id);
    if (!p) throw new Error('That playlist is gone');
    const have = new Set(p.tracks.map((x) => x.videoId));
    const fresh = tracks.filter((t) => !have.has(t.videoId) && have.add(t.videoId)).map(clean);
    p.tracks.push(...fresh); p.updated = Date.now();
    await write(LISTS, lists);
    return fresh.length;
  });
}
export function removeFromPlaylist(id: string, videoId: string): Promise<void> {
  return locked(async () => {
    const lists = await getPlaylists();
    const p = lists.find((x) => x.id === id);
    if (p) { p.tracks = p.tracks.filter((t) => t.videoId !== videoId); p.updated = Date.now(); }
    await write(LISTS, lists);
  });
}
export function renamePlaylist(id: string, title: string): Promise<void> {
  return locked(async () => {
    const lists = await getPlaylists();
    const p = lists.find((x) => x.id === id);
    if (p && title.trim()) { p.title = title.trim().slice(0, 100); p.updated = Date.now(); }
    await write(LISTS, lists);
  });
}
export function deletePlaylist(id: string): Promise<void> {
  return locked(async () => write(LISTS, (await getPlaylists()).filter((x) => x.id !== id)));
}
/** A playlist as a card, so it shows in grids and opens like any other. */
export const playlistCard = (p: LocalPlaylist): Card => ({ kind: 'playlist', title: p.title, subtitle: `${p.tracks.length} ${p.tracks.length === 1 ? 'song' : 'songs'}`, thumbnail: p.tracks[0]?.thumbnail ?? '', browseId: `local:${p.id}` });
export const localId = (c: Card) => (c.browseId?.startsWith('local:') ? c.browseId.slice(6) : null);

// ---------- suggest less ----------
export const getSuggestLess = () => read<string>(LESS);
export function setSuggestLess(id: string, on: boolean): Promise<boolean> {
  return locked(async () => {
    const list = (await getSuggestLess()).filter((x) => x !== id);
    if (on) list.unshift(id);
    await write(LESS, list.slice(0, 2000));
    return on;
  });
}
