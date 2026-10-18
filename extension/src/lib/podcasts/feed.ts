// Podcast RSS/Atom parsing, in the browser with DOMParser (the side panel; an
// MV3 service worker has no DOMParser).
//
// Parsing rules follow AntennaPod's feed parser (GPL-3.0,
// github.com/AntennaPod/AntennaPod, parser/feed): enclosure first, then
// media:content; itunes:duration as seconds, MM:SS or HH:MM:SS; itunes:image
// over the channel <image>; guid, else enclosure URL, else link; RFC 822 and
// ISO dates; Podcasting 2.0 chapters/transcript tags (public-domain spec,
// podcastindex.org/namespace/1.0).
// Episode de-duplication is ported from Winds (BSD-3-Clause, Copyright 2018
// Stream.io Inc, github.com/GetStream/Winds api/src/parsers/feed.js,
// CreateFingerPrints): a feed's guids are used only when they are unique, else
// links, else enclosure URLs, else a content hash.

export interface Episode {
  /** Stable id inside the feed (see fingerprint) */
  id: string;
  guid?: string;
  title: string;
  url: string;
  type: string;
  bytes?: number;
  /** Unix ms; 0 when the feed gives none */
  published: number;
  /** seconds; 0 = unknown */
  duration: number;
  image?: string;
  description: string;
  link?: string;
  season?: number;
  episode?: number;
  explicit?: boolean;
  chapters?: string;
  transcript?: { url: string; type: string };
}
export interface Show {
  feedUrl: string;
  title: string;
  author: string;
  image: string;
  description: string;
  link?: string;
  language?: string;
  categories: string[];
  explicit?: boolean;
  /** itunes:new-feed-url: the show moved */
  movedTo?: string;
  /** RFC 5005 paged feed: the next (older) page */
  nextPage?: string;
  episodes: Episode[];
}

type El = Element;
const kids = (el: El | Document | null | undefined): El[] => (el ? Array.from((el as El).children ?? []) : []);
const nameOf = (e: El) => e.tagName.toLowerCase();
/** First direct child with one of these tag names ("itunes:image", "image"…). */
function child(el: El | null | undefined, ...names: string[]): El | undefined {
  for (const n of names) { const hit = kids(el).find((k) => nameOf(k) === n); if (hit) return hit; }
  return undefined;
}
const all = (el: El | null | undefined, ...names: string[]) => kids(el).filter((k) => names.includes(nameOf(k)));
const text = (el?: El) => (el?.textContent ?? '').trim();
const attr = (el: El | undefined, a: string) => el?.getAttribute(a)?.trim() || undefined;

/** "1:02:03", "62:03", "3723", "3723.5" → seconds. Bad values give 0. */
export function parseDuration(s?: string): number {
  if (!s) return 0;
  const v = s.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v));
  const p = v.split(':').map((x) => Number(x.trim()));
  if (p.length < 2 || p.length > 3 || p.some((x) => !Number.isFinite(x) || x < 0)) return 0;
  return Math.round(p.reduce((acc, x) => acc * 60 + x, 0));
}

