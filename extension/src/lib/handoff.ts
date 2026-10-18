// Phone ↔ Chrome handoff with no server and no account: a YouTube Music link
// that carries the position (t=). Tunes for Android opens it and continues
// there; pasting one from the phone into Tunes' search continues here.
import type { Track } from './types';
import { fetchWithTimeout } from './net';

const isYt = (id: string) => /^[\w-]{11}$/.test(id);

/** The link for this song at this moment, or null when it isn't a YouTube Music song. */
export function handoffUrl(t: Pick<Track, 'videoId' | 'podcast'>, positionSec: number): string | null {
  if (t.podcast || !isYt(t.videoId)) return null;
  const at = Math.floor(positionSec);
  return `https://music.youtube.com/watch?v=${t.videoId}${at > 5 ? `&t=${at}` : ''}`;
}

/** "754", "754s", "12m34s", "1h2m3s" → seconds (0 when absent or odd). */
export function parseT(t: string | null | undefined): number {
  const v = (t ?? '').trim().toLowerCase();
  if (!v) return 0;
  if (/^\d+$/.test(v)) { const n = Number(v); return n > 0 && n <= 86400 ? n : 0; }
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  if (!m) return 0;
  const n = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return n > 0 && n <= 86400 ? n : 0;
}

/** A YouTube / YouTube Music song link anywhere in pasted text. */
export function parseHandoff(text: string): { videoId: string; startAt: number } | null {
  const raw = /https?:\/\/\S+/i.exec(text)?.[0] ?? (/^(music\.|www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(text.trim()) ? `https://${text.trim()}` : null);
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'm.youtube.com') {
    const seg = u.pathname.split('/').filter(Boolean);
    id = seg[0] === 'watch' ? u.searchParams.get('v') : ['shorts', 'embed', 'v'].includes(seg[0]) ? seg[1] ?? null : null;
  }
  if (!id || !isYt(id)) return null;
  return { videoId: id, startAt: parseT(u.searchParams.get('t')) };
}

/** A song from just its id: title and channel from YouTube's public oEmbed, else a placeholder. */
export async function linkTrack(videoId: string): Promise<Track> {
  const base: Track = { videoId, title: 'Shared song', artists: 'YouTube Music', thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
  try {
    const r = await fetchWithTimeout(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, {}, 8000, 'YouTube');
    if (!r.ok) return base;
    const j = await r.json();
    return { ...base, title: String(j.title || base.title).slice(0, 200), artists: String(j.author_name || base.artists).replace(/ - Topic$/, '').slice(0, 120) };
  } catch { return base; }
}
