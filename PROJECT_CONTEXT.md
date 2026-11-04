# Project context

## Background

Tunes started in October 2026 as a Chrome extension port of the open-source Android player
**BitChord** (kushagrasinghx/BitChord, GPL-3.0). The port was called "BitChord for Chrome", then
Halotune, then Tunes, which was the owner's choice. An upstream pull request (BitChord #807) was
closed unmerged, and Tunes became its own project at
[github.com/Hem456anth/Tunes](https://github.com/Hem456anth/Tunes).

The Android side went through three approaches:
1. A Capacitor wrapper around the extension UI.
2. A native "v2" app.
3. **The current one (3.x)**: a fork of the BitChord v1.8 Android app with Tunes branding. The first two are retired and not in this repo.

The owner works mostly in Chrome and uses the Android app on an Android phone. The project is
personal and AI-assisted ("vibe-coded"), and the public description should stay modest about that.

## Current status (4 Nov 2026)

| Part | Version | State |
|---|---|---|
| Android app | 3.1.2, versionCode 7 | Released on GitHub as `v3.1.2` (20 Oct 2026). See TASKS T-01 for the asset name. |
| Chrome extension | 1.3.1 | Code is in `extension/`. No zip is attached to any GitHub release (TASKS T-03). |
| Listen Together server | inherited | The app's default server URL is `https://bitchord-listen-together.onrender.com` (upstream's). Tunes doesn't deploy its own. |

GitHub releases: `v3.0.0` (17 Oct), `v3.1.1` (18 Oct, arm64 APK), `v3.1.2` (20 Oct, arm64 APK).
3.1.0 wasn't published as a release.

## Module completion

### Done (built, unit-tested, shipped)
- Android: branding (package `app.tunes.music`, blue accent, Inter font), backups off, the
  Spotify WebView pinned to `*.spotify.com`, the update checker on Hem456anth/Tunes, Continue from
  Chrome (`t=` links), the 3.0 Explore and Search kept, stop on swipe-away (`TaskRemovalPolicy`),
  and Music Transfer (`data/transfer/*`, `ui/screens/MusicTransferScreen.kt`).
- Android, inherited from BitChord v1.8 and kept working: playback, downloads, Automix, lyrics,
  Replay, widgets, Android Auto, scrobbling, Discord, local, SMB and WebDAV files, Spotify
  playlists, Chromecast, the equalizer and Listen Together.
- Extension 1.2.0–1.3.1: reliability (timeouts, per-source deadlines), long playlists, friendly
  errors, import and export, podcasts, block and dislike, lyric translation, gapless, smarter
  autoplay, onboarding, one Library, playlist reorder, and the Continue on Phone QR.

### Partly done or unverified
- **Music Transfer, live paths not tested**:
  - the Spotify albums and artists `libraryV3` parsing,
  - YouTube Music writes (likes, playlist creation, subscribe),
  - the on-device UI.
  Only unit tests (`MusicTransferTest`, 15 tests) cover them.
- **Extension lyric translation**: the live Google Translate endpoint was unreachable in the
  sandbox. Only a mocked unit test covers it.
- **Android has had no on-device test in this environment** (no emulator). Testing happens on the owner's phone.
- **`.github/workflows/android.yml`** runs by hand only. It failed on every push before, and the
  cause was never confirmed.

### Not started or declined
- Chrome Web Store listing (roadmap feature 14): it needs the owner's developer account and fee,
  and the Store may reject YouTube streaming.
- MusicBrainz integration: the owner rejected a "Song info panel" idea. What the owner wants instead
  wasn't decided.

## Where things live outside this repo (owner's workspace only)

Only the owner's Hark workspace has these. A fresh Claude Code checkout won't.
- `tunes-fork` (branch `tunes`): a git worktree of upstream BitChord, where the Android code is
  developed with upstream history. Its `app/src` is copied into this repo. **This repo has its own
  history, with no common ancestor with upstream**, so upstream merges happen in the fork, never
  here.
- Release keystore and `keystore.properties`.
- Playwright UI test scripts for the extension (`audit`, `menus`, `qtest`, `err`, `imp`, `pod`,
  `hand`, `shots`…). They aren't in this repo. Only `extension/test/*.test.ts` are.

## People

- **Hemanth Kundrapu** ([@Hem456anth](https://github.com/Hem456anth)): owner and sole maintainer
  (MAINTAINERS.md).
- Upstream: BitChord by kushagrasinghx (credited, GPL).
