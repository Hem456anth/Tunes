import { useCallback, useEffect, useRef, useState } from 'react';
import { isFresh, readCache, refresh } from '../lib/cache';
import type { PlayerState, UiCommand } from '../lib/types';
import { artworkColor } from '../lib/theme';
import { AUTH_COOKIE_NAMES, sessionId } from '../lib/accounts';

/** Live session fingerprint: re-renders the moment you sign in/out or switch accounts in any Chrome tab. */
export function useSession(): string | null {
  const [sid, setSid] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const check = () => sessionId().then(setSid);
    check();
    const fn = (c: chrome.cookies.CookieChangeInfo) => {
      if (!AUTH_COOKIE_NAMES.has(c.cookie.name)) return;
      if (t) clearTimeout(t);
      t = setTimeout(check, 800);
    };
    chrome.cookies.onChanged.addListener(fn);
    const vis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', vis);
    return () => { chrome.cookies.onChanged.removeListener(fn); document.removeEventListener('visibilitychange', vis); if (t) clearTimeout(t); };
  }, []);
  return sid;
}

export const send = (cmd: UiCommand) => chrome.runtime.sendMessage(cmd).catch(() => null);

export function usePlayer(): PlayerState | null {
  const [s, setS] = useState<PlayerState | null>(null);
  useEffect(() => {
    let pushed = false; // a broadcast that beats the get-state reply is newer
    send({ type: 'get-state' }).then((r) => { if (r && !pushed) setS(r); });
    // Only the service worker broadcasts state (a content script's message has sender.tab).
    const fn = (msg: any, sender: chrome.runtime.MessageSender) => { if (msg?.type === 'state' && !sender.tab && sender.id === chrome.runtime.id) { pushed = true; setS(msg.state); } };
    chrome.runtime.onMessage.addListener(fn);
    return () => chrome.runtime.onMessage.removeListener(fn);
  }, []);
  return s;
}

// Smoothly ticking position between state pushes: follows the audio clock
// every animation frame, and never steps backwards by a few hundred ms when a
// late push arrives (that jitter made word-by-word lyrics flicker).
export function useLivePosition(s: PlayerState | null, fps = 60): number {
  const [pos, setPos] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    if (!s) return;
    const base = s.position, start = performance.now();
    const clamp = (v: number) => Math.min(v, s.duration || Infinity);
    // small backward corrections are jitter; big ones are seeks
    const first = s.playing && base < last.current && last.current - base < 0.35 ? last.current : base;
    last.current = first; setPos(first);
    if (!s.playing) return;
    let raf = 0, prevPaint = 0;
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      if (now - prevPaint < 1000 / fps) return;
      prevPaint = now;
      const v = clamp(Math.max(first, base + (now - start) / 1000));
      last.current = v; setPos(v);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [s?.position, s?.playing, s?.duration, fps]);
  return pos;
}

export function useArtColor(url?: string): string {
  const [c, setC] = useState('#23232c');
  useEffect(() => {
    let alive = true;
    if (url) artworkColor(url).then((c) => alive && setC(c)).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  return c;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean } {
  const [st, setSt] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setSt((p) => ({ ...p, loading: true, error: null }));
    fn().then((data) => alive && setSt({ data, error: null, loading: false }))
      .catch((e) => alive && setSt({ data: null, error: String(e?.message ?? e), loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return st;
}

export const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

/**
 * Cached data: paints the last copy at once, refreshes it when older than
 * `ttlMs`, and only shows an error when there is nothing to show.
 */
export function useCached<T>(key: string | null, fetcher: () => Promise<T>, ttlMs = 10 * 60 * 1000) {
  const [st, setSt] = useState<{ data: T | null; error: string | null; loading: boolean; refreshing: boolean }>({ data: null, error: null, loading: true, refreshing: false });
  const [nonce, setNonce] = useState(0);
  const forced = useRef(false); // only the run a retry() started skips a fresh cache
  const retry = useCallback(() => { forced.current = true; setNonce((n) => n + 1); }, []);
  useEffect(() => {
    // No key: drop the old key's data rather than showing it under the new context.
    if (!key) { setSt((p) => (p.data === null && !p.error ? p : { data: null, error: null, loading: true, refreshing: false })); return; }
    let alive = true;
    const force = forced.current; forced.current = false;
    setSt({ data: null, error: null, loading: true, refreshing: false });
    (async () => {
      const hit = await readCache<T>(key).catch(() => null);
      if (!alive) return;
      if (hit) setSt({ data: hit.data, error: null, loading: false, refreshing: !isFresh(hit, ttlMs) || force });
      if (hit && isFresh(hit, ttlMs) && !force) return;
      try {
        const data = await refresh(key, fetcher);
        if (alive) setSt({ data, error: null, loading: false, refreshing: false });
      } catch (e: any) {
        if (alive) setSt((p) => ({ data: p.data, error: p.data ? null : String(e?.message ?? e), loading: false, refreshing: false }));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);
  return { ...st, retry };
}

// Live settings: re-renders when Settings change anywhere (panel, tab, background).
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';
import { getSettings } from '../lib/settings';
export function useSettings(): Settings {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    getSettings().then(setS);
    const fn = (c: Record<string, unknown>) => { if ('settings' in c) getSettings().then(setS); };
    chrome.storage.onChanged.addListener(fn);
    return () => chrome.storage.onChanged.removeListener(fn);
  }, []);
  return s;
}
