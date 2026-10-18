// Service worker: the hub, modelled on Tunes's PlaybackService + SourceResolver.
//
// For each track it resolves a stream through a source chain (JioSaavn 320
// kbps match / YouTube direct via native ANDROID_VR client), plays it in the
// offscreen <audio> element, and falls back to driving a pinned
// YouTube player hidden inside the offscreen page when every direct source fails
// (v0.9: no separate YouTube Music tab is ever opened).
import { DEFAULT_SETTINGS, type PlayerState, type Settings, type Track, type UiCommand } from '../lib/types';
import { lastfmNowPlaying, lastfmScrobble } from '../lib/lastfm';
import { pushRecent } from '../lib/history';
import { directOrder, getSettings, QUALITY_KBPS } from '../lib/settings';
import { resolveYouTube, type ResolvedStream } from '../lib/sources/youtube';
import { bestRendition, decryptMediaUrl, resolveSaavn } from '../lib/sources/jiosaavn';
import { getQueue, getTrackDetails, searchSongs } from '../lib/innertube';
import { best, score, toSeconds } from '../lib/matcher';
import { currentMediaUserAgent, installStaticRules, setMediaUserAgent, setPlayerUserAgent, syncYouTubeCookies } from './rules';
import { fetchWithTimeout, withTimeout } from '../lib/net';
import { friendlyPlayError } from '../lib/errors';
import { getBlocked, isBlocked, type Blocked } from '../lib/blocklist';
import { blend, refineRadio } from '../lib/suggest';
import { getLiked, getRecent } from '../lib/history';
import { addSongsToLibrary } from '../lib/library';

const START_TIMEOUT_MS = 7000;
const PREFETCH_TTL_MS = 25 * 60 * 1000;
let lastStream = '';
let resumeTried = '';

const initial: PlayerState = {
  videoId: null, track: null, playing: false, position: 0, duration: 0, volume: 100,
  helperReady: false, needsActivation: false, queue: [], index: -1, shuffle: false, repeat: 'off',
  engine: null, stream: null, resolving: false, error: null, sleepAt: null, sleepEndOfTrack: false,
};

let state: PlayerState = { ...initial };
let loadToken = 0;
let startTimer: ReturnType<typeof setTimeout> | null = null;
let triedSources = new Set<string>();
let failReasons: string[] = [];
let switchingToken = -1; // a source switch is already running for this load
const restored: Promise<void> = restore().then(() => cfgReady);

// Settings, kept in memory: read on every audio tick (crossfade, scrobbling).
let cfg: Settings = { ...DEFAULT_SETTINGS };
const cfgReady = getSettings().then((x) => { cfg = x; }).catch(() => {});
chrome.storage.onChanged.addListener((c) => {
  if (!c.settings) return;
  getSettings().then((x) => {
    const eqChanged = x.eqOn !== cfg.eqOn || x.eqGains.join() !== cfg.eqGains.join();
    cfg = x;
    if (eqChanged) sendEq();
  });
});
async function sendEq() {
  if (!(await chrome.offscreen.hasDocument?.())) return;
  chrome.runtime.sendMessage({ target: 'offscreen', cmd: 'eq', on: false, gains: cfg.eqGains }).catch(() => {});
}

// Ring buffer of recent engine events, readable from DevTools: self.__tunesLog
const LOG: string[] = [];
(self as unknown as { __tunesLog: string[] }).__tunesLog = LOG;
function log(...a: unknown[]) {
  LOG.push(`${new Date().toISOString().slice(11, 19)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`);
  if (LOG.length > 80) LOG.shift();
}

// ---------- persistence ----------
async function restore() {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(['queue', 'index', 'shuffle', 'repeat', 'volume']),
    chrome.storage.session.get(['engine', 'sleepAt', 'sleepEndOfTrack', 'loadToken', 'position', 'duration']),
  ]);
  state.queue = (local.queue as Track[]) ?? [];
  state.index = (local.index as number) ?? -1;
  state.shuffle = !!local.shuffle;
  state.repeat = (local.repeat as PlayerState['repeat']) ?? 'off';
  state.volume = (local.volume as number) ?? 100;
  state.track = state.queue[state.index] ?? null;
  state.videoId = state.track?.videoId ?? null;
  state.engine = (session.engine as PlayerState['engine']) ?? null;
  // The worker sleeps after ~30 s idle; the offscreen player may outlive it.
  // Keep the same load token so its events are still accepted, and the
  // position so Play can pick the song up where it was.
  loadToken = (session.loadToken as number) ?? 0;
  startedToken = loadToken;
  state.position = (session.position as number) ?? 0;
  state.duration = (session.duration as number) ?? 0;
  // Upgrading from v0.8: close the old pinned YouTube Music helper tab for good.
  closeOldHelperTabs();
  if (state.engine !== 'direct') state.engine = null;
  state.sleepAt = (session.sleepAt as number) ?? null;
  state.sleepEndOfTrack = !!session.sleepEndOfTrack;
  if (state.sleepAt) sleepTimer = setTimeout(checkSleep, Math.max(0, state.sleepAt - Date.now()) + 50);
}

async function closeOldHelperTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://music.youtube.com/*' });
    for (const t of tabs) {
      if (t.id == null) continue;
      // v0.8 marked its helper tab in the page's sessionStorage (the URL
      // flag disappears once the tab moves to another song).
      let helper = /[?&]bchelper=1/.test(t.url ?? t.pendingUrl ?? '');
      if (!helper) {
        const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => sessionStorage.getItem('bc-helper') === '1' }).catch(() => [] as chrome.scripting.InjectionResult<boolean>[]);
        helper = !!r?.result;
      }
      if (helper) await chrome.tabs.remove(t.id).catch(() => {});
    }
  } catch { /* ignore */ }
  chrome.storage.session.remove('helperTabId').catch(() => {});
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [20] }).catch(() => {});
}

