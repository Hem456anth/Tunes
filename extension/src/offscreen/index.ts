// Offscreen document = Tunes's "PlaybackService" for Chrome. MV3 service
// workers can't play audio, so the <audio> elements live here and survive the
// side panel being closed.
//
// v0.6: every song gets its own <audio> element ("slot"), so two can overlap
// for crossfade, and each slot is routed through one shared Web Audio graph:
//   element -> slot gain (fades/volume) -> 10-band equalizer -> speakers
// Streams are fetched with crossOrigin=anonymous (a DNR rule adds the CORS
// header for the extension). If that fails, or the AudioContext can't run,
// the slot plays as a plain element and only the equalizer is skipped.
import { EQ_BANDS } from '../lib/types';
const SW_URL = chrome.runtime.getURL('background.js');
let newestLoad = -1;
import { embedActive, embedCommand, embedLoad, embedStop, embedToken } from './embed';

interface Slot { el: HTMLAudioElement; token: number; gain: GainNode | null; src: MediaElementAudioSourceNode | null; ramp: ReturnType<typeof setInterval> | null; vol: number; metaReady: boolean; plainRetry: boolean }

let active: Slot | null = null;
let target = 1; // user volume 0..1
let lastSent = 0;
let eqOn = false;
let eqGains: number[] = EQ_BANDS.map(() => 0);

// ---------- Web Audio graph ----------
let ctx: AudioContext | null = null;
let eqIn: AudioNode | null = null;
let filters: BiquadFilterNode[] = [];
function graph(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: 'playback' });
      filters = EQ_BANDS.map((f, i) => {
        const b = ctx!.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f; b.Q.value = 1.1;
        return b;
      });
      // Pre-gain keeps big boosts from clipping.
      const pre = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -1; comp.knee.value = 0; comp.ratio.value = 20; comp.attack.value = 0.003; comp.release.value = 0.1;
      pre.connect(filters[0]);
      for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
      filters[filters.length - 1].connect(comp).connect(ctx.destination);
      eqIn = pre;
      applyEq();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}
function applyEq() {
  if (!ctx) return;
  const g = eqOn ? eqGains : eqGains.map(() => 0);
  filters.forEach((f, i) => f.gain.setTargetAtTime(g[i] ?? 0, ctx!.currentTime, 0.05));
  const peak = Math.max(0, ...g);
  (eqIn as GainNode).gain.setTargetAtTime(Math.pow(10, -peak / 20), ctx.currentTime, 0.05);
}

// ---------- slots ----------
const emit = (s: Slot, kind: string, extra: Record<string, unknown> = {}) => {
  const a = s.el;
  chrome.runtime.sendMessage({ type: 'audio-event', kind, token: s.token, position: a.currentTime || 0, duration: isFinite(a.duration) ? a.duration : 0, playing: !a.paused && !a.ended, volume: Math.round(target * 100), ...extra }).catch(() => {});
};
function setVol(s: Slot, v: number) {
  s.vol = Math.min(1, Math.max(0, v));
  if (s.gain) { s.gain.gain.value = s.vol; s.el.volume = 1; } else s.el.volume = s.vol;
}
function fade(s: Slot, to: number, ms: number): Promise<void> {
  if (s.ramp) clearInterval(s.ramp);
  return new Promise((done) => {
    const from = s.vol, steps = Math.max(1, Math.round(ms / 25));
    let i = 0;
    s.ramp = setInterval(() => {
      i++;
      // equal-power curve sounds even during long crossfades
      const p = i / steps, k = to > from ? Math.sin((p * Math.PI) / 2) : Math.cos(((1 - p) * Math.PI) / 2);
      setVol(s, from + (to - from) * k);
      if (i >= steps) { clearInterval(s.ramp!); s.ramp = null; done(); }
    }, 25);
  });
}
function kill(s: Slot) {
  if (s.ramp) { clearInterval(s.ramp); s.ramp = null; }
  s.token = -1;
  s.el.pause(); s.el.removeAttribute('src'); s.el.load();
  try { s.src?.disconnect(); s.gain?.disconnect(); } catch { /* ignore */ }
}

function makeSlot(token: number, useGraph: boolean): Slot {
  const el = new Audio();
  el.preload = 'auto';
  const s: Slot = { el, token, gain: null, src: null, ramp: null, vol: 0, metaReady: false, plainRetry: false };
  const c = useGraph && eqIn ? graph() : null;
  if (c && c.state === 'running') {
    el.crossOrigin = 'anonymous';
    s.src = c.createMediaElementSource(el);
    s.gain = c.createGain();
    s.src.connect(s.gain).connect(eqIn!);
  }
  setVol(s, 0);
  el.addEventListener('timeupdate', () => { if (s !== active) return; const n = performance.now(); if (n - lastSent > 400) { lastSent = n; emit(s, 'time'); } });
  el.addEventListener('loadedmetadata', () => { s.metaReady = true; });
  el.addEventListener('playing', () => emit(s, 'playing'));
  el.addEventListener('pause', () => s === active && emit(s, 'pause'));
  el.addEventListener('ended', () => s === active && emit(s, 'ended'));
  el.addEventListener('durationchange', () => s === active && emit(s, 'time'));
  return s;
}

