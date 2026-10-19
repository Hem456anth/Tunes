package com.music.bitchord.data.transfer

import com.music.bitchord.data.Http
import com.music.bitchord.data.YtMusicRepository
import com.music.bitchord.data.spotify.SpotifyImporter
import com.music.bitchord.data.spotify.SpotifyLibrary
import com.music.bitchord.data.spotify.SpotifyTrack
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request

/**
 * Reads collections and their tracks from the services Tunes can reach without
 * a third-party middleman.
 *
 * - Spotify: the account signed in under Settings → Account (its own login page
 *   in a WebView; Tunes never sees the password), or any public playlist/album link.
 * - Deezer: Deezer's public API — a public profile link lists its favourites,
 *   playlists, albums and artists; playlist and album links work too.
 * - Apple Music: public playlist and album links, read off the page Apple serves.
 * - YouTube Music / YouTube: playlist links, already YouTube ids.
 */
object TransferSources {

    private const val BROWSER_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    // ---- Spotify account ------------------------------------------------------

    /** Liked Songs, playlists, saved albums and followed artists of the signed-in Spotify account. */
    suspend fun spotifyLibrary(): List<SourceCollection> = withContext(Dispatchers.IO) {
        val out = mutableListOf<SourceCollection>()
        SpotifyLibrary.playlists().forEach { p ->
            val liked = p.id == SpotifyLibrary.LIKED_ID
            out += SourceCollection(
                id = p.id,
                service = TransferService.SPOTIFY,
                kind = if (liked) CollectionKind.LIKED else CollectionKind.PLAYLIST,
                name = p.name,
                subtitle = p.owner,
                imageUrl = p.imageUrl,
            )
        }
        // Albums and artists are extras: a library query Spotify changes
        // shouldn't cost the listener their playlists.
        runCatching { SpotifyLibrary.albums() }.getOrNull()?.forEach { a ->
            out += SourceCollection(a.id, TransferService.SPOTIFY, CollectionKind.ALBUM, a.name, a.subtitle, a.imageUrl)
        }
        runCatching { SpotifyLibrary.artists() }.getOrNull()?.forEach { a ->
            out += SourceCollection(a.id, TransferService.SPOTIFY, CollectionKind.ARTIST, a.name, null, a.imageUrl)
        }
        out
    }

    private fun SpotifyTrack.toSource() = SourceTrack(
        title = title,
        artist = artist,
        album = album,
        durationSec = durationMs.takeIf { it > 0 }?.div(1000),
    )

    // ---- Links ------------------------------------------------------------------

    /** What a pasted link points at, or null when Tunes can't read it. */
    sealed interface Link {
        data class SpotifyPlaylist(val id: String) : Link
        data class SpotifyAlbum(val id: String) : Link
        data class DeezerPlaylist(val id: String) : Link
        data class DeezerAlbum(val id: String) : Link
        data class DeezerProfile(val id: String) : Link
        data class DeezerShort(val url: String) : Link
        data class ApplePage(val url: String) : Link
        data class YouTubePlaylist(val id: String) : Link
    }

    private val SPOTIFY_ID = Regex("""[A-Za-z0-9]{22}""")

