import { sized } from '../../lib/innertube';
import { toSeconds } from '../../lib/matcher';
import { useEffect, useRef, useState } from 'react';
import type { PlayerState, Settings } from '../../lib/types';
import { QueuePane } from './Queue';
import { getLyrics, lyricsDebug, type LyricLine, type Lyrics } from '../../lib/lyrics';
import { getLiked, toggleLiked } from '../../lib/history';
import { fmt, send, useLivePosition } from '../hooks';
import { Icon } from './Icon';
import { openSongMenu } from './Actions';

type Pane = 'none' | 'lyrics' | 'queue';

export function Controls({ s, size = 'lg' }: { s: PlayerState; size?: 'lg' | 'sm' }) {
  const big = size === 'lg';
  return (
    <div className={`controls ${size}`}>
      {big && (
        <button className={`icon-btn ${s.shuffle ? 'on' : ''}`} title="Shuffle" onClick={() => send({ type: 'shuffle' })}>
          <Icon name="shuffle" size={18} />
        </button>
      )}
      <button className="icon-btn" title="Previous (Alt+Shift+,)" onClick={() => send({ type: 'prev' })}><Icon name="prev" size={big ? 28 : 22} /></button>
      <button className="play-btn" title="Play/Pause (Alt+Shift+P)" onClick={() => send({ type: 'toggle' })} aria-label={s.playing ? 'Pause' : 'Play'}>
        <Icon name={s.playing ? 'pause' : 'play'} size={big ? 30 : 22} />
      </button>
      <button className="icon-btn" title="Next (Alt+Shift+.)" onClick={() => send({ type: 'next' })}><Icon name="next" size={big ? 28 : 22} /></button>
      {big && (
        <button className={`icon-btn ${s.repeat !== 'off' ? 'on' : ''}`} title={`Repeat: ${s.repeat}`} onClick={() => send({ type: 'repeat' })}>
          <Icon name={s.repeat === 'one' ? 'repeat-one' : 'repeat'} size={18} />
        </button>
      )}
    </div>
  );
}

export function Seek({ s }: { s: PlayerState }) {
  const pos = useLivePosition(s, 8);
  const [drag, setDrag] = useState<number | null>(null);
  const dur = s.duration || 0;
  const v = drag ?? pos;
  const commit = () => { if (drag != null) send({ type: 'seek', seconds: drag }); setDrag(null); };
  return (
    <div className="seek">
      <input
        type="range" min={0} max={dur || 1} step={0.5} value={Math.min(v, dur || 1)}
        style={{ ['--p' as string]: `${dur ? (v / dur) * 100 : 0}%` }}
        onChange={(e) => setDrag(Number(e.target.value))}
        // pointer events cover mouse, touch and pen (touch fires no mouseup after a range drag)
        onPointerUp={commit} onKeyUp={commit} onBlur={commit} onPointerCancel={() => setDrag(null)}
        aria-label="Seek"
      />
      <div className="seek-times"><span>{fmt(v)}</span><span>-{fmt(Math.max(dur - v, 0))}</span></div>
    </div>
  );
}

function Words({ l, pos }: { l: LyricLine; pos: number }) {
  // Word-by-word fill, like Tunes's syllable lyrics
  return (
    <>
      {l.words!.map((w, i) => {
        const p = pos <= w.t ? 0 : pos >= w.t + w.d ? 1 : (pos - w.t) / Math.max(w.d, 0.05);
        return <span key={i} className="w" style={{ ['--f' as string]: `${Math.round(p * 100)}%` }}>{w.text}</span>;
      })}
    </>
  );
}

function LiveWords({ l, s }: { l: LyricLine; s: PlayerState }) {
  const pos = useLivePosition(s, 60); // only the sung line ticks at frame rate
  return <Words l={l} pos={pos} />;
}