function setMeta(meta?: { title: string; artist: string; album?: string; artwork?: string }) {
  if (!meta || !('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: meta.title, artist: meta.artist, album: meta.album ?? '',
    artwork: meta.artwork ? [{ src: meta.artwork, sizes: '544x544', type: 'image/jpeg' }] : [],
  });
}
try {
  const ms = navigator.mediaSession;
  const tok = () => (embedActive() ? embedToken() : active?.token ?? -1);
  ms.setActionHandler('play', () => (embedActive() ? embedCommand('play', {}) : active?.el.play()));
  ms.setActionHandler('pause', () => (embedActive() ? embedCommand('pause', {}) : active?.el.pause()));
  ms.setActionHandler('nexttrack', () => chrome.runtime.sendMessage({ type: 'audio-event', kind: 'media-next', token: tok() }));
  ms.setActionHandler('previoustrack', () => chrome.runtime.sendMessage({ type: 'audio-event', kind: 'media-prev', token: tok() }));
  ms.setActionHandler('seekto', (d) => { if (d.seekTime == null) return; if (embedActive()) embedCommand('seek', { seconds: d.seekTime }); else if (active) active.el.currentTime = d.seekTime; });
} catch { /* ignore */ }

interface LoadMsg { url: string; token: number; volume?: number; startAt?: number; fade?: number; meta?: { title: string; artist: string; album?: string; artwork?: string } }

let loadSeq = 0;
async function load(msg: LoadMsg, plain = false) {
  const seq = ++loadSeq;
  target = (msg.volume ?? 100) / 100;
  const xfade = Math.max(0, msg.fade ?? 0);
  // Build the graph on first use; a context that can't run means plain playback.
  if (!plain) {
    const c = graph();
    if (c && c.state !== 'running') await Promise.race([c.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
    if (seq !== loadSeq) return; // a newer load arrived meanwhile
  }
  const prev = active;
  const s = makeSlot(msg.token, !plain);
  s.plainRetry = plain;
  active = s;
  if (prev && prev !== s) {
    if (xfade > 0 && !prev.el.paused) { const p = prev; p.token = -1; fade(p, 0, xfade * 1000).then(() => kill(p)); }
    else if (!prev.el.paused && prev.vol > 0.05) { const p = prev; p.token = -1; fade(p, 0, 120).then(() => kill(p)); }
    else kill(prev);
  }
  s.el.addEventListener('error', () => {
    if (s.token !== msg.token || !s.el.getAttribute('src')) return;
    // A CORS refusal looks like a load error before any metadata: replay the
    // same stream as a plain element (no equalizer) before calling it failed.
    if (s.gain && !s.metaReady && !s.plainRetry) { kill(s); void load({ ...msg, startAt: msg.startAt, fade: 0 }, true); return; }
    emit(s, 'error', { message: s.el.error?.message || `media error ${s.el.error?.code}`, code: s.el.error?.code });
  });
  s.el.src = msg.url;
  if ((msg.startAt ?? 0) > 1) s.el.addEventListener('loadedmetadata', () => { try { s.el.currentTime = msg.startAt!; } catch { /* ignore */ } }, { once: true });
  setMeta(msg.meta);
  s.el.addEventListener('playing', () => fade(s, target, xfade > 0 ? xfade * 1000 : 250), { once: true });
  s.el.play().catch((e) => { if (!s.el.error && e?.name === 'NotAllowedError') emit(s, 'error', { message: String(e?.message ?? e) }); });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Only the service worker drives audio: not the side panel, not a tab.
  if (msg?.target !== 'offscreen' || sender.id !== chrome.runtime.id || sender.tab || (sender.url && sender.url !== SW_URL)) return;
  const a = active?.el;
  // Loads can cross in flight when Next is pressed rapidly: never let an older one win.
  if (msg.cmd === 'load' && typeof msg.token === 'number') {
    if (msg.token < newestLoad) { reply?.({ ok: false, stale: true }); return; }
    newestLoad = msg.token;
  }
  if (msg.cmd === 'load' && msg.embed) {
    // Hand over to the YouTube player: silence whatever <audio> was playing.
    const s = active; active = null;
    if (s) { s.token = -1; if (!s.el.paused && s.vol > 0.05) fade(s, 0, 150).then(() => kill(s)); else kill(s); }
    setMeta(msg.meta);
    embedLoad(msg, (kind, extra) => { chrome.runtime.sendMessage({ type: 'audio-event', kind, volume: Math.round(target * 100), ...extra }).catch(() => {}); });
    reply?.({ ok: true, embed: true });
    return;
  }
  if (msg.cmd === 'load' || msg.cmd === 'stop') embedStop();
  else if (embedActive() && ['play', 'pause', 'toggle', 'seek', 'volume', 'fade-pause'].includes(msg.cmd)) {
    if (msg.cmd === 'volume') target = msg.value / 100;
    embedCommand(msg.cmd, msg);
    reply?.({ ok: true, embed: true });
    return;
  }
  switch (msg.cmd) {
    // v0.8: no equalizer, so songs play as plain elements: no Web Audio graph,
    // no CORS-mode fetch, less CPU. (The graph code stays for a future EQ.)
    case 'load': void load(msg, true); break;
    case 'play': a?.play().catch(() => {}); break;
    case 'pause': a?.pause(); break;
    case 'fade-pause': if (active) { const s = active; fade(s, 0, (msg.ms ?? 4000)).then(() => { s.el.pause(); setVol(s, target); }); } break;
    case 'toggle': if (a) { if (a.paused) { if (active!.vol < 0.05) setVol(active!, target); a.play().catch(() => {}); } else a.pause(); } break;
    case 'seek': if (a) a.currentTime = msg.seconds; break;
    case 'volume': target = msg.value / 100; if (active && !active.ramp) setVol(active, target); break;
    case 'eq': eqOn = !!msg.on; if (Array.isArray(msg.gains)) eqGains = msg.gains; if (eqOn) graph(); applyEq(); break; // background always sends on:false
    case 'stop': {
      const s = active;
      active = null;
      if (s) { s.token = -1; if (!s.el.paused && s.vol > 0.05) fade(s, 0, 120).then(() => kill(s)); else kill(s); }
      break;
    }
    case 'ping': break;
  }
  reply?.({ ok: true, eq: !!active?.gain });
});
