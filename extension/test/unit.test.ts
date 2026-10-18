// Unit tests that need no browser: `npm test` bundles this with esbuild and
// runs it under node:test. Chrome APIs are stubbed with an in-memory store.
import test from 'node:test';
import assert from 'node:assert/strict';

const mem: Record<string, unknown> = {};
(globalThis as any).chrome = {
  storage: {
    local: { get: async (k: any) => (k == null ? { ...mem } : Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x: string) => x in mem).map((x: string) => [x, mem[x]]))), set: async (o: any) => { Object.assign(mem, o); } },
    session: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener() {} },
  },
  cookies: { getAll: async () => [] },
};

const { score, titleParts, toSeconds, best } = await import('../src/lib/matcher');
const { mergeBackup, parseBackup } = await import('../src/lib/backup');
const { friendlyPlayError } = await import('../src/lib/errors');
const { fetchJson, withTimeout, TimeoutError } = await import('../src/lib/net');

test('matcher: whole-word version tags', () => {
  assert.equal(titleParts('Still Alive').versions.has('live'), false);
  assert.equal(titleParts('Discover Me').versions.has('cover'), false);
  assert.equal(titleParts('Song (Live)').versions.has('live'), true);
  assert.equal(titleParts('Song - Remix').versions.has('mix'), false);
  assert.equal(titleParts('Song (Sped Up)').versions.has('sped up'), true);
});
test('matcher: rejects other versions, accepts same recording', () => {
  const t = { title: 'Gehra Hua', artist: 'Arijit Singh', durationSec: 240 };
  assert.equal(score(t, { title: 'Gehra Hua (Afro Mix)', artist: 'Arijit Singh', durationSec: 240 }), 0);
  assert.equal(score(t, { title: 'Gehra Hua (Live)', artist: 'Arijit Singh', durationSec: 240 }), 0);
  assert.ok(score(t, { title: 'Gehra Hua (From "Dhurandhar")', artist: 'Arijit Singh, Shashwat', durationSec: 242 }) > 0);
  assert.equal(score(t, { title: 'Gehra Hua', artist: 'Arijit Singh', durationSec: 300 }), 0);
  assert.equal(best(t, [{ title: 'Other', artist: 'X', durationSec: 240 }, { title: 'Gehra Hua', artist: 'Arijit Singh', durationSec: 241 }])?.durationSec, 241);
});
test('toSeconds', () => {
  assert.equal(toSeconds('3:24'), 204);
  assert.equal(toSeconds('1:02:03'), 3723);
  assert.equal(toSeconds('x'), undefined);
});
test('backup: rejects foreign files', () => {
  assert.throws(() => parseBackup('nope'), /isn’t a Tunes export/);
  assert.throws(() => parseBackup('{"app":"Other","data":{}}'), /isn’t a Tunes export/);
  assert.deepEqual(parseBackup('{"app":"Tunes","data":{"liked":[]}}'), { liked: [] });
});
test('backup: merges without duplicates and keeps secrets', () => {
  const cur = { liked: [{ videoId: 'a' }], settings: { lastfmSecret: 'mine', theme: 'dark' } };
  const inc = { liked: [{ videoId: 'a' }, { videoId: 'b' }], settings: { lastfmSecret: 'theirs', theme: 'light', crossfade: 'bad' }, queue: [{ videoId: 'q' }], localPlaylists: [{ id: 'p1', tracks: [] }] };
  const { next, summary } = mergeBackup(cur, inc);
  assert.deepEqual((next.liked as any[]).map((x) => x.videoId), ['a', 'b']);
  assert.equal((next.settings as any).lastfmSecret, 'mine');
  assert.equal((next.settings as any).theme, 'light');
  assert.equal((next.settings as any).crossfade, 0); // wrong type ignored
  assert.equal('queue' in next, false);
  assert.equal(summary.liked, 1); assert.equal(summary.playlists, 1);
});
test('errors: plain language', () => {
  assert.match(friendlyPlayError(['JioSaavn: no match', 'YouTube: YouTube direct failed (ANDROID_VR: HTTP 403)'], true), /Couldn’t play this song/);
  assert.match(friendlyPlayError(['JioSaavn: JioSaavn took too long'], true), /slow/);
  assert.match(friendlyPlayError([], false), /offline/);
  assert.match(friendlyPlayError(['YouTube: ANDROID_VR: UNPLAYABLE'], true), /isn’t available/);
});
test('net: timeouts cover a hung request', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((_: any, init: any) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as any;
  const t0 = Date.now();
  await assert.rejects(fetchJson('https://x', {}, 100, 'JioSaavn'), (e: any) => e instanceof TimeoutError && /JioSaavn took too long/.test(e.message));
  assert.ok(Date.now() - t0 < 1000);
  globalThis.fetch = realFetch;
  await assert.rejects(withTimeout(new Promise(() => {}), 50, 'Lookup'), /Lookup took too long/);
  assert.equal(await withTimeout(Promise.resolve(5), 50, 'x'), 5);
});