// The queue is saved at most once a second, and only when it changed; the
// small fields (index, volume…) are cheap. Before 1.2.0 the whole queue (up to
// 5,000 songs) was rewritten on every command, including each volume-drag frame.
export const QUEUE_CAP = 1000;
let queueSaved: Track[] | null = null;
let queueLen = -1;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaveAt = 0;
function capQueue() {
  // Autoplay keeps adding songs; drop the oldest already-played ones beyond the cap.
  const extra = state.queue.length - QUEUE_CAP;
  if (extra <= 0) return;
  const drop = Math.min(extra, Math.max(0, state.index - 50));
  if (drop > 0) { state.queue.splice(0, drop); state.index -= drop; }
  if (state.queue.length > QUEUE_CAP) state.queue.length = QUEUE_CAP;
}
function writeNow() {
  saveTimer = null; lastSaveAt = Date.now();
  const small = { index: state.index, shuffle: state.shuffle, repeat: state.repeat, volume: state.volume };
  const queueChanged = queueSaved !== state.queue || queueLen !== state.queue.length || queueDirty;
  if (queueChanged) { queueSaved = state.queue; queueLen = state.queue.length; queueDirty = false; }
  chrome.storage.local.set(queueChanged ? { ...small, queue: state.queue } as Record<string, unknown> : small).catch((e) => log('save failed', String(e)));
  chrome.storage.session.set({ engine: state.engine, loadToken, position: state.position, duration: state.duration }).catch(() => {});
}
let queueDirty = false;
/** Mark the queue edited in place (splice/push keep the same array). */
const touchQueue = () => { queueDirty = true; sentDirty = true; capQueue(); };
function persist() {
  if (saveTimer) return;
  const wait = Math.max(0, 1000 - (Date.now() - lastSaveAt));
  saveTimer = setTimeout(writeNow, wait);
}

// Broadcasts send the queue only when it changed (queueVersion tells the
// panel); the 400 ms position ticks carry just the small fields.
let bTimer: ReturnType<typeof setTimeout> | null = null;
let sentQueue: Track[] | null = null, sentLen = -1, queueVersion = 0;
function broadcast() {
  if (bTimer) return;
  bTimer = setTimeout(() => {
    bTimer = null;
    if (sentQueue !== state.queue || sentLen !== state.queue.length || sentDirty) { sentQueue = state.queue; sentLen = state.queue.length; sentDirty = false; queueVersion++; }
    const { queue, ...rest } = state;
    const full = sentFor !== queueVersion;
    chrome.runtime.sendMessage({ type: 'state', state: full ? { ...state, queueVersion } : { ...rest, queueVersion } }).catch(() => {});
    sentFor = queueVersion;
    void queue;
  }, 50);
}
let sentDirty = false, sentFor = -1;
function snapshot() { return { ...state, queueVersion }; }

// ---------- offscreen audio ----------
// Chrome 116+: getContexts (offscreen.hasDocument only arrived much later).
async function offscreenAlive(): Promise<boolean> {
  try {
    const c = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    return c.length > 0;
  } catch { return !!(await chrome.offscreen.hasDocument?.()); }
}
let creatingOffscreen: Promise<void> | null = null;
async function ensureOffscreen() {
  if (await offscreenAlive()) return;
  // Two commands at once must share one creation, or the second is dropped.
  creatingOffscreen ??= (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: 'Play music while the Tunes side panel is closed',
      });
    } catch (e) {
      if (!String(e).includes('single offscreen')) throw e;
    } finally { creatingOffscreen = null; }
  })();
  await creatingOffscreen;
}
async function audio(cmd: Record<string, unknown>) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: 'offscreen', ...cmd }).catch(() => null);
}

// ---------- embedded YouTube player (last resort, inside Tunes) ----------
// When no direct stream works, the song plays in a hidden YouTube player that
// lives in Tunes's own offscreen page: same controls, same queue, no tab.
let embedTried = new Set<string>();
let embedAd = false;
let adFreeSkips = 0; // songs skipped in a row by "ad-free only"
let onEmbed = false; // the current song plays in the YouTube player (no crossfade there)
/** Another upload of the same recording (Topic channel, lyric video) when one refuses to embed. */
async function alternateYouTube(t: Track): Promise<string | undefined> {
  const lead = t.artists.split(/,|&/)[0].trim();
  const target = { title: t.title, artist: t.artists, durationSec: toSeconds(t.duration), tolerance: 15 };
  for (const q of [`${t.title.replace(/\(.*?\)|\[.*?\]/g, '')} ${lead}`, `${t.title} ${t.artists}`]) {
    const rows = await searchSongs(q).catch(() => [] as Track[]);
    const hit = rows.find((r) => !embedTried.has(r.videoId) && score(target, { ...r, artist: r.artists, durationSec: toSeconds(r.duration) }) > 0);
    if (hit) return hit.videoId;
  }
  return undefined;
}
async function playEmbed(t: Track, token: number, startAt = 0): Promise<boolean> {
  let id = ytOf(t) ?? (await matchYouTube(t));
  if (!id || embedTried.has(id)) id = await alternateYouTube(t);
  if (token !== loadToken) return true; // user moved on
  if (!id) return false;
  embedTried.add(id);
  log('embed', t.title, id);
  onEmbed = true; embedAd = false;
  state.engine = 'direct';
  state.stream = 'YouTube player · in Tunes';
  state.quality = 'YouTube player';
  state.resolving = false;
  lastStream = ''; // nothing to reload by URL: errors go back through the chain
  // The catalogue length lets the player tell a pre-roll ad from the song.
  await audio({ cmd: 'load', embed: id, token, volume: state.volume, startAt, expect: toSeconds(t.duration), meta: { title: t.title, artist: t.artists, album: t.album, artwork: t.thumbnail } });
  armStartTimer(t, token, 15000);
  return true;
}

