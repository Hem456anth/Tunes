# Tasks, bugs and improvements

Checked against the code and the GitHub releases on 4 Nov 2026. Priority: P1 (do next), P2 (soon),
P3 (when convenient). When you close a task, delete it here and add an entry to CHANGELOG.md.

## Bugs and release issues

### T-01 · P1 · The v3.1.2 release asset has no `.apk` extension, so in-app updates fail
- On the `v3.1.2` release, the only asset is named `Tunes-3.1.2-arm64`, without `.apk`.
- `data/AppUpdateChecker.kt` (`apkAssetUrl`) only accepts assets whose name ends in `.apk`.
  So installs on 3.1.1 see the update, but `apkUrl` is null and the app falls back to opening
  the releases page. The README also promises `Tunes-<version>-arm64.apk`.
- **Fix (owner, on GitHub):** Releases → v3.1.2 → Edit → delete the asset and upload
  `Tunes-3.1.2-arm64.apk`. The connector can't upload or rename assets. Don't change the code.

### T-02 · P2 · `android.yml` workflow is unverified
It runs by hand only (`workflow_dispatch`), because it failed on every push and the logs were
never read. Run it once, read the log, fix it, and only then think about running it on tags. It
builds unsigned unless the `KEYSTORE_*` secrets are set.

### T-03 · P2 · The extension zip isn't on any release
No release has an extension asset. On 4 Nov 2026 the extension README install step was changed
to build-only to match. If the owner wants a download, build the zip (`rm -rf dist && npm run build && npm run zip`), attach `extension/tunes.zip` to the
next release, and put the download step back in `extension/README.md`.

### T-04 · P3 · Dead npm scripts in `extension/package.json`
`build:mobile` and `apk` point at `mobile/` and `android/` (the retired Capacitor app). Neither
folder is in this repo. The `@capacitor/*` dependencies are only for them. Nothing
in `src/` imports `@capacitor` (checked 4 Nov 2026). Removing the scripts and dependencies is
safe, but it changes `package-lock.json`. Run the full extension checks afterwards and note it in
CHANGELOG.

### T-05 · P3 · The backend module path still points upstream
`backend/go.mod` declares `module github.com/KabirSinghBhatia/BitChord/backend`, and
`backend/render.yaml` names the service `bitchord-listen-together`. It works as it is. Change it
only if Tunes deploys its own server (and then update `LISTEN_TOGETHER_SERVER` too).

## Verification gaps (need a real device or network)

- **V-05** 3.2.0 merge on a device: player, Settings, menus and icons (now Material), podcasts,
  music videos, bit-perfect USB output, Music Transfer opening from Settings and its Spotify sign-in
  (now upstream's `SpotifyLoginScreen`, which upstream says should be a root overlay, not page
  content), the `t=` handoff and share position, swipe-away stop, Explore and Search (3.0).

- **V-01** Music Transfer live paths: Spotify saved albums and followed artists (`SpotifyLibrary.albums()` and `artists()` in `data/spotify/SpotifyLibrary.kt`, called from `TransferSources.kt`), YouTube Music writes (like, create playlist, save album,
  subscribe), the on-device UI flow, and resuming after the app is killed.
- **V-02** Extension lyric translation against the real `translate.googleapis.com`
  (`lib/lyricsTranslate.ts`, an optional host permission).
- **V-03** Android 3.1.x on a device: Explore and Search, swipe-away stop, Android Auto keeping
  playback, and the `t=` handoff from the extension's QR.
- **V-04** `GeniusTest` needs the network. Run it where genius.com is reachable.

## Improvements (only when the owner asks)

- **I-01** Chrome Web Store and IzzyOnDroid listings (feature 14): needs the owner's developer account and the fee.
  The Store may reject YouTube streaming. See DECISIONS D-14.
- **I-02** Dev-server advisories in vite and esbuild affect `npm run dev` only, not shipped code.
  The fix needs vite 8. Treat it as a separate upgrade task with a full UI retest.
- **I-03** MusicBrainz: the owner rejected a "Song info panel". Ask what the owner actually wants
  (better search and pages, or song details and artwork) before building anything.
- **I-04** Done for v1.9.1 (3.2.0). For the next upstream release, this repo has no common history
  with upstream, so merge with an explicit base instead of `git merge`:
  `git fetch --depth 1 upstream refs/tags/vOLD:refs/tags/up-vOLD refs/tags/vNEW:refs/tags/up-vNEW`,
  then `git merge-tree --write-tree --merge-base=up-vOLD HEAD up-vNEW` and resolve. Keep the 3.0
  Explore and Search, the Tunes branding, Inter, Material icons (D-20) and the docs.
- **I-05** Android TV and Wear OS apps from upstream (D-21): swap their fonts (Google Sans,
  Minecraft, SF Pro) for Inter, include `:tv`/`:wearos`, and bundle the watch APK.

## Next actionable steps for a new session

1. Ask the owner to fix T-01 (rename the asset). Then confirm with
   `GET /repos/Hem456anth/Tunes/releases/latest`.
2. Decide T-03 with the owner (attach the zip, or change the README).
3. T-04 cleanup, if the owner agrees. It's small, and only the extension is affected.
4. Before any new Android feature, raise only `versionCode` (now 7) unless the owner approves a new
   `versionName`.
