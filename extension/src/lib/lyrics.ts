// Lyrics, ported from Tunes's LyricsRepository: every enabled provider is
// asked at the same time, answers are taken in the user's priority order,
// and (optionally) a word-timed answer beats a line-timed one.
import { titleParts } from './matcher';

export interface LyricWord { t: number; d: number; text: string } // seconds
export interface LyricLine { time: number; end?: number; text: string; words?: LyricWord[] }
export interface Lyrics { synced: LyricLine[] | null; plain: string | null; source?: string; wordSynced?: boolean }

export type LyricsSourceId = 'lyricsplus' | 'paxsenix' | 'kugou' | 'lrclib' | 'musixmatch' | 'genius';
export interface LyricsSourceInfo { id: LyricsSourceId; label: string; hint: string }

// Same order and wording as the app's "Lyrics sources" sheet.
export const LYRICS_SOURCES: LyricsSourceInfo[] = [
  { id: 'lyricsplus', label: 'LyricsPlus', hint: 'Syllable by syllable, on community servers' },
  { id: 'paxsenix', label: 'PaxSenix', hint: 'Apple Music timings, word by word' },
  { id: 'kugou', label: 'KuGou', hint: 'Whole lines, strong outside the English catalogue' },
  { id: 'lrclib', label: 'LRCLIB', hint: 'Whole lines only, and always up' },
  { id: 'musixmatch', label: 'Musixmatch', hint: 'Whole lines, from the biggest lyrics catalogue' },
  { id: 'genius', label: 'Genius', hint: 'Plain text fallback, massive web catalogue' },
];
export const DEFAULT_LYRICS_ORDER: LyricsSourceId[] = LYRICS_SOURCES.map((s) => s.id);

export interface LyricsPrefs { order: LyricsSourceId[]; enabled: LyricsSourceId[]; preferSyllable: boolean }

interface Query { title: string; artist: string; album?: string; duration?: number; videoId?: string }

/* eslint-disable @typescript-eslint/no-explicit-any */
const TIMEOUT = 9000;
async function getJson(url: string, init?: RequestInit, retry = true): Promise<any> {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, credentials: 'omit' });
    // "server busy" (LRCLIB, PaxSenix) is usually gone a moment later
    if ((r.status === 429 || r.status === 503) && retry) { clearTimeout(id); await new Promise((ok) => setTimeout(ok, 700)); return getJson(url, init, false); }
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(id); }
}
async function getText(url: string): Promise<string | null> {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
    return r.ok ? await r.text() : null;
  } catch { return null; } finally { clearTimeout(id); }
}

export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) out.push({ time: Number(m[1]) * 60 + Number(m[2]), text });
  }
  return out.sort((a, b) => a.time - b.time);
}

// ---------- verification ----------
// Root cause of "the same / random lyrics on different songs": providers answer
// a fuzzy search with their closest hit, and we used to take it unchecked
// (KuGou's first candidate, LRCLIB's first search row, whatever LyricsPlus or
// Musixmatch returned, Musixmatch's decoy lyrics). Every answer is now checked
// against the playing track's title, artist, language and length before use.
const LANGS = ['telugu', 'tamil', 'hindi', 'kannada', 'malayalam', 'marathi', 'bengali', 'punjabi', 'bhojpuri', 'gujarati', 'odia', 'english', 'spanish', 'korean', 'japanese'];
const normA = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const artistNames = (s: string) => normA(s).split(/,|&| and | x | feat\.? | ft\.? |\/|;|、|，/).map((a) => a.replace(/[^\p{L}\p{N} ]/gu, '').trim()).filter((a) => a.length > 1);
const langOf = (s: string) => LANGS.find((l) => new RegExp(`\\b${l}\\b`, 'i').test(s));
const words = (s: string) => new Set(titleParts(s).words.split(' ').filter(Boolean));

