// Podcasts: discovery (Apple Podcasts search and chart, fyyd), subscriptions,
// episode lists and playback through the normal player and queue.
import { memo, useEffect, useMemo, useState } from 'react';
import { readCache, refresh } from '../../lib/cache';
import { feedKey, searchPodcasts, topPodcasts, type PodcastCard } from '../../lib/podcasts/directory';
import type { Episode, Show } from '../../lib/podcasts/feed';
import { hasFeedAccess, loadShow, requestFeedAccess } from '../../lib/podcasts/load';
import { episodeTrack, fromOpml, getProgress, getSubs, PROGRESS, saveProgress, subscribe, SUBS, toOpml, unsubscribe, updateSub, type Progress, type Subscription } from '../../lib/podcasts/store';
import { send, useCached } from '../hooks';
import { Icon } from './Icon';
import { playQueue } from './Items';
import { Empty, Err, Scroller, SectionHead, SkelCards, SkelRows } from './Views';

const HOUR = 60 * 60 * 1000;
const SHOW_TTL = 6 * HOUR;
export const showKey = (feedUrl: string) => `pod:${feedKey(feedUrl)}`;
/** Cached show (stale-while-revalidate, refreshed at most every 6 hours). */
export const fetchShow = (feedUrl: string) => refresh(showKey(feedUrl), () => loadShow(feedUrl));