    fun parseLink(input: String): Link? {
        val text = input.trim()
        Regex("""spotify:(playlist|album):([A-Za-z0-9]{22})""").find(text)?.let { m ->
            return if (m.groupValues[1] == "album") Link.SpotifyAlbum(m.groupValues[2]) else Link.SpotifyPlaylist(m.groupValues[2])
        }
        val url = Regex("""https?://\S+""").find(text)?.value?.toHttpUrlOrNull() ?: return null
        val host = url.host.lowercase()
        val segments = url.pathSegments.filter { it.isNotBlank() }
        fun after(name: String) = segments.indexOf(name).takeIf { it >= 0 }?.let { segments.getOrNull(it + 1) }
        return when {
            host == "open.spotify.com" || host == "play.spotify.com" -> {
                after("playlist")?.takeIf { SPOTIFY_ID.matches(it) }?.let { Link.SpotifyPlaylist(it) }
                    ?: after("album")?.takeIf { SPOTIFY_ID.matches(it) }?.let { Link.SpotifyAlbum(it) }
            }
            host == "deezer.page.link" || host == "link.deezer.com" -> Link.DeezerShort(url.toString())
            host.endsWith("deezer.com") -> {
                after("playlist")?.takeIf { it.all(Char::isDigit) }?.let { Link.DeezerPlaylist(it) }
                    ?: after("album")?.takeIf { it.all(Char::isDigit) }?.let { Link.DeezerAlbum(it) }
                    ?: after("profile")?.takeIf { it.all(Char::isDigit) }?.let { Link.DeezerProfile(it) }
            }
            host == "music.apple.com" || host == "itunes.apple.com" ->
                if (segments.any { it == "playlist" || it == "album" }) Link.ApplePage(url.toString()) else null
            host.endsWith("youtube.com") || host == "youtu.be" ->
                url.queryParameter("list")?.takeIf { it.isNotBlank() }?.let { Link.YouTubePlaylist(it) }
            else -> null
        }
    }

    /** Every collection a link opens: one playlist or album, or a whole Deezer profile. */
    suspend fun fromLink(input: String): List<SourceCollection> = withContext(Dispatchers.IO) {
        when (val link = parseLink(input) ?: throw TransferException("Tunes can't read that link. Paste a Spotify, Deezer, Apple Music or YouTube playlist or album link.")) {
            is Link.SpotifyPlaylist -> listOf(spotifyEmbed("playlist", link.id))
            is Link.SpotifyAlbum -> listOf(spotifyEmbed("album", link.id))
            is Link.DeezerPlaylist -> listOf(deezerPlaylist(link.id))
            is Link.DeezerAlbum -> listOf(deezerAlbum(link.id))
            is Link.DeezerProfile -> deezerProfile(link.id)
            is Link.DeezerShort -> fromLink(resolveRedirect(link.url))
            is Link.ApplePage -> listOf(AppleMusicPage.parse(fetchText(link.url), link.url))
            is Link.YouTubePlaylist -> listOf(youtubePlaylist(link.id))
        }
    }

    /** Fills in [SourceCollection.tracks] for a collection listed without them. */
    suspend fun tracksOf(collection: SourceCollection): List<SourceTrack> = withContext(Dispatchers.IO) {
        collection.tracks?.let { return@withContext it }
        when (collection.service) {
            TransferService.SPOTIFY -> when (collection.kind) {
                CollectionKind.LIKED, CollectionKind.PLAYLIST -> SpotifyLibrary.tracks(collection.id).map { it.toSource() }
                CollectionKind.ALBUM -> spotifyEmbed("album", collection.id).tracks.orEmpty()
                CollectionKind.ARTIST -> emptyList()
            }
            TransferService.DEEZER -> when (collection.kind) {
                CollectionKind.LIKED -> deezerTracks("https://api.deezer.com/user/${collection.id}/tracks")
                CollectionKind.PLAYLIST -> deezerTracks("https://api.deezer.com/playlist/${collection.id}/tracks")
                CollectionKind.ALBUM -> deezerAlbum(collection.id).tracks.orEmpty()
                CollectionKind.ARTIST -> emptyList()
            }
            else -> emptyList()
        }
    }

    // ---- Spotify links (public embed) -------------------------------------------