export interface Candidate { title: string; artist?: string; durationSec?: number }
/** Why a provider's answer was rejected, or '' when it belongs to this track. */
export function mismatch(q: { title: string; artist: string; duration?: number }, c: Candidate): string {
  const a = titleParts(q.title).words, b = titleParts(c.title).words;
  if (!b) return 'no title';
  // Whole words, never substrings: "Hero" is not "Superhero", "Love" is not
  // "Love Me Like You Do". Extra words are fine while two-thirds of them agree.
  let titleOk = a === b || a.replace(/ /g, '') === b.replace(/ /g, '');
  if (!titleOk) {
    const A = words(q.title), B = words(c.title);
    const shared = [...A].filter((w) => B.has(w)).length;
    titleOk = shared >= 1 && shared / Math.max(A.size, B.size, 1) >= 0.67;
  }
  if (!titleOk) return `title "${c.title}"`;
  // A Telugu and a Tamil version of a film song share a title but not lyrics.
  const la = langOf(q.title), lb = langOf(c.title);
  if (la && lb && la !== lb) return `language ${lb}`;
  // Instrumentals have no lyrics; a remix or live take keeps them.
  if (/instrumental|karaoke/i.test(c.title) !== /instrumental|karaoke/i.test(q.title)) return 'instrumental';
  const dur = q.duration && c.durationSec ? Math.abs(q.duration - c.durationSec) : null;
  if (dur != null && dur > 15) return `length ${Math.round(c.durationSec!)}s`;
  if (c.artist) {
    const ta = artistNames(q.artist), ca = artistNames(c.artist);
    const same = ta.some((x) => ca.some((y) => x === y || (x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x)))));
    // Credits differ between catalogues; an exact-length match vouches for it.
    if (ta.length && ca.length && !same && !(dur != null && dur <= 2)) return `artist "${c.artist}"`;
  }
  return '';
}
/** Synced lines that run well past the song's end belong to another song. */
function fitsLength(lines: LyricLine[] | null, duration?: number): boolean {
  if (!lines?.length || !duration) return true;
  return lines[lines.length - 1].time <= duration + 10;
}
const hms = (s?: string) => { const p = (s ?? '').split(':').map(Number); return p.length && !p.some(isNaN) ? p.reduce((a, x) => a * 60 + x, 0) : undefined; };
let reject = (_src: string, _why: string) => {};

const clean = (s: string) => s.replace(/\(.*?(official|video|audio|lyric|visuali[sz]er).*?\)|\[.*?\]/gi, '').trim();
// Search with the title proper: "Yeshanagula (From "The Paradise") (Telugu)" -> "Yeshanagula".
const titleOnly = (s: string) => clean(s).replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+[-|]\s+(from|feat|ft)\b.*$/i, '').trim() || clean(s);
const firstArtist = (a: string) => a.split(/,|&| x | feat\.? /i)[0].trim();

// ---------- providers ----------
const LYRICSPLUS_HOSTS = ['https://lyricsplus.binimum.org', 'https://lyricsplus.prjktla.workers.dev', 'https://lyricsplus.atomix.one', 'https://lyricsplus.prjktla.my.id', 'https://lyricsplus-seven.vercel.app'];
async function lyricsPlus(q: Query): Promise<Lyrics | null> {
  const p = new URLSearchParams({ title: titleOnly(q.title), artist: firstArtist(q.artist) });
  if (q.duration) p.set('duration', String(Math.round(q.duration)));
  if (q.album) p.set('album', q.album);
  for (const h of LYRICSPLUS_HOSTS) {
    const d = await getJson(`${h}/v2/lyrics/get?${p}`);
    if (!d?.lyrics?.length) continue;
    const m = d.metadata ?? {};
    const why = m.title ? mismatch(q, { title: m.title, artist: m.artist, durationSec: hms(m.totalDuration) }) : '';
    if (why) { reject('lyricsplus', why); return null; }
    const word = d.type === 'Word' || d.type === 'Syllable';
    const lines: LyricLine[] = d.lyrics.map((l: any) => ({
      time: l.time / 1000,
      end: (l.time + l.duration) / 1000,
      text: l.text,
      words: word && l.syllabus?.length ? l.syllabus.map((s: any) => ({ t: s.time / 1000, d: s.duration / 1000, text: s.text })) : undefined,
    }));
    if (!fitsLength(lines, q.duration)) { reject('lyricsplus', 'runs past the song'); return null; }
    return { synced: lines, plain: null, wordSynced: word };
  }
  return null;
}