function useStore<T>(read: () => Promise<T>, key: string, init: T): T {
  const [v, setV] = useState<T>(init);
  useEffect(() => {
    read().then(setV);
    const fn = (c: Record<string, unknown>) => { if (key in c) read().then(setV); };
    chrome.storage.onChanged.addListener(fn);
    return () => chrome.storage.onChanged.removeListener(fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}
export const useSubs = () => useStore<Subscription[] | null>(getSubs, SUBS, null);
const useProgress = () => useStore<Record<string, Progress>>(getProgress, PROGRESS, {});

function useAccess(): [boolean | null, () => Promise<void>] {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { hasFeedAccess().then(setOk); }, []);
  return [ok, async () => setOk(await requestFeedAccess())];
}

/** Shown once, before anything is fetched: podcasts live on many websites. */
function AccessGate({ onAllow }: { onAllow: () => void }) {
  return (
    <Empty icon="mic" title="Turn on podcasts" sub="Podcasts are hosted on many different websites. Chrome will ask you to let Tunes read podcast feeds; Tunes only downloads the shows you open.">
      <button className="pill white" onClick={onAllow} data-action="allow-podcasts">Allow podcast feeds</button>
    </Empty>
  );
}

export const fmtDur = (s: number) => { if (!s) return ''; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} hr ${m} min` : `${m} min`; };
export const fmtDate = (ms: number) => {
  if (!ms) return '';
  const d = new Date(ms), now = Date.now(), days = Math.floor((now - ms) / 86400000);
  if (days < 1) return 'Today'; if (days < 2) return 'Yesterday'; if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
};

export const PodcastTile = memo(function PodcastTile({ c, onShow, badge }: { c: PodcastCard | Subscription; onShow: (c: PodcastCard) => void; badge?: number }) {
  const card: PodcastCard = 'source' in c ? c : { ...c, source: 'url' };
  return (
    <div className="card pod-card" title={c.title}>
      <button type="button" className="card-hit" onClick={() => onShow(card)} aria-label={c.title}>
        <div className="card-art">{c.image ? <img src={c.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="coll-ph"><Icon name="mic" size={40} /></span>}{badge ? <span className="pod-new" aria-label={`${badge} new`}>{badge > 9 ? '9+' : badge}</span> : null}</div>
        <div className="card-title">{c.title}</div>
        <div className="card-sub">{('genre' in c && c.genre) || c.author}</div>
      </button>
    </div>
  );
});

// ---------- Podcasts home (Library → Podcasts, Explore → See all) ----------
export function PodcastsPage({ onBack, onShow }: { onBack: () => void; onShow: (c: PodcastCard) => void }) {
  const [access, allow] = useAccess();
  const subs = useSubs();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2600); };

  const submit = async () => {
    const v = q.trim();
    if (!v) return setQuery('');
    // A feed or website address opens that show directly.
    if (/^(https?:\/\/|www\.)|\.(xml|rss)(\?|$)|\/(feed|rss)\b/i.test(v) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) {
      try {
        const show = await loadShow(v);
        onShow({ feedUrl: show.feedUrl, title: show.title, author: show.author, image: show.image, source: 'url' });
      } catch (e) { flash((e as Error).message); }
      return;
    }
    setQuery(v);
  };

  const exportOpml = async () => {
    const blob = new Blob([toOpml(await getSubs())], { type: 'text/x-opml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'tunes-podcasts.opml'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const importOpml = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.opml,.xml,text/xml,text/x-opml';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const list = fromOpml(await f.text());
        let added = 0, failed = 0;
        // Four at a time, so a big OPML file doesn't flood the network.
        for (let i = 0; i < list.length; i += 4) {
          await Promise.all(list.slice(i, i + 4).map(async (o) => {
            try {
              const s = await fetchShow(o.feedUrl);
              await subscribe({ feedUrl: s.feedUrl, title: s.title || o.title, author: s.author, image: s.image }, s.episodes[0]?.published ?? 0);
              added++;
            } catch { failed++; }
          }));
        }
        flash(`Followed ${added} show${added === 1 ? '' : 's'}${failed ? `, ${failed} couldn’t be reached` : ''}`);
      } catch (e) { flash((e as Error).message); }
    };
    input.click();
  };

  return (
    <div className="podcasts">
      <button className="back-btn inline" onClick={onBack}><Icon name="back" size={20} /> Back</button>
      <h1 className="big-title">Podcasts</h1>
      {access === null ? <SkelRows n={3} /> : !access ? <AccessGate onAllow={allow} /> : (
        <>
          <form className="search pod-search" role="search" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setQuery(''); }} placeholder="Search podcasts, or paste a feed or website" aria-label="Search podcasts" spellCheck={false} />
            {q && <button type="button" className="icon-btn" aria-label="Clear" onClick={() => { setQ(''); setQuery(''); }}><Icon name="close" size={16} /></button>}
          </form>
          {query ? <PodcastResults q={query} onShow={onShow} /> : (
            <>
              <YourShows subs={subs} onShow={onShow} />
              <NewEpisodes subs={subs} />
              <TopShows onShow={onShow} />
            </>
          )}
          <div className="pod-tools">
            <button className="pill ghost sm" onClick={importOpml}><Icon name="download" size={16} /> Import OPML</button>
            <button className="pill ghost sm" onClick={exportOpml} disabled={!subs?.length}><Icon name="upload" size={16} /> Export OPML</button>
          </div>
          <p className="pod-credit">Search by Apple Podcasts and fyyd. Episodes stream from each podcast’s own website.</p>
        </>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

export function PodcastResults({ q, onShow }: { q: string; onShow: (c: PodcastCard) => void }) {
  const r = useCached(`podsearch:${q.toLowerCase()}`, () => searchPodcasts(q), 24 * HOUR);
  if (r.loading) return <SkelCards />;
  if (r.error) return <Err msg={r.error} retry={r.retry} />;
  if (!r.data?.length) return <div className="empty-state"><Icon name="mic" size={28} /><p>No podcasts found for “{q}”.</p></div>;
  return <div className="card-grid lib-grid">{r.data.map((c) => <PodcastTile key={c.feedUrl} c={c} onShow={onShow} />)}</div>;
}

function YourShows({ subs, onShow }: { subs: Subscription[] | null; onShow: (c: PodcastCard) => void }) {
  if (!subs?.length) return null;
  return (
    <section className="section">
      <SectionHead title="Your shows" />
      <div className="card-grid lib-grid">{subs.map((s) => <PodcastTile key={s.feedUrl} c={s} onShow={onShow} badge={s.latest && s.latest > s.seenUpTo ? 1 : 0} />)}</div>
    </section>
  );
}

/** Latest episodes across your shows. Feeds refresh when this opens, at most every 6 hours. */
function NewEpisodes({ subs }: { subs: Subscription[] | null }) {
  const progress = useProgress();
  const [rows, setRows] = useState<{ show: Show; e: Episode }[] | null>(null);
  const keys = subs?.map((s) => s.feedUrl).join('|') ?? '';
  useEffect(() => {
    if (!subs?.length) { setRows([]); return; }
    let alive = true;
    (async () => {
      const shows: Show[] = [];
      for (let i = 0; i < subs.length; i += 4) {
        await Promise.all(subs.slice(i, i + 4).map(async (s) => {
          const hit = await readCache<Show>(showKey(s.feedUrl));
          let show = hit?.data;
          if (!hit || Date.now() - hit.at > SHOW_TTL) show = await fetchShow(s.feedUrl).catch(() => hit?.data);
          if (!show) return;
          shows.push(show);
          const latest = show.episodes[0]?.published ?? 0;
          if (latest && latest !== s.latest) await updateSub(s.feedUrl, { latest, ...(show.movedTo ? { feedUrl: show.movedTo } : {}) });
        }));
        if (!alive) return;
      }
      const all = shows.flatMap((show) => show.episodes.slice(0, 5).map((e) => ({ show, e })));
      all.sort((a, b) => b.e.published - a.e.published);
      if (alive) setRows(all.slice(0, 12));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  if (!subs?.length) return null;
  return (
    <section className="section">
      <SectionHead title="Latest episodes" />
      {!rows ? <SkelRows n={3} /> : rows.length ? (
        <div className="ep-list">{rows.map(({ show, e }) => <EpisodeRow key={show.feedUrl + e.id} show={show} e={e} list={[e]} p={progress[episodeTrack(show, e).videoId]} showName />)}</div>
      ) : <p className="row-sub">No episodes yet.</p>}
    </section>
  );
}

function TopShows({ onShow }: { onShow: (c: PodcastCard) => void }) {
  const top = useCached('podtop:in', () => topPodcasts('in', 40), 24 * HOUR);
  return top.loading ? <SkelCards /> : top.error ? <Err msg={top.error} retry={top.retry} /> : top.data?.length ? (
    <section className="section">
      <SectionHead title="Top podcasts in India" sub="Apple Podcasts chart" />
      <div className="card-grid lib-grid">{top.data.map((c) => <PodcastTile key={c.feedUrl} c={c} onShow={onShow} />)}</div>
    </section>
  ) : null;
}

/** Explore shelf: a few top shows and a way into Podcasts. Fetches nothing until feeds are allowed. */
export function PodcastShelf({ onShow, onAll }: { onShow: (c: PodcastCard) => void; onAll: () => void }) {
  const [access, allow] = useAccess();
  const top = useCached(access ? 'podtop:in' : null, () => topPodcasts('in', 40), 24 * HOUR);
  if (access === null) return null;
  if (!access) return (
    <section className="section">
      <SectionHead title="Podcasts" onMore={onAll} />
      <div className="err-box pod-invite"><span>Listen to podcasts in Tunes: top shows in India, your subscriptions, and new episodes.</span><button className="pill sm" onClick={allow}>Turn on</button></div>
    </section>
  );
  if (top.error || (!top.loading && !top.data?.length)) return null;
  return (
    <Scroller title="Top podcasts in India" onMore={onAll}>
      {top.loading ? <SkelCards /> : top.data!.slice(0, 16).map((c) => <PodcastTile key={c.feedUrl} c={c} onShow={onShow} />)}
    </Scroller>
  );
}

// ---------- One show ----------
export function ShowView({ card, onBack }: { card: PodcastCard; onBack: () => void }) {
  const [access, allow] = useAccess();
  const show = useCached(access ? showKey(card.feedUrl) : null, () => loadShow(card.feedUrl), SHOW_TTL);
  const subs = useSubs();
  const progress = useProgress();
  const [filter, setFilter] = useState<'all' | 'unplayed'>('all');
  const [n, setN] = useState(50);
  const s = show.data;
  const followed = !!subs?.some((x) => feedKey(x.feedUrl) === feedKey(card.feedUrl));
  // Opening a followed show clears its "new" dot.
  useEffect(() => {
    const latest = s?.episodes[0]?.published ?? 0;
    if (followed && latest) void updateSub(card.feedUrl, { seenUpTo: latest, latest });
  }, [followed, s, card.feedUrl]);
  const eps = useMemo(() => (s?.episodes ?? []).filter((e) => filter === 'all' || !progress[episodeTrack(s!, e).videoId]?.played), [s, filter, progress]);
  if (access === false) return <div><button className="back-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={22} /></button><AccessGate onAllow={allow} /></div>;
  const head = s ?? { title: card.title, author: card.author, image: card.image, description: '', categories: [] as string[] };
  const toggleFollow = () => (followed ? unsubscribe(card.feedUrl) : subscribe({ feedUrl: s?.feedUrl ?? card.feedUrl, title: head.title, author: head.author, image: head.image }, s?.episodes[0]?.published ?? 0));
  const firstUnplayed = s?.episodes.find((e) => !progress[episodeTrack(s, e).videoId]?.played);
  return (
    <div className="show-view">
      <button className="back-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={22} /></button>
      <div className="coll-head">
        {head.image ? <img src={head.image} alt="" referrerPolicy="no-referrer" /> : <span className="coll-ph"><Icon name="mic" size={56} /></span>}
        <div className="coll-info">
          <div className="coll-kind">Podcast{head.categories[0] ? ` · ${head.categories[0]}` : ''}</div>
          <h1 className="coll-title">{head.title}</h1>
          <div className="coll-meta">{head.author}{s ? ` · ${s.episodes.length} episode${s.episodes.length === 1 ? '' : 's'}` : ''}</div>
          <div className="coll-actions show-actions">
            <button className="pill white" disabled={!firstUnplayed} onClick={() => s && firstUnplayed && playQueue([episodeTrack(s, firstUnplayed)], 0)}><Icon name="play" size={16} /> {firstUnplayed && firstUnplayed !== s?.episodes[0] ? 'Play next unplayed' : 'Play latest'}</button>
            <button className={`pill ${followed ? 'ghost' : ''}`} onClick={toggleFollow} aria-pressed={followed} data-action="follow">{followed ? <><Icon name="check" size={16} /> Following</> : <><Icon name="plus" size={16} /> Follow</>}</button>
          </div>
        </div>
      </div>
      {head.description && <p className="show-desc">{head.description}</p>}
      {show.loading && !s ? <SkelRows n={6} /> : show.error && !s ? <Err msg={show.error} retry={show.retry} /> : s && (
        <>
          <div className="schips" role="tablist">
            <button className={`schip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All episodes</button>
            <button className={`schip ${filter === 'unplayed' ? 'on' : ''}`} onClick={() => setFilter('unplayed')}>Unplayed</button>
          </div>
          {eps.length ? (
            <div className="ep-list">{eps.slice(0, n).map((e) => <EpisodeRow key={e.id} show={s} e={e} list={eps} p={progress[episodeTrack(s, e).videoId]} />)}</div>
          ) : <p className="row-sub">You’ve played every episode.</p>}
          {eps.length > n && <button className="pill ghost sm more-eps" onClick={() => setN(n + 50)}>Show older episodes</button>}
        </>
      )}
    </div>
  );
}

