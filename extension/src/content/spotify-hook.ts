// Runs in open.spotify.com's own JS world. The Spotify web player signs every
// request with a short-lived Bearer token; we remember the latest one so
// Tunes's "Transfer music" can read *your* playlists and Liked Songs with
// the session you already have in Chrome. Nothing is sent anywhere else.
type Cap = { token?: string; clientToken?: string; at?: number };
const w = window as unknown as { __bcSpotify?: Cap };
w.__bcSpotify = w.__bcSpotify ?? {};
const grab = (k: string, v: string | null | undefined) => {
  if (!v) return;
  const key = k.toLowerCase();
  if (key === 'authorization' && /^Bearer\s+\S{20,}/i.test(v)) { w.__bcSpotify!.token = v.replace(/^Bearer\s+/i, ''); w.__bcSpotify!.at = Date.now(); }
  if (key === 'client-token') w.__bcSpotify!.clientToken = v;
};
const origFetch = window.fetch;
window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
  try {
    const h = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    if (h instanceof Headers) h.forEach((v, k) => grab(k, v));
    else if (Array.isArray(h)) h.forEach(([k, v]) => grab(k, v));
    else if (h) Object.entries(h as Record<string, string>).forEach(([k, v]) => grab(k, v));
  } catch { /* ignore */ }
  return origFetch.call(this, input as RequestInfo, init);
} as typeof fetch;
const origSet = XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader = function (k: string, v: string) {
  try { grab(k, v); } catch { /* ignore */ }
  return origSet.call(this, k, v);
};
