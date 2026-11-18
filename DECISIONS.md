# Technical decisions

These were decided by the owner, or for clear legal or technical reasons. Don't reverse one
without asking the owner. Add new decisions at the end with the date.

### D-01 · Never block, skip or mute YouTube ads (Oct 2026)
**Why:** the YouTube terms of service, and the owner's request to respect platform policies.
**What it means:** the extension has an `adFreeOnly` setting that *skips songs that have no ad-free
source*. It shows "ad playing, your song is next" while an ad plays. YouTube Premium works through
the embed's cookies. Neither app strips ad slots.

### D-02 · The Android app is a fork of BitChord (v1.8, now v1.9.1), not a rewrite (Oct 2026)
**Why:** it replaced two earlier approaches (a Capacitor wrapper, a native v2 app) and gets BitChord's
full player. Moving from v1.5.1 to v1.8 brought in 353 non-merge upstream commits, and v1.8 to
v1.9.1 (18 Nov 2026) another 544.
**What it means:** upstream merges happen in a separate worktree with upstream history (this repo has
its own unrelated history). Keep Tunes changes small and isolated so merges stay cheap.

### D-03 · Inter instead of SF Pro, and no desktop app (18 Oct 2026)
**Why:** Apple's SF Pro can't be redistributed. Upstream's desktop app bundled it.
**What it means:** use Inter (OFL, `Inter-OFL.txt`). `desktopApp/` and its workflows were removed. The
`jvmSharedMain` source sets stay.