// ---------- songs found outside YouTube Music (Discover) ----------
// "jsv:" ids carry their own JioSaavn stream; "itm:" (Apple) and "dz:" (Deezer)
// ids are matched to the same recording on YouTube Music when needed.
const isYt = (id: string) => /^[\w-]{11}$/.test(id);
const ytMatches = new Map<string, string | null>();
function ytOf(t: Track): string | undefined {
  if (isYt(t.videoId)) return t.videoId;
  return ytMatches.get(t.videoId) ?? undefined;
}
async function matchYouTube(t: Track): Promise<string | undefined> {
  if (isYt(t.videoId)) return t.videoId;
  if (ytMatches.has(t.videoId)) return ytMatches.get(t.videoId) ?? undefined;
  const lead = t.artists.split(/,|&/)[0].trim();
  const target = { title: t.title, artist: t.artists, durationSec: toSeconds(t.duration), tolerance: 8 };
  let hit: Track | null = null;
  for (const q of [`${t.title.replace(/\(.*?\)|\[.*?\]/g, '')} ${lead}`, `${t.title} ${t.artists}`]) {
    const rows = await searchSongs(q).catch(() => [] as Track[]);
    hit = best(target, rows.map((r) => ({ ...r, artist: r.artists, durationSec: toSeconds(r.duration) })));
    if (hit) break;
  }
  log('match youtube', t.title, hit ? hit.videoId : 'none');
  ytMatches.set(t.videoId, hit?.videoId ?? null);
  if (ytMatches.size > 500) ytMatches.delete(ytMatches.keys().next().value!);
  return hit?.videoId;
}
function saavnDirect(t: Track, q: 'high' | 'normal' | 'low'): ResolvedStream | null {
  const url = t.saavn ? decryptMediaUrl(t.saavn.enc) : '';
  if (!url) return null;
  const r = q === 'high' ? bestRendition(url, t.saavn!.has320) : q === 'normal' ? bestRendition(url.replace(/_(96|320)\./, '_160.'), false) : bestRendition(url, false);
  return { url: r.url, mimeType: 'audio/mp4', kbps: r.kbps, source: 'jiosaavn', durationSec: toSeconds(t.duration) };
}

// ---------- source chain ----------
const describe = (s: ResolvedStream) => {
  if (s.source === 'podcast') { try { return `Podcast · ${new URL(s.url).host}`; } catch { return 'Podcast'; } }
  const codec = /opus/.test(s.mimeType) ? 'Opus' : /mp4a|mp4/.test(s.mimeType) ? 'AAC' : s.mimeType.split(';')[0];
  return `${s.source === 'jiosaavn' ? 'JioSaavn' : `YouTube (${s.client})`} · ${s.kbps} kbps ${codec}`;
};

/** Short quality badge for Now Playing: "320 kbps · AAC". */
const badge = (s: ResolvedStream) => {
  if (s.source === 'podcast') return null; // the podcast bar says enough
  const codec = /opus/.test(s.mimeType) ? 'Opus' : /mp4a|mp4/.test(s.mimeType) ? 'AAC' : '';
  return s.kbps ? `${s.kbps} kbps${codec ? ` · ${codec}` : ''}` : codec || null;
};
const details = new Map<string, Awaited<ReturnType<typeof getTrackDetails>>>();
async function enrich(t: Track) {
  if (!isYt(t.videoId)) return {} as Awaited<ReturnType<typeof getTrackDetails>>; // catalogue rows already carry runtime and album
  let info = details.get(t.videoId);
  if (!info) {
    info = await getTrackDetails(t.videoId).catch(() => ({}));
    details.set(t.videoId, info);
    if (details.size > 300) details.delete(details.keys().next().value!);
  }
  if (!toSeconds(t.duration) && info.duration) t.duration = info.duration;
  if (!t.album && info.album) t.album = info.album;
  if (state.track?.videoId === t.videoId) { state.track = { ...state.track, duration: t.duration, album: t.album }; broadcast(); }
  return info;
}

async function resolveNext(t: Track, order: string[], triedSources: Set<string>, failReasons: string[]): Promise<ResolvedStream | null> {
  // A podcast episode is its own stream: nothing to look up, nothing to fall back to.
  if (t.podcast) {
    if (triedSources.has('podcast')) return null;
    triedSources.add('podcast');
    return { url: t.podcast.url, mimeType: t.podcast.type || 'audio/mpeg', kbps: 0, source: 'podcast', durationSec: toSeconds(t.duration) };
  }
  for (const src of order) {
    if (triedSources.has(src)) continue;
    triedSources.add(src);
    try {
      const q = cfg.quality;
      let tol = 12;
      if (src === 'saavn' && t.saavn) {
        const r = saavnDirect(t, q);
        log('source', 'saavn', r ? 'own stream' : 'bad link');
        if (r) { resolved.set(t.videoId, { r, src, at: Date.now() }); return r; }
        failReasons.push('JioSaavn: bad link');
        continue;
      }
      let ytId = t.videoId;
      if (src === 'youtube' && !isYt(t.videoId)) {
        const m = await matchYouTube(t);
        if (!m) { failReasons.push('YouTube: no match'); continue; }
        ytId = m;
      }
      if (src === 'saavn' && !isYt(t.videoId)) tol = 6;
      else if (src === 'saavn') {
        // Search rows carry no runtime or album; without them a new song can
        // be "matched" to an older one with the same name. Fetch them first.
        const info = await enrich(t);
        if (info.videoType && /UGC|PODCAST/.test(info.videoType)) { failReasons.push('JioSaavn: skipped (fan upload)'); continue; }
        if (!toSeconds(t.duration)) { failReasons.push('JioSaavn: skipped (unknown length)'); continue; }
        // A YouTube "song" is the label's audio: the catalogue copy must run
        // the same length. Music videos get a little slack for intros/outros.
        tol = info.videoType === 'MUSIC_VIDEO_TYPE_ATV' ? 4 : 10;
      }
      // One hard deadline per source: a stuck lookup moves on to the next source.
      const r = await withTimeout(src === 'saavn' ? resolveSaavn(t, undefined, q, tol) : resolveYouTube(ytId, setPlayerUserAgent, QUALITY_KBPS[q]), 20000, src === 'saavn' ? 'JioSaavn' : 'YouTube');
      log('source', src, r ? `ok ${r.kbps}kbps ${r.url.slice(0, 60)}` : 'no match');
      if (r) { resolved.set(t.videoId, { r, src, at: Date.now() }); if (resolved.size > 40) resolved.delete(resolved.keys().next().value!); return r; }
      failReasons.push(`${src === 'saavn' ? 'JioSaavn' : 'YouTube'}: no match`);
    } catch (e) {
      console.warn('[Tunes] source failed', src, e);
      log('source', src, 'error', String((e as Error)?.message ?? e));
      failReasons.push(`${src === 'saavn' ? 'JioSaavn' : 'YouTube'}: ${String((e as Error)?.message ?? e).slice(0, 80)}`);
    }
  }
  return null;
}

