// Discover: the newest songs from several catalogues, not just YouTube Music.
//
// Sources (all public, no sign-in, checked live 14 Oct 2026):
//  - JioSaavn  content.getAlbums&languages=<lang>   new releases per language,
//              playable directly (encrypted_media_url), label, release date, 500px art
//              webapi.get&type=album                  the songs of a new album
//  - Apple     itunes.apple.com/<cc>/rss/topsongs/genre=<id>   charts per language/genre
//              itunes.apple.com/lookup?id=…                    runtime, genre, release date,
//                                                              official artwork up to 1000px
//  - Deezer    api.deezer.com/chart/<genre>/tracks             trending charts, 1000px covers
// Each song is merged across sources (same title proper + lead artist), keeps
// the best official cover art, and gets a language from the catalogue (JioSaavn,
// Apple's regional genre) or, failing that, from the script of its title.
import type { Track } from './types';
import { titleParts } from './matcher';

export type DiscoverSource = 'jiosaavn' | 'apple' | 'deezer';
export interface DiscoverTrack extends Track {
  language: string;
  genre?: string;
  releaseDate?: string; // YYYY-MM-DD
  label?: string;
  sources: DiscoverSource[];
}
export interface DiscoverSection { id: string; title: string; sub?: string; tracks: DiscoverTrack[] }

export const DISCOVER_LANGUAGES: { id: string; label: string }[] = [
  { id: 'telugu', label: 'Telugu' }, { id: 'hindi', label: 'Hindi' }, { id: 'tamil', label: 'Tamil' },
  { id: 'english', label: 'English' }, { id: 'punjabi', label: 'Punjabi' }, { id: 'kannada', label: 'Kannada' },
  { id: 'malayalam', label: 'Malayalam' }, { id: 'marathi', label: 'Marathi' }, { id: 'bengali', label: 'Bengali' },
  { id: 'bhojpuri', label: 'Bhojpuri' }, { id: 'gujarati', label: 'Gujarati' }, { id: 'korean', label: 'Korean' },
];
export const DISCOVER_GENRES: { id: string; label: string; apple?: number; deezer?: number }[] = [
  { id: 'all', label: 'All' },
  { id: 'film', label: 'Film' },
  { id: 'pop', label: 'Pop', apple: 14, deezer: 132 },
  { id: 'hiphop', label: 'Hip-hop', apple: 18, deezer: 116 },
  { id: 'dance', label: 'Dance', apple: 17, deezer: 113 },
  { id: 'rnb', label: 'R&B', apple: 15, deezer: 165 },
  { id: 'rock', label: 'Rock', apple: 21, deezer: 152 },
  { id: 'electronic', label: 'Electronic', apple: 7, deezer: 106 },
  { id: 'devotional', label: 'Devotional', apple: 1267 },
  { id: 'sufi', label: 'Sufi & ghazal', apple: 1268 },
  { id: 'folk', label: 'Indian folk', apple: 1279 },
  { id: 'classical', label: 'Indian classical', apple: 1269 },
];
/** Apple's regional genres double as language charts. */
const APPLE_LANG_GENRE: Record<string, number> = { hindi: 1263, tamil: 1264, telugu: 1265, kannada: 1262 };
const APPLE_GENRE_LANG: Record<string, string> = { Bollywood: 'hindi', Tamil: 'tamil', Telugu: 'telugu', Kannada: 'kannada', Malayalam: 'malayalam', Punjabi: 'punjabi', 'K-Pop': 'korean' };

