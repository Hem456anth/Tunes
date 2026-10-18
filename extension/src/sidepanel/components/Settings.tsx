import { importBackup } from '../../lib/backup';
// Settings, laid out like Tunes's Android Settings: big title, grouped
// rounded cards, uppercase section labels, toggles on the right, sub-pages
// for Account & integrations and Sources, and the Lyrics sources sheet.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DirectSource, Settings } from '../../lib/types';
import { DEFAULT_SETTINGS } from '../../lib/types';
import { getSettings, setSettings } from '../../lib/settings';
import { CACHE_PREFIX, clearAllCache } from '../../lib/cache';
import { AUTH_COOKIE_NAMES, appleMusicSignedIn, googleAccounts, openSignIn, youtubeMusicStatus, type GoogleAccount } from '../../lib/accounts';
import type { AccountInfo } from '../../lib/innertube';
import { DEFAULT_LYRICS_ORDER, getLyricsPrefs, LYRICS_SOURCES, setLyricsPrefs, type LyricsPrefs, type LyricsSourceId } from '../../lib/lyrics';
import { TransferPage } from './Transfer';
import { lastfmFinishAuth, lastfmStartAuth } from '../../lib/lastfm';
import { DISCOVER_LANGUAGES } from '../../lib/discover';
import { Icon } from './Icon';
import { LogoMark } from './Logo';
import { IS_MOBILE } from '../../lib/platform';

// ---------- primitives ----------
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch ${on ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onChange(!on); }}>
      <span className="knob" />
    </button>
  );
}
function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>)}
    </div>
  );
}
export function Group({ label, children, foot }: { label?: string; children: ReactNode; foot?: string }) {
  return (
    <section className="s-group">
      {label && <div className="s-label">{label}</div>}
      <div className="s-card">{children}</div>
      {foot && <p className="s-foot">{foot}</p>}
    </section>
  );
}
/** Enter/Space on a focused row-like element activates it (and never reaches the global Space = play/pause). */
export const keyActivate = (fn: () => void) => (e: React.KeyboardEvent) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fn(); }
};

export function Row({ icon, title, sub, value, onClick, toggle, badge, children, disabled }: {
  icon?: string | ReactNode; title: string; sub?: string; value?: string; onClick?: () => void; toggle?: { on: boolean; set: (v: boolean) => void }; badge?: string; children?: ReactNode; disabled?: boolean;
}) {
  const click = toggle ? () => toggle.set(!toggle.on) : onClick;
  const live = click && !disabled ? click : undefined;
  return (
    <div className={`s-row ${click ? 'tap' : ''} ${disabled ? 'disabled' : ''}`} onClick={live} onKeyDown={live ? keyActivate(live) : undefined}
      role={click ? (toggle ? 'switch' : 'button') : undefined} aria-checked={toggle ? toggle.on : undefined} aria-disabled={disabled || undefined} tabIndex={live ? 0 : undefined}>
      <div className="s-row-main">
        {icon !== undefined && <span className="s-icon">{typeof icon === 'string' ? <Icon name={icon} size={22} /> : icon}</span>}
        <span className="s-text">
          <span className="s-title">{title}{badge && <span className="s-badge">{badge}</span>}</span>
          {sub && <span className="s-sub">{sub}</span>}
        </span>
        {value && <span className="s-value">{value}</span>}
        {toggle && <Toggle on={toggle.on} onChange={toggle.set} label={title} disabled={disabled} />}
        {onClick && !toggle && <Icon name="chev-right" size={20} />}
      </div>
      {children}
    </div>
  );
}
export function Page({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  return (
    <div className="s-page" ref={ref} onScroll={() => setScrolled((ref.current?.scrollTop ?? 0) > 40)}>
      <header className={`s-head ${scrolled ? 'solid' : ''}`}>
        <button className="round-btn ghost" onClick={onBack} aria-label="Back"><Icon name="back" size={22} /></button>
        <div className="s-head-title">{title}</div>
        <span style={{ width: 40 }} />
      </header>
      <h1 className="big-title">{title}</h1>
      {children}
    </div>
  );
}

// ---------- logos ----------
const YtmLogo = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#FF0033" /><circle cx="12" cy="12" r="6.6" fill="none" stroke="#fff" strokeWidth="1.2" /><path d="M10 9v6l5-3z" fill="#fff" /></svg>
);
const GoogleLogo = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#fff" />
    <path d="M17.6 12.2c0-.4 0-.8-.1-1.2H12v2.3h3.2a2.7 2.7 0 01-1.2 1.8v1.5h1.9c1.1-1 1.7-2.5 1.7-4.4z" fill="#4285F4" />
    <path d="M12 18c1.6 0 3-.5 3.9-1.4L14 15.1c-.5.4-1.2.6-2 .6-1.5 0-2.8-1-3.3-2.4H6.8v1.6A6 6 0 0012 18z" fill="#34A853" />
    <path d="M8.7 13.3a3.6 3.6 0 010-2.3V9.4H6.8a6 6 0 000 5.4l1.9-1.5z" fill="#FBBC05" />
    <path d="M12 8.4c.9 0 1.6.3 2.2.9l1.7-1.7A5.8 5.8 0 0012 6a6 6 0 00-5.2 3.4l1.9 1.6c.5-1.5 1.8-2.6 3.3-2.6z" fill="#EA4335" /></svg>
);
const AppleLogo = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#FA2D48" />
    <path d="M15.5 6.2v8.4a2 2 0 11-1.2-1.8V8.6l-4.4 1v6.1a2 2 0 11-1.2-1.8V8.6c0-.3.2-.6.5-.6l5.6-1.3c.4-.1.7.1.7.5z" fill="#fff" /></svg>
);

