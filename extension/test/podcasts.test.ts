import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
const mem: Record<string, unknown> = {};
(globalThis as any).chrome ??= { storage: { local: { get: async (k: any) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x: string) => x in mem).map((x: string) => [x, mem[x]])), set: async (o: any) => { Object.assign(mem, o); } } } };
const { parseFeed, parseDuration, parseDate, plain, discoverFeeds } = await import('../src/lib/podcasts/feed');
const { fromItunes, fromFyyd, mergeCards, feedKey } = await import('../src/lib/podcasts/directory');
const { toOpml, fromOpml, episodeTrack, subscribe, getSubs, unsubscribe, isSubscribed } = await import('../src/lib/podcasts/store');
const P = new DOMParser() as any;

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Telugu Talks</title><itunes:author>Hem</itunes:author><description><![CDATA[<p>Stories &amp; more</p>]]></description>
  <itunes:image href="https://cdn.example.com/show.jpg"/><language>te</language><itunes:category text="Arts"/>
  <atom:link rel="next" href="https://example.com/feed?page=2"/>
  <item><title>Ep 2</title><guid>g2</guid><pubDate>Mon, 05 Oct 2026 10:00:00 IST</pubDate><itunes:duration>1:02:03</itunes:duration>
    <enclosure url="https://cdn.example.com/2.mp3" length="1000" type="audio/mpeg"/><content:encoded><![CDATA[<b>Bold</b> notes<script>alert(1)</script>]]></content:encoded>
    <podcast:transcript url="https://cdn.example.com/2.vtt" type="text/vtt"/><podcast:chapters url="https://cdn.example.com/2.json" type="application/json+chapters"/></item>
  <item><title>Ep 1</title><guid>g1</guid><pubDate>2026-09-01T08:00:00Z</pubDate><itunes:duration>754</itunes:duration>
    <enclosure url="https://cdn.example.com/1.m4a" type="audio/x-m4a"/><itunes:image href="https://cdn.example.com/1.jpg"/></item>
  <item><title>Blog post</title><guid>b</guid><link>https://example.com/post</link></item>
  <item><title>JS link</title><guid>x</guid><enclosure url="javascript:alert(1)" type="audio/mpeg"/></item>
</channel></rss>`;

test('feed: show and episodes', () => {
  const s = parseFeed(RSS, 'https://example.com/feed', P);
  assert.equal(s.title, 'Telugu Talks'); assert.equal(s.author, 'Hem'); assert.equal(s.image, 'https://cdn.example.com/show.jpg');
  assert.equal(s.description, 'Stories & more'); assert.deepEqual(s.categories, ['Arts']); assert.equal(s.nextPage, 'https://example.com/feed?page=2');
  assert.equal(s.episodes.length, 2, 'blog posts and unsafe links are dropped');
  const [e2, e1] = s.episodes;
  assert.equal(e2.title, 'Ep 2'); assert.equal(e2.duration, 3723); assert.equal(e2.url, 'https://cdn.example.com/2.mp3');
  assert.equal(e2.published, Date.parse('2026-10-05T04:30:00Z'));
  assert.ok(!/script|alert|</.test(e2.description), 'no markup survives: ' + e2.description);
  assert.equal(e2.transcript?.url, 'https://cdn.example.com/2.vtt'); assert.equal(e2.chapters, 'https://cdn.example.com/2.json');
  assert.equal(e1.duration, 754); assert.equal(e1.image, 'https://cdn.example.com/1.jpg');
  assert.notEqual(e1.id, e2.id);
});
test('feed: duplicate guids fall back to enclosure ids (Winds rule)', () => {
  const xml = RSS.replace('<guid>g1</guid>', '<guid>g2</guid>');
  const s = parseFeed(xml, 'https://example.com/feed', P);
  assert.equal(new Set(s.episodes.map((e) => e.id)).size, 2);
});
test('feed: errors are plain', () => {
  assert.throws(() => parseFeed('<html><body>hi</body></html>', 'https://x', P), /isn’t a podcast feed/);
});
test('feed: atom', () => {
  const s = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><entry><id>1</id><title>E</title><updated>2026-01-01T00:00:00Z</updated><link rel="enclosure" href="https://x/1.mp3" type="audio/mpeg"/></entry></feed>`, 'https://x/feed', P);
  assert.equal(s.episodes[0].url, 'https://x/1.mp3');
});
test('duration and date edge cases', () => {
  assert.equal(parseDuration('62:03'), 3723); assert.equal(parseDuration('3723.6'), 3724); assert.equal(parseDuration('abc'), 0); assert.equal(parseDuration(''), 0);
  assert.equal(parseDate('Tue, 6 Oct 2026 01:00:00 GMT'), Date.parse('2026-10-06T01:00:00Z')); assert.equal(parseDate('nonsense'), 0);
  assert.equal(plain('a&nbsp;b &#8217;', 50), 'a b ’');
});
test('discover a feed from a website', () => {
  const html = '<html><head><link rel="alternate" type="application/rss+xml" title="Comments" href="/comments/feed"><link rel="alternate" type="application/rss+xml" title="Podcast" href="/podcast.xml"></head></html>';
  assert.deepEqual(discoverFeeds(html, 'https://site.example/', P), ['https://site.example/podcast.xml']);
});
test('directory: Apple and fyyd rows, merged by feed', () => {
  const a = fromItunes({ collectionId: 9, collectionName: 'S', artistName: 'A', feedUrl: 'https://f.example/rss', artworkUrl100: 'https://img/x/100x100bb.jpg' })!;
  assert.equal(a.image, 'https://img/x/600x600bb.jpg'); assert.equal(a.appleId, '9');
  const f = fromFyyd({ title: 'S', xmlURL: 'http://www.f.example/rss/', status: 200 })!;
  assert.equal(mergeCards([a], [f]).length, 1);
  assert.equal(fromItunes({ collectionName: 'no feed' }), null);
  assert.equal(feedKey('HTTPS://www.X.com/a/'), 'x.com/a');
});
test('OPML round trip and subscriptions', async () => {
  await subscribe({ feedUrl: 'https://f.example/rss', title: 'A & B', author: '', image: '' });
  await subscribe({ feedUrl: 'http://f.example/rss/', title: 'dupe', author: '', image: '' });
  assert.equal((await getSubs()).length, 1);
  assert.ok(await isSubscribed('https://www.f.example/rss'));
  const back = fromOpml(toOpml(await getSubs()), P);
  assert.deepEqual(back, [{ feedUrl: 'https://f.example/rss', title: 'A & B' }]);
  await unsubscribe('https://f.example/rss'); assert.equal((await getSubs()).length, 0);
  assert.throws(() => fromOpml('<<<', P), /OPML/);
});
test('episode → queue item', () => {
  const s = parseFeed(RSS, 'https://example.com/feed', P);
  const t = episodeTrack(s, s.episodes[0]);
  assert.match(t.videoId, /^pod:example\.com\/feed#/); assert.equal(t.duration, '1:02:03'); assert.equal(t.artists, 'Telugu Talks'); assert.equal(t.podcast?.url, 'https://cdn.example.com/2.mp3');
});