/** RFC 822 (with odd zones and day names) and ISO 8601 → ms, or 0. */
export function parseDate(s?: string): number {
  if (!s) return 0;
  let v = s.trim().replace(/\s+/g, ' ');
  let t = Date.parse(v);
  if (Number.isFinite(t)) return t;
  // "Mon, 5 Oct 2026 10:00:00 IST" and friends: drop the day name, map common zones
  const zones: Record<string, string> = { IST: '+0530', PST: '-0800', PDT: '-0700', EST: '-0500', EDT: '-0400', CET: '+0100', CEST: '+0200', BST: '+0100', AEST: '+1000', JST: '+0900', UT: '+0000', Z: '+0000' };
  v = v.replace(/^[A-Za-z]{2,}\.?,?\s*/, '').replace(/\b([A-Z]{1,4})$/, (z) => zones[z] ?? z);
  t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

/** Feed HTML descriptions → short plain text (no markup ever reaches the UI as HTML). */
export function plain(html: string, max = 600): string {
  const s = html
    .replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\s*(br|\/p|\/div|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

const okUrl = (u?: string, base?: string): string | undefined => {
  if (!u) return undefined;
  try {
    const x = new URL(u, base);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : undefined;
  } catch { return undefined; }
};
const isAudioish = (type?: string, url?: string) =>
  (type ? /^(audio|video)\//i.test(type) || /octet-stream|x-m4a|mpeg/i.test(type) : false) || /\.(mp3|m4a|aac|ogg|oga|opus|mp4|m4b|wav|flac)(\?|$)/i.test(url ?? '');

function hash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = (Math.imul(h2, 31) + c) | 0; }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/** Winds-style: use the first id kind that is present and unique for every episode. */
function fingerprint(eps: (Omit<Episode, 'id'>)[]): string[] {
  const kinds: ((e: Omit<Episode, 'id'>) => string | undefined)[] = [(e) => e.guid, (e) => e.link, (e) => e.url];
  for (const k of kinds) {
    const ids = eps.map(k);
    if (ids.every(Boolean) && new Set(ids).size === ids.length) return ids.map((x) => hash(x!));
  }
  return eps.map((e) => hash(`${e.title}:${e.url}:${e.published}`));
}

export class FeedError extends Error {}

export function parseFeed(xml: string, feedUrl: string, parser: { parseFromString(s: string, t: string): Document } = new DOMParser()): Show {
  const doc = parser.parseFromString(xml.replace(/^\uFEFF/, ''), 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new FeedError('This podcast feed is broken (not valid XML).');
  const root = doc.documentElement;
  const rootName = root ? nameOf(root) : '';
  if (rootName === 'feed') return parseAtom(root, feedUrl);
  const channel = rootName === 'rss' ? child(root, 'channel') : rootName === 'rdf:rdf' ? child(root, 'channel') : undefined;
  if (!channel) throw new FeedError('That address isn’t a podcast feed.');
  const items = rootName === 'rdf:rdf' ? all(root, 'item') : all(channel, 'item');
  const chImage = okUrl(attr(child(channel, 'itunes:image'), 'href') ?? text(child(child(channel, 'image'), 'url')), feedUrl) ?? '';
  const raw = items.map((it): Omit<Episode, 'id'> | null => {
    const enc = child(it, 'enclosure');
    const media = all(it, 'media:content').find((m) => isAudioish(attr(m, 'type'), attr(m, 'url')));
    const url = okUrl(attr(enc, 'url') ?? attr(media, 'url'), feedUrl);
    const type = attr(enc, 'type') ?? attr(media, 'type') ?? 'audio/mpeg';
    if (!url || !isAudioish(type, url)) return null; // blog posts in a mixed feed
    const tr = all(it, 'podcast:transcript');
    const pick = tr.find((x) => /vtt|srt|json/.test(attr(x, 'type') ?? '')) ?? tr[0];
    const sn = Number(text(child(it, 'itunes:season'))), en = Number(text(child(it, 'itunes:episode')));
    return {
      guid: text(child(it, 'guid')) || undefined,
      title: plain(text(child(it, 'title', 'itunes:title')), 300) || 'Untitled episode',
      url, type,
      bytes: Number(attr(enc, 'length')) || undefined,
      published: parseDate(text(child(it, 'pubdate', 'dc:date'))),
      duration: parseDuration(text(child(it, 'itunes:duration'))) || Math.round(Number(attr(media, 'duration')) || 0),
      image: okUrl(attr(child(it, 'itunes:image'), 'href'), feedUrl),
      description: plain(text(child(it, 'content:encoded', 'description', 'itunes:summary'))),
      link: okUrl(text(child(it, 'link')), feedUrl),
      season: Number.isFinite(sn) && sn > 0 ? sn : undefined,
      episode: Number.isFinite(en) && en > 0 ? en : undefined,
      explicit: /^(yes|true|explicit)$/i.test(text(child(it, 'itunes:explicit'))) || undefined,
      chapters: okUrl(attr(child(it, 'podcast:chapters'), 'url'), feedUrl),
      transcript: pick && okUrl(attr(pick, 'url'), feedUrl) ? { url: okUrl(attr(pick, 'url'), feedUrl)!, type: attr(pick, 'type') ?? 'text/plain' } : undefined,
    };
  }).filter((x): x is Omit<Episode, 'id'> => !!x);
  const ids = fingerprint(raw);
  const episodes = raw.map((e, i) => ({ ...e, id: ids[i] })).sort((a, b) => b.published - a.published);
  const next = kids(channel).find((k) => (nameOf(k) === 'atom:link' || nameOf(k) === 'link') && attr(k, 'rel') === 'next');
  return {
    feedUrl,
    title: plain(text(child(channel, 'title', 'itunes:title')), 200) || 'Untitled podcast',
    author: plain(text(child(channel, 'itunes:author', 'author', 'managingeditor', 'dc:creator')), 120),
    image: chImage,
    description: plain(text(child(channel, 'description', 'itunes:summary')), 1200),
    link: okUrl(text(child(channel, 'link')), feedUrl),
    language: text(child(channel, 'language')) || undefined,
    categories: [...new Set(kids(channel).filter((k) => nameOf(k) === 'itunes:category').map((k) => attr(k, 'text')).filter((x): x is string => !!x))],
    explicit: /^(yes|true|explicit)$/i.test(text(child(channel, 'itunes:explicit'))) || undefined,
    movedTo: okUrl(text(child(channel, 'itunes:new-feed-url')), feedUrl),
    nextPage: okUrl(attr(next, 'href'), feedUrl),
    episodes,
  };
}

function parseAtom(feed: El, feedUrl: string): Show {
  const raw = all(feed, 'entry').map((en): Omit<Episode, 'id'> | null => {
    const enc = all(en, 'link').find((l) => attr(l, 'rel') === 'enclosure');
    const url = okUrl(attr(enc, 'href'), feedUrl);
    const type = attr(enc, 'type') ?? 'audio/mpeg';
    if (!url || !isAudioish(type, url)) return null;
    return {
      guid: text(child(en, 'id')) || undefined, title: plain(text(child(en, 'title')), 300) || 'Untitled episode', url, type,
      bytes: Number(attr(enc, 'length')) || undefined, published: parseDate(text(child(en, 'published', 'updated'))),
      duration: parseDuration(text(child(en, 'itunes:duration'))), image: undefined,
      description: plain(text(child(en, 'content', 'summary'))), link: okUrl(attr(all(en, 'link').find((l) => (attr(l, 'rel') ?? 'alternate') === 'alternate'), 'href'), feedUrl),
    };
  }).filter((x): x is Omit<Episode, 'id'> => !!x);
  const ids = fingerprint(raw);
  return {
    feedUrl, title: plain(text(child(feed, 'title')), 200) || 'Untitled podcast', author: plain(text(child(child(feed, 'author'), 'name')), 120),
    image: okUrl(text(child(feed, 'logo', 'icon')), feedUrl) ?? '', description: plain(text(child(feed, 'subtitle')), 1200), categories: [],
    nextPage: okUrl(attr(all(feed, 'link').find((l) => attr(l, 'rel') === 'next'), 'href'), feedUrl),
    episodes: raw.map((e, i) => ({ ...e, id: ids[i] })).sort((a, b) => b.published - a.published),
  };
}

/**
 * A website's podcast feed, from its HTML (port of Winds' discoverFromHTML):
 * <link rel="alternate" type="application/rss+xml" href="…">. Returns absolute URLs, best first.
 */
export function discoverFeeds(html: string, pageUrl: string, parser: { parseFromString(s: string, t: string): Document } = new DOMParser()): string[] {
  const doc = parser.parseFromString(html, 'text/html');
  const links = Array.from(doc.querySelectorAll('link[rel~="alternate"]'))
    .filter((l) => /rss|atom|xml/i.test(l.getAttribute('type') ?? ''))
    .map((l) => ({ href: okUrl(l.getAttribute('href') ?? undefined, pageUrl), title: (l.getAttribute('title') ?? '').toLowerCase() }))
    .filter((l): l is { href: string; title: string } => !!l.href && !/comments/.test(l.title + l.href));
  links.sort((a, b) => Number(/podcast|audio|episode/.test(b.title + b.href)) - Number(/podcast|audio|episode/.test(a.title + a.href)));
  return [...new Set(links.map((l) => l.href))];
}
