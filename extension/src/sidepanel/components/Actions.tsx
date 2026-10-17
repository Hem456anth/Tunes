// Apple Music-style action sheets, trimmed to the essentials: the song menu
// (Now Playing ⋯, song rows), album/playlist menus, Add to a Playlist, plus the
// confirmation HUD. One host renders whatever is open.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Card, PlayerState, Track } from '../../lib/types';
import { addToYouTubePlaylist, getCollection, getLibraryPlaylists, getQueue, searchSongs, sized } from '../../lib/innertube';
import { getLiked, toggleLiked } from '../../lib/history';
import {
  addToPlaylist, collInLibrary, createPlaylist, deletePlaylist, getPlaylists, getSuggestLess, inLibrary, localId,
  removeFromPlaylist, renamePlaylist, setCollInLibrary, setInLibrary, setSuggestLess, type LocalPlaylist,
} from '../../lib/library';
import { send } from '../hooks';
import { Icon } from './Icon';
import { playQueue, playSongWithRadio } from './Items';

// ---------- what can be open ----------
export interface SongMenuOpts { nowPlaying?: boolean; playlistId?: string }
type Sheet =
  | { kind: 'song'; t: Track; opts: SongMenuOpts }
  | { kind: 'card'; c: Card }
  | { kind: 'playlist-pick'; title: string; tracks: () => Promise<Track[]> }
  | { kind: 'rename'; id: string; title: string }
  | { kind: 'new-playlist'; tracks?: () => Promise<Track[]> };

let openFn: ((s: Sheet | null) => void) | null = null;
let hudFn: ((h: { text: string; icon: string } | null) => void) | null = null;
export const openSongMenu = (t: Track, opts: SongMenuOpts = {}) => openFn?.({ kind: 'song', t, opts });
export const openCardMenu = (c: Card) => { if (c.kind !== 'artist') openFn?.({ kind: 'card', c }); };
export const openNewPlaylist = () => openFn?.({ kind: 'new-playlist' });
export function hud(text: string, icon = 'check') { hudFn?.({ text, icon }); }

/** Right-click, long-press (touch) and Shift+F10 open a context menu. */
export function useContextMenu(open: () => void) {
  const timer = useRef<number>(0);
  const fired = useRef(false);
  const cancel = () => clearTimeout(timer.current);
  return {
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); cancel(); open(); },
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      if (e.pointerType !== 'touch') return;
      timer.current = window.setTimeout(() => { fired.current = true; navigator.vibrate?.(10); open(); }, 480);
    },
    onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel,
    // A long-press must not also activate the row underneath.
    onClickCapture: (e: React.MouseEvent) => { if (fired.current) { e.stopPropagation(); e.preventDefault(); fired.current = false; } },
    onKeyDown: (e: React.KeyboardEvent) => { if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') { e.preventDefault(); open(); } },
  };
}

// ---------- helpers ----------
const isYtId = (id: string) => /^[\w-]{11}$/.test(id);
async function seedId(t: Track): Promise<string | null> {
  if (isYtId(t.videoId)) return t.videoId;
  const hit = (await searchSongs(`${t.title} ${t.artists}`).catch(() => []))[0];
  return hit?.videoId ?? null;
}
const songUrl = (t: Track) => isYtId(t.videoId)
  ? `https://music.youtube.com/watch?v=${t.videoId}`
  : `https://music.youtube.com/search?q=${encodeURIComponent(`${t.title} ${t.artists}`)}`;
