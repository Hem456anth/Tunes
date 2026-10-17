import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sized } from '../../lib/innertube';
import type { PlayerState, Track, UiCommand } from '../../lib/types';
import { send } from '../hooks';
import { Icon } from './Icon';

/**
 * Up Next, after Apple Music: History (optional), the playing song, then Playing Next.
 * Drag the handle (mouse, touch or pen) to reorder; arrow keys move a focused handle.
 * Edits show at once and are confirmed by the background's next broadcast.
 */

interface Local { queue: Track[]; index: number }
interface Drag { from: number; over: number; dy: number; h: number; startY: number; scroll0: number; pointer: number }

const parseDur = (d?: string) => (d ? d.split(':').reduce((a, x) => a * 60 + Number(x || 0), 0) : 0);
const totalLabel = (tracks: Track[]) => {
  const sec = tracks.reduce((a, t) => a + parseDur(t.duration), 0);
  if (!sec) return '';
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
};

function moveLocal(l: Local, from: number, to: number): Local {
  const q = l.queue.slice();
  const [it] = q.splice(from, 1);
  q.splice(to, 0, it);
  let index = l.index;
  if (from === index) index = to;
  else if (from < index && to >= index) index--;
  else if (from > index && to <= index) index++;
  return { queue: q, index };
}

