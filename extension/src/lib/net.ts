// fetch with a hard deadline that also covers reading the body. Every network
// call in Tunes goes through this, so no song or screen can wait forever.
export class TimeoutError extends Error {
  constructor(what: string) { super(`${what} took too long`); this.name = 'TimeoutError'; }
}

export async function fetchJson<T = unknown>(url: string, init: RequestInit = {}, ms = 8000, what = 'Request'): Promise<{ res: Response; data: T }> {
  const ctl = new AbortController();
  const outer = init.signal;
  if (outer) outer.addEventListener('abort', () => ctl.abort(), { once: true });
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    const data = (res.ok ? await res.json() : null) as T;
    return { res, data };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError' && !outer?.aborted) throw new TimeoutError(what);
    throw e;
  } finally { clearTimeout(timer); }
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 8000, what = 'Request'): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new TimeoutError(what);
    throw e;
  } finally { clearTimeout(timer); }
}

/** Reject after ms if the promise hasn't settled. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new TimeoutError(what)), ms); })]).finally(() => clearTimeout(t));
}

/** GET a body as text with one deadline for the whole request, body included. Throws on HTTP errors. */
export async function fetchText(url: string, init: RequestInit = {}, ms = 15000, what = 'Request', maxBytes = 20_000_000): Promise<{ text: string; url: string; type: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`${what} answered ${res.status}`);
    const len = Number(res.headers.get('content-length'));
    if (len > maxBytes) throw new Error(`${what} is too large`);
    const text = await res.text();
    if (text.length > maxBytes) throw new Error(`${what} is too large`);
    return { text, url: res.url || url, type: res.headers.get('content-type') ?? '' };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new TimeoutError(what);
    throw e;
  } finally { clearTimeout(timer); }
}
/** GET JSON (deadline covers the body); throws on HTTP errors. */
export async function getJson<T = any>(url: string, ms = 10000, what = 'Request'): Promise<T> {
  const { text } = await fetchText(url, {}, ms, what, 5_000_000);
  try { return JSON.parse(text) as T; } catch { throw new Error(`${what} sent an unreadable answer`); }
}
