// Import a Tunes export (Settings → Your data → Export data). Pure merge logic
// lives in mergeBackup() so it can be tested without Chrome.
import { DEFAULT_SETTINGS, type Settings } from './types';

/** Keys an import may write. Caches, visitor ids and the live queue are never restored. */
export const IMPORT_KEYS = ['settings', 'libSongs', 'libCollections', 'localPlaylists', 'suggestLess', 'liked', 'recentlyPlayed', 'recentSearches', 'lyricsPrefs', 'blocked', 'podcastSubs', 'podcastProgress'] as const;
type Store = Record<string, unknown>;
const SECRET_SETTINGS: (keyof Settings)[] = ['listenbrainzToken', 'lastfmSecret', 'lastfmSession', 'lastfmKey', 'lastfmUser'];

export interface ImportSummary { songs: number; playlists: number; liked: number; other: string[] }

/** Parse and validate an export file. Throws a plain-language error. */
export function parseBackup(text: string): Store {
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error('That file isn’t a Tunes export (it isn’t valid JSON).'); }
  const data = j?.data;
  if (!j || typeof data !== 'object' || data === null || (j.app !== 'Tunes' && j.app !== 'BitChord')) throw new Error('That file isn’t a Tunes export.');
  return data as Store;
}

const keyOf = (x: any): string => x?.videoId ?? x?.browseId ?? x?.playlistId ?? x?.id ?? x?.feedUrl ?? x?.guid ?? JSON.stringify(x);

/** Merge an export into what's stored now. Lists are unioned (yours first), settings keep your secrets. */
export function mergeBackup(current: Store, incoming: Store): { next: Store; summary: ImportSummary } {
  const next: Store = {};
  const summary: ImportSummary = { songs: 0, playlists: 0, liked: 0, other: [] };
  for (const k of IMPORT_KEYS) {
    const v = incoming[k];
    if (v === undefined) continue;
    if (k === 'settings') {
      if (typeof v !== 'object' || !v) continue;
      const cur = { ...DEFAULT_SETTINGS, ...(current.settings as Partial<Settings> ?? {}) };
      const merged: Record<string, unknown> = { ...cur };
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        if (!(sk in DEFAULT_SETTINGS) || SECRET_SETTINGS.includes(sk as keyof Settings)) continue;
        if (typeof sv !== typeof (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[sk]) continue;
        merged[sk] = sv;
      }
      next.settings = merged; summary.other.push('settings');
      continue;
    }
    if (k === 'lyricsPrefs' || k === 'podcastProgress') {
      if (typeof v === 'object' && v) { next[k] = { ...(v as object), ...((current[k] as object) ?? {}) }; summary.other.push(k); }
      continue;
    }
    if (!Array.isArray(v)) continue;
    const have = Array.isArray(current[k]) ? (current[k] as unknown[]) : [];
    const seen = new Set(have.map(keyOf));
    const add = v.filter((x) => x != null && !seen.has(keyOf(x)) && (seen.add(keyOf(x)), true));
    next[k] = [...have, ...add];
    if (k === 'libSongs') summary.songs += add.length;
    else if (k === 'localPlaylists') summary.playlists += add.length;
    else if (k === 'liked') summary.liked += add.length;
    else if (add.length) summary.other.push(k);
  }
  return { next, summary };
}

export async function importBackup(text: string): Promise<ImportSummary> {
  const incoming = parseBackup(text);
  const current = await chrome.storage.local.get([...IMPORT_KEYS]);
  const { next, summary } = mergeBackup(current, incoming);
  await chrome.storage.local.set(next);
  return summary;
}
