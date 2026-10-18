// Better autoplay/radio picks. YouTube's radio is a good start, but on its own
// it repeats what you just heard, lists the same song as video + audio + lyric
// upload, and bunches one artist together. This cleans that up.
import { isBlocked, type Blocked } from './blocklist';
import { titleParts } from './matcher';
import type { Track } from './types';

export interface RadioContext {
  /** Already in the queue */
  queued: Set<string>;
  /** Recently played, newest first */
  recent: Track[];
  /** "Suggest less" ids */
  less: Set<string>;
  blocked: Blocked;
}

const lead = (t: Track) => t.artists.split(/,|&| x | feat\.? | ft\.? /i)[0].trim().toLowerCase();
/** Same recording under another upload: same title proper and lead artist. */
const songKey = (t: Track) => `${titleParts(t.title).words}|${lead(t)}`;

export function refineRadio(candidates: Track[], ctx: RadioContext, want = 25): Track[] {
  const recentIds = new Set(ctx.recent.slice(0, 60).map((t) => t.videoId));
  const seenKeys = new Set([...ctx.recent.slice(0, 60)].map(songKey));
  const out: Track[] = [];
  const pool: Track[] = [];
  for (const t of candidates) {
    if (ctx.queued.has(t.videoId) || ctx.less.has(t.videoId) || isBlocked(t, ctx.blocked)) continue;
    const k = songKey(t);
    if (seenKeys.has(k)) continue; // a duplicate upload, or a song you just heard
    seenKeys.add(k);
    if (recentIds.has(t.videoId)) continue;
    pool.push(t);
  }
  // Spread artists out: never three in a row by the same lead artist.
  while (pool.length && out.length < want) {
    const n = out.length;
    const streak = n >= 2 && lead(out[n - 1]) === lead(out[n - 2]) ? lead(out[n - 1]) : null;
    const i = streak ? pool.findIndex((t) => lead(t) !== streak) : 0;
    if (i < 0) break;
    const [t] = pool.splice(i, 1);
    out.push(t);
  }
  return out;
}

/** Interleave two radios (current song first) so the mix follows where you've been, not just this one song. */
export function blend(a: Track[], b: Track[]): Track[] {
  const out: Track[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (i % 2 === 1 && b[i >> 1]) out.push(b[i >> 1]);
  }
  return out;
}
