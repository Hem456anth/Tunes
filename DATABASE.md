# Data storage

**Tunes has no database.** No SQL, no Room, no server-side storage. Each app keeps the user's data
on the device in key-value stores and JSON files. The Listen Together server keeps parties in
memory only, so they're lost on restart. That's by design.

Rule: **never rename a store or key**. The names still say `bitchord`, and renaming one silently
wipes user data, or breaks encryption for the encrypted stores (DECISIONS D-05). Add new keys
instead, and migrate on read.

## Android (`app/`)

### SharedPreferences
| Name | Holds | Code |
|---|---|---|
| `bitchord_settings` | Every user setting (about 110 keys), recent searches, download settings | `data/settings/AppSettings.kt`, `SearchHistory.kt`, `download/Downloads.kt` |
| `bitchord_auth` (encrypted) | Google/YouTube cookie, account sessions and active account/profile, channel ids, Discord token, WebDAV password, among others | `auth/AuthStore.kt` through `auth/EncryptedPrefs.open(…, "bitchord_auth", "bitchord_auth_plain")` |
| `bitchord_sources` (encrypted) | Configured sources (`SourceConfig` list as JSON) | `data/sources/SourceRegistry.kt` through `EncryptedPrefs.open(…, "bitchord_sources", "bitchord_sources_plain")` |
| `bitchord_local_playlists` | On-device playlists (also the "This phone" target of Music Transfer) | `data/spotify/LocalPlaylistStore.kt` |
| `bitchord_last_played` | The last queue and position, for resume | `playback/LastPlayed.kt` |
| `bitchord_original_versions` | Chosen original version per track | `playback/OriginalVersion.kt` |
| `bitchord_party_queue_stash` | Personal queue stashed during a party | `playback/PartyPersonalQueueStash.kt` |
| `bitchord_listen_together` | Party server address and session | `data/listentogether/ListenTogether.kt` |
| `bitchord_widget` | Widget snapshot | `widget/MediaWidgetSnapshot.kt` |
| `presence` | Presence ping state | `data/presence/AndroidPresence.kt` |
| `audio_cache_state` | Audio cache bookkeeping | `playback/AudioCache.kt` |
| `innertubex_player_config` | InnerTubeX player config cache | `data/innertube/AndroidStreamHooks.kt` |

`EncryptedPrefs` uses AndroidX `security-crypto`. The `*_plain` name is the fallback or migration
store used when the keystore can't be used. Read `auth/EncryptedPrefs.kt` before touching it.

### Files (`context.filesDir`)
| Path | Holds | Code |
|---|---|---|
| `music_transfer.json` | The resumable Music Transfer job (`TransferJob`: destination, options, items, state, startedAt, message) | `data/transfer/TransferEngine.kt` |
| `listening/` | Replay stats, one `StoredBucket` per month (tracks, artists, albums, hours, days) | `data/stats/ListeningStats.kt` |
| `artist_facts.json` | Cached artist facts | `data/stats/ArtistFacts.kt` |
| `smart_analysis/` | Automix per-track analysis (written through a temp file, then renamed) | `shared/.../playback/smart/AnalysisStore.kt` |
| `downloads/`, `download-artwork/`, `offline-hls/` | Offline audio and artwork | `download/*` |

Caches (`cacheDir`): `audio/`, `canvas/`, `remote_art/`, plus temporary tagging and share folders.
Downloads saved to public storage go to `Music/Tunes` (`DownloadStore.FOLDER = "Tunes"`).

### Backup format
`data/stats/Backup.kt` exports one JSON file (`tunes-backup-YYYY-MM-DD.json`) with
`app` (tag `bitchord`), `version` (schema), `versionName`, `settings` (typed values:
`{type, value | values}`) and `listening` (monthly buckets). Credentials are excluded
(`AppSettings.exportPrefs`). A backup from a newer schema is refused. Android auto-backup is off
(`allowBackup=false`).

## Chrome extension (`extension/`)

### `chrome.storage.local`
| Key | Holds | Code |
|---|---|---|
| `settings` | `Settings` (defaults: `DEFAULT_SETTINGS` in `src/lib/types.ts`). Includes Last.fm and ListenBrainz secrets | `src/lib/settings.ts` |
| `queue`, `index`, `shuffle`, `repeat`, `volume` | Player state (queue capped at 1,000) | `src/background/index.ts` |
| `libSongs`, `libCollections`, `localPlaylists`, `suggestLess` | Library. A local playlist's `browseId` is `local:<id>` | `src/lib/library.ts` |
| `liked` | Liked songs (shown in the Library) | `src/lib/history.ts` |
| `recentlyPlayed`, `recentSearches` | History | `src/lib/history.ts`, search UI |
| `lyricsPrefs` | Per-song lyric choices | `src/lib/lyrics.ts` |
| `blocked` | `{songs (≤2000), artists (≤500)}` | `src/lib/blocklist.ts` |
| `podcastSubs`, `podcastProgress`, `podcastRate` | Podcasts | `src/lib/podcasts/store.ts`, background |
| `importedPlaylists`, `transferMatches` | Transfer results and match memo | `src/lib/transfer/index.ts` |
| `visitorData` | InnerTube visitor id | `src/lib/innertube.ts` |
| `c2:<key>`, `c2-index` | Response cache | `src/lib/cache.ts` |

### `chrome.storage.session`
`engine`, `sleepAt`, `sleepEndOfTrack`, `loadToken`, `position`, `duration` (`background/index.ts`).

### Export and import
`src/lib/backup.ts`: `IMPORT_KEYS` lists what is imported. Import merges and never deletes, and it
never overwrites `SECRET_SETTINGS` (`listenbrainzToken`, `lastfmSecret`, `lastfmSession`,
`lastfmKey`, `lastfmUser`). The manifest asks for `unlimitedStorage`.

## Listen Together server
In-memory parties (`backend/party`), presence (`backend/presence`) and rate-limit maps. There's
no persistence. Run a single instance (`numInstances: 1` in `render.yaml`).