function LyricsPane({ s, settings }: { s: PlayerState; settings: Settings }) {
  const pos = useLivePosition(s, 10);
  const [ly, setLy] = useState<Lyrics | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const t = s.track;
  // The song's length lets every lyrics answer be checked; when the catalogue
  // row doesn't carry it, wait (briefly) for the player to report it.
  const len = toSeconds(t?.duration) || (s.duration > 0 ? Math.round(s.duration) : 0);
  const hasLen = len > 0;
  useEffect(() => {
    let alive = true; // a slow lookup for the previous song must not land on this one
    setLy(null);
    if (!t) return;
    const run = () => getLyrics(t.title, t.artists, len || undefined, t.album)
      .then((l) => alive && setLy(l))
      .catch(() => alive && setLy({ synced: null, plain: null }));
    const wait = hasLen ? null : setTimeout(run, 3000);
    if (hasLen) run();
    return () => { alive = false; if (wait) clearTimeout(wait); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.videoId, hasLen]);
  const lines = settings.syncedLyrics ? ly?.synced : null;
  const cur = lines ? lines.findLastIndex((l) => l.time <= pos + 0.25) : -1;
  useEffect(() => {
    box.current?.querySelector('.ly.cur')?.scrollIntoView({ block: 'center', behavior: settings.reduceMotion ? 'auto' : 'smooth' });
  }, [cur, settings.reduceMotion]);
  if (!ly) return <div className="pane-empty"><span className="spinner" /></div>;
  const plain = ly.plain ?? (!settings.syncedLyrics && ly.synced ? ly.synced.map((l) => l.text).join('\n') : null);
  if (!lines && !plain) return <div className="pane-empty">No lyrics found{settings.lyricsDebug && <pre className="ly-debug">{lyricsDebug.slice(-8).join('\n')}</pre>}</div>;
  return (
    <div className={`lyrics ${settings.blurLyrics ? 'blur' : ''}`} ref={box}>
      {lines
        ? lines.map((l, i) => (
            <p key={i} className={`ly ${i === cur ? 'cur' : i < cur ? 'past' : ''} ${l.words ? 'wordy' : ''}`} style={{ ['--d' as string]: Math.min(Math.abs(i - cur), 4) }}
              role="button" tabIndex={-1} onClick={() => send({ type: 'seek', seconds: l.time })}>
              {l.words && i === cur ? <LiveWords l={l} s={s} /> : l.text || '♪'}
            </p>
          ))
        : plain!.split('\n').map((l, i) => <p key={i} className="ly plain">{l}</p>)}
      {ly.source && <div className="ly-source">Lyrics from {ly.source}{ly.wordSynced ? ' · word by word' : ''}</div>}
      {settings.lyricsDebug && <pre className="ly-debug">{lyricsDebug.slice(-8).join('\n')}</pre>}
    </div>
  );
}


const SLEEP_OPTIONS: { label: string; min: number }[] = [
  { label: '15 minutes', min: 15 }, { label: '30 minutes', min: 30 }, { label: '45 minutes', min: 45 },
  { label: '1 hour', min: 60 }, { label: 'End of this song', min: -1 },
];
function SleepButton({ s }: { s: PlayerState }) {
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { if (!s.sleepAt) return; const id = setInterval(() => tick((n) => n + 1), 15000); return () => clearInterval(id); }, [s.sleepAt]);
  const left = s.sleepAt ? Math.max(1, Math.ceil((s.sleepAt - Date.now()) / 60000)) : 0;
  const on = !!s.sleepAt || s.sleepEndOfTrack;
  const pick = (min: number) => { send({ type: 'sleep', minutes: min }); setOpen(false); };
  return (
    <div className="sleep">
      <button className={`icon-btn ${on ? 'on' : ''}`} title={on ? (s.sleepEndOfTrack ? 'Sleep timer: end of song' : `Sleep timer: ${left} min left`) : 'Sleep timer'} onClick={() => setOpen(!open)}>
        <Icon name="moon" size={20} />{on && <span className="sleep-badge">{s.sleepEndOfTrack ? '♪' : left}</span>}
      </button>
      {open && (
        <>
          <div className="menu-scrim" onClick={() => setOpen(false)} />
          <div className="menu" role="menu">
            <div className="menu-title">Stop playing in</div>
            {SLEEP_OPTIONS.map((o) => <button key={o.min} role="menuitem" onClick={() => pick(o.min)}>{o.label}</button>)}
            {on && <button role="menuitem" className="danger" onClick={() => pick(0)}>Turn off timer</button>}
          </div>
        </>
      )}
    </div>
  );
}