const EpisodeRow = memo(function EpisodeRow({ show, e, p, showName, list }: { show: Show; e: Episode; p?: Progress; showName?: boolean; list: Episode[] }) {
  const t = episodeTrack(show, e);
  const [open, setOpen] = useState(false);
  const left = p && !p.played && p.pos > 5 && (p.dur || e.duration) ? Math.max(0, (p.dur || e.duration) - p.pos) : 0;
  const pct = p?.played ? 100 : p && (p.dur || e.duration) ? Math.min(100, (p.pos / (p.dur || e.duration)) * 100) : 0;
  const play = () => {
    // This episode, then the older ones after it in the same show.
    const i = list.indexOf(e);
    const next = (i >= 0 ? list.slice(i, i + 20) : [e]).map((x) => episodeTrack(show, x));
    void playQueue(next, 0);
  };
  const mark = (played: boolean) => saveProgress(t.videoId, { pos: 0, dur: p?.dur || e.duration, played });
  return (
    <div className={`ep-row ${p?.played ? 'played' : ''}`}>
      <button className="ep-main" onClick={play} aria-label={`Play ${e.title}`}>
        <img src={e.image || show.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
        <span className="ep-text">
          <span className="ep-meta">{showName ? `${show.title} · ` : ''}{fmtDate(e.published)}{e.season && e.episode ? ` · S${e.season} E${e.episode}` : ''}</span>
          <span className="ep-title">{e.title}</span>
          <span className="ep-sub">
            <Icon name="play" size={12} /> {p?.played ? 'Played' : left ? `${fmtDur(left)} left` : fmtDur(e.duration) || 'Episode'}
            {pct > 0 && pct < 100 && <span className="ep-bar"><span style={{ width: `${pct}%` }} /></span>}
          </span>
        </span>
      </button>
      <div className="ep-actions">
        <button className="icon-btn" aria-label="More" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="more" size={18} /></button>
        {open && (
          <div className="ep-menu" role="menu" onMouseLeave={() => setOpen(false)}>
            <button role="menuitem" onClick={() => { send({ type: 'add-next', track: t }); setOpen(false); }}><Icon name="next-up" size={18} />Play next</button>
            <button role="menuitem" onClick={() => { send({ type: 'add-queue', track: t }); setOpen(false); }}><Icon name="queue-add" size={18} />Add to queue</button>
            <button role="menuitem" onClick={() => { void mark(!p?.played); setOpen(false); }}><Icon name="check" size={18} />{p?.played ? 'Mark as unplayed' : 'Mark as played'}</button>
            {e.link && <a role="menuitem" href={e.link} target="_blank" rel="noreferrer noopener" onClick={() => setOpen(false)}><Icon name="external" size={18} />Episode page</a>}
          </div>
        )}
      </div>
      {e.description && <p className="ep-desc">{e.description}</p>}
    </div>
  );
});
