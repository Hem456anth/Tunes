// Readers for the services you're moving from. They use the sessions already
// signed in in Chrome (an open.spotify.com / music.apple.com tab), the same
// way the YouTube Music account works: no passwords, no API keys.
export type ServiceId = 'spotify' | 'apple';
export interface SourceTrack { title: string; artist: string; album?: string; durationSec?: number }
export interface SourceList { id: string; title: string; count?: number; image?: string; kind: 'liked' | 'playlist' }

const SITE: Record<ServiceId, { match: string; open: string; login: string; name: string }> = {
  spotify: { match: 'https://open.spotify.com/*', open: 'https://open.spotify.com/collection/tracks', login: 'https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F', name: 'Spotify' },
  apple: { match: 'https://music.apple.com/*', open: 'https://music.apple.com/library/songs', login: 'https://music.apple.com/login', name: 'Apple Music' },
};

export class NeedsSignIn extends Error {
  constructor(public service: ServiceId) { super(`Sign in to ${SITE[service].name} in Chrome first`); }
}
export const openLogin = (s: ServiceId) => chrome.tabs.create({ url: SITE[s].login });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Find (or quietly open) a tab on the service and run `probe` in its page until it returns a value. */
async function fromTab<T>(s: ServiceId, probe: () => T | Promise<T>, timeoutMs = 25000): Promise<T | null> {
  let [tab] = await chrome.tabs.query({ url: SITE[s].match });
  let opened = false;
  if (!tab) { tab = await chrome.tabs.create({ url: SITE[s].open, active: false, pinned: true }); opened = true; }
  const until = Date.now() + timeoutMs;
  let reloaded = false;
  try {
    while (Date.now() < until) {
      try {
        const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'MAIN', func: probe });
        if (r?.result) return r.result as T;
      } catch { /* page still loading */ }
      // A tab opened before Tunes was installed has no token hook yet.
      if (s === 'spotify' && !opened && !reloaded && Date.now() > until - timeoutMs + 3000) { reloaded = true; await chrome.tabs.reload(tab.id!); }
      await sleep(800);
    }
    return null;
  } finally {
    if (opened && tab.id != null) setTimeout(() => chrome.tabs.remove(tab.id!).catch(() => {}), 500);
  }
}

// ---------------- Spotify ----------------
let spToken: { token: string; at: number } | null = null;
async function spotifyToken(): Promise<string> {
  if (spToken && Date.now() - spToken.at < 20 * 60 * 1000) return spToken.token;
  const cap = await fromTab('spotify', () => {
    const c = (window as unknown as { __bcSpotify?: { token?: string; at?: number } }).__bcSpotify;
    // A signed-out web player still gets an anonymous token, so wait until the
    // page shows who's signed in (or the Log in button) before trusting it.
    if (document.querySelector('[data-testid="login-button"]')) return { out: true } as { out: true };
    const user = document.querySelector('[data-testid="user-widget-link"], [data-testid="user-widget-avatar"]');
    // Top bar drawn and no Log in button: signed in (the API call confirms it).
    const drawn = document.querySelector('[data-testid="top-bar-back-button"], [data-testid="home-button"], nav');
    return c?.token && (user || drawn) ? c : null;
  });
  if (!cap || 'out' in cap || !cap.token) throw new NeedsSignIn('spotify');
  spToken = { token: cap.token, at: Date.now() };
  return cap.token;
}
async function sp(path: string): Promise<any> {
  const url = path.startsWith('http') ? path : `https://api.spotify.com/v1${path}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await spotifyToken()}` } });
    if (res.status === 401 || res.status === 403) {
      spToken = null;
      if (attempt >= 1) throw new NeedsSignIn('spotify'); // fresh token still refused: not a signed-in session
      continue;
    }
    if (res.status === 429) { await sleep((Number(res.headers.get('retry-after')) || 2) * 1000); continue; }
    if (!res.ok) throw new Error(`Spotify answered ${res.status}`);
    return res.json();
  }
  throw new Error('Spotify kept refusing the request');
}
async function spAll(first: string, pick: (it: any) => SourceTrack | null): Promise<SourceTrack[]> {
  const out: SourceTrack[] = [];
  let next: string | null = first;
  while (next) {
    const d: any = await sp(next);
    for (const it of d.items ?? []) { const t = pick(it); if (t) out.push(t); }
    next = d.next;
  }
  return out;
}
const spTrack = (t: any): SourceTrack | null =>
  t && t.type === 'track' && t.name ? { title: t.name, artist: (t.artists ?? []).map((a: any) => a.name).join(', '), album: t.album?.name, durationSec: t.duration_ms ? Math.round(t.duration_ms / 1000) : undefined } : null;

async function spotifyLists(): Promise<SourceList[]> {
  const liked = await sp('/me/tracks?limit=1');
  const lists: SourceList[] = [{ id: 'liked', title: 'Liked Songs', count: liked.total, kind: 'liked' }];
  let next: string | null = '/me/playlists?limit=50';
  while (next) {
    const d: any = await sp(next);
    for (const p of d.items ?? []) if (p) lists.push({ id: p.id, title: p.name, count: p.tracks?.total ?? p.items?.total, image: p.images?.[0]?.url, kind: 'playlist' });
    next = d.next;
  }
  return lists;
}
async function spotifyTracks(id: string): Promise<SourceTrack[]> {
  if (id === 'liked') return spAll('/me/tracks?limit=50', (it) => spTrack(it.track));
  return spAll(`/playlists/${id}/tracks?limit=100&additional_types=track`, (it) => spTrack(it.track ?? it.item));
}

