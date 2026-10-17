import { clearAllCache } from './cache';
import { DEFAULT_SETTINGS, type Settings } from './types';

export async function getSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get('settings');
  const raw = (r.settings as Partial<Settings>) ?? {};
  const s: Settings = { ...DEFAULT_SETTINGS, ...raw };
  // migrate the v0.2 single "source order" choice
  if (raw.sourceOrder && !raw.sources) {
    if (raw.sourceOrder === 'youtube-first') s.sources = ['youtube', 'jiosaavn'];
    if (raw.sourceOrder === 'youtube-only') s.jiosaavn = false;
  }
  return s;
}
// Writes are read-modify-write: chain them so two quick changes never drop one.
let chain: Promise<unknown> = Promise.resolve();
export function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const run = chain.then(async () => {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ settings: next });
    // Account changes change what YouTube Music returns: drop cached feeds.
    if ('useAccount' in patch || 'authUser' in patch || 'defaultAccount' in patch) await clearAllCache();
    return next;
  });
  chain = run.catch(() => {});
  return run;
}

/** Direct sources to try, in order, for the background engine. */
export function directOrder(s: Settings): ('saavn' | 'youtube')[] {
  if (s.sourceOrder === 'tab-only' && !s.sources) return [];
  return s.sources.filter((x) => x === 'youtube' || s.jiosaavn).map((x) => (x === 'jiosaavn' ? 'saavn' : 'youtube'));
}
export const QUALITY_KBPS = { high: Infinity, normal: 140, low: 70 } as const;