    private suspend fun spotifyEmbed(kind: String, id: String): SourceCollection {
        if (kind == "playlist") {
            // The importer already pages past the embed's first 100 tracks.
            val (title, tracks) = runCatching { SpotifyImporter.fetchPlaylistTracks(id) }
                .getOrElse { throw TransferException("That Spotify playlist couldn't be read. Make sure it's public.", it) }
            return SourceCollection(
                id = id, service = TransferService.SPOTIFY, kind = CollectionKind.PLAYLIST, name = title,
                count = tracks.size, tracks = tracks.map { SourceTrack(title = it.title, artist = it.artist) },
            )
        }
        val html = fetchText("https://open.spotify.com/embed/$kind/$id")
        val data = Regex("""<script id="__NEXT_DATA__" type="application/json">(.*?)</script>""", RegexOption.DOT_MATCHES_ALL)
            .find(html)?.groupValues?.get(1) ?: throw TransferException("That Spotify $kind couldn't be read.")
        return parseSpotifyEmbed(json.parseToJsonElement(data).jsonObject, kind, id)
    }

    internal fun parseSpotifyEmbed(root: JsonObject, kind: String, id: String): SourceCollection {
        val props = root.o("props")?.o("pageProps")
        val entity = props?.o("state")?.o("data")?.o("entity") ?: props?.o("entity")
            ?: throw TransferException("That Spotify $kind is private or gone.")
        val name = entity.s("name") ?: entity.s("title") ?: "Spotify $kind"
        val byline = entity.s("subtitle")
        val tracks = entity.a("trackList")?.mapNotNull { el ->
            val t = el as? JsonObject ?: return@mapNotNull null
            val title = t.s("title") ?: return@mapNotNull null
            SourceTrack(
                title = title,
                artist = t.s("subtitle") ?: byline.orEmpty(),
                album = if (kind == "album") name else null,
                durationSec = t.i("duration")?.div(1000)?.takeIf { it > 0 },
            )
        }.orEmpty()
        val image = entity.o("visualIdentity")?.a("image")?.mapNotNull { (it as? JsonObject)?.s("url") }?.lastOrNull()
        return SourceCollection(
            id = id,
            service = TransferService.SPOTIFY,
            kind = if (kind == "album") CollectionKind.ALBUM else CollectionKind.PLAYLIST,
            name = name,
            subtitle = byline,
            imageUrl = image,
            count = tracks.size,
            tracks = tracks,
        )
    }

    // ---- Deezer (public API) ---------------------------------------------------

    private fun deezerJson(url: String): JsonObject {
        val root = json.parseToJsonElement(fetchText(url)).jsonObject
        root.o("error")?.let { err ->
            val code = err.i("code")
            throw TransferException(
                when (code) {
                    800 -> "Deezer couldn't find that. Check the link."
                    4 -> "Deezer is busy. Try again in a moment."
                    else -> "Deezer said: ${err.s("message") ?: "error $code"}. Is the profile or playlist public?"
                },
            )
        }
        return root
    }

    /** Every page of a Deezer list endpoint (`data` + `next`). */
    private fun deezerPaged(first: String, cap: Int = 10_000): List<JsonObject> {
        val out = mutableListOf<JsonObject>()
        var next: String? = if ('?' in first) "$first&limit=100" else "$first?limit=100"
        val seen = HashSet<String>()
        while (next != null && seen.add(next) && out.size < cap) {
            val page = deezerJson(next)
            page.a("data")?.forEach { (it as? JsonObject)?.let(out::add) }
            next = page.s("next")
        }
        return out
    }

    internal fun deezerTrack(t: JsonObject, album: String? = null) = SourceTrack(
        title = t.s("title") ?: "",
        artist = t.o("artist")?.s("name").orEmpty(),
        album = album ?: t.o("album")?.s("title"),
        durationSec = t.i("duration")?.takeIf { it > 0 },
        isrc = t.s("isrc"),
    )

    private fun deezerTracks(url: String) = deezerPaged(url).map { deezerTrack(it) }.filter { it.title.isNotBlank() }

    private fun deezerPlaylist(id: String): SourceCollection {
        val p = deezerJson("https://api.deezer.com/playlist/$id")
        val tracks = deezerTracks("https://api.deezer.com/playlist/$id/tracks")
        return SourceCollection(
            id = id, service = TransferService.DEEZER, kind = CollectionKind.PLAYLIST,
            name = p.s("title") ?: "Deezer playlist", subtitle = p.o("creator")?.s("name"),
            imageUrl = p.s("picture_medium"), count = tracks.size, tracks = tracks,
        )
    }

