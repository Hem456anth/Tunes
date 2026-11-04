# Roadmap

Tunes is a personal project. Work happens when the owner asks for it. This file records priorities
so far, not promises. Task details are in TASKS.md.

## Done: the 15-feature plan (Oct 2026)
The owner asked for 15 roadmap features in three updates, each tested before the next, followed by
an audit. All shipped except feature 14:

Feature numbers come from the owner's list of 18 Oct 2026.

| Update | Version | Features |
|---|---|---|
| 1 | Extension 1.2.0 | 1 songs that always play (timeouts, deadlines, long playlists), 8 clear errors, 10 backup and restore (Import), 12 quality badge; also tests and CI |
| 2 | Extension 1.3.0 | 2 dislike and block, 3 lyric translation and romanization, 4 gapless, 6 better suggestions, 7 first-run guide, 9 one Library, 11 playlist reorder, 15 podcasts |
| 3 | Android 3.1.0 + extension 1.3.1 | 13 update to BitChord v1.8 (Spotify import, Cast, Android Auto), 5 phone-to-Chrome handoff (Continue on Phone QR, `t=` links) |
| — | — | 14 easy install: Chrome Web Store and IzzyOnDroid listings, **not built** (the Web Store needs the owner's developer account and fee; Android updates come from the in-app GitHub updater) |

After that came Android 3.1.1 (the 3.0 Explore and Search restored), 3.1.2 (swipe-away stops
playback, Music Transfer) and the README screenshots.

## Now (P1)
1. Fix the v3.1.2 asset name so in-app updates work (TASKS T-01).
2. Close the verification gaps on a real device (TASKS V-01, V-03).

## Next (P2)
3. Get `android.yml` CI working (T-02).
4. Ship the extension zip with releases, or fix its README (T-03).

## Later (P3, only when the owner asks)
5. Clean up the extension's retired Capacitor scripts (T-04).
6. Upgrade vite to clear the dev-only advisories (I-02).
7. Merge newer upstream BitChord (I-04), keeping the Tunes decisions.
8. Chrome Web Store listing (I-01).
9. MusicBrainz, once the owner decides what it should do (I-03).
