# Changelog

Newest first. Dates are commit dates (`git log`). The user-facing summaries are in README.md
("What's new") and `extension/README.md` ("Changes"). Add every change here.

## Unreleased
- Docs: Claude Code handoff package (CLAUDE.md, PROJECT_CONTEXT, ARCHITECTURE, FEATURES, ROADMAP,
  TASKS, API, DATABASE, SETUP, DECISIONS, CHANGELOG). README build notes corrected: the
  `MODULE_INDEX_URL` key it listed isn't read anywhere in the code.

## Android

### 3.1.2: versionCode 7 (2026-10-19 / 20), released as GitHub `v3.1.2` on 2026-10-20
- `7f5286f` **Music Transfer** (Settings → Music Transfer): Spotify account and links, Deezer,
  Apple Music, YouTube links, and CSV/TXT/M3U files, into YouTube Music or on-device playlists.
  `data/transfer/*`, `MusicTransferScreen.kt`, `MusicTransferTest` (15 tests),
  `docs/music-transfer.md`.
- `7ee1b0b` README and code comments for Music Transfer.
- `1c70154`, `e4d6629` README screenshots (`docs/screenshots/`), with the profile photo replaced by a
  generic icon.
- `c00c05f`, `beaf919` Credits updated by the owner on GitHub.
- The version name stayed 3.1.2 at the owner's request ("v3.1.2 only"). Only versionCode went from
  6 to 7.

### 3.1.2: versionCode 6 (2026-10-19, not released on its own)
- `8b03a4f` Swiping Tunes away from Recent Apps stops playback, clears the notification and saves
  the queue. The setting "Stop music on close from recents" defaults to on (an earlier saved value
  is kept). Android Auto/AAOS keeps playback going. `TaskRemovalPolicy.kt`, `TaskRemovalPolicyTest`.
- `f7690f7` Docs and comments say Tunes. Identifiers and license notices are unchanged.

### 3.1.1: versionCode 5 (2026-10-18, GitHub `v3.1.1`)
- `6c5e000` The 3.0 Explore (sectioned two-column mood grid) and the 3.0 Search (text
  suggestions, a "Search 'term'" row first, typed recent searches) are back.
- `4d336cc`, `2df19dd`, `7a620ed` Tunes-only README, CONTRIBUTING, CODE_OF_CONDUCT,
  MAINTAINERS. The BitChord banner and donation QR were removed. `android.yml` now runs by hand only.

### 3.1.0: versionCode 4 (2026-10-18, no GitHub release)
- `f43b05f` Rebased on **BitChord v1.8**: Spotify playlists and Liked Songs, Chromecast, equalizer,
  lyric translation and romanization, Listen Together, SMB/WebDAV, playlist reorder, new queue and
  artist pages. Continue from Chrome: `t=` in YouTube Music links seeks, and the player share adds
  `&t=`.
- `912e6c8`, `a08d266` The desktop app and the upstream desktop, release, backend-deploy and
  contributors workflows were removed (SF Pro fonts can't be redistributed).

### 3.0.0: versionCode 3 (2026-10-17, GitHub `v3.0.0`)
- `6adc9ea` First Tunes release from the BitChord fork: package `app.tunes.music`, blue accent,
  Inter, backups off, Spotify WebView pinned, updater on Hem456anth/Tunes.
- `19f27a5` Near-simultaneous source answers are ranked by quality (60 ms tie window).

Earlier Android attempts (1.0.0 and 2.0.0: a Capacitor wrapper and a native v2 app) were retired and
aren't in this repo.

## Chrome extension

### 1.3.1 (2026-10-18, `d753787`)
Continue on Phone (QR code and `t=` link). A phone link pasted into search continues from that
second. Minimum Chrome is 116.

### 1.3.0 (2026-10-18, `83e9ed9`)
Podcasts, Don't Play This Song and Block Artist, lyric translation and romanization, gapless,
smarter autoplay, a welcome screen, one Library, playlist reorder.

### 1.2.0 (2026-10-18, `3fbbd55`)
Timeouts and per-source deadlines, long playlists (up to 1,000), throttled saves and a queue cap of
1,000, plain errors with Retry and Details, Import, a quality badge, unit tests and CI.

### 1.1.1 (2026-10-17, `5290c8e`)
Responsive Explore rows and genre chips.

### ≤ 1.1.0
These versions (0.4 to 1.1, as "BitChord for Chrome" and then Halotune) came before this repository:
transfer, artist pages, crossfade, Last.fm, sleep timer, Discover, queue editing, the security
audit, the ad-free-only decision, and the Apple-style menus trimmed to essentials. Their details are
kept in the owner's project notes, not here.

## Listen Together server
Inherited from BitChord unchanged, apart from docs.