// Streams already resolved (the next song, prefetched while this one plays,
// and songs played recently): a track change starts at once instead of
// waiting on JioSaavn/YouTube lookups.
const resolved = new Map<string, { r: ResolvedStream; src: string; at: number }>();
function takeResolved(t: Track, order: string[]): { r: ResolvedStream; src: string } | null {
  const hit = resolved.get(t.videoId);
  if (!hit || Date.now() - hit.at > PREFETCH_TTL_MS || !order.includes(hit.src) || triedSources.has(hit.src)) return null;
  // only use a lower-priority source if every source before it already failed
  if (order.slice(0, order.indexOf(hit.src)).some((x) => !triedSources.has(x))) return null;
  return hit;
}
let prefetchedFor = '';
async function prefetchNext() {
  if (state.repeat === 'one') return;
  const next = state.queue[state.index + 1];
  if (!next || prefetchedFor === next.videoId) return;
  prefetchedFor = next.videoId;
  if (resolved.has(next.videoId) && Date.now() - resolved.get(next.videoId)!.at < PREFETCH_TTL_MS) return;
  const order = ownFirst(next, await sourceOrder());
  log('prefetch', next.title);
  await resolveNext(next, order, new Set(), []).catch(() => null);
}

/** A song that carries its own JioSaavn stream plays that first. */
const ownFirst = (t: Track, order: string[]) => (t.saavn && order.includes('saavn') ? ['saavn', ...order.filter((x) => x !== 'saavn')] : order);

async function sourceOrder(): Promise<string[]> {
  return directOrder(await getSettings());
}

let staleRetried = '';
let cachedSrc = ''; // the playing stream came from the resolved cache (may have expired)
let pendingFade = 0; // seconds of crossfade for the load in flight
async function startDirect(t: Track, token: number, startAt = 0): Promise<void> {
  if (switchingToken === token) return; // errors arrive in bursts: switch once
  switchingToken = token;
  let r: ResolvedStream | null;
  try {
    const order = ownFirst(t, await sourceOrder());
    const hit = takeResolved(t, order);
    if (hit) { triedSources.add(hit.src); r = hit.r; cachedSrc = hit.src; log('source', hit.src, 'cached'); }
    else { cachedSrc = ''; r = await resolveNext(t, order, triedSources, failReasons); }
    if (!r) resolved.delete(t.videoId);
  } finally {
    if (switchingToken === token) switchingToken = -1;
  }
  if (token !== loadToken) return; // user moved on
  const fade = pendingFade; pendingFade = 0;
  if (!r && cfg.adFreeOnly) {
    // "Ad-free sources only": never hand the song to the YouTube player. Skip it.
    await audio({ cmd: 'stop' });
    state.engine = null; state.playing = false; state.resolving = false;
    state.error = 'No ad-free source for this song · skipped';
    log('ad-free only: skip', t.title);
    persist(); broadcast();
    // Move on, but never spin through a queue where nothing has an ad-free source.
    if (++adFreeSkips < state.queue.length && (state.index + 1 < state.queue.length || state.repeat === 'all'))
      setTimeout(() => { if (token === loadToken) advance(1, true); }, 1500);
    return;
  }
  if (!r && t.podcast) {
    await audio({ cmd: 'stop' });
    state.engine = null; state.playing = false; state.resolving = false;
    state.error = navigator.onLine === false ? 'You’re offline. Connect to the internet and try again.' : 'This episode didn’t play. The podcast’s server may be down; try again later.';
    state.errorDetail = failReasons.join('; ') || 'episode stream failed';
    state.canRetry = true;
    persist(); broadcast();
    return;
  }
  if (!r) {
    // Every direct stream failed: play it in the YouTube player inside Tunes.
    const ok = await playEmbed(t, token, startAt);
    if (token !== loadToken) return;
    if (!ok) {
      await audio({ cmd: 'stop' });
      state.engine = null; state.playing = false; state.resolving = false;
      state.error = friendlyPlayError(failReasons);
      state.errorDetail = failReasons.join('; ') || 'no source';
      state.canRetry = true;
    } else if (failReasons.length) state.stream = `YouTube player · in Tunes (${failReasons.join('; ')})`;
    persist(); broadcast();
    return;
  }
  if (r.userAgent) await setMediaUserAgent(r.userAgent);
  if (token !== loadToken) return; // a newer song started while we waited
  onEmbed = false;
  state.engine = 'direct';
  lastStream = r.url;
  state.stream = describe(r);
  state.quality = badge(r);
  state.resolving = false;
  state.duration = r.durationSec ?? state.duration;
  state.rate = t.podcast ? podcastRate : 1;
  await audio({ cmd: 'load', url: r.url, token, volume: state.volume, startAt, fade: t.podcast ? 0 : fade, rate: state.rate, podcast: !!t.podcast, meta: { title: t.title, artist: t.artists, album: t.album, artwork: t.thumbnail } });
  armStartTimer(t, token, t.podcast ? 30000 : START_TIMEOUT_MS);
  persist(); broadcast();
}