    private fun deezerAlbum(id: String): SourceCollection {
        val a = deezerJson("https://api.deezer.com/album/$id")
        val name = a.s("title") ?: "Deezer album"
        val tracks = deezerPaged("https://api.deezer.com/album/$id/tracks").map { deezerTrack(it, name) }
        return SourceCollection(
            id = id, service = TransferService.DEEZER, kind = CollectionKind.ALBUM, name = name,
            subtitle = a.o("artist")?.s("name"), imageUrl = a.s("cover_medium"), count = tracks.size, tracks = tracks,
        )
    }

    private fun deezerProfile(userId: String): List<SourceCollection> {
        val user = deezerJson("https://api.deezer.com/user/$userId")
        val owner = user.s("name")
        val out = mutableListOf<SourceCollection>()
        out += SourceCollection(
            id = userId, service = TransferService.DEEZER, kind = CollectionKind.LIKED,
            name = "Favourite tracks", subtitle = owner,
        )
        deezerPaged("https://api.deezer.com/user/$userId/playlists").forEach { p ->
            if (p.b("is_loved_track") == true) return@forEach // the favourites list again
            out += SourceCollection(
                id = p.s("id") ?: return@forEach, service = TransferService.DEEZER, kind = CollectionKind.PLAYLIST,
                name = p.s("title") ?: "Playlist", subtitle = p.o("creator")?.s("name"),
                imageUrl = p.s("picture_medium"), count = p.i("nb_tracks"),
            )
        }
        deezerPaged("https://api.deezer.com/user/$userId/albums").forEach { a ->
            out += SourceCollection(
                id = a.s("id") ?: return@forEach, service = TransferService.DEEZER, kind = CollectionKind.ALBUM,
                name = a.s("title") ?: "Album", subtitle = a.o("artist")?.s("name"), imageUrl = a.s("cover_medium"),
            )
        }
        deezerPaged("https://api.deezer.com/user/$userId/artists").forEach { a ->
            out += SourceCollection(
                id = a.s("id") ?: return@forEach, service = TransferService.DEEZER, kind = CollectionKind.ARTIST,
                name = a.s("name") ?: "Artist", imageUrl = a.s("picture_medium"),
            )
        }
        return out
    }

    // ---- YouTube ------------------------------------------------------------------

    private suspend fun youtubePlaylist(listId: String): SourceCollection {
        val browseId = if (listId.startsWith("VL")) listId else "VL$listId"
        val songs = YtMusicRepository.allSongs(browseId).getOrElse {
            throw TransferException("That YouTube playlist couldn't be read. Is it public or unlisted?", it)
        }
        return SourceCollection(
            id = listId, service = TransferService.YOUTUBE_MUSIC, kind = CollectionKind.PLAYLIST,
            name = "YouTube playlist", count = songs.size,
            imageUrl = songs.firstOrNull()?.thumbnailUrl,
            tracks = songs.map { SourceTrack(title = it.title, artist = it.artist, album = it.albumName, videoId = it.videoId) },
        )
    }

    // ---- HTTP ---------------------------------------------------------------------

    internal fun fetchText(url: String): String {
        val request = Request.Builder().url(url).header("User-Agent", BROWSER_UA).header("Accept-Language", "en").build()
        return Http.client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw TransferException(
                    if (response.code == 404) "That page doesn't exist any more." else "The service answered HTTP ${response.code}.",
                    retryable = response.code == 429 || response.code >= 500,
                )
            }
            response.body?.string().orEmpty()
        }
    }

    private fun resolveRedirect(url: String): String {
        val request = Request.Builder().url(url).header("User-Agent", BROWSER_UA).build()
        return Http.client.newCall(request).execute().use { it.request.url.toString() }
    }
}

