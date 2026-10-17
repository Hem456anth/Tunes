// Turns tracks from another service into playable YouTube Music songs and
// saves them: as a Tunes playlist (or into Liked songs), and optionally as
// a private playlist / likes in your YouTube Music account.
import type { Track } from '../types';
import { createPlaylist, likeOnYouTubeMusic, searchSongs } from '../innertube';
import { score, titleParts, toSeconds } from '../matcher';
import { getLiked } from '../history';
import type { SourceTrack } from './sources';

export interface ImportedPlaylist {
  id: string; title: string; source: string; image?: string; tracks: Track[];
  missed: SourceTrack[]; ytmPlaylistId?: string; at: number;
}
const KEY = 'importedPlaylists';
export async function getImported(): Promise<ImportedPlaylist[]> {
  return ((await chrome.storage.local.get(KEY))[KEY] as ImportedPlaylist[]) ?? [];
}
export async function deleteImported(id: string) {
  await chrome.storage.local.set({ [KEY]: (await getImported()).filter((p) => p.id !== id) });
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\u0900-\u0dff ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Spotify/Apple decorations YouTube Music doesn't use. */
const clean = (t: string) => t.replace(/\s+-\s+(\d{4}\s+)?(remaster(ed)?|single version|mono|stereo)(\s+\d{4})?$/i, '').replace(/\s*\((feat|ft|with)\.? [^)]*\)/i, '').trim();
const leadArtist = (a: string) => a.split(/,|&| x | feat\.? | ft\.? | and /i)[0].trim();

// Matches survive between imports (and re-imports), so a second run is fast
// and gentle on YouTube Music's rate limit.
const MATCH_KEY = 'transferMatches';
let memo: Map<string, Track | null> | null = null;
let memoDirty: ReturnType<typeof setTimeout> | null = null;
async function loadMemo() {
  if (memo) return memo;
  try { memo = new Map(Object.entries(((await chrome.storage.local.get(MATCH_KEY))[MATCH_KEY] as Record<string, Track | null>) ?? {})); }
  catch { memo = new Map(); }
  return memo;
}
function remember(k: string, v: Track | null) {
  memo!.set(k, v);
  if (memoDirty) return;
  memoDirty = setTimeout(() => {
    memoDirty = null;
    // keep the newest 3000 and don't persist misses (the catalogue grows)
    const entries = [...memo!.entries()].filter(([, x]) => x).slice(-3000);
    try { chrome.storage.local.set({ [MATCH_KEY]: Object.fromEntries(entries) }); } catch { /* node tests */ }
  }, 1500);
}

const tokens = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 1));
const overlap = (a: string, b: string) => {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  const inter = [...x].filter((w) => y.has(w)).length;
  return inter / Math.min(x.size, y.size);
};
/** "Song - From \"Film\"", "Song (From Film)", "Song [Live]" -> the title proper, keeping version words. */
const titleProper = (t: string) => clean(t).replace(/\s+-\s+from\s+.*$/i, '').replace(/\s*\((from|taken from)\s[^)]*\)/i, '').trim();

async function searchRetry(q: string): Promise<Track[]> {
  for (let tries = 0; tries < 4; tries++) {
    try { return await searchSongs(q); }
    catch (e: any) {
      // YouTube Music rate-limits bursts; back off instead of calling it a miss.
      if (/\(429\)|too long|connection/i.test(String(e?.message))) { await new Promise((r) => setTimeout(r, 1500 * (tries + 1))); continue; }
      return [];
    }
  }
  return [];
}

function rate(t: SourceTrack, title: string, r: Track): number {
  const c = { title: clean(r.title), artist: r.artists, durationSec: toSeconds(r.duration) };
  const target = { title, artist: t.artist, durationSec: t.durationSec, tolerance: 6 };
  let s = score(target, c) || score({ ...target, title: titleProper(t.title) }, { ...c, title: titleProper(r.title) });
  const artistOk = norm(c.artist).includes(norm(leadArtist(t.artist))) || norm(t.artist).includes(norm(leadArtist(c.artist)));
  const dDiff = t.durationSec && c.durationSec ? Math.abs(t.durationSec - c.durationSec) : null;
  if (!s) {
    // Looser: same lead artist, one title contains the other, same length.
    const a = titleParts(title).words, b = titleParts(c.title).words;
    if (a && b && (a.includes(b) || b.includes(a)) && dDiff != null && dDiff <= 3 && artistOk) s = 30;
  }
  if (!s && dDiff != null && dDiff <= 2 && artistOk && overlap(titleProper(t.title), titleProper(r.title)) >= 0.6) {
    // Transliterated or re-punctuated titles ("Naatu Naatu" vs "Naatu Naatu (Telugu)"):
    // most words shared, same lead artist and near-identical runtime.
    s = 25;
  }
  if (s && t.album && r.album) s += norm(r.album) === norm(t.album) ? 8 : overlap(t.album, r.album) >= 0.6 ? 4 : 0;
  return s;
}