const { getCollection, getQueue } = await import('../src/lib/innertube');
const row = (id: string) => ({ musicResponsiveListItemRenderer: {
  playlistItemData: { videoId: id },
  flexColumns: [
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: `Song ${id}`, navigationEndpoint: { watchEndpoint: { videoId: id } } }] } } },
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Artist', navigationEndpoint: { browseEndpoint: { browseId: 'UCx' } } }] } } },
  ],
  fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '3:00' }] } } }],
} });
const cont = (tok: string) => ({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: tok } } } });
const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j }) as any;

test('innertube: long playlists follow continuation pages', async () => {
  const calls: any[] = [];
  globalThis.fetch = (async (_u: string, init: any) => {
    const body = JSON.parse(init.body); calls.push(body);
    if (body.browseId) return ok({ contents: { twoColumnBrowseResultsRenderer: {
      tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicResponsiveHeaderRenderer: { title: { runs: [{ text: 'Big list' }] } } }] } } } }],
      secondaryContents: { sectionListRenderer: { contents: [{ musicPlaylistShelfRenderer: { contents: [row('aaaaaaaaaa1'), row('aaaaaaaaaa2'), cont('T1')] } }] } } } } });
    if (body.continuation === 'T1') return ok({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [row('aaaaaaaaaa3'), cont('T2')] } }] });
    if (body.continuation === 'T2') return ok({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [row('aaaaaaaaaa4')] } }] });
    return ok({});
  }) as any;
  const c = await getCollection({ kind: 'playlist', title: 'x', subtitle: '', thumbnail: '', browseId: 'VLPLtest' });
  assert.deepEqual(c.tracks.map((t) => t.videoId), ['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3', 'aaaaaaaaaa4']);
  assert.equal(calls.length, 3);
});

test('innertube: a signed-in 403 falls back to guest, other errors do not', async () => {
  (globalThis as any).chrome.cookies.getAll = async () => [{ name: 'SAPISID', value: 'x' }];
  let n = 0;
  globalThis.fetch = (async (u: string) => { n++; return /bc=anon/.test(u) ? ok({ contents: {} }) : ({ ok: false, status: 403, json: async () => ({}) } as any); }) as any;
  await getQueue({ videoId: 'aaaaaaaaaaa' });
  assert.equal(n, 2);
  n = 0;
  globalThis.fetch = (async () => { n++; return { ok: false, status: 500, json: async () => ({}) } as any; }) as any;
  await assert.rejects(getQueue({ videoId: 'aaaaaaaaaaa' }), /failed \(500\)/);
  assert.equal(n, 1);
  (globalThis as any).chrome.cookies.getAll = async () => [];
});

