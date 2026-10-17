// The YouTube player inside Tunes (v0.9). When no direct stream works, the
// song plays in a hidden youtube.com/embed iframe that lives in this offscreen
// page, driven over YouTube's documented postMessage protocol (the same one the
// IFrame API script speaks; MV3 can't load that remote script). No tab, no
// window: controls, progress and track changes flow through the same
// audio-event messages as the <audio> engine.
//
// A DNR rule (rules.ts, id 17) gives the embed request a Referer, without which
// YouTube refuses to start (error 153).

const ORIGIN = 'https://www.youtube.com';
// YouTube player states
const ENDED = 0, PLAYING = 1, PAUSED = 2, BUFFERING = 3;

type Emit = (kind: string, extra?: Record<string, unknown>) => void;

let frame: HTMLIFrameElement | null = null;
let ready = false;
let queue: string[] = [];
let token = -1;
let videoId = '';
let st = { state: -1, time: 0, duration: 0, at: 0, muted: false, vid: '' };
let emitFn: Emit = () => {};
let lastTime = 0;
let endedFor = '';
let tick: ReturnType<typeof setInterval> | null = null;
let volume = 100;
let expect = 0; // catalogue length of the song, seconds (0 = unknown)
let inAd = false;
let loadedAt = 0;
let fadeTimer: ReturnType<typeof setInterval> | null = null;
function stopFade() { if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; } }

export const embedActive = () => token !== -1;
export const embedToken = () => token;

function post(func: string, args: unknown[] = []) {
  const m = JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' });
  if (ready && frame?.contentWindow) frame.contentWindow.postMessage(m, ORIGIN);
  else queue.push(m);
}
function listen() {
  frame?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), ORIGIN);
}

/** Position estimated between YouTube's reports (it sends them about 4 times a second). */
function position() {
  return st.state === PLAYING && !inAd ? st.time + (performance.now() - st.at) / 1000 : st.time;
}
function report(kind: string, extra: Record<string, unknown> = {}) {
  if (token === -1) return;
  emitFn(kind, { token, position: Math.min(position(), st.duration || Infinity), duration: st.duration, playing: st.state === PLAYING, embed: true, ad: inAd, ...extra });
}

window.addEventListener('message', (e) => {
  if (!frame || e.source !== frame.contentWindow || !/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin)) return;
  let d: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
  if (!d?.event) return;
  if (d.event === 'onReady' || d.event === 'initialDelivery') {
    if (!ready) {
      ready = true;
      for (const m of queue) frame.contentWindow!.postMessage(m, ORIGIN);
      queue = [];
    }
  }
  if (d.event === 'onError') {
    // 2 bad id, 5 HTML5 error, 100 removed/private, 101/150 embedding disabled, 152/153 embedder refused
    report('error', { message: `YouTube player error ${d.info}`, code: d.info, fatal: [2, 100, 101, 150, 152, 153].includes(Number(d.info)) });
    return;
  }
  const info = d.info ?? {};
  if (d.event === 'infoDelivery' || d.event === 'initialDelivery' || d.event === 'onStateChange') {
    const vid = info.videoData?.video_id;
    if (vid) st.vid = vid;
    // Until this video's own id is seen, reports belong to the previous one.
    if (!st.vid && performance.now() - loadedAt < 3000) return;
    if (st.vid && st.vid !== videoId) return; // the end card of the previous song, or YouTube's own autoplay
    // A pre-roll ad reports its own (short) length under the song's id: hold
    // the clock at the start so the bar, lyrics and "ended" follow the song.
    if (typeof info.duration === 'number' && info.duration > 0 && expect > 60) {
      const was = inAd;
      // only a much SHORTER length is an ad; a longer one is a music video's intro/outro
      inAd = expect - info.duration > Math.max(20, expect * 0.15);
      if (was && !inAd) st.time = 0;
    }
    if (!inAd) {
      if (typeof info.currentTime === 'number') { st.time = info.currentTime; st.at = performance.now(); }
      if (typeof info.duration === 'number' && info.duration > 0) st.duration = info.duration;
    }
    if (typeof info.muted === 'boolean') st.muted = info.muted;
    const ps = typeof d.info === 'number' ? d.info : info.playerState;
    if (typeof ps === 'number' && ps !== st.state) {
      st.state = ps;
      st.at = performance.now();
      if (ps === PLAYING) { if (endedFor === videoId) endedFor = ''; /* replayed */ if (st.muted) post('unMute'); post('setVolume', [volume]); report('playing'); }
      else if (ps === PAUSED) report('pause');
      else if (ps === ENDED && !inAd && endedFor !== videoId) { endedFor = videoId; report('ended'); }
      else report('time');
    }
  }
});