// ---------- hooks ----------
/** Live settings with optimistic saves: the UI moves at once, and changes made elsewhere show up here. */
function useStoreSettings() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let alive = true;
    getSettings().then((x) => alive && setS(x));
    const fn = (c: Record<string, chrome.storage.StorageChange>) => { if (c.settings) getSettings().then((x) => alive && setS(x)); };
    chrome.storage.onChanged.addListener(fn);
    return () => { alive = false; chrome.storage.onChanged.removeListener(fn); };
  }, []);
  const save = useCallback(async (patch: Partial<Settings>) => { setS((p) => ({ ...p, ...patch })); await setSettings(patch); }, []);
  return [s, save] as const;
}

// ---------- Account & integrations ----------
function AccountsPage({ onBack }: { onBack: () => void }) {
  const [s, save] = useStoreSettings();
  const [ytm, setYtm] = useState<AccountInfo | 'signed-out' | 'signed-in' | null>(null);
  const [google, setGoogle] = useState<GoogleAccount[] | null>(null);
  const [apple, setApple] = useState<boolean | null>(null);
  const [lbOpen, setLbOpen] = useState(false);
  const [fmOpen, setFmOpen] = useState(false);
  const [fmKey, setFmKey] = useState('');
  const [fmSecret, setFmSecret] = useState('');
  const [fmToken, setFmToken] = useState('');
  const [fmErr, setFmErr] = useState('');
  const fmStart = async () => {
    setFmErr('');
    try {
      const k = fmKey.trim(), sec = fmSecret.trim();
      const { token, url } = await lastfmStartAuth(k, sec);
      setFmToken(token);
      await save({ lastfmKey: k, lastfmSecret: sec });
      chrome.tabs.create({ url });
    } catch (e: any) { setFmErr(String(e?.message ?? e)); }
  };
  const fmFinish = async () => {
    setFmErr('');
    try {
      const { session, user } = await lastfmFinishAuth(s.lastfmKey, s.lastfmSecret, fmToken);
      await save({ lastfmSession: session, lastfmUser: user });
      setFmOpen(false); setFmToken('');
    } catch (e: any) { setFmErr(/14|unauthori[sz]ed/i.test(String(e?.message)) ? 'Approve Tunes on the Last.fm tab first, then tap Done.' : String(e?.message ?? e)); }
  };
  const [lbDraft, setLbDraft] = useState('');
  const load = useCallback(() => {
    youtubeMusicStatus().then(setYtm); googleAccounts().then(setGoogle); appleMusicSignedIn().then(setApple);
  }, []);
  useEffect(() => {
    load();
    const fn = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', fn); window.addEventListener('focus', fn);
    // Sign in / out in any tab and the rows update by themselves.
    let t: ReturnType<typeof setTimeout> | null = null;
    const onCookie = (c: chrome.cookies.CookieChangeInfo) => { if (AUTH_COOKIE_NAMES.has(c.cookie.name)) { if (t) clearTimeout(t); t = setTimeout(load, 800); } };
    chrome.cookies.onChanged.addListener(onCookie);
    return () => {
      document.removeEventListener('visibilitychange', fn); window.removeEventListener('focus', fn);
      chrome.cookies.onChanged.removeListener(onCookie);
      if (t) clearTimeout(t);
    };
  }, [load]);
  const info = ytm && typeof ytm === 'object' ? ytm : null;
  const signed = ytm !== null && ytm !== 'signed-out';

  return (
    <Page title="Account & integrations" onBack={onBack}>
      {IS_MOBILE ? (
        <Group label="Accounts" foot="Google doesn't allow signing in to YouTube inside apps like this one, so Tunes for Android plays and searches without an account. Your library, likes and playlists are saved on this phone.">
          <Row icon={<YtmLogo />} title="YouTube Music" badge="DEFAULT" sub="Playing without an account" />
        </Group>
      ) : (<>
      <div className="acct-hero" onClick={() => !signed && openSignIn('youtube-music')} role={signed ? undefined : 'button'} tabIndex={signed ? undefined : 0}
        onKeyDown={signed ? undefined : keyActivate(() => openSignIn('youtube-music'))}>
        <span className="acct-hero-avatar">{info?.photo ? <img src={info.photo} alt="" referrerPolicy="no-referrer" /> : <Icon name="person" size={28} />}</span>
        <span className="s-text">
          <span className="acct-hero-name">{ytm === null ? '…' : info ? info.name : signed ? 'Signed in' : 'Not signed in'}</span>
          <span className="s-sub">{info ? info.email || info.channelHandle : signed ? 'YouTube Music' : 'Tap to sign in with Google'}</span>
        </span>
        {!signed && <Icon name="chev-right" size={20} />}
      </div>

      <Group label="Accounts" foot="You sign in on Google's or Apple's own page. Tunes never sees your password; it uses the session Chrome already has.">
        <Row icon={<YtmLogo />} title="YouTube Music" badge="DEFAULT" sub={signed ? 'Personalises Listen Now, mixes and Library' : 'Not signed in'} onClick={signed ? undefined : () => openSignIn('youtube-music')} />
        {signed && <Row title="Personalise with this account" sub="Your Quick picks, mixes and recommendations" toggle={{ on: s.useAccount, set: (v) => save({ useAccount: v }) }} />}
        <Row icon={<GoogleLogo />} title="Google" sub={google === null ? 'Checking…' : google.length ? `${google.length} account${google.length > 1 ? 's' : ''} in Chrome` : 'Not signed in'} value={google?.length ? 'Add' : 'Sign in'} onClick={() => openSignIn('google')} />
        {google && google.length > 0 && google.map((g) => (
          <div key={g.index + g.email} className={`s-row tap sub-row ${s.authUser === g.index ? 'sel' : ''}`} onClick={() => save({ authUser: g.index })} role="radio" aria-checked={s.authUser === g.index}
            tabIndex={0} onKeyDown={keyActivate(() => save({ authUser: g.index }))}>
            <div className="s-row-main">
              <span className="s-icon">{g.photo ? <img className="mini-avatar" src={g.photo} alt="" referrerPolicy="no-referrer" /> : <Icon name="person" size={20} />}</span>
              <span className="s-text"><span className="s-title">{g.name || 'Google account'}</span><span className="s-sub">{g.email}</span></span>
              {s.authUser === g.index && <Icon name="check" size={20} />}
            </div>
          </div>
        ))}
        <Row icon={<AppleLogo />} title="Apple Music" sub={apple === null ? 'Checking…' : apple ? 'Linked' : 'Tap to sign in'} onClick={apple ? undefined : () => openSignIn('apple-music')} value={apple ? 'Linked' : undefined} />
      </Group>

      </>)}

      <Group label="Scrobbling" foot="Scrobble your listens to ListenBrainz and Last.fm. Last.fm uses your own free API key from last.fm/api/account/create.">
        <Row icon="last-fm" title="Last.fm" sub={s.lastfmSession ? `Scrobbling as ${s.lastfmUser}` : 'Connect with your API key'}
          toggle={{ on: !!s.lastfmSession, set: (v) => { if (v) { setFmKey(s.lastfmKey); setFmSecret(s.lastfmSecret); setFmToken(''); setFmErr(''); setFmOpen(true); } else save({ lastfmSession: '', lastfmUser: '' }); } }} />
        {fmOpen && (
          <div className="s-row">
            {!fmToken ? (
              <form className="token-form col" onSubmit={(e) => { e.preventDefault(); if (fmKey.trim() && fmSecret.trim()) fmStart(); }}>
                <input autoFocus placeholder="API key" value={fmKey} onChange={(e) => setFmKey(e.target.value)} />
                <input type="password" placeholder="Shared secret" value={fmSecret} onChange={(e) => setFmSecret(e.target.value)} />
                <button className="pill white sm" type="submit">Connect</button>
              </form>
            ) : (
              <div className="token-form col">
                <span className="s-sub">Approve Tunes on the Last.fm tab that just opened, then come back.</span>
                <button className="pill white sm" onClick={fmFinish}>Done</button>
              </div>
            )}
            {fmErr && <p className="s-err">{fmErr}</p>}
          </div>
        )}
        <Row icon="cloud" title="ListenBrainz" sub={s.listenbrainzToken ? 'Scrobbling every song you play' : 'Enter a token to enable'}
          toggle={{ on: !!s.listenbrainzToken, set: (v) => { if (v) { setLbDraft(''); setLbOpen(true); } else save({ listenbrainzToken: '' }); } }} />
        {lbOpen && (
          <div className="s-row">
            <form className="token-form" onSubmit={(e) => { e.preventDefault(); if (lbDraft.trim()) { save({ listenbrainzToken: lbDraft.trim() }); setLbOpen(false); } }}>
              <input autoFocus type="password" placeholder="User token from listenbrainz.org/settings" value={lbDraft} onChange={(e) => setLbDraft(e.target.value)} />
              <button className="pill white sm" type="submit">Save</button>
            </form>
          </div>
        )}
      </Group>
    </Page>
  );
}

