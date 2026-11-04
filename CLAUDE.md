# CLAUDE.md: instructions for Claude Code

Read this first. It tells you what this repo is, the rules, and where to look. The details are in
the other root docs:

| File | Read it when |
|---|---|
| [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) | You need background, current status, or which modules are done |
| [ARCHITECTURE.md](ARCHITECTURE.md) | You're changing code and need to know how the parts fit together |
| [FEATURES.md](FEATURES.md) | You need to know what exists (and what doesn't) before adding anything |
| [TASKS.md](TASKS.md) | You're picking the next thing to do, or need the known bugs |
| [ROADMAP.md](ROADMAP.md) | You're deciding priorities |
| [DECISIONS.md](DECISIONS.md) | Before reversing anything that looks odd: it is probably deliberate |
| [API.md](API.md) | You're touching the network: YouTube Music, lyrics, transfer, the party server |
| [DATABASE.md](DATABASE.md) | You're touching stored data (SharedPreferences, files, chrome.storage) |
| [SETUP.md](SETUP.md) | Building, testing, signing, releasing |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Coding standards and PR rules |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## What this repo is

**Tunes** is a GPL-3.0 YouTube Music player by Hemanth Kundrapu ([@Hem456anth](https://github.com/Hem456anth)).
It is one repository with three deliverables:

1. **Android app** (`app/`, `shared/`, `sharedUi/`, `native/`): Kotlin, Jetpack Compose, Media3.
   It is a fork of [BitChord](https://github.com/kushagrasinghx/BitChord) v1.8 with Tunes branding
   and features. Package `app.tunes.music`, version **3.1.2 (versionCode 7)**.
2. **Tunes for Chrome** (`extension/`): a Manifest V3 side-panel player, React 18 + TypeScript +
   Vite 5. Version **1.3.1**.
3. **Listen Together server** (`backend/`): Go, WebSocket, in-memory, no database. Inherited from
   BitChord.

## Hard rules (don't break these)

- **Never block, skip or mute YouTube ads**, in either app. The extension's `adFreeOnly` setting only
  skips songs that have no ad-free source. See DECISIONS.md D-01.
- **Don't change versionName past what the owner asked for.** The owner asked for "v3.1.2 only", so
  new Android work so far has raised only `versionCode` (in `app/build.gradle.kts`). Ask before
  you bump `versionName`. `versionCode` must always go up.
- **Never rename the Kotlin package `com.music.bitchord`**, identifiers, string keys, log tags,
  SharedPreferences names (`bitchord_*`), native library names or server URLs. The prebuilt JNI
  symbols are named `Java_com_music_bitchord_*`, the encrypted prefs file names are part of the
  encryption, and backups use the app tag `bitchord`. Only docs and comments say "Tunes". (D-05)
- **Keep license notices verbatim**: copyright headers, the AGPL §13 "combined here into BitChord"
  notices, "Modified for/Vendored by BitChord" notices, and the BitChord entry in
  `extension/THIRD_PARTY_NOTICES.md`. BitChord stays credited in README Credits (GPL attribution).
- **Keep the 3.0 Explore and Search on Android** (`sharedUi/.../ui/screens/ExploreScreen.kt`,
  `SearchScreen.kt`, `MainViewModel.recordQuery`). If you merge upstream BitChord again, don't let
  its v1.8 redesign of those two screens back in. (D-07)
- **Extension: never open tabs for playback.** Audio plays in the offscreen document. The only tab
  the extension opens is `sidepanel.html?mode=tab`, when the user asks for it.
- **Extension menus stay essential.** Use a heart for likes (not a star). Don't add Apple Music-style
  features unless asked.
- **Never commit secrets**: `keystore.properties`, `*.jks`, `local.properties` (it holds
  `LASTFM_API_KEY`/`LASTFM_SECRET`) are all gitignored. Every release must be signed with the same
  key (certificate SHA-256 `963fa6cdbcedd9d6970b37acb42c28674b45b6215fa62bde799b2ac6eeb1f067`), or
  updates won't install over older versions.
- **Every dependency must be GPL-3.0 compatible.**
- **Don't put the Apple SF Pro fonts back**: they can't be redistributed. Use Inter (`Inter-OFL.txt`).
- **Podcasts are in the extension only.** The Android app has none.

## How to work here

1. Read the relevant section of ARCHITECTURE.md and the code you're changing. Comments in this
   codebase are long and explain *why*. Read them before you change behavior.
2. Make the smallest change that does the job. Don't reformat files or refactor along the way.
3. Test (commands in SETUP.md):
   - Android: `./gradlew :app:testProdReleaseUnitTest` (also `:shared:jvmTest` if you touched
     `shared/`). `GeniusTest` hits the live network and fails offline. That's expected.
   - Extension (in `extension/`): `npx tsc --noEmit -p . --noUnusedLocals && npm test && npm run build`.
   - Backend (in `backend/`): `go test ./...`.
4. Update the docs in the same change: CHANGELOG.md, FEATURES.md, and TASKS.md if you closed a
   task. Also update the README "What's new" section for user-visible changes.
5. Commit as `Hem456anth <183790673+Hem456anth@users.noreply.github.com>`. Pull with `--rebase`
   before you push, because the owner sometimes commits on GitHub directly.

## Big files to be careful in

- `app/src/main/java/com/music/bitchord/MainActivity.kt` (~5,450 lines): navigation, tabs,
  settings sub-screens, deep links.
- `app/src/main/java/com/music/bitchord/playback/PlaybackService.kt` (~8,400 lines): the Media3
  `MediaLibraryService`.
- `app/src/main/java/com/music/bitchord/ui/MainViewModel.kt` (~3,200 lines).
- `extension/src/background/index.ts`: the queue and the source chain, and `validCommand()`,
  which must accept every new `UiCommand`.

## What you can't verify in a sandbox

There's no emulator or device, no real audio, no YouTube `/player` or signed-in writes, and no live
Google Translate. When you report work, say which of these you couldn't test.
