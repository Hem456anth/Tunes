// YouTube stream resolution, reverse-engineered from Tunes's StreamResolver /
// InnerTubeXResolver / PlayerClient.
//
// Tunes asks the /player endpoint *as a native app client* (its catalog:
// IOS, ANDROID, ANDROID_MUSIC, ANDROID_VR, WEB_REMIX, TVHTML5...). Native
// clients get plain stream URLs with no signature cipher, and ANDROID_VR does
// not need a BotGuard PoToken. googlevideo then checks that the media request
// is "dressed" as the same client (User-Agent), or throttles / 403s.
//
// In an extension, fetch() cannot set User-Agent, so the background installs
// declarativeNetRequest rules (see background/rules.ts) that rewrite the
// User-Agent of /player calls and of googlevideo media requests to match the
// client that minted the URL.

export interface NativeClient {
  id: string;
  clientName: string;
  clientNameId: string; // X-YouTube-Client-Name
  clientVersion: string;
  userAgent: string;
  extra: Record<string, unknown>;
}

// Versions copied from Tunes's PlayerClient.kt (July 2026 catalog).
export const CLIENTS: NativeClient[] = [
  {
    id: 'ANDROID_VR',
    clientName: 'ANDROID_VR',
    clientNameId: '28',
    clientVersion: '1.65.10',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    extra: { deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L' },
  },
  {
    id: 'ANDROID_VR_LEGACY',
    clientName: 'ANDROID_VR',
    clientNameId: '28',
    clientVersion: '1.43.32',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.43.32 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/107.0.5284.2)',
    extra: { deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12' },
  },
];

export interface ResolvedStream {
  url: string;
  mimeType: string;
  kbps: number;
  source: 'youtube' | 'jiosaavn' | 'podcast';
  client?: string;
  userAgent?: string;
  durationSec?: number;
  loudnessDb?: number;
}

export type SetPlayerUa = (ua: string) => Promise<void>;

/* eslint-disable @typescript-eslint/no-explicit-any */
// The /player User-Agent rule is shared, so two lookups (the playing song and
// a prefetch) must never interleave: run them one at a time.
let lane: Promise<unknown> = Promise.resolve();
export function resolveYouTube(videoId: string, setUa: SetPlayerUa, maxKbps = Infinity): Promise<ResolvedStream> {
  const run = lane.then(() => resolveYouTubeNow(videoId, setUa, maxKbps));
  lane = run.catch(() => {});
  return run;
}

async function resolveYouTubeNow(videoId: string, setUa: SetPlayerUa, maxKbps: number): Promise<ResolvedStream> {
  const errors: string[] = [];
  for (const c of CLIENTS) {
    try {
      await setUa(c.userAgent); // DNR rewrites the UA of /player (the media UA is set only for the song that plays)
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000); // covers the body too
      try {
        const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
          method: 'POST',
          signal: ctl.signal,
          credentials: 'omit',
          headers: {
            'Content-Type': 'application/json',
            'X-YouTube-Client-Name': c.clientNameId,
            'X-YouTube-Client-Version': c.clientVersion,
          },
          body: JSON.stringify({
            context: { client: { clientName: c.clientName, clientVersion: c.clientVersion, hl: 'en', gl: 'IN', ...c.extra } },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        });
        // A 403 is often specific to one client version: try the next client.
        if (!res.ok) { errors.push(`${c.id}: HTTP ${res.status}`); continue; }
        const d: any = await res.json();
        const status = d?.playabilityStatus?.status;
        if (status !== 'OK') { errors.push(`${c.id}: ${status} ${d?.playabilityStatus?.reason ?? ''}`); continue; }
        const audio: any[] = (d?.streamingData?.adaptiveFormats ?? []).filter((f: any) => f.mimeType?.startsWith('audio/') && f.url);
        if (!audio.length) { errors.push(`${c.id}: no plain audio URLs`); continue; }
        // Highest bitrate under the ceiling; Chrome plays both Opus/WebM (251) and AAC/MP4 (140).
        audio.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
        const pick = audio.find((f) => (f.bitrate ?? 0) / 1000 <= maxKbps) ?? audio[audio.length - 1];
        return {
          url: pick.url,
          mimeType: pick.mimeType,
          kbps: Math.round((pick.averageBitrate ?? pick.bitrate ?? 0) / 1000),
          source: 'youtube',
          client: c.id,
          userAgent: c.userAgent,
          durationSec: Number(d?.videoDetails?.lengthSeconds) || undefined,
          loudnessDb: pick.loudnessDb,
        };
      } finally { clearTimeout(timer); }
    } catch (e: any) {
      errors.push(`${c.id}: ${e?.name === 'AbortError' ? 'timed out' : e?.message ?? e}`);
    }
  }
  throw new Error(`YouTube direct failed (${errors.join('; ')})`);
}
