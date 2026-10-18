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
