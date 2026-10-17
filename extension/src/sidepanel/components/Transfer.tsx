// Settings → Transfer music: bring playlists and liked songs over from
// Spotify and Apple Music (or any CSV export), matched to YouTube Music.
import { useEffect, useRef, useState } from 'react';
import { Group, keyActivate, Page, Row } from './Settings';
import { Icon } from './Icon';
import { NeedsSignIn, SERVICES, openLogin, parseCsv, spotifyLink, type ServiceId, type SourceList, type SourceTrack } from '../../lib/transfer/sources';
import { runImport, type Progress } from '../../lib/transfer/index';
import { sessionId } from '../../lib/accounts';

const SpotifyLogo = () => (
  <svg viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="12" fill="#1ed760" /><path d="M6.5 9.3c3.7-1.1 8.1-.8 11.2 1.1M7.1 12.4c3-.9 6.6-.6 9.2 1M7.7 15.3c2.4-.6 5-.4 7.1.8" stroke="#000" strokeWidth="1.6" fill="none" strokeLinecap="round" /></svg>
);
const AppleLogo = () => (
  <svg viewBox="0 0 24 24" width="26" height="26"><rect width="24" height="24" rx="6" fill="#fa2d48" /><path d="M15.5 6.5v8.2a2 2 0 1 1-1.2-1.8V9.1l-4.6 1v5.6a2 2 0 1 1-1.2-1.8V8.1z" fill="#fff" /></svg>
);

type Job = { title: string; source: string; image?: string; asLiked: boolean; load: () => Promise<SourceTrack[]> };
type Result = { title: string; total: number; matched: number; missed: SourceTrack[]; ytm?: string; ytmError?: string; error?: string };

