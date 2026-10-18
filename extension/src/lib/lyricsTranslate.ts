// Lyric translation and romanization, ported from BitChord's
// LyricsTranslation.kt (GPL-3.0, github.com/kushagrasinghx/BitChord): lines are
// batched into a few requests to Google Translate's web endpoint, separated by
// private-use markers so the answer splits back into the same lines.
import { fetchWithTimeout } from './net';
import { readCache, refresh } from './cache';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MAX_BATCH = 3500;
const MARKER = /\uE000[^\uE001]*\uE001/g;
const marker = (i: number) => `\uE000${String(i).padStart(4, '0')}\uE001`;
export const TRANSLATE_ORIGIN = 'https://translate.googleapis.com/*';

export type LyricMode = 'off' | 'translate' | 'romanize';
export interface LyricExtra { lines: (string | null)[]; source: string; same?: boolean }

/** Batches of non-empty lines; returns [batch payload, line indexes]. */
export function batches(lines: string[], max = MAX_BATCH): { payload: string; idx: number[] }[] {
  const out: { payload: string; idx: number[] }[] = [];
  let cur: number[] = [], len = 0;
  const flush = () => { if (cur.length) out.push({ payload: cur.map((i, k) => (k ? `\n${marker(k)}\n` : '') + lines[i]).join(''), idx: cur }); cur = []; len = 0; };
  lines.forEach((l, i) => {
    if (!l.trim() || l.trim() === '♪') return;
    const add = l.length + (cur.length ? 8 : 0);
    if (cur.length && len + add > max) flush();
    cur.push(i); len += add;
  });
  flush();
  return out;
}

/** Split Google's answer back into lines. [0][k][0] = translation, [0][k][3] = romanization. */
export function parseAnswer(j: any, field: 0 | 3, n: number): { parts: string[]; source: string } | null {
  if (!Array.isArray(j) || !Array.isArray(j[0])) return null;
  const body = j[0].map((seg: any) => (Array.isArray(seg) && typeof seg[field] === 'string' ? seg[field] : '')).join('');
  const parts = body.split(MARKER).map((s: string) => s.trim());
  if (parts.length !== n || parts.some((p: string) => !p)) return null;
  return { parts, source: typeof j[2] === 'string' ? j[2] : '' };
}

const base = (tag: string) => ({ iw: 'he', in: 'id', ji: 'yi' } as Record<string, string>)[tag.toLowerCase().split(/[-_]/)[0]] ?? tag.toLowerCase().split(/[-_]/)[0];
export const hasNonLatin = (lines: string[]) => lines.some((l) => /[^\p{Script=Latin}\P{L}]/u.test(l));

async function ask(payload: string, tl: string, dt: 't' | 'rm'): Promise<any> {
  const body = new URLSearchParams({ client: 'dict-chrome-ex', sl: 'auto', tl, dt, q: payload });
  let res: Response;
  try { res = await fetchWithTimeout(ENDPOINT, { method: 'POST', body, headers: { Accept: 'application/json' } }, 12000, 'Translation'); }
  catch (e) { throw new Error((e as Error).name === 'TimeoutError' ? 'Translation took too long. Try again.' : 'Translation is unavailable right now.'); }
  if (!res.ok) throw new Error(`Translation answered ${res.status}`);
  return res.json();
}

async function run(lines: string[], target: string, mode: 'translate' | 'romanize'): Promise<LyricExtra> {
  if (mode === 'romanize' && !hasNonLatin(lines)) return { lines: lines.map(() => null), source: 'latn', same: true };
  const bs = batches(lines);
  if (!bs.length) throw new Error('No lyrics to translate');
  const out: (string | null)[] = lines.map(() => null);
  const weights = new Map<string, number>();
  // Two requests at a time, like BitChord: fast for long songs, light on the network.
  for (let i = 0; i < bs.length; i += 2) {
    const answers = await Promise.all(bs.slice(i, i + 2).map(async (b) => {
      const a = parseAnswer(await ask(b.payload, target, mode === 'translate' ? 't' : 'rm'), mode === 'translate' ? 0 : 3, b.idx.length);
      if (!a) throw new Error('Translation unavailable for these lyrics');
      return { b, a };
    }));
    for (const { b, a } of answers) {
      b.idx.forEach((li, k) => { out[li] = a.parts[k]; });
      weights.set(base(a.source), (weights.get(base(a.source)) ?? 0) + b.payload.length);
    }
  }
  const source = [...weights.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
  const same = mode === 'translate' && source === base(target);
  // Lines that came back unchanged add nothing under the original.
  const cleaned = out.map((t, i) => (t && t.trim().toLowerCase() !== lines[i].trim().toLowerCase() ? t : null));
  if (mode === 'romanize' && cleaned.every((x) => x === null)) throw new Error('Romanization isn’t available for this language');
  return { lines: same ? lines.map(() => null) : cleaned, source, same };
}

/** Cached per song, target language and mode. */
export async function lyricExtra(songId: string, lines: string[], target: string, mode: 'translate' | 'romanize'): Promise<LyricExtra> {
  const key = `ly${mode === 'translate' ? 'tr' : 'rm'}:${songId}:${mode === 'translate' ? target : ''}:${lines.length}`;
  const hit = await readCache<LyricExtra>(key);
  if (hit && hit.data.lines.length === lines.length) return hit.data;
  return refresh(key, () => run(lines, target, mode));
}

export async function hasTranslateAccess(): Promise<boolean> {
  if (!chrome.permissions?.contains) return true;
  return chrome.permissions.contains({ origins: [TRANSLATE_ORIGIN] });
}
export async function requestTranslateAccess(): Promise<boolean> {
  if (!chrome.permissions?.request) return true;
  try { return await chrome.permissions.request({ origins: [TRANSLATE_ORIGIN] }); } catch { return false; }
}