export function NowPlaying({ s, settings, onArtist }: { s: PlayerState; settings: Settings; onArtist: (n: string, id?: string) => void }) {
  const [pane, setPane] = useState<Pane>('none');
  const [liked, setLiked] = useState(false);
  const t = s.track;
  useEffect(() => {
    if (!t) return;
    const read = () => getLiked().then((l) => setLiked(l.some((x) => x.videoId === t.videoId)));
    read();
    // Favorite from the ⋯ menu or a song row updates the star here too.
    const fn = (c: Record<string, chrome.storage.StorageChange>) => { if (c.liked) read(); };
    chrome.storage.onChanged.addListener(fn);
    return () => chrome.storage.onChanged.removeListener(fn);
  }, [t?.videoId]);

  if (!t) {
    return (
      <div className="np empty">
        <div className="np-art placeholder"><img src="icons/icon128.png" alt="" /></div>
        <p>Pick something to play</p>
      </div>
    );
  }
  return (
    <div className={`np ${pane !== 'none' ? 'with-pane' : ''}`}>
      <div className="np-label">NOW PLAYING</div>
      {pane === 'none' ? (
        <div className="np-art"><img src={sized(t.thumbnail, 544)} alt={t.title} /></div>
      ) : (
        <div className="np-pane">{pane === 'lyrics' ? <LyricsPane s={s} settings={settings} /> : <QueuePane s={s} />}</div>
      )}
      <div className="np-titlebar">
        <div className="np-titles">
          <div className="np-title" title={t.title}>{t.title}</div>
          <div className="np-artist link" onClick={() => onArtist(t.artists, t.artistId)}>{t.artists}</div>
        </div>
        <button className={`icon-btn ${liked ? 'on' : ''}`} title="Like" aria-pressed={liked} onClick={() => toggleLiked(t).then(setLiked)}>
          <Icon name={liked ? 'heart' : 'heart-o'} />
        </button>
        <button className="icon-btn np-more" title="More" aria-label="More options" aria-haspopup="menu" onClick={() => openSongMenu(t, { nowPlaying: true })}>
          <Icon name="more" />
        </button>
      </div>
      <Seek s={s} />
      {(s.resolving || s.error || settings.showStats || s.stream?.includes('· ad playing')) && (
        <div className="nerd" title="Stats for nerds">
          {s.resolving ? <><span className="spinner sm" /> Finding the best stream…</> : s.error ? s.error : s.stream ?? ''}
        </div>
      )}
      <Controls s={s} />
      <div className="np-bottom">
        <span className="np-side">
          <button className={`icon-btn ${pane === 'lyrics' ? 'on' : ''}`} title="Lyrics" onClick={() => setPane(pane === 'lyrics' ? 'none' : 'lyrics')}><Icon name="lyrics" /></button>
        </span>
        {settings.hideVolume ? <span className="vol" /> : (
          <label className="vol"><Icon name="volume" size={18} />
            <Volume value={s.volume} />
          </label>
        )}
        <span className="np-side">
          <button className={`icon-btn ${pane === 'queue' ? 'on' : ''}`} title="Up Next" aria-label="Up Next" onClick={() => setPane(pane === 'queue' ? 'none' : 'queue')}><Icon name="queue" /></button>
          <SleepButton s={s} />
        </span>
      </div>
    </div>
  );
}

export function MiniBar({ s, onExpand }: { s: PlayerState; onExpand: () => void }) {
  const t = s.track;
  if (!t) return null;
  const pct = s.duration ? (s.position / s.duration) * 100 : 0;
  return (
    <div className="minibar">
      <div className="mini-progress" style={{ width: `${pct}%` }} />
      <button className="mini-main" onClick={onExpand} aria-label="Open Now Playing">
        <img src={t.thumbnail} alt="" />
        <div className="q-meta"><div className="track-title">{t.title}</div><div className="track-sub">{t.artists}</div></div>
      </button>
      <Controls s={s} size="sm" />
    </div>
  );
}

/** Volume follows the finger locally and sends at most one update per frame. */
function Volume({ value }: { value: number }) {
  const [drag, setDrag] = useState<number | null>(null);
  const raf = useRef(0);
  const pending = useRef<number | null>(null);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const v = drag ?? value;
  const change = (n: number) => {
    setDrag(n); pending.current = n;
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; if (pending.current != null) send({ type: 'volume', value: pending.current }); });
  };
  return <input type="range" min={0} max={100} value={v} style={{ ['--p' as string]: `${v}%` }} onChange={(e) => change(Number(e.target.value))}
    onPointerUp={() => setTimeout(() => setDrag(null), 150)} onKeyUp={() => setTimeout(() => setDrag(null), 150)} onBlur={() => setDrag(null)} aria-label="Volume" />;
}