/* eslint-disable @typescript-eslint/no-explicit-any */
const unescape = (s: string) => String(s ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const fmtDur = (sec?: number) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` : undefined);
const TIMEOUT = 10000;
async function getJson(url: string): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { credentials: 'omit', signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

const SCRIPTS: [RegExp, string][] = [
  [/[\u0C00-\u0C7F]/, 'telugu'], [/[\u0B80-\u0BFF]/, 'tamil'], [/[\u0C80-\u0CFF]/, 'kannada'], [/[\u0D00-\u0D7F]/, 'malayalam'],
  [/[\u0A00-\u0A7F]/, 'punjabi'], [/[\u0980-\u09FF]/, 'bengali'], [/[\u0A80-\u0AFF]/, 'gujarati'], [/[\u0900-\u097F]/, 'hindi'],
  [/[\uAC00-\uD7AF]/, 'korean'], [/[\u3040-\u30FF]/, 'japanese'], [/[\u0600-\u06FF]/, 'arabic'],
];
export function languageFromText(s: string, fallback = 'international'): string {
  for (const [re, l] of SCRIPTS) if (re.test(s)) return l;
  return fallback;
}
const isFilm = (t: DiscoverTrack) => /\((from|taken from)\b|original motion picture|soundtrack|\bost\b/i.test(`${t.title} ${t.album ?? ''}`);

// ---------- JioSaavn ----------
const SAAVN = 'https://www.jiosaavn.com/api.php';
function saavnTrack(r: any, album?: any): DiscoverTrack | null {
  const mi = r.more_info ?? {};
  if (!mi.encrypted_media_url) return null;
  const prim: any[] = mi.artistMap?.primary_artists ?? [];
  const artists = prim.map((a) => unescape(a.name)).join(', ') || unescape(r.subtitle ?? '').split(' - ')[0];
  const dur = Number(mi.duration) || undefined;
  return {
    videoId: `jsv:${r.id}`,
    title: unescape(r.title),
    artists,
    album: unescape(mi.album ?? album?.title ?? ''),
    thumbnail: String(r.image ?? '').replace(/(150x150|50x50)/, '500x500'),
    duration: fmtDur(dur),
    language: String(r.language || album?.language || 'unknown').toLowerCase(),
    releaseDate: mi.release_date || album?.more_info?.release_date || (r.year ? `${r.year}-01-01` : undefined),
    label: unescape(mi.label ?? ''),
    sources: ['jiosaavn'],
    saavn: { enc: mi.encrypted_media_url, has320: String(mi['320kbps']).toLowerCase() === 'true' },
  };
}
export async function saavnLatest(lang: string, maxAlbums = 6): Promise<DiscoverTrack[]> {
  const q = new URLSearchParams({ __call: 'content.getAlbums', api_version: '4', _format: 'json', _marker: '0', n: '40', p: '1', ctx: 'web6dot0', languages: lang });
  const d = await getJson(`${SAAVN}?${q}`);
  const rows: any[] = d?.data ?? [];
  const out: DiscoverTrack[] = [];
  const albums = rows.filter((r) => r.type === 'album').slice(0, maxAlbums);
  for (const r of rows) if (r.type === 'song') { const t = saavnTrack(r); if (t) out.push(t); }
  const lists = await Promise.all(albums.map(async (a) => {
    try {
      const token = String(a.perma_url ?? '').split('/').pop();
      const q2 = new URLSearchParams({ __call: 'webapi.get', token: token ?? '', type: 'album', includeMetaTags: '0', ctx: 'web6dot0', api_version: '4', _format: 'json', _marker: '0' });
      const al = await getJson(`${SAAVN}?${q2}`);
      return ((al?.list ?? []) as any[]).map((s) => saavnTrack(s, a)).filter(Boolean) as DiscoverTrack[];
    } catch { return []; }
  }));
  for (const l of lists) out.push(...l);
  return out;
}

// ---------- Apple Music (iTunes) ----------
const big = (u: string) => String(u ?? '').replace(/\/\d+x\d+bb\.(jpg|png)$/, '/1000x1000bb.jpg');
export async function appleChart(genreId: number, country = 'in', limit = 50): Promise<DiscoverTrack[]> {
  const d = await getJson(`https://itunes.apple.com/${country}/rss/topsongs/limit=${limit}/genre=${genreId}/json`);
  const entries: any[] = Array.isArray(d?.feed?.entry) ? d.feed.entry : d?.feed?.entry ? [d.feed.entry] : [];
  const ids = entries.map((e) => e?.id?.attributes?.['im:id']).filter(Boolean);
  if (!ids.length) return [];
  const look = await getJson(`https://itunes.apple.com/lookup?id=${ids.join(',')}&country=${country}`).catch(() => ({ results: [] }));
  const byId = new Map<string, any>((look?.results ?? []).map((r: any) => [String(r.trackId), r]));
  return entries.map((e): DiscoverTrack => {
    const id = String(e.id.attributes['im:id']);
    const r = byId.get(id) ?? {};
    const title = r.trackName ?? e['im:name']?.label ?? '';
    const genre = r.primaryGenreName ?? e.category?.attributes?.label;
    return {
      videoId: `itm:${id}`,
      title,
      artists: String(r.artistName ?? e['im:artist']?.label ?? '').replace(/ & /g, ', '),
      album: String(r.collectionName ?? e['im:collection']?.['im:name']?.label ?? '').replace(/ - (Single|EP)$/, ''),
      thumbnail: big(r.artworkUrl100 ?? e['im:image']?.[e['im:image'].length - 1]?.label),
      duration: fmtDur(r.trackTimeMillis ? r.trackTimeMillis / 1000 : undefined),
      language: APPLE_GENRE_LANG[genre] ?? languageFromText(title, 'international'),
      genre,
      releaseDate: String(r.releaseDate ?? e['im:releaseDate']?.label ?? '').slice(0, 10) || undefined,
      sources: ['apple'],
    };
  }).filter((t) => t.title);
}

