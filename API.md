# API and integrations

Tunes has no backend of its own for music. Both apps talk to public services directly from the
device. The only server in this repo is the Listen Together party server. **No API keys are
committed.** The user enters keys and logins on the device, and the build reads Last.fm keys from
`local.properties`.

## 1. Listen Together server (`backend/`)

Routes are registered in `backend/main.go`. The full protocol is in `backend/README.md` (API section).

| Method and path | Purpose |
|---|---|
| `GET /` | Root landing page |
| `GET /healthz` | Health check (Render) |
| `GET /api/time` | Server clock, for a first clock-offset estimate |
| `POST /api/parties` | Create a party (`userId`, `deviceId`, `displayName`) |
| `POST /api/parties/{code}/join` | Join. `404` unknown, `409` full, `422` no identity |
| `GET /api/parties/{code}` | Party state |
| `GET /api/parties/{code}/preview` | Preview, before joining |
| `POST /api/parties/{code}/leave` | Leave |
| `POST /api/presence` | Presence ping |
| `GET /api/stats/live` | Live stats |
| `GET /invite/{code}` | Invite landing page |
| `GET /ws/parties/{code}` | WebSocket: `ping`, state anchors (`positionMs` and `anchorMs`), `report`, controls, queue |

Environment variables (`backend/config/config.go`, with defaults): `JAM_MAX_MEMBERS` 5,
`JAM_STATE_HEARTBEAT_MS` 5000, `JAM_PLAY_LEAD_MS` 350, `JAM_DISCONNECT_GRACE_MS` 45000,
`JAM_EMPTY_PARTY_TTL_MS` 120000, `JAM_PARTY_MAX_AGE_MS` 12 h, `JAM_CONTROL_RATE_PER_SECOND` 25,
`JAM_MAX_UPCOMING_QUEUE` 25, `JAM_MAX_QUEUE_LENGTH` 26, `JAM_MAX_PARTIES` 50,
`JAM_CREATE_RATE_PER_MINUTE` 2, `JAM_RATE_LIMIT_MAX_ENTRIES` 10000, `JAM_REQUEST_MAX_BYTES` 16 KiB,
`JAM_WEBSOCKET_MAX_BYTES` 16 KiB, `JAM_CONNECTION_IDLE_MS` 15 min, `JAM_FRAME_RATE_PER_SECOND` 30,
`JAM_ALLOWED_ORIGINS` (CSV, empty by default), `JAM_TRUST_PROXY` false, `JAM_PUBLIC_ORIGIN`, and
the presence settings `JAM_PRESENCE_INTERVAL_SEC` 300, `JAM_PRESENCE_GRACE_SEC` 90,
`JAM_PRESENCE_MAX_ENTRIES` 200000, `JAM_PRESENCE_PINGS_PER_MINUTE` 20 and
`JAM_PRESENCE_RATE_LIMIT_MAX_IPS` 100000. Render values are in `backend/render.yaml`.

Android client: `data/listentogether/ListenTogether.kt`. The default server comes from the Gradle
property or env var `LISTEN_TOGETHER_SERVER`, else `https://bitchord-listen-together.onrender.com`.
The user can change it on the Listen Together screen. Invite links use
`https://bitchord.kushagrasingh.in/invite/<CODE>` (`JamInviteLink.kt`), an upstream domain.

## 2. Android integrations

