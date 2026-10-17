// Accounts: YouTube Music (default), Google, Apple Music.
// Tunes never asks for passwords. Like the Android app's login WebView,
// it reuses the sessions you already have in Chrome: you sign in on the
// provider's own page, and Tunes reads the session cookies from there.
import { getAccountInfo, type AccountInfo } from './innertube';

export interface GoogleAccount { index: number; name: string; email: string; photo: string; signedIn: boolean }

export const SIGN_IN_URL = {
  'youtube-music': 'https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=https%3A%2F%2Fmusic.youtube.com%2F',
  google: 'https://accounts.google.com/AddSession?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F',
  'apple-music': 'https://music.apple.com/login',
} as const;

const cookie = (url: string, name: string) => chrome.cookies.get({ url, name }).then((c) => c?.value ?? null).catch(() => null);

/** Any cookie by name on a domain (covers host-only and dot-domain copies). */
async function anyCookie(domain: string, names: string[]): Promise<string | null> {
  try {
    const all = await chrome.cookies.getAll({ domain });
    for (const n of names) { const c = all.find((x) => x.name === n && x.value); if (c) return c.value; }
  } catch { /* ignore */ }
  return null;
}

export const YT_AUTH_COOKIES = ['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID'];
export const AUTH_COOKIE_NAMES = new Set([...YT_AUTH_COOKIES, 'SID', '__Secure-3PSID', '__Secure-1PSID', 'LOGIN_INFO', 'media-user-token', 'myacinfo']);

/** A short fingerprint of the current YouTube session ('out' when signed out). Changes on sign-in, sign-out or account switch. */
export async function sessionId(): Promise<string> {
  const v = await anyCookie('youtube.com', YT_AUTH_COOKIES);
  if (!v) return 'out';
  let h = 0;
  for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function youtubeMusicStatus(): Promise<AccountInfo | 'signed-out' | 'signed-in'> {
  const sid = await anyCookie('youtube.com', YT_AUTH_COOKIES);
  if (!sid) return 'signed-out';
  return (await getAccountInfo()) ?? 'signed-in';
}

/** Google accounts signed in to Chrome's cookie jar, in X-Goog-AuthUser order. */
export async function googleAccounts(): Promise<GoogleAccount[]> {
  const sid = (await anyCookie('google.com', ['SID', '__Secure-3PSID', '__Secure-1PSID'])) ?? (await cookie('https://accounts.google.com', 'SID'));
  if (!sid) return [];
  try {
    const res = await fetch('https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard', { credentials: 'include' });
    const raw = await res.text();
    const data = JSON.parse(raw.replace(/^\)\]\}'\n?/, ''));
    const list: unknown[][] = Array.isArray(data?.[1]) ? data[1] : [];
    return list.map((a, i) => ({
      index: typeof a[7] === 'number' ? (a[7] as number) : i,
      name: String(a[2] ?? ''),
      email: String(a[3] ?? ''),
      photo: String(a[4] ?? ''),
      signedIn: a[9] !== 0,
    })).filter((a) => a.email);
  } catch {
    return [{ index: 0, name: 'Google account', email: '', photo: '', signedIn: true }];
  }
}

export async function appleMusicSignedIn(): Promise<boolean> {
  // media-user-token = Apple Music web session; myacinfo = signed-in Apple ID
  return !!(await anyCookie('apple.com', ['media-user-token', 'myacinfo']));
}

export function openSignIn(id: keyof typeof SIGN_IN_URL) {
  chrome.tabs.create({ url: SIGN_IN_URL[id] });
}
