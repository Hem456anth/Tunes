// Podcast discovery with no API key: Apple's iTunes Search API and top-shows
// chart (country India by default), with fyyd (api.fyyd.de) as a second search.
// Podcast Index is not used: its terms forbid shipping keys in open source.
import { getJson } from '../net';

export interface PodcastCard {
  feedUrl: string;
  title: string;
  author: string;
  image: string;
  /** Apple Podcasts id, when the result came from Apple */
  appleId?: string;
  genre?: string;
  source: 'apple' | 'fyyd' | 'url';
}

const big = (u?: string) => (u ?? '').replace(/\/\d+x\d+bb\.(jpg|png|webp)$/, '/600x600bb.jpg');
const httpsOnly = (u?: string) => (u && /^https?:\/\//i.test(u) ? u.replace(/^http:\/\//i, 'https://') : '');

export function fromItunes(r: any): PodcastCard | null {
  if (!r?.feedUrl) return null;
  return { feedUrl: r.feedUrl, title: r.collectionName ?? r.trackName ?? 'Podcast', author: r.artistName ?? '', image: httpsOnly(r.artworkUrl600 ?? big(r.artworkUrl100)), appleId: r.collectionId ? String(r.collectionId) : undefined, genre: r.primaryGenreName, source: 'apple' };
}
export function fromFyyd(r: any): PodcastCard | null {
  if (!r?.xmlURL || (r.status && r.status !== 200)) return null;
  return { feedUrl: r.xmlURL, title: r.title ?? 'Podcast', author: r.author ?? '', image: httpsOnly(r.imgURL ?? r.layoutImageURL), source: 'fyyd' };
}

/** Feed URLs differ only by scheme, "www." or a trailing slash: treat them as one show. */
export const feedKey = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

export function mergeCards(...lists: PodcastCard[][]): PodcastCard[] {
  const seen = new Set<string>(), out: PodcastCard[] = [];
  for (const l of lists) for (const c of l) { const k = feedKey(c.feedUrl); if (!seen.has(k)) { seen.add(k); out.push(c); } }
  return out;
}

export async function searchApple(term: string, country = 'IN', limit = 30): Promise<PodcastCard[]> {
  const u = `https://itunes.apple.com/search?media=podcast&entity=podcast&country=${encodeURIComponent(country)}&limit=${limit}&term=${encodeURIComponent(term)}`;
  const j = await getJson(u, 10000, 'Apple Podcasts');
  return (j?.results ?? []).map(fromItunes).filter(Boolean) as PodcastCard[];
}
export async function searchFyyd(term: string, count = 20): Promise<PodcastCard[]> {
  const j = await getJson(`https://api.fyyd.de/0.2/search/podcast?title=${encodeURIComponent(term)}&count=${count}`, 10000, 'fyyd');
  return (j?.data ?? []).map(fromFyyd).filter(Boolean) as PodcastCard[];
}

/** Apple first, fyyd fills in; either one failing still gives results. */
export async function searchPodcasts(term: string, country = 'IN'): Promise<PodcastCard[]> {
  const q = term.trim();
  if (!q) return [];
  const [a, f] = await Promise.allSettled([searchApple(q, country), searchFyyd(q)]);
  if (a.status === 'rejected' && f.status === 'rejected') throw new Error('Podcast search is unavailable right now. Try again in a moment.');
  return mergeCards(a.status === 'fulfilled' ? a.value : [], f.status === 'fulfilled' ? f.value : []);
}

/** Apple ids → feed URLs (the chart has no feed URLs). One call for up to 100 ids. */
export async function lookupApple(ids: string[], country = 'IN'): Promise<PodcastCard[]> {
  if (!ids.length) return [];
  const j = await getJson(`https://itunes.apple.com/lookup?country=${encodeURIComponent(country)}&id=${ids.slice(0, 100).join(',')}`, 10000, 'Apple Podcasts');
  const byId = new Map<string, PodcastCard>();
  for (const r of j?.results ?? []) { const c = fromItunes(r); if (c?.appleId) byId.set(c.appleId, c); }
  return ids.map((id) => byId.get(id)).filter(Boolean) as PodcastCard[];
}

/** Top shows in a country (Apple chart), with their feed URLs. */
export async function topPodcasts(country = 'in', n = 50): Promise<PodcastCard[]> {
  const j = await getJson(`https://rss.marketingtools.apple.com/api/v2/${encodeURIComponent(country.toLowerCase())}/podcasts/top/${n}/podcasts.json`, 10000, 'Apple Podcasts');
  const rows: any[] = j?.feed?.results ?? [];
  const found = await lookupApple(rows.map((r) => String(r.id)), country);
  // Keep the chart's order and genre; fall back to the chart's artwork.
  const genre = new Map(rows.map((r) => [String(r.id), r.genres?.[0]?.name as string | undefined]));
  return found.map((c) => ({ ...c, genre: c.genre ?? genre.get(c.appleId!) }));
}