/** A transfer step failed; [retryable] when trying again later might work. */
class TransferException(message: String, cause: Throwable? = null, val retryable: Boolean = false) : Exception(message, cause)

/**
 * Reads a public Apple Music playlist or album page.
 *
 * The page carries its own data as JSON (`serialized-server-data`): a header
 * section with the title and curator, and a track list whose rows name the
 * song, its artists and its length. Long playlists show their first rows only.
 */
object AppleMusicPage {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    fun parse(html: String, url: String): SourceCollection {
        val raw = Regex("""<script[^>]*id="serialized-server-data"[^>]*>(.*?)</script>""", RegexOption.DOT_MATCHES_ALL)
            .find(html)?.groupValues?.get(1) ?: throw TransferException("That Apple Music page couldn't be read.")
        val root = json.parseToJsonElement(raw)
        val page = (root as? JsonObject)?.a("data")?.firstOrNull()?.let { it as? JsonObject }?.o("data")
            ?: ((root as? JsonArray)?.firstOrNull() as? JsonObject)?.o("data")
            ?: throw TransferException("That Apple Music page looks different than expected.")
        val sections = page.a("sections").orEmpty().mapNotNull { it as? JsonObject }
        val header = sections.firstOrNull { it.s("id")?.contains("detail-header") == true }?.a("items")?.firstOrNull() as? JsonObject
        val isAlbum = "/album/" in url
        val name = header?.s("title") ?: "Apple Music ${if (isAlbum) "album" else "playlist"}"
        val byline = header?.a("subtitleLinks")?.mapNotNull { (it as? JsonObject)?.s("title") }?.joinToString(", ")
        val trackSection = sections.firstOrNull { it.s("id")?.startsWith("track-list") == true && it.s("itemKind") == "trackLockup" }
        val tracks = trackSection?.a("items").orEmpty().mapNotNull { el ->
            val t = el as? JsonObject ?: return@mapNotNull null
            val title = t.s("title") ?: return@mapNotNull null
            val artist = t.s("artistName")
                ?: t.a("subtitleLinks")?.mapNotNull { (it as? JsonObject)?.s("title") }?.joinToString(", ")
                ?: if (isAlbum) byline.orEmpty() else ""
            val album = if (isAlbum) name else t.a("tertiaryLinks")?.firstOrNull()?.let { (it as? JsonObject)?.s("title") }
            SourceTrack(
                title = title,
                artist = artist,
                album = album?.removeSuffix(" - Single")?.removeSuffix(" - EP"),
                durationSec = t.i("duration")?.div(1000)?.takeIf { it > 0 },
            )
        }
        if (tracks.isEmpty()) throw TransferException("No songs found on that Apple Music page.")
        val art = header?.o("artwork")?.o("dictionary")?.s("url")
            ?.replace("{w}", "300")?.replace("{h}", "300")?.replace("{f}", "jpg")
        return SourceCollection(
            id = url.substringAfterLast('/').substringBefore('?'),
            service = TransferService.APPLE_MUSIC,
            kind = if (isAlbum) CollectionKind.ALBUM else CollectionKind.PLAYLIST,
            name = name,
            subtitle = byline,
            imageUrl = art,
            count = tracks.size,
            tracks = tracks,
        )
    }
}

// ---- small JSON helpers -----------------------------------------------------------

internal fun JsonObject.o(key: String): JsonObject? = (this[key] as? JsonObject)
internal fun JsonObject.a(key: String): JsonArray? = (this[key] as? JsonArray)
internal fun JsonObject.s(key: String): String? =
    (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.takeIf { it.isNotBlank() && it != "null" }
internal fun JsonObject.i(key: String): Int? = (this[key] as? JsonPrimitive)?.content?.toDoubleOrNull()?.toInt()
internal fun JsonObject.b(key: String): Boolean? = (this[key] as? JsonPrimitive)?.content?.toBooleanStrictOrNull()
