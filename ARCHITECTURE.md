# Architecture

```
Tunes/
├── app/        Android application module (Kotlin, Compose, Media3)       → app.tunes.music
├── shared/     Kotlin Multiplatform library: models, YouTube Music client, lyrics, Automix math
├── sharedUi/   Kotlin Multiplatform Compose UI: Home/Explore/Library/Search screens, Now Playing
├── native/     C++ sources: audio analyzer (Automix) and an FFmpeg JNI bridge
├── extension/  Chrome MV3 side-panel extension (React 18 + TS + Vite 5)  → separate product
├── backend/    Go Listen Together party server (Render)                  → separate service
└── docs/       LYRICS_TRANSLATION.md, music-transfer.md, screenshots/
```

Gradle (`settings.gradle.kts`) includes `:shared` and `:sharedUi` always, and `:app` only when an
Android SDK is found. The extension and the backend aren't Gradle projects.

---

## 1. Android app

### Modules and source sets
- **`:app`**: `app/src/main/java/com/music/bitchord/`, 247 Kotlin files. The namespace is
  `com.music.bitchord`. The `applicationId` is `app.tunes.music` (flavor `prod`) or
  `app.tunes.music.dev` (flavor `dev`, named "Tunes Dev", so both can be installed side by side).
- **`:shared`**: `commonMain` holds platform-free models (`data/model/Models.kt`), Listen Together
  models and the Automix planner (`playback/smart/TransitionPlanner.kt`). `jvmSharedMain` holds the
  network layer: `data/YtMusicRepository.kt`, `data/innertube/*` (InnerTube client, stream resolver,
  PoToken), every lyrics provider in `data/lyrics/*`, `data/sources/TrackMatcher.kt`, and the
  vendored Kizzy Discord RPC (`com/my/kizzy/*`).
- **`:sharedUi`**: `jvmSharedMain` holds the main screens (`ui/screens/HomeScreen.kt`,
  `ExploreScreen.kt`, `LibraryScreen.kt`, `SearchScreen.kt`) and the player
  (`ui/player/NowPlayingScreen.kt`, `PlayerLyrics.kt`, `PlayerQueue.kt`, …). `composeResources`
  holds strings in 16 `values*` folders (default plus 15 locales).

The `jvmSharedMain` split exists because upstream BitChord also had a desktop app. Tunes removed
the desktop app (it bundled SF Pro), but kept the source-set layout so upstream merges stay easier.

### Packages in `:app`
| Package | Role |
|---|---|
| `MainActivity.kt` | The single activity. Tabs (Listen Now, Explore, Library, Search), navigation, settings sub-screens (`settingsSubScreen`, e.g. `"music_transfer"`), deep links through `playback/MusicLink.kt` |
| `BitChordApplication.kt` | Application class (the name is kept on purpose, see DECISIONS D-05) |
| `ui/navigation/AppNavigator.kt` | One back stack for every page over the tabs (`AppRoute`: Settings and its pages, Music Transfer, Replay, …); release pages are interleaved from `MainViewModel.detailStack` |
| `ui/MainViewModel.kt` | Screen state, search, library and recent searches (`recordQuery`) |
| `ui/screens/*` | Android-only screens: Settings (`SettingsSheet.kt`), Sources, Equalizer, Music Transfer, Listen Together, Discord, Spotify library, Local music, History, Account |
| `ui/icons/SfIcons.kt` | Settings and menu icons by meaning; Material icons in Tunes (upstream uses SF Symbols, D-20) |
| `wear/*` | Phone side of upstream's Wear OS app (Data Layer bridge, installer). No watch APK is bundled in Tunes (D-21) |
| `ui/player/*`, `ui/components/*`, `ui/theme/*` | Android player host, lyrics share card, glass and backdrop effects, theme |
| `playback/PlaybackService.kt` | Media3 `MediaLibraryService`: two ExoPlayers (for crossfade), media session, Android Auto browse tree, notification, cast, party sync |
| `playback/*` | Queue (`QueueCoordinator`, `QueueHistory`, `QueueShuffle`), crossfade, `AudioCache`, `QualityUpgrade`, `Autoplay`, `SleepTimer`, `TaskRemovalPolicy`, `PartySync`, DSP processors (EQ, loudness, spatial, transition filter) |
| `playback/audio/*` | Direct and USB/Bluetooth output pipeline, `PrecisionAudioSink`, telemetry |
| `playback/smart/*` | Automix analysis on device (ONNX Runtime plus native analyzer) |
| `playback/cast/*` | Chromecast |
| `data/sources/*` | Source chain (see below) |
| `data/transfer/*` | Music Transfer: `TransferModels`, `TransferFileParser`, `TransferSources`, `TransferEngine` |
| `data/spotify/*` | Spotify library import and `LocalPlaylistStore` (on-device playlists) |
| `data/lyrics`, `data/canvas`, `data/remote` | Embedded lyrics, animated covers (Spotify, Apple, Tidal, community), remote artwork |
| `data/scrobbling/*` | Last.fm and ListenBrainz |
| `data/discord`, `data/presence` | Discord Rich Presence, presence pings to the party server |
| `data/listentogether/*` | The Listen Together client (REST plus WebSocket) |
| `data/smb`, `data/webdav` | Network libraries |
| `data/stats/*` | Replay stats (`ListeningStats`), `Backup.kt` (export and import) |
| `data/settings/AppSettings.kt` | Every user setting (SharedPreferences `bitchord_settings`) |
| `data/AppUpdateChecker.kt` | Polls `api.github.com/repos/Hem456anth/Tunes/releases/latest` and downloads the first `.apk` asset |
| `auth/*` | YouTube Music and Discord login WebViews, `EncryptedPrefs`, `AccountSessions` |
| `download/*` | `DownloadService`, the downloader, offline DASH and HLS, tag writers (FLAC, MP4, WebM) |
| `widget/*` | Home-screen widgets (2×2, 4×2, 4×1 pill) |