// ---------- Deezer ----------
export async function deezerChart(genreId = 0, limit = 50): Promise<DiscoverTrack[]> {
  const d = await getJson(`https://api.deezer.com/chart/${genreId}/tracks?limit=${limit}`);
  return ((d?.data ?? []) as any[]).map((r): DiscoverTrack => ({
    videoId: `dz:${r.id}`,
    title: r.title,
    artists: r.artist?.name ?? '',
    album: r.album?.title,
    thumbnail: r.album?.cover_xl ?? r.album?.cover_big ?? '',
    duration: fmtDur(r.duration),
    language: languageFromText(`${r.title} ${r.artist?.name ?? ''}`, 'international'),
    sources: ['deezer'],
  }));
}

// ---------- merge ----------
const lead = (a: string) => a.split(/,|&| x | feat\.? | ft\.? /i)[0].trim().toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
const keyOf = (t: Track) => `${titleParts(t.title).words}|${lead(t.artists)}`;
const ART_RANK: Record<DiscoverSource, number> = { apple: 3, deezer: 2, jiosaavn: 1 }; // highest-resolution official artwork first

/** One entry per recording; playable JioSaavn copies win, artwork from the best source. */
export function mergeTracks(lists: DiscoverTrack[][]): DiscoverTrack[] {
  const map = new Map<string, DiscoverTrack>();
  for (const list of lists) for (const t of list) {
    const k = keyOf(t);
    if (!k.startsWith('|') && map.has(k)) {
      const a = map.get(k)!;
      const base = a.saavn || !t.saavn ? a : { ...t, sources: a.sources, thumbnail: a.thumbnail };
      const artFrom = ART_RANK[t.sources[0]] > Math.max(...a.sources.map((s) => ART_RANK[s])) ? t : a;
      map.set(k, {
        ...base,
        thumbnail: artFrom.thumbnail || base.thumbnail,
        sources: [...new Set([...a.sources, ...t.sources])],
        duration: base.duration ?? t.duration ?? a.duration,
        album: base.album || t.album || a.album,
        language: [a.language, t.language].find((l) => l && l !== 'international' && l !== 'unknown') ?? base.language,
        genre: a.genre ?? t.genre,
        label: a.label || t.label,
        releaseDate: [a.releaseDate, t.releaseDate].filter(Boolean).sort()[0],
      });
    } else map.set(k || t.videoId, { ...t });
  }
  return [...map.values()];
}

const daysAgo = (d?: string) => (d ? (Date.now() - Date.parse(d)) / 86400000 : Infinity);

export interface DiscoverFeed { fresh: DiscoverTrack[]; sections: DiscoverSection[]; failed: string[] }