const { refineRadio, blend } = await import('../src/lib/suggest');
const { isBlocked, creditNames } = await import('../src/lib/blocklist');
const tr = (id: string, title: string, artists: string) => ({ videoId: id.padEnd(11, 'x'), title, artists, thumbnail: '' });
test('blocklist: songs and artists, whole names only', () => {
  const b = { songs: [{ videoId: 'aaaaaaaaaaa', title: '', artists: '', at: 0 }], artists: [{ name: 'Anirudh', at: 0 }] };
  assert.ok(isBlocked(tr('aaaaaaaaaaa', 'x', 'y'), b));
  assert.ok(isBlocked(tr('b', 'Song', 'Arijit Singh, Anirudh'), b));
  assert.ok(!isBlocked(tr('c', 'Song', 'Anirudh Ravichander Fans'), b), 'not a substring match');
  assert.ok(!isBlocked({ ...tr('aaaaaaaaaaa', 'x', 'y'), podcast: { url: '', type: '', feedUrl: '' } }, b), 'podcasts never blocked by song rules');
  assert.deepEqual(creditNames('A, B & C feat. D'), ['a', 'b', 'c', 'd']);
});
test('suggestions: no repeats, no duplicate uploads, no blocked, artists spread out', () => {
  const cands = [
    tr('r1', 'Heard', 'X'), tr('d1', 'Tum Hi Ho', 'Arijit Singh'), tr('d2', 'Tum Hi Ho (Lyric Video)', 'Arijit Singh'),
    tr('a1', 'One', 'Same'), tr('a2', 'Two', 'Same'), tr('a3', 'Three', 'Same'), tr('o1', 'Other', 'Else'),
    tr('bl', 'Blocked', 'Nope'), tr('ls', 'Less', 'Z'),
  ];
  const out = refineRadio(cands, { queued: new Set(), recent: [tr('r1', 'Heard', 'X')], less: new Set(['ls'.padEnd(11, 'x')]), blocked: { songs: [], artists: [{ name: 'Nope', at: 0 }] } });
  const ids = out.map((t) => t.videoId.replace(/x+$/, ''));
  assert.ok(!ids.includes('r1') && !ids.includes('d2') && !ids.includes('bl') && !ids.includes('ls'), ids.join());
  const leads = out.map((t) => t.artists);
  for (let i = 2; i < leads.length; i++) assert.ok(!(leads[i] === leads[i - 1] && leads[i] === leads[i - 2]), 'three in a row: ' + leads.join());
  assert.equal(blend([tr('a', 'a', 'a'), tr('b', 'b', 'b'), tr('c', 'c', 'c')], [tr('z', 'z', 'z')]).length, 4);
});

const { batches, parseAnswer, lyricExtra } = await import('../src/lib/lyricsTranslate');
test('lyrics translation: batching and splitting back into lines', async () => {
  const lines = ['Hello', '', 'How are you', '♪', 'Goodbye'];
  const b = batches(lines);
  assert.equal(b.length, 1); assert.deepEqual(b[0].idx, [0, 2, 4]);
  assert.equal(b[0].payload.split(/\uE000\d{4}\uE001/).length, 3);
  assert.equal(batches(Array.from({ length: 40 }, () => 'x'.repeat(200))).length, 3, 'about 3,500 characters per request');
  // Google's answer: segments, then the detected language at [2]; romanization in segment[3].
  const ans = [[['నమస్కారం\n\uE0000001\uE001\n', 'Hello'], ['మీరు ఎలా ఉన్నారు\n\uE0000002\uE001\n', 'How are you'], ['వీడ్కోలు', 'Goodbye']], null, 'en'];
  assert.deepEqual(parseAnswer(ans, 0, 3), { parts: ['నమస్కారం', 'మీరు ఎలా ఉన్నారు', 'వీడ్కోలు'], source: 'en' });
  assert.equal(parseAnswer(ans, 0, 4), null, 'a lost marker means no answer, never misaligned lines');
  const calls: string[] = [];
  globalThis.fetch = (async (_u: string, init: any) => { calls.push(String(init.body)); return { ok: true, status: 200, json: async () => ans } as any; }) as any;
  const r = await lyricExtra('song1', lines, 'te', 'translate');
  assert.deepEqual(r.lines, ['నమస్కారం', null, 'మీరు ఎలా ఉన్నారు', null, 'వీడ్కోలు']);
  assert.equal(r.source, 'en'); assert.ok(!r.same);
  await lyricExtra('song1', lines, 'te', 'translate');
  assert.equal(calls.length, 1, 'cached per song');
  const same = await lyricExtra('song2', lines, 'en', 'translate');
  assert.ok(same.same && same.lines.every((x) => x === null), 'already in your language');
  const rm = await lyricExtra('song3', ['Hello'], 'en', 'romanize');
  assert.ok(rm.same, 'Latin lyrics need no romanization');
});