function ensureFrame(id: string, startAt: number) {
  if (frame) return false;
  frame = document.createElement('iframe');
  frame.allow = 'autoplay; encrypted-media';
  frame.width = '320'; frame.height = '180';
  frame.title = 'YouTube player';
  const p = new URLSearchParams({
    enablejsapi: '1', autoplay: '1', controls: '0', playsinline: '1', rel: '0', iv_load_policy: '3', disablekb: '1',
    origin: location.origin, widget_referrer: location.origin,
  });
  if (startAt > 1) p.set('start', String(Math.floor(startAt)));
  frame.src = `${ORIGIN}/embed/${encodeURIComponent(id)}?${p}`;
  frame.addEventListener('load', () => { listen(); setTimeout(listen, 400); setTimeout(listen, 1500); });
  document.body.appendChild(frame);
  return true;
}

export function embedLoad(msg: { embed: string; token: number; volume?: number; startAt?: number; expect?: number }, emit: Emit) {
  expect = msg.expect ?? 0;
  inAd = false;
  loadedAt = performance.now();
  stopFade();
  emitFn = emit;
  token = msg.token;
  videoId = msg.embed;
  volume = msg.volume ?? 100;
  endedFor = '';
  st = { state: -1, time: msg.startAt ?? 0, duration: 0, at: performance.now(), muted: false, vid: '' };
  const created = ensureFrame(videoId, msg.startAt ?? 0);
  if (!created) post('loadVideoById', [{ videoId, startSeconds: Math.floor(msg.startAt ?? 0) }]);
  post('setVolume', [volume]);
  post('unMute');
  post('playVideo');
  // Progress for the panel, lyrics and scrobbling, at the same rate as <audio>.
  if (!tick) tick = setInterval(() => {
    if (token === -1 || st.state !== PLAYING || inAd) return;
    const n = performance.now();
    if (n - lastTime > 400) { lastTime = n; report('time'); }
    // Belt and braces: some embeds never send "ended" while hidden.
    if (st.duration > 5 && position() >= st.duration - 0.25 && endedFor !== videoId) { endedFor = videoId; st.state = ENDED; report('ended'); }
  }, 200);
}

export function embedCommand(cmd: string, msg: { seconds?: number; value?: number; ms?: number }) {
  if (cmd !== 'volume' && cmd !== 'seek') stopFade();
  if (cmd === 'seek') endedFor = '';
  switch (cmd) {
    case 'play': post('playVideo'); break;
    case 'pause': post('pauseVideo'); break;
    case 'toggle': post(st.state === PLAYING || st.state === BUFFERING ? 'pauseVideo' : 'playVideo'); break;
    case 'seek': post('seekTo', [msg.seconds ?? 0, true]); st.time = msg.seconds ?? 0; st.at = performance.now(); break;
    case 'volume': volume = msg.value ?? volume; post('setVolume', [volume]); break;
    case 'fade-pause': {
      // step the volume down, then pause and restore it for the next play
      const from = volume, steps = 20, ms = msg.ms ?? 4000;
      let i = 0;
      fadeTimer = setInterval(() => {
        i++; post('setVolume', [Math.round(from * (1 - i / steps))]);
        if (i >= steps) { stopFade(); post('pauseVideo'); post('setVolume', [from]); }
      }, ms / steps);
      break;
    }
  }
}

export function embedStop() {
  stopFade();
  if (tick) { clearInterval(tick); tick = null; }
  if (token === -1) return;
  token = -1;
  post('stopVideo');
}
