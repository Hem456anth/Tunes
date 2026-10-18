// Recording matcher, a compact port of Tunes's TrackMatcher.kt idea:
// split a title into the title proper, version words (remix/live/...) and
// throwaway context (film name, "Official Audio"), then require the title and
// version words to agree, a shared artist when both sides name one, and a
// runtime within tolerance.

const VERSION_WORDS = ['remix', 'live', 'acoustic', 'unplugged', 'reprise', 'slowed', 'reverb', 'sped up', 'lofi', 'lo-fi', 'instrumental', 'karaoke', 'cover', 'female version', 'male version', 'remastered', 'extended', 'mashup', '8d', 'eclipsa', 'dolby', 'atmos', 'spatial', 'immersive', 'bass boosted', 'nightcore', 'mix', 'radio edit', 'lofi flip', 'version', 'dj ', 'telugu', 'tamil', 'hindi', 'kannada', 'malayalam', 'marathi', 'bengali', 'punjabi', 'bhojpuri'];
const VERSION_RE = new Map(VERSION_WORDS.map((v) => [v, new RegExp(`(^|[^\\p{L}\\p{N}])${v.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u')]));
const NOISE = /\b(official|video|audio|lyrics?|lyrical|full song|hd|4k|visuali[sz]er|music video|from)\b/g;

const norm = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’'`"]/g, '').replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();

export interface TitleParts { words: string; versions: Set<string> }

export function titleParts(title: string): TitleParts {
  const t = norm(title);
  // Whole words only: "live" is not in "alive", "cover" not in "discover", "mix" not in "remix".
  const versions = new Set(VERSION_WORDS.filter((v) => VERSION_RE.get(v)!.test(t)));
  // Drop bracketed context and "- From ..." tails, then noise words.
  const words = t
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s[-|]\s.*$/, ' ')
    .replace(/\bfeat\.?\b.*$|\bft\.?\b.*$/, ' ')
    .replace(NOISE, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { words, versions };
}

const artistSet = (s: string) =>
  new Set(norm(s).split(/,| and | x | feat\.? | ft\.? |\/|;/).map((a) => a.trim()).filter(Boolean));

export interface MatchTarget { title: string; artist: string; durationSec?: number; /** seconds of runtime drift allowed (default 12) */ tolerance?: number }
export interface MatchCandidate { title: string; artist: string; durationSec?: number }

/** 0 = reject; higher is better. */
export function score(target: MatchTarget, c: MatchCandidate): number {
  const a = titleParts(target.title), b = titleParts(c.title);
  // Exact title proper only: "Gehra Hua" must not match "Gehra Hua Afro Mix".
  if (!a.words || a.words !== b.words) return 0;
  for (const v of new Set([...a.versions, ...b.versions])) if (a.versions.has(v) !== b.versions.has(v)) return 0;
  let sc = 50;
  const ta = artistSet(target.artist), ca = artistSet(c.artist);
  if (ta.size && ca.size) {
    const same = (x: string, y: string) => x === y || x.includes(y) || y.includes(x);
    const sharedCount = [...ta].filter((x) => [...ca].some((y) => same(x, y))).length;
    const lead = (set: Set<string>, other: Set<string>) => [...other].some((y) => same([...set][0], y));
    // A shared composer isn't enough ("Gehra Hua" by Arijit vs a cover by
    // another singer on the same composer): the lead artist must be on both,
    // or at least two names must agree.
    if (!(lead(ta, ca) || lead(ca, ta) || sharedCount >= 2)) return 0;
    sc += 25;
  }
  if (target.durationSec && c.durationSec) {
    const diff = Math.abs(target.durationSec - c.durationSec);
    if (diff > (target.tolerance ?? 12)) return 0; // music videos run long; catalogue audio doesn't
    sc += Math.max(0, 25 - diff * 2);
  }
  return sc;
}

export function best<T extends MatchCandidate>(target: MatchTarget, list: T[]): T | null {
  let top: T | null = null, topScore = 0;
  for (const c of list) {
    const s = score(target, c);
    if (s > topScore) { top = c; topScore = s; }
  }
  return top;
}

export const toSeconds = (d?: string) => {
  if (!d) return undefined;
  const p = d.split(':').map(Number);
  if (p.some(isNaN)) return undefined;
  return p.reduce((acc, x) => acc * 60 + x, 0);
};
