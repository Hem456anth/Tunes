# Music Transfer (Android)

Settings → **Music Transfer** moves music from other services into Tunes.

## Sources
| Source | What it reads | How |
| --- | --- | --- |
| Spotify account | Liked Songs, playlists, saved albums, followed artists | Spotify's own login page in a WebView (the same one used for animated covers). Tunes never sees your password. |
| Spotify link | Public playlist or album | Spotify's public embed page |
| Deezer link | Public playlist, album, or a public profile (favourites, playlists, albums, artists) | Deezer's public API, no sign-in |
| Apple Music link | Public playlist or album | The data on Apple's public page. Very long playlists may show only their first rows. |
| YouTube / YouTube Music link | Playlist | Already YouTube songs, so there's no matching step |
| File | CSV (TuneMyMusic, Exportify, Soundiiz TSV, or any sheet with title and artist columns), M3U/M3U8, TXT (`Artist - Title` per line) | On-device parser |

## Destinations
- **YouTube Music** (signed in): liked songs become likes, playlists are created (private by
  default), albums are saved to the library, and artists are subscribed.
- **This phone**: Tunes on-device playlists. Albums become playlists. Artists need YouTube Music.

## Behaviour
- Matching: ISRC first when the source has one, then title + lead artist through Tunes' track
  matcher (length and album break ties). A strict fallback needs the same title, a shared artist
  and a length within 15 s.
- Duplicates: repeats inside a source count once. Songs already liked or already in the target
  playlist are skipped (optional). A playlist with the same name is merged into (optional).
- Progress is saved after every batch of 20. If Tunes is closed, the job comes back paused and
  resumes into the same playlists. Network and rate-limit errors retry 4 times with backoff. A
  collection that still fails is marked and the rest carry on. If YouTube Music sign-in lapses,
  the job pauses with a message.
- Songs that weren't found are listed per collection with **Find**, which shows search results to
  pick from. **Retry problems** runs failed collections again and searches again for missing songs.

## Third-party tools
- **TuneMyMusic** has no public developer API, and its terms don't allow building on it, so Tunes
  doesn't embed or scrape it. The screen links to it for services Tunes can't read (Tidal, Amazon
  Music, SoundCloud and others): transfer to YouTube Music there, or export a CSV and import it here.
- **SongShift** is an iPhone/iPad app with no public API. The screen links to it with the same advice.

## Not supported
Apple Music libraries (they need a paid MusicKit developer token), Tidal, Amazon Music and other
services without a public API. Use the TuneMyMusic route for those.
