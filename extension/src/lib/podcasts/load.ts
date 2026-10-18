// Fetching podcast feeds (side panel only: parsing needs DOMParser).
import { fetchText } from '../net';
import { discoverFeeds, FeedError, parseFeed, type Show } from './feed';

/** Podcast feeds live on any website, so podcasts need Chrome's "read any site" permission, asked once. */
export const FEED_ORIGINS = ['https://*/*', 'http://*/*'];
export async function hasFeedAccess(): Promise<boolean> {
  if (!chrome.permissions?.contains) return true; // Android build: native fetch, no permission model
  return chrome.permissions.contains({ origins: FEED_ORIGINS });
}
/** Must run inside a click handler. */
export async function requestFeedAccess(): Promise<boolean> {
  if (!chrome.permissions?.request) return true;
  try { return await chrome.permissions.request({ origins: FEED_ORIGINS }); } catch { return false; }
}

const MAX_EPISODES = 500;
const MAX_PAGES = 5;

/**
 * Load a show from its feed URL, or from a website that links one.
 * Follows itunes:new-feed-url once and RFC 5005 "next" pages (up to 5).
 */
export async function loadShow(input: string, depth = 0): Promise<Show> {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let got;
  // Try https first: plain-http feeds are often blocked from secure pages, and most hosts serve both.
  if (/^http:\/\//i.test(url) && depth === 0) {
    try { return await loadShow(url.replace(/^http:/i, 'https:'), 1); } catch { /* fall back to the address as given */ }
  }
  try { got = await fetchText(url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' } }, 20000, 'The podcast feed'); }
  catch (e) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('You’re offline.');
    if (/Failed to fetch|NetworkError/i.test(String((e as Error).message))) throw new Error('Couldn’t reach this podcast. Check the address, or allow Tunes to read podcast feeds.');
    throw e;
  }
  const looksHtml = /text\/html/i.test(got.type) || /^\s*(<!doctype html|<html)/i.test(got.text);
  if (looksHtml) {
    if (depth > 0) throw new FeedError('That address isn’t a podcast feed.');
    const feeds = discoverFeeds(got.text, got.url);
    if (!feeds.length) throw new FeedError('No podcast feed found on that page.');
    return loadShow(feeds[0], depth + 1);
  }
  let show = parseFeed(got.text, url);
  if (show.movedTo && show.movedTo !== url && depth < 2) {
    try { return { ...(await loadShow(show.movedTo, depth + 1)) }; } catch { /* the old address still works */ }
  }
  let next = show.nextPage;
  const seen = new Set(show.episodes.map((e) => e.id));
  for (let i = 0; next && i < MAX_PAGES && show.episodes.length < MAX_EPISODES; i++) {
    try {
      const page = parseFeed((await fetchText(next, {}, 20000, 'The podcast feed')).text, url);
      for (const e of page.episodes) if (!seen.has(e.id)) { seen.add(e.id); show.episodes.push(e); }
      next = page.nextPage && page.nextPage !== next ? page.nextPage : undefined;
    } catch { break; }
  }
  show = { ...show, episodes: show.episodes.sort((a, b) => b.published - a.published).slice(0, MAX_EPISODES) };
  return show;
}