let startedToken = -1;
let pauseIntent = -1; // the user paused this load before it started: don't override that
function armStartTimer(t: Track, token: number, ms = START_TIMEOUT_MS) {
  if (startTimer) clearTimeout(startTimer);
  startTimer = setTimeout(() => {
    // "never started" = no playing event for this load (a resume at 1:30
    // reports position 90 before it plays, so position can't tell).
    if (token === loadToken && startedToken !== token && !state.playing && pauseIntent !== token) {
      console.warn('[Tunes] stream never started, trying next source');
      log('watchdog: stream never started');
      resolved.delete(t.videoId);
      startDirect(t, token);
    }
  }, ms);
}

// ---------- queue ----------
async function playCurrent(fade = 0) {
  const t = state.queue[state.index];
  if (!t) return;
  log('play', t.title, fade ? `crossfade ${fade}s` : '');
  pendingFade = fade;
  const token = ++loadToken;
  triedSources = new Set();
  failReasons = [];
  embedTried = new Set();
  Object.assign(state, { track: t, videoId: t.videoId, position: 0, duration: 0, needsActivation: false, resolving: true, error: null, errorDetail: null, canRetry: false, stream: null, quality: null });
  if (!t.podcast) pushRecent(t); // episodes keep their own progress instead
  persist(); broadcast();
  // Silence the previous song right away instead of letting it run on while
  // the next one resolves (heard as the music "fluctuating" between songs).
  const seamless = gaplessNext === t.videoId;
  gaplessNext = '';
  if (state.engine === 'direct' && !fade && !seamless) audio({ cmd: 'stop' });
  resumeTried = '';
  // Episodes pick up where you left them.
  let at = 0;
  if (t.podcast) {
    const p = ((await chrome.storage.local.get('podcastProgress')).podcastProgress as Record<string, { pos: number; dur: number; played: boolean }> | undefined)?.[t.videoId];
    if (p && !p.played && p.pos > 5 && (!p.dur || p.pos < p.dur - 15)) at = Math.max(0, p.pos - 3);
    if (token !== loadToken) return;
  }
  await startDirect(t, token, at);
}

async function advance(dir: 1 | -1, auto = false, fade = 0) {
  if (!state.queue.length) return;
  if (auto && state.sleepEndOfTrack) {
    // Sleep timer "end of this song": stop here, ready to resume on the next one.
    state.sleepEndOfTrack = false; state.playing = false;
    if (state.index + 1 < state.queue.length) state.index++;
    state.track = state.queue[state.index]; state.videoId = state.track?.videoId ?? null; state.position = 0;
    audio({ cmd: 'stop' });
    state.engine = null; persist(); broadcast(); return;
  }
  if (auto && state.repeat === 'one') return playCurrent();
  let i = state.index + dir;
  if (i >= state.queue.length) {
    // Tunes-style autoplay: when the queue runs out, keep going with radio.
    if (auto && state.repeat === 'off' && (await getSettings()).autoRadio && state.track && !state.track.podcast) {
      try {
        const more = await autoplayPicks(state.track);
        if (more.length) { state.queue.push(...more); touchQueue(); state.index++; return playCurrent(); }
      } catch { /* fall through */ }
    }
    if (state.repeat === 'all' || !auto) i = 0; else { state.playing = false; broadcast(); return; }
  }
  if (i < 0) i = state.repeat === 'all' ? state.queue.length - 1 : 0;
  // Songs and artists you blocked are skipped when they come up on their own.
  if (auto && blocked.songs.length + blocked.artists.length) {
    let guard = state.queue.length;
    while (guard-- > 0 && state.queue[i] && isBlocked(state.queue[i], blocked)) {
      log('skip blocked', state.queue[i].title);
      i += 1;
      if (i >= state.queue.length) { if (state.repeat === 'all') i = 0; else { state.playing = false; broadcast(); return; } }
    }
  }
  state.index = i;
  await playCurrent(fade);
}

// ---------- blocked songs/artists, smarter autoplay ----------
let blocked: Blocked = { songs: [], artists: [] };
void getBlocked().then((b) => { blocked = b; });
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.blocked) void getBlocked().then((b) => { blocked = b; }); });
/** Radio from the current song, blended with radio from the song before it; cleaned by refineRadio. */
async function autoplayPicks(cur: Track): Promise<Track[]> {
  const seed = ytOf(cur) ?? (await matchYouTube(cur));
  if (!seed) return [];
  const prev = [...state.queue.slice(0, state.index)].reverse().find((t) => !t.podcast && ytOf(t) && ytOf(t) !== seed);
  const [a, b] = await Promise.all([getQueue({ videoId: seed }), prev ? getQueue({ videoId: ytOf(prev)! }).catch(() => [] as Track[]) : Promise.resolve([] as Track[])]);
  const less = new Set(((await chrome.storage.local.get('suggestLess')).suggestLess as string[]) ?? []);
  const ctx = { queued: new Set(state.queue.map((x) => x.videoId)), recent: await getRecent().catch(() => []), less, blocked };
  const picks = refineRadio(blend(a, b), ctx);
  // A small niche can run out of unheard songs: then allow recent ones (never blocked ones).
  return picks.length >= 5 ? picks : refineRadio(blend(a, b), { ...ctx, recent: ctx.recent.slice(0, 3) });
}

/** Move one queue item; the playing song keeps playing, wherever it ends up. */
function moveItem(from: number, to: number) {
  const n = state.queue.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return;
  const [item] = state.queue.splice(from, 1);
  state.queue.splice(to, 0, item); touchQueue();
  if (from === state.index) state.index = to;
  else if (from < state.index && to >= state.index) state.index--;
  else if (from > state.index && to <= state.index) state.index++;
}

