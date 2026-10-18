// Podcast subscriptions and listening progress, in chrome.storage.local.
import type { Track } from '../types';
import type { Episode, Show } from './feed';
import { feedKey, type PodcastCard } from './directory';

export interface Subscription { feedUrl: string; title: string; author: string; image: string; addedAt: number; /** newest episode time seen when last opened */ seenUpTo: number; latest?: number }
export interface Progress { pos: number; dur: number; played: boolean; at: number }

export const SUBS = 'podcastSubs', PROGRESS = 'podcastProgress';
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> { const r = chain.then(fn); chain = r.catch(() => {}); return r; }

export async function getSubs(): Promise<Subscription[]> { return ((await chrome.storage.local.get(SUBS))[SUBS] as Subscription[]) ?? []; }
export async function isSubscribed(feedUrl: string) { const k = feedKey(feedUrl); return (await getSubs()).some((s) => feedKey(s.feedUrl) === k); }
export function subscribe(c: Pick<PodcastCard, 'feedUrl' | 'title' | 'author' | 'image'>, latest = 0): Promise<void> {
  return locked(async () => {
    const list = await getSubs();
    const k = feedKey(c.feedUrl);
    if (list.some((s) => feedKey(s.feedUrl) === k)) return;
    await chrome.storage.local.set({ [SUBS]: [{ feedUrl: c.feedUrl, title: c.title, author: c.author, image: c.image, addedAt: Date.now(), seenUpTo: latest, latest }, ...list] });
  });
}
export function unsubscribe(feedUrl: string): Promise<void> {
  return locked(async () => {
    const k = feedKey(feedUrl);
    await chrome.storage.local.set({ [SUBS]: (await getSubs()).filter((s) => feedKey(s.feedUrl) !== k) });
  });
}
/** After a refresh: record the newest episode, follow a moved feed, mark seen when opened. */
export function updateSub(feedUrl: string, patch: Partial<Subscription>): Promise<void> {
  return locked(async () => {
    const k = feedKey(feedUrl);
    await chrome.storage.local.set({ [SUBS]: (await getSubs()).map((s) => (feedKey(s.feedUrl) === k ? { ...s, ...patch } : s)) });
  });
}

export async function getProgress(): Promise<Record<string, Progress>> { return ((await chrome.storage.local.get(PROGRESS))[PROGRESS] as Record<string, Progress>) ?? {}; }
/** Keeps the 2,000 most recent entries. */
export function saveProgress(id: string, p: Omit<Progress, 'at'>): Promise<void> {
  return locked(async () => {
    const all = await getProgress();
    all[id] = { ...p, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 2000) for (const k of keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 2000)) delete all[k];
    await chrome.storage.local.set({ [PROGRESS]: all });
  });
}

/** A queue item for an episode. The id is "pod:" + the episode's fingerprint, unique per feed. */
export function episodeTrack(show: Pick<Show, 'feedUrl' | 'title' | 'author' | 'image'>, e: Episode): Track {
  const m = Math.floor(e.duration / 60), h = Math.floor(m / 60);
  return {
    videoId: `pod:${feedKey(show.feedUrl).slice(0, 60)}#${e.id}`,
    title: e.title,
    artists: show.title,
    album: show.author || undefined,
    thumbnail: e.image || show.image,
    duration: e.duration ? (h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(e.duration % 60).padStart(2, '0')}` : `${m}:${String(e.duration % 60).padStart(2, '0')}`) : undefined,
    // The player is a secure page: plain-http audio is blocked there, and nearly every podcast host serves https too.
    podcast: { url: e.url.replace(/^http:\/\//i, 'https://'), type: e.type, feedUrl: show.feedUrl, published: e.published },
  };
}

// ---------- OPML ----------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function toOpml(subs: Subscription[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Tunes podcasts</title><dateCreated>${new Date().toUTCString()}</dateCreated></head>\n  <body>\n${subs.map((s) => `    <outline type="rss" text="${esc(s.title)}" title="${esc(s.title)}" xmlUrl="${esc(s.feedUrl)}"/>`).join('\n')}\n  </body>\n</opml>\n`;
}
export function fromOpml(xml: string, parser: { parseFromString(s: string, t: string): Document } = new DOMParser()): { feedUrl: string; title: string }[] {
  const doc = parser.parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement?.tagName.toLowerCase() !== 'opml') throw new Error('That file isn’t a valid OPML file.');
  const out: { feedUrl: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const o of Array.from(doc.getElementsByTagName('outline'))) {
    const u = o.getAttribute('xmlUrl') ?? o.getAttribute('xmlurl') ?? o.getAttribute('url');
    if (!u || !/^https?:\/\//i.test(u) || seen.has(feedKey(u))) continue;
    seen.add(feedKey(u));
    const dec = (x: string) => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    out.push({ feedUrl: dec(u), title: dec(o.getAttribute('title') ?? o.getAttribute('text') ?? u) });
  }
  return out;
}
