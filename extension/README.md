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
Tunes also ships as an Android app (Android 6.0 and newer, built for Android 15), using the same code:
- **Plays in the background** through a media service (ExoPlayer). That gives you the media
  notification, lock-screen, Bluetooth and headset controls, and audio focus, so a call pauses it.
- Phone layout with the mini player and floating tab bar. The Android back button closes sheets
  and pages; at Listen Now it sends Tunes to the background without stopping the music.
- **Security:** HTTPS only (no cleartext, system CAs only), backups off, and the Last.fm and
  ListenBrainz tokens encrypted with an Android Keystore key. The release build isn't debuggable.
- **Not on Android:** YouTube account sign-in (Google blocks sign-in inside apps like this), Transfer
  music and Export data. Search, playback, lyrics, library, playlists and scrobbling all work.

Install: download `Tunes-1.0.0.apk` from Releases, open it on your phone and allow "Install
unknown apps" when asked.

Build it yourself (needs JDK 21 and the Android SDK):
```
npm install
npm run build:mobile                       # web bundle -> dist-mobile, synced into android/
cd android && ./gradlew assembleRelease    # set TUNES_KEYSTORE_PROPS to sign
```

## Development
React 18 + TypeScript + Vite 5, Manifest V3. The background, offscreen and content scripts are
bundled with esbuild.

```
npm install
npm run build   # dist/
npm run zip     # tunes.zip
```

```
public/manifest.json     MV3 manifest
src/background/          queue, source chain, commands, header rules
src/offscreen/           <audio> playback, embed fallback, media session
src/lib/                 YouTube Music client, sources, lyrics, library, transfer
src/sidepanel/           React UI
```

## License and credits
GPL-3.0 (see [LICENSE](../LICENSE)). Tunes adapts ideas and code from the GPL-3.0
[BitChord](https://github.com/kushagrasinghx/BitChord) project. It isn't affiliated with YouTube,
Google, Apple or Spotify.