function shuffleRest() {
  const head = state.queue.slice(0, state.index + 1);
  const rest = state.queue.slice(state.index + 1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  state.queue = [...head, ...rest];
}

// Transport commands go to whichever engine is live
const live = {
  toggle: () => audio({ cmd: 'toggle' }),
  seek: (s: number) => audio({ cmd: 'seek', seconds: s }),
  volume: (v: number) => audio({ cmd: 'volume', value: v }),
};

// ---------- ListenBrainz scrobbling (Settings → Account & integrations) ----------
let scrobbled = '';
let nowPlayingSent = '';
async function listenbrainz(kind: 'playing_now' | 'single') {
  const t = state.track;
  if (!t) return;
  const { listenbrainzToken: token } = await getSettings();
  if (!token) return;
  const payload: Record<string, unknown> = {
    track_metadata: {
      artist_name: t.artists, track_name: t.title, release_name: t.album,
      additional_info: { media_player: 'Tunes', submission_client: 'Tunes', origin_url: ytOf(t) ? `https://music.youtube.com/watch?v=${ytOf(t)}` : undefined, duration_ms: state.duration ? Math.round(state.duration * 1000) : undefined },
    },
  };
  if (kind === 'single') payload.listened_at = Math.floor(Date.now() / 1000) - Math.round(state.position);
  fetchWithTimeout('https://api.listenbrainz.org/1/submit-listens', {
    method: 'POST', headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ listen_type: kind, payload: [payload] }),
  }, 10000, 'ListenBrainz').catch(() => {});
}
function lastfm(kind: 'now' | 'scrobble') {
  const t = state.track;
  if (!t || !cfg.lastfmSession || !cfg.lastfmKey || !cfg.lastfmSecret) return;
  const info = { artist: t.artists, track: t.title, album: t.album, duration: state.duration || undefined, timestamp: Math.floor(Date.now() / 1000) - Math.round(state.position) };
  (kind === 'now' ? lastfmNowPlaying : lastfmScrobble)(cfg.lastfmKey, cfg.lastfmSecret, cfg.lastfmSession, info)
    .catch((e) => log('last.fm', kind, String(e?.message ?? e)));
}
function maybeScrobble() {
  const id = state.track?.videoId;
  if (!id || !state.playing || state.track?.podcast) return; // episodes aren't music listens
  if (nowPlayingSent !== id) { nowPlayingSent = id; listenbrainz('playing_now'); lastfm('now'); }
  // Last.fm rules: tracks over 30 s, after half the song or 4 minutes.
  const need = Math.min(240, (state.duration || 60) / 2);
  if (scrobbled !== id && state.position >= need && (state.duration || 61) > 30) { scrobbled = id; listenbrainz('single'); lastfm('scrobble'); }
}

// ---------- sleep timer ----------
let sleepTimer: ReturnType<typeof setTimeout> | null = null;
let sleepFadeUntil = 0;
function setSleep(minutes: number) {
  if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
  state.sleepAt = minutes > 0 ? Date.now() + minutes * 60_000 : null;
  state.sleepEndOfTrack = minutes === -1;
  if (state.sleepAt) sleepTimer = setTimeout(checkSleep, minutes * 60_000 + 50);
  chrome.storage.session.set({ sleepAt: state.sleepAt, sleepEndOfTrack: state.sleepEndOfTrack });
}
function checkSleep() {
  if (!state.sleepAt || Date.now() < state.sleepAt) return;
  log('sleep timer: pausing');
  setSleep(0);
  sleepFadeUntil = Date.now() + 7000; // a song ending mid-fade must not start the next one
  // Fade out over a few seconds instead of cutting off mid-word.
  audio({ cmd: 'fade-pause', ms: 6000 });
  broadcast();
}

// ---------- crossfade + prefetch, driven by the audio clock ----------
let xfadeToken = -1;
let preloadFor = -1;
let gaplessNext = ''; // the next song is loaded in the player: don't stop the player before it
function onTick() {
  checkSleep();
  if (state.engine !== 'direct' || !state.playing) return;
  if (state.position > 8) prefetchNext();
  const x = cfg.crossfade;
  const left = state.duration - state.position;
  // Gapless (no crossfade): hand the next song's stream to the player a few seconds early.
  if (x === 0 && cfg.gapless && !onEmbed && preloadFor !== loadToken && state.repeat !== 'one' && !state.sleepEndOfTrack && !state.sleepAt
    && state.index + 1 < state.queue.length && left > 0 && left <= 12) {
    const next = state.queue[state.index + 1];
    const hit = resolved.get(next.videoId);
    if (hit && !next.podcast && Date.now() - hit.at < PREFETCH_TTL_MS && !(blocked.songs.length + blocked.artists.length && isBlocked(next, blocked))
      && (!hit.r.userAgent || hit.r.userAgent === currentMediaUserAgent())) {
      preloadFor = loadToken; gaplessNext = next.videoId;
      log('gapless preload', next.title);
      audio({ cmd: 'preload', url: hit.r.url, rate: 1, podcast: false });
    }
  }
  if (x > 0 && !onEmbed && Date.now() > sleepFadeUntil && state.duration > 30 && xfadeToken !== loadToken && state.repeat !== 'one' && !state.sleepEndOfTrack
    && state.index + 1 < state.queue.length && left > 0 && left <= x + 0.3) {
    xfadeToken = loadToken;
    advance(1, true, Math.min(x, left));
  }
}

// ---------- podcasts: speed and per-episode progress ----------
let podcastRate = 1;
void chrome.storage.local.get('podcastRate').then((r) => { const v = Number(r.podcastRate); if (v >= 0.5 && v <= 3) podcastRate = v; });
let progSavedAt = 0;
function podcastProgress(kind: string) {
  const t = state.track!;
  const dur = state.duration || toSeconds(t.duration) || 0;
  const played = kind === 'ended' || (dur > 60 && state.position >= dur * 0.95);
  if (!played && kind === 'time' && Date.now() - progSavedAt < 10000) return;
  progSavedAt = Date.now();
  const id = t.videoId;
  void chrome.storage.local.get('podcastProgress').then((r) => {
    const all = (r.podcastProgress as Record<string, unknown>) ?? {};
    all[id] = { pos: played ? 0 : state.position, dur, played, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 2000) for (const k of keys.sort((a, b) => (all[a] as { at: number }).at - (all[b] as { at: number }).at).slice(0, keys.length - 2000)) delete all[k];
    return chrome.storage.local.set({ podcastProgress: all });
  }).catch(() => {});
}

