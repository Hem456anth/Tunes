import { useEffect, useRef, useState } from 'react';
import type { Card, Suggestion } from '../../lib/types';
import { searchSuggestions } from '../../lib/innertube';
import { Icon } from './Icon';
import { playSongWithRadio } from './Items';

const RECENT_KEY = 'recentSearches';
const getRecentSearches = async () => ((await chrome.storage.local.get(RECENT_KEY))[RECENT_KEY] as string[]) ?? [];
export async function rememberSearch(q: string) {
  const list = (await getRecentSearches()).filter((x) => x.toLowerCase() !== q.toLowerCase());
  await chrome.storage.local.set({ [RECENT_KEY]: [q, ...list].slice(0, 8) });
}

const KIND_LABEL: Record<Suggestion['kind'], string> = { query: '', song: 'Song', video: 'Video', artist: 'Artist', album: 'Album', playlist: 'Playlist' };

function Bold({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase().trim());
  if (i < 0 || !q.trim()) return <>{text}</>;
  const n = q.trim().length;
  return <>{text.slice(0, i)}<b>{text.slice(i, i + n)}</b>{text.slice(i + n)}</>;
}

type Row = { type: 'recent'; text: string } | { type: 'sugg'; s: Suggestion };

export function SearchBar({ value, onSearch, onOpen, onArtist, busy, autoFocus }: {
  value: string | null; onSearch: (q: string) => void; onOpen: (c: Card) => void; onArtist: (n: string, id?: string) => void; busy?: boolean; autoFocus?: boolean;
}) {
  const [q, setQ] = useState(value ?? '');
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(-1);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { setQ(value ?? ''); }, [value]);
  useEffect(() => { if (autoFocus) setTimeout(() => input.current?.focus(), 50); }, [autoFocus]);
  useEffect(() => { getRecentSearches().then(setRecent); }, [open]);

  useEffect(() => {
    setSel(-1);
    const term = q.trim();
    if (term.length < 1) { setSugg([]); setLoading(false); return; }
    setLoading(true);
    let alive = true;
    const id = setTimeout(() => {
      searchSuggestions(term).then((s) => alive && setSugg(s)).catch(() => alive && setSugg([])).finally(() => alive && setLoading(false));
    }, 160);
    return () => { alive = false; clearTimeout(id); };
  }, [q]);

  // "/" or Ctrl/⌘+K focuses search, like YouTube Music
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const typing = document.activeElement?.tagName === 'INPUT';
      if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault(); input.current?.focus(); input.current?.select();
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const showRecent = !q.trim();
  const queries = sugg.filter((s) => s.kind === 'query').slice(0, 6);
  const rich = sugg.filter((s) => s.kind !== 'query').slice(0, 4);
  const rows: Row[] = showRecent
    ? recent.map((text) => ({ type: 'recent' as const, text }))
    : [...queries, ...rich].map((s) => ({ type: 'sugg' as const, s }));

  const close = () => { setOpen(false); setSel(-1); input.current?.blur(); };
  const submit = (v: string) => {
    const term = v.trim();
    if (!term) return;
    setQ(term); close(); onSearch(term); rememberSearch(term);
  };
  const pick = (r: Row) => {
    if (r.type === 'recent') return submit(r.text);
    const s = r.s;
    if (s.kind === 'query') return submit(s.text);
    close();
    rememberSearch(s.text);
    if ((s.kind === 'song' || s.kind === 'video') && s.track) return void playSongWithRadio(s.track);
    if (s.kind === 'artist') return onArtist(s.text, s.card?.browseId);
    if (s.card) return onOpen(s.card);
  };
  const removeRecent = async (text: string) => {
    const next = recent.filter((x) => x !== text);
    setRecent(next);
    await chrome.storage.local.set({ [RECENT_KEY]: next });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setSel((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(-1, i - 1)); }
    else if (e.key === 'Escape') { if (q) setQ(''); else close(); }
    else if (e.key === 'Enter' && sel >= 0 && rows[sel]) { e.preventDefault(); pick(rows[sel]); }
  };

  const selRow = sel >= 0 ? rows[sel] : null;
  const preview = selRow ? (selRow.type === 'recent' ? selRow.text : selRow.s.kind === 'query' ? selRow.s.text : null) : null;

  return (
    <form className={`search ${open ? 'focused' : ''}`} onSubmit={(e) => { e.preventDefault(); submit(preview ?? q); }} role="search">
      {busy || (loading && open) ? <span className="spinner sm search-spin" /> : <Icon name="search" size={18} />}
      <input
        ref={input} value={preview ?? q} placeholder="Songs, albums, artists" aria-label="Search music"
        role="combobox" aria-expanded={open} aria-autocomplete="list" autoComplete="off" spellCheck={false}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 160)}
        onKeyDown={onKey}
      />
      {q ? (
        <button type="button" className="icon-btn" onClick={() => { setQ(''); onSearch(''); input.current?.focus(); }} aria-label="Clear"><Icon name="close" size={16} /></button>
      ) : <kbd className="kbd">/</kbd>}
      {open && rows.length > 0 && (
        <div className="suggest" role="listbox">
          {showRecent && <div className="suggest-head"><span>Recent searches</span><button type="button" onMouseDown={(e) => { e.preventDefault(); setRecent([]); chrome.storage.local.set({ [RECENT_KEY]: [] }); }}>Clear</button></div>}
          {rows.map((r, i) => {
            const on = i === sel;
            if (r.type === 'recent') return (
              <div key={'r' + r.text} className={`sugg ${on ? 'on' : ''}`} role="option" aria-selected={on} onMouseDown={(e) => { e.preventDefault(); pick(r); }} onMouseEnter={() => setSel(i)}>
                <Icon name="history" size={16} /><span className="sugg-text">{r.text}</span>
                <button type="button" className="icon-btn x" aria-label="Remove" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeRecent(r.text); }}><Icon name="close" size={14} /></button>
              </div>
            );
            const s = r.s;
            const sep = s.kind !== 'query' && i > 0 && rows[i - 1].type === 'sugg' && (rows[i - 1] as { s: Suggestion }).s.kind === 'query';
            return (
              <div key={s.kind + s.text + i}>
                {sep && <div className="suggest-sep" />}
                <div className={`sugg ${on ? 'on' : ''} ${s.kind !== 'query' ? 'rich' : ''}`} role="option" aria-selected={on} onMouseDown={(e) => { e.preventDefault(); pick(r); }} onMouseEnter={() => setSel(i)}>
                  {s.kind === 'query' ? <Icon name="search" size={16} /> : <img className={s.kind === 'artist' ? 'round' : ''} src={s.thumbnail} alt="" />}
                  <span className="sugg-main">
                    <span className="sugg-text">{s.kind === 'query' ? <Bold text={s.text} q={q} /> : s.text}</span>
                    {s.kind !== 'query' && <span className="sugg-sub">{KIND_LABEL[s.kind]}{s.sub ? ` · ${s.sub}` : ''}</span>}
                  </span>
                  {s.kind === 'query'
                    ? <button type="button" className="icon-btn x" aria-label="Fill" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setQ(s.text + ' '); input.current?.focus(); }}><Icon name="arrow-ul" size={14} /></button>
                    : (s.kind === 'song' || s.kind === 'video') && <Icon name="play" size={16} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </form>
  );
}
