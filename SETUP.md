# Setup, build, test, debug and release

## Requirements
| Part | Tools |
|---|---|
| Android | JDK 17 (Temurin), Android SDK with **platform 37** (`compileSdk 37`, `targetSdk 36`, `minSdk 26`), CMake 3.22.1 and the NDK (or prebuilt `.so` files, see below). AGP 8.10.1, Kotlin 2.3.20, Compose Multiplatform 1.10.3, R8 pinned to 8.13.23 (`build.gradle.kts` says why) |
| Extension | Node.js 22, npm |
| Backend | Go (the toolchain `backend/go.mod` names, `go 1.27.0`) |

Repositories: Google, Maven Central, Gradle Plugin Portal and JitPack (for NewPipeExtractor and
InnerTubeX).

## Configuration (all gitignored, never commit)

### `local.properties` (repo root)
```
sdk.dir=/path/to/android-sdk
LASTFM_API_KEY=        # optional: without it, Last.fm sign-in stays off
LASTFM_SECRET=         # optional
LISTEN_TOGETHER_SERVER= # optional: default https://bitchord-listen-together.onrender.com
```
`LASTFM_*` and `LISTEN_TOGETHER_SERVER` can also be environment variables (`app/build.gradle.kts`).
Those three are the only build-time keys. Module and addon sources are added in the app (Settings → Sources).

### `keystore.properties` (repo root)
Copy `keystore.properties.example`. Without it (or without the `.jks` it names), release builds come
out **unsigned** instead of failing. Shipping builds must use the original Tunes key, certificate
SHA-256 `963fa6cdbcedd9d6970b37acb42c28674b45b6215fa62bde799b2ac6eeb1f067`. If the key is lost, no
update can install over existing installs.

### Other environment variables
| Variable | Effect |
|---|---|
| `TUNES_PREBUILT_NATIVE_DIR` | Package prebuilt native libs from a jniLibs-shaped folder and skip CMake (hosts without an NDK, e.g. ARM64 Linux) |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | SDK location if `local.properties` has none. Without an SDK, `:app` isn't included |
| `JAM_*` | Backend settings, see API.md |

## Android

```bash
./gradlew assembleDevDebug                 # dev flavor, app.tunes.music.dev ("Tunes Dev")
./gradlew :app:assembleProdRelease         # app/build/outputs/apk/prod/release/ (ABI splits + universal)
./gradlew installDevBenchmark              # release-like build, debug-signed, own package suffix
./gradlew :app:testProdReleaseUnitTest     # unit tests (app/src/test, ~90 test classes)
./gradlew testDevDebugUnitTest --tests "com.music.bitchord.playback.TaskRemovalPolicyTest"
./gradlew :shared:jvmTest                  # shared module tests
```
- ABI splits: `armeabi-v7a`, `arm64-v8a` and `x86_64`, plus a universal APK.
- Expected offline failure: `GeniusTest` (it reaches genius.com).
- Low-memory hosts (about 8 GB): run Gradle with `--max-workers=1`, `-XX:+UseSerialGC` and about
  `-Xmx4100m`. A 4,600 MB heap was OOM-killed in R8 on that host. Don't run two JVMs at once. To
  save time you can skip the lint-vital tasks:
  `-x lintVitalProdRelease -x lintVitalAnalyzeProdRelease -x lintVitalReportProdRelease`.
- A release build takes about 12–16 minutes on the owner's sandbox.

### Build snags seen in sandboxes (18 Nov 2026)
- `compileSdk = 37`: the SDK repository names the platform `android-37.0`, which AGP 8.10 doesn't
  match to `android-37` ("Failed to find target with hash string"). Android Studio installs work;
  in a bare sandbox, test-compile against 36 locally (and skip `check*AarMetadata`), never commit it.
- Native build: CMake fetches Oboe (GitHub archive) and libusb (GitHub release) at configure time.
  Where GitHub archive downloads are blocked, clone Oboe 1.11.0 and pass
  `-DFETCHCONTENT_SOURCE_DIR_OBOE=<dir>` as a local CMake argument.

### Debugging
- Log tags still say `BitChord` (e.g. `adb logcat -s BitChord`), on purpose.
- The `dev` flavor installs beside the `prod` one. The `benchmark` build type is for checking R8
  and startup.
- `betaSuffix` in `app/build.gradle.kts` marks sideloaded betas (`3.2.0-beta1`) so the updater
  still offers the final release. Leave it empty for releases.
- Stats for nerds (in the player) shows the stream, codec and source in use.

## Chrome extension
```bash
cd extension
npm ci
npx tsc --noEmit -p . --noUnusedLocals
npm test                 # esbuild bundles test/*.test.ts, then node --test (unit, podcasts)
npm run build            # dist/  (vite for UI, scripts/build-scripts.mjs for background/offscreen/content)
rm -rf dist && npm run build && npm run zip   # tunes.zip
npm run dev              # vite build --watch
```
Load it: `chrome://extensions` → Developer mode → Load unpacked → `extension/dist`. Open it with
Alt+M.

Debugging:
- Background: `chrome://extensions` → Tunes → "service worker" → Console.
- Side panel: right-click → Inspect.
- The background exposes `self.__tunesDebug` (`state`, `broadcast`) for tests.
- Settings has a lyrics debug and a stats toggle (`lyricsDebug`, `showStats`).

`test/live-podcasts.ts` hits real feeds and isn't part of `npm test`. Ignore the `build:mobile`
and `apk` scripts: they belong to the retired Capacitor app, and its folders aren't in the repo
(TASKS T-04).

## Backend
```bash
cd backend
go run .           # local server
go test -v ./...
```
Deploy: Render web service with root `backend`, build `go build -o server .`, start `./server`,
health check `/healthz`, **1 instance** (`render.yaml`). `backend/deploy/` holds an alternative VPS
setup (Caddy and systemd units).

## CI
- `.github/workflows/extension.yml`: on changes to `extension/**`, runs `npm ci`, `tsc`,
  `npm test` and `npm run build`.
- `.github/workflows/android.yml`: **runs by hand only**. Builds `assembleProdRelease`, signed
  if the `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD` secrets exist.
  Uses `LASTFM_API_KEY` and `LASTFM_SECRET` secrets. Unverified (TASKS T-02).

## Releasing the Android app
1. Raise `bitchordVersionCode` in the root `build.gradle.kts` (now 8). Change
   `bitchordVersionName` only with the owner's OK (now 3.2.0).
2. Build `:app:assembleProdRelease` with the Tunes key. Check the signature:
   `apksigner verify --print-certs <apk>` must show the SHA-256 above.
3. Add an entry to CHANGELOG.md and the README "What's new" section.
4. Commit, `git pull --rebase`, push.
5. Create the GitHub release (tag `vX.Y.Z`). **Attach the arm64 APK first, named
   `Tunes-X.Y.Z-arm64.apk`.** The in-app updater takes the first asset ending in `.apk` from
   `releases/latest`. The GitHub connector can't upload assets, so the owner does it by hand.
