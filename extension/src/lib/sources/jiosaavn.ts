// JioSaavn source, reverse-engineered from Tunes's JioSaavnService.kt /
// JioSaavnSource.kt:
//  - catalogue API: https://www.jiosaavn.com/api.php?__call=search.getResults&api_version=4
//  - each row carries more_info.encrypted_media_url = Base64(DES-ECB-PKCS5(url), key "38346591")
//  - the decrypted CDN URL names the 96 kbps file (…_96.mp4); swap to _320
//    only when more_info["320kbps"] === "true" (Tunes's selectBestSaavnStream)
// Direct AAC/MP4 files on aac.saavncdn.com play in a plain <audio> element.
import CryptoJS from 'crypto-js';
import type { Track } from '../types';
import { best, toSeconds } from '../matcher';
import type { ResolvedStream } from './youtube';

const API = 'https://www.jiosaavn.com/api.php';
const DES_KEY = CryptoJS.enc.Utf8.parse('38346591');

export function decryptMediaUrl(enc: string): string {
  if (!enc) return '';
  const out = CryptoJS.DES.decrypt({ ciphertext: CryptoJS.enc.Base64.parse(enc) } as CryptoJS.lib.CipherParams, DES_KEY, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return out.toString(CryptoJS.enc.Utf8).trim().replace(/^http:\/\//, 'https://');
}

export function bestRendition(url: string, has320: boolean): { url: string; kbps: number } {
  const m = url.match(/_(\d{2,3})\.(mp4|mp3|m4a)/);
  if (!m) return { url, kbps: 96 };
  if (!has320) return { url, kbps: Number(m[1]) };
  return { url: url.replace(m[0], `_320.${m[2]}`), kbps: 320 };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface SaavnRow { title: string; artist: string; durationSec?: number; enc: string; has320: boolean; image: string; album: string }

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");

export async function searchSaavn(query: string): Promise<SaavnRow[]> {
  const q = new URLSearchParams({ __call: 'search.getResults', _format: 'json', _marker: '0', api_version: '4', ctx: 'web6dot0', q: query, p: '1', n: '10' });
  const res = await fetch(`${API}?${q}`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`JioSaavn HTTP ${res.status}`);
  const d: any = await res.json();
  return (d?.results ?? []).map((r: any) => ({
    title: unescape(r.title ?? ''),
    artist: (r.more_info?.artistMap?.primary_artists ?? []).map((a: any) => unescape(a.name)).join(', '),
    durationSec: Number(r.more_info?.duration) || undefined,
    enc: r.more_info?.encrypted_media_url ?? '',
    has320: String(r.more_info?.['320kbps']).toLowerCase() === 'true',
    image: String(r.image ?? '').replace(/150x150|50x50/, '500x500'),
    album: unescape(r.more_info?.album ?? ''),
  }));
}

/** Find the same recording on JioSaavn and return its best stream, or null. */
export async function resolveSaavn(t: Track, durationSec?: number, quality: 'high' | 'normal' | 'low' = 'high', tolerance = 12): Promise<ResolvedStream | null> {
  const firstArtist = t.artists.split(',')[0]?.trim() ?? '';
  const rows = await searchSaavn(`${t.title.replace(/\(.*?\)|\[.*?\]/g, '')} ${firstArtist}`.trim());
  const target = { title: t.title, artist: t.artists, durationSec: durationSec ?? toSeconds(t.duration), tolerance };
  if (!target.durationSec) return null; // never guess without a runtime
  let hit = best(target, rows);
  if (!hit) hit = best(target, await searchSaavn(t.title.replace(/\(.*?\)|\[.*?\]/g, '').trim()));
  if (!hit) return null;
  const url = decryptMediaUrl(hit.enc);
  if (!url) return null;
  const r = quality === 'high' ? bestRendition(url, hit.has320) : quality === 'normal' ? bestRendition(url.replace(/_(96|320)\./, '_160.'), false) : bestRendition(url, false);
  return { url: r.url, mimeType: 'audio/mp4', kbps: r.kbps, source: 'jiosaavn', durationSec: hit.durationSec };
}
