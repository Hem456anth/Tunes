<div align="center">

<img src="Logo.png" alt="Tunes app icon" width="160" />

# Tunes

### An aesthetic YouTube Music client for Android, plus a Chrome side-panel player

[**Download**](#download) · [**Features**](#features) · [**Build**](#build) · [**Chrome extension**](#chrome-extension) · [**Credits**](#credits--license)

</div>

> [!WARNING]
> Tunes is not affiliated with, endorsed by, or connected to YouTube, Google, Spotify, JioSaavn or any other service it talks to. Use it at your own discretion.

<h2><a id="features"></a>Features</h2>

<table>
  <tr>
    <td width="50%" valign="top">

#### Playback
- **Search, browse and play** anything available on YouTube Music.
- **Hi-Res lossless audio** — FLAC/ALAC from a configured module source, with YouTube Music as fallback.
- **Gapless playback with true crossfade**, adjustable 0–12s.
- **Automix [Beta]** — DJ-style transitions with beat-matching and tempo-stretching.
- **Offline downloads** — save tracks with embedded metadata.
- **Local music library** integration.
- **Background playback** via a proper foreground media session.

#### Experience
- **Animated album canvas** — motion artwork on the now-playing screen.
- **Word-synced lyrics** — word/syllable-level highlighting from multiple sources.
- **Dynamic, artwork-driven theming** — Material palette extracted from album art.
- **Frosted-glass UI** — Telegram-style translucent bars via Haze, Material 3 theming.

    </td>
    <td width="50%" valign="top">

#### Connectivity & Accounts
- **Sign in with your Google account** for personalized content.
- **Discord Rich Presence** — in-app login, live track/artist/album and progress.
- **Scrobbling** to Last.fm and ListenBrainz.
- **Pluggable sources** — add, edit, test and health-check module sources.

#### Controls & Tweaks
- **Per-network audio quality** — separate quality ceilings for Wi-Fi and mobile data.
- **Playback speed control** (0.5×–2.0×) and **skip silence**.
- **Sleep timer** — fixed presets or "stop after this track".
- **System equalizer** integration.
- **Home-screen widgets**, **Android Auto**, and **Replay** listening stats.
- **Stats for nerds** — codec, bit depth, sample rate, and more on the now-playing screen.

    </td>
  </tr>
</table>

</div>

</div>

## Download

Grab the latest signed APK from [Releases](https://github.com/Hem456anth/Tunes/releases).
`Tunes-<version>-arm64.apk` fits almost every phone from the last few years; the
`universal` APK covers every ABI. Sideloading needs "Install unknown apps" for the app you
download it with. Package: `app.tunes.music` (installs beside BitChord).

## Repository layout

Same structure and setup as BitChord:

| Path | What it is |
| --- | --- |
| `app/` | The Android app (Kotlin, Jetpack Compose, Media3). Sources in `app/src/main/java`, tests in `app/src/test`. |
| `app/src/main/cpp/`, `native/` | C++ audio analysis for Automix (JNI, built with the NDK via CMake). |
| `app/src/main/assets/` | Logo and the int8 ONNX models used by Automix. |
| `gradle/`, `build.gradle.kts`, `settings.gradle.kts` | Gradle 8.11 wrapper, AGP 8.10, Kotlin 2.3. |
| `keystore.properties.example` | Template for release signing (the real file is gitignored). |
| `.github/workflows/android.yml` | CI: dev debug APK on branches, signed prod release on `main`, extension build. |
| `extension/` | The Tunes Chrome (MV3) side-panel player (React, TypeScript, Vite). |

## Build

Requirements: JDK 17, Android SDK 36, NDK + CMake 3.22.1.

```bash
./gradlew :app:assembleDevDebug          # app.tunes.music.dev, installs beside the release
./gradlew :app:assembleProdRelease       # app/build/outputs/apk/prod/release/
./gradlew :app:testProdReleaseUnitTest   # unit tests
```

Optional `local.properties` keys (never commit them): `LASTFM_API_KEY`, `LASTFM_SECRET`,
`MODULE_INDEX_URL`. Without them Last.fm sign-in and Hi-Res module sources stay off and
everything else works.

Signing: copy `keystore.properties.example` to `keystore.properties` and point it at your
keystore. Without it the release build comes out unsigned instead of failing. CI reads
`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD` from repository secrets.

Hosts without an NDK can set `TUNES_PREBUILT_NATIVE_DIR` to a `jniLibs`-shaped folder
containing `libbitchord_analysis.so` built from `native/` elsewhere.

## Chrome extension

`extension/` holds Tunes for Chrome: search, Listen Now, Explore, Library, queue, synced
lyrics and media keys in the side panel, with audio that keeps playing after the panel
closes. See [extension/README.md](extension/README.md).

```bash
cd extension && npm ci && npm run build && npm run zip   # dist/ and tunes.zip
```

Load `extension/dist` from `chrome://extensions` with Developer mode on.

## What Tunes changes relative to BitChord v1.5.1

- **Identity:** package `app.tunes.music`, name "Tunes", its own blue logomark and icon.
  Internal Kotlin packages stay `com.music.bitchord` so upstream fixes merge cleanly.
- **Blue accents:** red action buttons and accents are blue (`ActionBlue` #4A94FF on dark /
  #005BD3 on light, `AccentBlue` #0A60FF), all at least 4.5:1 contrast. Error text stays red.
- **Fonts:** Inter (SIL OFL 1.1, see `Inter-OFL.txt`) instead of SF Pro, which can't be
  redistributed.
- **Security:** Android backup and device transfer are off, so sign-in cookies and tokens
  never leave the device; the Spotify token WebView is locked to `*.spotify.com`.
- **Updates:** the in-app update checker reads this repository's releases.
- BitChord backups still import.

## Credits & license

Tunes is a fork of [BitChord](https://github.com/kushagrasinghx/BitChord) by
[Kushagra Singh](https://github.com/kushagrasinghx), based on v1.5.1 (`05f4be9`). It uses
NewPipe Extractor, Media3/ExoPlayer, ONNX Runtime, QuickJS, Haze and the other libraries
listed in `app/build.gradle.kts`, under their own licenses.

Tunes is free software under the **GNU General Public License v3.0**; see [LICENSE](LICENSE).
Anyone who distributes it must provide the corresponding source under the same license.
Tunes doesn't host, upload or store any music; it's an interface to public and
user-authenticated services, and you're responsible for using it within your local law and
those services' terms.
