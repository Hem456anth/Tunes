import { useEffect, useRef, useState, type ReactNode } from 'react';
import { deleteImported, getImported, type ImportedPlaylist } from '../../lib/transfer/index';
import type { Card, MoodChip, Shelf, Track } from '../../lib/types';
import { findArtistId, getArtist, getQueue, getCardTracks, getCollection, getHome, getHomeMore, getLibraryPlaylists, getMoodCategory, getMoods, search, sized, type SearchChip } from '../../lib/innertube';
import { readCache, refresh } from '../../lib/cache';
import { SearchBar } from './SearchBar';
import { getLiked, getRecent } from '../../lib/history';
import { send, useCached } from '../hooks';
import { CardTile, playQueue, playSongWithRadio, TrackRow } from './Items';
import { DiscoverPage } from './Discover';
import { Icon } from './Icon';
import { openCardMenu, openNewPlaylist, useContextMenu } from './Actions';
import { collKey, getLibCollections, getLibSongs, getPlaylists, localId, playlistCard } from '../../lib/library';
import { IS_MOBILE } from '../../lib/platform';


export interface Ctx { activeId: string | null; onArtist: (n: string, id?: string) => void; onOpen: (c: Card) => void }

const HOUR = 60 * 60 * 1000;

// ---------- loading / error ----------
export function SkelRows({ n = 4 }: { n?: number }) {
  return <div className="track-grid">{Array.from({ length: n }, (_, i) => <div key={i} className="skel-row"><span className="skel sq" /><span className="skel-lines"><span className="skel l1" /><span className="skel l2" /></span></div>)}</div>;
}
export function SkelCards({ n = 6, round = false }: { n?: number; round?: boolean }) {
  return <div className="carousel">{Array.from({ length: n }, (_, i) => <div key={i} className="card"><span className={`skel card-sq ${round ? 'round' : ''}`} /><span className="skel l1" /><span className="skel l2" /></div>)}</div>;
}
function SkelTiles({ n = 8 }: { n?: number }) {
  return <div className="tiles">{Array.from({ length: n }, (_, i) => <span key={i} className="skel tile-skel" />)}</div>;
}
function Err({ msg, retry }: { msg: string; retry?: () => void }) {
  return (
    <div className="err-box">
      <span>{msg}</span>
      {retry && <button className="pill sm ghost" onClick={retry}>Try again</button>}
    </div>
  );
}

function SectionHead({ title, sub, onMore, children }: { title: string; sub?: string; onMore?: () => void; children?: ReactNode }) {
  return (
    <div className="section-head">
      <div>{sub && <div className="strap">{sub}</div>}<h2>{title}</h2></div>
      <div className="head-actions">{children}{onMore && <button className="more" onClick={onMore}>See all</button>}</div>
    </div>
  );
}

// Horizontal scroller with arrow buttons (wide panel) and swipe (narrow).
function Scroller({ children, className = 'carousel', title, sub, onMore }: { children: ReactNode; className?: string; title?: string; sub?: string; onMore?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: true, r: false });
  const check = () => {
    const el = ref.current;
    if (!el) return;
    const l = el.scrollLeft < 4, r = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    setEdge((p) => (p.l === l && p.r === r ? p : { l, r }));
  };
  useEffect(() => { check(); }, [children]);
  const by = (d: number) => ref.current?.scrollBy({ left: d * (ref.current.clientWidth * 0.85), behavior: 'smooth' });
  return (
    <section className="section">
      {title !== undefined && (
        <SectionHead title={title} sub={sub} onMore={onMore}>
          <button className="arrow" disabled={edge.l} onClick={() => by(-1)} aria-label="Scroll left"><Icon name="chev-left" size={18} /></button>
          <button className="arrow" disabled={edge.r} onClick={() => by(1)} aria-label="Scroll right"><Icon name="chev-right" size={18} /></button>
        </SectionHead>
      )}
      <div className={className} ref={ref} onScroll={check}>{children}</div>
    </section>
  );
}

const PAGE = 100;
function TrackGrid({ tracks, ctx, limit }: { tracks: Track[]; ctx: Ctx; limit?: number }) {
  // Long imported playlists render in pages instead of thousands of rows at once.
  const [shown, setShown] = useState(PAGE);
  const max = limit ?? shown;
  const list = tracks.slice(0, max);
  return (
    <>
      <div className="track-grid">
        {list.map((t, i) => <TrackRow key={t.videoId + i} t={t} list={tracks} i={i} activeId={ctx.activeId} onArtist={ctx.onArtist} />)}
      </div>
      {!limit && tracks.length > shown && (
        <button className="pill show-more" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, tracks.length - shown)} more</button>
      )}
    </>
  );
}

