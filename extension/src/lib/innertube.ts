// Minimal YouTube Music InnerTube client (WEB_REMIX), the browser counterpart of
// Tunes's JVM InnerTube layer. Response shapes verified against live
// responses on 14 Oct 2026 (search, FEmusic_home, FEmusic_new_releases,
// FEmusic_moods_and_genres, moods category).
import type { Card, CardKind, HomeChip, MoodChip, Shelf, Suggestion, Track } from './types';

const BASE = 'https://music.youtube.com/youtubei/v1';
const CONTEXT: { client: Record<string, unknown> & { clientVersion: string } } = {
  client: { clientName: 'WEB_REMIX', clientVersion: '1.20260707.12.00', hl: 'en', gl: 'IN' },
};
const TIMEOUT_MS = 12000;

// visitorData: Tunes's Innertube.ensureVisitorData(). Without it YouTube
// refuses Home continuations, so Home stops after two shelves.
let visitorData: string | null = null;
const vdReady: Promise<void> = (async () => {
  try { visitorData = ((await chrome.storage.local.get('visitorData')).visitorData as string) ?? null; } catch { /* node tests */ }
})();
function rememberVisitor(d: J) {
  const v = d?.responseContext?.visitorData;
  if (v && v !== visitorData) {
    visitorData = v;
    try { chrome.storage.local.set({ visitorData: v }); } catch { /* node tests */ }
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;

// Signed-in requests, the way Tunes's Innertube.kt does it: the session
// cookie plus Authorization: SAPISIDHASH <ts>_<sha1("ts SAPISID origin")>.
// The extension reads SAPISID from the user's own Chrome cookie jar.
async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    if ((settings as { useAccount?: boolean } | undefined)?.useAccount === false) return null;
    const all = await chrome.cookies.getAll({ domain: 'youtube.com' });
    const get = (n: string) => all.find((x) => x.name === n && x.value)?.value;
    const sap = get('SAPISID') ?? get('__Secure-3PAPISID');
    if (!sap) return null;
    const ts = Math.floor(Date.now() / 1000);
    const hash = async (v: string) => {
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${v} https://music.youtube.com`));
      return `${ts}_${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    };
    // Same Authorization shape music.youtube.com itself sends today.
    const parts = [`SAPISIDHASH ${await hash(sap)}`];
    const p1 = get('__Secure-1PAPISID'), p3 = get('__Secure-3PAPISID');
    if (p1) parts.push(`SAPISID1PHASH ${await hash(p1)}`);
    if (p3) parts.push(`SAPISID3PHASH ${await hash(p3)}`);
    return { Authorization: parts.join(' '), 'X-Goog-AuthUser': String((settings as { authUser?: number } | undefined)?.authUser ?? 0) };
  } catch {
    return null;
  }
}

export async function isSignedIn(): Promise<boolean> {
  return (await authHeaders()) != null;
}

async function call(endpoint: string, body: Record<string, unknown>, query = ''): Promise<J> {
  await vdReady;
  const auth = await authHeaders();
  const go = async (signed: boolean) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      return await fetch(`${BASE}/${endpoint}?prettyPrint=false${query}${signed && auth ? '' : '&bc=anon'}`, {
        method: 'POST',
        signal: ctl.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-YouTube-Client-Name': '67',
          'X-YouTube-Client-Version': CONTEXT.client.clientVersion,
          ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
          ...(signed && auth ? auth : {}),
        },
        credentials: signed && auth ? 'include' : 'omit',
        body: JSON.stringify({ context: { client: { ...CONTEXT.client, ...(visitorData ? { visitorData } : {}) } }, ...body }),
      });
    } finally {
      clearTimeout(timer);
    }
  };
  let res: Response;
  try {
    res = await go(true);
    if (!res.ok && auth && (res.status === 401 || res.status === 403)) {
      // Stale session: carry on as a guest, but say so (Settings shows "Sign in again").
      res = await go(false);
      if (res.ok) noteSession(false);
    } else if (res.ok && auth) noteSession(true);
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('YouTube Music took too long to answer');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('You’re offline');
    throw new Error('Couldn’t reach YouTube Music');
  }
  if (!res.ok) throw new Error(res.status === 429 ? 'YouTube Music is busy, try again in a minute' : `YouTube Music ${endpoint} failed (${res.status})`);
  let d: J;
  try { d = await res.json(); } catch { throw new Error('YouTube Music sent an unreadable answer'); }
  rememberVisitor(d);
  return d;
}

/** Remember whether the signed-in session still works, so the UI can offer "Sign in again". */
let sessionOk: boolean | null = null;
function noteSession(ok: boolean) {
  if (ok === sessionOk) return;
  sessionOk = ok;
  try { chrome.storage.session.set({ ytSessionExpired: !ok }); } catch { /* node tests */ }
}

/** Continuation token of a shelf or panel, in either of YouTube's two shapes. */
function contToken(x: J): string | undefined {
  const last = x?.contents?.[x.contents.length - 1]?.continuationItemRenderer;
  return last?.continuationEndpoint?.continuationCommand?.token
    ?? x?.continuations?.[0]?.nextContinuationData?.continuation
    ?? undefined;
}
/** Items of a continuation answer, plus the next token. */
function contPage(c: J): { items: J[]; next?: string } {
  const act = (c?.onResponseReceivedActions ?? []).map((a: J) => a.appendContinuationItemsAction).find(Boolean);
  if (act) {
    const items: J[] = act.continuationItems ?? [];
    const next = items[items.length - 1]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    return { items, next };
  }
  const cc = c?.continuationContents;
  const sh = cc?.musicPlaylistShelfContinuation ?? cc?.musicShelfContinuation ?? cc?.playlistPanelContinuation;
  return { items: sh?.contents ?? [], next: sh?.continuations?.[0]?.nextContinuationData?.continuation };
}
/** Long playlists come in pages of ~100: follow them, up to a sane cap. */
export const MAX_COLLECTION = 1000;
async function followPages(endpoint: 'browse' | 'next', first: J[], token: string | undefined, have: number): Promise<J[]> {
  const out = [...first];
  let t = token;
  for (let page = 0; t && have + out.length < MAX_COLLECTION && page < 15; page++) {
    let c: J;
    try {
      c = endpoint === 'browse'
        ? await call('browse', { continuation: t })
        : await call('next', { continuation: t, isAudioOnly: true });
      let p = contPage(c);
      if (!p.items.length && endpoint === 'browse') {
        // older shape: the token goes in the query string
        c = await call('browse', {}, `&ctoken=${encodeURIComponent(t)}&continuation=${encodeURIComponent(t)}&type=next`);
        p = contPage(c);
      }
      if (!p.items.length) break;
      out.push(...p.items);
      t = p.next;
    } catch { break; } // keep what we have
  }
  return out;
}

// ---------- helpers ----------
const text = (t: J): string => (t?.runs ?? []).map((r: J) => r.text).join('') || t?.simpleText || '';
const bestThumb = (thumbs: J[] | undefined): string => {
  if (!thumbs?.length) return '';
  const url: string = thumbs[thumbs.length - 1].url;
  // Medium square: big enough for cards, light enough to load fast. The UI
  // asks for 544 px only for the Now Playing artwork (see sized()).
  return url.replace(/=w\d+-h\d+/, '=w288-h288');
};
/** Re-size a googleusercontent / ytimg artwork URL. */
export const sized = (url: string, px: number) =>
  url ? url.replace(/=w\d+-h\d+/, `=w${px}-h${px}`).replace(/\/(hq|mq|sd)default\.jpg/, '/hqdefault.jpg') : url;
const thumbOf = (r: J) =>
  bestThumb(
    r?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
      r?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
      r?.thumbnail?.thumbnails,
  );

function sectionsOf(d: J): J[] {
  return (
    d?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ??
    d?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ??
    []
  );
}

// musicResponsiveListItemRenderer -> Track (songs/videos) or Card (album/playlist/artist)
function parseListItem(r: J): { track?: Track; card?: Card } {
  const cols = r.flexColumns ?? [];
  const title = text(cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
  const runs: J[] = cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
  const subtitle = runs.map((x) => x.text).join('');
  const thumbnail = thumbOf(r);
  const watch =
    r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint ??
    cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint;
  const videoId: string | undefined = watch?.videoId ?? r.playlistItemData?.videoId;

  if (videoId) {
    // Artists are the runs that link to artist pages; album links to an album page.
    const artistRuns = runs.filter((x) => x.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST');
    const artists = artistRuns.map((x) => x.text);
    const album = runs.find((x) => x.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ALBUM')?.text;
    const fixed = text(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
    const durationRun = [...runs].reverse().find((x) => /^\d+:\d{2}(:\d{2})?$/.test(x.text)) ?? (/^\d+:\d{2}/.test(fixed) ? { text: fixed } : undefined);
    const parts = subtitle.split(' • ');
    return {
      track: {
        videoId,
        title,
        artists: artists.length
          ? artists.join(', ')
          : parts.find((x) => x && !/^(song|video|episode|single|ep|album)$/i.test(x) && !/^\d+:\d{2}/.test(x) && !/\b(views?|plays?|likes?)$/i.test(x)) ?? '',
        album,
        thumbnail,
        duration: durationRun?.text,
        artistId: artistRuns[0]?.navigationEndpoint?.browseEndpoint?.browseId,
      },
    };
  }

  const browse = r.navigationEndpoint?.browseEndpoint;
  const pageType: string = browse?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '';
  const playlistId = r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint?.playlistId;
  const kind: CardKind = pageType.includes('ARTIST') ? 'artist' : pageType.includes('ALBUM') ? 'album' : 'playlist';
  return { card: { kind, title, subtitle, thumbnail, browseId: browse?.browseId, playlistId } };
}

// musicTwoRowItemRenderer -> Card
function parseTwoRow(r: J): Card {
  const title = text(r.title);
  const subtitle = text(r.subtitle);
  const thumbnail = thumbOf(r);
  const nav = r.navigationEndpoint ?? {};
  if (nav.watchEndpoint?.videoId) {
    return { kind: 'video', title, subtitle, thumbnail, videoId: nav.watchEndpoint.videoId };
  }
  const browse = nav.browseEndpoint;
  const pageType: string = browse?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '';
  const playlistId =
    r.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint?.playlistId;
  const kind: CardKind = pageType.includes('ARTIST') ? 'artist' : pageType.includes('ALBUM') ? 'album' : 'playlist';
  return { kind, title, subtitle, thumbnail, browseId: browse?.browseId, playlistId };
}

function parseShelves(d: J): Shelf[] {
  const shelves: Shelf[] = [];
  for (const s of sectionsOf(d)) {
    const r = s.musicCarouselShelfRenderer ?? s.musicShelfRenderer ?? s.gridRenderer;
    if (!r) continue;
    const title =
      text(r.header?.musicCarouselShelfBasicHeaderRenderer?.title) ||
      text(r.title) ||
      text(r.header?.gridHeaderRenderer?.title);
    const items: J[] = r.contents ?? r.items ?? [];
    const shelf: Shelf = { title, tracks: [], cards: [] };
    for (const it of items) {
      if (it.musicResponsiveListItemRenderer) {
        const p = parseListItem(it.musicResponsiveListItemRenderer);
        if (p.track) shelf.tracks.push(p.track);
        if (p.card) shelf.cards.push(p.card);
      } else if (it.musicTwoRowItemRenderer) {
        shelf.cards.push(parseTwoRow(it.musicTwoRowItemRenderer));
      }
    }
    if (shelf.tracks.length || shelf.cards.length) shelves.push(shelf);
  }
  return shelves;
}

// ---------- public API ----------
function homeSectionList(d: J): J {
  return d?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer;
}

export interface HomeFeed { shelves: Shelf[]; chips: HomeChip[]; next?: string }

const cleanHome = (shelves: Shelf[]) => shelves.filter((s) => !/podcast|episode/i.test(s.title));

/** First page of Home (optionally filtered by a mood chip). Paints fast; more comes from getHomeMore. */
export async function getHome(params?: string): Promise<HomeFeed> {
  const d = await call('browse', params ? { browseId: 'FEmusic_home', params } : { browseId: 'FEmusic_home' });
  const sl = homeSectionList(d);
  const chips: HomeChip[] = (sl?.header?.chipCloudRenderer?.chips ?? [])
    .map((c: J) => c.chipCloudChipRenderer)
    .filter((c: J) => c && text(c.text) && !/podcast/i.test(text(c.text)))
    .map((c: J) => ({ title: text(c.text), params: c.navigationEndpoint?.browseEndpoint?.params }));
  return { shelves: cleanHome(parseShelves(d)), chips, next: sl?.continuations?.[0]?.nextContinuationData?.continuation };
}

/** Further Home shelves via continuation tokens (needs visitorData). */
export async function getHomeMore(token: string, pages = 3): Promise<Shelf[]> {
  const shelves: Shelf[] = [];
  let t: string | undefined = token;
  for (let i = 0; i < pages && t; i++) {
    try {
      const c = await call('browse', {}, `&ctoken=${encodeURIComponent(t)}&continuation=${encodeURIComponent(t)}&type=next`);
      const sc = c?.continuationContents?.sectionListContinuation;
      shelves.push(...parseShelves({ contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: sc } } }] } } }));
      t = sc?.continuations?.[0]?.nextContinuationData?.continuation;
    } catch {
      break;
    }
  }
  return cleanHome(shelves);
}

export async function getNewReleases(): Promise<Shelf[]> {
  return parseShelves(await call('browse', { browseId: 'FEmusic_new_releases' }));
}

export async function getMoods(): Promise<{ title: string; chips: MoodChip[] }[]> {
  const d = await call('browse', { browseId: 'FEmusic_moods_and_genres' });
  return sectionsOf(d)
    .map((s: J) => s.gridRenderer)
    .filter(Boolean)
    .map((g: J) => ({
      title: text(g.header?.gridHeaderRenderer?.title),
      chips: (g.items ?? [])
        .map((i: J) => i.musicNavigationButtonRenderer)
        .filter(Boolean)
        .map((b: J) => ({
          title: text(b.buttonText),
          color: '#' + ((b.solid?.leftStripeColor ?? 0xff888888) & 0xffffff).toString(16).padStart(6, '0'),
          browseId: b.clickCommand?.browseEndpoint?.browseId,
          params: b.clickCommand?.browseEndpoint?.params,
        })),
    }));
}

export async function getMoodCategory(chip: MoodChip): Promise<Shelf[]> {
  return parseShelves(await call('browse', { browseId: chip.browseId, params: chip.params }));
}

// Search. Since mid-2026 the unfiltered response is a flat list: one
// itemSectionRenderer per result, typed only by the first subtitle run
// ("Song", "Video", "Album", "EP", "Single", "Artist", "Playlist"), plus a
// musicCardShelfRenderer top result. Filtered searches (chip params) still
// return a titled musicShelfRenderer. Both are handled and grouped here.
export interface SearchChip { title: string; params?: string }
export interface SearchResult { shelves: Shelf[]; chips: SearchChip[] }

const TYPE_GROUP: Record<string, string> = {
  song: 'Songs', video: 'Videos', album: 'Albums', ep: 'Albums', single: 'Albums',
  artist: 'Artists', playlist: 'Playlists', podcast: 'Podcasts', episode: 'Episodes', profile: 'Profiles',
};

function itemType(r: J): string {
  const runs: J[] = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
  return String(runs[0]?.text ?? '').trim().toLowerCase();
}

function stripTypeRun(r: J) {
  // Drop the leading "Song • " so subtitles/artists read cleanly.
  const t = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text;
  if (t?.runs?.length > 2 && TYPE_GROUP[String(t.runs[0].text).trim().toLowerCase()] && t.runs[1].text.trim() === '•') {
    t.runs = t.runs.slice(2);
  }
}

function parseTopCard(c: J): Shelf | null {
  const title = text(c.title);
  const subtitle = text(c.subtitle);
  const subRuns: J[] = c.subtitle?.runs ?? [];
  const thumbnail = thumbOf(c);
  const watch =
    c.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint ??
    c.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint ??
    (c.buttons ?? []).map((b: J) => b.buttonRenderer?.command?.watchEndpoint).find(Boolean);
  const shelf: Shelf = { title: 'Top result', tracks: [], cards: [] };
  if (watch?.videoId) {
    const artists = subRuns
      .filter((x) => x.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST')
      .map((x) => x.text);
    const parts = subtitle.split(' • ');
    const durationRun = [...subRuns].reverse().find((x) => /^\d+:\d{2}(:\d{2})?$/.test(x.text));
    shelf.tracks.push({ videoId: watch.videoId, title, artists: artists.join(', ') || parts[1] || '', thumbnail, duration: durationRun?.text });
  } else {
    const browse = c.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint ?? c.onTap?.browseEndpoint;
    const pageType: string = browse?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '';
    if (browse && /ARTIST|ALBUM|PLAYLIST/.test(pageType)) {
      const kind: CardKind = pageType.includes('ARTIST') ? 'artist' : pageType.includes('ALBUM') ? 'album' : 'playlist';
      const playlistId = c.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint?.playlistId;
      shelf.cards.push({ kind, title, subtitle, thumbnail, browseId: browse.browseId, playlistId });
    }
  }
  // Songs listed under the top result
  const artistCard = shelf.cards[0]?.kind === 'artist' ? title : '';
  for (const it of c.contents ?? []) {
    if (!it.musicResponsiveListItemRenderer) continue;
    stripTypeRun(it.musicResponsiveListItemRenderer);
    const p = parseListItem(it.musicResponsiveListItemRenderer);
    if (p.track) shelf.tracks.push(p.track.artists ? p.track : { ...p.track, artists: artistCard });
  }
  return shelf.tracks.length || shelf.cards.length ? shelf : null;
}

export function parseSearch(d: J): SearchResult {
  const sl = d?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer;
  const chips: SearchChip[] = (sl?.header?.chipCloudRenderer?.chips ?? [])
    .map((c: J) => c.chipCloudChipRenderer)
    .filter((c: J) => c && text(c.text) && !/^(profiles|episodes|podcasts)$/i.test(text(c.text)))
    .map((c: J) => ({ title: text(c.text), params: c.navigationEndpoint?.searchEndpoint?.params }));

  const groups = new Map<string, Shelf>();
  const order = ['Top result', 'Songs', 'Albums', 'Artists', 'Videos', 'Playlists', 'Podcasts', 'Episodes', 'Profiles', 'More'];
  const group = (name: string) => {
    if (!groups.has(name)) groups.set(name, { title: name, tracks: [], cards: [] });
    return groups.get(name)!;
  };

  for (const s of sl?.contents ?? []) {
    if (s.musicCardShelfRenderer) {
      const top = parseTopCard(s.musicCardShelfRenderer);
      if (top) groups.set('Top result', top);
      continue;
    }
    // Titled shelves (filtered search, or the old layout)
    if (s.musicShelfRenderer) {
      const title = text(s.musicShelfRenderer.title) || 'Results';
      const g = group(title);
      for (const it of s.musicShelfRenderer.contents ?? []) {
        const r = it.musicResponsiveListItemRenderer;
        if (!r) continue;
        if (TYPE_GROUP[itemType(r)]) stripTypeRun(r);
        const p = parseListItem(r);
        if (p.track) g.tracks.push(p.track);
        if (p.card) g.cards.push(p.card);
      }
      if (!order.includes(title)) order.splice(order.length - 1, 0, title);
      continue;
    }
    // Flat layout: one result per itemSectionRenderer
    for (const it of s.itemSectionRenderer?.contents ?? []) {
      const r = it.musicResponsiveListItemRenderer;
      if (!r) continue;
      const type = itemType(r);
      const name = TYPE_GROUP[type] ?? 'More';
      if (TYPE_GROUP[type]) stripTypeRun(r);
      const p = parseListItem(r);
      if (p.track) group(name === 'Albums' || name === 'Artists' || name === 'Playlists' ? 'Songs' : name).tracks.push(p.track);
      if (p.card) group(name).cards.push(p.card);
    }
  }
  const NOISE = new Set(['Podcasts', 'Episodes', 'Profiles']);
  const shelves = [...groups.values()]
    .filter((g) => (g.tracks.length || g.cards.length) && !(NOISE.has(g.title) && groups.size > 1))
    .sort((a, b) => order.indexOf(a.title) - order.indexOf(b.title));
  return { shelves, chips };
}

export async function search(query: string, params?: string): Promise<SearchResult> {
  return parseSearch(await call('search', params ? { query, params } : { query }));
}

export async function searchSuggestions(input: string): Promise<Suggestion[]> {
  const d = await call('music/get_search_suggestions', { input });
  const out: Suggestion[] = [];
  for (const sec of d?.contents ?? []) {
    for (const c of sec?.searchSuggestionsSectionRenderer?.contents ?? []) {
      const q = text(c.searchSuggestionRenderer?.suggestion);
      if (q) { out.push({ kind: 'query', text: q }); continue; }
      const r = c.musicResponsiveListItemRenderer;
      if (!r) continue;
      const type = itemType(r);
      stripTypeRun(r);
      const p = parseListItem(r);
      if (p.track) {
        out.push({ kind: type === 'video' ? 'video' : 'song', text: p.track.title, sub: p.track.artists, thumbnail: p.track.thumbnail, track: p.track });
      } else if (p.card) {
        const pageType = r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '';
        const kind = /ARTIST/.test(pageType) ? 'artist' : /ALBUM/.test(pageType) ? 'album' : 'playlist';
        out.push({ kind, text: p.card.title, sub: p.card.subtitle, thumbnail: p.card.thumbnail, card: { ...p.card, kind } });
      }
    }
  }
  return out;
}

// Signed-in identity, from account/account_menu (same call Tunes makes).
export interface AccountInfo { name: string; email: string; photo: string; channelHandle?: string }
export async function getAccountInfo(): Promise<AccountInfo | null> {
  if (!(await authHeaders())) return null;
  try {
    const d = await call('account/account_menu', {});
    const h = d?.actions?.[0]?.openPopupAction?.popup?.multiPageMenuRenderer?.header?.activeAccountHeaderRenderer;
    if (!h) return null;
    return {
      name: text(h.accountName),
      email: text(h.email),
      photo: bestThumb(h.accountPhoto?.thumbnails),
      channelHandle: text(h.channelHandle) || undefined,
    };
  } catch {
    return null;
  }
}

// Queue for a song (radio) or a playlist/album.
export async function getQueue(opts: { videoId?: string; playlistId?: string; params?: string }): Promise<Track[]> {
  const body: Record<string, unknown> = { isAudioOnly: true };
  if (opts.videoId) body.videoId = opts.videoId;
  if (opts.params) body.params = decodeURIComponent(opts.params);
  body.playlistId = opts.playlistId ?? (opts.videoId ? `RDAMVM${opts.videoId}` : undefined);
  const d = await call('next', body);
  const panel =
    d?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer;
  const tracks: Track[] = [];
  // A playlist or album plays in full; a radio stays one page (autoplay refills it).
  const isRadio = !opts.playlistId || /^RD/.test(String(body.playlistId));
  const items: J[] = isRadio ? panel?.contents ?? [] : await followPages('next', panel?.contents ?? [], contToken(panel), 0);
  const seen = new Set<string>();
  for (const it of items) {
    const v = it.playlistPanelVideoRenderer ?? it.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
    if (!v?.videoId || seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    const byline: J[] = v.longBylineText?.runs ?? [];
    const artistRuns = byline.filter((x) => x.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'));
    const artists = artistRuns.map((x) => x.text);
    tracks.push({
      artistId: artistRuns[0]?.navigationEndpoint?.browseEndpoint?.browseId,
      videoId: v.videoId,
      title: text(v.title),
      artists: artists.length ? artists.join(', ') : text(v.shortBylineText),
      album: byline.find((x) => x.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('MPRE'))?.text,
      thumbnail: bestThumb(v.thumbnail?.thumbnails),
      duration: text(v.lengthText),
    });
  }
  return tracks;
}

// Resolve a card (album/playlist) to a playlistId that /next understands.
export async function playlistIdForCard(card: Card): Promise<string | undefined> {
  if (card.playlistId) return card.playlistId;
  if (!card.browseId) return undefined;
  if (card.browseId.startsWith('VL')) return card.browseId.slice(2);
  if (card.browseId.startsWith('MPRE')) {
    const d = await call('browse', { browseId: card.browseId });
    // Prefer the album's own play button; the whole answer also lists other albums.
    const two = d?.contents?.twoColumnBrowseResultsRenderer;
    const header = two?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0];
    const own = (header ? JSON.stringify(header) : '').match(/"playlistId":"(OLAK5uy_[^"]+)"/)?.[1]
      ?? d?.microformat?.microformatDataRenderer?.urlCanonical?.match(/list=(OLAK5uy_[\w-]+)/)?.[1];
    return own ?? JSON.stringify(d).match(/"playlistId":"(OLAK5uy_[^"]+)"/)?.[1];
  }
  return undefined;
}

export async function getCardTracks(card: Card): Promise<Track[]> {
  if (card.videoId) return getQueue({ videoId: card.videoId });
  const pid = await playlistIdForCard(card);
  if (!pid) return [];
  return getQueue({ playlistId: pid });
}

// Album / playlist page: header + full track list (browse MPRE… or VL…).
export interface Collection { title: string; subtitle: string; meta: string; artist: string; thumbnail: string; tracks: Track[] }

export async function getCollection(card: Card): Promise<Collection> {
  let browseId = card.browseId;
  if (!browseId && card.playlistId) browseId = `VL${card.playlistId}`;
  if (!browseId) {
    const tracks = await getCardTracks(card);
    return { title: card.title, subtitle: card.subtitle, meta: `${tracks.length} songs`, artist: '', thumbnail: card.thumbnail, tracks };
  }
  const d = await call('browse', { browseId });
  const two = d?.contents?.twoColumnBrowseResultsRenderer;
  const headerHost = two?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0];
  const h = headerHost?.musicResponsiveHeaderRenderer ?? headerHost?.musicEditablePlaylistDetailHeaderRenderer?.header?.musicResponsiveHeaderRenderer ?? {};
  const thumbnail = thumbOf(h) || card.thumbnail;
  const artist = text(h.straplineTextOne);
  const shelf =
    two?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer ??
    two?.secondaryContents?.sectionListRenderer?.contents?.[0]?.musicPlaylistShelfRenderer ??
    sectionsOf(d).map((s: J) => s.musicShelfRenderer ?? s.musicPlaylistShelfRenderer).find(Boolean);
  const isAlbum = browseId.startsWith('MPRE');
  const tracks: Track[] = [];
  const rows = await followPages('browse', shelf?.contents ?? [], contToken(shelf), 0);
  for (const it of rows) {
    const r = it.musicResponsiveListItemRenderer;
    if (!r) continue;
    const p = parseListItem(r);
    if (!p.track) continue;
    const t = p.track;
    tracks.push({
      ...t,
      artists: t.artists || artist,
      album: t.album ?? (isAlbum ? text(h.title) : undefined),
      thumbnail: t.thumbnail || thumbnail,
    });
  }
  return { title: text(h.title) || card.title, subtitle: text(h.subtitle) || card.subtitle, meta: text(h.secondSubtitle), artist, thumbnail, tracks };
}

// Signed-in library playlists (FEmusic_liked_playlists), like the app's Library tab.
export async function getLibraryPlaylists(): Promise<Card[]> {
  const d = await call('browse', { browseId: 'FEmusic_liked_playlists' });
  return parseShelves(d).flatMap((s) => s.cards).filter((c) => c.title && !/new playlist/i.test(c.title));
}

/**
 * Fill in what search rows leave out (the 2026 flat search layout has no
 * duration or album): one /next call for the video itself. The matcher needs
 * the real runtime to tell a new song from an older one with the same name.
 */
export async function getTrackDetails(videoId: string): Promise<Partial<Track> & { videoType?: string }> {
  const d = await call('next', { videoId, isAudioOnly: true });
  const panel =
    d?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer;
  for (const it of panel?.contents ?? []) {
    const v = it.playlistPanelVideoRenderer ?? it.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
    if (v?.videoId !== videoId) continue;
    const byline: J[] = v.longBylineText?.runs ?? [];
    const artists = byline.filter((x) => x.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC')).map((x) => x.text);
    return {
      duration: text(v.lengthText) || undefined,
      album: byline.find((x) => x.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('MPRE'))?.text,
      artists: artists.length ? artists.join(', ') : undefined,
      videoType: v.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType,
    };
  }
  return {};
}

// ---------- writing to your YouTube Music library (Transfer music) ----------
async function signedOnly() { if (!(await authHeaders())) throw new Error('Sign in to YouTube Music in Chrome to copy into your account'); }
const SONGS_PARAMS = 'EgWKAQIIAWoMEA4QChADEAQQCRAF';
/** Search restricted to Songs (rows carry duration and album). */
export async function searchSongs(query: string): Promise<Track[]> {
  const r = parseSearch(await call('search', { query, params: SONGS_PARAMS }));
  return r.shelves.flatMap((s) => s.tracks);
}
/** Creates a private playlist in your YouTube Music library and returns its id. */
export async function createPlaylist(title: string, description: string, videoIds: string[]): Promise<string> {
  await signedOnly();
  const first = videoIds.slice(0, 100);
  const d = await call('playlist/create', { title, description, privacyStatus: 'PRIVATE', videoIds: first });
  const id: string | undefined = d?.playlistId;
  if (!id) throw new Error('YouTube Music didn’t create the playlist');
  for (let i = 100; i < videoIds.length; i += 100) {
    await call('browse/edit_playlist', { playlistId: id, actions: videoIds.slice(i, i + 100).map((v) => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: v })) });
  }
  return id;
}
/** Adds songs to one of your YouTube Music playlists (playlist id with or without "VL"). */
export async function addToYouTubePlaylist(playlistId: string, videoIds: string[]): Promise<void> {
  await signedOnly();
  const id = playlistId.replace(/^VL/, '');
  for (let i = 0; i < videoIds.length; i += 100) {
    const d = await call('browse/edit_playlist', { playlistId: id, actions: videoIds.slice(i, i + 100).map((v) => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: v, dedupeOption: 'DEDUPE_OPTION_SKIP' })) });
    if (d?.status && d.status !== 'STATUS_SUCCEEDED') throw new Error('YouTube Music didn’t accept that change (only your own playlists can be edited)');
  }
}
export async function likeOnYouTubeMusic(videoId: string): Promise<void> {
  await signedOnly();
  await call('like/like', { target: { videoId } });
}

// ---------- artist pages (browse UC…, musicImmersiveHeaderRenderer) ----------
export interface ArtistPage {
  id: string; name: string; thumbnail: string; banner: string; description: string; audience: string; subscribers: string;
  shuffle?: { videoId: string; playlistId?: string; params?: string };
  radio?: { videoId: string; playlistId?: string; params?: string };
  topSongs: Track[]; topSongsCard?: Card;
  shelves: Shelf[];
}
const ARTISTS_PARAMS = 'EgWKAQIgAWoKEAkQBRAKEAMQBA%3D%3D';
const looseName = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
/** browseId for an artist name: the Artists search filter, best name match first. */
export async function findArtistId(name: string): Promise<string | undefined> {
  const lead = name.split(/,| & | x | feat\.? /i)[0].trim();
  const d = await call('search', { query: lead, params: decodeURIComponent(ARTISTS_PARAMS) });
  const cards = parseSearch(d).shelves.flatMap((s) => s.cards).filter((c) => c.kind === 'artist' && c.browseId?.startsWith('UC'));
  return (cards.find((c) => looseName(c.title) === looseName(lead)) ?? cards[0])?.browseId;
}
export async function getArtist(browseId: string): Promise<ArtistPage> {
  const d = await call('browse', { browseId });
  const h = d?.header?.musicImmersiveHeaderRenderer ?? d?.header?.musicVisualHeaderRenderer ?? {};
  const thumbs: J[] = h.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? h.foregroundThumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? [];
  const raw: string = thumbs[thumbs.length - 1]?.url ?? '';
  const ep = (b: J) => { const w = b?.buttonRenderer?.navigationEndpoint?.watchEndpoint ?? b?.buttonRenderer?.navigationEndpoint?.watchPlaylistEndpoint; return w ? { videoId: w.videoId, playlistId: w.playlistId, params: w.params } : undefined; };
  const sections: J[] = sectionsOf(d);
  const songsShelf = sections.find((x) => x.musicShelfRenderer)?.musicShelfRenderer;
  const topSongs: Track[] = [];
  for (const it of songsShelf?.contents ?? []) { const p = it.musicResponsiveListItemRenderer && parseListItem(it.musicResponsiveListItemRenderer); if (p?.track) topSongs.push(p.track); }
  const more = songsShelf?.bottomEndpoint?.browseEndpoint?.browseId ?? songsShelf?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
  const about = sections.find((x) => x.musicDescriptionShelfRenderer)?.musicDescriptionShelfRenderer;
  const name = text(h.title);
  return {
    id: browseId, name,
    thumbnail: raw ? raw.replace(/=w\d+-h\d+.*$/, '=w544-h544-p-l90-rj') : '',
    banner: raw ? raw.replace(/=w\d+-h\d+/, '=w1200-h500') : '',
    description: text(h.description) || text(about?.description),
    audience: text(h.monthlyListenerCount) || text(about?.subheader),
    subscribers: text(h.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText),
    shuffle: ep(h.playButton), radio: ep(h.startRadioButton),
    topSongs: topSongs.map((t) => ({ ...t, artists: t.artists || name })),
    topSongsCard: more ? { kind: 'playlist', title: `${name}: Top songs`, subtitle: 'Playlist', thumbnail: topSongs[0]?.thumbnail ?? '', browseId: more } : undefined,
    shelves: parseShelves(d).filter((s) => s.cards.length),
  };
}