// ---------- Sources ----------
function SourcesPage({ onBack }: { onBack: () => void }) {
  const [s, save] = useStoreSettings();
  const [drag, setDrag] = useState<number | null>(null);
  const info: Record<DirectSource, { icon: string; title: string; sub: string }> = {
    jiosaavn: { icon: 'waves', title: 'JioSaavn', sub: 'High Quality · 320kbps' },
    youtube: { icon: 'play', title: 'YouTube Music', sub: 'Lossy · Full catalogue · Radio' },
  };
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...s.sources];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    save({ sources: next });
  };
  return (
    <Page title="Sources" onBack={onBack}>
      <Group label="Sources, tried in this order" foot="If a source does not have a track or cannot be reached, Tunes tries the next one. Sources above YouTube can replace its recording when they return a better version.">
        {s.sources.map((id, i) => (
          <div key={id} className={`s-row src-row ${drag === i ? 'dragging' : ''}`} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => { e.preventDefault(); if (drag !== null && drag !== i) { move(drag, i); setDrag(i); } }} onDragEnd={() => setDrag(null)}
            tabIndex={0} aria-label={`${info[id].title}, position ${i + 1}. Alt plus arrow keys to reorder.`}
            onKeyDown={(e) => { if (e.target === e.currentTarget && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); const j = i + (e.key === 'ArrowUp' ? -1 : 1); if (j >= 0 && j < s.sources.length) move(i, j); } }}>
            <div className="s-row-main">
              <span className="src-num">{i + 1}</span>
              <span className="s-icon"><Icon name={info[id].icon} size={22} /></span>
              <span className="s-text"><span className="s-title">{info[id].title}</span><span className="s-sub">{info[id].sub}</span></span>
              {id === 'youtube' ? <span className="s-value">Always on</span> : <Toggle on={s.jiosaavn} onChange={(v) => save({ jiosaavn: v })} label="JioSaavn" />}
              <span className="drag-handle" title="Drag to reorder"><Icon name="drag" size={20} /></span>
            </div>
          </div>
        ))}
        <div className="s-row">
          <div className="s-row-main">
            <span className="src-num">{s.sources.length + 1}</span>
            <span className="s-icon"><Icon name="play" size={20} /></span>
            <span className="s-text"><span className="s-title">YouTube player</span><span className="s-sub">Last resort · plays inside Tunes, never in a tab. YouTube may show its ads here (none with YouTube Premium)</span></span>
            <Toggle on={!s.adFreeOnly} onChange={(v) => save({ adFreeOnly: !v })} label="YouTube player" />
          </div>
        </div>
      </Group>
    </Page>
  );
}