/** Public Spotify playlist/album link, no sign-in: read the embed page. */
export async function spotifyLink(url: string): Promise<{ title: string; image?: string; tracks: SourceTrack[] }> {
  const m = url.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album)\/([A-Za-z0-9]+)/);
  if (!m) throw new Error('That isn’t a Spotify playlist or album link');
  // The public embed page needs no sign-in (it lists up to ~100 songs).
  let embed: { title: string; image?: string; tracks: SourceTrack[] } | null = null;
  try {
    const html = await (await fetch(`https://open.spotify.com/embed/${m[1]}/${m[2]}`)).text();
    const json = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s)?.[1];
    const ent = json ? JSON.parse(json)?.props?.pageProps?.state?.data?.entity : null;
    if (ent?.trackList?.length) embed = {
      title: ent.name ?? ent.title ?? 'Spotify playlist',
      image: ent.coverArt?.sources?.[0]?.url,
      tracks: ent.trackList.map((t: any) => ({ title: t.title, artist: String(t.subtitle ?? '').replace(/\u00a0/g, ' '), durationSec: t.duration ? Math.round(t.duration / 1000) : undefined })),
    };
  } catch { /* fall through */ }
  if (embed && embed.tracks.length < 100) return embed;
  // Long (or private) list: read it in full with your Spotify session.
  try {
    const d = await sp(`/${m[1]}s/${m[2]}?fields=name,images`);
    const tracks = m[1] === 'album' ? await spAll(`/albums/${m[2]}/tracks?limit=50`, (t) => spTrack({ ...t, album: { name: d.name } })) : await spotifyTracks(m[2]);
    return { title: d.name, image: d.images?.[0]?.url, tracks };
  } catch (e) {
    if (embed) return embed;
    throw e instanceof NeedsSignIn ? e : new Error('Couldn’t read that Spotify link');
  }
}

// ---------------- Apple Music ----------------
let am: { dev: string; user: string; at: number } | null = null;
async function appleTokens() {
  if (am && Date.now() - am.at < 30 * 60 * 1000) return am;
  const r = await fromTab('apple', () => {
    const mk = (window as any).MusicKit?.getInstance?.();
    if (!mk?.developerToken) return null;
    return { dev: mk.developerToken as string, user: (mk.musicUserToken as string) || '' };
  });
  if (!r) throw new Error('Couldn’t reach Apple Music');
  if (!r.user) throw new NeedsSignIn('apple');
  am = { ...r, at: Date.now() };
  return am;
}
async function ap(path: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = await appleTokens();
    const res = await fetch(`https://amp-api.music.apple.com${path}`, { headers: { Authorization: `Bearer ${t.dev}`, 'Media-User-Token': t.user } });
    if (res.status === 401 || res.status === 403) { am = null; continue; }
    if (res.status === 429) { await sleep(2000); continue; }
    if (!res.ok) throw new Error(`Apple Music answered ${res.status}`);
    return res.json();
  }
  throw new Error('Apple Music kept refusing the request');
}
async function apAll(first: string): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = first;
  while (next) {
    const d: any = await ap(next);
    out.push(...(d.data ?? []));
    next = d.next ? `${d.next}${d.next.includes('limit=') ? '' : (d.next.includes('?') ? '&' : '?') + 'limit=100'}` : null;
  }
  return out;
}
const apTrack = (x: any): SourceTrack | null => {
  const a = x?.attributes;
  return a?.name ? { title: a.name, artist: a.artistName ?? '', album: a.albumName, durationSec: a.durationInMillis ? Math.round(a.durationInMillis / 1000) : undefined } : null;
};
async function appleLists(): Promise<SourceList[]> {
  const pls = await apAll('/v1/me/library/playlists?limit=100');
  return [
    { id: 'songs', title: 'Library songs', kind: 'liked' },
    ...pls.map((p: any) => ({ id: p.id, title: p.attributes?.name ?? 'Playlist', image: p.attributes?.artwork?.url?.replace('{w}', '300').replace('{h}', '300'), kind: 'playlist' as const })),
  ];
}
async function appleTracks(id: string): Promise<SourceTrack[]> {
  const rows = id === 'songs' ? await apAll('/v1/me/library/songs?limit=100') : await apAll(`/v1/me/library/playlists/${id}/tracks?limit=100`);
  return rows.map(apTrack).filter(Boolean) as SourceTrack[];
}

export const SERVICES: Record<ServiceId, { name: string; lists: () => Promise<SourceList[]>; tracks: (id: string) => Promise<SourceTrack[]> }> = {
  spotify: { name: 'Spotify', lists: spotifyLists, tracks: spotifyTracks },
  apple: { name: 'Apple Music', lists: appleLists, tracks: appleTracks },
};

/** CSV from Exportify, TuneMyMusic, Soundiiz… (needs a title and an artist column). */
export function parseCsv(text: string): SourceTrack[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const ti = col('track name', 'title', 'song', 'name'), ai = col('artist name', 'artist'), al = col('album name', 'album'), du = col('duration (ms)', 'duration');
  if (ti < 0 || ai < 0) throw new Error('The CSV needs a track/title column and an artist column');
  return rows.filter((r) => r[ti]?.trim()).map((r) => {
    const d = du >= 0 ? Number(r[du]) : NaN;
    return { title: r[ti].trim(), artist: r[ai]?.trim() ?? '', album: al >= 0 ? r[al]?.trim() : undefined, durationSec: isFinite(d) && d > 0 ? Math.round(d > 10000 ? d / 1000 : d) : undefined };
  });
}
