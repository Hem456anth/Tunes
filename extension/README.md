# Tunes

A music player that lives in Chrome's side panel. Search and play YouTube Music, follow synced
lyrics, build a library and playlists, and keep listening while you work: the panel can close and
the music keeps going.

## Features
- **Listen Now, Explore, Library and Search** in a floating tab bar, with a mini player on narrow
  panels and a two-column layout on wide ones (or open it in a full tab).
- **Plays inside the extension.** No extra tabs: a hidden offscreen player handles audio with
  crossfade. The source order is up to you: JioSaavn 320 kbps when the same recording exists, then
  YouTube direct, then an embedded YouTube player as the last resort.
- **Synced lyrics** from several providers, checked against the song so you never get the wrong one.
- **Song menus (⋯, right-click or long-press):** Play Next, Play Last, Add to Library, Add to a
  Playlist, Like, Share Song, Create Station and Suggest Less.
- **Library:** Playlists, Albums, Songs, Liked songs, Recently played and Recently Added, stored locally.
- **Up Next queue**, autoplay radio, sleep timer, and media keys.
- **Accounts:** YouTube Music (it uses your Chrome sign-in), Last.fm and ListenBrainz scrobbling.
  Transfer playlists from Spotify or Apple Music.
- **Ad-free only** option: skip songs that have no ad-free source. Tunes never blocks or skips
  YouTube's ads.

## Install (developer mode)
1. Download the latest `tunes.zip` from Releases and unzip it, or build it yourself:
   `npm install && npm run build`, then use `dist/`.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the folder.
4. Pin Tunes and click it (or press **Alt+M**) to open the side panel.

## Shortcuts
| Keys | Action |
|---|---|
| Alt+M | Open Tunes |
| Alt+Shift+P | Play / pause |
| Alt+Shift+. / , | Next / previous |
| Space (in panel) | Play / pause |
| / (in panel) | Focus search |

Change keys at `chrome://extensions/shortcuts`.

## Android app
Tunes for Android is a separate app in this repository. Download the APK from
[Releases](https://github.com/Hem456anth/Tunes/releases/latest); see the main [README](../README.md).
Continue on Phone links from this extension open in Tunes for Android 3.1.0 or newer at the same second.

## Development
React 18 + TypeScript + Vite 5, Manifest V3. The background, offscreen and content scripts are
bundled with esbuild.

```
npm install
npm run build   # dist/
npm test        # unit tests (node:test, no browser needed)
npm run zip     # tunes.zip
```

```
public/manifest.json     MV3 manifest
src/background/          queue, source chain, commands, header rules
src/offscreen/           <audio> playback, embed fallback, media session
src/lib/                 YouTube Music client, sources, lyrics, library, transfer
src/sidepanel/           React UI
```

## Changes
### 1.3.1
- Continue on Phone (Now Playing ⋯): a QR code and link for the song at this second; Tunes for Android (3.1.0 or newer) opens it at that spot. Going the other way, share a song from the phone's player and paste the link into search here.
- QR codes by qrcode-generator (MIT, Kazuhiko Arase).

### 1.3.0
- Podcasts (Library → Podcasts, Explore, and a Podcasts chip in Search): top shows in India and search through Apple Podcasts and fyyd, any RSS feed or website address, follow shows, latest episodes, resume where you stopped, 0.75–2× speed, back 15 s and forward 30 s (media keys too), mark played, OPML import and export. Feeds are parsed in Tunes, following AntennaPod's rules (GPL-3.0); episode de-duplication and site-to-feed discovery are ported from Winds (BSD-3-Clause, © 2018 Stream.io Inc). Chrome asks once for permission to read podcast feeds.
- Don't Play This Song and Block Artist: autoplay, radio and the queue skip them; Settings → Blocked songs and artists to undo.
- Lyrics: Original, Romanized or Translated (choose the language in Settings), ported from the Android app's lyric translation.
- Gapless playback: the next song is loaded early and starts the moment the current one ends (when crossfade is off).
- Smarter autoplay: no songs you just heard, no duplicate uploads of the same song, never three in a row by one artist, blended with the song before.
- A short welcome on first run.
- One Library: songs you like are added to your Library, and Podcasts live there too.
- Reorder your playlists: drag, move up/down, or sort by title, artist or reverse.

### 1.2.0
- Reliability: every network call has a deadline (8–20 s), a stuck source moves on to the next one, a YouTube 403 tries the next client, and preloading the next song can't break the one playing.
- Long playlists and albums load in full (continuation pages, up to 1,000 songs).
- The queue is saved at most once a second and capped at 1,000 songs; position ticks no longer resend the whole queue.
- Plain-language errors with Retry, and the technical reason under Details.
- Settings → Import data restores a Tunes export (merges, never deletes; your Last.fm/ListenBrainz keys are kept).
- Quality badge under the seek bar (for example "320 kbps · AAC").
- Fixed: "Still Alive" was treated as a live version, and similar substring matches.
- Unit tests and CI.

## License and credits
GPL-3.0 (see LICENSE). Tunes isn't affiliated with YouTube, Google, Apple or Spotify.
Third-party notices (Winds, BSD-3-Clause; AntennaPod; GPL-3.0 lyric translation code; data sources) are in THIRD_PARTY_NOTICES.md and ship inside the extension.
