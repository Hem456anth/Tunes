// Discover: new releases and charts from JioSaavn, Apple Music and Deezer,
// filtered by language and genre. Songs keep each catalogue's official
// artwork and metadata; playback picks the best source per song.
import { useEffect, useRef, useState } from 'react';
import { DISCOVER_GENRES, DISCOVER_LANGUAGES, getDiscover, type DiscoverTrack } from '../../lib/discover';
import { useCached, useSettings } from '../hooks';
import { playQueue, TrackRow } from './Items';
import { Icon } from './Icon';
import type { Ctx } from './Views';
import { SkelRows } from './Views';

const SRC_LABEL: Record<string, string> = { jiosaavn: 'JioSaavn', apple: 'Apple Music', deezer: 'Deezer' };
const langLabel = (l: string) => DISCOVER_LANGUAGES.find((x) => x.id === l)?.label ?? (l === 'international' ? 'Global' : l.charAt(0).toUpperCase() + l.slice(1));
function when(d?: string) {
  if (!d) return '';
  const days = Math.floor((Date.now() - Date.parse(d)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
const metaOf = (t: DiscoverTrack, withDate: boolean) => [langLabel(t.language), withDate ? when(t.releaseDate) : t.genre && t.genre.toLowerCase() !== t.language && !(t.genre === 'Bollywood' && t.language === 'hindi') ? t.genre : when(t.releaseDate), t.sources.map((s) => SRC_LABEL[s]).join(' + ')].filter(Boolean).join(' · ');

function Block({ title, sub, tracks, ctx, withDate, ranked, initial = 8 }: { title: string; sub?: string; tracks: DiscoverTrack[]; ctx: Ctx; withDate?: boolean; ranked?: boolean; initial?: number }) {
  const [all, setAll] = useState(false);
  if (!tracks.length) return null;
  const list = all ? tracks : tracks.slice(0, initial);
  return (
    <section className="section">
      <div className="section-head">
        <div>{sub && <div className="strap">{sub}</div>}<h2>{title}</h2></div>
        <div className="head-actions">
          <button className="round-btn sm" title="Play all" onClick={() => playQueue(tracks, 0)}><Icon name="play" size={16} /></button>
          {tracks.length > initial && <button className="more" onClick={() => setAll(!all)}>{all ? 'Less' : `All ${tracks.length}`}</button>}
        </div>
      </div>
      <div className="track-grid disc-list">
        {list.map((t, i) => <TrackRow key={t.videoId + i} t={t} list={tracks} i={i} activeId={ctx.activeId} onArtist={ctx.onArtist} meta={metaOf(t, !!withDate)} rank={ranked ? i + 1 : undefined} />)}
      </div>
    </section>
  );
}

// Genre filter: one row that scrolls sideways. A mouse wheel scrolls it too (most
// desktop mice have no horizontal wheel), arrow keys move between genres, and the
// chosen genre is kept in view.
function GenreChips({ genre, onPick }: { genre: string; onPick: (id: string) => void }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return;
      const max = el.scrollWidth - el.clientWidth;
      // At either end, let the page scroll on as usual.
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => {
    row.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [genre]);
  const key = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    const at = DISCOVER_GENRES.findIndex((g) => g.id === genre);
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? DISCOVER_GENRES.length - 1 : step ? (at + step + DISCOVER_GENRES.length) % DISCOVER_GENRES.length : -1;
    if (to < 0) return;
    e.preventDefault();
    onPick(DISCOVER_GENRES[to].id);
    row.current?.querySelectorAll<HTMLElement>('[role="radio"]')[to]?.focus();
  };
  return (
    <div className="disc-chips genres" role="radiogroup" aria-label="Genre" ref={row} onKeyDown={key}>
      {DISCOVER_GENRES.map((g) => (
        <button key={g.id} role="radio" aria-checked={genre === g.id} tabIndex={genre === g.id ? 0 : -1} className={`disc-chip ghost ${genre === g.id ? 'on' : ''}`} onClick={() => onPick(g.id)}>{g.label}</button>
      ))}
    </div>
  );
}

export function DiscoverPage({ ctx }: { ctx: Ctx }) {
  const s = useSettings();
  const [genre, setGenre] = useState('all');
  const langs = s.discoverLangs?.length ? s.discoverLangs : ['english'];
  const key = `discover:${langs.join(',')}:${genre}`;
  const { data, error, loading, refreshing, retry } = useCached(key, () => getDiscover(langs, genre), 30 * 60 * 1000);
  return (
    <div className="discover">
      <GenreChips genre={genre} onPick={setGenre} />
      {loading && !data ? <SkelRows n={8} /> : error && !data ? (
        <div className="err-box"><span>{error}</span><button className="pill sm ghost" onClick={retry}>Try again</button></div>
      ) : data && (
        <>
          <Block title="New releases" sub={refreshing ? 'Updating…' : 'Last 6 weeks'} tracks={data.fresh} ctx={ctx} withDate initial={12} />
          {data.sections.map((sec) => <Block key={sec.id} title={sec.title} sub={sec.sub} tracks={sec.tracks} ctx={ctx} ranked />)}
          {!data.fresh.length && !data.sections.length && <div className="hint">Nothing new for this mix yet. Try another genre or add a language.</div>}
          <p className="disc-foot">
            From JioSaavn, Apple Music and Deezer. Songs play from JioSaavn when it has them, otherwise the matching YouTube Music recording.
            {data.failed.length ? ` Couldn't reach: ${data.failed.join(', ')}.` : ''}
          </p>
        </>
      )}
    </div>
  );
}