export function QueuePane({ s }: { s: PlayerState }) {
  const [local, setLocal] = useState<Local>({ queue: s.queue, index: s.index });
  const [history, setHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menu, setMenuIdx] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState<React.CSSProperties>({});
  const setMenu = (i: number | null, btn?: HTMLElement) => {
    if (i != null && btn) {
      // Fixed position so the pane's scroll box never clips it; opens upward near the bottom.
      const r = btn.getBoundingClientRect();
      const below = window.innerHeight - r.bottom > 150;
      setMenuPos({ position: 'fixed', right: Math.max(8, window.innerWidth - r.right), ...(below ? { top: r.bottom + 4, bottom: 'auto' } : { bottom: window.innerHeight - r.top + 4, top: 'auto' }) });
    }
    setMenuIdx(i);
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  // Follow the background, but never yank the list out from under a drag.
  useEffect(() => { if (!dragRef.current) setLocal({ queue: s.queue, index: s.index }); }, [s.queue, s.index]);

  const apply = (next: Local, cmd: UiCommand) => { setLocal(next); send(cmd); };
  // Stable keys: the nth copy of a song keeps its key when rows move.
  const keys = (() => { const seen = new Map<string, number>(); return local.queue.map((t) => { const n = seen.get(t.videoId) ?? 0; seen.set(t.videoId, n + 1); return `${t.videoId}#${n}`; }); })();
  const keyOf = (_t: Track, i: number) => keys[i];

  const localRef = useRef(local);
  localRef.current = local;
  const remove = (abs: number) => {
    const k = keyOf(local.queue[abs], abs);
    setLeaving((x) => new Set(x).add(k));
    setMenu(null);
    setTimeout(() => {
      setLeaving((x) => { const n = new Set(x); n.delete(k); return n; });
      // Find the row again by key: other removes may have shifted it meanwhile.
      const cur = localRef.current;
      const seen = new Map<string, number>();
      const idx = cur.queue.findIndex((t) => { const n = seen.get(t.videoId) ?? 0; seen.set(t.videoId, n + 1); return `${t.videoId}#${n}` === k; });
      if (idx < 0 || idx === cur.index) return;
      const q = cur.queue.slice(); q.splice(idx, 1);
      const next = { queue: q, index: idx < cur.index ? cur.index - 1 : cur.index };
      localRef.current = next;
      apply(next, { type: 'remove-index', index: idx });
    }, 160);
  };
  const playNext = (abs: number) => {
    setMenu(null);
    const to = abs < local.index ? local.index : local.index + 1;
    if (abs !== to) apply(moveLocal(local, abs, to), { type: 'play-next-index', index: abs });
  };
  const moveToEnd = (abs: number) => {
    setMenu(null);
    const to = local.queue.length - 1;
    if (abs !== to) apply(moveLocal(local, abs, to), { type: 'move', from: abs, to });
  };
  const move = (abs: number, to: number) => {
    if (to <= local.index || to >= local.queue.length || abs === to) return;
    setFocusKey(local.queue[abs].videoId);
    apply(moveLocal(local, abs, to), { type: 'move', from: abs, to });
  };

  // Keep keyboard focus on the moved row's handle.
  useLayoutEffect(() => {
    if (!focusKey) return;
    listRef.current?.querySelector<HTMLElement>(`[data-vid="${CSS.escape(focusKey)}"] .q-handle`)?.focus();
    setFocusKey(null);
  }, [local]);

  const up = local.queue.map((t, i) => ({ t, i })).slice(local.index + 1);
  const past = local.queue.map((t, i) => ({ t, i })).slice(0, Math.max(0, local.index));
  const cur = local.index >= 0 ? local.queue[local.index] : null;

  // ----- drag (pointer events cover mouse, touch and pen) -----
  const scroller = () => listRef.current?.closest('.np-pane') as HTMLElement | null;
  const onHandleDown = (e: React.PointerEvent, pos: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const row = (e.currentTarget as HTMLElement).closest('.q-row') as HTMLElement;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setMenu(null);
    setDrag({ from: pos, over: pos, dy: 0, h: row.getBoundingClientRect().height, startY: e.clientY, scroll0: scroller()?.scrollTop ?? 0, pointer: e.pointerId });
  };
  const lastY = useRef(0);
  const update = (clientY: number) => {
    const d = dragRef.current; if (!d) return;
    const dy = clientY - d.startY + ((scroller()?.scrollTop ?? 0) - d.scroll0);
    const over = Math.max(0, Math.min(up.length - 1, d.from + Math.round(dy / d.h)));
    setDrag({ ...d, dy, over });
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!dragRef.current || e.pointerId !== dragRef.current.pointer) return;
    lastY.current = e.clientY;
    update(e.clientY);
  };
  // Auto-scroll near the edges while dragging.
  useEffect(() => {
    if (!drag) return;
    let raf = 0;
    const tick = () => {
      const sc = scroller(); const d = dragRef.current;
      if (sc && d) {
        const r = sc.getBoundingClientRect(); const y = lastY.current; const zone = 48;
        const v = y < r.top + zone ? -(r.top + zone - y) / 4 : y > r.bottom - zone ? (y - (r.bottom - zone)) / 4 : 0;
        if (v) { sc.scrollTop += Math.max(-14, Math.min(14, v)); update(y); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [!!drag]);
  const onHandleUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointer) return;
    setDrag(null);
    if (d.over !== d.from) {
      const from = local.index + 1 + d.from, to = local.index + 1 + d.over;
      apply(moveLocal(local, from, to), { type: 'move', from, to });
    }
  };
  const shiftFor = (pos: number) => {
    if (!drag || pos === drag.from) return 0;
    if (drag.from < drag.over && pos > drag.from && pos <= drag.over) return -drag.h;
    if (drag.from > drag.over && pos < drag.from && pos >= drag.over) return drag.h;
    return 0;
  };

  // A render function, not a component: rows must not remount mid-drag or pointer capture is lost.
  const row = (t: Track, i: number, pos: number, kind: 'up' | 'past') => {
    const k = keyOf(t, i);
    const dragging = drag && kind === 'up' && drag.from === pos;
    const style = kind === 'up' && drag ? { transform: `translateY(${dragging ? drag.dy : shiftFor(pos)}px)` } : undefined;
    return (
      <div
        key={k}
        data-vid={t.videoId}
        className={`q-row ${kind} ${dragging ? 'dragging' : ''} ${drag && !dragging ? 'shifting' : ''} ${leaving.has(k) ? 'leaving' : ''}`}
        style={style}
        onClick={() => { if (!drag && !editing) send({ type: 'play-index', index: i }); }}
        role={editing ? undefined : 'button'} tabIndex={editing ? undefined : 0} aria-label={editing ? undefined : `Play ${t.title}`}
        onKeyDown={(e) => { if (e.target === e.currentTarget && !editing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); send({ type: 'play-index', index: i }); } }}
      >
        {editing && kind === 'up' && (
          <button className="q-del" title="Remove" aria-label={`Remove ${t.title}`} onClick={(e) => { e.stopPropagation(); remove(i); }}><span /></button>
        )}
        <img src={sized(t.thumbnail, 96)} alt="" loading="lazy" draggable={false} />
        <div className="q-meta"><div className="track-title">{t.title}</div><div className="track-sub">{t.artists}</div></div>
        {kind === 'up' && !editing && t.duration && <span className="q-dur">{t.duration}</span>}
        {!editing && (
          <div className="q-more-wrap">
            <button className="icon-btn q-more" title="More" aria-haspopup="menu" aria-expanded={menu === i} onClick={(e) => { e.stopPropagation(); setMenu(menu === i ? null : i, e.currentTarget); }}><Icon name="more" size={18} /></button>
            {menu === i && (
              <>
                <div className="menu-scrim" onClick={(e) => { e.stopPropagation(); setMenu(null); }} />
                <div className="menu q-menu" role="menu" style={menuPos} onClick={(e) => e.stopPropagation()}>
                  {(kind === 'past' || i !== local.index + 1) && <button role="menuitem" onClick={() => playNext(i)}><Icon name="next-up" size={18} />Play next</button>}
                  {kind === 'up' && i !== local.queue.length - 1 && <button role="menuitem" onClick={() => moveToEnd(i)}><Icon name="queue" size={18} />Move to end</button>}
                  <button role="menuitem" className="danger" onClick={() => remove(i)}><Icon name="trash" size={18} />Remove from queue</button>
                </div>
              </>
            )}
          </div>
        )}
        {kind === 'up' && (
          <button
            className="q-handle" title="Drag to reorder" aria-label={`Reorder ${t.title}. Use the up and down arrow keys.`}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => onHandleDown(e, pos)} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); }
              if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); }
            }}
          ><Icon name="drag" size={18} /></button>
        )}
      </div>
    );
  };

  useEffect(() => { if (!up.length) setEditing(false); }, [up.length]);

  return (
    <div className={`queue ${drag ? 'is-dragging' : ''}`} ref={listRef}>
      {past.length > 0 && (
        <button className={`q-history-toggle ${history ? 'on' : ''}`} onClick={() => { setHistory(!history); if (!history) requestAnimationFrame(() => curRef.current?.scrollIntoView({ block: 'center' })); }}>
          <Icon name="history" size={16} />{history ? 'Hide history' : `History · ${past.length}`}
        </button>
      )}
      {history && past.length > 0 && (
        <section className="q-section">
          <div className="q-head"><div className="pane-title">History</div></div>
          {past.map(({ t, i }, pos) => row(t, i, pos, 'past'))}
        </section>
      )}
      {cur && (
        <div className="q-now" ref={curRef}>
          <img src={sized(cur.thumbnail, 96)} alt="" />
          <div className="q-meta"><div className="q-now-label">{s.playing ? 'Playing' : 'Paused'}</div><div className="track-title">{cur.title}</div><div className="track-sub">{cur.artists}</div></div>
          <span className={`q-eq ${s.playing ? 'on' : ''}`}><i /><i /><i /></span>
        </div>
      )}
      <section className="q-section">
        <div className="q-head">
          <div>
            <div className="pane-title">Playing Next</div>
            <div className="q-sub">{up.length ? [`${up.length} song${up.length === 1 ? '' : 's'}`, totalLabel(up.map((x) => x.t))].filter(Boolean).join(' · ') : s.repeat === 'all' ? 'Repeats from the top' : 'Autoplay picks similar songs'}</div>
          </div>
          {up.length > 0 && (
            <div className="q-actions">
              {editing && <button className="q-pill danger" onClick={() => { setEditing(false); apply({ queue: local.queue.slice(0, local.index + 1), index: local.index }, { type: 'clear-upnext' }); }}>Clear</button>}
              <button className={`q-pill ${editing ? 'on' : ''}`} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</button>
            </div>
          )}
        </div>
        {up.length === 0 ? (
          <div className="q-empty">Use Play next or Add to queue on any song to line it up here.</div>
        ) : up.map(({ t, i }, pos) => row(t, i, pos, 'up'))}
      </section>
    </div>
  );
}