/** The system share sheet where Chrome has one, otherwise copy the link. */
async function share(title: string, url: string | null, text?: string) {
  const data = { title, url: url ?? undefined, text };
  try {
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) { await navigator.share(data); return; }
  } catch (e) { if ((e as Error).name === 'AbortError') return; }
  await navigator.clipboard.writeText([text, url].filter(Boolean).join('\n'));
  hud(url ? 'Link Copied' : 'Copied', 'link-o');
}
/** Every song of an album or playlist card (your own playlists come from storage). */
export async function cardTracks(c: Card): Promise<Track[]> {
  const lid = localId(c);
  if (lid) return (await getPlaylists()).find((p) => p.id === lid)?.tracks ?? [];
  if ((c.kind === 'song' || c.kind === 'video') && c.videoId) return [{ videoId: c.videoId, title: c.title, artists: c.subtitle.split(' • ')[0] ?? '', thumbnail: c.thumbnail }];
  return (await getCollection(c)).tracks;
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- building blocks ----------
interface Row { id: string; label: string; icon: string; run: () => void | Promise<void>; danger?: boolean; chevron?: boolean; keepOpen?: boolean; hint?: string }

function SheetFrame({ label, head, children, onClose, wide }: { label: string; head?: ReactNode; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const close = () => { setLeaving(true); setTimeout(onClose, 160); };
  useEffect(() => {
    // Focus the sheet itself (its rows may still be loading); arrows then reach the first row.
    const prev = document.activeElement as HTMLElement | null;
    const input = box.current?.querySelector<HTMLElement>('input');
    (input ?? box.current)?.focus({ preventScroll: true });
    // Escape closes even when focus wandered outside the sheet.
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); prev?.focus?.({ preventScroll: true }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(box.current?.querySelectorAll<HTMLElement>('[role=menuitem],[role=menuitemcheckbox]') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  };
  return (
    <div className={`sheet-wrap ${leaving ? 'leaving' : ''}`} onKeyDown={onKey}>
      <div className="sheet-scrim" onClick={close} />
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={label} ref={box} tabIndex={-1}>
        <div className="sheet-grab" aria-hidden="true" />
        {head}
        <div className="sheet-body" role="menu" aria-label={label}>{children}</div>
      </div>
    </div>
  );
}
function Head({ img, title, sub, round, onClose }: { img?: string; title: string; sub?: string; round?: boolean; onClose?: () => void }) {
  return (
    <div className="sheet-head">
      {img ? <img className={round ? 'round' : ''} src={sized(img, 120)} alt="" referrerPolicy="no-referrer" /> : <span className="sheet-head-ph"><Icon name="note-o" size={22} /></span>}
      <div className="sheet-head-text"><div className="sheet-head-title">{title}</div>{sub && <div className="sheet-head-sub">{sub}</div>}</div>
      {onClose && <button className="sheet-x" aria-label="Close" onClick={onClose}><Icon name="close" size={16} /></button>}
    </div>
  );
}
function Rows({ rows, close }: { rows: Row[]; close: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <>
      {rows.map((r) => (
        <button key={r.id} role="menuitem" className={`sheet-row ${r.danger ? 'danger' : ''}`} disabled={busy === r.id} data-action={r.id}
          onClick={async () => {
            setBusy(r.id);
            try { if (!r.keepOpen) close(); await r.run(); }
            catch (e) { hud(errText(e), 'info-o'); }
            finally { setBusy(null); }
          }}>
          <span className="sheet-ico"><Icon name={r.icon} size={24} /></span>
          <span className="sheet-label">{r.label}</span>
          {r.hint && <span className="sheet-hint">{r.hint}</span>}
          {r.chevron && <span className="sheet-chev"><Icon name="chev-right" size={18} /></span>}
        </button>
      ))}
    </>
  );
}

// ---------- the host ----------
export function ActionHost({ player, signedIn, onArtist, onOpen }: { player: PlayerState | null; signedIn: boolean; onArtist: (n: string, id?: string) => void; onOpen: (c: Card) => void }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [h, setH] = useState<{ text: string; icon: string; n: number } | null>(null);
  useEffect(() => {
    openFn = (s) => setSheet(s);
    let t = 0;
    hudFn = (x) => { clearTimeout(t); setH(x ? { ...x, n: Date.now() } : null); t = window.setTimeout(() => setH(null), 1600); };
    return () => { openFn = null; hudFn = null; };
  }, []);
  const close = () => setSheet(null);
  const p = useRef(player); p.current = player;
  return (
    <>
      {sheet?.kind === 'song' && <SongSheet key={`s${sheet.t.videoId}`} t={sheet.t} opts={sheet.opts} player={p} onClose={close} open={setSheet} onArtist={onArtist} />}
      {sheet?.kind === 'card' && <CardSheet c={sheet.c} player={p} onClose={close} open={setSheet} onArtist={onArtist} onOpen={onOpen} />}
      {sheet?.kind === 'playlist-pick' && <PlaylistPicker title={sheet.title} tracks={sheet.tracks} signedIn={signedIn} onClose={close} open={setSheet} />}
      {sheet?.kind === 'new-playlist' && <NamePrompt label="New Playlist" action="Create" initial="" onClose={close} onSubmit={async (name) => {
        const ts = sheet.tracks ? await sheet.tracks() : [];
        await createPlaylist(name, ts);
        hud(ts.length ? 'Added to Playlist' : 'Playlist Created', 'playlist-add');
      }} />}
      {sheet?.kind === 'rename' && <NamePrompt label="Rename Playlist" action="Save" initial={sheet.title} onClose={close} onSubmit={async (name) => { await renamePlaylist(sheet.id, name); hud('Renamed', 'pencil'); }} />}
      {h && <div className="hud" key={h.n} role="status" aria-live="polite"><Icon name={h.icon} size={40} /><span>{h.text}</span></div>}
    </>
  );
}

// ---------- song menu (Image 2) ----------
function SongSheet({ t, opts, player, onClose, open, onArtist }: { t: Track; opts: SongMenuOpts; player: React.MutableRefObject<PlayerState | null>; onClose: () => void; open: (s: Sheet) => void; onArtist: (n: string, id?: string) => void }) {
  const [f, setF] = useState<{ lib: boolean; fav: boolean; less: boolean } | null>(null);
  useEffect(() => {
    Promise.all([inLibrary(t.videoId), getLiked(), getSuggestLess()]).then(([lib, liked, less]) =>
      setF({ lib, fav: liked.some((x) => x.videoId === t.videoId), less: less.includes(t.videoId) }));
  }, [t.videoId]);
  const s = player.current;
  const isCurrent = s?.track?.videoId === t.videoId;
  const np = !!opts.nowPlaying;
  const R: Record<string, Row> = {
    lib: f?.lib
      ? { id: 'lib', label: 'Remove from Library', icon: 'trash-o', danger: true, run: async () => { await setInLibrary(t, false); hud('Removed from Library', 'trash-o'); } }
      : { id: 'lib', label: 'Add to Library', icon: 'plus', run: async () => { await setInLibrary(t, true); hud('Added to Library', 'check'); } },
    playlist: { id: 'playlist', label: 'Add to a Playlist…', icon: 'playlist-add', keepOpen: true, run: () => open({ kind: 'playlist-pick', title: t.title, tracks: async () => [t] }) },
    next: { id: 'next', label: 'Play Next', icon: 'play-next', run: async () => { await send({ type: 'add-next', track: t }); hud('Playing Next', 'play-next'); } },
    last: { id: 'last', label: 'Play Last', icon: 'play-last', run: async () => { await send({ type: 'add-queue', track: t }); hud('Playing Last', 'play-last'); } },
    shareSong: { id: 'share-song', label: 'Share Song', icon: 'share', run: () => share(`${t.title} · ${t.artists}`, songUrl(t), `${t.title} by ${t.artists}`) },
    station: { id: 'station', label: 'Create Station', icon: 'station-add', run: async () => {
      if (!isCurrent) { await playSongWithRadio(t); hud('Station Created', 'station-add'); return; }
      // Keep the song playing; replace what's up next with its station.
      const id = await seedId(t);
      const less = new Set(await getSuggestLess());
      const radio = id ? (await getQueue({ videoId: id })).filter((x) => x.videoId !== t.videoId && !less.has(x.videoId)) : [];
      if (!radio.length) throw new Error('No station for this song');
      await send({ type: 'clear-upnext' });
      await send({ type: 'append', tracks: radio.slice(0, 40) });
      hud('Station Created', 'station-add');
    } },
    fav: f?.fav
      ? { id: 'fav', label: 'Remove from Liked Songs', icon: 'heart', run: async () => { await toggleLiked(t); hud('Removed from Liked Songs', 'heart-o'); } }
      : { id: 'fav', label: 'Like', icon: 'heart-o', run: async () => { await toggleLiked(t); hud('Added to Liked Songs', 'heart'); } },
    less: f?.less
      ? { id: 'less', label: 'Undo Suggest Less', icon: 'thumb-down-f', run: async () => { await setSuggestLess(t.videoId, false); hud('Got It', 'check'); } }
      : { id: 'less', label: 'Suggest Less', icon: 'thumb-down', run: async () => {
          await setSuggestLess(t.videoId, true);
          const st = player.current;
          if (st?.track?.videoId === t.videoId && st.queue.length > 1) await send({ type: 'next' });
          else if (st) { const i = st.queue.findIndex((x, k) => k > st.index && x.videoId === t.videoId); if (i > 0) await send({ type: 'remove-index', index: i }); }
          hud('We’ll Suggest Less Like This', 'thumb-down');
        } },
    removePl: { id: 'remove-pl', label: 'Remove from Playlist', icon: 'minus-circle', danger: true, run: async () => { await removeFromPlaylist(opts.playlistId!, t.videoId); hud('Removed', 'minus-circle'); } },
  };
  // Only what matters: the star and the moon already sit on Now Playing.
  const order = np
    ? ['lib', 'playlist', 'shareSong', 'station', 'less']
    : ['next', 'last', 'lib', 'playlist', 'fav', 'shareSong', ...(opts.playlistId ? ['removePl'] : [])];
  return (
    <SheetFrame label={`${t.title} options`} onClose={onClose} head={<Head img={t.thumbnail} title={t.title} sub={[t.artists, t.album].filter(Boolean).join(' · ')} />}>
      {f ? <Rows rows={order.map((k) => R[k])} close={onClose} /> : <div className="sheet-wait"><span className="spinner" /></div>}
    </SheetFrame>
  );
}

// ---------- album / playlist / artist menu ----------
function CardSheet({ c, player, onClose, open, onArtist, onOpen }: { c: Card; player: React.MutableRefObject<PlayerState | null>; onClose: () => void; open: (s: Sheet) => void; onArtist: (n: string, id?: string) => void; onOpen: (c: Card) => void }) {
  const lid = localId(c);
  const [lib, setLib] = useState<boolean | null>(lid ? true : null);
  useEffect(() => { if (!lid) collInLibrary(c).then(setLib); }, [c, lid]);
  const noun = c.kind === 'album' ? 'Album' : c.kind === 'artist' ? 'Artist' : 'Playlist';
  const tracks = () => cardTracks(c).then((ts) => { if (!ts.length) throw new Error(`No playable songs in this ${noun.toLowerCase()}`); return ts; });
  const empty = () => !player.current?.queue.length;
  if (c.kind === 'song' || c.kind === 'video') {
    return <SongSheet t={{ videoId: c.videoId ?? '', title: c.title, artists: c.subtitle.split(' • ')[0] ?? '', thumbnail: c.thumbnail }} opts={{}} player={player} onClose={onClose} open={open} onArtist={onArtist} />;
  }
  let rows: Row[];
  {
    rows = [
      { id: 'next', label: 'Play Next', icon: 'play-next', run: async () => { const ts = await tracks(); await (empty() ? playQueue(ts, 0) : send({ type: 'add-next-many', tracks: ts })); hud('Playing Next', 'play-next'); } },
      { id: 'last', label: 'Play Last', icon: 'play-last', run: async () => { const ts = await tracks(); await (empty() ? playQueue(ts, 0) : send({ type: 'append', tracks: ts, keepDupes: true })); hud('Playing Last', 'play-last'); } },
      lid
        ? { id: 'lib', label: 'Delete from Library', icon: 'trash-o', danger: true, run: async () => { if (!confirm(`Delete “${c.title}”? This can’t be undone.`)) return; await deletePlaylist(lid); hud('Deleted', 'trash-o'); } }
        : lib
          ? { id: 'lib', label: 'Remove from Library', icon: 'trash-o', danger: true, run: async () => { await setCollInLibrary(c, false); hud('Removed from Library', 'trash-o'); } }
          : { id: 'lib', label: 'Add to Library', icon: 'plus', run: async () => { await setCollInLibrary(c, true); hud('Added to Library', 'check'); } },
      { id: 'playlist', label: 'Add to a Playlist…', icon: 'playlist-add', keepOpen: true, run: () => open({ kind: 'playlist-pick', title: c.title, tracks }) },
      ...(lid ? [{ id: 'rename', label: 'Rename', icon: 'pencil', keepOpen: true, run: () => open({ kind: 'rename', id: lid, title: c.title }) }] : []),
    ];
  }
  return (
    <SheetFrame label={`${c.title} options`} onClose={onClose} head={<Head img={c.thumbnail} title={c.title} sub={c.subtitle} round={c.kind === 'artist'} />}>
      {lib == null ? <div className="sheet-wait"><span className="spinner" /></div> : <Rows rows={rows} close={onClose} />}
    </SheetFrame>
  );
}

// ---------- Add to a Playlist… ----------
function PlaylistPicker({ title, tracks, signedIn, onClose, open }: { title: string; tracks: () => Promise<Track[]>; signedIn: boolean; onClose: () => void; open: (s: Sheet) => void }) {
  const [mine, setMine] = useState<LocalPlaylist[] | null>(null);
  const [yt, setYt] = useState<Card[] | null>(null);
  useEffect(() => {
    getPlaylists().then(setMine);
    if (signedIn) getLibraryPlaylists().then((l) => setYt(l.filter((c) => c.kind === 'playlist' && (c.playlistId || c.browseId?.startsWith('VL')) && !/^(liked music|episodes for later)$/i.test(c.title)))).catch(() => setYt([]));
  }, [signedIn]);
  const add = async (fn: (ts: Track[]) => Promise<number | void>) => {
    onClose();
    try {
      const ts = await tracks();
      const n = await fn(ts);
      hud(n === 0 ? 'Already in Playlist' : 'Added to Playlist', 'playlist-add');
    } catch (e) { hud(errText(e), 'info-o'); }
  };
  return (
    <SheetFrame label="Add to a Playlist" onClose={onClose} head={<div className="sheet-title-bar"><span className="sheet-title">Add to a Playlist</span><span className="sheet-title-sub">{title}</span></div>}>
      <button role="menuitem" className="sheet-row" data-action="new-playlist" onClick={() => open({ kind: 'new-playlist', tracks })}>
        <span className="sheet-ico"><Icon name="plus" size={24} /></span><span className="sheet-label accent">New Playlist…</span>
      </button>
      {mine?.map((p) => (
        <button key={p.id} role="menuitem" className="sheet-row with-art" onClick={() => add((ts) => addToPlaylist(p.id, ts))}>
          <span className="sheet-art">{p.tracks[0] ? <img src={sized(p.tracks[0].thumbnail, 96)} alt="" referrerPolicy="no-referrer" /> : <Icon name="playlists-o" size={22} />}</span>
          <span className="sheet-label">{p.title}<small>{p.tracks.length} {p.tracks.length === 1 ? 'song' : 'songs'}</small></span>
        </button>
      ))}
      {signedIn && (
        <>
          <div className="sheet-section">YouTube Music</div>
          {yt == null ? <div className="sheet-wait"><span className="spinner" /></div> : yt.map((c) => (
            <button key={c.playlistId ?? c.browseId} role="menuitem" className="sheet-row with-art" onClick={() => add(async (ts) => {
              const ids = ts.map((x) => x.videoId).filter(isYtId);
              if (!ids.length) throw new Error('These songs aren’t on YouTube Music');
              await addToYouTubePlaylist(c.playlistId ?? c.browseId!, ids);
            })}>
              <span className="sheet-art"><img src={sized(c.thumbnail, 96)} alt="" referrerPolicy="no-referrer" /></span>
              <span className="sheet-label">{c.title}<small>{c.subtitle}</small></span>
            </button>
          ))}
        </>
      )}
    </SheetFrame>
  );
}

function NamePrompt({ label, action, initial, onSubmit, onClose }: { label: string; action: string; initial: string; onSubmit: (name: string) => Promise<void>; onClose: () => void }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!v.trim() || busy) return;
    setBusy(true);
    try { await onSubmit(v.trim()); onClose(); } catch (e) { hud(errText(e), 'info-o'); setBusy(false); }
  };
  return (
    <SheetFrame label={label} onClose={onClose} head={
      <div className="sheet-title-bar row">
        <button className="sheet-text-btn" onClick={onClose}>Cancel</button>
        <span className="sheet-title">{label}</span>
        <button className="sheet-text-btn strong" disabled={!v.trim() || busy} onClick={go}>{action}</button>
      </div>}>
      <form className="sheet-form" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <input autoFocus maxLength={100} value={v} placeholder="Playlist Title" aria-label="Playlist title" onChange={(e) => setV(e.target.value)} />
      </form>
    </SheetFrame>
  );
}