// YouTube Music's Quick Picks layout: columns of four rows that scroll sideways.
function QuickGrid({ tracks, ctx, title, sub, onMore }: { tracks: Track[]; ctx: Ctx; title: string; sub?: string; onMore?: () => void }) {
  return (
    <Scroller className="quick-grid" title={title} sub={sub} onMore={onMore}>
      {tracks.map((t, i) => <TrackRow key={t.videoId + i} t={t} activeId={ctx.activeId} onArtist={ctx.onArtist} />)}
    </Scroller>
  );
}

function ShelfView({ shelf, ctx }: { shelf: Shelf; ctx: Ctx }) {
  return (
    <>
      {shelf.tracks.length > 0 && (shelf.tracks.length > 4
        ? <QuickGrid tracks={shelf.tracks} ctx={ctx} title={shelf.title} />
        : <section className="section"><SectionHead title={shelf.title} /><TrackGrid tracks={shelf.tracks} ctx={ctx} /></section>)}
      {shelf.cards.length > 0 && (
        <Scroller title={shelf.tracks.length ? '' : shelf.title}>
          {shelf.cards.map((c, i) => <CardTile key={i} c={c} onArtist={ctx.onArtist} onOpen={ctx.onOpen} />)}
        </Scroller>
      )}
    </>
  );
}