### Playback path
```
UI (sharedUi screens) → MainViewModel / PlayerConnection → PlaybackService (MediaLibrarySession)
   → QueueCoordinator → SourceResolver.resolve(track)
        → SourceRegistry.active()   sorted by SourceKind.rank:
             user-added ADDON / CUSTOM_MODULE (rank 0) → MODULE (rank 1) → JIOSAAVN → YOUTUBE
        → TrackMatcher decides whether another source has the same recording
   → StreamChoice / StreamResolver (InnerTube) → ExoPlayer (+ AudioCache, CrossfadeController, DSP)
```
- `SourceKind.kt` notes: JioSaavn resolves in about 0.4 s, while module indexes take 7–13 s,
  so only fast sources are resolved ahead of time.
- With lossless on, a higher-priority source that can serve the same recording bit-exact is asked
  first. A failing source is stepped over.

### Process and lifecycle
- `PlaybackService` runs as a foreground media service. When the task is swiped away,
  `TaskRemovalPolicy` decides what happens: playback stops unless the "Stop music on close from
  recents" setting is off or an Android Auto/AAOS controller is connected. If it stops,
  `stopForDismissal()` saves state, stops both players and calls `stopSelf()`.
- `DownloadService` is a separate foreground service (data sync).

### Native code
- `app/src/main/cpp/CMakeLists.txt` builds the DSD decoder (`dsd/`), the JNI glue (`jni/`), and
  the sources in `native/analyzer` (tempo, mel spectrogram, vocals) and `native/ffmpeg`.
- `TUNES_PREBUILT_NATIVE_DIR` (an environment variable) skips CMake and packages prebuilt `.so`
  files from a jniLibs-shaped folder.

---

## 2. Chrome extension (`extension/`)

```
public/manifest.json        MV3 manifest: side panel, service worker, permissions, shortcuts
src/background/index.ts     Service worker: PlayerState, queue, source chain, commands, persistence
src/background/rules.ts     declarativeNetRequest rules (headers for YouTube/Apple, player UA)
src/offscreen/index.ts      Offscreen document: <audio> playback, crossfade, gapless, media session
src/offscreen/embed.ts      Embedded YouTube player fallback
src/content/spotify-hook.ts MAIN-world script on open.spotify.com to read the user's token (transfer)
src/lib/*                   InnerTube client, sources (jiosaavn, youtube), lyrics, library, history,
                            settings, podcasts/*, transfer/*, backup, blocklist, suggest, handoff, net
src/sidepanel/*             React UI: App.tsx, components/* (NowPlaying, Queue, Views, Podcasts, …), hooks.ts
test/*.test.ts              node:test unit tests, bundled by scripts/test.mjs
```

### Message flow
```
Side panel (React) ──UiCommand──▶ background SW ──▶ offscreen document (<audio> or YouTube embed)
       ▲                              │
       └──── {type:'state'} broadcast ┘   (queue omitted unless it changed; queueVersion bumps)
```
- `UiCommand` is defined in `src/lib/types.ts`. Every command is checked by `validCommand()` in
  `background/index.ts` and accepted only from extension pages. The offscreen document accepts
  messages only from the service worker.
- Source order per song comes from `Settings.sources` (default `['jiosaavn','youtube']`). A
  JioSaavn copy is used only when the same recording matches. Then come YouTube direct streams, then
  the embedded YouTube player as the last resort (`tabFallback`). Each source has a 20 s deadline
  (`withTimeout` in `background/index.ts`). `lib/net.ts` sets per-request timeouts.
- The queue is capped at `QUEUE_CAP = 1000` and saved at most about once a second.
- Track id prefixes: plain 11-character YouTube ids, `jsv:` (JioSaavn), `itm:` (iTunes) and `dz:`
  (Deezer). The last two are matched to YouTube Music at play time. Podcasts use `pod:<feed>#<id>`.

### Handoff between the apps
- Extension → phone: `lib/handoff.ts` builds a `music.youtube.com/watch?v=…&t=…` link, shown as a
  QR code (qrcode-generator). Android's `MusicLink.parse` reads `t=`, and `MainActivity` seeks.
- Phone → extension: the Android player's share adds `&t=`. Pasting the link into extension search
  plays it from that second (`parseHandoff`).

---

## 3. Listen Together server (`backend/`)

Go, `net/http` plus gorilla/websocket. Parties live in memory, so run only one instance. The packages are
`clock` (a monotonic server clock), `codes` (party codes), `config` (env vars), `hub`, `party`,
`presence` and `protocol`. Sync works by anchoring a position to a server timestamp (see
`backend/README.md`, "How devices stay in time"). The Android client is
`app/.../data/listentogether/ListenTogether.kt`. The extension doesn't use the server.
