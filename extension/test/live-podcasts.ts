// Manual smoke test against the real services (not part of npm test):
//   npx esbuild test/live-podcasts.ts --bundle --platform=node --format=esm --outfile=.test-out/live.mjs && node .test-out/live.mjs
import { DOMParser } from 'linkedom';
(globalThis as any).DOMParser = DOMParser;
const { searchPodcasts, topPodcasts } = await import('../src/lib/podcasts/directory');
const { loadShow } = await import('../src/lib/podcasts/load');
const s = await searchPodcasts('telugu');
console.log('search telugu:', s.length, s.slice(0, 3).map((c) => `${c.title} [${c.source}]`).join(' | '));
const top = await topPodcasts('in', 10);
console.log('top IN:', top.length, top.slice(0, 3).map((c) => c.title).join(' | '));
for (const c of [s[0], top[0], top[1]]) {
  const t0 = Date.now();
  try { const show = await loadShow(c.feedUrl); console.log('feed', show.title, show.episodes.length, 'eps', show.episodes[0]?.title, show.episodes[0]?.duration, 's', Date.now() - t0, 'ms'); }
  catch (e) { console.log('feed FAIL', c.feedUrl, (e as Error).message); }
}
try { const viaSite = await loadShow('https://www.thisamericanlife.org/'); console.log('site discovery:', viaSite.title, viaSite.episodes.length); } catch (e) { console.log('site discovery FAIL', (e as Error).message); }