export function TransferPage({ onBack }: { onBack: () => void }) {
  const [toYouTube, setToYouTube] = useState(false);
  const [signedYt, setSignedYt] = useState(false);
  const [service, setService] = useState<ServiceId | null>(null);
  const [lists, setLists] = useState<SourceList[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<{ msg: string; login?: ServiceId } | null>(null);
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState('');
  const [running, setRunning] = useState<{ label: string; p: Progress | null; i: number; n: number } | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [openMissed, setOpenMissed] = useState<number | null>(null);
  const cancel = useRef({ cancelled: false });
  const file = useRef<HTMLInputElement>(null);
  const seq = useRef(0); // the latest service the user picked; older answers are dropped
  // Leaving the page (Escape, closing Settings) stops a running transfer.
  useEffect(() => () => { cancel.current.cancelled = true; seq.current++; }, []);

  useEffect(() => { sessionId().then((s) => { const on = s !== 'out'; setSignedYt(on); setToYouTube(on); }); }, []);

  const fail = (e: unknown) => {
    if (e instanceof NeedsSignIn) setErr({ msg: e.message, login: e.service });
    else setErr({ msg: String((e as Error)?.message ?? e), login: undefined });
  };

  const connect = async (s: ServiceId) => {
    const my = ++seq.current;
    setService(s); setLists(null); setErr(null); setPicked(new Set()); setLoading(true);
    try { const l = await SERVICES[s].lists(); if (my !== seq.current) return; setLists(l); setPicked(new Set(l.filter((x) => x.kind === 'liked').map((x) => x.id))); }
    catch (e) { if (my === seq.current) fail(e); }
    finally { if (my === seq.current) setLoading(false); }
  };

  const run = async (jobs: Job[]) => {
    cancel.current = { cancelled: false };
    const out: Result[] = [];
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      setRunning({ label: j.title, p: { done: 0, total: 0, matched: 0, phase: 'reading' }, i, n: jobs.length });
      try {
        const tracks = await j.load();
        const r = await runImport({ title: j.title, source: j.source, image: j.image, tracks, asLiked: j.asLiked, toYouTube, signal: cancel.current,
          onProgress: (p) => setRunning({ label: j.title, p, i, n: jobs.length }) });
        out.push({ title: j.title, total: tracks.length, matched: r.matched.length, missed: r.missed, ytm: r.ytm, ytmError: r.ytmError });
      } catch (e: any) {
        out.push({ title: j.title, total: 0, matched: 0, missed: [], error: String(e?.message ?? e) });
        if (cancel.current.cancelled) break;
      }
    }
    setRunning(null); setResults(out); setService(null); setLists(null);
  };

  const startService = () => {
    if (!service || !lists) return;
    const name = SERVICES[service].name;
    run(lists.filter((l) => picked.has(l.id)).map((l) => ({
      title: l.kind === 'liked' ? `${name} ${l.title}` : l.title, source: name, image: l.image, asLiked: l.kind === 'liked',
      load: () => SERVICES[service].tracks(l.id),
    })));
  };
  const startLink = () => {
    const url = link.trim();
    if (!url) return;
    if (!/open\.spotify\.com\/(intl-[a-z]+\/)?(playlist|album)\//.test(url)) { setErr({ msg: 'That isn’t a Spotify playlist or album link' }); return; }
    setErr(null);
    const job: Job = { title: 'Spotify link', source: 'Spotify', asLiked: false, load: async () => { const r = await spotifyLink(url); job.title = r.title; job.image = r.image; return r.tracks; } };
    setLink(''); run([job]);
  };
  const startCsv = async (f: File) => {
    const title = f.name.replace(/\.(csv|txt)$/i, '');
    try {
      const tracks = parseCsv(await f.text());
      run([{ title, source: 'CSV', asLiked: false, load: async () => tracks }]);
    } catch (e) { fail(e); }
  };

  // ---------- running ----------
  if (running) {
    const p = running.p;
    const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
    return (
      <Page title="Transfer music" onBack={() => { cancel.current.cancelled = true; }}>
        <Group label={running.n > 1 ? `Playlist ${running.i + 1} of ${running.n}` : undefined}>
          <div className="s-row">
            <div className="xfer-now"><b>{running.label}</b>
              <span className="s-sub">{!p || p.phase === 'reading' ? 'Reading your list…' : p.phase === 'matching' ? `Finding songs · ${p.done} of ${p.total} · ${p.matched} found` : p.phase === 'saving' ? (p.note ? `${p.note} · ${p.done} of ${p.total}` : 'Saving…') : 'Done'}</span>
            </div>
            <div className="xfer-bar"><span style={{ width: `${p?.phase === 'reading' ? 4 : pct}%` }} /></div>
          </div>
        </Group>
        <p className="s-foot">Keep Tunes open while it works. Big libraries take a few minutes.</p>
        <div className="xfer-actions"><button className="pill ghost" onClick={() => { cancel.current.cancelled = true; }}>Cancel</button></div>
      </Page>
    );
  }

  // ---------- picking lists ----------
  if (service) {
    const name = SERVICES[service].name;
    const count = lists?.filter((l) => picked.has(l.id)).reduce((a, l) => a + (l.count ?? 0), 0) ?? 0;
    return (
      <Page title={name} onBack={() => { seq.current++; setService(null); setErr(null); setLoading(false); }}>
        {loading && <Group><Row icon="cloud" title={`Connecting to ${name}…`} sub="Using the session already signed in in Chrome" /></Group>}
        {err && (
          <Group>
            <Row icon="info" title={err.msg} sub={err.login ? 'Sign in on the page that opens, then come back and tap Retry.' : undefined} />
            <div className="xfer-actions in">
              {err.login && <button className="pill white sm" onClick={() => openLogin(err.login!)}>Sign in to {name}</button>}
              <button className="pill ghost sm" onClick={() => connect(service)}>Retry</button>
            </div>
          </Group>
        )}
        {lists && (
          <>
            <Group label="Choose what to bring over" foot={`Liked songs go into Tunes's Liked songs${toYouTube ? ' and get a like on YouTube Music' : ''}. Each playlist becomes its own playlist.`}>
              <div className="s-row tap" role="button" tabIndex={0} onClick={() => setPicked(picked.size === lists.length ? new Set() : new Set(lists.map((l) => l.id)))}
                onKeyDown={keyActivate(() => setPicked(picked.size === lists.length ? new Set() : new Set(lists.map((l) => l.id))))}>
                <div className="s-row-main"><span className="s-text"><span className="s-title">{picked.size === lists.length ? 'Unselect all' : 'Select all'}</span></span></div>
              </div>
              {lists.map((l) => (
                <div key={l.id} className="s-row tap" role="checkbox" aria-checked={picked.has(l.id)} tabIndex={0}
                  onClick={() => { const n = new Set(picked); n.has(l.id) ? n.delete(l.id) : n.add(l.id); setPicked(n); }}
                  onKeyDown={keyActivate(() => { const n = new Set(picked); n.has(l.id) ? n.delete(l.id) : n.add(l.id); setPicked(n); })}>
                  <div className="s-row-main">
                    <span className="xfer-art">{l.image ? <img src={l.image} alt="" referrerPolicy="no-referrer" /> : <Icon name={l.kind === 'liked' ? 'heart' : 'queue'} size={18} />}</span>
                    <span className="s-text"><span className="s-title">{l.title}</span>{l.count != null && <span className="s-sub">{l.count} songs</span>}</span>
                    <span className={`xfer-check ${picked.has(l.id) ? 'on' : ''}`}>{picked.has(l.id) && <Icon name="check" size={16} />}</span>
                  </div>
                </div>
              ))}
            </Group>
            <div className="xfer-actions"><button className="pill white" disabled={!picked.size} onClick={startService}>Transfer {picked.size} {picked.size === 1 ? 'list' : 'lists'}{count ? ` · ${count} songs` : ''}</button></div>
          </>
        )}
      </Page>
    );
  }

  // ---------- home ----------
  return (
    <Page title="Transfer music" onBack={onBack}>
      {results && (
        <Group label="Last transfer">
          {results.map((r, i) => (
            <div key={i}>
              <Row icon={r.error ? 'info' : 'check'} title={r.title}
                sub={r.error ? r.error : `${r.matched} of ${r.total} songs found${r.ytm ? ' · saved to YouTube Music' : ''}${r.ytmError ? ` · YouTube Music: ${r.ytmError}` : ''}`}
                value={r.missed.length ? `${r.missed.length} missing` : undefined}
                onClick={r.missed.length ? () => setOpenMissed(openMissed === i ? null : i) : undefined} />
              {openMissed === i && (
                <div className="xfer-missed">{r.missed.map((m, k) => <div key={k}><b>{m.title}</b> · {m.artist}</div>)}</div>
              )}
            </div>
          ))}
        </Group>
      )}
      <Group label="Move from" foot="Tunes uses the account already signed in in Chrome. If you're not signed in, it opens the sign-in page.">
        <Row icon={<SpotifyLogo />} title="Spotify" sub="Liked Songs and your playlists" onClick={() => connect('spotify')} />
        <Row icon={<AppleLogo />} title="Apple Music" sub="Library songs and your playlists" onClick={() => connect('apple')} />
      </Group>
      <Group label="Or bring one playlist">
        <div className="s-row">
          <form className="token-form" onSubmit={(e) => { e.preventDefault(); startLink(); }}>
            <input placeholder="Paste a Spotify playlist or album link" value={link} onChange={(e) => setLink(e.target.value)} />
            <button className="pill white sm" type="submit" disabled={!link.trim()}>Import</button>
          </form>
        </div>
        <Row icon="upload" title="Import a CSV file" sub="From Exportify, TuneMyMusic, Soundiiz and similar" onClick={() => file.current?.click()} />
        <input ref={file} type="file" accept=".csv,text/csv,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) startCsv(f); e.target.value = ''; }} />
      </Group>
      {err && !service && <Group><Row icon="info" title={err.msg} /></Group>}
      <Group label="Where it goes" foot="Everything is saved in Tunes's Library. Copying to YouTube Music also makes private playlists and likes there, so they show on your phone too.">
        <Row icon="cloud" title="Also save to my YouTube Music" sub={signedYt ? 'Private playlists and likes in your account' : 'Sign in to YouTube Music in Chrome to use this'}
          toggle={{ on: toYouTube && signedYt, set: (v) => setToYouTube(v) }} disabled={!signedYt} />
      </Group>
    </Page>
  );
}
