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