function pick<T extends Candidate>(q: Query, list: T[]): T | null {
  return list.find((c) => !mismatch(q, c)) ?? null;
}

async function itunesId(q: Query): Promise<string | null> {
  for (const country of ['in', 'us']) {
    const d = await getJson(`https://itunes.apple.com/search?${new URLSearchParams({ term: `${titleOnly(q.title)} ${firstArtist(q.artist)}`, entity: 'song', limit: '10', country })}`);
    const rows: { id: string; title: string; artist: string; durationSec: number }[] = (d?.results ?? []).map((r: any) => ({ id: String(r.trackId), title: r.trackName, artist: r.artistName, durationSec: Math.round((r.trackTimeMillis ?? 0) / 1000) }));
    const hit = pick(q, rows.map((r) => ({ ...r, durationSec: r.durationSec || undefined })));
    if (hit) return hit.id;
  }
  return null;
}
async function paxSenix(q: Query): Promise<Lyrics | null> {
  const id = await itunesId(q);
  if (!id) return null;
  const d = await getJson(`https://lyrics.paxsenix.org/apple-music/lyrics?id=${id}`);
  if (!d?.content?.length) return null;
  const word = d.type === 'Syllable' || d.type === 'Word';
  const lines: LyricLine[] = d.content.map((l: any) => {
    const parts: any[] = l.text ?? [];
    const words = parts.map((w, i) => ({ t: w.timestamp / 1000, d: w.duration / 1000, text: w.text + (w.part || i === parts.length - 1 ? '' : ' ') }));
    return { time: l.timestamp / 1000, end: l.endtime / 1000, text: words.map((w) => w.text).join('').trim(), words: word ? words : undefined };
  });
  if (!fitsLength(lines, q.duration)) { reject('paxsenix', 'runs past the song'); return null; }
  return { synced: lines, plain: null, wordSynced: word };
}