/** The whole Discover page for the chosen languages and genre. */
export async function getDiscover(langs: string[], genre = 'all', country = 'in'): Promise<DiscoverFeed> {
  const g = DISCOVER_GENRES.find((x) => x.id === genre) ?? DISCOVER_GENRES[0];
  const failed: string[] = [];
  const safe = (name: string, p: Promise<DiscoverTrack[]>) => p.catch((): DiscoverTrack[] => { failed.push(name); return []; });
  const label = (l: string) => DISCOVER_LANGUAGES.find((x) => x.id === l)?.label ?? l;
  const indian = genre === 'all' || genre === 'film';

  const wantsGlobal = !indian || langs.includes('english') || langs.includes('korean');
  const [saavn, appleLang, appleGenre, deezer] = await Promise.all([
    indian ? Promise.all(langs.map((l) => safe(`JioSaavn ${label(l)}`, saavnLatest(l)))) : Promise.resolve([] as DiscoverTrack[][]),
    indian ? Promise.all(langs.map((l) => (APPLE_LANG_GENRE[l] ? safe(`Apple Music ${label(l)}`, appleChart(APPLE_LANG_GENRE[l], country)) : Promise.resolve([] as DiscoverTrack[])))) : Promise.resolve([] as DiscoverTrack[][]),
    g.apple ? safe(`Apple Music ${g.label}`, appleChart(g.apple, country)) : Promise.resolve([] as DiscoverTrack[]),
    wantsGlobal ? safe(`Deezer ${g.deezer ? g.label : 'charts'}`, deezerChart(g.deezer ?? 0)) : Promise.resolve([] as DiscoverTrack[]),
  ]);

  const keep = (t: DiscoverTrack) => (genre === 'film' ? isFilm(t) : true) && (!indian || langs.includes(t.language) || (t.language === 'international' && langs.includes('english')));
  const all = mergeTracks([...saavn, ...appleLang, [...appleGenre], [...deezer]]);
  // New releases: dated within ~6 weeks, newest first, regional catalogues first on ties.
  const dated = all.filter((t) => keep(t) && daysAgo(t.releaseDate) <= 45)
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || b.sources.length - a.sources.length);
  // Same release day: alternate languages so one busy language doesn't bury the rest.
  const fresh: DiscoverTrack[] = [];
  for (let i = 0; i < dated.length;) {
    let j = i; while (j < dated.length && dated[j].releaseDate === dated[i].releaseDate) j++;
    const groups = new Map<string, DiscoverTrack[]>();
    for (const t of dated.slice(i, j)) { if (!groups.has(t.language)) groups.set(t.language, []); groups.get(t.language)!.push(t); }
    const order = [...groups.keys()].sort((a, b) => (langs.indexOf(a) + 99) % 99 - (langs.indexOf(b) + 99) % 99);
    for (let k = 0; fresh.length < dated.length && order.some((l) => groups.get(l)!.length > k); k++) for (const l of order) { const t = groups.get(l)![k]; if (t) fresh.push(t); }
    i = j;
  }

  const byKey = new Map(all.map((t) => [keyOf(t), t]));
  const merged = (list: DiscoverTrack[]) => list.map((t) => byKey.get(keyOf(t)) ?? t);
  const sections: DiscoverSection[] = [];
  langs.forEach((l, i) => {
    const chart = merged(appleLang[i] ?? []).filter((t) => genre !== 'film' || isFilm(t));
    if (chart.length) sections.push({ id: `apple-${l}`, title: `Top ${label(l)} songs`, sub: 'Apple Music chart', tracks: chart });
    else if (saavn[i]?.length && !APPLE_LANG_GENRE[l]) {
      const pick = merged(saavn[i]).filter((t) => genre !== 'film' || isFilm(t));
      if (pick.length) sections.push({ id: `saavn-${l}`, title: `New in ${label(l)}`, sub: 'JioSaavn', tracks: pick });
    }
  });
  if (appleGenre.length) sections.push({ id: `apple-g-${genre}`, title: `${g.label} chart`, sub: 'Apple Music', tracks: merged(appleGenre) });
  if (deezer.length) sections.push({ id: `deezer-${genre}`, title: g.deezer ? `${g.label}, trending worldwide` : 'Trending worldwide', sub: 'Deezer chart', tracks: merged(deezer) });
  return { fresh, sections, failed };
}