function useStoredTracks(get: () => Promise<Track[]>, key: string) {
  const [t, setT] = useState<Track[] | null>(null);
  useEffect(() => {
    get().then(setT);
    const fn = (changes: Record<string, unknown>) => { if (key in changes) get().then(setT); };
    chrome.storage.onChanged.addListener(fn);
    return () => chrome.storage.onChanged.removeListener(fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return t;
}

// Square tile for Recently Played on Home
function RecentTile({ t, list, i, active }: { t: Track; list: Track[]; i: number; active: boolean }) {
  return (
    <button className={`card ${active ? 'playing' : ''}`} onClick={() => playQueue(list, i)} title={t.title}>
      <div className="card-art">
        <img src={t.thumbnail} alt="" loading="lazy" />
        <span className="card-play"><Icon name={active ? 'eq' : 'play'} /></span>
      </div>
      <div className="card-title">{t.title}</div>
      <div className="card-sub">{t.artists}</div>
    </button>
  );
}

// ---------- Explore tiles (Tunes style: solid colour, tilted cover art) ----------
const artQueue: (() => void)[] = [];
let artRunning = 0;
function nextArt() {
  while (artRunning < 3 && artQueue.length) { artRunning++; artQueue.shift()!(); }
}
function useMoodArt(chip: MoodChip, visible: boolean) {
  const key = `moodart:${chip.browseId}:${chip.params}`;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    readCache<string>(key).then((hit) => {
      if (!alive) return;
      if (hit?.data) { setUrl(hit.data); return; }
      artQueue.push(() => {
        refresh(key, async () => {
          const shelves = await getMoodCategory(chip);
          return shelves.flatMap((s) => s.cards.map((c) => c.thumbnail).concat(s.tracks.map((t) => t.thumbnail))).find(Boolean) ?? '';
        }).then((u) => alive && setUrl(u)).catch(() => {}).finally(() => { artRunning--; nextArt(); });
      });
      nextArt();
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key]);
  return url;
}

function MoodTile({ c, onPick }: { c: MoodChip; onPick: (c: MoodChip) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const art = useMoodArt(c, seen);
  return (
    <button ref={ref} className="tile" style={{ ['--c' as string]: c.color }} onClick={() => onPick(c)}>
      <span className="tile-title">{c.title}</span>
      {art && <img className="tile-art" src={sized(art, 226)} alt="" loading="lazy" />}
    </button>
  );
}

export function MoodView({ chip, ctx, onBack }: { chip: MoodChip; ctx: Ctx; onBack: () => void }) {
  const { data, error, loading, retry } = useCached(`mood:${chip.browseId}:${chip.params}`, () => getMoodCategory(chip), 6 * HOUR);
  return (
    <div>
      <button className="back-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={22} /></button>
      <div className="mood-hero" style={{ ['--c' as string]: chip.color }}>
        <h1>{chip.title}</h1>
      </div>
      {loading ? <><SkelCards /><SkelCards /></> : error ? <Err msg={error} retry={retry} /> : data!.map((s, i) => <ShelfView key={i} shelf={s} ctx={ctx} />)}
    </div>
  );
}

// ---------- Listen Now ----------
function HeroCard({ c, ctx }: { c: Card; ctx: Ctx }) {
  const [busy, setBusy] = useState(false);
  const play = async (e: React.MouseEvent) => {
    e.stopPropagation(); setBusy(true);
    try { const t = await getCardTracks(c); if (t.length) await playQueue(t, 0); } finally { setBusy(false); }
  };
  const open = () => (c.kind === 'artist' ? ctx.onArtist(c.title, c.browseId) : c.kind === 'album' || c.kind === 'playlist' ? ctx.onOpen(c) : play({ stopPropagation() {} } as React.MouseEvent));
  return (
    <div className="hero-card" title={c.title}>
      <button type="button" className="hero-hit" onClick={open} aria-label={c.title}>
        <img src={sized(c.thumbnail, 544)} alt="" loading="lazy" />
        <span className="hero-text"><span className="hero-title">{c.title}</span><span className="hero-sub">{c.subtitle}</span></span>
      </button>
      <button type="button" className="hero-play" aria-label={`Play ${c.title}`} onClick={(e) => { if (!busy) play(e); }}>{busy ? <span className="spinner sm" /> : <Icon name="play" size={16} />}</button>
    </div>
  );
}

export function SignInBanner({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="signin-card">
      <div className="signin-text"><div className="signin-title">Sign in to YouTube Music</div><div className="signin-sub">Get personalized recommendations for you</div></div>
      <button className="pill white" onClick={onSignIn}>Sign in</button>
    </div>
  );
}

export function ListenNow({ ctx, signedIn, session, onSignIn, onMood, goExplore }: {
  ctx: Ctx; me: { name: string } | null; signedIn: boolean; session: string; onSignIn: () => void; onMood: (c: MoodChip) => void; goExplore: () => void;
}) {
  const [chip, setChip] = useState<{ title: string; params?: string } | null>(null);
  // Keyed by session: signing in swaps the generic feed for your own at once.
  const homeKey = `${chip ? `home:${chip.params}` : 'home'}:${session}`;
  const home = useCached(session ? homeKey : null, () => getHome(chip?.params), 30 * 60 * 1000);
  const more = useCached(home.data?.next ? `${homeKey}:more` : null, () => getHomeMore(home.data!.next!, chip ? 1 : 3), 30 * 60 * 1000);
  const recent = useStoredTracks(getRecent, 'recentlyPlayed');
  const chips = useRef<{ title: string; params?: string }[]>([]);
  if (!chip && home.data?.chips.length) chips.current = home.data.chips;

  const shelves = [...(home.data?.shelves ?? []), ...(more.data ?? [])].filter((s, i, a) => a.findIndex((x) => x.title === s.title) === i);
  const heroIdx = shelves.findIndex((s) => s.cards.length >= 2 && !s.tracks.length);
  const quick = shelves.find((s) => /quick picks/i.test(s.title) && s.tracks.length);

  return (
    <div>
      {!signedIn && !IS_MOBILE && <SignInBanner onSignIn={onSignIn} />}
      {chips.current.length > 0 && (
        <div className="schips home-chips">
          {chips.current.map((c) => (
            <button key={c.title} className={`schip ${chip?.title === c.title ? 'on' : ''}`} onClick={() => setChip(chip?.title === c.title ? null : c)}>{c.title}</button>
          ))}
        </div>
      )}
      {home.loading ? <><span className="skel hero-skel" /><SkelRows n={4} /></> : home.error ? <Err msg={home.error} retry={home.retry} /> : (
        shelves.map((s, i) => {
          if (i === heroIdx) return (
            <Scroller key={s.title} title={s.title} className="hero-row">
              {s.cards.map((c, j) => <HeroCard key={j} c={c} ctx={ctx} />)}
            </Scroller>
          );
          if (s === quick) return (
            <div key={s.title}>
              <QuickGrid tracks={s.tracks} ctx={ctx} title="Quick picks" sub="Start radio from a song" />
              {!chip && recent && recent.length > 0 && (
                <Scroller title="Recently played">
                  {recent.slice(0, 20).map((t, k) => <RecentTile key={t.videoId} t={t} list={recent} i={k} active={ctx.activeId === t.videoId} />)}
                </Scroller>
              )}
            </div>
          );
          return <ShelfView key={s.title + i} shelf={s} ctx={ctx} />;
        })
      )}
      {!home.loading && more.loading && home.data?.next && <SkelCards />}
      {!home.loading && !home.error && (
        <button className="explore-more" onClick={goExplore}><Icon name="compass" size={18} /> Explore moods & genres</button>
      )}
      {void onMood}
    </div>
  );
}

// ---------- Explore ----------
export function ExplorePage({ ctx, onMood }: { ctx: Ctx; onMood: (c: MoodChip) => void }) {
  const moods = useCached('moods', getMoods, 24 * HOUR);
  return (
    <div>
      <DiscoverPage ctx={ctx} />
      <h2 className="group-title explore-moods">Moods & genres</h2>
      {moods.loading ? <SkelTiles n={10} /> : moods.error ? <Err msg={moods.error} retry={moods.retry} /> : moods.data!.map((g) => (
        <section key={g.title} className="section">
          <h2 className="group-title">{g.title}</h2>
          <div className="tiles">{g.chips.map((c) => <MoodTile key={c.title} c={c} onPick={onMood} />)}</div>
        </section>
      ))}
    </div>
  );
}

// ---------- Library ----------
// ---------- Library (Apple Music layout: category rows + Recently Added) ----------
const LIB_ROWS: { id: string; label: string; icon: string }[] = [
  { id: 'playlists', label: 'Playlists', icon: 'queue' },
  { id: 'albums', label: 'Albums', icon: 'album' },
  { id: 'songs', label: 'Songs', icon: 'lyrics' },
  { id: 'favorites', label: 'Liked songs', icon: 'heart' },
  { id: 'recent', label: 'Recently played', icon: 'history' },
  { id: 'transfer', label: 'Transfer music', icon: 'swap' },
];
function useStored<T>(get: () => Promise<T[]>, key: string) {
  const [v, setV] = useState<T[] | null>(null);
  useEffect(() => {
    get().then(setV);
    const fn = (c: Record<string, unknown>) => { if (key in c) get().then(setV); };
    chrome.storage.onChanged.addListener(fn);
    return () => chrome.storage.onChanged.removeListener(fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}
function shuffle<T>(a: T[]): T[] { const t = [...a]; for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; } return t; }
function PlayShuffle({ tracks, more }: { tracks: Track[]; more?: () => void }) {
  return (
    <div className="coll-actions top">
      <button className="pill white" disabled={!tracks.length} onClick={() => playQueue(tracks, 0)}><Icon name="play" size={16} /> Play</button>
      <button className="pill ghost" disabled={!tracks.length} onClick={() => playQueue(shuffle(tracks), 0)}><Icon name="shuffle" size={16} /> Shuffle</button>
      {more && <button className="pill ghost icon-only" aria-label="More options" aria-haspopup="menu" onClick={more}><Icon name="more" size={16} /></button>}
    </div>
  );
}
function Back({ onClick }: { onClick: () => void }) {
  return <button className="back-btn inline" onClick={onClick}><Icon name="back" size={20} /> Library</button>;
}
function Empty({ icon, title, sub, children }: { icon: string; title: string; sub: string; children?: ReactNode }) {
  return <div className="empty-state am"><Icon name={icon} size={44} /><h3>{title}</h3><p>{sub}</p>{children}</div>;
}

export function LibraryPage({ ctx, signedIn, session, onSignIn, onTransfer }: { ctx: Ctx; me: { name: string } | null; signedIn: boolean; session: string; onSignIn: () => void; onTransfer: () => void }) {
  const recent = useStoredTracks(getRecent, 'recentlyPlayed');
  const liked = useStoredTracks(getLiked, 'liked');
  const songs = useStored(getLibSongs, 'libSongs');
  const colls = useStored(getLibCollections, 'libCollections');
  const mine = useStored(getPlaylists, 'localPlaylists');
  const lists = useCached(signedIn ? `library:playlists:${session}` : null, getLibraryPlaylists, HOUR);
  const [view, setView] = useState<string>('home');
  const [imported, setImported] = useState<ImportedPlaylist[] | null>(null);
  useEffect(() => {
    getImported().then(setImported);
    const fn = (c: Record<string, chrome.storage.StorageChange>) => { if (c.importedPlaylists) getImported().then(setImported); };
    chrome.storage.onChanged.addListener(fn);
    return () => chrome.storage.onChanged.removeListener(fn);
  }, []);
  const home = () => setView('home');
  const imp = view.startsWith('imp:') ? imported?.find((p) => p.id === view.slice(4)) : null;
  if (imp) {
    return (
      <div>
        <button className="back-btn inline" onClick={() => setView('playlists')}><Icon name="back" size={20} /> Playlists</button>
        <h2 className="sub-title">{imp.title}</h2>
        <p className="row-sub" style={{ margin: '-6px 0 12px' }}>From {imp.source} · {imp.tracks.length} songs{imp.missed.length ? ` · ${imp.missed.length} not found` : ''}{imp.ytmPlaylistId ? ' · also in YouTube Music' : ''}</p>
        <div className="coll-actions top">
          <button className="pill white" disabled={!imp.tracks.length} onClick={() => playQueue(imp.tracks, 0)}><Icon name="play" size={16} /> Play</button>
          <button className="pill ghost" onClick={async () => { if (confirm(`Remove "${imp.title}" from Tunes?`)) { await deleteImported(imp.id); setView('playlists'); } }}><Icon name="trash" size={16} /> Remove</button>
        </div>
        <TrackGrid tracks={imp.tracks} ctx={ctx} />
      </div>
    );
  }
  if (view === 'favorites' || view === 'recent' || view === 'songs') {
    const list = view === 'favorites' ? liked : view === 'recent' ? recent : songs;
    const label = LIB_ROWS.find((r) => r.id === view)!;
    return (
      <div>
        <Back onClick={home} />
        <h2 className="sub-title">{label.label}</h2>
        {!list ? <SkelRows /> : list.length ? (
          <><PlayShuffle tracks={list} /><TrackGrid tracks={list} ctx={ctx} /></>
        ) : view === 'songs'
          ? <Empty icon="note-o" title="Add Songs to Your Library" sub="Tap ⋯ on any song, then Add to Library." />
          : view === 'favorites' ? <Empty icon="heart-o" title="No liked songs yet" sub="Tap the heart on Now Playing, or Like in a song’s menu." />
          : <Empty icon="clock-o" title="Nothing Played Yet" sub="Songs you play show up here." />}
      </div>
    );
  }
  if (view === 'albums') {
    const albums = colls?.filter((c) => c.kind === 'album') ?? null;
    return (
      <div>
        <Back onClick={home} />
        <h2 className="sub-title">Albums</h2>
        {!albums ? <SkelCards /> : albums.length
          ? <div className="card-grid lib-grid">{albums.map((c) => <CardTile key={collKey(c)} c={c} onArtist={ctx.onArtist} onOpen={ctx.onOpen} more />)}</div>
          : <Empty icon="album-o" title="Add Albums to Your Library" sub="Long-press or right-click an album, or tap ⋯ on its page, then Add to Library." />}
      </div>
    );
  }
  if (view === 'playlists') {
    const saved = colls?.filter((c) => c.kind === 'playlist') ?? [];
    return (
      <div>
        <Back onClick={home} />
        <h2 className="sub-title">Playlists</h2>
        <div className="am-list">
          <button className="am-row" onClick={openNewPlaylist} data-action="new-playlist">
            <span className="am-art add"><Icon name="plus" size={26} /></span>
            <span className="am-text accent">New Playlist…</span>
          </button>
          {mine?.map((p) => <PlaylistRow key={p.id} c={playlistCard(p)} onOpen={ctx.onOpen} />)}
          {imported?.map((p) => (
            <button key={p.id} className="am-row" onClick={() => setView(`imp:${p.id}`)}>
              <span className="am-art">{p.image ? <img src={p.image} alt="" referrerPolicy="no-referrer" /> : <Icon name="playlists-o" size={22} />}</span>
              <span className="am-text">{p.title}<small>{p.source} · {p.tracks.length} songs</small></span>
              <Icon name="chev-right" size={18} />
            </button>
          ))}
          {saved.map((c) => <PlaylistRow key={collKey(c)} c={c} onOpen={ctx.onOpen} />)}
        </div>
        {signedIn && (lists.loading ? <SkelCards /> : lists.data?.length ? (
          <section className="section">
            <SectionHead title="YouTube Music" sub="Your playlists" />
            <div className="card-grid lib-grid">{lists.data.map((c, i) => <CardTile key={i} c={c} onArtist={ctx.onArtist} onOpen={ctx.onOpen} more />)}</div>
          </section>
        ) : lists.error ? <Err msg={lists.error} retry={lists.retry} /> : null)}
      </div>
    );
  }
  // Recently Added: everything you put in the library, newest first.
  const added: (Card & { at: number })[] = [
    ...(mine ?? []).map((p) => ({ ...playlistCard(p), at: p.created })),
    ...(colls ?? []).map((c) => ({ ...c, at: c.addedAt })),
    ...(songs ?? []).map((t) => ({ kind: 'song' as const, title: t.title, subtitle: t.artists, thumbnail: t.thumbnail, videoId: t.videoId, at: t.addedAt })),
  ].sort((a, b) => b.at - a.at).slice(0, 12);
  const count: Record<string, number | undefined> = { songs: songs?.length, favorites: liked?.length, recent: recent?.length, albums: colls?.filter((c) => c.kind === 'album').length, playlists: (mine?.length ?? 0) + (imported?.length ?? 0) + (colls?.filter((c) => c.kind === 'playlist').length ?? 0) };
  return (
    <div className="library-am">
      {!signedIn && !IS_MOBILE && <SignInBanner onSignIn={onSignIn} />}
      <div className="group">
        {LIB_ROWS.filter((r) => !(IS_MOBILE && r.id === 'transfer')).map((r) => (
          <button key={r.id} className="row" data-row={r.id} onClick={() => (r.id === 'transfer' ? onTransfer() : setView(r.id))}>
            <span className={`row-icon ${r.id === 'favorites' ? 'liked' : ''}`}><Icon name={r.icon} size={18} /></span>
            <span className="row-text"><span className="row-title">{r.label}</span><span className="row-sub">{r.id === 'transfer' ? 'From Spotify or Apple Music' : `${count[r.id] ?? 0} ${r.id === 'albums' ? (count[r.id] === 1 ? 'album' : 'albums') : r.id === 'playlists' ? (count[r.id] === 1 ? 'playlist' : 'playlists') : count[r.id] === 1 ? 'song' : 'songs'}`}</span></span>
            <Icon name="chev-right" size={20} />
          </button>
        ))}
      </div>
      {(added.length > 0 ? (
        <section className="section">
          <SectionHead title="Recently Added" />
          <div className="card-grid lib-grid">{added.map((c) => <CardTile key={collKey(c)} c={c} onArtist={ctx.onArtist} onOpen={ctx.onOpen} more />)}</div>
        </section>
      ) : recent && recent.length > 0 ? (
        <Scroller title="Jump back in">
          {recent.slice(0, 16).map((t, k) => <RecentTile key={t.videoId} t={t} list={recent} i={k} active={ctx.activeId === t.videoId} />)}
        </Scroller>
      ) : null)}
    </div>
  );
}

function PlaylistRow({ c, onOpen }: { c: Card; onOpen: (c: Card) => void }) {
  const menu = useContextMenu(() => openCardMenu(c));
  return (
    <div className="am-row" {...menu}>
      <button className="am-row-hit" onClick={() => onOpen(c)}>
        <span className="am-art">{c.thumbnail ? <img src={sized(c.thumbnail, 120)} alt="" referrerPolicy="no-referrer" /> : <Icon name="playlists-o" size={22} />}</span>
        <span className="am-text">{c.title}<small>{c.subtitle}</small></span>
      </button>
      <button className="icon-btn more-btn" aria-label={`More options for ${c.title}`} aria-haspopup="menu" onClick={() => openCardMenu(c)}><Icon name="more" /></button>
    </div>
  );
}

// ---------- Search tab ----------
export function SearchPage({ ctx, query, onSearch, onMood }: { ctx: Ctx; query: string | null; onSearch: (q: string) => void; onMood: (c: MoodChip) => void }) {
  const moods = useCached(query ? null : 'moods', getMoods, 24 * HOUR);
  return (
    <div>
      <SearchBar value={query} onSearch={onSearch} onOpen={ctx.onOpen} onArtist={ctx.onArtist} autoFocus={!query} />
      {query ? <SearchView key={query} q={query} ctx={ctx} /> : (
        <section className="section">
          <h2 className="group-title">Browse categories</h2>
          {moods.loading ? <SkelTiles n={8} /> : <div className="tiles">{(moods.data?.flatMap((g) => g.chips) ?? []).slice(0, 12).map((c, i) => <MoodTile key={`${c.browseId}:${c.params ?? ''}:${i}`} c={c} onPick={onMood} />)}</div>}
        </section>
      )}
    </div>
  );
}

// ---------- Search ----------
export function SearchView({ q, ctx }: { q: string; ctx: Ctx }) {
  const [chip, setChip] = useState<SearchChip | null>(null);
  const [chips, setChips] = useState<SearchChip[]>([]);
  const { data, error, loading, retry } = useCached(`search:${q}:${chip?.params ?? ''}`, () => search(q, chip?.params), 30 * 60 * 1000);
  useEffect(() => { if (!chip && data?.chips.length) setChips(data.chips); }, [data, chip]);

  const top = data?.shelves.find((s) => s.title === 'Top result');
  const rest = data?.shelves.filter((s) => s !== top) ?? [];
  const chipFor = (title: string) => chips.find((c) => c.title.toLowerCase().startsWith(title.toLowerCase().replace(/s$/, '')));

  return (
    <div>
      {chips.length > 0 && (
        <div className="schips" role="tablist">
          <button className={`schip ${!chip ? 'on' : ''}`} onClick={() => setChip(null)}>All</button>
          {chips.map((c) => (
            <button key={c.title} className={`schip ${chip?.title === c.title ? 'on' : ''}`} onClick={() => setChip(c)}>{c.title}</button>
          ))}
        </div>
      )}
      {loading ? <><SkelRows n={3} /><SkelCards /></> : error ? <Err msg={error} retry={retry} /> : !data!.shelves.length ? (
        <div className="empty-state"><Icon name="search" size={28} /><p>No results for “{q}”. Try fewer words, or check the spelling.</p></div>
      ) : chip ? (
        rest.map((s, i) => (
          <section key={i} className="section">
            {s.tracks.length > 0 && <TrackGrid tracks={s.tracks} ctx={ctx} />}
            {s.cards.length > 0 && <div className="card-grid">{s.cards.map((c, j) => <CardTile key={j} c={c} onArtist={ctx.onArtist} onOpen={ctx.onOpen} />)}</div>}
          </section>
        ))
      ) : (
        <>
          {top && <TopResult shelf={top} ctx={ctx} />}
          {rest.map((s, i) => {
            const more = chipFor(s.title);
            return s.tracks.length ? (
              <section key={i} className="section">
                <SectionHead title={s.title} onMore={more ? () => setChip(more) : undefined} />
                <TrackGrid tracks={s.tracks} ctx={ctx} limit={4} />
              </section>
            ) : (
              <Scroller key={i} title={s.title} onMore={more ? () => setChip(more) : undefined}>
                {s.cards.map((c, j) => <CardTile key={j} c={c} onArtist={ctx.onArtist} onOpen={ctx.onOpen} />)}
              </Scroller>
            );
          })}
        </>
      )}
    </div>
  );
}

function TopResult({ shelf, ctx }: { shelf: Shelf; ctx: Ctx }) {
  const card = shelf.cards[0];
  const lead = card ? null : shelf.tracks[0];
  const songs = card ? shelf.tracks : shelf.tracks.slice(1);
  const art = card?.thumbnail ?? lead?.thumbnail ?? '';
  const open = () => (card ? (card.kind === 'artist' ? ctx.onArtist(card.title, card.browseId) : ctx.onOpen(card)) : lead && playSongWithRadio(lead));
  return (
    <section className="section top-result">
      <SectionHead title="Top result" />
      <div className={`top-wrap ${songs.length ? '' : 'solo'}`}>
        <div className="top-card" onClick={open} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}>
          <img className={card?.kind === 'artist' ? 'round' : ''} src={art} alt="" />
          <div className="top-info">
            <div className="top-title">{card?.title ?? lead?.title}</div>
            <div className="top-sub">{card ? card.subtitle : `Song · ${lead?.artists}`}</div>
            <button className="pill sm" onClick={(e) => {
              e.stopPropagation();
              if (lead) playSongWithRadio(lead);
              else if (songs.length) playQueue(songs, 0);
              else open();
            }}><Icon name="play" size={14} /> Play</button>
          </div>
        </div>
        {songs.length > 0 && <div className="top-songs"><TrackGrid tracks={songs} ctx={ctx} limit={4} /></div>}
      </div>
    </section>
  );
}

// ---------- Album / playlist ----------
export function CollectionView({ card, ctx, onBack }: { card: Card; ctx: Ctx; onBack: () => void }) {
  const lid = localId(card);
  return lid ? <LocalPlaylistView id={lid} ctx={ctx} onBack={onBack} /> : <RemoteCollection card={card} ctx={ctx} onBack={onBack} />;
}

function LocalPlaylistView({ id, ctx, onBack }: { id: string; ctx: Ctx; onBack: () => void }) {
  const lists = useStored(getPlaylists, 'localPlaylists');
  const p = lists?.find((x) => x.id === id);
  useEffect(() => { if (lists && !p) onBack(); }, [lists, p, onBack]);
  if (!p) return <SkelRows n={6} />;
  const card = playlistCard(p);
  return (
    <div>
      <button className="back-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={22} /></button>
      <div className="coll-head">
        {p.tracks[0] ? <img src={sized(p.tracks[0].thumbnail, 544)} alt="" /> : <span className="coll-ph"><Icon name="playlists-o" size={56} /></span>}
        <div className="coll-info">
          <div className="coll-kind">Playlist</div>
          <h1 className="coll-title">{p.title}</h1>
          <div className="coll-meta">{card.subtitle}</div>
          <PlayShuffle tracks={p.tracks} more={() => openCardMenu(card)} />
        </div>
      </div>
      {p.tracks.length
        ? <div className="track-grid">{p.tracks.map((t, i) => <TrackRow key={t.videoId} t={t} list={p.tracks} i={i} activeId={ctx.activeId} onArtist={ctx.onArtist} playlistId={p.id} />)}</div>
        : <Empty icon="playlist-add" title="This Playlist Is Empty" sub="Tap ⋯ on any song, then Add to a Playlist…" />}
    </div>
  );
}

function RemoteCollection({ card, ctx, onBack }: { card: Card; ctx: Ctx; onBack: () => void }) {
  const { data, error, loading, retry } = useCached(`coll:${card.browseId ?? card.playlistId ?? card.title}`, () => getCollection(card), HOUR);
  return (
    <div>
      <button className="back-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={22} /></button>
      {loading ? (
        <><div className="coll-head"><span className="skel coll-skel" /><div className="coll-info"><span className="skel l1" /><span className="skel l2" /></div></div><SkelRows n={8} /></>
      ) : error ? <Err msg={error} retry={retry} /> : (
        <>
          <div className="coll-head">
            <img src={data!.thumbnail} alt="" />
            <div className="coll-info">
              <div className="coll-kind">{data!.subtitle}</div>
              <h1 className="coll-title">{data!.title}</h1>
              {data!.artist && <div className="coll-artist link" onClick={() => ctx.onArtist(data!.artist)}>{data!.artist}</div>}
              <div className="coll-meta">{data!.meta}</div>
              <div className="coll-actions">
                <button className="pill" disabled={!data!.tracks.length} onClick={() => playQueue(data!.tracks, 0)}><Icon name="play" size={16} /> Play</button>
                <button className="pill ghost" disabled={!data!.tracks.length} onClick={() => {
                  const t = [...data!.tracks]; for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
                  playQueue(t, 0);
                }}><Icon name="shuffle" size={16} /> Shuffle</button>
                <button className="pill ghost icon-only" aria-label="More options" aria-haspopup="menu" onClick={() => openCardMenu(card)}><Icon name="more" size={16} /></button>
              </div>
            </div>
          </div>
          {data!.tracks.length ? <TrackGrid tracks={data!.tracks} ctx={ctx} /> : <div className="hint">No playable tracks.</div>}
        </>
      )}
    </div>
  );
}

// ---------- Artist page (Tunes's ArtistScreen) ----------
export function ArtistView({ name, id, ctx, onBack }: { name: string; id?: string; ctx: Ctx; onBack: () => void }) {
  const lead = name.split(/,| & /)[0].trim();
  const { data, error, loading, retry } = useCached(`artist:${id ?? lead.toLowerCase()}`, async () => {
    const bid = id ?? (await findArtistId(lead));
    if (!bid) throw new Error(`Couldn't find ${lead} on YouTube Music`);
    return getArtist(bid);
  }, 6 * HOUR);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<'' | 'shuffle' | 'radio'>('');
  const start = async (kind: 'shuffle' | 'radio') => {
    const ep = kind === 'shuffle' ? data?.shuffle : data?.radio;
    if (!ep && !data?.topSongs.length) return;
    setBusy(kind);
    try {
      const tracks = ep ? await getQueue(ep) : data!.topSongs;
      if (tracks.length) send({ type: 'play-queue', tracks, index: 0 });
    } finally { setBusy(''); }
  };
  return (
    <div className="artist-page">
      <button className="back-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={22} /></button>
      {loading ? (
        <><div className="artist-hero"><span className="skel artist-skel" /><div className="artist-info"><span className="skel l1" /><span className="skel l2" /></div></div><SkelRows n={5} /></>
      ) : error ? <Err msg={error} retry={retry} /> : (
        <>
          <div className="artist-hero" style={{ ['--banner' as string]: data!.banner ? `url("${data!.banner}")` : 'none' }}>
            <div className="artist-banner" />
            <img className="artist-photo" src={data!.thumbnail} alt="" />
            <div className="artist-info">
              <h1 className="artist-name">{data!.name}</h1>
              <div className="artist-meta">{[data!.audience, data!.subscribers && `${data!.subscribers} subscribers`].filter(Boolean).join(' · ')}</div>
              <div className="coll-actions">
                <button className="pill" disabled={!!busy} onClick={() => start('shuffle')}>{busy === 'shuffle' ? <span className="spinner sm" /> : <Icon name="shuffle" size={16} />} Shuffle</button>
                <button className="pill ghost" disabled={!!busy} onClick={() => start('radio')}>{busy === 'radio' ? <span className="spinner sm" /> : <Icon name="radio" size={16} />} Radio</button>
              </div>
            </div>
          </div>
          {data!.topSongs.length > 0 && (
            <section className="section">
              <SectionHead title="Top songs" onMore={data!.topSongsCard ? () => ctx.onOpen(data!.topSongsCard!) : undefined} />
              <TrackGrid tracks={data!.topSongs} ctx={ctx} />
            </section>
          )}
          {data!.shelves.map((sh, i) => <ShelfView key={i} shelf={sh} ctx={ctx} />)}
          {data!.description && (
            <section className="section">
              <SectionHead title="About" />
              <p className={`artist-about ${more ? 'open' : ''}`} role="button" tabIndex={0} aria-expanded={more} onClick={() => setMore(!more)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMore(!more); } }}>{data!.description}</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