/** Best YouTube Music song for a track from another service, or null when nothing is a safe match. */
export async function matchTrack(t: SourceTrack): Promise<Track | null> {
  const m = await loadMemo();
  const k = norm(`${t.title}|${t.artist}|${t.durationSec ?? ''}`);
  if (m.has(k)) return m.get(k)!;
  const title = clean(t.title);
  let found: Track | null = null, foundScore = 0;
  const queries = [...new Set([`${title} ${leadArtist(t.artist)}`, `${titleProper(t.title)} ${leadArtist(t.artist)}`, `${title} ${t.artist}`, title])];
  for (const q of queries) {
    const rows = await searchRetry(q);
    for (const r of rows.slice(0, 10)) {
      const sc = rate(t, title, r);
      if (sc > foundScore) { found = r; foundScore = sc; }
    }
    // A strong hit (title + artist + runtime agree) ends the search early.
    if (foundScore >= 90) break;
    if (found && q !== queries[0]) break;
  }
  remember(k, found);
  return found;
}

export interface Progress { done: number; total: number; matched: number; phase: 'reading' | 'matching' | 'saving' | 'done'; note?: string }

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>, tick: () => void): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); tick(); }
  }));
  return out;
}

export async function runImport(opts: {
  title: string; source: string; image?: string; tracks: SourceTrack[]; asLiked: boolean; toYouTube: boolean;
  onProgress: (p: Progress) => void; signal?: { cancelled: boolean };
}): Promise<{ matched: Track[]; missed: SourceTrack[]; ytm?: string; ytmError?: string }> {
  const { tracks, onProgress } = opts;
  let done = 0, matched = 0;
  const res = await pool(tracks, 4, async (t) => {
    if (opts.signal?.cancelled) return null;
    const m = await matchTrack(t);
    if (m) matched++;
    return m;
  }, () => { done++; onProgress({ done, total: tracks.length, matched, phase: 'matching' }); });
  if (opts.signal?.cancelled) throw new Error('Import cancelled');
  const seen = new Set<string>();
  const ok: Track[] = [];
  const missed: SourceTrack[] = [];
  res.forEach((m, i) => { if (!m) missed.push(tracks[i]); else if (!seen.has(m.videoId)) { seen.add(m.videoId); ok.push(m); } });

  onProgress({ done, total: tracks.length, matched, phase: 'saving' });
  let ytm: string | undefined, ytmError: string | undefined;
  if (opts.asLiked) {
    const liked = await getLiked();
    const have = new Set(liked.map((x) => x.videoId));
    await chrome.storage.local.set({ liked: [...ok.filter((x) => !have.has(x.videoId)), ...liked] });
    if (opts.toYouTube && ok.length) {
      try {
        let n = 0;
        await pool(ok, 3, (x) => likeOnYouTubeMusic(x.videoId), () => onProgress({ done: ++n, total: ok.length, matched, phase: 'saving', note: 'Liking on YouTube Music' }));
        ytm = 'LM';
      } catch (e: any) { ytmError = String(e?.message ?? e); }
    }
  } else {
    if (opts.toYouTube && ok.length) {
      try { ytm = await createPlaylist(opts.title, `Moved from ${opts.source} with Tunes`, ok.map((x) => x.videoId)); }
      catch (e: any) { ytmError = String(e?.message ?? e); }
    }
    // Importing the same playlist again replaces the old copy.
    const list = (await getImported()).filter((p) => !(p.source === opts.source && p.title === opts.title));
    const id = `${opts.source.toLowerCase().replace(/\s+/g, '-')}:${Date.now()}`;
    list.unshift({ id, title: opts.title, source: opts.source, image: opts.image ?? ok[0]?.thumbnail, tracks: ok, missed, ytmPlaylistId: ytm, at: Date.now() });
    await chrome.storage.local.set({ [KEY]: list });
  }
  onProgress({ done, total: tracks.length, matched, phase: 'done' });
  return { matched: ok, missed, ytm, ytmError };
}
