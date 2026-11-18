# Features

Status: ✅ shipped · 🧪 shipped, but the live path isn't verified · ❌ not built.
Only what exists in the code is listed here. User-facing summaries are in README.md.

## Android app (3.2.0)

### Added or changed by Tunes
| Feature | Status | Code |
|---|---|---|
| Tunes identity: package `app.tunes.music`, name, blue logo, launcher icon | ✅ | `app/build.gradle.kts`, `res/` |
| Blue accent replaces red (`ActionBlue`, `AccentBlue`). Error text stays red | ✅ | `ui/theme/Theme.kt` |
| Inter font replaces SF Pro | ✅ | `Inter-OFL.txt`, font resources |
| Auto-backup and device transfer off (`allowBackup=false`) | ✅ | `AndroidManifest.xml` |
| Spotify token WebView can't leave `*.spotify.com` | ✅ | `data/canvas/SpotifyToken.kt` (`shouldOverrideUrlLoading`) |
| In-app updates from Hem456anth/Tunes releases | ✅ | `data/AppUpdateChecker.kt` |
| Continue from Chrome: `t=` in YouTube Music links seeks; player share adds `&t=` | ✅ | `playback/MusicLink.kt`, `MainActivity.kt`, `HandoffLinkTest` |
| 3.0 Explore (sectioned two-column mood grid) and 3.0 Search (text suggestions, typed recent searches as `q:` entities) | ✅ | `sharedUi/.../ExploreScreen.kt`, `SearchScreen.kt`, `MainViewModel.recordQuery` |
| Swiping away from Recents stops playback (setting, default on; Android Auto keeps playing) | ✅ | `playback/TaskRemovalPolicy.kt`, `PlaybackService.stopForDismissal()`, `TaskRemovalPolicyTest` |
| Material icons in place of upstream's Apple SF Symbols (D-20) | ✅ | `ui/icons/SfIcons.kt`, `BrokenHeart.kt` |
| Music Transfer: Spotify account, Spotify/Deezer/Apple Music/YouTube links, CSV/TXT/M3U into YouTube Music or on-device playlists; resumable, retries, duplicate skip and merge, manual Find | 🧪 | `data/transfer/*`, `ui/screens/MusicTransferScreen.kt`, `MusicTransferTest`, `docs/music-transfer.md` |

### Inherited from BitChord (v1.8, and v1.9.1 since 3.2.0)
YouTube Music search, browse and playback. Google sign-in. Hi-Res lossless from configured module
or addon sources. Gapless playback with 0–12 s crossfade. Automix (beta). Offline downloads with tags.
Local files, SMB and WebDAV. Word-synced lyrics from many providers, with translation and
romanization (`docs/LYRICS_TRANSLATION.md`). Animated album canvas. Replay stats. Widgets. Android
Auto. Chromecast. Equalizer. Per-network quality. Speed. Skip silence. Sleep timer. Stats for nerds.
Last.fm and ListenBrainz scrobbling. Discord Rich Presence. Listen Together. Spotify playlists and
Liked Songs. Playlist reorder. Backup export and import (`data/stats/Backup.kt`).

New with v1.9.1 (🧪, not yet tested on a device): bit-perfect USB DAC output and DAC volume HUD,
music video playback, YouTube Music podcasts, Direct Source Stream, Top Picks for You, Automix mix
view, offline player (device playlists, Liked, Folders, Open with), rebuilt downloads with "Keep
playlists updated", single back stack (`ui/navigation/AppNavigator.kt`).

### Not in the Android app
- ❌ Android TV and Wear OS apps (upstream has them; not merged, D-21)
- ❌ Desktop app (removed, see DECISIONS D-03)

## Chrome extension (1.3.1)

| Feature | Since | Code |
|---|---|---|
| Side panel with Listen Now, Explore, Library and Search; wide two-column layout; full-tab mode | ≤1.1 | `sidepanel/App.tsx`, `components/Views.tsx` |
| Offscreen playback with crossfade, and a source chain (JioSaavn 320 → YouTube direct → YouTube embed) | ≤1.1 | `background/index.ts`, `offscreen/*` |
| Synced lyrics from several providers, with mismatch checks | ≤1.1 | `lib/lyrics.ts` |
| Song menus (Play Next, Play Last, Library, Playlist, Like, Share, Station, Suggest Less) | 0.10.1 | `components/Actions.tsx` |
| Local library: songs, albums and playlists, liked, recently played, recently added | 0.10 | `lib/library.ts`, `lib/history.ts` |
| Queue editing with drag, keyboard reorder, Edit and Clear | 0.8 | `components/Queue.tsx` |
| Autoplay radio, sleep timer, media keys, keyboard shortcuts | ≤1.1 | `background/index.ts`, `manifest.json` |
| YouTube Music account through the Chrome sign-in; Last.fm and ListenBrainz scrobbling | ≤1.1 | `lib/accounts.ts`, `lib/lastfm.ts` |
| Transfer from Spotify, Apple Music and CSV | 0.5 | `lib/transfer/*`, `content/spotify-hook.ts`, `components/Transfer.tsx` |
| Discover (JioSaavn by language, iTunes genres, Deezer charts) | 0.7 | `lib/discover.ts`, `components/Discover.tsx` |
| Ad-free only switch (skips songs with no ad-free source; never blocks ads) | 0.9.3 | `settings.adFreeOnly` |
| Timeouts, per-source deadlines, long playlists (up to 1,000), friendly errors with Retry and Details, Import, quality badge | 1.2.0 | `lib/net.ts`, `lib/errors.ts`, `lib/backup.ts` |
| Podcasts: Apple and fyyd search, India charts, RSS and site discovery, follow, resume, 0.75–2× speed (`RATES` in `NowPlaying.tsx`), skip 15/30, OPML | 1.3.0 | `lib/podcasts/*`, `components/Podcasts.tsx` |
| Don't Play This Song and Block Artist | 1.3.0 | `lib/blocklist.ts` |
| Lyrics Original, Romanized or Translated | 1.3.0 | `lib/lyricsTranslate.ts` 🧪 (live translate unverified) |
| Gapless (when crossfade is off), smarter autoplay, onboarding, one Library, playlist reorder | 1.3.0 | `lib/suggest.ts`, `components/Onboarding.tsx` |
| Continue on Phone (QR) and pasted `t=` links | 1.3.1 | `lib/handoff.ts`, `components/Handoff.tsx` |
| ❌ Chrome Web Store listing | not built | see ROADMAP |
| ❌ Equalizer (removed in 0.8; the settings fields remain in `DEFAULT_SETTINGS`) | removed | |

## Listen Together server
Create and join parties with 6-character codes, up to 5 members (`JAM_MAX_MEMBERS`),
server-anchored sync, presence and live stats, and an invite landing page. See `backend/README.md`.