// ---------- Lyrics sources sheet ----------
function LyricsSourcesSheet({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState<LyricsPrefs | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => { getLyricsPrefs().then(setP); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const update = (next: LyricsPrefs) => { setP(next); setLyricsPrefs(next); };
  if (!p) return null;
  const move = (from: number, to: number) => {
    const order = [...p.order];
    const [x] = order.splice(from, 1);
    order.splice(to, 0, x);
    update({ ...p, order });
  };
  const toggle = (id: LyricsSourceId) => update({ ...p, enabled: p.enabled.includes(id) ? p.enabled.filter((x) => x !== id) : [...p.enabled, id] });
  return (
    <div className="dialog-wrap" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Lyrics sources">
        <h2>Lyrics sources</h2>
        <p className="dialog-sub">Sources are tried in this order. Drag to reorder them. The first source with lyrics wins unless syllable lyrics are prioritized.</p>
        <div className="dialog-list">
          {p.order.map((id, i) => {
            const meta = LYRICS_SOURCES.find((x) => x.id === id)!;
            const on = p.enabled.includes(id);
            return (
              <div key={id} className={`ly-src ${drag === i ? 'dragging' : ''} ${on ? '' : 'off'}`} draggable onDragStart={() => setDrag(i)}
                onDragOver={(e) => { e.preventDefault(); if (drag !== null && drag !== i) { move(drag, i); setDrag(i); } }} onDragEnd={() => setDrag(null)} onClick={() => toggle(id)}
                role="checkbox" aria-checked={on} tabIndex={0}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); const j = i + (e.key === 'ArrowUp' ? -1 : 1); if (j >= 0 && j < p.order.length) move(i, j); return; }
                  keyActivate(() => toggle(id))(e);
                }}>
                <span className="drag-handle"><Icon name="drag" size={18} /></span>
                <span className="s-text"><span className="s-title">{meta.label}</span><span className="s-sub">{meta.hint}</span></span>
                <span className="ly-check">{on && <Icon name="check" size={20} />}</span>
              </div>
            );
          })}
          <div className="ly-src" onClick={() => update({ ...p, preferSyllable: !p.preferSyllable })}>
            <span className="s-text"><span className="s-title">Prioritize syllable lyrics</span><span className="s-sub">Keep searching past a line-synced match for word-by-word lyrics</span></span>
            <Toggle on={p.preferSyllable} onChange={(v) => update({ ...p, preferSyllable: v })} label="Prioritize syllable lyrics" />
          </div>
        </div>
        <button className="dialog-btn" onClick={() => update({ order: [...DEFAULT_LYRICS_ORDER], enabled: [...DEFAULT_LYRICS_ORDER], preferSyllable: true })}>Reset to default</button>
        <button className="dialog-btn strong" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

