// "Continue on phone": a QR code (and a link to copy) for the song at this second.
import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { handoffUrl } from '../../lib/handoff';
import type { Track } from '../../lib/types';

export function HandoffPanel({ t, position }: { t: Track; position: number }) {
  const url = handoffUrl(t, position);
  const [copied, setCopied] = useState(false);
  const svg = useMemo(() => {
    if (!url) return '';
    const q = qrcode(0, 'M');
    q.addData(url); q.make();
    return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  }, [url]);
  if (!url) return <p className="handoff-note">This song isn’t from YouTube Music, so it can’t be continued on another device.</p>;
  return (
    <div className="handoff">
      {/* qrcode-generator builds the SVG from the link only; no user HTML reaches it. */}
      <div className="handoff-qr" aria-label="QR code for this song" role="img" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="handoff-note">Scan with your phone’s camera. Tunes for Android (or YouTube Music) opens this song at {fmt(position)}.</p>
      <div className="handoff-row">
        <input className="handoff-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Link to continue this song" />
        <button className="pill sm" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <p className="handoff-note sub">From your phone: share a song from Tunes’ player and paste the link into search here to continue at the same spot.</p>
    </div>
  );
}
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