### D-04 · Blue accent (Oct 2026)
The red accent became `ActionBlue` (#4A94FF dark, #005BD3 light) and `AccentBlue` (#0A60FF), all
with at least 4.5:1 contrast. Error *status text* stays red. The logo gradient runs #1388FF to #0652FF.

### D-05 · Only docs and comments say "Tunes", not identifiers (19 Oct 2026)
**Why:**
- The prebuilt native libs export `Java_com_music_bitchord_*` JNI symbols.
- `EncryptedSharedPreferences` file names are part of their encryption.
- Backups use the app tag `bitchord`.
- Renaming would break all of these and wipe user data.

**What it means:** keep the Kotlin package `com.music.bitchord`, `BitChordApplication`, `BitChordIcons`,
string keys, log tags, prefs names, native lib names and server URLs. Only the `applicationId`
(`app.tunes.music`), the user-visible names and the docs are Tunes. License and copyright notices,
including "combined here into BitChord" and "Modified for BitChord", stay verbatim.

### D-06 · Android auto-backup and device transfer off (Oct 2026)
**Why:** restoring sign-in cookies and account tokens onto another device is a security risk.
**What it means:** `allowBackup=false` with all domains excluded. Users move data with Settings →
export/import (`Backup.kt`), which leaves out credentials.

### D-07 · Keep the 3.0 Explore and Search on Android (18 Oct 2026)
**Why:** the owner prefers them to the BitChord v1.8 redesign.
**What it means:** Explore is a sectioned two-column mood grid. Search has text suggestions only,
with a "Search 'term'" row first, no media cards while typing, plain song rows, and recent searches
stored as typed terms (`q:` ids, `MainViewModel.recordQuery`). Everything else follows v1.8. Keep
this through future upstream merges.

### D-08 · Swiping away from Recents stops playback by default (19 Oct 2026)
**Why:** the owner's request, and it matches other players.
**What it means:** `stopOnTaskRemoved` defaults to true, and an earlier saved value is kept. Playback
continues only when the setting is off or an Android Auto/AAOS controller is connected
(`TaskRemovalPolicy`).

### D-09 · Version numbers (20 Oct 2026, updated 18 Nov 2026)
The owner said "v3.1.2 only", so Music Transfer shipped as 3.1.2 with versionCode 7. On 18 Nov 2026
the owner approved 3.2.0 (versionCode 8) for the BitChord v1.9.1 merge. Ask before
raising `versionName`. `versionCode` must always increase.

### D-10 · Music Transfer uses only public data and the user's own sign-ins (20 Oct 2026)
**Why:** TuneMyMusic and SongShift have no public API, and TuneMyMusic's terms forbid building on it.
**What it means:**
- Sources: Spotify's own login page in a WebView (Tunes never sees the password), the Spotify embed,
  the Deezer public API, Apple's public pages, and files.
- TuneMyMusic and SongShift are external links only.
- Apple Music *libraries* aren't supported, because they need a paid MusicKit token.

### D-11 · Podcasts in the extension only; sources (18 Oct 2026)
- Discovery uses iTunes Search (`country=IN`) and Apple charts, with fyyd as the backup.
- **Not Podcast Index:** its terms forbid embedding keys. **Not Open RSS:** it's closed-source.
- The parser is our own (DOMParser). It ports AntennaPod's rules (GPL, credited) and Winds'
  dedupe and feed discovery (BSD-3, notice kept in `THIRD_PARTY_NOTICES.md`).

### D-12 · The extension never opens tabs for playback (v0.9, Oct 2026)
**Why:** a standing rule from the owner. The hidden helper tab was removed in v0.9.
**What it means:** audio plays in the offscreen document (`<audio>`, or the YouTube embed as the
last resort). The only tab is `sidepanel.html?mode=tab`, when the user asks for it.

### D-13 · Extension message security (v0.8.1–v0.9.1, Oct 2026)
- UiCommands are accepted only from extension pages and must pass `validCommand()`.
- The offscreen document accepts only the service worker. The panel accepts state only from the
  service worker.
- The `*.google.com` and cookies permissions stay (they're needed for the Google account picker).

### D-14 · No Chrome Web Store listing for now (18 Oct 2026)
**Why:** it needs the owner's developer account and fee, and the Store may reject direct YouTube
streams. The extension is installed unpacked.

### D-15 · Essential menus only, heart not star (v0.10.1, Oct 2026)
Menus keep only the essential actions (listed in FEATURES.md). Likes use a heart. Don't add Apple
Music-style features unless asked.

### D-16 · Release assets: arm64 APK first, named `.apk` (18 Oct 2026)
**Why:** `AppUpdateChecker` downloads the first asset ending in `.apk` from `releases/latest`.
**What it means:** attach `Tunes-X.Y.Z-arm64.apk` only, or upload it first. The GitHub connector can't
upload assets, so the owner does it. (The v3.1.2 asset broke this rule; see TASKS T-01.)

### D-17 · `android.yml` runs by hand only (18 Oct 2026)
**Why:** it failed on every push, and the logs needed authentication to read. Release APKs are
built and signed locally with the Tunes key.

### D-18 · GPL-3.0 everywhere
Every dependency must be GPL-3.0 compatible. BitChord stays in the README Credits. A distributed
build must come with its source.

### D-19 · YouTube Music podcasts on Android (18 Nov 2026)
**Why:** the owner chose to keep upstream v1.9's podcast playback when merging, to close a gap with
other clients. **What it means:** the old "podcasts in the extension only" rule is retired. The
Android app plays YouTube Music podcast shows; the extension keeps its own Apple/fyyd/RSS directory.

### D-20 · No Apple SF Symbols (18 Nov 2026)
**Why:** upstream v1.9 draws its settings and menu icons from Apple's SF Symbols (the
`Jetpack_SF_Symbols` port). Apple licenses them only for apps on its own platforms, the same reason
SF Pro was removed (D-03). **What it means:** `ui/icons/SfIcons.kt` keeps upstream's object and
member names but maps each to a Material Symbols Rounded icon (Apache-2.0). `BrokenHeart` is cut
from the Material heart. Keep the names so later upstream merges stay small.

### D-21 · Phone app only: no TV, Wear OS or web app (18 Nov 2026)
**Why:** the owner chose to merge the phone app first. Upstream's TV app bundles Google Sans and a
Minecraft font, the Wear OS app SF Pro, and `web/` is upstream's own site. **What it means:**
`settings.gradle.kts` includes only `:shared`, `:sharedUi` and `:app`. `wearos/protocol/` stays
because the phone app compiles `WearProtocol.kt`. The Wear OS settings row only shows when a watch
is connected, and Tunes bundles no watch APK, so installing onto a watch won't work yet.

### D-22 · No addon verification service (18 Nov 2026)
**Why:** upstream v1.9 added `AddonAuth`: for addons that ask, the app attests its hardware key to
upstream's auth service, which only vouches for the official BitChord package and signing key. It
would always refuse Tunes, after receiving the device's attestation chain. **What it means:**
`ADDON_AUTH_SERVER` defaults to empty and `AddonAuth.attest()` refuses locally. Addons that require
BitChord auth don't work in Tunes; all other addons are unaffected.

### D-23 · App icon picker hidden (18 Nov 2026)
**Why:** upstream's alternate launcher icons (glass, neon, monochrome) are BitChord art, mostly red,
which clashes with the Tunes icon and blue accent (D-04). **What it means:** `AppIcon.PICKER_ENABLED`
is false, so Settings doesn't offer them; only the Tunes icon (`LauncherDefault`) is enabled. Turn it
on when Tunes has its own variants (TASKS I-07).