async function kugou(q: Query): Promise<Lyrics | null> {
  const p = new URLSearchParams({ ver: '1', man: 'yes', client: 'pc', keyword: `${firstArtist(q.artist)} - ${titleOnly(q.title)}` });
  if (q.duration) p.set('duration', String(Math.round(q.duration * 1000)));
  const s = await getJson(`https://lyrics.kugou.com/search?${p}`);
  const cands: any[] = s?.candidates ?? [];
  const c = cands.find((x) => {
    const why = mismatch(q, { title: x.song ?? '', artist: x.singer, durationSec: x.duration ? x.duration / 1000 : undefined });
    if (why) reject('kugou', why);
    return !why;
  });
  if (!c) return null;
  const d = await getJson(`https://lyrics.kugou.com/download?${new URLSearchParams({ fmt: 'lrc', charset: 'utf8', client: 'pc', ver: '1', id: c.id, accesskey: c.accesskey })}`);
  if (!d?.content) return null;
  const lrc = new TextDecoder().decode(Uint8Array.from(atob(d.content), (ch) => ch.charCodeAt(0)));
  // KuGou puts credits ("作词：", "Produced by：…") and "Artist - Title" in the first lines.
  const credit = /^(作词|作曲|编曲|制作|监制|混音|和声|吉他|贝斯|鼓|母带|出品|发行|op|sp|lyrics?|composed|composer|written|arranged|produced|producer|mixed|mastered)[^:：]{0,24}[:：]|\bby\s*[:：]/i;
  const lines = parseLrc(lrc).filter((l, i) => !(i < 12 && credit.test(l.text)) && !(i === 0 && l.text.includes(' - ')));
  // ...and any other "Role：Name" block at the top (Drums：…, Guitar：…).
  for (let n = 0; n < 15 && lines.length && /^[\p{L} /&.'-]{1,24}[:：]\s*\S/u.test(lines[0].text); n++) lines.shift();
  if (!fitsLength(lines, q.duration)) { reject('kugou', 'runs past the song'); return null; }
  return lines.length ? { synced: lines, plain: null } : null;
}

async function lrclib(q: Query): Promise<Lyrics | null> {
  const p = new URLSearchParams({ track_name: clean(q.title), artist_name: firstArtist(q.artist) });
  if (q.duration) p.set('duration', String(Math.round(q.duration)));
  const asCand = (x: any): Candidate => ({ title: x.trackName ?? '', artist: x.artistName, durationSec: x.duration });
  let d = await getJson(`https://lrclib.net/api/get?${p}`);
  if (d) { const why = mismatch(q, asCand(d)); if (why) { reject('lrclib', why); d = null; } }
  if (!d) {
    const list: any[] = (await getJson(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: titleOnly(q.title), artist_name: firstArtist(q.artist) })}`)) ?? [];
    const ok = list.filter((x) => !mismatch(q, asCand(x)) && !x.instrumental);
    d = ok.find((x) => x.syncedLyrics) ?? ok.find((x) => x.plainLyrics) ?? null;
  }
  if (!d || d.instrumental) return null;
  let synced = d.syncedLyrics ? parseLrc(d.syncedLyrics) : null;
  // timings for another cut of the song: keep the words, drop the timings
  if (!fitsLength(synced, q.duration)) { reject('lrclib', 'timings run past the song'); synced = null; }
  return synced?.length || d.plainLyrics ? { synced, plain: d.plainLyrics ?? null } : null;
}

let mxmToken: string | null = null;
let mxmRetryAt = 0;
/** Musixmatch answers unauthorised clients with made-up lyrics ("Wob gopini den…") on an
 *  exact 4-second grid. Never show those. */
function looksFake(lines: LyricLine[]): boolean {
  if (lines.length < 6) return false;
  const gaps = lines.slice(1, 12).map((l, i) => +(l.time - lines[i].time).toFixed(2));
  return gaps.every((g) => g === gaps[0]) && lines.slice(0, 12).every((l) => Number.isInteger(l.time));
}
async function musixmatch(q: Query): Promise<Lyrics | null> {
  const base = 'https://apic-desktop.musixmatch.com/ws/1.1';
  const common = { app_id: 'web-desktop-app-v1.0', format: 'json' };
  if (!mxmToken) {
    if (Date.now() < mxmRetryAt) return null;
    const t = await getJson(`${base}/token.get?${new URLSearchParams({ ...common, user_language: 'en', t: String(Date.now()) })}`);
    mxmToken = t?.message?.body?.user_token ?? null;
    // An all-zero or "UpgradeOnly" token is a refusal, not a session.
    if (!mxmToken || /UpgradeOnlyUpgradeOnly|^0+$/.test(mxmToken)) { mxmToken = null; mxmRetryAt = Date.now() + 5 * 60_000; return null; }
  }
  const p = new URLSearchParams({ ...common, usertoken: mxmToken, q_track: titleOnly(q.title), q_artist: firstArtist(q.artist), ...(q.duration ? { q_duration: String(Math.round(q.duration)) } : {}), namespace: 'lyrics_richsynched', subtitle_format: 'lrc' });
  const d = await getJson(`${base}/macro.subtitles.get?${p}`);
  const calls = d?.message?.body?.macro_calls;
  const lrc = calls?.['track.subtitles.get']?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body;
  if (d?.message?.header?.status_code === 401) { mxmToken = null; return null; }
  const tr = calls?.['matcher.track.get']?.message?.body?.track;
  if (tr) { const why = mismatch(q, { title: tr.track_name ?? '', artist: tr.artist_name, durationSec: tr.track_length || undefined }); if (why) { reject('musixmatch', why); return null; } }
  else if (lrc || calls?.['track.lyrics.get']?.message?.body?.lyrics) { reject('musixmatch', 'no track info'); return null; }
  if (lrc) { const lines = parseLrc(lrc); return looksFake(lines) || !fitsLength(lines, q.duration) ? null : { synced: lines, plain: null }; }
  const plain = calls?.['track.lyrics.get']?.message?.body?.lyrics?.lyrics_body;
  return plain ? { synced: null, plain } : null;
}

async function genius(q: Query): Promise<Lyrics | null> {
  const s = await getJson(`https://genius.com/api/search/multi?${new URLSearchParams({ q: `${titleOnly(q.title)} ${firstArtist(q.artist)}` })}`);
  const hits: any[] = (s?.response?.sections ?? []).flatMap((x: any) => x.hits ?? []).filter((h: any) => h.type === 'song');
  const rows: { url: string; title: string; artist: string }[] = hits.map((h: any) => ({ url: h.result.url, title: h.result.title, artist: h.result.primary_artist?.name ?? '' }));
  const hit = pick(q, rows);
  if (!hit) return null;
  const html = await getText(hit.url);
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const parts = [...doc.querySelectorAll('[data-lyrics-container="true"]')].map((el) => {
    el.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    el.querySelectorAll('[data-exclude-from-selection="true"]').forEach((x) => x.remove());
    return el.textContent ?? '';
  });
  const plain = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return plain ? { synced: null, plain } : null;
}

const PROVIDERS: Record<LyricsSourceId, (q: Query) => Promise<Lyrics | null>> = { lyricsplus: lyricsPlus, paxsenix: paxSenix, kugou, lrclib, musixmatch, genius };

// ---------- repository ----------
export async function getLyricsPrefs(): Promise<LyricsPrefs> {
  const r = await chrome.storage.local.get('lyricsPrefs');
  const p = (r.lyricsPrefs as Partial<LyricsPrefs>) ?? {};
  const order = [...(p.order ?? []).filter((x) => DEFAULT_LYRICS_ORDER.includes(x)), ...DEFAULT_LYRICS_ORDER.filter((x) => !(p.order ?? []).includes(x))];
  return { order, enabled: p.enabled ?? [...DEFAULT_LYRICS_ORDER], preferSyllable: p.preferSyllable ?? true };
}
export async function setLyricsPrefs(p: LyricsPrefs) {
  await chrome.storage.local.set({ lyricsPrefs: p });
  cache.clear();
}

const cache = new Map<string, Lyrics>();
export const lyricsDebug: string[] = [];

export async function getLyrics(title: string, artist: string, duration?: number, album?: string): Promise<Lyrics> {
  const key = `${title}|${artist}|${Math.round(duration ?? 0)}`;
  if (cache.has(key)) return cache.get(key)!;
  const prefs = await getLyricsPrefs();
  const q: Query = { title, artist, album, duration: duration && duration > 0 ? duration : undefined };
  reject = (src, why) => { lyricsDebug.push(`${src}: rejected (${why})`); if (lyricsDebug.length > 40) lyricsDebug.shift(); };
  const order = prefs.order.filter((id) => prefs.enabled.includes(id));
  // Ask everyone at once; take answers in priority order.
  const started = order.map((id) => {
    const t0 = performance.now();
    return PROVIDERS[id](q)
      .catch(() => null)
      .then((r) => { lyricsDebug.push(`${id}: ${r ? (r.wordSynced ? 'word-synced' : r.synced ? 'line-synced' : 'plain') : 'none'} in ${Math.round(performance.now() - t0)} ms`); if (lyricsDebug.length > 40) lyricsDebug.shift(); return r; });
  });
  let lineHit: Lyrics | null = null;
  let plainHit: Lyrics | null = null;
  for (let i = 0; i < order.length; i++) {
    const r = await started[i];
    if (!r) continue;
    const tagged = { ...r, source: LYRICS_SOURCES.find((s) => s.id === order[i])!.label };
    if (r.synced?.length) {
      if (r.wordSynced || !prefs.preferSyllable) { cache.set(key, tagged); return tagged; }
      lineHit ??= tagged;
    } else if (r.plain) plainHit ??= tagged;
  }
  const result = lineHit ?? plainHit ?? { synced: null, plain: null };
  // A miss may be a network hiccup: only answers are cached, so a later look tries again.
  if (result.synced || result.plain) cache.set(key, result);
  return result;
}
