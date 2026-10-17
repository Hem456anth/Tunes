// Data models, ported in spirit from Tunes shared/commonMain data/model/Models.kt

export interface Track {
  videoId: string;
  title: string;
  artists: string;
  album?: string;
  thumbnail: string;
  duration?: string; // "3:24"
  /** browseId (UC…) of the lead artist, when the row links one */
  artistId?: string;
  /** Discover: playable JioSaavn copy (videoId is then "jsv:<id>"; "itm:"/"dz:" ids are matched to YouTube Music at play time) */
  saavn?: { enc: string; has320: boolean };
  language?: string;
  releaseDate?: string;
  sources?: string[];
}

export type CardKind = 'album' | 'playlist' | 'artist' | 'video' | 'song';

export interface Card {
  kind: CardKind;
  title: string;
  subtitle: string;
  thumbnail: string;
  videoId?: string;
  playlistId?: string;
  browseId?: string;
}

export interface MoodChip {
  title: string;
  color: string;
  browseId: string;
  params: string;
}

export interface Shelf {
  title: string;
  tracks: Track[];
  cards: Card[];
}

export interface PlayerState {
  videoId: string | null;
  track: Track | null;
  playing: boolean;
  position: number; // seconds
  duration: number; // seconds
  volume: number; // 0..100
  helperReady: boolean;
  needsActivation: boolean; // autoplay blocked in helper tab
  queue: Track[];
  index: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  engine: 'direct' | null; // offscreen page: <audio> or the embedded YouTube player
  stream: string | null; // "Stats for nerds": e.g. "JioSaavn · 320 kbps AAC"
  resolving: boolean;
  error: string | null;
  /** Sleep timer: epoch ms when playback pauses, or null */
  sleepAt: number | null;
  /** Sleep timer: pause when the current song ends */
  sleepEndOfTrack: boolean;
}

export type SourceOrder = 'saavn-first' | 'youtube-first' | 'youtube-only' | 'tab-only';
export type DirectSource = 'jiosaavn' | 'youtube';
export type AccountId = 'youtube-music' | 'google' | 'apple-music';
export type Quality = 'high' | 'normal' | 'low';
export type Theme = 'system' | 'light' | 'dark';
export interface Settings {
  // Sources (Tunes's "Sources, tried in this order")
  sources: DirectSource[]; // order
  jiosaavn: boolean; // enabled
  /** @deprecated v0.9: the YouTube Music tab is gone (embedded player instead) */
  tabFallback: boolean;
  /** Never fall back to the YouTube player (the one source that can show YouTube's ads): skip the song instead. */
  adFreeOnly: boolean;
  tabDataSaver: boolean; // helper tab: smallest video, Song mode, no images
  quality: Quality;
  // Accounts
  useAccount: boolean;
  defaultAccount: AccountId;
  authUser: number;
  listenbrainzToken: string;
  // Playback
  autoRadio: boolean;
  hideVolume: boolean;
  /** seconds of overlap between songs, 0 = off */
  crossfade: number;
  /** Equalizer: 10 bands (31 Hz to 16 kHz), dB */
  eqOn: boolean;
  eqPreset: string;
  eqGains: number[];
  /** Last.fm: your own API key and secret (last.fm/api/account/create) and the session they unlock */
  lastfmKey: string;
  lastfmSecret: string;
  lastfmSession: string;
  lastfmUser: string;
  /** Discover languages, in the order shown */
  discoverLangs: string[];
  // Appearance
  theme: Theme;
  reduceMotion: boolean;
  reduceBlur: boolean;
  syncedLyrics: boolean;
  blurLyrics: boolean;
  // Advanced
  showStats: boolean;
  lyricsDebug: boolean;
  /** @deprecated v0.2 setting, migrated into sources/jiosaavn/tabFallback */
  sourceOrder?: SourceOrder;
}
export const DEFAULT_SETTINGS: Settings = {
  sources: ['jiosaavn', 'youtube'], jiosaavn: true, tabFallback: true, adFreeOnly: false, tabDataSaver: true, quality: 'high',
  useAccount: true, defaultAccount: 'youtube-music', authUser: 0, listenbrainzToken: '',
  autoRadio: true, hideVolume: false, crossfade: 0,
  eqOn: false, eqPreset: 'Flat', eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  lastfmKey: '', lastfmSecret: '', lastfmSession: '', lastfmUser: '',
  discoverLangs: ['telugu', 'hindi', 'tamil', 'english'],
  theme: 'dark', reduceMotion: false, reduceBlur: false, syncedLyrics: true, blurLyrics: true,
  showStats: false, lyricsDebug: false,
};

export interface HomeChip { title: string; params?: string }
export interface Suggestion { kind: 'query' | 'song' | 'artist' | 'album' | 'playlist' | 'video'; text: string; sub?: string; thumbnail?: string; track?: Track; card?: Card }

// Messages between side panel <-> background <-> helper tab
export type UiCommand =
  | { type: 'get-state' }
  | { type: 'play-queue'; tracks: Track[]; index: number }
  | { type: 'play-index'; index: number }
  | { type: 'add-next'; track: Track }
  | { type: 'add-queue'; track: Track }
  | { type: 'add-next-many'; tracks: Track[] }
  | { type: 'append'; tracks: Track[]; keepDupes?: boolean }
  | { type: 'remove-index'; index: number }
  | { type: 'move'; from: number; to: number } // absolute queue indices
  | { type: 'play-next-index'; index: number } // move a queued song to right after the current one
  | { type: 'clear-upnext' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'seek'; seconds: number }
  | { type: 'volume'; value: number }
  | { type: 'shuffle' }
  | { type: 'repeat' }
  | { type: 'sleep'; minutes: number } // 0 = off, -1 = end of this song
  | { type: 'open-tab' };

export type PageCommand =
  | { cmd: 'load'; videoId: string; startSeconds?: number }
  | { cmd: 'hint'; videoId: string | null }
  | { cmd: 'config'; dataSaver: boolean }
  | { cmd: 'ping' }
  | { cmd: 'play' }
  | { cmd: 'pause' }
  | { cmd: 'toggle' }
  | { cmd: 'seek'; seconds: number }
  | { cmd: 'volume'; value: number };

export interface PageState {
  videoId: string | null;
  state: number; // YT player state: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
  position: number;
  duration: number;
  volume: number;
  title?: string;
  author?: string;
  /** an ad is on screen (the helper tab skips it) */
  ad?: boolean;
  /** Date.now() when read, and what triggered it */
  at?: number;
  event?: string;
  quality?: string;
}

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Treble boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  Vocal: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  Pop: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
  Rock: [4, 3, 2, 0, -1, -1, 1, 2, 3, 4],
  Electronic: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5],
  Acoustic: [3, 3, 2, 1, 1, 1, 2, 2, 2, 1],
  'Late night': [3, 2, 1, 0, -1, -1, -2, -3, -3, -4],
};