// ---------- main Settings ----------

export function SettingsPage({ me, onClose, initial }: { me: AccountInfo | null; onClose: () => void; initial?: 'transfer' }) {
  const [s, save] = useStoreSettings();
  const [page, setPage] = useState<'main' | 'accounts' | 'sources' | 'transfer'>(initial ?? 'main');
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsSummary, setLyricsSummary] = useState('');
  const [toast, setToast] = useState('');
  useEffect(() => {
    getLyricsPrefs().then((p) => setLyricsSummary(p.order.filter((x) => p.enabled.includes(x)).map((x) => LYRICS_SOURCES.find((y) => y.id === x)!.label).join(', ') || 'Off'));
  }, [lyricsOpen]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || lyricsOpen) return; // the dialog closes first
      // Opened straight into Transfer: Escape closes Settings, like Back does.
      page === 'main' || (page === 'transfer' && initial === 'transfer') ? onClose() : setPage('main');
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [page, onClose, lyricsOpen, initial]);
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2200); };

  const clearCache = async () => {
    await clearAllCache();
    flash('Cache cleared');
  };
  const exportData = async () => {
    const all = await chrome.storage.local.get(null);
    const data = Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith(CACHE_PREFIX) && !k.startsWith('c:') && k !== 'c2-index' && k !== 'visitorData'));
    if (data.settings) Object.assign(data.settings as Settings, { listenbrainzToken: '', lastfmSecret: '', lastfmSession: '' });
    const blob = new Blob([JSON.stringify({ app: 'Tunes', exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `tunes-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const importData = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const r = await importBackup(await f.text());
        const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
        flash(`Imported ${n(r.songs, 'song')}, ${n(r.playlists, 'playlist')}, ${n(r.liked, 'favorite')}`);
      } catch (e) { flash((e as Error).message); }
    };
    input.click();
  };
  const quality = { high: 'High', normal: 'Normal', low: 'Data saver' } as const;
  const srcSummary = [...s.sources.filter((x) => x === 'youtube' || s.jiosaavn).map((x) => (x === 'jiosaavn' ? 'JioSaavn' : 'YouTube Music')), ...(s.adFreeOnly ? [] : ['YouTube player'])].join(' → ');

  return (
    <div className="settings-layer">
      {page === 'transfer' ? <TransferPage onBack={() => (initial ? onClose() : setPage('main'))} /> : page === 'accounts' ? <AccountsPage onBack={() => setPage('main')} /> : page === 'sources' ? <SourcesPage onBack={() => setPage('main')} /> : (
        <Page title="Settings" onBack={onClose}>
          <Group>
            <Row icon="person" title="Account & integrations" sub={IS_MOBILE ? 'Scrobbling with Last.fm and ListenBrainz' : me ? `${me.name}${me.email ? ' · ' + me.email : ''}` : 'Not signed in'} onClick={() => setPage('accounts')} />
          </Group>

          <Group label="Audio quality">
            <Row icon="puzzle" title="Sources" sub={`Where audio comes from and the order used · ${srcSummary}`} onClick={() => setPage('sources')} />
            <Row icon="wifi" title="Streaming quality" sub={s.quality === 'high' ? 'JioSaavn 320 kbps · best YouTube stream' : s.quality === 'normal' ? 'About 160 kbps' : 'About 96 kbps, saves data'} value={quality[s.quality]}>
              <Segmented value={s.quality} options={[{ id: 'low', label: 'Data saver' }, { id: 'normal', label: 'Normal' }, { id: 'high', label: 'High' }]} onChange={(v) => save({ quality: v })} />
            </Row>
          </Group>

          <Group label="New releases languages" foot="Explore shows new songs in these languages, newest first.">
            <div className="disc-chips s-chips">
              {DISCOVER_LANGUAGES.map((l) => {
                const on = (s.discoverLangs ?? []).includes(l.id);
                return (
                  <button key={l.id} className={`disc-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => {
                    const cur = s.discoverLangs ?? [];
                    const next = on ? cur.filter((x) => x !== l.id) : [...cur, l.id];
                    if (next.length) save({ discoverLangs: next });
                  }}>{on && <Icon name="check" size={14} />}{l.label}</button>
                );
              })}
            </div>
          </Group>

          <Group label="Playback">
            <Row icon="radio" title="Autoplay radio" sub="Keeps playing similar songs when your queue ends" toggle={{ on: s.autoRadio, set: (v) => save({ autoRadio: v }) }} />
            <Row icon="waves" title="Crossfade" sub={s.crossfade ? `Songs blend for ${s.crossfade} seconds` : 'Off: songs change with a short fade'} value={s.crossfade ? `${s.crossfade}s` : 'Off'}>
              <input className="s-slider" type="range" min={0} max={12} step={1} value={s.crossfade} style={{ ['--p' as string]: `${(s.crossfade / 12) * 100}%` }} onChange={(e) => save({ crossfade: Number(e.target.value) })} aria-label="Crossfade seconds" />
            </Row>
            <Row icon="volume-off" title="Hide volume bar" sub="Removes the volume slider from the player" toggle={{ on: s.hideVolume, set: (v) => save({ hideVolume: v }) }} />
          </Group>

          <Group label="Appearance">
            <Row icon="theme" title="Theme">
              <Segmented value={s.theme} options={[{ id: 'system', label: 'System' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} onChange={(v) => save({ theme: v })} />
            </Row>
            <Row icon="motion" title="Reduce animation" sub="Freezes the player's gradient instead of drifting" toggle={{ on: s.reduceMotion, set: (v) => save({ reduceMotion: v }) }} />
            <Row icon="blur" title="Reduce dynamic blur" sub="Swaps frosted glass for solid fills across the app" toggle={{ on: s.reduceBlur, set: (v) => save({ reduceBlur: v }) }} />
            <Row icon="lyrics" title="Synced lyrics" sub="Lights up the words on the player as they're sung" toggle={{ on: s.syncedLyrics, set: (v) => save({ syncedLyrics: v }) }} />
            <Row icon="sparkle" title="Blur unfocused lyrics" sub="Keeps the spotlight on the current line" toggle={{ on: s.blurLyrics, set: (v) => save({ blurLyrics: v }) }} />
            <Row icon="globe" title="Lyrics sources" sub={lyricsSummary} onClick={() => setLyricsOpen(true)} />
          </Group>

          <Group label="Your data">
            {!IS_MOBILE && <Row icon="swap" title="Transfer music" sub="Bring playlists and liked songs from Spotify or Apple Music" onClick={() => setPage('transfer')} />}
            <Row icon="trash" title="Clear cache" sub="Frees space used by saved Home, search and artwork data" onClick={clearCache} />
            {!IS_MOBILE && <Row icon="upload" title="Export data" sub="Settings, likes and listening history, as one JSON file" onClick={exportData} />}
            {!IS_MOBILE && <Row icon="download" title="Import data" sub="Restore a Tunes export. Merges with what you have; nothing is deleted" onClick={importData} />}
          </Group>

          <Group label="Advanced options">
            <Row icon="waves" title="Show stats for nerds" sub="Source, codec and bitrate on the player" toggle={{ on: s.showStats, set: (v) => save({ showStats: v }) }} />
            <Row icon="history" title="Lyrics debug logs" sub="Show which lyrics providers answered, and how fast" toggle={{ on: s.lyricsDebug, set: (v) => save({ lyricsDebug: v }) }} />
          </Group>

          <div className="about">
            <LogoMark size={44} />
            <div><b>Tunes</b><br /><span className="s-sub">v{chrome.runtime.getManifest().version} · GPL-3.0 · adapts code from the BitChord project</span></div>
          </div>
        </Page>
      )}
      {lyricsOpen && <LyricsSourcesSheet onClose={() => setLyricsOpen(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
