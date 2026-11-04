# Contributing to Tunes

Thank you for contributing to Tunes. Follow these guidelines to ensure an efficient development and review process.

## Proposing Contributions
- Substantial features, refactors, or UI redesigns should normally be discussed before implementation. Open an issue on GitHub to outline your proposal.
- Straightforward bug fixes, documentation improvements, or minor corrections can be submitted directly as a Pull Request.

## Branch and Pull Request Workflow
Always check the repository for the current active version or development branch before starting work.

Base new work on `main` unless a maintainer asks otherwise.

When contributing:
- Fork the repository and create a descriptive branch (e.g., `fix/streaming-buffer`, `docs/translation-guide`).
- Keep pull requests focused on a single change or bug fix. Avoid mixing unrelated refactors, cosmetic tweaks, or mass reformatting with functional changes.
- Keep your branch reasonably synchronized with the target base branch.
- Provide a clear PR description explaining what was changed and why.
- Include relevant testing and validation details with your PR.
- Address review feedback promptly and keep discussions focused on technical merits.

## Development Setup
The project requires the following tools:
- **JDK**: Java Development Kit 17 (Eclipse Temurin 17 recommended).
- **Android SDK**: `compileSdk = 37`, `targetSdk = 36`, `minSdk = 26`.
- **C/C++ NDK & CMake**: CMake 3.22.1+ and Android NDK (for native audio DSP components configured under `app/src/main/cpp`).
- **Chrome extension (Optional)**: Node.js 22 for `extension/` (`npm ci && npm test && npm run build`).
- **Listen Together Backend (Optional)**: Go (the version in `backend/go.mod`) if developing or testing the party server (`backend/`).

## Build and Test Commands
Run Gradle commands from the repository root.

Build:
```bash
./gradlew assembleDevDebug
```

Windows:
```powershell
.\gradlew.bat assembleDevDebug
```

Tests:
```bash
./gradlew testDevDebugUnitTest
```

Windows:
```powershell
.\gradlew.bat testDevDebugUnitTest
```

Run a specific test:
```bash
./gradlew testDevDebugUnitTest --tests "com.music.bitchord.playback.audio.DirectAudioStreamingRegressionTest"
```

## Architecture Rules (Tunes)
Read [CLAUDE.md](CLAUDE.md) and [DECISIONS.md](DECISIONS.md) before changing behavior. In short:
- Never block, skip or mute YouTube ads.
- Don't rename the `com.music.bitchord` package, identifiers, prefs or store names, log tags or
  native libraries. Only docs and comments use the Tunes name.
- Keep license and copyright notices verbatim.
- Keep the 3.0 Explore and Search screens on Android.
- The extension never opens tabs for playback. Every new `UiCommand` must be added to
  `validCommand()` in `extension/src/background/index.ts`.
- Never commit `keystore.properties`, `*.jks` or `local.properties`. Releases use the one Tunes
  signing key.

## Extension and Backend Checks
```bash
cd extension && npx tsc --noEmit -p . --noUnusedLocals && npm test && npm run build
cd backend && go test ./...
```
Extension code: TypeScript strict, React function components, no new runtime dependencies without
a reason. Match the existing compact style. Add a `node:test` case in `extension/test/` for new
logic.

## Commits and Docs
- Use one focused commit per change, with a message that says what changed for the user
  (e.g. "Tunes 3.1.2 for Android: closing Tunes from Recent Apps stops playback").
- Run `git pull --rebase` before you push.
- In the same change, update [CHANGELOG.md](CHANGELOG.md), [FEATURES.md](FEATURES.md) and
  [TASKS.md](TASKS.md), and the README "What's new" section for user-visible changes. Setup
  details are in [SETUP.md](SETUP.md).

## Code Quality
- Follow idiomatic Kotlin and Jetpack Compose conventions.
- Maintain the project's existing architecture and separation of concerns (UI, domain logic, playback services, and data repositories).
- Write unit tests for new logic, fixes, and edge cases.
- Contributors should run relevant tests, must not introduce new failures, and should document known pre-existing failures when applicable.
- Keep diffs focused and minimal. Avoid unnecessary third-party dependencies.

## Audio Changes and Telemetry
For audio changes: application telemetry must not be presented as proof of physical hardware behavior unless that hardware behavior was actually verified.

Distinguish clearly between source metadata, decoder format, internal DSP format, AudioTrack output, AudioFlinger/HAL state, advertised device capability, and external physical endpoint behavior.

## Review Process
All pull requests require review and approval by repository maintainers before merging. Maintainers review changes for correctness, architecture fit, and maintainability.

## Dependencies and Licensing
Tunes is licensed under the **GNU General Public License v3.0 (GPLv3)**.

All contributed code and dependencies must be strictly compatible with GPLv3. Avoid introducing external dependencies unless strictly necessary; any new dependency must be evaluated for necessity, binary size, and license compliance.
