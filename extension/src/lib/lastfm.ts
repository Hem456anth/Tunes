// Last.fm scrobbling (Tunes's Last.fm integration), desktop auth flow:
// auth.getToken -> user approves on last.fm -> auth.getSession. Uses the
// user's own API key + shared secret, so nothing secret ships in the extension.
import MD5 from 'crypto-js/md5';
import { fetchWithTimeout } from './net';

const API = 'https://ws.audioscrobbler.com/2.0/';

function sign(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params).filter((k) => k !== 'format' && k !== 'callback').sort().map((k) => k + params[k]).join('');
  return MD5(base + secret).toString();
}

async function call(method: string, params: Record<string, string>, key: string, secret: string, post = false): Promise<any> {
  const p: Record<string, string> = { ...params, method, api_key: key };
  p.api_sig = sign(p, secret);
  p.format = 'json';
  const body = new URLSearchParams(p);
  const res = post
    ? await fetchWithTimeout(API, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 10000, 'Last.fm')
    : await fetchWithTimeout(`${API}?${body}`, {}, 10000, 'Last.fm');
  const d = await res.json().catch(() => ({}));
  if (d?.error) throw new Error(`Last.fm: ${d.message ?? d.error}`);
  if (!res.ok) throw new Error(`Last.fm answered ${res.status}`);
  return d;
}

/** Step 1: get a request token and the page where the user approves it. */
export async function lastfmStartAuth(key: string, secret: string): Promise<{ token: string; url: string }> {
  const d = await call('auth.getToken', {}, key, secret);
  const token: string = d.token;
  return { token, url: `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}` };
}
/** Step 2, after approval: exchange the token for a session key. */
export async function lastfmFinishAuth(key: string, secret: string, token: string): Promise<{ session: string; user: string }> {
  const d = await call('auth.getSession', { token }, key, secret);
  return { session: d.session.key, user: d.session.name };
}

export interface ScrobbleTrack { artist: string; track: string; album?: string; duration?: number; timestamp?: number }
const fields = (t: ScrobbleTrack) => {
  const p: Record<string, string> = { artist: t.artist.split(/,| & /)[0].trim(), track: t.track };
  if (t.album) p.album = t.album;
  if (t.duration) p.duration = String(Math.round(t.duration));
  return p;
};
export async function lastfmNowPlaying(key: string, secret: string, sk: string, t: ScrobbleTrack) {
  return call('track.updateNowPlaying', { ...fields(t), sk }, key, secret, true);
}
export async function lastfmScrobble(key: string, secret: string, sk: string, t: ScrobbleTrack) {
  return call('track.scrobble', { ...fields(t), timestamp: String(t.timestamp ?? Math.floor(Date.now() / 1000)), sk }, key, secret, true);
}