| Service | What for | Where |
|---|---|---|
| YouTube Music InnerTube (`music.youtube.com/youtubei/v1`) | Browse, search, library, likes, playlists | `shared/.../data/YtMusicRepository.kt`, `data/innertube/*` |
| YouTube streams | Stream URLs through InnerTubeX (`com.github.MetrolistGroup.innertubex`), NewPipeExtractor (stripped jar), PoToken | `shared/.../data/innertube/StreamResolver.kt`, `PlayerClient.kt`, `potoken/*`; `app/.../data/innertube/*` |
| JioSaavn | Alternate stream for the same recording | `data/jiosaavn/JioSaavnService.kt`, `data/sources/JioSaavnSource.kt` |
| Module and addon sources (user-configured URLs) | Hi-Res and lossless | `data/sources/ModuleSource.kt`, `AddonSource.kt`, `module/*`, `addon/*` |
| Lyrics: LRCLIB, lrc.red, BiniLyrics, BetterLyrics, PaxSenix, LyricsPlus, SimpMusic, Unison, Megalobiz, KuGou, Musixmatch, Genius, YouTube | Synced lyrics | `shared/.../data/lyrics/*` |
| Google Translate and Input Tools | Lyric translation and romanization | `shared/.../data/lyrics/LyricsTranslation.kt`, `docs/LYRICS_TRANSLATION.md` |
| Spotify (WebView login, `api-partner.spotify.com` GraphQL `libraryV3`, embed pages) | Spotify import, Music Transfer, animated covers | `data/spotify/*`, `data/canvas/SpotifyToken.kt`, `data/transfer/TransferSources.kt` |
| Deezer public API (`api.deezer.com`) | Music Transfer (no sign-in) | `data/transfer/TransferSources.kt` |
| Apple Music public pages | Music Transfer, artist art, canvas | `TransferSources.kt` (`AppleMusicPage`), `data/canvas/AppleMusicCanvas.kt` |
| Tidal resources, community canvas | Animated covers | `data/canvas/*` |
| Last.fm (`ws.audioscrobbler.com`), Libre.fm, ListenBrainz | Scrobbling | `data/scrobbling/*`. Keys: `LASTFM_API_KEY` and `LASTFM_SECRET` |
| Discord gateway (Kizzy) | Rich Presence | `shared/.../com/my/kizzy/*`, `data/discord/*` |
| GitHub Releases API | Update check and APK download | `data/AppUpdateChecker.kt` |
| Google Cast | Chromecast | `playback/cast/*` |

Deep links handled by `playback/MusicLink.kt`: `music.youtube.com/watch`, `/playlist`, `youtu.be`
(with `t=`), plus Listen Together invites.

## 3. Extension integrations

Host permissions are in `extension/public/manifest.json`.

| Service | Where |
|---|---|
| YouTube Music InnerTube (`/youtubei/v1`), using the user's Chrome Google sign-in through cookies | `src/lib/innertube.ts`, `lib/accounts.ts` |
| YouTube direct streams and the embedded player | `src/lib/sources/youtube.ts`, `src/offscreen/embed.ts`, `background/rules.ts` (UA and header rules) |
| JioSaavn (`www.jiosaavn.com/api.php`) | `src/lib/sources/jiosaavn.ts`, `lib/discover.ts` |
| iTunes RSS genres and Deezer charts | `src/lib/discover.ts` |
| Lyrics: LRCLIB, LyricsPlus mirrors, PaxSenix, KuGou, Musixmatch, Genius, Apple | `src/lib/lyrics.ts` |
| Google Translate (`translate.googleapis.com`, optional permission) | `src/lib/lyricsTranslate.ts` |
| Podcasts: iTunes Search (`country=IN`), Apple charts (`rss.marketingtools.apple.com`), fyyd (`api.fyyd.de`), any RSS feed (optional `https://*/*` permission) | `src/lib/podcasts/*` |
| Spotify (token read by `content/spotify-hook.ts`), Apple Music `amp-api`, CSV | `src/lib/transfer/*` |
| Last.fm, ListenBrainz | `src/lib/lastfm.ts`, scrobbling in `background/index.ts` |

### Internal messaging (side panel ↔ background)
`UiCommand` in `src/lib/types.ts` includes `get-state`, `play-queue`, `play-index`, `add-next`,
`add-queue`, `add-next-many`, `append`, `remove-index`, `move`, `play-next-index`,
`clear-upnext`, `toggle`, `retry`, `rate`, `skip`, `next`, `prev`, `seek`, `volume`, `shuffle`,
`repeat`, `sleep` and `open-tab`. Add a new command in three places: the union type,
`validCommand()` and the switch in `background/index.ts`.
