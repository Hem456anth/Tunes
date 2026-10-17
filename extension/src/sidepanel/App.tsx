import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Card, MoodChip } from '../lib/types';
import { getAccountInfo } from '../lib/innertube';
import { send, useArtColor, useCached, usePlayer, useSession, useSettings } from './hooks';
import { Icon } from './components/Icon';
import { ArtistView, CollectionView, ExplorePage, LibraryPage, ListenNow, MoodView, SearchPage } from './components/Views';
import { MiniBar, NowPlaying } from './components/NowPlaying';
import { SettingsPage } from './components/Settings';
import { Arcs } from './components/Logo';
import { ActionHost } from './components/Actions';
import { IS_MOBILE } from '../lib/platform';

export type Tab = 'listen' | 'explore' | 'library' | 'search';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'listen', label: 'Play', icon: 'play' },
  { id: 'explore', label: 'Explore', icon: 'compass' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'search', label: 'Search', icon: 'search' },
];

const isTab = new URLSearchParams(location.search).get('mode') === 'tab';

type Overlay = { kind: 'coll'; card: Card } | { kind: 'mood'; chip: MoodChip } | { kind: 'artist'; name: string; id?: string } | null;

export default function App() {
  const player = usePlayer();
  const settings = useSettings();
  const color = useArtColor(player?.track?.thumbnail);
  const [tab, setTab] = useState<Tab>('listen');
  const [query, setQuery] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState<false | true | 'transfer'>(false);
  const main = useRef<HTMLDivElement>(null);
  const session = useSession();
  const live = settings.useAccount && session && session !== 'out';
  const account = useCached(live ? `account:${settings.authUser}:${session}` : null, getAccountInfo, 6 * 60 * 60 * 1000);
  const me = live ? account.data ?? null : null;
  const signedIn = !!live; // session cookies present = signed in, even before the profile loads

  const top = () => main.current?.scrollTo({ top: 0 });
  const go = (t: Tab) => { setTab(t); setOverlay(null); setStack([]); if (t !== 'search') setQuery(null); top(); };
  // Overlays stack like Android's back stack: artist -> album -> back to artist.
  const [stack, setStack] = useState<Overlay[]>([]);
  // Stable callbacks (they read the overlay from a ref), so the memoised rows and
  // cards don't re-render on every player tick.
  const overlayRef = useRef<Overlay>(null);
  overlayRef.current = overlay;
  const push = useCallback((o: Overlay) => {
    const cur = overlayRef.current;
    setStack((st) => (cur ? [...st, cur].slice(-10) : st)); setOverlay(o); main.current?.scrollTo({ top: 0 });
  }, []);
  const back = () => { setOverlay(stack[stack.length - 1] ?? null); setStack((st) => st.slice(0, -1)); top(); };
  const onArtist = useCallback((name: string, id?: string) => { if (name || id) push({ kind: 'artist', name, id }); }, [push]);
  const onMood = useCallback((chip: MoodChip) => push({ kind: 'mood', chip }), [push]);
  const onOpen = useCallback((card: Card) => push({ kind: 'coll', card }), [push]);
  const activeId = player?.videoId ?? null;
  const ctx = useMemo(() => ({ activeId, onArtist, onOpen }), [activeId, onArtist, onOpen]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName ?? '') || !!el?.isContentEditable;
      // Space is play/pause only when focus is not on something Space already activates.
      const interactive = !!el?.closest('input,textarea,select,button,a,[role=button],[role=radio],[role=switch],[role=checkbox],[role=option],[role=menuitem],[contenteditable=true]');
      if (e.code === 'Space' && !typing && !interactive && !e.repeat) { e.preventDefault(); send({ type: 'toggle' }); }
      if (!typing && ((e.key === '/') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) && tab !== 'search') { e.preventDefault(); go('search'); }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Theme + motion/blur preferences
  const [sysDark, setSysDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)');
    const fn = () => setSysDark(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);
  const theme = settings.theme === 'system' ? (sysDark ? 'dark' : 'light') : settings.theme;

  const titles: Record<Tab, string> = { listen: 'Listen Now', explore: 'Explore', library: 'Library', search: 'Search' };

  return (
    <div
      className={`app ${isTab ? 'tab-mode' : ''} ${expanded ? 'expanded' : ''} ${settings.reduceMotion ? 'reduce-motion' : ''} ${settings.reduceBlur ? 'reduce-blur' : ''}`}
      data-theme={theme}
      style={{ ['--art' as string]: color }}
    >
      <div className="backdrop" />
      <div className="layout">
        <main className="main" ref={main}>
          <header className="appbar">
            <button className="arcs-btn" onClick={() => go('listen')} aria-label="Tunes, Listen Now"><Arcs size={34} /></button>
            <div className="appbar-title" />
            <div className="appbar-actions">
              {!isTab && !IS_MOBILE && <button className="round-btn" title="Open in a full tab" onClick={() => send({ type: 'open-tab' })}><Icon name="external" size={18} /></button>}
              <button className="round-btn avatar" title="Settings" onClick={() => setSettingsOpen(true)}>
                {me?.photo ? <img src={me.photo} alt="" referrerPolicy="no-referrer" /> : <Icon name="person" size={20} />}
              </button>
            </div>
          </header>

          <div className="content">
            {overlay?.kind === 'coll' ? (
              <CollectionView key={overlay.card.browseId ?? overlay.card.title} card={overlay.card} ctx={ctx} onBack={back} />
            ) : overlay?.kind === 'mood' ? (
              <MoodView chip={overlay.chip} ctx={ctx} onBack={back} />
            ) : overlay?.kind === 'artist' ? (
              <ArtistView key={overlay.id ?? overlay.name} name={overlay.name} id={overlay.id} ctx={ctx} onBack={back} />
            ) : (
              <>
                <h1 className="big-title">{titles[tab]}</h1>
                {tab === 'listen' && <ListenNow ctx={ctx} me={me} signedIn={signedIn || session === null} session={session ?? ''} onSignIn={() => setSettingsOpen(true)} onMood={onMood} goExplore={() => go('explore')} />}
                {tab === 'explore' && <ExplorePage ctx={ctx} onMood={onMood} />}
                {tab === 'library' && <LibraryPage ctx={ctx} me={me} signedIn={signedIn} session={session ?? ''} onSignIn={() => setSettingsOpen(true)} onTransfer={() => setSettingsOpen('transfer')} />}
                {tab === 'search' && <SearchPage ctx={ctx} query={query} onSearch={(q) => setQuery(q || null)} onMood={onMood} />}
              </>
            )}
          </div>
        </main>

        <aside className="side">
          {player && <NowPlaying s={player} settings={settings} onArtist={(n, id) => { setExpanded(false); onArtist(n, id); }} />}
          <button className="collapse" onClick={() => setExpanded(false)} aria-label="Close Now Playing"><Icon name="chevron" /></button>
        </aside>
      </div>

      <div className="dock">
        {player && <MiniBar s={player} onExpand={() => setExpanded(true)} />}
        <nav className="tabbar" aria-label="Main">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id && !overlay ? 'on' : ''}`} onClick={() => go(t.id)} aria-current={tab === t.id}>
              <Icon name={t.icon} size={22} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <ActionHost player={player} signedIn={signedIn} onArtist={(n, id) => { setExpanded(false); onArtist(n, id); }} onOpen={(c) => { setExpanded(false); onOpen(c); }} />
      {settingsOpen && <SettingsPage me={me} initial={settingsOpen === 'transfer' ? 'transfer' : undefined} onClose={() => { setSettingsOpen(false); account.retry(); }} />}
    </div>
  );
}