// ---------- events from offscreen audio ----------
let posSavedAt = 0;
function onAudioEvent(m: any) {
  if (m.kind !== 'time') log('audio', m.kind, m.token, loadToken, m.message ?? '');
  if (m.token !== loadToken || state.engine !== 'direct') return;
  if (m.kind === 'media-next') return void advance(1);
  if (m.kind === 'media-prev') return void previous();
  state.position = m.position;
  if (m.duration) state.duration = m.duration;
  // The YouTube player says when one of YouTube's ads is on: say so instead of a frozen bar.
  if (onEmbed && typeof m.ad === 'boolean' && m.ad !== embedAd) {
    embedAd = m.ad;
    state.stream = m.ad ? 'YouTube player · ad playing, your song is next' : 'YouTube player · in Tunes';
  }
  if (Date.now() - posSavedAt > 3000) { posSavedAt = Date.now(); chrome.storage.session.set({ position: state.position, duration: state.duration, loadToken }); }
  state.playing = m.playing;
  if (m.kind === 'playing') { startedToken = m.token; adFreeSkips = 0; if (startTimer) { clearTimeout(startTimer); startTimer = null; } }
  maybeScrobble();
  if (state.track?.podcast) podcastProgress(m.kind);
  onTick();
  if (m.kind === 'ended') {
    if (Date.now() < sleepFadeUntil) { state.playing = false; broadcast(); return; } // the sleep timer stopped here
    return void advance(1, true);
  }
  if (m.kind === 'error') {
    console.warn('[Tunes] audio error', m.message);
    if (/user didn't interact|play\(\) failed because/i.test(m.message)) { state.error = 'Press play to start'; broadcast(); return; }
    const t = state.track;
    const at = state.position;
    // A network blip mid-song: reload the same stream where it stopped, once,
    // before giving up on the source (switching sources swaps the recording).
    if (t && at > 2 && lastStream && resumeTried !== t.videoId) {
      resumeTried = t.videoId;
      log('resume same stream at', at.toFixed(1));
      startedToken = -1; armStartTimer(t, loadToken);
      audio({ cmd: 'load', url: lastStream, token: loadToken, volume: state.volume, startAt: at, meta: { title: t.title, artist: t.artists, album: t.album, artwork: t.thumbnail } });
      return;
    }
    if (t && switchingToken !== loadToken) {
      if (startTimer) { clearTimeout(startTimer); startTimer = null; }
      resolved.delete(t.videoId);
      if (cachedSrc && staleRetried !== t.videoId) { staleRetried = t.videoId; triedSources.delete(cachedSrc); cachedSrc = ''; } // stale link: look it up again, once
      else failReasons.push(`${state.stream?.split(' ·')[0] ?? 'stream'}: ${String(m.message).slice(0, 60)}`);
      state.resolving = true; broadcast();
      audio({ cmd: 'stop' });
      startDirect(t, loadToken, at > 2 ? at : 0);
    }
    return;
  }
  broadcast();
}

const EXT_ORIGIN = chrome.runtime.getURL('');
const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');
/** Extension pages (side panel, full-tab view, offscreen) — never a website's content script. */
const fromExtensionPage = (s: chrome.runtime.MessageSender) => s.id === chrome.runtime.id && !!s.url?.startsWith(EXT_ORIGIN);

function validCommand(cmd: UiCommand): boolean {
  const n = state.queue.length;
  const idx = (i: unknown, max = n) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < max;
  const isTrack = (t: any) => t && typeof t.videoId === 'string' && typeof t.title === 'string' && typeof t.artists === 'string';
  switch (cmd.type) {
    case 'play-queue': return Array.isArray(cmd.tracks) && cmd.tracks.length > 0 && cmd.tracks.every(isTrack) && idx(cmd.index, cmd.tracks.length);
    case 'play-index': case 'remove-index': case 'play-next-index': return idx(cmd.index);
    case 'move': return idx(cmd.from) && idx(cmd.to);
    case 'add-next': case 'add-queue': return isTrack(cmd.track);
    case 'append': case 'add-next-many': return Array.isArray(cmd.tracks) && cmd.tracks.length <= 5000 && cmd.tracks.every(isTrack);
    case 'seek': return Number.isFinite(cmd.seconds) && cmd.seconds >= 0;
    case 'volume': return Number.isFinite(cmd.value) && cmd.value >= 0 && cmd.value <= 100;
    case 'sleep': return Number.isFinite(cmd.minutes) && cmd.minutes >= -1 && cmd.minutes <= 24 * 60;
    case 'rate': return [0.5, 0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.5, 1.75, 2, 2.5, 3].includes(cmd.value);
    case 'skip': return Number.isFinite(cmd.seconds) && Math.abs(cmd.seconds) <= 600;
    default: return true;
  }
}

/** Start the current song again where it was (after an error, a restart, or Chrome closing an idle player). */
async function resumeTrack() {
  const t = state.track;
  if (!t) return;
  const at = state.position > 2 && (!state.duration || state.position < state.duration - 2) ? state.position : 0;
  const token = ++loadToken;
  triedSources = new Set(); failReasons = []; embedTried = new Set(); resumeTried = '';
  Object.assign(state, { resolving: true, error: null, errorDetail: null, canRetry: false });
  log('resume', t.title, 'at', at.toFixed(1));
  persist(); broadcast();
  await startDirect(t, token, at);
}
async function togglePlay() {
  state.error = null;
  // Chrome closes an audio page after ~30 s of silence: a paused song has to be reloaded.
  if (state.track && (!state.engine || !(await offscreenAlive()))) { await resumeTrack(); return; }
  if (startedToken !== loadToken) pauseIntent = pauseIntent === loadToken ? -1 : loadToken;
  await live.toggle();
}
async function previous() {
  if (state.position > 3) { await live.seek(0); state.position = 0; } else await advance(-1);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen' || msg?.type === 'state') return; // not for us
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    await restored;
    // Audio events come only from the offscreen player page.
    if (msg?.type === 'audio-event') {
      if (sender.id === chrome.runtime.id && sender.url?.startsWith(OFFSCREEN_URL)) onAudioEvent(msg);
      sendResponse({ ok: true }); // close the channel: callers never hang on it
      return;
    }
    const cmd = msg as UiCommand;
    // Player commands only come from Tunes's own pages, and must be well-formed.
    if (!fromExtensionPage(sender) || !cmd?.type) { sendResponse(null); return; }
    if (!validCommand(cmd)) { log('bad command', cmd.type); sendResponse(snapshot()); return; }
    // A choice the user made starts a fresh run of "ad-free only" skips.
    if (cmd.type === 'play-queue' || cmd.type === 'play-index' || cmd.type === 'next' || cmd.type === 'prev') adFreeSkips = 0;
    switch (cmd.type) {
      case 'get-state': sendResponse(snapshot()); return;
      case 'play-queue':
        state.queue = cmd.tracks.slice(0, QUEUE_CAP); state.index = Math.min(cmd.index, state.queue.length - 1);
        if (state.shuffle) shuffleRest();
        await playCurrent(); break;
      case 'play-index': state.index = cmd.index; await playCurrent(); break;
      case 'add-next': state.queue.splice(state.index + 1, 0, cmd.track); touchQueue(); if (state.index < 0) { state.index = 0; await playCurrent(); } break;
      case 'add-queue': state.queue.push(cmd.track); touchQueue(); if (state.index < 0) { state.index = 0; await playCurrent(); } break;
      case 'add-next-many':
        if (!cmd.tracks.length) break;
        state.queue.splice(state.index + 1, 0, ...cmd.tracks); touchQueue();
        if (state.index < 0) { state.index = 0; await playCurrent(); }
        break;
      case 'append': {
        const have = new Set(state.queue.map((x) => x.videoId));
        // Play Last from a menu queues every song, as asked; autoplay radio skips songs already queued.
        state.queue.push(...(cmd.keepDupes ? cmd.tracks : cmd.tracks.filter((x) => !have.has(x.videoId)))); touchQueue();
        break;
      }
      case 'remove-index':
        if (cmd.index === state.index || cmd.index < 0 || cmd.index >= state.queue.length) break;
        state.queue.splice(cmd.index, 1); touchQueue();
        if (cmd.index < state.index) state.index--;
        break;
      case 'move': moveItem(cmd.from, cmd.to); break;
      case 'play-next-index':
        if (cmd.index !== state.index) moveItem(cmd.index, cmd.index < state.index ? state.index : state.index + 1);
        break;
      case 'clear-upnext': state.queue = state.queue.slice(0, state.index + 1); break;
      case 'toggle': await togglePlay(); break;
      case 'retry': await resumeTrack(); break;
      case 'rate':
        if (!state.track?.podcast) break;
        podcastRate = cmd.value; state.rate = cmd.value;
        chrome.storage.local.set({ podcastRate: cmd.value });
        await audio({ cmd: 'rate', value: cmd.value });
        break;
      case 'skip': {
        const to = Math.max(0, Math.min((state.duration || Infinity) - 1, state.position + cmd.seconds));
        state.position = to; await live.seek(to);
        break;
      }
      case 'next': await advance(1); break;
      case 'prev': await previous(); break;
      case 'seek': await live.seek(cmd.seconds); state.position = cmd.seconds; break;
      case 'volume': await live.volume(cmd.value); state.volume = cmd.value; break;
      case 'shuffle': state.shuffle = !state.shuffle; if (state.shuffle) shuffleRest(); break;
      case 'repeat': state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off'; break;
      case 'sleep': setSleep(cmd.minutes); break;
      case 'open-tab': chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html?mode=tab') }); break;
    }
    persist();
    broadcast();
    sendResponse(snapshot());
  })();
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  await restored;
  if (command === 'toggle-play') await togglePlay();
  if (command === 'next-track') await advance(1);
  if (command === 'prev-track') await previous();
  persist(); broadcast();
});

