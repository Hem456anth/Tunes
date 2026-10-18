// First-run welcome: three short steps, skippable, never shown again.
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { LogoMark } from './Logo';
import { IS_MOBILE } from '../../lib/platform';

const STEPS = [
  { icon: 'logo', title: 'Welcome to Tunes', text: 'Music from YouTube Music, with JioSaavn’s 320 kbps streams when there’s a match. It keeps playing when you close this panel.' },
  { icon: 'person', title: 'Make it yours', text: 'Sign in to YouTube Music for your mixes and playlists, or just start listening. Likes and playlists you make here are kept on this computer.' },
  { icon: 'mic', title: 'More than music', text: 'Podcasts live in Library. Lyrics can be romanized or translated. Bring playlists over from Spotify or Apple Music.' },
];

export function Onboarding({ onSignIn, onTransfer }: { onSignIn: () => void; onTransfer: () => void }) {
  const [show, setShow] = useState(false);
  const [i, setI] = useState(0);
  useEffect(() => {
    // Raw storage, not the defaults: someone who has used Tunes before never sees this.
    chrome.storage.local.get('settings').then(({ settings }) => setShow(!(settings as { onboarded?: boolean } | undefined)?.onboarded));
  }, []);
  if (!show) return null;
  const done = async () => {
    setShow(false);
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(settings as object ?? {}), onboarded: true } });
  };
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <div className="onboard-wrap" role="dialog" aria-modal="true" aria-labelledby="onboard-title"
      onKeyDown={(e) => { if (e.key === 'Escape') void done(); if (e.key === 'ArrowRight' && !last) setI(i + 1); if (e.key === 'ArrowLeft' && i) setI(i - 1); }}>
      <div className="onboard">
        <button className="onboard-skip" onClick={done}>Skip</button>
        <div className="onboard-icon">{s.icon === 'logo' ? <LogoMark size={64} /> : <Icon name={s.icon} size={44} />}</div>
        <h2 id="onboard-title">{s.title}</h2>
        <p>{s.text}</p>
        {i === 1 && !IS_MOBILE && <button className="pill ghost" onClick={() => { void done(); onSignIn(); }}>Sign in to YouTube Music</button>}
        {i === 2 && !IS_MOBILE && <button className="pill ghost" onClick={() => { void done(); onTransfer(); }}>Transfer my playlists</button>}
        <div className="onboard-dots" aria-hidden>{STEPS.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
        <button className="pill white onboard-next" autoFocus onClick={() => (last ? done() : setI(i + 1))}>{last ? 'Start listening' : 'Next'}</button>
      </div>
    </div>
  );
}