async function setup() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await installStaticRules();
  await syncYouTubeCookies();
}
syncYouTubeCookies();
chrome.storage.onChanged.addListener((c) => { if (c.settings) syncYouTubeCookies(); });
let cookieTimer: ReturnType<typeof setTimeout> | null = null;
chrome.cookies.onChanged.addListener(({ cookie }) => {
  if (!cookie.domain.endsWith('youtube.com')) return;
  if (cookieTimer) clearTimeout(cookieTimer);
  cookieTimer = setTimeout(syncYouTubeCookies, 1000);
});
chrome.runtime.onInstalled.addListener((d) => {
  void setup();
  if (d.reason === 'update') void migrate();
});
/** 1.3.0: people updating skip the first-run welcome, and liked songs join the Library. */
async function migrate() {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings && (settings as Settings).onboarded === undefined) await chrome.storage.local.set({ settings: { ...(settings as Settings), onboarded: true } });
  const liked = await getLiked().catch(() => [] as Track[]);
  if (liked.length) await addSongsToLibrary(liked).catch(() => 0);
}
chrome.runtime.onStartup.addListener(setup);

// DevTools/test hook: inspect and nudge the live player state from the service worker console.
(self as unknown as { __tunesDebug: unknown }).__tunesDebug = { state, broadcast: () => broadcast(), audio: (m: Record<string, unknown>) => audio(m as never) };
